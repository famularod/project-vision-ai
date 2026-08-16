import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import type { ReferenceDocument } from '../../types';

function document(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'schedule-1',
    name: 'Schedule',
    originalFileName: 'schedule.pdf',
    uri: '',
    category: 'Schedules',
    notes: '',
    isCurrent: false,
    importedAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('reference document cloud recovery', () => {
  it('keeps newer cloud schedule authority while preserving the local file', () => {
    const local = document({
      uri: 'file:///device/schedule.pdf',
      isCurrent: false,
      updatedAt: '2026-07-20T12:00:00.000Z',
    });
    const cloud = document({
      storagePath: 'owner/schedules/schedule.pdf',
      isCurrent: true,
      updatedAt: '2026-07-20T13:00:00.000Z',
      cloudUpdatedAt: '2026-07-20T13:01:00.000Z',
    });

    expect(mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })).toEqual([expect.objectContaining({
      id: 'schedule-1',
      isCurrent: true,
      uri: 'file:///device/schedule.pdf',
      storagePath: 'owner/schedules/schedule.pdf',
    })]);
  });

  it('keeps newer offline user metadata but rejects legacy full-record current authority', () => {
    const local = document({
      name: 'Updated drawing name',
      notes: 'Added from the field while offline.',
      drawingDiscipline: 'Electrical',
      isCurrent: true,
      updatedAt: '2026-07-20T14:00:00.000Z',
    });
    const cloud = document({
      isCurrent: false,
      cloudUpdatedAt: '2026-07-20T13:00:00.000Z',
    });

    const merged = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })[0];

    expect(merged).toEqual(expect.objectContaining({
      name: 'Updated drawing name',
      notes: 'Added from the field while offline.',
      drawingDiscipline: 'Electrical',
      isCurrent: false,
    }));
  });

  it('preserves cloud ECOS preparation, Assurance, and proof fields over a newer offline edit', () => {
    const local = document({
      name: 'A2.01 - updated title',
      notes: 'Corrected discipline in the field.',
      drawingNumber: 'A2.01',
      drawingRevision: '4',
      drawingDiscipline: 'Architectural',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-07-20',
      uri: 'file:///device/a2.01.pdf',
      isCurrent: false,
      extractedText: 'stale local text',
      extractionStatus: 'pending',
      extractionMethod: null,
      extractionLimitations: ['stale local limitation'],
      documentIntelligenceVersion: null,
      documentVisualIndexVersion: null,
      ecosVerifiedIndexCommitVersion: null,
      ecosVerifiedIndexCommittedAt: null,
      ecosVerifiedIndexCommittedSha256: null,
      ecosVerifiedIndexCommittedPageCount: null,
      indexedAt: null,
      sourcePageCount: 0,
      searchablePageCount: 0,
      ocrPageCount: 0,
      extractionAverageConfidence: 0,
      indexedContentSha256: null,
      extractedPages: [],
      ecosHostedIndexStatus: 'Waiting',
      ecosHostedIndexProgressPercent: 5,
      ecosHostedIndexCustomerMessage: 'stale customer message',
      ecosHostedIndexLimitationCount: 9,
      ecosHostedIndexSupportReference: 'stale-support',
      ecosHostedIndexEvidenceVersion: null,
      ecosHostedIndexUpdatedAt: '2026-07-20T12:30:00.000Z',
      updatedAt: '2026-07-20T15:00:00.000Z',
    });
    const cloud = document({
      name: 'A2.01',
      notes: '',
      drawingNumber: 'A2.01',
      drawingRevision: '3',
      drawingDiscipline: 'Civil',
      drawingStatus: 'For Review',
      drawingIssuedAt: '2026-07-19',
      storagePath: 'owner/drawings/a2.01.pdf',
      isCurrent: true,
      webContentReview: 'Assurance passed.',
      webReport: { status: 'approved' },
      extractedText: 'verified cloud text',
      extractionStatus: 'complete',
      extractionMethod: 'embedded_text_and_ocr',
      extractionLimitations: [],
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedAt: '2026-07-20T13:20:00.000Z',
      ecosVerifiedIndexCommittedSha256: 'a'.repeat(64),
      ecosVerifiedIndexCommittedPageCount: 1,
      indexedAt: '2026-07-20T13:15:00.000Z',
      sourcePageCount: 1,
      searchablePageCount: 1,
      ocrPageCount: 1,
      extractionAverageConfidence: 0.98,
      indexedContentSha256: 'a'.repeat(64),
      extractedPages: [{
        pageNumber: 1,
        sheetNumber: 'A2.01',
        text: 'verified cloud page',
        regions: [],
      }],
      ecosHostedIndexStatus: 'Ready with limitations',
      ecosHostedIndexProgressPercent: 100,
      ecosHostedIndexCustomerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
      ecosHostedIndexLimitationCount: 2,
      ecosHostedIndexSupportReference: 'support-verified',
      ecosHostedIndexEvidenceVersion: 'ecos-evidence/3',
      ecosHostedIndexUpdatedAt: '2026-07-20T13:21:00.000Z',
      updatedAt: '2026-07-20T13:00:00.000Z',
      cloudUpdatedAt: '2026-07-20T13:30:00.000Z',
    });

    const merged = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })[0];

    expect(merged).toEqual(expect.objectContaining({
      // Legitimately newer user-controlled metadata remains editable offline.
      name: 'A2.01 - updated title',
      notes: 'Corrected discipline in the field.',
      drawingRevision: '4',
      drawingDiscipline: 'Architectural',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-07-20',
      uri: 'file:///device/a2.01.pdf',
      // Cloud/server authority always wins, even though the local timestamp is newer.
      isCurrent: true,
      webContentReview: 'Assurance passed.',
      webReport: { status: 'approved' },
      extractedText: 'verified cloud text',
      extractionStatus: 'complete',
      extractionMethod: 'embedded_text_and_ocr',
      extractionLimitations: [],
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedAt: '2026-07-20T13:20:00.000Z',
      ecosVerifiedIndexCommittedSha256: 'a'.repeat(64),
      ecosVerifiedIndexCommittedPageCount: 1,
      indexedAt: '2026-07-20T13:15:00.000Z',
      sourcePageCount: 1,
      searchablePageCount: 1,
      ocrPageCount: 1,
      extractionAverageConfidence: 0.98,
      indexedContentSha256: 'a'.repeat(64),
      ecosHostedIndexStatus: 'Ready with limitations',
      ecosHostedIndexProgressPercent: 100,
      ecosHostedIndexCustomerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
      ecosHostedIndexLimitationCount: 2,
      ecosHostedIndexSupportReference: 'support-verified',
      ecosHostedIndexEvidenceVersion: 'ecos-evidence/3',
      ecosHostedIndexUpdatedAt: '2026-07-20T13:21:00.000Z',
    }));
    expect(merged.extractedPages).toEqual(cloud.extractedPages);
  });

  it('fails closed when cloud hosted status is unavailable instead of trusting cached readiness', () => {
    const local = document({
      ecosHostedIndexStatus: 'Ready for ECOS',
      ecosHostedIndexProgressPercent: 100,
      ecosHostedIndexCustomerMessage: 'cached-message',
      ecosHostedIndexLimitationCount: 4,
      ecosHostedIndexSupportReference: 'cached-support',
      ecosHostedIndexEvidenceVersion: 'cached-evidence',
      ecosHostedIndexUpdatedAt: '2026-07-20T13:00:00.000Z',
      updatedAt: '2026-07-20T14:00:00.000Z',
    });
    const cloud = document({
      cloudUpdatedAt: '2026-07-20T13:30:00.000Z',
    });

    const merged = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })[0];

    expect(merged.ecosHostedIndexStatus).toBeUndefined();
    expect(merged.ecosHostedIndexProgressPercent).toBeUndefined();
    expect(merged.ecosHostedIndexCustomerMessage).toBeUndefined();
    expect(merged.ecosHostedIndexLimitationCount).toBeUndefined();
    expect(merged.ecosHostedIndexSupportReference).toBeUndefined();
    expect(merged.ecosHostedIndexEvidenceVersion).toBeUndefined();
    expect(merged.ecosHostedIndexUpdatedAt).toBeUndefined();
  });

  it('never restores a tombstoned schedule document', () => {
    expect(mergeDAVEReferenceDocumentRecoveryRecords({
      local: [document()],
      cloud: [document({ cloudUpdatedAt: '2026-07-20T13:00:00.000Z' })],
      deletedIds: ['schedule-1'],
    })).toEqual([]);
  });
});
