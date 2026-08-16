const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requirementsPath = path.join(root, 'workers/ecos-indexer/requirements.txt');
const requirements = fs.readFileSync(requirementsPath);
const dependencyKey = crypto.createHash('sha256').update(requirements).digest('hex').slice(0, 12);
const environmentPath = path.join(os.tmpdir(), `vitruvius-ecos-indexer-python-${dependencyKey}`);
const python = path.join(environmentPath, 'bin', 'python');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};

if (!fs.existsSync(python)) {
  run('python3', ['-m', 'venv', environmentPath]);
  run(path.join(environmentPath, 'bin', 'pip'), [
    'install', '--disable-pip-version-check', '--quiet', '--requirement', requirementsPath,
  ]);
}

run(python, ['-m', 'unittest', 'discover', '-s', 'workers/ecos-indexer/tests', '-p', 'test_*.py'], {
  env: { ...process.env, PYTHONPATH: path.join(root, 'workers/ecos-indexer') },
});
