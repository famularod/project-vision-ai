/**
 * GPS review, 29 Sep 2026: a fix's accuracy is in meters, but the area
 * suggestion added it to distances in feet and the status line printed it as
 * feet. Fixes were taken at the "balanced" (hundred-meter) setting, and no
 * area recorded how precise its saved point was.
 */
import {
  AREA_POINT_ACCURACY_LIMIT_FEET,
  areaPointFromFix,
  areaPointImpreciseMessage,
  areaPointPrecisionLabel,
  areaPointSavedMessage,
  clearWinnerMarginFeet,
  formatGpsAccuracy,
  gpsAccuracyFeet,
  isAreaPointImprecise,
  isConfidentlyInsideArea,
} from '../../services/GpsPrecision';
import { analyzeProjectLocationIntelligence } from '../../services/LocationIntelligenceService';
import {
  daveProjectAreasNeedingCloudUpload,
  mergeDAVEProjectAreaRecord,
} from '../../services/DAVEProjectAreaRecovery';
import { normalizeProjectArea } from '../../services/ProjectAreaRecord';
import { withDraftGps } from '../../services/DraftPhotoGps';
import { createRecentLocationFix } from '../../services/RecentLocationFix';
import type { ProjectUpdate } from '../../types';

describe('GPS accuracy units', () => {
  it('converts the phone’s meters to feet', () => {
    expect(gpsAccuracyFeet(10)).toBeCloseTo(32.8, 1);
    expect(gpsAccuracyFeet(0)).toBe(0);
    expect(gpsAccuracyFeet(null)).toBeNull();
    expect(gpsAccuracyFeet(-1)).toBeNull();
    expect(gpsAccuracyFeet(Number.NaN)).toBeNull();
    expect(formatGpsAccuracy(5)).toBe('±16 ft');
    expect(formatGpsAccuracy(0.1)).toBe('±1 ft');
    expect(formatGpsAccuracy(undefined)).toBeNull();
  });

  it('suggests an area only when the whole error margin, in feet, fits inside it', () => {
    // A ten-meter fix 100 ft from the centre of a 175 ft area: 100 + 33 fits.
    expect(isConfidentlyInsideArea({ distanceFeet: 100, accuracyMeters: 10, radiusFeet: 175 })).toBe(true);
    // A hundred-meter-class fix (65 m = 213 ft) cannot place you inside a
    // 175 ft area even at its centre. Read as feet, it used to pass.
    expect(isConfidentlyInsideArea({ distanceFeet: 0, accuracyMeters: 65, radiusFeet: 175 })).toBe(false);
    expect(isConfidentlyInsideArea({ distanceFeet: 100, accuracyMeters: 65, radiusFeet: 175 })).toBe(false);
    // No accuracy reported: distance alone decides, as before.
    expect(isConfidentlyInsideArea({ distanceFeet: 170, accuracyMeters: null, radiusFeet: 175 })).toBe(true);
  });

  it('widens the clear-winner margin by the error in feet', () => {
    expect(clearWinnerMarginFeet(75, 5)).toBe(75);
    expect(clearWinnerMarginFeet(75, 30)).toBeCloseTo(196.9, 1);
    expect(clearWinnerMarginFeet(75, null)).toBe(75);
  });

  it('labels the fix on the project summary in feet', () => {
    const update = {
      id: 'u1',
      projectName: '2321 Compliance Project',
      date: '2026-09-29',
      notes: '',
      photos: [],
      recipients: { contactIds: [] },
      selectedAreaName: 'North Lot',
      gpsLatitude: 37.1,
      gpsLongitude: -121.9,
      gpsAccuracy: 10,
      locationCapturedAt: '2026-09-29T15:00:00.000Z',
    } as unknown as ProjectUpdate;
    const summary = analyzeProjectLocationIntelligence({
      projectName: '2321 Compliance Project',
      updates: [update],
      scheduleItems: [],
    });
    expect(summary.gpsStatus).toBe('Captured, accuracy ±33 ft');
  });
});

