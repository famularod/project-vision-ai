import { canonicalComparableSheetNumber } from './ecos-sheet-provenance-validation.ts';

export type ECOSHostedPageContextClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{
    data: unknown;
    error: Readonly<{ code?: string | null; message?: string | null }> | null;
  }>>;
}>;

export type ECOSHostedSheetPageAuthority = Readonly<{
  candidateCount: number;
  overbound: boolean;
  rows: readonly Record<string, unknown>[];
}>;

/**
 * Atomically resolves every current hosted page carrying one of the requested
 * exact sheet identities. The RPC returns either all one-to-four contexts or
 * a fifth-candidate poison sentinel; ranked search is never allowed to choose
 * a smaller apparent authority set.
 */
export async function loadECOSCurrentHostedSheetPageContext({
  client,
  projectId,
  documentIds,
  sheetIdentifiers,
  authorityMode = 'published',
  actorId = null,
}: {
  client: ECOSHostedPageContextClient;
  projectId: string;
  documentIds: readonly string[];
  sheetIdentifiers: readonly string[];
  authorityMode?: 'published' | 'shadow';
  actorId?: string | null;
}): Promise<ECOSHostedSheetPageAuthority | null> {
  if (
    !Array.isArray(documentIds) || !Array.isArray(sheetIdentifiers) ||
    documentIds.length < 1 || documentIds.length > 4 ||
    sheetIdentifiers.length < 1 || sheetIdentifiers.length > 4
  ) return null;
  const normalizedProjectId = strictIdentity(projectId);
  const normalizedDocumentIds = exactDistinctIdentities(documentIds, 300);
  const normalizedSheetIdentifiers = exactDistinctIdentities(sheetIdentifiers, 160);
  const normalizedActorId = actorId == null ? '' : strictIdentity(actorId);
  if (
    !normalizedProjectId || !normalizedDocumentIds || !normalizedSheetIdentifiers ||
    normalizedSheetIdentifiers.some(identifier =>
      canonicalComparableSheetNumber(identifier) !== identifier
    ) ||
    (authorityMode === 'published' && actorId != null) ||
    (authorityMode === 'shadow' && !canonicalUUID(normalizedActorId))
  ) return null;

  const result = await client.rpc('ecos_load_current_hosted_sheet_page_context', {
    p_project_id: normalizedProjectId,
    p_document_ids: normalizedDocumentIds,
    p_sheet_identifiers: normalizedSheetIdentifiers,
    p_authority_mode: authorityMode,
    p_actor_id: authorityMode === 'shadow' ? normalizedActorId : null,
  });
  if (result.error) {
    if (rpcIsUnavailable(result.error)) return null;
    throw result.error;
  }
  if (!Array.isArray(result.data) || result.data.length !== 1) return null;
  const envelope = record(result.data[0]);
  const candidateCount = strictBoundedInteger(envelope.candidate_count, 0, 5);
  const overbound = envelope.overbound;
  const authorityComplete = envelope.authority_complete;
  const rawContexts = envelope.page_contexts;
  if (
    candidateCount == null || typeof overbound !== 'boolean' || authorityComplete !== true ||
    !Array.isArray(rawContexts) ||
    overbound !== (candidateCount === 5) ||
    (overbound ? rawContexts.length !== 0 : rawContexts.length !== candidateCount)
  ) return null;
  if (overbound) {
    return Object.freeze({ candidateCount, overbound, rows: Object.freeze([]) });
  }

  const requestedDocumentIds = new Set(normalizedDocumentIds);
  const requestedSheetIdentifiers = new Set(normalizedSheetIdentifiers);
  const rows: Record<string, unknown>[] = [];
  const pageKeys = new Set<string>();
  const authoritySignatureByDocument = new Map<string, string>();
  const authorityBindingByJob = new Map<string, string>();
  for (const value of rawContexts) {
    const row = record(value);
    const documentId = strictIdentity(row.document_id);
    const pageNumber = strictPageNumber(row.page_number);
    const sheetIdentifier = strictIdentity(row.sheet_identifier);
    const sheetNumber = strictSheetNumber(row.sheet_number);
    const rowProjectId = strictIdentity(row.project_id);
    const jobId = strictIdentity(row.job_id);
    const organizationId = strictIdentity(row.organization_id);
    const sourceSha256 = strictSha256(row.source_sha256);
    const evidenceVersion = strictIdentity(row.evidence_version);
    const sourceMode = strictIdentity(row.source_mode);
    if (
      !requestedDocumentIds.has(documentId) || pageNumber == null ||
      !requestedSheetIdentifiers.has(sheetIdentifier) ||
      canonicalComparableSheetNumber(sheetNumber) !== sheetIdentifier ||
      rowProjectId !== normalizedProjectId || !jobId || !organizationId || !sourceSha256 ||
      evidenceVersion !== 'ecos-hosted-evidence/1.3' ||
      (sourceMode !== 'live' && sourceMode !== 'shadow') ||
      (authorityMode === 'shadow' && sourceMode !== 'shadow')
    ) return null;
    const key = `${documentId}:${pageNumber}`;
    if (pageKeys.has(key)) return null;
    pageKeys.add(key);
    const authoritySignature = [
      jobId,
      organizationId,
      rowProjectId,
      sourceSha256,
      evidenceVersion,
      sourceMode,
    ].join('\u0000');
    const previousDocumentSignature = authoritySignatureByDocument.get(documentId);
    if (previousDocumentSignature && previousDocumentSignature !== authoritySignature) return null;
    authoritySignatureByDocument.set(documentId, authoritySignature);
    const authorityBinding = `${organizationId}\u0000${documentId}`;
    const previousJobBinding = authorityBindingByJob.get(jobId);
    if (previousJobBinding && previousJobBinding !== authorityBinding) return null;
    authorityBindingByJob.set(jobId, authorityBinding);
    rows.push(row);
  }
  return Object.freeze({
    candidateCount,
    overbound,
    rows: Object.freeze(rows),
  });
}

