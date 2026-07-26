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

assert.match(
  workflow,
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
    workflow.includes(command),
    `Native CI must execute ${command}.`,
  );
}

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
for (const plugin of [
  './plugins/withDaveIosAppIcon',
  './plugins/withVitruviusAndroidSecurityPolicy',
  'expo-router',
]) {
  assert(
    configuredPlugins.includes(plugin),
    `Clean native generation must include ${plugin}.`,
  );
}

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
