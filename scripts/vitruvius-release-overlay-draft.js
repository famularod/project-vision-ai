#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SCHEMA_VERSION,
  canonicalOverlayPayload,
  fileMode,
  isForbiddenOverlayPath,
  normalizeOverlaySpec,
  normalizeRelativePath,
  sha256,
  sha256File,
} = require('./vitruvius-sealed-candidate');

const SUMMARY_SAMPLE_LIMIT = 50;

function runGit(args, { cwd, encoding = 'utf8' }) {
  const result = spawnSync('git', args, {
    cwd,
    encoding,
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message
      || (Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8').trim()
        : String(result.stderr || '').trim())
      || `git exited with ${String(result.status)}`;
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

function nulSeparatedPaths(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  return text.split('\0').filter(Boolean).map(normalizeRelativePath);
}

function canonicalCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escaped its root: ${relativePath}`);
  }
  return target;
}

function canonicalNewFilePath(filePath, label) {
  const resolved = path.resolve(filePath);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) throw new Error(`${label} parent does not exist: ${parent}`);
  return path.join(fs.realpathSync(parent), path.basename(resolved));
}

function assertOutsideSource(sourceRoot, filePath, label) {
  const relative = path.relative(sourceRoot, filePath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the source worktree.`);
  }
}

function resolveBaselineCommit(sourceRoot, baselineCommit) {
  const requested = String(baselineCommit || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(requested)) {
    throw new Error('baselineCommit must be a full Git commit object ID.');
  }
  const resolved = String(runGit(
    ['rev-parse', '--verify', `${requested}^{commit}`],
    { cwd: sourceRoot },
  )).trim().toLowerCase();
  if (resolved !== requested) {
    throw new Error(`baselineCommit resolved to a different object ID: ${resolved}`);
  }
  return resolved;
}

function readBaselineEntries(sourceRoot, baselineCommit) {
  const raw = runGit(
    ['ls-tree', '-r', '-z', '--full-tree', baselineCommit],
    { cwd: sourceRoot, encoding: null },
  );
  const records = nulSeparatedPathsForTree(raw);
  const entries = new Map();
  for (const record of records) {
    const tabIndex = record.indexOf('\t');
    if (tabIndex < 0) throw new Error('Git returned an invalid baseline tree record.');
    const header = record.slice(0, tabIndex).split(' ');
    const relativePath = normalizeRelativePath(record.slice(tabIndex + 1));
    if (header.length !== 3 || header[1] !== 'blob') {
      throw new Error(`Unsupported baseline entry type at ${relativePath}.`);
    }
    if (!['100644', '100755'].includes(header[0])) {
      throw new Error(`Unsupported baseline file mode at ${relativePath}: ${header[0]}`);
    }
    if (isForbiddenOverlayPath(relativePath)) {
      throw new Error(`Baseline contains a forbidden generated, benchmark, cache, or secret path: ${relativePath}`);
    }
    entries.set(relativePath, {
      mode: header[0],
      objectId: header[2],
    });
  }
  return entries;
}

function nulSeparatedPathsForTree(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  return text.split('\0').filter(Boolean);
}

function gitStatusSnapshot(sourceRoot) {
  const status = String(runGit(
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    { cwd: sourceRoot },
  )).trim();
  return {
    entryCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    outputSha256: sha256(Buffer.from(status, 'utf8')),
  };
}

