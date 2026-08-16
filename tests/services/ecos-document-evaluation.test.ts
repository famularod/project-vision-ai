import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { askDAVE } from '../../services/DAVEAsk';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import {
  ECOS_DRAWING_REQUIRED_TILE_KEYS,
  ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION,
  ECOS_DRAWING_VISUAL_EVIDENCE_VERSION,
} from '../../services/ECOSDrawingVisualCoverage';
import type { ReferenceDocument, ReferenceDocumentExtractedPage } from '../../types';
import { buildMinimalRealPdf } from '../fixtures/minimal-real-pdf';
import { computeECOSPageGraphSha256 } from '../../services/ECOSHostedPageGraphAuthority';

async function indexedDrawing({
  id,
  revision,
  current,
  requirement,
}: {
  id: string;
  revision: string;
  current: boolean;
  requirement: string;
}): Promise<ReferenceDocument> {
  const bytes = buildMinimalRealPdf([
    'LIFE SAFETY PLAN - NORTH LOT PARKING AREA',
    requirement,
    'Coordinate work with architectural and civil requirements before installation.',
    'For construction use only. Verify dimensions in the field before starting work.',
    'SHEET: Sheet A101',
  ]);
  const sourceSha256 = revision.repeat(64).slice(0, 64);
  const extractedPages = extractActualPdfPages(bytes).map(page => {
    const regions = (page.regions ?? []).map(region => {
      const isSheetIdentity = /\bA\s*[-]?\s*101\b/i.test(region.text || region.label || '');
      return {
        ...region,
        searchable: true,
        ...(isSheetIdentity ? {
          source: 'ocr' as const,
          rawSource: 'sheet_identity_ocr_page_bound_validated',
        } : {}),
        corroboratingEvidence: [{
          id: `rendered-ocr:${region.id}`,
          text: region.text || region.label || '',
          source: 'ocr',
          confidence: 0.99,
          bounds: {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          },
        }],
      };
    });
    const identityRegion = regions.find(region =>
      region.rawSource === 'sheet_identity_ocr_page_bound_validated'
    );
    if (!identityRegion) throw new Error('The real PDF fixture did not expose its rendered A101 identity.');
    const sheetEvidence = [{
      id: 'bookmark:1:A101',
      pageNumber: 1,
      source: 'pdf_bookmark' as const,
      text: 'A03-A101',
      normalizedBounds: null,
      renderedCorroborated: true as const,
      renderedCorroboratingRegionIds: [identityRegion.id],
      renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
    }];
    return {
      ...page,
      regions,
      sheetNumber: 'A101',
      sheetMappingStatus: 'verified' as const,
      sheetMappingConfidence: 0.99,
      sheetMappingSource: 'pdf_bookmark' as const,
      sheetMappingEvidence: sheetEvidence,
      documentStructuralIdentity: {
        sheetNumber: 'A101',
        source: 'pdf_bookmark' as const,
        evidence: sheetEvidence,
      },
      assurance: {
        accepted: true,
        method: 'ecos-assurance/1.0',
        evidenceVersion: 'ecos-hosted-evidence/1.3',
        checks: { sheetMappingUsable: true },
        failureCodes: [],
      },
      visualCoverage: completedVisualCoverage(page.pageNumber, sourceSha256),
    };
  });
  const extractedText = extractedPages.map(page => page.text || '').join('\n\n').trim();
  const document: ReferenceDocument = {
    id,
    name: `A101 Life Safety Plan Rev ${revision}`,
    originalFileName: `A101-Rev-${revision}.pdf`,
    uri: '',
    mimeType: 'application/pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: current,
    importedAt: '2026-08-04T12:00:00.000Z',
    projectId: 'project-2321',
    projectName: '2321 Compliance Project',
    drawingNumber: 'A101',
    drawingRevision: revision,
    drawingStatus: current ? 'For Construction' : 'Superseded',
    contentSha256: sourceSha256,
    extractedText,
    extractedPages,
    extractionStatus: 'complete',
    extractionMethod: 'embedded_text',
    extractionLimitations: [],
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    indexedAt: '2026-08-04T12:01:00.000Z',
    sourcePageCount: 1,
    searchablePageCount: 1,
    ocrPageCount: 0,
    extractionAverageConfidence: 1,
    indexedContentSha256: sourceSha256,
  };
  document.ecosVerifiedIndexCommitVersion = 'ecos-verified-index-commit/1.0';
  document.ecosVerifiedIndexCommittedSha256 = sourceSha256;
  document.ecosVerifiedIndexCommittedPageCount = extractedPages.length;
  document.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(extractedPages);
  return document;
}

