export type ECOSNormalizedBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export const ECOS_RENDERED_SHEET_IDENTITY_SOURCES = Object.freeze([
  'fixed_visual_tile_coordinate_ocr',
  'sheet_identity_ocr_landscape_native',
  'sheet_identity_ocr_page_bound_validated',
  'sheet_identity_ocr_vertical_outline',
  'title_block_ocr',
] as const);

/** Backward-compatible alias for callers that only validate annotations. */
export const ECOS_PDF_ANNOTATION_RENDERED_SOURCES =
  ECOS_RENDERED_SHEET_IDENTITY_SOURCES;

export type ECOSRenderedSheetIdentityCorroboration = Readonly<{
  renderedCorroborated: true;
  renderedCorroboratingRegionIds: readonly string[];
  renderedCorroboratingSources: readonly string[];
}>;

export type ECOSPDFAnnotationRenderedCorroboration =
  ECOSRenderedSheetIdentityCorroboration;

export function strictPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function strictNormalizedBounds(value: unknown): ECOSNormalizedBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bounds = value as Record<string, unknown>;
  const x = strictNormalizedNumber(bounds.x);
  const y = strictNormalizedNumber(bounds.y);
  const width = strictNormalizedNumber(bounds.width);
  const height = strictNormalizedNumber(bounds.height);
  if (x == null || y == null || width == null || height == null ||
      width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;
  return { x, y, width, height };
}

export function validPDFAnnotationEvidenceId(id: string, pageNumber: number): boolean {
  if (strictPositiveInteger(pageNumber) == null) return false;
  const match = /^pdf-annotation-[0-9]+-page-([1-9][0-9]*)$/.exec(id);
  return Boolean(match && match[1] === String(pageNumber));
}

export function strictPDFAnnotationRenderedCorroboration(
  value: unknown,
): ECOSPDFAnnotationRenderedCorroboration | null {
  return strictRenderedSheetIdentityCorroboration(value);
}

export function strictRenderedSheetIdentityCorroboration(
  value: unknown,
): ECOSRenderedSheetIdentityCorroboration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const regionIds = strictUniqueStrings(record.renderedCorroboratingRegionIds, 8, 300);
  const sources = strictUniqueStrings(record.renderedCorroboratingSources, 8, 80);
  if (record.renderedCorroborated !== true || !regionIds || !sources ||
      sources.some(source => !ECOS_RENDERED_SHEET_IDENTITY_SOURCES.includes(
        source as typeof ECOS_RENDERED_SHEET_IDENTITY_SOURCES[number],
      ))) return null;
  return Object.freeze({
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: Object.freeze(regionIds),
    renderedCorroboratingSources: Object.freeze(sources),
  });
}

/**
 * Replays a rendered sheet-identity receipt against the current page regions.
 * Every cited identifier must resolve exactly once, retain the declared OCR
 * source, remain searchable, and contain the exact expected sheet token.
 */
export function renderedSheetIdentityMatchesCurrentRegions(
  value: unknown,
  regionsValue: unknown,
  expectedSheetNumberValue: unknown,
): boolean {
  const corroboration = strictRenderedSheetIdentityCorroboration(value);
  const expectedSheetNumber = strictText(expectedSheetNumberValue, 160);
  if (!corroboration || !Array.isArray(regionsValue) || !expectedSheetNumber) return false;
  const observedSources = new Set<string>();
  for (const regionId of corroboration.renderedCorroboratingRegionIds) {
    const matches = regionsValue.filter(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      return strictText((item as Record<string, unknown>).id, 300) === regionId;
    });
    if (matches.length !== 1) return false;
    const region = matches[0] as Record<string, unknown>;
    const source = strictText(region.rawSource ?? region.source, 80);
    const regionText = strictText(region.text ?? region.label, 1_000);
    if (
      region.searchable !== true
      || !source
      || !corroboration.renderedCorroboratingSources.includes(source)
      || !renderedTextContainsExactSheetIdentity(regionText, expectedSheetNumber)
    ) return false;
    observedSources.add(source);
  }
  return observedSources.size === corroboration.renderedCorroboratingSources.length &&
    corroboration.renderedCorroboratingSources.every(source => observedSources.has(source));
}

export function renderedTextContainsExactSheetIdentity(
  value: unknown,
  expectedSheetNumberValue: unknown,
): boolean {
  const text = strictText(value, 1_000).toUpperCase();
  const expected = canonicalComparableSheetNumber(
    strictText(expectedSheetNumberValue, 160),
  );
  if (!text || !expected) return false;
  const pattern = /(?:^|[^A-Z0-9])((?=[A-Z])(?:[A-Z]{1,4}\s*[-–—]\s*){0,2}[A-Z]{0,4}\s*[-.]?\s*\d{1,3}(?:\.\d{1,3})?[A-Z]?)(?=$|[^A-Z0-9])/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (canonicalComparableSheetNumber(match[1]) === expected) return true;
  }
  return false;
}

export function bookmarkTextMatchesSheetIdentity(
  value: unknown,
  expectedSheetNumberValue: unknown,
): boolean {
  const text = strictText(value, 1_000);
  const expected = canonicalComparableSheetNumber(
    strictText(expectedSheetNumberValue, 160),
  );
  if (!text || !expected) return false;
  const street = /^\s*SIP\s+SHT\s+([1-9]\d{0,2})\s*--\s*$/i.exec(text);
  if (street) return `SIP-SHT-${Number(street[1])}` === expected;
  const inserted = /^\s*A12A\s*[-–—]\s*(A\s*[-–—]?\s*1\.5A)\s*$/i.exec(text);
  if (inserted) return canonicalBookmarkSheetNumber(inserted[1]) === expected;
  const ordinary = /^\s*[A-Z]{1,4}\d{1,4}\s*[-–—]\s*((?:[A-Z]{1,4}(?:\s*[-–—]\s*[A-Z]{1,4}){0,2})\s*[-–—]?\s*\d{1,3}(?:\.\d{1,2})?)\s*$/i.exec(text);
  return Boolean(ordinary && canonicalBookmarkSheetNumber(ordinary[1]) === expected);
}

function strictNormalizedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function strictUniqueStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) return null;
  const normalized = value.map(item => typeof item === 'string' ? item.trim() : '');
  if (normalized.some(item => !item || item.length > maximumLength) ||
      new Set(normalized).size !== normalized.length) return null;
  return normalized;
}

function strictText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

function canonicalSheetNumber(value: string): string {
  return value.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/-\./g, '-');
}

function canonicalBookmarkSheetNumber(value: string): string | null {
  const normalized = canonicalSheetNumber(value);
  if (!normalized) return null;
  if (normalized.includes('-')) return normalized;
  const match = /^([A-Z]{1,4})(\d{1,3}(?:\.\d{1,2})?[A-Z]?)$/.exec(normalized);
  if (!match) return null;
  const [, prefix, number] = match;
  if (prefix === 'XE') return `X-E-${number}`;
  if (['A', 'E', 'MB', 'PB', 'SB', 'WPA', 'WPB', 'WPC'].includes(prefix)) {
    return `${prefix}-${number}`;
  }
  return `${prefix}${number}`;
}

function canonicalComparableSheetNumber(value: string): string {
  return canonicalBookmarkSheetNumber(value) || canonicalSheetNumber(value);
}
