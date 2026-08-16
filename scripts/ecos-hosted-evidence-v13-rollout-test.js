const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const expectAll = (source, markers, message) => {
  for (const marker of markers) {
    expect(source.includes(marker), `${message}: ${marker}`);
  }
};
const functionBody = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start >= 0, `Missing function: ${name}`);
  const end = source.indexOf('\n$$;', start);
  expect(end > start, `Could not isolate function: ${name}`);
  return source.slice(start, end + 4);
};

const migrationPaths = [
  'supabase/migrations/20260808100000_vitruvius_project_membership_beta_foundation.sql',
  'supabase/migrations/20260808101000_ecos_hosted_shadow_materialization_queue.sql',
  'supabase/migrations/20260808102000_ecos_hosted_evidence_v13_reset.sql',
  'supabase/migrations/20260808103000_ecos_hosted_visual_reservation_version.sql',
  'supabase/migrations/20260809014604_ecos_hosted_visual_exception_contract_v2.sql',
  'supabase/migrations/20260809021651_ecos_label_block_provenance.sql',
];
const migrations = Object.fromEntries(migrationPaths.map(file => [file, read(file)]));
for (const file of migrationPaths.slice(1)) {
  const source = migrations[file];
  expect(/\bbegin;/.test(source), `${file} must use a migration transaction`);
  expect(/\bcommit;\s*$/.test(source), `${file} must commit its migration transaction`);
}

const membership = migrations[migrationPaths[0]];
const materializationV1 = migrations[migrationPaths[1]];
const reset = migrations[migrationPaths[2]];
const reservationV1 = migrations[migrationPaths[3]];
const visualV2 = migrations[migrationPaths[4]];
const provenance = migrations[migrationPaths[5]];

expectAll(membership, [
  'alter table public.vitruvius_project_memberships enable row level security',
  'create policy vitruvius_project_memberships_read',
  'create policy vitruvius_project_memberships_admin_insert',
  'create policy vitruvius_project_memberships_admin_update',
  'create policy vitruvius_project_memberships_admin_delete',
], 'Membership beta foundation is incomplete');

expectAll(materializationV1, [
  'alter table public.ecos_hosted_shadow_materialization_queue force row level security',
  'revoke all on table public.ecos_hosted_shadow_materialization_queue',
  'from public, anon, authenticated',
  'grant all on table public.ecos_hosted_shadow_materialization_queue to service_role',
], 'Shadow queue isolation is incomplete');

expectAll(reset, [
  "job.mode = 'shadow'",
  'job.source_sha256 = lower(trim(p_expected_source_sha256))',
  "raise exception 'An active worker lease is still processing this job'",
  'for update',
  'delete from public.ecos_hosted_visual_exceptions',
  'delete from public.ecos_hosted_index_pages',
  'delete from public.ecos_hosted_shadow_chunks',
  'delete from public.ecos_hosted_shadow_materialization_queue',
  "'targetEvidenceVersion', 'ecos-hosted-evidence/1.3'",
  'grant execute on function public.ecos_reset_hosted_shadow_job_for_reindex',
  'to service_role',
], 'Evidence 1.3 reset boundary is incomplete');
expect(!reset.includes('delete from public.reference_documents'), 'Reset must not delete source documents');

expectAll(reservationV1, [
  "normalized_version !~ '^ecos-hosted-evidence/[0-9]+\\.[0-9]+$'",
  "'visual:' || normalized_version || ':'",
  "'providerAttempt', 'worker_claim'",
  "usage.event_type = 'visual_region_reserved'",
], 'Versioned reservation migration is incomplete');

const reserve = functionBody(visualV2, 'ecos_reserve_hosted_visual_region_v2');
const upsert = functionBody(visualV2, 'ecos_upsert_hosted_visual_exception_v2');
const resolve = functionBody(visualV2, 'ecos_resolve_hosted_visual_exception_v2');
const materialize = functionBody(visualV2, 'ecos_materialize_next_hosted_shadow_page');
const readyGuard = functionBody(visualV2, 'ecos_require_complete_shadow_materialization');

for (const [name, body] of Object.entries({ reserve, upsert, resolve, materialize })) {
  expect(
    body.includes("if coalesce(auth.jwt()->>'role', '') <> 'service_role'"),
    `${name} must reject every non-service JWT`,
  );
  expect(
    body.includes('job.claim_token = p_claim_token') &&
      body.includes('job.lease_expires_at >= now()'),
    `${name} must bind work to an exact non-expired claim`,
  );
}

