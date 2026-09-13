import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ECOSDocumentProofAuthorityError,
  loadAuthorizedECOSDocumentProof,
  loadAuthorizedECOSDocumentProofBundle,
  type ECOSDocumentProofClaim,
} from '../../services/ECOSDocumentProofAuthority';
import type { ReferenceDocument } from '../../types';
import { buildProtectedSourceCitation } from '../fixtures/ecos-protected-source';

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const RASTER_SHA = 'c'.repeat(64);

const claim: ECOSDocumentProofClaim = Object.freeze({
  documentId: DOCUMENT_ID,
  projectId: PROJECT_ID,
  sourceSha256: SOURCE_SHA,
  evidenceVersion: EVIDENCE_VERSION,
  revision: '1',
  pageNumber: 6,
  sheetNumber: 'C6',
  regionId: REGION_ID,
});

const compactDocument: ReferenceDocument = {
  id: DOCUMENT_ID,
  name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
  originalFileName: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-01T00:00:00.000Z',
  projectId: PROJECT_ID,
  projectName: '2375 Compliance Project',
  contentSha256: SOURCE_SHA,
  webFileFingerprint: SOURCE_SHA,
  indexedContentSha256: SOURCE_SHA,
  drawingRevision: '1',
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
  ecosVerifiedIndexCommittedPageCount: 8,
  sourcePageCount: 8,
  extractedPages: [],
};

function authorityRow(patch: Record<string, unknown> = {}) {
  return {
    document_id: DOCUMENT_ID,
    project_id: PROJECT_ID,
    source_sha256: SOURCE_SHA,
    evidence_version: EVIDENCE_VERSION,
    source_revision: '1',
    page_number: 6,
    sheet_number: 'C6',
    region_id: REGION_ID,
    region_bounds: { x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 },
    ...patch,
  };
}

function protectedCitation() {
  return buildProtectedSourceCitation({
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    sourceSha256: SOURCE_SHA,
    rasterSha256: RASTER_SHA,
    rasterByteCount: 33,
    rasterWidth: 2,
    rasterHeight: 3,
  });
}

