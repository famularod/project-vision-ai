const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const packageConfig = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'screens', 'AdminScreen.tsx'), 'utf8');
const expo = appConfig.expo;

assert(expo && typeof expo === 'object', 'app.json must define an Expo configuration.');
assert.match(expo.version, /^\d+\.\d+\.\d+$/, 'Expo version must be a numeric semantic version.');
assert.equal(packageConfig.version, expo.version, 'package.json version must match app.json.');
assert.equal(packageLock.version, expo.version, 'package-lock.json version must match app.json.');
assert.equal(packageLock.packages?.['']?.version, expo.version, 'package-lock root version must match app.json.');

const build = Number(expo.version.split('.')[2]);
assert(Number.isSafeInteger(build) && build > 0, 'The app version patch must contain a positive build number.');
assert.equal(expo.ios?.buildNumber, String(build), 'iOS buildNumber must match the app version patch.');
assert.equal(expo.android?.versionCode, build, 'Android versionCode must match the app version patch.');
assert.equal(expo.extra?.buildLabel, `Build ${build}`, 'The visible build label must match native build metadata.');
assert.equal(
  expo.orientation,
  'portrait',
  'The shared app orientation must remain portrait so iPhone stays portrait-only.',
);
assert.equal(expo.ios?.supportsTablet, true, 'The iOS app must continue to support iPad.');
assert.equal(
  expo.ios?.requireFullScreen,
  false,
  'iPad full-screen mode must remain optional so Split View and Slide Over stay available.',
);
assert.equal(
  expo.android?.allowBackup,
  false,
  'Android backup must remain disabled for the local workspace and auth boundary.',
);

const blockedAndroidPermissions = new Set(expo.android?.blockedPermissions || []);
for (const permission of [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.WRITE_CONTACTS',
  'android.permission.SYSTEM_ALERT_WINDOW',
]) {
  assert(
    blockedAndroidPermissions.has(permission),
    `Android must block unnecessary permission ${permission}.`,
  );
}

for (const [label, source] of [['App', appSource], ['Admin', adminSource]]) {
  assert(
    source.includes("__DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP === 'true'"),
    `${label} must never expose development account creation in a production bundle.`,
  );
}

console.log(`Release metadata PASS: ${expo.version} / Build ${build}`);
