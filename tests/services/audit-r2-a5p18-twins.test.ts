/**
 * Audit round 2, A5 pass 18 (1 Oct 2026): same-named tasks ("twins", two
 * "Pour slab" in Alpha/Lot) as an import, Set Active and Make Current pair
 * them with the saved twins (ScheduleImportMerge.pairSameNamedTasks).
 *
 * The rule, by the schedule's role:
 * - Microsoft Project rows carry no stable task identity across revisions:
 *   the normalizer keeps the ID column (sourceActivityId), the WBS / outline
 *   number when the export has one (sourceWbsCode) and the row number
 *   (sourceRowNumber). No Unique ID is read, and an inserted row renumbers
 *   all three below it, so none of them is an identity. They pair as every
 *   other master does, the row number breaking a tie between twins on the
 *   same days.
 * - A master (or Set Active / Make Current) with as many rows as twins pairs
 *   both sides in one stable order: start day, finish day, row number, then
 *   the file's own order (rows) or the task id (saved twins). Never the order
 *   tasks happen to be saved in, which differs between the phone and the
 *   web. With different counts, only twins on the same days pair.
 * - A lookahead (a rolling window) pairs each twin row with the saved twin
 *   it overlaps or is uniquely nearest to, each the other's best; a twin it
 *   does not list is not left over for another row.
 *
 * Remaining ambiguity, recorded: dates alone cannot tell a slip by exactly
 * the twin spacing from "drop the first, keep the second, add a third". A
 * master reads it as the slip; a lookahead as the rolling window.
 *
 * Real CSV and Microsoft Project normalizers, the phone's merge and shown-task
 * pick, the web's upload plan and Make Current carry, and task links.
 * Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
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

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const shownNamed = (state: State, name: string) => shown(state).filter(item => item.taskName === name);

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
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]) {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt,
  });
  return {
    merged,
    state: { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') },
  };
}

/** Approving a lookahead: it restates the master's tasks in place and adds the rest (owner answer Q22). */
function approveLookahead(state: State, source: ReferenceDocument, imported: ScheduleItem[]) {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: true,
  });
  return { merged, state: { items: [...merged.additions, ...merged.next], documents: [...state.documents, source] } };
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
/** Each shown twin: id, start, percent and the ids it answers to, by start day. */
const twins = (state: State, name = 'Pour slab') => shownNamed(state, name)
  .map(item => [item.id, item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []] as const)
  .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]));

const FRAMING = 'Framing,Alpha,Lot,10/26/2026,10/30/2026,';
const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-26T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-29T12:00:00.000Z');

/**
 * F1 (caused by 38f12be): twins on 10/05-09 (David's 80%) and 10/12-16; a
 * revision slips both by a week. Same days first paired the new 10/12 row
 * with the saved second twin, so David's 80% went to 10/19.
 */
