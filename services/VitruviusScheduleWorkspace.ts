import type { ScheduleDependency, ScheduleItem } from '../types';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';

export type VitruviusScheduleHierarchyIssue = Readonly<{
  code: 'missing_parent' | 'hierarchy_cycle';
  itemId: string;
  message: string;
}>;

export type VitruviusScheduleRow = Readonly<{
  item: ScheduleItem;
  depth: number;
  childCount: number;
  orphaned: boolean;
}>;

export type VitruviusScheduleHierarchy = Readonly<{
  rows: readonly VitruviusScheduleRow[];
  issues: readonly VitruviusScheduleHierarchyIssue[];
}>;

export function buildVitruviusScheduleHierarchy(
  sourceItems: readonly ScheduleItem[],
): VitruviusScheduleHierarchy {
  const items = uniqueScheduleItems(sourceItems);
  const itemsById = new Map(items.map(item => [item.id, item]));
  const childrenByParent = new Map<string, ScheduleItem[]>();
  const roots: ScheduleItem[] = [];
  const issues: VitruviusScheduleHierarchyIssue[] = [];

  items.forEach(item => {
    const parentId = item.parentItemId?.trim();
    if (!parentId) {
      roots.push(item);
      return;
    }
    if (!itemsById.has(parentId)) {
      roots.push(item);
      issues.push(Object.freeze({
        code: 'missing_parent',
        itemId: item.id,
        message: `${item.taskName} references a phase that no longer exists.`,
      }));
      return;
    }
    const children = childrenByParent.get(parentId);
    if (children) children.push(item);
    else childrenByParent.set(parentId, [item]);
  });

  const rows: VitruviusScheduleRow[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const append = (item: ScheduleItem, depth: number) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) {
      issues.push(Object.freeze({
        code: 'hierarchy_cycle',
        itemId: item.id,
        message: `${item.taskName} is part of a phase hierarchy cycle.`,
      }));
      return;
    }
    visiting.add(item.id);
    const children = [...(childrenByParent.get(item.id) || [])].sort(compareScheduleItems);
    rows.push(Object.freeze({
      item,
      depth,
      childCount: children.length,
      orphaned: Boolean(item.parentItemId?.trim() && !itemsById.has(item.parentItemId.trim())),
    }));
    children.forEach(child => append(child, depth + 1));
    visiting.delete(item.id);
    visited.add(item.id);
  };

  roots.sort(compareScheduleItems).forEach(item => append(item, 0));
  items.filter(item => !visited.has(item.id)).sort(compareScheduleItems).forEach(item => {
    issues.push(Object.freeze({
      code: 'hierarchy_cycle',
      itemId: item.id,
      message: `${item.taskName} is part of a phase hierarchy cycle.`,
    }));
    appendCycleMember(item, rows, visited, childrenByParent);
  });

  return Object.freeze({
    rows: Object.freeze(rows),
    issues: Object.freeze(dedupeHierarchyIssues(issues)),
  });
}

export function scheduleParentOptions(
  itemId: string | null,
  sourceItems: readonly ScheduleItem[],
): ScheduleItem[] {
  const blockedIds = itemId
    ? descendantIds(itemId, sourceItems)
    : new Set<string>();
  if (itemId) blockedIds.add(itemId);
  return uniqueScheduleItems(sourceItems)
    .filter(item => !blockedIds.has(item.id))
    .filter(item => item.isSummary === true || sourceItems.some(candidate =>
      candidate.parentItemId?.trim() === item.id,
    ))
    .sort(compareScheduleItems);
}

export function schedulePredecessorOptions(
  itemId: string | null,
  sourceItems: readonly ScheduleItem[],
): ScheduleItem[] {
  const descendants = itemId
    ? dependencyDescendantIds(itemId, sourceItems)
    : new Set<string>();
  return uniqueScheduleItems(sourceItems)
    .filter(item => item.id !== itemId && !descendants.has(item.id))
    .filter(item => item.isSummary !== true)
    .sort(compareScheduleItems);
}

export function planningDependenciesFromIds(
  predecessorItemIds: readonly string[],
  lagDays: number | string | null | undefined = 0,
): ScheduleDependency[] {
  const parsedLag = typeof lagDays === 'number'
    ? lagDays
    : Number(lagDays || 0);
  return normalizeScheduleDependencies(
    predecessorItemIds.map(predecessorItemId => ({
      predecessorItemId,
      type: 'FS',
      lagDays: Number.isFinite(parsedLag) ? parsedLag : 0,
    })),
  );
}

