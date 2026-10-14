jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import { scheduleProjectScopeKey } from '../../services/PIEScheduleReconciliation';

// High item 2, after the second independent review (the owner's instruction of 13 Oct 2026, the three high items;
// open item 2.33). What the desktop's upload review of a schedule file now does:
//  H2S-1  the app's guess from a name (bestScheduleProjectMatch) is never stated: the page names a project of his only
//         where the file's name IS that project by the strict rule (the phone's comparison, then
//         scheduleProjectScopeKey). A guess may withhold the one button; the line then is neutral. Where the ticked
//         project reads as the file's name too, the button for it is offered again (as before 2b).
//  L2S-2  where the line does name projects (the name fits several, none ticked), ticking one of them and choosing the
//         file again files the tasks under it: the ticked projects are read first.
//  L2S-3  one task given twice under two spellings of one unknown name ("Shed Annex", "Shed-Annex") is one row.
//  L2S-4  short names ("Mill") still get the ticked project's button: no new guessing (left, as decided).
// The desktop's own functions. Made-up projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];

type Review = web.DAVEWebScheduleUploadProjectReview;
const review = (prepared: unknown) => (web.daveWebScheduleUploadProjectReview as unknown as (value: unknown) => Review)(prepared);
const otherLine = (prepared: unknown) => (web.daveWebScheduleUploadOtherProjectLine as unknown as (value: unknown) => string | null)(prepared);
type Line = readonly [task: string, project: string, start: string, finish: string];
const csv = (rows: readonly Line[]) => ['Task,Project,Area,Start,Finish,Percent Complete', ...rows.map(([name, project, start, finish]) => `${name},${project},Lot,${start},${finish},`)].join('\n');
const plan3 = (project: string): Line[] => [
  ['Pour footings', project, '10/26/2026', '10/30/2026'], ['Set steel', project, '11/02/2026', '11/06/2026'], ['Deck and detail', project, '11/09/2026', '11/13/2026'],
];
const prepare = (ticked: readonly string[], contents: string, projects: readonly string[] = ALL) => web.prepareDAVEWebDocumentUpload({
  fileName: 'Field plan.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: ticked,
  projects: [...projects], openProjectNames: [...projects], fingerprint: 'c'.repeat(64), now: '2026-10-13T18:00:00.000Z',
});
const listed = (prepared: ReturnType<typeof prepare>) => prepared.scheduleItems.map(item => `${item.taskName} | ${web.daveWebScheduleUploadRowProject(prepared, item)}`);
/** Every project of his the page's lines name, with the file's name: each must BE that name by the strict rule. */
const namedProjects = (prepared: ReturnType<typeof prepare>, projects: readonly string[]) => {
  // (The file's own names, in quotes, are left out: "Main St Retail" is the file's, not a project the page names.)
  const said = [review(prepared).heldLine, otherLine(prepared)].filter(Boolean).join(' ').replace(/"[^"]*"/g, '');
  return projects.filter(project => said.includes(project) && !(prepared.document.projectNames || []).includes(project));
};
const NEUTRAL = (name: string) => `"${name}" in the file may stand for one of your other projects, so there is no button for all of them. Choose the project on each of these tasks above; if the right project is not offered, tick it under Projects above and choose the file again.`;

