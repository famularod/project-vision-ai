import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAVE_REPORT_SNAPSHOT_VERSION,
  laterReportPeriod,
  reportPeriodIsLater,
  reportPeriodSentAt,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';
import {
  loadReportSnapshotCloud,
  saveReportSnapshotCloud,
} from './SupabaseService';

const STORAGE_PREFIX = '@vitruvius/report-snapshots/v1';
/** How long opening Reports waits for the shared period before using this device's own. */
const CLOUD_READ_TIMEOUT_MS = 4000;

type SnapshotStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

/**
 * The owner's copy of each period shared by the phone and the iPad (owner
 * answer Q16, 30 Sep 2026). `read` is null when it cannot be used (signed
 * out, offline, not configured, or the table not created yet); `snapshot` is
 * null when the owner has none for this period yet.
 */
export type DAVEReportSnapshotCloud = Readonly<{
  read: (
    scopeKey: string,
    reportFormat: DAVEReportFormat,
  ) => Promise<Readonly<{ ownerId: string; snapshot: unknown }> | null>;
  write: (snapshot: DAVEReportSnapshot, expectedOwnerId?: string) => Promise<unknown>;
}>;

const supabaseReportSnapshotCloud: DAVEReportSnapshotCloud = {
  async read(scopeKey, reportFormat) {
    const result = await loadReportSnapshotCloud(scopeKey, reportFormat);
    // A missing table comes back as a quiet stub: this device's own period, as before the migration.
    return result.ok && !result.stubbed && result.data ? result.data : null;
  },
  write: (snapshot, expectedOwnerId) => saveReportSnapshotCloud({
    scopeKey: snapshot.scopeKey,
    format: snapshot.reportFormat as DAVEReportFormat,
    snapshot,
    approvedAt: snapshot.capturedAt,
    deliveredAt: reportPeriodSentAt(snapshot),
    expectedOwnerId,
  }),
};

/**
 * The last approved report of this format for these projects: its own
 * period since owner answer Q17 (30 Sep 2026).
 *
 * Until a format has saved a period of its own, the one period every format
 * shared before Q17 is its starting baseline, returned as this format's so
 * that approving or sending it writes this format's key and never the shared
 * one: the other format keeps the shared baseline until its own first send.
 *
 * Since owner answer Q16 it is merged with the owner's shared copy: the
 * period from the later sent report wins (`laterReportPeriod`). When this
 * device's period is later, or the owner has none yet (a period saved before
 * Q16), it is carried up. Without the shared copy this device's own is used.
 */
export async function loadDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = AsyncStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<DAVEReportSnapshot | null> {
  const local = await loadLocalDAVEReportSnapshot(scopeKey, reportFormat, storage);
  const read = await readShared(cloud, scopeKey, reportFormat);
  if (!read) return local;
  const shared = validSnapshot(read.snapshot, scopeKey, reportFormat);
  if (local && reportPeriodIsLater(local, shared)) void writeShared(cloud, local, read.ownerId);
  return laterReportPeriod(local, shared);
}

/**
 * Saved on this device first (verified, as before); then shared in the
 * background. A failed upload is retried by the next approval, send or open.
 */
export async function saveDAVEReportSnapshot(
  snapshot: DAVEReportSnapshot,
  storage: SnapshotStorage = AsyncStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
) {
  const raw = JSON.stringify(snapshot);
  const key = storageKey(snapshot.scopeKey, snapshot.reportFormat);
  await storage.setItem(key, raw);
  if (await storage.getItem(key) !== raw) {
    throw new Error('The approved report snapshot could not be verified after saving.');
  }
  if (snapshot.reportFormat) void writeShared(cloud, snapshot);
}

async function loadLocalDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage,
): Promise<DAVEReportSnapshot | null> {
  const own = await storage.getItem(storageKey(scopeKey, reportFormat));
  if (own) return parseSnapshot(own, scopeKey, reportFormat);
  const shared = parseSnapshot(await storage.getItem(storageKey(scopeKey, undefined)), scopeKey, undefined);
  return shared ? Object.freeze({ ...shared, reportFormat }) : null;
}

async function readShared(cloud: DAVEReportSnapshotCloud, scopeKey: string, reportFormat: DAVEReportFormat) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      cloud.read(scopeKey, reportFormat),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), CLOUD_READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeShared(cloud: DAVEReportSnapshotCloud, snapshot: DAVEReportSnapshot, expectedOwnerId?: string) {
  try {
    await cloud.write(snapshot, expectedOwnerId);
  } catch {
    // Offline or not shared yet: this device keeps its own copy.
  }
}

function parseSnapshot(
  raw: string | null,
  scopeKey: string,
  reportFormat: DAVEReportFormat | undefined,
): DAVEReportSnapshot | null {
  if (!raw) return null;
  try {
    return validSnapshot(JSON.parse(raw), scopeKey, reportFormat);
  } catch {
    return null;
  }
}

function validSnapshot(
  value: unknown,
  scopeKey: string,
  reportFormat: DAVEReportFormat | undefined,
): DAVEReportSnapshot | null {
  const parsed = value as DAVEReportSnapshot | null;
  if (
    parsed?.version !== DAVE_REPORT_SNAPSHOT_VERSION ||
    parsed.scopeKey !== scopeKey ||
    parsed.reportFormat !== reportFormat ||
    !Array.isArray(parsed.tasks)
  ) return null;
  return parsed;
}

/**
 * The shared pre-Q17 key is the prefix and the encoded projects; a format's
 * own key extends that suffix. The encoded projects never contain ':', so a
 * format key cannot be another scope's shared key, and the prefix still
 * covers every report-snapshot key.
 */
function storageKey(scopeKey: string, reportFormat: DAVEReportFormat | undefined) {
  const shared = `${STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`;
  return reportFormat ? `${shared}:${reportFormat}` : shared;
}