export function nextScheduleSortOrder(
  parentItemId: string | null,
  sourceItems: readonly ScheduleItem[],
): number {
  const siblingOrders = sourceItems
    .filter(item => normalizedId(item.parentItemId) === normalizedId(parentItemId))
    .map(item => item.sortOrder)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return siblingOrders.length > 0 ? Math.max(...siblingOrders) + 10 : 10;
}

export function nextScheduleWbsCode(
  parentItemId: string | null,
  sourceItems: readonly ScheduleItem[],
): string {
  const parent = parentItemId
    ? sourceItems.find(item => item.id === parentItemId)
    : null;
  const prefix = parent?.wbsCode?.trim();
  const siblingCount = sourceItems.filter(
    item => normalizedId(item.parentItemId) === normalizedId(parentItemId),
  ).length;
  return prefix ? `${prefix}.${siblingCount + 1}` : String(siblingCount + 1);
}

function uniqueScheduleItems(sourceItems: readonly ScheduleItem[]) {
  const byId = new Map<string, ScheduleItem>();
  sourceItems.forEach(item => {
    const id = item.id?.trim();
    if (id && !byId.has(id)) byId.set(id, item);
  });
  return [...byId.values()];
}

function compareScheduleItems(left: ScheduleItem, right: ScheduleItem) {
  const leftOrder = finiteOrder(left.sortOrder);
  const rightOrder = finiteOrder(right.sortOrder);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const wbsComparison = compareWbs(left.wbsCode, right.wbsCode);
  if (wbsComparison !== 0) return wbsComparison;
  const dateComparison = left.startDate.localeCompare(right.startDate);
  if (dateComparison !== 0) return dateComparison;
  return left.taskName.localeCompare(right.taskName);
}

function finiteOrder(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.MAX_SAFE_INTEGER;
}

function compareWbs(left: string | null | undefined, right: string | null | undefined) {
  const leftParts = wbsParts(left);
  const rightParts = wbsParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart !== rightPart) return leftPart.localeCompare(rightPart, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  return 0;
}

function wbsParts(value: string | null | undefined) {
  return value?.trim() ? value.trim().split(/[.\-]/) : ['~'];
}

function descendantIds(itemId: string, sourceItems: readonly ScheduleItem[]) {
  const childrenByParent = new Map<string, string[]>();
  sourceItems.forEach(item => {
    const parentId = item.parentItemId?.trim();
    if (!parentId) return;
    const children = childrenByParent.get(parentId);
    if (children) children.push(item.id);
    else childrenByParent.set(parentId, [item.id]);
  });
  return traverseIds(itemId, childrenByParent);
}

function dependencyDescendantIds(itemId: string, sourceItems: readonly ScheduleItem[]) {
  const successors = new Map<string, string[]>();
  sourceItems.forEach(item => {
    normalizeScheduleDependencies(item.dependencies).forEach(dependency => {
      const existing = successors.get(dependency.predecessorItemId);
      if (existing) existing.push(item.id);
      else successors.set(dependency.predecessorItemId, [item.id]);
    });
  });
  return traverseIds(itemId, successors);
}

function traverseIds(rootId: string, adjacency: ReadonlyMap<string, readonly string[]>) {
  const result = new Set<string>();
  const queue = [...(adjacency.get(rootId) || [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || result.has(id)) continue;
    result.add(id);
    queue.push(...(adjacency.get(id) || []));
  }
  return result;
}

function appendCycleMember(
  item: ScheduleItem,
  rows: VitruviusScheduleRow[],
  visited: Set<string>,
  childrenByParent: ReadonlyMap<string, readonly ScheduleItem[]>,
) {
  if (visited.has(item.id)) return;
  visited.add(item.id);
  rows.push(Object.freeze({
    item,
    depth: 0,
    childCount: (childrenByParent.get(item.id) || []).length,
    orphaned: false,
  }));
}

function dedupeHierarchyIssues(issues: readonly VitruviusScheduleHierarchyIssue[]) {
  const byKey = new Map<string, VitruviusScheduleHierarchyIssue>();
  issues.forEach(issue => byKey.set(`${issue.code}:${issue.itemId}`, issue));
  return [...byKey.values()];
}

function normalizedId(value: string | null | undefined) {
  return value?.trim() || '';
}
