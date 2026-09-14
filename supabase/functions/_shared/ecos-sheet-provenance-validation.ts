export type ECOSNormalizedBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export const ECOS_RENDERED_SHEET_IDENTITY_SOURCES = Object.freeze(
  [
    "fixed_visual_tile_coordinate_ocr",
    "sheet_identity_ocr_landscape_native",
    "sheet_identity_ocr_page_bound_validated",
    "sheet_identity_ocr_vertical_outline",
    "title_block_ocr",
  ] as const,
);

/** Backward-compatible alias for callers that only validate annotations. */
export const ECOS_PDF_ANNOTATION_RENDERED_SOURCES =
  ECOS_RENDERED_SHEET_IDENTITY_SOURCES;

export const ECOS_UNSUPPORTED_SHEET_COMPATIBILITY_MARKER = "\uE000";

const ECOS_SUPPORTED_SHEET_COMPATIBILITY_ALPHANUMERIC = /^[Ａ-Ｚａ-ｚ０-９]$/u;

/**
 * Preserve ordinary NFKC behavior while preventing compatibility symbols from
 * becoming sheet letters or digits before the exact-identity parser sees them.
 */
export function normalizeECOSSheetIdentityScanText(value: string): string {
  const guarded = [...value].map((character) => {
    const compatibility = character.normalize("NFKC");
    return compatibility !== character && /[A-Za-z0-9]/.test(compatibility) &&
        !ECOS_SUPPORTED_SHEET_COMPATIBILITY_ALPHANUMERIC.test(character)
      ? ECOS_UNSUPPORTED_SHEET_COMPATIBILITY_MARKER
      : character;
  }).join("");
  return guarded.normalize("NFKC").replace(/[‐‑‒–—―−]/g, "-");
}

export type ECOSRenderedSheetIdentityCorroboration = Readonly<{
  renderedCorroborated: true;
  renderedCorroboratingRegionIds: readonly string[];
  renderedCorroboratingSources: readonly string[];
}>;

export type ECOSPDFAnnotationRenderedCorroboration =
  ECOSRenderedSheetIdentityCorroboration;

export function strictPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function strictNormalizedBounds(
  value: unknown,
): ECOSNormalizedBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bounds = value as Record<string, unknown>;
  const x = strictNormalizedNumber(bounds.x);
  const y = strictNormalizedNumber(bounds.y);
  const width = strictNormalizedNumber(bounds.width);
  const height = strictNormalizedNumber(bounds.height);
  if (
    x == null || y == null || width == null || height == null ||
    width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001
  ) return null;
  return { x, y, width, height };
}

