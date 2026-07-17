import { buildPIEScheduleReconciliation } from '../../services/PIEScheduleReconciliation';
import type { ScheduleItem } from '../../types';

function scheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    projectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place concrete paving',
    startDate: '2026-07-10',
    finishDate: '2026-07-17',
    milestone: '',
    owner: 'Project manager',
    contractor: 'Concrete contractor',
    percentComplete: 0,
    priority: 'High',
    status: 'Not Started',
    notes: '',
    importedFrom: 'schedule.pdf',
    importedAt: '2026-07-10T12:00:00.000Z',
    createdAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  } as ScheduleItem;
}

describe('schedule reconciliation authority', () => {
  const now = new Date('2026-07-16T12:00:00-07:00');

  it('treats a project-manager progress percentage as authoritative evidence', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'In Progress',
        percentComplete: 60,
        progressSource: 'project_manager',
      })],
      updates: [],
      now,
    });

    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scheduled_work_without_recent_evidence' }),
    ]));
  });

  it('keeps the internal evidence-gap signal when no authority is recorded', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem()],
      updates: [],
      now,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'scheduled_work_without_recent_evidence' }),
    ]));
  });
});
