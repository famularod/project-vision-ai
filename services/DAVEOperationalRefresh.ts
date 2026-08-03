import type { SupabaseClient } from '@supabase/supabase-js';

// Realtime and foreground activation keep active work current. This is only a
// safety net for a missed event, so keep full-collection reads infrequent.
export const DAVE_OPERATIONAL_POLL_INTERVAL_MS = 30 * 60_000;
export const DAVE_WEB_OPERATIONAL_POLL_INTERVAL_MS = 30 * 60_000;
// A healthy Realtime channel already applies row-level changes. Re-entering
// the app inside this window therefore does not need another full portfolio
// read; older or disconnected sessions still take the conservative path.
export const DAVE_OPERATIONAL_FOREGROUND_FRESHNESS_MS = 5 * 60_000;
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

export type DAVEOperationalRealtimePayload = Readonly<{
  eventType: 'INSERT' | 'UPDATE' | 'DELETE' | 'UNKNOWN';
  newRow: Readonly<Record<string, unknown>> | null;
  oldRow: Readonly<Record<string, unknown>> | null;
  raw: unknown;
}>;

export type DAVEOperationalCollectionName =
  | 'projects'
  | 'project_updates'
  | 'project_areas'
  | 'schedule_items'
  | 'reference_documents'
  | 'sync_tombstones';

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

export function shouldRefreshDAVEOperationalDataOnForeground({
  realtimeHealthy,
  lastSuccessfulRefreshAt,
  now = Date.now(),
  freshnessMs = DAVE_OPERATIONAL_FOREGROUND_FRESHNESS_MS,
}: Readonly<{
  realtimeHealthy: boolean;
  lastSuccessfulRefreshAt: string | null;
  now?: number;
  freshnessMs?: number;
}>): boolean {
  if (!realtimeHealthy || !lastSuccessfulRefreshAt) return true;
  const refreshedAt = new Date(lastSuccessfulRefreshAt).getTime();
  if (!Number.isFinite(refreshedAt)) return true;
  return now - refreshedAt >= freshnessMs;
}

type OperationalRefreshControllerOptions = {
  refresh: (
    trigger: DAVEOperationalRefreshTrigger,
    collections?: readonly DAVEOperationalCollectionName[],
  ) => Promise<void>;
  canRefresh?: () => boolean;
  onStateChange?: (state: DAVEOperationalRefreshState) => void;
  pollIntervalMs?: number;
};

export function daveOperationalCollectionForRealtimeEntity(
  entity: DAVEOperationalRealtimeEntity,
): DAVEOperationalCollectionName | null {
  switch (entity) {
    case 'project':
      return 'projects';
    case 'project_update':
      return 'project_updates';
    case 'project_area':
      return 'project_areas';
    case 'schedule_item':
      return 'schedule_items';
    case 'reference_document':
      return 'reference_documents';
    case 'sync_tombstone':
      return null;
  }
}

export function daveOperationalCollectionsForRealtimeEvent(
  entity: DAVEOperationalRealtimeEntity,
  payload?: unknown,
): readonly DAVEOperationalCollectionName[] | undefined {
  const directCollection = daveOperationalCollectionForRealtimeEntity(entity);
  if (directCollection) return [directCollection];

  const tombstoneCollection = collectionForTombstonePayload(payload);
  return tombstoneCollection
    ? ['sync_tombstones', tombstoneCollection]
    : undefined;
}

export function normalizeDAVEOperationalRealtimePayload(
  payload: unknown,
): DAVEOperationalRealtimePayload {
  const record = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const rawEventType = typeof record.eventType === 'string'
    ? record.eventType.toUpperCase()
    : 'UNKNOWN';
  const eventType = rawEventType === 'INSERT' ||
    rawEventType === 'UPDATE' ||
    rawEventType === 'DELETE'
    ? rawEventType
    : 'UNKNOWN';
  return Object.freeze({
    eventType,
    newRow: realtimeRow(record.new),
    oldRow: realtimeRow(record.old),
    raw: payload,
  });
}

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
  let trailingCollections: Set<DAVEOperationalCollectionName> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let lastSuccessfulRefreshAt: string | null = null;

  function queueTrailingCollections(
    collections?: readonly DAVEOperationalCollectionName[],
  ) {
    if (!collections) {
      trailingCollections = null;
      return;
    }
    if (trailingCollections === null && trailingRefreshRequested) return;
    trailingCollections ??= new Set<DAVEOperationalCollectionName>();
    collections.forEach(collection => trailingCollections?.add(collection));
  }

  async function request(
    trigger: DAVEOperationalRefreshTrigger,
    collections?: readonly DAVEOperationalCollectionName[],
  ): Promise<void> {
    if (!running || !canRefresh()) return;
    if (inFlight) {
      queueTrailingCollections(collections);
      trailingRefreshRequested = true;
      return;
    }

    inFlight = true;
    let nextTrigger = trigger;
    let nextCollections = collections;
    try {
      do {
        trailingRefreshRequested = false;
        trailingCollections = null;
        onStateChange({
          status: 'refreshing',
          trigger: nextTrigger,
          lastSuccessfulRefreshAt,
        });
        try {
          if (nextCollections) await refresh(nextTrigger, nextCollections);
          else await refresh(nextTrigger);
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
        nextCollections = trailingCollections
          ? Array.from(trailingCollections)
          : undefined;
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
    trailingCollections = null;
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
  onChange: (
    entity: DAVEOperationalRealtimeEntity,
    collections?: readonly DAVEOperationalCollectionName[],
    payload?: DAVEOperationalRealtimePayload,
  ) => void;
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
        payload => onChange(
          'project',
          daveOperationalCollectionsForRealtimeEvent('project', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_updates', filter: ownerFilter },
        payload => onChange(
          'project_update',
          daveOperationalCollectionsForRealtimeEvent('project_update', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_areas', filter: ownerFilter },
        payload => onChange(
          'project_area',
          daveOperationalCollectionsForRealtimeEvent('project_area', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'schedule_items', filter: ownerFilter },
        payload => onChange(
          'schedule_item',
          daveOperationalCollectionsForRealtimeEvent('schedule_item', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reference_documents', filter: ownerFilter },
        payload => onChange(
          'reference_document',
          daveOperationalCollectionsForRealtimeEvent('reference_document', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dave_sync_tombstones', filter: ownerFilter },
        payload => onChange(
          'sync_tombstone',
          daveOperationalCollectionsForRealtimeEvent('sync_tombstone', payload),
          normalizeDAVEOperationalRealtimePayload(payload),
        ),
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

function realtimeRow(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.freeze({ ...(value as Record<string, unknown>) })
    : null;
}

function collectionForTombstonePayload(
  payload: unknown,
): DAVEOperationalCollectionName | null {
  if (!payload || typeof payload !== 'object') return null;
  const event = payload as Record<string, unknown>;
  const candidateRows = [event.new, event.old];
  for (const candidate of candidateRows) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entityType = (candidate as Record<string, unknown>).entity_type;
    if (typeof entityType !== 'string') continue;
    switch (entityType) {
      case 'project':
        return 'projects';
      case 'project_update':
        return 'project_updates';
      case 'project_area':
        return 'project_areas';
      case 'schedule_item':
        return 'schedule_items';
      case 'reference_document':
        return 'reference_documents';
    }
  }
  return null;
}
