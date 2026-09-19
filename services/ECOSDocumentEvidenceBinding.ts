import type { DAVEAskEvidence } from './DAVEAsk';
import type { ReferenceDocument } from '../types';
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import { hasCompleteECOSDrawingVisualCoverage } from './ECOSDrawingVisualCoverage';

export type ECOSProjectIdentity = Readonly<{
  id?: string | null;
  name?: string | null;
}>;

export type ECOSDocumentEvidenceBindingReason =
  | 'exact'
  | 'exact_hosted_region'
  | 'missing_citation'
  | 'document_unavailable'
  | 'document_not_current'
  | 'document_mismatch'
  | 'project_scope_mismatch'
  | 'source_mismatch'
  | 'revision_mismatch'
  | 'page_mismatch'
  | 'sheet_mismatch'
  | 'evidence_version_mismatch'
  | 'visual_coverage_mismatch';

export type ECOSDocumentEvidenceBinding = Readonly<{
  exact: boolean;
  reason: ECOSDocumentEvidenceBindingReason;
  proofMode: 'stored_visual_coverage' | 'hosted_cited_region' | null;
  message: string | null;
}>;

export const ECOS_DOCUMENT_EVIDENCE_UNAVAILABLE_MESSAGE =
  'This citation no longer matches the current project document. Refresh project documents and ask ECOS again before relying on this proof.';

/**
 * Revalidates a citation against the exact current document source available to
 * the signed-in user. Hosted V2 regions may be displayed before the older
 * six-tile mobile index is published, but only when the citation remains bound
 * to the same project, immutable bytes, revision, page, sheet, evidence
 * version, and bounded region carried by the assured answer.
 */
export function evaluateECOSDocumentEvidenceBinding(
  evidence: DAVEAskEvidence | null | undefined,
  document: ReferenceDocument | null | undefined,
  projectIdentities: readonly ECOSProjectIdentity[] = [],
): ECOSDocumentEvidenceBinding {
  const citation = evidence?.documentCitation;
  if (!citation) return unavailable('missing_citation');
  if (!document) return unavailable('document_unavailable');
  if (!document.isCurrent) return unavailable('document_not_current');
  if (!clean(citation.documentId) || citation.documentId !== document.id) {
    return unavailable('document_mismatch');
  }

  const projectId = clean(citation.projectId);
  if (!documentMatchesProject(document, projectId, projectIdentities)) {
    return unavailable('project_scope_mismatch');
  }

  const pageNumber = positiveInteger(citation.pageNumber);
  const pages = pageNumber == null
    ? []
    : (document.extractedPages ?? []).filter(page => page.pageNumber === pageNumber);
  const citationSourceSha256 = canonicalSha256(citation.sourceSha256);
  const sourceIdentities = [
    canonicalSha256(document.contentSha256),
    canonicalSha256(document.webFileFingerprint),
    canonicalSha256(document.indexedContentSha256),
    canonicalSha256(document.ecosVerifiedIndexCommittedSha256),
    ...pages.flatMap(page => [
      canonicalSha256(page.visualCoverage?.sourceSha256),
      ...(page.visualCoverage?.completedDeepReadRegionProofs ?? [])
        .map(proof => canonicalSha256(proof.sourceSha256)),
    ]),
  ].filter((value): value is string => Boolean(value));
  if (
    !citationSourceSha256 ||
    sourceIdentities.length === 0 ||
    sourceIdentities.some(value => value !== citationSourceSha256)
  ) {
    return unavailable('source_mismatch');
  }

  const citationRevision = clean(citation.revision);
  const documentRevision = clean(document.drawingRevision) ||
    clean(document.webVersionGroupId) ||
    `sha256:${sourceIdentities[0]}`;
  if (!citationRevision || citationRevision !== documentRevision) {
    return unavailable('revision_mismatch');
  }

  const sourcePageCount = positiveInteger(document.sourcePageCount);
  const committedPageCount = positiveInteger(document.ecosVerifiedIndexCommittedPageCount);
  if (
    pageNumber == null ||
    sourcePageCount == null ||
    committedPageCount == null ||
    sourcePageCount !== committedPageCount ||
    pageNumber > sourcePageCount ||
    pages.length !== 1
  ) {
    return unavailable('page_mismatch');
  }

  const page = pages[0];
  const citedSheet = clean(citation.sheetNumber);
  const indexedSheet = clean(page.sheetNumber);
  if (citedSheet && (!indexedSheet || normalizeSheet(citedSheet) !== normalizeSheet(indexedSheet))) {
    return unavailable('sheet_mismatch');
  }

  const citationEvidenceVersion = clean(citation.evidenceVersion);
  const evidenceVersions = [
    clean(document.ecosHostedIndexEvidenceVersion),
    clean(page.assurance?.evidenceVersion),
    clean(page.visualCoverage?.evidenceVersion),
    ...(page.visualCoverage?.completedDeepReadRegionProofs ?? [])
      .map(proof => clean(proof.evidenceVersion)),
  ].filter(Boolean);
  if (
    !citationEvidenceVersion ||
    evidenceVersions.length === 0 ||
    evidenceVersions.some(value => value !== citationEvidenceVersion)
  ) {
    return unavailable('evidence_version_mismatch');
  }

  if (
    canonicalReferenceCategory(document) !== 'drawing' ||
    hasCompleteECOSDrawingVisualCoverage(page)
  ) {
    return exact('exact', 'stored_visual_coverage');
  }

  if (hasExactHostedRegionBinding({
    evidence,
    document,
    citationSourceSha256,
    citationEvidenceVersion,
    pageNumber,
  })) {
    return exact('exact_hosted_region', 'hosted_cited_region');
  }

  return unavailable('visual_coverage_mismatch');
}