describe('saving an area point', () => {
  it('offers a retry for a point less precise than the limit, or of unknown precision', () => {
    expect(AREA_POINT_ACCURACY_LIMIT_FEET).toBe(65);
    expect(isAreaPointImprecise(5)).toBe(false);
    expect(isAreaPointImprecise(19.8)).toBe(false);
    expect(isAreaPointImprecise(25)).toBe(true);
    expect(isAreaPointImprecise(null)).toBe(true);
    expect(areaPointImpreciseMessage(30)).toBe(
      'GPS is only accurate to ±98 ft here. Step into the open and try again, or save this point anyway.',
    );
    expect(areaPointSavedMessage(4)).toBe(
      'This location now uses your current GPS point, accurate to ±13 ft.',
    );
  });

  it('records the precision with the point, and nothing when the phone gave none', () => {
    const fix = { latitude: 37.1, longitude: -121.9, accuracy: 4, capturedAt: '2026-09-29T15:00:00.000Z' };
    expect(areaPointFromFix(fix)).toEqual({
      latitude: 37.1,
      longitude: -121.9,
      locationCapturedAt: '2026-09-29T15:00:00.000Z',
      locationAccuracyMeters: 4,
      locationAccuracyCapturedAt: '2026-09-29T15:00:00.000Z',
    });
    expect(areaPointFromFix({ ...fix, accuracy: null })).toMatchObject({
      locationAccuracyMeters: null,
      locationAccuracyCapturedAt: null,
    });
  });

  it('shows each area’s precision, and says when an older point has none', () => {
    expect(areaPointPrecisionLabel({ locationCapturedAt: null })).toBe('GPS missing');
    expect(areaPointPrecisionLabel({ locationCapturedAt: '2026-07-21T15:57:00Z' }))
      .toBe('GPS saved, precision not recorded');
    expect(areaPointPrecisionLabel({
      locationCapturedAt: '2026-09-29T15:00:00Z',
      locationAccuracyMeters: 4,
      locationAccuracyCapturedAt: '2026-09-29T15:00:00Z',
    })).toBe('GPS saved ±13 ft');
    // Review, 29 Sep 2026: an older build saved a new point and kept the old
    // precision fields. The precision belongs to the earlier point.
    expect(areaPointPrecisionLabel({
      locationCapturedAt: '2026-09-29T16:30:00Z',
      locationAccuracyMeters: 4,
      locationAccuracyCapturedAt: '2026-09-29T15:00:00Z',
    })).toBe('GPS saved, precision not recorded');
  });

  it('keeps a valid precision through normalization and leaves older areas’ shape unchanged', () => {
    const saved = normalizeProjectArea({
      id: 'a',
      name: 'North Lot',
      ...areaPointFromFix({ latitude: 37.1, longitude: -121.9, accuracy: 4, capturedAt: '2026-09-29T15:00:00Z' }),
    });
    expect(saved.locationAccuracyMeters).toBe(4);
    expect(saved.locationAccuracyCapturedAt).toBe('2026-09-29T15:00:00Z');

    const movedByOlderBuild = normalizeProjectArea({ ...saved, locationCapturedAt: '2026-09-29T16:30:00Z' });
    expect(movedByOlderBuild).not.toHaveProperty('locationAccuracyMeters');
    expect(movedByOlderBuild).not.toHaveProperty('locationAccuracyCapturedAt');

    const older = normalizeProjectArea({ id: 'b', name: 'South Lot' });
    expect('locationAccuracyMeters' in older).toBe(false);

    const replaced = normalizeProjectArea({ ...saved, ...areaPointFromFix({
      latitude: 37.2, longitude: -121.8, accuracy: null, capturedAt: '2026-09-29T16:00:00Z',
    }) });
    expect('locationAccuracyMeters' in replaced).toBe(false);
    expect('locationAccuracyCapturedAt' in replaced).toBe(false);
    expect(normalizeProjectArea({ id: 'c', name: 'X', locationAccuracyMeters: -3 }))
      .not.toHaveProperty('locationAccuracyMeters');
  });
});

