import {
  appendProjectItemActivity,
  closeProjectItemWorkflow,
  normalizeProjectItemActivity,
  normalizeProjectItemType,
  projectItemWorkflowIsClosed,
  projectItemWorkflowReadiness,
  reopenProjectItemWorkflow,
  resolveProjectItemWorkflowMutation,
  validateProjectItemWorkflowEdit,
  WORKFLOW_PROJECT_ITEM_TYPES,
} from '../../services/ProjectItemWorkflow';
import type {
  ProjectControls,
  ProjectItemType,
  ScheduleItem,
} from '../../types';

const NOW = '2026-07-26T18:00:00.000Z';

function controls(overrides: Partial<ProjectControls> = {}): ProjectControls {
  return {
    version: 1,
    assignee: 'David',
    trade: 'General contractor',
    watchers: [],
    approvers: ['Project manager'],
    approvalStatus: 'Not Required',
    workflowStage: 'Open',
    referenceNumber: 'PC-001',
    responseDueDate: '2026-07-30',
    checklist: [],
    linkedRecords: [],
    resources: [],
    estimatedCostImpact: null,
    estimatedScheduleImpactDays: null,
    impactConfidence: 'Medium',
    impactNotes: '',
    revision: 2,
    updatedAt: '2026-07-25T18:00:00.000Z',
    updatedBy: 'David',
    ...overrides,
  };
}

function workflowItem(
  itemType: ProjectItemType,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  const requiresChecklist =
    itemType === 'Inspection' || itemType === 'Quality Check';
  return {
    id: `item-${itemType.toLowerCase().replace(/\s+/g, '-')}`,
    itemType,
    projectName: '2375 Compliance Project',
    scheduleProjectName: '2375 Compliance Project',
    locationName: 'Canopy C',
    taskName: `${itemType} record`,
    startDate: '2026-07-26',
    finishDate: '2026-07-30',
    milestone: '',
    owner: 'David',
    contractor: 'General contractor',
    percentComplete: 50,
    priority: 'High',
    status: 'In Progress',
    notes: 'The field outcome is recorded.',
    nextAction: 'Confirm the remaining field condition.',
    activity: [],
    projectControls: controls({
      approvalStatus: itemType === 'Submittal' ? 'Approved' : 'Not Required',
      linkedRecords: itemType === 'Submittal'
        ? [{ id: 'document-1', kind: 'Document', label: 'Reviewed submittal' }]
        : [],
      checklist: requiresChecklist
        ? [{
            id: 'check-1',
            label: 'Verify the field condition',
            completed: true,
            completedAt: NOW,
            completedBy: 'David',
          }]
        : [],
    }),
    createdAt: '2026-07-25T17:00:00.000Z',
    updatedAt: '2026-07-25T18:00:00.000Z',
    ...overrides,
  };
}

