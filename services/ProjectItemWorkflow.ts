import {
  PROJECT_ITEM_TYPES,
  type ProjectItemActivity,
  type ProjectItemType,
  type ScheduleItem,
} from '../types';
import {
  normalizeProjectControls,
  reviseProjectControls,
} from './VitruviusProjectControls';
import { reconcileScheduleProgressEdit } from './ScheduleProgressInvariant';

export type WorkflowProjectItemType = Exclude<ProjectItemType, 'Task'>;

export const WORKFLOW_PROJECT_ITEM_TYPES = PROJECT_ITEM_TYPES.filter(
  (itemType): itemType is WorkflowProjectItemType => itemType !== 'Task',
);

export type ProjectItemWorkflowCheck = Readonly<{
  label: string;
  satisfied: boolean;
}>;

export type ProjectItemWorkflowReadiness = Readonly<{
  itemType: ProjectItemType;
  supported: boolean;
  readyToClose: boolean;
  checks: readonly ProjectItemWorkflowCheck[];
  missing: readonly string[];
  message: string;
}>;

export type ProjectItemWorkflowTransitionResult = Readonly<
  | {
      ok: true;
      action: 'close' | 'reopen';
      item: ScheduleItem;
      message: string;
    }
  | {
      ok: false;
      action: 'close' | 'reopen';
      item: ScheduleItem;
      message: string;
      readiness?: ProjectItemWorkflowReadiness;
    }
>;

export type ProjectItemWorkflowEditValidation = Readonly<
  | {
      ok: true;
    }
  | {
      ok: false;
      code:
        | 'close_workflow_required'
        | 'reopen_workflow_required'
        | 'reopen_before_reclassification';
      message: string;
    }
>;

export type ProjectItemWorkflowMutationRequest = Readonly<{
  action: 'close' | 'reopen';
  actor: string;
  note?: string;
}>;

export type ProjectItemWorkflowMutationResult = Readonly<
  | {
      ok: true;
      item: ScheduleItem;
      message: string;
    }
  | {
      ok: false;
      item: ScheduleItem;
      message: string;
    }
>;

type ProjectItemWorkflowTransitionInput = Readonly<{
  item: ScheduleItem;
  actor: string;
  now: string;
  note?: string;
  activityId?: string;
}>;

export function normalizeProjectItemType(value: unknown): ProjectItemType {
  return PROJECT_ITEM_TYPES.includes(value as ProjectItemType)
    ? value as ProjectItemType
    : 'Task';
}

