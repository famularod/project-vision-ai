#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const migrationNames = fs.readdirSync(migrationsDirectory)
  .filter(name => name.endsWith('.sql'))
  .sort();

assert(migrationNames.length > 0, 'No Supabase migrations were found.');

const timestamps = new Set();
for (const name of migrationNames) {
  assert.match(
    name,
    /^\d{14}_[a-z0-9_]+\.sql$/,
    `Migration name is not deterministic: ${name}`,
  );
  const timestamp = name.slice(0, 14);
  assert(!timestamps.has(timestamp), `Duplicate migration timestamp: ${timestamp}`);
  timestamps.add(timestamp);

  const sql = fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');
  assert(sql.trim().length > 0, `Migration is empty: ${name}`);
  assert(!/^(?:<{7}|={7}|>{7})/m.test(sql), `Migration contains a merge marker: ${name}`);
  assert(sql.includes(';'), `Migration contains no terminated SQL statement: ${name}`);
}

const permissiveName = '20260707020000_project_sync_authenticated_policies.sql';
const ownershipName = '20260716000000_project_sync_single_user_ownership_rls.sql';
const permissiveIndex = migrationNames.indexOf(permissiveName);
const ownershipIndex = migrationNames.indexOf(ownershipName);
assert(permissiveIndex >= 0, `${permissiveName} is missing.`);
assert(ownershipIndex > permissiveIndex, `${ownershipName} must follow and correct the historical permissive policy.`);

const ownershipSql = fs.readFileSync(path.join(migrationsDirectory, ownershipName), 'utf8');
assert.match(ownershipSql, /force\s+row\s+level\s+security/i, 'Ownership migration must force row-level security.');
assert.match(ownershipSql, /revoke\s+all[\s\S]+from\s+public,\s*anon/i, 'Ownership migration must revoke public and anonymous access.');
assert.doesNotMatch(
  ownershipSql,
  /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i,
  'Ownership migration must not restore an unconditional policy.',
);
assert.match(ownershipSql, /dave_is_app_owner/i, 'Ownership migration must retain an explicit owner boundary.');

console.log(`Migration static validation PASS: ${migrationNames.length} ordered migrations.`);
