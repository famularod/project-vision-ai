import fs from 'node:fs';
import path from 'node:path';

describe('ECOS hosted customer-safe limitation status migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260809130657_ecos_hosted_status_limitations_v2.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('adds an authenticated security-definer v2 status boundary without changing v1', () => {
    expect(sql).toContain('create or replace function public.ecos_hosted_index_status_v2(');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain("public.vitruvius_has_project_permission(");
    expect(sql).toContain("job.project_id,\n        'view_project'");
    expect(sql).not.toContain('public.pie_layer4_has_active_membership(job.organization_id)');
    expect(sql).toContain('public.ecos_hosted_job_matches_reference(job.id, false)');
    expect(sql).toContain(
      'revoke all on function public.ecos_hosted_index_status_v2(text[])',
    );
    expect(sql).toContain('from public, anon;');
    expect(sql).toContain('to authenticated;');
    expect(sql).not.toContain('create or replace function public.ecos_hosted_index_status(');
  });

  it('counts only accepted exact-job pages with nonempty limitation arrays', () => {
    for (const exactBinding of [
      'page.job_id = job.id',
      'page.organization_id = job.organization_id',
      'page.project_id = job.project_id',
      'page.document_id = job.document_id',
      'page.source_sha256 = job.source_sha256',
    ]) {
      expect(sql).toContain(exactBinding);
    }
    expect(sql).toContain("page.state = 'assured'");
    expect(sql).toContain("page.assurance_result->>'accepted' = 'true'");
    expect(sql).toContain(
      "jsonb_typeof(page.assurance_result->'limitationCodes') = 'array'",
    );
    expect(sql).toContain('from jsonb_array_elements(');
    expect(sql).toContain("else '[]'::jsonb");
    expect(sql).toContain("jsonb_typeof(limitation.code) = 'string'");
    expect(sql).toContain("btrim(limitation.code #>> '{}') <> ''");
    expect(sql).toContain('count(page.page_number) filter (');
  });

  it('distinguishes plain and limited ready states without blocking activation or answers', () => {
    const needsReview = sql.indexOf("then 'Needs Review'");
    const readyLimited = sql.indexOf("then 'Ready with limitations'");
    const preparedLimited = sql.indexOf("then 'Prepared with limitations'");
    const ready = sql.indexOf("then 'Ready for ECOS'");
    const prepared = sql.indexOf("when job.state = 'ready' then 'Prepared'");

    expect(needsReview).toBeGreaterThan(0);
    expect(needsReview).toBeLessThan(readyLimited);
    expect(readyLimited).toBeLessThan(preparedLimited);
    expect(preparedLimited).toBeLessThan(ready);
    expect(ready).toBeLessThan(prepared);
    expect(sql.match(/job\.limitation_count > 0/g)).toHaveLength(4);
    expect(sql).toContain("job.committed_evidence_version = 'ecos-hosted-evidence/1.3'");
  });

  it('returns only a customer-safe count and message, never raw diagnostic fields', () => {
    const returnShape = sql.slice(
      sql.indexOf('returns table('),
      sql.indexOf('language sql'),
    ).toLowerCase();
    expect(returnShape).toContain('limitation_count integer');
    expect(returnShape).not.toContain('limitationcodes');
    expect(returnShape).not.toContain('assurance_result');
    expect(returnShape).not.toContain('provider');
    expect(returnShape).not.toContain('diagnostic');
    expect(sql).toContain(
      "' passed ECOS Assurance with review limitations.",
    );
  });
});

type PageFixture = Readonly<{
  jobId: string;
  organizationId: string;
  projectId: string;
  documentId: string;
  sourceSha256: string;
  state: string;
  accepted: boolean;
  limitationCodes: unknown;
}>;

const EXACT_JOB = Object.freeze({
  id: 'job-current-source',
  organizationId: 'organization-1',
  projectId: 'project-2375',
  documentId: 'drawing-c6',
  sourceSha256: 'a'.repeat(64),
});

