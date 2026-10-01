/**
 * Audit round 2, A5 pass 17 (1 Oct 2026): how an approved schedule joins the
 * tasks already saved (ScheduleImportMerge).
 *
 * M1 (older, from edf52a1): David adds "Pour slab" (Alpha, Lot) by hand at
 * 40%. A master lists Pour slab on other dates: the merge paired the master's
 * row with his task but, on new dates, saved the row as a new task (recording
 * his as the one it replaced) and left his on its old dates. A task entered
 * by hand belongs to no import, so it always shows: Pour slab showed twice,
 * each at 40%. On the next master, two candidates for one row paired with
 * neither, so its row came in at 0% and the 60% David had entered on the
 * master's copy left the view. The web's upload plan and Make Current did the
 * same. Now a task entered by hand is restated in place on the master's
 * dates, as a task on the same dates and a lookahead's task already are: his
 * id, progress (never lowered by a file, owner answer Q22), who judged it and
 * when (progressJudgment), owner and notes stay.
 *
 * Real CSV normalizer, the phone's merge and the shown-schedule pick, the
 * web's task builder, upload plan and Make Current carry, and task links.
 * Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { reconcileDAVEScheduleRecords, reconcileDAVEScheduleRecordsUnindexed } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { SCHEDULE_UPDATE_PROGRESS_CONFIRMER } from '../../services/ScheduleProgressSource';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { formatCalendarDate, parseFlexibleDate } from '../../utils/date';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const shownNamed = (state: State, name: string) => shown(state).filter(item => item.taskName === name);

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;

/** A CSV master's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
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

const report = (scheduleItemId: string): ProjectUpdate => ({
  id: `u-${scheduleItemId}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-29T16:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is half placed.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
}) as ProjectUpdate;

describe('A5 p17 M1: a task David added by hand is restated in place when a master moves it', () => {
  // David's 40%, given back to him earlier (judged 18 Sep), with his owner and notes.
  const HAND = {
    id: 'hand-pour', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab',
    startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: 'Crew A', contractor: '', status: 'In Progress',
    percentComplete: 40, priority: 'Medium', notes: 'Pump booked', progressSource: 'project_manager',
    progressConfirmedAt: '2026-09-20T15:00:00.000Z', progressConfirmedBy: 'David',
    progressJudgment: { judgedAt: '2026-09-18T15:00:00.000Z', givenBackAt: '2026-09-20T15:00:00.000Z' },
    createdAt: '2026-09-15T12:00:00.000Z', updatedAt: '2026-09-20T15:00:00.000Z',
  } as ScheduleItem;
  const FRAMING = 'Framing,Alpha,Lot,10/14/2026,10/20/2026,0';
  const F = schedule('MASTER F', '2026-09-25T12:00:00.000Z');
  const G = schedule('MASTER G', '2026-09-30T12:00:00.000Z');
  const start: State = { items: [HAND], documents: [] };
  const onF = approve(start, F, rows(F, ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,0', FRAMING]));

  it('the master\'s Pour slab on new dates shows once: David\'s task, on the master\'s dates, with his 40%, judgment, owner and notes', () => {
    expect(shownNamed(onF.state, 'Pour slab')).toEqual([{
      ...HAND, startDate: '10/08/2026', finishDate: '10/12/2026', updatedAt: F.importedAt,
    }]);
    expect(onF.merged.additions.map(item => item.taskName)).toEqual(['Framing']);
    // No row records David's task as the one it replaced; it is still entered by hand (no import).
    expect(onF.state.items.filter(item => item.revisedFromTaskIds?.includes(HAND.id))).toEqual([]);
    const saved = onF.state.items.find(item => item.id === HAND.id)!;
    expect([saved.importBatchId, saved.sourceDocumentId, saved.alsoImportedInBatchIds]).toEqual([undefined, undefined, undefined]);
  });

  it('a report on David\'s task links to it', () => {
    expect(scheduleTaskLinks(shown(onF.state), onF.state.items)(report(HAND.id))).toEqual({
      item: shownNamed(onF.state, 'Pour slab')[0], basis: 'task_id',
    });
  });

  it('the next master pairs with his one task: his 60% stays over the file\'s 20% (Q22), on G\'s dates', () => {
    const sixty = record(onF.state, HAND.id, 60, '2026-09-27T09:00:00.000Z');
    const onG = approve(sixty, G, rows(G, ['Pour slab,Alpha,Lot,10/09/2026,10/13/2026,20', FRAMING]));
    expect(shownNamed(onG.state, 'Pour slab')).toHaveLength(1);
    expect(shownNamed(onG.state, 'Pour slab')[0]).toMatchObject({
      id: HAND.id, startDate: '10/09/2026', finishDate: '10/13/2026', percentComplete: 60, progressSource: 'project_manager',
      progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-27T09:00:00.000Z',
    });
    expect(onG.merged.additions).toEqual([]);
    expect(onG.merged.fileProgressIds).toEqual([]);
    expect(scheduleTaskLinks(shown(onG.state), onG.state.items)(report(HAND.id))?.item.id).toBe(HAND.id);
  });

  it('a file stating more than David\'s percent raises it, as on the same dates (the schedule\'s, confirmed at approval)', () => {
    const onG = approve(onF.state, G, rows(G, ['Pour slab,Alpha,Lot,10/09/2026,10/13/2026,70', FRAMING]));
    expect(shownNamed(onG.state, 'Pour slab')).toEqual([expect.objectContaining({
      id: HAND.id, finishDate: '10/13/2026', percentComplete: 70, progressSource: 'project_manager',
      progressConfirmedBy: SCHEDULE_UPDATE_PROGRESS_CONFIRMER, progressConfirmedAt: G.importedAt,
    })]);
    expect(onG.merged.fileProgressIds).toEqual([HAND.id]);
  });

  it('an older task entered by hand with no progress source keeps its 40% over the file\'s 20%', () => {
    const { progressSource: _source, progressConfirmedAt: _at, progressConfirmedBy: _by, progressJudgment: _judged, ...older } = HAND;
    const onG = approve({ items: [older as ScheduleItem], documents: [] }, G, rows(G, ['Pour slab,Alpha,Lot,10/09/2026,10/13/2026,20']));
    expect(shownNamed(onG.state, 'Pour slab')).toEqual([{ ...older, startDate: '10/09/2026', finishDate: '10/13/2026', updatedAt: G.importedAt }]);
  });

  it('a master repeating what it said before a lookahead restated the task leaves the lookahead\'s dates (unchanged)', () => {
    const noted = {
      ...HAND, startDate: '10/03/2026', finishDate: '10/07/2026',
      lookaheadOverlay: {
        masterStartDate: '10/01/2026', masterFinishDate: '10/05/2026', masterPercentComplete: 40, masterStatus: 'In Progress',
        masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-18T15:00:00.000Z',
        masterFilePercentComplete: null, lookaheads: [{ batchId: 'batch-L', startDate: '10/03/2026', finishDate: '10/07/2026', percentComplete: null }],
      },
    } as ScheduleItem;
    const repeat = approve({ items: [noted], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,']));
    expect(shownNamed(repeat.state, 'Pour slab')).toEqual([noted]);
    // A master that moves it: the task takes the master's dates, and its note what the master says now.
    const moved = approve({ items: [noted], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,']));
    expect(shownNamed(moved.state, 'Pour slab')).toEqual([expect.objectContaining({
      id: HAND.id, startDate: '10/08/2026', finishDate: '10/12/2026', percentComplete: 40,
      lookaheadOverlay: expect.objectContaining({ masterStartDate: '10/08/2026', masterFinishDate: '10/12/2026' }),
    })]);
  });

  it('a master row that states no dates leaves David\'s dates (as a row stating no percent leaves his percent)', () => {
    const blank = approve(start, F, rows(F, ['Pour slab,Alpha,Lot,,,']));
    expect(shownNamed(blank.state, 'Pour slab')).toEqual([HAND]);
    expect(blank.merged.additions).toEqual([]);
  });

  it('a task the master owns on new dates is still a new row that records the one it replaced', () => {
    const onG = approve(onF.state, G, rows(G, ['Pour slab,Alpha,Lot,10/09/2026,10/13/2026,0', 'Framing,Alpha,Lot,10/15/2026,10/21/2026,0']));
    const framing = shownNamed(onG.state, 'Framing');
    expect(framing).toHaveLength(1);
    expect(framing[0].id).toBe('MASTER G-2');
    expect(framing[0].revisedFromTaskIds).toEqual(['MASTER F-2']);
  });
});

describe('A5 p17 M1 on the web: the upload plan and Make Current show David\'s task once', () => {
  const hand = buildDAVEWebScheduleItem({
    id: 'web-hand-pour', now: '2026-09-20T15:00:00.000Z', actor: 'David',
    draft: {
      itemType: 'Task', taskName: 'Pour slab', projectName: 'Alpha', projectId: 'alpha', locationName: 'Lot',
      startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: '', contractor: '', percentComplete: '40',
      priority: 'Medium', status: 'In Progress', notes: '', nextAction: '', activityMessage: '',
    },
  });
  const prepared = prepareDAVEWebDocumentUpload({
    fileName: 'alpha-master-f.csv', mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Location,Start,Finish,Owner,Status,Percent Complete',
      'Pour slab,Alpha,Lot,10/08/2026,10/12/2026,,Not Started,0', 'Framing,Alpha,Lot,10/14/2026,10/20/2026,,Not Started,0'].join('\n'),
    fingerprint: 'f'.repeat(64), now: '2026-09-25T12:00:00.000Z',
  });
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: [{ ...hand, cloudUpdatedAt: 'rev-1' }] }, importedScheduleItems: prepared.scheduleItems });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  const uploaded: State = {
    items: [...plan.additions, ...[hand].map(item => revised.get(item.id) || item)],
    documents: [prepared.document],
  };
  const current: State = { ...uploaded, documents: scheduleDocumentsAfterActivation(prepared.document, uploaded.documents, 'project') };
  const carried = new Map(scheduleProgressCarriedToShownTasks({ before: shown(uploaded), after: shown(current) }).map(item => [item.id, item]));
  const afterMakeCurrent: State = { ...current, items: current.items.map(item => carried.get(item.id) || item) };

  it('the upload restates David\'s task (a revision) and adds only the master\'s other task', () => {
    expect(plan.additions.map(item => item.taskName)).toEqual(['Framing']);
    expect(plan.revisions.map(revision => revision.item)).toEqual([expect.objectContaining({
      id: 'web-hand-pour', startDate: '10/08/2026', finishDate: '10/12/2026', percentComplete: 40, progressSource: 'project_manager',
      progressConfirmedBy: 'David',
    })]);
    expect(plan.revisions[0].cloudUpdatedAt).toBe('rev-1');
  });

  it('after Make Current, Pour slab shows once at David\'s 40%', () => {
    expect(shownNamed(afterMakeCurrent, 'Pour slab')).toEqual([expect.objectContaining({ id: 'web-hand-pour', percentComplete: 40 })]);
    expect(shown(afterMakeCurrent).map(item => item.taskName).sort()).toEqual(['Framing', 'Pour slab']);
  });
});

/**
 * M2 (older, from edf52a1): two tasks with the same name in one area were
 * matched purely by row order, even when a twin sat on the same calendar
 * days. Now, within each same-named group (project and area), a row first
 * pairs with a saved twin on the same calendar days (start and finish; for a
 * twin a lookahead restated, also the master's days its note keeps); the
 * rest pair by order only when exactly one is left on each side; otherwise
 * they are left unpaired (new rows) rather than move David's progress to
 * another task. The import, Set Active's and Make Current's carry share it.
 */
