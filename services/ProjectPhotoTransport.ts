import type { UpdatePhoto } from '../types';

/**
 * Device-local photo transport: where this device finds a photo's bytes (a
 * file path, a recovered cache copy, a signed URL) and the preview it shows
 * when it has no file. None of it is shared meaning; each device keeps its
 * own (DAVEProjectUpdateCloudReceipt excludes these keys).
 */

export function cloudPhotoPreviewIsFresh(
  photo: Pick<UpdatePhoto, 'cloudPreviewUri' | 'cloudPreviewSignedUrlExpiresAt'>,
  now = Date.now(),
): boolean {
  if (!photo.cloudPreviewUri?.trim()) return false;
  const expiresAt = photo.cloudPreviewSignedUrlExpiresAt
    ? new Date(photo.cloudPreviewSignedUrlExpiresAt).getTime()
    : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/** A copy this device fetched from the cloud: a cached download or a signed URL. */
export function isCloudRecoveryCopy(
  photo: Pick<UpdatePhoto, 'cloudRecoveryStatus'>,
): boolean {
  return photo.cloudRecoveryStatus === 'cached' || photo.cloudRecoveryStatus === 'signed_url';
}

/** Keeps whichever copy's preview is still usable, preferring the target's own. */
export function withFresherPhotoPreview<TPhoto extends UpdatePhoto>(
  target: TPhoto,
  source: UpdatePhoto | undefined,
  now = Date.now(),
): TPhoto {
  if (!source || cloudPhotoPreviewIsFresh(target, now) || !cloudPhotoPreviewIsFresh(source, now)) {
    return target;
  }
  return {
    ...target,
    cloudPreviewUri: source.cloudPreviewUri,
    cloudPreviewSignedUrlExpiresAt: source.cloudPreviewSignedUrlExpiresAt,
  };
}

/**
 * A cloud row's photo carries the uploading device's own path, which is not a
 * location on this device. Keep this device's path and recovery state for the
 * same photo, and its preview while that is still usable, so a refresh does
 * not sign every preview again (audit A7 M3). Whether the kept path still
 * holds a file is judged afterwards by hydrateProjectUpdatePhotoPreviews.
 */
export function preserveLocalPhotoTransport<TPhoto extends UpdatePhoto>(
  cloudPhoto: TPhoto,
  localUpdate: Readonly<{ photos: readonly UpdatePhoto[] }> | undefined,
  localPhotoUri: (photo: Partial<UpdatePhoto>) => string,
  now = Date.now(),
): TPhoto {
  const localPhoto = localUpdate?.photos.find(photo => photo.id === cloudPhoto.id);
  const uri = localPhoto ? localPhotoUri(localPhoto) : '';
  const withPreview = withFresherPhotoPreview(cloudPhoto, localPhoto, now);
  return uri
    ? {
        ...withPreview,
        uri,
        cloudRecoveredAt: localPhoto?.cloudRecoveredAt || cloudPhoto.cloudRecoveredAt,
        cloudRecoveryStatus: localPhoto?.cloudRecoveryStatus || cloudPhoto.cloudRecoveryStatus,
        cloudSignedUrlExpiresAt:
          localPhoto?.cloudSignedUrlExpiresAt || cloudPhoto.cloudSignedUrlExpiresAt,
      }
    : withPreview;
}
