import type { CloudProject, CloudProjectUpdate } from './SupabaseService';
import { normalizeDAVEOperationalRealtimeRecord } from './SupabaseService';
import type {
  DAVEOperationalRealtimeEntity,
  DAVEOperationalRealtimePayload,
} from './DAVEOperationalRefresh';
import { projectRecordFromCloud, type ProjectRecord } from './ProjectCoverPhotoService';
import { mergeDAVESyncTombstones } from './DAVESyncTombstones';
import { mergeDAVEProjectAreaRecoveryRecords } from './DAVEProjectAreaRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords } from './DAVECloudRecovery';
import { reconcileCurrentScheduleDocuments } from './PIEScheduleReconciliation';
import { scheduleItemRevisionForCloudRefresh } from './ScheduleItemQueueRevision';
import { hasMatchingQueuedProjectUpdateRevision } from './ProjectUpdateQueueRevision';
import { hydrateProjectUpdatePhotoPreviews } from './SyncService';
import {
  projectTombstoneMatchesRecord,
  projectTombstoneUsesExactId,
} from './ProjectTombstoneAuthority';
import type { DeletedUpdateTombstone } from './updateService';
import type { SyncQueueItem } from './SyncService';
import type {
  DAVESyncTombstone,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';

type OperationalProjectUpdate = ProjectUpdate & {
  archivedAt?: string | null;
  isArchived?: boolean;
};

type Snapshot = Readonly<{
  projects: string[];
  projectRecords: ProjectRecord[];
  archivedProjects: string[];
  deletedProjectNames: string[];
  updates: OperationalProjectUpdate[];
  deletedUpdates: DeletedUpdateTombstone[];
  tombstones: DAVESyncTombstone[];
  areas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  documents: ReferenceDocument[];
}>;

type Options = Readonly<{
  isActive: () => boolean;
  snapshot: () => Snapshot;
  getPendingQueue: () => Promise<SyncQueueItem[]>;
  normalizeUpdate: (value: unknown) => OperationalProjectUpdate;
  normalizeAreas: (value: unknown) => ProjectArea[];
  normalizeSchedule: (value: unknown) => ScheduleItem[];
  normalizeDocuments: (value: unknown) => ReferenceDocument[];
  migrateSchedule: (item: ScheduleItem) => ScheduleItem;
  localPhotoUri: (photo: Partial<UpdatePhoto>) => string;
  mergeProjectNames: (base: string[], ...sources: string[][]) => string[];
  mergeUpdates: (input: {
    localUpdates: OperationalProjectUpdate[];
    cloudUpdates: OperationalProjectUpdate[];
    tombstones: DeletedUpdateTombstone[];
  }) => OperationalProjectUpdate[];
  buildUpdateTombstone: (
    update: OperationalProjectUpdate,
    action: DeletedUpdateTombstone['action'],
    deletedAt?: string,
  ) => DeletedUpdateTombstone;
  buildCloudDeletionBarrier: (
    updateId: string,
    deletedAt: string,
  ) => DeletedUpdateTombstone;
  upsertDeletedUpdate: (
    current: DeletedUpdateTombstone[],
    next: DeletedUpdateTombstone,
  ) => DeletedUpdateTombstone[];
  commitProjects: (
    records: ProjectRecord[],
    projects: string[],
    archived: string[],
  ) => void;
  commitDeletedProjects: (names: string[]) => void;
  commitUpdates: (updates: OperationalProjectUpdate[]) => void;
  commitDeletedUpdates: (tombstones: DeletedUpdateTombstone[]) => void;
  commitTombstones: (tombstones: DAVESyncTombstone[]) => void;
  commitAreas: (areas: ProjectArea[]) => void;
  commitSchedule: (items: ScheduleItem[]) => void;
  commitDocuments: (documents: ReferenceDocument[]) => void;
}>;

export function createDAVEOperationalRealtimeApplier(options: Options) {
  return async function apply(
    entity: DAVEOperationalRealtimeEntity,
    payload?: DAVEOperationalRealtimePayload,
  ): Promise<boolean> {
    if (!payload || payload.eventType === 'UNKNOWN') return false;
    const rawRow = payload.eventType === 'DELETE' ? payload.oldRow : payload.newRow;
    if (!rawRow) return false;
    const normalized = normalizeDAVEOperationalRealtimeRecord(entity, rawRow);
    if (!normalized) return false;
    const state = options.snapshot();

    if (entity === 'sync_tombstone') {
      const tombstone = normalized as DAVESyncTombstone;
      options.commitTombstones(mergeDAVESyncTombstones(state.tombstones, [tombstone]));
      if (tombstone.entityType === 'project') {
        const exactIdTombstone = projectTombstoneUsesExactId(
          tombstone.recordId,
          state.projectRecords,
        );
        const deletedRecords = state.projectRecords.filter(record =>
          projectTombstoneMatchesRecord(
            tombstone.recordId,
            record,
            state.projectRecords,
          ));
        const records = state.projectRecords.filter(record =>
          !projectTombstoneMatchesRecord(
            tombstone.recordId,
            record,
            state.projectRecords,
          ));
        options.commitProjects(records, records.map(record => record.name), state.archivedProjects);
        const deletedNames = deletedRecords
          .map(record => record.name)
          .filter(name => !records.some(record =>
            normalizedKey(record.name) === normalizedKey(name)));
        if (!exactIdTombstone && deletedNames.length > 0) {
          options.commitDeletedProjects(options.mergeProjectNames(
            state.deletedProjectNames,
            deletedNames,
          ));
        }
      } else if (tombstone.entityType === 'project_update') {
        options.commitUpdates(state.updates.filter(update => update.id !== tombstone.recordId));
        options.commitDeletedUpdates(options.upsertDeletedUpdate(
          state.deletedUpdates,
          options.buildCloudDeletionBarrier(tombstone.recordId, tombstone.deletedAt),
        ));
      } else if (tombstone.entityType === 'project_area') {
        options.commitAreas(state.areas.filter(area => area.id !== tombstone.recordId));
      } else if (tombstone.entityType === 'schedule_item') {
        options.commitSchedule(state.scheduleItems.filter(item => item.id !== tombstone.recordId));
      } else if (tombstone.entityType === 'reference_document') {
        options.commitDocuments(state.documents.filter(document => document.id !== tombstone.recordId));
      }
      return true;
    }

    // Direct row deletion is finalized by the durable tombstone event.
    if (payload.eventType === 'DELETE') return false;
    const pendingQueue = await options.getPendingQueue();

    if (entity === 'project') {
      const cloudProject = normalized as CloudProject;
      const record = projectRecordFromCloud(cloudProject);
      const projectIsTombstoned = state.tombstones.some(tombstone =>
        tombstone.entityType === 'project' && projectTombstoneMatchesRecord(
          tombstone.recordId,
          record,
          state.projectRecords,
        ),
      );
      if (projectIsTombstoned) return true;
      if (pendingQueue.some(item => queuedProjectTouches(item, record))) return true;
      const records = replaceOperationalRecord(
        state.projectRecords,
        record,
        candidate => candidate.id || candidate.name,
      );
      const projects = options.mergeProjectNames(state.projects, [record.name]);
      const archived = cloudProject.archived
        ? options.mergeProjectNames(state.archivedProjects, [record.name])
        : state.archivedProjects.filter(name => normalizedKey(name) !== normalizedKey(record.name));
      options.commitProjects(records, projects, archived);
      return true;
    }

    if (entity === 'project_update') {
      const cloudRow = normalized as CloudProjectUpdate<OperationalProjectUpdate>;
      const cloudUpdate = options.normalizeUpdate(cloudRow.updateData);
      const localUpdate = state.updates.find(update => update.id === cloudUpdate.id);
      if (localUpdate && hasMatchingQueuedProjectUpdateRevision(localUpdate, pendingQueue)) {
        return true;
      }
      const photos = cloudUpdate.photos.map(cloudPhoto =>
        preserveLocalPhotoTransport(cloudPhoto, localUpdate, options.localPhotoUri));
      const previewReady = await hydrateProjectUpdatePhotoPreviews({ ...cloudUpdate, photos });
      if (!options.isActive()) return true;
      let deletedUpdates = state.deletedUpdates;
      if (previewReady.isArchived) {
        deletedUpdates = options.upsertDeletedUpdate(
          deletedUpdates,
          options.buildUpdateTombstone(
            previewReady,
            'hide_cloud_update',
            previewReady.archivedAt || previewReady.date,
          ),
        );
        options.commitDeletedUpdates(deletedUpdates);
      }
      options.commitUpdates(options.mergeUpdates({
        localUpdates: replaceOperationalRecord(
          state.updates,
          previewReady,
          update => update.id,
        ),
        cloudUpdates: [],
        tombstones: deletedUpdates,
      }));
      return true;
    }

    if (entity === 'project_area') {
      const [cloudArea] = options.normalizeAreas([normalized]);
      if (!cloudArea) return false;
      options.commitAreas(mergeDAVEProjectAreaRecoveryRecords({
        local: state.areas,
        cloud: [cloudArea],
        deletedIds: [],
      }));
      return true;
    }

    if (entity === 'schedule_item') {
      const [cloudItem] = options.normalizeSchedule([normalized]).map(options.migrateSchedule);
      if (!cloudItem) return false;
      const localItem = state.scheduleItems.find(item => item.id === cloudItem.id);
      const authoritative = localItem
        ? scheduleItemRevisionForCloudRefresh(localItem, cloudItem, pendingQueue)
        : cloudItem;
      options.commitSchedule(replaceOperationalRecord(
        state.scheduleItems,
        authoritative,
        item => item.id,
      ));
      return true;
    }

    if (entity === 'reference_document') {
      const [cloudDocument] = options.normalizeDocuments([normalized]);
      if (!cloudDocument) return false;
      options.commitDocuments(reconcileCurrentScheduleDocuments(
        mergeDAVEReferenceDocumentRecoveryRecords({
          local: state.documents,
          cloud: [cloudDocument],
          deletedIds: [],
        }),
      ));
      return true;
    }
    return false;
  };
}

export function mergeProjectNames(base: string[], ...sources: string[][]) {
  const names: string[] = [];
  [...sources.flat(), ...base].forEach(name => {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed && !names.some(existing => normalizedKey(existing) === normalizedKey(trimmed))) {
      names.push(trimmed);
    }
  });
  return names;
}

