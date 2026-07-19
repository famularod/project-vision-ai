import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import {
  buildQualifiedRealityEvidence,
  synchronizeAuthoritativeRealityModel,
  type PIEQualifiedRealityEvidence,
  type PIERealityModelSynchronizationResult,
} from './PIERealityModelSynchronization';
import type { PIERealityModelRepository } from './PIERealityModelRepository';
import { createPIERealityModelRepository } from './PIERealityModelRepository';
import type {
  PIERealityModel,
  PIERealitySourceObject,
} from './PIERealityModel';
import type { PIERuntimeContext, PIERuntimeState } from './PIERuntime';
import { buildRuntime } from './PIERuntime';

export type PIERealityPersistenceStatus =
  | 'authoritative_local'
  | 'authoritative_cloud'
  | 'queued_for_cloud'
  | 'degraded_local_only'
  | 'blocked_identity'
  | 'blocked_organization'
  | 'persistence_failed'
  | 'stale_model'
  | 'conflict_blocked';

export type PIEEvidenceDeltaStatus =
  | 'new'
  | 'changed'
  | 'unchanged'
  | 'removed'
  | 'invalidated';

export type PIERealityEvidenceDelta = {
  evidenceId: string;
  organizationId: string;
  projectId: string;
  evidenceVersionOrHash: string;
  status: PIEEvidenceDeltaStatus;
  lastProcessedModelVersion: number | null;
  processedAt: string;
  evidenceStatus: 'active' | 'removed' | 'invalidated';
  sourceObject?: PIEQualifiedRealityEvidence;
};

export type PIERealityModelOrchestrationInput = {
  runtime?: PIERuntimeState;
  runtimeContext?: PIERuntimeContext;
  organizationId?: string | null;
  projectId?: string | null;
  repository?: PIERealityModelRepository;
  qualifiedEvidence?: PIEQualifiedRealityEvidence[];
  generatedAt?: string;
  cloudAvailable?: boolean;
  identityTrusted?: boolean;
  expectedMinimumModelVersion?: number;
};

export type PIERealityModelOrchestrationResult = {
  runtime: PIERuntimeState;
  organizationId: string;
  projectId: string;
  model: PIERealityModel;
  previousModel: PIERealityModel | null;
  modelId: string;
  modelVersion: number;
  snapshotId: string;
  evidenceCutoffTime: string;
  persistenceStatus: PIERealityPersistenceStatus;
  synchronization: PIERealityModelSynchronizationResult;
  evidenceDeltas: PIERealityEvidenceDelta[];
  diagnostics: string[];
};

export const EVIDENCE_DELTA_PREFIX = 'projectVisionAI.pieRealityModel.evidenceDeltas.v2';

export class PIEEvidenceDeltaStorageCorruptionError extends Error {
  readonly code = 'corrupt_evidence_delta_storage';

  constructor(message: string) {
    super(message);
    this.name = 'PIEEvidenceDeltaStorageCorruptionError';
  }
}

