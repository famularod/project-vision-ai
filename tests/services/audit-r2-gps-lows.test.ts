/**
 * GPS review pass 1 lows (recorded 29 Sep 2026), fixed in audit round 2.
 *
 * G-L1: a fix with no usable accuracy (none, NaN, negative) counted as
 * perfectly precise, so GPS could "confirm" an area, or rule one out, from
 * a fix whose error was unknown. Save GPS already treated such a fix as
 * imprecise. Now it is never confidently inside or outside an area: the
 * nearest area can still be named as unconfirmed, never as confirmed.
 *
 * G-L2: deleting, in Manage Areas, the area an open new update had
 * accepted cleared it the way choosing "Unassigned" does, so the area row
 * read as though David had chosen Unassigned, even beside a suggestion GPS
 * still made. Now the draft goes back to no choice made.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  currentDraftAreaSuggestion,
  findClosestProjectArea,
  findProjectAreaSuggestions,
} from '../../services/AreaSuggestion';
import {
  currentDraftLocationNoticeView,
  draftAreaPresentation,
  draftLocationNoticeText,
  UNASSIGNED_AREA_NAME,
} from '../../services/DraftAreaPresentation';
import { areaChangeLocationFields, draftAfterAreaDeleted } from '../../services/DraftFix';
import { buildDAVEProjectWalkContext } from '../../services/DAVEProjectWalk';
import {
  isAreaPointImprecise,
  isConfidentlyInsideArea,
  isConfidentlyOutsideArea,
} from '../../services/GpsPrecision';
import { analyzeProjectLocationIntelligence } from '../../services/LocationIntelligenceService';
import { buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import type { ProjectArea } from '../../types';

const PROJECT = '2321 Compliance Project';
const ORIGIN = { latitude: 37.0, longitude: -122.0 };
/** A point `feet` north of the origin. */
function north(feet: number) {
  return { latitude: ORIGIN.latitude + feet / 364_000, longitude: ORIGIN.longitude };
}
function area(id: string, feetNorth: number, radiusFeet: number, extra: Partial<ProjectArea> = {}): ProjectArea {
  return {
    id,
    name: id,
    radiusFeet,
    projectName: PROJECT,
    locationCapturedAt: '2026-09-29T15:00:00Z',
    ...north(feetNorth),
    ...extra,
  };
}

/** Accuracies a phone can report that say nothing about the fix's error. */
const UNUSABLE_ACCURACIES: ReadonlyArray<[string, number | null | undefined]> = [
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['negative', -5],
  ['infinite', Number.POSITIVE_INFINITY],
];

