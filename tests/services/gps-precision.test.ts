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
import { normalizeProjectArea } from '../../services/ProjectAreaRecord';
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
    });
    expect(areaPointFromFix({ ...fix, accuracy: null }).locationAccuracyMeters).toBeNull();
  });

  it('shows each area’s precision, and says when an older point has none', () => {
    expect(areaPointPrecisionLabel({ locationCapturedAt: null })).toBe('GPS missing');
    expect(areaPointPrecisionLabel({ locationCapturedAt: '2026-07-21T15:57:00Z' }))
      .toBe('GPS saved, precision not recorded');
    expect(areaPointPrecisionLabel({ locationCapturedAt: '2026-09-29T15:00:00Z', locationAccuracyMeters: 4 }))
      .toBe('GPS saved ±13 ft');
  });

  it('keeps a valid precision through normalization and leaves older areas’ shape unchanged', () => {
    const saved = normalizeProjectArea({ id: 'a', name: 'North Lot', locationAccuracyMeters: 4 });
    expect(saved.locationAccuracyMeters).toBe(4);

    const older = normalizeProjectArea({ id: 'b', name: 'South Lot' });
    expect('locationAccuracyMeters' in older).toBe(false);

    const replaced = normalizeProjectArea({ ...saved, ...areaPointFromFix({
      latitude: 37.2, longitude: -121.8, accuracy: null, capturedAt: '2026-09-29T16:00:00Z',
    }) });
    expect('locationAccuracyMeters' in replaced).toBe(false);
    expect(normalizeProjectArea({ id: 'c', name: 'X', locationAccuracyMeters: -3 }))
      .not.toHaveProperty('locationAccuracyMeters');
  });
});

describe('GPS prompts in the app', () => {
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
  });

  it('decides an area suggestion with the unit-safe rule', () => {
    expect(app).toContain('withinRadius: isConfidentlyInsideArea({');
    expect(app).toContain('clearWinnerMarginFeet(');
  });
});
