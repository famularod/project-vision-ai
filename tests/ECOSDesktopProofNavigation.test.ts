import {
  buildECOSDesktopDocumentProofParams,
  parseECOSDesktopDocumentProofFocus,
  resolveECOSDesktopDocumentProof,
} from '../services/ECOSDesktopProofNavigation';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import type { ReferenceDocument } from '../types';
import { computeECOSPageGraphSha256 } from '../services/ECOSHostedPageGraphAuthority';

const PROOF_TEXT_SHA256 = '6709cadc6d4bec91375904589d3bc0a43794de5c65e50400f97fc4af48ed24d9';

const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'document-1',
  summary: 'Sheet C6 proof',
  timelineEventId: null,
  excerpt: '4 inch thick PCC walkway',
  documentCitation: {
    documentId: 'document-1',
    projectId: 'project-2375',
    sourceSha256: 'a'.repeat(64),
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    documentName: 'Civil drawings',
    revision: '1',
    pageNumber: 6,
    sheetNumber: 'C6',
    regionId: 'region-4-inch',
    label: 'Sheet C6, Page 6',
  },
  documentRegion: {
    id: 'region-4-inch',
    text: '4 inch thick PCC walkway',
    x: 0.12567891,
    y: 0.25,
    width: 0.3,
    height: 0.08,
    source: 'ocr',
  },
};

const documentRecord: ReferenceDocument = {
  id: 'document-1',
  name: 'Civil drawings',
  originalFileName: 'civil.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-01T00:00:00.000Z',
  projectId: 'project-2375',
  drawingRevision: '1',
  contentSha256: 'a'.repeat(64),
  indexedContentSha256: 'a'.repeat(64),
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: 'a'.repeat(64),
  ecosVerifiedIndexCommittedPageCount: 1,
  extractedPages: [{
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    assurance: {
      accepted: true,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      checks: { sheetMappingUsable: true },
      failureCodes: [],
    },
    regions: [{
      id: 'region-4-inch',
      text: '4 inch thick PCC walkway',
      x: 0.125679,
      y: 0.25,
      width: 0.3,
      height: 0.08,
      source: 'ocr',
    }],
  }],
};
documentRecord.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(
  documentRecord.extractedPages,
);

