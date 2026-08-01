import { buildDAVETaskAreaSummary } from '../../services/DAVETaskAreaSummary';
import type { ScheduleItem } from '../../types';

const baseTask: ScheduleItem = {
  id: 'task-a',
  projectName: '2321 Compliance Project',
  locationName: 'BBW-130',
  taskName: 'Install doors',
  startDate: '07/20/2026',
  finishDate: '07/30/2026',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 25,
  priority: 'Medium',
  status: 'In Progress',
  notes: '',
  createdAt: '2026-07-01T12:00:00.000Z',
};

describe('DAVE task area summary', () => {
  it('summarizes work, dates, progress, and overdue tasks for an area', () => {
    const summary = buildDAVETaskAreaSummary({
      projectName: baseTask.projectName,
      areaName: baseTask.locationName,
      tasks: [
        baseTask,
        {
          ...baseTask,
          id: 'task-b',
          taskName: 'Close walls',
          startDate: '07/31/2026',
          finishDate: '08/05/2026',
          percentComplete: 100,
          status: 'Complete',
        },
      ],
      now: new Date(2026, 6, 31),
    });

    expect(summary).toMatchObject({
      taskCount: 2,
      openCount: 1,
      inProgressCount: 1,
      completeCount: 1,
      overdueCount: 1,
      earliestStartLabel: 'Jul 20, 2026',
      latestFinishLabel: 'Aug 5, 2026',
    });
    expect(summary.workItems[0]).toMatchObject({
      taskName: 'Install doors',
      statusLabel: 'In Progress',
      startDateLabel: 'Jul 20, 2026',
      finishDateLabel: 'Jul 30, 2026',
    });
    expect(summary.warnings[0].message).toContain('Past due since Jul 30, 2026');
  });

  it('flags invalid ranges and reports missing planning dates', () => {
    const summary = buildDAVETaskAreaSummary({
      projectName: baseTask.projectName,
      areaName: baseTask.locationName,
      tasks: [
        { ...baseTask, startDate: '08/10/2026', finishDate: '08/01/2026' },
        { ...baseTask, id: 'task-b', startDate: '', finishDate: '' },
      ],
      now: new Date(2026, 6, 1),
    });

    expect(summary.missingStartCount).toBe(1);
    expect(summary.missingFinishCount).toBe(1);
    expect(summary.warnings.some(warning => warning.message.includes('is after finish'))).toBe(true);
  });

  it('preserves Waiting as an explicit exception to percentage-derived status', () => {
    const summary = buildDAVETaskAreaSummary({
      projectName: baseTask.projectName,
      areaName: baseTask.locationName,
      tasks: [{ ...baseTask, status: 'Waiting', percentComplete: 40 }],
    });

    expect(summary.workItems[0].statusLabel).toBe('Waiting');
  });

  it('uses the numeric percentage as truth when a stale status disagrees', () => {
    const summary = buildDAVETaskAreaSummary({
      projectName: baseTask.projectName,
      areaName: baseTask.locationName,
      tasks: [
        { ...baseTask, status: 'Complete', percentComplete: 25 },
        { ...baseTask, id: 'task-b', status: 'In Progress', percentComplete: 100 },
      ],
    });

    expect(summary).toMatchObject({
      openCount: 1,
      inProgressCount: 1,
      completeCount: 1,
    });
    expect(summary.workItems.map(item => [item.statusLabel, item.percentComplete])).toEqual([
      ['In Progress', 25],
      ['Complete', 100],
    ]);
  });
});