describe('G-L1: a fix with no usable accuracy is never confidently inside or outside an area', () => {
  describe.each(UNUSABLE_ACCURACIES)('%s accuracy', (_label, accuracyMeters) => {
    it('is not confidently inside an area, even at its centre', () => {
      expect(isConfidentlyInsideArea({ distanceFeet: 0, accuracyMeters, radiusFeet: 175 })).toBe(false);
      expect(isConfidentlyInsideArea({ distanceFeet: 170, accuracyMeters, radiusFeet: 175 })).toBe(false);
    });

    it('is not confidently outside an area, even far from it', () => {
      expect(isConfidentlyOutsideArea({ distanceFeet: 2_000, accuracyMeters, radiusFeet: 175 })).toBe(false);
    });

    it('is what Save GPS already calls imprecise', () => {
      expect(isAreaPointImprecise(accuracyMeters)).toBe(true);
    });
  });

  it('leaves a precise fix inside or outside an area unchanged', () => {
    // A ten-meter fix (33 ft) 100 ft from the centre of a 175 ft area.
    expect(isConfidentlyInsideArea({ distanceFeet: 100, accuracyMeters: 10, radiusFeet: 175 })).toBe(true);
    expect(isConfidentlyOutsideArea({ distanceFeet: 100, accuracyMeters: 10, radiusFeet: 175 })).toBe(false);
    // The same fix 400 ft away: 400 - 33 is still outside.
    expect(isConfidentlyOutsideArea({ distanceFeet: 400, accuracyMeters: 10, radiusFeet: 175 })).toBe(true);
    expect(isConfidentlyInsideArea({ distanceFeet: 400, accuracyMeters: 10, radiusFeet: 175 })).toBe(false);
  });

  it('decides a fix at the edge as before', () => {
    // An exact fix (0 m) right on the edge counts as inside.
    expect(isConfidentlyInsideArea({ distanceFeet: 175, accuracyMeters: 0, radiusFeet: 175 })).toBe(true);
    expect(isConfidentlyOutsideArea({ distanceFeet: 175, accuracyMeters: 0, radiusFeet: 175 })).toBe(false);
    expect(isConfidentlyOutsideArea({ distanceFeet: 175.5, accuracyMeters: 0, radiusFeet: 175 })).toBe(true);
    // A ten-meter fix whose margin straddles the edge is neither.
    expect(isConfidentlyInsideArea({ distanceFeet: 175, accuracyMeters: 10, radiusFeet: 175 })).toBe(false);
    expect(isConfidentlyOutsideArea({ distanceFeet: 175, accuracyMeters: 10, radiusFeet: 175 })).toBe(false);
    // With no accuracy, the edge is no different from the centre.
    expect(isConfidentlyInsideArea({ distanceFeet: 175, accuracyMeters: null, radiusFeet: 175 })).toBe(false);
    expect(isConfidentlyOutsideArea({ distanceFeet: 175, accuracyMeters: null, radiusFeet: 175 })).toBe(false);
  });

  describe('the new update’s area suggestion', () => {
    const lot = area('lot', 0, 175, { name: 'North Lot' });
    const draft = (accuracy: number | null) => ({
      id: 'd1',
      gpsLatitude: north(20).latitude,
      gpsLongitude: north(20).longitude,
      gpsAccuracy: accuracy,
    });

    it.each([null, Number.NaN, -5])('does not suggest an area as confirmed from accuracy %p', accuracy => {
      const fix = { ...north(20), accuracy };
      expect(findProjectAreaSuggestions(fix, [lot], { diagnose: false })[0]?.withinRadius).toBe(false);
      expect(findClosestProjectArea(fix, [lot], { diagnose: false })?.area.id).toBe('lot');
      expect(currentDraftAreaSuggestion({ entry: null, draft: draft(accuracy), areas: [lot] })).toBeNull();
      // An entry made from that fix earlier does not confirm it either.
      expect(currentDraftAreaSuggestion({
        entry: { draftId: 'd1', suggestion: { area: lot, distanceFeet: 20, withinRadius: true } },
        draft: draft(accuracy),
        areas: [lot],
      })).toBeNull();
    });

    it('still suggests the area from a precise fix', () => {
      const suggestion = currentDraftAreaSuggestion({ entry: null, draft: draft(5), areas: [lot] });
      expect(suggestion?.area.id).toBe('lot');
      expect(suggestion?.withinRadius).toBe(true);
    });

    it('names the nearest area as unconfirmed, near it or far from it', () => {
      const near = currentDraftLocationNoticeView({ notice: null, generation: 0, draft: draft(null), areas: [lot] });
      expect(near).toMatchObject({ kind: 'unconfirmed', areaName: 'North Lot' });
      expect(draftLocationNoticeText(near!)).toBe(
        'GPS may place you in North Lot but cannot confirm it. Choose the project area.',
      );
      const far = currentDraftLocationNoticeView({
        notice: null,
        generation: 0,
        draft: { id: 'd1', gpsLatitude: north(2_000).latitude, gpsLongitude: north(2_000).longitude, gpsAccuracy: -1 },
        areas: [lot],
      });
      // Not "about 1,825 ft outside": with no accuracy GPS cannot rule the area out.
      expect(far).toMatchObject({ kind: 'unconfirmed', areaName: 'North Lot' });
    });

    it('still places a precise fix outside every area', () => {
      const far = currentDraftLocationNoticeView({
        notice: null,
        generation: 0,
        draft: { id: 'd1', gpsLatitude: north(2_000).latitude, gpsLongitude: north(2_000).longitude, gpsAccuracy: 5 },
        areas: [lot],
      });
      expect(far).toMatchObject({ kind: 'no-area', areaName: 'North Lot' });
    });
  });

  describe('the project location summary', () => {
    const lot = area('lot', 0, 175, { name: 'North Lot' });
    const now = new Date('2026-09-29T15:05:00.000Z');
    const presence = (feetNorth: number, accuracy: number | null) => analyzeProjectLocationIntelligence({
      projectName: PROJECT,
      updates: [],
      currentUpdate: {
        id: 'd1', projectName: PROJECT, date: '2026-09-29', notes: '', photos: [],
        recipients: { contactIds: [] }, selectedAreaName: 'North Lot', selectedAreaId: 'lot',
        gpsLatitude: north(feetNorth).latitude, gpsLongitude: north(feetNorth).longitude, gpsAccuracy: accuracy,
        locationCapturedAt: '2026-09-29T15:00:00.000Z',
      } as never,
      scheduleItems: [],
      projectAreas: [lot],
      now,
    }).presenceStatus;

    it('reads neither on nor off site from a fix with no usable accuracy', () => {
      expect(presence(20, null)).toBe('unknown');
      expect(presence(20, -3)).toBe('unknown');
      expect(presence(2_000, null)).toBe('unknown');
    });

    it('still reads a precise fix on or off site', () => {
      expect(presence(20, 5)).toBe('on-site');
      expect(presence(2_000, 5)).toBe('off-site');
    });
  });

  describe('evidence fusion (gpsConfirmsRecommendedArea)', () => {
    const lot = area('north', 0, 175, { name: 'North Lot' });
    const now = new Date('2026-09-29T15:05:00.000Z');
    const fused = (feetNorth: number, accuracy: number | null) => buildFusedEvidence({
      projectName: PROJECT,
      updates: [{
        id: 'u1', projectName: PROJECT, date: '2026-09-29', notes: '', photos: [],
        recipients: { contactIds: [] }, selectedAreaName: 'North Lot',
        gpsLatitude: north(feetNorth).latitude, gpsLongitude: north(feetNorth).longitude, gpsAccuracy: accuracy,
        locationCapturedAt: '2026-09-29T15:00:00.000Z',
      } as never],
      projectAreas: [lot],
      now,
    }).gpsEvidence;

    it('does not say GPS confirms the area from a fix with no usable accuracy', () => {
      const evidence = fused(20, null);
      expect(evidence.recommendedArea).toBe('North Lot');
      expect(evidence.gpsConfirmsRecommendedArea).toBe(false);
      expect(evidence.withinMappedArea).toBe(false);
      expect(evidence.confidenceScore).toBe(45);
    });

    it('does not rule out the update’s named area from a fix with no usable accuracy', () => {
      // As for a ±1,500 m fix (review pass 17): the update's own area stands, unconfirmed.
      const evidence = fused(2_000, -1);
      expect(evidence.recommendedArea).toBe('North Lot');
      expect(evidence.gpsConfirmsRecommendedArea).toBe(false);
    });

    it('still confirms the area from a precise fix inside it, and rules it out from one far outside', () => {
      expect(fused(20, 5).gpsConfirmsRecommendedArea).toBe(true);
      expect(fused(2_000, 5).recommendedArea).toBeNull();
    });
  });

  describe('the Project Walk’s likely area', () => {
    const lot = area('lot', 0, 175, { name: 'North Lot' });
    const walk = (accuracyMeters: number | null) => buildDAVEProjectWalkContext({
      projectName: PROJECT,
      projectAreas: [lot],
      updates: [],
      scheduleItems: [],
      intelligence: {
        actionCenter: {
          priority: 'Open project item', reason: 'An item is open.',
          supportingEvidence: [{ sourceType: 'update', recordId: 'u1', summary: 'Open update.' }],
          recommendedAction: 'Verify the open project item.',
        },
        dailyBrief: { uncertaintyItems: [] },
        commitments: [],
      } as never,
      now: '2026-09-29T15:05:00.000Z',
      location: { status: 'resolved', ...north(20), accuracyMeters },
    }).recommendedArea;

    it('is only medium confidence from a negative or missing accuracy', () => {
      expect(walk(-5)).toMatchObject({ id: 'lot', confidence: 'medium' });
      expect(walk(null)).toMatchObject({ id: 'lot', confidence: 'medium' });
    });

    it('is still high confidence from a precise fix', () => {
      expect(walk(5)).toMatchObject({ id: 'lot', confidence: 'high' });
    });
  });
});