describe('A5 p18 F1: a slip by the twin spacing keeps each twin\'s progress on its task', () => {
  const ONE = 'Pour slab,Alpha,Lot,10/05/2026,10/09/2026,';
  const TWO = 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,';
  const THREE = 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,';
  const onF = record(approve(EMPTY, F, rows(F, [ONE, TWO, FRAMING])).state, 'MASTER F-1', 80, '2026-09-22T15:00:00.000Z');

  it('phone: a revised master slips both a week: 80% moves to 10/12 with the first twin, its reports follow', () => {
    const { state } = approve(onF, G, rows(G, [TWO, THREE, FRAMING]));
    expect(twins(state)).toEqual([
      ['MASTER G-1', '10/12/2026', 80, ['MASTER F-1']],
      ['MASTER G-2', '10/19/2026', 0, ['MASTER F-2']],
    ]);
    expect(link(state, 'MASTER F-1')).toBe('MASTER G-1');
    expect(link(state, 'MASTER F-2')).toBe('MASTER G-2');
  });

  it('phone: the same file listed in another order pairs the same way (the file\'s row order is not the rule)', () => {
    const { state } = approve(onF, G, rows(G, [FRAMING, THREE, TWO]));
    expect(twins(state).map(([, start, percent, from]) => [start, percent, from])).toEqual([
      ['10/12/2026', 80, ['MASTER F-1']],
      ['10/19/2026', 0, ['MASTER F-2']],
    ]);
  });

  it('Microsoft Project: one-day QUALITY INSPECTION twins a week apart, both slipped a week: 80% stays with the first', () => {
    const QI = 'QUALITY INSPECTION';
    const onMsp = approve(EMPTY, F, msp(F, [[QI, 'Mon 10/5/26'], ['FRAMING', 'Tue 10/6/26', 'Fri 10/9/26'], [QI, 'Mon 10/12/26']])).state;
    const first = shownNamed(onMsp, QI).find(item => item.startDate === '10/05/2026')!;
    const recorded = record(onMsp, first.id, 80, '2026-09-22T15:00:00.000Z');
    const { state } = approve(recorded, G, msp(G, [['FRAMING', 'Tue 10/13/26', 'Fri 10/16/26'], [QI, 'Mon 10/12/26'], [QI, 'Mon 10/19/26']]));
    expect(shownNamed(state, QI).map(item => [item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([
      ['10/12/2026', 80, [first.id]],
      ['10/19/2026', 0, [shownNamed(onMsp, QI).find(item => item.startDate === '10/12/2026')!.id]],
    ]);
  });

  it('Microsoft Project: an inserted row renumbers ID, WBS and row of the twins; they still pair by their days (guard)', () => {
    const QI = 'QUALITY INSPECTION';
    const onMsp = approve(EMPTY, F, msp(F, [[QI, 'Mon 10/5/26'], [QI, 'Mon 10/12/26']])).state;
    const [first, second] = [...shownNamed(onMsp, QI)].sort((left, right) => left.startDate.localeCompare(right.startDate));
    const recorded = record(record(onMsp, first.id, 80, '2026-09-22T15:00:00.000Z'), second.id, 20, '2026-09-22T15:00:00.000Z');
    // "Strip forms" above both: the first twin is now ID 3 / WBS 1.2, the second twin's old numbers.
    const revised = msp(G, [['Strip forms', 'Fri 10/2/26'], [QI, 'Mon 10/5/26'], [QI, 'Mon 10/12/26']]);
    expect(revised.find(item => item.startDate === '10/05/2026')!.sourceWbsCode).toBe(second.sourceWbsCode);
    const { state } = approve(recorded, G, revised);
    expect(shownNamed(state, QI).map(item => [item.id, item.startDate, item.percentComplete])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])))).toEqual([[first.id, '10/05/2026', 80], [second.id, '10/12/2026', 20]]);
  });

  it('Microsoft Project: the first twin slips past the second (outline order kept): each keeps its own (row order)', () => {
    const QI = 'QUALITY INSPECTION';
    const onMsp = approve(EMPTY, F, msp(F, [[QI, 'Mon 10/5/26'], [QI, 'Mon 10/12/26']])).state;
    const [first, second] = [...shownNamed(onMsp, QI)].sort((left, right) => left.startDate.localeCompare(right.startDate));
    const recorded = record(record(onMsp, first.id, 80, '2026-09-22T15:00:00.000Z'), second.id, 20, '2026-09-22T15:00:00.000Z');
    // The first inspection moves to 10/19, after the second; Project still lists it first.
    const { state } = approve(recorded, G, msp(G, [[QI, 'Mon 10/19/26'], [QI, 'Mon 10/12/26']]));
    expect(shownNamed(state, QI).map(item => [item.startDate, item.percentComplete])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))).toEqual([['10/12/2026', 20], ['10/19/2026', 80]]);
  });

  it('Microsoft Project: the twins swapped in the outline on the same days: each stays itself (the days decide)', () => {
    const QI = 'QUALITY INSPECTION';
    const onMsp = approve(EMPTY, F, msp(F, [[QI, 'Mon 10/5/26'], [QI, 'Mon 10/12/26']])).state;
    const [first, second] = [...shownNamed(onMsp, QI)].sort((left, right) => left.startDate.localeCompare(right.startDate));
    const recorded = record(record(onMsp, first.id, 80, '2026-09-22T15:00:00.000Z'), second.id, 20, '2026-09-22T15:00:00.000Z');
    const { state } = approve(recorded, G, msp(G, [[QI, 'Mon 10/12/26'], [QI, 'Mon 10/5/26']]));
    expect(shownNamed(state, QI).map(item => [item.id, item.startDate, item.percentComplete])
      .sort((left, right) => String(left[1]).localeCompare(String(right[1])))).toEqual([[first.id, '10/05/2026', 80], [second.id, '10/12/2026', 20]]);
  });

  it('lookahead: both twins listed a week later: the 80% never moves to 10/19, and is never lowered', () => {
    const L = schedule('LOOKAHEAD L', '2026-09-24T12:00:00.000Z', 'lookahead');
    const { state } = approveLookahead(onF, L, rows(L, [TWO, THREE]));
    // Read as the rolling window it is: the second twin is on its days, 10/19 is new, the first twin is not
    // listed (the recorded ambiguity: a slip by exactly the spacing reads as this).
    expect(twins(state)).toEqual([
      ['MASTER F-1', '10/05/2026', 80, []],
      ['MASTER F-2', '10/12/2026', 0, []],
      ['LOOKAHEAD L-2', '10/19/2026', 0, []],
    ]);
    expect(link(state, 'MASTER F-1')).toBe('MASTER F-1');
  });

  it('Set Active: progress David recorded on the slipped master goes back to the twin in its place, not the one on its days', () => {
    const fRows = rows(F, [ONE, TWO, FRAMING]);
    const gRows = rows(G, [TWO, THREE, FRAMING]);
    const recorded = (item: ScheduleItem, percentComplete: number): ScheduleItem => ({
      ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-27T09:00:00.000Z',
      progressConfirmedBy: 'David',
    });
    const carried = scheduleProgressCarriedToShownTasks({
      before: [recorded(gRows[0], 80), recorded(gRows[1], 30), gRows[2]], after: fRows, now: '2026-09-28T00:00:00.000Z',
    });
    expect(carried.map(item => [item.id, item.startDate, item.percentComplete])).toEqual([
      ['MASTER F-1', '10/05/2026', 80],
      ['MASTER F-2', '10/12/2026', 30],
    ]);
  });
});