export async function runPIERealityModelOrchestration(
  input: PIERealityModelOrchestrationInput = {},
): Promise<PIERealityModelOrchestrationResult> {
  const runtime = input.runtime || buildRuntime(input.runtimeContext || {});
  const generatedAt = input.generatedAt || runtime.generatedAt || new Date().toISOString();
  const { organizationId, projectId } = resolvePIERealityAuthorityScope(
    input.organizationId,
    input.projectId,
    runtime,
  );
  const repository = input.repository || createPIERealityModelRepository({
    cloudEnabled: input.cloudAvailable,
    identityTrusted: input.identityTrusted,
  });
  const diagnostics: string[] = [];

  if (!organizationId) {
    throw new Error('Reality Model orchestration blocked: organization identity is unavailable.');
  }
  if (!projectId) {
    throw new Error('Reality Model orchestration blocked: project identity is unavailable.');
  }

  const qualifiedEvidence = input.qualifiedEvidence || buildQualifiedRealityEvidence(
    buildRuntimeRealityEvidence(runtime, organizationId, projectId),
    organizationId,
    projectId,
  );
  const previousModel = await repository.loadCurrent(organizationId, projectId);
  const deltas = await classifyEvidenceDeltas(
    organizationId,
    projectId,
    previousModel,
    qualifiedEvidence,
    generatedAt,
  );
  const actionableEvidence = qualifiedEvidence.filter(evidence => {
    const delta = deltas.find(item => item.evidenceId === evidence.evidenceId || item.evidenceId === evidence.id);
    return !delta || delta.status !== 'unchanged';
  });
  const removedOrInvalidatedEvidence = deltas
    .filter(delta => delta.status === 'removed' || delta.status === 'invalidated')
    .map(delta => deltaToRealityEvidence(delta, organizationId, projectId, generatedAt))
    .filter((item): item is PIEQualifiedRealityEvidence => Boolean(item));
  const syncInputEvidence = actionableEvidence.length || !previousModel
    ? [...actionableEvidence, ...removedOrInvalidatedEvidence]
    : removedOrInvalidatedEvidence.length
      ? removedOrInvalidatedEvidence
    : [];
  let synchronization: PIERealityModelSynchronizationResult;
  let persistenceStatus: PIERealityPersistenceStatus = input.cloudAvailable
    ? 'queued_for_cloud'
    : 'degraded_local_only';

  const evidenceIsUnchanged = Boolean(
    previousModel &&
    actionableEvidence.length === 0 &&
    removedOrInvalidatedEvidence.length === 0,
  );

  if (evidenceIsUnchanged && previousModel) {
    // A no-op synchronization used to rebuild intelligence for every Reality
    // Object, stringify the full registry, and enter the persistence path even
    // though every evidence hash was unchanged. On a real project that work
    // can monopolize the React Native JS thread for seconds. Reuse the already
    // authoritative model without changing timestamps or writing storage.
    synchronization = unchangedRealitySynchronization(previousModel);
    if (!input.identityTrusted || organizationId.startsWith('local-unverified')) {
      persistenceStatus = 'degraded_local_only';
      diagnostics.push('Identity is local or untrusted; Reality Model is authoritative locally only.');
    } else if (input.cloudAvailable) {
      persistenceStatus = 'authoritative_cloud';
    } else {
      persistenceStatus = 'degraded_local_only';
      diagnostics.push('Cloud synchronization is unavailable; queued local authority only.');
    }
    diagnostics.push('Evidence is unchanged; the prior Reality Model was reused without rebuilding or rewriting it.');
  } else try {
    synchronization = await synchronizeAuthoritativeRealityModel({
      organizationId,
      projectId,
      qualifiedEvidence: syncInputEvidence.length ? syncInputEvidence : qualifiedEvidence.slice(0, 0),
      repository,
      previousModel,
      generatedAt,
      sourceEvidenceCutoffAt: generatedAt,
      reason: 'Live Reality Model orchestration synchronized qualified evidence.',
    });
    if (!input.identityTrusted || organizationId.startsWith('local-unverified')) {
      persistenceStatus = 'degraded_local_only';
      diagnostics.push('Identity is local or untrusted; Reality Model is authoritative locally only.');
    } else if (input.cloudAvailable) {
      persistenceStatus = 'authoritative_cloud';
    } else {
      persistenceStatus = 'degraded_local_only';
      diagnostics.push('Cloud synchronization is unavailable; queued local authority only.');
    }
    await saveEvidenceDeltas(organizationId, projectId, deltas.map(delta => ({
      ...delta,
      lastProcessedModelVersion: synchronization.model.version,
      processedAt: generatedAt,
    })));
  } catch (error) {
    if (error instanceof PIEEvidenceDeltaStorageCorruptionError) {
      throw error;
    }
    if (!previousModel) {
      throw error;
    }
    diagnostics.push('Persistence failed; DAVE reused the last loaded Reality Model and blocked authoritative success.');
    synchronization = {
      model: previousModel,
      previousModel,
      changed: false,
      createdObjectCount: 0,
      changedObjectCount: 0,
      conflictedObjectCount: previousModel.evidenceConflicts.length,
      uncertaintyCount: previousModel.activeUncertainties.length,
      snapshotCreated: false,
      conflicts: previousModel.evidenceConflicts,
    };
    persistenceStatus = 'persistence_failed';
  }

  if (
    input.expectedMinimumModelVersion !== undefined &&
    synchronization.model.version < input.expectedMinimumModelVersion
  ) {
    persistenceStatus = 'stale_model';
    diagnostics.push('Loaded Reality Model is older than the required authoritative version; high-impact automation is blocked.');
  } else if (synchronization.model.evidenceConflicts.length > 0) {
    persistenceStatus = 'conflict_blocked';
    diagnostics.push('Active Reality Model conflicts require resolution before high-impact automation.');
  }

  return {
    runtime,
    organizationId,
    projectId,
    model: synchronization.model,
    previousModel,
    modelId: `reality-model-${organizationId}-${projectId}`,
    modelVersion: synchronization.model.version,
    snapshotId: `reality-snapshot-${organizationId}-${projectId}-v${synchronization.model.version}`,
    evidenceCutoffTime: synchronization.model.sourceEvidenceCutoffAt,
    persistenceStatus,
    synchronization,
    evidenceDeltas: deltas,
    diagnostics,
  };
}

