const { withAndroidManifest } = require('@expo/config-plugins');

const BLOCKED_ANDROID_PERMISSIONS = Object.freeze([
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.WRITE_CONTACTS',
  'android.permission.SYSTEM_ALERT_WINDOW',
]);

function applyVitruviusAndroidSecurityPolicyToManifest(androidManifest) {
  const manifest = androidManifest.manifest || {};
  const permissions = Array.isArray(manifest['uses-permission'])
    ? manifest['uses-permission']
    : [];

  manifest['uses-permission'] = permissions.filter(permission => {
    const attributes = permission?.$ || {};
    const name = attributes['android:name'];
    return !BLOCKED_ANDROID_PERMISSIONS.includes(name) ||
      attributes['tools:node'] === 'remove';
  });

  const application = Array.isArray(manifest.application)
    ? manifest.application[0]
    : null;
  if (application) {
    application.$ = {
      ...(application.$ || {}),
      'android:allowBackup': 'false',
      'android:fullBackupContent': 'false',
    };
  }

  return androidManifest;
}

function withVitruviusAndroidSecurityPolicy(config) {
  return withAndroidManifest(config, currentConfig => {
    currentConfig.modResults =
      applyVitruviusAndroidSecurityPolicyToManifest(currentConfig.modResults);
    return currentConfig;
  });
}

module.exports = withVitruviusAndroidSecurityPolicy;
module.exports.applyVitruviusAndroidSecurityPolicyToManifest =
  applyVitruviusAndroidSecurityPolicyToManifest;
module.exports.BLOCKED_ANDROID_PERMISSIONS = BLOCKED_ANDROID_PERMISSIONS;
