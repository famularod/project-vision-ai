import { daveScheduleItemsNeedingCloudUpload } from '../../services/DAVEScheduleRecovery';
import {
  buildDAVEWebScheduleItem,
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import { scheduleManagersPercentUnderFileOfBoth } from '../../services/ScheduleProgressSource';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ScheduleItem } from '../../types';

// Review pass 1, web L9 (6 Oct 2026; older, the same on Build 230): the web rebuilds a task from a list of fields
// when it is edited, and the list left out two marks the phone's rules read: the row a sync carried the task's
// percent from (progressCarriedFrom), and the percent Talk wrote that its Undo took back (progressUndone). S4 item 4
// had put four other row fields on the list. Both are kept now, and the last test holds the whole record: a field
// added to a task must be listed there, and then is either kept by a web edit or named as never saved.
// Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const WEB_EDIT_AT = '2026-09-15T10:00:00.000Z';

/** The form's draft for a task as it stands, as the web's pages build it. */
function draftOf(task: ScheduleItem, changes: Partial<DAVEWebTaskDraft> = {}): DAVEWebTaskDraft {
  return {
    projectId: task.projectId ?? PROJECT_ID,
    itemType: task.itemType ?? 'Task',
    taskName: task.taskName,
    projectName: task.projectName,
    locationName: task.locationName,
    startDate: task.startDate,
    finishDate: task.finishDate,
    milestone: task.milestone,
    owner: task.owner,
    contractor: task.contractor,
    percentComplete: task.percentComplete,
    priority: task.priority,
    status: task.status,
    notes: task.notes,
    nextAction: task.nextAction ?? '',
    activityMessage: '',
    ...changes,
  };
}
/** The task as the cloud holds it after a web edit of it. */
function webEdit(task: ScheduleItem, changes: Partial<DAVEWebTaskDraft>): ScheduleItem {
  const current = { ...task, cloudUpdatedAt: '2026-09-15T08:00:01.000Z' } as DAVEWebScheduleItem;
  return scheduleItemForCloud(buildDAVEWebScheduleItem({ draft: draftOf(task, changes), current, id: task.id, now: WEB_EDIT_AT, actor: 'pm@example.com' }));
}

/** Master G's row for Framing: G moved the task, so this row answers to master F's row, since deleted with F. */
const G_ROW: ScheduleItem = {
  id: 'MASTER G-1',
  projectId: PROJECT_ID,
  scheduleProjectName: 'Alpha',
  projectName: 'Alpha',
  locationName: 'Lot',
  taskName: 'Framing',
  startDate: '10/22/2026',
  finishDate: '11/01/2026',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  progressSource: 'schedule_import',
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  nextAction: '',
  importedFrom: 'MASTER G.csv',
  importedAt: '2026-09-14T12:00:00.000Z',
  importBatchId: 'batch-MASTER G',
  sourceDocumentId: 'MASTER G',
  revisedFromTaskIds: ['MASTER F-1'],
  createdAt: '2026-09-14T12:00:00.000Z',
};

