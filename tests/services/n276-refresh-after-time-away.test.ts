/**
 * Open item 2.76 (15 Oct 2026): opened after ~4 hours away, the phone's first refresh did not bring every record
 * down, and nothing tried again for up to 30 minutes (the safety poll) while the app stayed open; one collection's
 * refresh (a live change) also counted as a refresh of everything, so coming back to the app inside five minutes
 * downloaded nothing. Settings said "All caught up" and Reports offered Approve meanwhile. Made-up data only.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

import {
  createDAVEOperationalRefreshController,
  shouldRefreshDAVEOperationalDataOnForeground,
  DAVE_OPERATIONAL_POLL_INTERVAL_MS,
  type DAVEOperationalRefreshState,
} from '../../services/DAVEOperationalRefresh';
import {
  deviceCloudPullPending,
  forgetScheduleCloudPullSession,
  noteDeviceCloudPullNeeded,
  onDeviceCloudPullChange,
  recordDeviceCloudPull,
} from '../../services/ScheduleCloudPull';

async function flushPromises() {
  for (let round = 0; round < 6; round += 1) await Promise.resolve();
}

describe('the refresh after opening is tried again within seconds (2.76)', () => {
  afterEach(() => jest.useRealTimers());

  it('a failed first refresh is tried again after 5 s, not at the 30-minute poll, and then stops', async () => {
    jest.useFakeTimers();
    const states: DAVEOperationalRefreshState[] = [];
    const refresh = jest.fn()
      .mockRejectedValueOnce(new Error('operational_deletion_history_incomplete'))
      .mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh, onStateChange: state => states.push(state) });
    controller.start();
    await flushPromises();
    expect(states.at(-1)?.status).toBe('retrying');
    expect(refresh).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4_999);
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('interval'); // every collection
    expect(states.at(-1)?.status).toBe('ready');

    // Landed: nothing more until the poll.
    jest.advanceTimersByTime(DAVE_OPERATIONAL_POLL_INTERVAL_MS - 6_000);
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('keeps trying, further apart (5 s, 15 s, 30 s ...), and stopping the refresh ends it', async () => {
    jest.useFakeTimers();
    const refresh = jest.fn().mockRejectedValue(new Error('task_refresh_incomplete'));
    const controller = createDAVEOperationalRefreshController({ refresh });
    controller.start();
    await flushPromises();
    for (const [wait, calls] of [[5_000, 2], [15_000, 3], [30_000, 4]] as const) {
      jest.advanceTimersByTime(wait - 1);
      await flushPromises();
      expect(refresh).toHaveBeenCalledTimes(calls - 1);
      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(refresh).toHaveBeenCalledTimes(calls);
    }
    controller.stop();
    jest.advanceTimersByTime(10 * 60_000);
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('a live change refreshing one collection does not count as a refresh of every record on return to the app', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
    const states: DAVEOperationalRefreshState[] = [];
    const refresh = jest.fn().mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh, onStateChange: state => states.push(state) });
    controller.start();
    await flushPromises();
    const full = states.at(-1)?.lastSuccessfulRefreshAt;
    expect(full).toBe('2026-10-15T09:00:00.000Z');

    jest.setSystemTime(new Date('2026-10-15T13:30:00.000Z'));
    await controller.request('realtime', ['reference_documents']);
    expect(states.at(-1)?.status).toBe('ready');
    expect(states.at(-1)?.lastSuccessfulRefreshAt).toBe(full);
    expect(shouldRefreshDAVEOperationalDataOnForeground({
      realtimeHealthy: true,
      lastSuccessfulRefreshAt: states.at(-1)?.lastSuccessfulRefreshAt ?? null,
      now: Date.parse('2026-10-15T13:31:00.000Z'),
    })).toBe(true);
    controller.stop();
  });
});

describe('whether this device has downloaded every record since it was opened (2.76)', () => {
  beforeEach(() => forgetScheduleCloudPullSession());

  it('waits from opening until a download started after it lands; an earlier one does not count', () => {
    const changes = jest.fn();
    const stop = onDeviceCloudPullChange(changes);
    expect(deviceCloudPullPending()).toBe(false); // nothing asked: no refresh running
    noteDeviceCloudPullNeeded('2026-10-15T13:30:00.000Z');
    expect(deviceCloudPullPending()).toBe(true);
    recordDeviceCloudPull('2026-10-15T13:29:59.000Z');
    expect(deviceCloudPullPending()).toBe(true);
    recordDeviceCloudPull('2026-10-15T13:30:00.000Z');
    expect(deviceCloudPullPending()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    // Back after time away: waits again.
    noteDeviceCloudPullNeeded('2026-10-15T14:10:00.000Z');
    expect(deviceCloudPullPending()).toBe(true);
    stop();
  });
});