function completedVisualCoverage(pageNumber: number, sourceSha256: string) {
  const bounds = [
    { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  ];
  return {
    schemaVersion: ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION,
    evidenceVersion: ECOS_DRAWING_VISUAL_EVIDENCE_VERSION,
    sourceSha256,
    pageNumber,
    overviewAnalyzed: true,
    requestedDeepReadRegionCount: ECOS_DRAWING_REQUIRED_TILE_KEYS.length,
    completedDeepReadRegionCount: ECOS_DRAWING_REQUIRED_TILE_KEYS.length,
    coverageComplete: true,
    completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
    completedDeepReadRegionProofs: ECOS_DRAWING_REQUIRED_TILE_KEYS.map((tileKey, index) => {
      const regionId = `visual-tile-${tileKey}-word-${index}`;
      return {
        tileKey,
        bounds: bounds[index],
        state: 'completed' as const,
        pageNumber,
        sourceSha256,
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
    }),
    failureCodes: [],
  };
}

function extractActualPdfPages(bytes: Uint8Array): ReferenceDocumentExtractedPage[] {
  const reader = path.resolve(process.cwd(), 'tests/fixtures/read-real-pdf.mjs');
  const result = spawnSync(process.execPath, [reader, Buffer.from(bytes).toString('base64')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Real PDF evaluation reader failed: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as { pages: ReferenceDocumentExtractedPage[] };
  return parsed.pages;
}

describe('ECOS real-PDF document evaluation library', () => {
  it('answers paraphrases only from the current revision with an exact sheet/page citation', async () => {
    const oldRevision = await indexedDrawing({
      id: 'a101-r3',
      revision: '3',
      current: false,
      requirement: 'Provide painted wood guardrails at open parking edges.',
    });
    const currentRevision = await indexedDrawing({
      id: 'a101-r4',
      revision: '4',
      current: true,
      requirement: 'Provide galvanized steel guardrails at every open parking edge.',
    });
    const intelligence = buildProjectIntelligence({
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      updates: [],
      documents: [],
      scheduleItems: [],
      referenceDocuments: [oldRevision, currentRevision],
      now: '2026-08-04T13:00:00.000Z',
    });

    const answer = askDAVE({
      question: 'What barrier material must protect the edge of the vehicle parking area?',
      intelligence,
    });

    expect(answer.answer).toContain('galvanized steel guardrails');
    expect(answer.answer).not.toContain('painted wood');
    expect(answer.supportingEvidence[0]?.documentCitation).toMatchObject({
      documentId: 'a101-r4',
      revision: '4',
      pageNumber: 1,
      sheetNumber: 'A101',
    });
    expect(answer.supportingEvidence[0]?.documentRegion).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    }));
  });

  it('refuses an unrelated fact that does not exist in the current drawing', async () => {
    const currentRevision = await indexedDrawing({
      id: 'a101-r4',
      revision: '4',
      current: true,
      requirement: 'Provide galvanized steel guardrails at every open parking edge.',
    });
    const intelligence = buildProjectIntelligence({
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      updates: [],
      documents: [],
      scheduleItems: [],
      referenceDocuments: [currentRevision],
      now: '2026-08-04T13:00:00.000Z',
    });

    const answer = askDAVE({
      question: 'What is the approved elevator manufacturer and model number?',
      intelligence,
    });

    expect(answer.answer).toContain("don't have enough current project information");
    expect(answer.supportingEvidence).toEqual([]);
  });
});