// Review, 29 Sep 2026: a sync merge takes the point from the copy with the
// newest GPS and everything else from the copy with the newest edit.
describe('area sync merge', () => {
  const pointA = normalizeProjectArea({
    id: 'a', name: 'North Lot', radiusFeet: 175, updatedAt: '2026-09-29T17:00:00Z',
    ...areaPointFromFix({ latitude: 37.1, longitude: -121.9, accuracy: 4, capturedAt: '2026-09-29T17:00:00Z' }),
  });
  const renamedOnB = normalizeProjectArea({
    id: 'a', name: 'North Lot East', radiusFeet: 175, updatedAt: '2026-09-29T17:05:00Z',
    latitude: 37.2, longitude: -121.8, locationCapturedAt: '2026-07-21T15:57:00Z',
  });

  it('keeps the precision with the point it belongs to', () => {
    for (const merged of [mergeDAVEProjectAreaRecord(pointA, renamedOnB), mergeDAVEProjectAreaRecord(renamedOnB, pointA)]) {
      expect(merged.name).toBe('North Lot East');
      expect(merged.latitude).toBe(37.1);
      expect(merged.locationCapturedAt).toBe('2026-09-29T17:00:00Z');
      expect(merged.locationAccuracyMeters).toBe(4);
      expect(merged.locationAccuracyCapturedAt).toBe('2026-09-29T17:00:00Z');
    }
  });

  it('does not put one copy’s precision on another copy’s point', () => {
    const olderPointWithPrecision = normalizeProjectArea({
      ...pointA, updatedAt: '2026-09-29T17:05:00Z',
      ...areaPointFromFix({ latitude: 37.3, longitude: -121.7, accuracy: 30, capturedAt: '2026-09-29T16:00:00Z' }),
    });
    const newerPointNoPrecision = normalizeProjectArea({
      id: 'a', name: 'North Lot', radiusFeet: 175, updatedAt: '2026-09-29T17:00:00Z',
      latitude: 37.1, longitude: -121.9, locationCapturedAt: '2026-09-29T17:00:00Z',
    });
    const merged = mergeDAVEProjectAreaRecord(newerPointNoPrecision, olderPointWithPrecision);
    expect(merged.locationCapturedAt).toBe('2026-09-29T17:00:00Z');
    expect(merged).not.toHaveProperty('locationAccuracyMeters');
    expect(areaPointPrecisionLabel(merged)).toBe('GPS saved, precision not recorded');
  });

  // Review pass 2: an older build's merge drops the precision keys, so its
  // rename reaches the cloud with the same point and no precision.
  it('keeps the precision when the other copy has the same point without it', () => {
    const renamedByOlderBuild = {
      ...pointA,
      name: 'North Lot East',
      updatedAt: '2026-09-29T17:10:00Z',
      locationAccuracyMeters: undefined,
      locationAccuracyCapturedAt: undefined,
    };
    for (const merged of [
      mergeDAVEProjectAreaRecord(pointA, renamedByOlderBuild),
      mergeDAVEProjectAreaRecord(renamedByOlderBuild, pointA),
    ]) {
      expect(merged.name).toBe('North Lot East');
      expect(areaPointPrecisionLabel(merged)).toBe('GPS saved ±13 ft');
    }
  });

  // Review pass 2: an older build moved the point but kept the old precision
  // keys. The new build must not upload the same record on every sync.
  it('does not re-upload a cloud copy only because it carries another point’s precision', () => {
    const movedByOlderBuild = {
      ...pointA,
      latitude: 37.3,
      locationCapturedAt: '2026-09-29T18:00:00Z',
      updatedAt: '2026-09-29T18:00:00Z',
    };
    const localAfterMerge = mergeDAVEProjectAreaRecord(pointA, movedByOlderBuild);
    expect(localAfterMerge).not.toHaveProperty('locationAccuracyMeters');
    expect(daveProjectAreasNeedingCloudUpload({ local: [localAfterMerge], cloud: [movedByOlderBuild] })).toEqual([]);
  });

  // Review pass 3: an older build's rename drops the precision keys in the
  // cloud; re-adding them alone would alternate with that build forever.
  it('does not upload only to restore precision an older build dropped', () => {
    const cloudAfterOlderRename = {
      ...pointA,
      name: 'North Lot East',
      updatedAt: '2026-09-29T17:10:00Z',
      locationAccuracyMeters: undefined,
      locationAccuracyCapturedAt: undefined,
    };
    const local = { ...pointA, name: 'North Lot East', updatedAt: '2026-09-29T17:10:00Z' };
    expect(daveProjectAreasNeedingCloudUpload({ local: [local], cloud: [cloudAfterOlderRename] })).toEqual([]);

    const newPoint = normalizeProjectArea({
      ...local,
      updatedAt: '2026-09-29T18:00:00Z',
      ...areaPointFromFix({ latitude: 37.4, longitude: -121.6, accuracy: 3, capturedAt: '2026-09-29T18:00:00Z' }),
    });
    const [upload] = daveProjectAreasNeedingCloudUpload({ local: [newPoint], cloud: [cloudAfterOlderRename] });
    expect(upload.latitude).toBe(37.4);
    expect(upload.locationAccuracyMeters).toBe(3);
  });
});

describe('photos added while the draft fix is pending', () => {
  const fix = {
    gpsLatitude: 37.1,
    gpsLongitude: -121.9,
    gpsAccuracy: 4,
    distanceFromSelectedAreaFeet: 30,
    locationCapturedAt: '2026-09-29T15:00:00Z',
  };

  it('take the draft’s fix when they have none, keeping their own capture time', () => {
    const bare = { id: 'p1', gpsLatitude: null, gpsLongitude: null, locationCapturedAt: '2026-09-29T14:59:00Z' };
    expect(withDraftGps(bare, fix)).toEqual({
      id: 'p1',
      gpsLatitude: 37.1,
      gpsLongitude: -121.9,
      gpsAccuracy: 4,
      distanceFromSelectedAreaFeet: 30,
      locationCapturedAt: '2026-09-29T14:59:00Z',
    });
    const own = { id: 'p2', gpsLatitude: 37.5, gpsLongitude: -121.5 };
    expect(withDraftGps(own, fix)).toBe(own);
    expect(withDraftGps(bare, { gpsLatitude: null, gpsLongitude: null })).toBe(bare);
  });
});

