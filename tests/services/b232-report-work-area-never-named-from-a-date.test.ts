/**
 * Build 232 item 3, part 2 (the coordinator's decision): a date printed in a line is never a building number, and
 * NOT ONE LINE LEAVES OR COMES.
 *
 * The phone's older report writer (services/PIEReporter.ts) names a line's work area from the project's name, the
 * area's name and the line's own words, and takes a four-digit number for a building number ("Building 2321 East
 * Driveway" is filed under "2321 East Driveway"). It took the YEAR of any date in the line the same way, so every
 * schedule line that prints its due date was filed under "<project> — 2026 <area>", and a client read "Tower — 2026
 * Site: Rough in electrical, due 10/08/2026, status Waiting, owner Dana."
 *
 * A work area prints at most three lines. "Site" (the field notes) and "2026 Site" (the schedule lines) each had
 * their own three. So the lines are FILED exactly as before, each group with its own three, and the groups whose
 * name differs only by the year of a date are PRINTED as one work area, under the area's own name: the notes' lines,
 * then the schedule's. The same lines, each area once, no "2026". A real number in a project's, an area's or a
 * task's own name names the area as before. Synthetic data. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { buildDailyProjectUpdate, cleanReportWorkAreaName, printedReportWorkAreaName } from '../../services/PIEReporter';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const LINE = 'Rough in electrical, due 10/08/2026, status Waiting, owner Dana';

const waiting = {
  id: 't1', projectName: 'Tower', scheduleProjectName: 'Tower', locationName: 'Site', taskName: 'Rough in electrical',
  startDate: '09/01/2026', finishDate: '10/08/2026', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: 0, priority: 'Medium', status: 'Waiting', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
} as unknown as ScheduleItem;
const note = (id: string, date: string, notes: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date, photos: [], recipients: { contactIds: [] },
  notes, status: 'sent', scheduleItemId: 't1', scheduleTaskName: 'Rough in electrical', selectedAreaName: 'Site',
}) as unknown as ProjectUpdate;
/** The work areas of the report as a client reads them: "<project> — <area>" and the lines under it. */
const printed = (updates: ProjectUpdate[], tasks: ScheduleItem[] = [waiting]) =>
  buildDailyProjectUpdate({ selectedProjectNames: ['Tower'], savedUpdates: updates, scheduleItems: tasks } as never)
    .locationGroups.flatMap(group => group.workAreas.map(area => ({
      area: `${area.projectName} — ${area.title}`, lines: area.bullets.map(bullet => bullet.text),
    })));

