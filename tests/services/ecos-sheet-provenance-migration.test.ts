import fs from 'node:fs';
import path from 'node:path';

describe('ECOS sheet-provenance migration contract', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260809070356_ecos_sheet_provenance_round_trip.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('adds the same bounded provenance fields to legacy and hosted page rows', () => {
    expect(sql).toContain('alter table public.ecos_document_pages');
    expect(sql).toContain('alter table public.ecos_hosted_document_pages');
    for (const column of [
      'sheet_mapping_source text',
      "sheet_mapping_evidence jsonb not null default '[]'::jsonb",
      'document_structural_identity jsonb',
      "sheet_mapping_assurance jsonb not null default '{}'::jsonb",
    ]) {
      expect(sql.match(new RegExp(`add column if not exists ${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')))
        .toHaveLength(2);
    }
  });

  it('requires exact page binding, unique evidence, native coordinate binding, and Assurance acceptance', () => {
    expect(sql).toContain('evidence_page <> page_number');
    expect(sql).toContain('evidence_id = any(seen_ids)');
    expect(sql).toContain("mapping_source not in ('pdf_bookmark', 'native_title_band')");
    expect(sql).toContain('native_match_count <> 1');
    expect(sql).toContain("assurance_data->>'accepted' is distinct from 'true'");
    expect(sql).toContain("assurance_data#>>'{checks,sheetMappingUsable}' is distinct from 'true'");
    expect(sql).not.toContain('ecos-database-provenance-assurance/1.0');
  });

  it('binds live and shadow provenance to the exact project, document, source, page, job, and mode', () => {
    for (const clause of [
      'page.organization_id = job.organization_id',
      'page.project_id = job.project_id',
      'page.document_id = job.document_id',
      'page.source_sha256 = job.source_sha256',
      'page.page_number = new.page_number',
      "job.mode = 'live'",
      'job.id = new.job_id',
      "job.mode = 'shadow'",
    ]) {
      expect(sql).toContain(clause);
    }
  });

  it('fails closed against authenticated legacy clients that fabricate sheet proof or Assurance', () => {
    const legacyTrigger = sql.slice(
      sql.indexOf('create or replace function public.ecos_prepare_legacy_page_sheet_provenance()'),
      sql.indexOf('drop trigger if exists ecos_prepare_legacy_page_sheet_provenance_trigger'),
    );
    const replacementWrapper = sql.slice(
      sql.indexOf('create or replace function public.ecos_replace_document_index('),
      sql.indexOf('revoke all on function public.ecos_replace_document_index(text, text, text, jsonb)',
        sql.indexOf('create or replace function public.ecos_replace_document_index(')),
    );

    expect(legacyTrigger).toContain('new.sheet_number := null;');
    expect(legacyTrigger).toContain("new.sheet_mapping_evidence := '[]'::jsonb;");
    expect(legacyTrigger).toContain('new.document_structural_identity := null;');
    expect(legacyTrigger).toContain("new.sheet_mapping_assurance := '{}'::jsonb;");
    expect(legacyTrigger).toContain("new.assurance_result := '{}'::jsonb;");
    expect(legacyTrigger).toContain("new.visual_coverage := '{}'::jsonb;");
    expect(legacyTrigger).not.toContain('ecos_document_index_job_pages');
    expect(legacyTrigger).not.toContain('assurance_payload := new.assurance_result');

    expect(replacementWrapper).toContain(
      'from public.ecos_replace_document_index_without_sheet_provenance(',
    );
    expect(replacementWrapper).not.toContain("page.value->'sheetMappingEvidence'");
    expect(replacementWrapper).not.toContain("page.value->'documentStructuralIdentity'");
    expect(replacementWrapper).not.toContain("page.value->'assurance'");
  });

  it('removes authenticated visual-coverage attestations from direct legacy chunk writes', () => {
    const legacyChunkTrigger = sql.slice(
      sql.indexOf('create or replace function public.ecos_enrich_legacy_chunk_sheet_provenance()'),
      sql.indexOf('drop trigger if exists ecos_enrich_legacy_chunk_sheet_provenance_trigger'),
    );

    expect(legacyChunkTrigger).toContain("'visualCoverage'");
    expect(legacyChunkTrigger).not.toContain("'visualCoverage', page_record.visual_coverage");
  });

  it('reconstructs every verified hosted row from a trusted live checkpoint', () => {
    const hostedTrigger = sql.slice(
      sql.indexOf('create or replace function public.ecos_prepare_hosted_page_sheet_provenance()'),
      sql.indexOf('drop trigger if exists ecos_prepare_hosted_page_sheet_provenance_trigger'),
    );

    expect(hostedTrigger).toContain(
      "if coalesce(new.sheet_mapping_status, 'unverified') = 'verified' then",
    );
    expect(hostedTrigger).toContain('select page.final_page_data, page.assurance_result');
    expect(hostedTrigger).toContain("job.mode = 'live'");
    expect(hostedTrigger).toContain("page.state = 'assured'");
    expect(hostedTrigger).toContain('page.unresolved_region_count = 0');
    expect(hostedTrigger).toContain("page.assurance_result->>'accepted' = 'true'");
    expect(hostedTrigger).toContain('if not found then');
    expect(hostedTrigger).toContain("'sheetMappingStatus', 'unverified'");
    expect(hostedTrigger).toContain("assurance_payload := '{}'::jsonb;");
  });

  it('replaces poisoned chunk metadata with canonical page provenance at all three materialization boundaries', () => {
    expect(sql).toContain('ecos_enrich_legacy_chunk_sheet_provenance_trigger');
    expect(sql).toContain('ecos_enrich_hosted_chunk_sheet_provenance_trigger');
    expect(sql).toContain('ecos_enrich_shadow_chunk_sheet_provenance_trigger');
    expect(sql.match(/'sheetMappingStatus', 'sheetMappingSource', 'sheetMappingEvidence'/g))
      .toHaveLength(3);
    expect(sql.match(/'documentStructuralIdentity', 'sheetMappingAssurance', 'assurance'/g))
      .toHaveLength(3);
  });

  it('keeps the public RPC name while wrapping the proven replacement function', () => {
    expect(sql).toContain('rename to ecos_replace_document_index_without_sheet_provenance');
    expect(sql).toContain('create or replace function public.ecos_replace_document_index(');
    expect(sql).toContain('from public.ecos_replace_document_index_without_sheet_provenance(');
    expect(sql).toContain("if current_owner is null or not public.dave_is_app_owner() then");
    expect(sql).toContain('to authenticated;');
  });

  it('exposes only bounded exact-current hosted page context to authenticated Ask clients', () => {
    const rpc = sql.slice(
      sql.indexOf('create or replace function public.ecos_load_current_hosted_page_context('),
      sql.indexOf('-- Retain the proven replacement behavior'),
    );

    expect(rpc).toContain('security definer');
    expect(rpc).toContain('current_user uuid := auth.uid();');
    expect(rpc).toContain('not public.dave_is_app_owner()');
    expect(rpc).toContain('cardinality(coalesce(p_document_ids');
    expect(rpc).toContain('not between 1 and 24');
    expect(rpc).toContain('project_record.owner_id = current_user');
    expect(rpc).toContain('project_record.archived = false');
    expect(rpc).toContain("membership.status = 'active'");
    expect(rpc).toContain("source.document_data->>'isCurrent' = 'true'");
    expect(rpc).toContain("source.document_data->>'drawingStatus' is distinct from 'Superseded'");
    expect(rpc).toContain("job.committed_evidence_version = 'ecos-hosted-evidence/1.3'");
    expect(rpc).toContain('public.ecos_hosted_job_matches_reference(job.id, true)');
    expect(rpc).toContain('limit 200;');
    expect(rpc).toContain('revoke all on function public.ecos_load_current_hosted_page_context');
    expect(rpc).toContain('to authenticated, service_role;');
  });
});
