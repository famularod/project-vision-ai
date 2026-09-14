import { buildECOSDocumentReadiness } from '../../services/ECOSDocumentReadiness';
import {
  ECOS_DRAWING_REQUIRED_TILE_KEYS,
  ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION,
  ECOS_DRAWING_VISUAL_EVIDENCE_VERSION,
} from '../../services/ECOSDrawingVisualCoverage';
import type { ReferenceDocument } from '../../types';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function completedVisualCoverage(pageNumber: number) {
  const bounds = [
    { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  ];
  const completedDeepReadRegionProofs = ECOS_DRAWING_REQUIRED_TILE_KEYS.map((tileKey, index) => {
    const regionId = `visual-tile-${tileKey}-word-${index}`;
    return {
      tileKey,
      bounds: bounds[index],
      state: 'completed' as const,
      pageNumber,
      sourceSha256: HASH_A,
      evidenceVersion: ECOS_DRAWING_VISUAL_EVIDENCE_VERSION,
      renderMethod: 'pymupdf_rgb_png',
      analysisMethod: 'tesseract_coordinate_ocr_psm11',
      renderDpi: 200,
      renderPixelWidth: 2400,
      renderPixelHeight: 1800,
      renderSha256: '1'.repeat(64),
      analysisInputSha256: '2'.repeat(64),
      analysisSha256: '3'.repeat(64),
      analysisRegionCount: 1,
      analysisRegionIds: [regionId],
      searchableRegionCount: 1,
      searchableRegionIds: [regionId],
    };
  });
  return {
    schemaVersion: ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION,
    evidenceVersion: ECOS_DRAWING_VISUAL_EVIDENCE_VERSION,
    sourceSha256: HASH_A,
    pageNumber,
    overviewAnalyzed: true,
    requestedDeepReadRegionCount: ECOS_DRAWING_REQUIRED_TILE_KEYS.length,
    completedDeepReadRegionCount: ECOS_DRAWING_REQUIRED_TILE_KEYS.length,
    coverageComplete: true,
    completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
    completedDeepReadRegionProofs,
    failureCodes: [],
  };
}

function drawing(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'drawing-a101',
    name: 'Life Safety Plan',
    originalFileName: 'A101.pdf',
    uri: '',
    category: 'Drawing',
    notes: '',
    isCurrent: false,
    importedAt: '2026-08-04T12:00:00.000Z',
    projectName: '2321 Compliance Project',
    drawingNumber: 'A101',
    drawingRevision: '4',
    drawingStatus: 'For Construction',
    extractionStatus: 'complete',
    extractionMethod: 'embedded_text',
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    sourcePageCount: 2,
    searchablePageCount: 2,
    extractedPages: [1, 2].map(pageNumber => ({
      pageNumber,
      sheetNumber: `A10${pageNumber}`,
      sheetMappingStatus: 'verified' as const,
      sheetMappingConfidence: 0.98,
      visualCoverage: completedVisualCoverage(pageNumber),
      text: `Page ${pageNumber} guardrail note`,
      regions: [{
        id: `page-${pageNumber}-line-1`,
        text: `Page ${pageNumber} guardrail note`,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        confidence: 0.98,
      }],
    })),
    ...overrides,
  };
}