function unchangedRealitySynchronization(
  model: PIERealityModel,
): PIERealityModelSynchronizationResult {
  return {
    model,
    previousModel: model,
    changed: false,
    createdObjectCount: 0,
    changedObjectCount: 0,
    conflictedObjectCount: model.evidenceConflicts.length,
    uncertaintyCount: model.activeUncertainties.length,
    snapshotCreated: false,
    conflicts: model.evidenceConflicts,
  };
}

export async function classifyEvidenceDeltas(
  organizationId: string,
  projectId: string,
  previousModel: PIERealityModel | null,
  evidence: PIEQualifiedRealityEvidence[],
  processedAt: string,
): Promise<PIERealityEvidenceDelta[]> {
  const previous = await loadEvidenceDeltaState(organizationId, projectId);
  const seenEvidenceIds = new Set<string>();
  const activeDeltas = evidence.map(item => {
    const evidenceId = item.evidenceId || item.id;
    seenEvidenceIds.add(evidenceId);
    const evidenceVersionOrHash = evidenceVersionHash(item);
    const prior = previous[evidenceId];
    const objectStatus = item.status as string | null | undefined;
    const evidenceStatus: PIERealityEvidenceDelta['evidenceStatus'] =
      objectStatus === 'removed'
        ? 'removed'
        : objectStatus === 'contradicted'
          ? 'invalidated'
          : 'active';
    const status: PIEEvidenceDeltaStatus = evidenceStatus === 'removed'
      ? 'removed'
      : evidenceStatus === 'invalidated'
        ? 'invalidated'
        : !prior
          ? 'new'
          : prior.evidenceVersionOrHash !== evidenceVersionOrHash
            ? 'changed'
            : 'unchanged';
    return {
      evidenceId,
      organizationId,
      projectId,
      evidenceVersionOrHash,
      status,
      lastProcessedModelVersion: prior?.lastProcessedModelVersion ?? previousModel?.version ?? null,
      processedAt,
      evidenceStatus,
      sourceObject: {
        ...item,
        organizationId,
        projectId,
      },
    };
  });
  const removedDeltas = Object.values(previous)
    .filter(delta => delta.evidenceStatus === 'active' && !seenEvidenceIds.has(delta.evidenceId))
    .map(delta => ({
      ...delta,
      organizationId,
      projectId,
      status: 'removed' as const,
      evidenceStatus: 'removed' as const,
      lastProcessedModelVersion: delta.lastProcessedModelVersion ?? previousModel?.version ?? null,
      processedAt,
    }));

  return [...activeDeltas, ...removedDeltas];
}

