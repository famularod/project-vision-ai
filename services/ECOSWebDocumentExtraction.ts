import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegion,
  ReferenceDocumentRegionEvidence,
} from '../types';
import { sanitizeECOSDocumentText } from './ECOSDocumentTextSanitization';
import { buildECOSSheetMapping } from './ECOSSheetMapping';
import type {
  ECOSDrawingBounds,
  ECOSDrawingPageAnalysisResult,
} from './ECOSDrawingPageAnalysis';
import {
  completedECOSDrawingTileKeys,
  ecosDrawingAnalysisFailureCode,
  ecosDrawingTileKey,
  hasCompleteECOSDrawingVisualCoverage,
  isRetryableECOSDrawingAnalysisError,
  runECOSDrawingAnalysisWithRetry,
  type ECOSDrawingAnalysisRetryStatus,
} from './ECOSDrawingVisualCoverage';

const MAX_PAGES = 100;
const MAX_OCR_PAGES = 40;
const MAX_CHARACTERS = 500_000;
// Large-format construction sheets need enough raster detail to preserve
// decimal points and inch marks in dense note blocks. At 1,800 px the real
// 2375 North Lot sheet found the note, but frequently confused 4", 6", and 8".
// 2,600 px materially improves those measurements while keeping a manual
// eight-page re-index bounded for desktop browsers.
const OCR_RENDER_WIDTH = 2_600;
const TITLE_BLOCK_LEFT = 0.72;
const TITLE_BLOCK_TOP = 0.82;
const TITLE_BLOCK_OCR_SCALE = 3;
const VISUAL_TILE_RENDER_WIDTH = 3_000;
const MAX_VISUAL_IMAGE_DATA_URL_LENGTH = 4_200_000;
const MAX_VISUAL_BATCH_DATA_URL_LENGTH = 14_000_000;
const MAX_DEEP_READ_REGIONS = 6;
const VISUAL_TILE_CONCURRENCY = 2;
const VISUAL_TILE_GROUP_SIZE = 3;
// The Edge Function already performs short provider retries and switches to
// the configured Gemini fallback model. Repeating the same request in the
// browser can add a two-minute pause without reducing its provider weight.
const VISUAL_TILE_MAX_ATTEMPTS = 1;
const FULL_PAGE_DEEP_READ_GRID = Object.freeze([
  { label: 'Upper-left drawing tile', bounds: { x: 0, y: 0, width: 1 / 3, height: 0.5 } },
  { label: 'Upper-center drawing tile', bounds: { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 } },
  { label: 'Upper-right drawing tile', bounds: { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 } },
  { label: 'Lower-left drawing tile', bounds: { x: 0, y: 0.5, width: 1 / 3, height: 0.5 } },
  { label: 'Lower-center drawing tile', bounds: { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 } },
  { label: 'Lower-right drawing and title-block tile', bounds: { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 } },
] as const);

export type ECOSDrawingPageAnalyzer = (input: Readonly<{
  pageNumber: number;
  imageDataUrl: string;
  existingText: string;
  analysisPass?: 'overview' | 'deep_read' | 'page_tiles';
  tileBounds?: ECOSDrawingBounds | null;
  tileImages?: readonly Readonly<{
    bounds: ECOSDrawingBounds;
    imageDataUrl: string;
  }>[];
}>) => Promise<ECOSDrawingPageAnalysisResult>;

export class ECOSDocumentExtractionCancelledError extends Error {
  constructor() {
    super('The document index update stopped because the Documents workspace is no longer active.');
    this.name = 'ECOSDocumentExtractionCancelledError';
  }
}

export type ECOSDocumentAnalysisProgress = Readonly<{
  pageNumber: number;
  pageCount: number;
  tileNumber: number;
  tileCount: number;
  state: 'preparing' | 'attempting' | 'waiting' | 'complete';
  attempt: number;
  maximumAttempts: number;
  waitMilliseconds: number;
  failureCode: string | null;
}>;

