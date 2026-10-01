/**
 * GPS review pass 1 lows (recorded 29 Sep 2026), fixed in audit round 2.
 *
 * G-L1: a fix with no usable accuracy (none, NaN, negative) counted as
 * perfectly precise, so GPS could "confirm" an area, or rule one out, from
 * a fix whose error was unknown. Save GPS already treated such a fix as
 * imprecise. Now it is never confidently inside or outside an area: the
 * nearest area can still be named as unconfirmed, never as confirmed.
 */
import {
  currentDraftAreaSuggestion,
  findClosestProjectArea,
  findProjectAreaSuggestions,
} from '../../services/AreaSuggestion';
import {
  currentDraftLocationNoticeView,
  draftLocationNoticeText,
} from '../../services/DraftAreaPresentation';
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
