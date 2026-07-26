import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { ReferenceDocument, ScheduleItem } from '../types';
import type {
  DAVEWebDocumentExtension,
  DAVEWebReportRecord,
} from './DAVEWebOperations';
import { supabaseSecureAuthStorage } from './SupabaseAuthStorage.web';
import { paginateSupabaseCollection } from './SupabaseCollectionPagination';
import {
  attachDAVEOperationalRealtime,
  type DAVEOperationalRealtimeEntity,
  type DAVEOperationalRealtimeStatus,
} from './DAVEOperationalRefresh';

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

export type DAVEWebStorageBucket = 'project-photos' | 'project-documents';

export class DAVEWebArtifactAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAVEWebArtifactAccessError';
  }
}

export type DAVEWebDocumentUploadInput = Readonly<{
  document: ReferenceDocument & DAVEWebDocumentExtension;
  bytes: ArrayBuffer;
  scheduleItems?: readonly ScheduleItem[];
}>;

type DAVEWebRevisionedReferenceDocument =
  ReferenceDocument &
  DAVEWebDocumentExtension &
  Readonly<{ cloudUpdatedAt?: string | null }>;

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
  let artifactPathOwnerId: string | null = null;
  let authorizedPhotoPaths = new Set<string>();
  let authorizedDocumentPaths = new Set<string>();

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

    async subscribeToAuthorizedOperationalChanges({
      onChange,
      onStatus,
    }: {
      onChange: (entity: DAVEOperationalRealtimeEntity) => void;
      onStatus?: (status: DAVEOperationalRealtimeStatus) => void;
    }): Promise<() => void> {
      if (!client) return () => undefined;
      const ownerId = await requireAuthorizedOwner(client);
      return attachDAVEOperationalRealtime({
        client,
        ownerId,
        onChange,
        onStatus,
      });
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
      artifactPathOwnerId = userId;
      authorizedPhotoPaths = collectOwnerPhotoStoragePaths(projectUpdates);
      authorizedDocumentPaths = collectOwnerDocumentStoragePaths(referenceDocuments);

      return Object.freeze({ projects, scheduleItems, projectUpdates, referenceDocuments, syncTombstones });
    },

    async createAuthorizedArtifactSignedUrl(
      bucket: DAVEWebStorageBucket,
      path: string,
      expiresInSeconds = 600,
    ): Promise<string> {
      if (!client) throw new DAVEWebArtifactAccessError('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwner(client);
      if (bucket !== 'project-photos' && bucket !== 'project-documents') {
        throw new DAVEWebArtifactAccessError('This project file type is not available in the desktop workspace.');
      }
      const safePath = safeArtifactStoragePath(path);
      const pathWasLoadedFromOwnerRecord =
        artifactPathOwnerId === ownerId &&
        (bucket === 'project-photos'
          ? authorizedPhotoPaths.has(safePath)
          : authorizedDocumentPaths.has(safePath));
      if (!safePath.startsWith(`${ownerId}/`) && !pathWasLoadedFromOwnerRecord) {
        throw new DAVEWebArtifactAccessError(
          'This project file does not have an owner-authorized storage path.',
        );
      }
      const lifetime = Math.min(900, Math.max(60, Math.floor(expiresInSeconds)));
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(safePath, lifetime);
      const signedUrl = typeof data?.signedUrl === 'string' ? data.signedUrl.trim() : '';
      if (error || !signedUrl) {
        throw new DAVEWebArtifactAccessError(
          'The protected project file is temporarily unavailable. Refresh and try again.',
        );
      }
      return signedUrl;
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

    async uploadAuthorizedReferenceDocument({
      document,
      bytes,
      scheduleItems = [],
    }: DAVEWebDocumentUploadInput): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwner(client);
      if (bytes.byteLength <= 0 || bytes.byteLength > 25 * 1024 * 1024) {
        throw new DAVEWebDocumentMutationError('write_failed', 'The document must be between 1 byte and 25 MB.');
      }

      if (document.webFileFingerprint) {
        const existingRows = await readOwnerRows(
          client,
          'reference_documents',
          ownerId,
          query => query.order('updated_at', { ascending: false }),
        );
        const duplicate = existingRows.some(value => {
          const row = isRecord(value) ? value : {};
          const data = isRecord(row.document_data) ? row.document_data : {};
          return data.webFileFingerprint === document.webFileFingerprint;
        });
        if (duplicate) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'This exact file is already in the project document library.',
          );
        }
      }

      const storagePath = `${ownerId}/web/${safePathSegment(document.id)}/${safePathSegment(document.originalFileName)}`;
      const uploadedDocument = { ...document, storagePath };
      const storage = client.storage.from('project-documents');
      const { error: uploadError } = await storage.upload(storagePath, bytes, {
        contentType: document.mimeType || 'application/octet-stream',
        upsert: false,
      });
      if (uploadError) {
        throw new DAVEWebDocumentMutationError('write_failed', 'The file could not be uploaded to protected project storage.');
      }

      const cloudUpdatedAt = new Date().toISOString();
      const { error: documentError } = await client
        .from('reference_documents')
        .insert(referenceDocumentRow(uploadedDocument, ownerId, cloudUpdatedAt));
      if (documentError) {
        await storage.remove([storagePath]);
        throw new DAVEWebDocumentMutationError('write_failed', 'The document record could not be saved. The uploaded file was removed.');
      }

      if (scheduleItems.length > 0) {
        const rows = scheduleItems.map(item => scheduleItemRow(item, ownerId, cloudUpdatedAt));
        const { error: taskError } = await client
          .from('schedule_items')
          .upsert(rows, { onConflict: 'id' });
        if (taskError) {
          const compensation = await compensateFailedDocumentImport({
            client,
            storage,
            ownerId,
            documentId: document.id,
            cloudUpdatedAt,
            storagePath,
          });
          if (!compensation.visibilityRecovered) {
            throw new DAVEWebDocumentMutationError(
              'write_failed',
              'The schedule tasks could not be saved, and automatic cleanup could not be confirmed. Refresh before retrying and remove the incomplete document if it appears.',
            );
          }
          if (!compensation.storageFileRemoved) {
            throw new DAVEWebDocumentMutationError(
              'write_failed',
              'The schedule tasks could not be saved. The incomplete document was blocked, but file cleanup could not be confirmed. Refresh before retrying.',
            );
          }
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The schedule tasks could not be saved. The incomplete document import was rolled back and its file was removed.',
          );
        }
      }
      return cloudUpdatedAt;
    },

    async setAuthorizedCurrentSchedule(
      selected: ReferenceDocument & DAVEWebDocumentExtension & { cloudUpdatedAt?: string | null },
      scheduleDocuments: readonly (ReferenceDocument & DAVEWebDocumentExtension & { cloudUpdatedAt?: string | null })[],
    ): Promise<void> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwner(client);
      const candidates = scheduleDocuments.filter(document => document.id && document.cloudUpdatedAt);
      if (!selected.cloudUpdatedAt || !candidates.some(document => document.id === selected.id)) throw staleDocumentError();

      const { data: currentRows, error: currentError } = await client
        .from('reference_documents')
        .select('id,updated_at')
        .eq('owner_id', ownerId)
        .in('id', candidates.map(document => document.id));
      if (currentError) throw staleDocumentError();
      const revisions = new Map((currentRows || []).map((row: any) => [row.id, readCloudTimestamp(row)]));
      if (candidates.some(document => revisions.get(document.id) !== document.cloudUpdatedAt)) throw staleDocumentError();

      const mutationPlan = [
        ...candidates
          .filter(document => document.id !== selected.id && document.isCurrent)
          .map(document => ({ document, isCurrent: false })),
        ...(selected.isCurrent ? [] : [{ document: selected, isCurrent: true }]),
      ];
      const applied: Array<{
        document: ReferenceDocument & DAVEWebDocumentExtension & { cloudUpdatedAt?: string | null };
        revision: string;
      }> = [];

      try {
        for (const change of mutationPlan) {
          const revision = await writeAuthorizedCurrentScheduleState({
            client,
            ownerId,
            document: change.document,
            isCurrent: change.isCurrent,
            expectedCloudUpdatedAt: change.document.cloudUpdatedAt!,
          });
          applied.push({ document: change.document, revision });
        }
      } catch {
        if (applied.length === 0) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'The current schedule could not be changed because the shared record changed first. No schedule selection was changed. Refresh and try again.',
          );
        }

        let rollbackConfirmed = true;
        for (const change of [...applied].reverse()) {
          try {
            await writeAuthorizedCurrentScheduleState({
              client,
              ownerId,
              document: change.document,
              isCurrent: change.document.isCurrent,
              expectedCloudUpdatedAt: change.revision,
            });
          } catch {
            rollbackConfirmed = false;
          }
        }

        if (!rollbackConfirmed) {
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The current schedule change stopped mid-save, and automatic recovery could not be confirmed. Refresh before making another schedule change.',
          );
        }
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The current schedule could not be changed. The previous schedule selection was restored. Refresh and try again.',
        );
      }
    },

    async saveAuthorizedReportArtifact({
      id,
      projectName,
      report,
      expectedCloudUpdatedAt = null,
    }: {
      id: string;
      projectName: string | null;
      report: DAVEWebReportRecord;
      expectedCloudUpdatedAt?: string | null;
    }): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwner(client);
      const updatedAt = new Date().toISOString();
      const document: ReferenceDocument & DAVEWebDocumentExtension = {
        id,
        name: report.title,
        originalFileName: `${safePathSegment(report.title)}.md`,
        uri: '',
        mimeType: 'text/markdown',
        category: 'Report',
        notes: report.status === 'approved' ? 'Approved project report' : 'Project report draft',
        isCurrent: report.status === 'approved',
        importedAt: report.generatedAt,
        projectId: null,
        projectName,
        importBatchId: null,
        webVersionGroupId: `report:${projectName || 'portfolio'}`,
        webReport: report,
      };
      let query = client.from('reference_documents');
      if (expectedCloudUpdatedAt) {
        const result = await query
          .update(referenceDocumentRow(document, ownerId, updatedAt))
          .eq('owner_id', ownerId)
          .eq('id', id)
          .eq('updated_at', expectedCloudUpdatedAt)
          .select('updated_at')
          .maybeSingle();
        if (result.error || !result.data) throw staleDocumentError();
        return readCloudTimestamp(result.data) || updatedAt;
      }
      const { data, error } = await query
        .insert(referenceDocumentRow(document, ownerId, updatedAt))
        .select('updated_at')
        .single();
      if (error || !data) throw new DAVEWebDocumentMutationError('write_failed', 'The report artifact could not be saved.');
      return readCloudTimestamp(data) || updatedAt;
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

