#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Json(value) {
  return sha256(stableJson(value));
}

function canonicalSha256(value, label = 'Value') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  assert(/^[a-f0-9]{64}$/.test(normalized), `${label} must be a SHA-256 checksum`);
  return normalized;
}

function canonicalUuid(value, label = 'Value') {
  assert(
    typeof value === 'string' && value === value.trim() &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
    `${label} must be a canonical UUID`,
  );
  return value;
}

function exactText(value, label, maximumLength = 500) {
  assert(
    typeof value === 'string' && value === value.trim() && value.length > 0 &&
      value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value),
    `${label} must be exact bounded text`,
  );
  return value;
}

function repositoryPath(value, label, options = {}) {
  const resolved = path.resolve(repoRoot, exactText(value, label, 2_000));
  const relative = path.relative(repoRoot, resolved);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${label} must stay inside the repository`);
  if (options.mustExist) {
    const stat = fs.lstatSync(resolved);
    assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  }
  return resolved;
}

function operatorIdentity(scriptPath, options = {}) {
  const execute = options.execFileSync || execFileSync;
  const runGit = (args, encoding = null) => execute('git', args, {
    cwd: repoRoot,
    encoding,
    timeout: 30_000,
    maxBuffer: 100 * 1024 * 1024,
  });
  const status = Buffer.from(runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']) || '');
  const trackedPatch = Buffer.from(runGit(['diff', '--binary', '--no-ext-diff', 'HEAD', '--']) || '');
  const untrackedPaths = Buffer.from(runGit(['ls-files', '--others', '--exclude-standard', '-z']) || '')
    .toString('utf8').split('\0').filter(Boolean).sort();
  const untracked = untrackedPaths.map(relativePath => {
    const absolutePath = path.resolve(repoRoot, relativePath);
    assert(absolutePath.startsWith(`${repoRoot}${path.sep}`), 'Untracked identity path escaped the repository');
    const stat = fs.lstatSync(absolutePath);
    assert(stat.isFile() || stat.isSymbolicLink(), `Unsupported untracked identity entry ${relativePath}`);
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolutePath))
      : fs.readFileSync(absolutePath);
    return {
      path: relativePath,
      mode: stat.mode & 0o777,
      type: stat.isSymbolicLink() ? 'symlink' : 'file',
      size: bytes.length,
      sha256: sha256(bytes),
    };
  });
  const runGitText = args => String(runGit(args, 'utf8') || '').trim().toLowerCase();
  const absoluteScriptPath = path.resolve(scriptPath);
  assert(absoluteScriptPath.startsWith(`${repoRoot}${path.sep}`), 'Operator script escaped the repository');
  return Object.freeze({
    repositoryCommit: runGitText(['rev-parse', 'HEAD']),
    repositoryTree: runGitText(['rev-parse', 'HEAD^{tree}']),
    workingTreeDirty: status.length > 0,
    workingTreeStatusSha256: sha256Json({
      statusSha256: sha256(status),
      trackedPatchSha256: sha256(trackedPatch),
      untracked,
    }),
    operatorScript: path.relative(repoRoot, absoluteScriptPath),
    operatorScriptSha256: sha256(fs.readFileSync(absoluteScriptPath)),
  });
}

function assertCleanOperatorIdentity(identity) {
  assert(identity && identity.workingTreeDirty === false,
    'Operator requires a clean working tree so its receipt names one frozen candidate');
  assert(/^[a-f0-9]{40}$/.test(String(identity.repositoryCommit || '')),
    'Operator repository commit is invalid');
  assert(/^[a-f0-9]{40}$/.test(String(identity.repositoryTree || '')),
    'Operator repository tree is invalid');
  canonicalSha256(identity.workingTreeStatusSha256, 'Operator working-tree seal');
  canonicalSha256(identity.operatorScriptSha256, 'Operator script seal');
  return identity;
}

function sealObject(value) {
  const unsealed = { ...value };
  delete unsealed.seal;
  return {
    ...unsealed,
    seal: {
      algorithm: 'sha256-stable-json',
      receiptSha256: sha256Json(unsealed),
    },
  };
}

function verifySealedObject(value, label = 'Receipt') {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
  assert(value.seal?.algorithm === 'sha256-stable-json', `${label} seal algorithm is invalid`);
  const expected = canonicalSha256(value.seal?.receiptSha256, `${label} seal`);
  const unsealed = { ...value };
  delete unsealed.seal;
  assert(sha256Json(unsealed) === expected, `${label} seal does not match its contents`);
  return value;
}

function readJsonFile(filePath, label = 'JSON file') {
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  assert(stat.size > 0 && stat.size <= 50 * 1024 * 1024,
    `${label} must be between 1 byte and 50 MiB`);
  const bytes = fs.readFileSync(filePath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  return { bytes, value };
}

function readSealedReceipt(filePath, expectedSha256, label = 'Receipt') {
  const { bytes, value } = readJsonFile(filePath, label);
  verifySealedObject(value, label);
  if (expectedSha256) {
    const expected = canonicalSha256(expectedSha256, `${label} expected file checksum`);
    assert(sha256(bytes) === expected, `${label} file checksum does not match approval`);
  }
  return { bytes, value };
}

function writeJsonAtomic(filePath, value, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (options.exclusive) {
    const descriptor = fs.openSync(filePath, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); } finally { fs.closeSync(descriptor); }
    return;
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  assert,
  assertCleanOperatorIdentity,
  canonicalSha256,
  canonicalUuid,
  exactText,
  operatorIdentity,
  readJsonFile,
  readSealedReceipt,
  repoRoot,
  repositoryPath,
  sealObject,
  sha256,
  sha256Json,
  stableJson,
  verifySealedObject,
  writeJsonAtomic,
};