export function validPDFAnnotationEvidenceId(
  id: string,
  pageNumber: number,
): boolean {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const regionIds = strictUniqueStrings(
    record.renderedCorroboratingRegionIds,
    8,
    300,
  );
  const sources = strictUniqueStrings(
    record.renderedCorroboratingSources,
    8,
    80,
  );
  if (
    record.renderedCorroborated !== true || !regionIds || !sources ||
    sources.some((source) =>
      !ECOS_RENDERED_SHEET_IDENTITY_SOURCES.includes(
        source as typeof ECOS_RENDERED_SHEET_IDENTITY_SOURCES[number],
      )
    )
  ) return null;
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
  const expectedSheetNumber = canonicalComparableSheetNumber(
    expectedSheetNumberValue,
  );
  if (!corroboration || !Array.isArray(regionsValue) || !expectedSheetNumber) {
    return false;
  }
  const receipt = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const receiptSource = strictText(receipt.source, 64);
  const receiptText = strictText(receipt.text, 1_000);
  const annotationReceipt = receiptSource === "pdf_annotation";
  if (annotationReceipt && !receiptText) return false;
  if (annotationReceipt) {
    return renderedPDFAnnotationSheetIdentityMatchesCurrentRegions(
      receipt,
      regionsValue,
      expectedSheetNumber,
      corroboration,
    );
  }
  if (
    receiptSource === "pdf_bookmark" &&
    corroboration.renderedCorroboratingSources.includes(
      "sheet_identity_ocr_page_bound_validated"
    )
  ) {
    return renderedPDFBookmarkSheetIdentityMatchesCurrentRegions(
      receipt,
      regionsValue,
      expectedSheetNumber,
      corroboration,
    );
  }
  const observedSources = new Set<string>();
  for (const regionId of corroboration.renderedCorroboratingRegionIds) {
    const matches = regionsValue.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      return strictText((item as Record<string, unknown>).id, 300) === regionId;
    });
    if (matches.length !== 1) return false;
    const region = matches[0] as Record<string, unknown>;
    const source = strictText(region.rawSource ?? region.source, 80);
    const regionText = strictText(region.text ?? region.label, 1_000);
    if (
      region.searchable !== true ||
      !source ||
      !corroboration.renderedCorroboratingSources.includes(source) ||
      !renderedTextContainsExactSheetIdentity(regionText, expectedSheetNumber)
    ) return false;
    observedSources.add(source);
  }
  const currentRenderedSheetIdentities = new Set<string>();
  for (const item of regionsValue) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const region = item as Record<string, unknown>;
    const source = strictText(region.rawSource ?? region.source, 80);
    const regionText = strictText(region.text ?? region.label, 1_000);
    if (
      region.searchable !== true ||
      !ECOS_RENDERED_SHEET_IDENTITY_SOURCES.includes(
        source as typeof ECOS_RENDERED_SHEET_IDENTITY_SOURCES[number],
      ) ||
      !regionText
    ) continue;
    for (const occurrence of renderedSheetIdentityOccurrences(regionText)) {
      if (!occurrence.qualified) {
        currentRenderedSheetIdentities.add(occurrence.identity);
      }
    }
  }
  return observedSources.size ===
      corroboration.renderedCorroboratingSources.length &&
    corroboration.renderedCorroboratingSources.every((source) =>
      observedSources.has(source)
    ) &&
    currentRenderedSheetIdentities.size === 1 &&
    currentRenderedSheetIdentities.has(expectedSheetNumber);
}