function normalizeAllowedRules(sourceRoot, values) {
  const seen = new Set();
  return values.map(rawValue => {
    const relativePath = normalizeRelativePath(rawValue);
    if (seen.has(relativePath)) {
      throw new Error(`Allowed untracked path is listed more than once: ${relativePath}`);
    }
    seen.add(relativePath);
    if (isForbiddenOverlayPath(relativePath)) {
      throw new Error(`A generated, benchmark, cache, or secret path cannot be allowed: ${relativePath}`);
    }
    const absolutePath = resolveInside(sourceRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Allowed untracked path does not exist: ${relativePath}`);
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`Allowed untracked path must be a regular file or directory: ${relativePath}`);
    }
    return {
      path: relativePath,
      kind: stat.isDirectory() ? 'directory' : 'file',
      matchedPaths: [],
    };
  }).sort((left, right) => canonicalCompare(left.path, right.path));
}

function matchingAllowedRule(rules, relativePath) {
  return rules.find(rule => (
    rule.kind === 'file'
      ? relativePath === rule.path
      : relativePath.startsWith(`${rule.path}/`)
  ));
}

function collectAllowedNewPaths(sourceRoot, rules, baselineEntries) {
  const paths = new Set();
  function visit(absolutePath, relativePath) {
    if (isForbiddenOverlayPath(relativePath)) return;
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Allowed untracked roots cannot contain symlinks: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      const names = fs.readdirSync(absolutePath).sort(canonicalCompare);
      names.forEach(name => visit(
        path.join(absolutePath, name),
        `${relativePath}/${name}`,
      ));
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`Allowed untracked roots contain an unsupported entry: ${relativePath}`);
    }
    if (!baselineEntries.has(relativePath)) paths.add(relativePath);
  }
  for (const rule of rules) {
    visit(resolveInside(sourceRoot, rule.path), rule.path);
  }
  return paths;
}

function regularFileEntry(sourceRoot, relativePath, allowNew) {
  if (isForbiddenOverlayPath(relativePath)) {
    throw new Error(`Generated, benchmark, cache, or secret path cannot enter a draft: ${relativePath}`);
  }
  const absolutePath = resolveInside(sourceRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Draft source file does not exist: ${relativePath}`);
  }
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Draft source must be a regular file: ${relativePath}`);
  }
  return {
    path: relativePath,
    operation: 'upsert',
    sha256: sha256File(absolutePath),
    mode: fileMode(stat),
    ...(allowNew ? { allowNew: true } : {}),
  };
}

function baselineDeleteEntry(sourceRoot, relativePath, baselineEntry) {
  if (!['100644', '100755'].includes(baselineEntry.mode)) {
    throw new Error(`Unsupported deleted baseline mode at ${relativePath}: ${baselineEntry.mode}`);
  }
  const contents = runGit(
    ['cat-file', 'blob', baselineEntry.objectId],
    { cwd: sourceRoot, encoding: null },
  );
  return {
    path: relativePath,
    operation: 'delete',
    baselineSha256: sha256(contents),
  };
}

function summarizePaths(paths) {
  const sorted = [...paths].sort(canonicalCompare);
  return {
    count: sorted.length,
    sample: sorted.slice(0, SUMMARY_SAMPLE_LIMIT),
    sampleTruncated: sorted.length > SUMMARY_SAMPLE_LIMIT,
  };
}

function buildSummary({
  sourceRoot,
  draftPath,
  baselineCommit,
  entries,
  allowedRules,
  excludedUntracked,
  deniedUntracked,
  draftFileSha256,
  overlayAllowlistSha256,
}) {
  const operations = entries.reduce((counts, entry) => {
    counts[entry.operation] += 1;
    return counts;
  }, { upsert: 0, delete: 0 });
  const lines = [
    '# Vitruvius Release Overlay Draft Review',
    '',
    '**DRAFT ONLY. This tool did not seal, build, deploy, reindex, install, stage, or commit anything.**',
    '',
    `- Source worktree: ${sourceRoot}`,
    `- Exact baseline commit: ${baselineCommit}`,
    `- Draft allowlist: ${draftPath}`,
    `- Draft file SHA-256: ${draftFileSha256}`,
    `- Canonical overlay SHA-256: ${overlayAllowlistSha256}`,
    `- Included entries: ${entries.length} (${operations.upsert} upsert, ${operations.delete} delete)`,
    '',
    '## Explicitly included paths',
    '',
  ];
  if (entries.length === 0) lines.push('- None');
  for (const entry of entries) {
    lines.push(
      entry.operation === 'delete'
        ? `- DELETE ${entry.path} (baseline SHA-256 ${entry.baselineSha256})`
        : `- UPSERT ${entry.path} (${entry.mode}, SHA-256 ${entry.sha256}${entry.allowNew ? ', new path approved' : ''})`,
    );
  }
  lines.push('', '## Allowed new-path rules', '');
  if (allowedRules.length === 0) lines.push('- None');
  for (const rule of allowedRules) {
    lines.push(`- ${rule.kind.toUpperCase()} ${rule.path} (${rule.matchedPaths.length} included path(s))`);
  }
  lines.push(
    '',
    '## Untracked paths deliberately excluded',
    '',
    `Count: ${excludedUntracked.count}`,
  );
  excludedUntracked.sample.forEach(relativePath => lines.push(`- ${relativePath}`));
  if (excludedUntracked.sampleTruncated) lines.push('- ... additional excluded paths omitted from this summary');
  lines.push(
    '',
    '## Denied generated, benchmark, cache, or secret paths',
    '',
    `Count: ${deniedUntracked.count}`,
  );
  deniedUntracked.sample.forEach(relativePath => lines.push(`- ${relativePath}`));
  if (deniedUntracked.sampleTruncated) lines.push('- ... additional denied paths omitted from this summary');
  lines.push(
    '',
    '## Required human review',
    '',
    '1. Inspect every included path, operation, file mode, and SHA-256 in the draft JSON.',
    '2. Confirm every excluded path is unrelated and every denied path must stay out.',
    '3. Only after approval, pass the unchanged draft JSON to `vitruvius-sealed-candidate.js`.',
    '4. If any source file changes, discard this draft and generate a new one.',
    '',
  );
  return lines.join('\n');
}

function prepareOverlayDraft({
  sourceRoot,
  baselineCommit,
  allowUntracked = [],
  draftPath,
  summaryPath,
}) {
  const source = fs.realpathSync(path.resolve(sourceRoot));
  const draft = canonicalNewFilePath(draftPath, 'Draft output');
  const summary = canonicalNewFilePath(summaryPath, 'Summary output');
  assertOutsideSource(source, draft, 'Draft output');
  assertOutsideSource(source, summary, 'Summary output');
  if (draft === summary) throw new Error('Draft and summary outputs must be different files.');
  if (fs.existsSync(draft)) throw new Error(`Draft output already exists: ${draft}`);
  if (fs.existsSync(summary)) throw new Error(`Summary output already exists: ${summary}`);

  const baseline = resolveBaselineCommit(source, baselineCommit);
  const sourceStatusBefore = gitStatusSnapshot(source);
  const baselineEntries = readBaselineEntries(source, baseline);
  const rules = normalizeAllowedRules(source, allowUntracked);
  const changedPaths = nulSeparatedPaths(runGit(
    ['diff', '--name-only', '-z', '--no-renames', baseline, '--'],
    { cwd: source, encoding: null },
  ));
  const untrackedPaths = nulSeparatedPaths(runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: source, encoding: null },
  ));
  const entryByPath = new Map();
  const newPathCandidates = new Set(untrackedPaths);
  collectAllowedNewPaths(source, rules, baselineEntries).forEach(relativePath => {
    newPathCandidates.add(relativePath);
  });

  for (const relativePath of changedPaths) {
    const baselineEntry = baselineEntries.get(relativePath);
    if (!baselineEntry) {
      if (fs.existsSync(resolveInside(source, relativePath))) newPathCandidates.add(relativePath);
      continue;
    }
    if (isForbiddenOverlayPath(relativePath)) {
      throw new Error(`A changed tracked path is forbidden from release candidates: ${relativePath}`);
    }
    const absolutePath = resolveInside(source, relativePath);
    const entry = fs.existsSync(absolutePath)
      ? regularFileEntry(source, relativePath, false)
      : baselineDeleteEntry(source, relativePath, baselineEntry);
    entryByPath.set(relativePath, entry);
  }

  const excluded = [];
  const denied = [];
  for (const relativePath of [...newPathCandidates].sort(canonicalCompare)) {
    if (baselineEntries.has(relativePath)) continue;
    if (isForbiddenOverlayPath(relativePath)) {
      denied.push(relativePath);
      continue;
    }
    const rule = matchingAllowedRule(rules, relativePath);
    if (!rule) {
      excluded.push(relativePath);
      continue;
    }
    entryByPath.set(relativePath, regularFileEntry(source, relativePath, true));
    rule.matchedPaths.push(relativePath);
  }
  for (const rule of rules) {
    if (rule.matchedPaths.length === 0) {
      throw new Error(`Allowed untracked rule matched no eligible new source files: ${rule.path}`);
    }
    rule.matchedPaths.sort(canonicalCompare);
  }

  const normalized = normalizeOverlaySpec({
    schemaVersion: SCHEMA_VERSION,
    baselineCommit: baseline,
    entries: [...entryByPath.values()],
  });
  const draftPayload = `${JSON.stringify(normalized, null, 2)}\n`;
  const summaryPayload = buildSummary({
    sourceRoot: source,
    draftPath: draft,
    baselineCommit: baseline,
    entries: normalized.entries,
    allowedRules: rules,
    excludedUntracked: summarizePaths(excluded),
    deniedUntracked: summarizePaths(denied),
    draftFileSha256: sha256(Buffer.from(draftPayload, 'utf8')),
    overlayAllowlistSha256: sha256(Buffer.from(canonicalOverlayPayload(normalized), 'utf8')),
  });
  const sourceStatusAfter = gitStatusSnapshot(source);
  if (JSON.stringify(sourceStatusAfter) !== JSON.stringify(sourceStatusBefore)) {
    throw new Error('Source worktree status changed while preparing the overlay draft.');
  }

  const draftTemporary = `${draft}.${crypto.randomUUID()}.tmp`;
  const summaryTemporary = `${summary}.${crypto.randomUUID()}.tmp`;
  let draftPublished = false;
  let summaryPublished = false;
  try {
    fs.writeFileSync(draftTemporary, draftPayload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.writeFileSync(summaryTemporary, summaryPayload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(draftTemporary, draft);
    draftPublished = true;
    fs.renameSync(summaryTemporary, summary);
    summaryPublished = true;
  } catch (error) {
    if (draftPublished && fs.existsSync(draft)) fs.unlinkSync(draft);
    if (summaryPublished && fs.existsSync(summary)) fs.unlinkSync(summary);
    if (fs.existsSync(draftTemporary)) fs.unlinkSync(draftTemporary);
    if (fs.existsSync(summaryTemporary)) fs.unlinkSync(summaryTemporary);
    throw error;
  }
  return {
    draftPath: draft,
    summaryPath: summary,
    overlay: normalized,
    excludedUntracked: summarizePaths(excluded),
    deniedUntracked: summarizePaths(denied),
  };
}

function parseArguments(argv) {
  const values = { allowUntracked: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--repo', '--baseline', '--allow-untracked', '--draft', '--summary'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--allow-untracked') values.allowUntracked.push(value);
    else values[flag.slice(2)] = value;
    index += 1;
  }
  if (!values.baseline) throw new Error('--baseline is required.');
  if (!values.draft) throw new Error('--draft is required.');
  if (!values.summary) throw new Error('--summary is required.');
  return {
    sourceRoot: path.resolve(values.repo || path.join(__dirname, '..')),
    baselineCommit: values.baseline,
    allowUntracked: values.allowUntracked,
    draftPath: values.draft,
    summaryPath: values.summary,
  };
}

function main() {
  try {
    const result = prepareOverlayDraft(parseArguments(process.argv.slice(2)));
    console.log('Review-only overlay draft prepared. No candidate was sealed.');
    console.log(`Draft: ${result.draftPath}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`Included paths: ${result.overlay.entries.length}`);
    console.log(`Excluded untracked paths: ${result.excludedUntracked.count}`);
    console.log(`Denied generated/cache/secret paths: ${result.deniedUntracked.count}`);
  } catch (error) {
    console.error(`Overlay draft preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildSummary,
  prepareOverlayDraft,
  summarizePaths,
};
