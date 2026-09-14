import type { SupabaseClient } from '@supabase/supabase-js';
import { registerECOSAuthorizedProof } from './ECOSAuthorizedProofRegistry';
import type { DAVEAskEvidence } from './DAVEAsk';
import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegion,
} from '../types';
import {
  loadECOSProtectedDocumentPage,
  normalizeECOSProtectedSourceCitation,
  type ECOSProtectedDocumentPage,
  type ECOSProtectedSourceCitation,
} from './ECOSProtectedDocumentPage';

export type ECOSDocumentProofClaim = Readonly<{
  documentId: string;
  projectId: string;
  sourceSha256: string;
  evidenceVersion: string;
  revision: string;
  pageNumber: number;
  sheetNumber: string | null;
  regionId: string | null;
}>;

type ECOSDocumentProofAuthorityRow = Readonly<{
  document_id: string;
  project_id: string;
  source_sha256: string;
  evidence_version: string;
  source_revision: string;
  page_number: number;
  sheet_number: string | null;
  region_id: string | null;
  region_bounds: unknown;
  source_view_citation: unknown;
}>;

export type ECOSAuthorizedDocumentProof = Readonly<{
  document: ReferenceDocument;
  protectedPage: ECOSProtectedDocumentPage | null;
}>;

export type ECOSDocumentProofAuthorityErrorCode =
  | 'invalid_claim'
  | 'source_identity_mismatch'
  | 'proof_service_unavailable'
  | 'permission_denied'
  | 'proof_not_found'
  | 'proof_response_invalid';

export class ECOSDocumentProofAuthorityError extends Error {
  readonly code: ECOSDocumentProofAuthorityErrorCode;

  constructor(
    code: ECOSDocumentProofAuthorityErrorCode = 'proof_response_invalid',
    message = proofAuthorityErrorMessage(code),
  ) {
    super(message);
    this.name = 'ECOSDocumentProofAuthorityError';
    this.code = code;
  }
}

export function ecosDocumentProofClaimFromEvidence(
  evidence: DAVEAskEvidence,
): ECOSDocumentProofClaim | null {
  const citation = evidence.documentCitation;
  if (!citation) return null;
  const documentId = boundedClean(citation.documentId, 200);
  const projectId = boundedClean(citation.projectId, 200);
  const sourceSha256 = canonicalSha256(citation.sourceSha256);
  const evidenceVersion = boundedClean(citation.evidenceVersion, 64);
  const revision = boundedClean(citation.revision, 200);
  const pageNumber = positiveInteger(citation.pageNumber);
  const regionId = boundedClean(citation.regionId, 512);
  if (
    !documentId || !projectId || !sourceSha256 || !evidenceVersion || !revision ||
    pageNumber == null || !regionId
  ) {
    return null;
  }
  return Object.freeze({
    documentId,
    projectId,
    sourceSha256,
    evidenceVersion,
    revision,
    pageNumber,
    sheetNumber: boundedClean(citation.sheetNumber, 64) || null,
    regionId,
  });
}

/**
 * Loads only the exact identity and bounds needed to open one assured proof.
 * The RPC returns no document text and no neighboring regions. The database
 * independently rechecks current-document, source, revision, project, page,
 * sheet, and region authority before returning a row.
 */
export async function loadAuthorizedECOSDocumentProof({
  client,
  document,
  claim,
}: {
  client: SupabaseClient | null;
  document: ReferenceDocument;
  claim: ECOSDocumentProofClaim;
}): Promise<ReferenceDocument> {
  return (await loadVerifiedProofAuthority({ client, document, claim })).document;
}

export async function loadAuthorizedECOSDocumentProofBundle({
  client,
  document,
  claim,
  loadProtectedPage = loadECOSProtectedDocumentPage,
}: {
  client: SupabaseClient | null;
  document: ReferenceDocument;
  claim: ECOSDocumentProofClaim;
  loadProtectedPage?: (input: Readonly<{
    client: SupabaseClient;
    claim: ECOSDocumentProofClaim;
    citation: ECOSProtectedSourceCitation;
  }>) => Promise<ECOSProtectedDocumentPage>;
}): Promise<ECOSAuthorizedDocumentProof> {
  const verified = await loadVerifiedProofAuthority({ client, document, claim });
  if (!client || !verified.sourceViewCitation) {
    return Object.freeze({ document: verified.document, protectedPage: null });
  }
  const protectedPage = await loadProtectedPage({
    client,
    claim,
    citation: verified.sourceViewCitation,
  });
  return Object.freeze({ document: verified.document, protectedPage });
}

