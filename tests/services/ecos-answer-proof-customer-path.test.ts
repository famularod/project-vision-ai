import {
  buildECOSDesktopDocumentProofParams,
  parseECOSDesktopDocumentProofFocus,
  resolveECOSDesktopDocumentProof,
} from '../../services/ECOSDesktopProofNavigation';
import { evaluateECOSDocumentEvidenceBinding } from '../../services/ECOSDocumentEvidenceBinding';
import {
  ecosDocumentProofClaimFromEvidence,
  loadAuthorizedECOSDocumentProofBundle,
} from '../../services/ECOSDocumentProofAuthority';
import {
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  parseECOSProjectQuestionAnswer,
} from '../../services/ECOSProjectQuestion';
import { ecosEvidenceProofTierLabel } from '../../services/DAVEAsk';
import type { ReferenceDocument } from '../../types';
import { buildProtectedSourceCitation } from '../fixtures/ecos-protected-source';

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const RASTER_SHA = 'c'.repeat(64);

const currentCivilDrawing: ReferenceDocument = {
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

describe('Ask ECOS answer-to-visible-proof customer contract', () => {
  it('loads exact proof authority for the compact document shape used by real customer surfaces', async () => {
    const answer = parseECOSProjectQuestionAnswer(realConcreteAnswer());
    const evidence = answer.supportingEvidence[0];

    expect(evidence.documentCitation).toMatchObject({
      documentId: DOCUMENT_ID,
      projectId: PROJECT_ID,
      sourceSha256: SOURCE_SHA,
      evidenceVersion: EVIDENCE_VERSION,
      revision: '1',
      pageNumber: 6,
      sheetNumber: 'C6',
      regionId: REGION_ID,
    });

    const compactBinding = evaluateECOSDocumentEvidenceBinding(
      evidence,
      currentCivilDrawing,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    );
    expect(compactBinding).toMatchObject({ exact: false, reason: 'page_mismatch' });

    const claim = ecosDocumentProofClaimFromEvidence(evidence);
    expect(claim).not.toBeNull();
    const sourceViewCitation = buildProtectedSourceCitation({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sourceSha256: SOURCE_SHA,
      rasterSha256: RASTER_SHA,
      rasterByteCount: 33,
      rasterWidth: 2,
      rasterHeight: 3,
    });
    const rpc = jest.fn(async () => ({
      data: [{
        document_id: DOCUMENT_ID,
        project_id: PROJECT_ID,
        source_sha256: SOURCE_SHA,
        evidence_version: EVIDENCE_VERSION,
        source_revision: '1',
        page_number: 6,
        sheet_number: 'C6',
        region_id: REGION_ID,
        region_bounds: { x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 },
        source_view_citation: sourceViewCitation,
      }],
      error: null,
    }));
    const loadProtectedPage = jest.fn(async () => ({
      dataUrl: 'data:image/png;base64,protected-current-page',
      width: 2,
      height: 3,
      sha256: RASTER_SHA,
    }));
    const proof = await loadAuthorizedECOSDocumentProofBundle({
      client: { rpc } as any,
      document: currentCivilDrawing,
      claim: claim!,
      loadProtectedPage,
    });
    const proofDocument = proof.document;
    expect(currentCivilDrawing.uri).toBe('');
    expect(currentCivilDrawing.storagePath).toBeUndefined();
    expect(proof.protectedPage).toMatchObject({ sha256: RASTER_SHA, width: 2, height: 3 });
    expect(loadProtectedPage).toHaveBeenCalledTimes(1);
    const mobileBinding = evaluateECOSDocumentEvidenceBinding(
      evidence,
      proofDocument,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    );
    expect(mobileBinding).toMatchObject({
      exact: true,
      reason: 'exact_hosted_region',
      proofMode: 'hosted_cited_region',
    });

    const params = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');
    const focus = parseECOSDesktopDocumentProofFocus(params);
    expect(focus).not.toBeNull();
    expect(resolveECOSDesktopDocumentProof(
      [proofDocument],
      focus!,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    )).toMatchObject({
      match: 'stored_region',
      bounds: { x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 },
    });
    expect(rpc).toHaveBeenCalledWith('dave_verify_current_ecos_document_proof', {
      p_project_id: PROJECT_ID,
      p_document_id: DOCUMENT_ID,
      p_source_sha256: SOURCE_SHA,
      p_evidence_version: EVIDENCE_VERSION,
      p_revision: '1',
      p_page_number: 6,
      p_sheet_number: 'C6',
      p_region_id: REGION_ID,
    });
  });

  it('ECO-04: opens a page-text proof as the whole current page, labelled "Verified from page text"', async () => {
    const answer = parseECOSProjectQuestionAnswer(pageTextAnswer());
    const evidence = answer.supportingEvidence[0];
    expect(evidence.proofTier).toBe('page_text');
    expect(evidence.documentCitation?.regionId).toBeNull();
    expect(evidence.documentRegion).toMatchObject({ id: 'page', x: 0, y: 0, width: 1, height: 1 });
    expect(ecosEvidenceProofTierLabel(evidence)).toBe('Verified from page text');
    expect(answer.assurance.status).toBe('verified_with_limits');

    const claim = ecosDocumentProofClaimFromEvidence(evidence);
    expect(claim).toMatchObject({ pageNumber: 6, regionId: null });
    const sourceViewCitation = buildProtectedSourceCitation({
      ownerId: OWNER_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sourceSha256: SOURCE_SHA,
      rasterSha256: RASTER_SHA,
      rasterByteCount: 33,
      rasterWidth: 2,
      rasterHeight: 3,
    });
    const rpc = jest.fn(async () => ({
      data: [{
        document_id: DOCUMENT_ID,
        project_id: PROJECT_ID,
        source_sha256: SOURCE_SHA,
        evidence_version: EVIDENCE_VERSION,
        source_revision: '1',
        page_number: 6,
        sheet_number: 'C6',
        region_id: null,
        region_bounds: { x: 0, y: 0, width: 1, height: 1 },
        source_view_citation: sourceViewCitation,
      }],
      error: null,
    }));
    const proof = await loadAuthorizedECOSDocumentProofBundle({
      client: { rpc } as any,
      document: currentCivilDrawing,
      claim: claim!,
      loadProtectedPage: jest.fn(async () => ({
        dataUrl: 'data:image/png;base64,protected-current-page',
        width: 2,
        height: 3,
        sha256: RASTER_SHA,
      })),
    });
    expect(rpc).toHaveBeenCalledWith('dave_verify_current_ecos_document_proof', expect.objectContaining({
      p_page_number: 6,
      p_region_id: null,
    }));
    expect(evaluateECOSDocumentEvidenceBinding(
      evidence,
      proof.document,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    )).toMatchObject({ exact: true, reason: 'exact_hosted_page', proofMode: 'hosted_cited_page' });

    // Desktop: the page opens with no region box to mark.
    const params = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');
    expect(params.proofTier).toBe('page_text');
    expect(params.proofRegion).toBeUndefined();
    expect(params.proofX).toBeUndefined();
    const focus = parseECOSDesktopDocumentProofFocus(params);
    expect(focus).toMatchObject({ pageNumber: 6, regionId: null, pageText: true });
    expect(resolveECOSDesktopDocumentProof(
      [proof.document],
      focus!,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    )).toMatchObject({ match: 'page_only', bounds: null, binding: { reason: 'exact_hosted_page' } });
  });

  it('ECO-04: a page-text label cannot ride on a region-less citation the server did not bind', () => {
    const raw = pageTextAnswer();
    raw.supportingEvidence[0].documentRegion = null;
    const evidence = parseECOSProjectQuestionAnswer(raw).supportingEvidence[0];
    expect(evidence.proofTier).toBeNull();
    expect(ecosEvidenceProofTierLabel(evidence)).toBeNull();
    expect(ecosDocumentProofClaimFromEvidence(evidence)).toBeNull();
  });

  it('fails closed after the current document bytes drift from the answered source', () => {
    const evidence = parseECOSProjectQuestionAnswer(realConcreteAnswer()).supportingEvidence[0];
    const binding = evaluateECOSDocumentEvidenceBinding(
      evidence,
      { ...currentCivilDrawing, contentSha256: 'f'.repeat(64) },
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    );
    expect(binding).toMatchObject({ exact: false, reason: 'source_mismatch' });
  });

  it('fails closed when authoritative region bounds do not match the answer citation', async () => {
    const evidence = parseECOSProjectQuestionAnswer(realConcreteAnswer()).supportingEvidence[0];
    const claim = ecosDocumentProofClaimFromEvidence(evidence)!;
    const proofDocument = (await loadAuthorizedECOSDocumentProofBundle({
      client: {
        rpc: jest.fn(async () => ({
          data: [{
            document_id: DOCUMENT_ID,
            project_id: PROJECT_ID,
            source_sha256: SOURCE_SHA,
            evidence_version: EVIDENCE_VERSION,
            source_revision: '1',
            page_number: 6,
            sheet_number: 'C6',
            region_id: REGION_ID,
            region_bounds: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
            source_view_citation: null,
          }],
          error: null,
        })),
      } as any,
      document: currentCivilDrawing,
      claim,
    })).document;

    expect(evaluateECOSDocumentEvidenceBinding(
      evidence,
      proofDocument,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    )).toMatchObject({ exact: false, reason: 'visual_coverage_mismatch' });
  });
});

function pageTextAnswer() {
  const base = realConcreteAnswer();
  const evidence = base.supportingEvidence[0];
  return {
    ...base,
    question: 'What does the general note say about paving?',
    answer: 'General note 4 requires 6.0” PCC paving.',
    limitations: ['Verified from page text: Civil drawing, Sheet C6, PDF page 6. The exact spot on the page is not marked.'],
    assurance: { ...base.assurance, status: 'verified_with_limits' },
    supportingEvidence: [{
      ...evidence,
      proofTier: 'page_text',
      documentCitation: { ...evidence.documentCitation, regionId: null },
      documentRegion: {
        id: 'page',
        text: '6.0” THICK 6.0” PCC PAVING',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rawSource: 'hosted_proof_authority_page',
      } as typeof evidence.documentRegion | null,
    }],
  };
}

function realConcreteAnswer() {
  return {
    schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
    projectId: PROJECT_ID,
    projectName: '2375 Compliance Project',
    question: 'How thick is the new concrete on the north lot?',
    answer: 'The current drawing specifies 6.0” THICK 6.0” PCC PAVING.',
    confidence: 'high',
    facts: [{
      id: 'fact-concrete-thickness',
      statement: 'The new north-lot concrete is 6.0 inches thick.',
      classification: 'fact',
      sourceIds: [`document:${DOCUMENT_ID}:6:${REGION_ID}`],
    }],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [{
      sourceType: 'document',
      recordId: DOCUMENT_ID,
      summary: 'Civil drawing, Sheet C6',
      excerpt: '6.0” THICK 6.0” PCC PAVING',
      documentCitation: {
        documentId: DOCUMENT_ID,
        projectId: PROJECT_ID,
        sourceSha256: SOURCE_SHA,
        evidenceVersion: EVIDENCE_VERSION,
        documentName: currentCivilDrawing.name,
        revision: '1',
        pageNumber: 6,
        sheetNumber: 'C6',
        regionId: REGION_ID,
        label: 'Civil drawing, Sheet C6, PDF page 6',
      },
      documentProvenance: {
        sheetNumber: 'C6',
        sheetMappingStatus: 'verified',
        sheetMappingSource: 'native_title_band',
        sheetMappingEvidence: [{
          id: 'title-band-c6',
          pageNumber: 6,
          source: 'embedded_text',
          text: 'C6',
          normalizedBounds: { x: 0.9, y: 0.9, width: 0.05, height: 0.03 },
        }],
        documentStructuralIdentity: {
          sheetNumber: 'C6',
          source: 'native_title_band',
          evidence: [{
            id: 'title-band-c6',
            pageNumber: 6,
            source: 'embedded_text',
            text: 'C6',
            normalizedBounds: { x: 0.9, y: 0.9, width: 0.05, height: 0.03 },
          }],
        },
        assurance: {
          accepted: true,
          evidenceVersion: EVIDENCE_VERSION,
          failureCodes: [],
          checks: { sheetMappingUsable: true },
        },
      },
      documentRegion: {
        id: REGION_ID,
        text: '6.0” THICK 6.0” PCC PAVING',
        x: 0.608889,
        y: 0.172222,
        width: 0.085,
        height: 0.009167,
        source: 'structured_table_fact',
      },
    }],
    assurance: {
      status: 'verified',
      checkedSourceCount: 1,
      verifiedFactCount: 1,
      rejectedFactCount: 0,
      message: 'ECOS Assurance matched the answer to the current drawing.',
    },
    generatedAt: '2026-09-12T00:00:00.000Z',
    model: 'deepseek-chat',
    diagnostics: {
      schemaVersion: 'ecos-question-trace/1.0',
      traceId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      clientSurface: 'web',
      evidenceSnapshotId: '33333333-3333-4333-8333-333333333333',
      evidenceDossierId: '44444444-4444-4444-8444-444444444444',
      replayed: false,
      persisted: true,
    },
  };
}
