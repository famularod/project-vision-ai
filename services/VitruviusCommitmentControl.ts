import type { ProjectUpdate, ScheduleItem } from '../types';
import { daysUntilDate, dueStatusText } from '../utils/date';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';
import { normalizeProjectControls } from './VitruviusProjectControls';

export type VitruviusCommitmentState =
  | 'needs_verification'
  | 'missed'
  | 'at_risk'
  | 'promised'
  | 'verified';

export type VitruviusCommitmentControlItem = Readonly<{
  id: string;
  projectName: string;
  taskName: string;
  areaName: string;
  promise: string;
  owner: string;
  dueDate: string | null;
  timing: string;
  state: VitruviusCommitmentState;
  stateLabel: string;
  recoveryAction: string;
  decisionNeeded: string;
  proofNeeded: string;
  latestFieldUpdateAt: string | null;
  priority: ScheduleItem['priority'];
}>;

export type VitruviusCommitmentControl = Readonly<{
  items: readonly VitruviusCommitmentControlItem[];
  actionableItems: readonly VitruviusCommitmentControlItem[];
  topItem: VitruviusCommitmentControlItem | null;
  missed: number;
  atRisk: number;
  needsVerification: number;
  promised: number;
  verified: number;
  unassigned: number;
  withoutDueDate: number;
}>;

export function buildVitruviusCommitmentControl({
  scheduleItems,
  updates,
  projectNames,
  now = new Date(),
}: {
  scheduleItems: readonly ScheduleItem[];
  updates: readonly ProjectUpdate[];
  projectNames?: readonly string[];
  now?: Date;
}): VitruviusCommitmentControl {
  const projectScope = new Set((projectNames || []).map(normalizedKey).filter(Boolean));
  const scopedItems = scheduleItems.filter(item =>
    projectScope.size === 0 ||
    projectScope.has(normalizedKey(parentProjectName(item))),
  );
  const updatesByTask = groupUpdatesByTask(updates);
  const items = scopedItems
    .map(item => commitmentItem(item, updatesByTask.get(normalizedKey(item.id)) || [], now))
    .sort(compareCommitments);
  const actionableItems = items.filter(item => item.state !== 'verified');

  return Object.freeze({
    items: Object.freeze(items),
    actionableItems: Object.freeze(actionableItems),
    topItem: actionableItems[0] || null,
    missed: countState(items, 'missed'),
    atRisk: countState(items, 'at_risk'),
    needsVerification: countState(items, 'needs_verification'),
    promised: countState(items, 'promised'),
    verified: countState(items, 'verified'),
    unassigned: items.filter(item => item.owner === 'Unassigned').length,
    withoutDueDate: items.filter(item => !item.dueDate).length,
  });
}

function commitmentItem(
  item: ScheduleItem,
  matchingUpdates: readonly ProjectUpdate[],
  now: Date,
): VitruviusCommitmentControlItem {
  const controls = normalizeProjectControls(item.projectControls);
  const projectName = parentProjectName(item);
  const owner = firstText(
    controls.assignee,
    item.owner,
    item.contractor,
    controls.trade,
  ) || 'Unassigned';
  const dueDate = firstText(controls.responseDueDate, item.finishDate) || null;
  const days = dueDate
    ? daysUntilDate(dueDate, now, item.projectTimeZone || undefined)
    : null;
  const state = commitmentState(item, controls, days);
  const latestFieldUpdateAt = latestUpdateDate(matchingUpdates);
  const promise = item.taskName.trim() || 'Unnamed project commitment';
  const recoveryAction = recoveryActionFor(item, state, owner, dueDate);

  return Object.freeze({
    id: item.id,
    projectName,
    taskName: promise,
    areaName: item.locationName.trim() || 'No area assigned',
    promise,
    owner,
    dueDate,
    timing: dueDate
      ? dueStatusText(dueDate, now, item.projectTimeZone || undefined)
      : 'No due date',
    state,
    stateLabel: stateLabel(state),
    recoveryAction,
    decisionNeeded: decisionNeededFor(state, owner, dueDate),
    proofNeeded: proofNeededFor(item, state, latestFieldUpdateAt),
    latestFieldUpdateAt,
    priority: item.priority,
  });
}

