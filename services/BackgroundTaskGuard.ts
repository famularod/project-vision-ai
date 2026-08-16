import { sanitizeStartupMessage } from './StartupDiagnostics';

export type BackgroundTaskDiagnostic = Readonly<{
  key: string;
  label: string;
  trigger: string;
  message: string;
  timestamp: string;
  repeatCount: number;
}>;

export type GuardedBackgroundTaskOutcome<T> =
  | Readonly<{ status: 'completed'; value: T; runs: number }>
  | Readonly<{ status: 'failed'; error: string; runs: number }>;

export type GuardedBackgroundTaskInput<T> = Readonly<{
  /** Stable key for work that must never run concurrently. */
  key: string;
  label: string;
  trigger: string;
  task: () => Promise<T>;
  /** One active run plus at most one coalesced follow-up by default. */
  maxConsecutiveRuns?: number;
}>;

type ActiveBackgroundTask = {
  promise: Promise<GuardedBackgroundTaskOutcome<unknown>>;
  rerunRequested: boolean;
  latest: GuardedBackgroundTaskInput<unknown>;
  maxConsecutiveRuns: number;
};

const activeTasks = new Map<string, ActiveBackgroundTask>();
const diagnostics: BackgroundTaskDiagnostic[] = [];
const recentFailureIndex = new Map<string, number>();
const DIAGNOSTIC_LIMIT = 120;
const REPEAT_LOG_WINDOW_MS = 60_000;

/**
 * Runs fire-and-forget work behind a non-rejecting, keyed boundary.
 *
 * Overlapping requests do not create parallel writes. They request one
 * bounded follow-up using the latest task closure, so work queued during an
 * active upload is not forgotten and a trigger storm cannot run forever.
 */
export function runGuardedBackgroundTask<T>(
  input: GuardedBackgroundTaskInput<T>,
): Promise<GuardedBackgroundTaskOutcome<T>> {
  const existing = activeTasks.get(input.key);
  if (existing) {
    existing.rerunRequested = true;
    existing.latest = input as GuardedBackgroundTaskInput<unknown>;
    existing.maxConsecutiveRuns = Math.max(
      existing.maxConsecutiveRuns,
      boundedRunCount(input.maxConsecutiveRuns),
    );
    return existing.promise as Promise<GuardedBackgroundTaskOutcome<T>>;
  }

  const state: ActiveBackgroundTask = {
    promise: Promise.resolve({
      status: 'failed',
      error: 'Background task did not start.',
      runs: 0,
    }),
    rerunRequested: false,
    latest: input as GuardedBackgroundTaskInput<unknown>,
    maxConsecutiveRuns: boundedRunCount(input.maxConsecutiveRuns),
  };

  const operation = (async (): Promise<GuardedBackgroundTaskOutcome<unknown>> => {
    let runs = 0;
    let outcome: GuardedBackgroundTaskOutcome<unknown> = {
      status: 'failed',
      error: 'Background task did not start.',
      runs,
    };

    do {
      state.rerunRequested = false;
      const attempt = state.latest;
      runs += 1;
      try {
        const value = await attempt.task();
        outcome = { status: 'completed', value, runs };
      } catch (error) {
        const message = reportBackgroundTaskFailure({
          key: attempt.key,
          label: attempt.label,
          trigger: attempt.trigger,
          error,
        });
        outcome = { status: 'failed', error: message, runs };
      }
    } while (state.rerunRequested && runs < state.maxConsecutiveRuns);

    return outcome;
  })().finally(() => {
    if (activeTasks.get(input.key) === state) activeTasks.delete(input.key);
  });

  state.promise = operation;
  activeTasks.set(input.key, state);
  return operation as Promise<GuardedBackgroundTaskOutcome<T>>;
}

/** Starts guarded work without creating a floating rejecting promise. */
export function startGuardedBackgroundTask<T>(
  input: GuardedBackgroundTaskInput<T>,
): void {
  void runGuardedBackgroundTask(input);
}

/** Records a handled inner-item failure without changing product state. */
export function reportBackgroundTaskFailure({
  key,
  label,
  trigger,
  error,
}: Readonly<{
  key: string;
  label: string;
  trigger: string;
  error: unknown;
}>): string {
  const message = safeBackgroundTaskErrorMessage(error);
  const sanitizedKey = sanitizeStartupMessage(key);
  const fingerprint = `${sanitizedKey}|${message}`;
  const now = Date.now();
  const previousIndex = recentFailureIndex.get(fingerprint);
  const previous = previousIndex === undefined ? null : diagnostics[previousIndex];
  const previousTime = previous ? new Date(previous.timestamp).getTime() : NaN;

  if (previous && Number.isFinite(previousTime) && now - previousTime < REPEAT_LOG_WINDOW_MS) {
    diagnostics[previousIndex as number] = Object.freeze({
      ...previous,
      timestamp: new Date(now).toISOString(),
      repeatCount: previous.repeatCount + 1,
      trigger: sanitizeStartupMessage(trigger),
    });
    return message;
  }

  const event = Object.freeze({
    key: sanitizedKey,
    label: sanitizeStartupMessage(label),
    trigger: sanitizeStartupMessage(trigger),
    message,
    timestamp: new Date(now).toISOString(),
    repeatCount: 1,
  });
  diagnostics.push(event);
  if (diagnostics.length > DIAGNOSTIC_LIMIT) {
    diagnostics.splice(0, diagnostics.length - DIAGNOSTIC_LIMIT);
    rebuildFailureIndex();
  } else {
    recentFailureIndex.set(fingerprint, diagnostics.length - 1);
  }

  try {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[background-task]', event.label, event.trigger, event.message);
    }
  } catch {
    // Diagnostics must never turn a handled background failure into a crash.
  }
  return message;
}

export function getBackgroundTaskDiagnostics(): BackgroundTaskDiagnostic[] {
  return diagnostics.map(event => ({ ...event }));
}

export function clearBackgroundTaskDiagnostics(): void {
  diagnostics.splice(0, diagnostics.length);
  recentFailureIndex.clear();
}

function boundedRunCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(3, Math.floor(value)));
}

function safeBackgroundTaskErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return sanitizeStartupMessage(error.message || error.name);
    if (typeof error === 'string') return sanitizeStartupMessage(error);
    return 'Unknown background task error.';
  } catch {
    return 'Unknown background task error.';
  }
}

function rebuildFailureIndex(): void {
  recentFailureIndex.clear();
  diagnostics.forEach((event, index) => {
    recentFailureIndex.set(`${event.key}|${event.message}`, index);
  });
}
