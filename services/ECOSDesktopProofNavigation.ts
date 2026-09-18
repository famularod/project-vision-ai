import type { DAVEAskEvidence } from './DAVEAsk';
import {
  evaluateECOSDocumentEvidenceBinding,
  type ECOSDocumentEvidenceBinding,
  type ECOSProjectIdentity,
} from './ECOSDocumentEvidenceBinding';
import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegion,
} from '../types';

export const ECOS_DESKTOP_PROOF_PARAM_KEYS = Object.freeze([
  'proofDocument',
  'proofProjectId',
  'proofSourceSha256',
  'proofEvidenceVersion',
  'proofRevision',
  'proofPage',
  'proofRegion',
  'proofSheet',
  'proofX',
  'proofY',
  'proofWidth',
  'proofHeight',
] as const);

export type ECOSDesktopDocumentProofFocus = Readonly<{
  documentId: string;
  projectId: string;
  sourceSha256: string;
  evidenceVersion: string;
  revision: string;
  pageNumber: number;
  regionId: string | null;
  sheetNumber: string | null;
  bounds: ECOSDesktopProofBounds | null;
  /** ECO-04: the answer was verified from page text, not an exact region. */
  pageText?: boolean;
}>;

export type ECOSDesktopProofBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ECOSDesktopResolvedProof = Readonly<{
  document: ReferenceDocument;
  page: ReferenceDocumentExtractedPage;
  region: ReferenceDocumentRegion | null;
  bounds: ECOSDesktopProofBounds | null;
  match: 'stored_region' | 'hosted_cited_bounds' | 'page_only';
  binding: ECOSDocumentEvidenceBinding;
}>;

type RouteParamValue = string | readonly string[] | undefined;

export function buildECOSDesktopDocumentProofParams(
  evidence: DAVEAskEvidence,
  projectName: string,
): Readonly<Record<string, string>> {
  const params: Record<string, string> = { project: projectName };
  if (evidence.sourceType !== 'document') return Object.freeze(params);

  const citation = evidence.documentCitation;
  const documentId = cleanIdentifier(citation?.documentId);
  const projectId = cleanIdentifier(citation?.projectId);
  const sourceSha256 = canonicalSha256(citation?.sourceSha256);
  const evidenceVersion = cleanIdentifier(citation?.evidenceVersion);
  const revision = cleanIdentifier(citation?.revision);
  const pageNumber = positiveInteger(citation?.pageNumber);
  if (!documentId || !projectId || !sourceSha256 || !evidenceVersion || !revision || pageNumber == null) {
    return Object.freeze(params);
  }

  params.proofDocument = documentId;
  params.proofProjectId = projectId;
  params.proofSourceSha256 = sourceSha256;
  params.proofEvidenceVersion = evidenceVersion;
  params.proofRevision = revision;
  params.proofPage = String(pageNumber);

  if (evidence.proofTier === 'page_text' && !cleanIdentifier(citation?.regionId)) {
    // Page-text proof opens the page itself; there is no exact spot to mark.
    params.proofTier = 'page_text';
    const pageTextSheet = cleanIdentifier(citation?.sheetNumber);
    if (pageTextSheet) params.proofSheet = pageTextSheet;
    return Object.freeze(params);
  }
  const citationRegionId = cleanIdentifier(citation?.regionId);
  const evidenceRegionId = cleanIdentifier(evidence.documentRegion?.id);
  const regionIdsAgree = !citationRegionId || !evidenceRegionId || citationRegionId === evidenceRegionId;
  const regionId = regionIdsAgree ? citationRegionId || evidenceRegionId : null;
  if (regionId) params.proofRegion = regionId;

  const sheetNumber = cleanIdentifier(citation?.sheetNumber);
  if (sheetNumber) params.proofSheet = sheetNumber;

  const bounds = regionIdsAgree ? validBounds(evidence.documentRegion) : null;
  if (bounds) {
    params.proofX = serializeCoordinate(bounds.x);
    params.proofY = serializeCoordinate(bounds.y);
    params.proofWidth = serializeCoordinate(bounds.width);
    params.proofHeight = serializeCoordinate(bounds.height);
  }
  return Object.freeze(params);
}

export function parseECOSDesktopDocumentProofFocus(
  params: Readonly<Record<string, RouteParamValue>>,
): ECOSDesktopDocumentProofFocus | null {
  const documentId = cleanIdentifier(firstParam(params.proofDocument));
  const projectId = cleanIdentifier(firstParam(params.proofProjectId));
  const sourceSha256 = canonicalSha256(firstParam(params.proofSourceSha256));
  const evidenceVersion = cleanIdentifier(firstParam(params.proofEvidenceVersion));
  const revision = cleanIdentifier(firstParam(params.proofRevision));
  const pageNumber = parsePositiveInteger(firstParam(params.proofPage));
  if (!documentId || !projectId || !sourceSha256 || !evidenceVersion || !revision || pageNumber == null) {
    return null;
  }

  const boundsValues = [
    firstParam(params.proofX),
    firstParam(params.proofY),
    firstParam(params.proofWidth),
    firstParam(params.proofHeight),
  ];
  const parsedBounds = boundsValues.every(value => value != null)
    ? validBounds({
        x: Number(boundsValues[0]),
        y: Number(boundsValues[1]),
        width: Number(boundsValues[2]),
        height: Number(boundsValues[3]),
      })
    : null;

  return Object.freeze({
    documentId,
    projectId,
    sourceSha256,
    evidenceVersion,
    revision,
    pageNumber,
    regionId: cleanIdentifier(firstParam(params.proofRegion)),
    sheetNumber: cleanIdentifier(firstParam(params.proofSheet)),
    bounds: parsedBounds,
    ...(firstParam(params.proofTier) === 'page_text' && !cleanIdentifier(firstParam(params.proofRegion))
      ? { pageText: true }
      : {}),
  });
}

