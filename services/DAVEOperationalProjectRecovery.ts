import type { ProjectRecord } from './ProjectCoverPhotoService';

export type DAVEOperationalQueuedProjectChange = Readonly<{
  operation: string;
  payload: unknown;
}>;

export type DAVEOperationalProjectRecoveryResult = Readonly<{
  projectRecords: ProjectRecord[];
  projectNames: string[];
  archivedProjectNames: string[];
}>;

/**
 * Reconciles an authoritative owner-scoped project inventory with device
 * records without rolling back a project mutation that is still queued on
 * this device. Cloud-backed records that disappear are removed; local-only
 * and queued records remain protected until their upload is resolved.
 */
export function reconcileDAVEOperationalProjects({
  localRecords,
  localArchivedProjectNames,
  cloudActiveRecords,
  cloudArchivedRecords,
  deletedProjectNames = [],
  queuedChanges = [],
}: {
  localRecords: readonly ProjectRecord[];
  localArchivedProjectNames: readonly string[];
  cloudActiveRecords: readonly ProjectRecord[];
  cloudArchivedRecords: readonly ProjectRecord[];
  deletedProjectNames?: readonly string[];
  queuedChanges?: readonly DAVEOperationalQueuedProjectChange[];
}): DAVEOperationalProjectRecoveryResult {
  const deletedKeys = new Set(deletedProjectNames.map(normalizedName).filter(Boolean));
  const pending = queuedProjectState(queuedChanges);
  const cloudRecords = [...cloudActiveRecords, ...cloudArchivedRecords]
    .filter(record => !deletedKeys.has(normalizedName(record.name)));
  const matchedLocalKeys = new Set<string>();

  const projectRecords = cloudRecords.map(cloudRecord => {
    const localRecord = localRecords.find(record => sameProject(record, cloudRecord));
    if (!localRecord) return cloudRecord;
    matchedLocalKeys.add(projectRecordKey(localRecord));
    const pendingName =
      pending.renames.get(normalizedName(localRecord.name)) ||
      pending.renames.get(normalizedName(cloudRecord.name));
    return mergeCloudProjectRecord(
      localRecord,
      pendingName ? { ...cloudRecord, name: pendingName } : cloudRecord,
    );
  });

  for (const localRecord of localRecords) {
    const localKey = projectRecordKey(localRecord);
    const nameKey = normalizedName(localRecord.name);
    if (
      matchedLocalKeys.has(localKey) ||
      deletedKeys.has(nameKey) ||
      pending.deleted.has(nameKey)
    ) {
      continue;
    }

    const pendingName = pending.renames.get(nameKey);
    const pendingLocally = pending.touched.has(nameKey) || Boolean(pendingName);
    if (localRecord.id && !pendingLocally) {
      // A previously cloud-backed row missing from both authoritative lists
      // was deleted or renamed on another device.
      continue;
    }
    projectRecords.push(pendingName ? { ...localRecord, name: pendingName } : localRecord);
  }

  for (const createdName of pending.created.values()) {
    if (
      deletedKeys.has(normalizedName(createdName)) ||
      projectRecords.some(record => normalizedName(record.name) === normalizedName(createdName))
    ) {
      continue;
    }
    projectRecords.push({ id: null, name: createdName });
  }

  const activeCloudKeys = new Set(cloudActiveRecords.map(record => normalizedName(record.name)));
  const archived = new Map<string, string>();
  cloudArchivedRecords.forEach(record => {
    const key = normalizedName(record.name);
    if (key && !deletedKeys.has(key)) archived.set(key, record.name);
  });

  localArchivedProjectNames.forEach(name => {
    const key = normalizedName(name);
    const localRecord = localRecords.find(record => normalizedName(record.name) === key);
    if (
      !key ||
      deletedKeys.has(key) ||
      activeCloudKeys.has(key) ||
      (localRecord?.id && !pending.touched.has(key))
    ) {
      return;
    }
    archived.set(key, name);
  });

  pending.archived.forEach((isArchived, key) => {
    const displayName =
      pending.renames.get(key) ||
      projectRecords.find(record => normalizedName(record.name) === key)?.name ||
      localRecords.find(record => normalizedName(record.name) === key)?.name;
    const effectiveKey = normalizedName(displayName || key);
    archived.delete(key);
    if (isArchived && displayName && !deletedKeys.has(effectiveKey)) {
      archived.set(effectiveKey, displayName);
    } else {
      archived.delete(effectiveKey);
    }
  });

  pending.renames.forEach((nextName, previousKey) => {
    const previousWasArchived = archived.has(previousKey);
    archived.delete(previousKey);
    if (previousWasArchived || pending.archived.get(previousKey) === true) {
      archived.set(normalizedName(nextName), nextName);
    }
  });
  pending.deleted.forEach(key => archived.delete(key));

  const visibleRecords = uniqueProjectRecords(
    projectRecords.filter(record => {
      const key = normalizedName(record.name);
      return key && !deletedKeys.has(key) && !pending.deleted.has(key);
    }),
  );

  return {
    projectRecords: visibleRecords,
    projectNames: visibleRecords.map(record => record.name),
    archivedProjectNames: [...archived.values()],
  };
}

