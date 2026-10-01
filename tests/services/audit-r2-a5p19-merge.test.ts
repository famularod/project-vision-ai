/**
 * Audit round 2, A5 pass 19 (1 Oct 2026): five Low findings in the schedule
 * import merge (ScheduleImportMerge) and the shown-task pick
 * (PIEScheduleReconciliation.selectAuthoritativeScheduleItems).
 *
 * Owner answer Q22: a lookahead adds to the master, and a file's progress
 * never goes below what David entered.
 *
 * Real CSV and Microsoft Project normalizers, the phone's merge and shown-task
 * pick, the web's upload plan and Make Current carry, Set Active, and task
 * links. Synthetic data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsAfterLookaheadDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const shownNamed = (state: State, name = 'Pour slab') => shown(state).filter(item => item.taskName === name);
/** Each shown copy of a task: id, start, finish, percent, by start day. */
const copies = (state: State, name = 'Pour slab') => shownNamed(state, name)
  .map(item => [item.id, item.startDate, item.finishDate, item.percentComplete] as const)
  .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]));

const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** A Microsoft Project export's rows (ID, WBS and row follow the row, as Project numbers them). */
function msp(source: ReferenceDocument, lines: (readonly [name: string, start: string, finish?: string])[]): ScheduleItem[] {
  return (normalizeMicrosoftProjectPdfRows({
    contents: ['ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS', '1\tALPHA\t0\t30 days\tThu 10/1/26\tFri 10/30/26\t0%\t1',
      ...lines.map(([name, start, finish], index) => [index + 2, name, 1, '1 day', start, finish || start, '0%', `1.${index + 1}`].join('\t'))].join('\n'),
    sourceName: `${source.id}.pdf`, projects: ['Alpha'], now: new Date(source.importedAt),
  }) as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
}

/** Approving a master on the phone merges its rows with the rows shown and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}

/** Approving a lookahead on the phone: it restates the master's tasks in place and adds the rest (owner answer Q22). */
function approveLookahead(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: true,
  });
  return { items: [...merged.additions, ...merged.next], documents: [...state.documents, source] };
}

/** A master uploaded on the web: planned against the tasks the web shows, saved not current. */
function upload(state: State, fileName: string, lines: string[], now: string): { state: State; document: ReferenceDocument } {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName, mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Location,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: fileName.padEnd(64, 'x').slice(0, 64), now,
  });
  const webShown = shown(state).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown }, importedScheduleItems: prepared.scheduleItems });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  return {
    document: prepared.document as ReferenceDocument,
    state: { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, prepared.document as ReferenceDocument] },
  };
}

/** Make Current on the web: the schedule current, and the carry over the tasks shown before and after. */
function makeCurrent(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(entry => entry.id === document.id) || document;
  const current: State = { ...state, documents: scheduleDocumentsAfterActivation(target, state.documents, 'project') };
  const carried = new Map(scheduleProgressCarriedToShownTasks({
    before: shown(state), after: shown(current), documentsBefore: state.documents, documentsAfter: current.documents, now,
  }).map(item => [item.id, item]));
  return { ...current, items: current.items.map(item => carried.get(item.id) || item) };
}

/** Set Active on the phone. */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(entry => entry.id === document.id) || document;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

/** David records a percent by hand on the task shown. */
function record(state: State, id: string, percentComplete: number, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
      progressConfirmedAt: at, progressConfirmedBy: 'David', progressJudgment: undefined, updatedAt: at,
    } : item),
  };
}

