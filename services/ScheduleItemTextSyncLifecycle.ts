export type ScheduleItemTextSyncTimer = ReturnType<typeof setTimeout>;

export type ScheduleItemTextSyncLifecycle = {
  pendingIds: Set<string>;
  timers: Map<string, ScheduleItemTextSyncTimer>;
};

const DEBOUNCED_SCHEDULE_ITEM_CHANGE_KEYS = new Set([
  'notes',
  'nextAction',
  'owner',
  'contractor',
  'percentComplete',
  'projectControls',
]);

export function scheduleItemChangeUsesDebouncedSync(next: object): boolean {
  const changedKeys = Object.keys(next);
  return (
    changedKeys.length > 0 &&
    changedKeys.every(key => DEBOUNCED_SCHEDULE_ITEM_CHANGE_KEYS.has(key))
  );
}

export function createScheduleItemTextSyncLifecycle(): ScheduleItemTextSyncLifecycle {
  return {
    pendingIds: new Set<string>(),
    timers: new Map<string, ScheduleItemTextSyncTimer>(),
  };
}

export function markScheduleItemTextSyncPending(
  lifecycle: ScheduleItemTextSyncLifecycle,
  itemId: string,
): void {
  lifecycle.pendingIds.add(itemId);
}

export function scheduleScheduleItemTextSync({
  lifecycle,
  itemId,
  generation,
  currentGeneration,
  onReady,
  delayMs = 700,
}: {
  lifecycle: ScheduleItemTextSyncLifecycle;
  itemId: string;
  generation: number;
  currentGeneration: () => number | undefined;
  onReady: (itemId: string, generation: number) => void;
  delayMs?: number;
}): void {
  const existingTimer = lifecycle.timers.get(itemId);
  if (existingTimer) clearTimeout(existingTimer);

  lifecycle.pendingIds.add(itemId);
  const timer = setTimeout(() => {
    lifecycle.timers.delete(itemId);
    if (currentGeneration() !== generation) return;
    onReady(itemId, generation);
  }, delayMs);
  lifecycle.timers.set(itemId, timer);
}

export function flushPendingScheduleItemTextSync({
  lifecycle,
  currentGeneration,
  onReady,
}: {
  lifecycle: ScheduleItemTextSyncLifecycle;
  currentGeneration: (itemId: string) => number | undefined;
  onReady: (itemId: string, generation: number | undefined) => void;
}): string[] {
  const pendingItemIds = [...lifecycle.pendingIds];
  pendingItemIds.forEach(itemId => {
    const timer = lifecycle.timers.get(itemId);
    if (timer) clearTimeout(timer);
    lifecycle.timers.delete(itemId);
    onReady(itemId, currentGeneration(itemId));
  });
  return pendingItemIds;
}

export function settleScheduleItemTextSync(
  lifecycle: ScheduleItemTextSyncLifecycle,
  itemId: string,
): void {
  const timer = lifecycle.timers.get(itemId);
  if (timer) clearTimeout(timer);
  lifecycle.timers.delete(itemId);
  lifecycle.pendingIds.delete(itemId);
}

export function cancelScheduleItemTextSync(
  lifecycle: ScheduleItemTextSyncLifecycle,
  itemId: string,
): void {
  settleScheduleItemTextSync(lifecycle, itemId);
}

export function disposeScheduleItemTextSyncLifecycle(
  lifecycle: ScheduleItemTextSyncLifecycle,
): void {
  lifecycle.timers.forEach(timer => clearTimeout(timer));
  lifecycle.timers.clear();
  lifecycle.pendingIds.clear();
}
