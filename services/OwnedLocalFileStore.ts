import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
  generateOwnedLocalFileBasename,
  isOwnedLocalFileReadDeleteAuthorized,
  parseOwnedLocalFileManifest,
  resolveOwnedLocalFilePath,
  type OwnedLocalFileKind,
  type OwnedLocalFileManifestRecord,
} from './OwnedLocalFileRepository';
import {
  FileSizePreflightError,
  preflightLocalFileRead,
} from './FileSizePreflight';

export type OwnedLocalFileStat = Readonly<{
  exists: boolean;
  sizeBytes: number | null;
}>;

/**
 * Native I/O and cryptography are injected so the ownership policy can be
 * failure-tested without granting tests or callers direct filesystem access.
 */
export type OwnedLocalFileStoreDependencies = Readonly<{
  generateOpaqueFileId: () => string;
  ensureDirectory: (directoryUri: string) => Promise<void>;
  copyFile: (sourceUri: string, destinationUri: string) => Promise<void>;
  readBytes: (fileUri: string) => Promise<Uint8Array>;
  hashFile?: (
    fileUri: string,
    maxBytes?: number,
  ) => Promise<Readonly<{ sha256: string; sizeBytes: number }>>;
  statFile: (fileUri: string) => Promise<OwnedLocalFileStat>;
  deleteFile: (fileUri: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => Promise<string>;
}>;

export type OwnedLocalFileStoreErrorCode =
  | 'invalid_request'
  | 'source_unreadable'
  | 'source_too_large'
  | 'destination_collision'
  | 'copy_failed'
  | 'manifest_invalid'
  | 'manifest_member_missing'
  | 'authorization_denied'
  | 'file_missing'
  | 'integrity_mismatch'
  | 'read_failed'
  | 'delete_failed'
  | 'cleanup_failed';

export type OwnedLocalFileRecoveryState =
  | 'none'
  | 'retryable'
  | 'restore_or_reselect'
  | 'manual_cleanup_required';

export class OwnedLocalFileStoreError extends Error {
  readonly code: OwnedLocalFileStoreErrorCode;
  readonly recoveryState: OwnedLocalFileRecoveryState;
  readonly cleanupRequired: boolean;
  readonly cause: unknown;

  constructor({
    code,
    message,
    recoveryState = 'none',
    cleanupRequired = false,
    cause,
  }: {
    code: OwnedLocalFileStoreErrorCode;
    message: string;
    recoveryState?: OwnedLocalFileRecoveryState;
    cleanupRequired?: boolean;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'OwnedLocalFileStoreError';
    this.code = code;
    this.recoveryState = recoveryState;
    this.cleanupRequired = cleanupRequired;
    this.cause = cause;
  }
}

export type StoreExternalOwnedFileInput = Readonly<{
  sourceUri: string;
  kind: OwnedLocalFileKind;
  extension: string;
  mimeType: string;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
}>;

export type AuthorizedOwnedLocalFileInput = Readonly<{
  manifest: unknown;
  fileId: string;
  candidatePath: string;
  expectedKind?: OwnedLocalFileKind;
}>;

export type OwnedLocalFileDeleteResult = Readonly<{
  fileId: string;
  deleted: true;
}>;

export type OwnedLocalFileStore = Readonly<{
  storeExternalFile: (
    input: StoreExternalOwnedFileInput,
  ) => Promise<OwnedLocalFileManifestRecord>;
  readAuthorizedFile: (
    input: AuthorizedOwnedLocalFileInput,
  ) => Promise<Uint8Array>;
  verifyAuthorizedFile: (
    input: AuthorizedOwnedLocalFileInput,
  ) => Promise<OwnedLocalFileManifestRecord>;
  deleteAuthorizedFile: (
    input: AuthorizedOwnedLocalFileInput,
  ) => Promise<OwnedLocalFileDeleteResult>;
}>;

type AuthorizedFile = Readonly<{
  record: OwnedLocalFileManifestRecord;
  path: string;
}>;

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

/**
 * Creates a store scoped to one app-owned root. No public method accepts a
 * destination for new files; the destination is always generated internally.
 */
export function createOwnedLocalFileStore({
  ownedRoot,
  dependencies,
}: {
  ownedRoot: string;
  dependencies: OwnedLocalFileStoreDependencies;
}): OwnedLocalFileStore {
  if (typeof ownedRoot !== 'string' || ownedRoot.length === 0) {
    throw storeError(
      'invalid_request',
      'Owned local file store requires a non-empty owned root.',
    );
  }

  async function storeExternalFile(
    input: StoreExternalOwnedFileInput,
  ): Promise<OwnedLocalFileManifestRecord> {
    assertExternalSourceUri(input.sourceUri);

    const sourcePreflight = await preflightExternalSource(
      input.sourceUri,
      input.reportedSizeBytes,
      input.maxBytes,
      dependencies,
    );
    const sourceIntegrity = await hashSourceFile(
      input.sourceUri,
      sourcePreflight.maxBytes,
      dependencies,
    );
    if (sourceIntegrity.sizeBytes !== sourcePreflight.sizeBytes) {
      throw storeError(
        'source_unreadable',
        'The selected file changed before it could be saved. Choose it again and retry.',
        'restore_or_reselect',
      );
    }

    let record: OwnedLocalFileManifestRecord;
    try {
      const fileId = dependencies.generateOpaqueFileId();
      const generatedBasename = generateOwnedLocalFileBasename(fileId, input.extension);
      record = createOwnedLocalFileManifestRecord({
        fileId,
        kind: input.kind,
        generatedBasename,
        sha256: sourceIntegrity.sha256,
        sizeBytes: sourceIntegrity.sizeBytes,
        mimeType: input.mimeType,
        relativePath: generatedBasename,
      });
    } catch (cause) {
      throw storeError(
        'invalid_request',
        'The owned file identity or metadata is invalid.',
        'none',
        cause,
      );
    }

    const manifest = createOwnedLocalFileManifest([record]);
    let destinationPath: string;

    try {
      destinationPath = resolveOwnedLocalFilePath({
        ownedRoot,
        manifest,
        fileId: record.fileId,
        expectedKind: record.kind,
      });
      await dependencies.ensureDirectory(ownedRoot);
    } catch (cause) {
      throw storeError(
        'copy_failed',
        'The app-owned file directory is unavailable.',
        'retryable',
        cause,
      );
    }

    const existingDestination = await statForCopy(destinationPath, dependencies);
    if (existingDestination.exists) {
      throw storeError(
        'destination_collision',
        'A generated owned file destination already exists.',
        'retryable',
      );
    }

    try {
      await dependencies.copyFile(input.sourceUri, destinationPath);
    } catch (cause) {
      const copyError = storeError(
        'copy_failed',
        'The selected file could not be copied into app-owned storage.',
        'retryable',
        cause,
      );
      await throwAfterFailedCopyCleanup({
        originalError: copyError,
        manifest,
        record,
        destinationPath,
        ownedRoot,
        dependencies,
      });
    }

    try {
      await verifyFileIntegrity(
        { record, path: destinationPath },
        dependencies,
      );
    } catch (cause) {
      const verificationError = cause instanceof OwnedLocalFileStoreError
        ? cause
        : storeError(
            'integrity_mismatch',
            'The app-owned copy could not be verified.',
            'retryable',
            cause,
          );
      await throwAfterFailedCopyCleanup({
        originalError: verificationError,
        manifest,
        record,
        destinationPath,
        ownedRoot,
        dependencies,
      });
    }

    return record;
  }

  async function readAuthorizedFile(
    input: AuthorizedOwnedLocalFileInput,
  ): Promise<Uint8Array> {
    const authorized = authorizeOwnedFile(input, ownedRoot);
    return readVerifiedFile(authorized, dependencies);
  }

  async function verifyAuthorizedFile(
    input: AuthorizedOwnedLocalFileInput,
  ): Promise<OwnedLocalFileManifestRecord> {
    const authorized = authorizeOwnedFile(input, ownedRoot);
    await verifyFileIntegrity(authorized, dependencies);
    return authorized.record;
  }

  async function deleteAuthorizedFile(
    input: AuthorizedOwnedLocalFileInput,
  ): Promise<OwnedLocalFileDeleteResult> {
    const authorized = authorizeOwnedFile(input, ownedRoot);

    // Verify the manifest-bound bytes immediately before deletion. A file that
    // was replaced at the same path is not treated as the owned object.
    await verifyFileIntegrity(authorized, dependencies);

    try {
      await dependencies.deleteFile(authorized.path);
      const afterDelete = await dependencies.statFile(authorized.path);
      if (afterDelete.exists) {
        throw new Error('Owned file still exists after delete completed.');
      }
    } catch (cause) {
      throw storeError(
        'delete_failed',
        'The authorized owned file could not be deleted.',
        'retryable',
        cause,
      );
    }

    return Object.freeze({
      fileId: authorized.record.fileId,
      deleted: true as const,
    });
  }

  return Object.freeze({
    storeExternalFile,
    readAuthorizedFile,
    verifyAuthorizedFile,
    deleteAuthorizedFile,
  });
}

async function preflightExternalSource(
  sourceUri: string,
  reportedSizeBytes: number | null | undefined,
  maxBytes: number | undefined,
  dependencies: OwnedLocalFileStoreDependencies,
) {
  try {
    return await preflightLocalFileRead({
      uri: sourceUri,
      reportedSizeBytes,
      maxBytes,
      statFile: dependencies.statFile,
    });
  } catch (cause) {
    if (cause instanceof FileSizePreflightError) {
      throw storeError(
        cause.code === 'file_too_large' ? 'source_too_large' : 'source_unreadable',
        cause.message,
        'restore_or_reselect',
        cause,
      );
    }
    throw cause;
  }
}

function authorizeOwnedFile(
  input: AuthorizedOwnedLocalFileInput,
  ownedRoot: string,
): AuthorizedFile {
  let manifest;
  try {
    manifest = parseOwnedLocalFileManifest(input.manifest);
  } catch (cause) {
    throw storeError(
      'manifest_invalid',
      'Owned local file manifest is missing or corrupt.',
      'restore_or_reselect',
      cause,
    );
  }

  const record = manifest.files[input.fileId];
  if (record === undefined) {
    throw storeError(
      'manifest_member_missing',
      'The requested file is not recorded in the owned-file manifest.',
      'restore_or_reselect',
    );
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveOwnedLocalFilePath({
      ownedRoot,
      manifest,
      fileId: input.fileId,
      expectedKind: input.expectedKind,
    });
  } catch (cause) {
    throw storeError(
      'authorization_denied',
      'The requested file is not authorized for this owned-file operation.',
      'none',
      cause,
    );
  }

  if (
    typeof input.candidatePath !== 'string' ||
    input.candidatePath !== resolvedPath ||
    !isOwnedLocalFileReadDeleteAuthorized({
      ownedRoot,
      manifest,
      fileId: input.fileId,
      expectedKind: input.expectedKind,
      candidatePath: input.candidatePath,
    })
  ) {
    throw storeError(
      'authorization_denied',
      'The candidate path does not exactly match the authorized owned file.',
    );
  }

  return Object.freeze({ record, path: resolvedPath });
}

async function readVerifiedFile(
  authorized: AuthorizedFile,
  dependencies: OwnedLocalFileStoreDependencies,
): Promise<Uint8Array> {
  let beforeRead: OwnedLocalFileStat;
  try {
    beforeRead = await dependencies.statFile(authorized.path);
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The authorized owned file could not be inspected.',
      'retryable',
      cause,
    );
  }

  if (!beforeRead.exists) {
    throw storeError(
      'file_missing',
      'The manifest-owned file is missing from local storage.',
      'restore_or_reselect',
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readBytes(authorized.path);
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The manifest-owned file could not be read.',
      'retryable',
      cause,
    );
  }

  if (!(bytes instanceof Uint8Array)) {
    throw storeError(
      'read_failed',
      'The manifest-owned file returned an invalid byte payload.',
      'retryable',
    );
  }

  const observedSha256 = await hashBytes(
    bytes,
    dependencies,
    'read_failed',
    'The manifest-owned file could not be hashed.',
  );

  let afterRead: OwnedLocalFileStat;
  try {
    afterRead = await dependencies.statFile(authorized.path);
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The manifest-owned file could not be re-inspected.',
      'retryable',
      cause,
    );
  }

  if (!afterRead.exists) {
    throw storeError(
      'file_missing',
      'The manifest-owned file disappeared during verification.',
      'restore_or_reselect',
    );
  }

  if (
    beforeRead.sizeBytes === null ||
    afterRead.sizeBytes === null ||
    beforeRead.sizeBytes !== authorized.record.sizeBytes ||
    afterRead.sizeBytes !== authorized.record.sizeBytes ||
    bytes.byteLength !== authorized.record.sizeBytes ||
    observedSha256 !== authorized.record.sha256
  ) {
    throw storeError(
      'integrity_mismatch',
      'The manifest-owned file does not match its recorded size and SHA-256.',
      'restore_or_reselect',
    );
  }

  return bytes;
}

