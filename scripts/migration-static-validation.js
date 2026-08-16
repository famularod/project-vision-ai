#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertExactFrozenMigrationSuffix,
} = require('./ecos-build160-migration-evidence-lib');
const {
  POSTAPPLY_MARKER: SOURCE_PROVENANCE_POSTAPPLY_MARKER,
  REHEARSAL_MARKER: SOURCE_PROVENANCE_REHEARSAL_MARKER,
} = require('./vitruvius-source-provenance-migration-evidence-lib');
const {
  POSTAPPLY_MARKER: SOURCE_PROVENANCE_ACL_POSTAPPLY_MARKER,
  REHEARSAL_MARKER: SOURCE_PROVENANCE_ACL_REHEARSAL_MARKER,
} = require('./vitruvius-source-provenance-acl-migration-evidence-lib');

const root = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(root, 'supabase', 'migrations');
const migrationNames = fs.readdirSync(migrationsDirectory)
  .filter(name => name.endsWith('.sql'))
  .sort();

assert(migrationNames.length > 0, 'No Supabase migrations were found.');
assertExactFrozenMigrationSuffix(migrationNames, [
  '20260811021601',
  '20260811151028',
  '20260811235642',
  '20260812011945',
  '20260812064107',
  '20260812075338',
  '20260813212000',
  '20260814072356',
  '20260814090116',
  '20260814165008',
  '20260815093500',
]);

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

