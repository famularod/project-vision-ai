import type { ProjectUpdate, ScheduleItem } from '../types';
import { parseFlexibleDate } from '../utils/date';
import type {
  PIEScheduleReconciliationWarning,
} from './PIEScheduleReconciliation';
import { scheduleHasAuthoritativeProgressJudgment } from './PIEScheduleReconciliation';
import type {
  PIEScheduleDependencyNode,
} from './PIEScheduleDependencyNetwork';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

export type DAVEActionInboxKind =
  | 'completion_verification'
  | 'schedule_conflict'
  | 'dependency_blocker'
  | 'schedule_deadline'
  | 'field_action';

export type DAVEActionInboxPriority = 'critical' | 'high' | 'medium' | 'low';

export type DAVEActionInboxItem = Readonly<{
  id: string;
  kind: DAVEActionInboxKind;
  priority: DAVEActionInboxPriority;
  projectName: string;
  areaName: string | null;
  title: string;
  summary: string;
  requestedAction: string;
  owner: string | null;
  dueDate: string | null;
  dueDays: number | null;
  scheduleItemId: string | null;
  updateId: string | null;
  photoId: string | null;
  requiresVerification: boolean;
}>;

export type DAVEActionInbox = Readonly<{
  generatedAt: string;
  items: DAVEActionInboxItem[];
  criticalCount: number;
  verificationCount: number;
  overdueCount: number;
  undatedActionCount: number;
}>;

