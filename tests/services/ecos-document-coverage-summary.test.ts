import { summarizeECOSDocumentCoverageRows } from '../../services/ECOSDocumentCoverageSummary';
import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from '../../services/ECOSDrawingVisualCoverage';

describe('ECOS document coverage summary', () => {
  it('counts unique indexed pages, complete visual coverage, and verified sheet mappings', () => {
    expect(summarizeECOSDocumentCoverageRows([
      {
        page_number: 1,
        sheet_number: 'C1',
        sheet_mapping_status: 'verified',
        visual_coverage: {
          overviewAnalyzed: true,
          requestedDeepReadRegionCount: 6,
          completedDeepReadRegionCount: 6,
          coverageComplete: true,
          completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
        },
      },
      {
        page_number: 2,
        sheet_number: null,
        sheet_mapping_status: 'conflicted',
        visual_coverage: {
          overviewAnalyzed: true,
          requestedDeepReadRegionCount: 6,
          completedDeepReadRegionCount: 2,
          coverageComplete: false,
        },
      },
      {
        page_number: 3,
        sheet_number: 'C3',
        sheet_mapping_status: 'unverified',
        visual_coverage: null,
      },
      { page_number: 0, sheet_mapping_status: 'verified' },
    ])).toEqual({
      indexedPageCount: 3,
      fullVisualCoveragePageCount: 1,
      verifiedSheetPageCount: 1,
      conflictedSheetPageCount: 1,
    });
  });

  it('does not double-count duplicate page rows', () => {
    expect(summarizeECOSDocumentCoverageRows([
      { page_number: 7, sheet_mapping_status: 'unverified' },
      {
        page_number: 7,
        sheet_number: 'A7',
        sheet_mapping_status: 'verified',
        visual_coverage: {
          overviewAnalyzed: true,
          requestedDeepReadRegionCount: 6,
          completedDeepReadRegionCount: 6,
          coverageComplete: true,
          completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
        },
      },
    ])).toEqual({
      indexedPageCount: 1,
      fullVisualCoveragePageCount: 1,
      verifiedSheetPageCount: 1,
      conflictedSheetPageCount: 0,
    });
  });

  it('does not trust a coverage-complete flag without all requested visual tiles', () => {
    expect(summarizeECOSDocumentCoverageRows([{
      page_number: 1,
      visual_coverage: {
        overviewAnalyzed: true,
        requestedDeepReadRegionCount: 6,
        completedDeepReadRegionCount: 5,
        coverageComplete: true,
      },
    }]).fullVisualCoveragePageCount).toBe(0);
  });
});
