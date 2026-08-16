export const REFERENCE_DOCUMENT_RESTORE_BUCKET = 'project-documents';

export type ReferenceDocumentByteRestoreInput = Readonly<{
  documentId: string;
  storagePath: string;
  originalFileName: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  bucket?: string;
}>;

export type ReferenceDocumentByteRestoreResult = Readonly<{
  documentId: string;
  uri: string;
  bucket: string;
  storagePath: string;
  sizeBytes: number;
  sha256: string;
}>;

export type ReferenceDocumentByteRestoreDependencies = Readonly<{
  downloadBytes: (bucket: string, storagePath: string) => Promise<Uint8Array>;
  createOwnedDestination: (
    documentId: string,
    originalFileName: string,
  ) => Promise<string>;
  writeBytes: (uri: string, bytes: Uint8Array) => Promise<void>;
  readBytes: (uri: string) => Promise<Uint8Array>;
  deleteFile: (uri: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => Promise<string>;
}>;

export type ReferenceDocumentByteRestoreErrorCode =
  | 'invalid_identity'
  | 'invalid_storage_path'
  | 'missing_integrity_metadata'
  | 'download_failed'
  | 'download_integrity_mismatch'
  | 'write_failed'
  | 'saved_integrity_mismatch';

export class ReferenceDocumentByteRestoreError extends Error {
  readonly code: ReferenceDocumentByteRestoreErrorCode;
  readonly causeValue: unknown;

  constructor(
    code: ReferenceDocumentByteRestoreErrorCode,
    message: string,
    causeValue?: unknown,
  ) {
    super(message);
    this.name = 'ReferenceDocumentByteRestoreError';
    this.code = code;
    this.causeValue = causeValue;
  }
}

/**
 * Restores a missing reference-document file only after checking the cloud
 * bytes against the record's immutable size/hash, then verifies the saved
 * app-owned copy a second time before returning it to the caller.
 */
export async function restoreVerifiedReferenceDocumentBytes(
  input: ReferenceDocumentByteRestoreInput,
  dependencies: ReferenceDocumentByteRestoreDependencies,
): Promise<ReferenceDocumentByteRestoreResult> {
  const documentId = requireIdentity(input.documentId);
  const storagePath = requireSafeStoragePath(input.storagePath);
  const expectedSizeBytes = requireSize(input.expectedSizeBytes);
  const expectedSha256 = requireSha256(input.expectedSha256);
  const bucket = requireBucket(input.bucket || REFERENCE_DOCUMENT_RESTORE_BUCKET);

  let downloaded: Uint8Array;
  try {
    downloaded = await dependencies.downloadBytes(bucket, storagePath);
  } catch (error) {
    throw new ReferenceDocumentByteRestoreError(
      'download_failed',
      'The reference document could not be downloaded from protected storage.',
      error,
    );
  }

  const downloadedSha256 = normalizeObservedSha(
    await dependencies.sha256(downloaded),
  );
  if (
    downloaded.byteLength !== expectedSizeBytes ||
    downloadedSha256 !== expectedSha256
  ) {
    throw new ReferenceDocumentByteRestoreError(
      'download_integrity_mismatch',
      'The downloaded reference document does not match its saved size and checksum.',
    );
  }

  let destination = '';
  try {
    destination = await dependencies.createOwnedDestination(
      documentId,
      safeOriginalFileName(input.originalFileName),
    );
    await dependencies.writeBytes(destination, downloaded);
  } catch (error) {
    if (destination) await bestEffortDelete(destination, dependencies);
    throw new ReferenceDocumentByteRestoreError(
      'write_failed',
      'The verified reference document could not be saved to app-owned storage.',
      error,
    );
  }

  try {
    const saved = await dependencies.readBytes(destination);
    const savedSha256 = normalizeObservedSha(await dependencies.sha256(saved));
    if (
      saved.byteLength !== expectedSizeBytes ||
      savedSha256 !== expectedSha256
    ) {
      await bestEffortDelete(destination, dependencies);
      throw new ReferenceDocumentByteRestoreError(
        'saved_integrity_mismatch',
        'The restored reference document failed its post-write integrity check.',
      );
    }
  } catch (error) {
    if (error instanceof ReferenceDocumentByteRestoreError) throw error;
    await bestEffortDelete(destination, dependencies);
    throw new ReferenceDocumentByteRestoreError(
      'saved_integrity_mismatch',
      'The restored reference document could not be verified after it was saved.',
      error,
    );
  }

  return Object.freeze({
    documentId,
    uri: destination,
    bucket,
    storagePath,
    sizeBytes: expectedSizeBytes,
    sha256: expectedSha256,
  });
}

function requireIdentity(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || /[/\\\0]/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new ReferenceDocumentByteRestoreError(
      'invalid_identity',
      'The reference document identity is missing or unsafe.',
    );
  }
  return normalized;
}

function requireBucket(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new ReferenceDocumentByteRestoreError(
      'invalid_storage_path',
      'The protected document bucket is missing or unsafe.',
    );
  }
  return normalized;
}

function requireSafeStoragePath(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  let decoded = normalized;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw unsafePathError();
  }
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    decoded.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    throw unsafePathError();
  }
  return normalized;
}

function unsafePathError(): ReferenceDocumentByteRestoreError {
  return new ReferenceDocumentByteRestoreError(
    'invalid_storage_path',
    'The reference document storage path is missing or unsafe.',
  );
}

function requireSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ReferenceDocumentByteRestoreError(
      'missing_integrity_metadata',
      'A positive saved byte count is required before restoring a reference document.',
    );
  }
  return value as number;
}

function requireSha256(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ReferenceDocumentByteRestoreError(
      'missing_integrity_metadata',
      'A canonical SHA-256 checksum is required before restoring a reference document.',
    );
  }
  return normalized;
}

function normalizeObservedSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function safeOriginalFileName(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const basename = normalized.split(/[\\/]/).pop() || 'reference-document';
  return basename.replace(/[^a-zA-Z0-9._-]/g, '-') || 'reference-document';
}

async function bestEffortDelete(
  uri: string,
  dependencies: ReferenceDocumentByteRestoreDependencies,
): Promise<void> {
  try {
    await dependencies.deleteFile(uri);
  } catch {
    // The original verification error remains authoritative.
  }
}