export async function analyzeECOSDrawingVisualBatchWithRecovery({
  analyzeDrawingPage,
  pageNumber,
  existingText,
  overviewImageDataUrl,
  tileImages,
  isCancelled,
  onTileAnalyzed,
  onTileStatus,
}: Readonly<{
  analyzeDrawingPage: ECOSDrawingPageAnalyzer;
  pageNumber: number;
  existingText: string;
  overviewImageDataUrl: string;
  tileImages: readonly Readonly<{ bounds: ECOSDrawingBounds; imageDataUrl: string }>[];
  isCancelled?: () => boolean;
  onTileAnalyzed?: (input: Readonly<{
    tile: Readonly<{ bounds: ECOSDrawingBounds; imageDataUrl: string }>;
    result: ECOSDrawingPageAnalysisResult;
    completedTileCount: number;
    totalTileCount: number;
  }>) => void | Promise<void>;
  onTileStatus?: (input: Readonly<{
    tileNumber: number;
    totalTileCount: number;
    state: ECOSDrawingAnalysisRetryStatus['state'] | 'complete';
    attempt: number;
    maximumAttempts: number;
    waitMilliseconds: number;
    failureCode: string | null;
  }>) => void;
}>): Promise<ECOSDrawingPageAnalysisResult> {
  const results: Array<ECOSDrawingPageAnalysisResult | undefined> = new Array(tileImages.length);
  let completedTileCount = 0;
  let checkpointChain = Promise.resolve();

  const checkpointTile = async (
    tileIndex: number,
    result: ECOSDrawingPageAnalysisResult,
    completedAttempt = 1,
  ) => {
    throwIfExtractionCancelled(isCancelled);
    const tile = tileImages[tileIndex];
    const tileResult = Object.freeze({
      regions: Object.freeze(result.regions.filter(region => regionOverlapsTile(region, tile.bounds))),
      deepReadRegions: Object.freeze([]),
    });
    results[tileIndex] = tileResult;
    completedTileCount += 1;
    onTileStatus?.({
      tileNumber: tileIndex + 1,
      totalTileCount: tileImages.length,
      state: 'complete',
      attempt: completedAttempt,
      maximumAttempts: VISUAL_TILE_MAX_ATTEMPTS,
      waitMilliseconds: 0,
      failureCode: null,
    });
    if (onTileAnalyzed) {
      const checkpointCompletedTileCount = completedTileCount;
      // Concurrent analysis may finish out of order. Serialize checkpoints so
      // an earlier write cannot overwrite a newer page state.
      checkpointChain = checkpointChain.then(() => onTileAnalyzed({
        tile,
        result: tileResult,
        completedTileCount: checkpointCompletedTileCount,
        totalTileCount: tileImages.length,
      }));
      await checkpointChain;
    }
  };

  const analyzeCombinedTiles = async (
    indexes: readonly number[],
  ): Promise<Readonly<{ result: ECOSDrawingPageAnalysisResult; completedAttempt: number }>> => {
    let completedAttempt = 1;
    const groupedTiles = indexes.map(index => tileImages[index]);
    const result = await runECOSDrawingAnalysisWithRetry(() => analyzeDrawingPage({
      pageNumber,
      imageDataUrl: overviewImageDataUrl,
      existingText,
      analysisPass: 'page_tiles',
      tileBounds: null,
      tileImages: groupedTiles,
    }), {
      isCancelled,
      maximumAttempts: VISUAL_TILE_MAX_ATTEMPTS,
      onStatus: status => {
        completedAttempt = status.attempt;
        onTileStatus?.({
          tileNumber: indexes[0] + 1,
          totalTileCount: tileImages.length,
          ...status,
        });
      },
    });
    return Object.freeze({ result, completedAttempt });
  };

  let individualTileIndexes = tileImages.map((_, index) => index);
  if (canUseCombinedECOSVisualBatch(overviewImageDataUrl, tileImages)) {
    const allTileIndexes = tileImages.map((_, index) => index);
    if (tileImages.length <= VISUAL_TILE_GROUP_SIZE) {
      try {
        const batch = await analyzeCombinedTiles(allTileIndexes);
        for (const tileIndex of allTileIndexes) {
          await checkpointTile(tileIndex, batch.result, batch.completedAttempt);
        }
        await checkpointChain;
        return batch.result;
      } catch (error) {
        if (!isRetryableECOSDrawingAnalysisError(error)) throw error;
      }
    }

    // A six-image construction-sheet request is valid, but repeated live runs
    // showed that it can consume too much instantaneous provider capacity.
    // Start normal pages as two parallel three-tile requests instead. Successful
    // groups are checkpointed; only failed groups fall through to individual
    // deep reads.
    if (tileImages.length > VISUAL_TILE_GROUP_SIZE) {
      const groups = Array.from(
        { length: Math.ceil(tileImages.length / VISUAL_TILE_GROUP_SIZE) },
        (_, groupIndex) => allTileIndexes.slice(
          groupIndex * VISUAL_TILE_GROUP_SIZE,
          (groupIndex + 1) * VISUAL_TILE_GROUP_SIZE,
        ),
      );
      const outcomes = await Promise.all(groups.map(async indexes => {
        try {
          return Object.freeze({ indexes, batch: await analyzeCombinedTiles(indexes), error: null });
        } catch (error) {
          return Object.freeze({ indexes, batch: null, error });
        }
      }));
      individualTileIndexes = [];
      for (const outcome of outcomes) {
        if (outcome.batch) {
          for (const tileIndex of outcome.indexes) {
            await checkpointTile(tileIndex, outcome.batch.result, outcome.batch.completedAttempt);
          }
          continue;
        }
        if (!isRetryableECOSDrawingAnalysisError(outcome.error)) throw outcome.error;
        individualTileIndexes.push(...outcome.indexes);
      }
      if (individualTileIndexes.length === 0) {
        await checkpointChain;
        const completedResults = results.filter(
          (result): result is ECOSDrawingPageAnalysisResult => Boolean(result),
        );
        return Object.freeze({
          regions: Object.freeze(completedResults.flatMap(result => result.regions)),
          deepReadRegions: Object.freeze(completedResults.flatMap(result => result.deepReadRegions)),
        });
      }
    }
  }

  // The last recovery level gives each unresolved high-resolution tile its own
  // focused request. Keep two in flight for useful throughput, but never pause
  // the browser for a long provider cooldown: completed tiles are checkpointed
  // and any remaining retryable failure stays on the retry list.
  let nextIndividualPosition = 0;
  let firstError: unknown = null;

  const worker = async () => {
    while (firstError == null) {
      throwIfExtractionCancelled(isCancelled);
      const tileIndex = individualTileIndexes[nextIndividualPosition];
      nextIndividualPosition += 1;
      if (tileIndex == null) return;
      const tile = tileImages[tileIndex];
      try {
        let completedAttempt = 1;
        const result = await runECOSDrawingAnalysisWithRetry(() => analyzeDrawingPage({
          pageNumber,
          imageDataUrl: tile.imageDataUrl,
          existingText,
          analysisPass: 'deep_read',
          tileBounds: tile.bounds,
          tileImages: [],
        }), {
          isCancelled,
          maximumAttempts: VISUAL_TILE_MAX_ATTEMPTS,
          onStatus: status => {
            completedAttempt = status.attempt;
            onTileStatus?.({
              tileNumber: tileIndex + 1,
              totalTileCount: tileImages.length,
              ...status,
            });
          },
        });
        await checkpointTile(tileIndex, result, completedAttempt);
      } catch (error) {
        firstError ||= error;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(VISUAL_TILE_CONCURRENCY, individualTileIndexes.length) },
    () => worker(),
  ));
  await checkpointChain;
  if (firstError != null) throw firstError;
  const completedResults = results.filter(
    (result): result is ECOSDrawingPageAnalysisResult => Boolean(result),
  );
  return Object.freeze({
    regions: Object.freeze(completedResults.flatMap(result => result.regions)),
    deepReadRegions: Object.freeze(completedResults.flatMap(result => result.deepReadRegions)),
  });
}

export type ECOSDocumentExtraction = Readonly<Pick<
  ReferenceDocument,
  | 'extractedText'
  | 'extractedPages'
  | 'extractionStatus'
  | 'extractionMethod'
  | 'extractionLimitations'
  | 'documentIntelligenceVersion'
  | 'documentVisualIndexVersion'
  | 'indexedAt'
  | 'sourcePageCount'
  | 'searchablePageCount'
  | 'ocrPageCount'
  | 'extractionAverageConfidence'
  | 'indexedContentSha256'
>>;

type ExtractLine = Readonly<{
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  source: 'embedded_text' | 'ocr';
  constituentEvidence?: readonly ReferenceDocumentRegionEvidence[];
}>;

