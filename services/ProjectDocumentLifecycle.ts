/**
 * Audit P1-23: an upload cannot survive an app relaunch, so any document
 * still marked 'uploading' at startup hydration is a stale in-flight state
 * from a killed process. Left alone it reads as "pending" forever and offers
 * no retry. Recovery converts it to the retryable 'failed' state.
 */

import { createExpoSdk54OwnedLocalFileStoreDependencies } from './ExpoOwnedLocalFileStoreAdapter';
import {
  createOwnedLocalFileStore,
  type OwnedLocalFileStore,
  type OwnedLocalFileStoreDependencies,
} from './OwnedLocalFileStore';
import {
  createOwnedLocalFileManifest,
  isOwnedLocalFileManifestMember,
  resolveOwnedLocalFilePath,
  type OwnedLocalFileManifest,
  type OwnedLocalFileManifestRecord,
} from './OwnedLocalFileRepository';

type UploadLifecycleDocument = {
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  updatedAt: string;
};

/**
 * V2 manifest-owned attachments are isolated from the legacy reference-file
 * directory, whose compatibility delete path authorizes direct children.
 */
export const OWNED_PROJECT_DOCUMENTS_FOLDER = 'project-documents-v2';

export const PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE =
  'This attachment is not in verified app storage and must be added again.';

export function requireOwnedProjectDocumentAccess(document: Readonly<{
  ownedFileId?: string | null;
  ownedFileManifest?: unknown;
  localUri?: string | null;
}>) {
  let manifestMember = false;
  try {
    manifestMember = Boolean(
      document.ownedFileId &&
      document.ownedFileManifest &&
      isOwnedLocalFileManifestMember(
        document.ownedFileManifest,
        document.ownedFileId,
        'project_document',
      ),
    );
  } catch {
    manifestMember = false;
  }
  if (
    !document.ownedFileId ||
    !document.ownedFileManifest ||
    !document.localUri ||
    !manifestMember
  ) {
    throw new Error(PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE);
  }
  return {
    manifest: document.ownedFileManifest,
    fileId: document.ownedFileId,
    candidatePath: document.localUri,
    expectedKind: 'project_document' as const,
  };
}

export function recoverStaleUploadingDocuments<T extends UploadLifecycleDocument>(
  documents: readonly T[],
  now: string = new Date().toISOString(),
): T[] {
  return documents.map(document =>
    document.status === 'uploading'
      ? { ...document, status: 'failed' as const, updatedAt: now }
      : document,
  );
}

export type ImportedOwnedProjectDocument = Readonly<{
  fileId: string;
  localUri: string;
  manifest: OwnedLocalFileManifest;
  record: OwnedLocalFileManifestRecord;
}>;

/**
 * Copies a picked project document into the app-owned persistence boundary
 * before a durable document record is created. Callers persist the returned
 * opaque file ID and manifest; the source picker URI is deliberately omitted.
 */
export async function importProjectDocumentIntoOwnedStorage({
  sourceUri,
  ownedRoot,
  extension,
  fileName,
  mimeType,
  reportedSizeBytes,
  dependencies = createExpoSdk54OwnedLocalFileStoreDependencies(),
}: Readonly<{
  sourceUri: string;
  ownedRoot: string;
  extension?: string;
  fileName?: string | null;
  mimeType: string;
  reportedSizeBytes?: number | null;
  dependencies?: OwnedLocalFileStoreDependencies;
}>): Promise<ImportedOwnedProjectDocument> {
  const store = createOwnedLocalFileStore({ ownedRoot, dependencies });
  const record = await store.storeExternalFile({
    sourceUri,
    kind: 'project_document',
    extension: extension || ownedProjectDocumentExtension(fileName, mimeType),
    mimeType,
    reportedSizeBytes,
  });
  const manifest = createOwnedLocalFileManifest([record]);

  return Object.freeze({
    fileId: record.fileId,
    localUri: resolveOwnedLocalFilePath({
      ownedRoot,
      manifest,
      fileId: record.fileId,
      expectedKind: 'project_document',
    }),
    manifest,
    record,
  });
}

export function ownedProjectDocumentExtension(
  fileName: string | null | undefined,
  mimeType: string,
): string {
  const extension = fileName?.trim().match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase();
  if (extension) return extension;
  if (/pdf/i.test(mimeType)) return 'pdf';
  if (/png/i.test(mimeType)) return 'png';
  if (/jpe?g/i.test(mimeType)) return 'jpg';
  if (/csv/i.test(mimeType)) return 'csv';
  if (/plain/i.test(mimeType)) return 'txt';
  return 'bin';
}

/**
 * Recreates a store for ownership-verified reads and deletes of a persisted
 * project document. The store accepts only exact manifest membership and
 * verifies size/hash immediately before either operation.
 */
export function createProjectDocumentOwnedFileStore({
  ownedRoot,
  dependencies = createExpoSdk54OwnedLocalFileStoreDependencies(),
}: Readonly<{
  ownedRoot: string;
  dependencies?: OwnedLocalFileStoreDependencies;
}>): OwnedLocalFileStore {
  return createOwnedLocalFileStore({ ownedRoot, dependencies });
}

export type ProjectDocumentOwnedFileCleanupResult = Readonly<{
  status: 'deleted' | 'not_recorded' | 'unavailable';
}>;

/**
 * Removing a document record must not be blocked by an unavailable local
 * attachment. Reinstalls legitimately invalidate the previous app-container
 * path. The owned-file boundary still decides whether bytes may be deleted;
 * an unverified path is left untouched while the caller removes the record.
 */
export async function cleanupProjectDocumentOwnedFileForRecordRemoval({
  document,
  ownedRoot,
  dependencies = createExpoSdk54OwnedLocalFileStoreDependencies(),
}: Readonly<{
  document: Readonly<{
    ownedFileId?: string | null;
    ownedFileManifest?: unknown;
    localUri?: string | null;
  }>;
  ownedRoot: string;
  dependencies?: OwnedLocalFileStoreDependencies;
}>): Promise<ProjectDocumentOwnedFileCleanupResult> {
  if (!document.ownedFileId || !document.ownedFileManifest || !document.localUri) {
    return Object.freeze({ status: 'not_recorded' });
  }

  try {
    const store = createProjectDocumentOwnedFileStore({ ownedRoot, dependencies });
    await store.deleteAuthorizedFile(requireOwnedProjectDocumentAccess(document));
    return Object.freeze({ status: 'deleted' });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  }
}
