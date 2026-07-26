#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function validateProductMetadata(metadata) {
  assert(metadata && typeof metadata === 'object' && !Array.isArray(metadata));
  assert.deepEqual(
    Object.keys(metadata).sort(),
    ['build', 'monogram', 'name', 'subtitle', 'version'],
    'Canonical product metadata has unexpected fields.',
  );
  assert.match(metadata.name, /\S/, 'Product name is required.');
  assert.match(metadata.monogram, /^[A-Z]$/, 'Product monogram must be one uppercase letter.');
  assert.match(metadata.subtitle, /\S/, 'Product subtitle is required.');
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/, 'Product version must be numeric semantic version.');
  assert(
    Number.isSafeInteger(metadata.build) && metadata.build > 0,
    'Product build must be a positive integer.',
  );
  assert.equal(
    Number(metadata.version.split('.')[2]),
    metadata.build,
    'The product version patch and build must match.',
  );
  return metadata;
}

function applyProductMetadataToExpoConfig(expo, metadataInput) {
  const metadata = validateProductMetadata(metadataInput);
  return {
    ...expo,
    name: metadata.name,
    version: metadata.version,
    ios: {
      ...(expo.ios || {}),
      buildNumber: String(metadata.build),
    },
    android: {
      ...(expo.android || {}),
      versionCode: metadata.build,
    },
    extra: {
      ...(expo.extra || {}),
      buildLabel: `Build ${metadata.build}`,
      productName: metadata.name,
      productMonogram: metadata.monogram,
      productSubtitle: metadata.subtitle,
    },
  };
}

function synchronizedProductFiles(root) {
  const metadata = validateProductMetadata(readJson(root, 'product-metadata.json'));
  const appJson = readJson(root, 'app.json');
  const packageJson = readJson(root, 'package.json');
  const packageLock = readJson(root, 'package-lock.json');
  assert(appJson.expo && typeof appJson.expo === 'object', 'app.json must define expo.');
  assert(packageLock.packages?.[''], 'package-lock.json must define the root package.');

  appJson.expo = applyProductMetadataToExpoConfig(appJson.expo, metadata);
  packageJson.version = metadata.version;
  packageLock.version = metadata.version;
  packageLock.packages[''].version = metadata.version;

  return new Map([
    ['app.json', serializeJson(appJson)],
    ['package.json', serializeJson(packageJson)],
    ['package-lock.json', serializeJson(packageLock)],
  ]);
}

function synchronizeProductMetadata({
  root = path.resolve(__dirname, '..'),
  write = true,
} = {}) {
  const files = synchronizedProductFiles(root);
  const changedFiles = [];
  for (const [relativePath, nextValue] of files) {
    const filePath = path.join(root, relativePath);
    const currentValue = fs.readFileSync(filePath, 'utf8');
    if (currentValue === nextValue) continue;
    changedFiles.push(relativePath);
    if (!write) continue;
    const temporaryPath = `${filePath}.vitruvius-metadata-tmp`;
    fs.writeFileSync(temporaryPath, nextValue);
    fs.renameSync(temporaryPath, filePath);
  }
  return { changedFiles };
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

if (require.main === module) {
  const result = synchronizeProductMetadata();
  console.log(
    result.changedFiles.length
      ? `Product metadata synchronized: ${result.changedFiles.join(', ')}.`
      : 'Product metadata already synchronized.',
  );
}

module.exports = {
  applyProductMetadataToExpoConfig,
  synchronizeProductMetadata,
  synchronizedProductFiles,
  validateProductMetadata,
};
