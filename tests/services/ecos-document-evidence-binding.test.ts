import { findExactECOSDocumentEvidenceSource } from '../../services/ECOSDocumentEvidenceBinding';
import type { DAVEAskEvidence } from '../../services/DAVEAsk';
import type { ReferenceDocument } from '../../types';
import { computeECOSPageGraphSha256 } from '../../services/ECOSHostedPageGraphAuthority';

const SHA = 'a'.repeat(64);
const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-1',
  summary: 'A101 proof',
  timelineEventId: null,
  excerpt: 'Provide guardrails.',
  documentCitation: {
    documentId: 'drawing-1',
    projectId: 'project-1',
    sourceSha256: SHA,
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    documentName: 'A101',
    revision: '4',
    pageNumber: 1,
    sheetNumber: 'A101',
    regionId: 'note-1',
    label: 'A101, Rev 4',
  },
  documentRegion: {
    id: 'note-1',
    text: 'Provide guardrails.',
    source: 'ocr',
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.05,
  },
};
const document: ReferenceDocument = {
  id: 'drawing-1',
  projectId: 'project-1',
  name: 'A101',
  originalFileName: 'A101.pdf',
  uri: '',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-09T00:00:00.000Z',
  drawingRevision: '4',
  contentSha256: SHA,
  indexedContentSha256: SHA,
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SHA,
  ecosVerifiedIndexCommittedPageCount: 1,
  extractedPages: [{
    pageNumber: 1,
    sheetNumber: 'A101',
    assurance: {
      accepted: true,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      checks: { sheetMappingUsable: true },
      failureCodes: [],
    },
    regions: [{
      id: 'note-1', text: 'Provide guardrails.', source: 'ocr',
      x: 0.1, y: 0.1, width: 0.3, height: 0.05,
    }],
  }],
};
document.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(
  document.extractedPages,
);

function authorizeGraph(value: ReferenceDocument): ReferenceDocument {
  return {
    ...value,
    ecosVerifiedIndexCommittedPageCount: value.extractedPages?.length ?? 0,
    ecosVerifiedIndexPageGraphSha256: computeECOSPageGraphSha256(value.extractedPages),
  };
}

describe('ECOS document evidence binding', () => {
  it('finds only the exact current project, revision, and source hash', () => {
    expect(findExactECOSDocumentEvidenceSource([document], evidence)).toBe(document);
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      excerpt: 'DRAWING PAGE CONTEXT: Sheet A101.\nProvide guardrails.',
      documentRegion: {
        ...evidence.documentRegion!,
        text: 'DRAWING PAGE CONTEXT: Sheet A101.\nProvide guardrails.',
      },
    })).toBe(document);
    expect(findExactECOSDocumentEvidenceSource([{ ...document, projectId: 'project-other' }], evidence)).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([{ ...document, drawingRevision: '5' }], evidence)).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([{ ...document, contentSha256: 'b'.repeat(64) }], evidence)).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([{ ...document, indexedContentSha256: 'b'.repeat(64) }], evidence)).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([{ ...document, isCurrent: false }], evidence)).toBeNull();
  });

  it('rejects legacy citations without immutable source binding', () => {
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      documentCitation: {
        ...evidence.documentCitation!,
        projectId: null,
        sourceSha256: null,
      },
    })).toBeNull();
  });

  it('rejects a forged excerpt even when every source identity field still matches', () => {
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      excerpt: 'Provide a 12-inch slab.',
    })).toBeNull();
  });

  it('requires the cited region id and exact current bounds to travel with the proof', () => {
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      documentRegion: null,
    })).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      documentRegion: {
        id: 'other-note',
        text: 'Provide guardrails.',
        source: 'ocr',
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.05,
      },
    })).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      documentRegion: {
        id: 'note-1',
        text: 'Provide guardrails.',
        source: 'ocr',
        x: 0.11,
        y: 0.1,
        width: 0.3,
        height: 0.05,
      },
    })).toBeNull();
  });

  it('rejects a tiny or missing text fragment as proof of a longer persisted statement', () => {
    expect(findExactECOSDocumentEvidenceSource([document], {
      ...evidence,
      excerpt: '2',
      documentRegion: {
        id: 'note-1',
        text: '2',
        source: 'ocr',
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.05,
      },
    })).toBeNull();
    expect(findExactECOSDocumentEvidenceSource([{
      ...document,
      extractedPages: [{
        ...document.extractedPages![0],
        regions: [{
          ...document.extractedPages![0].regions![0],
          text: null,
        }],
      }],
    }], evidence)).toBeNull();
  });

  it('accepts exact short construction proof from persisted evidence text or labels', () => {
    const shortEvidence: DAVEAskEvidence = {
      ...evidence,
      excerpt: '6 in',
      documentRegion: {
        ...evidence.documentRegion!,
        text: null,
        evidenceText: '6 in',
      },
    };
    const evidenceTextDocument: ReferenceDocument = {
      ...document,
      extractedPages: [{
        ...document.extractedPages![0],
        regions: [{
          ...document.extractedPages![0].regions![0],
          text: null,
          evidenceText: '6 in',
        }],
      }],
    };
    const labelEvidence: DAVEAskEvidence = {
      ...evidence,
      excerpt: 'Anchor bolts',
      documentRegion: {
        ...evidence.documentRegion!,
        text: null,
        label: 'Anchor bolts',
      },
    };
    const labelDocument: ReferenceDocument = {
      ...document,
      extractedPages: [{
        ...document.extractedPages![0],
        regions: [{
          ...document.extractedPages![0].regions![0],
          text: null,
          label: 'Anchor bolts',
        }],
      }],
    };

    const authorizedEvidenceText = authorizeGraph(evidenceTextDocument);
    const authorizedLabel = authorizeGraph(labelDocument);
    expect(findExactECOSDocumentEvidenceSource([authorizedEvidenceText], shortEvidence)).toBe(authorizedEvidenceText);
    expect(findExactECOSDocumentEvidenceSource([authorizedLabel], labelEvidence)).toBe(authorizedLabel);
  });

  it('does not match a short construction excerpt inside a different measurement', () => {
    const differentMeasurement = {
      ...document,
      extractedPages: [{
        ...document.extractedPages![0],
        regions: [{
          ...document.extractedPages![0].regions![0],
          text: '16 in',
        }],
      }],
    };
    expect(findExactECOSDocumentEvidenceSource([differentMeasurement], {
      ...evidence,
      excerpt: '6 in',
      documentRegion: {
        ...evidence.documentRegion!,
        text: '6 in',
      },
    })).toBeNull();
  });

  it('binds regionless proof to substantial current page text', () => {
    const pageDocument = {
      ...document,
      extractedPages: [{
        ...document.extractedPages![0],
        text: 'The current page requires edge protection and guardrails.',
        regions: [],
      }],
    };
    const pageEvidence: DAVEAskEvidence = {
      ...evidence,
      excerpt: 'requires edge protection and guardrails',
      documentCitation: {
        ...evidence.documentCitation!,
        regionId: null,
      },
      documentRegion: null,
    };

    const authorizedPage = authorizeGraph(pageDocument);
    expect(findExactECOSDocumentEvidenceSource([authorizedPage], pageEvidence)).toBe(authorizedPage);
    expect(findExactECOSDocumentEvidenceSource([authorizedPage], {
      ...pageEvidence,
      excerpt: 'requires a 12-inch concrete slab',
    })).toBeNull();
  });
});
