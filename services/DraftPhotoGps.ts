/**
 * GPS for a draft's photos that were added before its fix landed.
 *
 * GPS review, 29 Sep 2026: a fix at ten-meter precision can take several
 * seconds, and photos are copied in while it is pending. A camera photo
 * keeps GPS it already has; one without takes the draft's, if the draft has
 * a fix. A photo chosen from the library was taken at an unknown place and
 * time, so it never takes the draft's fix (review pass 7).
 */
export type DraftGpsFields = Readonly<{
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
  pickedFromLibrary?: boolean;
}>;

export function withDraftGps<TPhoto extends DraftGpsFields>(
  photo: TPhoto,
  draft: DraftGpsFields,
): TPhoto {
  if (
    photo.pickedFromLibrary ||
    typeof photo.gpsLatitude === 'number' ||
    typeof draft.gpsLatitude !== 'number' ||
    typeof draft.gpsLongitude !== 'number'
  ) {
    return photo;
  }
  return {
    ...photo,
    gpsLatitude: draft.gpsLatitude,
    gpsLongitude: draft.gpsLongitude,
    gpsAccuracy: draft.gpsAccuracy ?? null,
    distanceFromSelectedAreaFeet: draft.distanceFromSelectedAreaFeet ?? null,
    locationCapturedAt: draft.locationCapturedAt ?? photo.locationCapturedAt ?? null,
  };
}

/** A photo chosen from the library: no GPS of its own is known. */
export function asLibraryPhoto<TPhoto extends DraftGpsFields>(photo: TPhoto): TPhoto {
  return {
    ...photo,
    pickedFromLibrary: true,
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAccuracy: null,
    distanceFromSelectedAreaFeet: null,
  };
}

/**
 * The draft's area and location onto a photo after an area change: all of
 * it for a camera photo, the area alone for a library photo.
 */
export function withDraftLocation<TPhoto extends DraftGpsFields & Readonly<{
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
}>>(
  photo: TPhoto,
  fields: DraftGpsFields & Readonly<{ selectedAreaId: string | null; selectedAreaName: string | null }>,
): TPhoto {
  return photo.pickedFromLibrary
    ? { ...photo, selectedAreaId: fields.selectedAreaId, selectedAreaName: fields.selectedAreaName }
    : { ...photo, ...fields };
}