/**
 * Loads only the bounded page context published by the exact-current hosted
 * evidence RPC. Customer clients must never fall back to direct hosted-table
 * reads because those tables deliberately do not grant authenticated SELECT.
 */
export async function loadECOSCurrentHostedPageContext({
  client,
  projectId,
  documentIds,
  pageNumbers,
}: {
  client: ECOSHostedPageContextClient;
  projectId: string;
  documentIds: readonly string[];
  pageNumbers: readonly number[];
}): Promise<readonly Record<string, unknown>[]> {
  // Validate raw cardinality and containers before mapping or allocating a
  // normalized copy. Truncating or de-duplicating an overbound request would
  // let its omitted tail disappear from the authority decision.
  if (
    !Array.isArray(documentIds) || !Array.isArray(pageNumbers) ||
    documentIds.length < 1 || documentIds.length > 24 ||
    pageNumbers.length < 1 || pageNumbers.length > 24
  ) return Object.freeze([]);
  const normalizedProjectId = strictIdentity(projectId);
  const normalizedDocumentIds = exactUniqueDocumentIds(documentIds);
  const normalizedPageNumbers = exactUniquePageNumbers(pageNumbers);
  if (
    !normalizedProjectId || !normalizedDocumentIds || !normalizedPageNumbers ||
    normalizedDocumentIds.length === 0 || normalizedPageNumbers.length === 0
  ) {
    return Object.freeze([]);
  }
  // The RPC returns at most 200 rows. Reject a request whose unique
  // document/page cross-product could exceed that bound so a direct or future
  // multi-document caller cannot mistake a truncated response for complete
  // authority.
  if (normalizedDocumentIds.length * normalizedPageNumbers.length > 200) {
    return Object.freeze([]);
  }

  const result = await client.rpc('ecos_load_current_hosted_page_context', {
    p_project_id: normalizedProjectId,
    p_document_ids: normalizedDocumentIds,
    p_page_numbers: normalizedPageNumbers,
  });
  if (result.error) {
    if (rpcIsUnavailable(result.error)) return Object.freeze([]);
    throw result.error;
  }
  if (!Array.isArray(result.data)) return Object.freeze([]);
  const rawRows = result.data;
  // Never truncate an authority response into apparent uniqueness. A row past
  // the old slice boundary could conflict with an earlier receipt for the same
  // immutable page, and an unrequested row must not consume the bounded set.
  if (rawRows.length > 200) return Object.freeze([]);
  const requestedDocumentIds = new Set<string>(normalizedDocumentIds);
  const requestedPageNumbers = new Set<number>(normalizedPageNumbers);
  const rows: Record<string, unknown>[] = [];
  const pageKeys = new Set<string>();
  for (const value of rawRows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return Object.freeze([]);
    }
    const row = value as Record<string, unknown>;
    const documentId = strictIdentity(row.document_id);
    const pageNumber = strictPageNumber(row.page_number);
    if (!requestedDocumentIds.has(documentId) || pageNumber == null ||
        !requestedPageNumbers.has(pageNumber)) return Object.freeze([]);
    const key = `${documentId}:${pageNumber}`;
    // The hosted RPC contract returns at most one exact-current authority row
    // for a document/page tuple. Multiple receipts cannot be ordered here.
    if (pageKeys.has(key)) return Object.freeze([]);
    pageKeys.add(key);
    rows.push(row);
  }
  return Object.freeze(rows);
}

