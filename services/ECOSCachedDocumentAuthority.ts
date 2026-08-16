import type { ReferenceDocument } from '../types';
import { reconcileECOSHostedIndexStatus } from './ECOSHostedIndexer';

/**
 * Persisted device/backup records are document metadata, not a fresh hosted
 * authority snapshot. Revoke cached Ready and commit receipts until the
 * authenticated status boundary supplies the exact current document/project
 * status again.
 */
export function revokeCachedECOSDocumentAuthority(
  documents: readonly ReferenceDocument[],
): ReferenceDocument[] {
  return documents.map(document => reconcileECOSHostedIndexStatus(
    document,
    null,
    'unavailable',
  ));
}