describe('A5 p17 M2: same-named tasks pair by their calendar days first', () => {
  const PHASE_1 = 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,';
  const PHASE_2 = 'Pour slab,Alpha,Lot,10/08/2026,10/10/2026,';
  const PHASE_3 = 'Pour slab,Alpha,Lot,10/15/2026,10/17/2026,';
  const FRAMING = 'Framing,Alpha,Lot,10/20/2026,10/24/2026,';
  const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
  const G = schedule('MASTER G', '2026-09-26T12:00:00.000Z');
  const L = { ...schedule('LOOKAHEAD L', '2026-09-28T12:00:00.000Z'), scheduleRole: 'lookahead' } as ReferenceDocument;
  // Master F has two Pour slabs in Lot; David sets phase 1 to 80%.
  const onF = record(approve(EMPTY, F, rows(F, [PHASE_1, PHASE_2, FRAMING])).state, 'MASTER F-1', 80, '2026-09-22T15:00:00.000Z');
  const pours = (state: State) => shownNamed(state, 'Pour slab')
    .map(item => [item.id, item.startDate, item.percentComplete, item.revisedFromTaskIds ?? []] as const)
    .sort((left, right) => left[1].localeCompare(right[1]));
  const link = (state: State, id: string) => scheduleTaskLinks(shown(state), state.items)(report(id))?.item.id ?? null;

  it('A: a revised master drops phase 1, keeps phase 2 on its dates and adds phase 3: phase 2 stays itself', () => {
    const { state } = approve(onF, G, rows(G, [PHASE_2, PHASE_3, FRAMING]));
    expect(pours(state)).toEqual([
      // Phase 2 is F's own row, now in G too, at its own 0%.
      ['MASTER F-2', '10/08/2026', 0, []],
      // The one row left pairs with the one twin left (phase 1), as a single task's move would.
      ['MASTER G-2', '10/15/2026', 80, ['MASTER F-1']],
    ]);
    // A report on phase 2 stays on phase 2; one on phase 1 follows the row that replaced it.
    expect(link(state, 'MASTER F-2')).toBe('MASTER F-2');
    expect(link(state, 'MASTER F-1')).toBe('MASTER G-2');
  });

  it('B: a CSV sorted by start date where phase 1 slips past phase 2: phase 2 keeps its 0%, phase 1 keeps David\'s 80%', () => {
    const { state } = approve(onF, G, rows(G, [PHASE_2, 'Pour slab,Alpha,Lot,10/15/2026,10/17/2026,', FRAMING]));
    expect(pours(state)).toEqual([
      ['MASTER F-2', '10/08/2026', 0, []],
      ['MASTER G-2', '10/15/2026', 80, ['MASTER F-1']],
    ]);
  });

  it('C: a lookahead with phase 1 rolled off and one new: phase 1\'s 80% never moves onto phase 2\'s dates', () => {
    const overlay = mergeApprovedScheduleImportItems({
      existing: onF.items, imported: rows(L, [PHASE_2, PHASE_3]), completionMatch: () => null, mergeCompletion: item => item,
      isCurrent: scheduleItemsVisibleBeforeImport(onF.items, [...onF.documents, L], L.importBatchId || ''), approvedAt: L.importedAt, overlay: true,
    });
    const state: State = { items: [...overlay.additions, ...overlay.next], documents: [...onF.documents, L] };
    // Phase 2's own row restates phase 2 (its dates and 0% unchanged).
    expect(state.items.find(item => item.id === 'MASTER F-2')).toMatchObject({ startDate: '10/08/2026', percentComplete: 0 });
    expect(shownNamed(state, 'Pour slab').filter(item => item.startDate === '10/08/2026').map(item => item.percentComplete)).toEqual([0]);
    // The one row left pairs with the one twin left by the rule (phase 1, on the row's dates).
    expect(pours(state)).toEqual([
      ['MASTER F-2', '10/08/2026', 0, []],
      ['MASTER F-1', '10/15/2026', 80, []],
    ]);
  });

  it('twins on the same days in both files pair in file order (Microsoft Project\'s same-day QUALITY INSPECTION rows)', () => {
    // A row inserted above renumbers every ID and WBS, so only the pairing keeps them (guards the existing behaviour).
    const msp = (source: ReferenceDocument, lines: (readonly [string, string])[]) => (normalizeMicrosoftProjectPdfRows({
      contents: ['ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS', '1\tALPHA\t0\t20 days\tThu 10/1/26\tFri 10/30/26\t0%\t1',
        ...lines.map(([name, day], index) => [index + 2, name, 1, '1 day', day, day, '0%', `1.${index + 1}`].join('\t'))].join('\n'),
      sourceName: `${source.id}.pdf`, projects: ['Alpha'], now: new Date(source.importedAt),
    }) as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
    const QI = ['QUALITY INSPECTION', 'Mon 10/5/26'] as const;
    // David records on both (a 0% twin of a recorded one reads as its superseded copy, DAVEScheduleRecovery).
    const onFQ = approve(EMPTY, F, msp(F, [QI, QI, ['FRAMING', 'Fri 10/9/26']])).state;
    const twins = record(record(onFQ, 'MASTER F-1', 20, '2026-09-22T15:00:00.000Z'), 'MASTER F-2', 50, '2026-09-22T15:00:00.000Z');
    const { merged, state } = approve(twins, G, msp(G, [['FRAMING', 'Fri 10/9/26'], QI, QI]));
    expect(merged.rehomedIds).toEqual(['MASTER F-3', 'MASTER F-1', 'MASTER F-2']);
    expect(shownNamed(state, 'QUALITY INSPECTION').map(item => [item.id, item.percentComplete])).toEqual([['MASTER F-1', 20], ['MASTER F-2', 50]]);
  });

  // Both twins moved (a revised master that slips every date): as many left on
  // each side, so they pair in file order and David's 80% follows phase 1
  // (owner answer Q22). "Neither" had hidden his progress in this everyday case.
  it('both twins moved (every date slipped): they pair in file order, so David\'s progress follows its task', () => {
    const { merged, state } = approve(onF, G, rows(G, ['Pour slab,Alpha,Lot,10/02/2026,10/04/2026,', 'Pour slab,Alpha,Lot,10/09/2026,10/11/2026,', FRAMING]));
    expect(merged.carriedProgressIds.length).toBeGreaterThan(0);
    expect(pours(state)).toEqual([['MASTER G-1', '10/02/2026', 80, ['MASTER F-1']], ['MASTER G-2', '10/09/2026', 0, ['MASTER F-2']]]);
  });

  it('twins each restated by a lookahead: a master repeating what it said before pairs each on the days its note keeps', () => {
    const lookahead = (id: string, importedAt: string) => ({ ...schedule(id, importedAt), scheduleRole: 'lookahead' }) as ReferenceDocument;
    const approveLookahead = (state: State, source: ReferenceDocument, lines: string[]): State => {
      const merged = mergeApprovedScheduleImportItems({
        existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
        isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
        approvedAt: source.importedAt, overlay: true,
      });
      return { items: [...merged.additions, ...merged.next], documents: [...state.documents, source] };
    };
    // L1 moves phase 1 only; L2 moves phase 2 only (each the one left on each side).
    const L1 = lookahead('LOOKAHEAD L1', '2026-09-21T12:00:00.000Z');
    const L2 = lookahead('LOOKAHEAD L2', '2026-09-22T12:00:00.000Z');
    const onL1 = approveLookahead(onF, L1, ['Pour slab,Alpha,Lot,10/04/2026,10/06/2026,', PHASE_2]);
    const onL2 = approveLookahead(onL1, L2, ['Pour slab,Alpha,Lot,10/04/2026,10/06/2026,', 'Pour slab,Alpha,Lot,10/11/2026,10/13/2026,']);
    expect(pours(onL2)).toEqual([['MASTER F-1', '10/04/2026', 80, []], ['MASTER F-2', '10/11/2026', 0, []]]);
    // G repeats F: neither row is on a twin's shown days, both are on the master days the twins' notes keep.
    const { merged, state } = approve(onL2, G, rows(G, [PHASE_1, PHASE_2, FRAMING]));
    expect(merged.additions.filter(item => item.taskName === 'Pour slab')).toEqual([]);
    expect(pours(state)).toEqual([['MASTER F-1', '10/04/2026', 80, []], ['MASTER F-2', '10/11/2026', 0, []]]);
  });

  it('Set Active and Make Current carry: progress on G\'s rows goes back to the twin on the same days, not the one in that row\'s place', () => {
    // G (sorted by start date) came in while nothing was shown to pair with: fresh rows. David records on them.
    const gRows = rows(G, [PHASE_2, 'Pour slab,Alpha,Lot,10/15/2026,10/17/2026,', FRAMING]);
    const fRows = rows(F, [PHASE_1, PHASE_2, FRAMING]);
    const recorded = (item: ScheduleItem, percentComplete: number): ScheduleItem => ({
      ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-27T09:00:00.000Z',
      progressConfirmedBy: 'David',
    });
    const before = [recorded(gRows[0], 50), recorded(gRows[1], 90), gRows[2]];
    const carried = scheduleProgressCarriedToShownTasks({ before, after: fRows, now: '2026-09-28T00:00:00.000Z' });
    expect(carried.map(item => [item.id, item.startDate, item.percentComplete])).toEqual([
      ['MASTER F-1', '10/01/2026', 90],
      ['MASTER F-2', '10/08/2026', 50],
    ]);
  });
});

/**
 * L1: a CSV whose dates carry a weekday ("Thu 12/31/26", "Mon 1/4/27", as
 * Microsoft Project exports them) came in with every row's dates blank: the
 * shared date parser (parseFlexibleDate) took no weekday. The review flagged
 * the rows, but approval saved them with no dates. The parser now takes a
 * weekday's own names in front of a date; every other form parses as before.
 */
describe('A5 p17 L1: a CSV date written with a weekday comes in', () => {
  const day = (value: string) => {
    const parsed = parseFlexibleDate(value);
    return parsed ? formatCalendarDate(parsed) : null;
  };

  it('reads a weekday in front of a date, in the forms schedules write it', () => {
    expect(['Thu 12/31/26', 'Mon 1/4/27', 'Tues 10/6/26', 'Thu. 10/8/2026', 'wed 2026-10-07', 'Monday, October 5, 2026', 'Fri, Oct 9, 2026'].map(day))
      .toEqual(['12/31/2026', '01/04/2027', '10/06/2026', '10/08/2026', '10/07/2026', '10/05/2026', '10/09/2026']);
  });

  it('every other form parses as before, and text that is not a weekday still names no day', () => {
    expect(['07/31/2026', '7/31/26', '2026-07-31', 'Jul 24, 2026', '24 Jul 2026'].map(day))
      .toEqual(['07/31/2026', '07/31/2026', '07/31/2026', '07/24/2026', '07/24/2026']);
    expect(['', 'Mon', 'TBD', 'Monitor 1/4/27', 'Sun Valley 10/5/26', 'Phase 2', 'Mon 13/45/26', '13/45/2026'].map(day))
      .toEqual([null, null, null, null, null, null, null, null]);
  });

  it('the CSV normalizer keeps the dates, the review does not flag them, and approval saves them', () => {
    const W = schedule('WEEKDAYS', '2026-09-30T12:00:00.000Z');
    const result = normalizeScheduleImport({
      contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Pour slab,Alpha,Lot,Thu 12/31/26,Mon 1/4/27,0'].join('\n'),
      sourceName: W.originalFileName, mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(W.importedAt),
    });
    expect(result.items.map(item => [item.startDate, item.finishDate])).toEqual([['12/31/2026', '01/04/2027']]);
    expect(result.reviewItems.flatMap(item => item.correctionFields)).not.toContain('Dates');
    const { state } = approve(EMPTY, W, rows(W, ['Pour slab,Alpha,Lot,Thu 12/31/26,Mon 1/4/27,0']));
    expect(shownNamed(state, 'Pour slab').map(item => [item.startDate, item.finishDate])).toEqual([['12/31/2026', '01/04/2027']]);
  });
});

/**
 * L2: reconcileDAVEScheduleRecords (approval, startup, cloud apply and every
 * shown-task selection) compared every saved task with every other to find
 * superseded copies: about 1.6 s at 3,300 saved tasks. Each comparison only
 * ever matches a copy from the same file with the same task name, so the
 * saved tasks are now indexed by those first. The result is the same as the
 * full comparison (kept as reconcileDAVEScheduleRecordsUnindexed for this
 * test) over a few hundred mixed rows.
 */
describe('A5 p17 L2: the superseded-copy check compares a task only with copies from its own file and of its own name', () => {
  // A small deterministic generator, so a failure names the same rows every run.
  function generator(seed: number) {
    let state = seed;
    return (count: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % count;
    };
  }
  const pick = <T,>(next: (count: number) => number, values: readonly T[]): T => values[next(values.length)];

  function mixedRows(seed: number, count: number): ScheduleItem[] {
    const next = generator(seed);
    const files = ['', 'Master A.csv', 'master a.csv ', 'Master B.pdf', 'Lookahead.csv'];
    const names = ['Pour slab', 'pour  slab', 'Pour-slab', 'Pour & seal', 'pour and seal', 'Framing', 'Roofing', ''];
    const projects = ['', 'Alpha', 'alpha', 'Harbor North', 'Harbor South'];
    const roots = ['', '2400 Compliance Project', 'Alpha'];
    const areas = ['', 'Lot', 'lot ', 'Deck'];
    const days = ['10/01/2026', '10/02/2026', '2026-10-01', ''];
    const batches = ['', 'batch-a', 'batch-b'];
    const times = ['', '2026-09-01T00:00:00.000Z', '2026-09-15T00:00:00.000Z', '2026-09-30T00:00:00.000Z'];
    return Array.from({ length: count }, (_, index) => {
      const percent = pick(next, [0, 0, 40, 100]);
      const verified = percent === 100 && next(3) === 0;
      return {
        id: next(6) === 0 ? `Task-${next(count)}` : `task-${index}`,
        projectName: pick(next, projects), scheduleProjectName: pick(next, roots), locationName: pick(next, areas),
        taskName: pick(next, names), startDate: pick(next, days), finishDate: pick(next, days), milestone: pick(next, ['', '', 'M1']),
        owner: '', contractor: '', priority: 'Medium', notes: '',
        status: percent === 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', percentComplete: percent,
        progressSource: pick(next, [null, 'project_manager', 'schedule_import', undefined]),
        progressConfirmedAt: pick(next, times) || null,
        completionVerification: verified ? { status: 'pm_verified', reportedAt: pick(next, times), verifiedAt: pick(next, times) } : null,
        importedFrom: pick(next, files) || null, importBatchId: pick(next, batches) || null, sourceDocumentId: pick(next, ['', 'doc-a', 'doc-b']) || null,
        importedAt: pick(next, times) || null, createdAt: pick(next, times), updatedAt: pick(next, times),
      } as unknown as ScheduleItem;
    });
  }

  it.each([1, 2, 3, 4, 5])('seed %i: 400 mixed rows give the same tasks, in the same order, as comparing every row with every other', seed => {
    const records = mixedRows(seed, 400);
    const indexed = reconcileDAVEScheduleRecords(records);
    expect(indexed).toEqual(reconcileDAVEScheduleRecordsUnindexed(records));
    // The rows really exercise the check: some copies are superseded.
    expect(indexed.length).toBeLessThan(new Set(records.map(item => item.id.toLowerCase())).size);
  });

  it('reads each task\'s name a few times, not once per other task from its file (1,000 rows of one file)', () => {
    let reads = 0;
    const rows = Array.from({ length: 1000 }, (_, index) => {
      const row = {
        id: `row-${index}`, projectName: 'Alpha', locationName: 'Lot', startDate: '10/01/2026', finishDate: '10/02/2026', milestone: '',
        status: 'Not Started', percentComplete: 0, importedFrom: 'Master A.csv', importBatchId: 'batch-a', sourceDocumentId: 'doc-a',
      } as unknown as ScheduleItem;
      const name = `Task ${index}`;
      Object.defineProperty(row, 'taskName', { enumerable: true, get: () => { reads += 1; return name; } });
      return row;
    });
    reads = 0;
    expect(reconcileDAVEScheduleRecords(rows)).toHaveLength(1000);
    expect(reads).toBeLessThanOrEqual(10 * rows.length);
    reads = 0;
    reconcileDAVEScheduleRecordsUnindexed(rows);
    expect(reads).toBeGreaterThan(100 * rows.length);
  });
});
