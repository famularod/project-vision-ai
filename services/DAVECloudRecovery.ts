import type { ProjectUpdate, ReferenceDocument, UpdatePhoto } from '../types';
import { daveProjectUpdateMatchesCloudReceipt } from './DAVEProjectUpdateCloudReceipt';
import { isCloudRecoveryCopy, withFresherPhotoPreview } from './ProjectPhotoTransport';
import { referenceDocumentCategory, referenceDocumentName } from './ReferenceDocumentSharedFields';

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
  const recovered = {
    ...local,
    projectId: local.projectId || cloud.projectId || null,
    photos: local.photos.map(localPhoto => {
      const cloudPhoto = cloudPhotos.get(normalizedId(localPhoto.id));
      if (!cloudPhoto) return localPhoto;
      return withFresherPhotoPreview(
        cloudPhotoHasFreshRecovery(cloudPhoto, now)
          ? mergePhotoRecoveryTransport(localPhoto, cloudPhoto)
          : localPhoto,
        cloudPhoto,
        now,
      );
    }),
  } as T;

  // An exact semantic cloud copy is the durable receipt for this update. Its
  // database row proves that the pending local generation already completed;
  // device cache paths, signed URLs, and retry metadata must not keep it
  // falsely labelled queued on another device.
  return daveProjectUpdateMatchesCloudReceipt(local, cloud)
    ? {
        ...recovered,
        status: 'sent',
      }
    : recovered;
}

/**
 * A local update against the cloud copy of the same id, if there is one.
 * With no cloud copy the update stands as it is: merging it with itself made
 * it its own "receipt" and stamped every locally saved update 'sent' before
 * any upload, so the list read "Cloud Synced" for an update that had never
 * left the phone and the app's own retry loop ignored it (whole-app audit
 * A4, 29 Sep 2026).
 */
export function mergeLocalUpdateWithCloudCopy<T extends ProjectUpdate>(
  local: T,
  cloud: T | undefined,
  now = Date.now(),
): T {
  return cloud ? mergeDAVECloudRecoveredProjectUpdate(local, cloud, now) : local;
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
      if (cloudDocument) merged.push({ ...cloudDocument, cloudDetailsSeen: referenceDocumentSharedDetailsFingerprint(cloudDocument) });
      return;
    }
    if (!cloudDocument) {
      merged.push(localDocument);
      return;
    }

    // Both copies are ranked by their edit time, and a tie goes to the cloud.
    // The row's updated_at is the upload time: "1", uploaded after "12" was
    // typed, outranked "12" and the last keystroke never reached the cloud
    // (whole-app audit A8 pass 1 F1 (30 Sep 2026)). Web edits now write
    // document_data.updatedAt with updated_at, so a newer web edit still wins.
    const cloudWins = referenceDocumentRevision(cloudDocument) >=
      referenceDocumentRevision(localDocument);
    const winner = cloudWins ? cloudDocument : localDocument;
    const other = cloudWins ? localDocument : cloudDocument;
    const metadataMerged = {
      ...other,
      ...winner,
      uri: localDocument.uri || cloudDocument.uri || '',
      storagePath: winner.storagePath || other.storagePath || null,
      cloudUpdatedAt: cloudDocument.cloudUpdatedAt || localDocument.cloudUpdatedAt || null,
      // What the cloud copy said when this device last merged it (A7 pass 6 L1).
      cloudDetailsSeen: referenceDocumentSharedDetailsFingerprint(cloudDocument),
    };
    merged.push(mergeCloudReferenceDocumentAuthority(metadataMerged, cloudDocument));
  });

  return merged;
}

/**
 * A phone edit the cloud copy outranks only because the document was made
 * current (or another one was) since the phone last saw it. The activation
 * (ecos_activate_current_reference_document) stamps document_data.updatedAt
 * with the time it ran, so text typed before Make Current, or a note edited
 * offline before the document was made current on the iPad or the web, lost
 * to the cloud copy and was dropped as already uploaded; the card kept it
 * and the other devices never got it (whole-app audit A8 pass 3 M2).
 *
 * The edit is kept when the cloud copy's current flags differ from the ones
 * the phone's copy carries (only an activation changes them), the phone's
 * copy was edited after the cloud copy it last saw, and it still differs
 * from the cloud's. It is returned stamped just after the cloud copy, so it
 * wins here and on the other devices; the cloud's current flags still win
 * in every merge. Null when the ordinary ranking stands.
 *
 * Only while the cloud copy's shared details are still the ones the phone
 * last saw (whole-app audit A7 pass 6 L1): a note typed on the web after the
 * activation is newer than the phone's, and stands, as any newer edit does.
 * `sentDetails` is what this phone itself last put in the cloud, which it
 * may not have seen come back yet. A copy saved before this record existed
 * keeps the earlier rule.
 */
