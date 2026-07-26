import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { ReferenceDocument } from '../types';
import { createProjectId } from './ProjectIdentity';
import { reconcileCurrentScheduleDocuments } from './PIEScheduleReconciliation';
import { isStartupReferenceDocumentRecord } from './StartupRecordValidation';
import { uploadPhoto } from './SupabaseService';
import {
  isLegacyOwnedLocalFileReadDeleteAuthorized,
  resolveLegacyOwnedLocalFilePath,
} from './OwnedLocalFileRepository';

const REFERENCE_DOCUMENT_CATEGORIES = new Set([
  'Plans', 'Specifications', 'Permits', 'Inspection', 'Safety', 'Quality',
  'Contract', 'Change Order', 'RFI', 'Submittal', 'Environmental',
  'Electrical', 'Mechanical', 'Schedules', 'Report', 'Other',
]);
const REFERENCE_DOCUMENTS_FOLDER = 'project-documents';
const REFERENCE_DOCUMENTS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${REFERENCE_DOCUMENTS_FOLDER}/`
  : null;
const REFERENCE_DOCUMENT_BUCKET = 'project-documents';

export function resolveReferenceDocumentUri(uri: string) {
  if (!REFERENCE_DOCUMENTS_DIR || !uri) return '';
  return resolveLegacyOwnedLocalFilePath({
    ownedRoot: REFERENCE_DOCUMENTS_DIR,
    legacyFolderName: REFERENCE_DOCUMENTS_FOLDER,
    candidatePath: uri,
  }) || '';
}

export function normalizeReferenceDocument(
  value: Partial<ReferenceDocument>,
): ReferenceDocument {
  const category = stringOrNull(value.category) || 'Other';
  const importedAt = typeof value.importedAt === 'string'
    ? value.importedAt
    : new Date().toISOString();
  return {
    id: stringOrNull(value.id) || createProjectId(),
    name: stringOrNull(value.name) || stringOrNull(value.originalFileName) || 'Reference Document',
    originalFileName: stringOrNull(value.originalFileName) || 'reference-document',
    uri: typeof value.uri === 'string' ? resolveReferenceDocumentUri(value.uri) : '',
    mimeType: stringOrNull(value.mimeType),
    category: REFERENCE_DOCUMENT_CATEGORIES.has(category) ? category : 'Other',
    notes: typeof value.notes === 'string' ? value.notes : '',
    isCurrent: Boolean(value.isCurrent),
    importedAt,
    projectId: stringOrNull(value.projectId),
    projectName: stringOrNull(value.projectName),
    projectNames: Array.isArray(value.projectNames)
      ? value.projectNames.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
      : [],
    importBatchId: stringOrNull(value.importBatchId),
    storagePath: stringOrNull(value.storagePath),
    sizeBytes: finiteNumberOrNull(value.sizeBytes),
    contentSha256:
      canonicalSha256(value.contentSha256) ||
      canonicalSha256(value.webFileFingerprint),
    updatedAt: stringOrNull(value.updatedAt) || importedAt,
    cloudUpdatedAt: stringOrNull(value.cloudUpdatedAt),
    webFileFingerprint: stringOrNull(value.webFileFingerprint),
    webVersionGroupId: stringOrNull(value.webVersionGroupId),
    webContentReview: stringOrNull(value.webContentReview),
    webReport: isRecord(value.webReport) ? value.webReport : null,
  };
}

export function normalizeReferenceDocuments(value: unknown): ReferenceDocument[] {
  if (!Array.isArray(value)) return [];
  return reconcileCurrentScheduleDocuments(value
    .filter(isStartupReferenceDocumentRecord)
    .map(item => normalizeReferenceDocument(item as Partial<ReferenceDocument>)));
}

export async function ensureReferenceDocumentsDirectory() {
  if (!REFERENCE_DOCUMENTS_DIR) throw new Error('Reference document storage is unavailable.');
  const info = await FileSystem.getInfoAsync(REFERENCE_DOCUMENTS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(REFERENCE_DOCUMENTS_DIR, { intermediates: true });
  }
  return REFERENCE_DOCUMENTS_DIR;
}

export function isStoredReferenceDocument(uri: string) {
  if (!REFERENCE_DOCUMENTS_DIR) return false;
  const resolved = resolveReferenceDocumentUri(uri);
  return Boolean(resolved && isLegacyOwnedLocalFileReadDeleteAuthorized({
    ownedRoot: REFERENCE_DOCUMENTS_DIR,
    legacyFolderName: REFERENCE_DOCUMENTS_FOLDER,
    candidatePath: resolved,
  }));
}

export function deleteStoredReferenceDocument(uri: string) {
  const resolved = resolveReferenceDocumentUri(uri);
  if (!isStoredReferenceDocument(resolved)) return Promise.resolve();
  return FileSystem.deleteAsync(resolved, { idempotent: true });
}

export async function prepareReferenceDocumentForCloud(
  document: ReferenceDocument,
): Promise<ReferenceDocument> {
  if (!document.uri) return document;
  const resolvedUri = resolveReferenceDocumentUri(document.uri);
  if (!resolvedUri) return document;
  const bytes = await new File(resolvedUri).bytes();
  const integrity = {
    sizeBytes: bytes.byteLength,
    contentSha256: await sha256Bytes(bytes),
    updatedAt: new Date().toISOString(),
  };
  if (document.storagePath) return { ...document, ...integrity };
  const storagePath = `mobile/${document.id}/${sanitizeFilename(document.originalFileName)}`;
  const uploaded = await uploadPhoto({
    bucket: REFERENCE_DOCUMENT_BUCKET,
    path: storagePath,
    uri: resolvedUri,
    contentType: document.mimeType || 'application/octet-stream',
    upsert: true,
  });
  // Integrity metadata is local truth derived from the owned bytes. Preserve
  // it even when the cloud upload is unavailable so a later retry can safely
  // prove which file is being uploaded and recovered.
  if (!uploaded.ok || uploaded.stubbed) return { ...document, ...integrity };
  return {
    ...document,
    storagePath,
    ...integrity,
  };
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

async function sha256Bytes(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    digestInput.buffer,
  );
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}
