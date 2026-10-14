jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import { daveWebScheduleRetirementCheck } from '../../services/DAVEWebScheduleActivation';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// High item 2 (the owner's instruction of 13 Oct 2026, the three high items; open item 2.33; review pass 4, O-4).
// On the desktop (Documents, Add Project Documents, Schedules) a schedule file whose Project column spells the
// project another way than the app does was filed under the FILE's spelling: a lookahead's tasks were added a second
// time under a project called by that spelling, and a full schedule made current left the real project with no tasks.
// A row's project is now resolved as the phone's import resolves it, the project's own name is saved, and a row that
// names none of his projects waits for one: the upload is held, with one line, and (one project ticked, one name)
// one button. The desktop's own functions; Make Current by the app's own functions for both of the cloud's rules, as
// review passes 4 and 6 worked it out. Made-up projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];

type Web = typeof web & Partial<Record<'daveWebScheduleUploadProjectReview' | 'daveWebScheduleUploadUseProject' | 'daveWebScheduleUploadRowProject', (...args: never[]) => never>>;
const ops = web as Web;
const review = (prepared: unknown) => {
  if (!ops.daveWebScheduleUploadProjectReview) throw new Error('this build has no project review at the upload');
  return (ops.daveWebScheduleUploadProjectReview as unknown as (value: unknown) => web.DAVEWebScheduleUploadProjectReview)(prepared);
};
const useProject = <T,>(prepared: T, project: string): T => {
  if (!ops.daveWebScheduleUploadUseProject) throw new Error('this build has no one button');
  return (ops.daveWebScheduleUploadUseProject as unknown as (value: T, name: string) => T)(prepared, project);
};
/** The review's own choice of a task's project, as desktop-read-only-shell.tsx makes it. */
const give = <T extends { scheduleItems: readonly ScheduleItem[] }>(prepared: T, index: number, project: string): T => ({
  ...prepared,
  scheduleItems: prepared.scheduleItems.map((item, at) => (at === index ? { ...item, projectName: project, scheduleProjectName: project } : item)),
});