const frozenBuild160Migrations = [
  {
    version: '20260809193726',
    name: '20260809193726_ecos_project_evidence_exact_project_binding.sql',
    sha256: '1e96d376d2f869b220d32371e90636211b0011a85485f380af4c2c8340d2c65d',
    markers: [
      'alter table public.schedule_items',
      'alter table public.project_updates',
      'create or replace function public.ecos_bind_operational_row_project_id()',
      'ecos_operational_project_id_mismatch',
      'ecos_operational_project_id_invalid',
      'ecos_operational_project_id_required',
      "set project_id = operational_row.item_data->>'projectId'",
      "set project_id = operational_row.update_data->>'projectId'",
      "jsonb_typeof(payload_project_id_value) is distinct from 'string'",
      'project_record.id::text = top_level_project_id',
      "'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
      'create or replace function public.ecos_load_current_hosted_page_context(',
      'live_job_candidates as (',
      'eligible_live_jobs as (',
      'count(*) over (partition by candidate.document_id) as exact_job_count',
      'where candidate.exact_job_count = 1',
      'checkpoint.job_id = job.job_id',
      "checkpoint.final_page_data->'visualCoverage' as visual_coverage",
      "checkpoint.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256",
      "checkpoint.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version",
      "checkpoint.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text",
      'shadow_job_candidates as (',
      'eligible_shadow_jobs as (',
      'page.job_id = job.job_id',
      "page.assurance_result->>'evidenceVersion' = job.committed_evidence_version",
      "page.final_page_data->>'sourceSha256' = job.source_sha256",
      "page.final_page_data->'visualCoverage' as visual_coverage",
      "page.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256",
      "page.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version",
      "page.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text",
      'job.project_id = requested_project_id',
      'public.ecos_hosted_job_matches_reference(job.id, true)',
    ],
  },
  {
    version: '20260809195802',
    name: '20260809195802_ecos_pdf_annotation_rendered_corroboration.sql',
    sha256: '1d45a851add1711e4f76a2bb1b56d9c76c941206e95b5c522fe8ba31704b59e2',
    markers: [
      "evidence_item->'renderedCorroborated' is distinct from 'true'::jsonb",
      "rendered_region_ids := evidence_item->'renderedCorroboratingRegionIds'",
      "rendered_sources := evidence_item->'renderedCorroboratingSources'",
      'jsonb_array_length(rendered_region_ids) not between 1 and 8',
      'jsonb_array_length(rendered_sources) not between 1 and 8',
      "'fixed_visual_tile_coordinate_ocr'",
      "'title_block_ocr'",
      'from public, anon, authenticated;',
      'to service_role;',
    ],
  },
  {
    version: '20260809201435',
    name: '20260809201435_ecos_drawing_provider_attempt_reservations.sql',
    sha256: '67a393e48159e73fd7f91c5af24e98702026ae927dc6d7f5e3049b68037dddd4',
    markers: [
      'create table if not exists public.ecos_drawing_analysis_requests',
      'create table if not exists public.ecos_drawing_provider_attempts',
      'force row level security',
      'revoke all on table public.ecos_drawing_analysis_requests',
      'revoke all on table public.ecos_drawing_provider_attempts',
      'create or replace function public.ecos_begin_drawing_analysis(',
      'create or replace function public.ecos_reserve_drawing_provider_attempt(',
      'create or replace function public.ecos_finish_drawing_analysis(',
      'pg_advisory_xact_lock',
      'ecos_drawing_provider_attempt_already_reserved',
      'provider-attempt limit per drawing request',
      'daily organization provider-attempt limit',
      'octet_length(visual_region_key) between 1 and 300',
      'octet_length(normalized_region_key) not between 1 and 300',
      'octet_length(normalized_idempotency_key) not between 1 and 300',
      '8cb03b0dda19df38df3018f308da0f33cfd1aae77f0af36c0e8b6cf3431e3ea9',
    ],
  },
  {
    version: '20260809222329',
    name: '20260809222329_ecos_reference_document_authority_keys_guard.sql',
    sha256: '84b0380c4948442d2917b64829430578ee6fa9e7f31b0ac410b66445640318e4',
    markers: [
      'create or replace function public.ecos_reference_document_commit_identity(',
      'create or replace function public.ecos_guard_reference_document_authority_keys()',
      "current_setting('app.ecos_authority_purge', true) = 'allowed'",
      "current_setting('app.ecos_hosted_commit_hydration', true)",
      'create trigger ecos_reference_document_authority_keys_guard',
      'drop function if exists public.ecos_mark_verified_index_commit()',
      'create or replace function public.ecos_hosted_job_matches_reference(',
      "source.document_data->>'projectId' = job.project_id",
      'create or replace function public.ecos_mark_hosted_verified_index_commit()',
      'rename to ecos_enqueue_hosted_reference_unchecked',
      'ecos_hosted_configuration_must_be_disabled_for_project_identity_backfill',
      'create temporary table ecos_reference_project_backfill_candidates',
      'having count(distinct project_name.canonical_name) = 1',
      'create temporary table ecos_reference_hosted_reset_documents',
      'delete from public.ecos_hosted_document_chunks chunk',
      'delete from public.ecos_hosted_document_pages page',
      'delete from public.ecos_hosted_index_jobs job',
      'ecos_noncanonical_hosted_job_survived_project_identity_backfill',
    ],
  },
  {
    version: '20260810013000',
    name: '20260810013000_ecos_hosted_page_graph_and_search_authority.sql',
    sha256: 'c5217481bd7e47e9599f402953bfcdac90adaea5166928cce3ef704d889ed0fb',
    markers: [
      'create or replace function public.ecos_canonical_json_text(p_value jsonb)',
      'create or replace function public.ecos_page_graph_sha256(p_pages jsonb)',
      '545b03371fb739e594b59a5edeb006654b17e3897ef443cdf36063e6626f85e7',
      'create or replace function public.ecos_build_hosted_page_graph(p_job_id uuid)',
      "'ecosVerifiedIndexPageGraphSha256'",
      "public.ecos_request_jwt_role() = 'service_role'",
      'ecos_hosted_configuration_must_be_disabled_for_page_graph_reseal',
      'revoke all on table public.reference_documents from public, anon, authenticated',
      'create policy reference_documents_owner_select',
      'create policy reference_documents_owner_insert',
      'create policy reference_documents_owner_update',
      'create policy reference_documents_owner_delete',
      'drop function if exists public.ecos_search_hosted_shadow_chunks(text, text[], integer)',
      'drop function if exists public.ecos_search_hosted_document_chunks(text, text[], integer)',
      'count(*) over (partition by candidate.document_id) as exact_job_count',
      'job_id uuid',
      'organization_id text',
      'project_id text',
      'source_sha256 text',
      'evidence_version text',
      'ecos_reference_document_hosted_enqueue_not_enabled',
    ],
  },
];

