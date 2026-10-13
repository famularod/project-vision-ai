/**
 * Recorded by the last fixer and not fixed (P1 part B item 1, his decision
 * 2): on a project with a schedule, an update with NO area chosen showed,
 * under "Unassigned / Unknown Area", the line "Why: The imported schedule
 * identifies this as the most urgent area." "Unassigned" is not an area the
 * schedule identified. The schedule's own suggestion is the card just below
 * it, "Next Area to Visit".
 *
 * Under "Unassigned" the card now says what is true: that no area has been
 * chosen yet, or, when he picked Unassigned himself, that it is his
 * selection. The same as on a project with no schedule.
 */
import {
  draftAreaPresentation,
  NO_AREA_CHOSEN_REASON,
  UNASSIGNED_AREA_NAME,
  UNASSIGNED_SCHEDULE_AREA_NAME,
} from '../../services/DraftAreaPresentation';
import type { AreaSuggestion, ProjectArea } from '../../types';

const SCHEDULE_LINE = 'The imported schedule identifies this as the most urgent area.';
const CONFIRMED = 'This is your current confirmed selection.';

const north: ProjectArea = {
  id: 'north', name: 'North Pad', latitude: 37.5, longitude: -122.2, radiusFeet: 150, locationCapturedAt: '2026-09-29T15:00:00.000Z',
};

/** The Current Area card on a project whose schedule has a suggestion ("Next Area to Visit"). */
const cardWithSchedule = (input: Partial<Parameters<typeof draftAreaPresentation>[0]>) => draftAreaPresentation({
  selectedArea: null,
  areaSuggestion: null,
  hasScheduleRecommendation: true,
  ...input,
});

describe('the Current Area card under "Unassigned", on a project with a schedule', () => {
  it('a new update, or one whose area was deleted: no area has been chosen yet (was: the schedule\'s line)', () => {
    const view = cardWithSchedule({ selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'unknown' });
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.reason).toBe(NO_AREA_CHOSEN_REASON);
    expect(view.reason).toBe('No area has been chosen for this update yet.');
  });

  it('the schedule\'s own name for a task with no location reads the same way', () => {
    expect(cardWithSchedule({ selectedAreaName: UNASSIGNED_SCHEDULE_AREA_NAME, areaStatus: 'unknown' }).reason)
      .toBe(NO_AREA_CHOSEN_REASON);
  });

  it('Unassigned that he picked himself is his selection (was: the schedule\'s line)', () => {
    const view = cardWithSchedule({ selectedAreaName: null, areaStatus: 'confirmed' });
    expect(view.areaName).toBe(UNASSIGNED_AREA_NAME);
    expect(view.reason).toBe(CONFIRMED);
  });

  it('it never says the schedule identified "Unassigned"', () => {
    for (const selectedAreaName of [UNASSIGNED_AREA_NAME, UNASSIGNED_SCHEDULE_AREA_NAME, null, '', '   ', undefined]) {
      for (const areaStatus of ['unknown', 'suggested', 'confirmed'] as const) {
        const view = cardWithSchedule({ selectedAreaName, areaStatus });
        expect([selectedAreaName, areaStatus, view.areaName, view.reason]).not.toContain(SCHEDULE_LINE);
      }
    }
  });

  it('it reads exactly as on a project with no schedule', () => {
    for (const selectedAreaName of [UNASSIGNED_AREA_NAME, null]) {
      const without = draftAreaPresentation({ selectedArea: null, selectedAreaName, areaSuggestion: null, hasScheduleRecommendation: false });
      expect(cardWithSchedule({ selectedAreaName }).reason).toBe(without.reason);
    }
  });

  it('nothing else about the card changes: the same name, status and confidence as before', () => {
    expect(cardWithSchedule({ selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'unknown' })).toMatchObject({
      areaName: UNASSIGNED_AREA_NAME,
      areaRowName: UNASSIGNED_AREA_NAME,
      areaRowStatus: 'unknown',
      offeredSuggestion: null,
      locationSource: 'schedule',
      confidenceScore: 45,
      locationNotice: null,
    });
  });
});

// Guards: these already hold.
describe('guards: where the card names an area', () => {
  it('an area he picked is his confirmed selection, with or without a schedule', () => {
    expect(cardWithSchedule({ selectedArea: north, selectedAreaName: 'North Pad', areaStatus: 'confirmed' }).reason).toBe(CONFIRMED);
  });

  it('a GPS suggestion still gives the GPS reason', () => {
    const areaSuggestion: AreaSuggestion = { area: north, distanceFeet: 20, withinRadius: true };
    expect(cardWithSchedule({ selectedAreaName: UNASSIGNED_AREA_NAME, areaStatus: 'unknown', areaSuggestion }).reason)
      .toBe('GPS places you in North Pad. Accept it to use it for this update.');
  });

  // Not changed here, and pinned so that it is known: a named place that is
  // not one of the project's saved areas (a task's own location) still gets
  // the schedule's line when the project has a schedule suggestion, whether
  // or not that suggestion is this place. The card is not told which area
  // the schedule suggests.
  it('unchanged: a task\'s named location on a project with a schedule suggestion still gets the schedule\'s line', () => {
    expect(cardWithSchedule({ selectedAreaName: 'Building 3', areaStatus: 'confirmed' }).reason).toBe(SCHEDULE_LINE);
  });
});