describe('ECOS desktop proof navigation', () => {
  it('builds a document/page/region route without putting evidence text in the URL', () => {
    const params = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');

    expect(params).toEqual({
      project: '2375 Compliance Project',
      projectId: 'project-2375',
      proofDocument: 'document-1',
      proofProject: 'project-2375',
      proofRevision: '1',
      proofSource: 'a'.repeat(64),
      proofEvidence: 'ecos-hosted-evidence/1.3',
      proofText: PROOF_TEXT_SHA256,
      proofPage: '6',
      proofRegion: 'region-4-inch',
      proofSheet: 'C6',
      proofX: '0.125679',
      proofY: '0.25',
      proofWidth: '0.3',
      proofHeight: '0.08',
    });
    expect(JSON.stringify(params)).not.toContain('4 inch thick');
  });

  it('requires an exact document and positive page before accepting focus', () => {
    expect(parseECOSDesktopDocumentProofFocus({ proofDocument: 'document-1' })).toBeNull();
    expect(parseECOSDesktopDocumentProofFocus({ proofDocument: 'document-1', proofPage: '0' })).toBeNull();
    expect(parseECOSDesktopDocumentProofFocus({ proofDocument: 'document-1\nforged', proofPage: '6' })).toBeNull();
  });

  it('requires immutable project, revision, and source-hash proof identity', () => {
    expect(parseECOSDesktopDocumentProofFocus({
      proofDocument: 'document-1',
      proofPage: '6',
      proofProject: 'project-2375',
      proofRevision: '1',
    })).toBeNull();

    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    );
    expect(resolveECOSDesktopDocumentProof([{
      ...documentRecord,
      drawingRevision: '2',
      contentSha256: 'b'.repeat(64),
    }], focus!)).toBeNull();
    expect(resolveECOSDesktopDocumentProof([{
      ...documentRecord,
      isCurrent: false,
    }], focus!)).toBeNull();
    expect(resolveECOSDesktopDocumentProof([{
      ...documentRecord,
      indexedContentSha256: 'b'.repeat(64),
    }], focus!)).toBeNull();
  });

  it('drops partial or out-of-page bounds while retaining a safe page focus', () => {
    const partial = parseECOSDesktopDocumentProofFocus({
      proofDocument: 'document-1',
      proofPage: '6',
      proofProject: 'project-2375',
      proofRevision: '1',
      proofSource: 'a'.repeat(64),
      proofEvidence: 'ecos-hosted-evidence/1.3',
      proofX: '0.1',
      proofY: '0.2',
    });
    const outside = parseECOSDesktopDocumentProofFocus({
      proofDocument: 'document-1',
      proofPage: '6',
      proofProject: 'project-2375',
      proofRevision: '1',
      proofSource: 'a'.repeat(64),
      proofEvidence: 'ecos-hosted-evidence/1.3',
      proofX: '0.9',
      proofY: '0.2',
      proofWidth: '0.2',
      proofHeight: '0.1',
    });

    expect(partial?.bounds).toBeNull();
    expect(outside?.bounds).toBeNull();
  });

  it('revalidates an exact stored region inside the authorized document list', () => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    );
    expect(focus).not.toBeNull();

    const resolved = resolveECOSDesktopDocumentProof([documentRecord], focus!);
    expect(resolved?.match).toBe('stored_region');
    expect(resolved?.region?.id).toBe('region-4-inch');
    expect(resolved?.bounds).toEqual({ x: 0.125679, y: 0.25, width: 0.3, height: 0.08 });
  });

  it('rejects the same region id when cited bounds or current text drift', () => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project'),
    );
    const driftedBounds: ReferenceDocument = {
      ...documentRecord,
      extractedPages: [{
        ...documentRecord.extractedPages![0],
        regions: [{
          ...documentRecord.extractedPages![0].regions![0],
          x: 0.12568,
        }],
      }],
    };
    const driftedText: ReferenceDocument = {
      ...documentRecord,
      extractedPages: [{
        ...documentRecord.extractedPages![0],
        regions: [{
          ...documentRecord.extractedPages![0].regions![0],
          text: '6 inch thick PCC walkway',
        }],
      }],
    };

    expect(resolveECOSDesktopDocumentProof([driftedBounds], focus!)).toBeNull();
    expect(resolveECOSDesktopDocumentProof([driftedText], focus!)).toBeNull();
  });

  it('requires the cited text commitment for exact-region proof', () => {
    const exactParams = buildECOSDesktopDocumentProofParams(evidence, '2375 Compliance Project');
    const { proofText: _proofText, ...withoutCommitment } = exactParams;
    const missing = parseECOSDesktopDocumentProofFocus(withoutCommitment);
    const wrong = parseECOSDesktopDocumentProofFocus({
      ...exactParams,
      proofText: 'b'.repeat(64),
    });

    expect(missing).not.toBeNull();
    expect(resolveECOSDesktopDocumentProof([documentRecord], missing!)).toBeNull();
    expect(wrong).not.toBeNull();
    expect(resolveECOSDesktopDocumentProof([documentRecord], wrong!)).toBeNull();
  });

  it('does not downgrade a mismatched carried region to page-only proof', () => {
    const params = buildECOSDesktopDocumentProofParams({
      ...evidence,
      documentRegion: {
        ...evidence.documentRegion!,
        id: 'different-region',
      },
    }, '2375 Compliance Project');
    const focus = parseECOSDesktopDocumentProofFocus(params);

    expect(params.proofRegion).toBe('region-4-inch');
    expect(params.proofX).toBeUndefined();
    expect(resolveECOSDesktopDocumentProof([documentRecord], focus!)).toBeNull();
  });

  it('retains page-only navigation for citations that never claim a region', () => {
    const focus = parseECOSDesktopDocumentProofFocus(
      buildECOSDesktopDocumentProofParams({
        ...evidence,
        documentCitation: {
          ...evidence.documentCitation!,
          regionId: null,
        },
        documentRegion: null,
      }, '2375 Compliance Project'),
    );

    expect(resolveECOSDesktopDocumentProof([documentRecord], focus!)).toMatchObject({
      match: 'page_only',
      region: null,
      bounds: null,
    });
  });

  it('never opens a document outside the authorized project-scoped list', () => {
    const focus = parseECOSDesktopDocumentProofFocus({
      proofDocument: 'document-from-another-project',
      proofPage: '1',
      proofProject: 'project-2375',
      proofRevision: '1',
      proofSource: 'a'.repeat(64),
      proofEvidence: 'ecos-hosted-evidence/1.3',
      proofX: '0.1',
      proofY: '0.1',
      proofWidth: '0.2',
      proofHeight: '0.2',
    });

    expect(focus).not.toBeNull();
    expect(resolveECOSDesktopDocumentProof([documentRecord], focus!)).toBeNull();
  });

  it('rejects a sheet-mismatched stored region instead of using cited coordinates', () => {
    const focus = parseECOSDesktopDocumentProofFocus({
      proofDocument: 'document-1',
      proofPage: '6',
      proofProject: 'project-2375',
      proofRevision: '1',
      proofSource: 'a'.repeat(64),
      proofEvidence: 'ecos-hosted-evidence/1.3',
      proofRegion: 'region-4-inch',
      proofSheet: 'C5',
      proofX: '0.2',
      proofY: '0.2',
      proofWidth: '0.2',
      proofHeight: '0.2',
    });

    const resolved = resolveECOSDesktopDocumentProof([documentRecord], focus!);
    expect(resolved).toBeNull();
  });
});
