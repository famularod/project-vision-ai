import AsyncStorage from '@react-native-async-storage/async-storage';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import type {
  PIERealityConflict,
  PIERealityHistoryEvent,
  PIERealityModel,
  PIERealityObject,
  PIERealityObjectStatus,
  PIERealityReadiness,
  PIERealityRiskLevel,
  PIERealityUncertaintyRecord,
} from './PIERealityModel';

export const PIE_REALITY_MODEL_STORAGE_VERSION = 'v1';
export const PIE_REALITY_SNAPSHOT_MAX_COUNT = 3;
export const PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT = 3;
export const PIE_REALITY_SNAPSHOT_MAX_BYTES = 12 * 1024 * 1024;

const REALITY_MODEL_PREFIX = 'projectVisionAI.pieRealityModel';
const REALITY_SNAPSHOT_PREFIX = 'projectVisionAI.pieRealityModel.snapshots';

export type PIERealityModelSnapshot = {
  id: string;
  organizationId: string;
  projectId: string;
  modelVersion: number;
  createdAt: string;
  sourceEvidenceCutoffAt: string;
  reason: string;
  model: PIERealityModel;
};

export type PIERealityModelStoredState = {
  version: typeof PIE_REALITY_MODEL_STORAGE_VERSION;
  organizationId: string;
  projectId: string;
  currentModel: PIERealityModel | null;
  snapshots: PIERealityModelSnapshot[];
  snapshotArchiveFrozen?: boolean;
  savedAt: string;
};

export type PIERealityObjectQuery = {
  type?: string;
  state?: PIERealityObjectStatus;
  owner?: string | null;
  risk?: PIERealityRiskLevel;
  readiness?: PIERealityReadiness;
  attentionNeeded?: boolean;
};

export async function loadCurrentRealityModel(
  organizationId: string,
  projectId: string,
): Promise<PIERealityModel | null> {
  const currentKey = realityModelStorageKey(organizationId, projectId);
  return runExclusiveLocalStorageMutation([currentKey], async () => {
    const envelope = await loadRealityModelEnvelope(organizationId, projectId);
    return envelope?.currentModel || null;
  });
}

export async function saveSynchronizedRealityModel(
  model: PIERealityModel,
  reason = 'Reality Model synchronized from qualified evidence.',
): Promise<PIERealityModelStoredState> {
  if (!isRealityModelForScope(model, model.organizationId, model.projectId)) {
    throw new Error('Cannot store a Reality Model with invalid or cross-scope records.');
  }
  const currentKey = realityModelStorageKey(model.organizationId, model.projectId);
  const snapshotKey = realitySnapshotStorageKey(model.organizationId, model.projectId);
  return runExclusiveLocalStorageMutation([currentKey, snapshotKey], () =>
    saveRealityModelWithinLock(model, reason, currentKey, snapshotKey, true));
}

