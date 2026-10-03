/**
 * Audit round 2, A10 pass 7 L3 / A5 pass 9 L4 (30 Sep 2026): Talk's Undo on
 * an older task entered by hand hid a standing warning.
 *
 * Pour slab was entered by hand at 40% with nothing saying who set it (David's,
 * by the older rule). A 29 Sep field report says it is complete, so the
 * schedule warns "Recent field evidence may show Pour slab complete while the
 * schedule remains In Progress at 40%". Talk set 50%, and Undo gave back 40%
 * as David's, confirmed at the Undo (b03042f) with no earlier judgment time,
 * so the summaries judged it at the Undo, newer than the report, and the
 * warning disappeared though nothing about the slab had been judged.
 *
 * Now a percent entered by hand with no source comes back judged when it was
 * stated: its confirmation time, else when it was imported, else when it was
 * created (as deleting a lookahead gives it back, ScheduleLookahead), so a
 * report made since still counts against it. Undo notes those times with the
 * percent. These tests run App.tsx's own updateScheduleItem and
 * confirmTalkTaskAction, compiled. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ProjectUpdate, ScheduleItem } from '../../types';
import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildPIEScheduleReconciliation } from '../../services/PIEScheduleReconciliation';
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

const CREATED_AT = '2026-09-20T14:00:00.000Z';
const REPORT_AT = '2026-09-29T15:00:00.000Z';
const TALK_AT = '2026-09-30T15:00:00.000Z';
const UNDO_AT = '2026-09-30T15:00:05.000Z';

/** The phone's task update and Talk's confirm, compiled from App.tsx, over one task (as the A10 pass 6 L3 tests do). */
function phoneWith(task: ScheduleItem) {
  const scheduleItemsCurrentRef = { current: [task] };
  const alerts: Array<{ title: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const state = { talkTaskAction: null as unknown };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef,
    // Pin changed deliberately (A10 pass 8 L2, 30 Sep 2026): Undo asks which tasks are shown now, from the
    // schedules saved, so the compiled confirm needs them; one current schedule per import, the newest shown.
    referenceDocumentsCurrentRef: { get current() { return schedulesOfSavedTasks(scheduleItemsCurrentRef.current); } },
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
    Alert: { alert: (title: string, _message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => alerts.push({ title, buttons }) },
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
    task: () => scheduleItemsCurrentRef.current[0],
    talk(percent: number) {
      jest.setSystemTime(new Date(TALK_AT));
      state.talkTaskAction = {
        projectName: 'Alpha',
        command: { changes: { percentComplete: percent }, changeSummary: `set to ${percent}%` },
        candidates: [scheduleItemsCurrentRef.current[0]],
        selectedTaskId: scheduleItemsCurrentRef.current[0].id,
      };
      phone.confirmTalkTaskAction();
    },
    undo() {
      jest.setSystemTime(new Date(UNDO_AT));
      alerts.at(-1)!.buttons!.find(button => button.text === 'Undo')!.onPress!();
    },
  };
}

const byHand: ScheduleItem = {
  id: 'hand-pour', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Pour slab',
  startDate: '09/21/2026', finishDate: '10/10/2026', milestone: '', owner: '', contractor: '', percentComplete: 40,
  status: 'In Progress', priority: 'Medium', notes: '', importBatchId: null, sourceDocumentId: null, importedFrom: null,
  importedAt: null, createdAt: CREATED_AT, updatedAt: CREATED_AT,
} as unknown as ScheduleItem;
const report = {
  id: 'u-29sep', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: REPORT_AT, photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab is complete. Finished and cured.', scheduleItemId: 'hand-pour', scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;
const notReflected = (task: ScheduleItem) => buildPIEScheduleReconciliation({
  scheduleItems: [task], updates: [report], projectName: 'Alpha', now: new Date(UNDO_AT),
}).warnings.filter(warning => warning.type === 'field_progress_not_reflected').map(warning => warning.summary);

describe('A10 p7 L3: Talk\'s Undo on a task entered by hand keeps when its percent was stated', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the 29 Sep report still warns after Talk sets 50% and Undo gives back 40%', () => {
    const warning = 'Recent field evidence may show Pour slab complete while the schedule remains In Progress at 40%.';
    expect(notReflected(byHand)).toEqual([warning]);
    const phone = phoneWith(byHand);
    phone.talk(50);
    phone.undo();
    const undone = phone.task();
    expect(undone).toMatchObject({ percentComplete: 40, progressSource: 'project_manager', progressConfirmedAt: UNDO_AT });
    expect(notReflected(undone)).toEqual([warning]);
    expect(undone.progressJudgment).toEqual({ judgedAt: CREATED_AT, givenBackAt: UNDO_AT });
    expect(progressSource.scheduleProgressJudgedAt(undone)).toBe(CREATED_AT);
  });

  it('judged when it was confirmed, else imported, else created', () => {
    const confirmedAt = '2026-09-22T10:00:00.000Z';
    const importedAt = '2026-09-21T10:00:00.000Z';
    const restored = (task: Partial<ScheduleItem>) =>
      progressSource.scheduleProgressRestored(progressSource.scheduleProgressUndoPoint({ ...byHand, ...task } as ScheduleItem), UNDO_AT);
    expect(restored({ progressConfirmedAt: confirmedAt, importedAt }).progressJudgment).toEqual({ judgedAt: confirmedAt, givenBackAt: UNDO_AT });
    expect(restored({ importedAt }).progressJudgment).toEqual({ judgedAt: importedAt, givenBackAt: UNDO_AT });
    expect(restored({}).progressJudgment).toEqual({ judgedAt: CREATED_AT, givenBackAt: UNDO_AT });
  });

  it('the Undo still wins the sync over the other device\'s Talk 50% (A10 pass 6 L3)', () => {
    const phone = phoneWith(byHand);
    phone.talk(50);
    const stale = phone.task();
    phone.undo();
    const undone = phone.task();
    expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [undone], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
  });
});