export function createDAVEOperationalRealtimeCommit<T>(
  ref: { current: T },
  commit: (value: T) => void,
) {
  return (value: T) => {
    ref.current = value;
    commit(value);
  };
}

export function replaceOperationalRecord<T>(
  current: readonly T[],
  next: T,
  keyFor: (value: T) => string,
): T[] {
  const nextKey = normalizedKey(keyFor(next));
  if (!nextKey) return [...current];
  const index = current.findIndex(value => normalizedKey(keyFor(value)) === nextKey);
  if (index < 0) return [next, ...current];
  if (JSON.stringify(current[index]) === JSON.stringify(next)) return current as T[];
  const merged = [...current];
  merged[index] = next;
  return merged;
}

function preserveLocalPhotoTransport(
  cloudPhoto: UpdatePhoto,
  localUpdate: OperationalProjectUpdate | undefined,
  localPhotoUri: (photo: Partial<UpdatePhoto>) => string,
): UpdatePhoto {
  const localPhoto = localUpdate?.photos.find(photo => photo.id === cloudPhoto.id);
  const uri = localPhoto ? localPhotoUri(localPhoto) : '';
  return uri
    ? {
        ...cloudPhoto,
        uri,
        cloudRecoveredAt: localPhoto?.cloudRecoveredAt || cloudPhoto.cloudRecoveredAt,
        cloudRecoveryStatus: localPhoto?.cloudRecoveryStatus || cloudPhoto.cloudRecoveryStatus,
        cloudSignedUrlExpiresAt:
          localPhoto?.cloudSignedUrlExpiresAt || cloudPhoto.cloudSignedUrlExpiresAt,
      }
    : cloudPhoto;
}

function queuedProjectTouches(
  item: SyncQueueItem,
  project: Readonly<{ id?: string | null; name: string }>,
): boolean {
  if (item.entity !== 'project') return false;
  const payload = toRecord(item.payload);
  const projectId = normalizedKey(project.id);
  const queuedProjectId = normalizedKey(payload.projectId || payload.id);
  if (queuedProjectId) return Boolean(projectId && queuedProjectId === projectId);
  const keys = new Set([projectId, normalizedKey(project.name)].filter(Boolean));
  return [payload.id, payload.name, payload.previousName]
    .some(value => typeof value === 'string' && keys.has(normalizedKey(value)));
}

function normalizedKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
