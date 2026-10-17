/** Issue 2.76 follow-up against Build 236 + preserved N276/N276b. Synthetic, offline clocks only. */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined),
}));
import { createDAVEOperationalRefreshController, type DAVEOperationalRefreshState } from '../../services/DAVEOperationalRefresh';
import { deviceCloudPullState, forgetScheduleCloudPullSession, noteDeviceCloudPullFailed,
  noteDeviceCloudPullNeeded, noteSyncNowDownloadFailed, recordDeviceCloudPull } from '../../services/ScheduleCloudPull';
const at = (seconds: number) => new Date(Date.parse('2026-10-17T10:00:00Z') + seconds * 1_000).toISOString();
const flush = async () => { for (let n = 0; n < 20; n += 1) await Promise.resolve(); };

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date(at(0))); forgetScheduleCloudPullSession(); });
afterEach(() => jest.useRealTimers());

it('a failed targeted refresh after a complete download makes the records pending again', () => {
  noteDeviceCloudPullNeeded(at(0)); recordDeviceCloudPull(at(0));
  noteDeviceCloudPullFailed(['schedule_items'], at(5));
  expect(deviceCloudPullState(Date.parse(at(6)))).toMatchObject({ pending: true, failing: true, missing: 'tasks', gaveUp: false });
  expect(deviceCloudPullState(Date.parse(at(126))).gaveUp).toBe(true);
});

it('a late older full download cannot clear the failure of a newer required download', () => {
  noteDeviceCloudPullNeeded(at(0));
  noteDeviceCloudPullNeeded(at(10)); noteDeviceCloudPullFailed(['reference_documents'], at(11));
  recordDeviceCloudPull(at(2));
  expect(deviceCloudPullState(Date.parse(at(12)))).toMatchObject({ pending: true, failing: true, missing: 'documents' });
  recordDeviceCloudPull(at(15));
  expect(deviceCloudPullState(Date.parse(at(16)))).toMatchObject({ pending: false, failing: false });
});

it('an older failed request arriving after a newer full download does not make the device stale again', () => {
  noteDeviceCloudPullNeeded(at(0)); recordDeviceCloudPull(at(20));
  noteDeviceCloudPullFailed(['schedule_items'], at(5));
  expect(deviceCloudPullState(Date.parse(at(21)))).toMatchObject({ pending: false, failing: false });
});

it('a failed old Sync Now does not release the wait begun after it started', () => {
  noteDeviceCloudPullNeeded(at(0)); noteDeviceCloudPullNeeded(at(10));
  noteSyncNowDownloadFailed(['referenceDocuments'], at(2));
  expect(deviceCloudPullState(Date.parse(at(12))).gaveUp).toBe(false);
  noteSyncNowDownloadFailed(['referenceDocuments'], at(11));
  expect(deviceCloudPullState(Date.parse(at(13))).gaveUp).toBe(true);
});

it('a stopped controller emits no completed state or retry when its old request resolves', async () => {
  let finish!: () => void;
  const states: DAVEOperationalRefreshState[] = [];
  const controller = createDAVEOperationalRefreshController({
    refresh: () => new Promise<void>(resolve => { finish = resolve; }), onStateChange: state => states.push(state),
  });
  controller.start(); await flush(); controller.stop(); finish(); await flush();
  expect(states.map(state => state.status)).toEqual(['refreshing']);
  expect(jest.getTimerCount()).toBe(0);
});

it('a full refresh queued before backgrounding remains owed when the earlier request finishes away', async () => {
  let finish!: () => void;
  let foreground = true;
  const refresh = jest.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const controller = createDAVEOperationalRefreshController({ refresh, canRefresh: () => foreground });
  controller.start(); await flush();
  await controller.request('foreground'); // this request needs data newer than the first read
  foreground = false; finish(); await flush();
  expect(controller.fullRefreshOwed()).toBe(true);
  jest.advanceTimersByTime(10_000); await flush();
  expect(refresh).toHaveBeenCalledTimes(1);
  foreground = true; await controller.request('foreground');
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(controller.fullRefreshOwed()).toBe(false);
  controller.stop(); expect(jest.getTimerCount()).toBe(0);
});

it('three hours of failing downloads retain a bounded retry budget and stopping clears every timer', async () => {
  const refresh = jest.fn().mockRejectedValue(new Error('offline'));
  const controller = createDAVEOperationalRefreshController({ refresh });
  controller.start(); await flush();
  for (let elapsed = 0; elapsed < 3 * 60 * 60_000; elapsed += 1_000) {
    jest.advanceTimersByTime(1_000); await flush();
  }
  expect(refresh).toHaveBeenCalledTimes(42);
  expect(jest.getTimerCount()).toBe(2); // one safety poll and one bounded retry
  controller.stop();
  expect(jest.getTimerCount()).toBe(0);
});
