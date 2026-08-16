export type ECOSHostedPageContextClient = Readonly<{
  rpc: (
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ) => PromiseLike<Readonly<{
    data: unknown;
    error: Readonly<{ code?: string | null; message?: string | null }> | null;
  }>>;
}>;

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
  const normalizedProjectId = projectId.trim();
  const normalizedDocumentIds = [...new Set(documentIds.map(value => value.trim()).filter(Boolean))]
    .slice(0, 24);
  const normalizedPageNumbers = [...new Set(pageNumbers
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isInteger(value) && value > 0 && value <= 10_000))]
    .slice(0, 24);
  if (!normalizedProjectId || normalizedDocumentIds.length === 0 || normalizedPageNumbers.length === 0) {
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
  return Object.freeze((Array.isArray(result.data) ? result.data : [])
    .filter(value => value && typeof value === 'object' && !Array.isArray(value))
    .slice(0, 200) as Record<string, unknown>[]);
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