export async function extractECOSWebDocument({
  file,
  bytes,
  candidateAreaNames = [],
  onProgress,
  analyzeDrawingPage,
  isCancelled,
  resumePages = [],
  onPageExtracted,
  onAnalysisProgress,
}: {
  file: File;
  bytes: ArrayBuffer;
  candidateAreaNames?: readonly string[];
  onProgress?: (fraction: number) => void;
  analyzeDrawingPage?: ECOSDrawingPageAnalyzer;
  isCancelled?: () => boolean;
  resumePages?: readonly ReferenceDocumentExtractedPage[];
  onPageExtracted?: (page: ReferenceDocumentExtractedPage) => void | Promise<void>;
  onAnalysisProgress?: (progress: ECOSDocumentAnalysisProgress) => void;
}): Promise<ECOSDocumentExtraction> {
  throwIfExtractionCancelled(isCancelled);
  const indexedAt = new Date().toISOString();
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  if (mimeType.includes('pdf') || lowerName.endsWith('.pdf')) {
    return extractPdf(
      bytes,
      candidateAreaNames,
      indexedAt,
      onProgress,
      analyzeDrawingPage,
      isCancelled,
      resumePages,
      onPageExtracted,
      onAnalysisProgress,
    );
  }
  if (mimeType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/.test(lowerName)) {
    const page = await ocrImage(file, 1, candidateAreaNames);
    await onPageExtracted?.(page);
    onProgress?.(1);
    return finalizeExtraction([page], indexedAt, [], true, false, 1);
  }
  if (
    mimeType.includes('text') ||
    mimeType.includes('json') ||
    /\.(?:txt|csv|tsv|json)$/.test(lowerName)
  ) {
    const text = (await file.text()).slice(0, MAX_CHARACTERS).trim();
    const page = pageFromLines(1, textLines(text, 'embedded_text'), candidateAreaNames);
    await onPageExtracted?.(page);
    onProgress?.(1);
    return finalizeExtraction([page], indexedAt, [], false, true, 1);
  }
  return {
    extractedText: null,
    extractedPages: [],
    extractionStatus: 'not_supported',
    extractionMethod: null,
    extractionLimitations: [
      'This file type is stored securely but does not support local text extraction yet.',
    ],
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    indexedAt,
    sourcePageCount: 0,
    searchablePageCount: 0,
    ocrPageCount: 0,
    extractionAverageConfidence: null,
    indexedContentSha256: null,
  };
}

