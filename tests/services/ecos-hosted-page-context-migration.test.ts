import fs from 'node:fs';
import path from 'node:path';

describe('ECOS current hosted page-context migration', () => {
  const migration = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260809193726_ecos_project_evidence_exact_project_binding.sql',
  ), 'utf8');
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.ecos_load_current_hosted_page_context('),
    migration.indexOf('revoke all on function public.ecos_load_current_hosted_page_context('),
  );
  const live = rpc.slice(
    rpc.indexOf('live_job_candidates as ('),
    rpc.indexOf('shadow_job_candidates as ('),
  );
  const shadow = rpc.slice(
    rpc.indexOf('shadow_job_candidates as ('),
    rpc.indexOf('ranked as ('),
  );

  it('returns live visual coverage only from the exact assured worker checkpoint', () => {
    expect(live).toContain('checkpoint.job_id = job.job_id');
    expect(live).toContain('checkpoint.organization_id = job.organization_id');
    expect(live).toContain('checkpoint.project_id = job.project_id');
    expect(live).toContain('checkpoint.document_id = page.document_id');
    expect(live).toContain('checkpoint.source_sha256 = job.source_sha256');
    expect(live).toContain('checkpoint.page_number = page.page_number');
    expect(live).toContain("checkpoint.state = 'assured'");
    expect(live).toContain('checkpoint.unresolved_region_count = 0');
    expect(live).toContain("checkpoint.assurance_result->>'accepted' = 'true'");
    expect(live).toContain("checkpoint.final_page_data->'visualCoverage' as visual_coverage");
    expect(live).toContain("checkpoint.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256");
    expect(live).toContain("checkpoint.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version");
    expect(live).toContain("checkpoint.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text");
    expect(live).not.toContain("'{}'::jsonb as visual_coverage");
    expect(live).not.toContain('page.visual_coverage');
  });

  it('binds current authority before page selection and rejects ambiguous live-job rebinding', () => {
    expect(live).toContain('public.ecos_hosted_job_matches_reference(job.id, true)');
    expect(live).toContain("job.mode = 'live'");
    expect(live).toContain("job.state = 'ready'");
    expect(live).toContain("job.committed_evidence_version = 'ecos-hosted-evidence/1.3'");
    expect(live).toContain('job.project_id = requested_project_id');
    expect(live).toContain("membership.status = 'active'");
    expect(live).toContain('count(*) over (partition by candidate.document_id) as exact_job_count');
    expect(live).toContain('where candidate.exact_job_count = 1');
  });

  it('also rejects ambiguous exact shadow jobs instead of ranking one by planner order', () => {
    expect(shadow).toContain('public.ecos_hosted_job_matches_reference(job.id, true)');
    expect(shadow).toContain("job.mode = 'shadow'");
    expect(shadow).toContain("configuration.publication_mode = 'live'");
    expect(shadow).toContain('eligible_shadow_jobs as (');
    expect(shadow).toContain('count(*) over (partition by candidate.document_id) as exact_job_count');
    expect(shadow).toContain('where candidate.exact_job_count = 1');
    expect(shadow).toContain('page.job_id = job.job_id');
  });

  it('rejects stale shadow page assurance and mismatched visual-coverage receipts', () => {
    expect(shadow).toContain(
      "page.assurance_result->>'evidenceVersion' = job.committed_evidence_version",
    );
    expect(shadow).toContain("page.final_page_data->>'sourceSha256' = job.source_sha256");
    expect(shadow).toContain("page.final_page_data->'visualCoverage' as visual_coverage");
    expect(shadow).toContain("jsonb_typeof(page.final_page_data->'visualCoverage') = 'object'");
    expect(shadow).toContain(
      "page.final_page_data#>>'{visualCoverage,sourceSha256}' = job.source_sha256",
    );
    expect(shadow).toContain(
      "page.final_page_data#>>'{visualCoverage,evidenceVersion}' = job.committed_evidence_version",
    );
    expect(shadow).toContain(
      "page.final_page_data#>>'{visualCoverage,pageNumber}' = page.page_number::text",
    );
    expect(shadow).not.toContain("then page.final_page_data->'visualCoverage' else '{}'::jsonb end");
  });
});