export function normalizeProjectItemActivity(
  value: unknown,
  createId: () => string = () => `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
): ProjectItemActivity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Partial<ProjectItemActivity>;
    const message = clean(record.message);
    if (!message) return [];
    return [{
      id: clean(record.id) || createId(),
      message,
      author: clean(record.author) || 'Project manager',
      createdAt: clean(record.createdAt) || new Date().toISOString(),
    }];
  });
}

/**
 * Structured records deliberately treat "closed" as a three-field state. This
 * helper also recognizes older partially-closed records so they can only be
 * reopened through the explicit workflow.
 */
export function projectItemWorkflowIsClosed(
  item: Pick<
    ScheduleItem,
    'itemType' | 'status' | 'percentComplete' | 'projectControls'
  >,
): boolean {
  if (normalizeProjectItemType(item.itemType) === 'Task') return false;
  return item.status === 'Complete' ||
    item.percentComplete >= 100 ||
    normalizeProjectControls(item.projectControls).workflowStage === 'Closed';
}

/**
 * Guards ordinary edit forms from bypassing the structured close/reopen
 * workflow. Transition functions intentionally do not call this guard because
 * they are the only authorized way to move the protected fields.
 */
export function validateProjectItemWorkflowEdit({
  current,
  next,
}: {
  current: ScheduleItem | null | undefined;
  next: ScheduleItem;
}): ProjectItemWorkflowEditValidation {
  const currentType = normalizeProjectItemType(current?.itemType);
  const nextType = normalizeProjectItemType(next.itemType);
  const currentStructured = Boolean(current && currentType !== 'Task');
  const nextStructured = nextType !== 'Task';
  const currentClosed = Boolean(
    current && currentStructured && projectItemWorkflowIsClosed(current),
  );

  if (current && currentClosed && nextType !== currentType) {
    return {
      ok: false,
      code: 'reopen_before_reclassification',
      message: `Reopen ${currentType} before changing its project item type.`,
    };
  }

  if (current && currentClosed) {
    const currentStage = normalizeProjectControls(
      current.projectControls,
    ).workflowStage;
    const nextStage = normalizeProjectControls(next.projectControls).workflowStage;
    const protectedClosureChanged =
      next.status !== current.status ||
      next.percentComplete !== current.percentComplete ||
      nextStage !== currentStage;
    if (protectedClosureChanged) {
      return {
        ok: false,
        code: 'reopen_workflow_required',
        message: `Use "Reopen ${currentType}" before changing status or percent complete.`,
      };
    }
  }

  const nextRequestsClosure =
    next.status === 'Complete' ||
    next.percentComplete >= 100 ||
    normalizeProjectControls(next.projectControls).workflowStage === 'Closed';
  if (!currentClosed && (currentStructured || nextStructured) && nextRequestsClosure) {
    const protectedType = currentStructured ? currentType : nextType;
    return {
      ok: false,
      code: 'close_workflow_required',
      message: `Use "Close ${protectedType}" after its required information is complete. Complete and 100% are recorded only by that workflow.`,
    };
  }

  return { ok: true };
}

/**
 * Authoritative mutation boundary for every native structured-record edit.
 * Ordinary edits are validated against the complete next record. Close and
 * reopen requests are recalculated from the current record here, so a caller
 * cannot bypass the workflow by supplying protected status fields directly.
 */
export function resolveProjectItemWorkflowMutation({
  current,
  candidate,
  request,
  now,
}: {
  current: ScheduleItem;
  candidate: ScheduleItem;
  request?: ProjectItemWorkflowMutationRequest;
  now: string;
}): ProjectItemWorkflowMutationResult {
  if (!request) {
    const validation = validateProjectItemWorkflowEdit({
      current,
      next: candidate,
    });
    return validation.ok
      ? { ok: true, item: candidate, message: 'Project item edit authorized.' }
      : {
          ok: false,
          item: current,
          message: validation.message,
        };
  }

  const transition = request.action === 'close'
    ? closeProjectItemWorkflow({
        item: current,
        actor: request.actor,
        note: request.note,
        now,
      })
    : reopenProjectItemWorkflow({
        item: current,
        actor: request.actor,
        note: request.note,
        now,
      });

  return transition.ok
    ? {
        ok: true,
        item: transition.item,
        message: transition.message,
      }
    : {
        ok: false,
        item: current,
        message: transition.message,
      };
}

export function appendProjectItemActivity({
  activity,
  message,
  author,
  createdAt,
  id,
}: {
  activity: readonly ProjectItemActivity[] | null | undefined;
  message: string;
  author: string;
  createdAt: string;
  id: string;
}): ProjectItemActivity[] {
  const cleanMessage = message.trim();
  if (!cleanMessage) return [...(activity || [])];
  return [
    ...(activity || []),
    {
      id,
      message: cleanMessage,
      author: author.trim() || 'Project manager',
      createdAt,
    },
  ];
}

/**
 * Returns the PM-facing information still needed before a structured project
 * item can be closed. This deliberately uses the existing task JSON fields and
 * projectControls so the result can travel through the current sync path.
 */
export function projectItemWorkflowReadiness(
  item: ScheduleItem,
  options: Readonly<{ closingNote?: string }> = {},
): ProjectItemWorkflowReadiness {
  const itemType = normalizeProjectItemType(item.itemType);
  if (itemType === 'Task') {
    return {
      itemType,
      supported: false,
      readyToClose: false,
      checks: [],
      missing: ['Choose a project-control item type before closing this record.'],
      message: 'Regular tasks use the task completion workflow.',
    };
  }

  const controls = normalizeProjectControls(item.projectControls);
  const closingRecordPresent = Boolean(
    clean(options.closingNote) ||
    clean(item.notes) ||
    item.activity?.some(entry => Boolean(clean(entry.message))),
  );
  const assigneePresent = Boolean(clean(controls.assignee) || clean(item.owner));
  const responsibleTradePresent = Boolean(
    clean(controls.trade) || clean(item.contractor),
  );
  const dueDatePresent = Boolean(
    clean(controls.responseDueDate) || clean(item.finishDate),
  );
  const projectPresent = Boolean(
    clean(item.scheduleProjectName) || clean(item.projectName),
  );
  const incompleteChecklist = controls.checklist.filter(check => !check.completed);
  const approvalPending =
    controls.approvalStatus === 'Pending' ||
    controls.approvalStatus === 'Changes Requested';

  const checks: ProjectItemWorkflowCheck[] = [
    check('Add a clear title.', Boolean(clean(item.taskName))),
    check('Choose a project.', projectPresent),
    check('Record the outcome or closing note.', closingRecordPresent),
  ];

  if (itemType !== 'Daily Log') {
    checks.push(check('Assign a responsible person.', assigneePresent));
  }

  if (itemType === 'RFI' || itemType === 'Submittal') {
    checks.push(
      check(`Add the ${itemType} reference number.`, Boolean(clean(controls.referenceNumber))),
      check('Set the response due date.', dueDatePresent),
    );
  }

  if (itemType === 'Submittal') {
    checks.push(
      check('Identify the responsible trade.', responsibleTradePresent),
      check('Assign at least one approver.', controls.approvers.length > 0),
      check('Record the approved submittal document.', controls.linkedRecords.length > 0),
      check('Mark the submittal Approved before closing.', controls.approvalStatus === 'Approved'),
    );
  } else if (itemType === 'Decision') {
    checks.push(check(
      'Resolve the decision approval before closing.',
      controls.approvalStatus === 'Approved' ||
        controls.approvalStatus === 'Not Required',
    ));
  } else {
    checks.push(check('Resolve the pending approval before closing.', !approvalPending));
  }

  if (itemType === 'Daily Log') {
    checks.push(
      check('Set the daily log date.', Boolean(clean(item.startDate) || clean(item.finishDate))),
      check('Record the daily field summary.', Boolean(clean(item.notes))),
    );
  }

  if (itemType === 'Meeting') {
    checks.push(
      check('Set the meeting date.', Boolean(clean(item.startDate) || clean(item.finishDate))),
      check('Record at least one attendee.', controls.watchers.length > 0),
      check('Record at least one decision or action item.', controls.checklist.length > 0),
    );
  }

  if (itemType === 'Risk') {
    checks.push(
      check('Set the risk review date.', dueDatePresent),
      check('Record the risk impact or mitigation.', Boolean(clean(controls.impactNotes))),
      check('Add at least one mitigation check.', controls.checklist.length > 0),
    );
  }

  if (itemType === 'Transmittal') {
    checks.push(
      check('Add the transmittal reference number.', Boolean(clean(controls.referenceNumber))),
      check('Identify at least one recipient.', controls.watchers.length > 0),
      check('Link at least one issued document.', controls.linkedRecords.length > 0),
    );
  }

  if (itemType === 'Inspection' || itemType === 'Quality Check') {
    checks.push(check(
      `Add at least one ${itemType === 'Inspection' ? 'inspection' : 'quality'} checklist item.`,
      controls.checklist.length > 0,
    ));
  }

  if (controls.checklist.length > 0) {
    checks.push(check(
      `Complete the ${incompleteChecklist.length} remaining checklist ${
        incompleteChecklist.length === 1 ? 'item' : 'items'
      }.`,
      incompleteChecklist.length === 0,
    ));
  }

  const missing = checks
    .filter(requirement => !requirement.satisfied)
    .map(requirement => requirement.label);
  const readyToClose = missing.length === 0;
  return {
    itemType,
    supported: true,
    readyToClose,
    checks,
    missing,
    message: readyToClose
      ? `${itemType} is ready to close.`
      : `${itemType} needs ${missing.length} ${
          missing.length === 1 ? 'item' : 'items'
        } before it can be closed.`,
  };
}

/**
 * Closes a structured project item only after its PM-facing record is ready.
 * The task status/percent and project-control stage move together, and the
 * change is retained in the append-only activity history.
 */
export function closeProjectItemWorkflow(
  input: ProjectItemWorkflowTransitionInput,
): ProjectItemWorkflowTransitionResult {
  const readiness = projectItemWorkflowReadiness(input.item, {
    closingNote: input.note,
  });
  if (!readiness.supported || !readiness.readyToClose) {
    return {
      ok: false,
      action: 'close',
      item: input.item,
      readiness,
      message: readiness.message,
    };
  }

  const controls = normalizeProjectControls(input.item.projectControls);
  const alreadyClosed =
    controls.workflowStage === 'Closed' &&
    input.item.status === 'Complete' &&
    input.item.percentComplete === 100;
  if (alreadyClosed) {
    return {
      ok: false,
      action: 'close',
      item: input.item,
      readiness,
      message: `${readiness.itemType} is already closed.`,
    };
  }

  const itemType = readiness.itemType as WorkflowProjectItemType;
  const actor = clean(input.actor) || 'Project manager';
  const progress = reconcileScheduleProgressEdit(input.item, {
    status: 'Complete',
  });
  const activity = appendProjectItemActivity({
    activity: input.item.activity,
    message: transitionMessage(itemType, 'closed', input.note),
    author: actor,
    createdAt: input.now,
    id: input.activityId || transitionActivityId(
      input.item.id,
      'closed',
      input.now,
    ),
  });
  return {
    ok: true,
    action: 'close',
    message: `${itemType} closed.`,
    item: {
      ...input.item,
      ...progress,
      progressSource: 'project_manager',
      progressConfirmedAt: input.now,
      progressConfirmedBy: actor,
      completionVerification: null,
      projectControls: reviseProjectControls({
        current: controls,
        patch: { workflowStage: 'Closed' },
        actor,
        now: input.now,
      }),
      activity,
      updatedAt: input.now,
    },
  };
}

/**
 * Reopens only a previously closed structured project item. Reopening through
 * the status-only edit path safely reduces a prior 100% value to 99%.
 */
export function reopenProjectItemWorkflow(
  input: ProjectItemWorkflowTransitionInput,
): ProjectItemWorkflowTransitionResult {
  const itemType = normalizeProjectItemType(input.item.itemType);
  const controls = normalizeProjectControls(input.item.projectControls);
  if (itemType === 'Task') {
    return {
      ok: false,
      action: 'reopen',
      item: input.item,
      message: 'Regular tasks use the task completion workflow.',
    };
  }
  const closed =
    controls.workflowStage === 'Closed' ||
    input.item.status === 'Complete' ||
    input.item.percentComplete >= 100;
  if (!closed) {
    return {
      ok: false,
      action: 'reopen',
      item: input.item,
      message: `${itemType} is already open.`,
    };
  }

  const actor = clean(input.actor) || 'Project manager';
  const progress = reconcileScheduleProgressEdit(input.item, {
    status: 'In Progress',
  });
  const activity = appendProjectItemActivity({
    activity: input.item.activity,
    message: transitionMessage(itemType, 'reopened', input.note),
    author: actor,
    createdAt: input.now,
    id: input.activityId || transitionActivityId(
      input.item.id,
      'reopened',
      input.now,
    ),
  });
  return {
    ok: true,
    action: 'reopen',
    message: `${itemType} reopened.`,
    item: {
      ...input.item,
      ...progress,
      progressSource: 'project_manager',
      progressConfirmedAt: input.now,
      progressConfirmedBy: actor,
      completionVerification: null,
      projectControls: reviseProjectControls({
        current: controls,
        patch: { workflowStage: 'Open' },
        actor,
        now: input.now,
      }),
      activity,
      updatedAt: input.now,
    },
  };
}

function check(label: string, satisfied: boolean): ProjectItemWorkflowCheck {
  return { label, satisfied };
}

function transitionMessage(
  itemType: WorkflowProjectItemType,
  action: 'closed' | 'reopened',
  note: string | undefined,
): string {
  const cleanNote = clean(note);
  return cleanNote
    ? `${itemType} ${action}: ${cleanNote}`
    : `${itemType} ${action}.`;
}

function transitionActivityId(
  itemId: string,
  action: 'closed' | 'reopened',
  now: string,
): string {
  return `activity-${action}-${itemId}-${now}`;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