function acceptedExactPageLimitationCount(pages: readonly PageFixture[]) {
  return pages.filter(page =>
    page.jobId === EXACT_JOB.id &&
    page.organizationId === EXACT_JOB.organizationId &&
    page.projectId === EXACT_JOB.projectId &&
    page.documentId === EXACT_JOB.documentId &&
    page.sourceSha256 === EXACT_JOB.sourceSha256 &&
    page.state === 'assured' &&
    page.accepted === true &&
    Array.isArray(page.limitationCodes) &&
    page.limitationCodes.some(
      code => typeof code === 'string' && code.trim().length > 0,
    ),
  ).length;
}

function readyStatus({
  current,
  live,
  evidenceVersion = 'ecos-hosted-evidence/1.3',
  limitationCount,
}: Readonly<{
  current: boolean;
  live: boolean;
  evidenceVersion?: string;
  limitationCount: number;
}>) {
  if (evidenceVersion !== 'ecos-hosted-evidence/1.3') return 'Needs Review';
  if (limitationCount > 0 && current && live) return 'Ready with limitations';
  if (limitationCount > 0) return 'Prepared with limitations';
  if (current && live) return 'Ready for ECOS';
  return 'Prepared';
}

describe('ECOS hosted limitation status adversarial semantics', () => {
  const acceptedLimitedPage: PageFixture = {
    jobId: EXACT_JOB.id,
    organizationId: EXACT_JOB.organizationId,
    projectId: EXACT_JOB.projectId,
    documentId: EXACT_JOB.documentId,
    sourceSha256: EXACT_JOB.sourceSha256,
    state: 'assured',
    accepted: true,
    limitationCodes: ['structured_table_analysis_incomplete'],
  };

  it('counts an accepted limited page once even when it has multiple internal codes', () => {
    expect(acceptedExactPageLimitationCount([{
      ...acceptedLimitedPage,
      limitationCodes: [
        'structured_table_analysis_incomplete',
        'structured_table_analysis_conflicted',
      ],
    }])).toBe(1);
  });

  it.each([
    ['stale job', { jobId: 'job-stale' }],
    ['cross-organization page', { organizationId: 'organization-other' }],
    ['cross-project page', { projectId: 'project-2321' }],
    ['cross-document page', { documentId: 'drawing-a1' }],
    ['stale source page', { sourceSha256: 'b'.repeat(64) }],
    ['non-assured page', { state: 'rejected' }],
    ['non-accepted page', { accepted: false }],
    ['page without limitations', { limitationCodes: [] }],
    ['page with malformed limitations', { limitationCodes: 'internal-code' }],
    ['page with null-only limitations', { limitationCodes: [null] }],
    ['page with number-only limitations', { limitationCodes: [1] }],
    ['page with object-only limitations', { limitationCodes: [{}] }],
    ['page with blank-only limitations', { limitationCodes: ['', '   '] }],
  ])('excludes %s from the customer limitation count', (_label, override) => {
    expect(acceptedExactPageLimitationCount([{
      ...acceptedLimitedPage,
      ...override,
    }])).toBe(0);
  });

  it('shows limited accepted evidence as activatable before current and usable after current', () => {
    expect(readyStatus({ current: false, live: false, limitationCount: 1 }))
      .toBe('Prepared with limitations');
    expect(readyStatus({ current: true, live: true, limitationCount: 1 }))
      .toBe('Ready with limitations');
    expect(readyStatus({ current: false, live: false, limitationCount: 0 }))
      .toBe('Prepared');
    expect(readyStatus({ current: true, live: true, limitationCount: 0 }))
      .toBe('Ready for ECOS');
  });

  it('fails an outdated evidence version closed even when limitations exist', () => {
    expect(readyStatus({
      current: true,
      live: true,
      evidenceVersion: 'ecos-hosted-evidence/1.2',
      limitationCount: 1,
    })).toBe('Needs Review');
  });

  it('does not expose project status to organization members without project permission', () => {
    const canSeeStatus = ({
      activeOrganizationMember,
      hasProjectPermission,
    }: Readonly<{
      activeOrganizationMember: boolean;
      hasProjectPermission: boolean;
    }>) => activeOrganizationMember && hasProjectPermission;

    expect(canSeeStatus({
      activeOrganizationMember: true,
      hasProjectPermission: false,
    })).toBe(false);
    expect(canSeeStatus({
      activeOrganizationMember: true,
      hasProjectPermission: true,
    })).toBe(true);
  });
});
