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
      normalizedBounds: item.normalizedBounds
        ? Object.freeze({ ...item.normalizedBounds })
        : null,
    }))) as unknown as ReferenceDocumentSheetMappingEvidence[],
    documentStructuralIdentity: identity ? Object.freeze({
      ...identity,
      evidence: Object.freeze(identity.evidence.map(item => Object.freeze({
        ...item,
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
      if (evidenceSource !== 'pdf_bookmark' || evidence.normalizedBounds != null) return null;
      items.push({ id, pageNumber, source: 'pdf_bookmark', text, normalizedBounds: null });
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
    items.push({
      id,
      pageNumber,
      source: requiredEvidenceSource,
      text,
      normalizedBounds: bounds,
      ...(source === 'pdf_annotation_title_band'
        ? { annotationSubtype: 'Square' as const }
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