async function extractPdf(
  bytes: ArrayBuffer,
  candidateAreaNames: readonly string[],
  indexedAt: string,
  onProgress?: (fraction: number) => void,
  analyzeDrawingPage?: ECOSDrawingPageAnalyzer,
  isCancelled?: () => boolean,
  resumePages: readonly ReferenceDocumentExtractedPage[] = [],
  onPageExtracted?: (page: ReferenceDocumentExtractedPage) => void | Promise<void>,
  onAnalysisProgress?: (progress: ECOSDocumentAnalysisProgress) => void,
): Promise<ECOSDocumentExtraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  const pdf = await pdfjs.getDocument({ data: copyECOSPdfBytesForWorker(bytes) }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const pages: ReferenceDocumentExtractedPage[] = [];
  const limitations: string[] = [];
  let ocrWorker: Awaited<ReturnType<typeof createOCRWorker>> | null = null;
  let ocrPageCount = 0;
  let usedEmbeddedText = false;
  let usedOCR = false;
  const resumablePages = new Map(resumePages
    .filter(page => Number.isInteger(page.pageNumber) && page.pageNumber > 0 && page.pageNumber <= pageCount)
    .map(page => [page.pageNumber, page]));
  usedOCR = [...resumablePages.values()].some(page =>
    (page.regions ?? []).some(region => region.source === 'ocr'),
  );
  usedEmbeddedText = [...resumablePages.values()].some(page =>
    (page.regions ?? []).some(region => region.source === 'embedded_text'),
  );

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      throwIfExtractionCancelled(isCancelled);
      const resumedPage = resumablePages.get(pageNumber);
      if (resumedPage && (!analyzeDrawingPage || hasCompleteECOSDrawingVisualCoverage(resumedPage))) {
        pages.push(resumedPage);
        onProgress?.(pageNumber / pageCount);
        continue;
      }
      const page = await pdf.getPage(pageNumber);
      let extractedPage: ReferenceDocumentExtractedPage;
      if (resumedPage) {
        extractedPage = resumedPage;
      } else {
        const embeddedLines = await pdfTextLines(page);
        let lines = embeddedLines;
        if (embeddedLines.length > 0) {
          usedEmbeddedText = true;
        }
        const needsDrawingOCR = shouldSupplementECOSPdfPageWithOCR(embeddedLines);
        if (needsDrawingOCR && ocrPageCount < MAX_OCR_PAGES) {
          ocrWorker ||= await createOCRWorker();
          const recognizedLines = await ocrPdfPage(page, ocrWorker);
          lines = mergeDistinctLines(embeddedLines, recognizedLines);
          ocrPageCount += 1;
          usedOCR = usedOCR || recognizedLines.length > 0;
          if (embeddedLines.length > 0 && recognizedLines.length === 0) {
            limitations.push(
              `Page ${pageNumber} exposed only sparse drawing text and OCR did not recover additional searchable content.`,
            );
          }
        } else if (embeddedLines.length === 0) {
          limitations.push(
            `OCR stopped after ${MAX_OCR_PAGES} image-only pages to protect browser performance.`,
          );
        }
        extractedPage = pageFromLines(pageNumber, lines, candidateAreaNames);
      }
      let checkpointedDuringPage = false;
      if (analyzeDrawingPage) {
        const completedTileKeys = completedECOSDrawingTileKeys(extractedPage);
        const failureCodes = new Set<string>();
        let overviewAnalyzed = extractedPage.visualCoverage?.overviewAnalyzed === true;
        const requestedDeepReads = selectECOSDeepReadRegions([]);
        const missingDeepReads = requestedDeepReads.filter(request =>
          !completedTileKeys.has(ecosDrawingTileKey(request.bounds)),
        );
        const pageProgress = () => onProgress?.(
          ((pageNumber - 1) + Math.min(1, completedTileKeys.size / requestedDeepReads.length)) /
          pageCount,
        );
        pageProgress();
        if (!overviewAnalyzed && missingDeepReads.length === 0 && completedTileKeys.size > 0) {
          // Every tile request includes the overview for page context. Older
          // checkpoints could preserve all tile keys without the overview bit.
          overviewAnalyzed = true;
        }
        extractedPage = withVisualCoverage(
          extractedPage,
          overviewAnalyzed,
          requestedDeepReads.length,
          completedTileKeys,
          failureCodes,
        );
        await onPageExtracted?.(extractedPage);
        checkpointedDuringPage = Boolean(onPageExtracted);

        if (!overviewAnalyzed || missingDeepReads.length > 0) {
          try {
            throwIfExtractionCancelled(isCancelled);
            onAnalysisProgress?.({
              pageNumber,
              pageCount,
              tileNumber: Math.min(requestedDeepReads.length, completedTileKeys.size + 1),
              tileCount: requestedDeepReads.length,
              state: 'preparing',
              attempt: 0,
              maximumAttempts: VISUAL_TILE_MAX_ATTEMPTS,
              waitMilliseconds: 0,
              failureCode: null,
            });
            const tileImages: Array<{ bounds: ECOSDrawingBounds; imageDataUrl: string }> = [];
            const overviewImageDataUrl = await renderPDFPageOverviewForVisualAnalysis(page);
            for (const request of missingDeepReads) {
              throwIfExtractionCancelled(isCancelled);
              tileImages.push({
                bounds: request.bounds,
                imageDataUrl: await renderPDFPageTileForVisualAnalysis(page, request.bounds),
              });
            }
            assertECOSVisualBatchSize(overviewImageDataUrl, tileImages);
            const completedTileCountAtBatchStart = completedTileKeys.size;
            const result = await analyzeECOSDrawingVisualBatchWithRecovery({
              analyzeDrawingPage,
              pageNumber,
              existingText: extractedPage.text || '',
              overviewImageDataUrl,
              tileImages,
              isCancelled,
              onTileStatus: status => {
                const tileNumber = Math.min(
                  requestedDeepReads.length,
                  completedTileCountAtBatchStart + status.tileNumber,
                );
                onAnalysisProgress?.({
                  pageNumber,
                  pageCount,
                  tileNumber,
                  tileCount: requestedDeepReads.length,
                  state: status.state,
                  attempt: status.attempt,
                  maximumAttempts: status.maximumAttempts,
                  waitMilliseconds: status.waitMilliseconds,
                  failureCode: status.failureCode,
                });
              },
              onTileAnalyzed: async ({ tile, result: tileResult }) => {
                overviewAnalyzed = true;
                completedTileKeys.add(ecosDrawingTileKey(tile.bounds));
                extractedPage = mergeVisualRegions(extractedPage, tileResult.regions);
                extractedPage = withVisualCoverage(
                  extractedPage,
                  overviewAnalyzed,
                  requestedDeepReads.length,
                  completedTileKeys,
                  failureCodes,
                );
                await onPageExtracted?.(extractedPage);
                checkpointedDuringPage = Boolean(onPageExtracted);
                pageProgress();
              },
            });
            overviewAnalyzed = true;
            // The per-tile callback already merged and checkpointed every
            // verified result. Preserve support for callers without a page
            // checkpoint hook by merging the aggregate once here.
            if (!onPageExtracted) {
              missingDeepReads.forEach(request => completedTileKeys.add(ecosDrawingTileKey(request.bounds)));
              extractedPage = mergeVisualRegions(extractedPage, result.regions);
            }
            extractedPage = withVisualCoverage(
              extractedPage,
              true,
              requestedDeepReads.length,
              completedTileKeys,
              failureCodes,
            );
            await onPageExtracted?.(extractedPage);
            checkpointedDuringPage = Boolean(onPageExtracted);
            pageProgress();
          } catch (error) {
            if (isExtractionCancellation(error, isCancelled)) {
              throw new ECOSDocumentExtractionCancelledError();
            }
            failureCodes.add(ecosDrawingAnalysisFailureCode(error));
            extractedPage = withVisualCoverage(
              extractedPage,
              overviewAnalyzed,
              requestedDeepReads.length,
              completedTileKeys,
              failureCodes,
            );
            await onPageExtracted?.(extractedPage);
            checkpointedDuringPage = Boolean(onPageExtracted);
            // Stop at the exact failed page. Continuing through the rest of a
            // drawing while the provider is unavailable converted one
            // temporary capacity event into dozens of false page failures.
            throw error;
          }
        }

        if (!hasCompleteECOSDrawingVisualCoverage(extractedPage)) {
          const coverage = extractedPage.visualCoverage;
          const codeList = [...failureCodes].join(', ') || 'analysis_incomplete';
          limitations.push(
            `Page ${pageNumber} visual coverage remains incomplete ` +
            `(${coverage?.completedDeepReadRegionCount || 0} of ${coverage?.requestedDeepReadRegionCount || 6} tiles; ${codeList}).`,
          );
        }
      }
      if (!checkpointedDuringPage) await onPageExtracted?.(extractedPage);
      pages.push(extractedPage);
      onProgress?.(pageNumber / pageCount);
    }
  } finally {
    await ocrWorker?.terminate();
    await pdf.cleanup();
  }

  if (pdf.numPages > MAX_PAGES) {
    limitations.push(`Only the first ${MAX_PAGES} of ${pdf.numPages} pages were indexed.`);
  }
  return finalizeExtraction(
    pages,
    indexedAt,
    limitations,
    usedOCR,
    usedEmbeddedText,
    pdf.numPages,
  );
}

function throwIfExtractionCancelled(isCancelled?: () => boolean) {
  if (isCancelled?.()) throw new ECOSDocumentExtractionCancelledError();
}

/**
 * PDF.js transfers its input to the worker and may detach the backing buffer.
 * Give the worker an owned copy so the reviewed source bytes remain available
 * for the subsequent protected-storage upload.
 */
export function copyECOSPdfBytesForWorker(bytes: ArrayBuffer): Uint8Array {
  return new Uint8Array(bytes.slice(0));
}

async function pdfTextLines(page: any): Promise<ExtractLine[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = (content.items as any[]).flatMap(item => {
    const text = clean(item.str);
    const transform = Array.isArray(item.transform) ? item.transform : [];
    if (!text || transform.length < 6) return [];
    const region = normalizedECOSPdfTextRegion({
      itemTransform: transform,
      itemWidth: Number(item.width) || 0,
      itemHeight: Number(item.height) || 0,
      viewportTransform: viewport.transform,
      viewportScale: Number(viewport.scale) || 1,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });
    return [{
      text,
      ...region,
      confidence: 1,
      source: 'embedded_text' as const,
    }];
  });
  return mergeECOSPdfTextItems(items);
}

