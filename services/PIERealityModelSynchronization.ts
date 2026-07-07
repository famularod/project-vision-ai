import {
  buildPIERealityModel,
  synchronizeRealityModel,
  type PIERealityConflict,
  type PIERealityModel,
  type PIERealitySourceObject,
} from './PIERealityModel';
import {
  localPIERealityModelRepository,
  type PIERealityModelRepository,
} from './PIERealityModelRepository';

export type PIEQualifiedRealityEvidence = PIERealitySourceObject & {
  evidenceQualified: true;
  identityConfidence: 'low' | 'medium' | 'high';
  identityAliases?: string[];
};

export type PIERealityModelSynchronizationInput = {
  organizationId: string;
  projectId: string;
  qualifiedEvidence: PIEQualifiedRealityEvidence[];
  repository?: PIERealityModelRepository;
  generatedAt?: string;
  sourceEvidenceCutoffAt?: string;
  reason?: string;
};

export type PIERealityModelSynchronizationResult = {
  model: PIERealityModel;
  previousModel: PIERealityModel | null;
  changed: boolean;
  createdObjectCount: number;
  changedObjectCount: number;
  conflictedObjectCount: number;
  uncertaintyCount: number;
  snapshotCreated: boolean;
  conflicts: PIERealityConflict[];
};

export async function synchronizeAuthoritativeRealityModel(
  input: PIERealityModelSynchronizationInput,
): Promise<PIERealityModelSynchronizationResult> {
  const repository = input.repository || localPIERealityModelRepository;
  const generatedAt = input.generatedAt || new Date().toISOString();
  const previousModel = await repository.loadCurrent(input.organizationId, input.projectId);
  const usableEvidence = input.qualifiedEvidence
    .filter(evidence => evidence.evidenceQualified)
    .map(evidence => ({
      ...evidence,
      organizationId: input.organizationId,
      projectId: input.projectId,
    }));
  const ambiguousConflicts = detectAmbiguousIdentityConflicts(
    usableEvidence,
    input.organizationId,
    input.projectId,
    generatedAt,
  );
  const safeEvidence = usableEvidence.filter(evidence =>
    evidence.identityConfidence !== 'low' ||
    evidence.type === 'project' ||
    evidence.type === 'area',
  );
  const syncResult = previousModel
    ? synchronizeRealityModel(previousModel, safeEvidence, generatedAt, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        sourceEvidenceCutoffAt: input.sourceEvidenceCutoffAt,
      })
    : {
        model: buildPIERealityModel({
          organizationId: input.organizationId,
          projectId: input.projectId,
          objects: safeEvidence,
          generatedAt,
          sourceEvidenceCutoffAt: input.sourceEvidenceCutoffAt,
        }),
        createdObjects: [],
        updatedObjects: [],
        mergedObjects: [],
        historyEvents: [],
      };
  const model: PIERealityModel = {
    ...syncResult.model,
    evidenceConflicts: [
      ...syncResult.model.evidenceConflicts,
      ...ambiguousConflicts,
    ],
    status: syncResult.model.evidenceConflicts.length + ambiguousConflicts.length > 0
      ? 'conflicted'
      : syncResult.model.status,
  };
  const changed = !previousModel || model.version !== previousModel.version ||
    JSON.stringify(model.objectRegistry) !== JSON.stringify(previousModel.objectRegistry) ||
    ambiguousConflicts.length > 0;

  if (changed) {
    await repository.saveSynchronized(
      model,
      input.reason || 'Reality Model synchronized from qualified Layer 1 evidence.',
    );
  }

  return {
    model,
    previousModel,
    changed,
    createdObjectCount: syncResult.createdObjects.length || (previousModel ? 0 : model.objects.length),
    changedObjectCount: syncResult.updatedObjects.length,
    conflictedObjectCount: model.evidenceConflicts.length,
    uncertaintyCount: model.activeUncertainties.length,
    snapshotCreated: changed,
    conflicts: model.evidenceConflicts,
  };
}

export function buildQualifiedRealityEvidence(
  sources: PIERealitySourceObject[],
  defaultOrganizationId: string,
  defaultProjectId: string,
): PIEQualifiedRealityEvidence[] {
  return sources.map(source => ({
    ...source,
    organizationId: source.organizationId || defaultOrganizationId,
    projectId: source.projectId || defaultProjectId,
    evidenceQualified: true,
    identityConfidence: identityConfidenceForSource(source),
  }));
}

export function detectAmbiguousIdentityConflicts(
  evidence: PIEQualifiedRealityEvidence[],
  organizationId: string,
  projectId: string,
  generatedAt: string = new Date().toISOString(),
): PIERealityConflict[] {
  return evidence
    .filter(item => item.identityConfidence === 'low')
    .map(item => ({
      id: `conflict-ambiguous-identity-${item.id}`,
      organizationId,
      projectId,
      affectedObjectIds: [],
      affectedAssertionIds: [],
      supportingEvidenceSideA: [item.evidenceId || item.id],
      supportingEvidenceSideB: [],
      conflictType: 'identity_mismatch',
      severity: 'medium',
      confidence: item.confidence || 'low',
      status: 'open',
      resolutionOwner: item.owner || null,
      recommendedNextEvidence: [
        item.nextAction || `Confirm identity for ${item.name}.`,
      ],
      createdAt: generatedAt,
      resolvedAt: null,
      resolutionExplanation: null,
    }));
}

function identityConfidenceForSource(
  source: PIERealitySourceObject,
): PIEQualifiedRealityEvidence['identityConfidence'] {
  if (source.id && source.projectId && source.type && (source.areaName || source.location || source.name)) {
    return 'high';
  }
  if (source.id && source.projectName && source.name) return 'medium';
  if (source.name && source.projectName && source.type) return 'medium';
  return 'low';
}
