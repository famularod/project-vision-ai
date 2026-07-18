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

  it('lets a newer PM completion override an older in-progress field update', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'Complete',
        percentComplete: 100,
        progressSource: 'project_manager',
        progressConfirmedAt: '2026-07-16T17:00:00.000Z',
      })],
      updates: [{
        id: 'update-before-completion',
        projectName: '2321 Compliance Project',
        date: '2026-07-16T12:00:00.000Z',
        notes: 'Place concrete paving is still in progress.',
        scheduleItemId: 'task-1',
        photos: [],
        recipients: { contactIds: [] },
      }],
      now,
    });

    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'schedule_status_conflict' }),
    ]));
  });

  it('surfaces unfinished field evidence recorded after PM completion', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'Complete',
        percentComplete: 100,
        progressSource: 'project_manager',
        progressConfirmedAt: '2026-07-16T12:00:00.000Z',
      })],
      updates: [{
        id: 'update-after-completion',
        projectName: '2321 Compliance Project',
        date: '2026-07-16T17:00:00.000Z',
        notes: 'Place concrete paving is still in progress.',
        scheduleItemId: 'task-1',
        photos: [],
        recipients: { contactIds: [] },
      }],
      now,
    });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'schedule_status_conflict' }),
    ]));
  });
});
