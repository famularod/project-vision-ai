import {
  buildDAVEWebScheduleItem,
  DAVEWebTaskValidationError,
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';

const BASE_DRAFT: DAVEWebTaskDraft = {
  taskName: 'Install handrails',
  projectName: '2375 Compliance Project',
  locationName: 'Canopy C',
  startDate: '2026-07-20',
  finishDate: '2026-07-24',
  milestone: '',
  owner: 'Project manager',
  contractor: 'PLZ',
  percentComplete: 70,
  priority: 'High',
  status: 'In Progress',
  notes: 'Waiting for final anchors.',
};

describe('DAVE desktop task editing model', () => {
  test('creates a safe PM-authored task and reconciles status with progress', () => {
    const task = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'Not Started', percentComplete: 25 },
      id: 'task-1',
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(task).toMatchObject({
      id: 'task-1',
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      status: 'In Progress',
      percentComplete: 25,
      progressSource: 'project_manager',
      progressConfirmedBy: 'pm@example.com',
      cloudUpdatedAt: null,
    });
  });

  test('preserves immutable import identity while clearing stale completion verification after a progress edit', () => {
    const currentBase = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'Complete', percentComplete: 100 },
      id: 'task-2',
      now: '2026-07-18T18:00:00.000Z',
      actor: 'pm@example.com',
    });
    const current: DAVEWebScheduleItem = {
      ...currentBase,
      scheduleProjectName: '2375 Compliance Project',
      projectName: 'Canopy C',
      importBatchId: 'batch-1',
      sourceDocumentId: 'document-1',
      cloudUpdatedAt: '2026-07-18T18:00:01.000Z',
      completionVerification: {
        status: 'pm_verified',
        reportedAt: '2026-07-18T18:00:00.000Z',
        reportedBy: 'PM',
        priorScheduleStatus: 'In Progress',
        priorPercentComplete: 90,
        verifiedAt: '2026-07-18T18:00:00.000Z',
        verifiedBy: 'PM',
        verificationNote: null,
        evidence: [],
      },
    };

    const updated = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'In Progress', percentComplete: 80 },
      current,
      id: current.id,
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated.importBatchId).toBe('batch-1');
    expect(updated.sourceDocumentId).toBe('document-1');
    expect(updated.scheduleProjectName).toBe('2375 Compliance Project');
    expect(updated.projectName).toBe('Canopy C');
    expect(updated.completionVerification).toBeNull();
    expect(updated.cloudUpdatedAt).toBe('2026-07-18T18:00:01.000Z');
  });

  test('reopens a completed task when only its status is changed', () => {
    const current = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'Complete', percentComplete: 100 },
      id: 'task-reopen-status',
      now: '2026-07-18T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    const updated = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'In Progress', percentComplete: 100 },
      current,
      id: current.id,
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated.status).toBe('In Progress');
    expect(updated.percentComplete).toBe(99);
  });

  test('reopens a completed task when only its percent is reduced', () => {
    const current = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'Complete', percentComplete: 100 },
      id: 'task-reopen-percent',
      now: '2026-07-18T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    const updated = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, status: 'Complete', percentComplete: 50 },
      current,
      id: current.id,
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated.status).toBe('In Progress');
    expect(updated.percentComplete).toBe(50);
  });

  test('removes browser-only revision metadata before cloud persistence', () => {
    const task = buildDAVEWebScheduleItem({
      draft: BASE_DRAFT,
      id: 'task-3',
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(scheduleItemForCloud({ ...task, cloudUpdatedAt: 'cloud-revision' })).not.toHaveProperty('cloudUpdatedAt');
  });

  test('rejects missing task and project identity', () => {
    expect(() => buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, taskName: '  ' },
      id: 'task-4',
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    })).toThrow(DAVEWebTaskValidationError);

    expect(() => buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, projectName: '' },
      id: 'task-5',
      now: '2026-07-19T18:00:00.000Z',
      actor: 'pm@example.com',
    })).toThrow('Project is required.');
  });
});
