/**
 * N276 review pass 1, F1 and F2 (15 Oct 2026). Made-up data only.
 * F1: after a failed download of every record, a refresh of ONE record kind that succeeded (a live delete from the
 * iPad, or Reports' own task download) cancelled the retry: nothing downloaded every record again for up to 30
 * minutes, and Reports' Approve waited all that time. Now a failed download leaves "a download of every record still
 * owed", which only such a download that succeeds pays; the retries keep going (5 s, 15 s, 30 s, 1 min, 2 min, then
 * every 5 min) until it does.
 * F2: while the downloads kept failing, approval waited for good. Now the wait ends, with a note naming what could not
 * be downloaded, once a Sync Now has failed or the download has not landed for two minutes.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

import {
  createDAVEOperationalRefreshController,
  type DAVEOperationalCollectionName,
} from '../../services/DAVEOperationalRefresh';
import {
  deviceCloudPullState,
  forgetScheduleCloudPullSession,
  noteDeviceCloudPullFailed,
  noteDeviceCloudPullNeeded,
  noteSyncNowDownloadFailed,
  onDeviceCloudPullChange,
  recordDeviceCloudPull,
} from '../../services/ScheduleCloudPull';

type Call = { at: number; collections: string };

/** A controller whose refresh fails when `fails` says so; every call is kept with when it started. */
function rig(fails: (call: { full: boolean; at: number }) => boolean, canRefresh: () => boolean = () => true) {
  const calls: Call[] = [];
  const t0 = Date.now();
  let gate: (() => void) | null = null;
  let holdNext = false;
  const controller = createDAVEOperationalRefreshController({
    canRefresh,
    refresh: async (_trigger, collections?: readonly DAVEOperationalCollectionName[]) => {
      calls.push({ at: Date.now() - t0, collections: collections ? collections.join('+') : 'ALL' });
      if (holdNext) {
        holdNext = false;
        await new Promise<void>(resolve => { gate = resolve; });
      }
      if (fails({ full: !collections, at: Date.now() - t0 })) throw new Error('refresh_incomplete');
    },
  });
  return {
    controller,
    calls,
    hold: () => { holdNext = true; },
    release: () => { const open = gate; gate = null; open?.(); },
    fullAt: () => calls.filter(call => call.collections === 'ALL').map(call => call.at / 1000),
  };
}

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const advance = async (ms: number, step = 1_000) => {
  for (let t = 0; t < ms; t += step) {
    jest.advanceTimersByTime(Math.min(step, ms - t));
    await flush();
  }
};

describe('a download of every record that failed is owed until one lands (N276b F1)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T13:30:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('C1: a one-kind refresh waiting behind the failed one succeeds; every record is still downloaded again at 5 s', async () => {
    let refreshes = 0;
    const r = rig(() => { refreshes += 1; return refreshes === 1; }); // only the first one fails
    r.hold();
    r.controller.start();
    await flush();
    // While the first download waits for the deletion list, the iPad deletes a task live.
    void r.controller.request('realtime', ['sync_tombstones', 'schedule_items']);
    r.release();
    await flush();
    expect(r.calls.map(call => call.collections)).toEqual(['ALL', 'sync_tombstones+schedule_items']);
    await advance(29 * 60_000, 1_000);
    expect(r.fullAt()).toEqual([0, 5]); // tried again at 5 s, then nothing more until the poll
    r.controller.stop();
  });

  it('C2: the retry is waiting when a one-kind refresh succeeds at 2 s; it still runs at 5 s', async () => {
    let cloudBack = false;
    const r = rig(() => !cloudBack);
    r.controller.start();
    await flush();
    await advance(2_000);
    cloudBack = true;
    await r.controller.request('realtime', ['sync_tombstones', 'project_areas']);
    await flush();
    await advance(29 * 60_000, 1_000);
    expect(r.fullAt()).toEqual([0, 5]);
    expect(r.calls.find(call => call.collections !== 'ALL')?.at).toBe(2_000);
    r.controller.stop();
  });

  it('keeps going further apart while every record keeps failing, one-kind refreshes succeeding in between', async () => {
    const r = rig(call => call.full);
    r.controller.start();
    await flush();
    for (const at of [3_000, 12_000, 30_000]) {
      await advance(at - Date.now() + Date.parse('2026-10-15T13:30:00.000Z'), 1_000);
      await r.controller.request('realtime', ['sync_tombstones', 'schedule_items']);
      await flush();
    }
    await advance(10 * 60_000 - 30_000, 1_000);
    expect(r.fullAt()).toEqual([0, 5, 20, 50, 110, 230, 530]); // 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min
    r.controller.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a retry due while the app is in the background waits for the app; back in it, every record is downloaded', async () => {
    let background = false;
    let fails = true;
    const r = rig(() => fails, () => !background);
    r.controller.start();
    await flush();
    expect(r.controller.fullRefreshOwed()).toBe(true);
    background = true;
    await advance(10 * 60_000, 5_000);
    expect(r.fullAt()).toEqual([0]); // nothing ran in the background
    background = false;
    fails = false;
    await r.controller.request('realtime', ['reference_documents']); // a one-kind refresh does not pay it
    expect(r.controller.fullRefreshOwed()).toBe(true);
    await r.controller.request('foreground');
    expect(r.controller.fullRefreshOwed()).toBe(false);
    expect(r.fullAt()).toHaveLength(2);
    r.controller.stop();
  });
});