const rehearsalPath = path.join(
  root,
  'validation',
  'ecos',
  'ecos-migration-adversarial-rollback.sql',
);
const postapplyPath = path.join(
  root,
  'validation',
  'ecos',
  'ecos-pending-rollout-postapply-verify.sql',
);
const rehearsalTemplate = fs.readFileSync(rehearsalPath, 'utf8');
const postapplySql = fs.readFileSync(postapplyPath, 'utf8');

function stripFrozenTransactionBoundary(sql, name) {
  const lines = sql.split(/\r?\n/);
  const beginIndex = lines.findIndex(line => line.trim().toLowerCase() === 'begin;');
  let commitIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim()) continue;
    if (lines[index].trim().toLowerCase() === 'commit;') commitIndex = index;
    break;
  }
  assert(beginIndex >= 0, `${name} has no top-level BEGIN boundary.`);
  assert(commitIndex > beginIndex, `${name} has no final COMMIT boundary.`);
  assert.equal(
    lines.filter(line => line.trim().toLowerCase() === 'begin;').length,
    1,
    `${name} has an unexpected additional top-level BEGIN line.`,
  );
  assert.equal(
    lines.filter(line => line.trim().toLowerCase() === 'commit;').length,
    1,
    `${name} has an unexpected additional top-level COMMIT line.`,
  );
  return [
    ...lines.slice(0, beginIndex),
    ...lines.slice(beginIndex + 1, commitIndex),
    ...lines.slice(commitIndex + 1),
  ].join('\n').trim();
}

let composedRehearsal = rehearsalTemplate;
let previousMarkerOffset = -1;
for (const frozen of frozenBuild160Migrations) {
  const sql = fs.readFileSync(path.join(migrationsDirectory, frozen.name), 'utf8');
  const digest = crypto.createHash('sha256').update(sql).digest('hex');
  assert.equal(digest, frozen.sha256, `Frozen migration hash changed: ${frozen.name}`);
  for (const marker of frozen.markers) {
    assert(sql.includes(marker), `${frozen.name} is missing frozen safety marker: ${marker}`);
  }

  const applyMarker = `-- @apply-frozen-migration ${frozen.version}`;
  assert.equal(
    rehearsalTemplate.split(applyMarker).length - 1,
    1,
    `Rehearsal must contain exactly one apply marker for ${frozen.version}.`,
  );
  const markerOffset = rehearsalTemplate.indexOf(applyMarker);
  assert(markerOffset > previousMarkerOffset, 'Frozen rehearsal apply markers are out of order.');
  previousMarkerOffset = markerOffset;
  const frozenBody = [
    `-- BEGIN FROZEN MIGRATION ${frozen.version} SHA256 ${frozen.sha256}`,
    stripFrozenTransactionBoundary(sql, frozen.name),
    `-- END FROZEN MIGRATION ${frozen.version}`,
  ].join('\n');
  composedRehearsal = composedRehearsal.replace(
    applyMarker,
    () => frozenBody,
  );
}