const master = (project: string, importedAt: string): ReferenceDocument => ({
  id: `master ${project}`, name: `${project} master`, originalFileName: `${project} master.csv`, uri: '', mimeType: 'text/csv',
  category: 'Schedules', notes: '', isCurrent: true, importedAt, projectId: null, projectName: project, projectNames: [project],
  importBatchId: `batch ${project}`, cloudUpdatedAt: '2026-09-30T12:00:00.000Z', contentSha256: `sha-${project}`,
} as unknown as ReferenceDocument);
const task = (id: string, project: string, name: string, startDate: string, finishDate: string): ScheduleItem => ({
  id, itemType: 'Task', taskName: name, projectId: null, projectName: project, scheduleProjectName: project, locationName: 'Lot',
  startDate, finishDate, milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started',
  notes: '', nextAction: '', importedFrom: `${project} master.csv`, importBatchId: `batch ${project}`,
  importedAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
} as unknown as ScheduleItem);
// Quay Works: a 16-month master whose three tasks the file lists a week later, and two far ones. Mill Yard: a master.
const DOCS: ReferenceDocument[] = [master(QUAY, '2026-03-01T12:00:00.000Z'), master(MILL, '2026-05-30T12:00:00.000Z')];
const ITEMS: ScheduleItem[] = [
  task('q1', QUAY, 'Pour footings', '10/19/2026', '10/23/2026'), task('q2', QUAY, 'Set steel', '10/26/2026', '10/30/2026'),
  task('q3', QUAY, 'Deck and detail', '11/02/2026', '11/06/2026'), task('q4', QUAY, 'Site survey', '03/02/2026', '03/20/2026'),
  task('q5', QUAY, 'Closeout', '06/01/2027', '07/01/2027'),
  task('m1', MILL, 'Strip out', '06/01/2026', '06/12/2026'), task('m2', MILL, 'Refit', '10/19/2026', '10/30/2026'),
];
type Line = readonly [task: string, project: string, start: string, finish: string];
const csv = (rows: readonly Line[]) => ['Task,Project,Area,Start,Finish,Percent Complete', ...rows.map(([name, project, start, finish]) => `${name},${project},Lot,${start},${finish},`)].join('\n');
const fieldPlan = (project: string): Line[] => [
  ['Pour footings', project, '10/26/2026', '10/30/2026'], ['Set steel', project, '11/02/2026', '11/06/2026'], ['Deck and detail', project, '11/09/2026', '11/13/2026'],
];
const prepare = (ticked: readonly string[], contents: string, extra: Partial<{ projects: string[]; openProjectNames: string[] }> = {}, fileName = 'Field plan.csv') => web.prepareDAVEWebDocumentUpload({
  fileName, mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: ticked,
  projects: extra.projects ?? [...ALL], ...(extra.openProjectNames ? { openProjectNames: extra.openProjectNames } : {}),
  fingerprint: 'c'.repeat(64), now: '2026-10-13T18:00:00.000Z',
});
const snapshotOf = (documents: readonly ReferenceDocument[], items: readonly ScheduleItem[]) => ({
  referenceDocuments: documents,
  scheduleItems: selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }),
  knownScheduleItems: items,
});
/** The upload as the cloud then holds it: the document, and the plan's rows put on the saved tasks. */
function uploaded(reviewed: web.DAVEWebPreparedUpload) {
  const plan = web.planDAVEWebScheduleImport({ snapshot: snapshotOf(DOCS, ITEMS) as never, importedScheduleItems: reviewed.scheduleItems, document: reviewed.document });
  const written = new Map(plan.revisions.map(revision => [revision.item.id, revision.item] as const));
  const lookahead = reviewed.document.scheduleRole === 'lookahead';
  const document = { ...(reviewed.document as ReferenceDocument), isCurrent: lookahead, cloudUpdatedAt: '2026-10-13T18:05:00.000Z' } as ReferenceDocument;
  return { document, documents: [...DOCS, document], items: [...ITEMS.map(item => written.get(item.id) || item), ...(plan.additions as ScheduleItem[])], plan };
}
/** What every place lists, project by project: "project: task start-finish, ...". */
const shown = (items: readonly ScheduleItem[], documents: readonly ReferenceDocument[]) => {
  const list = selectAuthoritativeScheduleItems({ scheduleItems: [...items], scheduleDocuments: [...documents] }) as ScheduleItem[];
  const projects = [...new Set(list.map(item => item.projectName))].sort();
  return Object.fromEntries(projects.map(project => [project, list.filter(item => item.projectName === project).map(item => `${item.taskName} ${item.startDate}-${item.finishDate}`).sort()]));
};
/** Every project name a saved task or schedule carries, and those of them that are not his projects. */
const madeUp = (items: readonly ScheduleItem[], documents: readonly ReferenceDocument[]) => [...new Set([
  ...items.flatMap(item => [item.projectName, item.scheduleProjectName || item.projectName]),
  ...documents.flatMap(document => [...(document.projectNames || []), ...(document.projectName ? [document.projectName] : [])]),
])].filter(name => !ALL.includes(name));
const MILL_UNTOUCHED = ['Refit 10/19/2026-10/30/2026', 'Strip out 06/01/2026-06/12/2026'];
async function makeCurrent(target: ReferenceDocument, documents: readonly ReferenceDocument[], scope: 'project' | 'schedule') {
  const check = await daveWebScheduleRetirementCheck(target, { documents: async () => documents, scope: async () => scope });
  return { check, after: scheduleDocumentsAfterActivation(target, documents, scope, '2026-10-13T19:00:00.000Z') };
}
const HELD_6101 = '3 tasks need a project before you can upload: the file names their project "6101", which is not one of your open projects. Choose a project for each of them above.';
const SAVED_6101 = '3 tasks named "6101" in the file will be saved under 6101 Quay Works.';

