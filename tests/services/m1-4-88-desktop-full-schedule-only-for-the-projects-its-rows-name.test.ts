jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import { resolveScheduleParentActions, scheduleParentProjectNames } from '../../services/PIEScheduleImportBatch';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { narrowScheduleDocumentLabels } from '../../services/ScheduleDocumentLabels';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Open item 4.88 (review pass 6, what is left of O-3; 13 Oct 2026). On the computer a FULL schedule was still saved for
// every ticked project when the file had no Project column, a blank Project cell, or a row naming a project he had not
// ticked; Make Current Schedule then hid the other projects' tasks on every device (nothing deleted). Now:
//  - a row with no project in the file waits for one, with its own words, as on the phone ("Needs Project");
//  - a row naming a project of his that is not ticked waits too, and the page says which project and how to tick it;
//    no one button is offered for it (a wrong tick must never be one press);
//  - a full schedule is saved for the ticked projects its rows name as reviewed, whatever the file named, so Make
//    Current never retires another project's schedule because of this file.
// The desktop's own functions; Make Current by the app's own activation, both of the cloud's rules. Made-up projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];

type Line = readonly [task: string, project: string, start: string, finish: string];
const PLAN: Array<[string, string, string]> = [['Pour footings', '10/26/2026', '10/30/2026'], ['Set steel', '11/02/2026', '11/06/2026'], ['Deck and detail', '11/09/2026', '11/13/2026']];
const withProject = (rows: readonly Line[]) => ['Task,Project,Area,Start,Finish,Percent Complete', ...rows.map(([name, project, start, finish]) => `${name},${project},Lot,${start},${finish},`)].join('\n');
const noProjectColumn = ['Task,Area,Start,Finish,Percent Complete', ...PLAN.map(([name, start, finish]) => `${name},Lot,${start},${finish},`)].join('\n');
const prepare = (ticked: readonly string[], contents: string, projects: readonly string[] = ALL) => web.prepareDAVEWebDocumentUpload({
  fileName: 'Field plan.csv', mimeType: 'text/csv', sizeBytes: contents.length, contents, category: 'Schedules', projectNames: ticked,
  projects: [...projects], openProjectNames: [...projects], fingerprint: 'd'.repeat(64), now: '2026-10-13T18:00:00.000Z',
});
type Prepared = ReturnType<typeof prepare>;
const listed = (prepared: Prepared) => prepared.scheduleItems.map(item => `${item.taskName} | ${web.daveWebScheduleUploadRowProject(prepared, item)}`);
/** He gives a task a project with its own choice on the review (the page's per-task buttons). */
const give = (prepared: Prepared, index: number, project: string): Prepared => ({
  ...prepared, scheduleItems: prepared.scheduleItems.map((item, at) => (at === index ? { ...item, projectName: project, scheduleProjectName: project } : item)),
});
const giveAll = (prepared: Prepared, project: string) => prepared.scheduleItems.reduce((next, _, index) => give(next, index, project), prepared);
const exclude = (prepared: Prepared, keep: (item: ScheduleItem) => boolean): Prepared => ({ ...prepared, scheduleItems: prepared.scheduleItems.filter(keep) });

/* His account: each project's own master, current. */
const master = (project: string): ReferenceDocument => ({
  id: `${project} master`, name: `${project} master`, originalFileName: `${project} master.csv`, uri: '', category: 'Schedules', notes: '',
  isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z', projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${project}`,
}) as ReferenceDocument;
const saved = (id: string, project: string, name: string): ScheduleItem => ({
  id, itemType: 'Task', taskName: name, projectId: null, projectName: project, scheduleProjectName: project, locationName: 'Lot',
  startDate: '10/05/2026', finishDate: '10/16/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium',
  status: 'Not Started', notes: '', nextAction: '', importedFrom: `${project} master.csv`, importBatchId: `batch-${project}`,
  importedAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const DOCUMENTS = [master(QUAY), master(MILL), master(SHED)];
const ITEMS = [saved('q1', QUAY, 'Quay crane'), saved('q2', QUAY, 'Quay deck'), saved('m1', MILL, 'Mill roof'), saved('s1', SHED, 'Shed slab')];

/** The upload as Full schedule, saved, then Make Current Schedule on it: what each project shows on every device. */
function uploadedAndMadeCurrent(prepared: Prepared, scope: 'project' | 'schedule') {
  const reviewed = web.withDAVEWebScheduleUploadRole(prepared, 'master');
  const document = { ...reviewed.document, id: 'UPLOAD', importBatchId: 'batch-UPLOAD', isCurrent: false } as ReferenceDocument;
  const rows = reviewed.scheduleItems.map((item, index) => ({ ...item, id: `UPLOAD-${index + 1}`, importBatchId: 'batch-UPLOAD', sourceDocumentId: 'UPLOAD' }) as ScheduleItem);
  const items = [...ITEMS, ...rows];
  const documents = scheduleDocumentsAfterActivation(document, [...DOCUMENTS, document], scope, '2026-10-13T19:00:00.000Z');
  const shown = selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents }) as ScheduleItem[];
  return {
    label: document.projectNames,
    shows: ALL.map(project => `${project}: ${shown.filter(item => item.projectName === project).map(item => item.taskName).join(', ') || 'NO TASKS'}`),
    // The next iPhone or iPad that loads: what its tidying narrows, and what projects it would make.
    phoneNarrows: narrowScheduleDocumentLabels(documents, items, '2026-10-13T20:00:00.000Z').changed.map(changed => changed.id),
    phoneMakes: resolveScheduleParentActions({ parentNames: scheduleParentProjectNames(shown), existingProjects: ALL, archivedProjects: [], reopenArchivedParents: false }).missingNames,
  };
}