async function compensateFailedDocumentImport({
  client,
  storage,
  ownerId,
  documentId,
  cloudUpdatedAt,
  storagePath,
}: {
  client: SupabaseClient;
  storage: ReturnType<SupabaseClient['storage']['from']>;
  ownerId: string;
  documentId: string;
  cloudUpdatedAt: string;
  storagePath: string;
}): Promise<Readonly<{
  visibilityRecovered: boolean;
  storageFileRemoved: boolean;
}>> {
  const deletedAt = new Date().toISOString();
  let tombstoneSaved = false;
  let documentRowRemoved = false;
  let storageFileRemoved = false;
  try {
    const { error } = await client
      .from('dave_sync_tombstones')
      .upsert(
        {
          owner_id: ownerId,
          entity_type: 'reference_document',
          record_id: documentId,
          deleted_at: deletedAt,
        },
        { onConflict: 'owner_id,entity_type,record_id' },
      );
    tombstoneSaved = !error;
  } catch {
    tombstoneSaved = false;
  }

  try {
    const { data, error } = await client
      .from('reference_documents')
      .delete()
      .eq('owner_id', ownerId)
      .eq('id', documentId)
      .eq('updated_at', cloudUpdatedAt)
      .select('id')
      .maybeSingle();
    documentRowRemoved = !error && Boolean(data);
  } catch {
    documentRowRemoved = false;
  }

  try {
    const { error } = await storage.remove([storagePath]);
    storageFileRemoved = !error;
  } catch {
    storageFileRemoved = false;
  }
  return Object.freeze({
    visibilityRecovered: tombstoneSaved || documentRowRemoved,
    storageFileRemoved,
  });
}

