import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { ScheduleItem } from '../types';
import { supabaseSecureAuthStorage } from './SupabaseAuthStorage.web';
import { paginateSupabaseCollection } from './SupabaseCollectionPagination';

export type DAVEWebRawRows = Readonly<{
  projects: readonly unknown[];
  scheduleItems: readonly unknown[];
  projectUpdates: readonly unknown[];
  referenceDocuments: readonly unknown[];
  syncTombstones: readonly unknown[];
}>;

export type DAVEWebSignInResult = Readonly<{
  ok: boolean;
  session: Session | null;
}>;

export type DAVEWebSessionStatus = Readonly<{
  configured: boolean;
  session: Session | null;
}>;

export class DAVEWebAuthorizationError extends Error {
  constructor(message = 'This account is not authorized for the Vitruvius desktop pilot.') {
    super(message);
    this.name = 'DAVEWebAuthorizationError';
  }
}

export type DAVEWebTaskMutationErrorCode =
  | 'conflict'
  | 'deleted'
  | 'not_found'
  | 'write_failed';

export class DAVEWebTaskMutationError extends Error {
  constructor(
    public readonly code: DAVEWebTaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DAVEWebTaskMutationError';
  }
}

export class DAVEWebDocumentMutationError extends Error {
  constructor(
    public readonly code: DAVEWebTaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DAVEWebDocumentMutationError';
  }
}

export type DAVEWebSupabaseGateway = ReturnType<typeof createDAVEWebSupabaseGateway>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

const browserClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: supabaseSecureAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function createDAVEWebSupabaseGateway(client: SupabaseClient | null) {
  return Object.freeze({
    async getSessionStatus(): Promise<DAVEWebSessionStatus> {
      if (!client) return { configured: false, session: null };
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error('The desktop session could not be checked.');
      return { configured: true, session: data.session ?? null };
    },

    subscribeToAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): () => void {
      if (!client) return () => undefined;
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },

    async signIn(email: string, password: string): Promise<DAVEWebSignInResult> {
      if (!client) return { ok: false, session: null };
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return { ok: false, session: null };
      return { ok: true, session: data.session };
    },

    async signOut(): Promise<void> {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw new Error('The desktop session could not be closed.');
    },

    async loadAuthorizedRows(): Promise<DAVEWebRawRows> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const userId = await requireAuthorizedOwner(client);

      const [projects, scheduleItems, projectUpdates, referenceDocuments, syncTombstones] = await Promise.all([
        readOwnerRows(client, 'projects', userId, query => query.eq('archived', false).order('created_at', { ascending: false })),
        readOwnerRows(client, 'schedule_items', userId, query => query.order('updated_at', { ascending: false })),
        readOwnerRows(client, 'project_updates', userId, query => query.order('created_at', { ascending: false })),
        readOwnerRows(client, 'reference_documents', userId, query => query.order('updated_at', { ascending: false })),
        readOwnerRows(client, 'dave_sync_tombstones', userId, query => query.order('deleted_at', { ascending: false })),
      ]);

      return Object.freeze({ projects, scheduleItems, projectUpdates, referenceDocuments, syncTombstones });
    },

    async createAuthorizedScheduleItem(item: ScheduleItem): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwner(client);
      const cloudUpdatedAt = new Date().toISOString();
      const { data, error } = await client
        .from('schedule_items')
        .insert(scheduleItemRow(item, ownerId, cloudUpdatedAt))
        .select('updated_at')
        .single();

      if (error || !data) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be created. Refresh the workspace and try again.',
        );
      }
      return readCloudTimestamp(data) ?? cloudUpdatedAt;
    },

    async updateAuthorizedScheduleItem(
      item: ScheduleItem,
      expectedCloudUpdatedAt: string | null,
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) throw staleTaskError();
      const ownerId = await requireAuthorizedOwner(client);
      if (await scheduleItemWasDeleted(client, ownerId, item.id)) {
        throw new DAVEWebTaskMutationError(
          'deleted',
          'This task was deleted on another device. The workspace has been refreshed.',
        );
      }

      const cloudUpdatedAt = new Date().toISOString();
      const { data, error } = await client
        .from('schedule_items')
        .update(scheduleItemRow(item, ownerId, cloudUpdatedAt))
        .eq('owner_id', ownerId)
        .eq('id', item.id)
        .eq('updated_at', expectedCloudUpdatedAt)
        .select('updated_at')
        .maybeSingle();

      if (error) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be updated. Refresh the workspace and try again.',
        );
      }
      if (!data) throw staleTaskError();
      return readCloudTimestamp(data) ?? cloudUpdatedAt;
    },

    async deleteAuthorizedScheduleItem(
      itemId: string,
      expectedCloudUpdatedAt: string | null,
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) throw staleTaskError();
      const ownerId = await requireAuthorizedOwner(client);

      if (await scheduleItemWasDeleted(client, ownerId, itemId)) {
        return new Date().toISOString();
      }

      const { data: current, error: currentError } = await client
        .from('schedule_items')
        .select('updated_at')
        .eq('owner_id', ownerId)
        .eq('id', itemId)
        .maybeSingle();
      if (currentError) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be checked before deletion. Refresh and try again.',
        );
      }
      if (!current) {
        throw new DAVEWebTaskMutationError(
          'not_found',
          'This task no longer exists. The workspace has been refreshed.',
        );
      }
      if (readCloudTimestamp(current) !== expectedCloudUpdatedAt) throw staleTaskError();

      const deletedAt = new Date().toISOString();
      const { error } = await client
        .from('dave_sync_tombstones')
        .upsert(
          {
            owner_id: ownerId,
            entity_type: 'schedule_item',
            record_id: itemId,
            deleted_at: deletedAt,
          },
          { onConflict: 'owner_id,entity_type,record_id' },
        );
      if (error) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task deletion marker could not be saved. Nothing was deleted.',
        );
      }
      return deletedAt;
    },

    async deleteAuthorizedReferenceDocument(
      documentId: string,
      expectedCloudUpdatedAt: string | null,
      linkedScheduleItems: readonly Readonly<{ id: string; cloudUpdatedAt: string | null }>[] = [],
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) throw staleDocumentError();
      const ownerId = await requireAuthorizedOwner(client);

      if (await recordWasDeleted(client, ownerId, 'reference_document', documentId)) {
        return new Date().toISOString();
      }

      const { data: current, error: currentError } = await client
        .from('reference_documents')
        .select('updated_at')
        .eq('owner_id', ownerId)
        .eq('id', documentId)
        .maybeSingle();
      if (currentError) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The document could not be checked before deletion. Refresh and try again.',
        );
      }
      if (!current) {
        throw new DAVEWebDocumentMutationError(
          'not_found',
          'This document no longer exists. The workspace has been refreshed.',
        );
      }
      if (readCloudTimestamp(current) !== expectedCloudUpdatedAt) throw staleDocumentError();

      const requestedTaskRevisions = new Map<string, string | null>();
      linkedScheduleItems.forEach(item => {
        const id = item.id.trim();
        if (id) requestedTaskRevisions.set(id, item.cloudUpdatedAt);
      });
      const requestedTaskIds = [...requestedTaskRevisions.keys()];
      if (requestedTaskIds.length > 0) {
        const { data: ownedTasks, error: ownedTasksError } = await client
          .from('schedule_items')
          .select('id,updated_at')
          .eq('owner_id', ownerId)
          .in('id', requestedTaskIds);
        const ownedRevisions = new Map(
          (ownedTasks ?? [])
            .map(row => [
              typeof row?.id === 'string' ? row.id : '',
              readCloudTimestamp(row),
            ] as const)
            .filter(([id]) => Boolean(id)),
        );
        if (
          ownedTasksError ||
          requestedTaskIds.some(id => (
            !requestedTaskRevisions.get(id) ||
            ownedRevisions.get(id) !== requestedTaskRevisions.get(id)
          ))
        ) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'The document task links changed on another device. Refresh and review them before deleting.',
          );
        }
      }

      const deletedAt = new Date().toISOString();
      const deletionMarkers = [
        {
          owner_id: ownerId,
          entity_type: 'reference_document',
          record_id: documentId,
          deleted_at: deletedAt,
        },
        ...requestedTaskIds.map(recordId => ({
          owner_id: ownerId,
          entity_type: 'schedule_item',
          record_id: recordId,
          deleted_at: deletedAt,
        })),
      ];
      const { error } = await client
        .from('dave_sync_tombstones')
        .upsert(deletionMarkers, { onConflict: 'owner_id,entity_type,record_id' });
      if (error) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The document deletion marker could not be saved. Nothing was deleted.',
        );
      }
      return deletedAt;
    },
  });
}