describe('ECOS document proof authority', () => {
  it('hydrates only one exact assured page and region without returning evidence text', async () => {
    const rpc = jest.fn(async () => ({ data: [authorityRow()], error: null }));
    const result = await loadAuthorizedECOSDocumentProof({
      client: { rpc } as any,
      document: compactDocument,
      claim,
    });

    expect(result.extractedPages).toEqual([{
      pageNumber: 6,
      sheetNumber: 'C6',
      sheetMappingStatus: 'verified',
      assurance: {
        accepted: true,
        evidenceVersion: EVIDENCE_VERSION,
        failureCodes: [],
      },
      regions: [{
        id: REGION_ID,
        x: 0.608889,
        y: 0.172222,
        width: 0.085,
        height: 0.009167,
        source: null,
        rawSource: 'hosted_proof_authority',
      }],
    }]);
    expect(JSON.stringify(result.extractedPages)).not.toContain('THICK');
    expect(result.ecosHostedIndexEvidenceVersion).toBe(EVIDENCE_VERSION);
  });

  it('binds the exact current protected page to the verified answer proof', async () => {
    const sourceViewCitation = protectedCitation();
    const loadProtectedPage = jest.fn(async () => ({
      dataUrl: 'data:image/png;base64,protected',
      width: 2,
      height: 3,
      sha256: RASTER_SHA,
    }));
    const result = await loadAuthorizedECOSDocumentProofBundle({
      client: {
        rpc: jest.fn(async () => ({
          data: [authorityRow({ source_view_citation: sourceViewCitation })],
          error: null,
        })),
      } as any,
      document: compactDocument,
      claim,
      loadProtectedPage,
    });

    expect(result.protectedPage).toMatchObject({ width: 2, height: 3, sha256: RASTER_SHA });
    expect(result.document.extractedPages).toHaveLength(1);
    expect(loadProtectedPage).toHaveBeenCalledWith(expect.objectContaining({
      claim,
      citation: sourceViewCitation,
    }));
  });

  it('fails closed when the database supplies a malformed protected-page locator', async () => {
    const loadProtectedPage = jest.fn();
    await expect(loadAuthorizedECOSDocumentProofBundle({
      client: {
        rpc: jest.fn(async () => ({
          data: [authorityRow({
            source_view_citation: {
              ...protectedCitation(),
              source_sha256: 'f'.repeat(64),
            },
          })],
          error: null,
        })),
      } as any,
      document: compactDocument,
      claim,
      loadProtectedPage,
    })).rejects.toBeInstanceOf(ECOSDocumentProofAuthorityError);
    expect(loadProtectedPage).not.toHaveBeenCalled();
  });

  it.each([
    ['no authority row', [], claim],
    ['more than one row', [authorityRow(), authorityRow()], claim],
    ['mismatched source', [authorityRow({ source_sha256: 'f'.repeat(64) })], claim],
    ['mismatched region', [authorityRow({ region_id: 'different-region' })], claim],
    ['invalid bounds', [authorityRow({ region_bounds: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } })], claim],
  ])('fails closed for %s', async (_label, rows, proofClaim) => {
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc: jest.fn(async () => ({ data: rows, error: null })) } as any,
      document: compactDocument,
      claim: proofClaim,
    })).rejects.toBeInstanceOf(ECOSDocumentProofAuthorityError);
  });

  it('fails before the RPC when compact document identity has drifted', async () => {
    const rpc = jest.fn();
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc } as any,
      document: { ...compactDocument, contentSha256: 'f'.repeat(64) },
      claim,
    })).rejects.toMatchObject({ code: 'source_identity_mismatch' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('identifies a missing deployed proof function as a service failure, not source drift', async () => {
    await expect(loadAuthorizedECOSDocumentProof({
      client: {
        rpc: jest.fn(async () => ({
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.dave_verify_current_ecos_document_proof in the schema cache',
          },
        })),
      } as any,
      document: compactDocument,
      claim,
    })).rejects.toMatchObject({
      code: 'proof_service_unavailable',
      message: 'The protected proof service is temporarily unavailable. The project document was not reported as changed.',
    });
  });

  it('keeps project authorization failures distinct from missing proof data', async () => {
    await expect(loadAuthorizedECOSDocumentProof({
      client: {
        rpc: jest.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } })),
      } as any,
      document: compactDocument,
      claim,
    })).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('reports an exact proof miss separately from a malformed proof response', async () => {
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc: jest.fn(async () => ({ data: [], error: null })) } as any,
      document: compactDocument,
      claim,
    })).rejects.toMatchObject({ code: 'proof_not_found' });
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc: jest.fn(async () => ({ data: [authorityRow({ page_number: 7 })], error: null })) } as any,
      document: compactDocument,
      claim,
    })).rejects.toMatchObject({ code: 'proof_response_invalid' });
  });

  it('rejects oversized proof identifiers before the RPC', async () => {
    const rpc = jest.fn();
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc } as any,
      document: compactDocument,
      claim: { ...claim, regionId: 'r'.repeat(513) },
    })).rejects.toBeInstanceOf(ECOSDocumentProofAuthorityError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a proof claim without an exact region before the RPC', async () => {
    const rpc = jest.fn();
    await expect(loadAuthorizedECOSDocumentProof({
      client: { rpc } as any,
      document: compactDocument,
      claim: { ...claim, regionId: null },
    })).rejects.toBeInstanceOf(ECOSDocumentProofAuthorityError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('ECOS document proof migration contract', () => {
  const sql = readFileSync(join(
    __dirname,
    '../../supabase/migrations/20260913032335_dave_current_ecos_document_proof.sql',
  ), 'utf8');

  it('rechecks owner, current source, immutable identity, assurance, and exact region', () => {
    expect(sql).toContain('ecos_hosted_index_jobs_current_proof_idx');
    expect(sql).toContain("where state = 'ready'");
    expect(sql).toContain('current_actor is null or not public.dave_is_app_owner()');
    expect(sql).toContain('source.owner_id = current_actor');
    expect(sql).toContain('project_record.owner_id = current_actor');
    expect(sql).toContain('app_private.ecos_reference_document_authority source');
    expect(sql).toContain('source.is_current');
    expect(sql).toContain('requested_region_id is null');
    expect(sql).toContain('public.ecos_hosted_job_matches_reference(job.id, true)');
    expect(sql).toContain("page.state = 'assured'");
    expect(sql).toContain("page.assurance_result->>'accepted' = 'true'");
    expect(sql).toContain("region.value->>'id' = requested_region_id");
    expect(sql).toContain('region.match_count = 1');
    expect(sql).toContain('length(requested_region_id) > 512');
  });

  it('returns identity and bounds only and is not callable by public or anon', () => {
    const returnShape = sql.slice(sql.indexOf('returns table('), sql.indexOf('language plpgsql'));
    expect(returnShape).not.toMatch(/\b(evidence_text|excerpt|content|payload)\b/i);
    expect(sql).toContain('from public, anon, service_role;');
    expect(sql).toContain('to authenticated;');
  });
});

describe('protected ECOS page source migration contract', () => {
  const sql = readFileSync(join(
    __dirname,
    '../../supabase/migrations/20260913144434_dave_protected_ecos_page_source.sql',
  ), 'utf8');

  it('pins the current owner execution, exact page, and immutable raster receipt', () => {
    expect(sql).not.toContain('ecos_private.owner_execution_current_source(execution, binding)');
    expect(sql).toContain('execution.owner_id = current_actor');
    expect(sql).toContain('execution.project_id = requested_project_id::uuid');
    expect(sql).toContain('execution.source_id = requested_document_id');
    expect(sql).toContain('page_head.page_number = p_page_number');
    expect(sql).toContain("raster.attestation->>'raster_sha256' ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("raster_receipt.attestation_sha256 =");
    expect(sql).toContain("raster_receipt.receipt_sha256 =");
    expect(sql).toContain('locator_schema_version');
    expect(sql).toContain('ecos-owner-raster-source-locator/2.2');
    expect(sql).toContain('The source viewer must still reauthorize and revalidate every supplied raster pin');
  });

  it('returns only locator identity and keeps storage coordinates private', () => {
    const returnShape = sql.slice(sql.indexOf('returns table('), sql.indexOf('language plpgsql'));
    expect(returnShape).toContain('source_view_citation jsonb');
    expect(sql).not.toMatch(/['"](?:bucket|object_path|storage_path|public_url)['"]/i);
    expect(sql).toContain('from public, anon, service_role;');
    expect(sql).toContain('to authenticated;');
  });
});