async function verifyFileIntegrity(
  authorized: AuthorizedFile,
  dependencies: OwnedLocalFileStoreDependencies,
): Promise<void> {
  if (!dependencies.hashFile) {
    await readVerifiedFile(authorized, dependencies);
    return;
  }

  let beforeRead: OwnedLocalFileStat;
  try {
    beforeRead = await dependencies.statFile(authorized.path);
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The authorized owned file could not be inspected.',
      'retryable',
      cause,
    );
  }
  if (!beforeRead.exists) {
    throw storeError(
      'file_missing',
      'The manifest-owned file is missing from local storage.',
      'restore_or_reselect',
    );
  }

  let integrity: Readonly<{ sha256: string; sizeBytes: number }>;
  try {
    integrity = await dependencies.hashFile(
      authorized.path,
      authorized.record.sizeBytes,
    );
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The manifest-owned file could not be hashed.',
      'retryable',
      cause,
    );
  }

  let afterRead: OwnedLocalFileStat;
  try {
    afterRead = await dependencies.statFile(authorized.path);
  } catch (cause) {
    throw storeError(
      'read_failed',
      'The manifest-owned file could not be re-inspected.',
      'retryable',
      cause,
    );
  }

  if (!afterRead.exists) {
    throw storeError(
      'file_missing',
      'The manifest-owned file disappeared during verification.',
      'restore_or_reselect',
    );
  }
  if (
    beforeRead.sizeBytes === null ||
    afterRead.sizeBytes === null ||
    beforeRead.sizeBytes !== authorized.record.sizeBytes ||
    afterRead.sizeBytes !== authorized.record.sizeBytes ||
    integrity.sizeBytes !== authorized.record.sizeBytes ||
    integrity.sha256 !== authorized.record.sha256
  ) {
    throw storeError(
      'integrity_mismatch',
      'The manifest-owned file does not match its recorded size and SHA-256.',
      'restore_or_reselect',
    );
  }
}

