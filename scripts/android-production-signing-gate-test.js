#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  androidProductionSigningRequired,
  inspectAndroidReleaseSigning,
} = require('./android-production-signing-gate');

const debugSource = `
android {
  buildTypes {
    debug { signingConfig signingConfigs.debug }
    release {
      signingConfig signingConfigs.debug
      minifyEnabled true
    }
  }
}
`;
assert.equal(inspectAndroidReleaseSigning(debugSource).status, 'debug');

const productionSource = `
android {
  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
`;
assert.equal(inspectAndroidReleaseSigning(productionSource).status, 'configured');
assert.equal(
  inspectAndroidReleaseSigning('android { buildTypes { release { minifyEnabled true } } }').status,
  'missing',
);
assert.equal(androidProductionSigningRequired({ VIC_RELEASE_TARGET: 'android-production' }), true);
assert.equal(androidProductionSigningRequired({ VIC_REQUIRE_PRODUCTION_ANDROID_SIGNING: 'true' }), true);
assert.equal(androidProductionSigningRequired({ VIC_RELEASE_TARGET: 'ios' }), false);

const repoRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'mobile-ci.yml'),
  'utf8',
);
assert.match(
  workflow,
  /npx expo prebuild --platform all --no-install --clean/,
);
assert.match(workflow, /npm run sync:native-release-metadata/);
assert.match(workflow, /npm run check:release-metadata/);
assert.match(workflow, /npm run check:android-production-signing/);

const enforced = spawnSync(process.execPath, [
  path.join(__dirname, 'android-production-signing-gate.js'),
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    VIC_RELEASE_TARGET: 'android-production',
  },
});
assert.equal(enforced.status, 1, 'Android production certification must fail without production signing.');
assert.match(enforced.stdout, /production Android certification is refused/i);

console.log('Android production signing gate contract PASS.');
