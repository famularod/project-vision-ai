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
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { SCHEDULE_UPDATE_PROGRESS_CONFIRMER } from '../../services/ScheduleProgressSource';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

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
