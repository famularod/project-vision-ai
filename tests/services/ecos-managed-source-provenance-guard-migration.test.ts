import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260812064107_ecos_managed_source_provenance_guard.sql',
);

describe('ECOS managed-source provenance guard migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const enqueueIdentityBody = sql.slice(
    sql.indexOf('create or replace function public.ecos_reference_document_enqueue_identity('),
    sql.indexOf('revoke all on function public.ecos_reference_document_enqueue_identity(jsonb)'),
  );
  const enqueueTriggerBody = sql.slice(
    sql.indexOf('create or replace function public.ecos_enqueue_hosted_index_from_reference_document()'),
    sql.indexOf('revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()'),
  );
  const managedSourceGuardBody = sql.slice(
    sql.indexOf('create or replace function public.ecos_guard_hosted_managed_source_authority()'),
    sql.indexOf('revoke all on function public.ecos_guard_hosted_managed_source_authority()'),
  );

  it('requires hosted processing to be held before changing source authority', () => {
    const heldConfigurationCheck = sql.indexOf(
      'ecos_hosted_configuration_must_be_disabled_for_source_provenance_guard',
    );
    const firstFunction = sql.indexOf(
      'create or replace function public.ecos_reference_document_enqueue_identity(',
    );

    expect(sql).toContain('begin;');
    expect(sql).toContain(
      'lock table public.ecos_hosted_index_configuration in share row exclusive mode;',
    );
    expect(sql).toContain('from public.ecos_hosted_index_configuration configuration');
    expect(sql).toContain('where configuration.enabled = true');
    expect(heldConfigurationCheck).toBeGreaterThan(0);
    expect(heldConfigurationCheck).toBeLessThan(firstFunction);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('compares only exact queue-driving reference identity, excluding derived evidence', () => {
    for (const key of [
      'isCurrent',
      'drawingStatus',
      'organizationId',
      'projectId',
      'sourceSha256',
      'sourceRevision',
      'sourcePageCount',
      'sourceProvider',
      'storagePath',
      'externalSource',
    ]) {
      expect(enqueueIdentityBody).toContain(`'${key}'`);
    }
    for (const derivedKey of [
      'extractedPages',
      'extractedText',
      'extractionStatus',
      'searchablePageCount',
      'documentIntelligenceVersion',
      'documentVisualIndexVersion',
      'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount',
      'ecosVerifiedIndexPageGraphSha256',
      'ecosHostedIndexStatus',
      'ecosHostedIndexProgressPercent',
      'ecosHostedIndexCustomerMessage',
    ]) {
      expect(enqueueIdentityBody).not.toContain(`'${derivedKey}'`);
    }
    expect(enqueueIdentityBody).toContain('immutable');
    expect(enqueueIdentityBody).toContain('jsonb_strip_nulls(jsonb_build_object(');
    expect(enqueueIdentityBody).toContain(
      "'sourcePageCount', coalesce(p_document_data, '{}'::jsonb)->'sourcePageCount'",
    );
    expect(enqueueIdentityBody).not.toMatch(/sourcePageCount[\s\S]{0,160}::(?:big)?int/i);
    expect(enqueueTriggerBody).toContain(
      'public.ecos_reference_document_enqueue_identity(old.document_data)',
    );
    expect(enqueueTriggerBody).toContain(
      'public.ecos_reference_document_enqueue_identity(new.document_data)',
    );
    expect(enqueueTriggerBody).toMatch(
      /enqueue_identity\(old\.document_data\)\s*=\s*public\.ecos_reference_document_enqueue_identity\(new\.document_data\)\s+then\s+return new;/,
    );
    expect(enqueueTriggerBody.indexOf('return new;')).toBeLessThan(
      enqueueTriggerBody.lastIndexOf('perform public.ecos_enqueue_hosted_reference('),
    );
  });

  it('preserves the old provider and locator as one pair on downgrade or incomplete GCS replacement', () => {
    expect(managedSourceGuardBody).toContain("old.source_provider = 'managed_upload'");
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(old.source_locator->>'gcsBucket'), '') is not null",
    );
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(old.source_locator->>'gcsObject'), '') is not null",
    );
    expect(managedSourceGuardBody).toMatch(
      /new\.source_provider\s+is\s+distinct\s+from\s+'managed_upload'/,
    );
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(new.source_locator->>'gcsBucket'), '') is null",
    );
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(new.source_locator->>'gcsObject'), '') is null",
    );
    expect(managedSourceGuardBody).toContain('new.source_provider := old.source_provider;');
    expect(managedSourceGuardBody).toContain('new.source_locator := old.source_locator;');
  });

  it('allows a complete managed-to-managed locator replacement', () => {
    expect(managedSourceGuardBody).not.toContain(
      'new.source_locator is distinct from old.source_locator',
    );
    expect(managedSourceGuardBody).not.toContain(
      'new.source_provider is distinct from old.source_provider',
    );
    expect(managedSourceGuardBody).toMatch(
      /new\.source_provider\s+is\s+distinct\s+from\s+'managed_upload'/,
    );
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(new.source_locator->>'gcsBucket'), '') is null",
    );
    expect(managedSourceGuardBody).toContain(
      "nullif(btrim(new.source_locator->>'gcsObject'), '') is null",
    );
    expect(managedSourceGuardBody).toContain(
      "old.state in ('queued', 'reconnect_source')",
    );
    expect(managedSourceGuardBody).toContain('not clean_mutable_managed_job');
    for (const exactArtifactTable of [
      'ecos_hosted_index_pages',
      'ecos_hosted_shadow_chunks',
      'ecos_hosted_shadow_materialization_queue',
      'ecos_hosted_visual_exceptions',
      'ecos_hosted_index_usage',
      'ecos_drawing_analysis_requests',
    ]) {
      expect(managedSourceGuardBody).toContain(`public.${exactArtifactTable}`);
    }
  });

  it('allows a nonmanaged source to advance to a complete managed source', () => {
    const preservationIf = managedSourceGuardBody.slice(
      managedSourceGuardBody.indexOf('if old.source_provider'),
      managedSourceGuardBody.indexOf('new.source_provider := old.source_provider;'),
    );
    expect(preservationIf).toContain("old.source_provider = 'managed_upload'");
    expect(preservationIf).not.toMatch(
      /old\.source_provider\s+(?:is\s+distinct\s+from|<>|!=)\s+'managed_upload'/,
    );
  });

  it('preserves source authority only for the exact same hosted job identity', () => {
    for (const identityColumn of [
      'organization_id',
      'project_id',
      'document_id',
      'source_owner_id',
      'source_sha256',
      'source_revision',
      'mode',
    ]) {
      expect(managedSourceGuardBody).toContain(
        `old.${identityColumn} is not distinct from new.${identityColumn}`,
      );
    }
  });

  it('locks helper ACLs and leaves the before-update authority trigger enabled', () => {
    expect(sql).toContain(
      'revoke all on function public.ecos_reference_document_enqueue_identity(jsonb)',
    );
    expect(sql).toContain('from public, anon, authenticated;');
    expect(sql).toContain(
      'grant execute on function public.ecos_reference_document_enqueue_identity(jsonb)',
    );
    expect(sql).toContain('to service_role;');
    expect(sql).toContain(
      'revoke all on function public.ecos_enqueue_hosted_index_from_reference_document()',
    );
    expect(sql).toContain(
      'revoke all on function public.ecos_guard_hosted_managed_source_authority()',
    );
    expect(sql).toContain('from public, anon, authenticated, service_role;');
    expect(sql).toContain('create trigger ecos_hosted_managed_source_authority_guard');
    expect(sql).toContain('before update of source_provider, source_locator');
    expect(sql).toContain('on public.ecos_hosted_index_jobs');
    expect(sql).toContain(
      'for each row execute function public.ecos_guard_hosted_managed_source_authority();',
    );
    expect(sql).toContain("trigger_enabled is distinct from 'O'");
    expect(sql).toContain('ecos_hosted_managed_source_authority_guard_not_enabled');
  });
});
