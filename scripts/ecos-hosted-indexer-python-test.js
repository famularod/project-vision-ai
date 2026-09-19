const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requirementsPath = path.join(root, 'workers/ecos-indexer/requirements.txt');
const requirements = fs.readFileSync(requirementsPath);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

const inspect = (command, args) => spawnSync(command, args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const selectBootstrapPython = () => {
  const candidates = [
    process.env.ECOS_INDEXER_TEST_PYTHON,
    'python3.12',
    'python3.13',
    'python3.11',
    'python3',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = inspect(candidate, [
      '-c',
      'import json,sys; print(json.dumps({"executable":sys.executable,"version":".".join(map(str,sys.version_info[:3]))}))',
    ]);
    if (result.status !== 0) continue;
    const identity = JSON.parse(result.stdout.trim());
    const [major, minor] = identity.version.split('.').map(Number);
    if (major === 3 && minor >= 11 && minor <= 13) {
      return { command: candidate, ...identity };
    }
  }

  throw new Error(
    'A supported Python 3.11-3.13 interpreter is required for the hosted indexer tests. '
      + 'Set ECOS_INDEXER_TEST_PYTHON to an explicit interpreter path.',
  );
};

const environmentIsReady = (python) => {
  if (!fs.existsSync(python)) return false;
  const result = inspect(python, [
    '-c',
    'import fitz, PIL, pytesseract, requests; print("ready")',
  ]);
  return result.status === 0 && result.stdout.trim().split(/\r?\n/).at(-1) === 'ready';
};

const bootstrap = selectBootstrapPython();
const dependencyKey = crypto.createHash('sha256')
  .update(requirements)
  .update('\0')
  .update(bootstrap.executable)
  .update('\0')
  .update(bootstrap.version)
  .digest('hex')
  .slice(0, 16);
const environmentPath = path.join(os.tmpdir(), `vitruvius-ecos-indexer-python-${dependencyKey}`);
const python = path.join(environmentPath, 'bin', 'python');

if (!environmentIsReady(python)) {
  const stagingPath = fs.mkdtempSync(
    path.join(os.tmpdir(), `vitruvius-ecos-indexer-python-${dependencyKey}-staging-`),
  );
  const stagingPython = path.join(stagingPath, 'bin', 'python');
  try {
    run(bootstrap.command, ['-m', 'venv', stagingPath]);
    run(stagingPython, [
      '-m', 'pip', 'install', '--disable-pip-version-check', '--quiet',
      '--requirement', requirementsPath,
    ]);
    if (!environmentIsReady(stagingPython)) {
      throw new Error('The hosted indexer Python environment failed its dependency import check.');
    }

    const priorPath = `${environmentPath}.invalid-${process.pid}-${Date.now()}`;
    if (fs.existsSync(environmentPath)) fs.renameSync(environmentPath, priorPath);
    fs.renameSync(stagingPath, environmentPath);
    if (fs.existsSync(priorPath)) fs.rmSync(priorPath, { recursive: true, force: true });
  } finally {
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

run(python, ['-m', 'unittest', 'discover', '-s', 'workers/ecos-indexer/tests', '-p', 'test_*.py'], {
  env: { ...process.env, PYTHONPATH: path.join(root, 'workers/ecos-indexer') },
});