function renderedPDFBookmarkSheetIdentityMatchesCurrentRegions(
  receipt: Record<string, unknown>,
  regionsValue: unknown[],
  expectedSheetNumber: string,
  corroboration: ECOSRenderedSheetIdentityCorroboration,
): boolean {
  const receiptPageNumber = strictPositiveInteger(
    receipt.pageNumber ?? receipt.page_number,
  );
  if (
    receiptPageNumber == null ||
    !bookmarkTextMatchesSheetIdentity(receipt.text, expectedSheetNumber) ||
    !corroboration.renderedCorroboratingSources.includes(
      "sheet_identity_ocr_page_bound_validated",
    )
  ) return false;
  const exactAuthorityId =
    `sheet-identity-page-bound-validated-${receiptPageNumber}`;
  const observedSources = new Set<string>();
  let exactAuthorityCount = 0;
  let exactAuthorityBounds: ECOSNormalizedBounds | null = null;
  for (const citedId of corroboration.renderedCorroboratingRegionIds) {
    const matches = regionsValue.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      return strictText((item as Record<string, unknown>).id, 300) === citedId;
    });
    // IDs are the replay authority. A duplicate anywhere in the current
    // region snapshot is ambiguous even when the duplicate declares another
    // otherwise supported OCR source.
    if (matches.length !== 1) return false;
    const region = matches[0] as Record<string, unknown>;
    const source = strictConsistentRenderedRegionSource(region);
    const regionText = strictConsistentRenderedRegionText(region);
    if (
      region.searchable !== true ||
      !source ||
      !corroboration.renderedCorroboratingSources.includes(source) ||
      !renderedTextContainsExactSheetIdentity(regionText, expectedSheetNumber)
    ) return false;
    observedSources.add(source);
    if (source !== "sheet_identity_ocr_page_bound_validated") continue;
    const bounds = strictNormalizedBounds({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
    if (
      citedId !== exactAuthorityId ||
      bounds == null ||
      !boundsInsidePageBoundValidatedSheetCell(bounds) ||
      canonicalComparableSheetNumber(regionText) !== expectedSheetNumber
    ) return false;
    exactAuthorityCount += 1;
    exactAuthorityBounds = bounds;
  }
  const exactSourceRegions = regionsValue.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const region = item as Record<string, unknown>;
    return [region.rawSource, region.source].some((value) =>
      value === "sheet_identity_ocr_page_bound_validated"
    );
  });
  if (exactSourceRegions.length !== 1) return false;
  const exactRegion = exactSourceRegions[0] as Record<string, unknown>;
  if (
    exactAuthorityCount !== 1 || !exactAuthorityBounds ||
    strictText(exactRegion.id, 300) !== exactAuthorityId ||
    strictConsistentRenderedRegionSource(exactRegion) !==
      "sheet_identity_ocr_page_bound_validated" ||
    observedSources.size !==
      corroboration.renderedCorroboratingSources.length ||
    !corroboration.renderedCorroboratingSources.every((source) =>
      observedSources.has(source)
    )
  ) return false;

  // The page-bound producer cell is the primary authority, but a second
  // rendered identity in the same bottom-right title band makes that
  // authority ambiguous. Whole-page detail references remain outside
  // this narrow spatial veto and therefore cannot poison a valid bookmark.
  for (const item of regionsValue) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const region = item as Record<string, unknown>;
    const carrierScan = strictRenderedRegionTexts(region);
    const regionTexts = carrierScan.texts;
    const bounds = strictNormalizedBounds({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
    if (carrierScan.invalidSuppliedCarrier) {
      const mayOccupyTitleBand = bounds
        ? boundsSharePageBoundValidatedTitleBand(bounds, exactAuthorityBounds)
        : malformedBoundsMayOccupyPageBoundValidatedTitleBand(
          region,
          exactAuthorityBounds,
        );
      if (mayOccupyTitleBand) return false;
      continue;
    }
    if (regionTexts.length === 0) continue;
    const carriesUnqualifiedCompetingIdentity = regionTexts.some((regionText) =>
      renderedSheetIdentityOccurrences(regionText).some((occurrence) =>
        !occurrence.qualified && occurrence.identity !== expectedSheetNumber
      )
    );
    if (!carriesUnqualifiedCompetingIdentity) continue;
    // A conflict may not strip searchability, source, or bounds to escape the
    // title-band ambiguity veto. Validly bounded body/detail noise still
    // remains outside the narrow title band. When malformed bounds could
    // still occupy this band, fail closed too.
    if (!bounds) {
      if (
        malformedBoundsMayOccupyPageBoundValidatedTitleBand(
          region,
          exactAuthorityBounds,
        )
      ) return false;
      continue;
    }
    if (!boundsSharePageBoundValidatedTitleBand(bounds, exactAuthorityBounds)) {
      continue;
    }
    return false;
  }
  return true;
}

function strictRenderedRegionTexts(region: Record<string, unknown>) {
  const supplied = [region.text, region.evidenceText, region.label].filter(
    (value) => value != null,
  );
  const parsed = supplied.map((value) => strictRenderedRegionCarrierText(value));
  return Object.freeze({
    texts: Object.freeze([...new Set(parsed.filter(Boolean))]),
    invalidSuppliedCarrier: parsed.some((value) => !value),
  });
}

function strictConsistentRenderedRegionText(region: Record<string, unknown>) {
  const supplied = [region.text, region.evidenceText, region.label].filter(
    (value) => value != null,
  );
  if (supplied.length === 0) return "";
  const values = supplied.map((value) => strictRenderedRegionCarrierText(value));
  return values.every(Boolean) && new Set(values).size === 1 ? values[0] : "";
}

function strictRenderedRegionCarrierText(value: unknown) {
  const text = strictText(value, 1_000);
  return text &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)
    ? text
    : "";
}