/**
 * F2 (older): "file order" for saved twins was the order the device keeps
 * them in, since only Microsoft Project rows carry a row number. The phone
 * saves a task entered by hand at the top; the web reads tasks newest
 * updated first. So twins both moved paired differently on the phone and
 * the web, and two hand-entered twins swapped.
 */
describe('A5 p18 F2: the saved twins\' stored order never decides the pairing', () => {
  const hand = (id: string, startDate: string, finishDate: string, percentComplete: number, at: string): ScheduleItem => ({
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab', startDate, finishDate,
    milestone: '', owner: '', contractor: '', status: percentComplete > 0 ? 'In Progress' : 'Not Started', percentComplete, priority: 'Medium',
    notes: '', ...(percentComplete > 0 ? { progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David' } : {}),
    createdAt: at, updatedAt: at,
  }) as ScheduleItem;

  it('phone: two twins entered by hand (the newer saved at the top), both moved by a master, each keep their own', () => {
    const first = hand('hand-1', '10/05/2026', '10/09/2026', 80, '2026-09-15T12:00:00.000Z');
    const second = hand('hand-2', '10/12/2026', '10/16/2026', 0, '2026-09-16T12:00:00.000Z');
    const { state } = approve({ items: [second, first], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,10/07/2026,10/11/2026,', 'Pour slab,Alpha,Lot,10/14/2026,10/18/2026,',
    ]));
    expect(twins(state)).toEqual([['hand-1', '10/07/2026', 80, []], ['hand-2', '10/14/2026', 0, []]]);
  });

  it('web and phone agree: the web reads twin 2 first (updated last), the phone twin 1; both pair twin 1 with the first row', () => {
    let onF = record(approve(EMPTY, F, rows(F, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,'])).state,
      'MASTER F-1', 80, '2026-09-22T15:00:00.000Z');
    onF = { ...onF, items: onF.items.map(item => item.id === 'MASTER F-2' ? { ...item, owner: 'Crew B', updatedAt: '2026-09-23T15:00:00.000Z' } : item) };
    const slipped = ['Task,Project,Location,Start,Finish,Owner,Status,Percent Complete',
      'Pour slab,Alpha,Lot,10/07/2026,10/11/2026,,Not Started,0', 'Pour slab,Alpha,Lot,10/14/2026,10/18/2026,,Not Started,0'].join('\n');
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: 'alpha-master-g.csv', mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
      contents: slipped, fingerprint: 'a'.repeat(64), now: '2026-09-26T12:00:00.000Z',
    });
    // The web's read order: newest updated first.
    const webOrder = [...shown(onF)].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }));
    expect(webOrder.map(item => item.id)).toEqual(['MASTER F-2', 'MASTER F-1']);
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webOrder }, importedScheduleItems: prepared.scheduleItems });
    const web = plan.additions.map(item => [item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []] as const)
      .sort((left, right) => left[0].localeCompare(right[0]));
    expect(web).toEqual([['10/07/2026', 80, ['MASTER F-1']], ['10/14/2026', 0, ['MASTER F-2']]]);
    // The phone, with its own order, pairs the same rows the same way.
    const phone = mergeApprovedScheduleImportItems({
      existing: onF.items, imported: prepared.scheduleItems, completionMatch: () => null, mergeCompletion: item => item,
    }).additions.map(item => [item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []] as const)
      .sort((left, right) => left[0].localeCompare(right[0]));
    expect(phone).toEqual(web);
  });
});

