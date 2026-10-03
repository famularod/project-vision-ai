/**
 * Writing a landed GPS fix into its draft.
 *
 * GPS review, 29 Sep 2026: before pass 2 every fix was discarded; since
 * then the write has been refined by passes 2-8. It writes GPS only, so the
 * draft keeps its own area (a task's named location that is not a mapped
 * area) and a confirmed status; camera photos without GPS take the fix; a
 * reliable suggestion marks an unconfirmed draft 'suggested'.
 */
import type { AreaSuggestion, ProjectArea } from '../types';
import { distanceBetweenCoordinatesFeet, hasSavedAreaLocation } from './AreaSuggestion';
import { UNASSIGNED_AREA_NAME } from './DraftAreaPresentation';
import { withDraftGps, withDraftLocation, type DraftGpsFields } from './DraftPhotoGps';

export type LocationFix = Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}>;

/** A draft's location fields for a fix, measured against its selected area. */
export function draftLocationFields(fix: LocationFix, selectedArea?: ProjectArea | null) {
  const distance =
    selectedArea && hasSavedAreaLocation(selectedArea)
      ? distanceBetweenCoordinatesFeet(fix, selectedArea)
      : null;

  return {
    selectedAreaId: selectedArea?.id || null,
    selectedAreaName: selectedArea?.name || null,
    gpsLatitude: fix.latitude,
    gpsLongitude: fix.longitude,
    gpsAccuracy: fix.accuracy,
    distanceFromSelectedAreaFeet: distance,
    locationCapturedAt: fix.capturedAt,
  };
}

/**
 * A draft's location fields after its area changes: the given fix, else the
 * draft's own fix, measured against the new area. The draft's own fix keeps
 * its own time; one without a time is not stamped "now" (review pass 11:
 * that let an old fix cover new photos).
 */
export function areaChangeLocationFields(
  draft: Readonly<{
    gpsLatitude?: number | null;
    gpsLongitude?: number | null;
    gpsAccuracy?: number | null;
    locationCapturedAt?: string | null;
  }>,
  area: ProjectArea | null,
  fix?: LocationFix | null,
) {
  if (fix) return draftLocationFields(fix, area);
  if (typeof draft.gpsLatitude === 'number' && typeof draft.gpsLongitude === 'number') {
    return {
      ...draftLocationFields({
        latitude: draft.gpsLatitude,
        longitude: draft.gpsLongitude,
        accuracy: draft.gpsAccuracy ?? null,
        capturedAt: '',
      }, area),
      locationCapturedAt: draft.locationCapturedAt || null,
    };
  }
  return {
    selectedAreaId: area?.id || null,
    selectedAreaName: area?.name || null,
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAccuracy: null,
    distanceFromSelectedAreaFeet: null,
    locationCapturedAt: draft.locationCapturedAt || null,
  };
}

type FixableDraft<TPhoto> = {
  selectedAreaId?: string | null;
  areaStatus?: 'confirmed' | 'suggested' | 'unknown';
  photos: TPhoto[];
};

type AreaPhoto = DraftGpsFields & Readonly<{ selectedAreaId?: string | null; selectedAreaName?: string | null }>;

/**
 * The draft after a project area is deleted (GPS review pass 1 low, G-L2).
 * When it was the draft's area, the draft goes back to no choice made, as a
 * new draft starts: no area, the placeholder name and an unknown status, so
 * the current suggestion, if any, is offered and named again. Deleting it
 * used to clear the area the way choosing Unassigned does, and the area row
 * then read as though David had chosen Unassigned. Any other area, or a
 * draft whose Unassigned David chose, is unchanged.
 */
export function draftAfterAreaDeleted<
  TPhoto extends AreaPhoto,
  TDraft extends FixableDraft<TPhoto> & DraftGpsFields & { selectedAreaName?: string | null },
>(draft: TDraft, areaId: string): TDraft {
  if (!areaId || draft.selectedAreaId !== areaId) return draft;
  const fields = { ...areaChangeLocationFields(draft, null), selectedAreaName: UNASSIGNED_AREA_NAME };
  return {
    ...draft,
    ...fields,
    areaStatus: 'unknown',
    photos: draft.photos.map(photo => withDraftLocation(photo, fields)),
  };
}

/** The GPS fields a landed fix writes onto its draft. */
export type DraftFixFields = {
  gpsLatitude: number;
  gpsLongitude: number;
  gpsAccuracy: number | null;
  distanceFromSelectedAreaFeet: number | null;
  locationCapturedAt: string;
};

export function applyFixToDraft<TPhoto extends DraftGpsFields, TDraft extends FixableDraft<TPhoto>>(input: Readonly<{
  draft: TDraft;
  fix: LocationFix;
  areas: readonly ProjectArea[];
  reliableSuggestion: AreaSuggestion | null;
  now: number;
}>): TDraft & DraftFixFields {
  const { draft } = input;
  const selectedArea = input.areas.find(area => area.id === draft.selectedAreaId) || null;
  const {
    selectedAreaId: _areaId,
    selectedAreaName: _areaName,
    ...gpsFields
  } = draftLocationFields(input.fix, selectedArea);

  return {
    ...draft,
    ...gpsFields,
    photos: draft.photos.map(photo => withDraftGps(photo, gpsFields)),
    areaStatus:
      draft.areaStatus === 'confirmed' || selectedArea
        ? 'confirmed'
        : input.reliableSuggestion
          ? 'suggested'
          : draft.areaStatus,
  };
}
