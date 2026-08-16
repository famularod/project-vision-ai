import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { JsonValue } from './SupabaseService';
import {
  createPhotoSignedUrl,
} from './SupabaseService';
import {
  canonicalProjectCoverId,
  canonicalProjectCoverSha256,
  canonicalProjectCoverSizeBytes,
  immutableProjectCoverStoragePath,
  projectCoverStoragePathKind,
} from './ProjectCoverCommitAuthority';
import { hashExpoFileSha256 } from './FileSizePreflight';

export type ProjectCoverPhoto = {
  localUri?: string | null;
  remotePath?: string | null;
  mimeType?: string | null;
  updatedAt: string;
  contentSha256?: string | null;
  sizeBytes?: number | null;
};

export type ProjectCoverPhotoMode = 'automatic' | 'manual';

export type ProjectRecord = {
  /**
   * Transitional immutable identity. Legacy name-only records remain readable
   * until the journaled identity migration assigns or reconciles a UUID.
   */
  id?: string | null;
  name: string;
  coverPhoto?: ProjectCoverPhoto | null;
  coverPhotoMode?: ProjectCoverPhotoMode;
  coverPhotoUpdatedAt?: string | null;
  data?: JsonValue | null;
};

const COVER_PHOTO_FOLDER = 'project-cover-photos';
const COVER_PHOTO_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${COVER_PHOTO_FOLDER}/`
  : null;

function coverPhotoCacheRevision(
  coverPhoto: Pick<ProjectCoverPhoto, 'remotePath' | 'updatedAt'>,
): string {
  const revisionSource = `${coverPhoto.remotePath || 'local'}-${coverPhoto.updatedAt || 'unknown'}`;
  return revisionSource.replace(/[^a-zA-Z0-9]/g, '').slice(-48) || 'unknown';
}

function coverPhotoCacheUri(
  projectId: string,
  coverPhoto: Pick<ProjectCoverPhoto, 'remotePath' | 'updatedAt'>,
  extension: string,
): string | null {
  if (!COVER_PHOTO_DIR) return null;
  return `${COVER_PHOTO_DIR}${projectId}-${coverPhotoCacheRevision(coverPhoto)}.${extension}`;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCoverPhotoMode(
  value: unknown,
  coverPhoto: ProjectCoverPhoto | null,
): ProjectCoverPhotoMode {
  if (value === 'automatic' || value === 'manual') return value;
  return coverPhoto ? 'manual' : 'automatic';
}

export function normalizeProjectCoverPhoto(value: unknown): ProjectCoverPhoto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const updatedAt = optionalText(record.updatedAt);
  const localUri = optionalText(record.localUri);
  const remotePath = optionalText(record.remotePath);

  if (!updatedAt || (!localUri && !remotePath)) return null;

  return {
    localUri,
    remotePath,
    mimeType: optionalText(record.mimeType),
    updatedAt,
    contentSha256: canonicalProjectCoverSha256(record.contentSha256),
    sizeBytes: canonicalProjectCoverSizeBytes(record.sizeBytes),
  };
}

export function normalizeProjectRecord(value: unknown): ProjectRecord | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { id: null, name } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = optionalText(record.name);
  if (!name) return null;
  const id = exactCoverProjectId(record.id);
  const coverPhoto = normalizeProjectCoverPhoto(record.coverPhoto);
  const coverPhotoUpdatedAt = optionalText(record.coverPhotoUpdatedAt) || coverPhoto?.updatedAt || null;
  const coverPhotoMode = normalizeCoverPhotoMode(record.coverPhotoMode, coverPhoto);
  const data = record.data && typeof record.data === 'object' ? record.data as JsonValue : null;
  return { id, name, coverPhoto, coverPhotoMode, coverPhotoUpdatedAt, data };
}

function sameProjectIdentity(
  left: ProjectRecord,
  right: ProjectRecord,
): boolean {
  const leftId = exactCoverProjectId(left.id);
  const rightId = exactCoverProjectId(right.id);
  if (leftId || rightId) return Boolean(leftId && rightId && leftId === rightId);
  return normalizedProjectName(left.name) === normalizedProjectName(right.name);
}

function normalizedProjectName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function exactCoverProjectId(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    /^[a-zA-Z0-9._-]+$/.test(value)
    ? value
    : null;
}

function exactCoverStoragePath(projectSegment: string, value: unknown): string | null {
  return projectCoverStoragePathKind(projectSegment, value) && typeof value === 'string'
    ? value
    : null;
}

function exactProjectIdsByName(records: readonly ProjectRecord[]): ReadonlyMap<string, ReadonlySet<string>> {
  const mutable = new Map<string, Set<string>>();
  records.forEach(record => {
    const id = exactCoverProjectId(record.id);
    if (!id) return;
    const name = normalizedProjectName(record.name);
    const ids = mutable.get(name) || new Set<string>();
    ids.add(id);
    mutable.set(name, ids);
  });
  return mutable;
}

function bindLegacyProjectIdentity(
  record: ProjectRecord,
  idsByName: ReadonlyMap<string, ReadonlySet<string>>,
): ProjectRecord | null {
  if (exactCoverProjectId(record.id)) return record;
  const exactIds = idsByName.get(normalizedProjectName(record.name));
  if (!exactIds || exactIds.size === 0) return record;
  // A mutable display name is never sufficient to promote legacy cover data
  // into an immutable project. Even a currently unique name can become unique
  // only because a same-name sibling was archived, which would dynamically
  // rebind the stale cover to the wrong project.
  return null;
}

export function normalizeProjectRecords(values: unknown): ProjectRecord[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map(normalizeProjectRecord)
    .filter((record): record is ProjectRecord => Boolean(record));
  const idsByName = exactProjectIdsByName(normalized);
  const records: ProjectRecord[] = [];
  for (const record of normalized) {
    const next = bindLegacyProjectIdentity(record, idsByName);
    if (!next) continue;
    const existingIndex = records.findIndex(item => sameProjectIdentity(item, next));
    if (existingIndex < 0) records.push(next);
    else if (next.coverPhoto) {
      const previous = records[existingIndex];
      const previousUpdatedAt = previous.coverPhotoUpdatedAt || previous.coverPhoto?.updatedAt || '';
      const incomingUpdatedAt = next.coverPhotoUpdatedAt || next.coverPhoto.updatedAt || '';
      if (!previous.coverPhoto || incomingUpdatedAt >= previousUpdatedAt) {
        records[existingIndex] = {
          ...next,
          id: previous.id || next.id || null,
        };
      }
    } else if (!records[existingIndex].id && next.id) {
      records[existingIndex] = { ...records[existingIndex], id: next.id };
    }
  }
  return records;
}

export function projectRecordFromCloud(value: {
  id?: string | null;
  name: string;
  data?: JsonValue | null;
}): ProjectRecord {
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : {};
  const coverPhoto = normalizeProjectCoverPhoto(data.coverPhoto);
  return {
    id: exactCoverProjectId(value.id),
    name: value.name,
    coverPhoto,
    coverPhotoMode: normalizeCoverPhotoMode(data.coverPhotoMode, coverPhoto),
    coverPhotoUpdatedAt: optionalText(data.coverPhotoUpdatedAt) || coverPhoto?.updatedAt || null,
    data: value.data || null,
  };
}

export function mergeProjectRecords(
  baseNames: string[],
  localRecords: ProjectRecord[],
  cloudRecords: ProjectRecord[],
  deletedProjectNames: string[] = [],
): ProjectRecord[] {
  const candidates: ProjectRecord[] = [
    ...localRecords,
    ...cloudRecords,
    ...baseNames.map(name => ({ name })),
  ];
  const idsByName = exactProjectIdsByName(candidates);
  const records: ProjectRecord[] = [];
  const deletedKeys = new Set(
    deletedProjectNames.map(name => name.trim().toLowerCase()).filter(Boolean),
  );
  const add = (candidate: ProjectRecord) => {
    const record = bindLegacyProjectIdentity(candidate, idsByName);
    if (!record) return;
    const deletedKey = record.name.toLowerCase();
    if (deletedKeys.has(deletedKey)) return;
    const existingIndex = records.findIndex(item => sameProjectIdentity(item, record));
    if (existingIndex < 0) {
      records.push(record);
      return;
    }
    const previous = records[existingIndex];
    const localCover = previous.coverPhoto;
    const incomingCover = record.coverPhoto;
    const previousUpdatedAt = previous.coverPhotoUpdatedAt || localCover?.updatedAt || '';
    const incomingUpdatedAt = record.coverPhotoUpdatedAt || incomingCover?.updatedAt || '';
    if (incomingUpdatedAt && incomingUpdatedAt >= previousUpdatedAt) {
      records[existingIndex] = {
        ...previous,
        ...record,
        id: previous.id || record.id || null,
        coverPhoto: incomingCover
          ? {
              ...incomingCover,
              localUri:
                incomingCover.remotePath === localCover?.remotePath &&
                incomingCover.updatedAt === localCover?.updatedAt
                  ? incomingCover.localUri || localCover.localUri || null
                  : incomingCover.localUri || null,
            }
          : null,
      };
    } else if (record.data && !previous.data) {
      records[existingIndex] = {
        ...previous,
        id: record.id || previous.id || null,
        data: record.data,
      };
    } else if (!previous.id && record.id) {
      records[existingIndex] = { ...previous, id: record.id };
    }
  };
  candidates.forEach(add);
  return records;
}

export function coverPhotoForProject(
  records: readonly ProjectRecord[],
  projectId: string | null | undefined,
): ProjectCoverPhoto | null {
  const exactId = exactCoverProjectId(projectId);
  if (!exactId) return null;
  const exactMatches = records.filter(candidate => exactCoverProjectId(candidate.id) === exactId);
  if (exactMatches.length !== 1) return null;
  const record = exactMatches[0];
  if (!record?.coverPhoto) return null;
  if (
    record.coverPhotoMode === 'manual' &&
    record.coverPhotoUpdatedAt &&
    record.coverPhotoUpdatedAt !== record.coverPhoto.updatedAt
  ) return null;
  const remotePath = record.coverPhoto.remotePath;
  const pathKind = remotePath ? projectCoverStoragePathKind(exactId, remotePath) : null;
  if (remotePath && !pathKind) return null;
  if (
    pathKind === 'immutable' &&
    (!canonicalProjectCoverSha256(record.coverPhoto.contentSha256) ||
      !canonicalProjectCoverSizeBytes(record.coverPhoto.sizeBytes))
  ) return null;
  return record.coverPhoto;
}

export function exactProjectRecordForCoverName(
  records: readonly ProjectRecord[],
  projectName: string | null | undefined,
): ProjectRecord | null {
  if (!projectName?.trim()) return null;
  const matches = records.filter(record =>
    normalizedProjectName(record.name) === normalizedProjectName(projectName),
  );
  return matches.length === 1 && exactCoverProjectId(matches[0].id) ? matches[0] : null;
}

export function exactProjectUpdatesForCover<T extends Readonly<{
  projectId?: string | null;
}>>(
  updates: readonly T[],
  projectId: string | null | undefined,
): T[] {
  const exactId = exactCoverProjectId(projectId);
  if (!exactId) return [];
  return updates.filter(update => exactCoverProjectId(update.projectId) === exactId);
}

export function resolveProjectDisplayPhotoUri(
  coverPhotoMode: ProjectCoverPhotoMode | null | undefined,
  coverPhoto: ProjectCoverPhoto | null | undefined,
  automaticPhotoUri: string | null | undefined,
): string | null {
  if (coverPhotoMode === 'manual') return coverPhoto?.localUri || null;
  return automaticPhotoUri || null;
}

export function resolveProjectCoverPhotoUri(
  records: readonly ProjectRecord[],
  projectId: string | null | undefined,
  automaticPhotoUri: string | null | undefined,
): string | null {
  const exactId = exactCoverProjectId(projectId);
  if (!exactId) return null;
  const exactMatches = records.filter(item => exactCoverProjectId(item.id) === exactId);
  if (exactMatches.length !== 1) return null;
  const record = exactMatches[0];
  const coverPhoto = coverPhotoForProject(records, exactId);
  return resolveProjectDisplayPhotoUri(
    record?.coverPhotoMode,
    coverPhoto,
    automaticPhotoUri,
  );
}

export function cloudProjectCoverData(
  coverPhoto: ProjectCoverPhoto | null,
  coverPhotoMode: ProjectCoverPhotoMode,
  existingData: JsonValue | null | undefined,
  updatedAt = coverPhoto?.updatedAt || new Date().toISOString(),
): JsonValue {
  const base = existingData && typeof existingData === 'object' && !Array.isArray(existingData)
    ? existingData
    : {};
  return {
    ...base,
    coverPhoto: coverPhoto
      ? {
          remotePath: coverPhoto.remotePath || null,
          mimeType: coverPhoto.mimeType || null,
          updatedAt: coverPhoto.updatedAt,
          contentSha256: coverPhoto.contentSha256 || null,
          sizeBytes: coverPhoto.sizeBytes || null,
        }
      : null,
    coverPhotoMode,
    coverPhotoUpdatedAt: updatedAt,
  };
}

export async function cacheSelectedProjectCoverPhoto(
  sourceUri: string,
  projectId: string,
  mimeType = 'image/jpeg',
): Promise<ProjectCoverPhoto> {
  const exactId = canonicalProjectCoverId(projectId);
  if (!exactId) throw new Error('Choose one exact project before saving a cover photo.');
  if (!COVER_PHOTO_DIR) throw new Error('Local cover photo storage is unavailable.');
  await FileSystem.makeDirectoryAsync(COVER_PHOTO_DIR, { intermediates: true });
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const updatedAt = new Date().toISOString();
  const canonicalMimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
  const remotePath = immutableProjectCoverStoragePath(
    exactId,
    Crypto.randomUUID(),
    canonicalMimeType,
  );
  if (!remotePath) throw new Error('A unique cover photo receipt could not be created.');
  const localUri = coverPhotoCacheUri(exactId, { remotePath, updatedAt }, extension);
  if (!localUri) throw new Error('Local cover photo storage is unavailable.');
  await FileSystem.copyAsync({ from: sourceUri, to: localUri });
  const integrity = await hashExpoFileSha256({ uri: localUri });
  return {
    localUri,
    remotePath,
    mimeType: canonicalMimeType,
    updatedAt,
    contentSha256: integrity.sha256,
    sizeBytes: integrity.sizeBytes,
  };
}

export async function hydrateProjectCoverPhotoCache(
  projectId: string,
  coverPhoto: ProjectCoverPhoto,
  records: readonly ProjectRecord[],
): Promise<ProjectCoverPhoto> {
  const exactId = exactCoverProjectId(projectId);
  if (!exactId) return coverPhoto;
  if (!COVER_PHOTO_DIR || !coverPhoto.remotePath) return coverPhoto;
  const authorizedCover = coverPhotoForProject(records, exactId);
  if (
    !authorizedCover ||
    authorizedCover.remotePath !== coverPhoto.remotePath ||
    authorizedCover.updatedAt !== coverPhoto.updatedAt
  ) return coverPhoto;
  const extension = coverPhoto.mimeType?.includes('png') ? 'png' : 'jpg';
  const localUri = coverPhotoCacheUri(exactId, coverPhoto, extension);
  if (!localUri) return coverPhoto;
  if (coverPhoto.localUri === localUri) {
    const info = await FileSystem.getInfoAsync(coverPhoto.localUri).catch(() => null);
    if (info?.exists) return coverPhoto;
  }
  const signedUrl = await createPhotoSignedUrl(coverPhoto.remotePath, 300);
  if (!signedUrl.ok || !signedUrl.data) return coverPhoto;
  await FileSystem.makeDirectoryAsync(COVER_PHOTO_DIR, { intermediates: true });
  await FileSystem.downloadAsync(signedUrl.data, localUri);
  const expectedSha256 = canonicalProjectCoverSha256(coverPhoto.contentSha256);
  const expectedSizeBytes = canonicalProjectCoverSizeBytes(coverPhoto.sizeBytes);
  if (expectedSha256 && expectedSizeBytes) {
    const integrity = await hashExpoFileSha256({
      uri: localUri,
      reportedSizeBytes: expectedSizeBytes,
    }).catch(() => null);
    if (
      !integrity ||
      integrity.sha256 !== expectedSha256 ||
      integrity.sizeBytes !== expectedSizeBytes
    ) {
      await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
      return coverPhoto;
    }
  }
  if (
    coverPhoto.localUri &&
    coverPhoto.localUri !== localUri &&
    coverPhoto.localUri.startsWith(COVER_PHOTO_DIR)
  ) {
    await FileSystem.deleteAsync(coverPhoto.localUri, { idempotent: true }).catch(() => undefined);
  }
  return { ...coverPhoto, localUri };
}

export async function removeCachedProjectCoverPhoto(
  coverPhoto: ProjectCoverPhoto | null | undefined,
): Promise<void> {
  if (!coverPhoto?.localUri) return;
  await FileSystem.deleteAsync(coverPhoto.localUri, { idempotent: true }).catch(() => undefined);
}
