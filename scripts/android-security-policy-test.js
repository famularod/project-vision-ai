#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  applyVitruviusAndroidSecurityPolicyToManifest,
  BLOCKED_ANDROID_PERMISSIONS,
} = require(path.join(root, 'plugins', 'withVitruviusAndroidSecurityPolicy'));

const fixture = {
  manifest: {
    'uses-permission': [
      { $: { 'android:name': 'android.permission.INTERNET' } },
      ...BLOCKED_ANDROID_PERMISSIONS.map(name => ({
        $: { 'android:name': name },
      })),
      {
        $: {
          'android:name': 'android.permission.SYSTEM_ALERT_WINDOW',
          'tools:node': 'remove',
        },
      },
    ],
    application: [
      {
        $: {
          'android:name': '.MainApplication',
          'android:allowBackup': 'true',
        },
      },
    ],
  },
};

const result = applyVitruviusAndroidSecurityPolicyToManifest(fixture);
const application = result.manifest.application[0].$;
const activePermissions = result.manifest['uses-permission']
  .filter(entry => entry.$['tools:node'] !== 'remove')
  .map(entry => entry.$['android:name']);

assert.equal(application['android:allowBackup'], 'false');
assert.equal(application['android:fullBackupContent'], 'false');
assert(activePermissions.includes('android.permission.INTERNET'));
for (const permission of BLOCKED_ANDROID_PERMISSIONS) {
  assert(
    !activePermissions.includes(permission),
    `Android security policy must remove ${permission}.`,
  );
}
assert(
  result.manifest['uses-permission'].some(entry =>
    entry.$['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW' &&
    entry.$['tools:node'] === 'remove',
  ),
  'Manifest merge removal markers must remain intact.',
);

console.log('Android security policy PASS: backup disabled and broad permissions removed.');
