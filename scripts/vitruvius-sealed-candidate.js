#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = 'vitruvius-release-overlay/1';
const CANDIDATE_SCHEMA_VERSION = 'vitruvius-sealed-candidate/1';
const SOURCE_MANIFEST_ALGORITHM = 'sha256(canonical-json-lines:path,mode,size,sha256)';
const SYNTHETIC_GIT_NAME = 'Vitruvius Release Candidate';
const SYNTHETIC_GIT_EMAIL = 'release-candidate@local.invalid';
const SYNTHETIC_GIT_DATE = '2000-01-01T00:00:00Z';

const FORBIDDEN_PREFIXES = [
  '.git',
  '.expo',
  '.cache',
  'node_modules',
  'output',
  'tmp',
  'validation/output',
  'validation/builds',
  'validation/local-vision-benchmark',
  'validation/renderings',
  'coverage',
  'dist',
  'build',
  'web-build',
  'ios/build',
  'android/build',
  'deriveddata',
];

const FORBIDDEN_DIRECTORY_SEGMENTS = new Set([
  '.cache',
  '.expo',
  '.temp',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  'deriveddata',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'venv',
  'web-build',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function canonicalPathCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Every overlay entry requires a non-empty relative path.');
  }
  const candidate = value.trim();
  if (
    candidate.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(candidate)
    || path.posix.isAbsolute(candidate)
  ) {
    throw new Error(`Overlay path is not a safe repository-relative path: ${JSON.stringify(value)}`);
  }
  const normalized = path.posix.normalize(candidate);
  if (
    normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized !== candidate
  ) {
    throw new Error(`Overlay path is not canonical: ${JSON.stringify(value)}`);
  }
  return normalized;
}

function isForbiddenOverlayPath(relativePath) {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1].toLowerCase();
  if (
    basename === '.ds_store'
    || basename === '.env'
    || (basename.startsWith('.env.') && basename !== '.env.example')
    || ['.npmrc', '.netrc', 'credentials.json', 'credential.json', 'secrets.json', 'secret.json'].includes(basename)
    || /^service[-_]account.*\.json$/.test(basename)
    || basename.endsWith('.traineddata')
    || /\.(?:pem|p12|pfx|key|mobileprovision)$/i.test(basename)
  ) {
    return true;
  }
  if (
    segments.some(segment => FORBIDDEN_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))
    || /\.py[co]$/i.test(relativePath)
  ) {
    return true;
  }
  return FORBIDDEN_PREFIXES.some(prefix => (
    relativePath === prefix || relativePath.startsWith(`${prefix}/`)
  ));
}

function assertSha256(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be an exact SHA-256 value.`);
  }
  return normalized;
}

function normalizeOverlaySpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    throw new Error('The overlay allowlist must be a JSON object.');
  }
  if (rawSpec.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Overlay schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  const baselineCommit = String(rawSpec.baselineCommit || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(baselineCommit)) {
    throw new Error('baselineCommit must be a full Git commit object ID.');
  }
  if (!Array.isArray(rawSpec.entries)) {
    throw new Error('Overlay entries must be an array.');
  }

  const seen = new Set();
  const entries = rawSpec.entries.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(`Overlay entry ${index + 1} must be an object.`);
    }
    const relativePath = normalizeRelativePath(rawEntry.path);
    if (seen.has(relativePath)) {
      throw new Error(`Overlay path is listed more than once: ${relativePath}`);
    }
    seen.add(relativePath);
    if (isForbiddenOverlayPath(relativePath)) {
      throw new Error(`Generated, secret, or repository-control path cannot enter a candidate: ${relativePath}`);
    }
    const operation = rawEntry.operation === 'delete' ? 'delete' : rawEntry.operation === 'upsert'
      ? 'upsert'
      : null;
    if (!operation) {
      throw new Error(`Overlay entry ${relativePath} must use operation "upsert" or "delete".`);
    }
    if (operation === 'delete') {
      return {
        path: relativePath,
        operation,
        baselineSha256: assertSha256(
          rawEntry.baselineSha256,
          `baselineSha256 for ${relativePath}`,
        ),
      };
    }
    if (!['100644', '100755'].includes(rawEntry.mode)) {
      throw new Error(`Overlay entry ${relativePath} must declare mode 100644 or 100755.`);
    }
    return {
      path: relativePath,
      operation,
      sha256: assertSha256(rawEntry.sha256, `sha256 for ${relativePath}`),
      mode: rawEntry.mode,
      allowNew: rawEntry.allowNew === true,
    };
  });

  entries.sort((left, right) => canonicalPathCompare(left.path, right.path));
  return { schemaVersion: SCHEMA_VERSION, baselineCommit, entries };
}

function canonicalOverlayPayload(spec) {
  return `${JSON.stringify({
    schemaVersion: spec.schemaVersion,
    baselineCommit: spec.baselineCommit,
    entries: spec.entries,
  })}\n`;
}

function run(command, args, options = {}) {
  const result = (options.runner || spawnSync)(command, args, {
    cwd: options.cwd,
    encoding: options.encoding || 'utf8',
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    env: options.env || process.env,
  });
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message || String(result.stderr || '').trim()
      || `${command} exited with ${String(result.status)}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return String(result.stdout || '').trim();
}

