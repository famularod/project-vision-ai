import {
  buildDAVEWebScheduleItem,
  DAVEWebTaskValidationError,
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';

const BASE_DRAFT: DAVEWebTaskDraft = {
  itemType: 'Task',
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
  nextAction: 'Confirm anchor delivery.',
  activityMessage: '',
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

  test('persists project item type, next action, and append-only activity', () => {
    const created = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        activityMessage: 'Called the steel contractor.',
      },
      id: 'issue-1',
      now: '2026-07-22T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(created.itemType).toBe('Issue');
    expect(created.nextAction).toBe('Confirm anchor delivery.');
    expect(created.activity).toEqual([
      expect.objectContaining({
        message: 'Called the steel contractor.',
        author: 'pm@example.com',
        createdAt: '2026-07-22T18:00:00.000Z',
      }),
    ]);

    const updated = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        activityMessage: 'Delivery confirmed for tomorrow.',
      },
      current: created,
      id: created.id,
      now: '2026-07-22T19:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated.activity).toHaveLength(2);
    expect(updated.activity?.[0].message).toBe('Called the steel contractor.');
    expect(updated.activity?.[1].message).toBe('Delivery confirmed for tomorrow.');
  });

  test('rejects structured completion bypasses and uses explicit close/reopen transitions', () => {
    const issue = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
      },
      id: 'issue-workflow-1',
      now: '2026-07-22T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(() => buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        status: 'Complete',
        percentComplete: 100,
      },
      current: issue,
      id: issue.id,
      now: '2026-07-22T19:00:00.000Z',
      actor: 'pm@example.com',
    })).toThrow('Use "Close Issue"');

    const closed = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        workflowAction: 'close',
        activityMessage: 'Field outcome verified.',
      },
      current: issue,
      id: issue.id,
      now: '2026-07-22T19:00:00.000Z',
      actor: 'signed-in-pm@example.com',
    });
    expect(closed).toMatchObject({
      status: 'Complete',
      percentComplete: 100,
      progressConfirmedBy: 'signed-in-pm@example.com',
      projectControls: {
        workflowStage: 'Closed',
        updatedBy: 'signed-in-pm@example.com',
      },
    });
    expect(closed.activity?.at(-1)).toEqual(expect.objectContaining({
      message: 'Issue closed: Field outcome verified.',
      author: 'signed-in-pm@example.com',
    }));

    expect(() => buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        status: 'In Progress',
        percentComplete: 80,
      },
      current: closed,
      id: closed.id,
      now: '2026-07-22T20:00:00.000Z',
      actor: 'signed-in-pm@example.com',
    })).toThrow('Use "Reopen Issue"');
    expect(() => buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'RFI',
        status: 'Complete',
        percentComplete: 100,
      },
      current: closed,
      id: closed.id,
      now: '2026-07-22T20:00:00.000Z',
      actor: 'signed-in-pm@example.com',
    })).toThrow('Reopen Issue before changing its project item type.');
    expect(() => buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'RFI',
        status: 'Complete',
        percentComplete: 100,
        workflowAction: 'reopen',
      },
      current: closed,
      id: closed.id,
      now: '2026-07-22T20:00:00.000Z',
      actor: 'signed-in-pm@example.com',
    })).toThrow('Reopen Issue before changing its project item type.');

    const reopened = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        status: 'Complete',
        percentComplete: 100,
        workflowAction: 'reopen',
        activityMessage: 'Additional work discovered.',
      },
      current: closed,
      id: closed.id,
      now: '2026-07-22T21:00:00.000Z',
      actor: 'signed-in-pm@example.com',
    });
    expect(reopened).toMatchObject({
      status: 'In Progress',
      percentComplete: 99,
      projectControls: {
        workflowStage: 'Open',
      },
    });
    expect(reopened.activity?.at(-1)).toEqual(expect.objectContaining({
      message: 'Issue reopened: Additional work discovered.',
      author: 'signed-in-pm@example.com',
    }));
  });

  test('allows a closed structured record to receive non-transition detail corrections', () => {
    const issue = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
      },
      id: 'issue-workflow-detail',
      now: '2026-07-22T18:00:00.000Z',
      actor: 'pm@example.com',
    });
    const closed = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        workflowAction: 'close',
      },
      current: issue,
      id: issue.id,
      now: '2026-07-22T19:00:00.000Z',
      actor: 'pm@example.com',
    });

    const corrected = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        itemType: 'Issue',
        status: 'Complete',
        percentComplete: 100,
        notes: 'Corrected closeout detail.',
      },
      current: closed,
      id: closed.id,
      now: '2026-07-22T20:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(corrected.notes).toBe('Corrected closeout detail.');
    expect(corrected.status).toBe('Complete');
    expect(corrected.percentComplete).toBe(100);
  });

  test('preserves planning hierarchy, baselines, and dependencies during ordinary edits', () => {
    const created = buildDAVEWebScheduleItem({
      draft: BASE_DRAFT,
      id: 'planned-task',
      now: '2026-07-22T18:00:00.000Z',
      actor: 'pm@example.com',
    });
    const current: DAVEWebScheduleItem = {
      ...created,
      wbsCode: '1.2.3',
      parentItemId: 'phase-1',
      sortOrder: 20,
      dependencies: [{
        predecessorItemId: 'predecessor',
        type: 'FS',
        lagDays: 2,
      }],
      isMilestone: false,
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-24',
      isSummary: false,
    };

    const updated = buildDAVEWebScheduleItem({
      draft: { ...BASE_DRAFT, notes: 'Edited without changing schedule logic.' },
      current,
      id: current.id,
      now: '2026-07-23T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated).toMatchObject({
      wbsCode: '1.2.3',
      parentItemId: 'phase-1',
      sortOrder: 20,
      dependencies: [{
        predecessorItemId: 'predecessor',
        type: 'FS',
        lagDays: 2,
      }],
      isMilestone: false,
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-24',
      isSummary: false,
    });
  });

  test('accepts schedule-builder planning changes without affecting PM progress authority', () => {
    const current = buildDAVEWebScheduleItem({
      draft: BASE_DRAFT,
      id: 'schedule-builder-task',
      now: '2026-07-22T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    const updated = buildDAVEWebScheduleItem({
      draft: {
        ...BASE_DRAFT,
        wbsCode: '3.1',
        parentItemId: 'phase-3',
        sortOrder: '30',
        durationDays: '4',
        dependencies: [{
          predecessorItemId: 'predecessor',
          type: 'FS',
          lagDays: 1,
        }],
        isSummary: false,
        isMilestone: false,
        baselineStartDate: '2026-07-20',
        baselineFinishDate: '2026-07-23',
      },
      current,
      id: current.id,
      now: '2026-07-23T18:00:00.000Z',
      actor: 'pm@example.com',
    });

    expect(updated).toMatchObject({
      wbsCode: '3.1',
      parentItemId: 'phase-3',
      sortOrder: 30,
      durationDays: 4,
      dependencies: [{
        predecessorItemId: 'predecessor',
        type: 'FS',
        lagDays: 1,
      }],
      isSummary: false,
      isMilestone: false,
      baselineStartDate: '2026-07-20',
      baselineFinishDate: '2026-07-23',
      progressSource: 'project_manager',
    });
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
