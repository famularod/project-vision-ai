import type { ReferenceDocumentExtractedPage } from '../types';
import type { ECOSDrawingBounds } from './ECOSDrawingPageAnalysis';
import { ECOSDrawingPageAnalysisError } from './ECOSDrawingPageAnalysis';

export const ECOS_DRAWING_ANALYSIS_MAX_ATTEMPTS = 8;
export const ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION = 'ecos-visual-coverage/1.0';
export const ECOS_DRAWING_VISUAL_EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';

export const ECOS_DRAWING_REQUIRED_TILE_KEYS = Object.freeze([
  '0:0:333:500',
  '333:0:333:500',
  '667:0:333:500',
  '0:500:333:500',
  '333:500:333:500',
  '667:500:333:500',
] as const);

const ECOS_DRAWING_REQUIRED_TILE_BOUNDS = Object.freeze({
  '0:0:333:500': { x: 0, y: 0, width: 1 / 3, height: 0.5 },
  '333:0:333:500': { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
  '667:0:333:500': { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
  '0:500:333:500': { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
  '333:500:333:500': { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  '667:500:333:500': { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
} as const);

type ECOSVisualTileProof = NonNullable<
  NonNullable<ReferenceDocumentExtractedPage['visualCoverage']>['completedDeepReadRegionProofs']
>[number];

const NON_RETRYABLE_ANALYSIS_CODES = new Set([
  'analysis_prepaid_credits_depleted',
  'analysis_quota_exhausted',
  'analysis_request_exceeds_rate_limit',
  'forbidden',
  'invalid_request',
  'method_not_allowed',
  'not_configured',
  'origin_not_allowed',
  'request_too_large',
  'signed_out',
  'unauthorized',
]);

export type ECOSDrawingAnalysisRetryOptions = Readonly<{
  maximumAttempts?: number;
  isCancelled?: () => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  onStatus?: (status: ECOSDrawingAnalysisRetryStatus) => void;
}>;

export type ECOSDrawingAnalysisRetryStatus = Readonly<{
  state: 'attempting' | 'waiting';
  attempt: number;
  maximumAttempts: number;
  waitMilliseconds: number;
  failureCode: string | null;
}>;

export async function runECOSDrawingAnalysisWithRetry<T>(
  operation: () => Promise<T>,
  options: ECOSDrawingAnalysisRetryOptions = {},
): Promise<T> {
  const maximumAttempts = Math.max(
    1,
    Math.min(12, Math.floor(options.maximumAttempts ?? ECOS_DRAWING_ANALYSIS_MAX_ATTEMPTS)),
  );
  const wait = options.wait ?? defaultWait;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (options.isCancelled?.()) throw cancellationError();
    options.onStatus?.({
      state: 'attempting',
      attempt,
      maximumAttempts,
      waitMilliseconds: 0,
      failureCode: null,
    });
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableECOSDrawingAnalysisError(error) || attempt === maximumAttempts) throw error;
      const providerCooldown = error instanceof ECOSDrawingPageAnalysisError
        ? error.retryAfterMilliseconds || 0
        : 0;
      const waitMilliseconds = Math.max(
        providerCooldown,
        Math.min(60_000, 1_000 * (2 ** (attempt - 1))),
      );
      options.onStatus?.({
        state: 'waiting',
        attempt,
        maximumAttempts,
        waitMilliseconds,
        failureCode: ecosDrawingAnalysisFailureCode(error),
      });
      await wait(waitMilliseconds);
    }
  }
  throw lastError;
}

export function isRetryableECOSDrawingAnalysisError(error: unknown) {
  if (error instanceof ECOSDrawingPageAnalysisError) {
    return !NON_RETRYABLE_ANALYSIS_CODES.has(error.code);
  }
  if (error instanceof Error && error.name === 'AbortError') return false;
  return true;
}

export function ecosDrawingAnalysisFailureCode(error: unknown) {
  if (error instanceof ECOSDrawingPageAnalysisError) return cleanCode(error.code);
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  if (error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`)) return 'analysis_timeout';
  return 'analysis_failed';
}

export function ecosDrawingTileKey(bounds: ECOSDrawingBounds) {
  return [bounds.x, bounds.y, bounds.width, bounds.height]
    .map(value => Math.round(value * 1_000))
    .join(':');
}

export function completedECOSDrawingTileKeys(page: ReferenceDocumentExtractedPage | null | undefined) {
  return new Set((page?.visualCoverage?.completedDeepReadRegionKeys ?? [])
    .map(cleanCode)
    .filter(Boolean));
}

export function hasCompleteECOSDrawingVisualCoverage(
  page: ReferenceDocumentExtractedPage | null | undefined,
) {
  const coverage = page?.visualCoverage;
  const completedKeys = completedECOSDrawingTileKeys(page);
  const proofs = coverage?.completedDeepReadRegionProofs ?? [];
  const proofKeys = proofs.map(proof => proof.tileKey);
  const analysisRegionIds = proofs.flatMap(proof => proof.analysisRegionIds ?? []);
  return coverage?.overviewAnalyzed === true &&
    coverage.coverageComplete === true &&
    coverage.schemaVersion === ECOS_DRAWING_VISUAL_COVERAGE_SCHEMA_VERSION &&
    coverage.evidenceVersion === ECOS_DRAWING_VISUAL_EVIDENCE_VERSION &&
    canonicalSha256(coverage.sourceSha256) !== null &&
    coverage.pageNumber === page?.pageNumber &&
    coverage.requestedDeepReadRegionCount === ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
    coverage.completedDeepReadRegionCount === ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
    coverage.failureCodes?.length === 0 &&
    completedKeys.size === ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
    ECOS_DRAWING_REQUIRED_TILE_KEYS.every(key => completedKeys.has(key)) &&
    proofs.length === ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
    new Set(proofKeys).size === ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
    new Set(analysisRegionIds).size === analysisRegionIds.length &&
    proofs.every(proof => validCompletedECOSDrawingTileProof(proof, {
      pageNumber: page!.pageNumber,
      sourceSha256: coverage.sourceSha256!,
      evidenceVersion: coverage.evidenceVersion!,
    }));
}

function validCompletedECOSDrawingTileProof(
  proof: ECOSVisualTileProof,
  expected: { pageNumber: number; sourceSha256: string; evidenceVersion: string },
) {
  if (!proof) return false;
  const expectedBounds = ECOS_DRAWING_REQUIRED_TILE_BOUNDS[
    proof.tileKey as keyof typeof ECOS_DRAWING_REQUIRED_TILE_BOUNDS
  ];
  const analysisIds = proof.analysisRegionIds ?? [];
  const searchableIds = proof.searchableRegionIds ?? [];
  return Boolean(expectedBounds) &&
    proof.state === 'completed' &&
    proof.pageNumber === expected.pageNumber &&
    canonicalSha256(proof.sourceSha256) === canonicalSha256(expected.sourceSha256) &&
    proof.evidenceVersion === expected.evidenceVersion &&
    normalizedBoundsEqual(proof.bounds, expectedBounds) &&
    proof.renderMethod === 'pymupdf_rgb_png' &&
    proof.analysisMethod === 'tesseract_coordinate_ocr_psm11' &&
    canonicalSha256(proof.renderSha256) !== null &&
    canonicalSha256(proof.analysisInputSha256) !== null &&
    canonicalSha256(proof.analysisSha256) !== null &&
    Number.isInteger(proof.renderDpi) && proof.renderDpi >= 150 && proof.renderDpi <= 300 &&
    Number.isInteger(proof.renderPixelWidth) && proof.renderPixelWidth >= 1 && proof.renderPixelWidth <= 10_000 &&
    Number.isInteger(proof.renderPixelHeight) && proof.renderPixelHeight >= 1 && proof.renderPixelHeight <= 10_000 &&
    Number.isInteger(proof.analysisRegionCount) && proof.analysisRegionCount >= 0 &&
    analysisIds.length === proof.analysisRegionCount &&
    new Set(analysisIds).size === analysisIds.length &&
    analysisIds.every((id: string) => id.startsWith(`visual-tile-${proof.tileKey}-`)) &&
    Number.isInteger(proof.searchableRegionCount) && proof.searchableRegionCount >= 0 &&
    searchableIds.length === proof.searchableRegionCount &&
    new Set(searchableIds).size === searchableIds.length &&
    searchableIds.every((id: string) => analysisIds.includes(id));
}

function normalizedBoundsEqual(
  actual: { x: number; y: number; width: number; height: number } | null | undefined,
  expected: { x: number; y: number; width: number; height: number },
) {
  return Boolean(actual) && (['x', 'y', 'width', 'height'] as const).every(key =>
    Number.isFinite(actual![key]) && Math.abs(actual![key] - expected[key]) <= 1e-9,
  );
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export function incompleteECOSDrawingPageCount(
  pages: readonly ReferenceDocumentExtractedPage[] | null | undefined,
) {
  return (pages ?? []).filter(page => !hasCompleteECOSDrawingVisualCoverage(page)).length;
}

function cleanCode(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').slice(0, 160)
    : '';
}

function defaultWait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function cancellationError() {
  const error = new Error('The drawing index update was cancelled.');
  error.name = 'AbortError';
  return error;
}
