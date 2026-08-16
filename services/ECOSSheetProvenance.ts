import type {
  ReferenceDocumentExtractedPage,
  ReferenceDocumentPageAssurance,
  ReferenceDocumentSheetMappingEvidence,
  ReferenceDocumentSheetMappingSource,
  ReferenceDocumentSheetProvenance,
  ReferenceDocumentStructuralIdentity,
} from '../types';

const MAX_EVIDENCE_ITEMS = 8;
const NATIVE_BOUNDS_TOLERANCE = 0.000005;
const ANNOTATION_TOKEN_BAND = { x0: 0.948, y0: 0.904, x1: 0.972, y1: 0.925 };
const ANNOTATION_LABEL_BAND = { x0: 0.94, y0: 0.888, x1: 0.98, y1: 0.907 };
const RENDERED_IDENTITY_SOURCES = new Set([
  'fixed_visual_tile_coordinate_ocr',
  'sheet_identity_ocr_landscape_native',
  'sheet_identity_ocr_page_bound_validated',
  'sheet_identity_ocr_vertical_outline',
  'title_block_ocr',
]);

export type ECOSNormalizedSheetProvenance = Readonly<{
  sheetMappingStatus: 'verified' | 'conflicted' | 'unverified';
  sheetNumber: string | null;
  provenance: ReferenceDocumentSheetProvenance;
  verified: boolean;
  fingerprint: string;
}>;

/**
 * Canonicalizes the exact page-bound sheet identity contract. A displayed
 * sheet number and confidence score are never enough to cross the verified
 * boundary. Invalid or incomplete provenance is downgraded to PDF-page-only
 * citation instead of being partially retained.
 */
export function normalizeECOSSheetProvenance(
  value: unknown,
  options: Readonly<{
    expectedPageNumber?: number;
    requireAssurance?: boolean;
    requireNativeRegionBinding?: boolean;
    requireRenderedRegionBinding?: boolean;
  }> = {},
): ECOSNormalizedSheetProvenance {
  const page = record(value);
  const expectedPageNumber = positiveInteger(options.expectedPageNumber) ||
    positiveInteger(page.pageNumber);
  const status = sheetMappingStatus(page.sheetMappingStatus);
  const rawSource = sheetMappingSource(page.sheetMappingSource);
  const assurance = normalizePageAssurance(page.assurance ?? page.sheetMappingAssurance);

  if (status !== 'verified') {
    const source = rawSource === 'coordinate_text' ? rawSource : null;
    return result({
      status,
      sheetNumber: null,
      source,
      evidence: [],
      identity: null,
      assurance,
      verified: false,
    });
  }

  const sheetNumber = boundedText(page.sheetNumber, 160);
  if (!expectedPageNumber || !sheetNumber ||
      (rawSource !== 'pdf_bookmark' &&
       rawSource !== 'native_title_band' &&
       rawSource !== 'pdf_annotation_title_band')) {
    return invalid(assurance);
  }
  const evidence = normalizeMappingEvidence(
    page.sheetMappingEvidence,
    expectedPageNumber,
    rawSource,
    sheetNumber,
  );
  if (!evidence) return invalid(assurance);

  const identity = normalizeStructuralIdentity(
    page.documentStructuralIdentity,
    sheetNumber,
    rawSource,
    evidence,
  );
  if (!identity) return invalid(assurance);

  const requireAssurance = options.requireAssurance !== false;
  if (requireAssurance &&
      (assurance?.accepted !== true || assurance.checks?.sheetMappingUsable !== true)) {
    return invalid(assurance);
  }

  const requireNativeBinding = options.requireNativeRegionBinding === true ||
    (options.requireNativeRegionBinding !== false && Array.isArray(page.regions));
  if (rawSource === 'native_title_band' && requireNativeBinding &&
      !nativeEvidenceMatchesCurrentRegion(evidence[0], page.regions)) {
    return invalid(assurance);
  }
  const requireRenderedBinding = options.requireRenderedRegionBinding ??
    (options.requireNativeRegionBinding !== false);
  if (rawSource === 'pdf_bookmark' && requireRenderedBinding &&
      !bookmarkEvidenceMatchesCurrentRegions(evidence, page.regions, sheetNumber)) {
    return invalid(assurance);
  }

  return result({
    status: 'verified',
    sheetNumber,
    source: rawSource,
    evidence,
    identity,
    assurance,
    verified: true,
  });
}