function deltaToRealityEvidence(
  delta: PIERealityEvidenceDelta,
  organizationId: string,
  projectId: string,
  generatedAt: string,
): PIEQualifiedRealityEvidence | null {
  const source = delta.sourceObject;
  if (!source) return null;

  return {
    ...source,
    organizationId,
    projectId,
    summary: delta.status === 'removed'
      ? `Evidence removed or no longer available: ${source.summary || source.name}.`
      : `Evidence invalidated: ${source.summary || source.name}.`,
    status: delta.status === 'removed' ? 'retired' : 'contradicted',
    evidenceContentHash: `${delta.evidenceVersionOrHash}:${delta.status}:${generatedAt}`,
    updatedAt: generatedAt,
    classification: delta.status === 'removed' ? 'assumption' : 'inference',
    uncertain: true,
    evidenceQualified: true,
    identityConfidence: source.identityConfidence || 'high',
  };
}

function buildRuntimeRealityEvidence(
  runtime: PIERuntimeState,
  organizationId: string,
  projectId: string,
): PIERealitySourceObject[] {
  const projectName = runtime.projectName || runtime.projectNames[0] || 'Project';
  const generatedAt = runtime.generatedAt;
  const sources: PIERealitySourceObject[] = [{
    id: `runtime-project-${safeId(projectName)}`,
    organizationId,
    projectId,
    type: 'project',
    name: projectName,
    projectName,
    summary: runtime.intelligentSummary.projectStatus || runtime.evidenceFusionSummary.summary,
    status: runtime.missionComplete ? 'complete' : 'in_progress',
    confidence: runtime.overallConfidence,
    evidenceType: 'runtime',
    evidenceId: 'runtime-project',
    evidenceContentHash: hashText(`${runtime.evidenceFusionSummary.summary}:${runtime.nextBestAction.summary}`),
    classification: 'inference',
    updatedAt: generatedAt,
    nextAction: runtime.nextBestAction.suggestedNextAction,
  }];

  for (const item of runtime.fusedEvidence.scheduleEvidence) {
    sources.push({
      id: `schedule-${item.id}`,
      organizationId,
      projectId,
      type: item.isMilestone ? 'milestone' : 'schedule_activity',
      name: item.taskName,
      projectName: item.projectName || projectName,
      areaName: item.areaName,
      summary: `${item.taskName} is ${item.status} with ${item.percentComplete}% complete.`,
      status: item.isComplete ? 'complete' : item.isOverdue ? 'at_risk' : item.needsReview ? 'needs_verification' : 'in_progress',
      confidence: item.confidence,
      evidenceType: 'schedule',
      evidenceId: item.id,
      evidenceContentHash: hashText(`${item.taskName}:${item.status}:${item.percentComplete}:${item.dueDate || ''}`),
      classification: 'fact',
      updatedAt: item.importedAt || item.dueDate || generatedAt,
      nextAction: item.needsReview ? `Review schedule activity ${item.taskName}.` : null,
      uncertain: item.needsReview,
    });
  }

  for (const update of runtime.fusedEvidence.userUpdateEvidence) {
    sources.push({
      id: `update-${update.id}`,
      organizationId,
      projectId,
      type: 'work_package',
      name: update.notes?.slice(0, 80) || 'Project update',
      projectName: update.projectName || projectName,
      areaName: update.areaName || null,
      summary: update.notes || 'Project update captured.',
      status: 'in_progress',
      confidence: update.confidence,
      evidenceType: 'project_update',
      evidenceId: update.id,
      evidenceContentHash: hashText(`${update.notes || ''}:${update.areaName || ''}:${update.date || ''}`),
      classification: 'fact',
      updatedAt: update.date || generatedAt,
      nextAction: update.nextSteps[0] || null,
    });
  }

  return sources;
}

export function resolvePIERealityAuthorityScope(
  organizationId: string | null | undefined,
  projectId: string | null | undefined,
  runtime: PIERuntimeState,
) {
  return {
    organizationId: resolveOrganizationId(organizationId, runtime),
    projectId: resolveProjectId(projectId, runtime),
  };
}

function resolveOrganizationId(input: string | null | undefined, runtime: PIERuntimeState): string {
  const runtimeWithOrg = runtime as PIERuntimeState & { organizationId?: string | null };
  return input || runtimeWithOrg.organizationId || 'local-unverified-anonymous';
}

