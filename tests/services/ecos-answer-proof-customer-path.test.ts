import {
  buildECOSDesktopDocumentProofParams,
  parseECOSDesktopDocumentProofFocus,
  resolveECOSDesktopDocumentProof,
} from '../../services/ECOSDesktopProofNavigation';
import { evaluateECOSDocumentEvidenceBinding } from '../../services/ECOSDocumentEvidenceBinding';
import {
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  parseECOSProjectQuestionAnswer,
} from '../../services/ECOSProjectQuestion';
import type { ReferenceDocument } from '../../types';

const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';

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
  storagePath: 'owner/project/civil.pdf',
  contentSha256: SOURCE_SHA,
  webFileFingerprint: SOURCE_SHA,
  indexedContentSha256: SOURCE_SHA,
  drawingRevision: '1',
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
  ecosVerifiedIndexCommittedPageCount: 8,
  sourcePageCount: 8,
  ecosHostedIndexEvidenceVersion: EVIDENCE_VERSION,
  extractedPages: [{
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    assurance: {
      accepted: true,
      evidenceVersion: EVIDENCE_VERSION,
      failureCodes: [],
    },
  }],
};

describe('Ask ECOS answer-to-visible-proof customer contract', () => {
  it('carries the real hosted citation through parsing, routing, and the Build 188 proof gate', () => {
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

    const mobileBinding = evaluateECOSDocumentEvidenceBinding(
      evidence,
      currentCivilDrawing,
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
      [currentCivilDrawing],
      focus!,
      [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
    )).toMatchObject({
      match: 'hosted_cited_bounds',
      bounds: { x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 },
    });
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
});

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
