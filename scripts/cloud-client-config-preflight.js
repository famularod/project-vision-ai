#!/usr/bin/env node

const path = require('node:path');
const { parseProjectEnv } = require('@expo/env');

const REQUIRED_PUBLIC_CLIENT_KEYS = Object.freeze([
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
]);

function resolvedClientEnvironment(root, environment = process.env) {
  const mode = environment.NODE_ENV || 'development';
  const parsed = parseProjectEnv(root, { mode, silent: true }).env;
  return { ...parsed, ...environment };
}

function validateCloudClientConfiguration(root = path.resolve(__dirname, '..'), environment) {
  const resolved = resolvedClientEnvironment(root, environment);
  const missing = REQUIRED_PUBLIC_CLIENT_KEYS.filter(key =>
    typeof resolved[key] !== 'string' || resolved[key].trim().length === 0,
  );
  const url = typeof resolved.EXPO_PUBLIC_SUPABASE_URL === 'string'
    ? resolved.EXPO_PUBLIC_SUPABASE_URL.trim()
    : '';
  const urlValid = missing.includes('EXPO_PUBLIC_SUPABASE_URL')
    ? false
    : /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url);

  return Object.freeze({
    ok: missing.length === 0 && urlValid,
    missing: Object.freeze(missing),
    urlValid,
  });
}

function main() {
  const result = validateCloudClientConfiguration();
  if (!result.ok) {
    const reasons = [];
    if (result.missing.length > 0) {
      reasons.push(`missing ${result.missing.join(', ')}`);
    }
    if (!result.urlValid && !result.missing.includes('EXPO_PUBLIC_SUPABASE_URL')) {
      reasons.push('EXPO_PUBLIC_SUPABASE_URL is not a valid Supabase project URL');
    }
    process.stderr.write(
      `Vitruvius cloud client preflight FAIL: ${reasons.join('; ')}. ` +
      'Refusing to create a build that cannot sign in or sync.\n',
    );
    return 1;
  }

  process.stdout.write(
    'Vitruvius cloud client preflight PASS: public Supabase client configuration is available.\n',
  );
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  REQUIRED_PUBLIC_CLIENT_KEYS,
  resolvedClientEnvironment,
  validateCloudClientConfiguration,
  main,
};