const pageGraphAuthorityMigration = fs.readFileSync(
  path.join(
    migrationsDirectory,
    '20260810013000_ecos_hosted_page_graph_and_search_authority.sql',
  ),
  'utf8',
);
assert.doesNotMatch(
  pageGraphAuthorityMigration,
  /current_setting\(\s*'app\.ecos_hosted_commit_hydration'/i,
  'Authenticated custom GUCs must not mint hosted page-graph authority.',
);

for (const marker of [
  'create temporary table ecos_build160_rehearsal_manifest',
  'create or replace function pg_temp.ecos_build160_manifest_snapshot()',
  'ECOS_REHEARSAL_PRECONDITION_FAIL',
  'ECOS_193726_FAIL',
  'ECOS_195802_FAIL',
  'ECOS_201435_FAIL',
  'ECOS_222329_FAIL',
  'ECOS_100130_FAIL',
  '$ecos_stage_193726$',
  '$ecos_stage_195802$',
  '$ecos_stage_201435$',
  '$ecos_stage_222329$',
  '$ecos_stage_100130_exact_graph$',
  'ecos_operational_project_id_mismatch',
  'ecos_operational_project_id_invalid',
  'build160-live-visual-exact',
  'live page context lost the exact assured visualCoverage receipt',
  'ambiguous dual-organization exact live jobs returned a visual receipt',
  'ambiguous dual-organization exact shadow jobs returned a page receipt',
  'shadow assurance evidence version mismatch returned a page receipt',
  'shadow top-level source checksum mismatch returned a page receipt',
  'shadow visual source checksum mismatch returned a page receipt',
  'shadow visual evidence version mismatch returned a page receipt',
  'shadow visual page number mismatch returned a page receipt',
  'renderedCorroboratingRegionIds',
  'ecos_drawing_provider_attempt_already_reserved',
  'active drawing-analysis limit for source owner',
  'ecosVerifiedIndexCommitVersion',
  'fresh B hosted commit did not mint receipt',
  'public.ecos_activate_current_reference_document(',
  'fixture_nested_authority_update',
  'A -> B -> A',
  'same-name cross-project isolation',
  'authenticated custom GUC minted authority',
  'cross-owner select escaped RLS',
  'service ready commit did not mint exact graph',
  'shadow search lost exact job authority',
  'live search lost exact job authority',
  'ambiguous exact live jobs returned evidence',
  'client graph mutation retained authority',
  'rollback;',
  'ECOS_REHEARSAL_ROLLBACK_FAIL',
  'ECOS_BUILD160_MIGRATION_REHEARSAL_OK',
]) {
  assert(
    rehearsalTemplate.includes(marker),
    `Build 160 rehearsal is missing required contract marker: ${marker}`,
  );
}

const postFrozenMigrations = [
  {
    name: '20260811021601_exact_project_delete_rpc.sql',
    markers: [
      'create function public.dave_delete_project_atomically(',
      'p_project_id text',
      'p_project_name text',
      'drop function if exists public.dave_delete_project_atomically(text)',
      'project deletion blocked by reference document without exact single-project binding',
      'grant execute on function public.dave_delete_project_atomically(text, text)',
    ],
  },
  {
    name: '20260811151028_dave_project_cover_commit_authority.sql',
    markers: [
      'create or replace function public.dave_commit_project_cover_photo(',
      'pg_advisory_xact_lock(',
      "cover_object.user_metadata ->> 'vitruviusContentSha256'",
      "cover_object.user_metadata ->> 'vitruviusSizeBytes'",
      'drop policy if exists project_photos_owner_update',
      'drop policy if exists project_photos_owner_delete',
      'create policy project_photos_authenticated_update',
      'create policy project_photos_authenticated_delete',
      'create trigger dave_project_cover_authority_guard',
      'project cover authority requires atomic commit',
    ],
  },
  {
    name: '20260811235642_dave_project_cover_cleanup_authority.sql',
    markers: [
      'create or replace function public.dave_guard_project_cover_storage_delete()',
      "auth_user::text || ':project-cover:' || project_id",
      "referenced_project.project_data #>> '{coverPhoto,remotePath}' = old.name",
      'before delete on storage.objects',
      'create trigger dave_project_cover_storage_delete_guard',
      'drop policy if exists project_photos_authenticated_delete',
      'create policy project_photos_authenticated_delete',
      'revoke all on function public.dave_guard_project_cover_storage_delete()',
    ],
  },
  {
    name: '20260812011945_ecos_visual_exception_dismissal_authority.sql',
    markers: [
      'create or replace function public.ecos_dismiss_hosted_visual_exception_v1(',
      "p_normalized_dismissal->'facts' is distinct from '[]'::jsonb",
      'Every bounded diagnostic candidate must be dismissed',
      'Dismissed candidate indexes must be exact and complete',
      "job.claim_token = p_claim_token",
      "job.lease_expires_at >= now()",
      "'bounded_visual_exception_dismissal_v1'",
      'from public, anon, authenticated;',
      'to service_role;',
    ],
  },
  {
    name: '20260812064107_ecos_managed_source_provenance_guard.sql',
    markers: [
      'create or replace function public.ecos_reference_document_enqueue_identity(',
      "'isSuperseded', coalesce(p_document_data, '{}'::jsonb)->>'drawingStatus' = 'Superseded'",
      "'sourcePageCount', coalesce(p_document_data, '{}'::jsonb)->'sourcePageCount'",
      "->>'sourceProvider' = 'google_drive'",
      'public.ecos_reference_document_enqueue_identity(old.document_data)',
      'public.ecos_reference_document_enqueue_identity(new.document_data)',
      'create or replace function public.ecos_guard_hosted_managed_source_authority()',
      "old.state in ('queued', 'reconnect_source')",
      'not clean_mutable_managed_job',
      'public.ecos_hosted_index_pages',
      'public.ecos_hosted_shadow_chunks',
      'public.ecos_hosted_shadow_materialization_queue',
      'public.ecos_hosted_visual_exceptions',
      'public.ecos_hosted_index_usage',
      'public.ecos_drawing_analysis_requests',
      'new.source_provider := old.source_provider',
      'new.source_locator := old.source_locator',
      'create trigger ecos_hosted_managed_source_authority_guard',
      'before update of source_provider, source_locator',
      'ecos_hosted_configuration_must_be_disabled_for_source_provenance_guard',
    ],
  },
  {
    name: '20260812075338_ecos_source_provenance_trigger_acl_fix.sql',
    markers: [
      'ecos_source_provenance_acl_requires_exact_ten_migration_tip',
      'lock table public.ecos_hosted_index_configuration in share row exclusive mode',
      "procedure_record.proowner = 'postgres'::regrole",
      '043c4984955086c41ee6a343135752384447690e025b79d69b064cfb103dbc8c',
      "array['service_role:EXECUTE:false']::text[]",
      'from public, anon, authenticated, service_role;',
      'ecos_source_provenance_enqueue_function_binding_precondition_failed',
      'ecos_source_provenance_enqueue_function_binding_postcondition_failed',
      'ecos_source_provenance_enqueue_catalog_integrity_postcondition_failed',
    ],
  },
];
for (const migration of postFrozenMigrations) {
  const sql = fs.readFileSync(path.join(migrationsDirectory, migration.name), 'utf8');
  for (const marker of migration.markers) {
    assert(
      sql.includes(marker),
      `${migration.name} is missing post-frozen safety marker: ${marker}`,
    );
  }
}

const postFrozenRehearsalPath = path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-postfrozen-migration-adversarial-rollback.sql',
);
const postFrozenPostapplyPath = path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-postfrozen-migration-postapply-verify.sql',
);
const postFrozenRehearsal = fs.readFileSync(postFrozenRehearsalPath, 'utf8');
const postFrozenPostapply = fs.readFileSync(postFrozenPostapplyPath, 'utf8');
for (const marker of [
  '-- @apply-post-frozen-migration 20260811021601',
  '-- @apply-post-frozen-migration 20260811151028',
  'outer transaction did not restore the exact preapply state',
  'VITRUVIUS_POSTFROZEN_MIGRATION_REHEARSAL_OK',
]) {
  assert(
    postFrozenRehearsal.includes(marker),
    `Post-frozen rollback rehearsal is missing required marker: ${marker}`,
  );
}
for (const marker of [
  "'20260811021601'",
  "'20260811151028'",
  'target migration history is not the exact sealed seven-migration suffix',
  'project-cover authority trigger is missing or disabled',
  'immutable project-cover storage policies are incomplete',
  'VITRUVIUS_POSTFROZEN_POSTAPPLY_OK',
]) {
  assert(
    postFrozenPostapply.includes(marker),
    `Post-frozen post-apply verifier is missing required marker: ${marker}`,
  );
}
const coverHardeningRehearsal = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-cover-hardening-migration-adversarial-rollback.sql',
), 'utf8');
const coverHardeningPostapply = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-cover-hardening-migration-postapply-verify.sql',
), 'utf8');
for (const marker of [
  '-- @apply-cover-hardening-migration 20260812011945',
  'fact-free visual dismissal did not persist exactly',
  'cover hardening outer transaction did not restore the exact preapply state',
  'VITRUVIUS_COVER_HARDENING_MIGRATION_REHEARSAL_OK',
]) {
  assert(
    coverHardeningRehearsal.includes(marker),
    `Cover hardening rollback rehearsal is missing required marker: ${marker}`,
  );
}
for (const marker of [
  "'20260812011945'",
  'target migration history is not the exact sealed nine-migration suffix',
  'visual dismissal authority function or ACL is unsafe',
  'storage mutation policy catalog contains an unexpected authorizer',
  'project-cover immutable storage policy predicates are unsafe',
  'VITRUVIUS_COVER_HARDENING_POSTAPPLY_OK',
]) {
  assert(
    coverHardeningPostapply.includes(marker),
    `Cover hardening post-apply verifier is missing required marker: ${marker}`,
  );
}
const sourceProvenanceRehearsal = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-source-provenance-migration-adversarial-rollback.sql',
), 'utf8');
const sourceProvenancePostapply = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-source-provenance-migration-postapply-verify.sql',
), 'utf8');
for (const marker of [
  '-- @apply-source-provenance-migration 20260812064107',
  'source-provenance rehearsal requires the exact sealed nine-migration tip',
  'source-provenance rehearsal changed non-target, live, configuration, or migration state',
  'outer rollback did not restore the exact relation snapshot',
  SOURCE_PROVENANCE_REHEARSAL_MARKER,
]) {
  assert(
    sourceProvenanceRehearsal.includes(marker),
    `Source-provenance rollback rehearsal is missing required marker: ${marker}`,
  );
}
assert.equal(
  sourceProvenanceRehearsal.match(/^set local role postgres;$/gmi)?.length || 0,
  2,
  'Source-provenance rollback rehearsal must restore postgres exactly twice.',
);
assert.doesNotMatch(
  sourceProvenanceRehearsal,
  /\breset\s+role\s*;/i,
  'Source-provenance rollback rehearsal must not drop to the pooler session role.',
);
for (const marker of [
  "'20260812064107'",
  'source-provenance migration history is not the exact sealed ten-migration suffix',
  'enqueue-identity helper security or search_path is unsafe',
  'managed-source guard definition markers are incomplete',
  'exact enabled before-update managed-source guard trigger is missing',
  'exact six-page source-provenance canary job is not ready',
  "'protectedManagedUploadJobsMissingGcsAuthority', 0",
  SOURCE_PROVENANCE_POSTAPPLY_MARKER,
]) {
  assert(
    sourceProvenancePostapply.includes(marker),
    `Source-provenance post-apply verifier is missing required marker: ${marker}`,
  );
}
const sourceProvenanceAclRehearsal = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-source-provenance-acl-migration-adversarial-rollback.sql',
), 'utf8');
const sourceProvenanceAclPostapply = fs.readFileSync(path.join(
  root,
  'validation',
  'ecos',
  'vitruvius-source-provenance-acl-migration-postapply-verify.sql',
), 'utf8');
for (const marker of [
  '-- @apply-source-provenance-acl-migration 20260812075338',
  'source-provenance ACL rehearsal requires the exact sealed ten-migration tip',
  "'public', 'anon', 'authenticated', 'service_role', 'authenticator'",
  'source-provenance ACL migration changed function or trigger definition',
  'service_role trigger runtime did not update the exact canary reference',
  'source-provenance ACL outer rollback did not restore catalog and service grant',
  "'serviceRoleTriggerExecutionPreserved', true",
  SOURCE_PROVENANCE_ACL_REHEARSAL_MARKER,
]) {
  assert(
    sourceProvenanceAclRehearsal.includes(marker),
    `Source-provenance ACL rollback rehearsal is missing required marker: ${marker}`,
  );
}
assert.equal(
  sourceProvenanceAclRehearsal.match(/^set local role service_role;$/gmi)?.length || 0,
  1,
  'Source-provenance ACL rehearsal must exercise the service-role trigger path once.',
);
assert.equal(
  sourceProvenanceAclRehearsal.match(/p_ignored_keys\s*=>/g)?.length || 0,
  1,
  'Source-provenance ACL rehearsal may ignore transient keys for exactly one relation.',
);
assert.match(
  sourceProvenanceAclRehearsal,
  /p_ignored_keys\s*=>\s*array\['updated_at'\]::text\[\]/,
  'Source-provenance ACL rehearsal may ignore only the reference timestamp in its in-transaction relation digest.',
);
assert.match(
  sourceProvenanceAclRehearsal,
  /'relation:reference_documents_noncanary'[\s\S]*?relation_row\.id::text\s*<>\s*'web-document-6052f920-128e-46c5-8d93-46556e86252d'/,
  'Source-provenance ACL rehearsal must fully bind every non-canary reference document.',
);
assert.match(
  sourceProvenanceAclRehearsal,
  /'relation:reference_document_canary'[\s\S]*?relation_row\.id::text\s*=\s*'web-document-6052f920-128e-46c5-8d93-46556e86252d'[\s\S]*?p_ignored_keys\s*=>\s*array\['updated_at'\]::text\[\]/,
  'Source-provenance ACL rehearsal must scope its transient timestamp exclusion to the exact canary.',
);
assert.match(
  sourceProvenanceAclRehearsal,
  /'rollback:canary_reference_updated_at'/,
  'Source-provenance ACL rehearsal must separately prove the transient timestamp was restored by rollback.',
);
assert.doesNotMatch(
  sourceProvenanceAclRehearsal,
  /\breset\s+role\s*;/i,
  'Source-provenance ACL rehearsal must not drop to the pooler session role.',
);
for (const marker of [
  "'20260812064107', '20260812075338'",
  'source-provenance ACL postapply requires exact eleven-migration tip',
  "'public', 'anon', 'authenticated', 'service_role', 'authenticator'",
  'source-provenance ACL postapply trigger binding is not exact',
  'source-provenance ACL postapply exact canary is not ready',
  "'referenceEnqueueFunctionNonOwnerGrants', 0",
  "'referenceEnqueueFunctionBindings', 1",
  "'serviceRoleDirectExecutePrivilege', false",
  SOURCE_PROVENANCE_ACL_POSTAPPLY_MARKER,
]) {
  assert(
    sourceProvenanceAclPostapply.includes(marker),
    `Source-provenance ACL post-apply verifier is missing required marker: ${marker}`,
  );
}
assert(
  rehearsalTemplate.indexOf('rollback;') > previousMarkerOffset,
  'The full frozen migration chain must be inside the outer rollback boundary.',
);
for (const frozen of frozenBuild160Migrations) {
  assert(
    !composedRehearsal.includes(`-- @apply-frozen-migration ${frozen.version}`),
    `Frozen apply marker was not composed: ${frozen.version}`,
  );
}

