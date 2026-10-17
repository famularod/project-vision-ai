/**
 * Build 232 item 4c (the coordinator's decision, 13 Oct 2026; review pass 9, finding R9-1): a plain field note takes
 * only a place that Build 231 left empty.
 *
 * A work area of the written report prints at most three lines, chosen by KIND before date: its first progress line,
 * its first problem, its first next step, then the rest. Item 4 part B prints his plain notes (neither progress, a
 * problem nor a next step), and it filed them WITH the progress lines. So a plain note of ANY age took the "first
 * progress" place and pushed out a newer line of another kind that Build 231 printed:
 *   R9-1. In Level 2 a plain note of 3 Sep ("Radio batteries were swapped."), a problem of 7 Oct and two requests of
 *         9 and 11 Oct. Build 231 printed the problem and both requests; after part B "Please schedule the sprinkler
 *         inspection." was in no line and the 3 Sep note was.
 *   Second form: in an area with no progress note, the newest plain note took the first line and the area's second
 *         problem was gone.
 * Now an area's lines are chosen exactly as Build 231 chose them, the plain notes not counted; then, if fewer than
 * three were chosen, his plain notes fill the places left, newest first, printed after those lines. "See Image N"
 * goes, as on Build 231, to the area's first progress line; a plain note carries it only when it is the area's only
 * line. The project and every note are invented. Synthetic data. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { buildDailyProjectUpdate } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

const PROJECT = 'Quartz Hall';
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const note = (id: string, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, date, photos, recipients: { contactIds: [] },
  notes, status: 'sent', scheduleItemId: null, scheduleTaskName: null, selectedAreaName: area,
}) as unknown as ProjectUpdate;
/** The work areas of the report as a client reads them: "<project> — <area>" and the lines under it. */
const printed = (updates: ProjectUpdate[]) =>
  buildDailyProjectUpdate({ selectedProjectNames: [PROJECT], savedUpdates: updates, scheduleItems: [] } as never)
    .locationGroups.flatMap(group => group.workAreas.map(area => ({
      area: `${area.projectName} — ${area.title}`, lines: area.bullets.map(bullet => bullet.text),
    })));
/** Both orders a device can hold the same records in: the phone's (newest first) and the iPad's (oldest first). */
const onBothDevices = (updates: ProjectUpdate[]) => {
  const phone = printed([...updates].reverse());
  const ipad = printed(updates);
  expect(ipad).toEqual(phone);
  return phone;
};