/** Adds canonical provenance to a page while removing any unverified sheet. */
export function withNormalizedECOSSheetProvenance(
  page: ReferenceDocumentExtractedPage,
  options: Parameters<typeof normalizeECOSSheetProvenance>[1] = {},
): ReferenceDocumentExtractedPage {
  const normalized = normalizeECOSSheetProvenance(page, {
    expectedPageNumber: page.pageNumber,
    ...options,
  });
  return {
    ...page,
    sheetNumber: normalized.sheetNumber,
    sheetMappingStatus: normalized.sheetMappingStatus,
    sheetMappingSource: normalized.provenance.sheetMappingSource,
    sheetMappingEvidence: normalized.provenance.sheetMappingEvidence,
    documentStructuralIdentity: normalized.provenance.documentStructuralIdentity,
    assurance: normalized.provenance.assurance,
  };
}

export function sameECOSSheetProvenance(
  left: ECOSNormalizedSheetProvenance,
  right: ECOSNormalizedSheetProvenance,
) {
  return left.fingerprint === right.fingerprint;
}

function result({
  status,
  sheetNumber,
  source,
  evidence,
  identity,
  assurance,
  verified,
}: {
  status: 'verified' | 'conflicted' | 'unverified';
  sheetNumber: string | null;
  source: ReferenceDocumentSheetMappingSource | null;
  evidence: ReferenceDocumentSheetMappingEvidence[];
  identity: ReferenceDocumentStructuralIdentity | null;
  assurance: ReferenceDocumentPageAssurance | null;
  verified: boolean;
}): ECOSNormalizedSheetProvenance {
  const provenance = Object.freeze({
    sheetNumber,
    sheetMappingStatus: status,
    sheetMappingSource: source,
    sheetMappingEvidence: Object.freeze(evidence.map(item => Object.freeze({
      ...item,
      renderedCorroboratingRegionIds: item.renderedCorroboratingRegionIds
        ? Object.freeze([...item.renderedCorroboratingRegionIds]) as unknown as string[]
        : undefined,
      renderedCorroboratingSources: item.renderedCorroboratingSources
        ? Object.freeze([...item.renderedCorroboratingSources]) as unknown as string[]
        : undefined,
      normalizedBounds: item.normalizedBounds
        ? Object.freeze({ ...item.normalizedBounds })
        : null,
    }))) as unknown as ReferenceDocumentSheetMappingEvidence[],
    documentStructuralIdentity: identity ? Object.freeze({
      ...identity,
      evidence: Object.freeze(identity.evidence.map(item => Object.freeze({
        ...item,
        renderedCorroboratingRegionIds: item.renderedCorroboratingRegionIds
          ? Object.freeze([...item.renderedCorroboratingRegionIds]) as unknown as string[]
          : undefined,
        renderedCorroboratingSources: item.renderedCorroboratingSources
          ? Object.freeze([...item.renderedCorroboratingSources]) as unknown as string[]
          : undefined,
        normalizedBounds: item.normalizedBounds
          ? Object.freeze({ ...item.normalizedBounds })
          : null,
      }))) as unknown as ReferenceDocumentSheetMappingEvidence[],
    }) : null,
    assurance,
  });
  return Object.freeze({
    sheetMappingStatus: status,
    sheetNumber,
    provenance,
    verified,
    fingerprint: JSON.stringify({ status, sheetNumber, provenance }),
  });
}

function invalid(assurance: ReferenceDocumentPageAssurance | null) {
  return result({
    status: 'unverified',
    sheetNumber: null,
    source: null,
    evidence: [],
    identity: null,
    assurance,
    verified: false,
  });
}