function strictConsistentRenderedRegionSource(
  region: Record<string, unknown>,
) {
  const supplied = [region.rawSource, region.source].filter((value) =>
    value != null
  );
  if (supplied.length === 0) return "";
  const sources = supplied.map((value) => strictText(value, 80));
  return sources.every(Boolean) && new Set(sources).size === 1 ? sources[0] : "";
}

function boundsSharePageBoundValidatedTitleBand(
  candidate: ECOSNormalizedBounds,
  authority: ECOSNormalizedBounds,
) {
  const verticalGap = Math.max(
    0,
    Math.max(candidate.y, authority.y) -
      Math.min(candidate.y + candidate.height, authority.y + authority.height),
  );
  return candidate.x + candidate.width >= 0.88 && candidate.y >= 0.9 &&
    verticalGap <= 0.02;
}

function malformedBoundsMayOccupyPageBoundValidatedTitleBand(
  region: Record<string, unknown>,
  authority: ECOSNormalizedBounds,
) {
  const x = strictNormalizedNumber(region.x);
  const y = strictNormalizedNumber(region.y);
  const width = strictNormalizedNumber(region.width);
  const height = strictNormalizedNumber(region.height);
  // Missing coordinates are ambiguous, not exculpatory. Return false only
  // when the remaining valid coordinates prove the candidate cannot share
  // the bottom-right authority band.
  if (x != null && width != null && x + width < 0.88) return false;
  if (y != null && y < 0.9) return false;
  if (y != null && y > authority.y + authority.height + 0.02) return false;
  if (
    y != null && height != null &&
    y + height < authority.y - 0.02
  ) return false;
  return true;
}

function boundsInsidePageBoundValidatedSheetCell(
  bounds: ECOSNormalizedBounds,
): boolean {
  // Union of the producer's structural page-bound and dual-render electrical
  // value cells. The promoted region must remain wholly inside this narrow
  // bottom-right title area; ordinary whole-page OCR never has this source.
  return bounds.x >= 0.918 && bounds.y >= 0.938 &&
    bounds.x + bounds.width <= 0.999 &&
    bounds.y + bounds.height <= 1.001;
}

