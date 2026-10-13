import { cloudOwnerUnchanged, currentCloudOwner, type CloudOwnerBinding } from './CloudOwnerBinding';
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

/**
 * Photos the cloud answered "not found" for, by storage path, for the
 * signed-in account and for this run of the app only (sync batch Y3, item 1).
 * A photo with nothing in the cloud that carried no 'unavailable' mark on
 * this device was looked up again by every refresh, live update and Settings
 * download, and by its image about 16 times an hour. Kept per account: what
 * one account cannot see says nothing of another's, and it is all forgotten
 * when the account changes. One photo's is forgotten when this device uploads
 * it or any look-up finds it. Not saved on the device: a relaunch looks once
 * more, which is how a photo another device uploads later is found.
 */
const PHOTOS_NOT_IN_CLOUD_KEPT = 2000;
let photosNotInCloud: { ownerId: string; paths: Set<string> } | null = null;

function photosNotInCloudForSignedInAccount(): Set<string> | null {
  if (photosNotInCloud && photosNotInCloud.ownerId !== currentCloudOwner().ownerId) photosNotInCloud = null;
  return photosNotInCloud?.paths ?? null;
}

/** `askedAs` is the account signed in when the look-up began: an answer that arrives after it changed is not kept. */
export function rememberPhotoNotInCloud(path: string | null | undefined, askedAs: CloudOwnerBinding): void {
  const key = path?.trim();
  if (!key || !askedAs.ownerId || !cloudOwnerUnchanged(askedAs)) return;
  const known = photosNotInCloudForSignedInAccount() ??
    (photosNotInCloud = { ownerId: askedAs.ownerId, paths: new Set<string>() }).paths;
  known.delete(key);
  known.add(key);
  for (const oldest of known) {
    if (known.size <= PHOTOS_NOT_IN_CLOUD_KEPT) break;
    known.delete(oldest);
  }
}

export function forgetPhotoNotInCloud(path: string | null | undefined): void {
  if (path?.trim()) photosNotInCloudForSignedInAccount()?.delete(path.trim());
}

export function photoKnownNotInCloud(path: string | null | undefined): boolean {
  return Boolean(path?.trim() && photosNotInCloudForSignedInAccount()?.has(path.trim()));
}

/**
 * The storage path this device may sign to show a photo, or '' when there is
 * none. A photo the sync marked 'unavailable' had no file left to upload, so
 * nothing is in the cloud at the path worked out from its update; signing it
 * only fails, and the image tried again about 16 times an hour while shown
 * (whole-app audit A4 pass 8 F4, 30 Sep 2026). So does a photo this account
 * was told is not in the cloud (photoKnownNotInCloud). A photo that is merely
 * offline is neither, and keeps its path.
 */
export function signableCloudPhotoPath(
  photo: Partial<Pick<UpdatePhoto, 'cloudStoragePath' | 'cloudRecoveryStatus'>> | undefined,
): string {
  if (!photo || photo.cloudRecoveryStatus === 'unavailable') return '';
  const path = photo.cloudStoragePath?.trim() || '';
  return photoKnownNotInCloud(path) ? '' : path;
}

/**
 * Whether this device has something to show for a photo: its own file, a
 * cloud copy to sign, or a preview still usable. Covers and comparisons pass
 * over a photo with none of these.
 */
export function projectPhotoCanBeShown(
  photo: Partial<Pick<UpdatePhoto,
    'cloudStoragePath' | 'cloudRecoveryStatus' | 'cloudPreviewUri' | 'cloudPreviewSignedUrlExpiresAt'>>,
  localUri: string,
  now = Date.now(),
): boolean {
  return Boolean(localUri || signableCloudPhotoPath(photo) || cloudPhotoPreviewIsFresh({
    cloudPreviewUri: photo.cloudPreviewUri,
    cloudPreviewSignedUrlExpiresAt: photo.cloudPreviewSignedUrlExpiresAt,
  }, now));
}

/**
 * The photo an update's card shows: its first photo this device can show, or
 * its first photo when none can (the card then shows its placeholder). The
 * card took the first photo whatever it was, so one with nothing in the cloud
 * left the card blank beside later photos that exist (sync batch Y3, item 1).
 */
export function firstProjectPhotoToShow<TPhoto extends Partial<UpdatePhoto>>(
  photos: readonly TPhoto[],
  localUri: (photo: TPhoto) => string,
): TPhoto | undefined {
  return photos.find(photo => projectPhotoCanBeShown(photo, localUri(photo))) ?? photos[0];
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

/**
 * A cloud copy whose photos were judged against one local copy, taking this
 * device's photo transport again from the local copy read after that await
 * for each photo whose path changed meanwhile. A restore that committed
 * during a refresh got the pre-restore paths, its restored files were left
 * unreferenced, and the 14-day photo cleanup deleted them (whole-app audit A4
 * pass 6 F3 (30 Sep 2026)). Any other photo keeps the judgement: a path found
 * missing stays cleared. Compared by value, per photo: every save or merge
 * rebuilds the update, and taking the whole copy again whenever it was a new
 * object brought back a path already found missing, so the photo showed
 * blank (whole-app audit A4 pass 7 L2).
 */
export function withLatestLocalPhotoTransport<TUpdate extends { photos: UpdatePhoto[] }>(
  judgedCloudUpdate: TUpdate,
  judgedLocalUpdate: Readonly<{ photos: readonly UpdatePhoto[] }> | undefined,
  latestLocalUpdate: Readonly<{ photos: readonly UpdatePhoto[] }> | undefined,
  localPhotoUri: (photo: Partial<UpdatePhoto>) => string,
): TUpdate {
  if (!latestLocalUpdate || latestLocalUpdate === judgedLocalUpdate) return judgedCloudUpdate;
  const judgedUri = (photoId: string) =>
    judgedLocalUpdate?.photos.find(photo => photo.id === photoId)?.uri || '';
  const latestUri = (photoId: string) =>
    latestLocalUpdate.photos.find(photo => photo.id === photoId)?.uri || '';
  let changed = false;
  const photos = judgedCloudUpdate.photos.map(photo => {
    if (latestUri(photo.id) === judgedUri(photo.id)) return photo;
    changed = true;
    return preserveLocalPhotoTransport(photo, latestLocalUpdate, localPhotoUri);
  });
  return changed ? { ...judgedCloudUpdate, photos } : judgedCloudUpdate;
}