const HELD_NO_PROJECT = '3 tasks need a project before you can upload: the file names no project for them. Choose a project for each of them above.';

describe('a full schedule on the computer is saved only for the projects its rows name (open item 4.88)', () => {
  it('no Project column, every project ticked: each task waits with its own words, and the upload is held', () => {
    const prepared = prepare(ALL, noProjectColumn);
    expect(listed(prepared)).toEqual([
      'Pour footings | Needs Project (the file names no project)', 'Set steel | Needs Project (the file names no project)', 'Deck and detail | Needs Project (the file names no project)',
    ]);
    expect(web.daveWebScheduleUploadProjectReview(prepared)).toEqual({ heldLine: HELD_NO_PROJECT, useForAll: null, savedUnderLine: null });
    expect(web.daveWebScheduleUploadOtherProjectLine(prepared)).toBeNull();
    // No "every task is for" line while a task waits; the upload itself refuses a waiting task.
    expect(web.daveWebFullScheduleProjectsLine(prepared, 'master')).toBeNull();
    expect(() => web.planDAVEWebScheduleImport({ snapshot: { scheduleItems: [] }, importedScheduleItems: prepared.scheduleItems })).toThrow(web.DAVE_WEB_UPLOAD_NEEDS_PROJECT_TEXT);
  });

  it('he gives every task Garden shed: saved for Garden shed only, the line says so, and Make Current leaves the other projects\' tasks shown', () => {
    const given = giveAll(prepare(ALL, noProjectColumn), SHED);
    for (const scope of ['project', 'schedule'] as const) {
      expect([scope, uploadedAndMadeCurrent(given, scope)]).toEqual([scope, {
        label: [SHED],
        shows: [`${QUAY}: Quay crane, Quay deck`, `${MILL}: Mill roof`, `${SHED}: Pour footings, Set steel, Deck and detail`],
        phoneNarrows: [], phoneMakes: [],
      }]);
    }
    expect(web.daveWebScheduleUploadProjectReview(given)).toEqual({
      heldLine: null, useForAll: null, savedUnderLine: '3 tasks with no project in the file will be saved under Garden shed.',
    });
    expect(web.daveWebFullScheduleProjectsLine(given, 'master')).toBe('Every task as listed above is for Garden shed, so as a full schedule it will be saved for Garden shed only, not for every project ticked above.');
  });

  it('one blank Project cell among Garden shed rows: that task waits, the others do not, and once given Garden shed the file is saved for Garden shed only', () => {
    const prepared = prepare(ALL, withProject([['Pour footings', SHED, '10/26/2026', '10/30/2026'], ['Set steel', '', '11/02/2026', '11/06/2026'], ['Deck and detail', SHED, '11/09/2026', '11/13/2026']]));
    expect(listed(prepared)).toEqual(['Pour footings | Garden shed', 'Set steel | Needs Project (the file names no project)', 'Deck and detail | Garden shed']);
    expect(web.daveWebScheduleUploadProjectReview(prepared).heldLine).toBe('1 task needs a project before you can upload: the file names no project for it. Choose a project for it above.');
    expect(web.daveWebFullScheduleProjectsLine(prepared, 'master')).toBeNull();
    const given = give(prepared, 1, SHED);
    expect(uploadedAndMadeCurrent(given, 'project')).toMatchObject({ label: [SHED], shows: [`${QUAY}: Quay crane, Quay deck`, `${MILL}: Mill roof`, `${SHED}: Pour footings, Set steel, Deck and detail`] });
  });

  it('one project ticked and no Project column: one button gives the ticked project to the tasks the file names no project for', () => {
    const prepared = prepare([SHED], noProjectColumn);
    const review = web.daveWebScheduleUploadProjectReview(prepared);
    expect(review).toEqual({ heldLine: HELD_NO_PROJECT, useForAll: { project: SHED, label: 'Use Garden shed for all 3 tasks with no project in the file' }, savedUnderLine: null });
    const used = web.daveWebScheduleUploadUseProject(prepared, SHED);
    expect(web.daveWebScheduleUploadProjectReview(used)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: '3 tasks with no project in the file will be saved under Garden shed.' });
    expect(uploadedAndMadeCurrent(used, 'project')).toMatchObject({ label: [SHED], phoneNarrows: [], phoneMakes: [] });
    // One task: its own words.
    const one = prepare([SHED], ['Task,Area,Start,Finish', 'Pour footings,Lot,10/26/2026,10/30/2026'].join('\n'));
    expect(web.daveWebScheduleUploadProjectReview(one).useForAll).toEqual({ project: SHED, label: 'Use Garden shed for the task with no project in the file' });
  });

  it('a row naming a project of his that is not ticked waits; the page names that project and how to tick it, and offers no one button for it', () => {
    const file = withProject([['Pour footings', SHED, '10/26/2026', '10/30/2026'], ['Mill gutters', MILL, '11/02/2026', '11/06/2026'], ['Mill doors', MILL, '11/09/2026', '11/13/2026']]);
    const prepared = prepare([SHED], file);
    expect(listed(prepared)).toEqual(['Pour footings | Garden shed', 'Mill gutters | Needs Project (the file names "6102 Mill Yard")', 'Mill doors | Needs Project (the file names "6102 Mill Yard")']);
    expect(web.daveWebScheduleUploadProjectReview(prepared)).toEqual({
      heldLine: '2 tasks need a project before you can upload: the file names their project "6102 Mill Yard", which is one of your projects but is not ticked. Choose a project for each of them above.',
      useForAll: null,
      savedUnderLine: null,
    });
    expect(web.daveWebScheduleUploadOtherProjectLine(prepared)).toBe('"6102 Mill Yard" in the file is your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.');
    // Another spelling of it: the line says which project it is.
    const respelled = prepare([SHED], withProject([['Mill gutters', '6102 mill-yard', '11/02/2026', '11/06/2026']]));
    expect(web.daveWebScheduleUploadOtherProjectLine(respelled)).toBe('"6102 mill-yard" in the file is your project 6102 Mill Yard, which is not ticked. To file this task under it, tick it under Projects above and choose the file again.');
    // He ticks it too and chooses the file again: nothing waits, and the full schedule is saved for both.
    const both = prepare([SHED, MILL], file);
    expect(web.daveWebScheduleUploadProjectReview(both)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: null });
    expect(uploadedAndMadeCurrent(both, 'project')).toMatchObject({ label: [SHED, MILL], phoneMakes: [] });
  });

  it('two projects ticked, rows of one of them and of an unticked one: once the unticked rows are left out, the full schedule is saved for its own project only', () => {
    const file = withProject([['Pour footings', SHED, '10/26/2026', '10/30/2026'], ['Mill gutters', MILL, '11/02/2026', '11/06/2026']]);
    const prepared = prepare([QUAY, SHED], file);
    expect(listed(prepared)).toEqual(['Pour footings | Garden shed', 'Mill gutters | Needs Project (the file names "6102 Mill Yard")']);
    const left = exclude(prepared, item => item.taskName !== 'Mill gutters');
    for (const scope of ['project', 'schedule'] as const) {
      expect([scope, uploadedAndMadeCurrent(left, scope)]).toEqual([scope, {
        label: [SHED], shows: [`${QUAY}: Quay crane, Quay deck`, `${MILL}: Mill roof`, `${SHED}: Pour footings`], phoneNarrows: [], phoneMakes: [],
      }]);
    }
  });

  it('a Microsoft Project PDF under a root with one building ticked: the other building\'s tasks wait, they are not filed under the ticked one', () => {
    const page = microsoftProjectPage([['Campus Works', 0, '10/12/2026', '10/30/2026'], ['North Hall', 1, '10/12/2026', '10/16/2026'], ['Pour deck', 2, '10/12/2026', '10/16/2026'],
      ['South Hall', 1, '10/19/2026', '10/30/2026'], ['Glazing', 2, '10/19/2026', '10/23/2026'], ['Paint', 2, '10/26/2026', '10/30/2026']]);
    const projects = ['North Hall', 'South Hall'];
    const prepared = web.prepareDAVEWebDocumentUpload({
      fileName: 'Campus plan.pdf', mimeType: 'application/pdf', sizeBytes: 50_000, contents: page.text, extractedPages: [page] as never, category: 'Schedules',
      projectNames: ['North Hall'], projects, openProjectNames: projects, fingerprint: 'e'.repeat(64), now: '2026-10-13T18:00:00.000Z',
    });
    expect(listed(prepared)).toEqual(['Pour deck | North Hall', 'Glazing | Needs Project (the file names no project)', 'Paint | Needs Project (the file names no project)']);
  });

  it('unchanged: a file whose every row names a ticked project exactly is prepared as before, and saved for every ticked project its rows name', () => {
    const prepared = prepare([QUAY, SHED], withProject([['Pour footings', SHED, '10/26/2026', '10/30/2026'], ['Quay rails', QUAY, '11/02/2026', '11/06/2026']]));
    expect(Object.keys(prepared).sort()).toEqual(['document', 'everyRowNamedAProject', 'extractionStatus', 'reviewMessage', 'scheduleItems']);
    expect(web.daveWebScheduleUploadProjectReview(prepared)).toEqual({ heldLine: null, useForAll: null, savedUnderLine: null });
    expect(web.withDAVEWebScheduleUploadRole(prepared, 'master')).toBe(prepared);
    // All rows one ticked project's, by the file: the line keeps its words (Build 232 item 10b).
    expect(web.daveWebFullScheduleProjectsLine(prepare(ALL, withProject(PLAN.map(([name, start, finish]) => [name, SHED, start, finish] as Line))), 'master'))
      .toBe('Every task in this file is for Garden shed, so as a full schedule it will be saved for Garden shed only, not for every project ticked above.');
  });

  it('the "Full schedule or Lookahead" suggestion is Build 231\'s: it still reads a row with no project as the first ticked project', () => {
    const snapshot = { referenceDocuments: [], scheduleItems: [], knownScheduleItems: [] };
    expect(web.daveWebScheduleUploadRoleSuggestion({ snapshot: snapshot as never, prepared: prepare([SHED, QUAY], noProjectColumn) }))
      .toEqual({ role: 'master', reason: 'there is no master schedule for Garden shed, 6101 Quay Works yet' });
    // A Microsoft Project PDF whose other building's tasks name no ticked project: read as the ticked one, as before.
    const page = microsoftProjectPage([['Campus Works', 0, '10/12/2026', '10/30/2026'], ['North Hall', 1, '10/12/2026', '10/16/2026'], ['Pour deck', 2, '10/12/2026', '10/16/2026'],
      ['South Hall', 1, '10/19/2026', '10/30/2026'], ['Glazing', 2, '10/19/2026', '10/23/2026']]);
    const pdf = web.prepareDAVEWebDocumentUpload({
      fileName: 'Campus plan.pdf', mimeType: 'application/pdf', sizeBytes: 50_000, contents: page.text, extractedPages: [page] as never, category: 'Schedules',
      projectNames: ['North Hall'], projects: ['North Hall', 'South Hall'], openProjectNames: ['North Hall', 'South Hall'], fingerprint: 'e'.repeat(64), now: '2026-10-13T18:00:00.000Z',
    });
    expect(web.daveWebScheduleUploadRoleSuggestion({ snapshot: snapshot as never, prepared: pdf })).toEqual({ role: 'master', reason: 'there is no master schedule for North Hall yet' });
  });
});

