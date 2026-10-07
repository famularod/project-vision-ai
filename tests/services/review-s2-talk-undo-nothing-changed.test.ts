/*
 * Build 231, S2 item 4 (small): Talk asked to set a task to the percent it already shows writes nothing. Undo then
 * recorded "the entry it took back" all the same, and that entry was David's own (the same percent, confirmed at the
 * same time): his word read as undone, so a later master that moved the task could bring back an older percent of
 * his. No Undo is recorded when Talk changed nothing.
 */
import { scheduleEntryUndone, scheduleManagersOwnPercent, scheduleProgressUndoPoint, scheduleTalkUndo } from '../../services/ScheduleProgressSource';
import type { ScheduleItem } from '../../types';

const task = {
  id: 'MASTER F-1', taskName: 'Framing', projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026',
  percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-10T10:00:00.000Z',
  priority: 'Medium', notes: '', owner: '', contractor: '', milestone: '', createdAt: '2026-09-07T12:00:00.000Z',
} as ScheduleItem;
const AT = '2026-09-12T09:00:00.000Z';

describe('S2 item 4: Undo after Talk changed nothing records no Undo', () => {
  it('Talk set the percent the task already showed: Undo changes nothing of his entry and marks nothing as taken back', () => {
    const point = scheduleProgressUndoPoint(task);
    const undo = scheduleTalkUndo([task], task, point, point, AT);
    expect(undo.ok).toBe(true);
    const edit = (undo as { edit: Partial<ScheduleItem> }).edit;
    // (It was: progressUndone { percentComplete: 40, confirmedAt: '2026-09-10T10:00:00.000Z' }, which is his own entry.)
    expect('progressUndone' in edit).toBe(false);
    const after = { ...task, ...edit } as ScheduleItem;
    expect(after.percentComplete).toBe(40);
    expect(scheduleEntryUndone(after, scheduleManagersOwnPercent(after)!)).toBe(false);
  });

  it('Talk changed the percent: Undo gives the old one back and notes the entry it took back, as before', () => {
    const before = scheduleProgressUndoPoint(task);
    const talked = { ...task, percentComplete: 70, progressConfirmedAt: '2026-09-12T08:59:00.000Z' } as ScheduleItem;
    const undo = scheduleTalkUndo([talked], talked, before, scheduleProgressUndoPoint(talked), AT);
    expect(undo).toMatchObject({ ok: true, edit: { percentComplete: 40, progressUndone: { percentComplete: 70, confirmedAt: '2026-09-12T08:59:00.000Z' } } });
  });
});
