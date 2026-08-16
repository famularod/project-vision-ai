import type { ScheduleItem } from '../types';
import { scheduleTaskIsComplete } from './dave-project-schedule-rollup';

/**
 * Free-text predecessor extraction remains disabled. Vitruvius only trusts
 * structured, PM-authored dependency records when building schedule logic.
 */
export const SCHEDULE_DEPENDENCY_EXTRACTION_ENABLED = false as const;

export type PIEScheduleDependencyNode = Readonly<{
  scheduleItemId: string;
  activityId: string;
  taskName: string;
  predecessorItemIds: string[];
  unresolvedPredecessors: string[];
  blockingPredecessorIds: string[];
  blocked: boolean;
  blockedReason: string | null;
  cycle: boolean;
}>;

export type PIEScheduleDependencyEdge = Readonly<{
  fromScheduleItemId: string;
  toScheduleItemId: string;
  sourceLabel: string;
}>;

export type PIEScheduleDependencyNetwork = Readonly<{
  nodes: PIEScheduleDependencyNode[];
  edges: PIEScheduleDependencyEdge[];
  cycles: string[][];
  unresolvedReferenceCount: number;
  blockedItemCount: number;
}>;

export function buildPIEScheduleDependencyNetwork(
  scheduleItems: readonly ScheduleItem[],
): PIEScheduleDependencyNetwork {
  const itemsById = new Map(
    scheduleItems
      .filter(item => Boolean(item.id?.trim()))
      .map(item => [item.id.trim(), item] as const),
  );
  const edges: PIEScheduleDependencyEdge[] = [];
  const predecessorIdsByItem = new Map<string, string[]>();
  const unresolvedByItem = new Map<string, string[]>();

  scheduleItems.forEach(item => {
    const itemId = item.id?.trim();
    if (!itemId) return;
    const seen = new Set<string>();
    const predecessors: string[] = [];
    const unresolved: string[] = [];
    (item.dependencies || []).forEach(dependency => {
      const predecessorId = dependency.predecessorItemId?.trim();
      if (!predecessorId || seen.has(predecessorId)) return;
      seen.add(predecessorId);
      predecessors.push(predecessorId);
      if (!itemsById.has(predecessorId)) {
        unresolved.push(predecessorId);
        return;
      }
      const lagDays = finiteLagDays(dependency.lagDays);
      edges.push(Object.freeze({
        fromScheduleItemId: predecessorId,
        toScheduleItemId: itemId,
        sourceLabel: `FS${lagDays === 0 ? '' : lagDays > 0 ? `+${lagDays}d` : `${lagDays}d`}`,
      }));
    });
    predecessorIdsByItem.set(itemId, predecessors);
    unresolvedByItem.set(itemId, unresolved);
  });

  const cycles = dependencyCycles(
    [...itemsById.keys()],
    edges,
  );
  const cyclicIds = new Set(cycles.flat());
  const nodes = scheduleItems
    .filter(item => Boolean(item.id?.trim()))
    .map(item => {
      const itemId = item.id.trim();
      const predecessors = predecessorIdsByItem.get(itemId) || [];
      const unresolved = unresolvedByItem.get(itemId) || [];
      const blockingPredecessors = predecessors.filter(predecessorId => {
        const predecessor = itemsById.get(predecessorId);
        return Boolean(
          predecessor &&
          !scheduleTaskIsComplete(predecessor),
        );
      });
      const cycle = cyclicIds.has(itemId);
      const blockedReason = cycle
        ? 'Dependency cycle must be corrected before dates can be calculated.'
        : unresolved.length > 0
          ? `${unresolved.length} predecessor reference${unresolved.length === 1 ? '' : 's'} could not be matched.`
          : blockingPredecessors.length > 0
            ? `${blockingPredecessors.length} predecessor task${blockingPredecessors.length === 1 ? '' : 's'} still open.`
            : null;
      return Object.freeze({
        scheduleItemId: itemId,
        activityId: item.wbsCode?.trim() || itemId,
        taskName: item.taskName,
        predecessorItemIds: Object.freeze([...predecessors]) as unknown as string[],
        unresolvedPredecessors: Object.freeze([...unresolved]) as unknown as string[],
        blockingPredecessorIds: Object.freeze([...blockingPredecessors]) as unknown as string[],
        blocked: Boolean(blockedReason),
        blockedReason,
        cycle,
      });
    });

  return Object.freeze({
    nodes: Object.freeze(nodes) as unknown as PIEScheduleDependencyNode[],
    edges: Object.freeze(edges) as unknown as PIEScheduleDependencyEdge[],
    cycles: Object.freeze(cycles.map(cycle => Object.freeze(cycle))) as unknown as string[][],
    unresolvedReferenceCount: nodes.reduce(
      (total, node) => total + node.unresolvedPredecessors.length,
      0,
    ),
    blockedItemCount: nodes.filter(node => node.blocked).length,
  });
}

function finiteLagDays(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(365, Math.trunc(value)))
    : 0;
}

function dependencyCycles(
  itemIds: readonly string[],
  edges: readonly PIEScheduleDependencyEdge[],
) {
  const successors = new Map<string, string[]>();
  edges.forEach(edge => {
    const existing = successors.get(edge.fromScheduleItemId);
    if (existing) existing.push(edge.toScheduleItemId);
    else successors.set(edge.fromScheduleItemId, [edge.toScheduleItemId]);
  });
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const uniqueCycles = new Map<string, string[]>();

  const visit = (itemId: string) => {
    if (state.get(itemId) === 'visited') return;
    if (state.get(itemId) === 'visiting') {
      const start = stack.lastIndexOf(itemId);
      const cycle = start >= 0 ? stack.slice(start) : [itemId];
      const key = [...cycle].sort().join('|');
      if (!uniqueCycles.has(key)) uniqueCycles.set(key, cycle);
      return;
    }
    state.set(itemId, 'visiting');
    stack.push(itemId);
    (successors.get(itemId) || []).forEach(visit);
    stack.pop();
    state.set(itemId, 'visited');
  };

  itemIds.forEach(visit);
  return [...uniqueCycles.values()];
}

export function stripScheduleDependencyMetadata(value: string) {
  return value
    .replace(
      /\b(?:predecessors?|dependencies)\s*:\s*.*?(?=\s+(?:activity\s+id|wbs|duration|critical|float|review\s+needed|schedule\s+confidence|notes?)\s*:|\s+imported\s+from\b|$)/gi,
      ' ',
    )
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