expectAll(resolve, [
  "p_normalized_evidence->>'schemaVersion' is distinct from 'ecos-drawing-page-analysis/2.0'",
  "p_normalized_evidence->>'evidenceVersion' is distinct from normalized_version",
  "p_normalized_evidence->>'exceptionFingerprint' is distinct from normalized_fingerprint",
  "p_assurance_result->>'evidenceVersion' is distinct from normalized_version",
  "p_assurance_result->>'exceptionFingerprint' is distinct from normalized_fingerprint",
  "fact->>'evidenceVersion' is distinct from normalized_version",
  "fact->>'exceptionFingerprint' is distinct from normalized_fingerprint",
  "fact->>'visionProvider' is distinct from p_normalized_evidence->>'visionProvider'",
  "fact->>'assuranceProvider' is distinct from p_normalized_evidence->>'assuranceProvider'",
  "jsonb_typeof(fact->'providerBounds') <> 'object'",
  'abs(fact_x - provider_x::numeric / 1000) > 0.000001',
  'abs(fact_y - provider_y::numeric / 1000) > 0.000001',
  'abs(fact_width - provider_width::numeric / 1000) > 0.000001',
  'abs(fact_height - provider_height::numeric / 1000) > 0.000001',
  'intersection_area < smaller_area * 0.5',
  "raise exception 'Visual fact proof does not materially overlap the exact exception bounds'",
  'on conflict (job_id, page_number, region_key) do update set',
], 'Exact resolution contract is incomplete');

const insertPosition = resolve.indexOf('insert into public.ecos_hosted_visual_exceptions');
const conflictPosition = resolve.indexOf('on conflict (job_id, page_number, region_key) do update set');
expect(insertPosition >= 0 && conflictPosition > insertPosition, 'Resolution must atomically insert or update');

const durableGuard = materialize.indexOf('Accepted shadow page produced no durable search chunks');
const queueDelete = materialize.indexOf('delete from public.ecos_hosted_shadow_materialization_queue');
expect(durableGuard >= 0 && queueDelete > durableGuard, 'Queue acknowledgement must follow durable-chunk validation');
expectAll(materialize, [
  'for update skip locked',
  'get diagnostics affected_rows = row_count',
  "raise exception 'Shadow materialization queue acknowledgement failed'",
], 'Materializer rollback/queue-retention contract is incomplete');

expectAll(readyGuard, [
  "new.mode = 'shadow' and new.state = 'ready'",
  'from public.ecos_hosted_shadow_materialization_queue queued',
  'An accepted shadow page has no durable search chunks',
  'exception.evidence_version is distinct from new.committed_evidence_version',
  'Resolved visual evidence is stale or unassured',
], 'Ready-state rejection contract is incomplete');

for (const signature of [
  'ecos_upsert_hosted_visual_exception(\n  uuid, uuid, integer, text, jsonb, text\n) from public, anon, authenticated, service_role',
  'ecos_resolve_hosted_visual_exception(\n  uuid, uuid, integer, text, jsonb, jsonb\n) from public, anon, authenticated, service_role',
  'ecos_reserve_hosted_visual_region(\n  uuid, uuid, integer, text, bigint\n) from public, anon, authenticated, service_role',
  'ecos_reserve_hosted_visual_region_versioned(\n  uuid, uuid, integer, text, text, bigint\n) from public, anon, authenticated, service_role',
]) {
  expect(visualV2.includes(signature), `Legacy service-role EXECUTE revocation is missing: ${signature}`);
}
for (const signature of [
  'ecos_reserve_hosted_visual_region_v2(\n  uuid, uuid, integer, text, text, text, bigint\n) from public, anon, authenticated',
  'ecos_upsert_hosted_visual_exception_v2(\n  uuid, uuid, integer, text, jsonb, text, text, text\n) from public, anon, authenticated',
  'ecos_resolve_hosted_visual_exception_v2(\n  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb\n) from public, anon, authenticated',
]) {
  expect(visualV2.includes(signature), `V2 anon/auth EXECUTE revocation is missing: ${signature}`);
}
for (const signature of [
  'grant execute on function public.ecos_reserve_hosted_visual_region_v2(\n  uuid, uuid, integer, text, text, text, bigint\n) to service_role',
  'grant execute on function public.ecos_upsert_hosted_visual_exception_v2(\n  uuid, uuid, integer, text, jsonb, text, text, text\n) to service_role',
  'grant execute on function public.ecos_resolve_hosted_visual_exception_v2(\n  uuid, uuid, integer, text, jsonb, text, text, text, jsonb, jsonb\n) to service_role',
  'grant execute on function public.ecos_materialize_next_hosted_shadow_page(uuid, uuid)\n  to service_role',
]) {
  expect(visualV2.includes(signature), `V2 service-role EXECUTE grant is missing: ${signature}`);
}