async function loadVerifiedProofAuthority({
  client,
  document,
  claim,
}: {
  client: SupabaseClient | null;
  document: ReferenceDocument;
  claim: ECOSDocumentProofClaim;
}): Promise<Readonly<{
  document: ReferenceDocument;
  sourceViewCitation: ECOSProtectedSourceCitation | null;
}>> {
  if (!client || !validProofClaim(claim)) {
    throw new ECOSDocumentProofAuthorityError('invalid_claim');
  }
  if (!baseDocumentMatchesClaim(document, claim)) {
    throw new ECOSDocumentProofAuthorityError('source_identity_mismatch');
  }

  const { data, error } = await client.rpc('dave_verify_current_ecos_document_proof', {
    p_project_id: claim.projectId,
    p_document_id: claim.documentId,
    p_source_sha256: claim.sourceSha256,
    p_evidence_version: claim.evidenceVersion,
    p_revision: claim.revision,
    p_page_number: claim.pageNumber,
    p_sheet_number: claim.sheetNumber,
    p_region_id: claim.regionId,
  });
  if (error) {
    throw new ECOSDocumentProofAuthorityError(proofAuthorityRPCErrorCode(error));
  }
  if (!Array.isArray(data) || data.length !== 1) {
    throw new ECOSDocumentProofAuthorityError('proof_not_found');
  }

  const row = normalizeAuthorityRow(data[0]);
  if (!row || !authorityRowMatchesClaim(row, claim)) {
    throw new ECOSDocumentProofAuthorityError('proof_response_invalid');
  }
  const region = authorityRegion(row, claim);
  if (claim.regionId && !region) {
    throw new ECOSDocumentProofAuthorityError('proof_response_invalid');
  }
  const page: ReferenceDocumentExtractedPage = {
    pageNumber: row.page_number,
    sheetNumber: row.sheet_number,
    sheetMappingStatus: row.sheet_number ? 'verified' : 'unverified',
    assurance: {
      accepted: true,
      evidenceVersion: row.evidence_version,
      failureCodes: [],
    },
    regions: region ? [region] : [],
  };
  const proofDocument = Object.freeze({
    ...document,
    ecosHostedIndexEvidenceVersion: row.evidence_version,
    extractedPages: [page],
  });
  const sourceViewCitation = row.source_view_citation == null
    ? null
    : normalizeECOSProtectedSourceCitation(row.source_view_citation, claim);
  if (row.source_view_citation != null && !sourceViewCitation) {
    throw new ECOSDocumentProofAuthorityError('proof_response_invalid');
  }
  registerECOSAuthorizedProof(proofDocument, claim);
  return Object.freeze({ document: proofDocument, sourceViewCitation });
}

export function proofAuthorityErrorMessage(code: ECOSDocumentProofAuthorityErrorCode) {
  switch (code) {
    case 'invalid_claim':
      return 'This answer did not include a complete proof identity. Ask ECOS again before relying on it.';
    case 'source_identity_mismatch':
      return 'The cited document changed after this answer was prepared. Refresh the project and ask ECOS again.';
    case 'proof_service_unavailable':
      return 'The protected proof service is temporarily unavailable. The project document was not reported as changed.';
    case 'permission_denied':
      return 'This signed-in account cannot open the cited project source.';
    case 'proof_not_found':
      return 'The current document does not contain the exact cited page and region.';
    default:
      return 'The protected proof response could not be safely verified.';
  }
}

function proofAuthorityRPCErrorCode(error: unknown): ECOSDocumentProofAuthorityErrorCode {
  const value = record(error);
  const code = clean(value.code).toUpperCase();
  const message = [value.message, value.details, value.hint]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    code === 'PGRST202' || code === '42883' ||
    /could not find the function|function .* does not exist|schema cache/.test(message)
  ) return 'proof_service_unavailable';
  if (code === '42501' || /permission denied|not authorized|requires an authorized owner/.test(message)) {
    return 'permission_denied';
  }
  if (code === '57014' || /^PGRST5/.test(code) || /timeout|timed out|connection/.test(message)) {
    return 'proof_service_unavailable';
  }
  return 'proof_response_invalid';
}