function renderedPDFAnnotationSheetIdentityMatchesCurrentRegions(
  receipt: Record<string, unknown>,
  regionsValue: unknown[],
  expectedSheetNumber: string,
  corroboration: ECOSRenderedSheetIdentityCorroboration,
): boolean {
  const receiptText = strictText(receipt.text, 1_000);
  const normalizedReceiptText = normalizedRenderedEvidenceText(receiptText);
  const receiptToken = exactPDFAnnotationCivilSheetToken(receiptText);
  const labelReceipt = normalizedReceiptText === "SHEET NO.";
  if (
    (!labelReceipt && receiptToken !== expectedSheetNumber) ||
    (labelReceipt && !/^C[1-9]\d{0,2}$/.test(expectedSheetNumber))
  ) return false;

  const observedSources = new Set<string>();
  for (const regionId of corroboration.renderedCorroboratingRegionIds) {
    const matches = regionsValue.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return false;
      }
      return strictText((item as Record<string, unknown>).id, 300) === regionId;
    });
    if (matches.length !== 1) return false;
    const region = matches[0] as Record<string, unknown>;
    const source = strictText(region.rawSource ?? region.source, 80);
    const regionText = strictText(region.text ?? region.label, 1_000);
    const bounds = strictNormalizedBounds({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
    if (
      region.searchable !== true ||
      !source ||
      !bounds ||
      !corroboration.renderedCorroboratingSources.includes(source)
    ) return false;
    if (labelReceipt) {
      const normalizedRegionText = normalizedRenderedEvidenceText(regionText);
      if (
        !boundsInsideRenderedSheetCell(bounds, "label") ||
        (normalizedRegionText !== "SHEET NO." &&
          normalizedRegionText !== "SHEET NO")
      ) return false;
    } else if (
      !boundsInsideRenderedSheetCell(bounds, "token") ||
      exactPDFAnnotationCivilSheetToken(regionText) !== expectedSheetNumber
    ) return false;
    observedSources.add(source);
  }

  const currentTitleCellIdentities = new Set<string>();
  for (const item of regionsValue) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const region = item as Record<string, unknown>;
    const source = strictText(region.rawSource ?? region.source, 80);
    const regionText = strictText(region.text ?? region.label, 1_000);
    const bounds = strictNormalizedBounds({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
    if (
      region.searchable !== true ||
      !ECOS_RENDERED_SHEET_IDENTITY_SOURCES.includes(
        source as typeof ECOS_RENDERED_SHEET_IDENTITY_SOURCES[number],
      ) ||
      !bounds ||
      !boundsInsideRenderedSheetCell(bounds, "token") ||
      !regionText
    ) continue;
    const occurrences = renderedSheetIdentityOccurrences(regionText);
    if (occurrences.length === 0) continue;
    const identity = exactPDFAnnotationCivilSheetToken(regionText);
    if (!identity || occurrences.some((occurrence) => occurrence.qualified)) {
      return false;
    }
    currentTitleCellIdentities.add(identity);
  }
  return observedSources.size ===
      corroboration.renderedCorroboratingSources.length &&
    corroboration.renderedCorroboratingSources.every((source) =>
      observedSources.has(source)
    ) &&
    currentTitleCellIdentities.size === 1 &&
    currentTitleCellIdentities.has(expectedSheetNumber);
}

function exactPDFAnnotationCivilSheetToken(value: unknown): string {
  const normalized = normalizeECOSSheetIdentityScanText(
    strictText(value, 1_000),
  );
  const match = /^C\s*-?\s*([1-9]\d{0,2})$/i.exec(normalized);
  return match ? `C${Number(match[1])}` : "";
}

function boundsInsideRenderedSheetCell(
  bounds: ECOSNormalizedBounds,
  cell: "token" | "label",
): boolean {
  const [x0, y0, x1, y1] = cell === "token"
    ? [0.948, 0.904, 0.972, 0.925]
    : [0.94, 0.888, 0.98, 0.907];
  return bounds.x >= x0 && bounds.y >= y0 &&
    bounds.x + bounds.width <= x1 && bounds.y + bounds.height <= y1;
}

function normalizedRenderedEvidenceText(value: string) {
  return normalizedSheetIdentityScanText(value).replace(/\s+/g, " ").trim()
    .toUpperCase();
}

function normalizedSheetIdentityScanText(value: string) {
  return normalizeECOSSheetIdentityScanText(value);
}

export function renderedTextContainsExactSheetIdentity(
  value: unknown,
  expectedSheetNumberValue: unknown,
): boolean {
  const expected = canonicalComparableSheetNumber(
    expectedSheetNumberValue,
  );
  const occurrences = renderedSheetIdentityOccurrences(value);
  if (!expected || occurrences.length === 0) return false;
  const observedSheetIdentities = new Set(
    occurrences.map((occurrence) => occurrence.identity),
  );
  return observedSheetIdentities.size === 1 &&
    observedSheetIdentities.has(expected) &&
    !occurrences.some((occurrence) =>
      occurrence.identity === expected && occurrence.qualified
    );
}

function renderedSheetIdentityOccurrences(value: unknown) {
  const text = normalizedSheetIdentityScanText(strictText(value, 1_000))
    .toUpperCase();
  if (!text) return [];
  const pattern =
    /(?:^|[^A-Z0-9\uE000])((?=[A-Z])(?:[A-Z]{1,4}\s*-\s*){0,2}[A-Z]{0,4}\s*[-.]?\s*\d{1,3}(?:\.\d{1,3})?[A-Z]?)(?![A-Z0-9\uE000/]|\.[/\\])/gi;
  const occurrences: Array<Readonly<{ identity: string; qualified: boolean }>> =
    [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const identity = canonicalComparableSheetNumber(match[1]);
    if (!identity) continue;
    const identityStart = match.index + match[0].lastIndexOf(match[1]);
    occurrences.push(Object.freeze({
      identity,
      qualified: renderedSheetIdentityOccurrenceIsQualified(
        text,
        identityStart,
        identityStart + match[1].length,
      ),
    }));
  }
  return occurrences;
}

export function bookmarkTextMatchesSheetIdentity(
  value: unknown,
  expectedSheetNumberValue: unknown,
): boolean {
  const text = normalizedSheetIdentityScanText(strictText(value, 1_000));
  const expected = canonicalComparableSheetNumber(
    expectedSheetNumberValue,
  );
  if (!text || !expected) return false;
  const street = /^\s*SIP\s+SHT\s+([1-9]\d{0,2})\s*--\s*$/i.exec(text);
  if (street) return `SIP-SHT-${Number(street[1])}` === expected;
  const inserted = /^\s*A12A\s*-\s*(A\s*-?\s*1\.5A)\s*$/i.exec(text);
  if (inserted) return canonicalBookmarkSheetNumber(inserted[1]) === expected;
  const ordinary =
    /^\s*[A-Z]{1,4}\d{1,4}\s*-\s*((?:[A-Z]{1,4}(?:\s*-\s*[A-Z]{1,4}){0,2})\s*-?\s*\d{1,3}(?:\.\d{1,2})?)\s*$/i
      .exec(text);
  return Boolean(
    ordinary && canonicalBookmarkSheetNumber(ordinary[1]) === expected,
  );
}

function strictNormalizedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
      value <= 1
    ? value
    : null;
}

