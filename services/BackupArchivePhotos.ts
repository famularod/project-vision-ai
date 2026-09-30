/**
 * How a device backup archive locates photos, for validation.
 *
 * Whole-app audit A7 (30 Sep 2026): the export writes a carried photo as
 * { ...photo, uri: '', _backupAssetId } and a photo it cannot carry as
 * { ...photo, uri: '' }; the restore validated that raw archive with the
 * device rules, which require a uri or a cloud storage path, so any archive
 * holding a draft photo or an update not yet merged back from the cloud
 * was refused whole ("The active draft is malformed"). The device rules
 * stay as they are: for an archive, a carried photo is judged with a
 * placeholder uri for its asset, and a photo nothing locates (declared
 * unavailable by the export, or written by an older export as { uri: '' })
 * is accepted and dropped on restore by normalizeUpdate.
 *
 * Pass 2 of the same audit: the device wrapper resolves a uri to a file on
 * this phone, which a placeholder never is, so the archive rule must not
 * hand a placeholder to it; archivePhotoIsLocated is that rule, and the
 * device resolver is asked only about a real uri.
 */
export const BACKUP_ASSET_PLACEHOLDER_URI = 'vitruvius-backup-asset:';
export const BACKUP_UNAVAILABLE_PLACEHOLDER_URI = 'vitruvius-backup-unavailable:';

type ArchivePhoto = Readonly<{
  uri?: unknown;
  cloudStoragePath?: unknown;
  _backupAssetId?: unknown;
  _backupUnavailable?: unknown;
}>;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The photo as the device validators can judge it (validation only; never stored). */
export function archivePhotoForValidation<TPhoto extends ArchivePhoto>(photo: TPhoto): TPhoto {
  if (nonEmpty(photo.uri) || nonEmpty(photo.cloudStoragePath)) return photo;
  if (nonEmpty(photo._backupAssetId)) return { ...photo, uri: `${BACKUP_ASSET_PLACEHOLDER_URI}${photo._backupAssetId}` };
  // Declared unavailable, or nothing locates it (an older export): no
  // restore could find this photo either way, so it is accepted and dropped.
  return { ...photo, uri: `${BACKUP_UNAVAILABLE_PLACEHOLDER_URI}${String(photo._backupAssetId ?? '')}` };
}

/**
 * Whether an archive can locate this photo: a cloud copy, a carried asset,
 * a declared or older-style unavailable photo, or a real uri this device
 * resolves (a materialized file, or a signed URL).
 */
export function archivePhotoIsLocated(
  photo: ArchivePhoto,
  deviceResolves: (photo: ArchivePhoto) => boolean,
): boolean {
  if (nonEmpty(photo.cloudStoragePath) || nonEmpty(photo._backupAssetId) || photo._backupUnavailable === true) return true;
  if (!nonEmpty(photo.uri)) return true;
  return deviceResolves(photo);
}

/** Every photo of a saved update or draft record in an archive is located (a record without a photo list passes). */
export function archiveUpdatePhotosAreLocated(
  value: unknown,
  deviceResolves: (photo: ArchivePhoto) => boolean,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as { photos?: unknown };
  if (!Array.isArray(record.photos)) return true;
  return record.photos.every(photo =>
    photo && typeof photo === 'object' && archivePhotoIsLocated(photo as ArchivePhoto, deviceResolves),
  );
}

/** A saved update or draft record from an archive, with its photos made judgeable. */
export function archiveUpdateForValidation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as { photos?: unknown };
  if (!Array.isArray(record.photos)) return value;
  return {
    ...record,
    photos: record.photos.map(photo =>
      photo && typeof photo === 'object' ? archivePhotoForValidation(photo as ArchivePhoto) : photo,
    ),
  };
}

/** The archive's draft envelope ({ draft, savedAt }) with its draft made judgeable. */
export function archiveDraftEnvelopeForValidation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const envelope = value as { draft?: unknown };
  if (!('draft' in envelope)) return value;
  return { ...envelope, draft: archiveUpdateForValidation(envelope.draft) };
}

/** A photo the export cannot carry and that is not in the cloud either. */
export function markPhotoUnavailableInBackup<TPhoto extends Readonly<Record<string, unknown>>>(photo: TPhoto): TPhoto {
  return { ...photo, uri: '', _backupUnavailable: true };
}