export const daveWebSupabaseGateway = createDAVEWebSupabaseGateway(browserClient);

async function requireAuthorizedOwner(client: SupabaseClient): Promise<string> {
  const { data: userResult, error: userError } = await client.auth.getUser();
  const userId = userResult.user?.id ?? null;
  if (userError || !userId) {
    throw new DAVEWebAuthorizationError('Sign in is required for the Vitruvius desktop pilot.');
  }

  const { data: authorized, error: authorizationError } = await client.rpc('dave_is_app_owner');
  if (authorizationError || authorized !== true) throw new DAVEWebAuthorizationError();
  return userId;
}

function scheduleItemRow(item: ScheduleItem, ownerId: string, updatedAt: string) {
  return {
    id: item.id,
    owner_id: ownerId,
    project_name: item.projectName,
    task_name: item.taskName,
    item_data: item,
    updated_at: updatedAt,
  };
}

async function scheduleItemWasDeleted(
  client: SupabaseClient,
  ownerId: string,
  itemId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('dave_sync_tombstones')
    .select('deleted_at')
    .eq('owner_id', ownerId)
    .eq('entity_type', 'schedule_item')
    .eq('record_id', itemId)
    .maybeSingle();
  if (error) {
    throw new DAVEWebTaskMutationError(
      'write_failed',
      'Deletion history could not be checked. Refresh the workspace and try again.',
    );
  }
  return Boolean(data);
}

async function recordWasDeleted(
  client: SupabaseClient,
  ownerId: string,
  entityType: 'reference_document',
  recordId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('dave_sync_tombstones')
    .select('deleted_at')
    .eq('owner_id', ownerId)
    .eq('entity_type', entityType)
    .eq('record_id', recordId)
    .maybeSingle();
  if (error) {
    throw new DAVEWebDocumentMutationError(
      'write_failed',
      'Document deletion history could not be checked. Refresh and try again.',
    );
  }
  return Boolean(data);
}

function readCloudTimestamp(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const updatedAt = (value as Record<string, unknown>).updated_at;
  return typeof updatedAt === 'string' && updatedAt.trim() ? updatedAt : null;
}

function staleTaskError() {
  return new DAVEWebTaskMutationError(
    'conflict',
    'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
  );
}

function staleDocumentError() {
  return new DAVEWebDocumentMutationError(
    'conflict',
    'This document changed on another device. The workspace has been refreshed; review the latest record before deleting.',
  );
}

async function readOwnerRows(
  client: SupabaseClient,
  table: string,
  ownerId: string,
  refine: (query: any) => any,
): Promise<readonly unknown[]> {
  const result = await paginateSupabaseCollection(({ from, to, includeExactCount }) => {
    const baseQuery = client
      .from(table)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', ownerId);
    return refine(baseQuery).range(from, to);
  });

  if (!result.ok) throw new Error(`Authorized ${table.replace(/_/g, ' ')} could not be loaded.`);
  return Object.freeze([...result.rows]);
}