describe('the desktop\'s upload review names only what the file names (High item 2, after the second review)', () => {
  it('H2S-1: the ticked project read in the file\'s name gets its button back, and no other project is named (W2, W4, W5)', () => {
    const cases: Array<[string, string, string[]]> = [
      // [the ticked project, the file's name, his projects]
      [QUAY, 'Quay Works 2026', [...ALL, '2026 Office Fitout']],
      ['Harbor Road Lofts', '450 Harbor Road', [...ALL, 'Harbor Road Lofts', '450 Pine Street']],
      ['12 Main St Retail', 'Main St Retail', [...ALL, '12 Main St Retail', 'Main St']],
    ];
    for (const [ticked, name, projects] of cases) {
      const prepared = prepare([ticked], csv(plan3(name)), projects);
      expect([name, review(prepared).useForAll]).toEqual([name, { project: ticked, label: `Use ${ticked} for all 3 tasks named "${name}"` }]);
      expect([name, otherLine(prepared)]).toEqual([name, null]);
      expect([name, namedProjects(prepared, projects)]).toEqual([name, []]);
    }
  });

  it('H2S-1: where the guess points away from the ticked project, no button, and the line is neutral: it names no project (W1, W8)', () => {
    for (const name of ['6102', 'Mill Yard']) {
      const prepared = prepare([QUAY], csv(plan3(name)));
      expect([name, review(prepared).useForAll]).toEqual([name, null]);
      expect([name, otherLine(prepared)]).toEqual([name, NEUTRAL(name)]);
      expect([name, namedProjects(prepared, ALL)]).toEqual([name, []]);
    }
    // One task: its own words.
    expect(otherLine(prepare([QUAY], csv([['Survey', '6102', '10/26/2026', '10/30/2026']])))).toBe('"6102" in the file may stand for one of your other projects, so there is no button for it. Choose the project on this task above; if the right project is not offered, tick it under Projects above and choose the file again.');
    // Several projects ticked: there is no one button anyway, and no line about it.
    expect(otherLine(prepare([QUAY, SHED], csv(plan3('6102'))))).toBeNull();
    // The prepared upload keeps no guessed project name at all.
    expect(JSON.stringify(prepare([QUAY], csv(plan3('6102'))).waitingProjectNames)).not.toContain(MILL);
  });

  it('L2S-2: the line names projects only where the name fits them by the strict rule; ticked as it says, the tasks are filed there (W10)', () => {
    const projects = [...ALL, 'Garden-shed'];
    const prepared = prepare([QUAY], csv(plan3('Garden_shed')), projects);
    expect(otherLine(prepared)).toBe('"Garden_shed" in the file matches your projects Garden shed and Garden-shed, and neither is ticked. To file these tasks under one of them, tick it under Projects above and choose the file again.');
    for (const project of namedProjects(prepared, projects)) expect([project, scheduleProjectScopeKey(project)]).toEqual([project, scheduleProjectScopeKey('Garden_shed')]);
    // He ticks Garden shed as well (or alone) and chooses the file again: filed under Garden shed, nothing waits.
    for (const ticks of [[QUAY, SHED], [SHED]]) {
      const again = prepare(ticks, csv(plan3('Garden_shed')), projects);
      expect([ticks, again.scheduleItems.map(item => item.projectName)]).toEqual([ticks, [SHED, SHED, SHED]]);
      expect([ticks, review(again)]).toEqual([ticks, { heldLine: null, useForAll: null, savedUnderLine: '3 tasks named "Garden_shed" in the file will be saved under Garden shed.' }]);
    }
    // Both ticked: it fits both, so it waits, and the red line says it matches more than one.
    const both = prepare([SHED, 'Garden-shed'], csv(plan3('Garden_shed')), projects);
    expect(review(both).heldLine).toBe('3 tasks need a project before you can upload: the file names their project "Garden_shed", which matches more than one of your open projects. Choose a project for each of them above.');
  });

  it('L2S-3: one task given twice under two spellings of one unknown name is one row (D2, D3); other names stay apart', () => {
    const annex = prepare([QUAY], csv([['Footings', 'Shed Annex', '10/26/2026', '10/30/2026'], ['Footings', 'Shed-Annex', '10/26/2026', '10/30/2026'], ['Frame', 'Shed Annex', '11/02/2026', '11/06/2026']]));
    expect(listed(annex)).toEqual(['Footings | Needs Project (the file names "Shed Annex")', 'Frame | Needs Project (the file names "Shed Annex")']);
    expect(review(annex).useForAll).toEqual({ project: QUAY, label: 'Use 6101 Quay Works for all 2 tasks named "Shed Annex"' });
    const job = prepare([QUAY], csv([['Pour footings', 'Job 6101', '10/26/2026', '10/30/2026'], ['Pour footings', 'Job-6101', '10/26/2026', '10/30/2026'], ['Set steel', 'Job 6101', '11/02/2026', '11/06/2026']]));
    expect(listed(job)).toEqual(['Pour footings | Needs Project (the file names "Job 6101")', 'Set steel | Needs Project (the file names "Job 6101")']);
    // H1S-1 stays fixed: two different unknown names, the same task on the same day, are two rows.
    const two = prepare([QUAY, MILL], csv([['Safety walk', '6101', '10/26/2026', '10/30/2026'], ['Safety walk', '6102', '10/26/2026', '10/30/2026']]));
    expect(listed(two)).toEqual(['Safety walk | Needs Project (the file names "6101")', 'Safety walk | Needs Project (the file names "6102")']);
  });

  it('L2S-4, left: a short name the strict rule does not take and the guess does not read ("Mill") still gets the ticked project\'s button', () => {
    expect(review(prepare([QUAY], csv(plan3('Mill')))).useForAll).toEqual({ project: QUAY, label: 'Use 6101 Quay Works for all 3 tasks named "Mill"' });
  });
});