function queuedProjectState(changes: readonly DAVEOperationalQueuedProjectChange[]) {
  const created = new Map<string, string>();
  const deleted = new Set<string>();
  const touched = new Set<string>();
  const archived = new Map<string, boolean>();
  const renames = new Map<string, string>();

  changes.forEach(change => {
    const payload = toRecord(change.payload);
    const name = text(payload.name);
    const previousName = text(payload.previousName);
    const key = normalizedName(previousName || name);
    if (!key) return;
    touched.add(key);

    if (change.operation === 'create' && name) {
      created.set(normalizedName(name), name);
    } else if (change.operation === 'delete') {
      deleted.add(key);
    } else if (change.operation === 'update') {
      if (name && previousName && normalizedName(name) !== normalizedName(previousName)) {
        renames.set(normalizedName(previousName), name);
      }
      if (typeof payload.archived === 'boolean') archived.set(key, payload.archived);
    }
  });

  return { created, deleted, touched, archived, renames };
}

function mergeCloudProjectRecord(local: ProjectRecord, cloud: ProjectRecord): ProjectRecord {
  const localPhoto = local.coverPhoto;
  const cloudPhoto = cloud.coverPhoto;
  const canReuseLocalPhoto =
    Boolean(localPhoto?.localUri) &&
    (!cloudPhoto?.remotePath || !localPhoto?.remotePath || cloudPhoto.remotePath === localPhoto.remotePath);

  return {
    ...local,
    ...cloud,
    coverPhoto: cloudPhoto
      ? {
          ...cloudPhoto,
          localUri: canReuseLocalPhoto ? localPhoto?.localUri || cloudPhoto.localUri : cloudPhoto.localUri,
        }
      : null,
  };
}

function uniqueProjectRecords(records: readonly ProjectRecord[]): ProjectRecord[] {
  const result: ProjectRecord[] = [];
  records.forEach(record => {
    const existingIndex = result.findIndex(existing => sameProject(existing, record));
    if (existingIndex < 0) result.push(record);
    else result[existingIndex] = mergeCloudProjectRecord(result[existingIndex], record);
  });
  return result;
}

function sameProject(left: ProjectRecord, right: ProjectRecord) {
  const leftId = text(left.id);
  const rightId = text(right.id);
  if (leftId && rightId && leftId === rightId) return true;
  return normalizedName(left.name) === normalizedName(right.name);
}

function projectRecordKey(record: ProjectRecord) {
  return text(record.id) ? `id:${text(record.id)}` : `name:${normalizedName(record.name)}`;
}

function normalizedName(value: unknown) {
  return text(value).toLocaleLowerCase();
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
