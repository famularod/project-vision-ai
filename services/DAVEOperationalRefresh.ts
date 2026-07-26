import type { SupabaseClient } from '@supabase/supabase-js';

export const DAVE_OPERATIONAL_POLL_INTERVAL_MS = 4_000;
export const DAVE_OPERATIONAL_REQUEST_TIMEOUT_MS = 3_500;
export const DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS = Object.freeze([
  1_000,
  3_000,
  10_000,
  30_000,
]) as readonly number[];
export const DAVE_OPERATIONAL_REFRESH_RETRY_MESSAGE =
  'Automatic device refresh is reconnecting. Your saved changes are protected, and Vitruvius will keep retrying while the app is open.';

export type DAVEOperationalRefreshTrigger =
  | 'initial'
  | 'interval'
  | 'foreground'
  | 'realtime';

export type DAVEOperationalRefreshState = {
  status: 'refreshing' | 'ready' | 'retrying';
  trigger: DAVEOperationalRefreshTrigger;
  lastSuccessfulRefreshAt: string | null;
};

export type DAVEOperationalRealtimeEntity =
  | 'project'
  | 'project_update'
  | 'project_area'
  | 'schedule_item'
  | 'reference_document'
  | 'sync_tombstone';

export type DAVEOperationalRealtimeStatus =
  | 'subscribed'
  | 'error'
  | 'closed';

export type DAVEOperationalCollectionName =
  | 'projects'
  | 'project_updates'
  | 'project_areas'
  | 'schedule_items'
  | 'reference_documents';

export type DAVEOperationalCollectionRefresh = Readonly<{
  name: DAVEOperationalCollectionName;
  run: () => Promise<void>;
}>;

export type DAVEOperationalRefreshCommit = Readonly<{
  generation: number;
  isCurrent: () => boolean;
  commit: (effect: () => void) => boolean;
}>;

export type DAVEOperationalRefreshCommitGuard = Readonly<{
  begin: () => DAVEOperationalRefreshCommit;
  invalidate: () => void;
}>;

type OperationalRefreshControllerOptions = {
  refresh: (trigger: DAVEOperationalRefreshTrigger) => Promise<void>;
  canRefresh?: () => boolean;
  onStateChange?: (state: DAVEOperationalRefreshState) => void;
  pollIntervalMs?: number;
};

/**
 * Creates a request-generation guard for asynchronous refreshes whose network
 * work can outlive a timeout. Starting a newer generation immediately makes
 * every older commit token stale, so a late response cannot replace newer
 * state or mutable refs.
 */
export function createDAVEOperationalRefreshCommitGuard():
  DAVEOperationalRefreshCommitGuard {
  let currentGeneration = 0;

  function begin(): DAVEOperationalRefreshCommit {
    const generation = currentGeneration + 1;
    currentGeneration = generation;
    return Object.freeze({
      generation,
      isCurrent: () => generation === currentGeneration,
      commit: effect => {
        if (generation !== currentGeneration) return false;
        effect();
        return true;
      },
    });
  }

  function invalidate(): void {
    currentGeneration += 1;
  }

  return Object.freeze({ begin, invalidate });
}

