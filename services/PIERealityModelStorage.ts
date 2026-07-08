import AsyncStorage from '@react-native-async-storage/async-storage';
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

  await AsyncStorage.setItem(realityModelKey(model.organizationId, model.projectId), JSON.stringify(next));
  await AsyncStorage.setItem(realitySnapshotKey(model.organizationId, model.projectId), JSON.stringify(snapshots));
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
  const value = await AsyncStorage.getItem(realitySnapshotKey(organizationId, projectId));
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PIERealityModelSnapshot[] : [];
  } catch {
    return [];
  }
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
  const value = await AsyncStorage.getItem(realityModelKey(organizationId, projectId));
  const snapshots = await getRealityModelSnapshots(organizationId, projectId);
  if (!value) {
    return {
      version: PIE_REALITY_MODEL_STORAGE_VERSION,
      organizationId,
      projectId,
      currentModel: null,
      snapshots,
      savedAt: new Date().toISOString(),
    };
  }

  try {
    const parsed = JSON.parse(value);
    if (
      parsed?.version !== PIE_REALITY_MODEL_STORAGE_VERSION ||
      parsed?.organizationId !== organizationId ||
      parsed?.projectId !== projectId
    ) {
      throw new Error('Reality Model storage boundary mismatch.');
    }
    return {
      version: PIE_REALITY_MODEL_STORAGE_VERSION,
      organizationId,
      projectId,
      currentModel: parsed.currentModel || null,
      snapshots,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    await AsyncStorage.setItem(
      `${realityModelKey(organizationId, projectId)}.corrupt.${Date.now()}`,
      value,
    );
    await AsyncStorage.removeItem(realityModelKey(organizationId, projectId));
    return {
      version: PIE_REALITY_MODEL_STORAGE_VERSION,
      organizationId,
      projectId,
      currentModel: null,
      snapshots,
      savedAt: new Date().toISOString(),
    };
  }
}

export async function clearRealityModelForTesting(
  organizationId: string,
  projectId: string,
): Promise<void> {
  await AsyncStorage.removeItem(realityModelKey(organizationId, projectId));
  await AsyncStorage.removeItem(realitySnapshotKey(organizationId, projectId));
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

function realityModelKey(organizationId: string, projectId: string) {
  return `${REALITY_MODEL_PREFIX}.${PIE_REALITY_MODEL_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

function realitySnapshotKey(organizationId: string, projectId: string) {
  return `${REALITY_SNAPSHOT_PREFIX}.${PIE_REALITY_MODEL_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}
