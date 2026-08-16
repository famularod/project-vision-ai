import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import type { DAVEAskEvidence } from './DAVEAsk';
import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegion,
} from '../types';
import { hasAuthoritativeECOSPageGraph } from './ECOSHostedPageGraphAuthority';

export const ECOS_DESKTOP_PROOF_PARAM_KEYS = Object.freeze([
  'proofDocument',
  'proofProject',
  'proofRevision',
  'proofSource',
  'proofEvidence',
  'proofText',
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
  revision: string;
  sourceSha256: string;
  evidenceVersion: string;
  excerptSha256: string | null;
  pageNumber: number;
  regionId: string | null;
  sheetNumber: string | null;
  bounds: ECOSDesktopProofBounds | null;
}>;

export type ECOSDesktopProofBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ECOSDesktopResolvedProof = Readonly<{
  document: ReferenceDocument;
  page: ReferenceDocumentExtractedPage | null;
  region: ReferenceDocumentRegion | null;
  bounds: ECOSDesktopProofBounds | null;
  match: 'stored_region' | 'cited_bounds' | 'page_only';
}>;

type RouteParamValue = string | readonly string[] | undefined;

export function buildECOSDesktopDocumentProofParams(
  evidence: DAVEAskEvidence,
  projectName: string,
): Readonly<Record<string, string>> {
  const params: Record<string, string> = { project: projectName };
  if (evidence.sourceType !== 'document') return Object.freeze(params);

  const citation = evidence.documentCitation;
  const documentId = cleanIdentifier(citation?.documentId || evidence.recordId);
  const projectId = cleanIdentifier(citation?.projectId);
  const revision = cleanIdentifier(citation?.revision);
  const sourceSha256 = canonicalSha256(citation?.sourceSha256);
  const evidenceVersion = cleanIdentifier(citation?.evidenceVersion);
  const pageNumber = positiveInteger(citation?.pageNumber);
  if (!documentId || !projectId || !revision || !sourceSha256 || !evidenceVersion || pageNumber == null) {
    return Object.freeze(params);
  }

  // Keep the workspace selection bound to the same immutable project as the
  // proof. Display names are not unique and must never re-select a project.
  params.projectId = projectId;
  params.proofDocument = documentId;
  params.proofProject = projectId;
  params.proofRevision = revision;
  params.proofSource = sourceSha256;
  params.proofEvidence = evidenceVersion;
  params.proofPage = String(pageNumber);

  const excerptSha256 = proofTextSha256(evidence.excerpt);
  if (excerptSha256) params.proofText = excerptSha256;

  const citationRegionId = cleanIdentifier(citation?.regionId);
  const evidenceRegionId = cleanIdentifier(evidence.documentRegion?.id);
  const regionIdsAgree = Boolean(citationRegionId && citationRegionId === evidenceRegionId);
  if (citationRegionId) params.proofRegion = citationRegionId;

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
  const projectId = cleanIdentifier(firstParam(params.proofProject));
  const revision = cleanIdentifier(firstParam(params.proofRevision));
  const sourceSha256 = canonicalSha256(firstParam(params.proofSource));
  const evidenceVersion = cleanIdentifier(firstParam(params.proofEvidence));
  const excerptSha256 = canonicalSha256(firstParam(params.proofText));
  const pageNumber = parsePositiveInteger(firstParam(params.proofPage));
  if (!documentId || !projectId || !revision || !sourceSha256 || !evidenceVersion || pageNumber == null) return null;

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
    revision,
    sourceSha256,
    evidenceVersion,
    excerptSha256,
    pageNumber,
    regionId: cleanIdentifier(firstParam(params.proofRegion)),
    sheetNumber: cleanIdentifier(firstParam(params.proofSheet)),
    bounds: parsedBounds,
  });
}

