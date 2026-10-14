jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import type { ScheduleItem } from '../../types';

// High item 2, after the first independent review (the owner's instruction of 13 Oct 2026, the three high items;
// open item 2.33). Four things the review found in the desktop's upload of a schedule file:
//  H1S-1  two names the app does not know ("6101", "6102") with the same task on the same day: both rows were
//         "Needs Project" before the duplicate check, so one was dropped with no word. Every row must reach the list.
//  L-1    the one button offered the ticked project for a name that plainly names another of his projects.
//  L-3    the red line said "not one of your open projects" of a name that fits two of his projects equally.
//  L-4    with no open project in the cloud's list, the page's list (with names known only from saved tasks) was read.
// The desktop's own functions. Made-up projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];

type Review = web.DAVEWebScheduleUploadProjectReview;
const ops = web as unknown as Record<string, ((...args: never[]) => unknown) | undefined>;
const review = (prepared: unknown) => (web.daveWebScheduleUploadProjectReview as unknown as (value: unknown) => Review)(prepared);
const otherProjectLine = (prepared: unknown): string | null => {
  const line = ops.daveWebScheduleUploadOtherProjectLine as unknown as ((value: unknown) => string | null) | undefined;
  if (!line) throw new Error('this build has no line naming the project the file points to');
  return line(prepared);
};
/** The review's own choice of a task's project, as desktop-read-only-shell.tsx makes it. */
const give = <T extends { scheduleItems: readonly ScheduleItem[] }>(prepared: T, index: number, project: string): T => ({
  ...prepared,
  scheduleItems: prepared.scheduleItems.map((item, at) => (at === index ? { ...item, projectName: project, scheduleProjectName: project } : item)),
});
type Line = readonly [task: string, project: string, start: string, finish: string];
const csv = (rows: readonly Line[]) => ['Task,Project,Area,Start,Finish,Percent Complete', ...rows.map(([name, project, start, finish]) => `${name},${project},Lot,${start},${finish},`)].join('\n');
const fieldPlan = (project: string): Line[] => [
  ['Pour footings', project, '10/26/2026', '10/30/2026'], ['Set steel', project, '11/02/2026', '11/06/2026'], ['Deck and detail', project, '11/09/2026', '11/13/2026'],
];
const prepare = (ticked: readonly string[], contents: string, extra: Partial<{ projects: string[]; openProjectNames: string[] }> = {}) => web.prepareDAVEWebDocumentUpload({
  fileName: 'Field plan.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: ticked,
  projects: extra.projects ?? [...ALL], ...(extra.openProjectNames ? { openProjectNames: extra.openProjectNames } : {}),
  fingerprint: 'c'.repeat(64), now: '2026-10-13T18:00:00.000Z',
});
const listed = (prepared: ReturnType<typeof prepare>) => prepared.scheduleItems.map(item => `${item.taskName} | ${web.daveWebScheduleUploadRowProject(prepared, item)}`);
const SNAPSHOT = { referenceDocuments: [], scheduleItems: [], knownScheduleItems: [] };

