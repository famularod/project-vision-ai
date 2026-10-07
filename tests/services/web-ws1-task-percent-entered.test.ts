import {
  buildDAVEWebScheduleItem,
  mergeDAVEWebConflictDraft,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleProgressIsManagers } from '../../services/ScheduleProgressSource';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Open item, web batch WS1 item 5 (6 Oct 2026; "needs a closer look: fix if
// his entry is not recorded as his"). The closer look: a web save marks the
// progress as his only when the percent or the status CHANGES. So a percent
// he typed that is the percent a schedule file had given the task was no
// change and stayed the file's ("Schedule update"). It then behaved as a
// file's percent: the next master could lower it, and deleting the lookahead
// that gave it, with its tasks, put his older percent back, though he had
// typed that percent himself. It is now his entry. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const NOW = '2026-10-06T18:00:00.000Z';
const ACTOR = 'david@example.com';

function task(extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id: 'framing',
    projectId: 'alpha',
    itemType: 'Task',
    scheduleProjectName: 'Alpha',
    projectName: 'Alpha',
    locationName: 'Lot',
    taskName: 'Framing',
    startDate: '10/15/2026',
    finishDate: '10/25/2026',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 60,
    status: 'In Progress',
    priority: 'Medium',
    notes: '',
    nextAction: '',
    activity: [],
    importedFrom: 'Master G.csv',
    importedAt: '2026-10-01T12:00:00.000Z',
    importBatchId: 'batch-G',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}

/** A master's 60% taken over his own 30%: it keeps his rank, but it is the file's ("Schedule update"). */
const filesOverHis = task({
  progressSource: 'project_manager',
  progressConfirmedBy: 'Schedule update',
  progressConfirmedAt: '2026-10-01T12:00:00.000Z',
  managersPercentUnderFile: 30,
  managersPercentUnderFileJudgedAt: '2026-09-20T12:00:00.000Z',
});
/** A percent that came with the import and nobody has touched. */
const imported = task({ percentComplete: 40, progressSource: 'schedule_import', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-10-01T12:00:00.000Z' });

/** The form's draft for a task as it opened, then what he did to it. */
function draftOf(current: DAVEWebScheduleItem, edit: Partial<DAVEWebTaskDraft> = {}): DAVEWebTaskDraft {
  return {
    projectId: current.projectId,
    itemType: current.itemType ?? 'Task',
    taskName: current.taskName,
    projectName: current.projectName,
    locationName: current.locationName,
    startDate: current.startDate,
    finishDate: current.finishDate,
    milestone: current.milestone,
    owner: current.owner,
    contractor: current.contractor,
    percentComplete: current.percentComplete,
    priority: current.priority ?? 'Medium',
    status: current.status,
    notes: current.notes,
    nextAction: current.nextAction ?? '',
    activityMessage: '',
    ...edit,
  };
}
const save = (current: DAVEWebScheduleItem, edit: Partial<DAVEWebTaskDraft> = {}) =>
  buildDAVEWebScheduleItem({ draft: draftOf(current, edit), current, id: current.id, now: NOW, actor: ACTOR });
const who = (item: ScheduleItem) => [item.percentComplete, item.progressSource ?? null, item.progressConfirmedBy ?? null, item.progressConfirmedAt ?? null];

describe('a percent typed on the web that is the percent a schedule file gave (WS1 item 5)', () => {
  it('typed over a master\'s 60% that stood over his 30%: the 60% is his entry now, and his older 30% is no longer kept under it', () => {
    const saved = save(filesOverHis, { percentEntered: true });
    expect(who(saved)).toEqual([60, 'project_manager', ACTOR, NOW]);
    expect(scheduleProgressIsManagers(saved)).toBe(true);
    expect(saved.managersPercentUnderFile).toBeUndefined();
    expect(saved.managersPercentUnderFileJudgedAt).toBeUndefined();
  });

  it('typed over an import\'s own 40%: his entry', () => {
    expect(who(save(imported, { percentEntered: true }))).toEqual([40, 'project_manager', ACTOR, NOW]);
  });

  it('typed as text with a percent sign, the same', () => {
    expect(who(save(imported, { percentComplete: '40%', percentEntered: true }))).toEqual([40, 'project_manager', ACTOR, NOW]);
  });

  it('what it protects: the next master\'s lower percent no longer lowers it', () => {
    const row = { ...task({ id: 'h-framing', importBatchId: 'batch-H', importedFrom: 'Master H.csv', startDate: '10/20/2026', finishDate: '10/30/2026', percentComplete: 40, status: 'In Progress' }), percentCompleteStated: true } as ScheduleItem;
    const { cloudUpdatedAt: _cloud, ...asRow } = row as DAVEWebScheduleItem;
    const next = (existing: ScheduleItem) => mergeApprovedScheduleImportItems({
      existing: [existing], imported: [asRow as ScheduleItem], completionMatch: () => null, mergeCompletion: item => item,
    }).additions[0].percentComplete;
    // Left as the file's (the box not touched), the newer file's 40% is taken, as before.
    expect(next(save(filesOverHis, { locationName: 'Lot A' }))).toBe(40);
    expect(next(save(filesOverHis, { percentEntered: true }))).toBe(60);
  });

  it('what it protects: deleting the lookahead that gave the percent, with its tasks, no longer puts his older percent back', () => {
    const L1 = { id: 'L1', name: 'L1', originalFileName: 'L1.csv', uri: '', category: 'Schedules', notes: '', isCurrent: false, importedAt: '2026-10-02T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-L1', scheduleRole: 'lookahead' } as ReferenceDocument;
    const G = { ...L1, id: 'G', name: 'G', originalFileName: 'G.csv', isCurrent: true, importedAt: '2026-10-01T12:00:00.000Z', importBatchId: 'batch-G', scheduleRole: null } as ReferenceDocument;
    /** His 30%; lookahead L1 gave 60% on its own dates. */
    const underLookahead = task({
      startDate: '10/18/2026', finishDate: '10/28/2026',
      progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: '2026-10-02T12:00:00.000Z',
      alsoImportedInBatchIds: ['batch-L1'],
      lookaheadOverlay: {
        masterStartDate: '10/15/2026', masterFinishDate: '10/25/2026', masterPercentComplete: 30, masterStatus: 'In Progress',
        masterProgressSource: 'project_manager', masterProgressConfirmedAt: '2026-09-20T12:00:00.000Z', masterProgressConfirmedBy: 'David',
        masterFilePercentComplete: null,
        lookaheads: [{ batchId: 'batch-L1', startDate: '10/18/2026', finishDate: '10/28/2026', percentComplete: 60, importedAt: '2026-10-02T12:00:00.000Z' }],
      },
    } as Partial<DAVEWebScheduleItem>);
    const after = (saved: ScheduleItem) => {
      const [back] = scheduleItemsAfterScheduleDeleted({ items: [saved], removed: [], document: L1, documents: [G], updatedAt: '2026-10-07T12:00:00.000Z' });
      return (back ?? saved).percentComplete;
    };
    expect(after(save(underLookahead, { locationName: 'Lot A' }))).toBe(30);
    expect(after(save(underLookahead, { percentEntered: true }))).toBe(60);
  });

  it('guard: a save that changes something else, the box untouched, leaves the file\'s percent the file\'s (A12 pass 4 M1)', () => {
    const saved = save(filesOverHis, { locationName: 'Lot A' });
    expect(who(saved)).toEqual([60, 'project_manager', 'Schedule update', '2026-10-01T12:00:00.000Z']);
    expect(saved.managersPercentUnderFile).toBe(30);
    expect(who(save(imported, { owner: 'Mike' }))).toEqual([40, 'schedule_import', 'Schedule update', '2026-10-01T12:00:00.000Z']);
  });

  it('guard: an emptied box keeps the stored percent and whose it is (A12 pass 5 L1)', () => {
    expect(who(save(imported, { percentEntered: false }))).toEqual([40, 'schedule_import', 'Schedule update', '2026-10-01T12:00:00.000Z']);
  });

  it('guard: his own percent typed again is left as it was, with its time', () => {
    const his = task({ percentComplete: 50, progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-10-03T09:00:00.000Z' });
    expect(who(save(his, { percentEntered: true }))).toEqual([50, 'project_manager', 'David', '2026-10-03T09:00:00.000Z']);
  });

  it('guard: a changed percent is his entry, as before', () => {
    expect(who(save(imported, { percentComplete: 55, percentEntered: true }))).toEqual([55, 'project_manager', ACTOR, NOW]);
    expect(who(save(imported, { percentComplete: 55 }))).toEqual([55, 'project_manager', ACTOR, NOW]);
  });
});

describe('Apply My Changes after another device changed the task (WS1 item 5)', () => {
  const apply = (latest: DAVEWebScheduleItem) => buildDAVEWebScheduleItem({
    draft: mergeDAVEWebConflictDraft({ draft: draftOf(imported, { percentEntered: true, notes: 'Mine' }), base: imported, latest, now: NOW, actor: ACTOR }),
    current: latest, id: latest.id, now: NOW, actor: ACTOR,
  });

  it('the other device left the percent alone: the percent he typed is his entry', () => {
    const latest = { ...imported, owner: 'Mike', cloudUpdatedAt: '2026-10-05T12:00:01.000Z' };
    const saved = apply(latest);
    expect(who(saved)).toEqual([40, 'project_manager', ACTOR, NOW]);
    expect([saved.owner, saved.notes]).toEqual(['Mike', 'Mine']);
  });

  it('guard: the other device changed the percent: its newer percent stays, and is not marked as his', () => {
    const latest = { ...imported, percentComplete: 70, progressSource: 'field_report' as never, progressConfirmedBy: 'Field report', progressConfirmedAt: '2026-10-05T12:00:00.000Z', cloudUpdatedAt: '2026-10-05T12:00:01.000Z' };
    const saved = apply(latest);
    expect(who(saved)).toEqual([70, 'field_report', 'Field report', '2026-10-05T12:00:00.000Z']);
    expect(saved.notes).toBe('Mine');
  });
});
