import { buildECOSDocumentReindexPlan } from '../../services/ECOSDocumentReindexPlan';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from '../../services/ECOSDrawingVisualCoverage';

function drawing(
  id: string,
  overrides: Partial<DAVEWebReferenceDocument> = {},
): DAVEWebReferenceDocument {
  return {
    id,
    name: `${id}.pdf`,
    originalFileName: `${id}.pdf`,
    uri: '',
    category: 'Drawing',
    notes: '',
    isCurrent: false,
    importedAt: '2026-08-04T12:00:00.000Z',
    projectName: '2375 Compliance Project',
    drawingNumber: id,
    drawingRevision: '1',
    drawingStatus: 'For Construction',
    extractionStatus: 'complete',
    documentIntelligenceVersion: 'ecos-document-intelligence/1.1',
    storagePath: `documents/${id}.pdf`,
    cloudUpdatedAt: null,
    linkedScheduleItems: [],
    ...overrides,
  };
}

describe('ECOS automatic document re-index plan', () => {
  it('limits a requested plan to the selected project', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('2321', { projectName: '2321 Compliance Project' }),
      drawing('2375', { projectName: '2375 Compliance Project' }),
      drawing('shared', {
        projectName: null,
        projectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      }),
    ], '2375 Compliance Project');

    expect(plan.map(document => document.id)).toEqual(['2375', 'shared']);
  });

  it('includes stale, failed, and pending documents that retain a protected source', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('stale-storage'),
      drawing('failed-drive', {
        extractionStatus: 'failed',
        documentIntelligenceVersion: 'ecos-document-intelligence/1.5',
        storagePath: null,
        sourceProvider: 'google_drive',
        externalSource: {
          provider: 'google_drive',
          fileId: 'drive-file-1',
          name: 'failed-drive.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4,
          modifiedTime: null,
          revisionId: null,
          md5Checksum: null,
          resourceKey: null,
          webViewLink: null,
        },
      }),
      drawing('pending-storage', {
        extractionStatus: 'pending',
        documentIntelligenceVersion: 'ecos-document-intelligence/1.5',
      }),
    ]);

    expect(plan.map(document => document.id)).toEqual([
      'failed-drive',
      'pending-storage',
      'stale-storage',
    ]);
  });

  it('excludes schedules, current indexes, missing sources, unsupported files, and incomplete metadata', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('schedule', { category: 'Schedules', name: 'Three Week Lookahead' }),
      drawing('current-index', {
        documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
        documentVisualIndexVersion: 'ecos-visual-index/3.0',
        extractionStatus: 'complete',
        sourcePageCount: 1,
        searchablePageCount: 1,
        extractedPages: [{
          pageNumber: 1,
          sheetNumber: 'A101',
          sheetMappingStatus: 'verified',
          sheetMappingConfidence: 0.99,
          text: 'Searchable',
          regions: [],
          visualCoverage: {
            overviewAnalyzed: true,
            requestedDeepReadRegionCount: 6,
            completedDeepReadRegionCount: 6,
            coverageComplete: true,
            completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
          },
        }],
      }),
      drawing('missing-source', { storagePath: null }),
      drawing('unsupported', {
        documentIntelligenceVersion: 'ecos-document-intelligence/1.5',
        extractionStatus: 'not_supported',
      }),
      drawing('missing-metadata', { drawingNumber: null }),
    ]);

    expect(plan).toEqual([]);
  });

  it('does not requeue a transactionally committed cloud drawing whose pages are stored outside the document JSON', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('committed-cloud-index', {
        isCurrent: true,
        documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
        documentVisualIndexVersion: 'ecos-visual-index/3.0',
        extractionStatus: 'complete',
        sourcePageCount: 8,
        searchablePageCount: 8,
        extractedPages: [],
        indexedContentSha256: 'a'.repeat(64),
        ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
        ecosVerifiedIndexCommittedAt: '2026-08-08T04:00:00.000Z',
        ecosVerifiedIndexCommittedSha256: 'a'.repeat(64),
        ecosVerifiedIndexCommittedPageCount: 8,
      }),
    ]);

    expect(plan).toEqual([]);
  });

  it.each(['Waiting', 'Preparing', 'Prepared', 'Ready for ECOS'] as const)(
    'keeps %s hosted preparation out of the legacy browser re-index plan',
    hostedStatus => {
      expect(buildECOSDocumentReindexPlan([
        drawing(`hosted-${hostedStatus}`, { ecosHostedIndexStatus: hostedStatus }),
      ])).toEqual([]);
    },
  );

  it('automatically repairs current v2 drawings whose visual tile coverage is incomplete', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('current-partial-visual', {
        isCurrent: true,
        documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
        documentVisualIndexVersion: 'ecos-visual-index/3.0',
        extractionStatus: 'partial',
        sourcePageCount: 1,
        searchablePageCount: 1,
        extractedPages: [{
          pageNumber: 1,
          sheetNumber: 'C6',
          sheetMappingStatus: 'verified',
          sheetMappingConfidence: 0.98,
          text: 'CONSTRUCT 6 INCH THICK PCC',
          regions: [],
          visualCoverage: {
            overviewAnalyzed: true,
            requestedDeepReadRegionCount: 6,
            completedDeepReadRegionCount: 4,
            coverageComplete: false,
            completedDeepReadRegionKeys: ['0:0:333:500'],
          },
        }],
      }),
      drawing('prior-partial-visual', {
        isCurrent: false,
        documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
        documentVisualIndexVersion: 'ecos-visual-index/3.0',
        extractionStatus: 'partial',
        sourcePageCount: 1,
        searchablePageCount: 1,
        extractedPages: [{
          pageNumber: 1,
          text: 'Prior revision',
          regions: [],
          visualCoverage: {
            overviewAnalyzed: true,
            requestedDeepReadRegionCount: 6,
            completedDeepReadRegionCount: 0,
            coverageComplete: false,
          },
        }],
      }),
    ]);

    expect(plan.map(document => document.id)).toEqual(['current-partial-visual']);
  });

  it('commits current and smaller drawing sets first so useful indexes become available sooner', () => {
    const plan = buildECOSDocumentReindexPlan([
      drawing('large-current', { isCurrent: true, sourcePageCount: 30, sizeBytes: 3_000_000 }),
      drawing('small-prior', { isCurrent: false, sourcePageCount: 2, sizeBytes: 500_000 }),
      drawing('small-current', { isCurrent: true, sourcePageCount: 8, sizeBytes: 4_000_000 }),
      drawing('medium-current', { isCurrent: true, sourcePageCount: 12, sizeBytes: 2_000_000 }),
    ]);

    expect(plan.map(document => document.id)).toEqual([
      'small-current',
      'medium-current',
      'large-current',
      'small-prior',
    ]);
  });
});