/**
 * F3 (older): a lookahead listing only some twins (phase 2 outside its
 * window) paired none (1 row against 2 twins), so Pour slab showed three
 * times, and the next master's slip (2 rows against 3) paired none either:
 * both rows came in at 0%, David's 80% and its reports left the view.
 */
describe('A5 p18 F3: a lookahead listing some of the twins restates the one it lists', () => {
  const L = schedule('LOOKAHEAD L', '2026-09-24T12:00:00.000Z', 'lookahead');
  const onF = record(approve(EMPTY, F, rows(F, [
    'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,', 'Pour slab,Alpha,Lot,10/22/2026,10/24/2026,', FRAMING,
  ])).state, 'MASTER F-1', 80, '2026-09-22T15:00:00.000Z');
  const onL = approveLookahead(onF, L, rows(L, ['Pour slab,Alpha,Lot,10/02/2026,10/04/2026,'])).state;

  it('the one row listed restates phase 1 in place, at David\'s 80%: Pour slab shows twice, not three times', () => {
    expect(twins(onL)).toEqual([['MASTER F-1', '10/02/2026', 80, []], ['MASTER F-2', '10/22/2026', 0, []]]);
    expect(link(onL, 'MASTER F-1')).toBe('MASTER F-1');
  });

  it('the next master slipping both pairs both: David\'s 80% follows phase 1', () => {
    const { state } = approve(onL, G, rows(G, ['Pour slab,Alpha,Lot,10/03/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/23/2026,10/25/2026,', FRAMING]));
    // The master's rows (phase 1's own row, which the lookahead holds, still shows beside them).
    expect(twins(state).filter(([id]) => id.startsWith('MASTER G'))).toEqual([
      ['MASTER G-1', '10/03/2026', 80, ['MASTER F-1']],
      ['MASTER G-2', '10/23/2026', 0, ['MASTER F-2']],
    ]);
  });

  it('after a rolling lookahead added a third, the next master\'s two rows pair with the master\'s two twins', () => {
    // The lookahead keeps phase 2 on its days (restated) and adds a phase 3; phase 1 is outside its window.
    const rolling = approveLookahead(onF, L, rows(L, ['Pour slab,Alpha,Lot,10/22/2026,10/24/2026,', 'Pour slab,Alpha,Lot,10/29/2026,10/31/2026,'])).state;
    expect(twins(rolling).map(([id, start, percent]) => [id, start, percent])).toEqual([
      ['MASTER F-1', '10/01/2026', 80], ['MASTER F-2', '10/22/2026', 0], ['LOOKAHEAD L-2', '10/29/2026', 0],
    ]);
    // Two rows against three shown: the lookahead's own twin is left to it, so the master's pair and 80% follows.
    const { state } = approve(rolling, G, rows(G, ['Pour slab,Alpha,Lot,10/03/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/23/2026,10/25/2026,', FRAMING]));
    // (Phase 2's own row, which the lookahead holds, still shows beside the master's.)
    expect(twins(state).filter(([id]) => !id.startsWith('MASTER F'))).toEqual([
      ['MASTER G-1', '10/03/2026', 80, ['MASTER F-1']],
      ['MASTER G-2', '10/23/2026', 0, ['MASTER F-2']],
      ['LOOKAHEAD L-2', '10/29/2026', 0, []],
    ]);
    expect(link(state, 'MASTER F-1')).toBe('MASTER G-1');
  });

  it('a row equally near two twins pairs with neither (added), and never takes a percent', () => {
    const between = approveLookahead(onF, L, rows(L, ['Pour slab,Alpha,Lot,10/12/2026,10/13/2026,'])).state;
    expect(twins(between)).toEqual([
      ['MASTER F-1', '10/01/2026', 80, []],
      ['LOOKAHEAD L-1', '10/12/2026', 0, []],
      ['MASTER F-2', '10/22/2026', 0, []],
    ].sort((left, right) => String(left[1]).localeCompare(String(right[1]))));
  });
});