function normalizeMappingEvidence(
  value: unknown,
  expectedPageNumber: number,
  source: 'pdf_bookmark' | 'native_title_band' | 'pdf_annotation_title_band',
  sheetNumber: string,
): ReferenceDocumentSheetMappingEvidence[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVIDENCE_ITEMS) return null;
  const items: ReferenceDocumentSheetMappingEvidence[] = [];
  for (const item of value) {
    const evidence = record(item);
    const id = boundedText(evidence.id, 300);
    const pageNumber = positiveInteger(evidence.pageNumber);
    const text = boundedText(evidence.text, 1_000);
    const evidenceSource = boundedText(evidence.source, 80);
    const annotationSubtype = boundedText(evidence.annotationSubtype, 80);
    const bounds = normalizedBounds(evidence.normalizedBounds);
    if (!id || pageNumber !== expectedPageNumber || !text) return null;
    if (source === 'pdf_bookmark') {
      const renderedRegionIds = strictUniqueStringArray(
        evidence.renderedCorroboratingRegionIds,
        MAX_EVIDENCE_ITEMS,
        300,
      );
      const renderedSources = strictUniqueStringArray(
        evidence.renderedCorroboratingSources,
        MAX_EVIDENCE_ITEMS,
        80,
      );
      if (
        evidenceSource !== 'pdf_bookmark'
        || evidence.normalizedBounds != null
        || !bookmarkTextMatchesSheetIdentity(text, sheetNumber)
        || evidence.renderedCorroborated !== true
        || !renderedRegionIds
        || !renderedSources
        || renderedSources.some(item => !RENDERED_IDENTITY_SOURCES.has(item))
      ) return null;
      items.push({
        id,
        pageNumber,
        source: 'pdf_bookmark',
        text,
        normalizedBounds: null,
        renderedCorroborated: true,
        renderedCorroboratingRegionIds: renderedRegionIds,
        renderedCorroboratingSources: renderedSources,
      });
      continue;
    }
    const requiredEvidenceSource = source === 'native_title_band'
      ? 'embedded_text'
      : 'pdf_annotation';
    if (evidenceSource !== requiredEvidenceSource || !bounds) return null;
    if (source === 'pdf_annotation_title_band' && (
      annotationSubtype !== 'Square' ||
      !validPDFAnnotationEvidenceId(id, expectedPageNumber)
    )) return null;
    const renderedRegionIds = source === 'pdf_annotation_title_band'
      ? strictUniqueStringArray(evidence.renderedCorroboratingRegionIds, MAX_EVIDENCE_ITEMS, 300)
      : null;
    const renderedSources = source === 'pdf_annotation_title_band'
      ? strictUniqueStringArray(evidence.renderedCorroboratingSources, MAX_EVIDENCE_ITEMS, 80)
      : null;
    if (source === 'pdf_annotation_title_band' && (
      evidence.renderedCorroborated !== true ||
      !renderedRegionIds ||
      !renderedSources ||
      renderedSources.some(item => !RENDERED_IDENTITY_SOURCES.has(item))
    )) return null;
    items.push({
      id,
      pageNumber,
      source: requiredEvidenceSource,
      text,
      normalizedBounds: bounds,
      ...(source === 'pdf_annotation_title_band'
        ? {
            annotationSubtype: 'Square' as const,
            renderedCorroborated: true as const,
            renderedCorroboratingRegionIds: renderedRegionIds!,
            renderedCorroboratingSources: renderedSources!,
          }
        : {}),
    });
  }
  if (new Set(items.map(item => item.id)).size !== items.length) return null;
  if (source === 'native_title_band' && items.length !== 1) return null;
  if (source === 'pdf_annotation_title_band' &&
      !validPDFAnnotationTitleBandEvidence(items, sheetNumber)) return null;
  return items;
}

function validPDFAnnotationEvidenceId(id: string, pageNumber: number) {
  const match = /^pdf-annotation-[0-9]+-page-([1-9][0-9]*)$/.exec(id);
  return Boolean(match && Number(match[1]) === pageNumber);
}

function normalizeStructuralIdentity(
  value: unknown,
  sheetNumber: string,
  source: 'pdf_bookmark' | 'native_title_band' | 'pdf_annotation_title_band',
  evidence: ReferenceDocumentSheetMappingEvidence[],
): ReferenceDocumentStructuralIdentity | null {
  if (value == null) return { sheetNumber, source, evidence };
  const identity = record(value);
  const identityEvidence = normalizeMappingEvidence(
    identity.evidence,
    evidence[0].pageNumber,
    source,
    sheetNumber,
  );
  if (boundedText(identity.sheetNumber, 160) !== sheetNumber ||
      boundedText(identity.source, 80) !== source ||
      !identityEvidence || JSON.stringify(identityEvidence) !== JSON.stringify(evidence)) return null;
  return { sheetNumber, source, evidence: identityEvidence };
}