expectAll(provenance, [
  "'rawSource', nullif(trim(source_region->>'source'), '')",
  "'reconstructionMethod', source_region->'reconstructionMethod'",
  "'evidenceSources', source_region->'evidenceSources'",
  "'constituentEvidence', source_region->'constituentEvidence'",
  "'corroboratingEvidence', source_region->'corroboratingEvidence'",
  'revoke all on function public.ecos_enrich_shadow_chunk_provenance() from public, anon, authenticated',
  'revoke all on function public.ecos_enrich_hosted_chunk_provenance() from public, anon, authenticated',
  'revoke all on function public.ecos_enrich_legacy_chunk_provenance() from public, anon, authenticated',
], 'Label-block provenance contract is incomplete');

const edge = read('supabase/functions/ecos-analyze-drawing-page/index.ts');
const visual = read('workers/ecos-indexer/ecos_indexer/visual.py');
const gateway = read('workers/ecos-indexer/ecos_indexer/gateway.py');
const worker = read('workers/ecos-indexer/ecos_indexer/worker.py');
expectAll(edge, [
  'function pageBoundsFromTile(',
  'Math.round((tile.x + (local.x / 1_000) * tile.width) * 1_000)',
  'Math.round((tile.y + (local.y / 1_000) * tile.height) * 1_000)',
  'Math.round((local.width / 1_000) * tile.width * 1_000)',
  'Math.round((local.height / 1_000) * tile.height * 1_000)',
], 'Edge tile-to-page coordinate mapping is incomplete');
expect(
  /bounds:\s*tileIndex == null\s*\?\s*bounds\s*:\s*pageBoundsFromTile\(bounds, tileImages\[tileIndex\]\.bounds\)/.test(edge),
  'Edge tile-to-page coordinate mapping is incomplete: tile-local facts must map to page bounds',
);
expectAll(visual, [
  '"analysisPass": "page_tiles"',
  'review_bounds = visual_review_bounds(bounds, candidates)',
  '"tileBounds": review_bounds',
  '"bounds": bounds',
  '"tileImages": tiles',
  'def normalized_provider_bounds(value: Any)',
  'return {key: round(integer_bounds[key] / 1000, 6) for key in integer_bounds}',
  '"providerBounds": {',
  'key: int(raw["bounds"][key]) for key in ("x", "y", "width", "height")',
], 'Worker coordinate preservation is incomplete');
expectAll(worker, [
  'exception_fingerprint = visual_exception_fingerprint(exception)',
  'evidence_version=EVIDENCE_VERSION',
  'exception_fingerprint=exception_fingerprint',
  'normalized_evidence=durable_evidence',
], 'Worker evidence binding is incomplete');
expectAll(gateway, [
  'self.rpc("ecos_resolve_hosted_visual_exception_v2"',
  '"p_evidence_version": evidence_version',
  '"p_exception_fingerprint": exception_fingerprint',
  '"p_normalized_evidence": normalized_evidence',
  '"p_assurance_result": assurance_result',
], 'Worker-to-database mapping is incomplete');

const pageBoundsFromTile = (local, tile) => ({
  x: Math.round((tile.x + (local.x / 1000) * tile.width) * 1000),
  y: Math.round((tile.y + (local.y / 1000) * tile.height) * 1000),
  width: Math.max(1, Math.round((local.width / 1000) * tile.width * 1000)),
  height: Math.max(1, Math.round((local.height / 1000) * tile.height * 1000)),
});
const tile = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const local = { x: 250, y: 250, width: 500, height: 500 };
const providerBounds = pageBoundsFromTile(local, tile);
expect(
  JSON.stringify(providerBounds) === JSON.stringify({ x: 175, y: 300, width: 150, height: 200 }),
  `Unexpected Edge page bounds: ${JSON.stringify(providerBounds)}`,
);
const normalizedBounds = Object.fromEntries(
  Object.entries(providerBounds).map(([key, value]) => [key, Number((value / 1000).toFixed(6))]),
);
expect(
  JSON.stringify(normalizedBounds) === JSON.stringify({ x: 0.175, y: 0.3, width: 0.15, height: 0.2 }),
  `Unexpected worker normalized bounds: ${JSON.stringify(normalizedBounds)}`,
);
const exceptionBounds = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const edgeOnlyFact = { x: 0.4, y: 0.2, width: 0.001, height: 0.001 };
const overlapWidth = Math.max(0, Math.min(
  edgeOnlyFact.x + edgeOnlyFact.width,
  exceptionBounds.x + exceptionBounds.width,
) - Math.max(edgeOnlyFact.x, exceptionBounds.x));
expect(overlapWidth === 0, 'One-pixel edge-only proof fixture must have zero material overlap');

console.log('ECOS hosted evidence 1.3 rollout static/dry-run contract: PASS');
console.log(`Coordinate fixture: ${JSON.stringify({ tile, local, providerBounds, normalizedBounds })}`);
console.log('Live post-migration validation remains required for SQL permissions, transactions, and concurrency.');
