import type { ScheduleItem } from '../types';

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
  _scheduleItems: readonly ScheduleItem[],
): PIEScheduleDependencyNetwork {
  return Object.freeze({
    nodes: Object.freeze([]) as unknown as PIEScheduleDependencyNode[],
    edges: Object.freeze([]) as unknown as PIEScheduleDependencyEdge[],
    cycles: Object.freeze([]) as unknown as string[][],
    unresolvedReferenceCount: 0,
    blockedItemCount: 0,
  });
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
