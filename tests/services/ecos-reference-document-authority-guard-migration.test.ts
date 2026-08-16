import fs from 'node:fs';
import path from 'node:path';

describe('reference-document hosted authority database guard', () => {
  const migration = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260809222329_ecos_reference_document_authority_keys_guard.sql',
  ), 'utf8');

  const guardBody = migration.slice(
    migration.indexOf('create or replace function public.ecos_guard_reference_document_authority_keys()'),
    migration.indexOf('revoke all on function public.ecos_guard_reference_document_authority_keys()'),
  );
  const exactJobBody = migration.slice(
    migration.indexOf('create or replace function public.ecos_hosted_job_matches_reference('),
    migration.indexOf('revoke all on function public.ecos_hosted_job_matches_reference(uuid, boolean)'),
  );

  it('separates authenticated, service JWT, exact hosted hydration, and migration-purge authority', () => {
    expect(migration).toContain("current_setting('request.jwt.claim.role', true)");
    expect(migration).toContain("auth.jwt()->>'role'");
    expect(migration).not.toContain('auth.role()');
    expect(guardBody).toContain("public.ecos_request_jwt_role() = 'service_role'");
    expect(guardBody).toContain("current_setting('app.ecos_hosted_commit_hydration', true)");
    expect(guardBody).toContain("'hosted-evidence-1.3'");
    expect(guardBody).not.toContain('pg_trigger_depth()');
    expect(guardBody).toContain("current_setting('app.ecos_authority_purge', true) = 'allowed'");
    expect(migration).toContain("set_config('app.ecos_authority_purge', 'allowed', true)");
    expect(migration).toContain('drop trigger if exists ecos_mark_verified_index_commit_trigger');
    expect(migration).toContain('drop function if exists public.ecos_mark_verified_index_commit()');
  });

  it('always strips hosted status and prevents direct commit self-attestation', () => {
    for (const key of [
      'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount',
      'ecosHostedIndexStatus',
      'ecosHostedIndexProgressPercent',
      'ecosHostedIndexCustomerMessage',
      'ecosHostedIndexLimitationCount',
      'ecosHostedIndexSupportReference',
      'ecosHostedIndexEvidenceVersion',
      'ecosHostedIndexUpdatedAt',
    ]) expect(migration).toContain(`'${key}'`);
    expect(guardBody.indexOf('new.document_data := coalesce(new.document_data')).toBeLessThan(
      guardBody.indexOf("public.ecos_request_jwt_role() = 'service_role'"),
    );
    expect(guardBody).toContain('new.document_data := new.document_data - commit_keys;');
    expect(guardBody).toContain("if tg_op = 'UPDATE' and identity_unchanged then");
    expect(guardBody).toContain("old.document_data->'ecosVerifiedIndexCommittedSha256'");
  });

  it('clears commit authority on every protected identity change but preserves ordinary metadata edits', () => {
    for (const key of [
      'name',
      'originalFileName',
      'category',
      'projectId',
      'organizationId',
      'contentSha256',
      'webFileFingerprint',
      'indexedContentSha256',
      'drawingRevision',
      'drawingNumber',
      'drawingDiscipline',
      'drawingIssuedAt',
      'webVersionGroupId',
      'sourcePageCount',
      'isCurrent',
      'drawingStatus',
      'sourceProvider',
      'storagePath',
      'externalSource',
    ]) expect(migration).toContain(`'${key}', coalesce(p_document_data`);
    expect(guardBody).toContain('old.owner_id is not distinct from new.owner_id');
    expect(guardBody).toContain('old.id is not distinct from new.id');
    expect(guardBody).toContain('old.name is not distinct from new.name');
    expect(guardBody).toContain('old.category is not distinct from new.category');
    expect(guardBody).not.toContain("- 'name'");
    expect(guardBody).not.toContain("- 'notes'");
  });

  it('replaces the hosted authority gate with exact durable project identity only', () => {
    expect(exactJobBody).toContain("source.document_data->>'projectId' = job.project_id");
    expect(exactJobBody).toContain('exact_project.id::text = job.project_id');
    expect(exactJobBody).toContain('exact_project.owner_id = source.owner_id');
    expect(exactJobBody).not.toContain("source.document_data->>'projectName'");
    expect(exactJobBody).not.toContain("source.document_data->'projectNames'");
  });

  it('writes a fresh compact receipt only from a complete exact hosted v1.3 commit', () => {
    expect(migration).toContain('create or replace function public.ecos_mark_hosted_verified_index_commit()');
    expect(migration).toContain("new.committed_evidence_version <> 'ecos-hosted-evidence/1.3'");
    expect(migration).toContain('not public.ecos_hosted_job_matches_reference(new.id, false)');
    expect(migration).toContain('published_page_count <> new.source_page_count');
    expect(migration).toContain('published_min_page <> 1');
    expect(migration).toContain('published_max_page <> new.source_page_count');
    expect(migration).toContain("set_config(\n    'app.ecos_hosted_commit_hydration'");
    expect(migration).toContain("'indexedContentSha256', new.source_sha256");
    expect(migration).toContain("'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0'");
    expect(migration).toContain('create trigger ecos_mark_hosted_verified_index_commit_insert_trigger');
    expect(migration).toContain('create trigger ecos_mark_hosted_verified_index_commit_update_trigger');
  });

  it('requires a held rollout, uniquely backfills collapsed names, and enables trusted current repair', () => {
    expect(migration).toContain('ecos_hosted_configuration_must_be_disabled_for_project_identity_backfill');
    expect(migration).toContain('create temporary table ecos_reference_project_backfill_candidates');
    expect(migration).toMatch(
      /regexp_replace\(\s*lower\(btrim\(project_record\.name\)\),\s*'\[\[:space:\]\]\+',\s*' ',\s*'g'\s*\)/,
    );
    expect(migration).toContain('jsonb_array_elements_text(');
    expect(migration).toContain('having count(distinct project_name.canonical_name) = 1');
    expect(migration).not.toContain("source.document_data->'projectNames'->>0");
    expect(migration).toContain('having count(*) = 1');
    expect(migration).toContain("jsonb_build_object('projectId', candidate.project_id)");
    expect(migration).toContain("set_config('app.ecos_current_activation', 'allowed', true)");
    expect(migration).toContain('disable trigger ecos_reference_document_hosted_enqueue');
    expect(migration).toContain('enable trigger ecos_reference_document_hosted_enqueue');
    expect(migration).toContain("trigger_record.tgenabled = 'O'");
  });

  it('makes atomic current activation use raw exact project IDs, never display names', () => {
    const shareProjectBody = migration.slice(
      migration.indexOf('create or replace function public.ecos_reference_documents_share_project('),
      migration.indexOf('revoke all on function public.ecos_reference_documents_share_project'),
    );
    expect(shareProjectBody).toContain("p_left->>'projectId' = p_right->>'projectId'");
    expect(shareProjectBody).toContain("p_left->>'projectId' = btrim(p_left->>'projectId')");
    expect(shareProjectBody).not.toContain('projectName');
    expect(shareProjectBody).not.toContain('projectNames');
  });

  it('puts the legacy queue behind one exact-project-only wrapper with no callable name fallback', () => {
    expect(migration).toContain('rename to ecos_enqueue_hosted_reference_unchecked');
    expect(migration).toContain('revoke all on function public.ecos_enqueue_hosted_reference_unchecked');
    expect(migration).toContain("select source.document_data->>'projectId'");
    expect(migration).toContain('exact_project.id::text = exact_project_id');
    expect(migration).toContain('create or replace function public.ecos_enqueue_hosted_index(p_document_id text)');
    const exactWrapper = migration.slice(
      migration.indexOf('create or replace function public.ecos_enqueue_hosted_reference('),
      migration.indexOf('revoke all on function public.ecos_enqueue_hosted_reference(text, uuid, uuid)'),
    );
    expect(exactWrapper).not.toContain("source.document_data->>'projectName'");
    expect(exactWrapper).not.toContain("source.document_data->'projectNames'");
  });

  it('purges unbound and mismatched public evidence before cascading every old job graph', () => {
    const chunkDelete = migration.indexOf('delete from public.ecos_hosted_document_chunks chunk');
    const pageDelete = migration.indexOf('delete from public.ecos_hosted_document_pages page');
    const jobDelete = migration.indexOf('delete from public.ecos_hosted_index_jobs job');
    expect(chunkDelete).toBeGreaterThan(0);
    expect(pageDelete).toBeGreaterThan(chunkDelete);
    expect(jobDelete).toBeGreaterThan(pageDelete);
    expect(migration).toContain('create temporary table ecos_reference_authority_purge_documents');
    expect(migration).toContain('from ecos_reference_authority_purge_documents purged');
    expect(migration).toContain("job.project_id is distinct from source.document_data->>'projectId'");
    expect(migration).toContain('ecos_noncanonical_hosted_job_survived_project_identity_backfill');
  });

  it('locks helper ACLs and keeps every authority trigger enabled', () => {
    for (const fn of [
      'ecos_reference_document_commit_identity(jsonb)',
      'ecos_request_jwt_role()',
      'ecos_guard_reference_document_authority_keys()',
      'ecos_hosted_job_matches_reference(uuid, boolean)',
      'ecos_mark_hosted_verified_index_commit()',
    ]) expect(migration).toContain(`revoke all on function public.${fn}`);
    expect(migration).toContain('create trigger ecos_reference_document_authority_keys_guard');
    expect(migration).toContain('before insert or update of document_data, id, name, category, owner_id');
  });
});
