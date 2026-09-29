/**
 * GPS review, 29 Sep 2026: the rules seven review passes settled, tested as
 * behaviour (pass 7 showed source-text checks let real regressions through).
 */
import {
  currentDraftAreaSuggestion,
  distanceBetweenCoordinatesFeet,
  findClosestProjectArea,
  findProjectAreaSuggestions,
} from '../../services/AreaSuggestion';
import { draftAreaPresentation, UNASSIGNED_AREA_NAME } from '../../services/DraftAreaPresentation';
import { createDraftFixTracker, createKeyedInFlight } from '../../services/DraftFixTracker';
import { asLibraryPhoto, withDraftGps, withDraftLocation } from '../../services/DraftPhotoGps';
import { createRecentLocationFix } from '../../services/RecentLocationFix';
import type { AreaSuggestion, ProjectArea } from '../../types';

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
    locationCapturedAt: '2026-09-29T15:00:00Z',
    ...north(feetNorth),
    ...extra,
  };
}

describe('which area a fix places you in', () => {
  it('measures distance in feet', () => {
    expect(distanceBetweenCoordinatesFeet(ORIGIN, north(100))).toBeCloseTo(100, 0);
  });

  it('ignores areas with no saved point and sorts by distance', () => {
    const areas = [area('far', 300, 250), area('near', 50, 250), area('unsaved', 0, 250, { locationCapturedAt: null })];
    expect(findProjectAreaSuggestions({ ...ORIGIN, accuracy: 5 }, areas).map(item => item.area.id)).toEqual(['near', 'far']);
    expect(findProjectAreaSuggestions(null, areas)).toEqual([]);
  });

  // Review pass 3: a small nearby area must not hide a larger one you are inside.
  it('chooses the nearest area that contains you, else the nearest', () => {
    const trailer = area('trailer', 90, 100);
    const yard = area('yard', 150, 250);
    const fix = { ...ORIGIN, accuracy: 10 }; // 33 ft
    expect(findClosestProjectArea(fix, [trailer, yard])?.area.id).toBe('yard');
    expect(findClosestProjectArea(fix, [trailer])).toMatchObject({ area: { id: 'trailer' }, withinRadius: false });
  });

  it('treats accuracy as meters: a ±65 m fix is not inside a 175 ft area even at its centre', () => {
    expect(findClosestProjectArea({ ...ORIGIN, accuracy: 65 }, [area('lot', 0, 175)])?.withinRadius).toBe(false);
    expect(findClosestProjectArea({ ...ORIGIN, accuracy: 10 }, [area('lot', 100, 175)])?.withinRadius).toBe(true);
  });
});

describe('the draft’s suggestion as it stands now', () => {
  const lot = area('lot', 50, 175);
  const entry = { draftId: 'd1', suggestion: { area: lot, distanceFeet: 50, withinRadius: true } };
  const draft = { id: 'd1', gpsLatitude: ORIGIN.latitude, gpsLongitude: ORIGIN.longitude, gpsAccuracy: 5 };

  it('is shown only on the draft that produced it (pass 3)', () => {
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [lot] })?.area.id).toBe('lot');
    expect(currentDraftAreaSuggestion({ entry, draft: { ...draft, id: 'd2' }, areas: [lot] })).toBeNull();
    expect(currentDraftAreaSuggestion({ entry: null, draft, areas: [lot] })).toBeNull();
  });

  it('disappears when the area is deleted or loses its point (pass 4)', () => {
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [] })).toBeNull();
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [{ ...lot, locationCapturedAt: null }] })).toBeNull();
  });

  it('follows the area’s current point and radius, and the draft’s fix (pass 5)', () => {
    const renamed = { ...lot, name: 'North Lot' };
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [renamed] })?.area.name).toBe('North Lot');
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [area('lot', 400, 175)] })).toBeNull();
    expect(currentDraftAreaSuggestion({ entry, draft, areas: [{ ...lot, radiusFeet: 40 }] })).toBeNull();
    expect(currentDraftAreaSuggestion({ entry, draft: { ...draft, gpsLatitude: null }, areas: [lot] })).toBeNull();
  });
});

