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

const fieldNotesName = '20260803000000_field_notes_cloud_sync.sql';
const fieldNotesSql = fs.readFileSync(path.join(migrationsDirectory, fieldNotesName), 'utf8');
for (const marker of [
  'create table if not exists public.field_notes',
  'owner_id uuid not null default auth.uid()',
  'primary key (owner_id, id)',
  'force row level security',
  'revoke all on table public.field_notes from public, anon',
  'grant select, insert, update on table public.field_notes to authenticated',
  'field_notes_owner_select',
  'field_notes_owner_insert',
  'field_notes_owner_update',
  'public.dave_is_app_owner()',
  'owner_id = (select auth.uid())',
  'alter publication supabase_realtime add table public.field_notes',
]) {
  assert(
    fieldNotesSql.includes(marker),
    `Field Notes cloud migration is missing security marker: ${marker}`,
  );
}
assert.doesNotMatch(
  fieldNotesSql,
  /grant\s+[^;]*delete/i,
  'Field Notes must not grant permanent deletion in the first cloud release.',
);
assert.doesNotMatch(
  fieldNotesSql,
  /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i,
  'Field Notes RLS must not contain a permissive owner bypass.',
);

const documentIndexName = '20260804000000_ecos_document_search_index.sql';
const documentIndexSql = fs.readFileSync(path.join(migrationsDirectory, documentIndexName), 'utf8');
for (const marker of [
  'create table if not exists public.ecos_document_pages',
  'create table if not exists public.ecos_document_chunks',
  'force row level security',
  'revoke all on table public.ecos_document_pages from public, anon',
  'revoke all on table public.ecos_document_chunks from public, anon',
  'public.dave_is_app_owner()',
  'owner_id = (select auth.uid())',
  'create or replace function public.ecos_replace_document_index',
  'create or replace function public.ecos_search_document_chunks',
  'security invoker',
  'ecos_reference_document_index_cleanup',
]) {
  assert(
    documentIndexSql.includes(marker),
    `ECOS document index migration is missing security marker: ${marker}`,
  );
}
assert.doesNotMatch(
  documentIndexSql,
  /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.ecos_document_/i,
  'Large ECOS page and chunk indexes must not be broadcast through Realtime.',
);
assert.doesNotMatch(
  documentIndexSql,
  /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i,
  'ECOS document index RLS must not contain a permissive owner bypass.',
);

const verifiedIndexCommitName = '20260807000000_ecos_commit_verified_index_job.sql';
const verifiedIndexCommitSql = fs.readFileSync(
  path.join(migrationsDirectory, verifiedIndexCommitName),
  'utf8',
);
for (const marker of [
  'create or replace function public.ecos_commit_verified_index_job',
  "set statement_timeout = '180s'",
  'The checkpoint source fingerprint does not match the current document',
  'Every ECOS index page must pass exact 6-of-6 visual coverage',
  'generate_series(1, job_record.source_page_count)',
  'ecos_document_index_job_pages',
  'status = \'committed\'',
  'security invoker',
]) {
  assert(
    verifiedIndexCommitSql.includes(marker),
    `ECOS verified index commit migration is missing safety marker: ${marker}`,
  );
}
assert.match(
  verifiedIndexCommitSql,
  /completedDeepReadRegionKeys[\s\S]*0:0:333:500[\s\S]*667:500:333:500/,
  'ECOS verified index commit must validate all deterministic drawing tiles.',
);
assert.doesNotMatch(
  verifiedIndexCommitSql,
  /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i,
  'ECOS verified index commit must not add a permissive owner bypass.',
);

console.log(`Migration static validation PASS: ${migrationNames.length} ordered migrations.`);
