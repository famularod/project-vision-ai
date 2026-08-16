import { askDAVE } from '../../services/DAVEAsk';
import {
  answerECOSDocumentQuestion,
  assureECOSDocumentEvidence,
  retrieveECOSDocumentEvidence,
} from '../../services/ECOSDocumentIntelligence';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from '../../services/ECOSDrawingVisualCoverage';
import type { ReferenceDocument } from '../../types';
import { computeECOSPageGraphSha256 } from '../../services/ECOSHostedPageGraphAuthority';

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
    text: `A${String(pageNumber).padStart(2, '0')}-${sheetNumber}`,
    normalizedBounds: null,
    renderedCorroborated: true as const,
    renderedCorroboratingRegionIds: [`sheet-identity-${pageNumber}-${sheetNumber}`],
    renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
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

function renderedSheetIdentityRegion(pageNumber: number, sheetNumber: string) {
  return {
    id: `sheet-identity-${pageNumber}-${sheetNumber}`,
    text: sheetNumber,
    searchable: true,
    x: 0.82,
    y: 0.9,
    width: 0.12,
    height: 0.04,
    confidence: 0.99,
    source: 'ocr' as const,
    rawSource: 'sheet_identity_ocr_page_bound_validated',
    corroboratingEvidence: [],
  };
}