describe('G-L2: deleting the draft’s accepted area is no choice made, not "chose Unassigned"', () => {
  // North Lot inside the larger Yard; the fix, 10 ft from North Lot's
  // centre at ±5 m, is confidently inside both. GPS suggested North Lot.
  const lot = area('lot', 0, 120, { name: 'North Lot' });
  const yard = area('yard', 60, 250, { name: 'Yard' });
  const gps = {
    gpsLatitude: north(10).latitude,
    gpsLongitude: north(10).longitude,
    gpsAccuracy: 5,
    locationCapturedAt: '2026-09-29T15:00:00.000Z',
  };
  const cameraPhoto = {
    id: 'p1', ...gps, distanceFromSelectedAreaFeet: 10, locationCapturedAt: '2026-09-29T15:01:00.000Z',
    selectedAreaId: 'lot', selectedAreaName: 'North Lot',
  };
  const libraryPhoto = {
    id: 'p2', pickedFromLibrary: true, gpsLatitude: null, gpsLongitude: null, gpsAccuracy: null,
    distanceFromSelectedAreaFeet: null, selectedAreaId: 'lot', selectedAreaName: 'North Lot',
  };
  type Photo = Readonly<{
    id: string;
    pickedFromLibrary?: boolean;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    gpsAccuracy: number | null;
    distanceFromSelectedAreaFeet: number | null;
    locationCapturedAt?: string | null;
    selectedAreaId: string | null;
    selectedAreaName: string | null;
  }>;
  type Draft = Readonly<{
    id: string;
    gpsLatitude: number | null;
    gpsLongitude: number | null;
    gpsAccuracy: number | null;
    distanceFromSelectedAreaFeet: number | null;
    locationCapturedAt: string | null;
    selectedAreaId: string | null;
    selectedAreaName: string | null;
    areaStatus: 'confirmed' | 'suggested' | 'unknown';
    photos: Photo[];
  }>;
  const accepted: Draft = {
    id: 'd1', ...gps, distanceFromSelectedAreaFeet: 10,
    selectedAreaId: 'lot', selectedAreaName: 'North Lot', areaStatus: 'confirmed',
    photos: [cameraPhoto, libraryPhoto],
  };
  const entry = { draftId: 'd1', suggestion: { area: lot, distanceFeet: 10, withinRadius: true } };

  /** The Add Photos area row for a draft, as App.tsx builds it. */
  function areaRow(draft: Draft, areas: ProjectArea[]) {
    return draftAreaPresentation({
      selectedArea: areas.find(item => item.id === draft.selectedAreaId) ?? null,
      selectedAreaName: draft.selectedAreaName,
      areaStatus: draft.areaStatus,
      areaSuggestion: currentDraftAreaSuggestion({ entry, draft, areas }),
      hasScheduleRecommendation: false,
      locationNotice: currentDraftLocationNoticeView({ notice: null, generation: 0, draft, areas }),
    });
  }

  it('falls back to the current suggestion when the accepted area is deleted', () => {
    expect(areaRow(accepted, [lot, yard])).toMatchObject({ areaRowName: 'North Lot', areaRowStatus: 'confirmed' });

    const after = draftAfterAreaDeleted(accepted, 'lot');
    expect(after).toMatchObject({
      selectedAreaId: null,
      selectedAreaName: UNASSIGNED_AREA_NAME,
      areaStatus: 'unknown',
      // The draft's own fix stays; its distance was to the deleted area.
      gpsLatitude: gps.gpsLatitude,
      gpsAccuracy: 5,
      locationCapturedAt: gps.locationCapturedAt,
      distanceFromSelectedAreaFeet: null,
    });
    // Its photos lose the deleted area as photos of a new draft start, and keep their own GPS.
    expect(after.photos[0]).toMatchObject({
      selectedAreaId: null, selectedAreaName: UNASSIGNED_AREA_NAME,
      gpsLatitude: gps.gpsLatitude, locationCapturedAt: '2026-09-29T15:01:00.000Z',
    });
    expect(after.photos[1]).toMatchObject({
      selectedAreaId: null, selectedAreaName: UNASSIGNED_AREA_NAME, pickedFromLibrary: true, gpsLatitude: null,
    });

    // GPS still places the fix in Yard: the row names it as a suggestion
    // to accept, rather than reading "Unassigned" beside it.
    const view = areaRow(after, [yard]);
    expect(view.areaRowName).toBe('Yard');
    expect(view.areaRowStatus).toBe('suggested');
    expect(view.offeredSuggestion?.area.id).toBe('yard');
    expect(view.reason).toBe('GPS places you in Yard. Accept it to use it for this update.');
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
  });

  it('reads plainly as no area when nothing else is suggested, and names a suggestion that appears later', () => {
    const after = draftAfterAreaDeleted(accepted, 'lot');
    const none = areaRow(after, []);
    expect(none.areaRowName).toBe(UNASSIGNED_AREA_NAME);
    expect(none.areaRowStatus).toBe('unknown');
    expect(none.offeredSuggestion).toBeNull();
    expect(none.locationNotice).toBe(
      'This project has no work area with a saved GPS point yet, so GPS cannot suggest one. Choose the project area.',
    );
    // David has not answered anything: a point saved since is named, as on a new draft.
    const later = areaRow(after, [yard]);
    expect(later).toMatchObject({ areaRowName: 'Yard', areaRowStatus: 'suggested' });
  });

  it('leaves the draft alone when a different area is deleted', () => {
    expect(draftAfterAreaDeleted(accepted, 'yard')).toBe(accepted);
    expect(areaRow(accepted, [lot])).toMatchObject({ areaRowName: 'North Lot', areaRowStatus: 'confirmed' });
  });

  it('keeps Unassigned as David’s choice when he really chose it', () => {
    // What choosing "Unassigned / Unknown Area" in the area sheet writes.
    const choseUnassigned: Draft = {
      ...accepted,
      ...areaChangeLocationFields(accepted, null),
      areaStatus: 'unknown' as const,
    };
    expect(choseUnassigned.selectedAreaName).toBeNull();
    expect(draftAfterAreaDeleted(choseUnassigned, 'lot')).toBe(choseUnassigned);
    const view = areaRow(choseUnassigned, [yard]);
    expect(view.areaRowName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.areaRowStatus).toBe('unknown');
    // The suggestion is still offered, but does not overrule his answer.
    expect(view.offeredSuggestion?.area.id).toBe('yard');
  });

  it('is what Manage Areas does to the open draft when an area is deleted', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
    const start = app.indexOf('function deleteProjectArea');
    const deletion = app.slice(start, app.indexOf('function useCurrentLocationForArea', start));
    expect(deletion).toContain('setDraft(prev => draftAfterAreaDeleted(prev, areaId));');
    expect(deletion).not.toContain("changeDraftArea('')");
  });
});
