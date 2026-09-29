/**
 * GPS for a draft's photos that were added before its fix landed.
 *
 * GPS review, 29 Sep 2026: a fix at ten-meter precision can take several
 * seconds, and photos (several, for a library pick) are copied in while it
 * is pending. A photo keeps GPS it already has; one without takes the
 * draft's, if the draft has a fix.
 */
export type DraftGpsFields = Readonly<{
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
}>;

export function withDraftGps<TPhoto extends DraftGpsFields>(
  photo: TPhoto,
  draft: DraftGpsFields,
): TPhoto {
  if (
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
