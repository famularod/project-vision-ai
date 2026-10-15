/**
 * Build 232 item 4, part C (the coordinator's decision; reviews pass 3 finding R3-O1): in a combined report a field
 * update belongs to its own project.
 *
 * The phone's older report writer (services/PIEReporter.ts reportContextForUpdate) learns the schedule project of an
 * update that names none from the first task whose project name OR AREA NAME equals the update's. In a combined
 * report of two projects that each have an area "Site", a task of the OTHER project matched by the area's name and
 * gave the update its project: both projects' notes were printed under one of them, the other's own note could be
 * cut by the three-line limit, and its photos were left out.
 *
 * Now, in a report of more than one project, a task that names another schedule project than the one the update was
 * recorded in, and shares only an area name with it, claims nothing: the update is its own project's. A report of
 * one project is not touched by one word. Synthetic data (the reviewer's case, notes/p6-b232/rv3-reports-combined).
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import * as fs from 'fs';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const OUT = process.env.B232_OUT_DIR || '';
const keep = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const task = (id: string, project: string, area: string, name: string, finish: string, status = 'In Progress') => ({
  id, projectName: project, scheduleProjectName: project, locationName: area, taskName: name,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: 0, priority: 'Medium', status, notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const photo = (id: string, caption: string) => ({ id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', createdAt: '2026-10-10T12:00:00.000Z' });
/** A field update as he records it from the project's page: it names its project, and no schedule project. */
const note = (id: string, project: string, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: project, date, photos, recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName: area,
}) as unknown as ProjectUpdate;

/** Harbor and Ridge each have a task at "Site"; which of the two finishes first is `ridgeSiteFinish`'s to say. */
const TASKS = (ridgeSiteFinish: string) => [
  task('h1', 'Harbor', 'Site', 'Pour slab', '11/20/2026', 'Waiting'),
  task('h2', 'Harbor', 'Level 1', 'Framing', '10/25/2026'),
  task('r1', 'Ridge', 'Site', 'Set forms', ridgeSiteFinish, 'Waiting'),
];
const UPDATES = [
  note('u1', 'Harbor', 'Site', '2026-10-08', 'Footing excavation is complete at the north side.', [photo('p1', 'Excavation complete at the north footing.'), photo('p2', 'Rebar delivered to the laydown area.')]),
  note('u2', 'Harbor', 'Site', '2026-10-11', 'Rebar is tied at the north footing.', [photo('p3', 'Rebar tied at the north footing.')]),
  note('u3', 'Harbor', 'Level 1', '2026-10-10', 'Framing is complete at the east wall.', [photo('p4', 'East wall framing complete.')]),
  note('u4', 'Ridge', 'Site', '2026-10-09', 'Formwork is staged at the south pad.', [photo('p5', 'Formwork staged at the south pad.')]),
];
const HARBORS = ['Footing excavation is complete at the north side', 'Rebar is tied at the north footing', 'Framing is complete at the east wall'];
const RIDGES = ['Formwork is staged at the south pad'];
const PHOTOS: Record<string, string> = { p1: 'Harbor', p2: 'Harbor', p3: 'Harbor', p4: 'Harbor', p5: 'Ridge' };

const write = (reportType: string, selected: string[], updates: ProjectUpdate[], tasks: ScheduleItem[]) =>
  buildPIEReportDraft({ reportType, audience: 'internal_team', selectedProjectNames: selected, savedUpdates: updates, scheduleItems: tasks, generatedAt: new Date('2026-10-13T16:00:00.000Z') } as never);
/** Every line of the report with the project it is printed under. */
const linesByProject = (draft: ReturnType<typeof write>) => draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
  area.bullets.map(bullet => ({ project: area.projectName, area: area.title, line: bullet.text }))));

