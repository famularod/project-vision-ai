import AsyncStorage from '@react-native-async-storage/async-storage';
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
  const state = await loadRealityModelState(organizationId, projectId);
  return state.currentModel;
}

export async function saveSynchronizedRealityModel(
  model: PIERealityModel,
  reason = 'Reality Model synchronized from qualified evidence.',
): Promise<PIERealityModelStoredState> {
  if (!isRealityModelForScope(model, model.organizationId, model.projectId)) {
    throw new Error('Cannot store a Reality Model with invalid or cross-scope records.');
  }
  const previous = await loadRealityModelState(model.organizationId, model.projectId);
  const lastSnapshot = previous.snapshots[0];
  const snapshotNeeded =
    !lastSnapshot ||
    lastSnapshot.modelVersion !== model.version ||
    JSON.stringify(lastSnapshot.model.objectRegistry) !== JSON.stringify(model.objectRegistry);
  const snapshots = snapshotNeeded
    ? [buildSnapshot(model, reason), ...previous.snapshots].slice(0, 50)
    : previous.snapshots;
  const next: PIERealityModelStoredState = {
    version: PIE_REALITY_MODEL_STORAGE_VERSION,
    organizationId: model.organizationId,
    projectId: model.projectId,
    currentModel: model,
    snapshots,
    savedAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(realityModelStorageKey(model.organizationId, model.projectId), JSON.stringify(next));
  await AsyncStorage.setItem(realitySnapshotStorageKey(model.organizationId, model.projectId), JSON.stringify(snapshots));
  return next;
}

export async function appendRealityObjectHistory(
  organizationId: string,
  projectId: string,
  objectId: string,
  event: PIERealityHistoryEvent,
): Promise<PIERealityModel | null> {
  const model = await loadCurrentRealityModel(organizationId, projectId);
  if (!model) return null;
  const object = model.objectRegistry[objectId];
  if (!object) return model;
  const nextObject: PIERealityObject = {
    ...object,
    history: [event, ...object.history].filter(
      (item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index,
    ),
  };
  const nextModel: PIERealityModel = {
    ...model,
    objectRegistry: {
      ...model.objectRegistry,
      [objectId]: nextObject,
    },
    objects: model.objects.map(item => item.identity.id === objectId ? nextObject : item),
    changeHistory: [event, ...model.changeHistory],
  };
  await saveSynchronizedRealityModel(nextModel, `Appended history for ${object.name}.`);
  return nextModel;
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
  const storageKey = realitySnapshotStorageKey(organizationId, projectId);
  const value = await AsyncStorage.getItem(storageKey);
  if (value === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return quarantineInvalidRealityValue(
      storageKey,
      value,
      'Reality Model snapshots',
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(snapshot => isRealitySnapshotForScope(snapshot, organizationId, projectId))
  ) {
    return quarantineInvalidRealityValue(
      storageKey,
      value,
      'Reality Model snapshots',
    );
  }
  return parsed as PIERealityModelSnapshot[];
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
  const storageKey = realityModelStorageKey(organizationId, projectId);
  const value = await AsyncStorage.getItem(storageKey);
  const snapshots = await getRealityModelSnapshots(organizationId, projectId);
  if (value === null) {
    return {
      version: PIE_REALITY_MODEL_STORAGE_VERSION,
      organizationId,
      projectId,
      currentModel: null,
      snapshots,
      savedAt: new Date().toISOString(),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return quarantineInvalidRealityValue(
      storageKey,
      value,
      'Reality Model state',
    );
  }

  if (!isRealityStoredEnvelopeForScope(parsed, organizationId, projectId)) {
    return quarantineInvalidRealityValue(
      storageKey,
      value,
      'Reality Model state',
    );
  }

  return {
    version: PIE_REALITY_MODEL_STORAGE_VERSION,
    organizationId,
    projectId,
    currentModel: parsed.currentModel,
    snapshots,
    savedAt: parsed.savedAt,
  };
}

export async function clearRealityModelForTesting(
  organizationId: string,
  projectId: string,
): Promise<void> {
  await AsyncStorage.removeItem(realityModelStorageKey(organizationId, projectId));
  await AsyncStorage.removeItem(realitySnapshotStorageKey(organizationId, projectId));
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