describe('what Add Photos says about the area', () => {
  const lot = area('lot', 50, 175, { name: 'North Lot' });
  const south = area('south', 900, 175, { name: 'South Lot' });
  const suggestion: AreaSuggestion = { area: lot, distanceFeet: 50, withinRadius: true };
  const base = { hasScheduleRecommendation: false };

  it('names a pending suggestion without making it the current area (pass 4)', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: null, selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'suggested', areaSuggestion: suggestion,
    });
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.offeredSuggestion?.area.name).toBe('North Lot');
    expect(view.areaRowName).toBe('North Lot');
    expect(view.areaRowStatus).toBe('suggested');
    expect(view.reason).toBe('GPS places you in North Lot. Accept it to use it for this update.');
    expect(view.confidenceScore).toBeGreaterThanOrEqual(60);
  });

  it('after Accept, calls it auto-detected with the GPS reason', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: lot, selectedAreaName: 'North Lot', areaStatus: 'confirmed', areaSuggestion: suggestion,
    });
    expect(view.areaName).toBe('North Lot');
    expect(view.offeredSuggestion).toBeNull();
    expect(view.areaRowStatus).toBe('confirmed');
    expect(view.reason).toBe('GPS places you inside this saved area.');
    expect(view.confidenceScore).toBe(90);
  });

  // Pass 5: a rejected suggestion never reads as the current area.
  it('after rejecting (Unassigned), shows Unassigned and keeps offering the suggestion', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: null, selectedAreaName: null, areaStatus: 'unknown', areaSuggestion: suggestion,
    });
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.areaRowName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.areaRowStatus).toBe('unknown');
    expect(view.offeredSuggestion?.area.id).toBe('lot');
  });

  // Pass 6: a manual pick is a selected area, not auto-detected.
  it('calls a manual pick a selected area and still offers the suggestion', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: south, selectedAreaName: 'South Lot', areaStatus: 'confirmed', areaSuggestion: suggestion,
    });
    expect(view.areaName).toBe('South Lot');
    expect(view.areaRowStatus).toBe('unknown');
    expect(view.reason).toBe('This is your current confirmed selection.');
    expect(view.offeredSuggestion?.area.id).toBe('lot');
  });

  it('keeps a task’s named location and does not claim GPS for it', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: null, selectedAreaName: 'Building 3', areaStatus: 'confirmed', areaSuggestion: suggestion,
    });
    expect(view.areaName).toBe('Building 3');
    expect(view.areaRowName).toBe('Building 3');
    expect(view.areaRowStatus).toBe('unknown');
  });

  // Pass 5: "Area suggested" only while something is suggested.
  it('does not say "suggested" when the suggestion is gone', () => {
    const view = draftAreaPresentation({
      ...base, selectedArea: null, selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'suggested', areaSuggestion: null,
    });
    expect(view.areaRowStatus).toBe('unknown');
    expect(view.areaRowName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.offeredSuggestion).toBeNull();
    expect(view.confidenceScore).toBeLessThan(60);
  });

  it('uses the schedule reason with no GPS, and lowers confidence after corrections', () => {
    const view = draftAreaPresentation({
      selectedArea: null, selectedAreaName: null, areaSuggestion: null, hasScheduleRecommendation: true,
    });
    expect(view.reason).toBe('The imported schedule identifies this as the most urgent area.');
    const corrected = draftAreaPresentation({
      ...base, selectedArea: lot, areaSuggestion: suggestion, correctionPenalty: 40,
    });
    expect(corrected.confidenceScore).toBe(50);
  });
});

describe('fix bookkeeping', () => {
  it('drops a pending fix at save and reports it only for that draft (passes 3, 5)', () => {
    const tracker = createDraftFixTracker();
    const first = tracker.start('d1');
    expect(tracker.pendingDraftId()).toBe('d1');
    expect(tracker.beginSave('d2')).toBe(false);
    expect(tracker.generation()).not.toBe(first);
    expect(tracker.pendingDraftId()).toBeNull();

    tracker.start('d1');
    expect(tracker.beginSave('d1')).toBe(true);
    expect(tracker.beginSave('d1')).toBe(false);
  });

  it('keeps a fix pending until it is settled by its own generation (pass 6)', () => {
    const tracker = createDraftFixTracker();
    const older = tracker.start('d1');
    const newer = tracker.start('d2');
    tracker.settle(older);
    expect(tracker.pendingDraftId()).toBe('d2');
    tracker.settle(newer);
    expect(tracker.pendingDraftId()).toBeNull();
  });

  it('runs one Save GPS fix per area at a time (pass 1)', () => {
    const inFlight = createKeyedInFlight();
    expect(inFlight.tryStart('a')).toBe(true);
    expect(inFlight.tryStart('a')).toBe(false);
    expect(inFlight.tryStart('b')).toBe(true);
    inFlight.finish('a');
    expect(inFlight.tryStart('a')).toBe(true);
  });
});

describe('photo GPS', () => {
  const fix = {
    gpsLatitude: 37.1, gpsLongitude: -121.9, gpsAccuracy: 4, distanceFromSelectedAreaFeet: 30,
    locationCapturedAt: '2026-09-29T15:00:00Z',
  };

  // Review pass 7: a library photo was taken at an unknown place and time.
  it('never gives a library photo the draft’s fix', () => {
    const picked = asLibraryPhoto({ id: 'p1', ...fix });
    expect(picked).toMatchObject({ pickedFromLibrary: true, gpsLatitude: null, gpsLongitude: null, gpsAccuracy: null });
    expect(withDraftGps(picked, fix)).toBe(picked);
    const moved = withDraftLocation(picked, { ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot' });
    expect(moved).toMatchObject({ selectedAreaId: 'lot', selectedAreaName: 'North Lot', gpsLatitude: null });
  });

  it('gives a camera photo the draft’s area and location', () => {
    const camera = { id: 'p2', gpsLatitude: null, gpsLongitude: null };
    expect(withDraftGps(camera, fix)).toMatchObject(fix);
    expect(withDraftLocation(camera, { ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot' }))
      .toMatchObject({ ...fix, selectedAreaId: 'lot' });
  });
});

describe('a shared home-screen fix', () => {
  // Review pass 7: a poor fix served only its caller, not the next minute.
  it('reuses only a fix good enough to place you in an area', async () => {
    const takeFix = jest.fn()
      .mockResolvedValueOnce({ accuracy: 200 })
      .mockResolvedValueOnce({ accuracy: 5 });
    const recent = createRecentLocationFix<{ accuracy: number }>(takeFix, 60_000, {
      now: () => 0,
      keep: fix => fix.accuracy <= 20,
    });
    await recent.get();
    expect(recent.fresh()).toBeNull();
    await recent.get();
    expect(recent.fresh()).toEqual({ fix: { accuracy: 5 } });
    await recent.get();
    expect(takeFix).toHaveBeenCalledTimes(2);
  });
});