async function saveRealityModelWithinLock(
  model: PIERealityModel,
  reason: string,
  currentKey: string,
  snapshotKey: string,
  rejectStaleWriter: boolean,
): Promise<PIERealityModelStoredState> {
  const envelope = await loadRealityModelEnvelope(model.organizationId, model.projectId);
  const storedModel = envelope?.currentModel || null;
  if (rejectStaleWriter && storedModel) {
    if (model.version < storedModel.version) {
      throw new Error('Reality Model save rejected because a newer local version already exists.');
    }
    if (
      model.version === storedModel.version &&
      JSON.stringify(model) !== JSON.stringify(storedModel)
    ) {
      throw new Error('Reality Model save rejected because the same version changed concurrently.');
    }
  }

  const archiveWasPreviouslyFrozen = envelope?.snapshotArchiveFrozen === true;
  const archive = archiveWasPreviouslyFrozen
    ? { raw: null, snapshots: [] as PIERealityModelSnapshot[] }
    : await loadRealitySnapshotArchive(model.organizationId, model.projectId);
  const embeddedSnapshots = envelope?.snapshots || [];
  const archiveFingerprints = new Set(archive.snapshots.map(snapshotFingerprint));
  const embeddedOnly = embeddedSnapshots.filter(
    snapshot => !archiveFingerprints.has(snapshotFingerprint(snapshot)),
  );
  let archivedSnapshots = uniqueSnapshots(archive.snapshots);
  let recentSnapshots: PIERealityModelSnapshot[] = [];
  let nextArchiveRaw = archive.raw;
  // Interrupted legacy writes may leave the embedded envelope as the only
  // copy of history. Install that history in the archive before slimming the
  // current envelope when it fits. Once the archive is full, the envelope is
  // the bounded recent-head store and is not repeatedly copied into history.
  if (archiveWasPreviouslyFrozen) {
    recentSnapshots = embeddedOnly;
  } else if (embeddedOnly.length > 0) {
    const proposedMigration = uniqueSnapshots([...embeddedOnly, ...archivedSnapshots]);
    if (archive.raw === null || snapshotArchiveFits(proposedMigration)) {
      archivedSnapshots = proposedMigration;
      nextArchiveRaw = JSON.stringify(archivedSnapshots);
    } else {
      recentSnapshots = embeddedOnly;
    }
  }

  const knownSnapshots = uniqueSnapshots([...recentSnapshots, ...archivedSnapshots]);
  const snapshotNeeded = !knownSnapshots.some(snapshot =>
    snapshot.modelVersion === model.version &&
    JSON.stringify(snapshot.model) === JSON.stringify(model));
  let embeddedHead = recentSnapshots;
  let candidateForArchive: PIERealityModelSnapshot | null = null;
  let snapshotArchiveFrozen = archiveWasPreviouslyFrozen || !storedSnapshotArchiveFits(archive);
  if (snapshotNeeded) {
    if (recentSnapshots.length > PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT) {
      throw new Error('Reality Model legacy snapshot history requires a safe migration before saving.');
    }
    const candidate = buildSnapshot(model, reason);
    const proposedArchive = recentSnapshots.length === 0
      ? uniqueSnapshots([candidate, ...archivedSnapshots])
      : [];
    if (proposedArchive.length > 0 && snapshotArchiveFits(proposedArchive)) {
      archivedSnapshots = proposedArchive;
      nextArchiveRaw = JSON.stringify(archivedSnapshots);
      candidateForArchive = candidate;
    } else {
      // Do not rewrite or prune a legacy archive just to make room. The newest
      // immutable head lives once beside current state while the old archive
      // remains byte-for-byte recoverable.
      embeddedHead = compactRecentSnapshots([candidate, ...recentSnapshots]);
      snapshotArchiveFrozen = true;
    }
  }

  const persistedEnvelope: PIERealityModelStoredState = {
    version: PIE_REALITY_MODEL_STORAGE_VERSION,
    organizationId: model.organizationId,
    projectId: model.projectId,
    currentModel: model,
    snapshots: embeddedHead,
    snapshotArchiveFrozen,
    savedAt: new Date().toISOString(),
  };
  const currentRaw = JSON.stringify(persistedEnvelope);
  const archiveWriteNeeded = nextArchiveRaw !== null && nextArchiveRaw !== archive.raw;
  let stagedEnvelope: PIERealityModelStoredState | null = null;

  if (archiveWriteNeeded && candidateForArchive) {
    // Commit current authority and its immutable snapshot together first. If
    // archive replication fails, the envelope remains a complete recoverable
    // state instead of leaving a future snapshot detached from authority.
    stagedEnvelope = {
      ...persistedEnvelope,
      snapshots: uniqueSnapshots([candidateForArchive, ...embeddedSnapshots]),
      snapshotArchiveFrozen: true,
    };
    await writeVerifiedStorageValue(
      currentKey,
      JSON.stringify(stagedEnvelope),
      'Reality Model staged current state',
    );
  }

  if (archiveWriteNeeded) {
    try {
      await writeVerifiedStorageValue(
        snapshotKey,
        nextArchiveRaw as string,
        'Reality Model snapshot history',
      );
    } catch (error) {
      if (stagedEnvelope) {
        return {
          ...stagedEnvelope,
          snapshots: visibleSnapshots(
            model,
            uniqueSnapshots([...stagedEnvelope.snapshots, ...archive.snapshots]),
          ),
        };
      }
      throw error;
    }
  }

  try {
    await writeVerifiedStorageValue(
      currentKey,
      currentRaw,
      'Reality Model current state',
    );
  } catch (error) {
    if (stagedEnvelope) {
      return {
        ...stagedEnvelope,
        snapshots: visibleSnapshots(
          model,
          uniqueSnapshots([...stagedEnvelope.snapshots, ...archivedSnapshots]),
        ),
      };
    }
    throw error;
  }
  return {
    ...persistedEnvelope,
    snapshots: visibleSnapshots(model, uniqueSnapshots([...embeddedHead, ...archivedSnapshots])),
  };
}

