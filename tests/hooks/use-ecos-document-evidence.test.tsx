import { act, renderHook } from '@testing-library/react-native';
import { useECOSDocumentEvidence } from '../../hooks/use-ecos-document-evidence';
import type { DAVEAskEvidence } from '../../services/DAVEAsk';
import type { ReferenceDocument } from '../../types';

jest.mock('../../modules/dave-text-recognition', () => ({
  isDavePdfExcerptRenderingAvailable: () => false,
  renderPdfExcerpt: jest.fn(),
}));

const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const BOUNDS = Object.freeze({ x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 });

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

const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: DOCUMENT_ID,
  summary: 'Civil drawing, Sheet C6',
  timelineEventId: null,
  documentCitation: {
    documentId: DOCUMENT_ID,
    projectId: PROJECT_ID,
    sourceSha256: SOURCE_SHA,
    evidenceVersion: EVIDENCE_VERSION,
    documentName: compactDocument.name,
    revision: '1',
    pageNumber: 6,
    sheetNumber: 'C6',
    regionId: REGION_ID,
    label: 'Civil drawing, Sheet C6, PDF page 6',
  },
  documentRegion: {
    id: REGION_ID,
    text: '6.0” THICK 6.0” PCC PAVING',
    ...BOUNDS,
    source: 'ocr',
  },
};

const proofDocument: ReferenceDocument = {
  ...compactDocument,
  ecosHostedIndexEvidenceVersion: EVIDENCE_VERSION,
  extractedPages: [{
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    assurance: { accepted: true, evidenceVersion: EVIDENCE_VERSION, failureCodes: [] },
    regions: [{ id: REGION_ID, ...BOUNDS, source: null }],
  }],
};

describe('useECOSDocumentEvidence customer proof opening', () => {
  it('hydrates authority for a compact record and downloads the authority-bound document', async () => {
    const loadProofDocument = jest.fn(async () => ({ document: proofDocument, protectedPage: null }));
    const ensureDocument = jest.fn(async (document: ReferenceDocument) => ({
      ...document,
      uri: 'file:///civil.pdf',
    }));
    const openDocument = jest.fn(async () => undefined);
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [compactDocument],
      projectIdentities: [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
      loadProofDocument,
      ensureDocument,
      openDocument,
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(loadProofDocument).toHaveBeenCalledWith(evidence, compactDocument);
    expect(ensureDocument).toHaveBeenCalledWith(proofDocument);
    expect(result.current.state).toMatchObject({
      document: {
        id: DOCUMENT_ID,
        ecosHostedIndexEvidenceVersion: EVIDENCE_VERSION,
        extractedPages: [{ pageNumber: 6, regions: [{ id: REGION_ID }] }],
      },
      binding: {
        exact: true,
        reason: 'exact_hosted_region',
      },
      loading: false,
    });
    expect(result.current.state?.error).toContain('could not render the drawing crop');
  });

  it('opens a protected Drive-backed page without a local file or storage path', async () => {
    const protectedPage = {
      dataUrl: 'data:image/png;base64,protected',
      width: 4898,
      height: 3265,
      sha256: 'f'.repeat(64),
    };
    const ensureDocument = jest.fn();
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [compactDocument],
      projectIdentities: [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
      loadProofDocument: jest.fn(async () => ({ document: proofDocument, protectedPage })),
      ensureDocument,
      openDocument: jest.fn(),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(ensureDocument).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      document: { id: DOCUMENT_ID },
      imageUri: protectedPage.dataUrl,
      imageWidth: 4898,
      imageHeight: 3265,
      imageBounds: BOUNDS,
      binding: { exact: true, reason: 'exact_hosted_region' },
      loading: false,
      error: null,
    });
  });

  it('fails closed and never downloads bytes when authority rejects the citation', async () => {
    const ensureDocument = jest.fn();
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [compactDocument],
      projectIdentities: [{ id: PROJECT_ID, name: '2375 Compliance Project' }],
      loadProofDocument: jest.fn(async () => {
        throw new Error('The exact cited proof could not be verified.');
      }),
      ensureDocument,
      openDocument: jest.fn(),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(ensureDocument).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      document: null,
      loading: false,
      error: 'The exact cited proof could not be verified.',
    });
  });
});