async function hashSourceFile(
  sourceUri: string,
  maxBytes: number,
  dependencies: OwnedLocalFileStoreDependencies,
): Promise<Readonly<{ sha256: string; sizeBytes: number }>> {
  if (dependencies.hashFile) {
    try {
      return await dependencies.hashFile(sourceUri, maxBytes);
    } catch (cause) {
      throw storeError(
        'source_unreadable',
        'The selected source file could not be hashed.',
        'restore_or_reselect',
        cause,
      );
    }
  }

  const sourceBytes = await readSourceBytes(sourceUri, dependencies);
  const sourceSha256 = await hashBytes(
    sourceBytes,
    dependencies,
    'source_unreadable',
    'The selected source file could not be hashed.',
  );
  return Object.freeze({
    sha256: sourceSha256,
    sizeBytes: sourceBytes.byteLength,
  });
}

async function readSourceBytes(
  sourceUri: string,
  dependencies: OwnedLocalFileStoreDependencies,
): Promise<Uint8Array> {
  try {
    const bytes = await dependencies.readBytes(sourceUri);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error('Selected source file is empty or unreadable.');
    }
    return bytes;
  } catch (cause) {
    throw storeError(
      'source_unreadable',
      'The selected source file is missing, empty, or unreadable.',
      'restore_or_reselect',
      cause,
    );
  }
}