const report = (scheduleItemId: string, task = 'Pour slab'): ProjectUpdate => ({
  id: `u-${scheduleItemId}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-29T16:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: `${task} is under way.`, scheduleItemId, scheduleTaskName: task, selectedAreaName: 'Lot',
}) as ProjectUpdate;
const link = (state: State, id: string, task = 'Pour slab') => scheduleTaskLinks(shown(state), state.items)(report(id, task))?.item.id ?? null;

const FRIDAY = '2026-09-25T12:00:00.000Z';
const SUNDAY = '2026-09-27T12:00:00.000Z';
const MONDAY = '2026-09-28T12:00:00.000Z';
const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-26T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-29T12:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,10/26/2026,10/30/2026,';

/**
 * L1 (caused by bf3d303; everyday, no twins): David's hand-entered Pour slab
 * at 40%. Friday he uploads master G on the web (10/08, 30%), not current.
 * Sunday he approves lookahead L on the phone (10/14, 60%). Monday he makes G
 * current: the row G's upload noted on the task restated it to G's 10/08 and
 * David's 40%, undoing the newer lookahead. A task a file brought in keeps
 * 10/14 in the same flow.
 */
describe('A5 p19 L1: a lookahead approved after a web upload is not undone when that upload is made current', () => {
  const hand = buildDAVEWebScheduleItem({
    id: 'hand-pour', now: '2026-09-20T15:00:00.000Z', actor: 'David',
    draft: {
      itemType: 'Task', taskName: 'Pour slab', projectName: 'Alpha', projectId: 'alpha', locationName: 'Lot',
      startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: 'Crew A', contractor: '', percentComplete: '40',
      priority: 'Medium', status: 'In Progress', notes: 'Pump booked', nextAction: '', activityMessage: '',
    },
  });
  const L = schedule('LOOKAHEAD L', SUNDAY, 'lookahead');
  const uploaded = upload({ items: [hand], documents: [] }, 'alpha-master-g.csv', ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,30', FRAMING], FRIDAY);
  const onL = approveLookahead(uploaded.state, L, rows(L, ['Pour slab,Alpha,Lot,10/14/2026,10/18/2026,60']));

  it('the lookahead restates his task (10/14, 60%) while G waits', () => {
    expect(copies(onL)).toEqual([['hand-pour', '10/14/2026', '10/18/2026', 60]]);
  });

  it('web Make Current keeps the lookahead\'s 10/14 and 60%; G becomes what the master says under it', () => {
    const after = makeCurrent(onL, uploaded.document, MONDAY);
    expect(copies(after)).toEqual([['hand-pour', '10/14/2026', '10/18/2026', 60]]);
    const task = after.items.find(item => item.id === 'hand-pour')!;
    expect(task).toMatchObject({ owner: 'Crew A', notes: 'Pump booked' });
    // G's row is applied once: the task no longer waits on G, and its note now keeps G's dates.
    expect(task).not.toHaveProperty('scheduleRowsAwaitingCurrent');
    expect(task.lookaheadOverlay).toMatchObject({ masterStartDate: '10/08/2026', masterFinishDate: '10/12/2026' });
    // Deleting the lookahead then gives G's dates, never below David's 40% (Q22).
    const back = scheduleItemsAfterLookaheadDeleted(after.items, L, '2026-09-30T12:00:00.000Z').find(item => item.id === 'hand-pour')!;
    expect([back.startDate, back.finishDate, back.percentComplete]).toEqual(['10/08/2026', '10/12/2026', 40]);
  });

  it('phone Set Active does the same', () => {
    const after = setActive(onL, uploaded.document, MONDAY);
    expect(copies(after)).toEqual([['hand-pour', '10/14/2026', '10/18/2026', 60]]);
    expect(after.items.find(item => item.id === 'hand-pour')).not.toHaveProperty('scheduleRowsAwaitingCurrent');
  });

  it('a task a file brought in keeps 10/14 in the same flow (unchanged guard)', () => {
    const onF = approve(EMPTY, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', FRAMING]));
    const recorded = record(onF, 'MASTER F-1', 40, '2026-09-22T15:00:00.000Z');
    const up = upload(recorded, 'alpha-master-g.csv', ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,30', FRAMING], FRIDAY);
    const after = makeCurrent(approveLookahead(up.state, L, rows(L, ['Pour slab,Alpha,Lot,10/14/2026,10/18/2026,60'])), up.document, MONDAY);
    expect(copies(after).map(([, start, , percent]) => [start, percent])).toEqual([['10/14/2026', 60]]);
  });

  it('a lookahead approved before the upload: Make Current still restates the task on G\'s dates (unchanged guard)', () => {
    const early = { ...L, importedAt: '2026-09-23T12:00:00.000Z' } as ReferenceDocument;
    const before = approveLookahead({ items: [hand], documents: [] }, early, rows(early, ['Pour slab,Alpha,Lot,10/14/2026,10/18/2026,60']));
    const up = upload(before, 'alpha-master-g.csv', ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,30', FRAMING], FRIDAY);
    expect(copies(makeCurrent(up.state, up.document, MONDAY))).toEqual([['hand-pour', '10/08/2026', '10/12/2026', 40]]);
  });
});

/**
 * L2 (caused by 592d8ab): a task imported before import batches and document
 * ids, known only by the file it came from (importedFrom), now counts as the
 * import's, so a master moving it adds a new row that answers to it. When its
 * old file is not saved, or the new master has the same file name, the shown
 * schedule still showed the old row too: Pour slab twice.
 */
describe('A5 p19 L2: an old task known only by its file name shows once after a master moves it', () => {
  const legacy = {
    id: 'legacy-pour', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab',
    startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: '', contractor: '', status: 'In Progress', percentComplete: 40,
    priority: 'Medium', notes: '', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T12:00:00.000Z', progressConfirmedBy: 'David',
    importedFrom: 'alpha-master.csv', importedAt: '2026-08-01T12:00:00.000Z', createdAt: '2026-08-01T12:00:00.000Z',
  } as ScheduleItem;
  const MOVED = ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,', FRAMING];

  it('its old file is not saved: shown once, on the master\'s dates, at David\'s 40%; reports follow', () => {
    const state = approve({ items: [legacy], documents: [] }, G, rows(G, MOVED));
    expect(copies(state)).toEqual([['MASTER G-1', '10/08/2026', '10/12/2026', 40]]);
    expect(link(state, 'legacy-pour')).toBe('MASTER G-1');
  });

  it('the new master has the same file name: shown once', () => {
    const sameName = { ...G, originalFileName: 'alpha-master.csv' } as ReferenceDocument;
    const legacyFile = { ...schedule('legacy-master', '2026-08-01T12:00:00.000Z'), originalFileName: 'alpha-master.csv', importBatchId: null } as ReferenceDocument;
    expect(copies(approve({ items: [legacy], documents: [] }, sameName, rows(sameName, MOVED)))).toEqual([['MASTER G-1', '10/08/2026', '10/12/2026', 40]]);
    expect(copies(approve({ items: [legacy], documents: [legacyFile] }, sameName, rows(sameName, MOVED)))).toEqual([['MASTER G-1', '10/08/2026', '10/12/2026', 40]]);
  });

  it('a master that leaves it on its days still shows it once, and Set Active back to its saved file shows the old row (guard)', () => {
    const legacyFile = { ...schedule('legacy-master', '2026-08-01T12:00:00.000Z'), originalFileName: 'alpha-master.csv', importBatchId: null } as ReferenceDocument;
    const unchanged = approve({ items: [legacy], documents: [] }, G, rows(G, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', FRAMING]));
    expect(copies(unchanged)).toEqual([['legacy-pour', '10/01/2026', '10/05/2026', 40]]);
    const moved = approve({ items: [legacy], documents: [legacyFile] }, G, rows(G, MOVED));
    const back = setActive(moved, legacyFile, MONDAY);
    expect(copies(back)).toEqual([['legacy-pour', '10/01/2026', '10/05/2026', 40]]);
  });
});

/**
 * L3 (caused by 7663b54): master F has phase 1 at 100% and phase 2; a rolling
 * lookahead adds phase 3 on 10/29; master G drops phase 1 and lists phases 2
 * and 3 on their exact days. The shortcut that leaves out a twin only a
 * lookahead added (to even the counts) ran before any same-day pairing: phase
 * 2 took phase 1's 100% and 10/29 showed twice.
 */
describe('A5 p19 L3: rows on a different saved twin\'s exact days pair by days before the count shortcut', () => {
  const L = schedule('LOOKAHEAD L', '2026-09-24T12:00:00.000Z', 'lookahead');
  const PHASE_2 = 'Pour slab,Alpha,Lot,10/22/2026,10/24/2026,';
  const PHASE_3 = 'Pour slab,Alpha,Lot,10/29/2026,10/31/2026,';
  const onF = record(approve(EMPTY, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,', PHASE_2, FRAMING])), 'MASTER F-1', 100, '2026-09-22T15:00:00.000Z');

  it('the lookahead lists phases 2 and 3: G\'s phase 2 stays at 0%, 10/29 shows once', () => {
    const rolling = approveLookahead(onF, L, rows(L, [PHASE_2, PHASE_3]));
    const state = approve(rolling, G, rows(G, [PHASE_2, PHASE_3, FRAMING]));
    expect(copies(state).map(([id, start, , percent]) => [id, start, percent])).toEqual([
      ['MASTER F-2', '10/22/2026', 0],
      ['LOOKAHEAD L-2', '10/29/2026', 0],
    ]);
  });

  it('rows that land on no twin\'s days still leave out the lookahead\'s own twin (A5 p18 F3, unchanged guard)', () => {
    const rolling = approveLookahead(onF, L, rows(L, [PHASE_2, PHASE_3]));
    const state = approve(rolling, G, rows(G, ['Pour slab,Alpha,Lot,10/03/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/23/2026,10/25/2026,', FRAMING]));
    expect(copies(state).map(([id, start, , percent]) => [id, start, percent])).toEqual([
      ['MASTER G-1', '10/03/2026', 100],
      ['MASTER G-2', '10/23/2026', 0],
      ['LOOKAHEAD L-2', '10/29/2026', 0],
    ]);
  });
});