function baseDocumentMatchesClaim(
  document: ReferenceDocument,
  claim: ECOSDocumentProofClaim,
) {
  if (!document.isCurrent || document.id !== claim.documentId) return false;
  const sourceIdentities = [
    document.contentSha256,
    document.webFileFingerprint,
    document.indexedContentSha256,
    document.ecosVerifiedIndexCommittedSha256,
  ].map(canonicalSha256).filter(Boolean);
  if (sourceIdentities.length === 0 || sourceIdentities.some(value => value !== claim.sourceSha256)) {
    return false;
  }
  const revision = clean(document.drawingRevision) || clean(document.webVersionGroupId);
  return revision === claim.revision &&
    positiveInteger(document.sourcePageCount) != null &&
    claim.pageNumber <= (positiveInteger(document.sourcePageCount) || 0);
}

function validProofClaim(claim: ECOSDocumentProofClaim) {
  return boundedClean(claim.documentId, 200) === claim.documentId &&
    boundedClean(claim.projectId, 200) === claim.projectId &&
    canonicalSha256(claim.sourceSha256) === claim.sourceSha256 &&
    claim.evidenceVersion === 'ecos-hosted-evidence/1.3' &&
    boundedClean(claim.revision, 200) === claim.revision &&
    positiveInteger(claim.pageNumber) === claim.pageNumber &&
    (claim.sheetNumber == null || boundedClean(claim.sheetNumber, 64) === claim.sheetNumber) &&
    boundedClean(claim.regionId, 512) === claim.regionId && Boolean(claim.regionId);
}

function normalizeAuthorityRow(value: unknown): ECOSDocumentProofAuthorityRow | null {
  const row = record(value);
  const documentId = clean(row.document_id);
  const projectId = clean(row.project_id);
  const sourceSha256 = canonicalSha256(row.source_sha256);
  const evidenceVersion = clean(row.evidence_version);
  const sourceRevision = clean(row.source_revision);
  const pageNumber = positiveInteger(row.page_number);
  if (!documentId || !projectId || !sourceSha256 || !evidenceVersion || !sourceRevision || pageNumber == null) {
    return null;
  }
  return Object.freeze({
    document_id: documentId,
    project_id: projectId,
    source_sha256: sourceSha256,
    evidence_version: evidenceVersion,
    source_revision: sourceRevision,
    page_number: pageNumber,
    sheet_number: clean(row.sheet_number) || null,
    region_id: clean(row.region_id) || null,
    region_bounds: row.region_bounds,
    source_view_citation: row.source_view_citation ?? null,
  });
}

function authorityRowMatchesClaim(
  row: ECOSDocumentProofAuthorityRow,
  claim: ECOSDocumentProofClaim,
) {
  return row.document_id === claim.documentId &&
    row.project_id === claim.projectId &&
    row.source_sha256 === claim.sourceSha256 &&
    row.evidence_version === claim.evidenceVersion &&
    row.source_revision === claim.revision &&
    row.page_number === claim.pageNumber &&
    normalizeSheet(row.sheet_number) === normalizeSheet(claim.sheetNumber) &&
    row.region_id === claim.regionId;
}

function authorityRegion(
  row: ECOSDocumentProofAuthorityRow,
  claim: ECOSDocumentProofClaim,
): ReferenceDocumentRegion | null {
  if (!claim.regionId) return null;
  const bounds = normalizedBounds(row.region_bounds);
  if (!bounds) return null;
  return {
    id: claim.regionId,
    ...bounds,
    source: null,
    rawSource: 'hosted_proof_authority',
  };
}

function normalizedBounds(value: unknown) {
  const bounds = record(value);
  const x = finiteNumber(bounds.x);
  const y = finiteNumber(bounds.y);
  const width = finiteNumber(bounds.width);
  const height = finiteNumber(bounds.height);
  if (
    x == null || y == null || width == null || height == null ||
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x > 1 || y > 1 || width > 1 || height > 1 ||
    x + width > 1.000001 || y + height > 1.000001
  ) return null;
  return Object.freeze({ x, y, width, height });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedClean(value: unknown, maxLength: number) {
  const normalized = clean(value);
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : '';
}

function canonicalSha256(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSheet(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}