function resolveProjectId(input: string | null | undefined, runtime: PIERuntimeState): string {
  const projectName = runtime.projectName || runtime.projectNames[0] || 'Project';
  return input || `project-${safeId(projectName)}`;
}

async function loadEvidenceDeltaState(
  organizationId: string,
  projectId: string,
): Promise<Record<string, PIERealityEvidenceDelta>> {
  const storageKey = evidenceDeltaStorageKey(organizationId, projectId);
  const value = await AsyncStorage.getItem(storageKey);
  if (value === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return quarantineInvalidEvidenceDeltaState(storageKey, value);
  }
  if (!isEvidenceDeltaStateForScope(parsed, organizationId, projectId)) {
    return quarantineInvalidEvidenceDeltaState(storageKey, value);
  }
  return parsed;
}

async function saveEvidenceDeltas(
  organizationId: string,
  projectId: string,
  deltas: PIERealityEvidenceDelta[],
) {
  if (!deltas.every(delta => isEvidenceDeltaForScope(delta, organizationId, projectId))) {
    throw new Error('Cannot store invalid or cross-scope Reality Model evidence deltas.');
  }
  const previous = await loadEvidenceDeltaState(organizationId, projectId);
  const next = { ...previous };
  for (const delta of deltas) {
    next[delta.evidenceId] = delta;
  }
  await AsyncStorage.setItem(evidenceDeltaStorageKey(organizationId, projectId), JSON.stringify(next));
}

export function evidenceDeltaStorageKey(organizationId: string, projectId: string): string {
  return `${EVIDENCE_DELTA_PREFIX}.${safeId(organizationId)}.${safeId(projectId)}`;
}

async function quarantineInvalidEvidenceDeltaState(
  storageKey: string,
  raw: string,
): Promise<never> {
  try {
    const recovery = await quarantineCorruptLocalValue({
      storage: AsyncStorage,
      storageKey,
      quarantineKeyPrefix: `${storageKey}.corrupt.`,
      raw,
      replacementRaw: null,
    });
    throw new PIEEvidenceDeltaStorageCorruptionError(
      localCorruptionRecoveryError({
        label: 'Stored Reality Model evidence deltas',
        recovery,
      }).message,
    );
  } catch (error) {
    if (error instanceof PIEEvidenceDeltaStorageCorruptionError) throw error;
    throw new PIEEvidenceDeltaStorageCorruptionError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isEvidenceDeltaStateForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is Record<string, PIERealityEvidenceDelta> {
  return (
    isRecord(value) &&
    Object.entries(value).every(([evidenceId, delta]) =>
      isEvidenceDeltaForScope(delta, organizationId, projectId) &&
      delta.evidenceId === evidenceId)
  );
}

function isEvidenceDeltaForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIERealityEvidenceDelta {
  if (
    !isRecord(value) ||
    typeof value.evidenceId !== 'string' ||
    value.evidenceId.length === 0 ||
    value.organizationId !== organizationId ||
    value.projectId !== projectId ||
    typeof value.evidenceVersionOrHash !== 'string' ||
    !['new', 'changed', 'unchanged', 'removed', 'invalidated'].includes(String(value.status)) ||
    (value.lastProcessedModelVersion !== null &&
      (typeof value.lastProcessedModelVersion !== 'number' ||
        !Number.isFinite(value.lastProcessedModelVersion))) ||
    typeof value.processedAt !== 'string' ||
    !['active', 'removed', 'invalidated'].includes(String(value.evidenceStatus))
  ) {
    return false;
  }
  return value.sourceObject === undefined || (
    isRecord(value.sourceObject) &&
    value.sourceObject.organizationId === organizationId &&
    value.sourceObject.projectId === projectId &&
    value.sourceObject.evidenceQualified === true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function evidenceVersionHash(evidence: PIEQualifiedRealityEvidence): string {
  return evidence.evidenceVersionId ||
    evidence.evidenceContentHash ||
    hashText(`${evidence.id}:${evidence.name}:${evidence.summary || ''}:${evidence.status || ''}:${evidence.updatedAt || ''}`);
}

function safeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `hash-${Math.abs(hash)}`;
}
