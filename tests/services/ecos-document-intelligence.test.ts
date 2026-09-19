import { askDAVE } from '../../services/DAVEAsk';
import {
  answerECOSDocumentQuestion,
  assureECOSDocumentEvidence,
  retrieveECOSDocumentEvidence,
} from '../../services/ECOSDocumentIntelligence';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from '../../services/ECOSDrawingVisualCoverage';
import type { ReferenceDocument } from '../../types';

const SOURCE_SHA = 'a'.repeat(64);

function completedVisualCoverage(pageNumber: number) {
  const bounds = [
    { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  ];
  return {
    schemaVersion: 'ecos-visual-coverage/1.0',
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    sourceSha256: SOURCE_SHA,
    pageNumber,
    overviewAnalyzed: true,
    requestedDeepReadRegionCount: 6,
    completedDeepReadRegionCount: 6,
    coverageComplete: true,
    completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
    completedDeepReadRegionProofs: ECOS_DRAWING_REQUIRED_TILE_KEYS.map((tileKey, index) => {
      const regionId = `visual-tile-${tileKey}-word-${index}`;
      return {
        tileKey,
        bounds: bounds[index],
        state: 'completed' as const,
        pageNumber,
        sourceSha256: SOURCE_SHA,
        evidenceVersion: 'ecos-hosted-evidence/1.3',
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

function verifiedBookmark(pageNumber: number, sheetNumber: string) {
  const evidence = [{
    id: `bookmark-${pageNumber}-${sheetNumber}`,
    pageNumber,
    source: 'pdf_bookmark' as const,
    text: sheetNumber,
    normalizedBounds: null,
  }];
  return {
    sheetMappingSource: 'pdf_bookmark' as const,
    sheetMappingEvidence: evidence,
    documentStructuralIdentity: {
      sheetNumber,
      source: 'pdf_bookmark' as const,
      evidence,
    },
    assurance: {
      accepted: true,
      method: 'ecos-assurance-test/1.0',
      checks: { sheetMappingUsable: true },
      failureCodes: [],
    },
  };
}

function drawing(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'drawing-a101',
    name: 'Architectural Life Safety Plan',
    originalFileName: 'A101.pdf',
    uri: 'file:///A101.pdf',
    mimeType: 'application/pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-04T12:00:00.000Z',
    projectId: 'project-2321',
    projectName: '2321 Compliance Project',
    drawingNumber: 'A101',
    drawingRevision: '4',
    drawingStatus: 'For Construction',
    extractionStatus: 'complete',
    extractionMethod: 'embedded_text',
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    extractedText: 'Provide galvanized steel guardrails at all open parking edges.',
    extractedPages: [{
      pageNumber: 3,
      sheetNumber: 'A101',
      sheetMappingStatus: 'verified',
      ...verifiedBookmark(3, 'A101'),
      sheetMappingConfidence: 0.99,
      visualCoverage: completedVisualCoverage(3),
      title: 'LIFE SAFETY PLAN',
      text: 'Provide galvanized steel guardrails at all open parking edges.',
      regions: [{
        id: 'a101-note-7',
        label: 'Guardrail note',
        text: 'Provide galvanized steel guardrails at all open parking edges.',
        areaNames: ['North Lot'],
        x: 0.14,
        y: 0.22,
        width: 0.38,
        height: 0.06,
        confidence: 0.99,
        source: 'embedded_text',
      }],
    }],
    ...overrides,
  };
}

describe('ECOS document intelligence', () => {
  it('retrieves and independently verifies exact current-revision page evidence', () => {
    const document = drawing();
    const candidates = retrieveECOSDocumentEvidence({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [document],
    });
    const assured = assureECOSDocumentEvidence({ candidates, documents: [document] });

    expect(assured).toHaveLength(1);
    expect(assured[0].citation).toMatchObject({
      documentId: 'drawing-a101',
      revision: '4',
      pageNumber: 3,
      sheetNumber: 'A101',
      regionId: 'a101-note-7',
    });
    expect(assured[0].region).toMatchObject({ x: 0.14, y: 0.22, width: 0.38, height: 0.06 });
  });

  it('rejects superseded sources and fabricated citations', () => {
    const current = drawing();
    expect(retrieveECOSDocumentEvidence({
      question: 'guardrails at parking edges',
      documents: [drawing({ id: 'old', isCurrent: false })],
    })).toEqual([]);

    const assured = assureECOSDocumentEvidence({
      documents: [current],
      candidates: [{
        documentId: current.id,
        pageNumber: 3,
        sheetNumber: 'A101',
        regionId: 'a101-note-7',
        excerpt: 'Install a concrete barrier at every edge.',
        score: 1,
        queryCoverage: 1,
        extractionConfidence: 1,
      }],
    });
    expect(assured).toEqual([]);
  });

  it('answers Talk questions with exact document citations and proof coordinates', () => {
    const document = drawing();
    const intelligence = buildProjectIntelligence({
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      updates: [],
      documents: [],
      scheduleItems: [],
      referenceDocuments: [document],
      now: '2026-08-04T13:00:00.000Z',
    });
    const result = askDAVE({
      question: 'What guardrail protection is required at the parking edge?',
      intelligence,
    });

    expect(result.answer).toContain('Provide galvanized steel guardrails');
    expect(result.supportingEvidence[0]).toMatchObject({
      sourceType: 'document',
      recordId: document.id,
      excerpt: 'Provide galvanized steel guardrails at all open parking edges.',
      documentCitation: {
        documentId: document.id,
        pageNumber: 3,
        sheetNumber: 'A101',
        regionId: 'a101-note-7',
      },
      documentRegion: { id: 'a101-note-7' },
      documentProvenance: {
        sheetNumber: 'A101',
        sheetMappingStatus: 'verified',
        sheetMappingSource: 'pdf_bookmark',
      },
    });
    expect(result.navigationTargets[0]?.target).toBe('project_documents');
  });

  it('warns when answers rely on OCR', () => {
    const result = answerECOSDocumentQuestion({
      question: 'guardrails at parking edges',
      documents: [drawing({
        extractionMethod: 'local_ocr',
        extractedPages: [{
          ...drawing().extractedPages![0],
          regions: [{
            ...drawing().extractedPages![0].regions![0],
            confidence: 0.7,
            source: 'ocr',
          }],
        }],
      })],
    });
    expect(result?.limitations.join(' ')).toContain('OCR');
    expect(result?.confidence).toBe('medium');
  });

  it('follows an explicit cross-sheet reference while preserving both exact citations', () => {
    const source = drawing({
      extractedPages: [
        {
          pageNumber: 1,
          sheetNumber: 'A101',
          sheetMappingStatus: 'verified',
          ...verifiedBookmark(1, 'A101'),
          sheetMappingConfidence: 0.99,
          visualCoverage: completedVisualCoverage(1),
          text: 'North Lot parking edge. See Sheet A102 for guardrail requirements.',
          regions: [{
            id: 'a101-cross-reference',
            text: 'North Lot parking edge. See Sheet A102 for guardrail requirements.',
            x: 0.1,
            y: 0.2,
            width: 0.55,
            height: 0.05,
            confidence: 0.99,
            source: 'embedded_text',
          }],
        },
        {
          pageNumber: 2,
          sheetNumber: 'A102',
          sheetMappingStatus: 'verified',
          ...verifiedBookmark(2, 'A102'),
          sheetMappingConfidence: 0.99,
          visualCoverage: completedVisualCoverage(2),
          text: 'Provide galvanized steel guardrails at every open parking edge.',
          regions: [{
            id: 'a102-guardrail-note',
            text: 'Provide galvanized steel guardrails at every open parking edge.',
            x: 0.2,
            y: 0.3,
            width: 0.5,
            height: 0.05,
            confidence: 0.99,
            source: 'embedded_text',
          }],
        },
      ],
      sourcePageCount: 2,
      searchablePageCount: 2,
    });

    const answer = answerECOSDocumentQuestion({
      question: 'What barrier is required at the North Lot parking edge?',
      documents: [source],
    });

    expect(answer?.evidence.map(item => item.citation.sheetNumber)).toEqual(expect.arrayContaining(['A101', 'A102']));
    expect(answer?.answer).toContain('galvanized steel guardrails');
  });
});
