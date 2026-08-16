import type { ReferenceDocument } from '../types';
import type { DAVEAskEvidence } from './DAVEAsk';
import { hasAuthoritativeECOSPageGraph } from './ECOSHostedPageGraphAuthority';

/**
 * Resolves proof only against the immutable source identity carried by the
 * assured citation. Display names and document ids alone are not revision
 * authority and are intentionally insufficient.
 */
export function findExactECOSDocumentEvidenceSource(
  documents: readonly ReferenceDocument[],
  evidence: DAVEAskEvidence,
): ReferenceDocument | null {
  const citation = evidence.documentCitation;
  if (evidence.sourceType !== 'document' || !citation) return null;
  const documentId = clean(citation.documentId);
  const projectId = clean(citation.projectId);
  const revision = clean(citation.revision);
  const sourceSha256 = canonicalSha256(citation.sourceSha256);
  const evidenceVersion = clean(citation.evidenceVersion);
  const pageNumber = positiveInteger(citation.pageNumber);
  const excerpt = proofBody(evidence.excerpt);
  if (
    !documentId || !projectId || !revision || !sourceSha256 ||
    !evidenceVersion || !pageNumber || !isSubstantialProofText(excerpt)
  ) return null;

  return documents.find(document => {
    const page = (document.extractedPages ?? []).find(item => item.pageNumber === pageNumber);
    const regionId = clean(citation.regionId);
    const region = regionId
      ? page?.regions?.find(item => clean(item.id) === regionId)
      : null;
    const exactPageProof = page && (
      (page.assurance?.accepted === true && clean(page.assurance.evidenceVersion) === evidenceVersion) ||
      (canonicalSha256(page.visualCoverage?.sourceSha256) === sourceSha256 &&
        clean(page.visualCoverage?.evidenceVersion) === evidenceVersion)
    );
    const exactTextProof = regionId
      ? Boolean(
          region &&
          evidence.documentRegion &&
          clean(evidence.documentRegion.id) === regionId &&
          sameBounds(region, evidence.documentRegion) &&
          sourceFieldsContainProof(region, excerpt) &&
          carriedRegionTextMatches(region, evidence.documentRegion),
        )
      : !evidence.documentRegion && sourceContainsProof(page?.text, excerpt);
    const commitMatches = !evidenceVersion.startsWith('ecos-hosted-') || (
      document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0' &&
      canonicalSha256(document.ecosVerifiedIndexCommittedSha256) === sourceSha256 &&
      hasAuthoritativeECOSPageGraph(document)
    );
    return Boolean(
    document.id === documentId &&
    document.isCurrent &&
    clean(document.projectId) === projectId &&
    clean(document.drawingRevision) === revision &&
    canonicalSha256(document.contentSha256) === sourceSha256 &&
    canonicalSha256(document.indexedContentSha256) === sourceSha256 &&
    commitMatches &&
    exactPageProof &&
    exactTextProof
    );
  }) ?? null;
}

function sameBounds(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return validBounds(left) && validBounds(right) &&
    (['x', 'y', 'width', 'height'] as const).every(key => left[key] === right[key]);
}

function validBounds(value: { x: number; y: number; width: number; height: number }) {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
    value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 &&
    value.x + value.width <= 1.001 && value.y + value.height <= 1.001;
}

function sourceContainsProof(source: unknown, proof: string) {
  const normalizedSource = normalizeProofText(source);
  const normalizedProof = normalizeProofText(proof);
  return isSubstantialProofText(normalizedSource) &&
    isSubstantialProofText(normalizedProof) &&
    (normalizedSource === normalizedProof ||
      ` ${normalizedSource} `.includes(` ${normalizedProof} `));
}

function sourceFieldsContainProof(
  source: { evidenceText?: unknown; text?: unknown; label?: unknown },
  proof: string,
) {
  return [source.evidenceText, source.text, source.label]
    .some(value => sourceContainsProof(value, proof));
}

function carriedRegionTextMatches(
  source: { evidenceText?: unknown; text?: unknown; label?: unknown },
  carried: { evidenceText?: unknown; text?: unknown; label?: unknown },
) {
  return [carried.evidenceText, carried.text, carried.label]
    .map(proofBody)
    .filter(isSubstantialProofText)
    .some(proof => sourceFieldsContainProof(source, proof));
}

function isSubstantialProofText(value: unknown) {
  const normalized = normalizeProofText(value);
  return normalized.length >= 3 && normalized.split(' ').filter(Boolean).length >= 2;
}

function proofBody(value: unknown) {
  const lines = clean(value).split(/\r?\n/);
  if (/^DRAWING PAGE CONTEXT\s*:/i.test(lines[0]?.trim() ?? '')) lines.shift();
  return lines.join('\n').trim();
}

function normalizeProofText(value: unknown) {
  return clean(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalSha256(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}
