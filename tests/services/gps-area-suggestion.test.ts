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
import { applyFixToDraft, areaChangeLocationFields } from '../../services/DraftFix';
import { buildFusedEvidence, extractGPSEvidence, findEvidenceConflicts } from '../../services/PIEEvidenceFusion';
import {
  asLibraryPhoto,
  DRAFT_FIX_MAX_AGE_MS,
  fixCoversPhoto,
  newPhotoGps,
  photoGpsOrUpdate,
  withDraftGps,
  withDraftLocation,
} from '../../services/DraftPhotoGps';
import { areaGpsSaveDecision, overviewFixMaxAgeMs } from '../../services/GpsPrecision';
import { analyzeProjectLocationIntelligence } from '../../services/LocationIntelligenceService';
import { inferViewpoint } from '../../services/PIEPhotoProgressIntelligence';
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
  const fixedAt = Date.parse(fix.locationCapturedAt);

  // Review pass 7: a library photo was taken at an unknown place.
  it('never gives a library photo the draft’s fix, in storage or in reports', () => {
    const picked = asLibraryPhoto({ id: 'p1', ...fix });
    expect(picked).toMatchObject({ pickedFromLibrary: true, gpsLatitude: null, gpsLongitude: null, gpsAccuracy: null });
    expect(withDraftGps(picked, fix)).toBe(picked);
    const moved = withDraftLocation(picked, { ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot' });
    expect(moved).toMatchObject({ selectedAreaId: 'lot', selectedAreaName: 'North Lot', gpsLatitude: null });
    // Pass 8: derived views used to fall back to the update's GPS.
    expect(photoGpsOrUpdate(picked, fix)).toMatchObject({ gpsLatitude: null, gpsLongitude: null });
    expect(photoGpsOrUpdate({ gpsLatitude: null }, fix)).toMatchObject({ gpsLatitude: 37.1, gpsLongitude: -121.9 });
  });

  it('gives a camera photo the draft’s area and location but keeps its own capture time', () => {
    const camera = { id: 'p2', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: '2026-09-29T15:10:00Z' };
    expect(withDraftGps(camera, fix)).toMatchObject({ gpsLatitude: 37.1, locationCapturedAt: '2026-09-29T15:10:00Z' });
    expect(withDraftLocation(camera, { ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot' }))
      .toMatchObject({ gpsLatitude: 37.1, selectedAreaId: 'lot', locationCapturedAt: '2026-09-29T15:10:00Z' });
    // Pass 10: a photo with no time of its own (older data) takes the area,
    // not the fix; with no fix at all it keeps its own GPS.
    const olderPhoto: { id: string; gpsLatitude?: number | null; locationCapturedAt?: string | null } = { id: 'p3' };
    expect(withDraftLocation(olderPhoto, { ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot' }))
      .toEqual({ id: 'p3', selectedAreaId: 'lot', selectedAreaName: 'North Lot', distanceFromSelectedAreaFeet: null });
    expect(withDraftGps(olderPhoto, fix)).toBe(olderPhoto);
    const ownGps = { id: 'p5', gpsLatitude: 36.5, gpsLongitude: -121.5, locationCapturedAt: '2026-09-29T15:10:00Z' };
    expect(withDraftLocation(ownGps, {
      gpsLatitude: null, gpsLongitude: null, locationCapturedAt: null, selectedAreaId: 'lot', selectedAreaName: 'North Lot',
    })).toMatchObject({ gpsLatitude: 36.5, selectedAreaId: 'lot' });
  });

  // Passes 8-9: a fix stands for a photo only within 30 minutes of the
  // photo's own time, wherever photo GPS is written or read.
  it('uses the draft’s fix only for photos taken within 30 minutes of it', () => {
    const later = (ms: number) => new Date(fixedAt + ms).toISOString();
    expect(fixCoversPhoto(later(DRAFT_FIX_MAX_AGE_MS), fix.locationCapturedAt)).toBe(true);
    expect(fixCoversPhoto(later(DRAFT_FIX_MAX_AGE_MS + 1), fix.locationCapturedAt)).toBe(false);
    expect(fixCoversPhoto(later(-5_000), fix.locationCapturedAt)).toBe(true);
    // Pass 10: writing GPS needs both times; reading older records without
    // a time keeps the previous behaviour.
    expect(fixCoversPhoto(null, fix.locationCapturedAt)).toBe(false);
    expect(fixCoversPhoto(later(0), null)).toBe(false);
    expect(photoGpsOrUpdate({ gpsLatitude: null }, fix).gpsLatitude).toBe(37.1);
    expect(photoGpsOrUpdate({ gpsLatitude: null, locationCapturedAt: later(0) }, { ...fix, locationCapturedAt: null }).gpsLatitude)
      .toBe(37.1);

    expect(newPhotoGps(fix, fixedAt + DRAFT_FIX_MAX_AGE_MS).gpsLatitude).toBe(37.1);
    expect(newPhotoGps(fix, fixedAt + DRAFT_FIX_MAX_AGE_MS + 1).gpsLatitude).toBeNull();

    const twoHoursLater = { id: 'p4', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: later(2 * 3600_000) };
    expect(withDraftGps(twoHoursLater, fix).gpsLatitude).toBeNull();
    // An area change does not bring the old fix back, and drops the old distance.
    expect(withDraftLocation({ ...twoHoursLater, distanceFromSelectedAreaFeet: 90 }, {
      ...fix, selectedAreaId: 'lot', selectedAreaName: 'North Lot',
    })).toMatchObject({ selectedAreaId: 'lot', gpsLatitude: null, distanceFromSelectedAreaFeet: null });
    // Reports do not place it at the old fix either.
    expect(photoGpsOrUpdate(twoHoursLater, fix).gpsLatitude).toBeNull();
  });
});

// The pass-2 fix: a landed fix is written into its draft, GPS only.
describe('a landed fix written into its draft', () => {
  const lot = area('lot', 50, 175, { name: 'North Lot' });
  const fixAt = '2026-09-29T15:00:00.000Z';
  const now = Date.parse(fixAt) + 5_000;
  const fix = { ...ORIGIN, accuracy: 5, capturedAt: fixAt };
  const suggestion: AreaSuggestion = { area: lot, distanceFeet: 50, withinRadius: true };
  const photo = (id: string, extra: Record<string, unknown> = {}) => ({
    id, gpsLatitude: null as number | null, gpsLongitude: null as number | null, locationCapturedAt: '2026-09-29T14:59:59Z', ...extra,
  });

  it('marks a new draft suggested, fills photos without GPS, and keeps the placeholder area', () => {
    const draft = {
      id: 'd1', selectedAreaId: null, selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'unknown' as const,
      photos: [photo('p1'), photo('p2', { pickedFromLibrary: true }), photo('p3', { gpsLatitude: 36.9, gpsLongitude: -122.1 })],
    };
    const next = applyFixToDraft({ draft, fix, areas: [lot], reliableSuggestion: suggestion, now });
    expect(next).toMatchObject({
      selectedAreaId: null,
      selectedAreaName: UNASSIGNED_AREA_NAME,
      areaStatus: 'suggested',
      gpsLatitude: ORIGIN.latitude,
      gpsAccuracy: 5,
      locationCapturedAt: fixAt,
      distanceFromSelectedAreaFeet: null,
    });
    expect(next.photos[0]).toMatchObject({ gpsLatitude: ORIGIN.latitude, locationCapturedAt: '2026-09-29T14:59:59Z' });
    expect(next.photos[1].gpsLatitude).toBeNull();
    expect(next.photos[2].gpsLatitude).toBe(36.9);
  });

  it('keeps a task’s named location and its confirmed status', () => {
    const draft = {
      id: 'd2', selectedAreaId: null, selectedAreaName: 'Building 3', areaStatus: 'confirmed' as const, photos: [],
    };
    const next = applyFixToDraft({ draft, fix, areas: [lot], reliableSuggestion: suggestion, now });
    expect(next).toMatchObject({ selectedAreaName: 'Building 3', areaStatus: 'confirmed' });
  });

  it('measures the distance to a selected mapped area and confirms it', () => {
    const draft = { id: 'd3', selectedAreaId: 'lot', selectedAreaName: 'North Lot', areaStatus: 'unknown' as const, photos: [] };
    const next = applyFixToDraft({ draft, fix, areas: [lot], reliableSuggestion: null, now });
    expect(next.areaStatus).toBe('confirmed');
    expect(next.distanceFromSelectedAreaFeet).toBeCloseTo(50, 0);
    expect(next.selectedAreaId).toBe('lot');
  });

  it('leaves the status alone when nothing is suggested', () => {
    const draft = { id: 'd4', selectedAreaId: null, selectedAreaName: null, areaStatus: 'unknown' as const, photos: [] };
    expect(applyFixToDraft({ draft, fix, areas: [lot], reliableSuggestion: null, now }).areaStatus).toBe('unknown');
  });
});

describe('a shared home-screen fix', () => {
  // Passes 7-8: a poor fix is reused briefly, not for a minute and not never.
  it('reuses a precise fix for a minute and a poor one for 15 s', async () => {
    expect(overviewFixMaxAgeMs(5)).toBe(60_000);
    expect(overviewFixMaxAgeMs(60)).toBe(15_000);
    expect(overviewFixMaxAgeMs(null)).toBe(15_000);
    let clock = 0;
    const takeFix = jest.fn()
      .mockResolvedValueOnce({ accuracy: 60 })
      .mockResolvedValueOnce({ accuracy: 5 });
    const recent = createRecentLocationFix<{ accuracy: number }>(takeFix, 60_000, {
      now: () => clock,
      maxAgeFor: fix => overviewFixMaxAgeMs(fix.accuracy),
    });
    await recent.get();
    clock = 14_000;
    expect(recent.fresh()).toEqual({ fix: { accuracy: 60 } });
    clock = 16_000;
    expect(recent.fresh()).toBeNull();
    await recent.get();
    clock = 16_000 + 59_000;
    expect(recent.fresh()).toEqual({ fix: { accuracy: 5 } });
    expect(takeFix).toHaveBeenCalledTimes(2);
  });
});

// Review pass 9.
describe('photos and the project’s location', () => {
  it('does not let a library photo added last displace the update’s fix', () => {
    const update = {
      id: 'u1',
      projectName: '2321 Compliance Project',
      date: '2026-09-29',
      notes: '',
      recipients: { contactIds: [] },
      selectedAreaName: 'North Lot',
      gpsLatitude: 37.1,
      gpsLongitude: -121.9,
      gpsAccuracy: 5,
      locationCapturedAt: '2026-09-29T15:00:00.000Z',
      photos: [{
        id: 'p1', uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '',
        actionDueDate: '', actionStatus: 'Open', pickedFromLibrary: true,
        gpsLatitude: null, gpsLongitude: null, locationCapturedAt: '2026-09-29T15:20:00.000Z',
      }],
    };
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project',
      updates: [update as never],
      scheduleItems: [],
      now: new Date('2026-09-29T15:21:00.000Z'),
    });
    expect(summary.gpsStatus).toBe('Captured, accuracy ±16 ft');
  });

  // Pass 10: without a fix, a library-only update still gives its area.
  it('keeps the area of a later library-only update that has no fix', () => {
    const photoAt = (id: string, time: string, extra: Record<string, unknown> = {}) => ({
      id, uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '',
      actionDueDate: '', actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: time, ...extra,
    });
    const morning = {
      id: 'u1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '',
      recipients: { contactIds: [] }, selectedAreaName: 'Area A',
      photos: [photoAt('p1', '2026-09-29T17:00:00.000Z')],
    };
    const later = {
      id: 'u2', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '',
      recipients: { contactIds: [] }, selectedAreaName: 'Area B',
      photos: [photoAt('p2', '2026-09-29T18:00:00.000Z', { pickedFromLibrary: true })],
    };
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project',
      updates: [morning as never, later as never],
      scheduleItems: [],
    });
    expect(summary.currentArea).toBe('Area B');
  });

  it('groups photos of one spot into one sequence whatever each fix said', () => {
    expect(inferViewpoint({ projectName: '2321' }, 'Canopy', 'North Lot'))
      .toBe(inferViewpoint({ projectName: '2321' }, 'Canopy', 'North Lot'));
    expect(inferViewpoint({ projectName: '2321' }, 'Canopy', 'North Lot')).toMatch(/:no-gps$/);
  });
});

// Review pass 11 (the desktop flag test is in dave-web-read-only-repository.test.ts).
describe('late photos and the project’s location', () => {
  const summaryWithPhotoAt = (photoTime: string) => analyzeProjectLocationIntelligence({
    now: new Date(Date.parse(photoTime) + 60_000),
    projectAreas: [{
      id: 'north', name: 'North Lot', projectName: '2321 Compliance Project', radiusFeet: 175,
      latitude: 37.1, longitude: -121.9, locationCapturedAt: '2026-09-20T15:00:00Z',
    }],
    projectName: '2321 Compliance Project',
    updates: [{
      id: 'u1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '',
      recipients: { contactIds: [] }, selectedAreaName: 'North Lot',
      gpsLatitude: 37.1, gpsLongitude: -121.9, gpsAccuracy: 5, locationCapturedAt: '2026-09-29T15:00:00.000Z',
      photos: [{
        id: 'p1', uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '',
        actionDueDate: '', actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: photoTime,
      }],
    } as never],
    scheduleItems: [],
  });

  // Pass 11: a photo without GPS of its own is not location evidence.
  it('keeps the fix as current while the update’s activity is within 30 minutes of it', () => {
    const summary = summaryWithPhotoAt('2026-09-29T15:20:00.000Z');
    expect(summary.gpsStatus).toBe('Captured, accuracy ±16 ft');
    expect(summary.needsConfirmation).toBe(false);
  });

  // Pass 13: later, the update still gives its area, but its fix is not
  // claimed as your current GPS.
  it('keeps the area but not the fix as current after 30 minutes', () => {
    const summary = summaryWithPhotoAt('2026-09-29T15:45:00.000Z');
    expect(summary.currentArea).toBe('North Lot');
    expect(summary.gpsStatus).not.toMatch(/^Captured/);
  });

  // Passes 13 and 15: a fix says where you are only while it is recent.
  it('does not show yesterday’s fix as current GPS, and asks to confirm the area', () => {
    const photo = (id: string, time: string, extra: Record<string, unknown> = {}) => ({
      id, uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
      actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: time, ...extra,
    });
    const yesterday = {
      id: 'u-old', projectName: '2321 Compliance Project', date: '2026-09-28', notes: '',
      recipients: { contactIds: [] }, selectedAreaName: 'North Lot',
      gpsLatitude: 37.1, gpsLongitude: -121.9, gpsAccuracy: 5, locationCapturedAt: '2026-09-28T16:00:00.000Z',
      photos: [photo('p1', '2026-09-28T16:05:00.000Z')],
    };
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project',
      updates: [yesterday as never],
      scheduleItems: [],
      now: new Date('2026-09-29T15:00:00.000Z'),
    });
    expect(summary.currentArea).toBe('North Lot');
    expect(summary.gpsStatus).not.toMatch(/^Captured/);
    expect(summary.presenceStatus).toBe('unknown');
    expect(summary.needsConfirmation).toBe(true);
    expect(summary.confirmationPrompt).toBe("I believe you're at North Lot. Is that correct?");
  });
});

