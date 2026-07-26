export const PENDING_CHANGES_RETRY_DELAYS_MS = Object.freeze([
  5_000,
  15_000,
  30_000,
  60_000,
]) as readonly number[];

export const PENDING_CHANGES_IDLE_CHECK_INTERVAL_MS = 30_000;

export type PendingChangesRetryTrigger =
  | 'initial'
  | 'timer'
  | 'foreground'
  | 'reconnect'
  | string;

export type PendingChangesUploadResult = Readonly<{
  configured: boolean;
  uploaded: number;
  itemOutcomes?: Readonly<Record<
    string,
    'uploaded' | 'superseded' | 'conflict' | 'blocked' | 'failed'
  >>;
  queued: number;
  conflicts: number;
  errors: readonly string[];
}>;

export type PendingChangesRetryState = Readonly<{
  status: 'idle' | 'syncing' | 'waiting_retry';
  trigger: PendingChangesRetryTrigger;
  queued: number;
  consecutiveRetryCount: number;
  nextAttemptInMs: number | null;
  lastError: string | null;
}>;

type PendingChangesRetryTimer = unknown;

type PendingChangesRetryControllerOptions = Readonly<{
  upload: () => Promise<PendingChangesUploadResult>;
  getPendingChangeCount: () => Promise<number>;
  canRun?: () => boolean;
  onStateChange?: (state: PendingChangesRetryState) => void;
  retryDelaysMs?: readonly number[];
  idleCheckIntervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => PendingChangesRetryTimer;
  cancel?: (timer: PendingChangesRetryTimer) => void;
}>;

/**
 * A resolved upload promise is not proof that the durable queue synced.
 * SyncUploadResult deliberately reports handled per-item failures without
 * rejecting, so retry decisions must inspect the result itself.
 */
export function pendingChangesUploadNeedsRetry(
  result: PendingChangesUploadResult,
): boolean {
  if (result.queued <= 0) return false;
  if (!result.configured || result.errors.length > 0) return true;

  const outcomes = Object.values(result.itemOutcomes ?? {});
  if (outcomes.some(outcome => outcome === 'failed')) return true;

  // A project update blocked on missing photo bytes is not helped by a tight
  // retry loop. The slower idle/foreground/reconnect checks will try it again
  // after the independent photo recovery path has had time to run.
  const remainingItemsAreBlocked = (
    outcomes.length > 0 &&
    outcomes.every(outcome => (
      outcome === 'uploaded' ||
      outcome === 'superseded' ||
      outcome === 'conflict' ||
      outcome === 'blocked'
    )) &&
    outcomes.some(outcome => outcome === 'blocked')
  );
  return !remainingItemsAreBlocked;
}

export function createPendingChangesRetryController({
  upload,
  getPendingChangeCount,
  canRun = () => true,
  onStateChange = () => undefined,
  retryDelaysMs = PENDING_CHANGES_RETRY_DELAYS_MS,
  idleCheckIntervalMs = PENDING_CHANGES_IDLE_CHECK_INTERVAL_MS,
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: PendingChangesRetryControllerOptions) {
  const boundedRetryDelays = retryDelaysMs.length > 0
    ? retryDelaysMs.map(delay => Math.max(1, Math.floor(delay)))
    : [PENDING_CHANGES_IDLE_CHECK_INTERVAL_MS];
  const boundedIdleInterval = Math.max(1, Math.floor(idleCheckIntervalMs));

  let running = false;
  let inFlight = false;
  let trailingTrigger: PendingChangesRetryTrigger | null = null;
  let timer: PendingChangesRetryTimer | null = null;
  let consecutiveRetryCount = 0;

  function clearScheduledAttempt() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function scheduleAttempt(delayMs: number) {
    clearScheduledAttempt();
    if (!running) return;
    timer = schedule(() => {
      timer = null;
      void request('timer');
    }, delayMs);
  }

  function retryDelay(): number {
    const index = Math.min(
      Math.max(0, consecutiveRetryCount - 1),
      boundedRetryDelays.length - 1,
    );
    return boundedRetryDelays[index];
  }

  async function run(trigger: PendingChangesRetryTrigger): Promise<void> {
    if (!running) return;
    clearScheduledAttempt();

    if (!canRun()) {
      scheduleAttempt(boundedIdleInterval);
      return;
    }

    let queued = 0;
    try {
      queued = Math.max(0, await getPendingChangeCount());
      if (queued === 0) {
        consecutiveRetryCount = 0;
        onStateChange({
          status: 'idle',
          trigger,
          queued: 0,
          consecutiveRetryCount,
          nextAttemptInMs: boundedIdleInterval,
          lastError: null,
        });
        scheduleAttempt(boundedIdleInterval);
        return;
      }

      onStateChange({
        status: 'syncing',
        trigger,
        queued,
        consecutiveRetryCount,
        nextAttemptInMs: null,
        lastError: null,
      });
      const result = await upload();
      queued = Math.max(0, result.queued);

      if (pendingChangesUploadNeedsRetry(result)) {
        consecutiveRetryCount += 1;
        const delayMs = retryDelay();
        onStateChange({
          status: 'waiting_retry',
          trigger,
          queued,
          consecutiveRetryCount,
          nextAttemptInMs: delayMs,
          lastError: result.errors[0] ?? 'Pending cloud changes remain queued.',
        });
        scheduleAttempt(delayMs);
        return;
      }

      consecutiveRetryCount = 0;
      onStateChange({
        status: 'idle',
        trigger,
        queued,
        consecutiveRetryCount,
        nextAttemptInMs: boundedIdleInterval,
        lastError: null,
      });
      scheduleAttempt(boundedIdleInterval);
    } catch (error) {
      consecutiveRetryCount += 1;
      const delayMs = retryDelay();
      onStateChange({
        status: 'waiting_retry',
        trigger,
        queued,
        consecutiveRetryCount,
        nextAttemptInMs: delayMs,
        lastError: error instanceof Error
          ? error.message
          : 'Pending cloud sync could not start.',
      });
      scheduleAttempt(delayMs);
    }
  }

  async function request(trigger: PendingChangesRetryTrigger): Promise<void> {
    if (!running) return;
    clearScheduledAttempt();
    if (inFlight) {
      trailingTrigger = trigger;
      return;
    }

    inFlight = true;
    try {
      await run(trigger);
    } finally {
      inFlight = false;
      const pendingTrigger = trailingTrigger;
      trailingTrigger = null;
      if (pendingTrigger !== null && running) {
        await request(pendingTrigger);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    void request('initial');
  }

  function stop() {
    running = false;
    trailingTrigger = null;
    clearScheduledAttempt();
  }

  return Object.freeze({
    start,
    stop,
    request,
    isRunning: () => running,
  });
}
