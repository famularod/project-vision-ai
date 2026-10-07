#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');
const app = JSON.parse(read('app.json')).expo;
const eas = JSON.parse(read('eas.json'));
const workflow = read('.github/workflows/mobile-ci.yml');
const gitignore = read('.gitignore');
const productMetadata = JSON.parse(read('product-metadata.json'));
const linuxValidationJob = workflow.match(
  /  validate:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\s*$)/,
)?.[1];
const nativeGenerationJob = workflow.match(
  /  native-release-generation:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\s*$)/,
)?.[1];

assert(linuxValidationJob, 'CI must preserve the Linux validation job.');
assert.match(
  linuxValidationJob,
  /runs-on: ubuntu-latest/,
  'Routine validation must stay on the lower-cost Linux runner.',
);
assert(
  !linuxValidationJob.includes('npx expo prebuild --platform all'),
  'Linux validation must not invoke Apple-only native generation tools.',
);

assert(nativeGenerationJob, 'CI must define a dedicated native generation job.');

// Build 231 E1: the validate check could not pass on GitHub. It stopped at
// the cloud-configuration preflight (GitHub has no .env), and it ran the
// test suite twice inside 45 minutes.
{
  const { validateCloudClientConfiguration } = require('./cloud-client-config-preflight');
  const { MAX_PARTS, PARTS_ENVIRONMENT_NAME } = require('./jarvis-jest-gate');
  const standInUrl = linuxValidationJob.match(/'EXPO_PUBLIC_SUPABASE_URL=([^'\n]+)'/)?.[1];
  const standInKey = linuxValidationJob.match(/'EXPO_PUBLIC_SUPABASE_ANON_KEY=([^'\n]+)'/)?.[1];
  assert(standInUrl && standInKey, 'The validate job must give the release gate stand-in cloud values.');
  assert.match(
    linuxValidationJob,
    /printf '%s\\n' \\\n\s+'EXPO_PUBLIC_SUPABASE_URL=[^']+' \\\n\s+'EXPO_PUBLIC_SUPABASE_ANON_KEY=[^']+' > \.env\n/,
    'The stand-ins must be written to .env, where the preflight and the web export read them and the test suite does not.',
  );
  // Checked against an empty folder, so no env file of this checkout is read here.
  const emptyRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vitruvius-ci-stand-in-'));
  try {
    assert.deepEqual(
      validateCloudClientConfiguration(emptyRoot, {
        EXPO_PUBLIC_SUPABASE_URL: standInUrl,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: standInKey,
      }),
      { ok: true, missing: [], urlValid: true },
      'The stand-ins must satisfy the cloud-configuration preflight.',
    );
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }
  // Plainly not real: an ordinary Supabase project address is twenty letters
  // and digits, and a real key is a token, not hyphenated words. That is how
  // the stand-ins read to a person. It is not a guarantee that nobody could
  // ever hold this address (review pass 1, L10); what makes the job safe is
  // pinned further down: it is given no secret, and it publishes nothing.
  const standInHost = new URL(standInUrl).hostname.split('.')[0];
  assert(standInHost.includes('-') && /stand-in/.test(standInHost), 'The stand-in address must be plainly not a real project.');
  assert(/^[a-z-]+$/.test(standInKey) && /stand-in/.test(standInKey) && /not-a-key/.test(standInKey), 'The stand-in key must be plainly not a real key.');
  assert(gitignore.split('\n').includes('.env'), 'The stand-in .env must stay untracked, or the gate would see a changed working tree.');
  assert(
    !nativeGenerationJob.includes('EXPO_PUBLIC_SUPABASE') && !nativeGenerationJob.includes('.env'),
    'The native generation job must be given no cloud values, stand-in or real.',
  );
  assert(
    !/upload-artifact|deploy|gh-pages|netlify|vercel|eas (?:build|submit|update)/i.test(linuxValidationJob),
    'The validate job must publish nothing: its web export is made with stand-ins and cannot sign in.',
  );

  assert.match(linuxValidationJob, /\n\s+run: npm run qa:release\n/, 'The validate job must run the release gate.');
  assert(
    !/\n\s+run: npm (?:test|run test:unit(?::\w+)?|run check)\n/.test(linuxValidationJob),
    'The validate job must not run the suite or the checks a second time: the release gate contains both.',
  );
  const gateStep = linuxValidationJob.slice(linuxValidationJob.indexOf('- name: Run complete local release gate'));
  const parts = Number(gateStep.match(new RegExp(`\\n\\s+${PARTS_ENVIRONMENT_NAME}: (\\d+)\\n`))?.[1]);
  assert(
    parts >= 2 && parts <= MAX_PARTS,
    `The release gate step must set ${PARTS_ENVIRONMENT_NAME} (2 to ${MAX_PARTS}): one in-band run of the suite does not fit a GitHub runner.`,
  );
  assert.equal(
    workflow.split(PARTS_ENVIRONMENT_NAME).length - 1,
    2,
    `${PARTS_ENVIRONMENT_NAME} belongs to the release gate step only (its comment and its value).`,
  );
  assert(!/maxWorkers/.test(workflow), 'CI must not switch the suite to a jest worker pool.');
  const minutes = Number(linuxValidationJob.match(/\n\s+timeout-minutes: (\d+)\n/)?.[1]);
  assert(
    minutes >= 50 && minutes <= 90,
    'The validate job needs a time limit that fits the gate (about 25 to 35 minutes expected) without being open-ended.',
  );
}

