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
import { withDraftGps, type DraftGpsFields } from './DraftPhotoGps';

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

type FixableDraft<TPhoto> = {
  selectedAreaId?: string | null;
  areaStatus?: 'confirmed' | 'suggested' | 'unknown';
  photos: TPhoto[];
};

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
