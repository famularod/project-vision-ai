import type {
  ScheduleDependency,
  ScheduleItem,
} from '../types';
import {
  buildPIEScheduleDependencyNetwork,
  type PIEScheduleDependencyNetwork,
} from './PIEScheduleDependencyNetwork';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';
import {
  SCHEDULE_FIRST_YEAR,
  SCHEDULE_LAST_YEAR,
  SCHEDULE_MAX_DURATION_WORKING_DAYS,
  scheduleDayIsSupported,
} from './ScheduleInputLimits';
import { isScheduleWorkingDay, scheduleTaskLengthInWorkingDays } from './ScheduleWorkingDays';

export type VitruviusScheduleIssueCode =
  | 'dependency_cycle'
  | 'invalid_task_date'
  | 'missing_predecessor'
  | 'missing_predecessor_finish'
  | 'completed_task_locked'
  | 'unsupported_task_duration'
  | 'phase_link_circle';

/**
 * An 'error' is a fault in the plan (a circle of links, a link to a task that
 * is gone, a date that cannot be read, completed work that would have to
 * move): nothing calculated is applied until it is corrected.
 *
 * A 'warning' is a note about one task whose new dates the calculation cannot
 * give: a line longer than the schedule walks, or a task that would land
 * outside the years the schedule takes. That task is left as it is and named;
 * every other change is still calculated and can be applied (review pass 1,
 * L2: one such line made the whole page's calculation unsafe).
 */
export type VitruviusScheduleIssue = Readonly<{
  code: VitruviusScheduleIssueCode;
  severity: 'error' | 'warning';
  itemId: string | null;
  message: string;
}>;

export type VitruviusScheduleDateChange = Readonly<{
  itemId: string;
  taskName: string;
  predecessorItemIds: string[];
  previousStartDate: string;
  previousFinishDate: string;
  nextStartDate: string;
  nextFinishDate: string;
  reason: string;
}>;

export type VitruviusSchedulePreview = Readonly<{
  items: ScheduleItem[];
  changes: VitruviusScheduleDateChange[];
  issues: VitruviusScheduleIssue[];
  network: PIEScheduleDependencyNetwork;
  safeToApply: boolean;
}>;

const OTHER_CHANGES_STILL_APPLY = 'The other date changes can still be applied.';

export class VitruviusScheduleCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VitruviusScheduleCalculationError';
  }
}

/**
 * Produces a reviewable schedule calculation. It never changes the supplied
 * task records and it never moves work earlier than the PM-authored date.
 */