export function normalizedECOSPdfTextRegion({
  itemTransform,
  itemWidth,
  itemHeight,
  viewportTransform,
  viewportScale,
  viewportWidth,
  viewportHeight,
}: {
  itemTransform: readonly number[];
  itemWidth: number;
  itemHeight: number;
  viewportTransform: readonly number[];
  viewportScale: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const transform = multiplyPdfTransforms(viewportTransform, itemTransform);
  const angle = Math.atan2(transform[1], transform[0]);
  const fontHeight = Math.max(Math.hypot(transform[2], transform[3]), itemHeight * viewportScale, 1);
  const textLength = Math.max(itemWidth * viewportScale, fontHeight * 0.35, 1);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const topDirection = { x: Math.sin(angle), y: -Math.cos(angle) };
  const corners = [
    { x: transform[4], y: transform[5] },
    { x: transform[4] + direction.x * textLength, y: transform[5] + direction.y * textLength },
    { x: transform[4] + topDirection.x * fontHeight, y: transform[5] + topDirection.y * fontHeight },
    {
      x: transform[4] + direction.x * textLength + topDirection.x * fontHeight,
      y: transform[5] + direction.y * textLength + topDirection.y * fontHeight,
    },
  ];
  const left = clamp(Math.min(...corners.map(corner => corner.x)) / Math.max(1, viewportWidth));
  const top = clamp(Math.min(...corners.map(corner => corner.y)) / Math.max(1, viewportHeight));
  const right = clamp(Math.max(...corners.map(corner => corner.x)) / Math.max(1, viewportWidth));
  const bottom = clamp(Math.max(...corners.map(corner => corner.y)) / Math.max(1, viewportHeight));
  return {
    x: left,
    y: top,
    width: clamp(right - left, 0.001, 1 - left),
    height: clamp(bottom - top, 0.001, 1 - top),
  };
}

function multiplyPdfTransforms(left: readonly number[], right: readonly number[]) {
  const a = [...left, 0, 0, 0, 0, 0, 0].slice(0, 6).map(Number);
  const b = [...right, 0, 0, 0, 0, 0, 0].slice(0, 6).map(Number);
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function createOCRWorker() {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng');
}

async function ocrPdfPage(
  page: any,
  worker: Awaited<ReturnType<typeof createOCRWorker>>,
): Promise<ExtractLine[]> {
  if (typeof document === 'undefined') return [];
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = OCR_RENDER_WIDTH / Math.max(1, baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return [];
  await page.render({ canvasContext: context, viewport }).promise;
  const result = await worker.recognize(canvas, {}, { blocks: true });
  const recognizedLines = tesseractLines(result.data as any, canvas.width, canvas.height);
  let enhancedLines = recognizedLines;

  if (shouldRunECOSConstructionNoteOCR(recognizedLines)) {
    const noteBounds = constructionNoteOCRBounds(recognizedLines);
    if (noteBounds) {
      const noteLines = await ocrFocusedPDFRegion(canvas, worker, noteBounds, 3);
      enhancedLines = mergeDistinctLines(enhancedLines, noteLines);
    }
  }

  if (!shouldRunECOSTitleBlockOCR(recognizedLines)) return enhancedLines;

  // The full-sheet pass is optimized for notes and dimensions. Sheet numbers
  // are often tiny in the lower-right title block, so OCR that bounded area at
  // higher effective resolution and map its regions back to page coordinates.
  const titleLines = await ocrFocusedPDFRegion(canvas, worker, {
    x: TITLE_BLOCK_LEFT,
    y: TITLE_BLOCK_TOP,
    width: 1 - TITLE_BLOCK_LEFT,
    height: 1 - TITLE_BLOCK_TOP,
  }, TITLE_BLOCK_OCR_SCALE);
  return mergeDistinctLines(enhancedLines, titleLines);
}

export function shouldRunECOSTitleBlockOCR(lines: readonly Readonly<{ text: string }>[]) {
  // Reliability-critical sheet mapping cannot depend on the full-page pass
  // already recognizing the tiny word "SHEET". That circular trigger caused
  // the focused title-block pass to be skipped precisely when it was needed.
  // Every OCR-eligible drawing page now receives the bounded title-block pass.
  void lines;
  return true;
}

export function shouldRunECOSConstructionNoteOCR(lines: readonly Readonly<{ text: string }>[]) {
  return lines.some(line => /\b(?:construction\s+notes?|construct\s+\d|construct\s+[^\s]+\s+thick)\b/i.test(clean(line.text)));
}

function constructionNoteOCRBounds(lines: readonly ExtractLine[]) {
  const matches = lines.filter(line =>
    /\b(?:construction\s+notes?|construct)\b/i.test(clean(line.text))
  );
  if (matches.length === 0) return null;
  const left = Math.max(0, Math.min(...matches.map(line => line.x)) - 0.035);
  const top = Math.max(0, Math.min(...matches.map(line => line.y)) - 0.025);
  const right = Math.min(1, Math.max(
    left + 0.48,
    ...matches.map(line => line.x + line.width + 0.05),
  ));
  const bottom = Math.min(1, Math.max(
    top + 0.34,
    ...matches.map(line => line.y + line.height + 0.08),
  ));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function ocrFocusedPDFRegion(
  canvas: HTMLCanvasElement,
  worker: Awaited<ReturnType<typeof createOCRWorker>>,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  scale: number,
) {
  if (typeof document === 'undefined') return [];
  const sourceX = Math.max(0, Math.floor(canvas.width * bounds.x));
  const sourceY = Math.max(0, Math.floor(canvas.height * bounds.y));
  const sourceWidth = Math.max(1, Math.min(canvas.width - sourceX, Math.ceil(canvas.width * bounds.width)));
  const sourceHeight = Math.max(1, Math.min(canvas.height - sourceY, Math.ceil(canvas.height * bounds.height)));
  const focusedCanvas = document.createElement('canvas');
  focusedCanvas.width = Math.max(1, Math.ceil(sourceWidth * scale));
  focusedCanvas.height = Math.max(1, Math.ceil(sourceHeight * scale));
  const focusedContext = focusedCanvas.getContext('2d', { alpha: false });
  if (!focusedContext) return [];
  focusedContext.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    focusedCanvas.width,
    focusedCanvas.height,
  );
  const focusedResult = await worker.recognize(focusedCanvas, {}, { blocks: true });
  return tesseractLines(
    focusedResult.data as any,
    focusedCanvas.width,
    focusedCanvas.height,
  ).map(line => ({
    ...line,
    x: (sourceX + line.x * sourceWidth) / canvas.width,
    y: (sourceY + line.y * sourceHeight) / canvas.height,
    width: line.width * sourceWidth / canvas.width,
    height: line.height * sourceHeight / canvas.height,
  }));
}

async function ocrImage(
  file: File,
  pageNumber: number,
  candidateAreaNames: readonly string[],
): Promise<ReferenceDocumentExtractedPage> {
  const worker = await createOCRWorker();
  try {
    const result = await worker.recognize(file, {}, { blocks: true });
    const dimensions = await imageDimensions(file);
    return pageFromLines(
      pageNumber,
      tesseractLines(result.data as any, dimensions.width, dimensions.height),
      candidateAreaNames,
    );
  } finally {
    await worker.terminate();
  }
}

function tesseractLines(data: any, width: number, height: number): ExtractLine[] {
  const lines = (data.blocks || []).flatMap((block: any) =>
    (block.paragraphs || []).flatMap((paragraph: any) => paragraph.lines || []),
  );
  // Do not invent page coordinates when the OCR engine returns text without
  // bounding boxes. Exact snippets require real recognized regions.
  if (lines.length === 0) return [];
  return lines.flatMap((line: any) => {
    const text = clean(line.text);
    const box = line.bbox || {};
    if (!text || !width || !height) return [];
    const x0 = clamp(Number(box.x0) / width);
    const y0 = clamp(Number(box.y0) / height);
    const x1 = clamp(Number(box.x1) / width);
    const y1 = clamp(Number(box.y1) / height);
    if (x1 <= x0 || y1 <= y0) return [];
    return [{
      text,
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
      confidence: clamp((Number(line.confidence) || Number(data.confidence) || 0) / 100),
      source: 'ocr' as const,
    }];
  });
}

function pageFromLines(
  pageNumber: number,
  lines: readonly ExtractLine[],
  candidateAreaNames: readonly string[],
): ReferenceDocumentExtractedPage {
  const regions: ReferenceDocumentRegion[] = lines
    .filter(line => clean(line.text))
    .map((line, index) => {
      const text = normalizeECOSConstructionMeasurementText(line.text);
      return {
        id: `page-${pageNumber}-line-${index + 1}`,
        label: text,
        text,
        areaNames: matchingAreas(text, candidateAreaNames),
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        confidence: line.confidence,
        source: line.source,
        constituentEvidence: line.constituentEvidence
          ? [...line.constituentEvidence]
          : undefined,
      };
    });
  const text = boundedText(regions.map(region => region.text || '').join('\n'));
  const sheetMapping = buildECOSSheetMapping(regions);
  return {
    pageNumber,
    sheetNumber: sheetMapping.sheetNumber,
    sheetTitle: sheetMapping.sheetTitle,
    sheetMappingStatus: sheetMapping.status,
    sheetMappingConfidence: sheetMapping.confidence,
    sheetMappingCandidates: sheetMapping.candidates.map(candidate => ({
      sheetNumber: candidate.sheetNumber,
      score: candidate.score,
      confidence: candidate.confidence,
      evidenceRegionIds: [...candidate.evidenceRegionIds],
    })),
    title: sheetMapping.sheetTitle || regions[0]?.text?.slice(0, 160) || null,
    text: text || null,
    regions,
  };
}

function mergeVisualRegions(
  page: ReferenceDocumentExtractedPage,
  visualRegions: readonly ReferenceDocumentRegion[],
): ReferenceDocumentExtractedPage {
  const verified = visualRegions.filter(region =>
    region.source === 'vision' && clean(region.text || region.label) &&
    [region.x, region.y, region.width, region.height].every(value =>
      Number.isFinite(value) && value >= 0 && value <= 1
    ) && region.width > 0 && region.height > 0 &&
    region.x + region.width <= 1.001 && region.y + region.height <= 1.001
  ).filter((region, index, all) => all.findIndex(other =>
    normalizedVisualFactKey(other) === normalizedVisualFactKey(region)
  ) === index);
  if (verified.length === 0) return page;
  const regions = [...(page.regions || []), ...verified].filter((region, index, all) =>
    region.source !== 'vision' || all.findIndex(other =>
      other.source === 'vision' && normalizedVisualFactKey(other) === normalizedVisualFactKey(region)
    ) === index
  );
  const sheetMapping = buildECOSSheetMapping(regions);
  return {
    ...page,
    sheetNumber: sheetMapping.sheetNumber,
    sheetTitle: sheetMapping.sheetTitle || page.sheetTitle || null,
    sheetMappingStatus: sheetMapping.status,
    sheetMappingConfidence: sheetMapping.confidence,
    sheetMappingCandidates: sheetMapping.candidates.map(candidate => ({
      sheetNumber: candidate.sheetNumber,
      score: candidate.score,
      confidence: candidate.confidence,
      evidenceRegionIds: [...candidate.evidenceRegionIds],
    })),
    title: sheetMapping.sheetTitle || page.title || null,
    text: boundedText(regions
      .map(region => clean(region.text || region.label))
      .filter(Boolean)
      .join('\n')) || null,
    regions,
  };
}

function withVisualCoverage(
  page: ReferenceDocumentExtractedPage,
  overviewAnalyzed: boolean,
  requestedDeepReadRegionCount: number,
  completedTileKeys: ReadonlySet<string>,
  failureCodes: ReadonlySet<string>,
): ReferenceDocumentExtractedPage {
  const completedDeepReadRegionKeys = [...completedTileKeys].sort();
  return {
    ...page,
    visualCoverage: {
      overviewAnalyzed,
      requestedDeepReadRegionCount,
      completedDeepReadRegionCount: completedDeepReadRegionKeys.length,
      coverageComplete: overviewAnalyzed &&
        requestedDeepReadRegionCount > 0 &&
        completedDeepReadRegionKeys.length >= requestedDeepReadRegionCount,
      completedDeepReadRegionKeys,
      failureCodes: [...failureCodes].sort(),
    },
  };
}

function isExtractionCancellation(error: unknown, isCancelled?: () => boolean) {
  return isCancelled?.() || (error instanceof Error && error.name === 'AbortError');
}

function normalizedVisualFactKey(region: ReferenceDocumentRegion) {
  return clean(region.evidenceText || region.text || region.label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function renderPDFPageTileForVisualAnalysis(
  page: any,
  bounds: ECOSDrawingBounds,
) {
  if (typeof document === 'undefined') throw new Error('Drawing vision requires a browser canvas.');
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = VISUAL_TILE_RENDER_WIDTH / Math.max(1, baseViewport.width * bounds.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width * bounds.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height * bounds.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Drawing vision could not prepare a deep-read tile.');
  await page.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -viewport.width * bounds.x, -viewport.height * bounds.y],
  }).promise;
  return visualCanvasDataUrl(canvas);
}

async function renderPDFPageOverviewForVisualAnalysis(page: any) {
  if (typeof document === 'undefined') throw new Error('Drawing vision requires a browser canvas.');
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = 1_600 / Math.max(1, baseViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Drawing vision could not prepare the page overview.');
  await page.render({ canvasContext: context, viewport }).promise;
  return visualCanvasDataUrl(canvas);
}

function visualCanvasDataUrl(canvas: HTMLCanvasElement) {
  for (const quality of [0.82, 0.7, 0.58, 0.46]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_VISUAL_IMAGE_DATA_URL_LENGTH) return dataUrl;
  }
  const reduced = document.createElement('canvas');
  reduced.width = Math.max(1, Math.floor(canvas.width * 0.7));
  reduced.height = Math.max(1, Math.floor(canvas.height * 0.7));
  const reducedContext = reduced.getContext('2d', { alpha: false });
  if (!reducedContext) throw new Error('Drawing vision could not reduce the page image.');
  reducedContext.drawImage(canvas, 0, 0, reduced.width, reduced.height);
  const dataUrl = reduced.toDataURL('image/jpeg', 0.58);
  if (dataUrl.length > MAX_VISUAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error('The drawing page image was too large for secure visual analysis.');
  }
  return dataUrl;
}

function assertECOSVisualBatchSize(
  overviewImageDataUrl: string,
  tileImages: readonly Readonly<{ imageDataUrl: string }>[],
) {
  const largestRequestCharacters = tileImages.reduce(
    (largest, tile) => Math.max(largest, tile.imageDataUrl.length),
    0,
  );
  // Supabase Edge Functions accept a 20 MB request. Leave headroom for JSON,
  // OCR context, headers, and bounds while keeping every image high resolution.
  if (largestRequestCharacters > 18_000_000) {
    throw new Error('A high-resolution drawing tile was too large for secure analysis.');
  }
  if (!canUseCombinedECOSVisualBatch(overviewImageDataUrl, tileImages)) return;
  const totalRequestCharacters = overviewImageDataUrl.length + tileImages.reduce(
    (total, tile) => total + tile.imageDataUrl.length,
    0,
  );
  if (totalRequestCharacters > MAX_VISUAL_BATCH_DATA_URL_LENGTH) {
    throw new Error('The combined high-resolution drawing page was too large for secure analysis.');
  }
}

function canUseCombinedECOSVisualBatch(
  overviewImageDataUrl: string,
  tileImages: readonly Readonly<{ imageDataUrl: string }>[],
) {
  return overviewImageDataUrl.length + tileImages.reduce(
    (total, tile) => total + tile.imageDataUrl.length,
    0,
  ) <= MAX_VISUAL_BATCH_DATA_URL_LENGTH;
}

function regionOverlapsTile(region: ReferenceDocumentRegion, tile: ECOSDrawingBounds) {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  return centerX >= tile.x && centerX <= tile.x + tile.width &&
    centerY >= tile.y && centerY <= tile.y + tile.height;
}

export function selectECOSDeepReadRegions(
  requested: readonly Readonly<{ label: string; reason: string; bounds: ECOSDrawingBounds }>[],
) {
  const normalizedRequested = requested.map(request => ({
    label: clean(request.label).slice(0, 240) || 'Detailed drawing area',
    reason: clean(request.reason).slice(0, 500) || 'Small or dense drawing content requires a high-resolution pass.',
    bounds: normalizedDeepReadBounds(request.bounds),
  })).filter((request): request is { label: string; reason: string; bounds: ECOSDrawingBounds } => Boolean(request.bounds));

  // Overview-only analysis can miss the one note or symbol that answers a
  // field question. Every drawing receives deterministic full-page tile
  // coverage. Model-requested regions may annotate a tile, but may not replace
  // coverage of another part of the page.
  return FULL_PAGE_DEEP_READ_GRID.slice(0, MAX_DEEP_READ_REGIONS).map(tile => {
    const request = [...normalizedRequested].sort((left, right) =>
      overlappingBounds(right.bounds, tile.bounds) - overlappingBounds(left.bounds, tile.bounds)
    )[0];
    const overlap = request ? overlappingBounds(request.bounds, tile.bounds) : 0;
    return {
      label: overlap > 0.12 ? `${tile.label}: ${request!.label}` : tile.label,
      reason: overlap > 0.12
        ? request!.reason
        : 'Complete high-resolution coverage is required so small notes, dimensions, symbols, and callouts are not omitted.',
      bounds: { ...tile.bounds },
    };
  });
}

function normalizedDeepReadBounds(value: ECOSDrawingBounds) {
  const x = clamp(Number(value.x));
  const y = clamp(Number(value.y));
  const right = clamp(x + Number(value.width));
  const bottom = clamp(y + Number(value.height));
  if (![x, y, right, bottom].every(Number.isFinite) || right - x < 0.05 || bottom - y < 0.05) return null;
  const padding = 0.015;
  const left = Math.max(0, x - padding);
  const top = Math.max(0, y - padding);
  const paddedRight = Math.min(1, right + padding);
  const paddedBottom = Math.min(1, bottom + padding);
  return {
    x: left,
    y: top,
    width: paddedRight - left,
    height: paddedBottom - top,
  };
}

function overlappingBounds(left: ECOSDrawingBounds, right: ECOSDrawingBounds) {
  const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = intersectionWidth * intersectionHeight;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? intersection / smaller : 0;
}

function finalizeExtraction(
  pages: readonly ReferenceDocumentExtractedPage[],
  indexedAt: string,
  limitations: readonly string[],
  usedOCR: boolean,
  usedEmbeddedText: boolean,
  sourcePageCount = pages.length,
): ECOSDocumentExtraction {
  const extractedText = boundedText(pages.map(page => page.text || '').join('\n\n'));
  const hasMissingPages = pages.some(page => !clean(page.text));
  const searchablePageCount = pages.filter(page => clean(page.text) ||
    (page.regions ?? []).some(region => clean(region.text || region.label))).length;
  const regionConfidences = pages.flatMap(page => (page.regions ?? [])
    .map(region => region.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  const extractionAverageConfidence = regionConfidences.length > 0
    ? regionConfidences.reduce((sum, value) => sum + value, 0) / regionConfidences.length
    : null;
  const ocrPageCount = pages.filter(page =>
    (page.regions ?? []).some(region => region.source === 'ocr'),
  ).length;
  // Search extraction and visual proof coverage are independent readiness
  // dimensions. A drawing can have every source page searchable while only a
  // subset has completed high-resolution visual tiles. Keep those visual
  // limitations visible, but do not misreport the text/page index as partial.
  const extractionStatus = extractedText
    ? hasMissingPages || searchablePageCount < sourcePageCount ? 'partial' : 'complete'
    : 'failed';
  return {
    extractedText: extractedText || null,
    extractedPages: [...pages],
    extractionStatus,
    extractionMethod: usedOCR && usedEmbeddedText
      ? 'embedded_text_and_ocr'
      : usedOCR ? 'local_ocr' : usedEmbeddedText ? 'embedded_text' : null,
    extractionLimitations: [...new Set(limitations)],
    documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
    documentVisualIndexVersion: 'ecos-visual-index/3.0',
    indexedAt,
    sourcePageCount,
    searchablePageCount,
    ocrPageCount,
    extractionAverageConfidence,
    indexedContentSha256: null,
  };
}

export function shouldSupplementECOSPdfPageWithOCR(
  lines: readonly Readonly<{ text: string }>[],
) {
  if (lines.length === 0) return true;
  const pageText = lines.map(line => clean(line.text)).filter(Boolean).join(' ');
  const characterCount = pageText.length;
  const hasCADPlotMarker = /(?:\.dwg\b|autocad\s+pdf|high\s+quality\s+print)/i.test(pageText);
  const tokens = pageText.split(/\s+/).filter(Boolean);
  const wordTokens = tokens.filter(token => /[a-z]{2,}/i.test(token));
  const isolatedGlyphTokens = tokens.filter(token => /^[a-z0-9]$/i.test(token));
  const fragmentedTokenLayer = tokens.length >= 20 && (
    wordTokens.length / tokens.length < 0.45 ||
    isolatedGlyphTokens.length / tokens.length >= 0.35 ||
    /(?:\b[a-z0-9]\b\s+){5,}/i.test(pageText)
  );
  const shortLineRatio = lines.filter(line => clean(line.text).length <= 3).length / lines.length;
  const fragmentedLineLayer = lines.length >= 12 && shortLineRatio >= 0.4;

  // CAD-exported construction sheets often expose only the plot path and
  // title block as embedded PDF text. Treating those few strings as a complete
  // page caused ECOS to report 100% coverage while omitting the plan notes and
  // dimensions that answer field questions. A dense CAD text layer remains
  // authoritative; sparse CAD output is supplemented with drawing OCR.
  return lines.length < 3 ||
    characterCount < 120 ||
    fragmentedTokenLayer ||
    fragmentedLineLayer ||
    (hasCADPlotMarker && (lines.length < 40 || characterCount < 2_000));
}

function mergeDistinctLines(
  embedded: readonly ExtractLine[],
  recognized: readonly ExtractLine[],
) {
  const next = [...embedded];
  recognized.forEach(line => {
    const normalized = normalize(line.text);
    const duplicate = next.some(existing => {
      const existingText = normalize(existing.text);
      const textMatches = existingText === normalized ||
        (normalized.length >= 8 && (existingText.includes(normalized) || normalized.includes(existingText)));
      const spatiallyClose = Math.abs(existing.x - line.x) <= 0.03 &&
        Math.abs(existing.y - line.y) <= 0.03;
      return textMatches && spatiallyClose;
    });
    if (!duplicate) next.push(line);
  });
  return next.sort((left, right) => left.y - right.y || left.x - right.x);
}

export function mergeECOSPdfTextItems(lines: readonly ExtractLine[]): ExtractLine[] {
  const ordered = [...lines].sort((left, right) => left.y - right.y || left.x - right.x);
  const rows: ExtractLine[][] = [];
  ordered.forEach(line => {
    const row = rows.find(candidate => Math.abs(candidate[0].y - line.y) <= 0.006);
    if (row) row.push(line);
    else rows.push([line]);
  });
  return rows.flatMap(row => {
    const sorted = row.sort((left, right) => left.x - right.x);
    const groups: ExtractLine[][] = [];
    sorted.forEach(item => {
      const group = groups.at(-1);
      const previous = group?.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const maximumWordGap = previous
        ? Math.max(0.025, Math.max(previous.height, item.height) * 3)
        : Number.POSITIVE_INFINITY;
      if (!group || gap > maximumWordGap) groups.push([item]);
      else group.push(item);
    });
    return groups.map(group => {
      const left = Math.min(...group.map(item => item.x));
      const top = Math.min(...group.map(item => item.y));
      const right = Math.max(...group.map(item => item.x + item.width));
      const bottom = Math.max(...group.map(item => item.y + item.height));
      return {
        text: clean(group.map(item => item.text).join(' ')),
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        confidence: 1,
        source: 'embedded_text' as const,
        constituentEvidence: group.length > 1
          ? group.map(item => ({
              text: item.text,
              source: item.source,
              confidence: item.confidence,
              bounds: {
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
              },
            }))
          : undefined,
      };
    });
  });
}

function textLines(text: string, source: ExtractLine['source']): ExtractLine[] {
  return text.split(/\r?\n/).map(clean).filter(Boolean).map((line, index, all) => ({
    text: line,
    x: 0.04,
    y: clamp(0.04 + (index / Math.max(1, all.length)) * 0.9),
    width: 0.92,
    height: clamp(0.9 / Math.max(1, all.length), 0.01, 0.08),
    confidence: source === 'embedded_text' ? 1 : 0.5,
    source,
  }));
}

function matchingAreas(text: string, candidates: readonly string[]) {
  const normalizedText = normalize(text);
  return candidates.filter(candidate => {
    const normalizedCandidate = normalize(candidate);
    return normalizedCandidate && (
      normalizedText === normalizedCandidate ||
      normalizedText.includes(normalizedCandidate)
    );
  });
}

export function detectECOSSheetNumber(regions: readonly ReferenceDocumentRegion[]) {
  return buildECOSSheetMapping(regions).sheetNumber;
}

/**
 * Repairs only high-confidence construction-measurement OCR artifacts. CAD
 * plots frequently turn a closing inch mark into a 7 (for example 4" becomes
 * 47). The correction is intentionally limited to realistic one-digit PCC or
 * concrete thickness notes so legitimate dimensions are not silently changed.
 */
export function normalizeECOSConstructionMeasurementText(value: string) {
  return clean(value)
    .replace(/[“”″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(
      /\b(CONSTRUCT|PROVIDE|INSTALL)\s+([2-9])7\s+(THICK\s+(?:PCC|CONCRETE|SLAB|WALKWAY|PAVING))\b/gi,
      '$1 $2" $3',
    )
    .replace(
      /\b([2-9])\s*[|Il]\s+(THICK\s+(?:PCC|CONCRETE|SLAB|WALKWAY|PAVING))\b/g,
      '$1" $2',
    );
}

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof document === 'undefined') return Promise.resolve({ width: 1, height: 1 });
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected image could not be prepared for OCR.'));
    };
    image.src = url;
  });
}

function boundedText(value: string) {
  return value.slice(0, MAX_CHARACTERS).trim();
}

function clean(value: unknown) {
  return sanitizeECOSDocumentText(value);
}

function normalize(value: string) {
  return clean(value).toLowerCase();
}

function clamp(value: number, minimum = 0, maximum = 1) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
