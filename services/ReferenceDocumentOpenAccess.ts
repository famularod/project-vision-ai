import type { ReferenceDocument } from '../types';

export type ReferenceDocumentOpenMode =
  | 'device_or_protected_storage'
  | 'google_drive'
  | 'unavailable';

export function referenceDocumentOpenMode(
  document: ReferenceDocument | null | undefined,
): ReferenceDocumentOpenMode {
  if (!document) return 'unavailable';
  if (googleDriveReferenceDocumentUrl(document)) return 'google_drive';
  if (document.uri?.trim() || document.storagePath?.trim()) {
    return 'device_or_protected_storage';
  }
  return 'unavailable';
}

/**
 * Builds the canonical Drive URL from the provider-issued file identity rather
 * than trusting a persisted arbitrary URL.
 */
export function googleDriveReferenceDocumentUrl(
  document: ReferenceDocument,
): string | null {
  const source = document.externalSource;
  const fileId = source?.fileId?.trim() || '';
  if (
    document.sourceProvider !== 'google_drive' ||
    source?.provider !== 'google_drive' ||
    !/^[A-Za-z0-9_-]{8,512}$/.test(fileId)
  ) return null;
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