// Review pass 1, L10: the pins above missed five of six faults put into a
// copy of the workflow: real values given to the gate step from repository
// secrets (a step's environment overrides .env), the web export published
// with actions/upload-pages-artifact or "aws s3 sync", and the gate step
// made unable to fail the check (continue-on-error) or switched off
// (if: false). Looking for known bad words cannot keep up with the ways to
// do those things. So the validate job is now held to exactly what it is:
// these steps, these commands, these two actions, and nothing else.
{
  // Comment lines say nothing to GitHub; only what GitHub reads is judged.
  const read = text => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const whole = read(workflow);

  // 1. Nothing is taken from GitHub: no expression, so no secret and no variable.
  assert(
    !whole.includes('${{') && !/\bsecrets\b|\bvars\.|\binherit\b/.test(whole),
    'The workflow must take nothing from GitHub expressions, secrets or variables. The validate job runs on stand-in values on purpose: a real address or key in a step\'s environment would override them.',
  );

  // 2. The workflow itself: read-only, and no environment set for every job.
  assert.deepEqual(
    [...whole.matchAll(/^([A-Za-z-]+):/gm)].map(match => match[1]),
    ['name', 'on', 'permissions', 'jobs'],
    'The workflow may have only its name, its triggers, its permissions and its jobs (no environment, defaults or concurrency set for every job).',
  );
  assert.match(
    whole,
    /\npermissions:\n  contents: read\n\njobs:\n/,
    'The workflow must keep read-only access to the repository and ask for nothing else (no pages, deployments, packages or identity token).',
  );
  assert.equal(
    whole.split('permissions:').length - 1,
    1,
    'No job may ask for permissions of its own.',
  );

  /** A job's own settings and its steps, as GitHub reads them. Fails if the job is not laid out as expected. */
  const jobShape = (name, text) => {
    const body = read(text);
    const settings = [...body.matchAll(/^ {4}([A-Za-z-]+):/gm)].map(match => match[1]);
    const stepsAt = body.indexOf('\n    steps:\n');
    assert(stepsAt >= 0, `The ${name} job's steps could not be read.`);
    const steps = body.slice(stepsAt + '\n    steps:\n'.length).split(/^ {6}- /m).slice(1).map(step => {
      const lines = `        ${step}`.split('\n').filter(line => line.trim());
      const keys = [];
      const values = {};
      let current = null;
      for (const line of lines) {
        const own = line.match(/^ {8}([A-Za-z-]+):(.*)$/);
        if (own) {
          current = own[1];
          keys.push(current);
          values[current] = [own[2].trim()];
        } else {
          assert(current && /^ {10}/.test(line), `A line of the ${name} job could not be read: "${line.trim()}".`);
          values[current].push(line.slice(10));
        }
      }
      return { keys, values };
    });
    assert(steps.length > 0, `The ${name} job has no steps that could be read.`);
    return { settings, steps };
  };
  /** A step's command: the one line after "run:", or the lines of a "run: |" block. */
  const command = step => (step.values.run[0] === '|' ? step.values.run.slice(1) : step.values.run).join('\n');
  const ALLOWED_STEP_KEYS = ['name', 'uses', 'with', 'run', 'env'];
  const ALLOWED_ACTIONS = /^actions\/(checkout|setup-node)@[0-9a-f]{40}( #.*)?$/;

  for (const [name, text] of [['validate', linuxValidationJob], ['native generation', nativeGenerationJob]]) {
    const job = jobShape(name, text);
    // 3. The job cannot be switched off, made unable to fail, or given an environment of its own.
    assert.deepEqual(
      job.settings,
      ['runs-on', 'timeout-minutes', 'steps'],
      `The ${name} job may set only where it runs, its time limit and its steps (no "if", "continue-on-error", "env", "environment", "needs" or "permissions").`,
    );
    for (const step of job.steps) {
      const label = step.values.name?.[0] || '(unnamed)';
      // 4. No step can be switched off or made unable to fail.
      const extra = step.keys.filter(key => !ALLOWED_STEP_KEYS.includes(key));
      assert.deepEqual(
        extra,
        [],
        `The step "${label}" of the ${name} job may not set ${extra.join(', ')}: a step may only be named, use an action, or run a command (no "if", "continue-on-error", "shell" or "working-directory").`,
      );
      assert(step.keys.includes('name') && step.keys.includes('uses') !== step.keys.includes('run'),
        `The step "${label}" of the ${name} job must be named and either use an action or run a command.`);
      // 5. Only the two actions the job has always used, each pinned to an exact commit.
      if (step.keys.includes('uses')) {
        assert.match(
          step.values.uses.join(' '),
          ALLOWED_ACTIONS,
          `The step "${label}" of the ${name} job may use only actions/checkout or actions/setup-node, pinned to a commit. Any other action (an upload, a deployment, a pages artifact) is refused.`,
        );
        assert.deepEqual(
          (step.values.with || []).slice(1).map(line => line.split(':')[0].trim()).filter(key => !['node-version', 'cache'].includes(key)),
          [],
          `The step "${label}" of the ${name} job may give its action only the Node version and the cache setting.`,
        );
      }
    }
  }

  const validate = jobShape('validate', linuxValidationJob);
  // 6. Exactly these commands, in this order. Anything added (a copy to a
  // bucket, an upload, "|| true") changes the list and is refused.
  assert.deepEqual(
    validate.steps.filter(step => step.keys.includes('run')).map(command),
    [
      'npm ci',
      'node scripts/dependency-audit-gate.js --require-registry',
      'npm run test:release-contracts',
      "printf '%s\\n' \\\n  'EXPO_PUBLIC_SUPABASE_URL=https://ci-stand-in-not-a-project.supabase.co' \\\n  'EXPO_PUBLIC_SUPABASE_ANON_KEY=ci-stand-in-not-a-key' > .env",
      'npm run qa:release',
    ],
    'The validate job must run exactly its five commands: install, audit, the release contracts, the stand-in values, and the release gate. Its web export is made with stand-ins and must be published nowhere.',
  );
  // 7. One step has an environment: the gate step, and in it only the number of parts.
  const withEnvironment = validate.steps.filter(step => step.keys.includes('env'));
  assert(
    withEnvironment.length === 1 &&
      withEnvironment[0].values.name[0] === 'Run complete local release gate' &&
      withEnvironment[0].values.env.slice(1).length === 1 &&
      /^VIC_JEST_PARTS: \d+$/.test(withEnvironment[0].values.env[1]),
    'Only the release gate step may have an environment, and only VIC_JEST_PARTS in it. A cloud address or key there, real or not, would override the stand-ins in .env.',
  );
  // 8. The gate step is the last thing the job does, so nothing after it can use what it built.
  assert.equal(
    validate.steps[validate.steps.length - 1].values.name[0],
    'Run complete local release gate',
    'The release gate must be the validate job\'s last step.',
  );
  // The native job is given no environment at all.
  assert(
    jobShape('native generation', nativeGenerationJob).steps.every(step => !step.keys.includes('env')),
    'No step of the native generation job may have an environment.',
  );
}

assert.match(
  nativeGenerationJob,
  /runs-on: macos-latest/,
  'Native project generation must run on macOS where Apple asset tools are available.',
);
assert.match(
  nativeGenerationJob,
  /npx expo prebuild --platform all --no-install --clean/,
  'CI must regenerate both native projects from clean source configuration.',
);
for (const command of [
  'npm ci',
  'npm run sync:native-release-metadata',
  'npm run check:release-metadata',
  'npm run check:android-production-signing',
  'npx expo export --platform ios',
  'npx expo export --platform android',
]) {
  assert(
    nativeGenerationJob.includes(command),
    `The macOS native generation job must execute ${command}.`,
  );
}

assert(
  require('../package.json').scripts['check:ios-release-artifact'] ===
    'node scripts/ios-release-artifact-gate.js',
  'Signed iOS releases must expose the post-build artifact gate that verifies embedded cloud configuration and native linkage.',
);

assert.equal(app.name, productMetadata.name);
assert.equal(app.version, productMetadata.version);
assert.equal(app.ios?.buildNumber, String(productMetadata.build));
assert.equal(app.android?.versionCode, productMetadata.build);
assert.equal(app.ios?.bundleIdentifier, 'com.davidfamularo.projectphotoupdate');
assert.equal(app.android?.package, 'com.davidfamularo.projectphotoupdate');
assert.equal(app.ios?.supportsTablet, true);
assert.equal(app.android?.allowBackup, false);
assert.equal(
  eas.cli?.appVersionSource,
  'local',
  'Store builds must use the reviewed source-controlled Vitruvius version.',
);
assert.equal(
  eas.build?.production?.autoIncrement,
  false,
  'EAS must not silently change a reviewed Vitruvius build number.',
);

const configuredPlugins = (app.plugins || []).map(plugin =>
  Array.isArray(plugin) ? plugin[0] : plugin,
);
const buildProperties = (app.plugins || []).find(
  plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
)?.[1];
for (const plugin of [
  './plugins/withDaveIosAppIcon',
  'expo-build-properties',
  './plugins/withVitruviusAndroidSecurityPolicy',
  'expo-router',
]) {
  assert(
    configuredPlugins.includes(plugin),
    `Clean native generation must include ${plugin}.`,
  );
}

assert.equal(
  buildProperties?.ios?.usePrecompiledModules,
  false,
  'iOS release generation must build Expo modules from source so test-only framework dependencies cannot enter the customer app.',
);

for (const entry of ['/ios', '/android']) {
  assert(
    gitignore.includes(entry),
    `Generated ${entry} project must not become the source of release truth.`,
  );
}

for (const sensitiveMarker of [
  'PROVISIONING_PROFILE_SPECIFIER',
  'CODE_SIGN_IDENTITY',
  'storePassword',
  'keyPassword',
]) {
  assert(
    !JSON.stringify(app).includes(sensitiveMarker),
    `Expo source configuration must not embed ${sensitiveMarker}.`,
  );
}

console.log(
  'Native release generation contract PASS: iOS and Android are regenerated cleanly from reviewed Expo source configuration.',
);
