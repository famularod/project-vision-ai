/**
 * Build 232 item 4, part B (the coordinator's decision; reviews pass 2 finding O2): no field note falls through.
 *
 * The phone's older report writer (services/PIEReporter.ts) makes a work area's lines from three lists: progress,
 * problems, next steps. A field note was put in "progress" only if it used a word of the writer's own construction
 * vocabulary (install, pour, frame, slab, wall, inspect ... services/dave-construction-relevance.ts), in "problems"
 * only if it read as an issue or a blocker, in "next steps" only if it used an action word (please, confirm,
 * verify, approve ...). A note of none of the three was in no list and so in no line of the report:
 * "Glazing shop drawings are approved." ("approved" is not "approve"), "Sprinkler main is hung in Bay B.", "Anchor
 * bolts were surveyed at the dock.", "Plumber found a broken cleanout at the site lateral. Dana to call the city."
 * ("plumber" is not "plumbing"). And a note with a word the writer takes for an incidental thing in a photo
 * (table, chair, desk, monitor, dog ...) and no construction word was dropped before the lists were made.
 *
 * Now a field note of none of the three kinds is listed with the progress notes, a plain observation: in the same
 * order (newest first) and under the same allowance of lines. Synthetic data. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { buildDailyProjectUpdate } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

const note = (id: string, area: string, date: string, notes: string, extra: Record<string, unknown> = {}) => ({
  id, projectName: 'Harbor Lofts', scheduleProjectName: 'Harbor Lofts', date, photos: [], recipients: { contactIds: [] },
  notes, status: 'sent', scheduleItemId: null, scheduleTaskName: null, selectedAreaName: area, ...extra,
}) as unknown as ProjectUpdate;
/** The work areas of the report as a client reads them: "<project> — <area>" and the lines under it. */
const printed = (updates: ProjectUpdate[]) =>
  buildDailyProjectUpdate({ selectedProjectNames: ['Harbor Lofts'], savedUpdates: updates, scheduleItems: [] } as never)
    .locationGroups.flatMap(group => group.workAreas.map(area => ({
      area: `${area.projectName} — ${area.title}`, lines: area.bullets.map(bullet => bullet.text),
    })));

describe('B232 item 4 part B: no field note falls through', () => {
  it('the four notes the reviewer found in no line are each a line of their area', () => {
    expect(printed([
      note('u4', 'Site', '2026-10-12', 'Plumber found a broken cleanout at the site lateral. Dana to call the city.'),
      note('u3', 'Level 1', '2026-10-10', 'Glazing shop drawings are approved.'),
      note('u2', 'Bay B', '2026-10-09', 'Sprinkler main is hung in Bay B.'),
      note('u1', 'Dock', '2026-10-08', 'Anchor bolts were surveyed at the dock.'),
    ])).toEqual([
      { area: 'Harbor Lofts — Site', lines: ['Plumber found a broken cleanout at the site lateral. Dana to call the city.'] },
      { area: 'Harbor Lofts — Level 1', lines: ['Glazing shop drawings are approved.'] },
      { area: 'Harbor Lofts — Bay B', lines: ['Sprinkler main is hung in Bay B.'] },
      { area: 'Harbor Lofts — Dock', lines: ['Anchor bolts were surveyed at the dock.'] },
    ]);
  });

  // Changed by item 4c (the coordinator's decision; review pass 9, R9-1). This test pinned the plain note in the
  // area's FIRST progress place, which pushed out a line Build 231 printed ("Trench is backfilled at the site
  // lateral."). Now Build 231's lines are chosen first, the plain notes not counted, and the plain notes fill only
  // the places left, newest first: here one place, so "Called the office about parking." has none.
  it('it is printed after the lines Build 231 chose, newest first, in the places they leave (item 4c)', () => {
    expect(printed([
      note('u4', 'Site', '2026-10-12', 'Plumber found a broken cleanout at the site lateral. Dana to call the city.'),
      note('u3', 'Site', '2026-10-10', 'Underground plumbing passed the pressure test.'),
      note('u2', 'Site', '2026-10-08', 'Called the office about parking.'),
      note('u1', 'Site', '2026-10-06', 'Trench is backfilled at the site lateral.'),
    ])).toEqual([{
      area: 'Harbor Lofts — Site',
      lines: [
        'Underground plumbing passed the pressure test.',
        'Trench is backfilled at the site lateral.',
        'Plumber found a broken cleanout at the site lateral. Dana to call the city.',
      ],
    }]);
  });

  it('a note with a word the writer takes for an incidental thing in a photo is his note all the same', () => {
    expect(printed([note('u1', 'Trailer', '2026-10-12', 'Conference table and chairs were delivered to the trailer.')])).toEqual([
      { area: 'Harbor Lofts — Trailer', lines: ['Conference table and chairs were delivered to the trailer.'] },
    ]);
  });

  it('a problem and a next step are where they were', () => {
    expect(printed([
      note('u2', 'Level 1', '2026-10-12', 'West bay rebar failed inspection. Pour is on hold.'),
      note('u1', 'Level 2', '2026-10-11', 'Please confirm the delivery date for the storefront.'),
    ])).toEqual(AS_BEFORE);
  });

  it('what the photo analysis suggested and he accepted word for word is still left out unless it is about the work', () => {
    const suggested = 'A person is standing near the gate.';
    expect(printed([note('u1', 'Site', '2026-10-12', suggested, { pieSuggestedNote: suggested, pieSuggestedNoteAccepted: true })])).toEqual([]);
  });
});

/** The lines of a problem and of a next step, as the writer printed them before this change. */
const AS_BEFORE = [
  { area: 'Harbor Lofts — Level 1', lines: ['West bay rebar failed inspection. Pour is on hold.'] },
  { area: 'Harbor Lofts — Level 2', lines: ['Confirm the delivery date for the storefront.'] },
];
