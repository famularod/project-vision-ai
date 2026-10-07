/**
 * P1 part B item 1 (6 Oct 2026). After the manager deleted the area his
 * open update was in, Add Photos' Current Area card read "Unassigned /
 * Unknown Area" and under it "Why: This is your current confirmed
 * selection." Nothing had been selected: deleting the area puts the update
 * back to "no area chosen", as a new update starts (DraftFix,
 * draftAfterAreaDeleted). The line now says so.
 *
 * Only that case changes. An area he picked, and "Unassigned" when he
 * picked it himself, are his selections and still say so.
 */
import {
  draftAreaPresentation,
  NO_AREA_CHOSEN_REASON,
  UNASSIGNED_AREA_NAME,
} from '../../services/DraftAreaPresentation';
import { areaChangeLocationFields, draftAfterAreaDeleted } from '../../services/DraftFix';
import type { AreaSuggestion, ProjectArea } from '../../types';

const CONFIRMED = 'This is your current confirmed selection.';

function area(id: string, name: string): ProjectArea {
  return { id, name, latitude: 37.5, longitude: -122.2, radiusFeet: 150, locationCapturedAt: '2026-09-29T15:00:00.000Z' };
}

const north = area('north', 'North Pad');
type Draft = {
  id: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracy: number | null;
  distanceFromSelectedAreaFeet: number | null;
  locationCapturedAt: string | null;
  selectedAreaId: string | null;
  selectedAreaName: string | null;
  areaStatus: 'confirmed' | 'suggested' | 'unknown';
  photos: never[];
};
const noGps = { gpsLatitude: null, gpsLongitude: null, gpsAccuracy: null, distanceFromSelectedAreaFeet: null, locationCapturedAt: null };
const inNorthPad: Draft = {
  id: 'draft-1', ...noGps, selectedAreaId: 'north', selectedAreaName: 'North Pad', areaStatus: 'confirmed', photos: [],
};

/** The card for a draft, as App.tsx builds it (no GPS suggestion, no schedule recommendation unless given). */
function card(draft: Draft, areas: ProjectArea[], extra: { hasScheduleRecommendation?: boolean; areaSuggestion?: AreaSuggestion | null } = {}) {
  return draftAreaPresentation({
    selectedArea: areas.find(item => item.id === draft.selectedAreaId) ?? null,
    selectedAreaName: draft.selectedAreaName,
    areaStatus: draft.areaStatus,
    areaSuggestion: extra.areaSuggestion ?? null,
    hasScheduleRecommendation: extra.hasScheduleRecommendation ?? false,
  });
}

describe('the Current Area card says why only when the reason is true (P1 part B item 1)', () => {
  it('before the deletion, his pick is his confirmed selection', () => {
    const view = card(inNorthPad, [north]);
    expect(view.areaName).toBe('North Pad');
    expect(view.reason).toBe(CONFIRMED);
  });

  it('after he deletes the update\'s area, it says no area has been chosen, not "your confirmed selection"', () => {
    const after = draftAfterAreaDeleted(inNorthPad, 'north');
    const view = card(after, []);
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.reason).not.toBe(CONFIRMED);
    expect(view.reason).toBe(NO_AREA_CHOSEN_REASON);
    expect(NO_AREA_CHOSEN_REASON).toBe('No area has been chosen for this update yet.');
  });

  it('a new update with no area says the same (it is the same state)', () => {
    const fresh: Draft = { ...inNorthPad, selectedAreaId: null, selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'unknown' };
    expect(card(fresh, [north]).reason).toBe(NO_AREA_CHOSEN_REASON);
  });

  it('a suggestion that has since gone leaves "no area chosen", not a confirmed selection', () => {
    const suggestedThenGone: Draft = { ...inNorthPad, selectedAreaId: null, selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'suggested' };
    expect(card(suggestedThenGone, []).reason).toBe(NO_AREA_CHOSEN_REASON);
  });

  it('"Unassigned" he picked himself is still his selection', () => {
    // What choosing "Unassigned / Unknown Area" in the area sheet writes.
    const choseUnassigned: Draft = { ...inNorthPad, ...areaChangeLocationFields(inNorthPad, null), areaStatus: 'unknown' };
    expect(choseUnassigned.selectedAreaName).toBeNull();
    const view = card(choseUnassigned, [north]);
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.reason).toBe(CONFIRMED);
  });

  it('a task update keeps its task\'s named location as before', () => {
    const taskUpdate: Draft = { ...inNorthPad, selectedAreaId: null, selectedAreaName: 'Building 3', areaStatus: 'confirmed' };
    const view = card(taskUpdate, [north]);
    expect(view.areaName).toBe('Building 3');
    expect(view.reason).toBe(CONFIRMED);
  });

  it('a GPS suggestion still gives the GPS reason after the deletion', () => {
    const after = draftAfterAreaDeleted(inNorthPad, 'north');
    const south = area('south', 'South Pad');
    const view = card(after, [south], { areaSuggestion: { area: south, distanceFeet: 20, withinRadius: true } });
    expect(view.reason).toBe('GPS places you in South Pad. Accept it to use it for this update.');
  });

  // Left as it is, and recorded for a decision: with a schedule on the
  // project this line is the schedule's, also when no area is chosen.
  it('unchanged: with a schedule recommendation the line is still the schedule\'s', () => {
    const after = draftAfterAreaDeleted(inNorthPad, 'north');
    expect(card(after, [], { hasScheduleRecommendation: true }).reason)
      .toBe('The imported schedule identifies this as the most urgent area.');
  });

  it('nothing else about the card changes after the deletion', () => {
    const after = draftAfterAreaDeleted(inNorthPad, 'north');
    expect(card(after, [])).toMatchObject({
      areaName: UNASSIGNED_AREA_NAME,
      areaRowName: UNASSIGNED_AREA_NAME,
      areaRowStatus: 'unknown',
      offeredSuggestion: null,
      locationSource: 'last-active-area',
      confidenceScore: 45,
      locationNotice: null,
    });
  });
});