/**
 * L1 (from 348e414): a row carrying only importedFrom (imported before batch
 * and document ids) counted as entered by hand, so a master restated it in
 * place on its dates; once its own file was no longer current the task was
 * hidden, and Pour slab left the view with David's 40%.
 */
describe('A5 p18 L1: a task known only by the file it came from belongs to that file', () => {
  const legacyFile = { ...schedule('legacy-master', '2026-08-01T12:00:00.000Z'), originalFileName: 'alpha-master-2025.csv', importBatchId: null } as ReferenceDocument;
  const legacy = {
    id: 'legacy-pour', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab',
    startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: '', contractor: '', status: 'In Progress', percentComplete: 40,
    priority: 'Medium', notes: '', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T12:00:00.000Z', progressConfirmedBy: 'David',
    importedFrom: 'alpha-master-2025.csv', importedAt: '2026-08-01T12:00:00.000Z', createdAt: '2026-08-01T12:00:00.000Z',
  } as ScheduleItem;

  it('a master moving it shows Pour slab once, on the master\'s dates, at David\'s 40%', () => {
    const start: State = { items: [legacy], documents: [legacyFile] };
    expect(shownNamed(start, 'Pour slab').map(item => item.id)).toEqual(['legacy-pour']);
    const { state } = approve(start, G, rows(G, ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,', FRAMING]));
    expect(twins(state)).toEqual([['MASTER G-1', '10/08/2026', 40, ['legacy-pour']]]);
    expect(link(state, 'legacy-pour')).toBe('MASTER G-1');
  });
});

/**
 * L2 (from 348e414): a master row with blank dates wrote blank master dates
 * into a lookahead's note, so deleting the lookahead gave the task blank
 * dates.
 */
describe('A5 p18 L2: a master row with no dates leaves the lookahead note\'s master dates', () => {
  const L = schedule('LOOKAHEAD L', '2026-09-24T12:00:00.000Z', 'lookahead');
  const noted = {
    id: 'hand-pour', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab',
    startDate: '10/03/2026', finishDate: '10/07/2026', milestone: '', owner: '', contractor: '', status: 'In Progress', percentComplete: 40,
    priority: 'Medium', notes: '', progressSource: 'project_manager', progressConfirmedAt: '2026-09-18T15:00:00.000Z', progressConfirmedBy: 'David',
    createdAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-24T12:00:00.000Z',
    lookaheadOverlay: {
      masterStartDate: '10/01/2026', masterFinishDate: '10/05/2026', masterPercentComplete: 40, masterStatus: 'In Progress',
      masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-18T15:00:00.000Z',
      masterFilePercentComplete: null, lookaheads: [{ batchId: L.importBatchId, startDate: '10/03/2026', finishDate: '10/07/2026', percentComplete: null }],
    },
  } as ScheduleItem;

  it('the note keeps 10/01-10/05 (the percent it states is noted), and deleting the lookahead gives those dates back', () => {
    const { state } = approve({ items: [noted], documents: [L] }, F, rows(F, ['Pour slab,Alpha,Lot,,,70']));
    const task = state.items.find(item => item.id === 'hand-pour')!;
    expect(task.lookaheadOverlay).toMatchObject({ masterStartDate: '10/01/2026', masterFinishDate: '10/05/2026', masterPercentComplete: 70 });
    expect([task.startDate, task.finishDate]).toEqual(['10/03/2026', '10/07/2026']);
    const back = scheduleItemsAfterLookaheadDeleted(state.items, L, '2026-09-30T12:00:00.000Z').find(item => item.id === 'hand-pour')!;
    expect([back.startDate, back.finishDate]).toEqual(['10/01/2026', '10/05/2026']);
  });
});

/**
 * L3 (from 348e414): a schedule uploaded on the web is not current until
 * David makes it current ("must be reviewed"), but its upload already moved
 * his hand-entered task to the file's dates on every device, and nothing
 * undid that if he never made it current. Now the task is restated when the
 * schedule becomes current: Make Current on the web, Set Active on the phone.
 */
describe('A5 p18 L3: a web upload restates a hand-entered task only when it is made current', () => {
  const hand = buildDAVEWebScheduleItem({
    id: 'web-hand-pour', now: '2026-09-20T15:00:00.000Z', actor: 'David',
    draft: {
      itemType: 'Task', taskName: 'Pour slab', projectName: 'Alpha', projectId: 'alpha', locationName: 'Lot',
      startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: 'Crew A', contractor: '', percentComplete: '40',
      priority: 'Medium', status: 'In Progress', notes: 'Pump booked', nextAction: '', activityMessage: '',
    },
  });
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: 'alpha-master-f.csv', mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Location,Start,Finish,Owner,Status,Percent Complete',
      'Pour slab,Alpha,Lot,10/08/2026,10/12/2026,,In Progress,60', 'Framing,Alpha,Lot,10/14/2026,10/20/2026,,Not Started,0'].join('\n'),
    fingerprint: 'f'.repeat(64), now: '2026-09-25T12:00:00.000Z',
  });
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: [{ ...hand, cloudUpdatedAt: 'rev-1' }] }, importedScheduleItems: prepared.scheduleItems });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  const uploaded: State = { items: [...plan.additions, ...[hand].map(item => revised.get(item.id) || item)], documents: [prepared.document] };

  it('after the upload (not current) David\'s task shows on his own dates and percent, on every device', () => {
    expect(prepared.document.isCurrent).toBe(false);
    expect(shownNamed(uploaded, 'Pour slab')).toEqual([expect.objectContaining({
      id: 'web-hand-pour', startDate: '10/01/2026', finishDate: '10/05/2026', percentComplete: 40, owner: 'Crew A',
    })]);
    expect(plan.additions.map(item => item.taskName)).toEqual(['Framing']);
  });

  it('Make Current on the web restates it in place: the file\'s dates, the file\'s higher 60%, his owner and notes; shown once', () => {
    const current: State = { ...uploaded, documents: scheduleDocumentsAfterActivation(prepared.document, uploaded.documents, 'project') };
    const carried = new Map(scheduleProgressCarriedToShownTasks({
      before: shown(uploaded), after: shown(current), documentsBefore: uploaded.documents, documentsAfter: current.documents,
      now: '2026-09-27T12:00:00.000Z',
    }).map(item => [item.id, item]));
    const after: State = { ...current, items: current.items.map(item => carried.get(item.id) || item) };
    expect(shownNamed(after, 'Pour slab')).toEqual([expect.objectContaining({
      id: 'web-hand-pour', startDate: '10/08/2026', finishDate: '10/12/2026', percentComplete: 60, owner: 'Crew A', notes: 'Pump booked',
    })]);
    // Applied once: the task no longer waits on that schedule.
    expect(after.items.find(item => item.id === 'web-hand-pour')).not.toHaveProperty('scheduleRowsAwaitingCurrent');
  });

  it('Set Active on the phone does the same', () => {
    const documentsAfter = scheduleDocumentsAfterActivation(prepared.document, uploaded.documents, 'project');
    const carried = scheduleProgressCarriedOnActivation({
      items: uploaded.items, documentsBefore: uploaded.documents, documentsAfter, now: '2026-09-27T12:00:00.000Z',
    });
    expect(carried).toEqual([expect.objectContaining({ id: 'web-hand-pour', startDate: '10/08/2026', percentComplete: 60 })]);
  });

  it('another schedule made current leaves David\'s task and the waiting row alone', () => {
    const other = { ...schedule('MASTER OTHER', '2026-09-26T12:00:00.000Z'), isCurrent: false } as ReferenceDocument;
    const documentsBefore = [...uploaded.documents, other];
    const documentsAfter = scheduleDocumentsAfterActivation(other, documentsBefore, 'project');
    expect(scheduleProgressCarriedOnActivation({ items: uploaded.items, documentsBefore, documentsAfter })).toEqual([]);
  });

  it('a percent David raised meanwhile stays (a file never lowers his): 70% over the file\'s 60%', () => {
    const raised: State = { ...uploaded, items: uploaded.items.map(item => item.id === 'web-hand-pour'
      ? { ...item, percentComplete: 70, progressConfirmedAt: '2026-09-26T12:00:00.000Z', updatedAt: '2026-09-26T12:00:00.000Z' } : item) };
    const documentsAfter = scheduleDocumentsAfterActivation(prepared.document, raised.documents, 'project');
    const carried = scheduleProgressCarriedOnActivation({ items: raised.items, documentsBefore: raised.documents, documentsAfter, now: '2026-09-27T12:00:00.000Z' });
    expect(carried).toEqual([expect.objectContaining({ id: 'web-hand-pour', startDate: '10/08/2026', percentComplete: 70, progressConfirmedBy: 'David' })]);
  });
});