type Row = readonly [name: string, indent: number, start: string, finish: string];
/** A Microsoft Project PDF page as the web's extractor positions it (the page builder of review pass 10). */
function microsoftProjectPage(rows: readonly Row[]) {
  const regions: unknown[] = [];
  const addRegion = (text: string, x: number, y: number, width = 0.04) => {
    regions.push({ id: `region-${regions.length + 1}`, text, label: text, x, y, width, height: 0.01, source: 'embedded_text', confidence: 1 });
  };
  ([['ID', 0.03], ['Task Name', 0.05], ['Duration', 0.31], ['Start', 0.36], ['Finish', 0.41], ['%', 0.46]] as const)
    .forEach(([text, x]) => addRegion(text, x, 0.02));
  rows.forEach(([taskName, indent, start, finish], index) => {
    const id = String(index + 1);
    const y = 0.05 + index * 0.02;
    const taskX = 0.05 + indent * 0.007;
    regions.push({
      id: `activity-${id}`, text: `${id} ${taskName}`, label: `${id} ${taskName}`, x: 0.03, y, width: 0.26, height: 0.01,
      source: 'embedded_text', confidence: 1,
      constituentEvidence: [
        { id: `activity-${id}-id`, text: id, source: 'embedded_text', confidence: 1, bounds: { x: 0.03, y, width: 0.012, height: 0.01 } },
        { id: `activity-${id}-task`, text: taskName, source: 'embedded_text', confidence: 1, bounds: { x: taskX, y, width: 0.29 - taskX, height: 0.01 } },
      ],
    });
    addRegion('3 days', 0.31, y);
    addRegion(start, 0.36, y);
    addRegion(finish, 0.41, y);
    addRegion('0%', 0.46, y, 0.025);
  });
  return { pageNumber: 1, text: (regions as { text: string }[]).map(region => region.text).join('\n'), regions };
}
