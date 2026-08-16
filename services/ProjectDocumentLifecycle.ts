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
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import type { ReferenceDocument } from '../types';
import {
  PROJECT_DOCUMENT_CATEGORIES,
  suggestProjectDocumentCategory,
  type ProjectDocumentCategory,
} from './ProjectDocumentClassification';

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
  webVersionGroupId?: string | null;
}>;

type DownloadableProjectDocumentSource = Readonly<{
  id: string;
  referenceDocumentId?: string | null;
  projectId: string;
  storagePath?: string | null;
}>;

export type ProjectDocumentWorkspaceRecord = {
  id: string;
  projectId: string;
  areaId?: string | null;
  updateId?: string | null;
  name: string;
  category: ProjectDocumentCategory;
  mimeType?: string | null;
  sizeBytes?: number | null;
  localUri?: string | null;
  ownedFileId?: string | null;
  ownedFileManifest?: unknown;
  referenceDocumentId?: string | null;
  storagePath?: string | null;
  uploadedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  archivedAt?: string | null;
  isArchived?: boolean;
  isCurrent?: boolean;
  duplicateOf?: string | null;
  uploadAttemptCount?: number;
  lastUploadAttemptAt?: string | null;
  uploadProgress?: number | null;
  importedAt: string;
  drawingNumber?: string | null;
  drawingRevision?: string | null;
  drawingDiscipline?: string | null;
  drawingStatus?: ReferenceDocument['drawingStatus'];
  drawingIssuedAt?: string | null;
  webVersionGroupId?: string | null;
  /** True when this device is rendering the shared record without a local attachment cache. */
  sharedReferenceOnly?: boolean;
};

function projectDocumentCategoryForReference(
  document: Pick<ReferenceDocument, 'category' | 'name' | 'mimeType'>,
): ProjectDocumentCategory {
  const canonical = canonicalReferenceCategory(document);
  if (canonical === 'schedule') return 'Schedule';
  if (canonical === 'drawing') return 'Drawing';

  const exact = PROJECT_DOCUMENT_CATEGORIES.find(category =>
    category.toLocaleLowerCase() === canonical,
  );
  if (exact) return exact;

  if (canonical === 'permit' || canonical === 'permits') return 'Permit Card';
  if (canonical === 'rfi') return 'RFI / Field Decision';
  if (canonical === 'submittal') return 'Vendor Document';

  return suggestProjectDocumentCategory({
    name: `${document.category || ''} ${document.name || ''}`,
    mimeType: document.mimeType,
  });
}

function sharedReferenceWorkspaceRecord(
  document: ReferenceDocument & { projectId: string },
): ProjectDocumentWorkspaceRecord {
  const importedAt = document.importedAt || document.updatedAt ||
    document.cloudUpdatedAt || '1970-01-01T00:00:00.000Z';
  const updatedAt = document.cloudUpdatedAt || document.updatedAt || importedAt;
  return {
    id: document.id,
    projectId: document.projectId,
    areaId: null,
    updateId: null,
    name: document.originalFileName || document.name,
    category: projectDocumentCategoryForReference(document),
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    localUri: null,
    ownedFileId: null,
    ownedFileManifest: null,
    referenceDocumentId: document.id,
    storagePath: document.storagePath,
    uploadedAt: updatedAt,
    createdAt: importedAt,
    updatedAt,
    note: document.notes,
    status: 'uploaded',
    isArchived: false,
    isCurrent: document.isCurrent,
    importedAt,
    drawingNumber: document.drawingNumber,
    drawingRevision: document.drawingRevision,
    drawingDiscipline: document.drawingDiscipline,
    drawingStatus: document.drawingStatus,
    drawingIssuedAt: document.drawingIssuedAt,
    webVersionGroupId: document.webVersionGroupId,
    sharedReferenceOnly: true,
  };
}

/**
 * Builds the visible document workspace from one exact immutable project ID.
 *
 * Device-local attachment metadata is preferred when present. Shared cloud
 * reference records fill the gap on a fresh browser/device, without allowing
 * display-name fallback or unbound/multi-project records into the workspace.
 */