describe('the desktop\'s upload review after the first independent review (High item 2)', () => {
  it('H1S-1: two names the app does not know, the same task on the same day for each: every row of the file is listed, in its own group', () => {
    const file = csv([
      ['Safety walk', '6101', '10/26/2026', '10/30/2026'], ['Safety walk', '6102', '10/26/2026', '10/30/2026'],
      ['Pour footings', '6101', '10/26/2026', '10/30/2026'], ['Refit', '6102', '10/26/2026', '10/30/2026'],
    ]);
    const prepared = prepare([QUAY, MILL], file);
    expect(listed(prepared)).toEqual([
      'Safety walk | Needs Project (the file names "6101")', 'Safety walk | Needs Project (the file names "6102")',
      'Pour footings | Needs Project (the file names "6101")', 'Refit | Needs Project (the file names "6102")',
    ]);
    expect(prepared.reviewMessage.startsWith('4 schedule activities extracted for 2 selected projects.')).toBe(true);
    expect(review(prepared).heldLine).toBe('4 tasks need a project before you can upload: the file names their projects "6101" and "6102", which are not among your open projects. Choose a project for each of them above.');
    // He gives each its job: both Safety walks are uploaded, one for each project.
    const given = give(give(give(give(prepared, 0, QUAY), 1, MILL), 2, QUAY), 3, MILL);
    expect(review(given).heldLine).toBeNull();
    const plan = web.planDAVEWebScheduleImport({ snapshot: SNAPSHOT as never, importedScheduleItems: web.withDAVEWebScheduleUploadRole(given, 'master').scheduleItems });
    expect(plan.additions.map(item => `${item.taskName} | ${item.projectName}`)).toEqual(['Safety walk | 6101 Quay Works', 'Safety walk | 6102 Mill Yard', 'Pour footings | 6101 Quay Works', 'Refit | 6102 Mill Yard']);
  });

  it('H1S-1: the duplicate check still drops a row the file gives twice under the same name, and a row it gives twice as one of his projects (as before)', () => {
    const twice = prepare([QUAY, MILL], csv([['Safety walk', '6101', '10/26/2026', '10/30/2026'], ['Safety walk', '6101', '10/26/2026', '10/30/2026'], ['Refit', '6102', '10/26/2026', '10/30/2026']]));
    expect(listed(twice)).toEqual(['Safety walk | Needs Project (the file names "6101")', 'Refit | Needs Project (the file names "6102")']);
    // "Garden shed" and "Garden-shed" are one project: the phone's order (the project, then the duplicate check).
    const one = prepare(ALL, csv([['Footings', SHED, '10/26/2026', '10/30/2026'], ['Footings', 'Garden-shed', '10/26/2026', '10/30/2026']]));
    expect(listed(one)).toEqual(['Footings | Garden shed']);
    // One project ticked and two names: two groups, no one button; the choice on each task stays its own.
    const groups = prepare([QUAY], csv([['Safety walk', '6101', '10/26/2026', '10/30/2026'], ['Safety walk', 'Quay', '10/26/2026', '10/30/2026']]));
    expect(listed(groups)).toEqual(['Safety walk | Needs Project (the file names "6101")', 'Safety walk | Needs Project (the file names "Quay")']);
    expect(review(groups).useForAll).toBeNull();
    expect(review(give(groups, 0, QUAY)).heldLine).toBe('1 task needs a project before you can upload: the file names its project "Quay", which is not one of your open projects. Choose a project for it above.');
  });

  it('L-1: no one button for a name that plainly names another of his projects; a line says which, and how to tick it', () => {
    const mill = prepare([QUAY], csv(fieldPlan('6102')));
    expect(review(mill).useForAll).toBeNull();
    expect(review(mill).heldLine).toBe('3 tasks need a project before you can upload: the file names their project "6102", which is not one of your open projects. Choose a project for each of them above.');
    expect(otherProjectLine(mill)).toBe('"6102" in the file looks like your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.');
    // The review's second case: Garden shed ticked, two rows of Garden shed and two "6101".
    const mixed = prepare([SHED], csv([['Slab', SHED, '10/26/2026', '10/30/2026'], ['Walls', SHED, '11/02/2026', '11/06/2026'], ['Pour footings', '6101', '10/26/2026', '10/30/2026'], ['Set steel', '6101', '11/02/2026', '11/06/2026']]));
    expect(review(mixed).useForAll).toBeNull();
    expect(otherProjectLine(mixed)).toBe('"6101" in the file looks like your project 6101 Quay Works, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.');
    // Several ticked, the project it looks like not among them: the line too. Among them: no line.
    expect(otherProjectLine(prepare([QUAY, SHED], csv(fieldPlan('6102'))))).toBe('"6102" in the file looks like your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.');
    expect(otherProjectLine(prepare([QUAY, MILL], csv(fieldPlan('6102'))))).toBeNull();
    // One task: "this task".
    expect(otherProjectLine(prepare([QUAY], csv([['Survey', '6102', '10/26/2026', '10/30/2026']])))).toBe('"6102" in the file looks like your project 6102 Mill Yard, which is not ticked. To file this task under it, tick it under Projects above and choose the file again.');
    // Unchanged: the name looks like the ticked project, or like none of his projects: the button is offered, no line.
    for (const name of ['6101', 'PLZ 6101 Quay Works', 'Shed']) {
      const offered = prepare([QUAY], csv(fieldPlan(name)));
      expect([name, review(offered).useForAll]).toEqual([name, { project: QUAY, label: `Use 6101 Quay Works for all 3 tasks named "${name}"` }]);
      expect([name, otherProjectLine(offered)]).toEqual([name, null]);
    }
  });

  it('L-3: a name that fits two of his projects equally waits, and the line says it matches more than one', () => {
    const twins = { projects: [...ALL, 'Garden-shed'], openProjectNames: [...ALL, 'Garden-shed'] };
    const both = prepare([SHED], csv(fieldPlan('Garden_shed')), twins);
    expect(both.scheduleItems.map(item => item.projectName)).toEqual(['Needs Project', 'Needs Project', 'Needs Project']);
    expect(review(both).heldLine).toBe('3 tasks need a project before you can upload: the file names their project "Garden_shed", which matches more than one of your open projects. Choose a project for each of them above.');
    // The ticked project is one of the two: the button is offered, and no other line.
    expect(review(both).useForAll).toEqual({ project: SHED, label: 'Use Garden shed for all 3 tasks named "Garden_shed"' });
    expect(otherProjectLine(both)).toBeNull();
    // Neither is ticked: no button, and the line names both.
    const neither = prepare([QUAY], csv(fieldPlan('Garden_shed')), twins);
    expect(review(neither).useForAll).toBeNull();
    expect(otherProjectLine(neither)).toBe('"Garden_shed" in the file matches your projects Garden shed and Garden-shed, and neither is ticked. To file these tasks under one of them, tick it under Projects above and choose the file again.');
    // With a name that is none of his projects as well, each name gets its own reason.
    const mixed = prepare([SHED], csv([...fieldPlan('Garden_shed').slice(0, 2), ['Survey', 'Shed', '11/16/2026', '11/20/2026']]), twins);
    expect(review(mixed).heldLine).toBe('3 tasks need a project before you can upload: the file names their projects "Shed", which is not one of your open projects, and "Garden_shed", which matches more than one of your open projects. Choose a project for each of them above.');
  });

  it('L-4: with no open project in the cloud\'s list, a name the page knows only from saved tasks is not his project: the tasks wait', () => {
    const stray = prepare([QUAY], csv(fieldPlan('6101')), { projects: [...ALL, '6101'], openProjectNames: [] });
    expect(stray.scheduleItems.map(item => item.projectName)).toEqual(['Needs Project', 'Needs Project', 'Needs Project']);
    expect(review(stray).heldLine).toBe('3 tasks need a project before you can upload: the file names their project "6101", which is not one of your open projects. Choose a project for each of them above.');
    // The ticked project is still his, spelled any way the app takes for it.
    expect(prepare([QUAY], csv(fieldPlan('6101 quay works')), { projects: [...ALL, '6101'], openProjectNames: [] }).scheduleItems[0].projectName).toBe(QUAY);
    // No list given at all (an older caller): the page's list, as before.
    expect(prepare([QUAY], csv(fieldPlan('6101')), { projects: [...ALL, '6101'] }).scheduleItems[0].projectName).toBe('6101');
  });
});