describe('B232 item 4 part C: in a combined report a field update belongs to its own project', () => {
  for (const [label, finish] of [['Ridge\'s task at Site finishes first', '10/20/2026'], ['Harbor\'s task at Site finishes first', '12/20/2026']] as const) {
    it(`${label}: each project's notes are under that project, none is cut by the other's, and each photo is with its own project`, () => {
      const draft = write('combined_project_update', ['Harbor', 'Ridge'], UPDATES, TASKS(finish));
      keep(`combined-${finish.replace(/\//g, '-')}.txt`, draft.body);
      const lines = linesByProject(draft);
      const under = (words: string) => lines.filter(entry => entry.line.includes(words)).map(entry => entry.project);
      expect(Object.fromEntries(HARBORS.map(words => [words, under(words)]))).toEqual(Object.fromEntries(HARBORS.map(words => [words, ['Harbor']])));
      expect(Object.fromEntries(RIDGES.map(words => [words, under(words)]))).toEqual(Object.fromEntries(RIDGES.map(words => [words, ['Ridge']])));
      // Every photo is listed, under a work area of the project its update was recorded in.
      const listed = draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.imageReferences.map(reference => [reference.photoId, area.projectName] as const)));
      expect(Object.fromEntries(listed)).toEqual(PHOTOS);
      // And the other device, holding the same updates and tasks the other way round, writes the same report.
      expect(write('combined_project_update', ['Harbor', 'Ridge'], [...UPDATES].reverse(), [...TASKS(finish)].reverse()).body).toBe(draft.body);
    });
  }

  it('a report of ONE project is not changed by one word, whatever tasks it is handed', () => {
    const harborsOwn = { updates: UPDATES.filter(update => update.projectName === 'Harbor'), tasks: TASKS('10/20/2026').filter(item => item.projectName === 'Harbor') };
    const daily = write('daily_project_update', ['Harbor'], harborsOwn.updates, harborsOwn.tasks);
    // Handed Ridge's task too (a name two schedule projects share can do it): as it was before this change.
    const withRidgesTask = write('daily_project_update', ['Harbor'], harborsOwn.updates, TASKS('10/20/2026'));
    keep('daily-harbor.txt', daily.body);
    keep('daily-harbor-with-ridges-task.txt', withRidgesTask.body);
    expect(daily.body).toBe(DAILY_HARBOR);
    expect(withRidgesTask.body).toBe(DAILY_HARBOR_HANDED_RIDGES_TASK);
  });
});

/** The daily report of Harbor as the writer wrote it before this change. */
const DAILY_HARBOR = [
  'Please review the updates below and look for action items assigned to your name.',
  '',
  'Project Summary',
  '• Construction progress was reported or visually observed in 1 area; verification status is identified in the detailed evidence.',
  '• Key update: Harbor / Site — Rebar is tied at the north footing.',
  '• Priority concern: Harbor / Site — Pour slab, due 11/20/2026, status Waiting, owner Dana',
  '• Next action: Harbor / Site — Footing excavation is complete at the north side.',
  '• Schedule attention is indicated in 2 areas.',
  '',
  'Harbor',
  '',
  '1. Site',
  // Open item 7.62: Images 3 and 4 were taken with the footing excavation note; they were cited on the rebar note.
  '• Progress: Rebar is tied at the north footing. See Image 1.',
  '• Action: Footing excavation is complete at the north side. See Images 3 and 4.',
  '• Progress: Rebar tied at the north footing.',
  '• Issue: Pour slab, due 11/20/2026, status Waiting, owner Dana.',
  '• Action: Dana – Please confirm what is blocking Pour slab.',
  '',
  '2. Level 1',
  '• Action: Framing is complete at the east wall.',
  '• Action: East wall framing complete.',
  '• Evidence: See Image 2.',
  '',
  'Please let me know if you have any questions.',
].join('\n');
/** The same, handed Ridge's task as well: as the writer wrote it before this change (but for open item 4.87's photos). */
const DAILY_HARBOR_HANDED_RIDGES_TASK = [
  'Please review the updates below and look for action items assigned to your name.',
  '',
  'Project Summary',
  '• Construction progress was reported or visually observed in 1 area; verification status is identified in the detailed evidence.',
  '• Key update: Ridge / Site — Rebar is tied at the north footing.',
  '• Priority concern: Harbor / Site — Pour slab, due 11/20/2026, status Waiting, owner Dana',
  '• Next action: Ridge / Site — Footing excavation is complete at the north side.',
  '• Schedule attention is indicated in 2 areas.',
  '',
  'Ridge',
  '',
  '1. Site',
  // Open item 4.87 (13 Oct 2026): Harbor's three Site photos were in no line and attached nowhere here (their lines
  // are printed under Ridge, the case this test keeps as it was); each now goes with the lines of its own update.
  // Open item 7.62: Images 3 and 4 were taken with the footing excavation note; they were cited on the rebar note.
  '• Progress: Rebar is tied at the north footing. See Image 1.',
  '• Action: Footing excavation is complete at the north side. See Images 3 and 4.',
  '• Progress: Rebar tied at the north footing.',
  '',
  'Harbor',
  '',
  '1. Level 1',
  '• Action: Framing is complete at the east wall.',
  '• Action: East wall framing complete.',
  '• Evidence: See Image 2.',
  '',
  '2. Site',
  '• Issue: Pour slab, due 11/20/2026, status Waiting, owner Dana.',
  '• Action: Dana – Please confirm what is blocking Pour slab.',
  '',
  'Please let me know if you have any questions.',
].join('\n');