export function evaluateECOSDesktopDocumentProofBinding(
  document: ReferenceDocument | null | undefined,
  focus: ECOSDesktopDocumentProofFocus,
  projectIdentities: readonly ECOSProjectIdentity[] = [],
): ECOSDocumentEvidenceBinding {
  return evaluateECOSDocumentEvidenceBinding(
    desktopFocusEvidence(document, focus),
    document,
    projectIdentities,
  );
}

export function resolveECOSDesktopDocumentProof(
  documents: readonly ReferenceDocument[],
  focus: ECOSDesktopDocumentProofFocus,
  projectIdentities: readonly ECOSProjectIdentity[] = [],
): ECOSDesktopResolvedProof | null {
  const document = documents.find(item => item.id === focus.documentId);
  if (!document) return null;
  const binding = evaluateECOSDesktopDocumentProofBinding(document, focus, projectIdentities);
  if (!binding.exact) return null;

  const page = (document.extractedPages ?? [])
    .find(candidate => candidate.pageNumber === focus.pageNumber);
  if (!page) return null;
  const sheetMatches = !focus.sheetNumber || (
    Boolean(page.sheetNumber) &&
    normalizeSheet(page.sheetNumber || '') === normalizeSheet(focus.sheetNumber)
  );
  if (!sheetMatches) return null;

  const region = focus.regionId
    ? page.regions?.find(candidate => candidate.id === focus.regionId) ?? null
    : null;
  const storedBounds = region ? validBounds(region) : null;
  const boundsMatch = !focus.bounds || Boolean(
    storedBounds && sameBounds(storedBounds, focus.bounds),
  );
  if (region && storedBounds && boundsMatch) {
    return Object.freeze({
      document,
      page,
      region,
      bounds: storedBounds,
      match: 'stored_region',
      binding,
    });
  }
  if (focus.bounds && binding.proofMode === 'hosted_cited_region') {
    return Object.freeze({
      document,
      page,
      region: null,
      bounds: focus.bounds,
      match: 'hosted_cited_bounds',
      binding,
    });
  }
  if (focus.regionId) return null;
  return Object.freeze({
    document,
    page,
    region: null,
    bounds: null,
    match: 'page_only',
    binding,
  });
}

function desktopFocusEvidence(
  document: ReferenceDocument | null | undefined,
  focus: ECOSDesktopDocumentProofFocus,
): DAVEAskEvidence {
  return {
    sourceType: 'document',
    recordId: focus.documentId,
    summary: document?.name || 'Ask ECOS document proof',
    timelineEventId: null,
    documentCitation: {
      documentId: focus.documentId,
      projectId: focus.projectId,
      sourceSha256: focus.sourceSha256,
      evidenceVersion: focus.evidenceVersion,
      documentName: document?.name || 'Project document',
      revision: focus.revision,
      pageNumber: focus.pageNumber,
      sheetNumber: focus.sheetNumber,
      regionId: focus.regionId,
      label: document?.name || 'Project document',
    },
    ...(focus.pageText && !focus.regionId ? { proofTier: 'page_text' as const } : {}),
    documentRegion: focus.regionId && focus.bounds ? {
      id: focus.regionId,
      x: focus.bounds.x,
      y: focus.bounds.y,
      width: focus.bounds.width,
      height: focus.bounds.height,
      source: null,
    } : focus.pageText && !focus.regionId ? {
      id: 'page',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      source: null,
    } : null,
  };
}

function firstParam(value: RouteParamValue): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function cleanIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > 512 || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

function canonicalSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(clean) ? clean : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) return null;
  return positiveInteger(Number(value));
}

function validBounds(value: unknown): ECOSDesktopProofBounds | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const x = finiteNumber(candidate.x);
  const y = finiteNumber(candidate.y);
  const width = finiteNumber(candidate.width);
  const height = finiteNumber(candidate.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1) return null;
  if (x + width > 1.000001 || y + height > 1.000001) return null;
  return Object.freeze({ x, y, width, height });
}

function sameBounds(left: ECOSDesktopProofBounds, right: ECOSDesktopProofBounds) {
  return (['x', 'y', 'width', 'height'] as const)
    .every(key => serializeCoordinate(left[key]) === serializeCoordinate(right[key]));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serializeCoordinate(value: number): string {
  return String(Number(value.toFixed(6)));
}

function normalizeSheet(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\u2012-\u2015]+/g, '-');
}