async function writeAuthorizedCurrentScheduleState({
  client,
  ownerId,
  document,
  isCurrent,
  expectedCloudUpdatedAt,
}: {
  client: SupabaseClient;
  ownerId: string;
  document: DAVEWebRevisionedReferenceDocument;
  isCurrent: boolean;
  expectedCloudUpdatedAt: string;
}): Promise<string> {
  const updatedAt = new Date().toISOString();
  const { data, error } = await client
    .from('reference_documents')
    .update(referenceDocumentRow({
      ...document,
      isCurrent,
    }, ownerId, updatedAt))
    .eq('owner_id', ownerId)
    .eq('id', document.id)
    .eq('updated_at', expectedCloudUpdatedAt)
    .select('updated_at')
    .maybeSingle();
  if (error || !data) throw staleDocumentError();
  return readCloudTimestamp(data) ?? updatedAt;
}

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

function referenceDocumentRow(
  document: ReferenceDocument & DAVEWebDocumentExtension,
  ownerId: string,
  updatedAt: string,
) {
  const { cloudUpdatedAt: _cloudUpdatedAt, linkedScheduleItems: _linkedScheduleItems, ...documentData } = document as any;
  return {
    id: document.id,
    owner_id: ownerId,
    name: document.name,
    category: document.category,
    document_data: documentData,
    updated_at: updatedAt,
  };
}

function safePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function safeArtifactStoragePath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.includes('\\') ||
    path.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new DAVEWebArtifactAccessError(
      'This project file does not have an owner-authorized storage path.',
    );
  }
  return path;
}

function collectOwnerPhotoStoragePaths(rows: readonly unknown[]): Set<string> {
  const paths = new Set<string>();
  rows.forEach(row => {
    if (!isRecord(row)) return;
    const updateData = isRecord(row.update_data) ? row.update_data : row;
    const photos = Array.isArray(updateData.photos) ? updateData.photos : [];
    photos.forEach(photo => {
      if (!isRecord(photo) || typeof photo.cloudStoragePath !== 'string') return;
      const path = photo.cloudStoragePath.trim();
      if (path) paths.add(path);
    });
  });
  return paths;
}

function collectOwnerDocumentStoragePaths(rows: readonly unknown[]): Set<string> {
  const paths = new Set<string>();
  rows.forEach(row => {
    if (!isRecord(row)) return;
    const documentData = isRecord(row.document_data) ? row.document_data : row;
    if (typeof documentData.storagePath !== 'string') return;
    const path = documentData.storagePath.trim();
    if (path) paths.add(path);
  });
  return paths;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