export function referenceDocumentEditOutlivingActivation(
  local: ReferenceDocument,
  cloud: ReferenceDocument,
  now = Date.now(),
  sentDetails: string | null = null,
): ReferenceDocument | null {
  const cloudRevision = referenceDocumentRevision(cloud);
  if (referenceDocumentRevision(local) > cloudRevision) return null;
  if (currentFlags(local) === currentFlags(cloud)) return null;
  const seen = new Date(local.cloudUpdatedAt || '').getTime();
  const edited = new Date(local.updatedAt || '').getTime();
  if (!Number.isFinite(seen) || !Number.isFinite(edited) || edited <= seen) return null;
  if (sharedMetadataWithoutRevision(local) === sharedMetadataWithoutRevision(cloud)) return null;
  const cloudDetails = referenceDocumentSharedDetailsFingerprint(cloud);
  if (local.cloudDetailsSeen && local.cloudDetailsSeen !== cloudDetails && sentDetails !== cloudDetails) return null;
  return { ...local, updatedAt: new Date(Math.max(now, cloudRevision + 1)).toISOString() };
}

const DRAWING_STATUSES = new Set(['Draft', 'For Review', 'For Construction', 'As-Built', 'Superseded']);

/**
 * The details every device shares and a person edits, as the phone's
 * normalizer reads them, so the cloud row and the phone's normalized copy of
 * it give the same answer: a blank or unknown category reads "Other", a
 * blank name the file name, on both sides (whole-app audit A7 pass 7 L1).
 * Current flags, the revision stamp, device paths and cloud-owned index
 * fields are not part of it.
 */
