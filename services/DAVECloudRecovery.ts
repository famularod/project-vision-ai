import type { ProjectUpdate, ReferenceDocument, UpdatePhoto } from '../types';

export type DAVECloudRecoveryRecord = {
  id: string;
};

export function bindDAVECloudDatabaseIdentity<T extends Record<string, unknown>>(
  payload: T,
  databaseId: unknown,
): T {
  const id = typeof databaseId === 'string' ? databaseId.trim() : '';
  return id ? { ...payload, id } : payload;
}

/**
 * Combines a cloud recovery snapshot with the device's current records.
 * Device records deliberately win for matching ids because they may contain
 * unsynced field changes. Cloud-only records are restored after reinstall or
 * when a second device starts with empty local storage.
 */
export function mergeDAVECloudRecoveryRecords<T extends DAVECloudRecoveryRecord>({
  local,
  cloud,
  deletedIds = [],
}: {
  local: readonly T[];
  cloud: readonly T[];
  deletedIds?: readonly string[];
}): T[] {
  const deleted = new Set(deletedIds.map(normalizedId).filter(Boolean));
  const merged = new Map<string, T>();

  for (const record of cloud) {
    const key = normalizedId(record.id);
    if (!key || deleted.has(key)) continue;
    merged.set(key, record);
  }

  for (const record of local) {
    const key = normalizedId(record.id);
    if (!key || deleted.has(key)) continue;
    merged.set(key, record);
  }

  return [...merged.values()];
}

export function mergeDAVECloudRecoveredProjectUpdate<T extends ProjectUpdate>(
  local: T,
  cloud: T,
  now = Date.now(),
): T {
  const cloudPhotos = new Map(cloud.photos.map(photo => [normalizedId(photo.id), photo]));
  return {
    ...local,
    photos: local.photos.map(localPhoto => {
      const cloudPhoto = cloudPhotos.get(normalizedId(localPhoto.id));
      return cloudPhoto && cloudPhotoHasFreshRecovery(cloudPhoto, now)
        ? mergePhotoRecoveryTransport(localPhoto, cloudPhoto)
        : localPhoto;
    }),
  };
}

export function countDAVECloudRecoveredRecords<T extends DAVECloudRecoveryRecord>(
  local: readonly T[],
  merged: readonly T[],
): number {
  const localIds = new Set(local.map(record => normalizedId(record.id)).filter(Boolean));
  return merged.filter(record => !localIds.has(normalizedId(record.id))).length;
}

/**
 * Reference documents carry three kinds of state:
 * - user-editable shared metadata, ordered by the record revision;
 * - a device-local file URI, retained only on the device that owns it; and
 * - cloud-owned authority/evidence fields, which must never be changed by a
 *   stale or generic full-record mobile sync.
 *
 * Current-version changes use the dedicated server authority operation. This
 * recovery merge therefore always fails closed to the cloud value for
 * `isCurrent`, hosted preparation, and every ECOS index/proof field whenever a
 * cloud copy exists.
 */
export function mergeDAVEReferenceDocumentRecoveryRecords({
  local,
  cloud,
  deletedIds = [],
}: {
  local: readonly ReferenceDocument[];
  cloud: readonly ReferenceDocument[];
  deletedIds?: readonly string[];
}): ReferenceDocument[] {
  const deleted = new Set(deletedIds.map(normalizedId).filter(Boolean));
  const localById = new Map(local.map(document => [normalizedId(document.id), document]));
  const cloudById = new Map(cloud.map(document => [normalizedId(document.id), document]));
  const ids = new Set([...cloudById.keys(), ...localById.keys()]);
  const merged: ReferenceDocument[] = [];

  ids.forEach(id => {
    if (!id || deleted.has(id)) return;
    const localDocument = localById.get(id);
    const cloudDocument = cloudById.get(id);
    if (!localDocument) {
      if (cloudDocument) merged.push(cloudDocument);
      return;
    }
    if (!cloudDocument) {
      merged.push(localDocument);
      return;
    }

    const cloudWins = referenceDocumentRevision(cloudDocument, 'cloud') >
      referenceDocumentRevision(localDocument, 'local');
    const winner = cloudWins ? cloudDocument : localDocument;
    const other = cloudWins ? localDocument : cloudDocument;
    const metadataMerged = {
      ...other,
      ...winner,
      uri: localDocument.uri || cloudDocument.uri || '',
      storagePath: winner.storagePath || other.storagePath || null,
      cloudUpdatedAt: cloudDocument.cloudUpdatedAt || localDocument.cloudUpdatedAt || null,
    };
    merged.push(mergeCloudReferenceDocumentAuthority(metadataMerged, cloudDocument));
  });

  return merged;
}