async function hashBytes(
  bytes: Uint8Array,
  dependencies: OwnedLocalFileStoreDependencies,
  errorCode: 'source_unreadable' | 'read_failed',
  message: string,
): Promise<string> {
  try {
    return await dependencies.sha256(bytes);
  } catch (cause) {
    throw storeError(errorCode, message, 'retryable', cause);
  }
}

async function statForCopy(
  destinationPath: string,
  dependencies: OwnedLocalFileStoreDependencies,
): Promise<OwnedLocalFileStat> {
  try {
    return await dependencies.statFile(destinationPath);
  } catch (cause) {
    throw storeError(
      'copy_failed',
      'The generated owned-file destination could not be inspected.',
      'retryable',
      cause,
    );
  }
}

async function throwAfterFailedCopyCleanup({
  originalError,
  manifest,
  record,
  destinationPath,
  ownedRoot,
  dependencies,
}: {
  originalError: OwnedLocalFileStoreError;
  manifest: unknown;
  record: OwnedLocalFileManifestRecord;
  destinationPath: string;
  ownedRoot: string;
  dependencies: OwnedLocalFileStoreDependencies;
}): Promise<never> {
  try {
    if (!isOwnedLocalFileReadDeleteAuthorized({
      ownedRoot,
      manifest,
      fileId: record.fileId,
      expectedKind: record.kind,
      candidatePath: destinationPath,
    })) {
      throw new Error('Failed-copy cleanup path was not manifest-authorized.');
    }

    const partial = await dependencies.statFile(destinationPath);
    if (partial.exists) {
      await dependencies.deleteFile(destinationPath);
      const afterDelete = await dependencies.statFile(destinationPath);
      if (afterDelete.exists) {
        throw new Error('Partial owned file still exists after cleanup.');
      }
    }
  } catch (cleanupCause) {
    throw storeError(
      'cleanup_failed',
      'A failed owned-file copy requires manual cleanup before retry.',
      'manual_cleanup_required',
      { originalError, cleanupCause },
      true,
    );
  }

  throw originalError;
}

function assertExternalSourceUri(sourceUri: unknown): asserts sourceUri is string {
  if (
    typeof sourceUri !== 'string' ||
    sourceUri.trim().length === 0 ||
    sourceUri.length > 8_192 ||
    CONTROL_CHARACTER_RE.test(sourceUri)
  ) {
    throw storeError(
      'invalid_request',
      'External source URI must be a non-empty local provider URI.',
    );
  }
}

function storeError(
  code: OwnedLocalFileStoreErrorCode,
  message: string,
  recoveryState: OwnedLocalFileRecoveryState = 'none',
  cause?: unknown,
  cleanupRequired = false,
) {
  return new OwnedLocalFileStoreError({
    code,
    message,
    recoveryState,
    cleanupRequired,
    cause,
  });
}
