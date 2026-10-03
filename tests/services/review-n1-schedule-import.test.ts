/**
 * Review N1 (pass 1 of the next round, 3 Oct 2026): findings in the schedule
 * import commits of 2 Oct (owner answers Q25, Q29, Q30), each with the check
 * that failed before its fix. Real CSV normalizer, the phone's merge, the
 * shown-schedule pick, the delete helpers and the web's plans. Synthetic data.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { rejectScheduleItemCompletion, verifyScheduleItemCompletion } from '../../services/DAVECompletionVerification';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { daveWebScheduleImportPairingQuestions, planDAVEWebScheduleDocumentDelete, planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem, scheduleItemForCloud, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleImportPairingQuestions,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
  scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleDatesShownUnderReplacedLookahead, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressUndoPoint, scheduleTalkUndo } from '../../services/ScheduleProgressSource';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
const one = (state: State, name: string) => {
  const found = named(state, name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;
const saved = (state: State, id: string) => state.items.find(item => item.id === id)!;

const schedule = (id: string, importedAt: string, role?: 'lookahead', project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], project = 'Alpha'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], pairingChoices?: Record<string, string | null>): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead, ...(pairingChoices ? { pairingChoices } : {}),
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

/** What a save made at that time returns (a date changed alone is noted with the time of the save, review N1 M1). */
function savedAt<T>(at: string, save: () => T): T {
  jest.useFakeTimers({ now: new Date(at) });
  try { return save(); } finally { jest.useRealTimers(); }
}

