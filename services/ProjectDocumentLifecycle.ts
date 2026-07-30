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
import { MAX_PROJECT_DOCUMENT_FILE_BYTES } from './FileSizePreflight';
import type { ReferenceDocument } from '../types';
import type { ProjectDocumentCategory } from './ProjectDocumentClassification';

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

type SharedProjectDocumentSource = Readonly<{
  id: string;
  referenceDocumentId?: string | null;
  projectId: string;
  name: string;
  category: ProjectDocumentCategory;
  mimeType?: string | null;
  sizeBytes?: number | null;
  storagePath?: string | null;
  note?: string | null;
  importedAt: string;
  drawingNumber?: string | null;
  drawingRevision?: string | null;
  drawingDiscipline?: string | null;
  drawingStatus?: ReferenceDocument['drawingStatus'];
  drawingIssuedAt?: string | null;
}>;

type DownloadableProjectDocumentSource = Readonly<{
  id: string;
  referenceDocumentId?: string | null;
  projectId: string;
  storagePath?: string | null;
}>;

/**
 * Finds the shared cloud record that owns an uploaded project document.
 *
 * Local project-document records contain device-specific manifest paths that
 * legitimately stop working after an app reinstall or on another device. The
 * shared reference record is the cross-device authority for downloading the
 * protected bytes again. Prefer the explicit bridge ID, then the stable ID,
 * and use the protected storage path only as a final exact-match fallback.
 */
export function findSharedReferenceDocumentForProjectDocument(
  document: DownloadableProjectDocumentSource,
  referenceDocuments: readonly ReferenceDocument[],
): ReferenceDocument | null {
  const projectId = document.projectId.trim();
  const belongsToProject = (candidate: ReferenceDocument) =>
    !candidate.projectId || candidate.projectId === projectId;
  const referenceDocumentId = document.referenceDocumentId?.trim();

  if (referenceDocumentId) {
    const explicit = referenceDocuments.find(candidate =>
      candidate.id === referenceDocumentId && belongsToProject(candidate),
    );
    if (explicit) return explicit;
  }

  const stableIdentity = referenceDocuments.find(candidate =>
    candidate.id === document.id && belongsToProject(candidate),
  );
  if (stableIdentity) return stableIdentity;

  const storagePath = document.storagePath?.trim();
  if (!storagePath) return null;

  return referenceDocuments.find(candidate =>
    candidate.storagePath === storagePath && belongsToProject(candidate),
  ) || null;
}

export function referenceCategoryForProjectDocument(
  category: ProjectDocumentCategory,
): string {
  return category === 'Schedule' ? 'Schedules' : category;
}

/**
 * Produces the cloud-visible metadata record for bytes already stored in the
 * protected project-document bucket. The project-document ID is reused unless
 * an earlier bridge ID exists, making upload retries idempotent.
 */
export function buildSharedReferenceDocument({
  document,
  projectName,
  contentSha256,
  updatedAt = new Date().toISOString(),
}: Readonly<{
  document: SharedProjectDocumentSource;
  projectName: string | null;
  contentSha256: string | null;
  updatedAt?: string;
}>): ReferenceDocument {
  return Object.freeze({
    id: document.referenceDocumentId || document.id,
    name: document.name.replace(/\.[^/.]+$/, '') || document.name,
    originalFileName: document.name,
    uri: '',
    mimeType: document.mimeType || null,
    category: referenceCategoryForProjectDocument(document.category),
    notes: document.note || '',
    // A schedule becomes authoritative only through the explicit
    // "Make Current" workflow. Uploading bytes alone must not supersede it.
    isCurrent: false,
    importedAt: document.importedAt,
    projectId: document.projectId,
    projectName,
    projectNames: projectName ? [projectName] : [],
    importBatchId: null,
    storagePath: document.storagePath || null,
    sizeBytes: document.sizeBytes || null,
    contentSha256,
    updatedAt,
    cloudUpdatedAt: null,
    webFileFingerprint: null,
    webVersionGroupId: null,
    webContentReview: null,
    webReport: null,
    drawingNumber: document.drawingNumber || null,
    drawingRevision: document.drawingRevision || null,
    drawingDiscipline: document.drawingDiscipline || null,
    drawingStatus: document.drawingStatus || null,
    drawingIssuedAt: document.drawingIssuedAt || null,
  });
}

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
  maxBytes = MAX_PROJECT_DOCUMENT_FILE_BYTES,
  dependencies = createExpoSdk54OwnedLocalFileStoreDependencies(),
}: Readonly<{
  sourceUri: string;
  ownedRoot: string;
  extension?: string;
  fileName?: string | null;
  mimeType: string;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
  dependencies?: OwnedLocalFileStoreDependencies;
}>): Promise<ImportedOwnedProjectDocument> {
  const store = createOwnedLocalFileStore({ ownedRoot, dependencies });
  const record = await store.storeExternalFile({
    sourceUri,
    kind: 'project_document',
    extension: extension || ownedProjectDocumentExtension(fileName, mimeType),
    mimeType,
    reportedSizeBytes,
    maxBytes,
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
