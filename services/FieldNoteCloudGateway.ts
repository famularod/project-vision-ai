import type { SupabaseClient } from '@supabase/supabase-js';

import {
  FIELD_NOTE_VERSION,
  normalizeFieldNote,
  type FieldNote,
} from './FieldNoteRepository';
import { paginateSupabaseCollection } from './SupabaseCollectionPagination';

const FIELD_NOTES_TABLE = 'field_notes';
const REALTIME_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000, 10_000, 30_000]);
let realtimeSubscriptionSequence = 0;

export type FieldNoteCloudErrorCode =
  | 'authorization'
  | 'conflict'
  | 'not_found'
  | 'read_failed'
  | 'write_failed';

export class FieldNoteCloudError extends Error {
  constructor(
    public readonly code: FieldNoteCloudErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FieldNoteCloudError';
  }
}

export type FieldNoteCloudRealtimeStatus = 'subscribed' | 'retrying' | 'closed';

export type FieldNoteCloudGateway = Readonly<{
  list: () => Promise<readonly FieldNote[]>;
  create: (note: FieldNote) => Promise<FieldNote>;
  update: (note: FieldNote, expectedRevision: number) => Promise<FieldNote>;
  subscribe: (
    onChange: (note: FieldNote) => void,
    onStatus?: (status: FieldNoteCloudRealtimeStatus) => void,
  ) => Promise<() => void>;
}>;

export function createFieldNoteCloudGateway(
  client: SupabaseClient | null,
  getAuthorizedOwnerId: () => Promise<string>,
): FieldNoteCloudGateway {
  async function authorizedContext() {
    if (!client) {
      throw new FieldNoteCloudError(
        'authorization',
        'Cloud synchronization is not configured on this device.',
      );
    }
    const ownerId = (await getAuthorizedOwnerId()).trim();
    if (!ownerId) {
      throw new FieldNoteCloudError(
        'authorization',
        'Sign in is required before Field Notes can synchronize.',
      );
    }
    return { client, ownerId } as const;
  }

  return Object.freeze({
    async list(): Promise<readonly FieldNote[]> {
      const context = await authorizedContext();
      const result = await paginateSupabaseCollection<Record<string, unknown>>(
        async ({ from, to }) => {
          const response = await context.client
            .from(FIELD_NOTES_TABLE)
            .select('*')
            .eq('owner_id', context.ownerId)
            .order('created_at', { ascending: false })
            .range(from, to);
          return response;
        },
      );
      if (!result.ok) {
        throw new FieldNoteCloudError(
          'read_failed',
          'Field Notes could not be refreshed from the cloud.',
        );
      }
      return Object.freeze(result.rows.map(normalizeFieldNoteCloudRow));
    },

    async create(note: FieldNote): Promise<FieldNote> {
      const context = await authorizedContext();
      const local = normalizeFieldNote(note);
      const { data, error } = await context.client
        .from(FIELD_NOTES_TABLE)
        .insert(fieldNoteCloudRow(local, context.ownerId, 1))
        .select('*')
        .single();

      if (!error && data) return normalizeFieldNoteCloudRow(data);
      if (error?.code !== '23505') {
        throw new FieldNoteCloudError(
          'write_failed',
          'The field note is saved on this device and is waiting to synchronize.',
        );
      }

      const existing = await readOne(context.client, context.ownerId, local.id);
      if (!existing) {
        throw new FieldNoteCloudError(
          'write_failed',
          'The field note is saved on this device and is waiting to synchronize.',
        );
      }
      if (!sameFieldNoteContent(local, existing)) {
        throw new FieldNoteCloudError(
          'conflict',
          'This field note ID already contains different information in the cloud.',
        );
      }
      return existing;
    },

    async update(note: FieldNote, expectedRevision: number): Promise<FieldNote> {
      const context = await authorizedContext();
      const local = normalizeFieldNote(note);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new FieldNoteCloudError(
          'conflict',
          'This note does not have a synchronized revision. Refresh it before editing.',
        );
      }
      const nextRevision = expectedRevision + 1;
      const { data, error } = await context.client
        .from(FIELD_NOTES_TABLE)
        .update(fieldNoteCloudRow(local, context.ownerId, nextRevision))
        .eq('owner_id', context.ownerId)
        .eq('id', local.id)
        .eq('revision', expectedRevision)
        .select('*')
        .maybeSingle();

      if (error) {
        throw new FieldNoteCloudError(
          'write_failed',
          'The field note is saved on this device and is waiting to synchronize.',
        );
      }
      if (data) return normalizeFieldNoteCloudRow(data);

      const current = await readOne(context.client, context.ownerId, local.id);
      if (!current) {
        throw new FieldNoteCloudError(
          'not_found',
          'This field note is no longer available in the cloud.',
        );
      }
      if (sameFieldNoteContent(local, current)) return current;
      throw new FieldNoteCloudError(
        'conflict',
        'This note changed on another device. Review the newer version before saving again.',
      );
    },

    async subscribe(onChange, onStatus = () => undefined): Promise<() => void> {
      const context = await authorizedContext();
      const ownerFilter = `owner_id=eq.${context.ownerId}`;
      const subscriptionId = `${Date.now()}-${++realtimeSubscriptionSequence}`;
      let stopped = false;
      let reconnectAttempt = 0;
      let connectionSequence = 0;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let channel: ReturnType<typeof context.client.channel> | null = null;

      function clearReconnectTimer() {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      function scheduleReconnect() {
        if (stopped || reconnectTimer) return;
        onStatus('retrying');
        const delay = REALTIME_RETRY_DELAYS_MS[
          Math.min(reconnectAttempt, REALTIME_RETRY_DELAYS_MS.length - 1)
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
                await context.client.removeChannel(previousChannel);
              } catch {
                // A failed cleanup must not block an owner-scoped reconnect.
              }
            }
            if (!stopped) connect();
          })();
        }, delay);
      }

      function connect() {
        if (stopped) return;
        let nextChannel: ReturnType<typeof context.client.channel> | null = null;
        try {
          nextChannel = context.client.channel(
            `field-notes-${context.ownerId}-${subscriptionId}-${++connectionSequence}`,
          );
          nextChannel.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: FIELD_NOTES_TABLE,
              filter: ownerFilter,
            },
            payload => {
              const candidate = payload.new;
              if (!candidate || Object.keys(candidate).length === 0) return;
              try {
                onChange(normalizeFieldNoteCloudRow(candidate));
              } catch {
                // Ignore malformed rows; the next bounded collection read can recover.
              }
            },
          );
          channel = nextChannel;
          nextChannel.subscribe(status => {
            if (stopped || channel !== nextChannel) return;
            if (status === 'SUBSCRIBED') {
              clearReconnectTimer();
              reconnectAttempt = 0;
              onStatus('subscribed');
            } else if (status === 'CLOSED') {
              onStatus('closed');
              scheduleReconnect();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              scheduleReconnect();
            }
          });
        } catch {
          if (channel === nextChannel) channel = null;
          if (nextChannel) void context.client.removeChannel(nextChannel).catch(() => undefined);
          scheduleReconnect();
        }
      }

      connect();
      return () => {
        if (stopped) return;
        stopped = true;
        clearReconnectTimer();
        const activeChannel = channel;
        channel = null;
        if (activeChannel) void context.client.removeChannel(activeChannel);
      };
    },
  });
}