function normalizePageAssurance(value: unknown): ReferenceDocumentPageAssurance | null {
  const assurance = record(value);
  if (typeof assurance.accepted !== 'boolean') return null;
  const checks = record(assurance.checks);
  const sheetMappingUsable = typeof checks.sheetMappingUsable === 'boolean'
    ? checks.sheetMappingUsable
    : undefined;
  return Object.freeze({
    accepted: assurance.accepted,
    method: boundedText(assurance.method, 160) || null,
    schemaVersion: boundedText(assurance.schemaVersion, 160) || null,
    evidenceVersion: boundedText(assurance.evidenceVersion, 160) || null,
    assuranceProvider: boundedText(assurance.assuranceProvider, 160) || null,
    assuranceModel: boundedText(assurance.assuranceModel, 160) || null,
    confidence: normalizedNumber(assurance.confidence),
    checks: sheetMappingUsable == null ? null : Object.freeze({ sheetMappingUsable }),
    failureCodes: stringArray(assurance.failureCodes, 32, 160),
  });
}

function nativeEvidenceMatchesCurrentRegion(
  evidence: ReferenceDocumentSheetMappingEvidence | undefined,
  value: unknown,
) {
  if (!evidence?.normalizedBounds || !Array.isArray(value)) return false;
  const matching = value.filter(item => {
    const region = record(item);
    const bounds = normalizedBounds(region);
    return boundedText(region.id, 300) === evidence.id &&
      boundedText(region.text ?? region.label, 1_000) === evidence.text &&
      boundedText(region.source, 80) === 'embedded_text' && Boolean(bounds) &&
      (['x', 'y', 'width', 'height'] as const).every(key =>
        Math.abs(bounds![key] - evidence.normalizedBounds![key]) <= NATIVE_BOUNDS_TOLERANCE
      );
  });
  return matching.length === 1;
}

function bookmarkEvidenceMatchesCurrentRegions(
  evidence: ReferenceDocumentSheetMappingEvidence[],
  value: unknown,
  expectedSheetNumber: string,
) {
  return evidence.length > 0 && evidence.every(item =>
    renderedIdentityMatchesCurrentRegions(item, value, expectedSheetNumber)
  );
}

function renderedIdentityMatchesCurrentRegions(
  evidence: ReferenceDocumentSheetMappingEvidence,
  value: unknown,
  expectedSheetNumber: string,
) {
  if (
    evidence.renderedCorroborated !== true
    || !Array.isArray(value)
    || !evidence.renderedCorroboratingRegionIds?.length
    || !evidence.renderedCorroboratingSources?.length
  ) return false;
  const observedSources = new Set<string>();
  for (const regionId of evidence.renderedCorroboratingRegionIds) {
    const matches = value.filter(item => boundedText(record(item).id, 300) === regionId);
    if (matches.length !== 1) return false;
    const region = record(matches[0]);
    const source = boundedText(region.rawSource ?? region.source, 80);
    const text = boundedText(region.text ?? region.label, 1_000);
    if (
      region.searchable !== true
      || !source
      || !evidence.renderedCorroboratingSources.includes(source)
      || !renderedTextContainsExactSheetIdentity(text, expectedSheetNumber)
    ) return false;
    observedSources.add(source);
  }
  return observedSources.size === evidence.renderedCorroboratingSources.length &&
    evidence.renderedCorroboratingSources.every(source => observedSources.has(source));
}

function sheetMappingStatus(value: unknown): 'verified' | 'conflicted' | 'unverified' {
  return value === 'verified' || value === 'conflicted' ? value : 'unverified';
}

function sheetMappingSource(value: unknown): ReferenceDocumentSheetMappingSource | null {
  return value === 'pdf_bookmark' ||
    value === 'native_title_band' ||
    value === 'pdf_annotation_title_band' ||
    value === 'coordinate_text'
    ? value
    : null;
}

