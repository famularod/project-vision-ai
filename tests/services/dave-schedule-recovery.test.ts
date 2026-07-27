import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import type { ScheduleItem } from '../../types';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    projectName: '2321 Compliance Project',
    scheduleProjectName: '2321 Compliance Project',
    locationName: '2321 North Lot',
    taskName: 'PLACE ASPHALT AT EMPLOYEE PARKING AREA',
    startDate: '2026-07-27',
    finishDate: '2026-07-31',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Paving contractor',
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-26T20:00:00.000Z',
    progressConfirmedBy: 'David',
    priority: 'Medium',
    status: 'Not Started',
    notes: 'Older task note.',
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-26T20:00:00.000Z',
    ...overrides,
  };
}

describe('DAVE schedule cloud recovery', () => {
  it('applies a newer cloud note without replacing newer unrelated local progress', () => {
    const local = scheduleItem({
      status: 'In Progress',
      percentComplete: 60,
      progressConfirmedAt: '2026-07-26T22:30:00.000Z',
      progressConfirmedBy: 'David on iPad',
      notes: 'Older task note.',
      updatedAt: '2026-07-26T22:30:00.000Z',
    });
    const cloud = scheduleItem({
      status: 'Not Started',
      percentComplete: 0,
      progressConfirmedAt: '2026-07-26T21:00:00.000Z',
      progressConfirmedBy: 'David on iPhone',
      notes: 'Test 1',
      updatedAt: '2026-07-26T23:00:00.000Z',
    });

    expect(recoverDAVEScheduleRecords({
      local: [local],
      cloud: [cloud],
      allowCloudOnly: true,
    })).toEqual([
      expect.objectContaining({
        id: 'task-1',
        notes: 'Test 1',
        updatedAt: '2026-07-26T23:00:00.000Z',
        status: 'In Progress',
        percentComplete: 60,
        progressSource: 'project_manager',
        progressConfirmedAt: '2026-07-26T22:30:00.000Z',
        progressConfirmedBy: 'David on iPad',
      }),
    ]);
  });
});