export function normalizeFieldNoteCloudRow(value: unknown): FieldNote {
  const row = record(value);
  return normalizeFieldNote({
    schemaVersion: FIELD_NOTE_VERSION,
    id: row.id,
    originalText: row.original_text,
    source: row.source,
    projectId: row.project_id,
    projectName: row.project_name,
    locationName: row.location_name,
    actionKind: row.action_kind,
    actionText: row.action_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    archivedAt: row.archived_at,
    revision: row.revision,
    cloudUpdatedAt: row.updated_at,
    syncState: 'synced',
    syncError: null,
  });
}

export function sameFieldNoteContent(left: FieldNote, right: FieldNote): boolean {
  const leftNote = normalizeFieldNote(left);
  const rightNote = normalizeFieldNote(right);
  return JSON.stringify(fieldNoteComparableValue(leftNote)) ===
    JSON.stringify(fieldNoteComparableValue(rightNote));
}

function fieldNoteCloudRow(
  note: FieldNote,
  ownerId: string,
  revision: number,
) {
  return {
    owner_id: ownerId,
    id: note.id,
    original_text: note.originalText,
    source: note.source,
    project_id: note.projectId,
    project_name: note.projectName,
    location_name: note.locationName,
    action_kind: note.actionKind,
    action_text: note.actionKind === 'none' ? null : note.actionText,
    status: note.status,
    revision,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    resolved_at: note.resolvedAt,
    archived_at: note.archivedAt,
  };
}

async function readOne(
  client: SupabaseClient,
  ownerId: string,
  id: string,
): Promise<FieldNote | null> {
  const { data, error } = await client
    .from(FIELD_NOTES_TABLE)
    .select('*')
    .eq('owner_id', ownerId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new FieldNoteCloudError(
      'read_failed',
      'The latest field note revision could not be checked.',
    );
  }
  return data ? normalizeFieldNoteCloudRow(data) : null;
}

function fieldNoteComparableValue(note: FieldNote) {
  return {
    id: note.id,
    originalText: note.originalText,
    source: note.source,
    projectId: note.projectId,
    projectName: note.projectName,
    locationName: note.locationName,
    actionKind: note.actionKind,
    actionText: note.actionText,
    status: note.status,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    resolvedAt: note.resolvedAt,
    archivedAt: note.archivedAt,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Field note cloud row is invalid.');
  }
  return value as Record<string, unknown>;
}