function strictUniqueStrings(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): string[] | null {
  if (
    !Array.isArray(value) || value.length < 1 || value.length > maximumItems
  ) return null;
  const normalized: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" || item.length < 1 || item.length > maximumLength
    ) return null;
    const trimmed = item.trim();
    if (
      !trimmed || trimmed.length > maximumLength || normalized.includes(trimmed)
    ) return null;
    normalized.push(trimmed);
  }
  return normalized;
}

function strictText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" || value.length < 1 ||
    value.length > maximumLength
  ) return "";
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : "";
}

function canonicalSheetNumber(value: string): string {
  if (!/^[A-Za-z0-9 .\-‐‑‒–—―−－．Ａ-Ｚａ-ｚ０-９]+$/u.test(value)) return "";
  return normalizeECOSSheetIdentityScanText(value).toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-\./g, "-");
}

function canonicalBookmarkSheetNumber(value: string): string | null {
  const normalized = canonicalSheetNumber(value);
  if (!normalized) return null;
  if (normalized.includes("-")) return normalized;
  const match = /^([A-Z]{1,4})(\d{1,3}(?:\.\d{1,2})?[A-Z]?)$/.exec(normalized);
  if (!match) return null;
  const [, prefix, number] = match;
  if (prefix === "XE") return `X-E-${number}`;
  if (["A", "E", "MB", "PB", "SB", "WPA", "WPB", "WPC"].includes(prefix)) {
    return `${prefix}-${number}`;
  }
  return `${prefix}${number}`;
}

/**
 * Canonicalizes conventional sheet-number typography without removing numeric
 * separators such as the decimal point in E-2.1.
 */
export function canonicalComparableSheetNumber(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 160 ||
    value !== value.trim()
  ) return "";
  const normalized = canonicalSheetNumber(value);
  if (!normalized || !/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(normalized)) {
    return "";
  }
  return canonicalBookmarkSheetNumber(value) || normalized;
}

