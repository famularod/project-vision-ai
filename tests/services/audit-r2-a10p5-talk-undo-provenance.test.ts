/**
 * Audit round 2, A10 pass 5 L3 (30 Sep 2026): Talk's Undo turned the file's
 * percent into David's.
 *
 * Talk changed Roofing from the schedule file's 30% to 50%, and David tapped
 * Undo. Undo put back only the status and percent, through the same task
 * update every progress change takes, which marks the progress as David's:
 * 30% came back as "project manager judgment", and a later master stating
 * 20% could no longer lower it.
 *
 * Now Talk notes the task's progress and who stated it before the change
 * (scheduleProgressUndoPoint), and Undo gives all of it back
 * (scheduleProgressRestored), not through the "any progress change is
 * David's" path: the file's 30% is the file's again; David's own percent
 * comes back as his, confirmed at the Undo so every device takes it back,
 * and judged when he judged it (progressJudgment). These tests run App.tsx's
 * own updateScheduleItem and confirmTalkTaskAction, compiled. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ScheduleItem } from '../../types';
import { reconcileScheduleProgressEdit, scheduleProgressRecordedByManager } from '../../services/ScheduleProgressInvariant';
import * as progressSource from '../../services/ScheduleProgressSource';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';

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
  const alerts: Array<{ title: string; buttons: Array<{ text: string; onPress?: () => void }> }> = [];
  const synced: ScheduleItem[] = [];
  const state = {
    talkTaskAction: null as unknown,
  };
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
    syncScheduleItemRevision: (item: ScheduleItem) => { synced.push(item); return Promise.resolve(true); },
    Alert: { alert: (title: string, _message: string, buttons: Array<{ text: string; onPress?: () => void }>) => alerts.push({ title, buttons }) },
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
    synced,
    /** Talk sets the percent; David confirms; then Undo, when asked. */
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
      const undo = alerts.at(-1)?.buttons.find(button => button.text === 'Undo');
      expect(undo).toBeDefined();
      undo!.onPress!();
    },
  };
}

const master = { id: 'MASTER 0831', importBatchId: 'batch-MASTER 0831', importedAt: '2026-08-31T12:00:00.000Z' };
/** Roofing as the master's file gave it: 30%, nothing saying anyone else set it. */
const roofing: ScheduleItem = {
  id: 'MASTER 0831-2', projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot', taskName: 'Roofing',
  startDate: '12/01/2026', finishDate: '12/15/2026', milestone: '', owner: '', contractor: '', percentComplete: 30,
  status: 'In Progress', priority: 'Medium', notes: '', importBatchId: master.importBatchId, sourceDocumentId: master.id,
  importedAt: master.importedAt, createdAt: master.importedAt,
};

/** A new master stating Roofing at `percent`, on the same dates. */
function laterMaster(task: ScheduleItem, percent: number) {
  const row = {
    ...roofing, id: 'MASTER 1007-2', importBatchId: 'batch-MASTER 1007', sourceDocumentId: 'MASTER 1007',
    importedAt: '2026-10-07T12:00:00.000Z', createdAt: '2026-10-07T12:00:00.000Z', percentComplete: percent,
  };
  const merged = mergeApprovedScheduleImportItems({
    existing: [task], imported: [row], completionMatch: () => null, mergeCompletion: item => item,
    approvedAt: '2026-10-07T12:00:00.000Z',
  });
  return [...merged.next, ...merged.additions].find(item => item.taskName === 'Roofing')!;
}

describe('A10 pass 5 L3: Talk\'s Undo gives back who stated the progress, not just the percent', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Talk takes the file\'s 30% to 50% as David\'s; Undo gives back 30% as the file\'s, and a later master at 20% lowers it', () => {
    const phone = phoneWith(roofing);
    phone.talk(50);
    expect(phone.task()).toMatchObject({ percentComplete: 50, progressSource: 'project_manager', progressConfirmedBy: 'David' });
    phone.undo();
    const undone = phone.task();
    // Pin updated (A10 pass 6 L3): the file's percent comes back marked as a file's over David's is kept
    // ("Schedule update", confirmed at the Undo), so a device still holding Talk's 50% cannot win it back.
    expect(undone).toMatchObject({ percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT });
    expect(undone.progressJudgment ?? null).toBeNull();
    expect(scheduleProgressRecordedByManager(undone)).toBe(false);
    // What the phone saved is what it shows.
    expect(phone.synced.at(-1)).toMatchObject({ percentComplete: 30, progressConfirmedBy: 'Schedule update' });
    expect(laterMaster(undone, 20)).toMatchObject({ percentComplete: 20 });
  });

  it('a percent a schedule update set over David\'s ("Schedule update") comes back as the schedule\'s, confirmed at the Undo', () => {
    const fromUpdate = { ...roofing, progressSource: 'project_manager' as const, progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-09-20T12:00:00.000Z' };
    const phone = phoneWith(fromUpdate);
    phone.talk(50);
    phone.undo();
    const undone = phone.task();
    expect(undone).toMatchObject({ percentComplete: 30, progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: UNDO_AT });
    expect(undone.progressJudgment ?? null).toBeNull();
    expect(scheduleProgressRecordedByManager(undone)).toBe(false);
    expect(laterMaster(undone, 20)).toMatchObject({ percentComplete: 20 });
  });

  it('David\'s own 40% comes back as his, judged when he judged it, confirmed at the Undo so every device takes it back', () => {
    const davids = { ...roofing, percentComplete: 40, progressSource: 'project_manager' as const, progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-10T15:00:00.000Z' };
    const phone = phoneWith(davids);
    phone.talk(60);
    phone.undo();
    const undone = phone.task();
    expect(undone).toMatchObject({
      percentComplete: 40, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: UNDO_AT,
      progressJudgment: { judgedAt: '2026-09-10T15:00:00.000Z', givenBackAt: UNDO_AT },
    });
    expect(progressSource.scheduleProgressJudgedAt(undone)).toBe('2026-09-10T15:00:00.000Z');
    expect(scheduleProgressRecordedByManager(undone)).toBe(true);
    // A later master below David's percent leaves it, as before Talk.
    expect(laterMaster(undone, 20)).toMatchObject({ percentComplete: 40 });
  });

  it('the completion record and the lookahead note Talk\'s change set aside come back with it', () => {
    const verification = {
      status: 'reported_complete' as const, reportedAt: '2026-09-25T12:00:00.000Z', reportedBy: 'Acme Roofing',
      priorScheduleStatus: 'In Progress' as const, priorPercentComplete: 30, verifiedAt: null, verifiedBy: null,
      verificationNote: null, evidence: [],
    };
    const lookaheadOverlay = {
      masterStartDate: '12/01/2026', masterFinishDate: '12/15/2026', masterPercentComplete: 20,
      lookaheads: [{ batchId: 'batch-wk40', startDate: '12/01/2026', finishDate: '12/15/2026', percentComplete: 30 }],
    };
    const phone = phoneWith({ ...roofing, completionVerification: verification, lookaheadOverlay });
    phone.talk(50);
    expect(phone.task().completionVerification).toBeNull();
    phone.undo();
    expect(phone.task()).toMatchObject({ percentComplete: 30, completionVerification: verification, lookaheadOverlay });
  });
});