describe('evidence fusion’s area match', () => {
  const base = { projectName: '2321 Compliance Project', updates: [], scheduleEvidence: [] };
  const gpsUpdate = (accuracy: number) => ({
    id: 'u1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
    recipients: { contactIds: [] }, selectedAreaName: 'Yard', ...north(150), gpsLatitude: north(150).latitude,
    gpsLongitude: north(150).longitude, gpsAccuracy: accuracy, locationCapturedAt: '2026-09-29T15:00:00Z',
  });

  it('needs the fix confidently inside the area, and ignores areas without a saved point', () => {
    const lot = area('lot', 0, 175, { name: 'North Lot' });
    const unsaved = area('unsaved', 150, 250, { name: 'Unsaved', locationCapturedAt: null });
    const sloppy = extractGPSEvidence({ ...base, updates: [gpsUpdate(30) as never], projectAreas: [lot, unsaved] });
    expect(sloppy.nearestMappedArea).toBe('North Lot');
    expect(sloppy.withinMappedArea).toBe(false);
    const precise = extractGPSEvidence({ ...base, updates: [gpsUpdate(3) as never], projectAreas: [lot, unsaved] });
    expect(precise.withinMappedArea).toBe(true);
  });
});

describe('Save GPS and area changes', () => {
  it('decides what Save GPS does with a fix', () => {
    expect(areaGpsSaveDecision(null)).toBe('location-denied');
    expect(areaGpsSaveDecision({ accuracy: 3, preciseLocationOff: true })).toBe('precise-off');
    expect(areaGpsSaveDecision({ accuracy: 30 })).toBe('imprecise');
    expect(areaGpsSaveDecision({ accuracy: null })).toBe('imprecise');
    expect(areaGpsSaveDecision({ accuracy: 5 })).toBe('save');
  });

  it('measures the draft’s own fix against the new area and keeps its time', () => {
    const lot = area('lot', 100, 175, { name: 'North Lot' });
    const draft = { ...ORIGIN, gpsLatitude: ORIGIN.latitude, gpsLongitude: ORIGIN.longitude, gpsAccuracy: 5, locationCapturedAt: '2026-09-29T15:00:00Z' };
    const fields = areaChangeLocationFields(draft, lot);
    expect(fields).toMatchObject({ selectedAreaId: 'lot', gpsLatitude: ORIGIN.latitude, locationCapturedAt: '2026-09-29T15:00:00Z' });
    expect(fields.distanceFromSelectedAreaFeet).toBeCloseTo(100, 0);
    // Pass 11: an untimed fix is not stamped "now".
    expect(areaChangeLocationFields({ ...draft, locationCapturedAt: null }, lot).locationCapturedAt).toBeNull();
    expect(areaChangeLocationFields({}, lot)).toMatchObject({ selectedAreaId: 'lot', gpsLatitude: null, distanceFromSelectedAreaFeet: null });
    expect(areaChangeLocationFields(draft, null)).toMatchObject({ selectedAreaId: null, selectedAreaName: null });
  });
});