function renderedSheetIdentityOccurrenceIsQualified(
  text: string,
  identityStart: number,
  identityEnd: number,
): boolean {
  const prefix = text.slice(Math.max(0, identityStart - 120), identityStart)
    .replace(/\s+/g, " ")
    .trimStart();
  const suffix = text.slice(
    identityEnd,
    Math.min(text.length, identityEnd + 120),
  )
    .replace(/\s+/g, " ")
    .trimStart();
  const identityLabel = String
    .raw`(?:(?:THE\s+)?(?:SHEET|DRAWING|SHT\.?|DWG\.?)(?:\s+(?:NUMBER|NO\.?|#))?\s+)?`;
  const prefixQualifier = String
    .raw`(?:DO\s+NOT\s+USE|NEVER\s+USE|NOT(?:\s+CURRENT|(?:\s+ISSUED)?\s+FOR\s+CONSTRUCTION|\s+FOR)?|OLD|NEW|PREVIOUS|FORMER|SUPERSEDED|OBSOLETE|VOID(?:ED)?|CANCEL(?:ED|LED)|REPLACED|DELET(?:E|ED)|OMIT(?:TED)?|ADD\s+ALTERNATE|ALTERNATE(?:\s+ONLY)?|IF\s+REQUIRED|DRAFT|PROPOSED|FUTURE|OUTDATED|RETIRED|REVOKED|INVALID|UNAPPROVED|FOR\s+REFERENCE\s+ONLY|REVIEW\s+COPY|EXCEPT(?:\s+FOR)?|SEE|FROM|REFER(?:\s+TO)?|REFERENCE(?:\s+TO)?)`;
  const qualifierSeparator = String.raw`(?:\s+|\s*[:=|/–—-]\s*)`;
  if (
    new RegExp(
      String.raw`\b${prefixQualifier}${qualifierSeparator}${identityLabel}$`,
    ).test(prefix)
  ) {
    return true;
  }
  if (
    new RegExp(
      String
        .raw`\bNO\s+(?:THE\s+)?(?:SHEET|DRAWING|SHT\.?|DWG\.?)(?:\s+(?:NUMBER|NO\.?|#))?\s+$`,
    ).test(prefix)
  ) {
    return true;
  }
  if (
    /\bNO(?:\s+|\s*[:=|/–—-]\s*)$/.test(prefix) &&
    !/\b(?:SHEET|DRAWING|SHT\.?|DWG\.?)\s+NO\.?(?:\s+|\s*[:=]\s*)$/.test(prefix)
  ) return true;

  const suffixWithoutDelimiter = suffix.replace(/^[\s\[({|\/,:;\-–—]+/, "");
  const statusAfterCopula =
    /^(?:(?:IS|WAS|MARKED|STATUS(?:\s+IS)?)\s+)(?:NOT\s+CURRENT|NOT(?:\s+ISSUED)?\s+FOR\s+CONSTRUCTION|FOR\s+REFERENCE\s+ONLY|REVIEW\s+COPY|OLD|NEW|PREVIOUS|FORMER|SUPERSEDED|OBSOLETE|VOID(?:ED)?|CANCEL(?:ED|LED)|REPLACED|DELET(?:E|ED)|OMIT(?:TED)?|ALTERNATE\s+ONLY|DRAFT|PROPOSED|FUTURE|OUTDATED|RETIRED|REVOKED|INVALID|UNAPPROVED)\b/;
  const strongSuffixQualifier =
    /^(?:DO\s+NOT\s+USE|NEVER\s+USE|NOT\s+CURRENT|NO\s+LONGER\s+CURRENT|NOT(?:\s+ISSUED)?\s+FOR\s+CONSTRUCTION|FOR\s+REFERENCE\s+ONLY|REVIEW\s+COPY|PREVIOUS|FORMER|SUPERSEDED|OBSOLETE|VOID(?:ED)?|CANCEL(?:ED|LED)|REPLACED|DELET(?:E|ED)|OMIT(?:TED)?|ALTERNATE\s+ONLY|DRAFT|PROPOSED|FUTURE|OUTDATED|RETIRED|REVOKED|INVALID|UNAPPROVED)\b/;
  const standaloneOldOrNew =
    /^(?:OLD|NEW)(?=\s*(?:$|[\])},:;|\/–—-])|\s+(?:SHEET|DRAWING|ISSUE|REVISION|VERSION|SET)\b)/;
  return statusAfterCopula.test(suffixWithoutDelimiter) ||
    strongSuffixQualifier.test(suffixWithoutDelimiter) ||
    standaloneOldOrNew.test(suffixWithoutDelimiter);
}
