/** A failed/truncated read is not evidence that a project has no answer. */
export class ECOSCustomerEvidenceReadError extends Error {
  readonly code: 'ecos_project_evidence_unavailable' | 'ecos_project_evidence_limit';
  constructor(readonly collection: string, readonly reason: 'read_failed' | 'malformed' | 'overbound') {
    super(`Project evidence ${collection}: ${reason}`);
    this.name = 'ECOSCustomerEvidenceReadError';
    this.code = reason === 'overbound' ? 'ecos_project_evidence_limit' : 'ecos_project_evidence_unavailable';
  }
}

export function completeCustomerEvidenceRows<T>(
  collection: string,
  result: Readonly<{ data: T[] | null; error: unknown }>,
  maximumRows?: number,
): T[] {
  if (result.error) throw new ECOSCustomerEvidenceReadError(collection, 'read_failed');
  if (!Array.isArray(result.data)) throw new ECOSCustomerEvidenceReadError(collection, 'malformed');
  if (maximumRows != null && result.data.length > maximumRows) {
    throw new ECOSCustomerEvidenceReadError(collection, 'overbound');
  }
  return result.data;
}
