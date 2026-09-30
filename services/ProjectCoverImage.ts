import { cloudPhotoPreviewIsFresh } from './ProjectPhotoTransport';
import type { ProjectRecord } from './ProjectCoverPhotoService';
import type { UpdatePhoto } from '../types';

/**
 * A project's cover as shown by ProjectPhotoImage: this device's file for it
 * ('' when it holds none) and the photo, so a field-update photo held only in
 * the cloud signs its preview when shown. A chosen cover has only its file.
 */
export type ProjectCoverImage = Readonly<{ localUri: string; photo: Partial<UpdatePhoto> }>;

/**
 * The automatic cover: the newest field-update photo this device can show,
 * its own file or a copy in the cloud. It used to be the newest update's
 * first photo `uri`, which is empty for a photo taken on the other device,
 * so the project showed no cover there (whole-app audit A4 pass 7 M2, 30 Sep
 * 2026). A photo with neither is passed over for the next one.
 */
export function mostRecentProjectHeroPhoto<TUpdate extends { photos: readonly Partial<UpdatePhoto>[] }>(
  updates: readonly TUpdate[],
  sortTime: (update: TUpdate) => number,
  localUri: (photo: Partial<UpdatePhoto>) => string,
): ProjectCoverImage | null {
  const newestFirst = updates
    .filter(update => update.photos.length > 0)
    .sort((left, right) => sortTime(right) - sortTime(left));
  for (const update of newestFirst) {
    for (const photo of update.photos) {
      const uri = localUri(photo);
      if (uri || photo.cloudStoragePath?.trim() || cloudPhotoPreviewIsFresh({
        cloudPreviewUri: photo.cloudPreviewUri,
        cloudPreviewSignedUrlExpiresAt: photo.cloudPreviewSignedUrlExpiresAt,
      })) {
        return { localUri: uri, photo };
      }
    }
  }
  return null;
}

/**
 * The project's cover on every surface: the chosen cover in manual mode (its
 * cached file, none while that downloads), else the automatic one. The same
 * rule as resolveProjectCoverPhotoUri, for a cover that may be cloud-only.
 */
export function resolveProjectCoverImage(
  records: readonly ProjectRecord[],
  projectName: string | null | undefined,
  automatic: ProjectCoverImage | null,
): ProjectCoverImage | null {
  const key = projectName?.toLowerCase();
  const record = key ? records.find(item => item.name.toLowerCase() === key) : undefined;
  if (record?.coverPhotoMode !== 'manual') return automatic;
  const chosen = record.coverPhoto?.localUri;
  return chosen ? { localUri: chosen, photo: {} } : null;
}