export function previewVitruviusFinishToStartSchedule(
  sourceItems: readonly ScheduleItem[],
): VitruviusSchedulePreview {
  // Open item 3.6: a link to a phase is worked out as links to the work in it; a circle through a phase is named.
  const phaseLinks = scheduleItemsWithPhaseLinksWorkedOut(sourceItems);
  const calculatedItems = phaseLinks.items;
  const savedLinks = new Map(sourceItems.map(item => [item.id, normalizeScheduleDependencies(item.dependencies)]));
  const network = buildPIEScheduleDependencyNetwork(calculatedItems);
  const issues: VitruviusScheduleIssue[] = [...phaseLinks.issues];
  const changes: VitruviusScheduleDateChange[] = [];
  const itemsById = new Map<string, ScheduleItem>(
    calculatedItems.map(item => [
      item.id,
      {
        ...item,
        dependencies: normalizeScheduleDependencies(item.dependencies),
      },
    ]),
  );

  network.cycles.forEach(cycle => {
    issues.push(Object.freeze({
      code: 'dependency_cycle',
      severity: 'error',
      itemId: cycle[0] || null,
      message: `Dependency cycle includes ${cycle.join(', ')}.`,
    }));
  });
  network.nodes.forEach(node => {
    node.unresolvedPredecessors.forEach(predecessorId => {
      issues.push(Object.freeze({
        code: 'missing_predecessor',
        severity: 'error',
        itemId: node.scheduleItemId,
        message: `${node.taskName} references missing predecessor ${predecessorId}.`,
      }));
    });
  });

  if (network.cycles.length === 0) {
    topologicalScheduleOrder(calculatedItems, network).forEach(itemId => {
      const item = itemsById.get(itemId);
      if (!item) return;
      const dependencies = normalizeScheduleDependencies(item.dependencies);
      if (dependencies.length === 0) return;

      const predecessorDates = dependencies.flatMap(dependency => {
        const predecessor = itemsById.get(dependency.predecessorItemId);
        if (!predecessor) return [];
        const finish = parseScheduleDate(predecessor.finishDate);
        if (!finish) {
          issues.push(Object.freeze({
            code: 'missing_predecessor_finish',
            severity: 'error',
            itemId,
            message: `${predecessor.taskName} needs a valid finish date before ${item.taskName} can be calculated.`,
          }));
          return [];
        }
        return [{
          dependency,
          requiredStart: addWorkingDays(nextWorkingDay(finish), dependency.lagDays || 0),
        }];
      });
      if (predecessorDates.length !== dependencies.length) return;

      const requiredStart = predecessorDates.reduce(
        (latest, candidate) => candidate.requiredStart.getTime() > latest.getTime()
          ? candidate.requiredStart
          : latest,
        predecessorDates[0].requiredStart,
      );
      const currentStart = item.startDate.trim()
        ? parseScheduleDate(item.startDate)
        : null;
      if (item.startDate.trim() && !currentStart) {
        issues.push(Object.freeze({
          code: 'invalid_task_date',
          severity: 'error',
          itemId,
          message: `${item.taskName} has an invalid start date.`,
        }));
        return;
      }
      if (currentStart && currentStart.getTime() >= requiredStart.getTime()) return;

      if (scheduleTaskIsComplete(item)) {
        issues.push(Object.freeze({
          code: 'completed_task_locked',
          severity: 'error',
          itemId,
          message: `${item.taskName} is complete and will not be rescheduled automatically.`,
        }));
        return;
      }

      // The task's length by the one rule the critical path uses too (the
      // owner's answer to question 41, 13 Oct 2026): what he typed, or the
      // working days its dates span. Worked out, never counted out. (A
      // record with no finish at all was only ever read when no length was
      // typed; it still is not read as text here.)
      const durationDays = scheduleTaskLengthInWorkingDays(
        item,
        currentStart,
        typeof item.finishDate === 'string' ? parseScheduleDate(item.finishDate) : null,
      );
      // Checked before the duration is walked day by day (independent review
      // R08: a stored or imported duration of a billion days did not finish).
      // It is a note about this one task, which is left as it is; he did not
      // type this value in the change being reviewed (review pass 1, L2).
      if (durationDays > SCHEDULE_MAX_DURATION_WORKING_DAYS) {
        issues.push(Object.freeze({
          code: 'unsupported_task_duration',
          severity: 'warning',
          itemId,
          message: `${item.taskName} is longer than the ${SCHEDULE_MAX_DURATION_WORKING_DAYS.toLocaleString('en-US')} working days the schedule supports, so its dates were not calculated. Its predecessors now put its start on or after ${formatScheduleDate(requiredStart)}: move it yourself. ${OTHER_CHANGES_STILL_APPLY}`,
        }));
        return;
      }
      const nextFinish = item.isMilestone
        ? requiredStart
        : addWorkingDays(requiredStart, Math.max(0, durationDays - 1));
      if (!scheduleDayIsSupported(requiredStart) || !scheduleDayIsSupported(nextFinish)) {
        issues.push(Object.freeze({
          code: 'invalid_task_date',
          severity: 'warning',
          itemId,
          message: `${item.taskName} would be moved to ${formatScheduleDate(requiredStart)}, outside ${SCHEDULE_FIRST_YEAR} through ${SCHEDULE_LAST_YEAR}, so its dates were left as they are. Correct its predecessors' dates. ${OTHER_CHANGES_STILL_APPLY}`,
        }));
        return;
      }
      const nextItem: ScheduleItem = {
        ...item,
        startDate: formatScheduleDate(requiredStart),
        finishDate: formatScheduleDate(nextFinish),
        durationDays,
      };
      itemsById.set(itemId, nextItem);
      changes.push(Object.freeze({
        itemId,
        taskName: item.taskName,
        // The links as saved: "After Sitework", not the tasks in it (3.6).
        predecessorItemIds: Object.freeze(
          (savedLinks.get(itemId) ?? dependencies).map(dependency => dependency.predecessorItemId),
        ) as unknown as string[],
        previousStartDate: item.startDate,
        previousFinishDate: item.finishDate,
        nextStartDate: nextItem.startDate,
        nextFinishDate: nextItem.finishDate,
        reason: 'Finish-to-start predecessor dates require this task to begin later.',
      }));
    });
  }

  const safeToApply = !issues.some(issue => issue.severity === 'error');
  return Object.freeze({
    items: Object.freeze(
      sourceItems.map(item => {
        const calculated = itemsById.get(item.id);
        // Each with its links as saved (a link to a phase stays a link to the phase, 3.6).
        return calculated ? { ...calculated, dependencies: normalizeScheduleDependencies(item.dependencies) } : item;
      }),
    ) as unknown as ScheduleItem[],
    changes: Object.freeze(changes) as unknown as VitruviusScheduleDateChange[],
    issues: Object.freeze(issues) as unknown as VitruviusScheduleIssue[],
    network,
    safeToApply,
  });
}