/** A task edit on the phone: App.tsx's updateScheduleItem patches the saved row with the fields given (its first step included). */
function patch(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  const merged = savedAt(at, () => withProjectControlsEditMerged(state.items.find(item => item.id === id)!, change));
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, ...merged,
      ...(typeof change.percentComplete === 'number' ? {
        status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
        progressConfirmedAt: at, progressConfirmedBy: 'David', progressJudgment: undefined,
      } : {}),
      updatedAt: at,
    } as ScheduleItem : item),
  };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents };
}

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const WK1 = schedule('LOOKAHEAD wk1', '2026-09-14T12:00:00.000Z', 'lookahead');
const WK2 = schedule('LOOKAHEAD wk2', '2026-09-21T12:00:00.000Z', 'lookahead');
const WK3 = schedule('LOOKAHEAD wk3', '2026-09-28T12:00:00.000Z', 'lookahead');
const onF = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', 'Roof,Alpha,Lot,11/02/2026,11/06/2026,']);
// Week 1 moves Framing and adds a detail task; week 2, listing neither, replaces it.
const onWk1 = approve(onF, WK1, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', 'Detail 1,Alpha,Lot,10/21/2026,10/22/2026,']);
const onWk2 = approve(onWk1, WK2, ['Roof,Alpha,Lot,11/03/2026,11/07/2026,', 'Detail 2,Alpha,Lot,10/28/2026,10/29/2026,']);
const framingId = one(onF, 'Framing').id;

/** App.tsx's own updateScheduleItem, compiled from its source: what it puts in the phone's tasks and sends. */
function phoneUpdate(state: State, id: string, edit: Partial<ScheduleItem>, restoresProgress = false): { saved: ScheduleItem; sent: ScheduleItem[] } {
  const from = APP_SOURCE.indexOf('\n  function updateScheduleItem(');
  const to = APP_SOURCE.indexOf('\n  async function saveScheduleItemChanges(', from);
  expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(`module.exports = (() => { ${APP_SOURCE.slice(from, to)}\n return updateScheduleItem; })();`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const ref = { current: state.items };
  const sent: ScheduleItem[] = [];
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: () => 1, markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: () => undefined, scheduleItemChangeUsesDebouncedSync: () => false, cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: (item: ScheduleItem) => { sent.push(item); }, queueScheduleItemRecord: async () => undefined,
    Alert: { alert: () => undefined },
  };
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  (mod.exports as (id: string, edit: Partial<ScheduleItem>, workflow?: unknown, restores?: boolean) => void)(id, edit, undefined, restoresProgress);
  return { saved: ref.current.find(item => item.id === id)!, sent };
}


describe('Review N1 M1 (caused by ada8ef6, Q25): a date David changes on the phone starts from the dates he sees', () => {
  it('Framing is shown on the master\'s dates and saved on the replaced lookahead\'s', () => {
    expect(dates(one(onWk2, 'Framing'))).toBe('10/15/2026-10/25/2026');
    expect(dates(saved(onWk2, framingId))).toBe('10/20/2026-10/30/2026');
  });

  it('only Finish changed: Start stays the day he saw, not the replaced lookahead\'s', () => {
    const edited = patch(onWk2, framingId, { finishDate: '10/27/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(one(edited, 'Framing'))).toBe('10/15/2026-10/27/2026');
    // The note says which date he changed and when; nothing else of it changes.
    const note = saved(edited, framingId).lookaheadOverlay!;
    expect(note.lookaheads.at(-1)).toMatchObject({ startDate: '10/20/2026', finishDate: '10/30/2026', dateByHand: { field: 'finishDate', at: '2026-09-22T12:00:00.000Z' } });
    expect([note.masterStartDate, note.masterFinishDate]).toEqual(['10/15/2026', '10/25/2026']);
    // App.tsx's own save, from its source, gives the same.
    const { saved: row } = savedAt('2026-09-22T12:00:00.000Z', () => phoneUpdate(onWk2, framingId, { finishDate: '10/27/2026' }));
    expect(dates(one({ ...onWk2, items: onWk2.items.map(item => item.id === framingId ? row : item) }, 'Framing'))).toBe('10/15/2026-10/27/2026');
    // His finish again later: still from the dates he sees.
    const again = patch(edited, framingId, { finishDate: '10/28/2026' }, '2026-09-23T12:00:00.000Z');
    expect(dates(one(again, 'Framing'))).toBe('10/15/2026-10/28/2026');
    // Then his start: both dates are his now, shown as saved.
    const both = patch(again, framingId, { startDate: '10/17/2026' }, '2026-09-24T12:00:00.000Z');
    expect(dates(one(both, 'Framing'))).toBe('10/17/2026-10/28/2026');
  });

  it('only Start changed: Finish stays the day he saw', () => {
    const edited = patch(onWk2, framingId, { startDate: '10/16/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(one(edited, 'Framing'))).toBe('10/16/2026-10/25/2026');
  });

  it('a Finish he sets before the replaced lookahead\'s start saves the start he saw: never a start after the finish', () => {
    const edited = patch(onWk2, framingId, { finishDate: '10/18/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(saved(edited, framingId))).toBe('10/15/2026-10/18/2026');
    expect(dates(one(edited, 'Framing'))).toBe('10/15/2026-10/18/2026');
    // A start he sets past the master's finish: shown as saved, never a start after the finish.
    const late = patch(onWk2, framingId, { startDate: '10/28/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(one(late, 'Framing'))).toBe('10/28/2026-10/30/2026');
  });

  it('a date he changes while the lookahead is in effect is a hand move, as before: both dates stay as he saw them, replaced or not', () => {
    const edited = patch(onWk1, framingId, { finishDate: '11/02/2026' }, '2026-09-15T12:00:00.000Z');
    expect(dates(one(edited, 'Framing'))).toBe('10/20/2026-11/02/2026');
    const replaced = approve(edited, WK2, ['Roof,Alpha,Lot,11/03/2026,11/07/2026,']);
    expect(dates(one(replaced, 'Framing'))).toBe('10/20/2026-11/02/2026');
    // His finish again after the lookahead was replaced: from the dates he sees, which are those.
    expect(dates(one(patch(replaced, framingId, { finishDate: '11/03/2026' }, '2026-09-22T12:00:00.000Z'), 'Framing'))).toBe('10/20/2026-11/03/2026');
    // Deleted with its items: dates he changed stay, as before.
    expect(dates(one(deleteWithItems(edited, WK1, '2026-09-16T12:00:00.000Z'), 'Framing'))).toBe('10/20/2026-11/02/2026');
  });

  it('a later lookahead that lists the task takes over, and the one after that leaves it on the master\'s dates: his old date does not come back', () => {
    const lists = ['Framing,Alpha,Lot,10/22/2026,11/03/2026,'];
    const drops = ['Roof,Alpha,Lot,11/04/2026,11/08/2026,'];
    // Changed while week 1 was in effect; week 2 lists Framing, week 3 does not.
    const inEffect = patch(onWk1, framingId, { finishDate: '11/02/2026' }, '2026-09-15T12:00:00.000Z');
    const relisted = approve(inEffect, WK2, lists);
    expect(dates(one(relisted, 'Framing'))).toBe('10/22/2026-11/03/2026');
    expect(dates(one(approve(relisted, WK3, drops), 'Framing'))).toBe('10/15/2026-10/25/2026');
    // Changed after week 2 replaced week 1; week 3 lists Framing, week 4 does not.
    const WK4 = schedule('LOOKAHEAD wk4', '2026-10-05T12:00:00.000Z', 'lookahead');
    const sinceReplaced = patch(onWk2, framingId, { finishDate: '10/27/2026' }, '2026-09-22T12:00:00.000Z');
    const relisted3 = approve(sinceReplaced, WK3, lists);
    expect(dates(one(relisted3, 'Framing'))).toBe('10/22/2026-11/03/2026');
    expect(dates(one(approve(relisted3, WK4, drops), 'Framing'))).toBe('10/15/2026-10/25/2026');
  });

  it('both dates changed, one to the replaced lookahead\'s own day: kept as he set them', () => {
    const edited = patch(onWk2, framingId, { startDate: '10/16/2026', finishDate: '10/30/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(one(edited, 'Framing'))).toBe('10/16/2026-10/30/2026');
  });

  it('the phone\'s date fields send the other date as shown, so the saved task is what he sees plus his change', () => {
    expect(APP_SOURCE).toContain('onChange={startDate => onUpdate({ startDate, finishDate: item.finishDate })}');
    expect(APP_SOURCE).toContain('onChange={finishDate => onUpdate({ finishDate, startDate: item.startDate })}');
    // What that saves: both dates as shown and changed, nothing noted; deleting the newest lookahead later leaves them.
    const shownFraming = one(onWk2, 'Framing');
    const edited = patch(onWk2, framingId, { finishDate: '10/27/2026', startDate: shownFraming.startDate }, '2026-09-22T12:00:00.000Z');
    expect(dates(saved(edited, framingId))).toBe('10/15/2026-10/27/2026');
    expect(saved(edited, framingId).lookaheadOverlay).toEqual(saved(onWk2, framingId).lookaheadOverlay);
    expect(dates(one(deleteWithItems(edited, WK2, '2026-09-23T12:00:00.000Z'), 'Framing'))).toBe('10/15/2026-10/27/2026');
    // On a task whose lookahead is in effect the other date sent is the saved one: only his date changes, nothing noted.
    const inEffect = patch(onWk1, framingId, { finishDate: '11/02/2026', startDate: one(onWk1, 'Framing').startDate }, '2026-09-15T12:00:00.000Z');
    expect(dates(saved(inEffect, framingId))).toBe('10/20/2026-11/02/2026');
    expect(saved(inEffect, framingId).lookaheadOverlay).toEqual(saved(onWk1, framingId).lookaheadOverlay);
  });

  it('one date alone set to the very day the replaced lookahead gave: still his change from the dates he sees', () => {
    // Shown 10/15 - 10/25, saved 10/20 - 10/30. He sets Finish to 10/30: the saved day, a change from what he sees.
    const edited = patch(onWk2, framingId, { finishDate: '10/30/2026' }, '2026-09-22T12:00:00.000Z');
    expect(dates(saved(edited, framingId))).toBe('10/20/2026-10/30/2026');
    expect(dates(one(edited, 'Framing'))).toBe('10/15/2026-10/30/2026');
    // The same day set while the lookahead was in effect changed nothing: the master's dates once it is replaced.
    const before = patch(onWk1, framingId, { finishDate: '10/30/2026' }, '2026-09-15T12:00:00.000Z');
    expect(dates(one(approve(before, WK2, ['Roof,Alpha,Lot,11/03/2026,11/07/2026,']), 'Framing'))).toBe('10/15/2026-10/25/2026');
  });
});

describe('Review N1 L1 (caused by ada8ef6, Q25): the shown copy\'s marker is never saved, by any writer', () => {
  const shownFraming = () => one(onWk2, 'Framing');
  const noMarker = (items: readonly unknown[]) => items.filter(item => 'savedLookaheadDates' in (item as object));
  it('the task shown carries the marker (shown only)', () => {
    expect(shownFraming().savedLookaheadDates).toEqual({ startDate: '10/20/2026', finishDate: '10/30/2026', shownStartDate: '10/15/2026', shownFinishDate: '10/25/2026' });
  });

  it('the phone: Confirm Completed and Not Complete pass the shown copy whole; the saved task keeps its saved dates, no marker', () => {
    const reported = { ...shownFraming(), completionVerification: { status: 'reported', priorScheduleStatus: 'Not Started', priorPercentComplete: 0, evidence: [], reportedAt: '2026-09-22T10:00:00.000Z', reportedBy: 'Field', claim: 'done' } } as unknown as ScheduleItem;
    for (const copy of [
      verifyScheduleItemCompletion(reported, { verifiedAt: '2026-09-22T12:00:00.000Z', verifiedBy: 'Project manager', note: '' }),
      rejectScheduleItemCompletion(reported, { rejectedAt: '2026-09-22T12:00:00.000Z', rejectedBy: 'Project manager', note: '' }),
    ]) {
      expect('savedLookaheadDates' in copy).toBe(true);
      const { saved: row, sent } = phoneUpdate(onWk2, framingId, copy as Partial<ScheduleItem>);
      expect(noMarker([row, ...sent])).toEqual([]);
      expect(dates(row)).toBe('10/20/2026-10/30/2026');
      // Still week 1's task: deleting the newest lookahead shows week 1's dates again.
      const after: State = { ...onWk2, items: onWk2.items.map(item => item.id === framingId ? row : item) };
      expect(dates(one(deleteWithItems(after, WK2, '2026-09-23T12:00:00.000Z'), 'Framing'))).toBe('10/20/2026-10/30/2026');
    }
  });

  it('the phone: a shown copy with dates David changed saves those dates, no marker', () => {
    const { saved: row, sent } = phoneUpdate(onWk2, framingId, { ...shownFraming(), finishDate: '10/27/2026' });
    expect(noMarker([row, ...sent])).toEqual([]);
    expect(dates(row)).toBe('10/15/2026-10/27/2026');
  });

  it('the phone: an approval, a lookahead\'s delete and Set Active given the tasks as shown save none', () => {
    const G = schedule('MASTER G', '2026-09-22T12:00:00.000Z');
    const merged = mergeApprovedScheduleImportItems({
      existing: shown(onWk2), imported: rows(G, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,50', 'Roof,Alpha,Lot,11/04/2026,11/08/2026,']),
      completionMatch: () => null, mergeCompletion: item => item, isCurrent: () => true, approvedAt: G.importedAt,
    });
    expect(noMarker([...merged.next.filter(item => !shown(onWk2).includes(item)), ...merged.additions])).toEqual([]);
    const documents = onWk2.documents.filter(document => document.id !== WK2.id);
    expect(noMarker(scheduleItemsAfterScheduleDeleted({ items: shown(onWk2), removed: [], document: WK2, documents, updatedAt: '2026-09-23T12:00:00.000Z' }))).toEqual([]);
    const onG = approve(onWk2, G, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,', 'Roof,Alpha,Lot,11/04/2026,11/08/2026,']);
    const backToF = scheduleDocumentsAfterActivation(onG.documents.find(document => document.id === F.id)!, onG.documents, 'project', '2026-09-24T12:00:00.000Z');
    expect(noMarker(scheduleProgressCarriedOnActivation({ items: onG.items, documentsBefore: onG.documents, documentsAfter: backToF, now: '2026-09-24T12:00:00.000Z' }))).toEqual([]);
    expect(noMarker(scheduleProgressCarriedToShownTasks({
      before: shown(onG), after: shown({ items: onG.items, documents: backToF }), documentsBefore: onG.documents, documentsAfter: backToF, now: '2026-09-24T12:00:00.000Z',
    }))).toEqual([]);
  });

  it('the web: every task write passes scheduleItemForCloud, which saves none (a save, Apply dates, an upload, a delete)', () => {
    const provider = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8');
    const writes = provider.match(/daveWebSupabaseGateway\.(?:create|update)AuthorizedScheduleItem\(\s*[^\n]*/g) || [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    writes.forEach(write => expect(write).toMatch(/scheduleItemForCloud\(item\)/));
    const webShown = shown(onWk2).map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: null })) as DAVEWebScheduleItem[];
    const framing = webShown.find(item => item.id === framingId)!;
    // Gantt "Apply dates": the shown copy with new dates.
    const applied = scheduleItemForCloud({ ...framing, startDate: '10/21/2026', finishDate: '10/31/2026' });
    expect(noMarker([applied])).toEqual([]);
    expect(dates(applied)).toBe('10/21/2026-10/31/2026');
    // The shown copy written whole with nothing changed: the saved dates, never the dates shown.
    expect(dates(scheduleItemForCloud(framing))).toBe('10/20/2026-10/30/2026');
    expect(noMarker([scheduleItemForCloud(framing)])).toEqual([]);
    const built = buildDAVEWebScheduleItem({
      draft: { projectId: 'alpha', itemType: 'Task', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026',
        milestone: '', owner: '', contractor: '', percentComplete: '40', priority: 'Medium', status: 'In Progress', notes: '', nextAction: '', activityMessage: '' },
      current: framing, id: framingId, now: '2026-09-22T15:00:00.000Z', actor: 'David',
    });
    expect(noMarker([scheduleItemForCloud(built)])).toEqual([]);
    const W = schedule('MASTER W', '2026-09-22T12:00:00.000Z');
    const upload = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown }, importedScheduleItems: rows(W, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,50']) });
    expect(noMarker([...upload.additions, ...upload.revisions.map(revision => revision.item)])).toEqual([]);
    const wk1 = { ...WK1, cloudUpdatedAt: null, linkedScheduleItems: webShown.filter(item => item.importBatchId === WK1.importBatchId) } as never;
    const removed = planDAVEWebScheduleDocumentDelete({
      snapshot: { scheduleItems: webShown, knownScheduleItems: onWk2.items.map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: null })) as DAVEWebScheduleItem[], referenceDocuments: onWk2.documents as never },
      document: wk1, updatedAt: '2026-09-23T12:00:00.000Z',
    });
    expect(noMarker(removed.map(revision => revision.item))).toEqual([]);
  });
});

describe('Review N1 M2 (caused by ada8ef6, Q25): a task only lookaheads listed comes back with his note and percent', () => {
  const FRAMING = 'Framing,Alpha,Lot,10/16/2026,10/26/2026,';
  const view = (state: State) => shown(state).filter(item => item.taskName === 'Inspection')
    .map(item => `${dates(item)} @${item.percentComplete} "${item.notes}"`);
  const wk1 = approve(onF, WK1, [FRAMING, 'Inspection,Alpha,Lot,10/20/2026,10/20/2026,']);
  const inspectionId = one(wk1, 'Inspection').id;
  const noted = patch(wk1, inspectionId, { notes: 'Call inspector Monday', percentComplete: 30 }, '2026-09-15T12:00:00.000Z');
  // Week 2 leaves it out: off the list (owner answer Q25), nothing deleted.
  const wk2 = approve(noted, WK2, [FRAMING]);

  it('left out of one lookahead, it is off the list', () => {
    expect(view(wk2)).toEqual([]);
    expect(saved(wk2, inspectionId).notes).toBe('Call inspector Monday');
  });

  it('listed again on other dates: the same task, on the new dates, with his note and percent', () => {
    const wk3 = approve(wk2, WK3, [FRAMING, 'Inspection,Alpha,Lot,10/27/2026,10/27/2026,']);
    expect(view(wk3)).toEqual(['10/27/2026-10/27/2026 @30 "Call inspector Monday"']);
    expect(one(wk3, 'Inspection').id).toBe(inspectionId);
    expect(wk3.items.filter(item => item.taskName === 'Inspection')).toHaveLength(1);
  });

  it('the returning file\'s percent stands only above his (Q22)', () => {
    expect(view(approve(wk2, WK3, [FRAMING, 'Inspection,Alpha,Lot,10/27/2026,10/27/2026,10']))).toEqual(['10/27/2026-10/27/2026 @30 "Call inspector Monday"']);
    expect(view(approve(wk2, WK3, [FRAMING, 'Inspection,Alpha,Lot,10/27/2026,10/27/2026,60']))).toEqual(['10/27/2026-10/27/2026 @60 "Call inspector Monday"']);
  });

  it('a master that lists it next keeps his note and percent too', () => {
    const G = schedule('MASTER G', '2026-09-28T12:00:00.000Z');
    const onG = approve(wk2, G, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', 'Roof,Alpha,Lot,11/02/2026,11/06/2026,', 'Inspection,Alpha,Lot,10/27/2026,10/27/2026,']);
    expect(view(onG)).toEqual(['10/27/2026-10/27/2026 @30 "Call inspector Monday"']);
  });

  it('two such tasks of the name off the list: the one nearest in days', () => {
    const second = approve(wk2, WK3, [FRAMING, 'Inspection,Alpha,Lot,11/10/2026,11/10/2026,']); // the first one, back
    const WK4 = schedule('LOOKAHEAD wk4', '2026-10-05T12:00:00.000Z', 'lookahead');
    const WK5 = schedule('LOOKAHEAD wk5', '2026-10-12T12:00:00.000Z', 'lookahead');
    // A second Inspection row saved by an older build's return (0%, no note), both off the list after week 4.
    const twoSaved: State = { ...second, items: [...second.items, { ...saved(second, inspectionId), id: 'older-return', startDate: '10/21/2026', finishDate: '10/21/2026', percentComplete: 0, notes: '', lookaheadOverlay: undefined } as ScheduleItem] };
    const off = approve(twoSaved, WK4, [FRAMING]);
    expect(view(off)).toEqual([]);
    const back = approve(off, WK5, [FRAMING, 'Inspection,Alpha,Lot,11/12/2026,11/12/2026,']);
    expect(view(back)).toEqual(['11/12/2026-11/12/2026 @30 "Call inspector Monday"']);
  });
});

describe('Review N1 web M1 (caused by ada8ef6, Q25): the web\'s delete of a replaced lookahead leaves the dates the phone\'s delete leaves', () => {
  const AT = '2026-09-22T12:00:00.000Z';
  const asWeb = (items: readonly ScheduleItem[]) => items.map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: '2026-09-21T12:00:00.000Z' })) as DAVEWebScheduleItem[];
  /** The web's Delete Document (Only) or Delete Document + Tasks: its plan's task writes, then the deletion records. */
  function webDelete(state: State, document: ReferenceDocument, keepTasks: boolean): State {
    const linked = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
    const revisions = planDAVEWebScheduleDocumentDelete({
      snapshot: { scheduleItems: asWeb(shown(state)), knownScheduleItems: asWeb(state.items), referenceDocuments: state.documents as never },
      document: { ...document, cloudUpdatedAt: '2026-09-21T12:00:00.000Z', linkedScheduleItems: asWeb(linked), lookaheadReplaced: 'Replaced by the lookahead of Sep 21, 2026' } as never,
      updatedAt: AT, keepTasks,
    });
    const written = new Map(revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
    const removedIds = new Set(keepTasks ? [] : linked.map(item => item.id));
    return {
      items: state.items.filter(item => !removedIds.has(item.id)).map(item => written.get(item.id) || item),
      documents: state.documents.filter(other => other.id !== document.id),
    };
  }

  it('week 1, replaced, moved Framing: shown on the master\'s dates, and the phone\'s Delete PDF + Items leaves them', () => {
    expect(dates(one(onWk2, 'Framing'))).toBe('10/15/2026-10/25/2026');
    expect(dates(one(deleteWithItems(onWk2, WK1, AT), 'Framing'))).toBe('10/15/2026-10/25/2026');
    // The file gone with no task written was the jump: the deleted lookahead's dates.
    expect(dates(one({ items: onWk2.items, documents: onWk2.documents.filter(document => document.id !== WK1.id) }, 'Framing'))).toBe('10/20/2026-10/30/2026');
  });

  it('"Delete Document Only" and "Delete Document + Tasks" both leave the master\'s dates', () => {
    for (const keepTasks of [true, false]) {
      const after = webDelete(onWk2, WK1, keepTasks);
      expect(dates(one(after, 'Framing'))).toBe('10/15/2026-10/25/2026');
      expect(dates(saved(after, framingId))).toBe('10/15/2026-10/25/2026');
      expect(named(after, 'Detail 1')).toEqual([]);
      expect(after.items.some(item => item.taskName === 'Detail 1')).toBe(keepTasks);
    }
  });

  it('"Delete Document Only" removes no task: a link to the lookahead\'s own task stays; "+ Tasks" drops it with the task', () => {
    const detailId = onWk2.items.find(item => item.taskName === 'Detail 1')!.id;
    const roofId = one(onWk2, 'Roof').id;
    const linked: State = { ...onWk2, items: onWk2.items.map(item => item.id === roofId
      ? { ...item, dependencies: [{ predecessorItemId: detailId, type: 'FS' as const, lagDays: 0 }], dependenciesUpdatedAt: '2026-09-21T13:00:00.000Z' } as ScheduleItem : item) };
    const links = (state: State) => (saved(state, roofId).dependencies || []).map(link => link.predecessorItemId);
    expect(links(webDelete(linked, WK1, true))).toEqual([detailId]);
    expect(links(webDelete(linked, WK1, false))).toEqual([]);
  });

  it('a replaced lookahead with no task of its own ("Delete Document"): the same', () => {
    const A1 = schedule('LOOKAHEAD a', '2026-09-14T12:00:00.000Z', 'lookahead');
    const A2 = schedule('LOOKAHEAD b', '2026-09-21T12:00:00.000Z', 'lookahead');
    const onA2 = approve(approve(onF, A1, ['Roof,Alpha,Lot,11/03/2026,11/07/2026,']), A2, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,']);
    expect(dates(one(onA2, 'Roof'))).toBe('11/02/2026-11/06/2026');
    expect(dates(one(webDelete(onA2, A1, true), 'Roof'))).toBe('11/02/2026-11/06/2026');
  });

  it('a master deleted without its tasks writes no task, as before', () => {
    const G = schedule('MASTER G', '2026-09-22T12:00:00.000Z');
    const onG = approve(onWk2, G, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,', 'Roof,Alpha,Lot,11/04/2026,11/08/2026,']);
    expect(planDAVEWebScheduleDocumentDelete({
      snapshot: { scheduleItems: asWeb(shown(onG)), knownScheduleItems: asWeb(onG.items), referenceDocuments: onG.documents as never },
      document: { ...F, isCurrent: false, cloudUpdatedAt: '2026-09-21T12:00:00.000Z', linkedScheduleItems: [] } as never, updatedAt: AT, keepTasks: true,
    })).toEqual([]);
  });

  it('the web plans it for a lookahead whichever button deletes it, and never makes a lookahead current', () => {
    const provider = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8');
    expect(provider).toContain('current && (deleteLinkedTasks || scheduleDocumentAddsToMaster(document))');
    expect(provider).toContain('planDAVEWebScheduleDocumentDelete({ snapshot: current, document, keepTasks: !deleteLinkedTasks })');
    const makeCurrent = provider.slice(provider.indexOf('const setCurrentSchedule = useCallback('));
    expect(makeCurrent.indexOf('if (scheduleDocumentAddsToMaster(document)) {')).toBeGreaterThan(0);
    expect(makeCurrent.indexOf('if (scheduleDocumentAddsToMaster(document)) {')).toBeLessThan(makeCurrent.indexOf('setAuthorizedCurrentSchedule'));
  });
});

describe('Review N1 L5 (older, owner answer Q30): a lookahead row as near to one same-named task as to another is asked about', () => {
  const M = schedule('MASTER M', '2026-09-07T12:00:00.000Z');
  const LA = schedule('LOOKAHEAD la', '2026-09-14T12:00:00.000Z', 'lookahead');
  const twins = approve(EMPTY, M, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', 'Framing,Alpha,Lot,11/02/2026,11/06/2026,']);
  const [first, second] = shown(twins).filter(item => item.taskName === 'Pour slab').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const questions = (lines: string[]) => scheduleImportPairingQuestions({
    existing: twins.items, imported: rows(LA, lines), overlay: true,
    isCurrent: scheduleItemsVisibleBeforeImport(twins.items, [...twins.documents, LA], LA.importBatchId || ''),
  });

  it('three days after the first and three before the second: asked, the guess a new task', () => {
    const asked = questions(['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,']);
    expect(asked).toHaveLength(1);
    expect(asked[0].title).toBe('2 tasks named Pour slab in Lot — confirm which is which');
    expect(asked[0].saved.map(item => item.id)).toEqual([first.id, second.id]);
    expect(Object.values(asked[0].guess)).toEqual([null]);
  });

  it('his answer decides: the second pour, moved a week earlier, with its percent', () => {
    const started = patch(twins, second.id, { percentComplete: 40 }, '2026-09-10T12:00:00.000Z');
    const row = rows(LA, ['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,'])[0];
    const chosen = approve(started, LA, ['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,'], { [row.id]: second.id });
    const pours = shown(chosen).filter(item => item.taskName === 'Pour slab').map(item => `${dates(item)} @${item.percentComplete}`).sort();
    expect(pours).toEqual(['10/05/2026-10/09/2026 @0', '10/12/2026-10/16/2026 @40']);
  });

  it('two rows as near to the one saved task of the name: asked too', () => {
    const single = approve(EMPTY, M, ['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,', 'Framing,Alpha,Lot,11/02/2026,11/06/2026,']);
    const asked = scheduleImportPairingQuestions({
      existing: single.items, imported: rows(LA, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,']), overlay: true,
      isCurrent: scheduleItemsVisibleBeforeImport(single.items, [...single.documents, LA], LA.importBatchId || ''),
    });
    expect(asked.map(question => question.title)).toEqual(['2 tasks named Pour slab in Lot — confirm which is which']);
    expect(Object.values(asked[0].guess)).toEqual([null, null]);
  });

  it('nearer to one of them: not asked, as before', () => {
    expect(questions(['Pour slab,Alpha,Lot,10/11/2026,10/15/2026,'])).toEqual([]);
    expect(questions(['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,'])).toEqual([]);
  });

  it('a master listing as many as are saved pairs them in order, unasked, as before; its one row tied between two is asked about', () => {
    const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
    const masterQuestions = (lines: string[]) => scheduleImportPairingQuestions({
      existing: twins.items, imported: rows(G, lines),
      isCurrent: scheduleItemsVisibleBeforeImport(twins.items, [...twins.documents, G], G.importBatchId || ''),
    });
    expect(masterQuestions(['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,'])).toEqual([]);
    const asked = masterQuestions(['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,']);
    expect(asked.map(question => question.title)).toEqual(['2 tasks named Pour slab in Lot — confirm which is which']);
    expect(Object.values(asked[0].guess)).toEqual([null]);
  });
});

describe('Review N1 (the gap owner answer Q30 left): the web\'s upload review asks which same-named task is which', () => {
  const M = schedule('MASTER M', '2026-09-07T12:00:00.000Z');
  const W = schedule('MASTER W', '2026-09-14T12:00:00.000Z');
  const base = approve(EMPTY, M, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,', 'Framing,Alpha,Lot,10/26/2026,10/30/2026,']);
  const [first, second] = shown(base).filter(item => item.taskName === 'Pour slab').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const started = patch(base, first.id, { percentComplete: 80, notes: 'Forms stripped' }, '2026-09-10T12:00:00.000Z');
  const snapshot = { scheduleItems: shown(started).map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: null })) as DAVEWebScheduleItem[] };
  // Every date a week later, or the first pour dropped and a new one added: the dates alone cannot say.
  const slipped = rows(W, ['Pour slab,Alpha,Lot,10/12/2026,10/16/2026,', 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,', 'Framing,Alpha,Lot,10/26/2026,10/30/2026,']);

  it('asks, with the saved tasks beside the rows and the best guess', () => {
    const asked = daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: slipped });
    expect(asked.map(question => question.title)).toEqual(['2 tasks named Pour slab in Lot — confirm which is which']);
    expect(asked[0].saved.map(item => item.id)).toEqual([first.id, second.id]);
    expect(asked[0].guess).toEqual({ [slipped[0].id]: first.id, [slipped[1].id]: second.id });
    // Nothing to ask when the rows are on the saved days, or with no schedule read yet.
    expect(daveWebScheduleImportPairingQuestions({ snapshot, importedScheduleItems: rows(W, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,']) })).toEqual([]);
    expect(daveWebScheduleImportPairingQuestions({ snapshot: null, importedScheduleItems: slipped })).toEqual([]);
  });

  it('his answer decides the upload\'s pairing: his percent and note go with the task he chose', () => {
    const view = (choices: Record<string, string | null>) => {
      const plan = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: slipped, pairingChoices: choices });
      return {
        added: plan.additions.filter(item => item.taskName === 'Pour slab')
          .map(item => `${item.startDate} @${item.percentComplete} "${item.notes}" after ${(item.revisedFromTaskIds || []).join(',') || 'nothing'}`),
        restated: plan.revisions.filter(revision => revision.item.taskName === 'Pour slab').map(revision => revision.item.id),
      };
    };
    // "Every date slipped a week": each row is its pour on new dates, the first with his 80% and note.
    expect(view({ [slipped[0].id]: first.id, [slipped[1].id]: second.id })).toEqual({
      added: [`10/12/2026 @80 "Forms stripped" after ${first.id}`, `10/19/2026 @0 "" after ${second.id}`], restated: [],
    });
    // "The first was dropped and a new one added": the first row is the second pour where it was, the other is new.
    expect(view({ [slipped[0].id]: second.id, [slipped[1].id]: null })).toEqual({
      added: ['10/19/2026 @0 "" after nothing'], restated: [second.id],
    });
  });

  it('the web\'s review shows the check, waits for his confirmation, and sends his answers with the upload', () => {
    const shell = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    expect(shell).toContain('daveWebScheduleImportPairingQuestions({ snapshot: auth.snapshot, importedScheduleItems: preparedUpload.scheduleItems })');
    expect(shell).toContain('<ScheduleImportPairingCheck');
    const upload = shell.slice(shell.indexOf('async function uploadPreparedDocument()'));
    const refusal = upload.indexOf('const pairingRefusal = scheduleImportPairingRefusal(pairingQuestions, pairingAnswerOf);');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(upload.indexOf('setUploading(true);'));
    // Refused while a question is unconfirmed: the notice, and nothing uploads.
    expect(upload.slice(refusal, upload.indexOf('setUploading(true);')).replace(/\s+/g, ' '))
      .toContain("if (pairingRefusal) { setNotice({ tone: 'danger', text: pairingRefusal.replace('before saving', 'before uploading') }); return; }");
    expect(upload).toContain('let reviewedUpload = withScheduleImportPairingChoices(preparedUpload, pairingQuestions, pairingAnswerOf);');
    const provider = fs.readFileSync(path.resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8');
    expect(provider).toContain('importedScheduleItems: prepared.scheduleItems, pairingChoices: prepared.pairingChoices');
  });
});

describe('Review N1 (caused by ada8ef6, Q25; web M1 on the phone): "Delete PDF Only" on a replaced lookahead leaves the dates shown', () => {
  /** App.tsx's "Delete PDF Only": the dates shown are saved first (the helper, through updateScheduleItem), then the file goes. */
  function deletePdfOnly(state: State, document: ReferenceDocument): State {
    let items = state.items;
    scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true }).forEach(shownTask => {
      const { saved: row } = phoneUpdate({ ...state, items }, shownTask.id, { startDate: shownTask.startDate, finishDate: shownTask.finishDate });
      items = items.map(item => item.id === shownTask.id ? row : item);
    });
    return { items, documents: state.documents.filter(other => other.id !== document.id) };
  }

  it('week 1, replaced, moved Framing: shown on the master\'s dates before and after its file is deleted alone', () => {
    expect(dates(one(onWk2, 'Framing'))).toBe('10/15/2026-10/25/2026');
    const after = deletePdfOnly(onWk2, WK1);
    expect(after.documents.map(document => document.id)).toEqual(['MASTER F', 'LOOKAHEAD wk2']);
    expect(dates(one(after, 'Framing'))).toBe('10/15/2026-10/25/2026');
    expect(one(after, 'Framing').savedLookaheadDates).toBeUndefined();
    // Saved, so the iPad and the web show the same once they hold the row.
    expect(dates(saved(after, framingId))).toBe('10/15/2026-10/25/2026');
    // Its detail task stays off the list, and week 2's tasks are untouched.
    expect(named(after, 'Detail 1')).toHaveLength(0);
    expect(dates(one(after, 'Roof'))).toBe('11/03/2026-11/07/2026');
  });

  it('a lookahead still in effect deleted alone keeps its tasks on its dates, as before; a master writes none', () => {
    expect(scheduleDatesShownUnderReplacedLookahead(onWk2.items, onWk2.documents, WK2)).toEqual([]);
    expect(scheduleDatesShownUnderReplacedLookahead(onWk2.items, onWk2.documents, F)).toEqual([]);
    expect(scheduleItemsAfterScheduleDeleted({ items: onWk2.items, removed: [], document: WK2, documents: onWk2.documents, fileOnly: true })).toEqual([]);
    expect(scheduleDatesShownUnderReplacedLookahead(onWk2.items, onWk2.documents, WK1)).toEqual([{ id: framingId, startDate: '10/15/2026', finishDate: '10/25/2026' }]);
    const after = deletePdfOnly(onWk2, WK2);
    expect(dates(one(after, 'Roof'))).toBe('11/03/2026-11/07/2026');
  });

  it('the phone\'s Delete PDF Only saves them before it removes the file', () => {
    const from = APP_SOURCE.indexOf("text: 'Delete PDF Only'");
    const handler = APP_SOURCE.slice(from, APP_SOURCE.indexOf("text: 'Delete PDF + Items'", from));
    const saves = handler.indexOf('fileOnly: true }).forEach(item => updateScheduleItem(item.id, { startDate: item.startDate, finishDate: item.finishDate }))');
    expect(saves).toBeGreaterThan(0);
    expect(saves).toBeLessThan(handler.indexOf('removeReferenceDocumentEverywhere('));
  });
});

describe('Review N1 (older; shown by ada8ef6, Q25): Talk\'s Undo keeps the lookahead note the task has', () => {
  // The phone had not heard of week 1 when David used Talk: its copy of Framing had no lookahead note.
  const stale = saved(onF, framingId);
  const before = scheduleProgressUndoPoint(stale);
  // Talk's 30% uploaded: the phone's row came back as the cloud's, on week 1's dates with its note.
  const talked = patch(onWk1, framingId, { percentComplete: 30 }, '2026-09-15T12:00:00.000Z');
  const written = scheduleProgressUndoPoint(saved(talked, framingId));
  const note = saved(onWk1, framingId).lookaheadOverlay;

  it('the task holds week 1\'s note when he taps Undo; the phone\'s copy before Talk had none', () => {
    expect(before.lookaheadOverlay).toBeUndefined();
    expect(note?.lookaheads.map(entry => entry.batchId)).toEqual([WK1.importBatchId]);
    expect(saved(talked, framingId).lookaheadOverlay).toEqual(note);
  });

  it('Undo gives the percent back and leaves the note: saved and sent with it', () => {
    const undo = scheduleTalkUndo(talked.items, { id: framingId, taskName: 'Framing' }, before, written, '2026-09-15T12:00:30.000Z');
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect('lookaheadOverlay' in undo.edit).toBe(false);
    const { saved: row, sent } = phoneUpdate(talked, undo.taskId, undo.edit, true);
    expect(row.percentComplete).toBe(0);
    expect(row.lookaheadOverlay).toEqual(note);
    expect(sent).toHaveLength(1);
    expect(sent[0].lookaheadOverlay).toEqual(note);
    // Week 2 replaces week 1: the task goes back to the master's dates, which only the note keeps.
    const undone: State = { ...talked, items: talked.items.map(item => item.id === framingId ? row : item) };
    const next = approve(undone, WK2, ['Roof,Alpha,Lot,11/03/2026,11/07/2026,']);
    expect(dates(one(next, 'Framing'))).toBe('10/15/2026-10/25/2026');
  });

  it('the row Talk changed with its note unchanged keeps it too, as before', () => {
    const point = scheduleProgressUndoPoint(saved(onWk1, framingId));
    const undo = scheduleTalkUndo(talked.items, { id: framingId, taskName: 'Framing' }, point, written, '2026-09-15T12:00:30.000Z');
    expect(undo.ok && phoneUpdate(talked, framingId, undo.edit, true).saved.lookaheadOverlay).toEqual(note);
  });
});

describe('Review N1 (caused by 74940c6, the two-device rule of Q25): the master\'s word when masters not current disagree', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;
  const doc = (id: string, day: number, extra: Partial<ReferenceDocument> = {}) =>
    ({ ...schedule(id, at(day), id.startsWith('LOOK') ? 'lookahead' : undefined), ...extra }) as ReferenceDocument;
  const row = (id: string, source: ReferenceDocument, start: string, finish: string, extra: Partial<ScheduleItem> = {}) => ({
    id, taskName: 'Roof', projectName: 'Alpha', locationName: 'Lot', startDate: start, finishDate: finish, percentComplete: 0,
    status: 'Not Started', priority: 'Medium', owner: '', contractor: '', milestone: '', notes: '', createdAt: source.importedAt,
    importedAt: source.importedAt, importBatchId: source.importBatchId, sourceDocumentId: source.id, ...extra,
  }) as ScheduleItem;
  type Entry = NonNullable<ScheduleItem['lookaheadOverlay']>['lookaheads'][number];
  const noted = (masterStart: string, masterFinish: string, entries: Entry[], also: ReferenceDocument[] = []) => ({
    alsoImportedInBatchIds: [...entries.map(entry => entry.batchId), ...also.map(document => document.importBatchId!)],
    lookaheadOverlay: { masterStartDate: masterStart, masterFinishDate: masterFinish, masterPercentComplete: 0, lookaheads: entries },
  }) as Partial<ScheduleItem>;
  const entry = (lookahead: ReferenceDocument, start: string, finish: string, extra: Partial<Entry> = {}): Entry =>
    ({ batchId: lookahead.importBatchId!, startDate: start, finishDate: finish, percentComplete: null, ...extra });
  const roofDates = (items: ScheduleItem[], documents: ReferenceDocument[]) => dates(one({ items, documents }, 'Roof'));
  const MF = doc('MASTER F', 1);
  const LA = doc('LOOKAHEAD A', 8);
  const LB = doc('LOOKAHEAD B', 15); // the newest: it lists another task, so it replaces LA (and LC)

  it('seed 982114: a master on the lookahead\'s dates, then a newer master on other dates: the newer one\'s', () => {
    // LA moved F's Roof to 11/03. The phone's master P (not current now) restated 11/03 on its own row; the iPad's
    // master I, newer, says 11/04. One device that had heard all three shows I's dates; so do two that had not.
    const P = doc('MASTER P', 10, { isCurrent: false });
    const I = doc('MASTER I', 12, { isCurrent: false });
    const items = [
      row('F-2', MF, '11/03/2026', '11/07/2026', noted('11/02/2026', '11/06/2026', [entry(LA, '11/03/2026', '11/07/2026')])),
      row('P-2', P, '11/03/2026', '11/07/2026', { revisedFromTaskIds: ['F-2'] }),
      row('I-2', I, '11/04/2026', '11/08/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [MF, P, I, LA, LB])).toBe('11/04/2026-11/08/2026');
    // With no newer master, the restatement keeps the dates, as before.
    expect(roofDates(items.slice(0, 2), [MF, P, LA, LB])).toBe('11/03/2026-11/07/2026');
  });

  it('seed 982544: the current master restated the lookahead\'s dates on the task (its note says so): they stay', () => {
    // The web's master W, made current, restated F's Roof in place on the dates LA gave; the phone's master G, newer
    // and not current, says 11/04. The task's note keeps the current master's dates.
    const W = doc('MASTER W', 10, { webFileFingerprint: 'w'.repeat(64) });
    const G = doc('MASTER G', 12, { isCurrent: false });
    const items = [
      row('F-2', MF, '11/03/2026', '11/07/2026',
        noted('11/03/2026', '11/07/2026', [entry(LA, '11/03/2026', '11/07/2026', { datesReplacedByMaster: W.importBatchId! })], [W])),
      row('G-2', G, '11/04/2026', '11/08/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [{ ...MF, isCurrent: false }, W, G, LA, LB])).toBe('11/03/2026-11/07/2026');
    // Restated by a master that is not current: the newest master's word, as before.
    expect(roofDates(items, [MF, { ...W, isCurrent: false }, G, LA, LB])).toBe('11/04/2026-11/08/2026');
  });

  it('seed 1300083: ...or a master before the current one did, and the current master holds the task on those dates', () => {
    // The iPad's master P restated the lookahead's 11/05 on F's Roof; the web's master W, made current, lists it on
    // 11/05 too (it holds the row). G, newer and not current, says 11/08.
    const P = doc('MASTER P', 10, { isCurrent: false });
    const W = doc('MASTER W', 12, { webFileFingerprint: 'w'.repeat(64) });
    const G = doc('MASTER G', 14, { isCurrent: false });
    const items = [
      row('F-2', MF, '11/05/2026', '11/09/2026',
        noted('11/05/2026', '11/09/2026', [entry(LA, '11/05/2026', '11/09/2026', { datesReplacedByMaster: P.importBatchId! })], [P, W])),
      row('G-2', G, '11/08/2026', '11/12/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [{ ...MF, isCurrent: false }, P, W, G, LA, LB])).toBe('11/05/2026-11/09/2026');
    // A master newer than the current one restated them: the newest master's word, as before.
    const later = [{ ...items[0], ...noted('11/05/2026', '11/09/2026',
      [entry(LA, '11/05/2026', '11/09/2026', { datesReplacedByMaster: 'batch-MASTER P2' })], [W]),
      alsoImportedInBatchIds: [LA.importBatchId!, W.importBatchId!, 'batch-MASTER P2'] }, items[1]];
    expect(roofDates(later, [{ ...MF, isCurrent: false }, doc('MASTER P2', 13, { isCurrent: false }), W, G, LA, LB])).toBe('11/08/2026-11/12/2026');
    // The current master does not hold the task (it lists no Roof; the replaced lookahead keeps the task shown): it
    // said nothing of it, so the newest master's word, as before.
    const C = doc('MASTER C', 15);
    const unheld = [{ ...items[0], alsoImportedInBatchIds: [LA.importBatchId!, P.importBatchId!] }, items[1]];
    expect(roofDates(unheld, [{ ...MF, isCurrent: false }, P, G, C, LA, doc('LOOKAHEAD B', 16)])).toBe('11/08/2026-11/12/2026');
  });

  it('seed 982131: ...but not when the task\'s note missed a later lookahead that holds it: the newest master\'s word', () => {
    // As 982544, on a copy whose note was merged without LC's entry (LC holds the task: its batch is on the row). The
    // phone's master G, newer than LC, said 11/04 on its own row; one device that had heard all of it shows G's dates.
    const W = doc('MASTER W', 10, { webFileFingerprint: 'w'.repeat(64) });
    const LC = doc('LOOKAHEAD C', 11);
    const G = doc('MASTER G', 12, { isCurrent: false });
    const items = [
      row('F-2', MF, '11/03/2026', '11/07/2026', { ...noted('11/03/2026', '11/07/2026',
        [entry(LA, '11/03/2026', '11/07/2026', { datesReplacedByMaster: W.importBatchId! })], [W]),
        alsoImportedInBatchIds: [LA.importBatchId!, W.importBatchId!, LC.importBatchId!] }),
      row('G-2', G, '11/04/2026', '11/08/2026', { revisedFromTaskIds: ['F-2'] }),
    ];
    expect(roofDates(items, [{ ...MF, isCurrent: false }, W, G, LA, LC, LB])).toBe('11/04/2026-11/08/2026');
  });

  it('M1 with two devices: a date he changed alone after the lookahead was replaced stands beside the newest master\'s other date', () => {
    // LA moved F's Roof to 11/07 - 11/11; G, a newer master, says 11/05 - 11/09 on its own row; LB replaced LA.
    const G = doc('MASTER G', 12, { isCurrent: false });
    const task = (handAt: string) => row('F-2', MF, '11/07/2026', '11/12/2026', noted('11/02/2026', '11/06/2026',
      [entry(LA, '11/07/2026', '11/11/2026', { dateByHand: { field: 'finishDate', at: handAt } })]));
    const gRow = row('G-2', G, '11/05/2026', '11/09/2026', { revisedFromTaskIds: ['F-2'] });
    // Finish changed on day 16, after LB (day 15): he saw G's dates, so G's start and his finish.
    expect(roofDates([task(at(16)), gRow], [MF, G, LA, LB])).toBe('11/05/2026-11/12/2026');
    // Changed on day 10, while LA was in effect: a hand move, as saved.
    expect(roofDates([task(at(10)), gRow], [MF, G, LA, LB])).toBe('11/07/2026-11/12/2026');
  });

  it('seed 1303494: a newer master\'s row put back on the lookahead\'s dates speaks by its note, not by the dates it is on', () => {
    // LA moved F's Roof to 11/03. The phone's master P (offline, not current) said 11/04 on its own row; a Set Active
    // then put that row back on the lookahead's 11/03, its note keeping P's 11/04. That row is not a restatement.
    const P = doc('MASTER P', 10, { isCurrent: false });
    const items = [
      row('F-2', MF, '11/03/2026', '11/07/2026', noted('11/02/2026', '11/06/2026', [entry(LA, '11/03/2026', '11/07/2026')])),
      row('P-2', P, '11/03/2026', '11/07/2026', { revisedFromTaskIds: ['F-2'],
        ...noted('11/04/2026', '11/08/2026', [entry(LA, '11/03/2026', '11/07/2026', { datesReplacedByMaster: P.importBatchId! })]),
        alsoImportedInBatchIds: [] }),
    ];
    expect(roofDates(items, [MF, P, LA, LB])).toBe('11/04/2026-11/08/2026');
  });

  it('seed 982723: a web master saved between two lookaheads, on the dates the first gave: the master\'s word', () => {
    // LA moved Roof to 11/03; the web's master W (not made current), which had not seen LA, said 11/03 on its own row;
    // LC then moved it to 11/09. One device that had heard LA first took W's dates as the master's in the task's note.
    const W = doc('MASTER W', 10, { isCurrent: false, webFileFingerprint: 'w'.repeat(64) });
    const LC = doc('LOOKAHEAD C', 12);
    const task = row('F-2', MF, '11/09/2026', '11/13/2026',
      noted('11/02/2026', '11/06/2026', [entry(LA, '11/03/2026', '11/07/2026'), entry(LC, '11/09/2026', '11/13/2026')]));
    const documents = [MF, W, LA, LC, LB];
    expect(roofDates([task, row('W-2', W, '11/03/2026', '11/07/2026', { revisedFromTaskIds: ['F-2'] })], documents)).toBe('11/03/2026-11/07/2026');
    // On other dates it is not the master's word (a web upload not made current), as before.
    expect(roofDates([task, row('W-2', W, '11/05/2026', '11/09/2026', { revisedFromTaskIds: ['F-2'] })], documents)).toBe('11/02/2026-11/06/2026');
    // Nor on the dates of a lookahead approved after it.
    expect(roofDates([task, row('W-2', W, '11/09/2026', '11/13/2026', { revisedFromTaskIds: ['F-2'] })], [MF, { ...W, importedAt: at(9) }, LA, LC, LB]))
      .toBe('11/02/2026-11/06/2026');
  });

  it('seed 1321728: ...but not over a newer master whose own row took the task and its note over', () => {
    // LA moved F's Roof to 11/03 and the web's master W (not current) restated it there. The iPad's master G, newer and
    // current, moved the task to its own row on 11/05, keeping the note's entries; LC then moved it to 11/09.
    const W = doc('MASTER W', 10, { isCurrent: false, webFileFingerprint: 'w'.repeat(64) });
    const G = doc('MASTER G', 11);
    const LC = doc('LOOKAHEAD C', 12);
    const items = [
      row('F-2', MF, '11/03/2026', '11/07/2026',
        noted('11/03/2026', '11/07/2026', [entry(LA, '11/03/2026', '11/07/2026', { datesReplacedByMaster: W.importBatchId! })], [W])),
      row('G-2', G, '11/09/2026', '11/13/2026', { revisedFromTaskIds: ['F-2'], ...noted('11/05/2026', '11/09/2026',
        [entry(LA, '11/03/2026', '11/07/2026', { datesReplacedByMaster: W.importBatchId! }), entry(LC, '11/09/2026', '11/13/2026')]),
        alsoImportedInBatchIds: [LC.importBatchId!] }),
    ];
    expect(roofDates(items, [{ ...MF, isCurrent: false }, W, G, LA, LC, LB])).toBe('11/05/2026-11/09/2026');
  });
});