function validPDFAnnotationTitleBandEvidence(
  items: ReferenceDocumentSheetMappingEvidence[],
  sheetNumber: string,
) {
  if (items.length !== 2) return false;
  const tokenItems = items.filter(item => {
    const match = /^C\s*[-–—]?\s*([1-9]\d{0,2})$/i.exec(item.text);
    return Boolean(match && `C${Number(match![1])}` === sheetNumber);
  });
  const labelItems = items.filter(item => /^SHEET\s+NO\.$/i.test(item.text));
  if (tokenItems.length !== 1 || labelItems.length !== 1) return false;
  const token = tokenItems[0].normalizedBounds;
  const label = labelItems[0].normalizedBounds;
  if (!token || !label ||
      !boundsInsideBand(token, ANNOTATION_TOKEN_BAND) ||
      !boundsInsideBand(label, ANNOTATION_LABEL_BAND)) return false;
  const tokenCenter = token.x + token.width / 2;
  const labelCenter = label.x + label.width / 2;
  const gap = token.y - (label.y + label.height);
  return Math.abs(tokenCenter - labelCenter) <= 0.02 && gap >= 0 && gap <= 0.025;
}

function renderedTextContainsExactSheetIdentity(value: string, expectedSheetNumber: string) {
  const expected = canonicalComparableSheetNumber(expectedSheetNumber);
  const pattern = /(?:^|[^A-Z0-9])((?=[A-Z])(?:[A-Z]{1,4}\s*[-–—]\s*){0,2}[A-Z]{0,4}\s*[-.]?\s*\d{1,3}(?:\.\d{1,3})?[A-Z]?)(?=$|[^A-Z0-9])/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value.toUpperCase())) !== null) {
    if (canonicalComparableSheetNumber(match[1]) === expected) return true;
  }
  return false;
}

function bookmarkTextMatchesSheetIdentity(value: string, expectedSheetNumber: string) {
  const expected = canonicalComparableSheetNumber(expectedSheetNumber);
  const street = /^\s*SIP\s+SHT\s+([1-9]\d{0,2})\s*--\s*$/i.exec(value);
  if (street) return `SIP-SHT-${Number(street[1])}` === expected;
  const inserted = /^\s*A12A\s*[-–—]\s*(A\s*[-–—]?\s*1\.5A)\s*$/i.exec(value);
  if (inserted) return canonicalBookmarkSheetNumber(inserted[1]) === expected;
  const ordinary = /^\s*[A-Z]{1,4}\d{1,4}\s*[-–—]\s*((?:[A-Z]{1,4}(?:\s*[-–—]\s*[A-Z]{1,4}){0,2})\s*[-–—]?\s*\d{1,3}(?:\.\d{1,2})?)\s*$/i.exec(value);
  return Boolean(ordinary && canonicalBookmarkSheetNumber(ordinary[1]) === expected);
}

function canonicalBookmarkSheetNumber(value: string) {
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

function canonicalComparableSheetNumber(value: string) {
  return canonicalBookmarkSheetNumber(value) || canonicalSheetNumber(value);
}

function canonicalSheetNumber(value: string) {
  return value.toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, '').replace(/-\./g, '-');
}

function boundsInsideBand(
  bounds: NonNullable<ReferenceDocumentSheetMappingEvidence['normalizedBounds']>,
  band: { x0: number; y0: number; x1: number; y1: number },
) {
  return bounds.x >= band.x0 && bounds.y >= band.y0 &&
    bounds.x + bounds.width <= band.x1 &&
    bounds.y + bounds.height <= band.y1;
}

function normalizedBounds(value: unknown) {
  const bounds = record(value);
  const x = normalizedNumber(bounds.x);
  const y = normalizedNumber(bounds.y);
  const width = normalizedNumber(bounds.width);
  const height = normalizedNumber(bounds.height);
  if (x == null || y == null || width == null || height == null ||
      width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;
  return { x, y, width, height };
}

function normalizedNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value)
    ? value.flatMap(item => {
        const normalized = boundedText(item, maximumLength);
        return normalized ? [normalized] : [];
      }).slice(0, maximumItems)
    : [];
}

function strictUniqueStringArray(
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