/**
 * Makes the review boundary explicit. A calculation containing unresolved
 * logic or PM-protected completed work cannot be applied.
 */
export function applyVitruviusSchedulePreview(
  preview: VitruviusSchedulePreview,
): ScheduleItem[] {
  if (!preview.safeToApply) {
    throw new VitruviusScheduleCalculationError(
      'Schedule changes cannot be applied until dependency and date issues are resolved.',
    );
  }
  return preview.items.map(item => ({
    ...item,
    dependencies: normalizeScheduleDependencies(item.dependencies),
  }));
}

/**
 * Open item 3.6 (14 Oct 2026), the coordinator's rule: a task may start after a phase, as in Microsoft Project. A
 * phase finishes when the last task or milestone under it finishes (at any depth), so a finish-to-start link from a
 * phase means "starts after every task and milestone in that phase is finished". The calculation takes such a link
 * as a link to each of them, with the same lag; a phase with nothing under it yet is placed by its own dates, as a
 * task is. A link to a phase could not be saved on the computer ("this schedule can only place an item after tasks
 * and milestones"), and the critical path left it out.
 *
 * A phase may not follow one of its own tasks, a task in a phase may not start after that phase, and no link may
 * make a circle through a phase. Such a link is left out of the calculation and named as an error: "Apply dates"
 * and the critical path are held until it is removed. (A phase starts no later than the work in it, and its own
 * predecessors come before that work, so a circle is looked for with each phase as a start and a finish.) A circle
 * of tasks alone is named as before. The items come back with their links worked out, for the calculation only.
 */
export function scheduleItemsWithPhaseLinksWorkedOut(
  sourceItems: readonly ScheduleItem[],
): Readonly<{ items: readonly ScheduleItem[]; issues: readonly VitruviusScheduleIssue[] }> {
  const plan = schedulePhasePlan(sourceItems);
  const linksOf = (item: ScheduleItem) => normalizeScheduleDependencies(item.dependencies);
  const throughPhase = (item: ScheduleItem, predecessorId: string) =>
    plan.isPhase(item.id) || plan.isPhase(predecessorId);
  if (!sourceItems.some(item => linksOf(item).some(link => throughPhase(item, link.predecessorItemId)))) {
    return Object.freeze({ items: sourceItems, issues: Object.freeze([]) });
  }

  const issues: VitruviusScheduleIssue[] = [];
  const circular = new Set<string>();
  sourceItems.forEach(item => {
    linksOf(item).forEach(link => {
      const predecessorId = link.predecessorItemId;
      if (!plan.has(predecessorId) || !throughPhase(item, predecessorId)) return;
      if (!plan.finishReachedFrom(item.id).has(predecessorId)) return;
      circular.add(`${item.id}\u0000${predecessorId}`);
      issues.push(Object.freeze({
        code: 'phase_link_circle',
        severity: 'error',
        itemId: item.id,
        message: phaseCircleText(item, plan.item(predecessorId)!, plan),
      }));
    });
  });

  const items = sourceItems.map(item => {
    const links = linksOf(item);
    if (!links.some(link => plan.isPhase(link.predecessorItemId) || circular.has(`${item.id}\u0000${link.predecessorItemId}`))) {
      return item;
    }
    const worked = new Map<string, ScheduleDependency>();
    const add = (predecessorItemId: string, lagDays: number) => {
      const had = worked.get(predecessorItemId);
      if (!had || (had.lagDays || 0) < lagDays) {
        worked.set(predecessorItemId, Object.freeze({ predecessorItemId, type: 'FS', lagDays }));
      }
    };
    links.forEach(link => {
      if (circular.has(`${item.id}\u0000${link.predecessorItemId}`)) return;
      const work = plan.isPhase(link.predecessorItemId) ? plan.workUnder(link.predecessorItemId) : [];
      if (work.length === 0) add(link.predecessorItemId, link.lagDays || 0);
      else work.forEach(id => add(id, link.lagDays || 0));
    });
    return { ...item, dependencies: [...worked.values()] };
  });
  return Object.freeze({ items: Object.freeze(items), issues: Object.freeze(issues) });
}