function hasExactHostedRegionBinding({
  evidence,
  document,
  citationSourceSha256,
  citationEvidenceVersion,
  pageNumber,
}: {
  evidence: DAVEAskEvidence;
  document: ReferenceDocument;
  citationSourceSha256: string;
  citationEvidenceVersion: string;
  pageNumber: number;
}) {
  const citation = evidence.documentCitation;
  const region = evidence.documentRegion;
  const page = (document.extractedPages ?? []).find(item => item.pageNumber === pageNumber);
  return Boolean(
    citation &&
    citationEvidenceVersion.startsWith('ecos-hosted-evidence/') &&
    document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0' &&
    canonicalSha256(document.ecosVerifiedIndexCommittedSha256) === citationSourceSha256 &&
    clean(document.ecosHostedIndexEvidenceVersion) === citationEvidenceVersion &&
    page?.assurance?.accepted === true &&
    clean(page.assurance.evidenceVersion) === citationEvidenceVersion &&
    clean(citation.regionId) &&
    clean(citation.regionId) === clean(region?.id) &&
    validBounds(region),
  );
}

function exact(
  reason: Extract<ECOSDocumentEvidenceBindingReason, 'exact' | 'exact_hosted_region'>,
  proofMode: NonNullable<ECOSDocumentEvidenceBinding['proofMode']>,
): ECOSDocumentEvidenceBinding {
  return Object.freeze({ exact: true, reason, proofMode, message: null });
}

function unavailable(reason: Exclude<
  ECOSDocumentEvidenceBindingReason,
  'exact' | 'exact_hosted_region'
>): ECOSDocumentEvidenceBinding {
  const message = reason === 'document_unavailable'
    ? 'The cited current document is no longer available on this device.'
    : reason === 'visual_coverage_mismatch'
      ? 'The cited source is current, but this build cannot safely display its exact hosted drawing region.'
      : ECOS_DOCUMENT_EVIDENCE_UNAVAILABLE_MESSAGE;
  return Object.freeze({ exact: false, reason, proofMode: null, message });
}

function documentMatchesProject(
  document: ReferenceDocument,
  projectId: string,
  projectIdentities: readonly ECOSProjectIdentity[],
) {
  if (!projectId) return false;
  if (clean(document.projectId) === projectId) return true;

  const documentProjectNames = new Set([
    document.projectName,
    ...(document.projectNames ?? []),
  ].map(normalizedName).filter(Boolean));
  if (documentProjectNames.size === 0) return false;

  const uniqueIdentities = [...new Map(projectIdentities.flatMap(project => {
    const id = clean(project.id);
    const name = normalizedName(project.name);
    return id && name ? [[`${id}\u0000${name}`, { id, name }] as const] : [];
  })).values()];
  const matches = uniqueIdentities.filter(project => project.id === projectId);
  if (matches.length !== 1) return false;
  const projectName = matches[0].name;
  const sameNameIds = new Set(
    uniqueIdentities.filter(project => project.name === projectName).map(project => project.id),
  );
  return sameNameIds.size === 1 && documentProjectNames.has(projectName);
}

function validBounds(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  const x = finiteNumber(bounds.x);
  const y = finiteNumber(bounds.y);
  const width = finiteNumber(bounds.width);
  const height = finiteNumber(bounds.height);
  return x != null && y != null && width != null && height != null &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x <= 1 && y <= 1 && width <= 1 && height <= 1 &&
    x + width <= 1.000001 && y + height <= 1.000001;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalSha256(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function normalizedName(value: unknown) {
  return clean(value).toLocaleLowerCase('en-US');
}

function normalizeSheet(value: string) {
  return value.trim().toUpperCase().replace(/[\s\u2012-\u2015]+/g, '-');
}