// Review pass 12.
describe('GPS evidence against the update’s area', () => {
  const update = (areaName: string, feetNorth: number, accuracy: number) => ({
    id: 'u1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
    recipients: { contactIds: [] }, selectedAreaName: areaName,
    gpsLatitude: north(feetNorth).latitude, gpsLongitude: north(feetNorth).longitude, gpsAccuracy: accuracy,
    locationCapturedAt: '2026-09-29T15:00:00Z',
  });

  it('does not recommend a larger area around the nearer one you are in', () => {
    const room = area('room', 0, 100, { name: 'Room A' });
    const building = area('building', 210, 250, { name: 'Building B' });
    const gps = extractGPSEvidence({
      projectName: '2321 Compliance Project',
      updates: [update('Room A', 90, 5) as never],
      projectAreas: [room, building],
    });
    expect(gps.nearestMappedArea).toBe('Room A');
    expect(gps.recommendedArea).toBe('Room A');
  });

  it('raises no area conflict against "Unassigned / Unknown Area", but does against a named area', () => {
    const evidence = (updateArea: string) => ({
      scheduleReconciliation: { warnings: [] },
      scheduleEvidence: [],
      issueEvidence: [],
      photoEvidence: [],
      gpsEvidence: { recommendedArea: 'North Lot' },
      userUpdateEvidence: [{ areaName: updateArea }],
      projectName: '2321 Compliance Project',
    }) as never;
    const ids = (updateArea: string) => findEvidenceConflicts(evidence(updateArea)).map(item => item.id);
    expect(ids(UNASSIGNED_AREA_NAME)).not.toContain('pie-evidence-conflict-gps-update-area-mismatch');
    expect(ids('South Lot')).toContain('pie-evidence-conflict-gps-update-area-mismatch');
  });

  it('keeps an update with a late photo ahead of an earlier update elsewhere', () => {
    const photoAt = (id: string, time: string) => ({
      id, uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
      actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: time,
    });
    const yard = {
      ...update('Yard', 0, 5), id: 'u-yard', locationCapturedAt: '2026-09-29T16:00:00.000Z',
      photos: [photoAt('p-late', '2026-09-29T17:30:00.000Z')],
    };
    const roof = {
      id: 'u-roof', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '',
      recipients: { contactIds: [] }, selectedAreaName: 'Roof', photos: [photoAt('p-roof', '2026-09-29T17:00:00.000Z')],
    };
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [yard as never, roof as never], scheduleItems: [],
    });
    expect(summary.currentArea).toBe('Yard');
  });

  it('logs the unmapped-areas diagnostic only where asked', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unmapped = [area('lot', 0, 175, { locationCapturedAt: null })];
    findProjectAreaSuggestions({ ...ORIGIN, accuracy: 5 }, unmapped, { diagnose: false });
    expect(warn).not.toHaveBeenCalled();
    findProjectAreaSuggestions({ ...ORIGIN, accuracy: 5 }, unmapped);
    expect(warn).toHaveBeenCalledTimes(typeof __DEV__ !== 'undefined' && __DEV__ ? 1 : 0);
    warn.mockRestore();
  });
});

