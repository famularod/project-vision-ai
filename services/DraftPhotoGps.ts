/**
 * GPS on a draft's photos.
 *
 * GPS review, 29 Sep 2026: a fix at ten-meter precision can take several
 * seconds, and photos are copied in while it is pending. A camera photo
 * without GPS takes the draft's fix only if the fix stands for where the
 * photo was taken: within 30 minutes of the photo's own time (pass 8-9; a
 * draft resumed later must not put an old place on a new photo). A photo
 * keeps its own capture time; the fix's time is not the photo's (pass 8:
 * prior-photo ordering reads it). A photo chosen from the library was taken
 * at an unknown place, so it never takes the draft's fix (pass 7).
 */
export type DraftGpsFields = Readonly<{
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  pickedFromLibrary?: boolean;
}>;

/** How far apart a photo and a fix may be and the fix still stand for where the photo was taken. */
export const DRAFT_FIX_MAX_AGE_MS = 30 * 60 * 1000;

export type PhotoGpsFields = {
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracy: number | null;
  distanceFromSelectedAreaFeet: number | null;
};

const NO_GPS: PhotoGpsFields = {
  gpsLatitude: null,
  gpsLongitude: null,
  gpsAccuracy: null,
  distanceFromSelectedAreaFeet: null,
};

/**
 * Whether a fix taken at `fixTime` stands for a photo taken at `photoTime`.
 * A missing time on either side (older records) counts as covered, as before.
 */
export function fixCoversPhoto(
  photoTime: string | null | undefined,
  fixTime: string | null | undefined,
): boolean {
  const fixedAt = Date.parse(fixTime ?? '');
  const takenAt = Date.parse(photoTime ?? '');
  if (!Number.isFinite(fixedAt) || !Number.isFinite(takenAt)) return true;
  return Math.abs(takenAt - fixedAt) <= DRAFT_FIX_MAX_AGE_MS;
}

function draftGps(draft: DraftGpsFields): PhotoGpsFields | null {
  if (typeof draft.gpsLatitude !== 'number' || typeof draft.gpsLongitude !== 'number') return null;
  return {
    gpsLatitude: draft.gpsLatitude,
    gpsLongitude: draft.gpsLongitude,
    gpsAccuracy: draft.gpsAccuracy ?? null,
    distanceFromSelectedAreaFeet: draft.distanceFromSelectedAreaFeet ?? null,
  };
}

/** The draft's fix, if it stands for a photo taken at `now`. */
export function freshDraftGps(draft: DraftGpsFields, now: number): PhotoGpsFields | null {
  const gps = draftGps(draft);
  return gps && fixCoversPhoto(new Date(now).toISOString(), draft.locationCapturedAt) ? gps : null;
}

/** GPS for a photo just added to a draft. */
export function newPhotoGps(draft: DraftGpsFields, now: number): PhotoGpsFields {
  return freshDraftGps(draft, now) ?? NO_GPS;
}

/** A camera photo without GPS takes the draft's fix if it covers the photo; its time stays its own. */
export function withDraftGps<TPhoto extends DraftGpsFields>(photo: TPhoto, draft: DraftGpsFields): TPhoto {
  if (photo.pickedFromLibrary || typeof photo.gpsLatitude === 'number') return photo;
  const gps = draftGps(draft);
  return gps && fixCoversPhoto(photo.locationCapturedAt, draft.locationCapturedAt) ? { ...photo, ...gps } : photo;
}

/** A photo chosen from the library: where it was taken is not known. */
export function asLibraryPhoto<TPhoto extends DraftGpsFields>(photo: TPhoto): TPhoto {
  return { ...photo, pickedFromLibrary: true, ...NO_GPS };
}

/**
 * The draft's area and location onto a photo after an area change. Every
 * photo takes the area; a camera photo takes the draft's location only if
 * the fix covers it, and a photo keeps its own capture time (pass 8; an
 * area change used to wipe or replace it).
 */
export function withDraftLocation<TPhoto extends DraftGpsFields & Readonly<{
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
}>>(
  photo: TPhoto,
  fields: DraftGpsFields & Readonly<{ selectedAreaId: string | null; selectedAreaName: string | null }>,
): TPhoto {
  const area = { selectedAreaId: fields.selectedAreaId, selectedAreaName: fields.selectedAreaName };
  if (photo.pickedFromLibrary) return { ...photo, ...area };
  if (!fixCoversPhoto(photo.locationCapturedAt, fields.locationCapturedAt)) {
    // Its distance was to the previous area.
    return { ...photo, ...area, distanceFromSelectedAreaFeet: null };
  }
  return {
    ...photo,
    ...fields,
    locationCapturedAt: photo.locationCapturedAt ?? fields.locationCapturedAt ?? null,
  };
}

/**
 * A photo's GPS for reports and analysis: its own; else the update's if
 * that fix covers the photo; never the update's for a library photo
 * (pass 8-9: derived views showed photos at a place they were not taken).
 */
export function photoGpsOrUpdate(
  photo: DraftGpsFields,
  update: DraftGpsFields,
): PhotoGpsFields {
  if (typeof photo.gpsLatitude === 'number' && typeof photo.gpsLongitude === 'number') {
    return {
      gpsLatitude: photo.gpsLatitude,
      gpsLongitude: photo.gpsLongitude,
      gpsAccuracy: typeof photo.gpsAccuracy === 'number' ? photo.gpsAccuracy : null,
      distanceFromSelectedAreaFeet: photo.distanceFromSelectedAreaFeet ?? null,
    };
  }
  if (photo.pickedFromLibrary || !fixCoversPhoto(photo.locationCapturedAt, update.locationCapturedAt)) {
    return { ...NO_GPS };
  }
  return {
    gpsLatitude: typeof update.gpsLatitude === 'number' ? update.gpsLatitude : null,
    gpsLongitude: typeof update.gpsLongitude === 'number' ? update.gpsLongitude : null,
    gpsAccuracy: typeof update.gpsAccuracy === 'number' ? update.gpsAccuracy : null,
    distanceFromSelectedAreaFeet: photo.distanceFromSelectedAreaFeet ?? update.distanceFromSelectedAreaFeet ?? null,
  };
}