function commitmentState(
  item: ScheduleItem,
  controls: ReturnType<typeof normalizeProjectControls>,
  days: number | null,
): VitruviusCommitmentState {
  const verification = item.completionVerification?.status;
  if (
    verification === 'reported_complete' ||
    verification === 'evidence_supported' ||
    verification === 'conflicting_evidence'
  ) {
    return 'needs_verification';
  }
  if (scheduleTaskIsComplete(item)) return 'verified';
  if (days !== null && days < 0) return 'missed';
  if (
    item.status === 'Waiting' ||
    (days !== null && days <= 7) ||
    (controls.estimatedScheduleImpactDays ?? 0) > 0 ||
    controls.approvalStatus === 'Changes Requested' ||
    controls.approvalStatus === 'Pending'
  ) {
    return 'at_risk';
  }
  return 'promised';
}

function recoveryActionFor(
  item: ScheduleItem,
  state: VitruviusCommitmentState,
  owner: string,
  dueDate: string | null,
): string {
  const savedAction = item.nextAction?.trim();
  if (savedAction) return savedAction;
  if (owner === 'Unassigned') return 'Assign one accountable owner.';
  if (!dueDate) return 'Set the next accountable date.';
  if (state === 'needs_verification') {
    return 'Confirm the current condition, then keep or correct the saved task status.';
  }
  if (state === 'missed') return 'Set a recovery date and record the next field action.';
  if (item.status === 'Waiting') return 'Resolve the waiting condition and confirm the recovery date.';
  if (state === 'at_risk') return 'Confirm the crew, access, and materials needed to protect the due date.';
  return 'Record the next material change when work advances.';
}

function decisionNeededFor(
  state: VitruviusCommitmentState,
  owner: string,
  dueDate: string | null,
): string {
  if (owner === 'Unassigned') return 'Choose the accountable owner.';
  if (!dueDate) return 'Choose the accountable date.';
  if (state === 'needs_verification') return 'Confirm whether the saved task status is correct.';
  if (state === 'missed') return 'Approve the recovery date and next action.';
  if (state === 'at_risk') return 'Confirm the recovery plan or revise the due date.';
  if (state === 'verified') return 'No decision is currently required.';
  return 'No immediate decision is required.';
}

function proofNeededFor(
  item: ScheduleItem,
  state: VitruviusCommitmentState,
  latestFieldUpdateAt: string | null,
): string {
  if (state === 'needs_verification') {
    return 'Review the linked completion claim and record the PM decision.';
  }
  if (state === 'verified') return 'The PM-confirmed task record is current.';
  if (latestFieldUpdateAt) {
    return 'Confirm that the latest field update still reflects the current condition.';
  }
  if (item.status === 'Waiting') return 'Add the blocker and the person responsible for clearing it.';
  return 'Add a current field photo or note when the condition changes.';
}

function groupUpdatesByTask(updates: readonly ProjectUpdate[]) {
  const grouped = new Map<string, ProjectUpdate[]>();
  updates.forEach(update => {
    const key = normalizedKey(update.scheduleItemId);
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), update]);
  });
  return grouped;
}

function latestUpdateDate(updates: readonly ProjectUpdate[]): string | null {
  return updates
    .map(update => update.date?.trim())
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => timestamp(right) - timestamp(left))[0] || null;
}

function compareCommitments(
  left: VitruviusCommitmentControlItem,
  right: VitruviusCommitmentControlItem,
) {
  const stateDifference = stateRank(left.state) - stateRank(right.state);
  if (stateDifference) return stateDifference;
  const priorityDifference = priorityRank(right.priority) - priorityRank(left.priority);
  if (priorityDifference) return priorityDifference;
  const leftDue = left.dueDate ? timestamp(left.dueDate) : Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueDate ? timestamp(right.dueDate) : Number.MAX_SAFE_INTEGER;
  if (leftDue !== rightDue) return leftDue - rightDue;
  return left.taskName.localeCompare(right.taskName);
}

function stateRank(state: VitruviusCommitmentState) {
  return {
    needs_verification: 0,
    missed: 1,
    at_risk: 2,
    promised: 3,
    verified: 4,
  }[state];
}

function priorityRank(priority: ScheduleItem['priority']) {
  return priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
}

function stateLabel(state: VitruviusCommitmentState) {
  return {
    needs_verification: 'Needs Verification',
    missed: 'Overdue',
    at_risk: 'At Risk',
    promised: 'Open',
    verified: 'Verified',
  }[state];
}

function countState(
  items: readonly VitruviusCommitmentControlItem[],
  state: VitruviusCommitmentState,
) {
  return items.filter(item => item.state === state).length;
}

function parentProjectName(item: ScheduleItem) {
  return item.scheduleProjectName?.trim() || item.projectName.trim() || 'Project';
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map(value => value?.trim() || '').find(Boolean) || '';
}

function normalizedKey(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