// Review passes 13-14.
describe('placeholders and GPS evidence', () => {
  const lot = area('lot', 0, 175, { name: 'North Lot' });
  const placeholderDraft = (feetNorth: number) => ({
    id: 'draft-1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
    recipients: { contactIds: [] }, selectedAreaName: UNASSIGNED_AREA_NAME,
    gpsLatitude: north(feetNorth).latitude, gpsLongitude: north(feetNorth).longitude, gpsAccuracy: 10,
    locationCapturedAt: '2026-09-29T15:00:00Z',
  });

  it('recommends the area a fix is confidently inside', () => {
    const gps = extractGPSEvidence({ projectName: '2321 Compliance Project', updates: [placeholderDraft(50) as never], projectAreas: [lot] });
    expect(gps.recommendedArea).toBe('North Lot');
  });

  // Pass 14: with a fix, history and far areas are not "GPS suggests".
  it('recommends nothing for a fix outside every area, whatever the history says', () => {
    const photoInPumpHouse = {
      id: 'ph1', projectName: '2321 Compliance Project', areaName: 'Pump House', gpsLatitude: null,
      gpsLongitude: null, gpsAccuracy: null, timestamp: '2026-09-20T15:00:00Z',
    };
    const gps = extractGPSEvidence({
      projectName: '2321 Compliance Project',
      updates: [placeholderDraft(600) as never],
      photoEvidence: [photoInPumpHouse as never],
      scheduleEvidence: [{ areaName: 'Unassigned area', projectName: '2321 Compliance Project' } as never],
      projectAreas: [lot],
    });
    expect(gps.recommendedArea).toBeNull();
  });

  it('still uses history when there is no fix', () => {
    const gps = extractGPSEvidence({
      projectName: '2321 Compliance Project',
      scheduleEvidence: [
        { areaName: 'Unassigned area', projectName: '2321 Compliance Project' } as never,
        { areaName: 'Unassigned area', projectName: '2321 Compliance Project' } as never,
        { areaName: 'Roof', projectName: '2321 Compliance Project' } as never,
      ],
      projectAreas: [lot],
    });
    expect(gps.recommendedArea).toBe('Roof');
  });

  it('raises no GPS area conflict with a placeholder on either side', () => {
    const conflicts = (gpsArea: string | null, updateArea: string) => findEvidenceConflicts({
      scheduleReconciliation: { warnings: [] }, scheduleEvidence: [], issueEvidence: [], photoEvidence: [],
      gpsEvidence: { recommendedArea: gpsArea }, userUpdateEvidence: [{ areaName: updateArea }],
      projectName: '2321 Compliance Project',
    } as never).map(item => item.id);
    expect(conflicts('Unassigned area', 'Roof')).not.toContain('pie-evidence-conflict-gps-update-area-mismatch');
    expect(conflicts(UNASSIGNED_AREA_NAME, 'Roof')).not.toContain('pie-evidence-conflict-gps-update-area-mismatch');
    expect(conflicts('North Lot', 'Roof')).toContain('pie-evidence-conflict-gps-update-area-mismatch');
  });

  it('never asks "are you at Unassigned / Unknown Area?"', () => {
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project',
      updates: [{
        ...placeholderDraft(50),
        photos: [{
          id: 'p1', uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '',
          actionDueDate: '', actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null,
          locationCapturedAt: '2026-09-29T16:00:00Z',
        }],
      } as never],
      scheduleItems: [],
    });
    expect(summary.currentArea).not.toBe(UNASSIGNED_AREA_NAME);
    expect(summary.confirmationPrompt ?? '').not.toContain(UNASSIGNED_AREA_NAME);
  });
});