describe('a recent location fix', () => {
  it('shares one pending fix, reuses it for its age, then takes a new one', async () => {
    let clock = 0;
    const takeFix = jest.fn(async () => ({ at: clock }));
    const recent = createRecentLocationFix(takeFix, 60_000, { now: () => clock });

    expect(recent.fresh()).toBeNull();
    const [first, second] = await Promise.all([recent.get(), recent.get()]);
    expect(first).toBe(second);
    expect(takeFix).toHaveBeenCalledTimes(1);

    clock = 59_000;
    expect(recent.fresh()).toEqual({ fix: first });
    await recent.get();
    expect(takeFix).toHaveBeenCalledTimes(1);

    clock = 61_000;
    expect(recent.fresh()).toBeNull();
    await recent.get();
    expect(takeFix).toHaveBeenCalledTimes(2);
  });

  it('does not keep "no fix", so allowing location takes effect at once', async () => {
    const takeFix = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ at: 1 });
    const recent = createRecentLocationFix(takeFix, 60_000, { now: () => 0 });
    await expect(recent.get()).resolves.toBeNull();
    expect(recent.fresh()).toBeNull();
    await expect(recent.get()).resolves.toEqual({ at: 1 });
  });

  it('does not keep a failed fix', async () => {
    const takeFix = jest.fn()
      .mockRejectedValueOnce(new Error('kCLErrorLocationUnknown'))
      .mockResolvedValueOnce({ at: 1 });
    const recent = createRecentLocationFix(takeFix, 60_000, { now: () => 0 });
    await expect(recent.get()).rejects.toThrow('kCLErrorLocationUnknown');
    expect(recent.fresh()).toBeNull();
    await expect(recent.get()).resolves.toEqual({ at: 1 });
  });
});

