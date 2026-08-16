const appJson = require('./app.json');
const productMetadata = require('./product-metadata.json');
const { spawnSync } = require('child_process');
const {
  applyProductMetadataToExpoConfig,
} = require('./scripts/sync-product-metadata');

const guard = spawnSync(
  process.execPath,
  ['scripts/production-secret-guard.js'],
  {
    cwd: __dirname,
    encoding: 'utf8',
  },
);

if (guard.status !== 0) {
  const message = guard.stderr || guard.stdout || 'Production secret guard failed.';
  throw new Error(message.trim());
}

module.exports = ({ config }) => applyProductMetadataToExpoConfig(
  {
    ...appJson.expo,
    ...config,
  },
  productMetadata,
);
