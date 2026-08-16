import { File as NodeFile } from 'node:buffer';
import {
  analyzeECOSDrawingVisualBatchWithRecovery,
  copyECOSPdfBytesForWorker,
  detectECOSSheetNumber,
  ECOSDocumentExtractionCancelledError,
  extractECOSWebDocument,
  mergeECOSPdfTextItems,
  normalizeECOSConstructionMeasurementText,
  normalizedECOSPdfTextRegion,
  selectECOSDeepReadRegions,
  shouldRunECOSTitleBlockOCR,
  shouldRunECOSConstructionNoteOCR,
  shouldSupplementECOSPdfPageWithOCR,
  type ECOSDrawingPageAnalyzer,
} from '../../services/ECOSWebDocumentExtraction';
import { ECOSDrawingPageAnalysisError } from '../../services/ECOSDrawingPageAnalysis';

describe('ECOS web document extraction', () => {
  it('analyzes a bounded six-tile page as two parallel independently assured groups', async () => {
    const tiles = Array.from({ length: 6 }, (_, index) => ({
      bounds: { x: (index % 3) / 3, y: index < 3 ? 0 : 0.5, width: 1 / 3, height: 0.5 },
      imageDataUrl: `data:image/jpeg;base64,tile-${index}`,
    }));
    let activeAnalysisCount = 0;
    let maximumActiveAnalysisCount = 0;
    const analyzeDrawingPage = jest.fn(async (input: Parameters<ECOSDrawingPageAnalyzer>[0]) => {
      activeAnalysisCount += 1;
      maximumActiveAnalysisCount = Math.max(maximumActiveAnalysisCount, activeAnalysisCount);
      await Promise.resolve();
      activeAnalysisCount -= 1;
      return {
        regions: (input.tileImages || []).map((tile, index) => ({
          id: `fact-${index}`,
          label: 'Verified fact',
          text: 'Verified fact',
          areaNames: [],
          x: tile.bounds.x + 0.01,
          y: tile.bounds.y + 0.01,
          width: 0.1,
          height: 0.1,
          confidence: 0.99,
          source: 'vision' as const,
        })),
        deepReadRegions: [],
      };
    });

    const result = await analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage,
      pageNumber: 41,
      existingText: 'Dense architectural page',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: tiles,
    });

    expect(analyzeDrawingPage).toHaveBeenCalledTimes(2);
    expect(analyzeDrawingPage.mock.calls.every(([input]) =>
      input.analysisPass === 'page_tiles' &&
      input.imageDataUrl === 'data:image/jpeg;base64,overview' &&
      input.tileImages?.length === 3,
    )).toBe(true);
    expect(maximumActiveAnalysisCount).toBe(2);
    expect(result.regions).toHaveLength(6);
  });

  it('does not split a page when authentication fails', async () => {
    const error = new ECOSDrawingPageAnalysisError('signed_out', 'Sign in again.');
    const analyzeDrawingPage = jest.fn().mockRejectedValue(error);

    await expect(analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage,
      pageNumber: 1,
      existingText: '',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: [{
        bounds: { x: 0, y: 0, width: 1 / 3, height: 0.5 },
        imageDataUrl: 'data:image/jpeg;base64,tile',
      }],
    })).rejects.toBe(error);
    expect(analyzeDrawingPage).toHaveBeenCalledTimes(1);
  });

  it('falls back only the unresolved group when one three-tile request is capacity limited', async () => {
    const error = new ECOSDrawingPageAnalysisError(
      'analysis_rate_limited',
      'Drawing analysis is temporarily busy.',
      120_000,
    );
    const analyzeDrawingPage = jest.fn(async (input: Parameters<ECOSDrawingPageAnalyzer>[0]) => {
      if (input.analysisPass === 'page_tiles' && input.tileImages?.[0]?.bounds.y === 0) throw error;
      const sourceTiles = input.analysisPass === 'page_tiles'
        ? input.tileImages || []
        : [{ bounds: input.tileBounds! }];
      return {
        regions: sourceTiles.map((tile, index) => ({
          id: `group-fact-${tile.bounds.y}-${index}`,
          label: 'Verified grouped fact',
          text: 'Verified grouped fact',
          areaNames: [],
          x: tile.bounds.x + 0.01,
          y: tile.bounds.y + 0.01,
          width: 0.1,
          height: 0.1,
          confidence: 0.99,
          source: 'vision' as const,
        })),
        deepReadRegions: [],
      };
    });

    const result = await analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage,
      pageNumber: 1,
      existingText: '',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: Array.from({ length: 6 }, (_, index) => ({
        bounds: { x: (index % 3) / 3, y: index < 3 ? 0 : 0.5, width: 1 / 3, height: 0.5 },
        imageDataUrl: `data:image/jpeg;base64,tile-${index}`,
      })),
    });

    expect(analyzeDrawingPage).toHaveBeenCalledTimes(5);
    expect(analyzeDrawingPage.mock.calls.filter(([input]) => input.analysisPass === 'page_tiles'))
      .toHaveLength(2);
    expect(analyzeDrawingPage.mock.calls.filter(([input]) => input.analysisPass === 'deep_read'))
      .toHaveLength(3);
    expect(result.regions).toHaveLength(6);
  });

  it('falls back to focused individual tiles when grouped requests are still capacity limited', async () => {
    const error = new ECOSDrawingPageAnalysisError(
      'analysis_rate_limited',
      'Drawing analysis is temporarily busy.',
      120_000,
    );
    const analyzeDrawingPage = jest.fn(async (input: Parameters<ECOSDrawingPageAnalyzer>[0]) => {
      if (input.analysisPass === 'page_tiles') throw error;
      const bounds = input.tileBounds!;
      return {
        regions: [{
          id: `focused-fact-${bounds.x}-${bounds.y}`,
          label: 'Verified focused fact',
          text: 'Verified focused fact',
          areaNames: [],
          x: bounds.x + 0.01,
          y: bounds.y + 0.01,
          width: 0.1,
          height: 0.1,
          confidence: 0.99,
          source: 'vision' as const,
        }],
        deepReadRegions: [],
      };
    });

    const result = await analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage,
      pageNumber: 1,
      existingText: '',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: Array.from({ length: 6 }, (_, index) => ({
        bounds: { x: (index % 3) / 3, y: index < 3 ? 0 : 0.5, width: 1 / 3, height: 0.5 },
        imageDataUrl: `data:image/jpeg;base64,tile-${index}`,
      })),
    });

    expect(analyzeDrawingPage).toHaveBeenCalledTimes(8);
    expect(analyzeDrawingPage.mock.calls.filter(([input]) => input.analysisPass === 'page_tiles'))
      .toHaveLength(2);
    expect(analyzeDrawingPage.mock.calls.filter(([input]) => input.analysisPass === 'deep_read'))
      .toHaveLength(6);
    expect(result.regions).toHaveLength(6);
  });

  it('serializes verified tile checkpoints so later progress cannot be overwritten', async () => {
    const tiles = Array.from({ length: 4 }, (_, index) => ({
      bounds: { x: index / 4, y: 0, width: 0.25, height: 1 },
      imageDataUrl: `data:image/jpeg;base64,tile-${index}`,
    }));
    const checkpoints: number[] = [];
    let activeCheckpointCount = 0;
    let maximumActiveCheckpointCount = 0;
    await analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage: async input => ({
        regions: [{
          id: input.imageDataUrl || 'fact',
          label: 'Verified fact',
          text: 'Verified fact',
          areaNames: [],
          x: 0,
          y: 0,
          width: 0.1,
          height: 0.1,
          confidence: 0.99,
          source: 'vision' as const,
        }],
        deepReadRegions: [],
      }),
      pageNumber: 1,
      existingText: '',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: tiles,
      onTileAnalyzed: async ({ completedTileCount }) => {
        activeCheckpointCount += 1;
        maximumActiveCheckpointCount = Math.max(maximumActiveCheckpointCount, activeCheckpointCount);
        await Promise.resolve();
        checkpoints.push(completedTileCount);
        activeCheckpointCount -= 1;
      },
    });

    expect(maximumActiveCheckpointCount).toBe(1);
    expect(checkpoints).toEqual([1, 2, 3, 4]);
  });

  it('reports each tile attempt and completion so a long page does not look frozen', async () => {
    const statuses: Array<{ state: string; tileNumber: number }> = [];
    await analyzeECOSDrawingVisualBatchWithRecovery({
      analyzeDrawingPage: async () => ({ regions: [], deepReadRegions: [] }),
      pageNumber: 6,
      existingText: '',
      overviewImageDataUrl: 'data:image/jpeg;base64,overview',
      tileImages: Array.from({ length: 2 }, (_, index) => ({
        bounds: { x: index / 2, y: 0, width: 0.5, height: 1 },
        imageDataUrl: `data:image/jpeg;base64,tile-${index}`,
      })),
      onTileStatus: status => statuses.push({
        state: status.state,
        tileNumber: status.tileNumber,
      }),
    });

    expect(statuses).toEqual([
      { state: 'attempting', tileNumber: 1 },
      { state: 'complete', tileNumber: 1 },
      { state: 'complete', tileNumber: 2 },
    ]);
  });

  it('gives the PDF worker an owned copy without detaching reviewed upload bytes', () => {
    const reviewedBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const workerBytes = copyECOSPdfBytesForWorker(reviewedBytes);

    workerBytes[0] = 9;

    expect(reviewedBytes.byteLength).toBe(4);
    expect(new Uint8Array(reviewedBytes)[0]).toBe(1);
  });

  it('creates searchable line records during desktop text upload', async () => {
    const file = new NodeFile(
      ['North Lot\nProvide guardrails at every open parking edge.'],
      'field-spec.txt',
      { type: 'text/plain' },
    ) as unknown as File;
    const bytes = await file.arrayBuffer();

    const result = await extractECOSWebDocument({
      file,
      bytes,
      candidateAreaNames: ['North Lot'],
    });

    expect(result.extractionStatus).toBe('complete');
    expect(result.extractionMethod).toBe('embedded_text');
    expect(result.extractedPages).toHaveLength(1);
    expect(result.extractedPages?.[0].regions?.[0]).toMatchObject({
      text: 'North Lot',
      areaNames: ['North Lot'],
      source: 'embedded_text',
    });
  });

  it('stops an index before saving work from an inactive Documents route', async () => {
    const file = new NodeFile(['North Lot'], 'field-spec.txt', {
      type: 'text/plain',
    }) as unknown as File;

    await expect(extractECOSWebDocument({
      file,
      bytes: await file.arrayBuffer(),
      isCancelled: () => true,
    })).rejects.toBeInstanceOf(ECOSDocumentExtractionCancelledError);
  });

  it('removes hidden PDF control characters before searchable text is saved', async () => {
    const file = new NodeFile(
      ['Canopy\u0000 A\u0007\nProvide\u001F guardrails'],
      'cad-export.txt',
      { type: 'text/plain' },
    ) as unknown as File;

    const result = await extractECOSWebDocument({
      file,
      bytes: await file.arrayBuffer(),
    });

    expect(result.extractedText).toBe('Canopy A\nProvide guardrails');
    expect(JSON.stringify(result)).not.toMatch(/\\u0000|\\u0007|\\u001f/i);
  });

  it('marks unsupported desktop files without pretending they were indexed', async () => {
    const file = new NodeFile(['binary'], 'model.dwg', {
      type: 'application/acad',
    }) as unknown as File;

    const result = await extractECOSWebDocument({ file, bytes: await file.arrayBuffer() });

    expect(result.extractionStatus).toBe('not_supported');
    expect(result.extractedPages).toEqual([]);
    expect(result.extractionLimitations?.[0]).toContain('does not support');
  });

  it('normalizes embedded-text coordinates after a 90-degree page rotation', () => {
    const region = normalizedECOSPdfTextRegion({
      itemTransform: [12, 0, 0, 12, 72, 720],
      itemWidth: 144,
      itemHeight: 12,
      viewportTransform: [0, 1, 1, 0, 0, 0],
      viewportScale: 1,
      viewportWidth: 792,
      viewportHeight: 612,
    });

    expect(region).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(region.x).toBeGreaterThan(0.9);
    expect(region.y).toBeGreaterThan(0.1);
    expect(region.x + region.width).toBeLessThanOrEqual(1.001);
    expect(region.y + region.height).toBeLessThanOrEqual(1.001);
  });

  it('supplements sparse CAD title-block text with OCR', () => {
    expect(shouldSupplementECOSPdfPageWithOCR([
      { text: 'PRECISE GRADING PLAN FOR PLZ CORPORATION 2375 THIRD STREET' },
      { text: 'Z:\\project\\drawings\\Precise Grading.dwg, AutoCAD PDF (High Quality Print).pc3' },
      { text: 'ENGINEERING CONSULTANTS 200 South Main Street' },
      { text: 'KH KH TEB 1:1' },
    ])).toBe(true);
  });

  it('does not OCR a dense CAD text layer unnecessarily', () => {
    const denseLines = Array.from({ length: 45 }, (_, index) => ({
      text: index === 0
        ? 'C6 North Lot Plan exported from Precise Grading.dwg using AutoCAD PDF'
        : `Construction note ${index}: detailed searchable plan requirement and dimension`,
    }));

    expect(shouldSupplementECOSPdfPageWithOCR(denseLines)).toBe(false);
  });

  it('OCRs a dense but fragmented CAD text layer that cannot support reliable answers', () => {
    const fragmentedLines = Array.from({ length: 45 }, (_, index) => ({
      text: index % 3 === 0 ? String(index % 10) : String.fromCharCode(65 + (index % 20)),
    }));

    expect(shouldSupplementECOSPdfPageWithOCR(fragmentedLines)).toBe(true);
  });

  it('does not merge distant callouts that happen to share the same drawing row', () => {
    const merged = mergeECOSPdfTextItems([{
      text: 'NORTH LOT', x: 0.05, y: 0.2, width: 0.12, height: 0.02,
      confidence: 1, source: 'embedded_text',
    }, {
      text: '6" THICK PCC', x: 0.18, y: 0.2, width: 0.14, height: 0.02,
      confidence: 1, source: 'embedded_text',
    }, {
      text: '4" WALKWAY', x: 0.72, y: 0.2, width: 0.14, height: 0.02,
      confidence: 1, source: 'embedded_text',
    }]);

    expect(merged.map(line => line.text)).toEqual([
      'NORTH LOT 6" THICK PCC',
      '4" WALKWAY',
    ]);
  });

  it('recognizes a one-digit civil sheet number instead of a nearby project number', () => {
    expect(detectECOSSheetNumber([
      {
        id: 'project-number', label: 'GP-2024-03571', text: 'GP-2024-03571', areaNames: [],
        x: 0.94, y: 0.97, width: 0.12, height: 0.03, confidence: 0.9, source: 'ocr',
      },
      {
        id: 'sheet-title', label: 'NORTH LOT PLAN C6', text: 'NORTH LOT PLAN C6', areaNames: [],
        x: 0.72, y: 0.83, width: 0.14, height: 0.04, confidence: 0.9, source: 'ocr',
      },
    ])).toBe('C6');
  });

  it('always requests a focused title-block pass even when full-page OCR misses the sheet label', () => {
    expect(shouldRunECOSTitleBlockOCR([
      { text: 'CITY OF RIVERSIDE PRECISE GRADING PLAN SHEET NO.' },
      { text: 'WDID: 8 33C405437 GP-2024-03571' },
    ])).toBe(true);
    expect(shouldRunECOSTitleBlockOCR([
      { text: 'CONSTRUCT 6.0" THICK PCC PAVING' },
    ])).toBe(true);
  });

  it('deep-reads the entire drawing page in six high-resolution tiles', () => {
    const regions = selectECOSDeepReadRegions([{
      label: 'Lighting plan',
      reason: 'Read fixture symbols and tags.',
      bounds: { x: 0.72, y: 0.1, width: 0.2, height: 0.2 },
    }]);

    expect(regions).toHaveLength(6);
    expect(regions.some(region => region.label.includes('Lighting plan'))).toBe(true);
    const area = regions.reduce((sum, region) => sum + region.bounds.width * region.bounds.height, 0);
    expect(area).toBeCloseTo(1, 8);
    expect(Math.min(...regions.map(region => region.bounds.x))).toBe(0);
    expect(Math.max(...regions.map(region => region.bounds.x + region.bounds.width))).toBe(1);
    expect(Math.min(...regions.map(region => region.bounds.y))).toBe(0);
    expect(Math.max(...regions.map(region => region.bounds.y + region.bounds.height))).toBe(1);
  });

  it('repairs the known one-digit PCC inch-mark OCR artifact without changing ordinary numbers', () => {
    expect(normalizeECOSConstructionMeasurementText('CONSTRUCT 47 THICK PCC PAVING'))
      .toBe('CONSTRUCT 4" THICK PCC PAVING');
    expect(normalizeECOSConstructionMeasurementText('PROJECT 47 CONSTRUCT 47 FOOT WALL'))
      .toBe('PROJECT 47 CONSTRUCT 47 FOOT WALL');
  });

  it('requests a focused construction-note OCR pass without repeating it on ordinary sheets', () => {
    expect(shouldRunECOSConstructionNoteOCR([
      { text: 'CONSTRUCTION NOTES' },
      { text: 'CONSTRUCT 47 THICK PCC PAVING' },
    ])).toBe(true);
    expect(shouldRunECOSConstructionNoteOCR([
      { text: 'ANCHOR ROD PLAN' },
      { text: "122'-0\"" },
    ])).toBe(false);
  });
});
