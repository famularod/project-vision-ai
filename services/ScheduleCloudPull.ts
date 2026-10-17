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

/**
 * Open item 2.76 (15 Oct 2026): opened after four hours away, the phone showed
 * an out-of-date task set for minutes (its first download came back without
 * the other devices' new records) while Settings said "All caught up" and
 * Reports offered the report. The app now says when this device has to
 * download the cloud's records (on opening, and on coming back to it when it
 * downloads again) and when a download of every record, deletions verified,
 * has landed since. In memory, this app session only. Nothing is waited for
 * until the app says so (no refresh running: signed out, or not started).
 */
let devicePullNeededSince: string | null = null;
let devicePulledAt: string | null = null;
const devicePullListeners = new Set<() => void>();

function devicePullChanged(): void {
  devicePullListeners.forEach(listener => listener());
}

/**
 * N276 review pass 1, F2 and F4 (15 Oct 2026): while a download kept failing, approval waited for good (Sync Now did
 * not release it) and Settings said "Downloading" while nothing could. Kept too, in memory: what could not be
 * downloaded since the last download of every record, and from when; and the download asked for that a Sync Now
 * could not bring down whole. Approval then stops waiting, with a note naming what is missing.
 */
let devicePullFailure: { kinds: string[]; since: string; startedAt: string } | null = null;
let syncNowFailedFor: string | null = null;
/** Approval stops waiting once the download asked for has not landed for this long (its retries failing). */
export const DEVICE_CLOUD_PULL_WAIT_LIMIT_MS = 120_000;
/** Record kinds in words, by the refresh's collection names and by Sync Now's. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  projects: 'projects', project_updates: 'field updates', updates: 'field updates',
  project_areas: 'areas', projectAreas: 'areas', schedule_items: 'tasks', scheduleItems: 'tasks',
  reference_documents: 'documents', referenceDocuments: 'documents', sync_tombstones: 'the list of deleted records',
};
const KIND_ORDER = ['projects', 'field updates', 'areas', 'tasks', 'documents', 'the list of deleted records'];

/** This device has to download the cloud's records again (opened, or back after time away). */
export function noteDeviceCloudPullNeeded(at: string = new Date().toISOString()): void {
  if (!validTime(at)) return;
  if (!validTime(devicePullNeededSince) || Date.parse(at) > Date.parse(devicePullNeededSince as string)) {
    devicePullNeededSince = at; // a new wait: a Sync Now that failed before does not end it
    devicePullChanged();
  }
}

/** A download of every record, deletions verified, started at `startedAt`, has been applied. */
export function recordDeviceCloudPull(startedAt: string): void {
  if (!validTime(startedAt)) return;
  const wasPending = deviceCloudPullPending();
  const wasFailing = devicePullFailure !== null;
  if (!validTime(devicePulledAt) || Date.parse(startedAt) > Date.parse(devicePulledAt as string)) {
    devicePulledAt = startedAt;
  }
  // Sync Now and the automatic refresh can overlap. An older successful read
  // cannot erase a newer failure or make its warning disappear.
  if (!devicePullFailure || Date.parse(startedAt) >= Date.parse(devicePullFailure.startedAt)) devicePullFailure = null;
  if (deviceCloudPullPending() !== wasPending || wasFailing) devicePullChanged();
}

function noteFailure(kinds: readonly string[], at: string): void {
  const words = KIND_ORDER.filter(word => kinds.some(kind => KIND_WORDS[kind] === word));
  devicePullFailure = { kinds: words, since: devicePullFailure?.since ?? at, startedAt: at };
}

/** The app's download begun at `at` failed: these record kinds did not come down. */
export function noteDeviceCloudPullFailed(kinds: readonly string[], at: string = new Date().toISOString()): void {
  if (!validTime(at) || (devicePulledAt && Date.parse(at) < Date.parse(devicePulledAt)) ||
      (devicePullFailure && Date.parse(at) < Date.parse(devicePullFailure.startedAt))) return;
  // A later one-kind failure also leaves a full download owed, even if this
  // session previously caught up. Reports must show that uncertainty too.
  if (!deviceCloudPullPending()) noteDeviceCloudPullNeeded(at);
  noteFailure(kinds, at);
  devicePullChanged();
}

/** Settings › Sync Now could not download `kinds` (its collection names, or none known): approval stops waiting. */
export function noteSyncNowDownloadFailed(kinds: readonly string[], startedAt: string = new Date().toISOString()): void {
  if (!validTime(startedAt) || (devicePulledAt && Date.parse(startedAt) < Date.parse(devicePulledAt))) return;
  noteDeviceCloudPullFailed(kinds, startedAt);
  // A Sync Now from before a new foreground request (or another owner session)
  // cannot release that newer wait.
  if (devicePullNeededSince && Date.parse(startedAt) >= Date.parse(devicePullNeededSince)) {
    syncNowFailedFor = devicePullNeededSince;
    devicePullChanged();
  }
}

export type DeviceCloudPullState = Readonly<{
  /** Asked to download the cloud's records, and no download of every record has landed since. */
  pending: boolean;
  /** A download failed since the last download of every record. */
  failing: boolean;
  /** Pending, and approval no longer waits: a Sync Now could not download every record, or two minutes went by. */
  gaveUp: boolean;
  /** While pending: when approval stops waiting by itself (two minutes after the download was asked, or failed). */
  giveUpAt: number | null;
  /** What could not be downloaded, in words ("tasks and documents"), or "the latest records" when not known. */
  missing: string;
}>;

/** This device's download of the cloud's records, for Reports and Settings (2.76, N276b). */
export function deviceCloudPullState(now: number = Date.now()): DeviceCloudPullState {
  const pending = deviceCloudPullPending();
  const giveUpAt = pending
    ? Math.max(Date.parse(devicePullNeededSince as string), devicePullFailure ? Date.parse(devicePullFailure.since) : 0) +
      DEVICE_CLOUD_PULL_WAIT_LIMIT_MS
    : null;
  const words = devicePullFailure?.kinds ?? [];
  return Object.freeze({
    pending,
    failing: devicePullFailure !== null,
    gaveUp: giveUpAt !== null && (syncNowFailedFor === devicePullNeededSince || now >= giveUpAt),
    giveUpAt,
    missing: words.length === 0 ? 'the latest records'
      : words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`,
  });
}

/** Whether this device was asked to download the cloud's records and no such download has landed since. */
export function deviceCloudPullPending(): boolean {
  if (devicePullFailure) return true;
  if (!validTime(devicePullNeededSince)) return false;
  return !validTime(devicePulledAt) || Date.parse(devicePulledAt as string) < Date.parse(devicePullNeededSince as string);
}

/** Called whenever this device's download state may have changed (`deviceCloudPullState`). Returns the unsubscribe. */
export function onDeviceCloudPullChange(listener: () => void): () => void {
  devicePullListeners.add(listener);
  return () => {
    devicePullListeners.delete(listener);
  };
}

/** Test seam: a new app session forgets which sends it saw. */
export function forgetScheduleCloudPullSession(): void {
  firstSeen.clear();
  const wasPending = deviceCloudPullPending() || devicePullFailure !== null;
  devicePullNeededSince = null;
  devicePulledAt = null;
  devicePullFailure = null;
  syncNowFailedFor = null;
  if (wasPending) devicePullChanged();
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