/**
 * The legacy page table is authenticated-owner writable. It may still support
 * generic document search, but drawing page context must come only from the
 * hosted worker/Assurance boundary.
 */
export function eligibleECOSLegacyPageDocumentIds(
  documentIds: readonly string[],
  drawingDocumentIds: ReadonlySet<string>,
): readonly string[] {
  return Object.freeze([...new Set(documentIds
    .map(value => value.trim())
    .filter(value => value && !drawingDocumentIds.has(value)))].slice(0, 24));
}

/**
 * Defense in depth for a stale/malicious response: even when a backend ignores
 * the requested document filter, no drawing row or hosted-page duplicate can
 * cross the client-writable legacy boundary.
 */
export function filterECOSLegacyPageContextRows({
  rows,
  hostedRows,
  drawingDocumentIds,
}: {
  rows: readonly unknown[];
  hostedRows: readonly unknown[];
  drawingDocumentIds: ReadonlySet<string>;
}): readonly Record<string, unknown>[] {
  const hostedKeys = new Set(hostedRows.flatMap(value => {
    const row = record(value);
    const key = pageKey(row);
    return key ? [key] : [];
  }));
  return Object.freeze(rows.flatMap(value => {
    const row = record(value);
    const documentId = text(row.document_id);
    const key = pageKey(row);
    if (!documentId || !key || drawingDocumentIds.has(documentId) || hostedKeys.has(key)) return [];
    return [row];
  }).slice(0, 200));
}

function rpcIsUnavailable(error: Readonly<{ code?: string | null; message?: string | null }>) {
  const diagnostic = String(error.message || '').toLowerCase();
  return error.code === '42883' || error.code === 'PGRST202' ||
    (!error.code && diagnostic.includes('could not find the function'));
}

function pageKey(row: Readonly<Record<string, unknown>>) {
  const documentId = text(row.document_id);
  const pageNumber = Math.floor(Number(row.page_number));
  return documentId && Number.isInteger(pageNumber) && pageNumber > 0
    ? `${documentId}:${pageNumber}`
    : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function strictIdentity(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 300 &&
      value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : '';
}

function strictSheetNumber(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 &&
      value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) &&
      !/["'‘’“”]/.test(value)
    ? value
    : '';
}

function strictPageNumber(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000
    ? value
    : null;
}

function exactUniqueDocumentIds(values: readonly unknown[]) {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const documentId = strictIdentity(value);
    if (!documentId) return null;
    if (seen.has(documentId)) continue;
    seen.add(documentId);
    unique.push(documentId);
  }
  return unique;
}

function exactUniquePageNumbers(values: readonly unknown[]) {
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const pageNumber = strictPageNumber(value);
    if (pageNumber == null) return null;
    if (seen.has(pageNumber)) continue;
    seen.add(pageNumber);
    unique.push(pageNumber);
  }
  return unique;
}

function exactDistinctIdentities(values: readonly unknown[], maximum: number) {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const identity = strictIdentity(value);
    if (!identity || identity.length > maximum || seen.has(identity)) return null;
    seen.add(identity);
    unique.push(identity);
  }
  return unique;
}

function strictBoundedInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function strictSha256(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : '';
}

function canonicalUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  ) ? value : '';
}