describe('B232 item 4c: a plain note takes only a place Build 231 left empty', () => {
  it('R9-1, the reviewer\'s steps: an OLD plain note no longer pushes out a newer request', () => {
    expect(onBothDevices([
      note('qu05', 'Level 2', '2026-09-03', 'Radio batteries were swapped.'),
      note('qu06', 'Level 2', '2026-10-07', 'Stair pressurization test failed. Stair finishes are on hold.'),
      note('qu07', 'Level 2', '2026-10-09', 'Please schedule the sprinkler inspection.'),
      note('qu08', 'Level 2', '2026-10-11', 'Please send the tile layout to the architect.'),
    ])).toEqual([{
      // Build 231's three lines, to the letter; the area is full, so the plain note has no place.
      area: 'Quartz Hall — Level 2',
      lines: [
        'Stair pressurization test failed. Stair finishes are on hold.',
        'Send the tile layout to the architect.',
        'Schedule the sprinkler inspection.',
      ],
    }]);
  });

  it('R9-1, second form: in an area with no progress note, a NEWER plain note no longer pushes out the second problem', () => {
    expect(onBothDevices([
      note('qu02', 'Level 1', '2026-10-06', 'Elevator inspection failed. Lobby finishes are on hold.'),
      note('qu03', 'Level 1', '2026-10-08', 'Please confirm the handrail height with the inspector.'),
      note('qu04', 'Level 1', '2026-10-10', 'Slab crack found at grid 5. Tile cannot start there.'),
      note('qu16', 'Level 1', '2026-10-12', 'Lunch truck moved to the back gate.'),
    ])).toEqual([{
      area: 'Quartz Hall — Level 1',
      lines: [
        'Slab crack found at grid 5. Tile cannot start there.',
        'Confirm the handrail height with the inspector.',
        'Elevator inspection failed. Lobby finishes are on hold.',
      ],
    }]);
  });

  it('where Build 231 left places empty, his plain notes fill them, newest first, after the lines Build 231 printed', () => {
    expect(onBothDevices([
      note('qu20', 'Level 3', '2026-10-02', 'Coffee order was doubled.'),
      note('qu21', 'Level 3', '2026-10-06', 'Fire alarm test failed. Level 3 finishes are on hold.'),
      note('qu22', 'Level 3', '2026-10-08', 'Radio batteries were swapped.'),
      note('qu23', 'Level 3', '2026-10-10', 'Courier dropped off the samples.'),
      note('qu24', 'Lobby', '2026-10-05', 'Tenant asked for a tour.'),
      note('qu25', 'Lobby', '2026-10-09', 'Ceiling grid was installed in the lobby.'),
      note('qu26', 'Lobby', '2026-10-11', 'Lender asked for an updated calendar.'),
      note('qu27', 'Lobby', '2026-10-12', 'Insurance agent took notes.'),
    ])).toEqual([
      {
        area: 'Quartz Hall — Lobby',
        lines: [
          'Ceiling grid was installed in the lobby.',
          'Insurance agent took notes.',
          'Lender asked for an updated calendar.',
        ],
      },
      {
        area: 'Quartz Hall — Level 3',
        lines: [
          'Fire alarm test failed. Level 3 finishes are on hold.',
          'Courier dropped off the samples.',
          'Radio batteries were swapped.',
        ],
      },
    ]);
  });

  it('an area of plain notes only prints them, newest first, as before', () => {
    expect(onBothDevices([
      note('qu30', 'Parking', '2026-10-03', 'Owner stopped by at noon.'),
      note('qu31', 'Parking', '2026-10-05', 'Bank appraiser signed the visitor log.'),
      note('qu32', 'Parking', '2026-10-07', 'Mail carrier left a parcel at the trailer.'),
      note('qu33', 'Parking', '2026-10-09', 'Reporter asked for a quote.'),
    ])).toEqual([{
      area: 'Quartz Hall — Parking',
      lines: ['Reporter asked for a quote.', 'Mail carrier left a parcel at the trailer.', 'Bank appraiser signed the visitor log.'],
    }]);
  });

  it('"See Image N" stands on the area\'s first progress line, as on Build 231, not on a newer plain note (R3)', () => {
    const lines = onBothDevices([
      note('qu40', 'Site', '2026-10-06', 'Footing rebar is installed at the east line.', [photo('qp40', 'Site', '')]),
      note('qu41', 'Site', '2026-10-08', 'Gate lock was changed.'),
    ]);
    expect(lines).toEqual([{
      area: 'Quartz Hall — Site',
      lines: ['Footing rebar has been installed at the east line. See Image 1.', 'Gate lock was changed.'],
    }]);
  });

  it('a plain note carries the photo numbers only when it is the area\'s only line', () => {
    const lines = onBothDevices([
      note('qu50', 'Roof', '2026-10-06', 'Glazing shop drawings are approved.', [photo('qp50', 'Roof', 'Shop drawing set')]),
      note('qu51', 'Basement', '2026-10-07', 'Tenant asked for a tour.', [photo('qp51', 'Basement', 'Visitors at the stair')]),
      note('qu52', 'Basement', '2026-10-09', 'Neighbor waved from across the street.'),
    ]);
    expect(lines).toEqual([
      { area: 'Quartz Hall — Basement', lines: ['See Image 1.', 'Neighbor waved from across the street.', 'Tenant asked for a tour.'] },
      { area: 'Quartz Hall — Roof', lines: ['Glazing shop drawings are approved. See Image 2.'] },
    ]);
  });
});
