/**
 * A photo chosen from the library, placed by the location stored inside it
 * (open item 3.26, GPS item 3; 14 Oct 2026).
 *
 * The photo picker returns the photo's EXIF when asked (`exif: true`; no
 * permission beyond the photo access the app already asks for). Its GPS tags
 * are the place the photo was taken. A library photo used to keep no GPS at
 * all: where it was taken was not known (GPS review pass 7), so it was filed
 * under the update's area, the one the phone's own position suggested.
 *
 * Now, when the photo carries its own location:
 * - that location is the photo's GPS (reports and analysis read it, as they
 *   read a camera photo's);
 * - when it is clearly inside one of the project's saved areas (the rule Add
 *   Task fills Location with: confidently inside, and the only such area or
 *   nearer than any other by the clear-winner margin), the photo is filed
 *   under that area, and stays there when the update's area is changed;
 * - it is never taken for where you are now (the update's current location,
 *   the area suggestion, fusion's latest fix): it may be days old.
 * A photo without one is handled as before.
 */
import type { ProjectArea } from '../types';
import { addTaskAreaSuggestion } from './AreaSuggestion';
import type { DraftGpsFields } from './DraftPhotoGps';

/** The photo's own location, as the GPS fields of a photo record. */
export type LibraryPhotoOwnGps = Readonly<{
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy: number | null;
}>;

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/**
 * A coordinate with its hemisphere. iOS gives the size of the angle and the
 * hemisphere letter apart (`GPSLatitude` 40.7, `GPSLatitudeRef` "N"); Android
 * gives the angle already signed, with the letter too.
 */
function signedCoordinate(value: unknown, reference: unknown, negative: 'S' | 'W', positive: 'N' | 'E', limit: number) {
  const angle = finiteNumber(value);
  if (angle === null) return null;
  const letter = typeof reference === 'string' ? reference.trim().toUpperCase() : '';
  const signed = letter === negative ? -Math.abs(angle) : letter === positive ? Math.abs(angle) : angle;
  return Math.abs(signed) <= limit ? signed : null;
}

/** The location stored in the photo's EXIF, or null (none, or not a usable one). */
export function libraryPhotoGpsFromExif(exif: unknown): LibraryPhotoOwnGps | null {
  if (!exif || typeof exif !== 'object') return null;
  const tags = exif as Record<string, unknown>;
  const gpsLatitude = signedCoordinate(tags.GPSLatitude, tags.GPSLatitudeRef, 'S', 'N', 90);
  const gpsLongitude = signedCoordinate(tags.GPSLongitude, tags.GPSLongitudeRef, 'W', 'E', 180);
  if (gpsLatitude === null || gpsLongitude === null) return null;
  // 0, 0 is what a camera with no fix writes, not a place on a site.
  if (gpsLatitude === 0 && gpsLongitude === 0) return null;
  const error = finiteNumber(tags.GPSHPositioningError);
  return { gpsLatitude, gpsLongitude, gpsAccuracy: error !== null && error >= 0 ? error : null };
}

/** A library photo with a location of its own. */
export function libraryPhotoHasOwnGps<TPhoto extends DraftGpsFields>(photo: TPhoto): photo is TPhoto & LibraryPhotoOwnGps {
  return photo.pickedFromLibrary === true &&
    typeof photo.gpsLatitude === 'number' &&
    typeof photo.gpsLongitude === 'number';
}

/**
 * The saved area a library photo's own location clearly places it in, with
 * its distance from the area's centre; null when it has none, or is not
 * clearly inside exactly one (its precision unknown or too wide, two areas
 * too close to tell, outside them all).
 */
export function libraryPhotoPlacement(
  photo: DraftGpsFields,
  areas: readonly ProjectArea[],
): Readonly<{ area: ProjectArea; distanceFeet: number }> | null {
  if (!libraryPhotoHasOwnGps(photo)) return null;
  const suggestion = addTaskAreaSuggestion({
    latitude: photo.gpsLatitude,
    longitude: photo.gpsLongitude,
    accuracy: typeof photo.gpsAccuracy === 'number' ? photo.gpsAccuracy : null,
  }, areas);
  return suggestion ? { area: suggestion.area, distanceFeet: suggestion.distanceFeet } : null;
}

/** The line under a photo on Add Photos when its own location was used; null otherwise. */
export function libraryPhotoLocationLine(
  photo: DraftGpsFields & Readonly<{ selectedAreaId?: string | null }>,
  areas: readonly ProjectArea[],
): string | null {
  if (!libraryPhotoHasOwnGps(photo)) return null;
  const placement = libraryPhotoPlacement(photo, areas);
  if (placement && placement.area.id === photo.selectedAreaId) {
    return `Placed by the photo's own location: ${placement.area.name}`;
  }
  return "Location taken from the photo. It is not clearly inside one saved area, so the update's area is used.";
}
