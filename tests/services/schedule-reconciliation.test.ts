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

  it('lets a newer imported schedule completion override an older in-progress field update', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'Complete',
        percentComplete: 100,
        progressSource: 'schedule_import',
        importedAt: '2026-07-16T17:00:00.000Z',
      })],
      updates: [{
        id: 'update-before-schedule-import',
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

  it('surfaces unfinished field evidence recorded after imported schedule completion', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'Complete',
        percentComplete: 100,
        progressSource: 'schedule_import',
        importedAt: '2026-07-16T12:00:00.000Z',
      })],
      updates: [{
        id: 'update-after-schedule-import',
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

  it('prefers the newest equally reliable task match over a higher-scoring stale match', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({
        status: 'Complete',
        percentComplete: 100,
      })],
      updates: [
        {
          id: 'older-detailed-update',
          projectName: '2321 Compliance Project',
          date: '2026-07-16T12:00:00.000Z',
          notes: 'Place concrete paving in the North Lot is still in progress.',
          scheduleTaskName: 'Place concrete paving',
          selectedAreaName: 'North Lot',
          photos: [],
          recipients: { contactIds: [] },
        },
        {
          id: 'newer-current-update',
          projectName: '2321 Compliance Project',
          date: '2026-07-16T17:00:00.000Z',
          notes: 'Work is complete.',
          scheduleTaskName: 'Place concrete paving',
          selectedAreaName: 'North Lot',
          photos: [],
          recipients: { contactIds: [] },
        },
      ],
      now,
    });

    expect(result.matches[0]).toEqual(expect.objectContaining({
      updateId: 'newer-current-update',
      signal: 'complete',
      matchBasis: 'stored_task_name',
    }));
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'schedule_status_conflict' }),
    ]));
  });

  it('clears a conflict when its mistaken source update is deleted without deleting the task', () => {
    const task = scheduleItem({
      status: 'Complete',
      percentComplete: 100,
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-07-16T12:00:00.000Z',
    });
    const mistakenUpdate = {
      id: 'mistaken-update',
      projectName: '2321 Compliance Project',
      date: '2026-07-16T17:00:00.000Z',
      notes: 'Place concrete paving is still in progress.',
      scheduleItemId: 'task-1',
      photos: [],
      recipients: { contactIds: [] },
    };

    const beforeDelete = buildPIEScheduleReconciliation({
      scheduleItems: [task],
      updates: [mistakenUpdate],
      now,
    });
    const afterDelete = buildPIEScheduleReconciliation({
      scheduleItems: [task],
      updates: [],
      now,
    });

    expect(beforeDelete.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'schedule_status_conflict',
        updateId: 'mistaken-update',
      }),
    ]));
    expect(afterDelete.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'schedule_status_conflict' }),
    ]));
    expect(task.id).toBe('task-1');
    expect(task.status).toBe('Complete');
  });

  it('isolates photo signals and evidence IDs by schedule area', () => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [
        scheduleItem({
          id: 'wall-packs-canopy-a',
          locationName: 'Canopy A',
          taskName: 'INSTALL ELECTRICAL WALL PACKS',
          status: 'Complete',
          percentComplete: 100,
        }),
        scheduleItem({
          id: 'wall-packs-canopy-b',
          locationName: 'Canopy B',
          taskName: 'INSTALL ELECTRICAL WALL PACKS',
          status: 'Complete',
          percentComplete: 100,
        }),
      ],
      updates: [{
        id: 'multi-area-wall-pack-update',
        projectName: '2321 Compliance Project',
        date: '2026-07-16T17:00:00.000Z',
        notes: '',
        scheduleTaskName: 'INSTALL ELECTRICAL WALL PACKS',
        selectedAreaId: null,
        selectedAreaName: null,
        recipients: { contactIds: [] },
        photos: [
          {
            id: 'photo-canopy-a-complete',
            uri: 'file:///canopy-a.jpg',
            caption: 'INSTALL ELECTRICAL WALL PACKS is complete.',
            category: 'Update',
            actionRequired: '',
            actionOwner: '',
            actionDueDate: '',
            actionStatus: 'Closed',
            selectedAreaId: 'area-canopy-a',
            selectedAreaName: 'Canopy A',
          },
          {
            id: 'photo-canopy-b-in-progress',
            uri: 'file:///canopy-b.jpg',
            caption: 'INSTALL ELECTRICAL WALL PACKS is still in progress.',
            category: 'Update',
            actionRequired: '',
            actionOwner: '',
            actionDueDate: '',
            actionStatus: 'In Progress',
            selectedAreaId: 'area-canopy-b',
            selectedAreaName: 'Canopy B',
          },
        ],
      }],
      projectName: '2321 Compliance Project',
      now,
    });

    expect(result.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scheduleItemId: 'wall-packs-canopy-a',
        signal: 'complete',
        photoIds: ['photo-canopy-a-complete'],
      }),
      expect.objectContaining({
        scheduleItemId: 'wall-packs-canopy-b',
        signal: 'in_progress',
        photoIds: ['photo-canopy-b-in-progress'],
      }),
    ]));
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'schedule_status_conflict',
        scheduleItemId: 'wall-packs-canopy-b',
        evidenceIds: [
          'schedule:wall-packs-canopy-b',
          'update:multi-area-wall-pack-update',
          'photo:photo-canopy-b-in-progress',
        ],
      }),
    ]));
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'schedule_status_conflict',
        scheduleItemId: 'wall-packs-canopy-a',
      }),
    ]));
  });

  it.each([
    'Place concrete paving will be complete tomorrow.',
    'Place concrete paving might be complete.',
    'Place concrete paving will be complete if inspection passes.',
    'Place concrete paving is not approved.',
    'No safety issues observed.',
    'Place concrete paving will be blocked tomorrow.',
    'The blocker might be resolved if material arrives.',
    'Place concrete paving is complete, but Place concrete paving is not complete.',
  ])('does not promote non-current or conflicting language to a field status: %s', notes => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem()],
      updates: [{
        id: 'adversarial-update',
        projectName: '2321 Compliance Project',
        date: '2026-07-16T17:00:00.000Z',
        notes,
        scheduleItemId: 'task-1',
        photos: [],
        recipients: { contactIds: [] },
      }],
      now,
    });

    expect(result.matches[0].signal).toBe('unknown');
    expect(result.warnings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'field_progress_not_reflected' }),
    ]));
  });

  it.each([
    'Place concrete paving is not complete.',
    'Place concrete paving is incomplete.',
    'Place concrete paving has not started.',
    'Place concrete paving is partially complete.',
  ])('preserves explicit unfinished field language: %s', notes => {
    const result = buildPIEScheduleReconciliation({
      scheduleItems: [scheduleItem({ status: 'Complete', percentComplete: 100 })],
      updates: [{
        id: 'unfinished-update',
        projectName: '2321 Compliance Project',
        date: '2026-07-16T17:00:00.000Z',
        notes,
        scheduleItemId: 'task-1',
        photos: [],
        recipients: { contactIds: [] },
      }],
      now,
    });

    expect(result.matches[0].signal).toBe('in_progress');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'schedule_status_conflict' }),
    ]));
  });
});