/**
 * The items an item may not be set to start after (open item 3.6): each would close a circle. A task or milestone
 * that already comes after it; a phase it is in; a phase with work in it that comes after it, or that is itself set
 * to start after it. The item itself is among them. `parentItemId`, when given, is the phase the item is in (or
 * none), as a form holds it before it is saved; a new item is asked for with a null id.
 */
export function scheduleItemsThatWouldCloseACircle(
  itemId: string | null,
  sourceItems: readonly ScheduleItem[],
  parentItemId?: string | null,
): ReadonlySet<string> {
  const { selfId, plan } = schedulePlanForForm(itemId, sourceItems, parentItemId);
  return plan.finishReachedFrom(selfId);
}

/**
 * The first phase among the predecessors a form has ticked that the item may not start after (open item 3.6), or
 * null: one it is in (`inIt`), or one with work in it that comes after it. Arguments as above.
 */
export function schedulePhaseThatWouldCloseACircle(
  itemId: string | null,
  sourceItems: readonly ScheduleItem[],
  parentItemId: string | null | undefined,
  predecessorItemIds: readonly string[],
): Readonly<{ phase: ScheduleItem; inIt: boolean }> | null {
  const { selfId, plan } = schedulePlanForForm(itemId, sourceItems, parentItemId);
  const closes = plan.finishReachedFrom(selfId);
  const id = predecessorItemIds.find(candidate => plan.isPhase(candidate) && closes.has(candidate));
  const phase = id ? plan.item(id) : undefined;
  return phase ? Object.freeze({ phase, inIt: plan.isIn(selfId, phase.id) }) : null;
}

function schedulePlanForForm(itemId: string | null, sourceItems: readonly ScheduleItem[], parentItemId?: string | null) {
  const selfId = itemId?.trim() || '\u0000new';
  const self = sourceItems.find(item => item.id === selfId);
  const items = parentItemId === undefined && self
    ? sourceItems
    : [
        ...sourceItems.filter(item => item.id !== selfId),
        { ...(self ?? { dependencies: [] }), id: selfId, parentItemId: parentItemId ?? self?.parentItemId ?? null } as ScheduleItem,
      ];
  return { selfId, plan: schedulePhasePlan(items) };
}

type SchedulePhasePlan = Readonly<{
  has: (id: string) => boolean;
  item: (id: string) => ScheduleItem | undefined;
  isPhase: (id: string) => boolean;
  /** Whether an item is in a phase, at any depth. */
  isIn: (itemId: string, phaseId: string) => boolean;
  /** The tasks and milestones under a phase, at any depth. */
  workUnder: (phaseId: string) => string[];
  /** The items whose finish cannot come before this item starts: through links, and through the phases they are in. */
  finishReachedFrom: (itemId: string) => Set<string>;
}>;

