/**
 * Audit round 2, A10 pass 8 L2 (30 Sep 2026): Talk's Undo after Make Current
 * back to the old master always refused.
 *
 * Master 0930 moved Roofing: its new row answers to master 0831's row
 * (revisedFromTaskIds). David made 0831 current again, so the old row is the
 * one shown and the new row is hidden. Talk took the shown Roofing from the
 * file's 30% to 50%, and David tapped Undo. Undo looked for the task "as it
 * is now" through the earlier ids first, found the hidden newer row, which
 * does not hold what Talk wrote, and said "Roofing changed since Talk updated
 * it, so it was not undone."
 *
 * Now Undo checks the row Talk changed first: while that row is shown it
 * decides (undone when it still holds what Talk wrote). Only when it is no
 * longer shown (a master moved the task while the alert was open, A10 pass 6
 * L4) does Undo follow the earlier ids to the newer row. These tests run
 * App.tsx's own updateScheduleItem and confirmTalkTaskAction, compiled.
 * Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import * as progressSource from '../../services/ScheduleProgressSource';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function slice(from: string, to: string) {
  const start = app.indexOf(from) + 1;
  const end = app.indexOf(to, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

const MASTER_AT = '2026-09-30T08:00:00.000Z';
const TALK_AT = '2026-09-30T15:00:00.000Z';
const UNDO_AT = '2026-09-30T15:00:05.000Z';
const NOT_UNDONE = 'Roofing changed since Talk updated it, so it was not undone.';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const OLD = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const NEW = schedule('MASTER 0930', MASTER_AT);

/** App.tsx's task update and Talk's confirm, compiled, over the saved tasks and schedules. */
function phoneWith(items: ScheduleItem[], documents: ReferenceDocument[]) {
  const ref = { current: items };
  const documentsRef = { current: documents };
  const alerts: Array<{ title: string; message: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const state = { talkTaskAction: null as unknown };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref,
    referenceDocumentsCurrentRef: documentsRef,
    selectAuthoritativeScheduleItems,
    withProjectControlsEditMerged: (_current: ScheduleItem, next: Partial<ScheduleItem>) => next,
    reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }),
    displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: () => 1,
    markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: () => undefined,
    scheduleItemChangeUsesDebouncedSync: () => false,
    cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: () => Promise.resolve(true),
    Alert: { alert: (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => alerts.push({ title, message, buttons }) },
    setTalkTaskAction: (value: unknown) => { state.talkTaskAction = value; },
    ...progressSource,
  };
  const source = [
    slice('\n  function updateScheduleItem(', '\n  async function saveScheduleItemChanges('),
    slice('\n  function confirmTalkTaskAction(', '\n  const ecosProjectQuestion ='),
  ].join('\n');
  const js = ts.transpileModule(
    `module.exports = (getTalkTaskAction) => { ${source}\n return { updateScheduleItem, confirmTalkTaskAction }; };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText.replace(/\btalkTaskAction\b/g, 'getTalkTaskAction()');
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  const phone = (mod.exports as (get: () => unknown) => { confirmTalkTaskAction: () => void })(() => state.talkTaskAction);
  return {
    ref,
    documentsRef,
    alerts,
    shown: () => selectAuthoritativeScheduleItems({ scheduleItems: ref.current, scheduleDocuments: documentsRef.current }) as ScheduleItem[],
    talk(taskId: string, percent: number) {
      jest.setSystemTime(new Date(TALK_AT));
      const task = ref.current.find(item => item.id === taskId)!;
      state.talkTaskAction = {
        projectName: 'Alpha',
        command: { changes: { percentComplete: percent }, changeSummary: `set to ${percent}%` },
        candidates: [task],
        selectedTaskId: task.id,
      };
      phone.confirmTalkTaskAction();
    },
    undo() {
      jest.setSystemTime(new Date(UNDO_AT));
      alerts.find(alert => alert.title === 'Task updated')!.buttons!.find(button => button.text === 'Undo')!.onPress!();
    },
  };
}

const roofing: ScheduleItem = {
  id: 'MASTER 0831-2', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Roofing',
  startDate: '12/01/2026', finishDate: '12/15/2026', milestone: '', owner: '', contractor: '', percentComplete: 30,
  status: 'In Progress', priority: 'Medium', notes: '', importBatchId: OLD.importBatchId, sourceDocumentId: OLD.id,
  importedAt: OLD.importedAt, createdAt: OLD.importedAt,
};
/** Master 0930 moves Roofing by a day at 30%: a new row answering to the old one. */
function moved(items: ScheduleItem[]): ScheduleItem[] {
  const row = {
    ...roofing, id: 'MASTER 0930-2', importBatchId: NEW.importBatchId, sourceDocumentId: NEW.id,
    importedAt: MASTER_AT, createdAt: MASTER_AT, startDate: '12/02/2026', finishDate: '12/16/2026',
  };
  const merged = mergeApprovedScheduleImportItems({
    existing: items, imported: [row], completionMatch: () => null, mergeCompletion: item => item, approvedAt: MASTER_AT,
  });
  return [...merged.additions, ...merged.next];
}

describe('A10 p8 L2: Talk\'s Undo after Make Current back to the old master', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the old row is shown, the newer hidden row answers to it; Undo gives back the file\'s 30% on the row Talk changed', () => {
    const items = moved([roofing]);
    const newer = items.find(item => item.id !== roofing.id)!;
    expect(newer.revisedFromTaskIds).toEqual([roofing.id]);
    // Make Current back to master 0831.
    const phone = phoneWith(items, scheduleDocumentsAfterActivation(OLD, [OLD, NEW], 'project'));
    expect(phone.shown().map(item => item.id)).toEqual([roofing.id]);

    phone.talk(roofing.id, 50);
    expect(phone.ref.current.find(item => item.id === roofing.id)).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David' });
    phone.undo();
    expect(phone.alerts.map(alert => alert.title)).toEqual(['Task updated']);
    expect(phone.ref.current.find(item => item.id === roofing.id))
      .toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT });
    // The hidden newer row is left as it was.
    expect(phone.ref.current.find(item => item.id === newer.id)).toEqual(newer);
  });

  it('the row Talk changed, still shown but changed since: Undo refuses and leaves it', () => {
    const items = moved([roofing]);
    const phone = phoneWith(items, scheduleDocumentsAfterActivation(OLD, [OLD, NEW], 'project'));
    phone.talk(roofing.id, 50);
    phone.ref.current = phone.ref.current.map(item => item.id === roofing.id ? { ...item, percentComplete: 60, progressConfirmedAt: '2026-09-30T15:00:03.000Z' } : item);
    phone.undo();
    expect(phone.alerts.at(-1)).toMatchObject({ title: 'Not undone', message: NOT_UNDONE });
    expect(phone.ref.current.find(item => item.id === roofing.id)).toMatchObject({ percentComplete: 60 });
  });

  it('as before: a master moving Roofing while the alert is open (the row Talk changed is no longer shown) lands on the new row', () => {
    const phone = phoneWith([roofing], [OLD]);
    phone.talk(roofing.id, 50);
    phone.ref.current = moved(phone.ref.current);
    phone.documentsRef.current = [OLD, NEW];
    const newer = phone.ref.current.find(item => item.id !== roofing.id)!;
    expect(phone.shown().map(item => item.id)).toEqual([newer.id]);
    expect(newer).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David' });
    phone.undo();
    expect(phone.ref.current.find(item => item.id === newer.id)).toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update' });
    expect(phone.ref.current.find(item => item.id === roofing.id)).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David' });
  });
});