export function createDAVEOperationalRefreshController({
  refresh,
  canRefresh = () => true,
  onStateChange = () => undefined,
  pollIntervalMs = DAVE_OPERATIONAL_POLL_INTERVAL_MS,
}: OperationalRefreshControllerOptions) {
  let running = false;
  let inFlight = false;
  let trailingRefreshRequested = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastSuccessfulRefreshAt: string | null = null;

  async function request(trigger: DAVEOperationalRefreshTrigger): Promise<void> {
    if (!running || !canRefresh()) return;
    if (inFlight) {
      trailingRefreshRequested = true;
      return;
    }

    inFlight = true;
    let nextTrigger = trigger;
    try {
      do {
        trailingRefreshRequested = false;
        onStateChange({
          status: 'refreshing',
          trigger: nextTrigger,
          lastSuccessfulRefreshAt,
        });
        try {
          await refresh(nextTrigger);
          lastSuccessfulRefreshAt = new Date().toISOString();
          onStateChange({
            status: 'ready',
            trigger: nextTrigger,
            lastSuccessfulRefreshAt,
          });
        } catch {
          onStateChange({
            status: 'retrying',
            trigger: nextTrigger,
            lastSuccessfulRefreshAt,
          });
        }
        nextTrigger = 'realtime';
      } while (running && canRefresh() && trailingRefreshRequested);
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    interval = setInterval(() => {
      void request('interval');
    }, pollIntervalMs);
    void request('initial');
  }

  function stop() {
    running = false;
    trailingRefreshRequested = false;
    if (interval) clearInterval(interval);
    interval = null;
  }

  return Object.freeze({ start, stop, request });
}

export async function withDAVEOperationalRefreshTimeout<T>(
  operation: Promise<T>,
  timeoutMs = DAVE_OPERATIONAL_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('operational_refresh_timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runDAVEOperationalCollectionRefreshes(
  collections: readonly DAVEOperationalCollectionRefresh[],
  timeoutMs = DAVE_OPERATIONAL_REQUEST_TIMEOUT_MS,
): Promise<DAVEOperationalCollectionName[]> {
  const outcomes = await Promise.all(collections.map(async collection => {
    try {
      await withDAVEOperationalRefreshTimeout(collection.run(), timeoutMs);
      return null;
    } catch {
      return collection.name;
    }
  }));
  return outcomes.filter((name): name is DAVEOperationalCollectionName => Boolean(name));
}

export function attachDAVEOperationalRealtime({
  client,
  ownerId,
  onChange,
  onStatus = () => undefined,
}: {
  client: Pick<SupabaseClient, 'channel' | 'removeChannel'>;
  ownerId: string;
  onChange: (entity: DAVEOperationalRealtimeEntity) => void;
  onStatus?: (status: DAVEOperationalRealtimeStatus) => void;
}): () => void {
  const ownerFilter = `owner_id=eq.${ownerId}`;
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof client.channel> | null = null;

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS[
      Math.min(reconnectAttempt, DAVE_OPERATIONAL_REALTIME_RETRY_DELAYS_MS.length - 1)
    ];
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      const previousChannel = channel;
      channel = null;
      void (async () => {
        if (previousChannel) {
          try {
            await client.removeChannel(previousChannel);
          } catch {
            // A failed cleanup must not prevent a new owner-scoped channel.
          }
        }
        if (!stopped) connect();
      })();
    }, delay);
  }

  function connect() {
    if (stopped) return;
    const nextChannel = client
      .channel(`dave-operational-${ownerId}-${Date.now()}-${reconnectAttempt}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: ownerFilter },
        () => onChange('project'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_updates', filter: ownerFilter },
        () => onChange('project_update'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_areas', filter: ownerFilter },
        () => onChange('project_area'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_items', filter: ownerFilter },
        () => onChange('schedule_item'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reference_documents', filter: ownerFilter },
        () => onChange('reference_document'),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dave_sync_tombstones', filter: ownerFilter },
        () => onChange('sync_tombstone'),
      )
      .subscribe(status => {
        if (stopped || channel !== nextChannel) return;
        if (status === 'SUBSCRIBED') {
          clearReconnectTimer();
          reconnectAttempt = 0;
          onStatus('subscribed');
        } else if (status === 'CLOSED') {
          onStatus('closed');
          scheduleReconnect();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onStatus('error');
          scheduleReconnect();
        }
      });
    channel = nextChannel;
  }

  connect();
  return () => {
    if (stopped) return;
    stopped = true;
    clearReconnectTimer();
    const activeChannel = channel;
    channel = null;
    if (activeChannel) void client.removeChannel(activeChannel);
  };
}
