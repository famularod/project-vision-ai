/**
 * Whole-app audit A6 pass 11, small limit (b) (30 Sep 2026), on pass 10 M1,
 * M2: when this device last downloaded every task, as Reports compares it
 * with the other device's send.
 *
 * The background refresh records the time it started. Its deletion history
 * can come from a read another refresh already had in flight
 * (loadDAVEOperationalTombstones shares it), started earlier: a deletion the
 * other device made between that read and the refresh was not in the history
 * used, yet the download was recorded as holding it. The loader now says
 * when the read it used started, and the refresh records that time.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));
const mockListTombstones = jest.fn();
jest.mock('../../services/SupabaseService', () => ({
  listDAVESyncTombstones: (...args: unknown[]) => mockListTombstones(...args),
}));

import { isDAVESafeCloudScheduleRecord, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import {
  deletedDAVERecordIds,
  loadDAVEOperationalTombstones,
  type DAVESyncTombstoneSyncResult,
} from '../../services/DAVESyncTombstones';
import { lastScheduleCloudPull, recordScheduleCloudPull } from '../../services/ScheduleCloudPull';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** The brace-matched block of App.tsx that opens at the end of `marker`. */
function blockAfter(marker: string): string {
  const start = app.indexOf(marker);
  if (start < 0) throw new Error(`App.tsx has no ${marker}`);
  const open = start + marker.length - 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(open, index + 1);
    }
  }
  throw new Error('unbalanced block');
}

/** The background refresh's task download, compiled from App.tsx, given the deletion history and its start. */
function taskRefresh(tombstones: DAVESyncTombstoneSyncResult, refreshStartedAt: string): () => Promise<void> {
  const js = ts.transpileModule(
    `module.exports = async function () ${blockAfter("collectionRefreshes.push({ name: 'schedule_items', run: async () => {")}`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const deps: Record<string, unknown> = {
    listScheduleItems: async () => ({ ok: true, configured: true, data: [] }),
    active: true,
    refreshCommit: { isCurrent: () => true, commit: (apply: () => void) => apply() },
    normalizeScheduleItems: (items: unknown[]) => items,
    migrateLegacyScheduleItem: (item: unknown) => item,
    isDAVESafeCloudScheduleRecord,
    deletedDAVERecordIds,
    tombstones,
    scheduleItemsCurrentRef: { current: [] },
    getOfflineQueue: async () => [],
    scheduleItemRevisionForCloudRefresh: (item: unknown) => item,
    recoverDAVEScheduleRecords,
    setScheduleItems: () => undefined,
    identityAliasCleanup: { markScheduleRefreshed: () => undefined },
    recordScheduleCloudPull,
    refreshStartedAt,
  };
  const mod = { exports: (async () => undefined) as () => Promise<void> };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

beforeEach(() => {
  mockStorage.clear();
  mockListTombstones.mockReset();
});

describe('a download is recorded from when the deletion history it used was read (A6 pass 11, limit b)', () => {
  it('a refresh that reuses a read already in flight records when that read started', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockListTombstones.mockImplementation(() => new Promise(resolve => {
      answer = resolve;
    }));
    const firstAt = Date.now();
    const first = loadDAVEOperationalTombstones();
    await pause(25);

    // A second refresh starts later and is handed the first one's read.
    const refreshStartedAt = new Date().toISOString();
    const second = loadDAVEOperationalTombstones();
    answer({ ok: true, configured: true, stubbed: false, data: [] });
    const [used] = await Promise.all([second, first]);
    expect(mockListTombstones).toHaveBeenCalledTimes(1);
    expect(used.cloudAuthoritative).toBe(true);
    expect(Date.parse(used.readStartedAt as string)).toBeGreaterThanOrEqual(firstAt);
    expect(Date.parse(used.readStartedAt as string)).toBeLessThan(Date.parse(refreshStartedAt));

    await taskRefresh(used, refreshStartedAt)();
    expect(await lastScheduleCloudPull()).toBe(used.readStartedAt);
  });

  it('a refresh with a read of its own records no earlier than it started', async () => {
    mockListTombstones.mockResolvedValue({ ok: true, configured: true, stubbed: false, data: [] });
    const refreshStartedAt = new Date().toISOString();
    const used = await loadDAVEOperationalTombstones();
    expect(Date.parse(used.readStartedAt as string)).toBeGreaterThanOrEqual(Date.parse(refreshStartedAt));
    await taskRefresh(used, refreshStartedAt)();
    expect(await lastScheduleCloudPull()).toBe(used.readStartedAt);
  });

  it('a deletion history that could not be verified records nothing', async () => {
    mockListTombstones.mockResolvedValue({ ok: false, configured: true, error: 'offline' });
    const used = await loadDAVEOperationalTombstones();
    expect(used.cloudAuthoritative).toBe(false);
    await taskRefresh(used, new Date().toISOString())();
    expect(await lastScheduleCloudPull()).toBeNull();
  });
});
