import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DAVE_REPORT_SNAPSHOT_VERSION,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

const STORAGE_PREFIX = '@vitruvius/report-snapshots/v1';

type SnapshotStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

export async function loadDAVEReportSnapshot(
  scopeKey: string,
  storage: SnapshotStorage = AsyncStorage,
): Promise<DAVEReportSnapshot | null> {
  const raw = await storage.getItem(storageKey(scopeKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DAVEReportSnapshot;
    if (
      parsed?.version !== DAVE_REPORT_SNAPSHOT_VERSION ||
      parsed.scopeKey !== scopeKey ||
      !Array.isArray(parsed.tasks)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveDAVEReportSnapshot(
  snapshot: DAVEReportSnapshot,
  storage: SnapshotStorage = AsyncStorage,
) {
  const raw = JSON.stringify(snapshot);
  await storage.setItem(storageKey(snapshot.scopeKey), raw);
  if (await storage.getItem(storageKey(snapshot.scopeKey)) !== raw) {
    throw new Error('The approved report snapshot could not be verified after saving.');
  }
}

function storageKey(scopeKey: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`;
}
