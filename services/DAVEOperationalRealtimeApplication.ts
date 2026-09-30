import type { CloudProject, CloudProjectUpdate } from './SupabaseService';
import { normalizeDAVEOperationalRealtimeRecord } from './SupabaseService';
import type {
  DAVEOperationalRealtimeEntity,
  DAVEOperationalRealtimePayload,
} from './DAVEOperationalRefresh';
import { projectRecordFromCloud, type ProjectRecord } from './ProjectCoverPhotoService';
import { deletedDAVERecordIds, mergeDAVESyncTombstones } from './DAVESyncTombstones';
import { mergeDAVEProjectAreaRecoveryRecords } from './DAVEProjectAreaRecovery';
import { mergeDAVEReferenceDocumentRecoveryRecords } from './DAVECloudRecovery';
import { reconcileCurrentScheduleDocuments } from './PIEScheduleReconciliation';
import { scheduleItemRevisionForCloudRefresh } from './ScheduleItemQueueRevision';
import { hasMatchingQueuedProjectUpdateRevision } from './ProjectUpdateQueueRevision';
import { hydrateProjectUpdatePhotoPreviews } from './SyncService';
import { preserveLocalPhotoTransport } from './ProjectPhotoTransport';
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
  /** A local record still owed its own sync (queued, failed): a cloud row must not replace it. */
  updateHasPendingLocalWork: (update: OperationalProjectUpdate) => boolean;
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
        const key = normalizedKey(tombstone.recordId);
        const records = state.projectRecords.filter(record =>
          normalizedKey(record.id) !== key && normalizedKey(record.name) !== key);
        // Out of the archived list too: Reopen had brought a project deleted
        // on another device back (whole-app audit A3 pass 2).
        options.commitProjects(
          records,
          records.map(record => record.name),
          state.archivedProjects.filter(name => normalizedKey(name) !== key),
        );
        options.commitDeletedProjects(options.mergeProjectNames(
          state.deletedProjectNames,
          [tombstone.recordId],
        ));
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
      const keys = new Set([normalizedKey(record.id), normalizedKey(record.name)].filter(Boolean));
      if (pendingQueue.some(item => queuedProjectTouches(item, keys))) return true;
      // A row for a project this device deleted (a teammate's late edit
      // echo) does not bring it back; the refresh applies the same list
      // (whole-app audit A3, 30 Sep 2026).
      if (state.deletedProjectNames.some(name => keys.has(normalizedKey(name)))) return true;
      // The local record of a project added on this phone has no id yet; the
      // echo of its create carries one, so match by id, then by name, or the
      // list held two rows for the name until the next launch (audit A3).
      const records = replaceProjectRecord(state.projectRecords, record);
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
      // Re-read after the awaits: a save or another event may have landed.
      const fresh = options.snapshot();
      let deletedUpdates = fresh.deletedUpdates;
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
      // The row is a cloud copy, not a replacement: the local record takes
      // its receipt when the two match (the phone's own upload echo, or a
      // teammate's row already held), keeps its own newer content when they
      // do not, and a row with no local record joins the list as synced.
      // Replacing the local record with the row had turned a just-sent
      // update back into "Waiting to Sync" (whole-app audit A4/A7, 30 Sep
      // 2026), since rows carry the phone's 'queued' status verbatim.
      // A newer revision of an update the device already holds and owes
      // nothing for (another device's edit) replaces it, as the refresh
      // does (audit A4 pass 3); one still owed its own sync keeps its own
      // content and takes the row only as a receipt.
      options.commitUpdates(options.mergeUpdates({
        localUpdates: fresh.updates.map(update =>
          update.id === previewReady.id && !options.updateHasPendingLocalWork(update) ? previewReady : update),
        cloudUpdates: [previewReady],
        tombstones: deletedUpdates,
      }));
      return true;
    }

    // A row for a record this device deleted (its tombstone may still be on
    // its way up) does not bring the record back: the refresh applies the
    // same tombstones (whole-app audit A3/A5/A7, 30 Sep 2026: a teammate's
    // late edit echo re-added a deleted area, task or document until the
    // next refresh, and an edit made in that window uploaded it again).
    if (entity === 'project_area') {
      const [cloudArea] = options.normalizeAreas([normalized]);
      if (!cloudArea) return false;
      options.commitAreas(mergeDAVEProjectAreaRecoveryRecords({
        local: state.areas,
        cloud: [cloudArea],
        deletedIds: deletedDAVERecordIds(state.tombstones, 'project_area'),
      }));
      return true;
    }

    if (entity === 'schedule_item') {
      const [cloudItem] = options.normalizeSchedule([normalized]).map(options.migrateSchedule);
      if (!cloudItem) return false;
      if (deletedDAVERecordIds(state.tombstones, 'schedule_item').includes(cloudItem.id)) return true;
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
          deletedIds: deletedDAVERecordIds(state.tombstones, 'reference_document'),
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

function replaceProjectRecord(current: readonly ProjectRecord[], next: ProjectRecord): ProjectRecord[] {
  const nextId = normalizedKey(next.id || '');
  const nextName = normalizedKey(next.name);
  const matches = (candidate: ProjectRecord) =>
    (Boolean(nextId) && normalizedKey(candidate.id || '') === nextId) ||
    (Boolean(nextName) && normalizedKey(candidate.name) === nextName);
  const index = current.findIndex(matches);
  if (index < 0) return [next, ...current];
  const merged = current.filter((candidate, position) => position === index || !matches(candidate));
  merged[merged.indexOf(current[index])] = next;
  return merged;
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

function queuedProjectTouches(item: SyncQueueItem, keys: Set<string>): boolean {
  if (item.entity !== 'project') return false;
  const payload = toRecord(item.payload);
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