export function projectDocumentsForExactWorkspace({
  projectId,
  projectDocuments,
  referenceDocuments,
}: Readonly<{
  projectId: string | null | undefined;
  projectDocuments: readonly ProjectDocumentWorkspaceRecord[];
  referenceDocuments: readonly ReferenceDocument[];
}>): ProjectDocumentWorkspaceRecord[] {
  const exactProjectId = typeof projectId === 'string' && projectId.length > 0 &&
    projectId.trim() === projectId
    ? projectId
    : null;
  if (!exactProjectId) return [];

  const localDocuments = projectDocuments.filter(document =>
    !document.isArchived && document.projectId === exactProjectId,
  );
  const exactReferences = referenceDocuments.filter(
    (document): document is ReferenceDocument & { projectId: string } =>
      document.projectId === exactProjectId,
  );
  const representedReferenceIds = new Set(
    localDocuments.flatMap(document => {
      const shared = findSharedReferenceDocumentForProjectDocument(
        document,
        exactReferences,
      );
      return shared ? [shared.id] : [];
    }),
  );

  return [
    ...localDocuments,
    ...exactReferences
      .filter(document => !representedReferenceIds.has(document.id))
      .map(sharedReferenceWorkspaceRecord),
  ];
}

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
    // An uploaded document becomes authoritative only through the explicit
    // "Make Current" workflow. Uploading bytes alone must not supersede the
    // current schedule or drawing revision.
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
    webVersionGroupId: document.webVersionGroupId || null,
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
 * Mirrors later mobile metadata edits into the shared ECOS authority record.
 * Hosted extraction, evidence, readiness, and current-version fields are
 * intentionally inherited from the existing shared record.
 */
export function synchronizeSharedReferenceDocumentMetadata({
  document,
  sharedDocument,
  projectName,
  updatedAt = new Date().toISOString(),
}: Readonly<{
  document: SharedProjectDocumentSource;
  sharedDocument: ReferenceDocument;
  projectName: string | null;
  updatedAt?: string;
}>): ReferenceDocument {
  const synchronized: ReferenceDocument = {
    ...sharedDocument,
    name: document.name.replace(/\.[^/.]+$/, '') || document.name,
    originalFileName: document.name,
    mimeType: document.mimeType || null,
    category: referenceCategoryForProjectDocument(document.category),
    notes: document.note || '',
    projectId: document.projectId,
    projectName: projectName || sharedDocument.projectName || null,
    projectNames: projectName
      ? [projectName]
      : sharedDocument.projectNames || [],
    storagePath: document.storagePath || sharedDocument.storagePath || null,
    sizeBytes: document.sizeBytes || sharedDocument.sizeBytes || null,
    webVersionGroupId:
      document.webVersionGroupId || sharedDocument.webVersionGroupId || null,
    drawingNumber: document.drawingNumber || null,
    drawingRevision: document.drawingRevision || null,
    drawingDiscipline: document.drawingDiscipline || null,
    drawingStatus: document.drawingStatus || null,
    drawingIssuedAt: document.drawingIssuedAt || null,
    updatedAt,
  };
  return Object.freeze(drawingIdentityChanged(sharedDocument, synchronized)
    ? invalidateReferenceDocumentEvidence(synchronized)
    : synchronized);
}

function drawingIdentityChanged(
  previous: ReferenceDocument,
  next: ReferenceDocument,
) {
  if (
    canonicalReferenceCategory(previous) !== 'drawing' &&
    canonicalReferenceCategory(next) !== 'drawing'
  ) return false;
  const keys: ReadonlyArray<keyof ReferenceDocument> = [
    'projectId',
    'category',
    'webVersionGroupId',
    'drawingNumber',
    'drawingRevision',
    'drawingDiscipline',
    'drawingStatus',
    'drawingIssuedAt',
  ];
  return keys.some(key => cleanIdentity(previous[key]) !== cleanIdentity(next[key]));
}

function cleanIdentity(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function invalidateReferenceDocumentEvidence(
  document: ReferenceDocument,
): ReferenceDocument {
  return {
    ...document,
    isCurrent: false,
    webContentReview: null,
    webReport: null,
    extractedText: null,
    extractionStatus: 'pending',
    extractionMethod: null,
    extractionLimitations: [],
    documentIntelligenceVersion: null,
    documentVisualIndexVersion: null,
    ecosVerifiedIndexCommitVersion: null,
    ecosVerifiedIndexCommittedAt: null,
    ecosVerifiedIndexCommittedSha256: null,
    ecosVerifiedIndexCommittedPageCount: null,
    ecosVerifiedIndexPageGraphSha256: null,
    indexedAt: null,
    sourcePageCount: null,
    searchablePageCount: null,
    ocrPageCount: null,
    extractionAverageConfidence: null,
    indexedContentSha256: null,
    extractedPages: [],
    ecosHostedIndexStatus: null,
    ecosHostedIndexProgressPercent: null,
    ecosHostedIndexCustomerMessage: null,
    ecosHostedIndexLimitationCount: null,
    ecosHostedIndexSupportReference: null,
    ecosHostedIndexEvidenceVersion: null,
    ecosHostedIndexUpdatedAt: null,
  };
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
