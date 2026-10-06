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
  // Plainly not real: a Supabase project address is twenty letters and digits,
  // and a real key is a token, not hyphenated words.
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