describe('Project item workflow', () => {
  it('defaults legacy and invalid rows to Task without inventing other classifications', () => {
    expect(normalizeProjectItemType(undefined)).toBe('Task');
    expect(normalizeProjectItemType('Change Order')).toBe('Task');
    expect(normalizeProjectItemType('RFI')).toBe('RFI');
  });

  it('drops malformed activity while preserving valid author and chronology', () => {
    expect(normalizeProjectItemActivity([
      null,
      { message: '   ' },
      {
        id: 'activity-1',
        message: '  Delivery confirmed. ',
        author: ' PM ',
        createdAt: '2026-07-22T18:00:00.000Z',
      },
    ])).toEqual([{
      id: 'activity-1',
      message: 'Delivery confirmed.',
      author: 'PM',
      createdAt: '2026-07-22T18:00:00.000Z',
    }]);
  });

  it('appends meaningful activity and ignores blank entries', () => {
    const existing = [{
      id: 'activity-1',
      message: 'Initial call made.',
      author: 'PM',
      createdAt: '2026-07-22T18:00:00.000Z',
    }];
    expect(appendProjectItemActivity({
      activity: existing,
      message: ' ',
      author: 'PM',
      createdAt: '2026-07-22T19:00:00.000Z',
      id: 'activity-2',
    })).toEqual(existing);
    expect(appendProjectItemActivity({
      activity: existing,
      message: ' Contractor confirmed delivery. ',
      author: ' PM ',
      createdAt: '2026-07-22T19:00:00.000Z',
      id: 'activity-2',
    })).toEqual([
      existing[0],
      {
        id: 'activity-2',
        message: 'Contractor confirmed delivery.',
        author: 'PM',
        createdAt: '2026-07-22T19:00:00.000Z',
      },
    ]);
  });

  it.each(WORKFLOW_PROJECT_ITEM_TYPES)(
    'reports a complete PM record as ready to close for %s',
    itemType => {
      const readiness = projectItemWorkflowReadiness(workflowItem(itemType));

      expect(readiness).toMatchObject({
        itemType,
        supported: true,
        readyToClose: true,
        missing: [],
        message: `${itemType} is ready to close.`,
      });
    },
  );

  it('returns specific PM-facing missing information for specialized records', () => {
    const rfi = projectItemWorkflowReadiness(workflowItem('RFI', {
      owner: '',
      notes: '',
      finishDate: '',
      projectControls: controls({
        assignee: '',
        referenceNumber: '',
        responseDueDate: '',
      }),
    }));
    expect(rfi.readyToClose).toBe(false);
    expect(rfi.missing).toEqual(expect.arrayContaining([
      'Record the outcome or closing note.',
      'Assign a responsible person.',
      'Add the RFI reference number.',
      'Set the response due date.',
    ]));
    expect(rfi.message).toBe('RFI needs 4 items before it can be closed.');

    const submittal = projectItemWorkflowReadiness(workflowItem('Submittal', {
      contractor: '',
      projectControls: controls({
        trade: '',
        approvers: [],
        linkedRecords: [],
        approvalStatus: 'Pending',
      }),
    }));
    expect(submittal.missing).toEqual(expect.arrayContaining([
      'Identify the responsible trade.',
      'Assign at least one approver.',
      'Record the approved submittal document.',
      'Mark the submittal Approved before closing.',
    ]));

    const inspection = projectItemWorkflowReadiness(workflowItem('Inspection', {
      projectControls: controls({ checklist: [] }),
    }));
    expect(inspection.missing).toContain(
      'Add at least one inspection checklist item.',
    );

    const dailyLog = projectItemWorkflowReadiness(workflowItem('Daily Log', {
      startDate: '',
      finishDate: '',
      notes: '',
    }));
    expect(dailyLog.missing).toEqual(expect.arrayContaining([
      'Record the outcome or closing note.',
      'Set the daily log date.',
      'Record the daily field summary.',
    ]));
    expect(dailyLog.missing).not.toContain('Assign a responsible person.');
  });

  it('lets a closing note satisfy the outcome record without weakening other checks', () => {
    const item = workflowItem('Issue', { notes: '', activity: [] });
    expect(projectItemWorkflowReadiness(item).readyToClose).toBe(false);
    expect(projectItemWorkflowReadiness(item, {
      closingNote: 'Verified with the superintendent.',
    }).readyToClose).toBe(true);
  });

  it.each(WORKFLOW_PROJECT_ITEM_TYPES)(
    'closes %s with synchronized progress, controls, and activity',
    itemType => {
      const source = workflowItem(itemType);
      const result = closeProjectItemWorkflow({
        item: source,
        actor: ' David ',
        now: NOW,
        note: 'Field record reviewed.',
        activityId: `close-${itemType}`,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item).toMatchObject({
        status: 'Complete',
        percentComplete: 100,
        progressSource: 'project_manager',
        progressConfirmedAt: NOW,
        progressConfirmedBy: 'David',
        completionVerification: null,
        updatedAt: NOW,
        projectControls: {
          workflowStage: 'Closed',
          revision: 3,
          updatedAt: NOW,
          updatedBy: 'David',
        },
      });
      expect(result.item.activity?.at(-1)).toEqual({
        id: `close-${itemType}`,
        message: `${itemType} closed: Field record reviewed.`,
        author: 'David',
        createdAt: NOW,
      });
      expect(source.status).toBe('In Progress');
      expect(source.projectControls?.workflowStage).toBe('Open');
    },
  );

  it.each(WORKFLOW_PROJECT_ITEM_TYPES)(
    'reopens %s without leaving Complete paired with less than 100 percent',
    itemType => {
      const closed = workflowItem(itemType, {
        status: 'Complete',
        percentComplete: 100,
        projectControls: controls({ workflowStage: 'Closed' }),
        completionVerification: {
          status: 'pm_verified',
          reportedAt: NOW,
          reportedBy: 'David',
          priorScheduleStatus: 'In Progress',
          priorPercentComplete: 50,
          verifiedAt: NOW,
          verifiedBy: 'David',
          verificationNote: 'Verified',
          evidence: [],
        },
      });
      const result = reopenProjectItemWorkflow({
        item: closed,
        actor: 'David',
        now: NOW,
        note: 'Additional work discovered.',
        activityId: `reopen-${itemType}`,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.item).toMatchObject({
        status: 'In Progress',
        percentComplete: 99,
        completionVerification: null,
        projectControls: {
          workflowStage: 'Open',
          revision: 3,
        },
      });
      expect(result.item.activity?.at(-1)).toEqual(expect.objectContaining({
        id: `reopen-${itemType}`,
        message: `${itemType} reopened: Additional work discovered.`,
      }));
    },
  );

  it('rejects unsupported, premature, and repeated transitions without mutation', () => {
    const task = workflowItem('Task');
    const taskClose = closeProjectItemWorkflow({
      item: task,
      actor: 'David',
      now: NOW,
    });
    expect(taskClose).toMatchObject({
      ok: false,
      item: task,
      message: 'Regular tasks use the task completion workflow.',
    });

    const incompleteIssue = workflowItem('Issue', {
      owner: '',
      notes: '',
      activity: [],
      projectControls: controls({ assignee: '' }),
    });
    const prematureClose = closeProjectItemWorkflow({
      item: incompleteIssue,
      actor: 'David',
      now: NOW,
    });
    expect(prematureClose.ok).toBe(false);
    if (prematureClose.ok) return;
    expect(prematureClose.readiness?.missing).toEqual(expect.arrayContaining([
      'Record the outcome or closing note.',
      'Assign a responsible person.',
    ]));

    const openIssue = workflowItem('Issue');
    expect(reopenProjectItemWorkflow({
      item: openIssue,
      actor: 'David',
      now: NOW,
    })).toMatchObject({
      ok: false,
      item: openIssue,
      message: 'Issue is already open.',
    });

    const closedIssue = workflowItem('Issue', {
      status: 'Complete',
      percentComplete: 100,
      projectControls: controls({ workflowStage: 'Closed' }),
    });
    expect(closeProjectItemWorkflow({
      item: closedIssue,
      actor: 'David',
      now: NOW,
    })).toMatchObject({
      ok: false,
      item: closedIssue,
      message: 'Issue is already closed.',
    });
  });

  it('rejects ordinary edits that would bypass structured close or reopen transitions', () => {
    const openIssue = workflowItem('Issue');
    expect(projectItemWorkflowIsClosed(openIssue)).toBe(false);
    expect(validateProjectItemWorkflowEdit({
      current: openIssue,
      next: { ...openIssue, status: 'Complete', percentComplete: 100 },
    })).toEqual({
      ok: false,
      code: 'close_workflow_required',
      message: 'Use "Close Issue" after its required information is complete. Complete and 100% are recorded only by that workflow.',
    });
    expect(validateProjectItemWorkflowEdit({
      current: openIssue,
      next: { ...openIssue, percentComplete: 100 },
    })).toMatchObject({
      ok: false,
      code: 'close_workflow_required',
    });
    expect(validateProjectItemWorkflowEdit({
      current: openIssue,
      next: {
        ...openIssue,
        projectControls: controls({ workflowStage: 'Closed' }),
      },
    })).toMatchObject({
      ok: false,
      code: 'close_workflow_required',
    });
    expect(validateProjectItemWorkflowEdit({
      current: openIssue,
      next: { ...openIssue, notes: 'Ordinary detail edit.', percentComplete: 99 },
    })).toEqual({ ok: true });

    const closedIssue = workflowItem('Issue', {
      status: 'Complete',
      percentComplete: 100,
      projectControls: controls({ workflowStage: 'Closed' }),
    });
    expect(projectItemWorkflowIsClosed(closedIssue)).toBe(true);
    expect(validateProjectItemWorkflowEdit({
      current: closedIssue,
      next: { ...closedIssue, status: 'In Progress', percentComplete: 99 },
    })).toMatchObject({
      ok: false,
      code: 'reopen_workflow_required',
    });
    expect(validateProjectItemWorkflowEdit({
      current: closedIssue,
      next: {
        ...closedIssue,
        projectControls: controls({ workflowStage: 'Open' }),
      },
    })).toMatchObject({
      ok: false,
      code: 'reopen_workflow_required',
    });
    expect(validateProjectItemWorkflowEdit({
      current: closedIssue,
      next: { ...closedIssue, itemType: 'RFI' },
    })).toEqual({
      ok: false,
      code: 'reopen_before_reclassification',
      message: 'Reopen Issue before changing its project item type.',
    });
    expect(validateProjectItemWorkflowEdit({
      current: closedIssue,
      next: { ...closedIssue, notes: 'Corrected closeout detail.' },
    })).toEqual({ ok: true });
  });

  it('protects new structured records while leaving regular task completion unchanged', () => {
    const newInspection = workflowItem('Inspection', {
      status: 'Complete',
      percentComplete: 100,
    });
    expect(validateProjectItemWorkflowEdit({
      current: null,
      next: newInspection,
    })).toMatchObject({
      ok: false,
      code: 'close_workflow_required',
    });

    const task = workflowItem('Task');
    expect(projectItemWorkflowIsClosed({
      ...task,
      status: 'Complete',
      percentComplete: 100,
    })).toBe(false);
    expect(validateProjectItemWorkflowEdit({
      current: task,
      next: { ...task, status: 'Complete', percentComplete: 100 },
    })).toEqual({ ok: true });
  });

  it('enforces the native mutation boundary and recalculates authorized workflow actions', () => {
    const openIssue = workflowItem('Issue');
    const directCompletion = resolveProjectItemWorkflowMutation({
      current: openIssue,
      candidate: {
        ...openIssue,
        status: 'Complete',
        percentComplete: 100,
      },
      now: NOW,
    });
    expect(directCompletion).toMatchObject({
      ok: false,
      item: openIssue,
      message: expect.stringContaining('Use "Close Issue"'),
    });

    const completionVerificationBypass = resolveProjectItemWorkflowMutation({
      current: openIssue,
      candidate: {
        ...openIssue,
        status: 'Complete',
        percentComplete: 100,
        completionVerification: {
          status: 'pm_verified',
          reportedAt: NOW,
          reportedBy: 'Field update',
          priorScheduleStatus: 'In Progress',
          priorPercentComplete: 50,
          verifiedAt: NOW,
          verifiedBy: 'David',
          verificationNote: 'Verified in the field.',
          evidence: [],
        },
      },
      now: NOW,
    });
    expect(completionVerificationBypass.ok).toBe(false);

    const authorizedClose = resolveProjectItemWorkflowMutation({
      current: openIssue,
      candidate: {
        ...openIssue,
        status: 'Complete',
        percentComplete: 100,
      },
      request: {
        action: 'close',
        actor: 'signed-in-pm@example.com',
      },
      now: NOW,
    });
    expect(authorizedClose).toMatchObject({
      ok: true,
      item: {
        status: 'Complete',
        percentComplete: 100,
        progressConfirmedBy: 'signed-in-pm@example.com',
        projectControls: {
          workflowStage: 'Closed',
        },
      },
    });
    if (!authorizedClose.ok) return;

    const authorizedReopen = resolveProjectItemWorkflowMutation({
      current: authorizedClose.item,
      candidate: authorizedClose.item,
      request: {
        action: 'reopen',
        actor: 'signed-in-pm@example.com',
      },
      now: '2026-07-26T19:00:00.000Z',
    });
    expect(authorizedReopen).toMatchObject({
      ok: true,
      item: {
        status: 'In Progress',
        percentComplete: 99,
        projectControls: {
          workflowStage: 'Open',
        },
      },
    });
  });
});
