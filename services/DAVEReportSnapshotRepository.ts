import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAVE_REPORT_SNAPSHOT_VERSION,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

const STORAGE_PREFIX = '@vitruvius/report-snapshots/v1';

type SnapshotStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

/**
 * The last approved report of this format for these projects: its own
 * period since owner answer Q17 (30 Sep 2026).
 *
 * Until a format has saved a period of its own, the one period every format
 * shared before Q17 is its starting baseline, returned as this format's so
 * that approving or sending it writes this format's key and never the shared
 * one: the other format keeps the shared baseline until its own first send.
 */
export async function loadDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = AsyncStorage,
): Promise<DAVEReportSnapshot | null> {
  const own = await storage.getItem(storageKey(scopeKey, reportFormat));
  if (own) return parseSnapshot(own, scopeKey, reportFormat);
  const shared = parseSnapshot(await storage.getItem(storageKey(scopeKey, undefined)), scopeKey, undefined);
  return shared ? Object.freeze({ ...shared, reportFormat }) : null;
}

export async function saveDAVEReportSnapshot(
  snapshot: DAVEReportSnapshot,
  storage: SnapshotStorage = AsyncStorage,
) {
  const raw = JSON.stringify(snapshot);
  const key = storageKey(snapshot.scopeKey, snapshot.reportFormat);
  await storage.setItem(key, raw);
  if (await storage.getItem(key) !== raw) {
    throw new Error('The approved report snapshot could not be verified after saving.');
  }
}

function parseSnapshot(
  raw: string | null,
  scopeKey: string,
  reportFormat: DAVEReportFormat | undefined,
): DAVEReportSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DAVEReportSnapshot;
    if (
      parsed?.version !== DAVE_REPORT_SNAPSHOT_VERSION ||
      parsed.scopeKey !== scopeKey ||
      parsed.reportFormat !== reportFormat ||
      !Array.isArray(parsed.tasks)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
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