function schedulePhasePlan(sourceItems: readonly ScheduleItem[]): SchedulePhasePlan {
  const byId = new Map<string, ScheduleItem>();
  sourceItems.forEach(item => {
    const id = item.id?.trim();
    if (id && !byId.has(id)) byId.set(id, item);
  });
  const isPhase = (id: string) => byId.get(id)?.isSummary === true;
  const phaseOf = (id: string) => {
    const parentId = byId.get(id)?.parentItemId?.trim();
    return parentId && parentId !== id && isPhase(parentId) ? parentId : null;
  };
  const childrenOf = new Map<string, string[]>();
  byId.forEach((_item, id) => {
    const parentId = phaseOf(id);
    if (!parentId) return;
    const children = childrenOf.get(parentId);
    if (children) children.push(id);
    else childrenOf.set(parentId, [id]);
  });
  // Each item is a start and a finish. A phase starts before the work in it and finishes after it; a link joins
  // the predecessor's finish to the successor's start.
  let next: Map<string, string[]> | null = null;
  const graph = () => {
    if (next) return next;
    const edges = new Map<string, string[]>();
    const edge = (from: string, to: string) => {
      const existing = edges.get(from);
      if (existing) existing.push(to);
      else edges.set(from, [to]);
    };
    byId.forEach((item, id) => {
      edge(`s:${id}`, `f:${id}`);
      const parentId = phaseOf(id);
      if (parentId) {
        edge(`s:${parentId}`, `s:${id}`);
        edge(`f:${id}`, `f:${parentId}`);
      }
      normalizeScheduleDependencies(item.dependencies).forEach(link => {
        if (byId.has(link.predecessorItemId)) edge(`f:${link.predecessorItemId}`, `s:${id}`);
      });
    });
    next = edges;
    return edges;
  };
  return {
    has: id => byId.has(id),
    item: id => byId.get(id),
    isPhase,
    isIn: (itemId, phaseId) => {
      const seen = new Set<string>();
      for (let at = phaseOf(itemId); at && !seen.has(at); at = phaseOf(at)) {
        if (at === phaseId) return true;
        seen.add(at);
      }
      return false;
    },
    workUnder: phaseId => {
      const work: string[] = [];
      const seen = new Set<string>([phaseId]);
      const queue = [...(childrenOf.get(phaseId) || [])];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        if (isPhase(id)) queue.push(...(childrenOf.get(id) || []));
        else work.push(id);
      }
      return work;
    },
    finishReachedFrom: itemId => {
      const edges = graph();
      const reached = new Set<string>();
      const seen = new Set<string>([`s:${itemId}`]);
      const queue = [`s:${itemId}`];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.startsWith('f:')) reached.add(node.slice(2));
        (edges.get(node) || []).forEach(to => {
          if (seen.has(to)) return;
          seen.add(to);
          queue.push(to);
        });
      }
      return reached;
    },
  };
}

/** What he reads of a link that would close a circle through a phase (3.6). */
function phaseCircleText(item: ScheduleItem, predecessor: ScheduleItem, plan: SchedulePhasePlan): string {
  const name = (target: ScheduleItem) => target.taskName.trim();
  const called = (target: ScheduleItem, start = false) =>
    plan.isPhase(target.id) ? `${start ? 'The' : 'the'} phase ${name(target)}` : name(target);
  if (plan.isPhase(predecessor.id) && plan.isIn(item.id, predecessor.id)) {
    return `${called(item, true)} is in the phase ${name(predecessor)}, so it cannot start after ${name(predecessor)} is finished: that is a circle.`;
  }
  if (plan.isPhase(item.id) && plan.isIn(predecessor.id, item.id)) {
    return `The phase ${name(item)} is set to start after ${name(predecessor)}, one of its own ${plan.isPhase(predecessor.id) ? 'phases' : 'tasks'}: that is a circle.`;
  }
  return `${called(item, true)} starts after ${called(predecessor)}, and ${called(predecessor)} also waits for ${called(item)}: that is a circle.`;
}

/**
 * The dependency lists that change when tasks are deleted: each successor
 * drops the deleted predecessors and keeps every other entry as stored
 * (whole-app audit A5, 30 Sep 2026). The dangling reference was flagged
 * "Map predecessor" for good, kept the task in Attention and made the
 * finish-to-start calculation unsafe to apply. Several ids at once give one
 * change per successor: "Delete PDF + Items" left tasks another schedule
 * still contains pointing at the tasks it deleted (A5 pass 3 F7).
 */
