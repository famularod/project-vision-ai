/**
 * GPS on a draft's photos.
 *
 * GPS review, 29 Sep 2026: a fix at ten-meter precision can take several
 * seconds, and photos are copied in while it is pending. A camera photo
 * without GPS takes the draft's fix, but only a recent one: a draft resumed
 * later must not put an old place on a new photo (pass 8). A photo keeps its
 * own capture time; the fix's time is not the photo's (pass 8: prior-photo
 * ordering reads it). A photo chosen from the library was taken at an
 * unknown place, so it never takes the draft's fix (pass 7).
 */
export type DraftGpsFields = Readonly<{
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  pickedFromLibrary?: boolean;
}>;

/** How old a draft's fix may be and still stand for where a photo is taken. */
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

/** The draft's fix, if it is recent enough to stand for where a photo is taken now. */
export function freshDraftGps(draft: DraftGpsFields, now: number): PhotoGpsFields | null {
  if (typeof draft.gpsLatitude !== 'number' || typeof draft.gpsLongitude !== 'number') return null;
  const fixedAt = Date.parse(draft.locationCapturedAt ?? '');
  if (!Number.isFinite(fixedAt) || now - fixedAt > DRAFT_FIX_MAX_AGE_MS) return null;
  return {
    gpsLatitude: draft.gpsLatitude,
    gpsLongitude: draft.gpsLongitude,
    gpsAccuracy: draft.gpsAccuracy ?? null,
    distanceFromSelectedAreaFeet: draft.distanceFromSelectedAreaFeet ?? null,
  };
}

/** GPS for a photo just added to a draft. */
export function newPhotoGps(draft: DraftGpsFields, now: number): PhotoGpsFields {
  return freshDraftGps(draft, now) ?? NO_GPS;
}

/** A camera photo without GPS takes the draft's recent fix; its capture time stays its own. */
export function withDraftGps<TPhoto extends DraftGpsFields>(
  photo: TPhoto,
  draft: DraftGpsFields,
  now: number,
): TPhoto {
  if (photo.pickedFromLibrary || typeof photo.gpsLatitude === 'number') return photo;
  const gps = freshDraftGps(draft, now);
  return gps ? { ...photo, ...gps } : photo;
}

/** A photo chosen from the library: where it was taken is not known. */
export function asLibraryPhoto<TPhoto extends DraftGpsFields>(photo: TPhoto): TPhoto {
  return { ...photo, pickedFromLibrary: true, ...NO_GPS };
}

/**
 * The draft's area and location onto a photo after an area change: all of
 * it for a camera photo, the area alone for a library photo. A photo keeps
 * its own capture time (pass 8; an area change used to wipe or replace it).
 */
export function withDraftLocation<TPhoto extends DraftGpsFields & Readonly<{
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
}>>(
  photo: TPhoto,
  fields: DraftGpsFields & Readonly<{ selectedAreaId: string | null; selectedAreaName: string | null }>,
): TPhoto {
  if (photo.pickedFromLibrary) {
    return { ...photo, selectedAreaId: fields.selectedAreaId, selectedAreaName: fields.selectedAreaName };
  }
  return {
    ...photo,
    ...fields,
    locationCapturedAt: photo.locationCapturedAt ?? fields.locationCapturedAt ?? null,
  };
}

/**
 * A photo's GPS for reports and analysis: its own, else the update's, but
 * never the update's for a library photo (pass 8: derived views showed a
 * library photo at the update's place).
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
  if (photo.pickedFromLibrary) return { ...NO_GPS };
  return {
    gpsLatitude: typeof update.gpsLatitude === 'number' ? update.gpsLatitude : null,
    gpsLongitude: typeof update.gpsLongitude === 'number' ? update.gpsLongitude : null,
    gpsAccuracy: typeof update.gpsAccuracy === 'number' ? update.gpsAccuracy : null,
    distanceFromSelectedAreaFeet: photo.distanceFromSelectedAreaFeet ?? update.distanceFromSelectedAreaFeet ?? null,
  };
}