describe('the desktop saves a schedule row under one of his projects (High item 2, open item 2.33)', () => {
  it('O-4, a lookahead whose Project column says "6101" for 6101 Quay Works, Quay Works ticked: held, one button, then the three tasks restated in place and nothing under "6101"', () => {
    const prepared = prepare([QUAY], csv(fieldPlan('6101')));
    // The rows wait for a project, as on the phone; the file's own name is kept to say what it named.
    expect(prepared.scheduleItems.map(item => item.projectName)).toEqual(['Needs Project', 'Needs Project', 'Needs Project']);
    expect(Object.values(prepared.fileProjectNames ?? {})).toEqual(['6101', '6101', '6101']);
    expect((ops.daveWebScheduleUploadRowProject as unknown as (p: unknown, i: unknown) => string)(prepared, prepared.scheduleItems[0])).toBe('Needs Project (the file names "6101")');
    // Held, with one line; one project ticked and one name: one button, in plain words.
    expect(review(prepared)).toEqual({ heldLine: HELD_6101, useForAll: { project: QUAY, label: 'Use 6101 Quay Works for all 3 tasks named "6101"' }, savedUnderLine: null });
    // The upload itself refuses a task still waiting (the door behind the held button).
    expect(() => web.planDAVEWebScheduleImport({ snapshot: snapshotOf(DOCS, ITEMS) as never, importedScheduleItems: web.withDAVEWebScheduleUploadRole(prepared, 'lookahead').scheduleItems, document: web.withDAVEWebScheduleUploadRole(prepared, 'lookahead').document })).toThrow(web.DAVE_WEB_UPLOAD_NEEDS_PROJECT_TEXT);

    const given = useProject(prepared, QUAY);
    expect(review(given)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: SAVED_6101 });
    const reviewed = web.withDAVEWebScheduleUploadRole(given, 'lookahead');
    expect(reviewed.document.projectNames).toEqual([QUAY]);
    const up = uploaded(reviewed);
    // The lookahead restates the master's three tasks in place (as with the name spelled exactly), adds none.
    expect([up.plan.additions.length, up.plan.revisions.length]).toEqual([0, 3]);
    expect(shown(up.items, up.documents)).toEqual({
      [MILL]: MILL_UNTOUCHED,
      [QUAY]: ['Closeout 06/01/2027-07/01/2027', 'Deck and detail 11/09/2026-11/13/2026', 'Pour footings 10/26/2026-10/30/2026', 'Set steel 11/02/2026-11/06/2026', 'Site survey 03/02/2026-03/20/2026'],
    });
    expect(madeUp(up.items, up.documents)).toEqual([]);
  });

  it('O-4, the same file as a full schedule, made current under both of the cloud\'s rules: saved for 6101 Quay Works only, Mill Yard untouched, nothing under "6101"', async () => {
    const reviewed = web.withDAVEWebScheduleUploadRole(useProject(prepare([QUAY], csv(fieldPlan('6101'))), QUAY), 'master');
    expect(reviewed.document).toMatchObject({ projectNames: [QUAY], projectName: QUAY });
    const up = uploaded(reviewed);
    expect(madeUp(up.items, up.documents)).toEqual([]);
    for (const scope of ['project', 'schedule'] as const) {
      const { check, after } = await makeCurrent(up.document, up.documents, scope);
      expect(check.ok && check.effects).toEqual([]);
      expect(shown(up.items, after)).toEqual({
        [MILL]: MILL_UNTOUCHED,
        [QUAY]: ['Deck and detail 11/09/2026-11/13/2026', 'Pour footings 10/26/2026-10/30/2026', 'Set steel 11/02/2026-11/06/2026'],
      });
    }
  });

  it('the hyphen and the double space: "Garden-shed" and "Garden  shed" are saved under Garden shed, every project ticked, and 10b\'s line follows', async () => {
    for (const spelling of ['Garden-shed', 'Garden  shed']) {
      const prepared = prepare(ALL, csv(fieldPlan(spelling)));
      expect(prepared.scheduleItems.map(item => [item.projectName, item.scheduleProjectName])).toEqual([[SHED, SHED], [SHED, SHED], [SHED, SHED]]);
      expect(review(prepared)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: `3 tasks named "${spelling}" in the file will be saved under Garden shed.` });
      expect(web.daveWebFullScheduleProjectsLine(prepared, 'master')).toBe('Every task in this file is for Garden shed, so as a full schedule it will be saved for Garden shed only, not for every project ticked above.');
      expect(web.withDAVEWebScheduleUploadRole(prepared, 'master').document.projectNames).toEqual([SHED]);
      expect(web.withDAVEWebScheduleUploadRole(prepared, 'lookahead').document.projectNames).toEqual([SHED]);
      const up = uploaded(web.withDAVEWebScheduleUploadRole(prepared, 'master'));
      expect(madeUp(up.items, up.documents)).toEqual([]);
      const { after } = await makeCurrent(up.document, up.documents, 'schedule');
      expect(shown(up.items, after)[MILL]).toEqual(MILL_UNTOUCHED);
      expect(shown(up.items, after)[QUAY]).toHaveLength(5);
    }
  });

  it('what is "the same project": the phone\'s comparison (capitals, spaces), then the one a project finds its schedule by (punctuation); a number alone, a part, other words are not', () => {
    const resolvedAs = (spelling: string) => prepare([QUAY], csv([['Survey', spelling, '10/26/2026', '10/30/2026']])).scheduleItems[0].projectName;
    for (const spelling of [QUAY, '6101 QUAY WORKS', '6101 quay works', '6101 Quay  Works', '6101 - Quay Works', '6101_Quay_Works']) {
      expect([spelling, resolvedAs(spelling)]).toEqual([spelling, QUAY]);
    }
    // (A mark at either END is not the same by scheduleProjectScopeKey either: "6101 Quay Works." keys with a space after.)
    for (const spelling of ['6101', 'Quay Works', '6101 Quay', 'Quay Works 6101', '6101 Quay Works (Phase 2)', 'PLZ 6101 Quay Works', 'Shed', '6101 Quay Works.']) {
      expect([spelling, resolvedAs(spelling)]).toEqual([spelling, 'Needs Project']);
    }
    // CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item): a project of his that is not ticked
    // (Mill Yard) now waits for a project, as on the phone, and the page names it; before, the row was filed under it.
    expect(resolvedAs('6102 mill yard')).toBe('Needs Project');
    // Two projects of his that differ only in punctuation: the exact name decides; another spelling of both waits.
    // CHANGED by 2c (review pass 2, L2S-2; the coordinator's decision): another spelling of both is the TICKED one when
    // one of them is ticked (the ticked projects are read first by the scope key); with neither ticked it waits.
    const twins = (spelling: string, ticked = [SHED]) => prepare(ticked, csv([['Survey', spelling, '10/26/2026', '10/30/2026']]), { projects: [SHED, 'Garden-shed', QUAY] }).scheduleItems[0].projectName;
    // CHANGED by open item 4.88 (13 Oct 2026): "Garden-shed" exactly is his OTHER project, not ticked, so it now waits
    // (named on the page as that project) instead of being filed under it.
    expect([twins('Garden shed'), twins('Garden-shed'), twins('GARDEN_SHED'), twins('GARDEN_SHED', [QUAY])]).toEqual([SHED, 'Needs Project', SHED, 'Needs Project']);
  });

  it('his projects are his OPEN projects in the cloud when the desktop knows them: a name the list only has from saved tasks, or a closed project, waits', () => {
    // "6101" is listed by the desktop because tasks are already saved under it (point 4); it is no cloud project.
    const listed = [...ALL, '6101'];
    expect(prepare([QUAY], csv(fieldPlan('6101')), { projects: listed, openProjectNames: [...ALL] }).scheduleItems[0].projectName).toBe('Needs Project');
    expect(prepare([QUAY], csv(fieldPlan('Old Pier')), { projects: [...ALL], openProjectNames: [...ALL] }).scheduleItems[0].projectName).toBe('Needs Project');
    // Ticked, a name is his choice.
    expect(prepare([QUAY, '6101'], csv(fieldPlan('6101')), { projects: listed, openProjectNames: [...ALL] }).scheduleItems[0].projectName).toBe('6101');
    // CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item): an unticked open project is still his
    // project, but its rows now wait (as on the phone) and the page names it; before, they were filed under it.
    const mill = prepare([QUAY], csv(fieldPlan(MILL)), { projects: [QUAY], openProjectNames: [...ALL] });
    expect([mill.scheduleItems[0].projectName, mill.waitingProjectNames?.[MILL]]).toEqual(['Needs Project', { fitsEqually: [MILL], mayBeAnother: false }]);
    // Without the cloud's list (an older caller), the desktop's own list is read: "6101" is one of his projects there
    // (CHANGED by 4.88 likewise: not ticked, it waits, named as his project).
    expect(prepare([QUAY], csv(fieldPlan('6101')), { projects: listed }).waitingProjectNames?.['6101']).toEqual({ fitsEqually: ['6101'], mayBeAnother: false });
  });

  it('the one button only for ONE project ticked and ONE name; its words for one task; never with two names or two ticks', () => {
    const one = prepare([QUAY], csv([['Survey', '6101', '10/26/2026', '10/30/2026'], ['Piling', QUAY, '11/02/2026', '11/06/2026']]));
    expect(review(one)).toEqual({
      heldLine: '1 task needs a project before you can upload: the file names its project "6101", which is not one of your open projects. Choose a project for it above.',
      useForAll: { project: QUAY, label: 'Use 6101 Quay Works for the task named "6101"' },
      savedUnderLine: null,
    });
    // The button gives a project to the waiting task only.
    expect(useProject(one, MILL).scheduleItems.map(item => item.projectName)).toEqual([MILL, QUAY]);
    const twoNames = prepare([QUAY], csv([['Survey', '6101', '10/26/2026', '10/30/2026'], ['Piling', 'Quay', '11/02/2026', '11/06/2026']]));
    expect(review(twoNames)).toEqual({
      heldLine: '2 tasks need a project before you can upload: the file names their projects "6101" and "Quay", which are not among your open projects. Choose a project for each of them above.',
      useForAll: null,
      savedUnderLine: null,
    });
    expect(review(prepare([QUAY, MILL], csv(fieldPlan('6101')))).useForAll).toBeNull();
  });

  it('several projects ticked and two unknown names: held until every task has one of his projects, then saved under the projects he chose', () => {
    const prepared = prepare(ALL, csv([['Footings', '6101', '10/26/2026', '10/30/2026'], ['Frame', 'Shed', '11/02/2026', '11/06/2026'], ['Roof on', '6101', '11/09/2026', '11/13/2026']]));
    expect(review(prepared)).toEqual({
      heldLine: '3 tasks need a project before you can upload: the file names their projects "6101" and "Shed", which are not among your open projects. Choose a project for each of them above.',
      useForAll: null,
      savedUnderLine: null,
    });
    // No line about a full schedule's projects while a task waits (nothing is promised that is not saved).
    expect(web.daveWebFullScheduleProjectsLine(prepared, 'master')).toBeNull();
    const two = give(give(prepared, 0, SHED), 1, SHED);
    expect(review(two).heldLine).toBe('1 task needs a project before you can upload: the file names its project "6101", which is not one of your open projects. Choose a project for it above.');
    const all = give(two, 2, SHED);
    expect(review(all)).toEqual({
      heldLine: null,
      useForAll: null,
      savedUnderLine: '2 tasks named "6101" in the file will be saved under Garden shed. 1 task named "Shed" in the file will be saved under Garden shed.',
    });
    expect(web.daveWebFullScheduleProjectsLine(all, 'master')).toBe('Every task in this file is for Garden shed, so as a full schedule it will be saved for Garden shed only, not for every project ticked above.');
    const up = uploaded(web.withDAVEWebScheduleUploadRole(all, 'master'));
    expect(up.document.projectNames).toEqual([SHED]);
    expect(up.plan.additions.map(item => item.projectName)).toEqual([SHED, SHED, SHED]);
    expect(madeUp(up.items, up.documents)).toEqual([]);
  });

  it('a file whose rows all name his projects exactly, or name none, is prepared as before (no file names kept, rows as read)', () => {
    for (const [ticked, contents] of [
      [ALL, csv(fieldPlan(SHED))],
    ] as const) {
      const prepared = prepare(ticked, contents);
      expect(prepared.fileProjectNames).toBeUndefined();
      expect(review(prepared)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: null });
      expect(prepared.scheduleItems.every(item => item.projectName !== 'Needs Project')).toBe(true);
    }
    // CHANGED by open item 4.88 (13 Oct 2026; the owner's go-ahead for every High and Medium item): a row naming a project of his that is not
    // ticked, a blank Project cell, and a file with no Project column now wait for a project, as on the phone; before,
    // they took that project or the first ticked one. Their words: tests/services/m1-4-88-*.
    for (const [ticked, contents] of [
      [[QUAY, SHED], csv([['Footings', SHED, '10/26/2026', '10/30/2026'], ['Refit', MILL, '11/02/2026', '11/06/2026']])],
      [ALL, csv([['Footings', '', '10/26/2026', '10/30/2026']])],
      [ALL, ['Task,Area,Start,Finish', 'Footings,Lot,10/26/2026,10/30/2026'].join('\n')],
    ] as const) {
      expect(prepare(ticked, contents).scheduleItems.some(item => item.projectName === 'Needs Project')).toBe(true);
    }
  });

  it('the "Full schedule or Lookahead" suggestion reads the rows as the file names them, as before (Build 231\'s, not changed)', () => {
    const snapshot = snapshotOf(DOCS, ITEMS) as never;
    const asTheFileNamesThem = (prepared: web.DAVEWebPreparedUpload, spelling: string) => web.daveWebScheduleUploadRoleSuggestion({
      snapshot, prepared: { ...prepared, fileProjectNames: undefined, scheduleItems: prepared.scheduleItems.map(item => ({ ...item, projectName: spelling, scheduleProjectName: spelling })) },
    });
    for (const [ticked, spelling] of [[[QUAY], '6101'], [ALL, 'Garden-shed'], [ALL, '6101 quay works']] as const) {
      const prepared = prepare(ticked, csv(fieldPlan(spelling)));
      expect(prepared.fileProjectNames).toBeDefined();
      expect(web.daveWebScheduleUploadRoleSuggestion({ snapshot, prepared })).toEqual(asTheFileNamesThem(prepared, spelling));
    }
  });
});