// Review pass 15: the location summary with fixes that land.
describe('the project location summary', () => {
  const lot = area('lot', 0, 175, { name: 'North Lot', projectName: '2321 Compliance Project' });
  const now = new Date('2026-09-29T15:05:00.000Z');
  const draft = (feetNorth: number, extra: Record<string, unknown> = {}) => ({
    id: 'd1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
    recipients: { contactIds: [] }, selectedAreaName: UNASSIGNED_AREA_NAME,
    gpsLatitude: north(feetNorth).latitude, gpsLongitude: north(feetNorth).longitude, gpsAccuracy: 5,
    locationCapturedAt: '2026-09-29T15:00:00.000Z', ...extra,
  });
  const pumpHouseTask = {
    id: 't1', projectName: '2321 Compliance Project', taskName: 'Pour', milestone: '', locationName: 'Pump House',
    startDate: '', finishDate: '', status: 'In Progress', percentComplete: 10,
  };

  it('names the area a placeholder draft’s current fix is inside, not the schedule’s first area', () => {
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [], currentUpdate: draft(40) as never,
      scheduleItems: [pumpHouseTask as never], projectAreas: [lot], now,
    });
    expect(summary.currentArea).toBe('North Lot');
    expect(summary.presenceStatus).toBe('on-site');
    expect(summary.source).toBe('current-draft');
  });

  it('asks no question when GPS names no area', () => {
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [], currentUpdate: draft(2_000) as never,
      scheduleItems: [pumpHouseTask as never], projectAreas: [lot], now,
    });
    expect(summary.currentArea).toBeNull();
    expect(summary.gpsStatus).toBe('Captured, accuracy ±16 ft');
    expect(summary.needsConfirmation).toBe(false);
    expect(summary.confirmationPrompt).toBeNull();
  });

  it('uses the schedule only when no update is evidence', () => {
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [], scheduleItems: [pumpHouseTask as never], now,
    });
    expect(summary.currentArea).toBe('Pump House');
    expect(summary.source).toBe('schedule');
  });

  it('reads on or off site only when the fix’s margin does not straddle the edge', () => {
    const at = (feetNorth: number, accuracy: number) => analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [],
      currentUpdate: draft(feetNorth, { selectedAreaName: 'North Lot', selectedAreaId: 'lot', gpsAccuracy: accuracy }) as never,
      scheduleItems: [], projectAreas: [lot], now,
    }).presenceStatus;
    expect(at(100, 5)).toBe('on-site');
    expect(at(400, 5)).toBe('off-site');
    expect(at(170, 5)).toBe('unknown');
    // Precise Location off: a 1-3 km fix says nothing.
    expect(at(400, 1500)).toBe('unknown');
  });

  it('lets the open draft stand for its saved copy', () => {
    // The saved copy still has a later photo the open draft has since removed.
    const saved = {
      ...draft(40),
      selectedAreaName: 'Old Area',
      photos: [{
        id: 'p-removed', uri: '', caption: '', category: 'Update', actionRequired: '', actionOwner: '',
        actionDueDate: '', actionStatus: 'Open', gpsLatitude: null, gpsLongitude: null,
        locationCapturedAt: '2026-09-29T15:04:00.000Z',
      }],
    };
    const open = { ...draft(40), selectedAreaName: 'North Lot' };
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [saved as never], currentUpdate: open as never,
      scheduleItems: [], projectAreas: [lot], now,
    });
    expect(summary.currentArea).toBe('North Lot');
  });
});

