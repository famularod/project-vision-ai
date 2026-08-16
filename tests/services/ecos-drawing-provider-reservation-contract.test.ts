import fs from 'node:fs';
import path from 'node:path';

describe('drawing provider attempt reservations', () => {
  const edge = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/functions/ecos-analyze-drawing-page/index.ts',
  ), 'utf8');
  const shared = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/functions/_shared/ecos-drawing-provider-reservation.ts',
  ), 'utf8');
  const migration = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260809201435_ecos_drawing_provider_attempt_reservations.sql',
  ), 'utf8');
  const operationFixture = JSON.parse(fs.readFileSync(path.join(
    process.cwd(),
    'workers/ecos-indexer/tests/visual_provider_operation_id_v1.json',
  ), 'utf8')) as Readonly<{
    requestIdentity: Readonly<{
      organizationId: string;
      projectId: string;
      documentId: string;
      providerOperationId: string;
    }>;
  }>;

  it('atomically begins an exact hosted claim/project/document/source/page request', () => {
    expect(operationFixture.requestIdentity).toMatchObject({
      organizationId: 'pie-rls-validation-org-a',
      projectId: '2321 Compliance Project',
      documentId: 'web-document-09314ce4-aff1-4857-9cc9-5f13ecae4603',
    });
    expect(migration).toContain('create table if not exists public.ecos_drawing_analysis_requests');
    expect(migration).toContain('organization_id text not null');
    expect(migration).toContain('project_id text not null');
    expect(migration).toContain('document_id text not null');
    expect(migration).toContain("source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$')");
    expect(migration).toContain('page_number integer not null');
    expect(migration).toContain('create or replace function public.ecos_begin_drawing_analysis');
    expect(migration).toMatch(/ecos_begin_drawing_analysis\(\s*p_organization_id text,\s*p_project_id text,\s*p_document_id text,/);
    expect(migration).toContain('ecos_drawing_analysis_exact_text_identity_required');
    expect(migration).toContain('octet_length(p_organization_id) not between 1 and 500');
    expect(migration).toContain('octet_length(p_project_id) not between 1 and 500');
    expect(migration).toContain('octet_length(p_document_id) not between 1 and 200');
    expect(migration).toContain("p_project_id !~ '^[ -~]+$'");
    expect(shared).toContain('const PRINTABLE_ASCII = /^[\\x20-\\x7e]+$/;');
    expect(migration).not.toMatch(/(?:lower|trim|btrim)\([^\n]*p_(?:organization|project|document)_id/);
    expect(migration).toContain('ecos_hosted_index_jobs');
    expect(migration).toContain('ecos_hosted_index_usage');
    expect(migration).toContain("usage.event_type = 'visual_region_reserved'");
    expect(migration).toContain('ecos_drawing_analysis_exact_visual_reservation_required');
    expect(migration).not.toContain('ecos_document_index_jobs');
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('recomputes the worker operation id and asserts the shared golden vector', () => {
    expect(migration).toContain('create or replace function public.ecos_visual_provider_operation_id_v1');
    expect(migration).toContain('ecos-visual-provider-operation/1.0');
    expect(migration).toContain(operationFixture.requestIdentity.providerOperationId);
    expect(migration).toContain('ecos_visual_provider_operation_id_golden_mismatch');
    expect(migration).toContain('ecos_drawing_analysis_provider_operation_mismatch');
    expect(migration).toContain(`expected_operation_id := public.ecos_visual_provider_operation_id_v1(
    p_organization_id,
    p_project_id,
    p_document_id,
    normalized_source_sha256,
    p_page_number,
    p_hosted_job_id,
    p_hosted_claim_token,
    normalized_evidence_version,
    normalized_fingerprint,
    normalized_region_key
  );`);
  });

  it('reserves every exact provider attempt with daily, concurrency, and per-request caps', () => {
    expect(migration).toContain('create table if not exists public.ecos_drawing_provider_attempts');
    expect(migration).toContain('create or replace function public.ecos_reserve_drawing_provider_attempt');
    expect(migration).toContain('daily organization provider-attempt limit');
    expect(migration).toContain('daily project provider-attempt limit');
    expect(migration).toContain('provider-attempt limit per drawing request');
    expect(migration).toContain('active drawing-analysis limit');
    expect(migration).toContain('unique (request_id, idempotency_key)');
  });

  it('keeps ledger tables opaque and exposes RPCs only to the hosted service worker', () => {
    expect(migration).toContain('force row level security');
    expect(migration).toContain('revoke all on table public.ecos_drawing_analysis_requests');
    expect(migration).toContain('revoke all on table public.ecos_drawing_provider_attempts');
    expect(migration).toContain(') to service_role;');
    expect(migration).not.toContain('to authenticated, service_role;');
    expect(migration).toContain("coalesce(auth.jwt()->>'role', '') <> 'service_role'");
    expect(edge).toContain('serviceWorkerAuthorized')
    expect(edge.includes('const serviceWorkerAuthorized = protectedServiceTokenMatches(authHeader)')).toBe(true);
    expect(edge.includes('if (!serviceWorkerAuthorized)')).toBe(true);
    expect(edge.includes('return json({ error: "forbidden" }, 403, corsHeaders);')).toBe(true);
    for (const ownerPath of [
      'authorizeOwner',
      'SUPABASE_ANON_KEY',
      'auth.getUser',
      'dave_is_app_owner',
    ]) {
      expect(edge).not.toContain(ownerPath);
    }
  });

  it('begins before provider orchestration and reserves immediately inside every fetch wrapper', () => {
    const handler = edge.slice(edge.indexOf('Deno.serve('), edge.indexOf('class DrawingAssuranceError'));
    expect(handler.indexOf('beginECOSDrawingAnalysisOperation({'))
      .toBeLessThan(handler.indexOf('callDrawingAnalysisProvider({'));
    expect(shared).toContain("client.rpc('ecos_begin_drawing_analysis'");
    expect(shared).toContain("client.rpc('ecos_reserve_drawing_provider_attempt'");
    expect(shared).toContain("client.rpc('ecos_finish_drawing_analysis'");

    const provider = edge.slice(
      edge.indexOf('async function callStructuredVisionProvider('),
      edge.indexOf('function geminiThinkingLevel('),
    );
    expect(provider).toContain('await reserveProviderAttempt(');
    expect(provider.indexOf('await reserveProviderAttempt(')).toBeLessThan(provider.indexOf('return fetch("https://api.openai.com/v1/responses"'));

    const gemini = edge.slice(
      edge.indexOf('async function fetchGemini('),
      edge.indexOf('function geminiInlineImagePart('),
    );
    expect(gemini.indexOf('await reserveProviderAttempt(')).toBeLessThan(gemini.indexOf('await fetch(url'));
    // The analyzer has exactly two paid-network sinks. Both are inside the
    // reservation-guarded wrappers inspected above; no third direct fetch can
    // bypass the atomic attempt ledger.
    expect(edge.match(/\bfetch\(/g)).toHaveLength(2);
  });

  it('fails closed when request or attempt reservation is unavailable or denied', () => {
    expect(shared).toContain("throw new ECOSDrawingOperationControlError('analysis_operation_control_unavailable')");
    expect(shared).toContain("throw new ECOSDrawingOperationControlError('drawing_provider_reservation_denied')");
    expect(edge).toContain("error instanceof ECOSDrawingOperationControlError");
    const normalizedEdge = edge.replaceAll("\"", "'");
    expect(normalizedEdge).toContain("callRole: 'analysis_primary'");
    expect(normalizedEdge).toContain("callRole: 'analysis_capacity_fallback'");
    expect(normalizedEdge).toContain("callRole: 'analysis_invalid_output_fallback'");
    expect(normalizedEdge).toContain("callRole: 'assurance'");
  });
});
