#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'product-metadata.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const generatedApp = require(path.join(root, 'app.config.js'))({ config: {} });
const {
  applyProductMetadataToExpoConfig,
  synchronizeProductMetadata,
} = require(path.join(root, 'scripts', 'sync-product-metadata'));

assert.deepEqual(
  Object.keys(metadata).sort(),
  ['build', 'monogram', 'name', 'subtitle', 'version'],
  'Canonical product metadata has unexpected fields.',
);
assert.equal(metadata.name, 'Vitruvius');
assert.equal(metadata.monogram, 'V');
assert.equal(metadata.subtitle, 'Project Intelligence');
assert.equal(app.name, metadata.name, 'Expo product name must match canonical metadata.');
assert.equal(app.version, metadata.version, 'Expo version must match canonical metadata.');
assert.equal(Number(app.ios?.buildNumber), metadata.build, 'iOS build must match canonical metadata.');
assert.equal(app.android?.versionCode, metadata.build, 'Android build must match canonical metadata.');
assert.equal(packageJson.version, metadata.version, 'package.json version must match canonical metadata.');
assert.equal(packageLock.version, metadata.version, 'package-lock version must match canonical metadata.');
assert.equal(generatedApp.name, metadata.name, 'Generated Expo name must use canonical metadata.');
assert.equal(generatedApp.version, metadata.version, 'Generated Expo version must use canonical metadata.');
assert.equal(generatedApp.ios?.buildNumber, String(metadata.build), 'Generated iOS build must use canonical metadata.');
assert.equal(generatedApp.android?.versionCode, metadata.build, 'Generated Android build must use canonical metadata.');
assert.equal(generatedApp.extra?.productSubtitle, metadata.subtitle, 'Generated product subtitle must use canonical metadata.');
const correctedStaleConfig = applyProductMetadataToExpoConfig({
  name: 'Old Name',
  version: '0.0.1',
  ios: { buildNumber: '1' },
  android: { versionCode: 1 },
  extra: { buildLabel: 'Build 1' },
}, metadata);
assert.equal(correctedStaleConfig.name, metadata.name, 'Generation must replace a stale product name.');
assert.equal(correctedStaleConfig.version, metadata.version, 'Generation must replace a stale version.');
assert.equal(correctedStaleConfig.ios?.buildNumber, String(metadata.build), 'Generation must replace a stale iOS build.');
assert.equal(correctedStaleConfig.android?.versionCode, metadata.build, 'Generation must replace a stale Android build.');
assert.deepEqual(
  synchronizeProductMetadata({ root, write: false }).changedFiles,
  [],
  'Generated product metadata files have drifted; run npm run sync:product-metadata.',
);
assert(readme.includes(`${metadata.name} ${metadata.subtitle}`), 'README must use the current product identity.');

console.log(`Product metadata PASS: ${metadata.name} ${metadata.version} / Build ${metadata.build}.`);