async function writeVerifiedStorageValue(key: string, raw: string, label: string) {
  await AsyncStorage.setItem(key, raw);
  if (await AsyncStorage.getItem(key) !== raw) {
    throw new Error(`${label} could not be verified.`);
  }
}

export async function appendRealityObjectHistory(
  organizationId: string,
  projectId: string,
  objectId: string,
  event: PIERealityHistoryEvent,
): Promise<PIERealityModel | null> {
  const currentKey = realityModelStorageKey(organizationId, projectId);
  const snapshotKey = realitySnapshotStorageKey(organizationId, projectId);
  return runExclusiveLocalStorageMutation([currentKey, snapshotKey], async () => {
    const model = (await loadRealityModelEnvelope(organizationId, projectId))?.currentModel;
    if (!model) return null;
    const object = model.objectRegistry[objectId];
    if (!object) return model;
    const nextObject: PIERealityObject = {
      ...object,
      history: [event, ...object.history].filter(
        (item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index,
      ).slice(0, 20),
    };
    const nextModel: PIERealityModel = {
      ...model,
      version: model.version + 1,
      objectRegistry: { ...model.objectRegistry, [objectId]: nextObject },
      objects: model.objects.map(item => item.identity.id === objectId ? nextObject : item),
      changeHistory: [event, ...model.changeHistory].filter(
        (item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index,
      ).slice(0, 200),
    };
    await saveRealityModelWithinLock(
      nextModel,
      `Appended history for ${object.name}.`,
      currentKey,
      snapshotKey,
      false,
    );
    return nextModel;
  });
}

export async function getRealityObjectHistory(
  organizationId: string,
  projectId: string,
  objectId: string,
): Promise<PIERealityHistoryEvent[]> {
  const model = await loadCurrentRealityModel(organizationId, projectId);
  return model?.objectRegistry[objectId]?.history || [];
}

export async function getRealityModelSnapshots(
  organizationId: string,
  projectId: string,
): Promise<PIERealityModelSnapshot[]> {
  const currentKey = realityModelStorageKey(organizationId, projectId);
  const snapshotKey = realitySnapshotStorageKey(organizationId, projectId);
  return runExclusiveLocalStorageMutation([currentKey, snapshotKey], async () => {
    const envelope = await loadRealityModelEnvelope(organizationId, projectId);
    const archive = await loadRealitySnapshotArchive(organizationId, projectId);
    const combinedSnapshots = [...(envelope?.snapshots || []), ...archive.snapshots];
    assertUnambiguousSnapshotIdentities(combinedSnapshots);
    return visibleSnapshots(
      envelope?.currentModel || null,
      uniqueSnapshots(combinedSnapshots),
    );
  });
}

async function loadRealitySnapshotArchive(
  organizationId: string,
  projectId: string,
): Promise<{ raw: string | null; snapshots: PIERealityModelSnapshot[] }> {
  const storageKey = realitySnapshotStorageKey(organizationId, projectId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return { raw: null, snapshots: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return quarantineInvalidRealityValue(
      storageKey,
      raw,
      'Reality Model snapshots',
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(snapshot => isRealitySnapshotForScope(snapshot, organizationId, projectId))
  ) {
    return quarantineInvalidRealityValue(
      storageKey,
      raw,
      'Reality Model snapshots',
    );
  }
  return { raw, snapshots: parsed as PIERealityModelSnapshot[] };
}

export async function getRealityConflicts(
  organizationId: string,
  projectId: string,
): Promise<PIERealityConflict[]> {
  const model = await loadCurrentRealityModel(organizationId, projectId);
  return model?.evidenceConflicts || [];
}

export async function getRealityUncertainties(
  organizationId: string,
  projectId: string,
): Promise<PIERealityUncertaintyRecord[]> {
  const model = await loadCurrentRealityModel(organizationId, projectId);
  return model?.activeUncertainties || [];
}

export async function queryRealityObjects(
  organizationId: string,
  projectId: string,
  query: PIERealityObjectQuery,
): Promise<PIERealityObject[]> {
  const model = await loadCurrentRealityModel(organizationId, projectId);
  if (!model) return [];
  return model.objects.filter(object => {
    if (query.type && object.type !== query.type) return false;
    if (query.state && object.currentStatus !== query.state) return false;
    if (query.owner !== undefined && object.owner !== query.owner) return false;
    if (query.risk && object.risk !== query.risk) return false;
    if (query.readiness && object.readiness !== query.readiness) return false;
    if (query.attentionNeeded && object.readiness === 'Ready' && object.risk === 'low') return false;
    return true;
  });
}

export async function loadRealityModelState(
  organizationId: string,
  projectId: string,
): Promise<PIERealityModelStoredState> {
  const currentKey = realityModelStorageKey(organizationId, projectId);
  const snapshotKey = realitySnapshotStorageKey(organizationId, projectId);
  return runExclusiveLocalStorageMutation([currentKey, snapshotKey], async () => {
    const envelope = await loadRealityModelEnvelope(organizationId, projectId);
    const archive = await loadRealitySnapshotArchive(organizationId, projectId);
    const currentModel = envelope?.currentModel || null;
    const combinedSnapshots = [...(envelope?.snapshots || []), ...archive.snapshots];
    assertUnambiguousSnapshotIdentities(combinedSnapshots);
    const snapshots = visibleSnapshots(
      currentModel,
      uniqueSnapshots(combinedSnapshots),
    );
    return {
      version: PIE_REALITY_MODEL_STORAGE_VERSION,
      organizationId,
      projectId,
      currentModel,
      snapshots,
      savedAt: envelope?.savedAt || new Date().toISOString(),
    };
  });
}

async function loadRealityModelEnvelope(
  organizationId: string,
  projectId: string,
): Promise<PIERealityModelStoredState | null> {
  const storageKey = realityModelStorageKey(organizationId, projectId);
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return quarantineInvalidRealityValue(
      storageKey,
      raw,
      'Reality Model state',
    );
  }

  if (!isRealityStoredEnvelopeForScope(parsed, organizationId, projectId)) {
    return quarantineInvalidRealityValue(
      storageKey,
      raw,
      'Reality Model state',
    );
  }
  return parsed;
}

export async function clearRealityModelForTesting(
  organizationId: string,
  projectId: string,
): Promise<void> {
  const currentKey = realityModelStorageKey(organizationId, projectId);
  const snapshotKey = realitySnapshotStorageKey(organizationId, projectId);
  await runExclusiveLocalStorageMutation([currentKey, snapshotKey], async () => {
    await AsyncStorage.removeItem(currentKey);
    await AsyncStorage.removeItem(snapshotKey);
  });
}

function buildSnapshot(model: PIERealityModel, reason: string): PIERealityModelSnapshot {
  return {
    id: `reality-snapshot-${model.organizationId}-${model.projectId}-v${model.version}`,
    organizationId: model.organizationId,
    projectId: model.projectId,
    modelVersion: model.version,
    createdAt: new Date().toISOString(),
    sourceEvidenceCutoffAt: model.sourceEvidenceCutoffAt,
    reason,
    model: JSON.parse(JSON.stringify(model)) as PIERealityModel,
  };
}

function snapshotArchiveFits(snapshots: readonly PIERealityModelSnapshot[]) {
  return snapshots.length <= PIE_REALITY_SNAPSHOT_MAX_COUNT &&
    utf8ByteLength(JSON.stringify(snapshots)) <= PIE_REALITY_SNAPSHOT_MAX_BYTES;
}

function storedSnapshotArchiveFits(archive: {
  raw: string | null;
  snapshots: readonly PIERealityModelSnapshot[];
}) {
  return archive.snapshots.length <= PIE_REALITY_SNAPSHOT_MAX_COUNT &&
    (archive.raw === null || utf8ByteLength(archive.raw) <= PIE_REALITY_SNAPSHOT_MAX_BYTES);
}

function compactRecentSnapshots(
  snapshots: readonly PIERealityModelSnapshot[],
): PIERealityModelSnapshot[] {
  const unique = uniqueSnapshots(snapshots);
  if (!snapshotArchiveFits(unique.slice(0, PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT))) {
    // An already oversized embedded legacy set is never silently truncated.
    throw new Error('Reality Model legacy snapshot history requires a safe migration before saving.');
  }
  return unique.slice(0, PIE_REALITY_RECENT_SNAPSHOT_MAX_COUNT);
}

function uniqueSnapshots(
  snapshots: readonly PIERealityModelSnapshot[],
): PIERealityModelSnapshot[] {
  const selected: PIERealityModelSnapshot[] = [];
  const fingerprints = new Set<string>();
  snapshots.forEach(snapshot => {
    const fingerprint = snapshotFingerprint(snapshot);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    selected.push(snapshot);
  });
  return selected;
}

function assertUnambiguousSnapshotIdentities(
  snapshots: readonly PIERealityModelSnapshot[],
): void {
  const snapshotsById = new Map<string, PIERealityModelSnapshot>();
  const snapshotsByVersion = new Map<number, PIERealityModelSnapshot>();
  snapshots.forEach(snapshot => {
    const priorWithId = snapshotsById.get(snapshot.id);
    if (priorWithId && JSON.stringify(priorWithId) !== JSON.stringify(snapshot)) {
      throw new Error('Reality Model snapshot history contains an ambiguous snapshot identity.');
    }
    const priorWithVersion = snapshotsByVersion.get(snapshot.modelVersion);
    if (
      priorWithVersion &&
      JSON.stringify(priorWithVersion.model) !== JSON.stringify(snapshot.model)
    ) {
      throw new Error('Reality Model snapshot history contains an ambiguous snapshot identity.');
    }
    snapshotsById.set(snapshot.id, snapshot);
    snapshotsByVersion.set(snapshot.modelVersion, snapshot);
  });
}

function visibleSnapshots(
  currentModel: PIERealityModel | null,
  snapshots: readonly PIERealityModelSnapshot[],
) {
  if (!currentModel) return [...snapshots];
  return snapshots.filter(snapshot => snapshot.modelVersion <= currentModel.version);
}

function snapshotFingerprint(snapshot: PIERealityModelSnapshot) {
  const raw = JSON.stringify(snapshot);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${raw.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function realityModelStorageKey(organizationId: string, projectId: string): string {
  return `${REALITY_MODEL_PREFIX}.${PIE_REALITY_MODEL_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

export function realitySnapshotStorageKey(organizationId: string, projectId: string): string {
  return `${REALITY_SNAPSHOT_PREFIX}.${PIE_REALITY_MODEL_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

async function quarantineInvalidRealityValue<T>(
  storageKey: string,
  raw: string,
  label: string,
): Promise<T> {
  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey,
    quarantineKeyPrefix: `${storageKey}.corrupt.`,
    raw,
    replacementRaw: null,
  });
  throw localCorruptionRecoveryError({ label, recovery });
}

function isRealityStoredEnvelopeForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIERealityModelStoredState {
  if (
    !isRecord(value) ||
    value.version !== PIE_REALITY_MODEL_STORAGE_VERSION ||
    value.organizationId !== organizationId ||
    value.projectId !== projectId ||
    typeof value.savedAt !== 'string' ||
    (value.snapshotArchiveFrozen !== undefined && typeof value.snapshotArchiveFrozen !== 'boolean') ||
    !Array.isArray(value.snapshots) ||
    !value.snapshots.every(snapshot => isRealitySnapshotForScope(snapshot, organizationId, projectId))
  ) {
    return false;
  }
  return value.currentModel === null ||
    isRealityModelForScope(value.currentModel, organizationId, projectId);
}

function isRealitySnapshotForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIERealityModelSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.organizationId === organizationId &&
    value.projectId === projectId &&
    typeof value.modelVersion === 'number' &&
    Number.isFinite(value.modelVersion) &&
    typeof value.createdAt === 'string' &&
    isRealityModelForScope(value.model, organizationId, projectId)
  );
}

function isRealityModelForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIERealityModel {
  if (
    !isRecord(value) ||
    value.organizationId !== organizationId ||
    value.projectId !== projectId ||
    typeof value.version !== 'number' ||
    !Number.isFinite(value.version) ||
    !isRecord(value.objectRegistry) ||
    !Array.isArray(value.objects)
  ) {
    return false;
  }
  return (
    value.objects.every(object => isRealityObjectForScope(object, organizationId, projectId)) &&
    Object.values(value.objectRegistry).every(object =>
      isRealityObjectForScope(object, organizationId, projectId))
  );
}

function isRealityObjectForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): boolean {
  return (
    isRecord(value) &&
    value.organizationId === organizationId &&
    value.projectId === projectId &&
    typeof value.stableObjectId === 'string' &&
    value.stableObjectId.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}
