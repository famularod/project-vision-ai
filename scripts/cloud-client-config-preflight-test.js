#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateCloudClientConfiguration,
} = require('./cloud-client-config-preflight');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vitruvius-cloud-config-'));

try {
  assert.deepEqual(
    validateCloudClientConfiguration(temporaryRoot, { NODE_ENV: 'test' }),
    {
      ok: false,
      missing: [
        'EXPO_PUBLIC_SUPABASE_URL',
        'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      ],
      urlValid: false,
    },
  );

  fs.writeFileSync(
    path.join(temporaryRoot, '.env'),
    'EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=publishable-test-key\n',
  );
  assert.equal(
    validateCloudClientConfiguration(temporaryRoot, { NODE_ENV: 'test' }).ok,
    true,
  );

  assert.deepEqual(
    validateCloudClientConfiguration(temporaryRoot, {
      NODE_ENV: 'test',
      EXPO_PUBLIC_SUPABASE_URL: 'not-a-project-url',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'publishable-test-key',
    }),
    {
      ok: false,
      missing: [],
      urlValid: false,
    },
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('Cloud client configuration preflight contract PASS.');