export function buildDAVEActionInbox({
  scheduleItems = [],
  updates = [],
  reconciliationWarnings = [],
  dependencyNodes = [],
  now = new Date(),
}: {
  scheduleItems?: readonly ScheduleItem[];
  updates?: readonly ProjectUpdate[];
  reconciliationWarnings?: readonly PIEScheduleReconciliationWarning[];
  dependencyNodes?: readonly PIEScheduleDependencyNode[];
  now?: Date;
} = {}): DAVEActionInbox {
  const items: DAVEActionInboxItem[] = [];
  const scheduleById = new Map(scheduleItems.map(item => [item.id, item]));

  scheduleItems.forEach(item => {
    const verification = item.completionVerification;
    if (
      verification?.status === 'reported_complete' ||
      verification?.status === 'evidence_supported' ||
      verification?.status === 'conflicting_evidence'
    ) {
      const conflicting = verification.status === 'conflicting_evidence';
      items.push(inboxItem({
        id: `dave-action:completion-verification:${item.id}`,
        kind: 'completion_verification',
        priority: conflicting ? 'critical' : 'high',
        projectName: projectNameFor(item),
        areaName: clean(item.locationName),
        title: conflicting ? `Resolve conflicting completion evidence: ${label(item)}` : `Verify reported completion: ${label(item)}`,
        summary: verification.evidence[0]?.summary || 'A source reported this work complete, but a project manager has not verified it.',
        requestedAction: conflicting
          ? 'Review the conflicting records and verify the actual field condition.'
          : 'Confirm the work in the field, attach evidence, or mark the completion report not confirmed.',
        owner: clean(item.owner) || clean(item.contractor),
        dueDate: clean(item.finishDate),
        dueDays: relativeDays(item.finishDate, now),
        scheduleItemId: item.id,
        updateId: null,
        photoId: null,
        requiresVerification: true,
      }));
    }

    if (scheduleComplete(item)) return;
    const dueDays = relativeDays(item.finishDate, now);
    const requiresDeadlineAttention = dueDays !== null && dueDays <= 7;
    const undatedPriorityWork = dueDays === null && (
      item.priority === 'High' || item.status === 'Waiting'
    );
    if (!requiresDeadlineAttention && !undatedPriorityWork) return;
    const overdue = dueDays !== null && dueDays < 0;
    items.push(inboxItem({
      id: `dave-action:schedule-deadline:${item.id}`,
      kind: 'schedule_deadline',
      priority: overdue && (item.priority === 'High' || Math.abs(dueDays) >= 7)
        ? 'critical'
        : overdue || item.status === 'Waiting' || item.priority === 'High'
          ? 'high'
          : 'medium',
      projectName: projectNameFor(item),
      areaName: clean(item.locationName),
      title: label(item),
      summary: dueDays === null
        ? `${item.status === 'Waiting' ? 'Waiting work' : 'High-priority work'} has no reliable finish date.`
        : dueLabel(dueDays),
      requestedAction: item.status === 'Waiting'
        ? 'Confirm the blocker, responsible owner, and recovery date.'
        : scheduleHasAuthoritativeProgressJudgment(item)
          ? 'Set the recovery date and next accountable step while preserving the project manager progress judgment.'
        : 'Confirm current field status and the next accountable step.',
      owner: clean(item.owner) || clean(item.contractor),
      dueDate: clean(item.finishDate),
      dueDays,
      scheduleItemId: item.id,
      updateId: null,
      photoId: null,
      requiresVerification: false,
    }));
  });

  reconciliationWarnings.forEach(warning => {
    if (warning.severity === 'low') return;
    const item = scheduleById.get(warning.scheduleItemId);
    items.push(inboxItem({
      id: `dave-action:schedule-conflict:${warning.id}`,
      kind: 'schedule_conflict',
      priority: warning.severity,
      projectName: warning.projectName,
      areaName: warning.areaName,
      title: warning.title,
      summary: warning.summary,
      requestedAction: warning.suggestedAction,
      owner: clean(item?.owner) || clean(item?.contractor),
      dueDate: clean(item?.finishDate),
      dueDays: relativeDays(item?.finishDate || '', now),
      scheduleItemId: warning.scheduleItemId,
      updateId: warning.updateId,
      photoId: null,
      requiresVerification: true,
    }));
  });

  dependencyNodes.forEach(node => {
    if (!node.blocked && node.unresolvedPredecessors.length === 0) return;
    const item = scheduleById.get(node.scheduleItemId);
    if (!item || scheduleComplete(item)) return;
    items.push(inboxItem({
      id: `dave-action:dependency:${item.id}`,
      kind: 'dependency_blocker',
      priority: node.cycle ? 'critical' : node.blocked ? 'high' : 'medium',
      projectName: projectNameFor(item),
      areaName: clean(item.locationName),
      title: node.cycle ? `Correct circular dependency: ${label(item)}` : `Resolve dependency: ${label(item)}`,
      summary: node.blockedReason || `${node.unresolvedPredecessors.length} predecessor reference needs mapping.`,
      requestedAction: node.cycle
        ? 'Correct the predecessor logic before using downstream dates.'
        : node.blocked
          ? 'Confirm the predecessor owner and recovery date.'
          : `Map ${node.unresolvedPredecessors.join(', ')} to the correct schedule activity.`,
      owner: clean(item.owner) || clean(item.contractor),
      dueDate: clean(item.finishDate),
      dueDays: relativeDays(item.finishDate, now),
      scheduleItemId: item.id,
      updateId: null,
      photoId: null,
      requiresVerification: node.cycle || node.unresolvedPredecessors.length > 0,
    }));
  });

  updates.forEach(update => update.photos.forEach(photo => {
    const open = photo.actionStatus !== 'Closed';
    const actionable = Boolean(clean(photo.actionRequired)) ||
      photo.category === 'Open Issue' ||
      photo.category === 'Safety Concern';
    if (!open || !actionable) return;
    const dueDays = relativeDays(photo.actionDueDate, now);
    const safety = photo.category === 'Safety Concern';
    const issue = photo.category === 'Open Issue';
    items.push(inboxItem({
      id: `dave-action:field-action:${update.id}:${photo.id}`,
      kind: 'field_action',
      priority: safety || (dueDays !== null && dueDays < 0) ? 'critical' : issue ? 'high' : 'medium',
      projectName: update.projectName,
      areaName: clean(photo.selectedAreaName) || clean(update.selectedAreaName),
      title: clean(photo.actionRequired) || clean(photo.caption) || photo.category,
      summary: dueDays === null
        ? 'This open field responsibility has no due date and remains visible until resolved.'
        : dueLabel(dueDays),
      requestedAction: safety
        ? 'Confirm immediate controls, owner, and resolution evidence.'
        : 'Confirm the owner, due date, and current resolution status.',
      owner: clean(photo.actionOwner),
      dueDate: clean(photo.actionDueDate),
      dueDays,
      scheduleItemId: clean(update.scheduleItemId),
      updateId: update.id,
      photoId: photo.id,
      requiresVerification: false,
    }));
  }));

  const deduped = uniqueBy(aggregateScheduleActions(items), item => item.id)
    .sort(compareInboxItems);
  return Object.freeze({
    generatedAt: now.toISOString(),
    items: Object.freeze(deduped) as unknown as DAVEActionInboxItem[],
    criticalCount: deduped.filter(item => item.priority === 'critical').length,
    verificationCount: deduped.filter(item => item.requiresVerification).length,
    overdueCount: deduped.filter(item => item.dueDays !== null && item.dueDays < 0).length,
    undatedActionCount: deduped.filter(item => item.kind === 'field_action' && !item.dueDate).length,
  });
}