export function referenceDocumentSharedDetailsFingerprint(document: ReferenceDocument): string {
  const record = document as unknown as Record<string, unknown>;
  const text = (key: string) => typeof record[key] === 'string' && (record[key] as string).trim() ? (record[key] as string).trim() : null;
  const sha = (key: string) => {
    const value = typeof record[key] === 'string' ? (record[key] as string).trim().toLowerCase() : '';
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  };
  const details = {
    name: referenceDocumentName(record.name, record.originalFileName),
    category: referenceDocumentCategory(record.category), notes: text('notes'),
    projectId: text('projectId'), projectName: text('projectName'),
    projectNames: Array.isArray(record.projectNames)
      ? (record.projectNames as unknown[]).filter(name => typeof name === 'string' && name.trim()) : [],
    importBatchId: text('importBatchId'), storagePath: text('storagePath'), mimeType: text('mimeType'),
    sizeBytes: typeof record.sizeBytes === 'number' && Number.isFinite(record.sizeBytes) ? record.sizeBytes : null,
    contentSha256: sha('contentSha256') || sha('webFileFingerprint'),
    webFileFingerprint: text('webFileFingerprint'), webVersionGroupId: text('webVersionGroupId'),
    drawingNumber: text('drawingNumber'), drawingRevision: text('drawingRevision'),
    drawingDiscipline: text('drawingDiscipline'), drawingIssuedAt: text('drawingIssuedAt'),
    drawingStatus: DRAWING_STATUSES.has(String(record.drawingStatus)) ? record.drawingStatus : null,
    sourceProvider: record.sourceProvider === 'google_drive' || record.sourceProvider === 'supabase_storage' ? record.sourceProvider : null,
  };
  const serialized = JSON.stringify(details);
  // FNV-1a, twice with different offsets: short, and stable across devices.
  const hash = (offset: number) => {
    let value = offset;
    for (let index = 0; index < serialized.length; index += 1) {
      value ^= serialized.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(16).padStart(8, '0');
  };
  return `v1:${hash(0x811c9dc5)}${hash(0x01000193)}`;
}

function currentFlags(document: ReferenceDocument): string {
  const retired = Array.isArray(document.retiredForProjectNames) ? document.retiredForProjectNames : [];
  return JSON.stringify([
    Boolean(document.isCurrent),
    [...new Set(retired.map(name => String(name).trim().toLowerCase()).filter(Boolean))].sort(),
  ]);
}

function sharedMetadataWithoutRevision(document: ReferenceDocument): string {
  const { updatedAt: _updatedAt, ...metadata } = document;
  return stableReferenceDocumentMetadata(metadata as ReferenceDocument);
}

/**
 * Return only device documents whose user-owned shared metadata would change
 * the current cloud record. Device URIs and cloud-owned ECOS/index authority
 * never make an otherwise current document eligible for a generic upsert.
 */
export function daveReferenceDocumentsNeedingCloudUpload({
  local,
  cloud,
  deletedIds = [],
}: {
  local: readonly ReferenceDocument[];
  cloud: readonly ReferenceDocument[];
  deletedIds?: readonly string[];
}): ReferenceDocument[] {
  const deleted = new Set(deletedIds.map(normalizedId).filter(Boolean));
  const cloudById = new Map(
    cloud
      .map(document => [normalizedId(document.id), document] as const)
      .filter(([id]) => Boolean(id) && !deleted.has(id)),
  );

  return local.flatMap(document => {
    const id = normalizedId(document.id);
    if (!id || deleted.has(id)) return [];
    const remote = cloudById.get(id);
    if (!remote) return [document];
    const authoritative = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [document],
      cloud: [remote],
    }).find(candidate => normalizedId(candidate.id) === id);
    if (!authoritative) return [];
    if (!remote.storagePath?.trim() && document.uri?.trim()) {
      return [authoritative];
    }
    return stableReferenceDocumentMetadata(authoritative) ===
        stableReferenceDocumentMetadata(remote)
      ? []
      : [authoritative];
  });
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
  // Part of "which schedule is current", written and cleared only by the
  // activation call (owner answer Q15): the cloud's list, or none.
  const { retiredForProjectNames: _deviceRetirement, ...merged } = metadataMerged;
  return {
    ...merged,
    ...(cloud.retiredForProjectNames?.length ? { retiredForProjectNames: cloud.retiredForProjectNames } : {}),
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

function referenceDocumentRevision(document: ReferenceDocument) {
  for (const value of [document.updatedAt, document.cloudUpdatedAt, document.importedAt]) {
    const parsed = new Date(value || '').getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizedId(value: string) {
  return String(value || '').trim().toLowerCase();
}

const REFERENCE_DOCUMENT_DEVICE_OR_CLOUD_AUTHORITY_KEYS = new Set([
  'uri',
  'cloudUpdatedAt',
  'cloudDetailsSeen',
  'isCurrent',
  'retiredForProjectNames',
  'webContentReview',
  'webReport',
  'extractedText',
  'extractionStatus',
  'extractionMethod',
  'extractionLimitations',
  'documentIntelligenceVersion',
  'documentVisualIndexVersion',
  'ecosVerifiedIndexCommitVersion',
  'ecosVerifiedIndexCommittedAt',
  'ecosVerifiedIndexCommittedSha256',
  'ecosVerifiedIndexCommittedPageCount',
  'indexedAt',
  'sourcePageCount',
  'searchablePageCount',
  'ocrPageCount',
  'extractionAverageConfidence',
  'indexedContentSha256',
  'extractedPages',
  'ecosHostedIndexStatus',
  'ecosHostedIndexProgressPercent',
  'ecosHostedIndexCustomerMessage',
  'ecosHostedIndexLimitationCount',
  'ecosHostedIndexSupportReference',
  'ecosHostedIndexEvidenceVersion',
  'ecosHostedIndexUpdatedAt',
]);

function stableReferenceDocumentMetadata(document: ReferenceDocument) {
  return JSON.stringify(sortRecord(
    Object.fromEntries(
      Object.entries(document).filter(([key]) =>
        !REFERENCE_DOCUMENT_DEVICE_OR_CLOUD_AUTHORITY_KEYS.has(key)),
    ),
  ));
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecord(entry)]),
  );
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
    // Only a copy this device fetched replaces its own path. A cloud row's
    // plain path is the uploading device's; taking it over a restored photo's
    // new name left that copy unreferenced, so the photo cleanup could delete
    // it 14 days after the restore (audit A7 M3).
    uri: isCloudRecoveryCopy(cloud) || !local.uri?.trim() ? cloud.uri : local.uri,
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
