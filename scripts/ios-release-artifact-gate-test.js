#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  embeddedClientConfigurationFailures,
} = require('./ios-release-artifact-gate');

const environment = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'publishable-test-key',
};

assert.deepEqual(
  embeddedClientConfigurationFailures(
    Buffer.from(
      `${environment.EXPO_PUBLIC_SUPABASE_URL}:${environment.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
    ),
    environment,
  ),
  [],
);
assert.deepEqual(
  embeddedClientConfigurationFailures(
    Buffer.from(environment.EXPO_PUBLIC_SUPABASE_URL),
    environment,
  ),
  ['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
);
assert.deepEqual(
  embeddedClientConfigurationFailures(Buffer.alloc(0), environment),
  ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'],
);

console.log('iOS release artifact gate contract PASS.');