function drawing(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  const document: ReferenceDocument = {
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
    contentSha256: SOURCE_SHA,
    indexedContentSha256: SOURCE_SHA,
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
        corroboratingEvidence: [{
          id: 'a101-note-7-ocr',
          text: 'Provide galvanized steel guardrails at all open parking edges.',
          source: 'ocr',
          confidence: 0.96,
          bounds: { x: 0.14, y: 0.22, width: 0.38, height: 0.06 },
        }],
      }, renderedSheetIdentityRegion(3, 'A101')],
    }],
    ...overrides,
  };
  document.ecosVerifiedIndexCommitVersion = 'ecos-verified-index-commit/1.0';
  document.ecosVerifiedIndexCommittedSha256 = document.contentSha256;
  document.ecosVerifiedIndexCommittedPageCount = document.extractedPages?.length ?? 0;
  document.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(
    document.extractedPages,
  );
  return document;
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

  it('rejects every page after an extracted graph mutation reuses an old receipt', () => {
    const committed = drawing();
    const mutated: ReferenceDocument = {
      ...committed,
      extractedPages: committed.extractedPages!.map(page => ({
        ...page,
        text: 'Install an attacker-controlled 12-inch concrete slab.',
        regions: (page.regions ?? []).map((region, index) => index === 0
          ? {
              ...region,
              text: 'Install an attacker-controlled 12-inch concrete slab.',
              label: 'Forged slab requirement',
            }
          : region),
      })),
    };

    expect(retrieveECOSDocumentEvidence({
      question: 'What concrete slab must be installed?',
      documents: [mutated],
    })).toEqual([]);
    expect(answerECOSDocumentQuestion({
      question: 'What concrete slab must be installed?',
      documents: [mutated],
    })).toBeNull();
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

  it('rejects hashless local evidence until exact source and index hashes match', () => {
    const hashless = drawing({ contentSha256: null, indexedContentSha256: null });
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [hashless],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).toBeNull();

    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [drawing()],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).not.toBeNull();
  });

  it('rejects explicit project-id mismatches even when project names are equal', () => {
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [drawing({ projectId: 'project-other' })],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).toBeNull();
  });

  it('preserves hosted Assurance limitations and qualifies the answer', () => {
    const limitation = 'One accepted page needs review before field use.';
    const answer = answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [drawing({
        ecosHostedIndexStatus: 'Ready with limitations',
        ecosHostedIndexCustomerMessage: limitation,
        ecosHostedIndexLimitationCount: 1,
      })],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    });
    expect(answer?.limitations).toContain(limitation);
    expect(answer?.confidence).not.toBe('high');
  });

  it('rejects uncorroborated embedded text but accepts matching OCR corroboration', () => {
    const page = drawing().extractedPages![0];
    const uncorroborated = drawing({
      extractedPages: [{
        ...page,
        regions: page.regions!.map(region => ({ ...region, corroboratingEvidence: [] })),
      }],
    });
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [uncorroborated],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).toBeNull();
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [drawing()],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).not.toBeNull();
  });

  it('rejects same-text OCR from a different page region as embedded-text corroboration', () => {
    const page = drawing().extractedPages![0];
    const spatiallyMismatched = drawing({
      extractedPages: [{
        ...page,
        regions: page.regions!.map(region => ({
          ...region,
          corroboratingEvidence: region.corroboratingEvidence!.map(evidence => ({
            ...evidence,
            bounds: { x: 0.72, y: 0.74, width: 0.2, height: 0.05 },
          })),
        })),
      }],
    });

    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [spatiallyMismatched],
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
    })).toBeNull();
  });

  it.each([
    ['one-character substring', { text: 'g', confidence: 0.96, bounds: { x: 0.14, y: 0.22, width: 0.38, height: 0.06 } }],
    ['short numeric substring', { text: '2', confidence: 0.96, bounds: { x: 0.14, y: 0.22, width: 0.38, height: 0.06 } }],
    ['tiny OCR box', { text: 'Provide galvanized steel guardrails at all open parking edges.', confidence: 0.96, bounds: { x: 0.2, y: 0.24, width: 0.01, height: 0.005 } }],
    ['missing OCR confidence', { text: 'Provide galvanized steel guardrails at all open parking edges.', confidence: null, bounds: { x: 0.14, y: 0.22, width: 0.38, height: 0.06 } }],
  ])('rejects %s as embedded-text visual corroboration', (_label, evidenceOverride) => {
    const page = drawing().extractedPages![0];
    const adversarial = drawing({
      extractedPages: [{
        ...page,
        regions: page.regions!.map(region => ({
          ...region,
          corroboratingEvidence: region.corroboratingEvidence!.map(evidence => ({
            ...evidence,
            ...evidenceOverride,
          })),
        })),
      }],
    });
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [adversarial],
      projectId: 'project-2321',
    })).toBeNull();
  });

  it('accepts a near-full visible OCR match with bounded aligned geometry', () => {
    const page = drawing().extractedPages![0];
    const corroborated = drawing({
      extractedPages: [{
        ...page,
        regions: page.regions!.map(region => ({
          ...region,
          corroboratingEvidence: region.corroboratingEvidence!.map(evidence => ({
            ...evidence,
            text: 'PROVIDE galvanized steel guardrails at all open parking edges',
            bounds: { x: 0.13, y: 0.215, width: 0.4, height: 0.065 },
          })),
        })),
      }],
    });
    expect(answerECOSDocumentQuestion({
      question: 'What guardrail protection is required at the parking edge?',
      documents: [corroborated],
      projectId: 'project-2321',
    })).not.toBeNull();
  });

  it('does not let hidden uncorroborated embedded text steer cross-sheet retrieval', () => {
    const source = drawing({
      extractedPages: [
        {
          pageNumber: 1,
          sheetNumber: 'A101',
          sheetMappingStatus: 'verified',
          ...verifiedBookmark(1, 'A101'),
          sheetMappingConfidence: 0.99,
          visualCoverage: completedVisualCoverage(1),
          text: 'North Lot basement waterproofing membrane. See Sheet A102 for requirements.',
          regions: [{
            id: 'hidden-cross-reference',
            text: 'North Lot basement waterproofing membrane. See Sheet A102 for requirements.',
            x: 0.1,
            y: 0.2,
            width: 0.6,
            height: 0.05,
            confidence: 0.99,
            source: 'embedded_text',
            corroboratingEvidence: [],
          }, renderedSheetIdentityRegion(1, 'A101')],
        },
        {
          pageNumber: 2,
          sheetNumber: 'A102',
          sheetMappingStatus: 'verified',
          ...verifiedBookmark(2, 'A102'),
          sheetMappingConfidence: 0.99,
          visualCoverage: completedVisualCoverage(2),
          text: 'Use system type X.',
          regions: [{
            id: 'visible-target',
            text: 'Use system type X.',
            x: 0.2,
            y: 0.3,
            width: 0.3,
            height: 0.05,
            confidence: 0.99,
            source: 'ocr',
          }, renderedSheetIdentityRegion(2, 'A102')],
        },
      ],
      sourcePageCount: 2,
      searchablePageCount: 2,
    });
    const candidates = retrieveECOSDocumentEvidence({
      question: 'What waterproofing membrane is required at the North Lot basement?',
      documents: [source],
    });
    expect(candidates.some(candidate => candidate.regionId === 'visible-target')).toBe(false);
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
            source: 'ocr',
          }, renderedSheetIdentityRegion(1, 'A101')],
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
            source: 'ocr',
          }, renderedSheetIdentityRegion(2, 'A102')],
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