describe('the wait for the download ends, saying what could not be downloaded (N276b F2)', () => {
  const OPENED = '2026-10-15T13:30:00.000Z';
  const at = (seconds: number) => new Date(Date.parse(OPENED) + seconds * 1_000).toISOString();
  beforeEach(() => forgetScheduleCloudPullSession());

  it('the downloads failing: waits, then not after two minutes; a later download of every record ends it', () => {
    const changes = jest.fn();
    const stop = onDeviceCloudPullChange(changes);
    noteDeviceCloudPullNeeded(OPENED);
    noteDeviceCloudPullFailed(['reference_documents'], at(8));
    expect(deviceCloudPullState(Date.parse(at(60)))).toEqual(expect.objectContaining({
      pending: true, failing: true, gaveUp: false, giveUpAt: Date.parse(at(128)), missing: 'documents',
    }));
    expect(deviceCloudPullState(Date.parse(at(128))).gaveUp).toBe(true);
    noteDeviceCloudPullFailed(['schedule_items', 'reference_documents', 'sync_tombstones'], at(130));
    expect(deviceCloudPullState(Date.parse(at(131))).missing).toBe('tasks, documents and the list of deleted records');
    recordDeviceCloudPull(at(140));
    expect(deviceCloudPullState(Date.parse(at(150)))).toEqual(expect.objectContaining({
      pending: false, failing: false, gaveUp: false, giveUpAt: null,
    }));
    expect(changes).toHaveBeenCalled();
    stop();
  });

  it('a Sync Now that could not download every record ends the wait at once; back after time away, it waits again', () => {
    noteDeviceCloudPullNeeded(OPENED);
    noteSyncNowDownloadFailed(['referenceDocuments']);
    expect(deviceCloudPullState(Date.parse(at(10)))).toEqual(expect.objectContaining({
      pending: true, failing: true, gaveUp: true, missing: 'documents',
    }));
    noteDeviceCloudPullNeeded(at(3_600));
    expect(deviceCloudPullState(Date.parse(at(3_610))).gaveUp).toBe(false);
    noteSyncNowDownloadFailed(['projects', 'updates', 'projectAreas', 'scheduleItems', 'referenceDocuments']);
    expect(deviceCloudPullState(Date.parse(at(3_620))).missing).toBe('projects, field updates, areas, tasks and documents');
  });

  it('nothing known to have failed: the note says the latest records; nothing asked, nothing waits', () => {
    expect(deviceCloudPullState()).toEqual(expect.objectContaining({ pending: false, failing: false, gaveUp: false }));
    noteDeviceCloudPullNeeded(OPENED);
    expect(deviceCloudPullState(Date.parse(at(121))).missing).toBe('the latest records');
    expect(deviceCloudPullState(Date.parse(at(121))).gaveUp).toBe(true); // not landed for two minutes
  });
});