// Wiring in App.tsx. The rules themselves are unit-tested in
// gps-area-suggestion.test.ts; these pin where App calls them (review
// pass 7: count-only checks let real regressions through).
describe('GPS wiring in the app', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

  it('shows no developer rebuild instructions to the user', () => {
    expect(app).not.toContain('npx expo run:ios');
    expect(app).not.toContain('If this installed app was not rebuilt');
  });

  it('takes fixes at ten-meter precision and saves area points at the best precision', () => {
    expect(app).toContain('accuracy: Location.Accuracy = Location.Accuracy.High');
    expect(app).not.toContain('Location.Accuracy.Balanced');
    expect(app).toContain('getCurrentLocationSnapshot(Location.Accuracy.Highest)');
    expect(app).toContain("preciseLocationOff: permission.ios?.accuracy === 'reduced'");
    expect(app).toContain('if (snapshot.preciseLocationOff) {');
  });

  it('saves an area point onto the latest copy of the area, one fix per area, only if the area exists', () => {
    expect(app).toContain('const current = projectAreasCurrentRef.current.find(area => area.id === areaId);');
    expect(app).toMatch(/async function saveCurrentLocationForArea\(areaId: string\) \{\n\s+if \(!areaGpsSaveInFlight\.tryStart\(areaId\)\) return;\n\s+try \{/);
    expect(app).toMatch(/\} finally \{\n\s+areaGpsSaveInFlight\.finish\(areaId\);\n\s+\}\n\s+\}/);
    expect(app).toContain('if (!updateProjectArea(areaId, areaPointFromFix(snapshot))) return;');
  });

  // Review pass 2: the fix was checked against the previous draft and discarded.
  it('captures GPS for the draft just started, against its own project’s areas', () => {
    expect(app).not.toContain('captureDraftLocation();');
    expect(app.match(/draftRef\.current = nextDraft;\n\s+setDraft\(nextDraft\);/g)).toHaveLength(2);
    expect(app.match(/draftLocationCaptureRef\.current = captureDraftLocation\(nextDraft\);/g)).toHaveLength(2);
    expect(app).toContain('const generation = draftFixTracker.start(targetDraft.id);');
    expect(app).toContain('projectName: targetDraft.projectName,');
  });

  it('writes the landed fix through applyFixToDraft, only for the current target', () => {
    expect(app).toMatch(/handedToDraft = true;\n\s+setDraft\(prev => \{\n\s+settle\(\);/);
    expect(app).toContain('if (!handedToDraft) settle();');
    expect(app).toMatch(/draftFixTracker\.generation\(\),\n\s+\)\) \{\n\s+return prev;\n\s+\}\n\s+return applyFixToDraft\(\{\n\s+draft: prev,\n\s+fix: snapshot,\n\s+areas: targetAreas,\n\s+reliableSuggestion,/);
    expect(app).toContain('reliableSuggestion ? { draftId: target.draftId, suggestion: reliableSuggestion } : null');
  });

  it('adds photos from the draft as it is when the camera or picker returns', () => {
    expect(app).not.toContain('withDraftPhotoContext(await photoFromAsset(asset), draft)');
    expect(app).toContain('photos.push(asLibraryPhoto(withDraftPhotoContext(await photoFromAsset(asset), draftRef.current)));');
    expect(app).toContain('...withDraftPhotoContext(await photoFromAsset(asset), draftRef.current),');
    expect(app.match(/const baseDraft = draftRef\.current;/g)).toHaveLength(2);
    expect(app.match(/photos: \[\.\.\.prev\.photos, \.\.\.photos\.map\(photo => withDraftGps\(photo, prev\)\)\]/g)).toHaveLength(2);
    expect(app).toContain('...newPhotoGps(sourceDraft, Date.now()),');
    expect(app).toMatch(/\.\.\.newPhotoGps\(sourceDraft, Date\.now\(\)\),\n\s+locationCapturedAt: new Date\(\)\.toISOString\(\),/);
    // Review pass 10: no new fix mid-update (it changed the suggestion and
    // could stamp older photos).
    expect(app).not.toContain('refreshStaleDraftFix');
    expect(app).toContain('photos: prev.photos.map(photo => withDraftLocation(photo, locationFields)),');
    expect(app).toContain('...(photo.pickedFromLibrary === true ? { pickedFromLibrary: true } : {}),');
  });

  it('drops a pending fix when a save starts, and re-fixes only a draft left open by that save', () => {
    expect(app).toMatch(/setFieldUpdateSaving\(true\);\n(?:\s*\/\/.*\n)*\s*const droppedPendingFix = draftFixTracker\.beginSave\(draftSnapshot\.id\);/);
    expect(app).toMatch(/setFieldUpdateSaving\(false\);\n\s+recaptureDroppedDraftLocation\(draftSnapshot\.id, droppedPendingFix\);\n\s+return;/);
    expect(app).toMatch(/setScreen\('ProjectWorkspace'\);\n\s+\} else \{\n\s+recaptureDroppedDraftLocation\(draftSnapshot\.id, droppedPendingFix\);/);
    expect(app).toContain("if (!droppedPendingFix || openDraft.id !== savedDraftId || typeof openDraft.gpsLatitude === 'number') return;");
  });

  it('shows the suggestion and area state from the tested rules, re-read every render', () => {
    expect(app).toMatch(/const draftAreaSuggestion = currentDraftAreaSuggestion\(\{\n\s+entry: draftAreaSuggestionEntry,\n\s+draft,\n\s+areas: draftProjectAreas,\n\s+\}\);/);
    expect(app).toContain('const areaView = draftAreaPresentation({');
    expect(app).toContain('Why: {areaView.reason}');
    expect(app).toContain('areaName={areaView.areaRowName}');
    expect(app).toContain('status={areaView.areaRowStatus}');
    expect(app).toContain('onPress={() => onChangeArea(offeredSuggestion.area.id)}');
    expect(app).toContain('if (areaId && !area) return;');
  });

  it('gates home-screen detection on the nearest centre across projects, with a shared fix', () => {
    expect(app).toMatch(/const suggestion = findProjectAreaSuggestions\(snapshot, projectAreas\)\[0\] \|\| null;\n(?:.*\n){0,24}\s+if \(!suggestion\?\.withinRadius \|\| gpsCandidates\.topCandidates\.length === 0\)/);
    expect(app).not.toContain('findClosestProjectArea(snapshot, projectAreas)');
    expect(app).toContain('overviewLocationFixRef.current.fresh()');
    expect(app).toContain('maxAgeFor: fix => overviewFixMaxAgeMs(fix.accuracy),');
    expect(app).toContain('clearWinnerMarginFeet(');
  });

  it('shows each area point’s precision on the Locations lists and the area panel', () => {
    expect(app.match(/areaPointPrecisionLabel\(area\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(app).toContain('formatGpsAccuracy(areaPointAccuracyMeters(area))');
  });
});
