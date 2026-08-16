import type { JsonValue } from './SupabaseService';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type ProjectCoverObjectReceipt = Readonly<{
  remotePath: string;
  mimeType: string | null;
  updatedAt: string;
  contentSha256: string | null;
  sizeBytes: number | null;
}>;

export type ProjectCoverAuthorityReceipt = Readonly<{
  coverPhoto: ProjectCoverObjectReceipt | null;
  mode: 'automatic' | 'manual';
  updatedAt: string | null;
}>;

export type ProjectCoverCommitMutation = Readonly<{
  expected: ProjectCoverAuthorityReceipt;
  target: ProjectCoverAuthorityReceipt & Readonly<{ updatedAt: string }>;
}>;

export type ProjectCoverCommitStatus =
  | 'committed'
  | 'already_committed'
  | 'conflict'
  | 'rejected';

export type ProjectCoverCommitReceipt = Readonly<{
  status: ProjectCoverCommitStatus;
  reason?: string | null;
}>;

function optionalExactText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : null;
}

export function canonicalProjectCoverSha256(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ? value
    : null;
}

export function canonicalProjectCoverSizeBytes(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function canonicalProjectCoverId(value: unknown): string | null {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value)
    ? value
    : null;
}

export function immutableProjectCoverStoragePath(
  projectIdValue: unknown,
  attemptIdValue: unknown,
  mimeType: unknown,
): string | null {
  const projectId = canonicalProjectCoverId(projectIdValue);
  const attemptId = canonicalProjectCoverId(attemptIdValue);
  if (!projectId || !attemptId) return null;
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return null;
  return `project-covers/${projectId}/revisions/${attemptId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
}

export function projectCoverStoragePathKind(
  projectIdValue: unknown,
  pathValue: unknown,
): 'legacy' | 'immutable' | null {
  const projectId = canonicalProjectCoverId(projectIdValue);
  const path = optionalExactText(pathValue);
  if (!projectId || !path) return null;
  if (
    path === `project-covers/${projectId}/cover.jpg` ||
    path === `project-covers/${projectId}/cover.png`
  ) {
    return 'legacy';
  }
  const prefix = `project-covers/${projectId}/revisions/`;
  if (!path.startsWith(prefix)) return null;
  const fileName = path.slice(prefix.length);
  const match = fileName.match(/^([0-9a-f-]+)\.(jpg|png)$/);
  return match && canonicalProjectCoverId(match[1]) ? 'immutable' : null;
}

export function normalizeProjectCoverObject(value: unknown): ProjectCoverObjectReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const remotePath = optionalExactText(record.remotePath);
  const updatedAt = optionalExactText(record.updatedAt);
  if (!remotePath || !updatedAt) return null;
  const mimeType = record.mimeType === null || record.mimeType === undefined
    ? null
    : optionalExactText(record.mimeType);
  if (record.mimeType !== null && record.mimeType !== undefined && !mimeType) return null;
  const contentSha256 = record.contentSha256 === null || record.contentSha256 === undefined
    ? null
    : canonicalProjectCoverSha256(record.contentSha256);
  const sizeBytes = record.sizeBytes === null || record.sizeBytes === undefined
    ? null
    : canonicalProjectCoverSizeBytes(record.sizeBytes);
  if (record.contentSha256 !== null && record.contentSha256 !== undefined && !contentSha256) {
    return null;
  }
  if (record.sizeBytes !== null && record.sizeBytes !== undefined && !sizeBytes) return null;
  return { remotePath, mimeType, updatedAt, contentSha256, sizeBytes };
}

export function projectCoverAuthorityFromData(
  value: JsonValue | null | undefined,
): ProjectCoverAuthorityReceipt {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const coverPhoto = normalizeProjectCoverObject(record.coverPhoto);
  const mode = record.coverPhotoMode === 'manual' || record.coverPhotoMode === 'automatic'
    ? record.coverPhotoMode
    : coverPhoto
      ? 'manual'
      : 'automatic';
  const updatedAt = optionalExactText(record.coverPhotoUpdatedAt) || coverPhoto?.updatedAt || null;
  return { coverPhoto, mode, updatedAt };
}

export function projectCoverAuthorityFromRecord(record: Readonly<{
  coverPhoto?: unknown;
  coverPhotoMode?: unknown;
  coverPhotoUpdatedAt?: unknown;
  data?: JsonValue | null;
}>): ProjectCoverAuthorityReceipt {
  const fromData = projectCoverAuthorityFromData(record.data);
  const hasTopLevelCover = Object.prototype.hasOwnProperty.call(record, 'coverPhoto');
  const coverPhoto = hasTopLevelCover
    ? normalizeProjectCoverObject(record.coverPhoto)
    : fromData.coverPhoto;
  const mode = record.coverPhotoMode === 'manual' || record.coverPhotoMode === 'automatic'
    ? record.coverPhotoMode
    : hasTopLevelCover
      ? coverPhoto
        ? 'manual'
        : 'automatic'
      : fromData.mode;
  const updatedAt = optionalExactText(record.coverPhotoUpdatedAt) ||
    (hasTopLevelCover ? coverPhoto?.updatedAt || null : fromData.updatedAt);
  return { coverPhoto, mode, updatedAt };
}

export function sameProjectCoverAuthority(
  left: ProjectCoverAuthorityReceipt,
  right: ProjectCoverAuthorityReceipt,
): boolean {
  const leftCover = normalizeProjectCoverObject(left.coverPhoto);
  const rightCover = normalizeProjectCoverObject(right.coverPhoto);
  return left.mode === right.mode &&
    left.updatedAt === right.updatedAt &&
    (leftCover === null) === (rightCover === null) &&
    (
      leftCover === null ||
      rightCover === null ||
      leftCover.remotePath === rightCover.remotePath &&
      leftCover.mimeType === rightCover.mimeType &&
      leftCover.updatedAt === rightCover.updatedAt &&
      leftCover.contentSha256 === rightCover.contentSha256 &&
      leftCover.sizeBytes === rightCover.sizeBytes
    );
}

export function validProjectCoverCommitMutation(
  projectIdValue: unknown,
  mutation: ProjectCoverCommitMutation,
): boolean {
  const projectId = canonicalProjectCoverId(projectIdValue);
  if (!projectId || !optionalExactText(mutation.target.updatedAt)) return false;
  const expectedPath = mutation.expected.coverPhoto?.remotePath;
  if (expectedPath && !projectCoverStoragePathKind(projectId, expectedPath)) return false;
  const targetPath = mutation.target.coverPhoto?.remotePath;
  if (targetPath && !projectCoverStoragePathKind(projectId, targetPath)) return false;
  if (mutation.target.mode === 'manual') {
    return Boolean(
      mutation.target.coverPhoto &&
      projectCoverStoragePathKind(projectId, targetPath) === 'immutable' &&
      mutation.target.coverPhoto.updatedAt === mutation.target.updatedAt &&
      canonicalProjectCoverSha256(mutation.target.coverPhoto.contentSha256) &&
      canonicalProjectCoverSizeBytes(mutation.target.coverPhoto.sizeBytes) &&
      (
        mutation.target.coverPhoto.mimeType === 'image/jpeg' && targetPath?.endsWith('.jpg') ||
        mutation.target.coverPhoto.mimeType === 'image/png' && targetPath?.endsWith('.png')
      )
    );
  }
  return true;
}
