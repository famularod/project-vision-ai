import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { laterScheduleImportSourceRow, withScheduleImportMembershipOf } from '../../services/ScheduleImportProvenance';
import type { ScheduleItem } from '../../types';

/**
 * Whole-app audit A7 pass 22 L-3 (from A5 pass 19 L4, 1 Oct 2026): a
 * Microsoft Project revision that found a twin unchanged records the row the
 * new file gave it (alsoImportedSourceRow), so twins pair in one file's row
 * order. The merge of two copies kept every import either knew of, but the
 * row only from the copy that won, and a re-homing revision leaves updatedAt
 * alone: Full Sync on a device still holding the copy from before the
 * revision wrote it to the cloud without the row, and at the next revision
 * the twins swapped David's percents. Keep Phone on a task conflict did the
 * same with the phone's copy.
 */
const before: ScheduleItem = {
  id: 'task-pour-1', projectName: 'Harbor Point', taskName: 'Pour slab', locationName: 'Level 2',
  startDate: '2026-10-08', finishDate: '2026-10-09', percentComplete: 40, status: 'in_progress',
  importBatchId: 'batch-F', sourceRowNumber: 12, updatedAt: '2026-10-01T08:00:00.000Z',
} as unknown as ScheduleItem;
const afterG = { ...before, alsoImportedInBatchIds: ['batch-G'], alsoImportedSourceRow: { importBatchId: 'batch-G', sourceRowNumber: 14 } } as ScheduleItem;
const afterH = { ...afterG, alsoImportedInBatchIds: ['batch-G', 'batch-H'], alsoImportedSourceRow: { importBatchId: 'batch-H', sourceRowNumber: 9 } } as ScheduleItem;

describe('a twin keeps the row its latest import gave it through a merge (audit A7 pass 22 L-3)', () => {
  it('Full Sync with the copy from before the revision: the merge keeps the row, and nothing is written back without it', () => {
    const [merged] = recoverDAVEScheduleRecords({ local: [before], cloud: [afterG], allowCloudOnly: true });
    expect(merged.alsoImportedSourceRow).toEqual({ importBatchId: 'batch-G', sourceRowNumber: 14 });
    expect(daveScheduleItemsNeedingCloudUpload({ local: [before], cloud: [afterG] })).toEqual([]);
  });

  it('two rows: the one from the import the other copy does not know, either way round', () => {
    expect(recoverDAVEScheduleRecords({ local: [afterG], cloud: [afterH], allowCloudOnly: true })[0].alsoImportedSourceRow)
      .toEqual({ importBatchId: 'batch-H', sourceRowNumber: 9 });
    expect(recoverDAVEScheduleRecords({ local: [afterH], cloud: [afterG], allowCloudOnly: true })[0].alsoImportedSourceRow)
      .toEqual({ importBatchId: 'batch-H', sourceRowNumber: 9 });
    expect(laterScheduleImportSourceRow(afterG, afterH)).toEqual(afterH.alsoImportedSourceRow);
    expect(laterScheduleImportSourceRow(afterH, afterG)).toEqual(afterH.alsoImportedSourceRow);
    expect(laterScheduleImportSourceRow(before, null)).toBeUndefined();
  });

  it('Keep Phone on a task conflict: the phone\'s copy takes the row with the imports', () => {
    const kept = withScheduleImportMembershipOf({ ...before, percentComplete: 60 } as ScheduleItem, afterG);
    expect(kept).toMatchObject({ percentComplete: 60, alsoImportedInBatchIds: ['batch-G'],
      alsoImportedSourceRow: { importBatchId: 'batch-G', sourceRowNumber: 14 } });
    expect(withScheduleImportMembershipOf(afterG, before)).toBe(afterG);
  });
});
