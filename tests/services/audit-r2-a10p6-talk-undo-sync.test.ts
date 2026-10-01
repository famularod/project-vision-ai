/**
 * Audit round 2, A10 pass 6 L3 (30 Sep 2026): a stale copy of Talk's change
 * could win over the Undo on Full Sync.
 *
 * Talk took Roofing from the schedule file's 30% to 50%, marked as David's.
 * David tapped Undo, which gave back the file's 30% with no progress source
 * (eaeefc0). Another device still held Talk's 50% marked as David's. Sync
 * ranks a manager's copy above a file's (DAVEScheduleRecovery), so on Full
 * Sync that device's 50% won over the Undo, on every device.
 *
 * Now Undo marks a percent that was not David's the way a file's percent over
 * David's is kept elsewhere: project_manager, confirmed by "Schedule update"
 * at the Undo. It wins the same sync, a later master can still lower it, and
 * the summaries read it as the schedule's. A percent on a task entered by hand
 * with nothing saying who set it counts as David's, and comes back as his,
 * confirmed at the Undo. These tests run App.tsx's own updateScheduleItem and
 * confirmTalkTaskAction, compiled. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { scheduleHasAuthoritativeProgressJudgment } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { reconcileScheduleProgressEdit, scheduleProgressRecordedByManager } from '../../services/ScheduleProgressInvariant';
import * as progressSource from '../../services/ScheduleProgressSource';

const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function slice(from: string, to: string) {
  const start = app.indexOf(from) + 1;
  const end = app.indexOf(to, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

const TALK_AT = '2026-09-30T15:00:00.000Z';
const UNDO_AT = '2026-09-30T15:00:05.000Z';

/** The phone's task update and Talk's confirm, compiled from App.tsx, over one task. */
function phoneWith(task: ScheduleItem) {
  const scheduleItemsCurrentRef = { current: [task] };
  const alerts: Array<{ title: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const state = { talkTaskAction: null as unknown };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef,
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

const master = { id: 'MASTER 0831', importBatchId: 'batch-MASTER 0831', importedAt: '2026-08-31T12:00:00.000Z' };
const roofing: ScheduleItem = {
  id: 'MASTER 0831-2', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Roofing',
  startDate: '12/01/2026', finishDate: '12/15/2026', milestone: '', owner: '', contractor: '', percentComplete: 30,
  status: 'In Progress', priority: 'Medium', notes: '', importBatchId: master.importBatchId, sourceDocumentId: master.id,
  importedAt: master.importedAt, createdAt: master.importedAt,
};
function laterMaster(task: ScheduleItem, percent: number) {
  const row = {
    ...roofing, id: 'MASTER 1007-2', importBatchId: 'batch-MASTER 1007', sourceDocumentId: 'MASTER 1007',
    importedAt: '2026-10-07T12:00:00.000Z', createdAt: '2026-10-07T12:00:00.000Z', percentComplete: percent,
  };
  const merged = mergeApprovedScheduleImportItems({
    existing: [task], imported: [row], completionMatch: () => null, mergeCompletion: item => item, approvedAt: '2026-10-07T12:00:00.000Z',
  });
  return [...merged.next, ...merged.additions].find(item => item.taskName === 'Roofing')!;
}

describe('A10 p6 L3: Talk\'s Undo wins the sync over a stale copy of Talk\'s change', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the file\'s 30% comes back confirmed by "Schedule update" at the Undo, and beats the other device\'s 50% either way round', () => {
    const phone = phoneWith(roofing);
    phone.talk(50);
    const stale = phone.task(); // what the other device still holds: Talk's 50%, David's
    expect(stale).toMatchObject({ percentComplete: 50, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: TALK_AT });
    phone.undo();
    const undone = phone.task();
    expect(undone).toMatchObject({
      percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT,
    });
    expect(undone.progressJudgment ?? null).toBeNull();
    // The stale device syncs: the Undo is the cloud's, and its 50% does not go up over it.
    expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [undone], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update' });
    expect(daveScheduleItemsNeedingCloudUpload({ local: [stale], cloud: [undone] })).toEqual([]);
    // The other way round: this phone's Undo goes up over the cloud's 50%.
    expect(daveScheduleItemsNeedingCloudUpload({ local: [undone], cloud: [stale] }).map(item => item.percentComplete)).toEqual([30]);
  });

  it('a later master can still lower it, and the summaries read it as the schedule\'s', () => {
    const phone = phoneWith(roofing);
    phone.talk(50);
    phone.undo();
    const undone = phone.task();
    expect(scheduleProgressRecordedByManager(undone)).toBe(false);
    expect(scheduleHasAuthoritativeProgressJudgment(undone)).toBe(false);
    expect(laterMaster(undone, 20)).toMatchObject({ percentComplete: 20 });
  });

  it('a task entered by hand with no progress source (David\'s by the older rule) comes back as his, confirmed at the Undo', () => {
    const hand: ScheduleItem = {
      ...roofing, id: 'hand', taskName: 'Punch list', importBatchId: null, sourceDocumentId: null, importedAt: null, percentComplete: 40,
    } as ScheduleItem;
    expect(scheduleHasAuthoritativeProgressJudgment(hand)).toBe(true);
    const phone = phoneWith(hand);
    phone.talk(60);
    const stale = phone.task();
    phone.undo();
    const undone = phone.task();
    expect(undone).toMatchObject({ percentComplete: 40, progressSource: 'project_manager', progressConfirmedAt: UNDO_AT });
    expect(undone.progressConfirmedBy).not.toBe('Schedule update');
    expect(scheduleHasAuthoritativeProgressJudgment(undone)).toBe(true);
    expect(recoverDAVEScheduleRecords({ local: [stale], cloud: [undone], allowCloudOnly: true })[0]).toMatchObject({ percentComplete: 40 });
  });
});
