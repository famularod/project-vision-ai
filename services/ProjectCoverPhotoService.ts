import * as FileSystem from 'expo-file-system/legacy';
import type { JsonValue } from './SupabaseService';
import {
  createPhotoSignedUrl,
} from './SupabaseService';

export type ProjectCoverPhoto = {
  localUri?: string | null;
  remotePath?: string | null;
  mimeType?: string | null;
  updatedAt: string;
};

export type ProjectCoverPhotoMode = 'automatic' | 'manual';

export type ProjectRecord = {
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
  };
}

export function normalizeProjectRecord(value: unknown): ProjectRecord | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = optionalText(record.name);
  if (!name) return null;
  const coverPhoto = normalizeProjectCoverPhoto(record.coverPhoto);
  const coverPhotoUpdatedAt = optionalText(record.coverPhotoUpdatedAt) || coverPhoto?.updatedAt || null;
  const coverPhotoMode = normalizeCoverPhotoMode(record.coverPhotoMode, coverPhoto);
  const data = record.data && typeof record.data === 'object' ? record.data as JsonValue : null;
  return { name, coverPhoto, coverPhotoMode, coverPhotoUpdatedAt, data };
}

export function normalizeProjectRecords(values: unknown): ProjectRecord[] {
  if (!Array.isArray(values)) return [];
  const records: ProjectRecord[] = [];
  for (const value of values) {
    const next = normalizeProjectRecord(value);
    if (!next) continue;
    const existingIndex = records.findIndex(
      item => item.name.toLowerCase() === next.name.toLowerCase(),
    );
    if (existingIndex < 0) records.push(next);
    else if (next.coverPhoto) records[existingIndex] = next;
  }
  return records;
}

export function projectRecordFromCloud(value: {
  name: string;
  data?: JsonValue | null;
}): ProjectRecord {
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : {};
  const coverPhoto = normalizeProjectCoverPhoto(data.coverPhoto);
  return {
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
): ProjectRecord[] {
  const records = new Map<string, ProjectRecord>();
  const add = (record: ProjectRecord) => {
    const key = record.name.toLowerCase();
    const previous = records.get(key);
    if (!previous) {
      records.set(key, record);
      return;
    }
    const localCover = previous.coverPhoto;
    const incomingCover = record.coverPhoto;
    const previousUpdatedAt = previous.coverPhotoUpdatedAt || localCover?.updatedAt || '';
    const incomingUpdatedAt = record.coverPhotoUpdatedAt || incomingCover?.updatedAt || '';
    if (incomingUpdatedAt && incomingUpdatedAt >= previousUpdatedAt) {
      records.set(key, {
        ...previous,
        ...record,
        coverPhoto: incomingCover
          ? {
              ...incomingCover,
              localUri: incomingCover.localUri || localCover?.localUri || null,
            }
          : null,
      });
    } else if (record.data && !previous.data) {
      records.set(key, { ...previous, data: record.data });
    }
  };
  localRecords.forEach(add);
  cloudRecords.forEach(add);
  baseNames.forEach(name => add({ name }));
  return Array.from(records.values());
}

export function coverPhotoForProject(
  records: ProjectRecord[],
  projectName: string | null | undefined,
): ProjectCoverPhoto | null {
  if (!projectName) return null;
  return records.find(record => record.name.toLowerCase() === projectName.toLowerCase())
    ?.coverPhoto || null;
}

export function resolveProjectDisplayPhotoUri(
  coverPhotoMode: ProjectCoverPhotoMode | null | undefined,
  coverPhoto: ProjectCoverPhoto | null | undefined,
  automaticPhotoUri: string | null | undefined,
): string | null {
  if (coverPhotoMode === 'manual') return coverPhoto?.localUri || null;
  return automaticPhotoUri || null;
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
  if (!COVER_PHOTO_DIR) throw new Error('Local cover photo storage is unavailable.');
  await FileSystem.makeDirectoryAsync(COVER_PHOTO_DIR, { intermediates: true });
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const updatedAt = new Date().toISOString();
  const localUri = `${COVER_PHOTO_DIR}${projectId}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: localUri });
  const remotePath = `project-covers/${projectId}/cover.${extension}`;
  return {
    localUri,
    remotePath,
    mimeType,
    updatedAt,
  };
}

export async function hydrateProjectCoverPhotoCache(
  projectId: string,
  coverPhoto: ProjectCoverPhoto,
): Promise<ProjectCoverPhoto> {
  if (coverPhoto.localUri) {
    const info = await FileSystem.getInfoAsync(coverPhoto.localUri).catch(() => null);
    if (info?.exists) return coverPhoto;
  }
  if (!COVER_PHOTO_DIR || !coverPhoto.remotePath) return coverPhoto;
  const signedUrl = await createPhotoSignedUrl(coverPhoto.remotePath, 300);
  if (!signedUrl.ok || !signedUrl.data) return coverPhoto;
  await FileSystem.makeDirectoryAsync(COVER_PHOTO_DIR, { intermediates: true });
  const extension = coverPhoto.mimeType?.includes('png') ? 'png' : 'jpg';
  const localUri = `${COVER_PHOTO_DIR}${projectId}.${extension}`;
  await FileSystem.downloadAsync(signedUrl.data, localUri);
  return { ...coverPhoto, localUri };
}

export async function removeCachedProjectCoverPhoto(
  coverPhoto: ProjectCoverPhoto | null | undefined,
): Promise<void> {
  if (!coverPhoto?.localUri) return;
  await FileSystem.deleteAsync(coverPhoto.localUri, { idempotent: true }).catch(() => undefined);
}