describe('ECOS document readiness', () => {
  it('distinguishes an indexed prior revision from a current answer source', () => {
    expect(buildECOSDocumentReadiness(drawing())).toMatchObject({
      status: 'not_current',
      canMakeCurrent: true,
      eligibleForAnswers: false,
      pageCoveragePercent: 100,
    });
    expect(buildECOSDocumentReadiness(drawing({ isCurrent: true }))).toMatchObject({
      status: 'ready',
      label: 'Ready for ECOS',
      eligibleForAnswers: true,
    });
  });

  it('requires project and drawing-control metadata before activation', () => {
    const result = buildECOSDocumentReadiness(drawing({
      projectName: null,
      drawingNumber: null,
      drawingRevision: null,
      drawingStatus: null,
    }));
    expect(result.status).toBe('needs_metadata');
    expect(result.canMakeCurrent).toBe(false);
    expect(result.missingMetadata).toEqual(expect.arrayContaining([
      'a project assignment',
      'the drawing number',
      'the revision',
      'the issue status',
    ]));
  });

  it('fails closed when the index source hash is stale', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      contentSha256: HASH_A,
      indexedContentSha256: HASH_B,
    }))).toMatchObject({ status: 'stale', eligibleForAnswers: false });
  });

  it('requires focused title-block OCR re-indexing for older drawing indexes', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      documentIntelligenceVersion: 'ecos-document-intelligence/1.1',
    }))).toMatchObject({
      status: 'stale',
      label: 'Preparing for ECOS',
      eligibleForAnswers: false,
    });
  });

  it('requires automatic re-indexing for drawings created before Visual Index 3.0', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      documentVisualIndexVersion: null,
    }))).toMatchObject({
      status: 'stale',
      eligibleForAnswers: false,
    });
  });

  it('fails closed when a current drawing lacks complete visual coverage', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractionStatus: 'partial',
      sourcePageCount: 4,
      searchablePageCount: 2,
    }))).toMatchObject({
      status: 'pending',
      label: 'Preparing for ECOS',
      eligibleForAnswers: false,
      canMakeCurrent: false,
      pageCoveragePercent: 50,
    });
  });

  it('uses the protected page-table summary and keeps complete searchable evidence available with an explicit visual limitation', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractedPages: [],
      indexedContentSha256: HASH_A,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedAt: '2026-08-08T04:00:00.000Z',
      ecosVerifiedIndexCommittedSha256: HASH_A,
      ecosVerifiedIndexCommittedPageCount: 2,
    }), {
      indexedPageCount: 2,
      fullVisualCoveragePageCount: 1,
      verifiedSheetPageCount: 1,
      conflictedSheetPageCount: 0,
    })).toMatchObject({
      status: 'ready_with_limitations',
      label: 'Ready with visual limitations',
      eligibleForAnswers: true,
      canMakeCurrent: false,
      indexedPageCount: 2,
      fullVisualCoveragePageCount: 1,
      verifiedSheetPageCount: 1,
      conflictedSheetPageCount: 0,
      limitations: ['1 drawing page does not have complete high-resolution visual tile coverage.'],
    });
  });

  it('does not describe a fully searchable current drawing as unavailable when only visual tiles are incomplete', () => {
    const result = buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractedPages: [],
      indexedContentSha256: HASH_A,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedAt: '2026-08-08T04:00:00.000Z',
      ecosVerifiedIndexCommittedSha256: HASH_A,
      ecosVerifiedIndexCommittedPageCount: 2,
    }), {
      indexedPageCount: 2,
      fullVisualCoveragePageCount: 0,
      verifiedSheetPageCount: 0,
      conflictedSheetPageCount: 0,
    });

    expect(result).toMatchObject({
      status: 'ready_with_limitations',
      label: 'Ready with visual limitations',
      eligibleForAnswers: true,
      pageCoveragePercent: 100,
    });
    expect(result.detail).toContain('2 of 2 pages are searchable and available to Ask ECOS.');
    expect(result.detail).toContain('questions that depend only on unindexed visual details may remain limited.');
    expect(result.detail).not.toContain('ECOS will not use this drawing');
  });

  it('recognizes a transactionally committed cloud drawing index without inline page JSON', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractedPages: [],
      extractionStatus: 'complete',
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
      sourcePageCount: 8,
      searchablePageCount: 8,
      indexedContentSha256: HASH_A,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedAt: '2026-08-08T04:00:00.000Z',
      ecosVerifiedIndexCommittedSha256: HASH_A,
      ecosVerifiedIndexCommittedPageCount: 8,
    }))).toMatchObject({
      status: 'ready',
      label: 'Ready for ECOS',
      eligibleForAnswers: true,
      indexedPageCount: 8,
      searchablePageCount: 8,
      fullVisualCoveragePageCount: 8,
      pageCoveragePercent: 100,
    });
  });

  it('does not trust 2.0/3.0 version labels without a database commit marker', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractedPages: [],
      extractionStatus: 'complete',
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
      sourcePageCount: 8,
      searchablePageCount: 8,
    }))).toMatchObject({
      status: 'pending',
      eligibleForAnswers: false,
      fullVisualCoveragePageCount: 0,
    });
  });

  it('does not allow a superseded drawing to become an ECOS authority source', () => {
    expect(buildECOSDocumentReadiness(drawing({
      drawingStatus: 'Superseded',
    }))).toMatchObject({
      status: 'needs_metadata',
      canMakeCurrent: false,
      eligibleForAnswers: false,
      missingMetadata: ['an issue status other than Superseded'],
    });
  });

  it('allows a prepared prior revision to be activated without exposing it to answers', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: false,
      extractionStatus: 'pending',
      extractedPages: [],
      ecosHostedIndexStatus: 'Prepared',
    }))).toMatchObject({
      status: 'not_current',
      label: 'Prepared — not current',
      canMakeCurrent: true,
      eligibleForAnswers: false,
    });
  });

  it('keeps limited hosted evidence answer-eligible only when current and visibly review-required', () => {
    const limitedMessage = '2 accepted pages passed ECOS Assurance with review limitations.';
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: false,
      extractionStatus: 'pending',
      extractedPages: [],
      ecosHostedIndexStatus: 'Prepared with limitations',
      ecosHostedIndexCustomerMessage: limitedMessage,
      ecosHostedIndexLimitationCount: 2,
    }))).toMatchObject({
      status: 'not_current',
      label: 'Prepared with limitations — not current',
      canMakeCurrent: true,
      eligibleForAnswers: false,
      limitations: [limitedMessage],
    });
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractionStatus: 'pending',
      extractedPages: [],
      ecosHostedIndexStatus: 'Ready with limitations',
      ecosHostedIndexCustomerMessage: limitedMessage,
      ecosHostedIndexLimitationCount: 2,
    }))).toMatchObject({
      status: 'ready_with_limitations',
      label: 'Ready with limitations',
      canMakeCurrent: false,
      eligibleForAnswers: true,
      detail: limitedMessage,
      limitations: [limitedMessage],
    });
  });

  it('trusts hosted evidence only after the exact revision is current and activated', () => {
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractionStatus: 'pending',
      extractedPages: [],
      ecosHostedIndexStatus: 'Prepared',
    }))).toMatchObject({
      status: 'pending',
      label: 'Activating for ECOS',
      eligibleForAnswers: false,
    });
    expect(buildECOSDocumentReadiness(drawing({
      isCurrent: true,
      extractionStatus: 'pending',
      extractedPages: [],
      ecosHostedIndexStatus: 'Ready for ECOS',
    }))).toMatchObject({
      status: 'ready',
      label: 'Ready for ECOS',
      eligibleForAnswers: true,
    });
  });
});
