import { revokeCachedECOSDocumentAuthority } from '../../services/ECOSCachedDocumentAuthority';
import { buildECOSDocumentReadiness } from '../../services/ECOSDocumentReadiness';
import { reconcileECOSHostedIndexStatus } from '../../services/ECOSHostedIndexer';
import type { ReferenceDocument } from '../../types';

const SOURCE_SHA = 'a'.repeat(64);

function cachedReadyDrawing(): ReferenceDocument {
  return {
    id: 'drawing-1',
    projectId: 'project-1',
    projectName: 'Project 1',
    name: 'A101',
    originalFileName: 'A101.pdf',
    uri: '',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-09T12:00:00.000Z',
    drawingNumber: 'A101',
    drawingRevision: '1',
    drawingStatus: 'For Construction',
    extractionStatus: 'complete',
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    contentSha256: SOURCE_SHA,
    indexedContentSha256: SOURCE_SHA,
    sourcePageCount: 2,
    searchablePageCount: 2,
    extractedPages: [],
    ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
    ecosVerifiedIndexCommittedAt: '2026-08-09T12:00:00.000Z',
    ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
    ecosVerifiedIndexCommittedPageCount: 2,
    ecosHostedIndexStatus: 'Ready for ECOS',
    ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
    ecosHostedIndexUpdatedAt: '2026-08-09T12:00:00.000Z',
  };
}

describe('persisted ECOS document authority', () => {
  it('revokes cached Ready and commit proof until hosted authority is refreshed', () => {
    const [revoked] = revokeCachedECOSDocumentAuthority([cachedReadyDrawing()]);

    expect(revoked).toMatchObject({
      ecosHostedIndexStatus: 'Temporarily Unavailable',
      ecosVerifiedIndexCommitVersion: null,
      ecosVerifiedIndexCommittedAt: null,
      ecosVerifiedIndexCommittedSha256: null,
      ecosVerifiedIndexCommittedPageCount: null,
    });
    expect(buildECOSDocumentReadiness(revoked)).toMatchObject({
      eligibleForAnswers: false,
      label: 'Temporarily Unavailable',
    });
  });

  it('allows a later exact current Ready snapshot to restore answer eligibility', () => {
    const [revoked] = revokeCachedECOSDocumentAuthority([cachedReadyDrawing()]);
    const refreshed = reconcileECOSHostedIndexStatus(revoked, {
      documentId: 'drawing-1',
      projectId: 'project-1',
      state: 'ready',
      customerStatus: 'Ready for ECOS',
      completedPageCount: 2,
      sourcePageCount: 2,
      progressPercent: 100,
      customerMessage: null,
      limitationCount: 0,
      supportReference: 'support-1',
      committedEvidenceVersion: 'ecos-hosted-evidence/1.3',
      updatedAt: '2026-08-09T13:00:00.000Z',
      readyAt: '2026-08-09T13:00:00.000Z',
    }, 'available');

    expect(buildECOSDocumentReadiness(refreshed)).toMatchObject({
      eligibleForAnswers: true,
      label: 'Ready for ECOS',
    });
  });
});
