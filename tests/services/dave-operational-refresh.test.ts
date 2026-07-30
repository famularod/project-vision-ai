import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachDAVEOperationalRealtime,
  createDAVEOperationalRefreshCommitGuard,
  createDAVEOperationalRefreshController,
  daveOperationalCollectionForRealtimeEntity,
  DAVE_OPERATIONAL_POLL_INTERVAL_MS,
  DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS,
  runDAVEOperationalCollectionRefreshes,
  type DAVEOperationalRealtimeEntity,
  type DAVEOperationalRefreshState,
} from '../../services/DAVEOperationalRefresh';

describe('DAVE operational cross-device refresh', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes an already-open device immediately and retains the fast polling fallback', async () => {
    jest.useFakeTimers();
    const refresh = jest.fn().mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh });

    controller.start();
    await flushPromises();
    expect(refresh).toHaveBeenCalledWith('initial');

    await controller.request('realtime');
    expect(refresh).toHaveBeenCalledWith('realtime');

    jest.advanceTimersByTime(DAVE_OPERATIONAL_POLL_INTERVAL_MS);
    await flushPromises();
    expect(refresh).toHaveBeenCalledWith('interval');

    controller.stop();
  });

  it('does not lose a cloud notification that arrives during an active refresh', async () => {
    let finishFirstRefresh: () => void = () => undefined;
    const refresh = jest.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        finishFirstRefresh = resolve;
      }))
      .mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh });

    controller.start();
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(1);

    await controller.request('realtime');
    expect(refresh).toHaveBeenCalledTimes(1);

    finishFirstRefresh();
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith('realtime');

    controller.stop();
  });

  it('refreshes only the collection named by a realtime event', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh });

    controller.start();
    await flushPromises();

    const collection = daveOperationalCollectionForRealtimeEntity('schedule_item');
    expect(collection).toBe('schedule_items');
    await controller.request('realtime', collection ? [collection] : undefined);

    expect(refresh).toHaveBeenLastCalledWith('realtime', ['schedule_items']);
    controller.stop();
  });

  it('merges targeted notifications that arrive during an active refresh', async () => {
    let finishInitialRefresh: () => void = () => undefined;
    const refresh = jest.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => {
        finishInitialRefresh = resolve;
      }))
      .mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({ refresh });

    controller.start();
    await flushPromises();

    void controller.request('realtime', ['schedule_items']);
    void controller.request('realtime', ['project_areas']);
    finishInitialRefresh();
    await flushPromises();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(
      'realtime',
      expect.arrayContaining(['schedule_items', 'project_areas']),
    );
    controller.stop();
  });

  it('uses a full refresh for tombstone events because the deleted collection is not known', () => {
    expect(daveOperationalCollectionForRealtimeEntity('sync_tombstone')).toBeNull();
  });

  it('reports a retrying state and automatically recovers on the next request', async () => {
    const states: DAVEOperationalRefreshState[] = [];
    const refresh = jest.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const controller = createDAVEOperationalRefreshController({
      refresh,
      onStateChange: state => states.push(state),
    });

    controller.start();
    await flushPromises();
    expect(states.at(-1)?.status).toBe('retrying');

    await controller.request('foreground');
    expect(states.at(-1)?.status).toBe('ready');

    controller.stop();
  });

  it('does not let a delayed document request block task refresh', async () => {
    jest.useFakeTimers();
    const refreshTasks = jest.fn().mockResolvedValue(undefined);
    const refreshDocuments = jest.fn(() => new Promise<void>(() => undefined));

    const refresh = runDAVEOperationalCollectionRefreshes([
      { name: 'schedule_items', run: refreshTasks },
      { name: 'reference_documents', run: refreshDocuments },
    ], 100);

    await flushPromises();
    expect(refreshTasks).toHaveBeenCalledTimes(1);
    expect(refreshDocuments).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    await flushPromises();
    await expect(refresh).resolves.toEqual(['reference_documents']);
  });

  it('reports only the failed collection when other operational pulls succeed', async () => {
    const refresh = await runDAVEOperationalCollectionRefreshes([
      { name: 'project_areas', run: jest.fn().mockResolvedValue(undefined) },
      { name: 'schedule_items', run: jest.fn().mockRejectedValue(new Error('temporary')) },
      { name: 'reference_documents', run: jest.fn().mockResolvedValue(undefined) },
    ]);

    expect(refresh).toEqual(['schedule_items']);
  });

  it('prevents an older timed-out refresh from overwriting a newer successful refresh', async () => {
    jest.useFakeTimers();
    const commitGuard = createDAVEOperationalRefreshCommitGuard();
    let resolveOldRequest: (value: string) => void = () => undefined;
    const oldResponse = new Promise<string>(resolve => {
      resolveOldRequest = resolve;
    });
    let visibleValue = 'local';
    const oldCommit = commitGuard.begin();

    const oldRefresh = runDAVEOperationalCollectionRefreshes([
      {
        name: 'schedule_items',
        run: async () => {
          const value = await oldResponse;
          oldCommit.commit(() => {
            visibleValue = value;
          });
        },
      },
    ], 100);

    jest.advanceTimersByTime(100);
    await flushPromises();
    await expect(oldRefresh).resolves.toEqual(['schedule_items']);

    const newCommit = commitGuard.begin();
    const newRefresh = await runDAVEOperationalCollectionRefreshes([
      {
        name: 'schedule_items',
        run: async () => {
          newCommit.commit(() => {
            visibleValue = 'new cloud value';
          });
        },
      },
    ], 100);
    expect(newRefresh).toEqual([]);
    expect(visibleValue).toBe('new cloud value');

    resolveOldRequest('stale cloud value');
    await flushPromises();

    expect(oldCommit.isCurrent()).toBe(false);
    expect(visibleValue).toBe('new cloud value');
  });

  it('invalidates pending commits when the refresh owner stops', () => {
    const commitGuard = createDAVEOperationalRefreshCommitGuard();
    const pendingCommit = commitGuard.begin();
    const mutation = jest.fn();

    commitGuard.invalidate();

    expect(pendingCommit.commit(mutation)).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('subscribes to owner-scoped project, update, task, area, document, and deletion changes', () => {
    const handlers = new Map<string, () => void>();
    let statusHandler: (status: string) => void = () => undefined;
    const channel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    channel.on.mockImplementation(
      (_kind: string, config: { table: string; filter: string }, handler: () => void) => {
        handlers.set(config.table, handler);
        expect(config.filter).toBe('owner_id=eq.owner-1');
        return channel;
      },
    );
    channel.subscribe.mockImplementation((handler: (status: string) => void) => {
      statusHandler = handler;
      return channel;
    });
    const removeChannel = jest.fn().mockResolvedValue('ok');
    const client = {
      channel: jest.fn(() => channel),
      removeChannel,
    } as unknown as Pick<SupabaseClient, 'channel' | 'removeChannel'>;
    const entities: DAVEOperationalRealtimeEntity[] = [];
    const statuses: string[] = [];

    const unsubscribe = attachDAVEOperationalRealtime({
      client,
      ownerId: 'owner-1',
      onChange: entity => entities.push(entity),
      onStatus: status => statuses.push(status),
    });

    statusHandler('SUBSCRIBED');
    handlers.get('projects')?.();
    handlers.get('project_updates')?.();
    handlers.get('schedule_items')?.();
    handlers.get('project_areas')?.();
    handlers.get('reference_documents')?.();
    handlers.get('dave_sync_tombstones')?.();

    expect(statuses).toEqual(['subscribed']);
    expect(entities).toEqual([
      'project',
      'project_update',
      'schedule_item',
      'project_area',
      'reference_document',
      'sync_tombstone',
    ]);
    expect(channel.on).toHaveBeenCalledTimes(6);

    unsubscribe();
    unsubscribe();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it('rebuilds a failed realtime channel without requiring an app restart', async () => {
    jest.useFakeTimers();
    const statusHandlers: Array<(status: string) => void> = [];
    const channels = Array.from({ length: 2 }, () => {
      const channel: { on: jest.Mock; subscribe: jest.Mock } = {
        on: jest.fn(),
        subscribe: jest.fn(),
      };
      channel.on.mockImplementation(() => channel);
      channel.subscribe.mockImplementation((handler: (status: string) => void) => {
        statusHandlers.push(handler);
        return channel;
      });
      return channel;
    });
    const channel = jest.fn()
      .mockReturnValueOnce(channels[0])
      .mockReturnValueOnce(channels[1]);
    const removeChannel = jest.fn().mockResolvedValue('ok');
    const statuses: string[] = [];

    const unsubscribe = attachDAVEOperationalRealtime({
      client: { channel, removeChannel } as unknown as Pick<
        SupabaseClient,
        'channel' | 'removeChannel'
      >,
      ownerId: 'owner-1',
      onChange: () => undefined,
      onStatus: status => statuses.push(status),
    });

    statusHandlers[0]('CHANNEL_ERROR');
    expect(statuses).toEqual(['error']);
    expect(channel).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS[0]);
    await flushPromises();
    expect(removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(channel).toHaveBeenCalledTimes(2);

    statusHandlers[1]('SUBSCRIBED');
    expect(statuses).toEqual(['error', 'subscribed']);

    unsubscribe();
    expect(removeChannel).toHaveBeenLastCalledWith(channels[1]);
  });

  it('cancels a pending reconnect when the app stops listening', async () => {
    jest.useFakeTimers();
    let statusHandler: (status: string) => void = () => undefined;
    const realtimeChannel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    realtimeChannel.on.mockImplementation(() => realtimeChannel);
    realtimeChannel.subscribe.mockImplementation((handler: (status: string) => void) => {
      statusHandler = handler;
      return realtimeChannel;
    });
    const channel = jest.fn(() => realtimeChannel);
    const removeChannel = jest.fn().mockResolvedValue('ok');
    const unsubscribe = attachDAVEOperationalRealtime({
      client: { channel, removeChannel } as unknown as Pick<
        SupabaseClient,
        'channel' | 'removeChannel'
      >,
      ownerId: 'owner-1',
      onChange: () => undefined,
    });

    statusHandler('TIMED_OUT');
    unsubscribe();
    jest.advanceTimersByTime(DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS[0]);
    await flushPromises();

    expect(channel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
