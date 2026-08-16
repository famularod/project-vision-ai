import fs from 'node:fs';
import path from 'node:path';

describe('Ask ECOS immutable project evidence scope', () => {
  const edge = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/functions/ecos-ask-project/index.ts',
  ), 'utf8');
  const migration = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260809193726_ecos_project_evidence_exact_project_binding.sql',
  ), 'utf8');

  it('filters tasks, updates, notes, and documents by exact project id', () => {
    const gather = edge.slice(
      edge.indexOf('async function gatherEvidence('),
      edge.indexOf('async function searchDocumentEvidence('),
    );
    expect(gather).toContain("select('id,project_id,project_name,task_name,item_data,updated_at')");
    expect(gather).toContain("select('id,project_id,project_name,update_data,created_at')");
    expect(gather.match(/matchesExactProjectId\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(gather).not.toContain('matchesProjectName(');

    const matcher = edge.slice(
      edge.indexOf('function documentMatchesProject('),
      edge.indexOf('function matchesExactProjectId('),
    );
    expect(matcher).toContain('const expected = canonicalProjectId(projectId);');
    expect(matcher).toContain('canonicalProjectId(data.projectId) === expected');
    expect(matcher).not.toContain('data.projectName');
    expect(matcher).not.toContain('data.projectNames');

    const exactMatcher = edge.slice(
      edge.indexOf('export function matchesExactProjectId('),
      edge.indexOf('function summarizeRecord('),
    );
    expect(exactMatcher).toContain('canonicalProjectId(value) === expected');
    expect(exactMatcher).not.toContain('normalize(text(value))');
    expect(exactMatcher).toContain("value !== value.trim()");
  });

  it('binds live document citations to the current indexed source, commit, and page proof version', () => {
    const gather = edge.slice(
      edge.indexOf('async function gatherEvidence('),
      edge.indexOf('async function searchDocumentEvidence('),
    );
    expect(gather).toContain('normalizeSha256(data.indexedContentSha256) !== sourceSha256');
    expect(gather).toContain("data.ecosVerifiedIndexCommitVersion !== 'ecos-verified-index-commit/1.0'");
    expect(gather).toContain('normalizeSha256(data.ecosVerifiedIndexCommittedSha256) !== sourceSha256');

    const search = edge.slice(
      edge.indexOf('async function searchDocumentEvidence('),
      edge.indexOf('async function loadPageIdentityContexts('),
    );
    expect(search).toContain('pageAssurance.accepted === true');
    expect(search).toContain('normalizeSha256(visualCoverage.sourceSha256) === document.sourceSha256');
    expect(search).toContain('if (!evidenceVersion) return [];');
    expect(search).toContain('evidenceVersion,');
  });

  it('rejects current drawing evidence without a bounded exact revision before search', () => {
    const gather = edge.slice(
      edge.indexOf('export async function gatherEvidence('),
      edge.indexOf('export async function searchDocumentEvidence('),
    );
    expect(gather).toContain('const revision = drawingCategory');
    expect(gather).toContain('? exactDrawingRevision(data.drawingRevision)');
    expect(gather).toContain('if (drawingCategory && !revision) return [];');
    expect(gather.indexOf('if (drawingCategory && !revision) return [];'))
      .toBeLessThan(gather.indexOf('const documentSources = await searchDocumentEvidence('));
  });

  it('backfills immutable project ids only from canonical payload authority', () => {
    const backfills = migration.slice(
      migration.indexOf('-- Backfill only from an immutable id'),
      migration.indexOf('create or replace function public.ecos_bind_operational_row_project_id()'),
    );
    expect(migration).toMatch(/alter table public\.schedule_items\s+add column if not exists project_id text/);
    expect(migration).toMatch(/alter table public\.project_updates\s+add column if not exists project_id text/);
    expect(backfills).toContain("set project_id = operational_row.item_data->>'projectId'");
    expect(backfills).toContain("set project_id = operational_row.update_data->>'projectId'");
    expect(backfills).toContain("jsonb_typeof(operational_row.item_data->'projectId') = 'string'");
    expect(backfills).toContain("jsonb_typeof(operational_row.update_data->'projectId') = 'string'");
    expect(backfills.match(/project_record\.id::text = operational_row\.(?:item_data|update_data)->>'projectId'/g))
      .toHaveLength(2);
    expect(backfills.match(/project_record\.owner_id = operational_row\.owner_id/g)).toHaveLength(2);
    expect(backfills.match(/coalesce\(project_record\.archived, false\) = false/g)).toHaveLength(2);
  });

  it('keeps name-only rows quarantined even when a same-name sibling is archived', () => {
    const backfills = migration.slice(
      migration.indexOf('-- Backfill only from an immutable id'),
      migration.indexOf('create or replace function public.ecos_bind_operational_row_project_id()'),
    );
    const trigger = migration.slice(
      migration.indexOf('create or replace function public.ecos_bind_operational_row_project_id()'),
      migration.indexOf('revoke all on function public.ecos_bind_operational_row_project_id()'),
    );

    expect(backfills).not.toContain('unique_projects');
    expect(backfills).not.toContain('project_record.name');
    expect(backfills).not.toContain('project_name');
    expect(backfills).not.toContain('scheduleProjectName');
    expect(backfills).not.toContain("payload->>'projectName'");
    expect(trigger).not.toContain('project_record.name');
    expect(trigger).not.toContain('legacy_project_name');
    expect(trigger).not.toContain('matching_project_ids');
    expect(trigger).not.toContain('ecos_operational_project_id_ambiguous');
    expect(trigger).toContain("raise exception 'ecos_operational_project_id_required'");
  });

  it('replaces both live and shadow hosted page-context branches with exact project-id binding', () => {
    const rpc = migration.slice(
      migration.indexOf('create or replace function public.ecos_load_current_hosted_page_context('),
      migration.indexOf('revoke all on function public.ecos_load_current_hosted_page_context('),
    );
    expect(rpc).toContain('live_candidates as (');
    expect(rpc).toContain('shadow_candidates as (');
    expect(rpc.match(/and job\.project_id = requested_project_id/g)).toHaveLength(2);
    expect(rpc).toContain("requested_project_id <> btrim(requested_project_id)");
    expect(rpc).toContain("requested.document_id <> btrim(requested.document_id)");
    expect(rpc).toContain('select distinct requested.document_id');
    expect(rpc).not.toContain('btrim(job.project_id)');
    expect(rpc).not.toContain('authorized_project_name');
    expect(rpc).not.toContain('lower(trim(job.project_id)) in');
    expect(rpc).not.toContain('lower(requested_project_id)');
  });

  it('rejects padded operational and page-context identities rather than aliasing them', () => {
    const trigger = migration.slice(
      migration.indexOf('create or replace function public.ecos_bind_operational_row_project_id()'),
      migration.indexOf('revoke all on function public.ecos_bind_operational_row_project_id()'),
    );
    expect(trigger).toContain('top_level_project_id <> btrim(top_level_project_id)');
    expect(trigger).toContain('payload_project_id <> btrim(payload_project_id)');
    expect(trigger).toContain("jsonb_typeof(payload_project_id_value) is distinct from 'string'");
    expect(trigger).toContain('top_level_project_id is distinct from payload_project_id');
    expect(trigger).toContain("raise exception 'ecos_operational_project_id_mismatch'");
    expect(trigger).toContain("raise exception 'ecos_operational_project_id_invalid'");
    expect(trigger).not.toContain('jsonb_set(payload');
    expect(trigger).not.toContain('jsonb_populate_record(new');
  });

  it('accepts only an exact equal id pair for an active project owned by the row owner', () => {
    const trigger = migration.slice(
      migration.indexOf('create or replace function public.ecos_bind_operational_row_project_id()'),
      migration.indexOf('revoke all on function public.ecos_bind_operational_row_project_id()'),
    );
    expect(trigger).toContain('top_level_project_id is null');
    expect(trigger).toContain('payload_project_id_value is null');
    expect(trigger.match(/\^\[0-9a-f\]\{8\}/g)).toHaveLength(2);
    expect(trigger).toContain('where project_record.id::text = top_level_project_id');
    expect(trigger).toContain('and project_record.owner_id = new.owner_id');
    expect(trigger).toContain('and coalesce(project_record.archived, false) = false');
    expect(trigger).toContain('return new;');
  });
});