for (const marker of [
  "'20260809193726'",
  "'20260809195802'",
  "'20260809201435'",
  "'20260809222329'",
  "'20260810013000'",
  'ecos_hosted_configuration_must_remain_disabled',
  'ecos_operational_project_binding_invalid',
  'ecos_operational_name_fallback_survived',
  'ecos_reference_project_binding_invalid',
  'ecos_authority_key_survived_rollout',
  'ecos_reference_document_owner_rls_unsafe',
  'ecos_page_graph_golden_vector_mismatch',
  'ecos_page_graph_receipt_guard_unsafe',
  'ecos_shadow_search_authority_unsafe',
  'ecos_live_search_authority_unsafe',
  'ecos_noncanonical_hosted_graph_survived',
  'ecos_provider_ledger_not_empty_before_canary',
  'ecos_provider_ledger_rls_or_policy_unsafe',
  'ecos_provider_golden_vector_mismatch',
  'shadow_job_candidates as',
  'eligible_shadow_jobs as',
  'page.job_id = job.job_id',
  "page.assurance_result->>''evidenceversion'' = job.committed_evidence_version",
  "page.final_page_data->>''sourcesha256'' = job.source_sha256",
  "page.final_page_data->''visualcoverage'' as visual_coverage",
  'ecos_atomic_activation_contract_unsafe',
  'ecos_reference_document_atomic_current_guard',
  'ecos_retired_local_marker_surface_survived',
  'ecos_required_trigger_missing_or_disabled',
  'ecos_function_acl_unsafe',
  'ECOS_BUILD160_POSTAPPLY_OK',
]) {
  assert(
    postapplySql.includes(marker),
    `Build 160 post-apply verifier is missing required marker: ${marker}`,
  );
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

if (process.argv.includes('--emit-ecos-rehearsal')) {
  process.stdout.write(`${composedRehearsal.trim()}\n`);
} else {
  console.log(
    `Migration static validation PASS: ${migrationNames.length} ordered migrations; ` +
    `${frozenBuild160Migrations.length} frozen Build 160 hashes and ` +
    `${postFrozenMigrations.length} post-frozen transition artifacts verified.`,
  );
}