function inboxItem(item: DAVEActionInboxItem) {
  return Object.freeze(item);
}

const PRIORITY_RANK: Record<DAVEActionInboxPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const KIND_RANK: Record<DAVEActionInboxKind, number> = {
  schedule_conflict: 0,
  completion_verification: 1,
  dependency_blocker: 2,
  schedule_deadline: 3,
  field_action: 4,
};

function compareInboxItems(left: DAVEActionInboxItem, right: DAVEActionInboxItem) {
  const leftDue = left.dueDays ?? Number.MAX_SAFE_INTEGER;
  const rightDue = right.dueDays ?? Number.MAX_SAFE_INTEGER;
  return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
    leftDue - rightDue ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id);
}

function aggregateScheduleActions(items: DAVEActionInboxItem[]) {
  const independent: DAVEActionInboxItem[] = [];
  const grouped = new Map<string, DAVEActionInboxItem[]>();

  items.forEach(item => {
    if (item.kind === 'field_action' || !item.scheduleItemId) {
      independent.push(item);
      return;
    }
    grouped.set(item.scheduleItemId, [
      ...(grouped.get(item.scheduleItemId) || []),
      item,
    ]);
  });

  grouped.forEach((group, scheduleItemId) => {
    const ordered = [...group].sort(compareInboxItems);
    const primary = ordered[0];
    const earliestDue = group
      .filter(item => item.dueDays !== null)
      .sort((left, right) => (left.dueDays as number) - (right.dueDays as number))[0] || null;
    independent.push(inboxItem({
      ...primary,
      id: `dave-action:schedule:${scheduleItemId}`,
      summary: uniqueText(group.map(item => item.summary)).join(' '),
      requestedAction: uniqueText(group.map(item => item.requestedAction)).join(' '),
      dueDate: earliestDue?.dueDate || primary.dueDate,
      dueDays: earliestDue?.dueDays ?? primary.dueDays,
      updateId: primary.updateId || group.find(item => item.updateId)?.updateId || null,
      photoId: primary.photoId || group.find(item => item.photoId)?.photoId || null,
      requiresVerification: group.some(item => item.requiresVerification),
    }));
  });

  return independent;
}

function scheduleComplete(item: ScheduleItem) {
  return scheduleProgressIsComplete(item);
}

function projectNameFor(item: ScheduleItem) {
  return clean(item.scheduleProjectName) || clean(item.projectName) || 'Unassigned Project';
}

function label(item: ScheduleItem) {
  return clean(item.taskName) || clean(item.milestone) || 'Untitled schedule activity';
}

function relativeDays(value: string, now: Date) {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const due = new Date(parsed);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(days: number) {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue.`;
  if (days === 0) return 'Due today.';
  return `Due in ${days} day${days === 1 ? '' : 's'}.`;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter(item => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