/**
 * Overlay only fields whose authority belongs to Vitruvius cloud services.
 * Explicit `undefined` values are intentional: when the supplemental hosted
 * status service cannot provide a current status, a cached mobile value must
 * not remain eligible as proof that preparation passed.
 */
function mergeCloudReferenceDocumentAuthority(
  metadataMerged: ReferenceDocument,
  cloud: ReferenceDocument,
): ReferenceDocument {
  return {
    ...metadataMerged,
    isCurrent: cloud.isCurrent,
    webContentReview: cloud.webContentReview,
    webReport: cloud.webReport,
    extractedText: cloud.extractedText,
    extractionStatus: cloud.extractionStatus,
    extractionMethod: cloud.extractionMethod,
    extractionLimitations: cloud.extractionLimitations,
    documentIntelligenceVersion: cloud.documentIntelligenceVersion,
    documentVisualIndexVersion: cloud.documentVisualIndexVersion,
    ecosVerifiedIndexCommitVersion: cloud.ecosVerifiedIndexCommitVersion,
    ecosVerifiedIndexCommittedAt: cloud.ecosVerifiedIndexCommittedAt,
    ecosVerifiedIndexCommittedSha256: cloud.ecosVerifiedIndexCommittedSha256,
    ecosVerifiedIndexCommittedPageCount: cloud.ecosVerifiedIndexCommittedPageCount,
    ecosVerifiedIndexPageGraphSha256: cloud.ecosVerifiedIndexPageGraphSha256,
    indexedAt: cloud.indexedAt,
    sourcePageCount: cloud.sourcePageCount,
    searchablePageCount: cloud.searchablePageCount,
    ocrPageCount: cloud.ocrPageCount,
    extractionAverageConfidence: cloud.extractionAverageConfidence,
    indexedContentSha256: cloud.indexedContentSha256,
    extractedPages: cloud.extractedPages,
    ecosHostedIndexStatus: cloud.ecosHostedIndexStatus,
    ecosHostedIndexProgressPercent: cloud.ecosHostedIndexProgressPercent,
    ecosHostedIndexCustomerMessage: cloud.ecosHostedIndexCustomerMessage,
    ecosHostedIndexLimitationCount: cloud.ecosHostedIndexLimitationCount,
    ecosHostedIndexSupportReference: cloud.ecosHostedIndexSupportReference,
    ecosHostedIndexEvidenceVersion: cloud.ecosHostedIndexEvidenceVersion,
    ecosHostedIndexUpdatedAt: cloud.ecosHostedIndexUpdatedAt,
  };
}

function referenceDocumentRevision(
  document: ReferenceDocument,
  source: 'local' | 'cloud',
) {
  const values = source === 'cloud'
    ? [document.cloudUpdatedAt, document.updatedAt, document.importedAt]
    : [document.updatedAt, document.cloudUpdatedAt, document.importedAt];
  for (const value of values) {
    const parsed = new Date(value || '').getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizedId(value: string) {
  return String(value || '').trim().toLowerCase();
}

function cloudPhotoHasFreshRecovery(photo: UpdatePhoto, now: number) {
  if (!photo.uri?.trim() || photo.cloudRecoveryStatus === 'unavailable') return false;
  if (!photo.cloudStoragePath?.trim() && !photo.cloudRecoveryStatus) return false;
  if (photo.cloudRecoveryStatus !== 'signed_url') return true;
  const expiresAt = photo.cloudSignedUrlExpiresAt
    ? new Date(photo.cloudSignedUrlExpiresAt).getTime()
    : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function mergePhotoRecoveryTransport(local: UpdatePhoto, cloud: UpdatePhoto): UpdatePhoto {
  return {
    ...local,
    uri: cloud.uri,
    cloudStoragePath: cloud.cloudStoragePath || local.cloudStoragePath || null,
    cloudRecoveredAt: cloud.cloudRecoveredAt || local.cloudRecoveredAt || null,
    cloudRecoveryStatus: cloud.cloudRecoveryStatus || local.cloudRecoveryStatus || null,
    cloudSignedUrlExpiresAt:
      cloud.cloudSignedUrlExpiresAt || local.cloudSignedUrlExpiresAt || null,
    cloudPreviewUri: cloud.cloudPreviewUri || local.cloudPreviewUri || null,
    cloudPreviewSignedUrlExpiresAt:
      cloud.cloudPreviewSignedUrlExpiresAt ||
      local.cloudPreviewSignedUrlExpiresAt ||
      null,
  };
}