export function dependencyChangesForDeletedTask(
  items: readonly Pick<ScheduleItem, 'id' | 'dependencies'>[],
  deletedItemIds: string | readonly string[],
): Array<{ id: string; dependencies: ScheduleDependency[] }> {
  const deleted = new Set((typeof deletedItemIds === 'string' ? [deletedItemIds] : deletedItemIds)
    .map(id => id.trim()).filter(Boolean));
  if (deleted.size === 0) return [];
  return items.flatMap(item => {
    if (deleted.has(item.id.trim()) || !Array.isArray(item.dependencies)) return [];
    const kept = item.dependencies.filter(dependency =>
      !(typeof dependency?.predecessorItemId === 'string' && deleted.has(dependency.predecessorItemId.trim())));
    return kept.length === item.dependencies.length ? [] : [{ id: item.id, dependencies: kept }];
  });
}

export function normalizeScheduleDependencies(
  value: unknown,
): ScheduleDependency[] {
  if (!Array.isArray(value)) return [];
  const byPredecessor = new Map<string, ScheduleDependency>();
  value.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    const record = candidate as Record<string, unknown>;
    const predecessorItemId = typeof record.predecessorItemId === 'string'
      ? record.predecessorItemId.trim()
      : '';
    if (
      !predecessorItemId ||
      byPredecessor.has(predecessorItemId) ||
      (record.type !== undefined && record.type !== null && record.type !== 'FS')
    ) return;
    const lagDays = typeof record.lagDays === 'number' && Number.isFinite(record.lagDays)
      ? Math.max(0, Math.min(365, Math.trunc(record.lagDays)))
      : 0;
    byPredecessor.set(predecessorItemId, Object.freeze({
      predecessorItemId,
      type: 'FS',
      lagDays,
    }));
  });
  return [...byPredecessor.values()];
}

function topologicalScheduleOrder(
  items: readonly ScheduleItem[],
  network: PIEScheduleDependencyNetwork,
) {
  const itemOrder = new Map(items.map((item, index) => [item.id, index]));
  const inDegree = new Map(items.map(item => [item.id, 0]));
  const successors = new Map<string, string[]>();
  network.edges.forEach(edge => {
    if (!inDegree.has(edge.fromScheduleItemId) || !inDegree.has(edge.toScheduleItemId)) return;
    inDegree.set(edge.toScheduleItemId, (inDegree.get(edge.toScheduleItemId) || 0) + 1);
    const existing = successors.get(edge.fromScheduleItemId);
    if (existing) existing.push(edge.toScheduleItemId);
    else successors.set(edge.fromScheduleItemId, [edge.toScheduleItemId]);
  });
  const queue = items
    .filter(item => (inDegree.get(item.id) || 0) === 0)
    .map(item => item.id);
  const result: string[] = [];
  while (queue.length > 0) {
    queue.sort((left, right) =>
      (itemOrder.get(left) || 0) - (itemOrder.get(right) || 0),
    );
    const itemId = queue.shift();
    if (!itemId) break;
    result.push(itemId);
    (successors.get(itemId) || []).forEach(successorId => {
      const nextDegree = (inDegree.get(successorId) || 0) - 1;
      inDegree.set(successorId, nextDegree);
      if (nextDegree === 0) queue.push(successorId);
    });
  }
  return result;
}

function nextWorkingDay(value: Date) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  while (!isScheduleWorkingDay(next)) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function addWorkingDays(value: Date, days: number) {
  const result = new Date(value.getTime());
  while (!isScheduleWorkingDay(result)) result.setUTCDate(result.getUTCDate() + 1);
  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isScheduleWorkingDay(result)) remaining -= 1;
  }
  return result;
}

function parseScheduleDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const named = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    const rawYear = Number(us[3]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  } else if (named) {
    const monthIndex = MONTHS.findIndex(monthName =>
      monthName.toLowerCase().startsWith(named[1].toLowerCase()),
    );
    if (monthIndex < 0) return null;
    year = Number(named[3]);
    month = monthIndex + 1;
    day = Number(named[2]);
  } else {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

function formatScheduleDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