describe('GPS evidence confidence', () => {
  it('does not count history toward confidence when the fix supports no area', () => {
    const lot = area('lot', 0, 175, { name: 'North Lot' });
    const far = {
      id: 'd1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
      recipients: { contactIds: [] }, selectedAreaName: UNASSIGNED_AREA_NAME,
      gpsLatitude: north(600).latitude, gpsLongitude: north(600).longitude, gpsAccuracy: 5,
      locationCapturedAt: '2026-09-29T15:00:00Z',
    };
    const history = [{ projectName: '2321 Compliance Project', areaName: 'Pump House', gpsLatitude: null,
      gpsLongitude: null, gpsAccuracy: null, timestamp: '2026-09-20T15:00:00Z' }];
    const gps = extractGPSEvidence({
      projectName: '2321 Compliance Project', updates: [far as never], photoEvidence: history as never,
      projectAreas: [lot],
    });
    expect(gps.recommendedArea).toBeNull();
    expect(gps.confidenceScore).toBeLessThan(70);
    expect(gps.correctionStatus).not.toBe('corrected');
  });
});

// Review pass 16.
describe('areas and projects', () => {
  const now = new Date('2026-09-29T15:05:00.000Z');
  const canopyB = area('canopy-b', 0, 175, { name: 'Canopy B', projectName: '2375 Compliance Project' });
  const canopyA = area('canopy-a', 400, 175, { name: 'Canopy A', projectName: '2321 Compliance Project' });
  const draft2321 = {
    id: 'd1', projectName: '2321 Compliance Project', date: '2026-09-29', notes: '', photos: [],
    recipients: { contactIds: [] }, selectedAreaName: UNASSIGNED_AREA_NAME,
    gpsLatitude: ORIGIN.latitude, gpsLongitude: ORIGIN.longitude, gpsAccuracy: 5,
    locationCapturedAt: '2026-09-29T15:00:00.000Z',
  };

  it('never names another project’s area as this project’s current area', () => {
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [], currentUpdate: draft2321 as never,
      scheduleItems: [], projectAreas: [canopyB, canopyA], now,
    });
    expect(summary.currentArea).toBeNull();
  });

  it('never says GPS supports another project’s area', () => {
    const fused = buildFusedEvidence({
      projectName: '2321 Compliance Project', updates: [draft2321 as never],
      projectAreas: [canopyB, canopyA], now,
    });
    expect(fused.gpsEvidence.recommendedArea).toBeNull();
    // The same fix in 2375's own evidence is Canopy B.
    const other = buildFusedEvidence({
      projectName: '2375 Compliance Project',
      updates: [{ ...draft2321, projectName: '2375 Compliance Project' } as never],
      projectAreas: [canopyB, canopyA], now,
    });
    expect(other.gpsEvidence.recommendedArea).toBe('Canopy B');
  });

  it('does not say GPS supports a named area the fix is far outside', () => {
    const northLot = area('north', 0, 175, { name: 'North Lot' });
    const office = {
      ...draft2321, selectedAreaName: 'North Lot',
      gpsLatitude: north(23_000).latitude, gpsLongitude: north(23_000).longitude,
    };
    const gps = extractGPSEvidence({ projectName: '2321 Compliance Project', updates: [office as never], projectAreas: [northLot] });
    expect(gps.recommendedArea).toBeNull();
    expect(gps.confidenceScore).toBeLessThan(70);
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project', updates: [office as never], scheduleItems: [],
      projectAreas: [{ ...northLot, projectName: '2321 Compliance Project' }], now,
    });
    expect(summary.presenceStatus).toBe('off-site');
    expect(summary.needsConfirmation).toBe(true);
  });
});