function assertOutsideSourceTree(sourceRoot, targetPath, label) {
  const relative = path.relative(sourceRoot, targetPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be outside the original source worktree.`);
  }
}

function canonicalNewTargetPath(targetPath, label) {
  const resolved = path.resolve(targetPath);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) {
    throw new Error(`${label} parent does not exist: ${parent}`);
  }
  return path.join(fs.realpathSync(parent), path.basename(resolved));
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escaped its root: ${relativePath}`);
  }
  return target;
}

function fileMode(stat) {
  return (stat.mode & 0o111) === 0 ? '100644' : '100755';
}

function walkSourceFiles(root) {
  const entries = [];
  function visit(directory, prefix = '') {
    const names = fs.readdirSync(directory).sort(canonicalPathCompare);
    for (const name of names) {
      if (!prefix && name === '.git') continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const absolutePath = path.join(directory, name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlinks are not allowed in a sealed candidate: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Unsupported filesystem entry in candidate: ${relativePath}`);
      }
      if (isForbiddenOverlayPath(relativePath)) {
        throw new Error(`Generated, secret, or repository-control path is present in candidate: ${relativePath}`);
      }
      entries.push({
        path: relativePath,
        mode: fileMode(stat),
        size: stat.size,
        sha256: sha256File(absolutePath),
      });
    }
  }
  visit(root);
  entries.sort((left, right) => canonicalPathCompare(left.path, right.path));
  return entries;
}

function canonicalSourceManifest(entries) {
  return entries.map(entry => `${JSON.stringify([
    entry.path,
    entry.mode,
    entry.size,
    entry.sha256,
  ])}\n`).join('');
}

function changedManifestPaths(beforeEntries, afterEntries) {
  const before = new Map(beforeEntries.map(entry => [entry.path, entry]));
  const after = new Map(afterEntries.map(entry => [entry.path, entry]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(relativePath => JSON.stringify(before.get(relativePath)) !== JSON.stringify(after.get(relativePath)))
    .sort(canonicalPathCompare);
}

function gitStatusSnapshot(sourceRoot) {
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd: sourceRoot,
  });
  return {
    mode: 'porcelain_v1_untracked_files_or_directories',
    entryCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    outputSha256: sha256(Buffer.from(status, 'utf8')),
  };
}

function extractBaseline(sourceRoot, baselineCommit, outputDir) {
  const resolved = run('git', ['rev-parse', '--verify', `${baselineCommit}^{commit}`], {
    cwd: sourceRoot,
  }).toLowerCase();
  if (resolved !== baselineCommit) {
    throw new Error(`baselineCommit resolved to a different object ID: ${resolved}`);
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-candidate-archive-'));
  const archivePath = path.join(scratch, 'baseline.tar');
  try {
    run('git', ['archive', '--format=tar', `--output=${archivePath}`, baselineCommit], {
      cwd: sourceRoot,
    });
    fs.mkdirSync(outputDir, { recursive: false, mode: 0o700 });
    run('tar', ['-xf', archivePath, '-C', outputDir]);
  } finally {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    fs.rmdirSync(scratch);
  }
}

function applyOverlayEntry({ sourceRoot, candidateRoot, entry }) {
  const candidatePath = resolveInside(candidateRoot, entry.path);
  const candidateExists = fs.existsSync(candidatePath);
  if (entry.operation === 'delete') {
    if (!candidateExists || !fs.lstatSync(candidatePath).isFile()) {
      throw new Error(`Deleted overlay path does not exist as a baseline file: ${entry.path}`);
    }
    const baselineSha = sha256File(candidatePath);
    if (baselineSha !== entry.baselineSha256) {
      throw new Error(`Baseline hash mismatch for deleted path ${entry.path}.`);
    }
    fs.unlinkSync(candidatePath);
    return;
  }

  if (candidateExists && entry.allowNew) {
    throw new Error(`Overlay path already exists in the baseline and cannot use allowNew: ${entry.path}`);
  }
  if (!candidateExists && !entry.allowNew) {
    throw new Error(`New overlay path requires allowNew=true: ${entry.path}`);
  }
  const sourcePath = resolveInside(sourceRoot, entry.path);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Overlay source file does not exist: ${entry.path}`);
  }
  const sourceStat = fs.lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Overlay source must be a regular file: ${entry.path}`);
  }
  if (sha256File(sourcePath) !== entry.sha256) {
    throw new Error(`Reviewed SHA-256 no longer matches overlay source: ${entry.path}`);
  }
  if (fileMode(sourceStat) !== entry.mode) {
    throw new Error(`Reviewed file mode no longer matches overlay source: ${entry.path}`);
  }
  fs.mkdirSync(path.dirname(candidatePath), { recursive: true, mode: 0o755 });
  fs.copyFileSync(
    sourcePath,
    candidatePath,
    candidateExists ? 0 : fs.constants.COPYFILE_EXCL,
  );
  fs.chmodSync(candidatePath, entry.mode === '100755' ? 0o755 : 0o644);
  if (sha256File(candidatePath) !== entry.sha256) {
    throw new Error(`Copied candidate bytes do not match reviewed SHA-256: ${entry.path}`);
  }
}

function initializeCleanCandidateGit(candidateRoot, sourceManifestSha256) {
  run('git', ['init', '--quiet', '--initial-branch=sealed-candidate'], { cwd: candidateRoot });
  run('git', ['config', '--local', 'user.name', SYNTHETIC_GIT_NAME], { cwd: candidateRoot });
  run('git', ['config', '--local', 'user.email', SYNTHETIC_GIT_EMAIL], { cwd: candidateRoot });
  run('git', ['config', '--local', 'commit.gpgSign', 'false'], { cwd: candidateRoot });
  run('git', ['config', '--local', 'core.autocrlf', 'false'], { cwd: candidateRoot });
  run('git', ['config', '--local', 'core.filemode', 'true'], { cwd: candidateRoot });
  // The baseline may legitimately track files that its own .gitignore would
  // ignore if they were newly discovered. Force-add the sealed filesystem so
  // the isolated Git identity covers every manifest entry, not a filtered set.
  run('git', ['add', '--force', '--all'], { cwd: candidateRoot });
  const commitEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: SYNTHETIC_GIT_NAME,
    GIT_AUTHOR_EMAIL: SYNTHETIC_GIT_EMAIL,
    GIT_AUTHOR_DATE: SYNTHETIC_GIT_DATE,
    GIT_COMMITTER_NAME: SYNTHETIC_GIT_NAME,
    GIT_COMMITTER_EMAIL: SYNTHETIC_GIT_EMAIL,
    GIT_COMMITTER_DATE: SYNTHETIC_GIT_DATE,
  };
  run('git', ['commit', '--quiet', '--no-gpg-sign', '-m', `Vitruvius sealed candidate ${sourceManifestSha256}`], {
    cwd: candidateRoot,
    env: commitEnvironment,
  });
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: candidateRoot,
  });
  if (status) throw new Error('The sealed candidate Git worktree is not clean.');
  const remotes = run('git', ['remote'], { cwd: candidateRoot });
  if (remotes) throw new Error('The sealed candidate must not retain a Git remote.');
  return {
    synthetic: true,
    branch: run('git', ['branch', '--show-current'], { cwd: candidateRoot }),
    commit: run('git', ['rev-parse', 'HEAD'], { cwd: candidateRoot }),
    clean: true,
    remoteCount: 0,
    authorName: SYNTHETIC_GIT_NAME,
    authorEmail: SYNTHETIC_GIT_EMAIL,
  };
}

function sealCandidate({
  sourceRoot,
  overlayPath,
  outputDir,
  evidencePath,
}) {
  const source = fs.realpathSync(path.resolve(sourceRoot));
  const overlay = path.resolve(overlayPath);
  const candidate = canonicalNewTargetPath(outputDir, 'Candidate output');
  const evidence = canonicalNewTargetPath(evidencePath, 'Candidate evidence');
  if (fs.existsSync(candidate)) throw new Error(`Candidate output already exists: ${candidate}`);
  if (fs.existsSync(evidence)) throw new Error(`Candidate evidence already exists: ${evidence}`);
  assertOutsideSourceTree(source, candidate, 'Candidate output');
  assertOutsideSourceTree(source, evidence, 'Candidate evidence');
  const evidenceRelativeToCandidate = path.relative(candidate, evidence);
  if (evidenceRelativeToCandidate === '' || (!evidenceRelativeToCandidate.startsWith('..') && !path.isAbsolute(evidenceRelativeToCandidate))) {
    throw new Error('Candidate evidence must be outside the sealed source tree.');
  }

  const spec = normalizeOverlaySpec(JSON.parse(fs.readFileSync(overlay, 'utf8')));
  const sourceStatusBefore = gitStatusSnapshot(source);
  const stagingRoot = fs.mkdtempSync(path.join(
    path.dirname(candidate),
    '.vitruvius-sealed-candidate-stage-',
  ));
  const stagingCandidate = path.join(stagingRoot, 'source');
  const stagingEvidence = path.join(
    path.dirname(evidence),
    `.vitruvius-sealed-candidate-evidence-${crypto.randomUUID()}.tmp`,
  );
  let candidatePublished = false;
  let evidencePublished = false;
  try {
    extractBaseline(source, spec.baselineCommit, stagingCandidate);
    const baselineEntries = walkSourceFiles(stagingCandidate);
    for (const entry of spec.entries) {
      applyOverlayEntry({ sourceRoot: source, candidateRoot: stagingCandidate, entry });
    }
    const sourceEntries = walkSourceFiles(stagingCandidate);
    const changedPaths = changedManifestPaths(baselineEntries, sourceEntries);
    const expectedChangedPaths = spec.entries.map(entry => entry.path).sort(canonicalPathCompare);
    if (JSON.stringify(changedPaths) !== JSON.stringify(expectedChangedPaths)) {
      throw new Error(
        `Candidate changes do not exactly match the overlay allowlist. Expected ${JSON.stringify(expectedChangedPaths)}, received ${JSON.stringify(changedPaths)}.`,
      );
    }
    const sourceManifestPayload = canonicalSourceManifest(sourceEntries);
    const sourceManifestSha256 = sha256(Buffer.from(sourceManifestPayload, 'utf8'));
    const candidateGit = initializeCleanCandidateGit(stagingCandidate, sourceManifestSha256);
    const sourceStatusAfter = gitStatusSnapshot(source);
    if (JSON.stringify(sourceStatusAfter) !== JSON.stringify(sourceStatusBefore)) {
      throw new Error('Original source worktree status changed while sealing the candidate.');
    }

    const manifest = {
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      baselineCommit: spec.baselineCommit,
      overlayAllowlist: {
        schemaVersion: spec.schemaVersion,
        sha256: sha256(Buffer.from(canonicalOverlayPayload(spec), 'utf8')),
        entries: spec.entries,
      },
      sourceManifest: {
        algorithm: SOURCE_MANIFEST_ALGORITHM,
        sha256: sourceManifestSha256,
        entryCount: sourceEntries.length,
        entries: sourceEntries,
      },
      candidateGit,
      originalWorktree: sourceStatusBefore,
    };
    fs.writeFileSync(stagingEvidence, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(stagingCandidate, candidate);
    candidatePublished = true;
    fs.renameSync(stagingEvidence, evidence);
    evidencePublished = true;
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return { candidateRoot: candidate, evidencePath: evidence, manifest };
  } catch (error) {
    if (evidencePublished && fs.existsSync(evidence)) fs.unlinkSync(evidence);
    if (candidatePublished && fs.existsSync(candidate)) {
      fs.rmSync(candidate, { recursive: true, force: true });
    }
    if (fs.existsSync(stagingEvidence)) fs.unlinkSync(stagingEvidence);
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--repo', '--overlay', '--output', '--evidence'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    values[flag.slice(2)] = value;
    index += 1;
  }
  if (!values.overlay) throw new Error('--overlay is required.');
  const sourceRoot = path.resolve(values.repo || path.join(__dirname, '..'));
  const outputDir = path.resolve(values.output || path.join(
    os.tmpdir(),
    `vitruvius-sealed-candidate-${crypto.randomUUID()}`,
  ));
  const evidencePath = path.resolve(values.evidence || `${outputDir}.manifest.json`);
  return { sourceRoot, overlayPath: values.overlay, outputDir, evidencePath };
}

function main() {
  try {
    const result = sealCandidate(parseArguments(process.argv.slice(2)));
    console.log(`Sealed candidate: ${result.candidateRoot}`);
    console.log(`Evidence manifest: ${result.evidencePath}`);
    console.log(`Source manifest SHA-256: ${result.manifest.sourceManifest.sha256}`);
    console.log(`Candidate Git commit: ${result.manifest.candidateGit.commit}`);
  } catch (error) {
    console.error(`Candidate sealing failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CANDIDATE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SOURCE_MANIFEST_ALGORITHM,
  canonicalOverlayPayload,
  canonicalSourceManifest,
  changedManifestPaths,
  fileMode,
  isForbiddenOverlayPath,
  normalizeRelativePath,
  normalizeOverlaySpec,
  sealCandidate,
  sha256,
  sha256File,
  walkSourceFiles,
};
