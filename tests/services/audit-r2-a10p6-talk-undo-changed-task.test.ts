/**
 * Audit round 2, A10 pass 6 L4 (30 Sep 2026): Talk's Undo put back the old
 * progress blindly when the task changed while the alert was open.
 *
 * Talk took Roofing from the file's 30% to 50%. Before David tapped Undo, a
 * master restated Roofing in place at 70%: Undo put back 30% over the
 * master's 70%. Or a master moved Roofing: the new row, shown, carried Talk's
 * 50%, and Undo landed on the hidden old row, so the task shown kept Talk's
 * 50%.
 *
 * Now Undo finds the task as it is now (the row a new master moved it to, by
 * its earlier ids) and gives back the old progress only when that task still
 * holds what Talk wrote; otherwise it says "Roofing changed since Talk
 * updated it, so it was not undone." These tests run App.tsx's own
 * updateScheduleItem and confirmTalkTaskAction, compiled. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ScheduleItem } from '../../types';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import * as progressSource from '../../services/ScheduleProgressSource';
import { schedulesOfSavedTasks } from '../fixtures/saved-schedules';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';

const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function slice(from: string, to: string) {
  const start = app.indexOf(from) + 1;
  const end = app.indexOf(to, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

const TALK_AT = '2026-09-30T15:00:00.000Z';
const MASTER_AT = '2026-09-30T15:00:02.000Z';
const UNDO_AT = '2026-09-30T15:00:05.000Z';

/** App.tsx's task update and Talk's confirm, compiled, over the saved tasks. */
function phoneWith(items: ScheduleItem[]) {
  const ref = { current: items };
  const alerts: Array<{ title: string; message: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const state = { talkTaskAction: null as unknown };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref,
    // Pin changed deliberately (A10 pass 8 L2, 30 Sep 2026): Undo asks which tasks are shown now, from the
    // schedules saved, so the compiled confirm needs them; one current schedule per import, the newest shown.
    referenceDocumentsCurrentRef: { get current() { return schedulesOfSavedTasks(ref.current); } },
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
    alerts,
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
  status: 'In Progress', priority: 'Medium', notes: '', importBatchId: 'batch-MASTER 0831', sourceDocumentId: 'MASTER 0831',
  importedAt: '2026-08-31T12:00:00.000Z', createdAt: '2026-08-31T12:00:00.000Z',
};
/** A new master approved while the alert is open, stating Roofing at `percent` on the given dates. */
function master(items: ScheduleItem[], percent: number, startDate = roofing.startDate, finishDate = roofing.finishDate): ScheduleItem[] {
  const row = {
    ...roofing, id: 'MASTER 0930-2', importBatchId: 'batch-MASTER 0930', sourceDocumentId: 'MASTER 0930',
    importedAt: MASTER_AT, createdAt: MASTER_AT, percentComplete: percent, startDate, finishDate,
  };
  const merged = mergeApprovedScheduleImportItems({
    existing: items, imported: [row], completionMatch: () => null, mergeCompletion: item => item, approvedAt: MASTER_AT,
  });
  return [...merged.additions, ...merged.next];
}
const NOT_UNDONE = 'Roofing changed since Talk updated it, so it was not undone.';

describe('A10 p6 L4: Undo gives back the old progress only over what Talk wrote', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a master restating Roofing in place at 70% while the alert is open: Undo leaves 70% and says why', () => {
    const phone = phoneWith([roofing]);
    phone.talk(roofing.id, 50);
    phone.ref.current = master(phone.ref.current, 70);
    expect(phone.ref.current).toHaveLength(1);
    expect(phone.ref.current[0]).toMatchObject({ id: roofing.id, percentComplete: 70, progressConfirmedBy: 'Schedule update' });
    phone.undo();
    expect(phone.ref.current[0]).toMatchObject({ percentComplete: 70, progressConfirmedBy: 'Schedule update', progressConfirmedAt: MASTER_AT });
    expect(phone.alerts.at(-1)).toMatchObject({ title: 'Not undone', message: NOT_UNDONE });
  });

  it('a master moving Roofing (its row carries Talk\'s 50%): Undo lands on the row shown, not the hidden old one', () => {
    const phone = phoneWith([roofing]);
    phone.talk(roofing.id, 50);
    phone.ref.current = master(phone.ref.current, 30, '12/02/2026', '12/16/2026');
    const moved = phone.ref.current.find(item => item.id !== roofing.id)!;
    expect(moved).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David', revisedFromTaskIds: [roofing.id] });
    phone.undo();
    const shown = phone.ref.current.find(item => item.id === moved.id)!;
    expect(shown).toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT, startDate: '12/02/2026' });
    // The hidden old row is left as it was.
    expect(phone.ref.current.find(item => item.id === roofing.id)).toMatchObject({ percentComplete: 50, progressConfirmedBy: 'David' });
    expect(phone.alerts.map(alert => alert.title)).toEqual(['Task updated']);
  });

  it('a master moving Roofing at 70%, above Talk\'s 50%: Undo leaves the task shown at 70% and says why', () => {
    const phone = phoneWith([roofing]);
    phone.talk(roofing.id, 50);
    phone.ref.current = master(phone.ref.current, 70, '12/02/2026', '12/16/2026');
    const moved = phone.ref.current.find(item => item.id !== roofing.id)!;
    expect(moved).toMatchObject({ percentComplete: 70 });
    phone.undo();
    expect(phone.ref.current.find(item => item.id === moved.id)).toMatchObject({ percentComplete: 70 });
    expect(phone.alerts.at(-1)).toMatchObject({ title: 'Not undone', message: NOT_UNDONE });
  });

  it('David changing the percent by hand after Talk is a change too', () => {
    const phone = phoneWith([roofing]);
    phone.talk(roofing.id, 50);
    phone.ref.current = phone.ref.current.map(item => ({ ...item, percentComplete: 55, progressConfirmedAt: MASTER_AT }));
    phone.undo();
    expect(phone.ref.current[0]).toMatchObject({ percentComplete: 55 });
    expect(phone.alerts.at(-1)).toMatchObject({ title: 'Not undone', message: NOT_UNDONE });
  });

  it('nothing changed: Undo gives back the file\'s 30%', () => {
    const phone = phoneWith([roofing]);
    phone.talk(roofing.id, 50);
    phone.undo();
    expect(phone.ref.current[0]).toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT });
    expect(phone.alerts.map(alert => alert.title)).toEqual(['Task updated']);
  });
});
