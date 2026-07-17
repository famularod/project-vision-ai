#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20260716000000_project_sync_single_user_ownership_rls.sql',
  ),
  'utf8',
);
const service = fs.readFileSync(
  path.join(root, 'services/SupabaseService.ts'),
  'utf8',
);

const targetTables = [
  'projects',
  'project_updates',
  'project_areas',
  'schedule_items',
  'reference_documents',
];

function includes(source, marker, message) {
  assert(source.includes(marker), message);
}

includes(migration, 'begin;', 'ownership migration must be transactional');
includes(migration, 'commit;', 'ownership migration must commit atomically');
includes(
  migration,
  'create table if not exists app_private.dave_app_owner',
  'migration must store one server-controlled app owner',
);
includes(
  migration,
  'if candidate_count <> 1 or target_owner is null then',
  'migration must abort rather than guess when ownership is ambiguous',
);
includes(
  migration,
  'min(user_id::text)::uuid',
  'the single UUID candidate must use an aggregate supported by PostgreSQL',
);
assert(
  !migration.includes('min(user_id)'),
  'PostgreSQL does not provide min(uuid)',
);
includes(
  migration,
  'where not exists (\n    select 1 from auth.users account',
  'migration must discard owner candidates that are not Auth users',
);
includes(
  migration,
  'columns.table_name = candidate_table_name',
  'owner discovery must use an unambiguous PL/pgSQL table variable',
);
assert(
  !migration.includes('columns.table_name = table_name'),
  'owner discovery must not collide with information_schema.columns.table_name',
);
includes(
  migration,
  'alter column owner_id set default auth.uid()',
  'new rows must default to the authenticated account',
);
includes(
  migration,
  'alter column owner_id set not null',
  'legacy sync rows must never remain unowned',
);
includes(
  migration,
  'foreign key (owner_id) references auth.users(id)',
  'owner ids must reference real Auth users',
);
includes(
  migration,
  'insert into public.organization_memberships',
  'the verified app owner must receive the existing Layer 4 cloud boundary',
);
includes(
  migration,
  "'organization_admin'",
  'the single app owner must be able to persist and validate DAVE authority',
);
includes(
  migration,
  "revoke all on function public.dave_is_app_owner() from public, anon;",
  'anonymous callers must not execute the ownership helper',
);

for (const table of targetTables) {
  includes(
    migration,
    `alter table public.%I force row level security`,
    'legacy sync tables must force row-level security',
  );
  includes(
    migration,
    `${table || ''}`,
    `migration must cover ${table}`,
  );
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    includes(
      migration,
      `table_name || '_owner_${operation}'`,
      `migration must create an owner-only ${operation} policy`,
    );
  }
}

assert(
  !/\busing\s*\(\s*true\s*\)/i.test(migration),
  'ownership migration must not contain a globally permissive USING policy',
);
assert(
  !/\bwith\s+check\s*\(\s*true\s*\)/i.test(migration),
  'ownership migration must not contain a globally permissive WITH CHECK policy',
);
assert(
  !/\bto\s+anon\b/i.test(migration),
  'ownership migration must never grant a policy to anonymous users',
);

for (const bucket of ['project-photos', 'project-documents']) {
  includes(
    migration,
    `bucket_id = '${bucket}' and (select public.dave_is_app_owner())`,
    `${bucket} must be restricted to the configured app owner`,
  );
}

includes(
  service,
  'async function requireAuthenticatedOwnerId',
  'cloud sync must resolve ownership from the active session',
);
includes(
  service,
  'owner_id: owner.data',
  'cloud writes must force the current authenticated owner',
);
assert.strictEqual(
  (service.match(/ownerScoped: true/g) || []).length,
  3,
  'only area, schedule, and reference-document generic writes should opt into legacy ownership',
);
includes(
  service,
  'if (ownerScoped) {',
  'generic intelligence writes must not receive a legacy owner_id column',
);
includes(
  service,
  ".eq('owner_id', owner.data)",
  'cloud reads and mutations must filter by the current authenticated owner',
);
const createProjectParams = service.match(
  /export type CreateProjectParams\s*=\s*\{([\s\S]*?)\n\};/m,
)?.[1] || '';
const saveProjectUpdateParams = service.match(
  /export type SaveProjectUpdateParams<[^>]+>\s*=\s*\{([\s\S]*?)\n\};/m,
)?.[1] || '';

assert(
  !/ownerId\??:/.test(createProjectParams),
  'project creation must not accept a caller-controlled owner id',
);
assert(
  !/ownerId\??:/.test(saveProjectUpdateParams),
  'project update sync must not accept a caller-controlled owner id',
);

console.log('Project sync ownership policy tests passed.');