describe('the row a sync carried the percent from (progressCarriedFrom), review pass 1 web L9', () => {
  const JUDGED = '2026-09-14T14:00:00.000Z';
  const MARK = { taskId: 'MASTER F-1', judgedAt: JUDGED };
  /** His 30% on F's row was carried to G's row by a sync after F was deleted: the cloud's row holds it, marked. */
  const carried: ScheduleItem = {
    ...G_ROW, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: JUDGED,
    progressConfirmedBy: 'David', progressCarriedFrom: MARK, updatedAt: '2026-09-14T14:00:00.001Z',
  };

  it('a note typed on the web keeps it: it goes with the percent, which this edit left alone', () => {
    const edited = webEdit(carried, { notes: 'Web note' });
    expect([edited.percentComplete, edited.notes, edited.progressCarriedFrom]).toEqual([30, 'Web note', MARK]);
  });

  it('what the phone\'s rules do with the web\'s row then: a device still holding it does not send it over a newer lookahead', () => {
    const edited = webEdit(carried, { notes: 'Web note' });
    // Next day the phone approves lookahead L, which restates the row at 60% on new dates. A device that was offline
    // since the web's edit still holds the web's row, and runs Sync Now.
    const restated: ScheduleItem = {
      ...edited, startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60, progressSource: 'schedule_import',
      progressConfirmedAt: null, progressConfirmedBy: null, progressCarriedFrom: undefined,
      alsoImportedInBatchIds: ['batch-LOOKAHEAD L'], updatedAt: '2026-09-16T09:30:00.000Z',
      lookaheadOverlay: { masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 0, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/25/2026', finishDate: '11/04/2026', percentComplete: 60 }] },
    };
    const sentUp = (held: ScheduleItem) =>
      daveScheduleItemsNeedingCloudUpload({ local: [held], cloud: [restated], deletedIds: ['MASTER F-1'] }).map(row => [row.percentComplete, row.startDate]);

    // With the mark the copy is weighed as a carried percent: the lookahead's 60% and dates stand, nothing goes up.
    expect(sentUp(edited)).toEqual([]);
    // Without it (the web's row before this fix) the copy read as his own word on this row and went up whole:
    // 30% on the master's dates, over the lookahead, on every device (the fault of audit A7 pass 28).
    const { progressCarriedFrom: _mark, ...asTheWebSavedItBefore } = edited;
    expect(sentUp(asTheWebSavedItBefore)).toEqual([[30, '10/22/2026']]);
  });

  it('guard: a percent entered on the web is his own word on this row: the mark is not carried on with it', () => {
    const edited = webEdit(carried, { percentComplete: 45, percentEntered: true });
    expect([edited.percentComplete, edited.progressConfirmedAt, edited.progressCarriedFrom]).toEqual([45, WEB_EDIT_AT, undefined]);
  });
});

describe('the percent Talk wrote that its Undo took back (progressUndone), review pass 1 web L9', () => {
  const HIS_AT = '2026-09-10T09:00:00.000Z';
  const TALK_AT = '2026-09-15T07:00:00.000Z';
  const UNDONE = { percentComplete: 50, confirmedAt: TALK_AT };
  /** He entered 40%; master G's file stated 60%, kept his 40% under it; Talk set 50%, and he tapped Undo. */
  const undone: ScheduleItem = {
    ...G_ROW, percentComplete: 60, status: 'In Progress', progressSource: 'schedule_import',
    managersPercentUnderFile: 40, managersPercentUnderFileJudgedAt: HIS_AT, progressUndone: UNDONE, updatedAt: '2026-09-15T07:05:00.000Z',
  };

  it('a note typed on the web keeps it: the note goes with the task', () => {
    const edited = webEdit(undone, { notes: 'Web note' });
    expect([edited.percentComplete, edited.managersPercentUnderFile, edited.progressUndone]).toEqual([60, 40, UNDONE]);
  });

  it('a percent entered on the web keeps it too: another device may still hold the entry Undo took back', () => {
    const edited = webEdit(undone, { percentComplete: 70, percentEntered: true });
    expect([edited.percentComplete, edited.progressUndone]).toEqual([70, UNDONE]);
  });

  it('what the phone\'s rules do with the web\'s row then: a device still holding Talk\'s 50% does not make it his latest entry', () => {
    const edited = webEdit(undone, { notes: 'Web note' });
    // The iPad heard Talk's 50% and slept before the Undo. Its copy meets the cloud's row, whose percent stands.
    const stillHoldsTalks: ScheduleItem = { ...G_ROW, percentComplete: 50, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: TALK_AT, progressConfirmedBy: 'David' };
    const hisEntryUnderTheFiles = (cloudRow: ScheduleItem) => scheduleManagersPercentUnderFileOfBoth(cloudRow, stillHoldsTalks);

    expect(hisEntryUnderTheFiles(edited)).toEqual({ managersPercentUnderFile: 40, managersPercentUnderFileJudgedAt: HIS_AT });
    // Without it (the web's row before this fix) Talk's undone 50% became his latest entry, kept under the file's
    // percent and sent up, so a lookahead stating 45% showed 50% on every device (the fault of audit A5 pass 26).
    const { progressUndone: _note, ...asTheWebSavedItBefore } = edited;
    expect(hisEntryUnderTheFiles(asTheWebSavedItBefore)).toEqual({ managersPercentUnderFile: 50, managersPercentUnderFileJudgedAt: TALK_AT });
  });
});

describe('the mark that a priority is one he set (prioritySetByHand), review pass 1 of the schedule round, P1-1 / P1-2 / P1-9', () => {
  const MARK = { priority: 'Low' as const, at: '2026-09-14T13:00:00.000Z' };
  /** G's row is Medium by its own import; he set Low on the phone, which left the mark. */
  const lowered: ScheduleItem = { ...G_ROW, priority: 'Low', priorityAsImported: 'Medium', prioritySetByHand: MARK, updatedAt: '2026-09-14T13:00:00.000Z' };

  it('a note typed on the web keeps it', () => {
    const edited = webEdit(lowered, { notes: 'Web note' });
    expect([edited.priority, edited.notes, edited.prioritySetByHand]).toEqual(['Low', 'Web note', MARK]);
  });

  it('a priority changed on the web leaves the mark, with the time of the edit, also when it is the priority the row\'s own import gave', () => {
    const edited = webEdit(lowered, { priority: 'Medium' });
    expect([edited.priority, edited.priorityAsImported, edited.prioritySetByHand]).toEqual(['Medium', 'Medium', { priority: 'Medium', at: WEB_EDIT_AT }]);
    const raised = webEdit({ ...G_ROW, priorityAsImported: 'Medium' }, { priority: 'High' });
    expect([raised.priority, raised.prioritySetByHand]).toEqual(['High', { priority: 'High', at: WEB_EDIT_AT }]);
  });

  it('guard: a web edit that leaves the priority alone leaves no mark on a task he never set it on', () => {
    expect(webEdit({ ...G_ROW, priorityAsImported: 'Medium' }, { notes: 'Web note' })).not.toHaveProperty('prioritySetByHand');
  });
});

describe('the whole task record through a web edit (review pass 1, web L9)', () => {
  /**
   * Every field a task can hold, each with a value the phone or iPad could have saved. The type makes this list
   * complete: a field added to ScheduleItem does not compile until it is given here, and the test below then says
   * whether a web edit keeps it.
   */
  const EVERY_FIELD: { [Field in keyof Required<ScheduleItem>]: NonNullable<ScheduleItem[Field]> } = {
    id: 'MASTER G-1',
    projectId: PROJECT_ID,
    itemType: 'RFI',
    scheduleProjectName: 'PLZ 2400 Harbor Project',
    projectTimeZone: 'America/Los_Angeles',
    projectName: 'Harbor North',
    locationName: 'Lot',
    taskName: 'Framing',
    startDate: '10/22/2026',
    finishDate: '11/01/2026',
    milestone: 'Dry-in',
    owner: 'Project manager',
    contractor: 'Frame Co',
    durationDays: 8,
    wbsCode: '1.2',
    parentItemId: 'MASTER G-phase',
    sortOrder: 20,
    dependencies: [{ predecessorItemId: 'MASTER G-0', type: 'FS', lagDays: 2 }],
    dependenciesUpdatedAt: '2026-09-12T09:00:00.000Z',
    isSummary: true,
    isMilestone: true,
    baselineStartDate: '10/15/2026',
    baselineFinishDate: '10/25/2026',
    percentComplete: 60,
    percentCompleteStated: true,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-09-14T15:00:00.000Z',
    progressConfirmedBy: 'Schedule update',
    progressJudgment: { judgedAt: '2026-09-10T09:00:00.000Z', givenBackAt: '2026-09-14T15:00:00.000Z' },
    managersPercentUnderFile: 40,
    managersPercentUnderFileJudgedAt: '2026-09-10T09:00:00.000Z',
    progressCarriedFrom: { taskId: 'MASTER F-1', judgedAt: '2026-09-10T09:00:00.000Z' },
    progressStandsSince: { at: '2026-09-14T16:00:00.000Z', percentComplete: 60 },
    fileProgressPeak: { percentComplete: 60, statedAt: '2026-09-14T12:00:00.000Z' },
    fileProgressLast: { percentComplete: 30, statedAt: '2026-09-15T06:00:00.000Z' },
    masterDatesOfRow: { startDate: '10/22/2026', finishDate: '11/01/2026', before: [{ startDate: '10/15/2026', finishDate: '10/25/2026', replacedByMaster: 'batch-MASTER G' }] },
    progressUndone: { percentComplete: 50, confirmedAt: '2026-09-15T07:00:00.000Z' },
    priority: 'High',
    priorityAsImported: 'Medium', // what the row's own import gave it (schedule batch S6, item 1): he set High himself
    prioritySetByHand: { priority: 'High', at: '2026-09-13T09:00:00.000Z' }, // the mark his edit of the priority left (review pass 1, P1-1 / P1-2 / P1-9)
    status: 'In Progress',
    notes: 'Walls up on the east side.',
    nextAction: 'Order trusses.',
    activity: [{ id: 'activity-1', message: 'Crew on site', author: 'David', createdAt: '2026-09-12T08:00:00.000Z' }],
    projectControls: normalizeProjectControls({ assignee: 'Dana', trade: 'Framing', approvalStatus: 'Pending', estimatedScheduleImpactDays: 2 })!,
    importedFrom: 'MASTER F.csv',
    importedAt: '2026-09-07T12:00:00.000Z',
    importBatchId: 'batch-MASTER F',
    alsoImportedInBatchIds: ['batch-MASTER G'],
    alsoImportedSourceRow: { importBatchId: 'batch-MASTER G', sourceRowNumber: 14 },
    importedAsLookahead: true,
    lookaheadOverlay: { masterStartDate: '10/22/2026', masterFinishDate: '11/01/2026', masterPercentComplete: 40, lookaheads: [{ batchId: 'batch-LOOKAHEAD L', startDate: '10/22/2026', finishDate: '11/01/2026', percentComplete: 60 }] },
    savedLookaheadDates: { startDate: '10/22/2026', finishDate: '11/01/2026', shownStartDate: '10/22/2026', shownFinishDate: '11/01/2026' },
    revisedFromTaskIds: ['MASTER F-1'],
    textFromTask: { taskId: 'MASTER F-1', owner: 'Project manager', notes: 'Walls up on the east side.', priority: 'High' },
    notRevisionOfTaskIds: ['MASTER E-9'],
    scheduleRowsAwaitingCurrent: [{ importBatchId: 'batch-MASTER H', sourceDocumentId: 'MASTER H', startDate: '10/29/2026', finishDate: '11/08/2026', percentComplete: 65, status: 'In Progress' }],
    sourceDocumentId: 'MASTER F',
    sourceActivityId: 'A-120',
    sourceWbsCode: '1.2',
    sourceRowNumber: 12,
    sourceUniqueId: '4711',
    completionVerification: {
      status: 'reported_complete', reportedAt: '2026-09-13T17:00:00.000Z', reportedBy: 'Crew lead', priorScheduleStatus: 'In Progress',
      priorPercentComplete: 40, verifiedAt: null, verifiedBy: null, verificationNote: null, evidence: [],
    },
    createdAt: '2026-09-07T12:00:00.000Z',
    updatedAt: '2026-09-15T07:05:00.000Z',
  };
  /**
   * The two fields that are never part of a saved task, by their own definitions in the type: a mark on an imported
   * row not yet approved, and a mark on the copy of a task as shown.
   */
  const NEVER_SAVED = ['percentCompleteStated', 'savedLookaheadDates'];

  it('a note typed on the web changes the note and the time of the edit, and nothing else of what the phone saved', () => {
    const phoneSaved = EVERY_FIELD as ScheduleItem;
    const edited = webEdit(phoneSaved, { notes: 'Trusses ordered.' }) as unknown as Record<string, unknown>;

    const expected: Record<string, unknown> = { ...EVERY_FIELD, notes: 'Trusses ordered.', updatedAt: WEB_EDIT_AT };
    NEVER_SAVED.forEach(field => { delete expected[field]; });
    expect(Object.keys(EVERY_FIELD).filter(field => edited[field] === undefined)).toEqual(NEVER_SAVED);
    expect(edited).toEqual(expected);
  });
});
