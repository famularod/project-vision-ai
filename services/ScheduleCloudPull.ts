import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When this device last downloaded every task from the cloud (whole-app audit
 * A6 pass 10 M1, M2, 30 Sep 2026). Reports uses it to tell whether this device
 * can have received the changes behind the report the other device sent: a
 * report counted from the other device's send, on a device that has not
 * downloaded the tasks since, read the other device's changes backwards
 * ("Frame walls was reopened", "Punch list was removed").
 *
 * The time is when the download started (it holds everything in the cloud by
 * then), saved only when the whole task list and the deletion history came
 * back and were applied. Kept per account: the key sits under the report
 * snapshot prefix, which the owner storage sandbox keeps for each account.
 */
export const SCHEDULE_CLOUD_PULL_KEY = '@vitruvius/report-snapshots/schedule-pull/v1';

type PullStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

const listeners = new Set<(pulledAt: string) => void>();
let pullRequest: (() => void) | null = null;
let writes: Promise<unknown> = Promise.resolve();
/** When this app session first saw each of the other device's sends (see `reportSendFirstSeenAt`). */
const firstSeen = new Map<string, string>();

/** A completed download of every task, started at `startedAt`; an earlier one than the saved time changes nothing. */
export function recordScheduleCloudPull(startedAt: string, storage: PullStorage = AsyncStorage): Promise<void> {
  const write = writes.then(async () => {
    if (!validTime(startedAt)) return;
    const saved = await storage.getItem(SCHEDULE_CLOUD_PULL_KEY).catch(() => null);
    const latest = validTime(saved) && Date.parse(saved as string) >= Date.parse(startedAt) ? saved as string : startedAt;
    if (latest !== saved) await storage.setItem(SCHEDULE_CLOUD_PULL_KEY, latest);
    listeners.forEach(listener => listener(latest));
  }).catch(() => undefined);
  writes = write;
  return write;
}

/** When this device last downloaded every task, or null when it has not since this was recorded. */
export async function lastScheduleCloudPull(storage: PullStorage = AsyncStorage): Promise<string | null> {
  await writes;
  const saved = await storage.getItem(SCHEDULE_CLOUD_PULL_KEY);
  return validTime(saved) ? saved : null;
}

/** Called with the latest download time whenever a download is recorded. Returns the unsubscribe. */
export function onScheduleCloudPull(listener: (pulledAt: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The app's way to download the tasks now (its operational refresh). Returns the unregister. */
export function registerScheduleCloudPullRequest(request: () => void): () => void {
  pullRequest = request;
  return () => {
    if (pullRequest === request) pullRequest = null;
  };
}

/** Asks the app to download the tasks now; nothing when no refresh is running (signed out, or not started yet). */
export function requestScheduleCloudPull(): void {
  try {
    pullRequest?.();
  } catch {
    // The next refresh, or Settings › Sync Now, still records it.
  }
}

/**
 * When this app session first saw the other device's send `sendKey`, in this
 * device's clock. A download started after that started after the send,
 * whatever the other device's clock said (A6 pass 10 L2: the iPad's clock
 * ahead kept the phone waiting after it had downloaded everything).
 */
export function reportSendFirstSeenAt(sendKey: string, now: () => string = () => new Date().toISOString()): string {
  const seen = firstSeen.get(sendKey) ?? now();
  firstSeen.set(sendKey, seen);
  return seen;
}

/** Test seam: a new app session forgets which sends it saw. */
export function forgetScheduleCloudPullSession(): void {
  firstSeen.clear();
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
