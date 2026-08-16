import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from './ECOSDrawingVisualCoverage';

export type ECOSDocumentCoverageSummary = Readonly<{
  indexedPageCount: number;
  fullVisualCoveragePageCount: number;
  verifiedSheetPageCount: number;
  conflictedSheetPageCount: number;
}>;

/**
 * Reduces the protected ECOS page index to the small set of counts needed by
 * the document inspector. The source PDF and extracted page content are not
 * downloaded as part of this summary.
 */
export function summarizeECOSDocumentCoverageRows(
  rows: readonly unknown[],
): ECOSDocumentCoverageSummary {
  const pages = new Map<number, Record<string, unknown>>();
  rows.forEach(value => {
    const row = record(value);
    const pageNumber = positiveInteger(row.page_number);
    if (pageNumber > 0) pages.set(pageNumber, row);
  });

  const pageRows = [...pages.values()];
  return Object.freeze({
    indexedPageCount: pageRows.length,
    fullVisualCoveragePageCount: pageRows.filter(row => {
      const coverage = record(row.visual_coverage);
      const requested = nonNegativeInteger(coverage.requestedDeepReadRegionCount);
      const completed = nonNegativeInteger(coverage.completedDeepReadRegionCount);
      const completedKeys = new Set(array(coverage.completedDeepReadRegionKeys).map(text).filter(Boolean));
      return coverage.overviewAnalyzed === true &&
        coverage.coverageComplete === true &&
        requested >= ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
        completed >= ECOS_DRAWING_REQUIRED_TILE_KEYS.length &&
        ECOS_DRAWING_REQUIRED_TILE_KEYS.every(key => completedKeys.has(key));
    }).length,
    verifiedSheetPageCount: pageRows.filter(row =>
      row.sheet_mapping_status === 'verified' && text(row.sheet_number),
    ).length,
    conflictedSheetPageCount: pageRows.filter(row =>
      row.sheet_mapping_status === 'conflicted',
    ).length,
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