export function resolveECOSDesktopDocumentProof(
  documents: readonly ReferenceDocument[],
  focus: ECOSDesktopDocumentProofFocus,
): ECOSDesktopResolvedProof | null {
  const documentRecord = documents.find(document =>
    document.id === focus.documentId &&
    document.isCurrent &&
    cleanIdentifier(document.projectId) === focus.projectId &&
    cleanIdentifier(document.drawingRevision) === focus.revision &&
    canonicalSha256(document.contentSha256) === focus.sourceSha256 &&
    canonicalSha256(document.indexedContentSha256) === focus.sourceSha256 &&
    (!focus.evidenceVersion.startsWith('ecos-hosted-') || (
      document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0' &&
      canonicalSha256(document.ecosVerifiedIndexCommittedSha256) === focus.sourceSha256 &&
      hasAuthoritativeECOSPageGraph(document)
    )),
  );
  if (!documentRecord) return null;

  const page = (documentRecord.extractedPages ?? [])
    .find(candidate => candidate.pageNumber === focus.pageNumber) ?? null;
  if (!page) return null;
  const pageProofMatches = (
    page.assurance?.accepted === true &&
    cleanIdentifier(page.assurance.evidenceVersion) === focus.evidenceVersion
  ) || (
    canonicalSha256(page.visualCoverage?.sourceSha256) === focus.sourceSha256 &&
    cleanIdentifier(page.visualCoverage?.evidenceVersion) === focus.evidenceVersion
  );
  if (!pageProofMatches) return null;
  const sheetMatches = !focus.sheetNumber || (
    Boolean(page.sheetNumber) &&
    normalizeSheet(page.sheetNumber || '') === normalizeSheet(focus.sheetNumber)
  );
  if (!sheetMatches) return null;
  const region = focus.regionId
    ? page?.regions?.find(candidate => candidate.id === focus.regionId) ?? null
    : null;
  if (focus.regionId && !region) return null;
  if (region) {
    const storedBounds = validBounds(region);
    if (
      !storedBounds || !focus.bounds || !sameBounds(storedBounds, focus.bounds) ||
      !focus.excerptSha256 || !regionTextMatchesCommitment(region, focus.excerptSha256)
    ) return null;
    return Object.freeze({
      document: documentRecord,
      page,
      region,
      bounds: storedBounds,
      match: 'stored_region',
    });
  }
  return Object.freeze({
    document: documentRecord,
    page,
    region: null,
    bounds: null,
    match: 'page_only',
  });
}

function firstParam(value: RouteParamValue): string | undefined {
  if (typeof value === 'string') return value;
  return value?.[0];
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

function proofTextSha256(value: unknown): string | null {
  const canonical = canonicalProofText(value);
  return canonical ? hex(sha256(utf8ToBytes(canonical))) : null;
}

function regionTextMatchesCommitment(region: ReferenceDocumentRegion, expectedSha256: string) {
  return [region.evidenceText, region.text, region.label]
    .some(value => proofTextSha256(value) === expectedSha256);
}

function canonicalProofText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lines = value.trim().split(/\r?\n/);
  if (/^DRAWING PAGE CONTEXT\s*:/i.test(lines[0]?.trim() ?? '')) lines.shift();
  const normalized = lines.join('\n')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (
    normalized.length < 3 || normalized.length > 1_600 ||
    normalized.split(' ').filter(Boolean).length < 2
  ) return null;
  return normalized;
}

function hex(bytes: Uint8Array) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,5}$/.test(value)) return null;
  return positiveInteger(Number(value));
}

function validBounds(value: unknown): ECOSDesktopProofBounds | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const x = number(candidate.x);
  const y = number(candidate.y);
  const width = number(candidate.width);
  const height = number(candidate.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x > 1 || y > 1 || width > 1 || height > 1) return null;
  if (x + width > 1.000001 || y + height > 1.000001) return null;
  return Object.freeze({ x, y, width, height });
}

function sameBounds(left: ECOSDesktopProofBounds, right: ECOSDesktopProofBounds) {
  return (['x', 'y', 'width', 'height'] as const)
    .every(key => left[key] === right[key]);
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function serializeCoordinate(value: number): string {
  return String(Number(value.toFixed(6)));
}

function normalizeSheet(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\u2012-\u2015]+/g, '-');
}