describe('B232 item 3 part 2: a work area is never named from a date, and not one line leaves or comes', () => {
  it('a schedule line that prints its due date is printed under the area\'s own name', () => {
    expect(printedReportWorkAreaName('Tower', 'Site', LINE)).toBe('Site');
    // With no area of its own it is printed under the project, as a line with no date is.
    expect(printedReportWorkAreaName('Tower', '', LINE)).toBe('Tower');
    // It is still FILED apart, with its own three lines, as before.
    expect(cleanReportWorkAreaName('Tower', 'Site', LINE)).toBe('2026 Site');
  });

  it('every form the app writes or reads a date in: none of them names the area', () => {
    const named = Object.fromEntries([
      'Rough in electrical, due 10/08/2026, status Waiting',
      'Rough in electrical, due 10/8/2026, status Waiting',
      'Rough in electrical, due 2026-10-08, status Waiting',
      'Rough in electrical, due 2026/10/08, status Waiting',
      'Rough in electrical, due Oct 8, 2026, status Waiting',
      'Rough in electrical, due October 8, 2026, status Waiting',
      'Rough in electrical, due 8 Oct 2026, status Waiting',
      'Inspection passed on Thursday, Oct 8, 2026 at 3:00 PM.',
      'The pour is planned for October 2026.',
      'Latest update: Forms are set. Schedule focus: Pour slab (was due 10/09/2026).',
    ].map(line => [line, printedReportWorkAreaName('Tower', 'Site', line)]));
    expect(named).toEqual(Object.fromEntries(Object.keys(named).map(line => [line, 'Site'])));
  });

  it('a real number in a name still names the area, exactly as before, with a date in the line or without', () => {
    const lines: Array<[string, string, string, string]> = [
      ['the area\'s own name: Building 2100', 'Tower', 'Building 2100', LINE],
      ['the area\'s own name: Level 2026', 'Tower', 'Level 2026', LINE],
      ['the area\'s own name: Level 2026, no date in the line', 'Tower', 'Level 2026', 'Hang drywall, status Waiting, owner Dana'],
      ['the task\'s own name: Building 2100 slab', 'Tower', 'Site', 'Building 2100 slab, due 10/08/2026, status Waiting, owner Dana'],
      ['the task\'s own name: Unit 2026 punch list', 'Tower', 'Site', 'Unit 2026 punch list, due 10/08/2026, status Waiting, owner Dana'],
      ['the project\'s own name: 2375 Compliance Project', '2375 Compliance Project', 'Site', LINE],
      ['a number in a note: racking at 2321', 'Tower', '', 'Racking at 2321 east driveway is complete.'],
      ['the writer\'s own example', 'Tower', 'Building 2321 East Driveway East Driveway', ''],
    ];
    expect(Object.fromEntries(lines.map(([name, project, area, line]) => [name, printedReportWorkAreaName(project, area, line)]))).toEqual(AS_BEFORE);
    // And each is filed where it is printed: nothing about these lines changes.
    expect(Object.fromEntries(lines.map(([name, project, area, line]) => [name, cleanReportWorkAreaName(project, area, line)]))).toEqual(AS_BEFORE);
  });

  it('through the writer: a note and a waiting task at the Site are one work area, "Tower — Site", with the same three lines', () => {
    expect(printed([note('u1', '2026-10-03', 'Conduit is installed along the north fence.')])).toEqual([{
      area: 'Tower — Site',
      lines: [
        'Conduit is installed along the north fence.',
        'Rough in electrical, due 10/08/2026, status Waiting, owner Dana.',
        'Dana – Please confirm what is blocking Rough in electrical.',
      ],
    }]);
  });

  it('NOT ONE LINE LEAVES: three notes and a waiting task at the Site print five lines under one heading, where three and two printed under two', () => {
    // Before: "Tower — Site" with the three notes, and "Tower — 2026 Site" with the task's two lines.
    expect(printed([
      note('u1', '2026-10-03', 'Conduit is installed along the north fence.'),
      note('u2', '2026-10-02', 'Trenching is finished at the east gate.'),
      note('u3', '2026-10-01', 'Light pole bases were poured.'),
    ])).toEqual([{
      area: 'Tower — Site',
      lines: [
        'Conduit is installed along the north fence.',
        'Trenching is finished at the east gate.',
        'Light pole bases were poured.',
        'Rough in electrical, due 10/08/2026, status Waiting, owner Dana.',
        'Dana – Please confirm what is blocking Rough in electrical.',
      ],
    }]);
  });

  it('NOT ONE LINE COMES: the notes keep their limit of three, and the schedule lines theirs', () => {
    // Four notes at the Site: three print, as before. Two waiting tasks there (four lines of theirs): three print, as before.
    const second = { ...waiting, id: 't2', taskName: 'Set light poles', finishDate: '10/20/2026', owner: 'Luis' } as ScheduleItem;
    const areas = printed([
      note('u1', '2026-10-03', 'Conduit is installed along the north fence.'),
      note('u2', '2026-10-02', 'Trenching is finished at the east gate.'),
      note('u3', '2026-10-01', 'Light pole bases were poured.'),
      note('u4', '2026-09-30', 'Survey stakes are set along the south fence.'),
    ], [waiting, second]);
    expect(areas.map(area => area.area)).toEqual(['Tower — Site']);
    expect(areas[0].lines.slice(0, 3)).toEqual([
      'Conduit is installed along the north fence.',
      'Trenching is finished at the east gate.',
      'Light pole bases were poured.',
    ]);
    expect(areas[0].lines).toHaveLength(6);
    expect(areas[0].lines).not.toContain('Survey stakes are set along the south fence.');
  });

  it('a number that is a line\'s own keeps its area apart, as before: "Unit 2026" is not the Site', () => {
    const unit = { ...waiting, id: 't3', taskName: 'Unit 2026 punch list' } as ScheduleItem;
    expect(printed([note('u1', '2026-10-03', 'Conduit is installed along the north fence.')], [unit]).map(area => area.area))
      .toEqual(['Tower — Site', 'Tower — 2026 Site']);
  });
});

/** What the writer named these before this change (run on the commit before it): a real number is not touched. */
const AS_BEFORE = {
  'the area\'s own name: Building 2100': '2100',
  'the area\'s own name: Level 2026': '2026 Level',
  'the area\'s own name: Level 2026, no date in the line': '2026 Level',
  'the task\'s own name: Building 2100 slab': '2100 Site',
  'the task\'s own name: Unit 2026 punch list': '2026 Site',
  'the project\'s own name: 2375 Compliance Project': '2375 Site',
  'a number in a note: racking at 2321': '2321 Tower',
  'the writer\'s own example': '2321 East Driveway',
};
