import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIERealityObjectType =
  | 'project'
  | 'building'
  | 'area'
  | 'room'
  | 'work_package'
  | 'equipment'
  | 'asset'
  | 'schedule_activity'
  | 'milestone'
  | 'inspection'
  | 'contractor'
  | 'issue'
  | 'risk'
  | 'action_item'
  | 'decision'
  | 'vendor'
  | 'permit'
  | 'document'
  | 'photo'
  | 'safety_observation'
  | 'report'
  | 'owner_action'
  | 'stakeholder'
  | 'constraint';

export type PIERealityObjectStatus =
  | 'unknown'
  | 'not_started'
  | 'in_progress'
  | 'ready'
  | 'needs_verification'
  | 'blocked'
  | 'at_risk'
  | 'complete'
  | 'contradicted'
  | 'retired';

export type PIERealityRelationshipType =
  | 'belongs_to'
  | 'supports'
  | 'blocks'
  | 'depends_on'
  | 'confirms'
  | 'contradicts'
  | 'affects'
  | 'assigned_to'
  | 'scheduled_before'
  | 'scheduled_after'
  | 'evidence_for'
  | 'risk_to'
  | 'decision_for'
  | 'inspection_for'
  | 'report_references';

export type PIERealityReadiness =
  | 'Ready'
  | 'Needs Verification'
  | 'Uncertain'
  | 'Blocked';

export type PIERealityRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type PIERealityMomentum =
  | 'moving'
  | 'slowing'
  | 'stalled'
  | 'blocked'
  | 'unknown';

export type PIERealityConfidence = {
  level: ProjectConfidenceLevel;
  score: number;
  reasons: string[];
};

export type PIERealityGoal = {
  id: string;
  goal: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
};

export type PIERealityRelationship = {
  id: string;
  type: PIERealityRelationshipType;
  targetObjectId: string | null;
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIERealityDependency = {
  id: string;
  dependsOnObjectId: string | null;
  affectsObjectId: string | null;
  summary: string;
  blocked: boolean;
  confidence: ProjectConfidenceLevel;
};

export type PIERealityNextAction = {
  action: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  ownerNeeded: boolean;
};

export type PIERealityUncertainty = {
  id: string;
  uncertainty: string;
  recommendedEvidence: string;
  severity: 'low' | 'medium' | 'high';
};

export type PIERealityModelStatus =
  | 'authoritative'
  | 'synchronizing'
  | 'needs_review'
  | 'conflicted'
  | 'stale';

export type PIERealityKnowledgeClassification =
  | 'fact'
  | 'assumption'
  | 'inference'
  | 'prediction';

export type PIERealityAssertion = {
  id: string;
  organizationId: string;
  projectId: string;
  objectId: string;
  statement: string;
  classification: PIERealityKnowledgeClassification;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: ProjectConfidenceLevel;
  source: string;
  createdAt: string;
  lastReviewedAt: string;
  reviewAt?: string | null;
  expiresAt?: string | null;
  assumptions: string[];
  expectedTimeframe?: string | null;
  explanation: string;
};

export type PIERealityConflictType =
  | 'evidence_contradiction'
  | 'schedule_contradiction'
  | 'ownership_contradiction'
  | 'status_contradiction'
  | 'scope_contradiction'
  | 'location_contradiction'
  | 'cost_contradiction'
  | 'compliance_contradiction'
  | 'identity_mismatch'
  | 'duplicate_object_conflict';

export type PIERealityConflictStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'accepted_uncertainty'
  | 'dismissed_with_reason';

export type PIERealityConflict = {
  id: string;
  organizationId: string;
  projectId: string;
  affectedObjectIds: string[];
  affectedAssertionIds: string[];
  supportingEvidenceSideA: string[];
  supportingEvidenceSideB: string[];
  conflictType: PIERealityConflictType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: ProjectConfidenceLevel;
  status: PIERealityConflictStatus;
  resolutionOwner?: string | null;
  recommendedNextEvidence: string[];
  createdAt: string;
  resolvedAt?: string | null;
  resolutionExplanation?: string | null;
};

export type PIERealityUncertaintyCategory =
  | 'missing_evidence'
  | 'stale_evidence'
  | 'weak_evidence'
  | 'ambiguous_identity'
  | 'unknown_owner'
  | 'unknown_completion_status'
  | 'unknown_dependency'
  | 'uncertain_schedule'
  | 'uncertain_cost'
  | 'uncertain_risk'
  | 'uncertain_outcome';

export type PIERealityUncertaintyStatus =
  | 'open'
  | 'evidence_requested'
  | 'accepted'
  | 'resolved'
  | 'dismissed';

export type PIERealityUncertaintyRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  affectedObjectId?: string | null;
  affectedAssertionId?: string | null;
  description: string;
  category: PIERealityUncertaintyCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidenceImpact: ProjectConfidenceLevel;
  evidenceNeeded: string[];
  likelySourceOfEvidence: string;
  owner?: string | null;
  reviewAt?: string | null;
  status: PIERealityUncertaintyStatus;
  createdAt: string;
};

export type PIERealityObjectIntelligence = {
  goalsSupported: PIERealityGoal[];
  relationships: PIERealityRelationship[];
  dependencies: PIERealityDependency[];
  confidence: PIERealityConfidence;
  readiness: PIERealityReadiness;
  riskLevel: PIERealityRiskLevel;
  momentum: PIERealityMomentum;
  nextBestAction: PIERealityNextAction;
  uncertainty: PIERealityUncertainty[];
  ownerNeeded: boolean;
  summary: string;
};

export type PIERealityObjectIntelligenceResult = {
  generatedAt: string;
  objectIntelligence: Record<string, PIERealityObjectIntelligence>;
  objectsReady: PIERealityObject[];
  objectsUncertain: PIERealityObject[];
  objectsBlocked: PIERealityObject[];
  objectsWithHighRisk: PIERealityObject[];
  objectNextBestActions: PIERealityNextAction[];
  objectRelationshipSummary: string;
  summary: string;
};

export type PIERealityObjectIdentity = {
  id: string;
  sourceIds: string[];
  stableKey: string;
};

export type PIERealityObjectState = {
  summary: string;
  status: PIERealityObjectStatus;
  confidence: ProjectConfidenceLevel;
  readiness: PIERealityObjectStatus;
  nextAction: string | null;
  stale: boolean;
  uncertain: boolean;
};

export type PIERealityEvidenceLink = {
  id: string;
  evidenceId: string;
  evidenceType: string;
  summary: string;
  confidence: ProjectConfidenceLevel;
  linkedAt: string;
};

export type PIERealityKnowledgeLink = {
  id: string;
  knowledgeType:
    | 'belief'
    | 'pattern'
    | 'prediction'
    | 'decision'
    | 'timeline'
    | 'missing_evidence'
    | 'quality';
  summary: string;
  confidence: ProjectConfidenceLevel;
};

export type PIERealityHistoryEvent = {
  id: string;
  occurredAt: string;
  eventType: 'created' | 'updated' | 'merged' | 'evidence_linked' | 'knowledge_linked' | 'status_changed';
  summary: string;
  previousStatus: PIERealityObjectStatus | null;
  nextStatus: PIERealityObjectStatus;
};

export type PIERealityObject = {
  organizationId: string;
  projectId: string;
  stableObjectId: string;
  identity: PIERealityObjectIdentity;
  type: PIERealityObjectType;
  name: string;
  description: string;
  projectName: string | null;
  areaName: string | null;
  owner: string | null;
  location: string | null;
  priorState: PIERealityObjectState | null;
  currentState: PIERealityObjectState;
  expectedState: PIERealityObjectState | null;
  currentStatus: PIERealityObjectStatus;
  sourceEvidenceReferences: PIERealityEvidenceLink[];
  assertions: PIERealityAssertion[];
  relationships: PIERealityRelationship[];
  dependencies: PIERealityDependency[];
  goals: PIERealityGoal[];
  readiness: PIERealityReadiness;
  risk: PIERealityRiskLevel;
  uncertainty: PIERealityUncertainty[];
  confidence: PIERealityConfidence;
  nextBestAction: PIERealityNextAction;
  evidenceLinks: PIERealityEvidenceLink[];
  knowledgeLinks: PIERealityKnowledgeLink[];
  history: PIERealityHistoryEvent[];
  lastObservedAt: string;
  lastChangedAt: string;
  lastUpdated: string;
  intelligence: PIERealityObjectIntelligence;
};

export type PIERealityModelSummary = {
  summary: string;
  objectCount: number;
  totalObjects: number;
  needsVerificationCount: number;
  atRiskCount: number;
  blockedCount: number;
  readyCount: number;
  recentlyUpdatedCount: number;
  recentlyUpdatedObjects: string[];
  objectsReady: string[];
  objectsBlocked: string[];
  objectsAtRisk: string[];
  objectsNeedingVerification: string[];
  strongestCurrentRealityStatement: string;
  weakestCurrentRealityAssumption: string;
  recommendedEvidenceToImproveModel: string[];
  confidence: ProjectConfidenceLevel;
};

export type PIERealityModel = {
  organizationId: string;
  projectId: string;
  version: number;
  status: PIERealityModelStatus;
  createdAt: string;
  generatedAt: string;
  lastSynchronizedAt: string;
  sourceEvidenceCutoffAt: string;
  objectRegistry: Record<string, PIERealityObject>;
  objects: PIERealityObject[];
  relationships: PIERealityRelationship[];
  dependencies: PIERealityDependency[];
  goals: PIERealityGoal[];
  activeRisks: string[];
  activeUncertainties: PIERealityUncertaintyRecord[];
  evidenceConflicts: PIERealityConflict[];
  expectedFutureState: string;
  confidence: ProjectConfidenceLevel;
  readiness: PIERealityReadiness;
  changeHistory: PIERealityHistoryEvent[];
  intelligence: PIERealityObjectIntelligenceResult;
  summary: PIERealityModelSummary;
};

export type PIERealitySyncResult = {
  model: PIERealityModel;
  createdObjects: PIERealityObject[];
  updatedObjects: PIERealityObject[];
  mergedObjects: PIERealityObject[];
  historyEvents: PIERealityHistoryEvent[];
};

export type PIERealitySourceObject = {
  id: string;
  organizationId?: string | null;
  projectId?: string | null;
  type: PIERealityObjectType;
  name: string;
  description?: string | null;
  projectName?: string | null;
  areaName?: string | null;
  owner?: string | null;
  location?: string | null;
  summary?: string | null;
  status?: PIERealityObjectStatus | null;
  expectedStatus?: PIERealityObjectStatus | null;
  confidence?: ProjectConfidenceLevel;
  evidenceType?: string;
  evidenceId?: string;
  evidenceVersionId?: string | null;
  evidenceContentHash?: string | null;
  knowledgeType?: PIERealityKnowledgeLink['knowledgeType'];
  classification?: PIERealityKnowledgeClassification;
  assumptions?: string[];
  expectedTimeframe?: string | null;
  updatedAt?: string | null;
  nextAction?: string | null;
  stale?: boolean;
  uncertain?: boolean;
  ownerNeeded?: boolean;
};

export type PIERealityModelInput = {
  organizationId?: string;
  projectId?: string;
  objects: PIERealitySourceObject[];
  previousModel?: PIERealityModel | null;
  generatedAt?: string;
  sourceEvidenceCutoffAt?: string;
};

export function buildPIERealityModel(
  input: PIERealityModelInput,
): PIERealityModel {
  return synchronizeRealityModel(
    input.previousModel || emptyRealityModel(
      input.generatedAt,
      input.organizationId,
      input.projectId,
    ),
    input.objects,
    input.generatedAt || new Date().toISOString(),
    {
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceEvidenceCutoffAt: input.sourceEvidenceCutoffAt,
    },
  ).model;
}

export function createRealityObject(
  source: PIERealitySourceObject,
  generatedAt: string = new Date().toISOString(),
): PIERealityObject {
  const status = source.status || inferStatus(source);
  const organizationId = source.organizationId || 'local-unverified-anonymous';
  const projectId = source.projectId || stableProjectId(source.projectName || 'Project');
  const currentState: PIERealityObjectState = {
    summary: source.summary || source.name,
    status,
    confidence: source.confidence || 'medium',
    readiness: status,
    nextAction: source.nextAction || null,
    stale: Boolean(source.stale),
    uncertain: Boolean(source.uncertain) || status === 'needs_verification' || status === 'unknown',
  };
  const expectedState: PIERealityObjectState | null = source.expectedStatus
    ? {
        ...currentState,
        status: source.expectedStatus,
        readiness: source.expectedStatus,
        summary: `Expected state for ${source.name}: ${source.expectedStatus}.`,
      }
    : null;
  const evidenceLink: PIERealityEvidenceLink = {
    id: `reality-evidence-${organizationId}-${projectId}-${source.evidenceId || source.id}`,
    evidenceId: source.evidenceId || source.id,
    evidenceType: source.evidenceType || source.type,
    summary: source.summary || source.name,
    confidence: source.confidence || 'medium',
    linkedAt: generatedAt,
  };
  const assertion = buildRealityAssertion({
    source,
    objectId: source.id || stableIdForSource(source),
    organizationId,
    projectId,
    generatedAt,
    evidenceId: evidenceLink.evidenceId,
  });
  const initialIntelligence = buildInitialObjectIntelligence(source, status);
  const object: PIERealityObject = {
    organizationId,
    projectId,
    stableObjectId: stableIdForSource(source),
    identity: {
      id: source.id || stableIdForSource(source),
      sourceIds: [source.id].filter(Boolean),
      stableKey: stableKeyForSource(source),
    },
    type: source.type,
    name: source.name,
    description: source.description || source.summary || source.name,
    projectName: source.projectName || null,
    areaName: source.areaName || null,
    owner: source.owner || null,
    location: source.location || source.areaName || null,
    priorState: null,
    currentState,
    expectedState,
    currentStatus: status,
    sourceEvidenceReferences: [evidenceLink],
    assertions: [assertion],
    relationships: [],
    dependencies: [],
    goals: [],
    readiness: initialIntelligence.readiness,
    risk: initialIntelligence.riskLevel,
    uncertainty: initialIntelligence.uncertainty,
    confidence: initialIntelligence.confidence,
    nextBestAction: initialIntelligence.nextBestAction,
    evidenceLinks: [],
    knowledgeLinks: [],
    history: [],
    lastObservedAt: source.updatedAt || generatedAt,
    lastChangedAt: generatedAt,
    lastUpdated: source.updatedAt || generatedAt,
    intelligence: initialIntelligence,
  };

  return appendRealityHistory(
    linkKnowledgeToRealityObject(
      linkEvidenceToRealityObject(object, evidenceLink),
      {
        id: `reality-knowledge-${object.identity.id}`,
        knowledgeType: source.knowledgeType || 'timeline',
        summary: source.summary || source.name,
        confidence: source.confidence || 'medium',
      },
    ),
    {
      id: `reality-history-created-${object.identity.id}`,
      occurredAt: generatedAt,
      eventType: 'created',
      summary: `Created reality object: ${object.name}`,
      previousStatus: null,
      nextStatus: status,
    },
  );
}

export function identifyRealityObjects(
  input: PIERealityModelInput,
): PIERealityObject[] {
  return input.objects.map(source =>
    createRealityObject(source, input.generatedAt || new Date().toISOString()),
  );
}

export function mergeRealityObjects(
  existing: PIERealityObject,
  incoming: PIERealityObject,
  generatedAt: string = new Date().toISOString(),
): PIERealityObject {
  const mergedStatus = strongerStatus(existing.currentStatus, incoming.currentStatus);
  const changed =
    existing.currentStatus !== mergedStatus ||
    existing.currentState.summary !== incoming.currentState.summary ||
    existing.currentState.confidence !== incoming.currentState.confidence;
  return appendRealityHistory({
    ...existing,
    identity: {
      ...existing.identity,
      sourceIds: Array.from(new Set([
        ...existing.identity.sourceIds,
        ...incoming.identity.sourceIds,
      ])),
    },
    currentState: {
      ...incoming.currentState,
      status: mergedStatus,
      readiness: incoming.currentState.readiness,
      confidence: strongerConfidence(existing.currentState.confidence, incoming.currentState.confidence),
      stale: existing.currentState.stale || incoming.currentState.stale,
      uncertain: existing.currentState.uncertain || incoming.currentState.uncertain,
    },
    priorState: changed ? existing.currentState : existing.priorState,
    expectedState: incoming.expectedState || existing.expectedState,
    currentStatus: mergedStatus,
    sourceEvidenceReferences: dedupeById([
      ...existing.sourceEvidenceReferences,
      ...incoming.sourceEvidenceReferences,
    ]),
    assertions: dedupeById([...existing.assertions, ...incoming.assertions]),
    relationships: dedupeById([...existing.relationships, ...incoming.relationships]),
    dependencies: dedupeById([...existing.dependencies, ...incoming.dependencies]),
    goals: dedupeById([...existing.goals, ...incoming.goals]),
    evidenceLinks: dedupeById([...existing.evidenceLinks, ...incoming.evidenceLinks]),
    knowledgeLinks: dedupeById([...existing.knowledgeLinks, ...incoming.knowledgeLinks]),
    history: [...existing.history, ...incoming.history],
    lastObservedAt: maxDate(existing.lastObservedAt, incoming.lastObservedAt),
    lastChangedAt: changed ? generatedAt : existing.lastChangedAt,
    lastUpdated: maxDate(existing.lastUpdated, incoming.lastUpdated),
    intelligence: incoming.intelligence,
  }, {
    id: `reality-history-merged-${existing.identity.id}-${generatedAt}`,
    occurredAt: generatedAt,
    eventType: 'merged',
    summary: `Merged duplicate reality object evidence into ${existing.name}.`,
    previousStatus: existing.currentStatus,
    nextStatus: mergedStatus,
  });
}

export function updateRealityObjectState(
  object: PIERealityObject,
  state: Partial<PIERealityObjectState>,
  generatedAt: string = new Date().toISOString(),
): PIERealityObject {
  const nextStatus = state.status || object.currentStatus;
  return appendRealityHistory({
    ...object,
    priorState: object.currentState,
    currentState: {
      ...object.currentState,
      ...state,
      status: nextStatus,
    },
    currentStatus: nextStatus,
    lastChangedAt: generatedAt,
    lastUpdated: generatedAt,
  }, {
    id: `reality-history-status-${object.identity.id}-${generatedAt}`,
    occurredAt: generatedAt,
    eventType: 'status_changed',
    summary: `Reality object status updated to ${nextStatus}.`,
    previousStatus: object.currentStatus,
    nextStatus,
  });
}

export function linkEvidenceToRealityObject(
  object: PIERealityObject,
  link: PIERealityEvidenceLink,
): PIERealityObject {
  return {
    ...object,
    evidenceLinks: dedupeById([...object.evidenceLinks, link]),
  };
}

export function linkKnowledgeToRealityObject(
  object: PIERealityObject,
  link: PIERealityKnowledgeLink,
): PIERealityObject {
  return {
    ...object,
    knowledgeLinks: dedupeById([...object.knowledgeLinks, link]),
  };
}

export function appendRealityHistory(
  object: PIERealityObject,
  event: PIERealityHistoryEvent,
): PIERealityObject {
  return {
    ...object,
    history: dedupeById([event, ...object.history]).slice(0, 20),
  };
}

export function synchronizeRealityModel(
  previousModel: PIERealityModel,
  sources: PIERealitySourceObject[],
  generatedAt: string = new Date().toISOString(),
  options: {
    organizationId?: string;
    projectId?: string;
    sourceEvidenceCutoffAt?: string;
  } = {},
): PIERealitySyncResult {
  const registry = { ...previousModel.objectRegistry };
  const createdObjects: PIERealityObject[] = [];
  const updatedObjects: PIERealityObject[] = [];
  const mergedObjects: PIERealityObject[] = [];

  for (const source of sources) {
    const incoming = createRealityObject(source, generatedAt);
    const existingKey = Object.keys(registry).find(key =>
      registry[key].identity.stableKey === incoming.identity.stableKey,
    );

    if (existingKey) {
      const merged = mergeRealityObjects(registry[existingKey], incoming, generatedAt);
      registry[existingKey] = merged;
      updatedObjects.push(merged);
      mergedObjects.push(merged);
    } else {
      registry[incoming.identity.id] = incoming;
      createdObjects.push(incoming);
    }
  }

  const rawObjects = Object.values(registry).sort((left, right) =>
    new Date(right.lastUpdated).getTime() - new Date(left.lastUpdated).getTime(),
  );
  const intelligentObjects = rawObjects.map(object =>
    updateRealityObjectIntelligence(object, rawObjects, generatedAt),
  );
  const intelligentRegistry = intelligentObjects.reduce<Record<string, PIERealityObject>>(
    (nextRegistry, object) => ({
      ...nextRegistry,
      [object.identity.id]: object,
    }),
    {},
  );
  const objectIntelligence = buildRealityObjectIntelligence(intelligentObjects, generatedAt);
  const changeHistory = [...createdObjects, ...updatedObjects].flatMap(object => object.history);
  const hasMeaningfulChange = changeHistory.length > 0;
  const organizationId = options.organizationId || previousModel.organizationId || 'local-unverified-anonymous';
  const projectId = options.projectId || previousModel.projectId || 'project-unassigned';
  const activeUncertainties = buildModelUncertaintyRecords(
    intelligentObjects,
    organizationId,
    projectId,
    generatedAt,
  );
  const evidenceConflicts = buildModelConflictRecords(
    intelligentObjects,
    organizationId,
    projectId,
    generatedAt,
  );
  const model = {
    organizationId,
    projectId,
    version: hasMeaningfulChange ? previousModel.version + 1 : previousModel.version,
    status: evidenceConflicts.length > 0
      ? 'conflicted' as const
      : activeUncertainties.length > 0
        ? 'needs_review' as const
        : 'authoritative' as const,
    createdAt: previousModel.createdAt || generatedAt,
    generatedAt,
    lastSynchronizedAt: generatedAt,
    sourceEvidenceCutoffAt: options.sourceEvidenceCutoffAt || generatedAt,
    objectRegistry: intelligentRegistry,
    objects: intelligentObjects,
    relationships: intelligentObjects.flatMap(object => object.relationships),
    dependencies: intelligentObjects.flatMap(object => object.dependencies),
    goals: intelligentObjects.flatMap(object => object.goals),
    activeRisks: intelligentObjects
      .filter(object => object.risk === 'high' || object.risk === 'critical')
      .map(object => object.name),
    activeUncertainties,
    evidenceConflicts,
    expectedFutureState: summarizeExpectedFutureState(intelligentObjects),
    confidence: summarizeRealityModel(intelligentObjects, generatedAt).confidence,
    readiness: readinessForObjects(intelligentObjects),
    changeHistory: [...changeHistory, ...previousModel.changeHistory].slice(0, 200),
    intelligence: objectIntelligence,
    summary: summarizeRealityModel(intelligentObjects, generatedAt),
  };

  return {
    model,
    createdObjects,
    updatedObjects,
    mergedObjects,
    historyEvents: [...createdObjects, ...updatedObjects].flatMap(object => object.history),
  };
}

export function summarizeRealityModel(
  objects: PIERealityObject[],
  generatedAt: string = new Date().toISOString(),
): PIERealityModelSummary {
  const objectsNeedingVerification = objects.filter(object =>
    object.currentStatus === 'needs_verification' ||
    object.currentState.uncertain,
  );
  const objectsAtRisk = objects.filter(object => object.currentStatus === 'at_risk');
  const objectsBlocked = objects.filter(object => object.currentStatus === 'blocked');
  const objectsReady = objects.filter(object =>
    object.currentStatus === 'ready' ||
    object.currentStatus === 'complete' ||
    object.intelligence.readiness === 'Ready',
  );
  const recentlyUpdated = objects.filter(object =>
    daysBetween(object.lastUpdated, generatedAt) <= 7,
  );
  const strongestObject =
    objectsReady.sort((left, right) =>
      right.intelligence.confidence.score - left.intelligence.confidence.score,
    )[0] ||
    objects.sort((left, right) =>
      right.intelligence.confidence.score - left.intelligence.confidence.score,
    )[0];
  const weakestObject =
    [...objectsNeedingVerification, ...objectsAtRisk, ...objectsBlocked]
      .sort((left, right) =>
        left.intelligence.confidence.score - right.intelligence.confidence.score ||
        actionPriorityScore(right.intelligence.nextBestAction.priority) - actionPriorityScore(left.intelligence.nextBestAction.priority),
      )[0] ||
    objects.find(object => object.currentStatus === 'unknown');
  const recommendedEvidenceToImproveModel = dedupeStrings([
    ...objectsNeedingVerification.map(object =>
      object.intelligence.uncertainty[0]?.recommendedEvidence ||
      object.intelligence.nextBestAction.action,
    ),
    ...objectsAtRisk.map(object => object.intelligence.nextBestAction.action),
    ...objectsBlocked.map(object => object.intelligence.nextBestAction.action),
  ]).slice(0, 8);

  return {
    summary: `${objects.length} reality object${objects.length === 1 ? '' : 's'} modeled. ${objectsNeedingVerification.length} need verification, ${objectsAtRisk.length} are at risk, ${objectsBlocked.length} are blocked.`,
    objectCount: objects.length,
    totalObjects: objects.length,
    needsVerificationCount: objectsNeedingVerification.length,
    atRiskCount: objectsAtRisk.length,
    blockedCount: objectsBlocked.length,
    readyCount: objectsReady.length,
    recentlyUpdatedCount: recentlyUpdated.length,
    recentlyUpdatedObjects: recentlyUpdated.map(object => object.name).slice(0, 8),
    objectsReady: objectsReady.map(object => object.name).slice(0, 8),
    objectsBlocked: objectsBlocked.map(object => object.name).slice(0, 8),
    objectsAtRisk: objectsAtRisk.map(object => object.name).slice(0, 8),
    objectsNeedingVerification: objectsNeedingVerification.map(object => object.name).slice(0, 8),
    strongestCurrentRealityStatement: strongestObject
      ? `${strongestObject.name}: ${strongestObject.intelligence.readiness}. ${strongestObject.currentState.summary}`
      : 'PIE does not have a strong current reality statement yet.',
    weakestCurrentRealityAssumption: weakestObject
      ? `${weakestObject.name}: ${weakestObject.intelligence.uncertainty[0]?.uncertainty || weakestObject.currentState.summary}`
      : 'No weak reality assumption is visible yet.',
    recommendedEvidenceToImproveModel: recommendedEvidenceToImproveModel.length
      ? recommendedEvidenceToImproveModel
      : ['Capture current evidence tied to project, area, status, and owner.'],
    confidence: objects.length >= 6 ? 'high' : objects.length >= 2 ? 'medium' : 'low',
  };
}

export function buildRealityObjectIntelligence(
  objects: PIERealityObject[],
  generatedAt: string = new Date().toISOString(),
): PIERealityObjectIntelligenceResult {
  const objectIntelligence = objects.reduce<Record<string, PIERealityObjectIntelligence>>(
    (registry, object) => ({
      ...registry,
      [object.identity.id]: object.intelligence,
    }),
    {},
  );
  const objectsReady = objects.filter(object => object.intelligence.readiness === 'Ready');
  const objectsUncertain = objects.filter(object =>
    object.intelligence.readiness === 'Uncertain' ||
    object.intelligence.readiness === 'Needs Verification',
  );
  const objectsBlocked = objects.filter(object => object.intelligence.readiness === 'Blocked');
  const objectsWithHighRisk = objects.filter(object =>
    object.intelligence.riskLevel === 'high' ||
    object.intelligence.riskLevel === 'critical',
  );
  const objectNextBestActions = objects
    .map(object => object.intelligence.nextBestAction)
    .sort((left, right) => actionPriorityScore(right.priority) - actionPriorityScore(left.priority))
    .slice(0, 8);

  return {
    generatedAt,
    objectIntelligence,
    objectsReady,
    objectsUncertain,
    objectsBlocked,
    objectsWithHighRisk,
    objectNextBestActions,
    objectRelationshipSummary: summarizeObjectRelationships(objects),
    summary: summarizeObjectIntelligence(objects),
  };
}

export function identifyObjectGoals(object: PIERealityObject): PIERealityGoal[] {
  const goals: PIERealityGoal[] = [];
  if (object.type === 'area' || object.type === 'work_package') {
    goals.push(goal('goal-progress', 'Verify field progress', 'Area and work package objects support current project understanding.', 'high'));
  }
  if (object.type === 'schedule_activity') {
    goals.push(goal('goal-schedule', 'Protect schedule milestone', 'Schedule activity supports milestone, contractor sequencing, and report readiness.', 'high'));
  }
  if (object.type === 'milestone') {
    goals.push(goal('goal-closeout', 'Protect project closeout', 'Milestones support rough inspection, certificate of occupancy, and closeout.', 'high'));
  }
  if (object.type === 'photo') {
    goals.push(goal('goal-photo-evidence', 'Support evidence quality', 'Photo supports evidence quality, belief verification, and report support.', 'medium'));
  }
  if (object.type === 'issue' || object.type === 'risk' || object.type === 'safety_observation') {
    goals.push(goal('goal-risk-reduction', 'Reduce project risk', 'Risk and safety objects support safe execution and schedule confidence.', 'high'));
  }
  if (object.type === 'decision' || object.type === 'owner_action') {
    goals.push(goal('goal-decision', 'Clarify accountability', 'Decision and owner action objects support clear next steps.', 'medium'));
  }
  if (object.type === 'report') {
    goals.push(goal('goal-communication', 'Support report readiness', 'Report objects support reviewable communication.', 'medium'));
  }
  return goals.length > 0 ? goals : [goal('goal-understanding', 'Improve project understanding', 'Reality object contributes to the current project model.', 'medium')];
}

export function identifyObjectRelationships(
  object: PIERealityObject,
  objects: PIERealityObject[] = [],
): PIERealityRelationship[] {
  const relationships: PIERealityRelationship[] = [];
  const project = objects.find(candidate =>
    candidate.type === 'project' &&
    candidate.projectName === object.projectName &&
    candidate.identity.id !== object.identity.id,
  );
  const area = objects.find(candidate =>
    candidate.type === 'area' &&
    candidate.areaName === object.areaName &&
    candidate.identity.id !== object.identity.id,
  );
  const relatedReports = objects.filter(candidate => candidate.type === 'report').slice(0, 2);

  if (project) relationships.push(relationship('belongs_to', project.identity.id, `${object.name} belongs to ${project.name}.`, object.currentState.confidence));
  if (area && object.type !== 'area') relationships.push(relationship('belongs_to', area.identity.id, `${object.name} belongs to ${area.name}.`, object.currentState.confidence));
  if (object.type === 'photo') relationships.push(relationship('evidence_for', area?.identity.id || project?.identity.id || null, `${object.name} is evidence for project understanding.`, object.currentState.confidence));
  if (object.type === 'issue' || object.type === 'risk' || object.type === 'safety_observation') {
    relationships.push(relationship('risk_to', area?.identity.id || project?.identity.id || null, `${object.name} is a risk to current readiness.`, object.currentState.confidence));
  }
  if (object.currentStatus === 'blocked') {
    relationships.push(relationship('blocks', area?.identity.id || project?.identity.id || null, `${object.name} blocks readiness.`, object.currentState.confidence));
  }
  if (object.type === 'decision') relationships.push(relationship('decision_for', project?.identity.id || null, `${object.name} is a decision for the project.`, object.currentState.confidence));
  if (/inspection/i.test(object.name + object.currentState.summary)) relationships.push(relationship('inspection_for', area?.identity.id || project?.identity.id || null, `${object.name} supports inspection readiness.`, object.currentState.confidence));
  relatedReports.forEach(report => {
    if (object.type !== 'report') relationships.push(relationship('report_references', report.identity.id, `${report.name} may reference ${object.name}.`, report.currentState.confidence));
  });
  return dedupeById(relationships);
}

export function identifyObjectDependencies(
  object: PIERealityObject,
  objects: PIERealityObject[] = [],
): PIERealityDependency[] {
  const dependencies: PIERealityDependency[] = [];
  const inspection = objects.find(candidate =>
    candidate.type === 'inspection' ||
    /inspection|rough-in|signoff/i.test(candidate.name + candidate.currentState.summary),
  );
  const scheduleActivity = objects.find(candidate =>
    candidate.type === 'schedule_activity' &&
    candidate.areaName === object.areaName &&
    candidate.identity.id !== object.identity.id,
  );

  if (object.currentStatus === 'blocked' || object.currentStatus === 'at_risk') {
    dependencies.push({
      id: `dependency-blocks-${object.identity.id}`,
      dependsOnObjectId: object.identity.id,
      affectsObjectId: inspection?.identity.id || scheduleActivity?.identity.id || null,
      summary: `${object.name} can block inspection readiness, downstream work, and closeout.`,
      blocked: object.currentStatus === 'blocked',
      confidence: object.currentState.confidence,
    });
  }
  if (scheduleActivity && object.type !== 'schedule_activity') {
    dependencies.push({
      id: `dependency-schedule-${object.identity.id}`,
      dependsOnObjectId: scheduleActivity.identity.id,
      affectsObjectId: object.identity.id,
      summary: `${object.name} depends on schedule activity ${scheduleActivity.name}.`,
      blocked: scheduleActivity.currentStatus === 'blocked' || scheduleActivity.currentStatus === 'at_risk',
      confidence: scheduleActivity.currentState.confidence,
    });
  }
  return dependencies;
}

export function calculateObjectConfidence(object: PIERealityObject): PIERealityConfidence {
  let score = object.currentState.confidence === 'high' ? 75 : object.currentState.confidence === 'medium' ? 55 : 35;
  const reasons = [`Base confidence is ${object.currentState.confidence}.`];
  if (object.evidenceLinks.length >= 2) {
    score += 10;
    reasons.push('Multiple evidence links support this object.');
  }
  if (object.knowledgeLinks.length >= 2) {
    score += 8;
    reasons.push('Knowledge links connect this object to reasoning output.');
  }
  if (object.currentState.stale) {
    score -= 20;
    reasons.push('Evidence is stale.');
  }
  if (object.currentState.uncertain) {
    score -= 15;
    reasons.push('Object remains uncertain.');
  }
  if (object.history.some(event => event.eventType === 'merged')) {
    score += 5;
    reasons.push('Duplicate evidence was merged into one object.');
  }
  score = clampScore(score);
  return {
    level: score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low',
    score,
    reasons,
  };
}

export function calculateObjectReadiness(object: PIERealityObject): PIERealityReadiness {
  if (object.currentStatus === 'blocked') return 'Blocked';
  if (object.currentStatus === 'contradicted') return 'Needs Verification';
  if (object.currentStatus === 'needs_verification' || object.currentState.uncertain) return 'Needs Verification';
  if (object.currentState.stale || object.currentStatus === 'unknown') return 'Uncertain';
  if (object.currentStatus === 'at_risk') return 'Needs Verification';
  return 'Ready';
}

export function calculateObjectRiskLevel(object: PIERealityObject): PIERealityRiskLevel {
  if (object.currentStatus === 'blocked') return 'critical';
  if (object.currentStatus === 'contradicted') return 'high';
  if (object.currentStatus === 'at_risk') return 'high';
  if (object.currentStatus === 'needs_verification' || object.currentState.uncertain) return 'medium';
  if (object.currentState.stale) return 'medium';
  return 'low';
}

export function calculateObjectMomentum(object: PIERealityObject): PIERealityMomentum {
  if (object.currentStatus === 'blocked') return 'blocked';
  if (object.currentStatus === 'contradicted') return 'stalled';
  if (object.currentState.stale) return 'stalled';
  if (/delay|slow|waiting|overdue/i.test(object.currentState.summary)) return 'slowing';
  if (object.currentStatus === 'in_progress' || object.currentStatus === 'ready' || object.currentStatus === 'complete') return 'moving';
  return 'unknown';
}

export function buildObjectNextBestAction(object: PIERealityObject): PIERealityNextAction {
  const ownerNeeded = object.currentState.nextAction === 'Assign an owner.' || /owner|assign/i.test(object.currentState.summary);
  if (object.currentStatus === 'blocked') {
    return { action: object.currentState.nextAction || `Resolve blocker for ${object.name}.`, reason: 'Blocked objects should be cleared before downstream work proceeds.', priority: 'critical', ownerNeeded };
  }
  if (object.currentStatus === 'contradicted') {
    return { action: object.currentState.nextAction || `Resolve contradiction for ${object.name}.`, reason: 'Contradicted objects should be reconciled before PIE relies on them.', priority: 'high', ownerNeeded };
  }
  if (object.currentStatus === 'at_risk') {
    return { action: object.currentState.nextAction || `Verify risk for ${object.name}.`, reason: 'At-risk objects can affect schedule, inspection, or closeout.', priority: 'high', ownerNeeded };
  }
  if (object.currentStatus === 'needs_verification' || object.currentState.uncertain) {
    return { action: object.currentState.nextAction || `Collect current evidence for ${object.name}.`, reason: 'This object needs verification before PIE relies on it.', priority: 'medium', ownerNeeded };
  }
  if (object.currentState.stale) {
    return { action: `Refresh evidence for ${object.name}.`, reason: 'Stale evidence weakens confidence.', priority: 'medium', ownerNeeded };
  }
  return { action: object.currentState.nextAction || `Continue monitoring ${object.name}.`, reason: 'Object is ready enough for normal monitoring.', priority: 'low', ownerNeeded };
}

export function summarizeObjectIntelligence(objects: PIERealityObject[]): string {
  if (objects.length === 0) return 'No reality object intelligence is available yet.';
  const blocked = objects.filter(object => object.intelligence.readiness === 'Blocked').length;
  const uncertain = objects.filter(object =>
    object.intelligence.readiness === 'Uncertain' ||
    object.intelligence.readiness === 'Needs Verification',
  ).length;
  const highRisk = objects.filter(object =>
    object.intelligence.riskLevel === 'high' ||
    object.intelligence.riskLevel === 'critical',
  ).length;
  return `${objects.length} intelligent object${objects.length === 1 ? '' : 's'} modeled. ${blocked} blocked, ${uncertain} uncertain, ${highRisk} high-risk.`;
}

function updateRealityObjectIntelligence(
  object: PIERealityObject,
  objects: PIERealityObject[],
  _generatedAt: string,
): PIERealityObject {
  const confidence = calculateObjectConfidence(object);
  const nextBestAction = buildObjectNextBestAction(object);
  const uncertainty = buildObjectUncertainty(object);
  const intelligence: PIERealityObjectIntelligence = {
    goalsSupported: identifyObjectGoals(object),
    relationships: identifyObjectRelationships(object, objects),
    dependencies: identifyObjectDependencies(object, objects),
    confidence,
    readiness: calculateObjectReadiness(object),
    riskLevel: calculateObjectRiskLevel(object),
    momentum: calculateObjectMomentum(object),
    nextBestAction,
    uncertainty,
    ownerNeeded: nextBestAction.ownerNeeded,
    summary: `${object.name}: ${calculateObjectReadiness(object)}. ${nextBestAction.action}`,
  };
  return {
    ...object,
    intelligence,
    relationships: intelligence.relationships,
    dependencies: intelligence.dependencies,
    goals: intelligence.goalsSupported,
    readiness: intelligence.readiness,
    risk: intelligence.riskLevel,
    uncertainty: intelligence.uncertainty,
    confidence: intelligence.confidence,
    nextBestAction: intelligence.nextBestAction,
  };
}

function emptyRealityModel(
  generatedAt: string = new Date().toISOString(),
  organizationId = 'local-unverified-anonymous',
  projectId = 'project-unassigned',
): PIERealityModel {
  const objects: PIERealityObject[] = [];
  return {
    organizationId,
    projectId,
    version: 0,
    status: 'authoritative',
    createdAt: generatedAt,
    generatedAt,
    lastSynchronizedAt: generatedAt,
    sourceEvidenceCutoffAt: generatedAt,
    objectRegistry: {},
    objects,
    relationships: [],
    dependencies: [],
    goals: [],
    activeRisks: [],
    activeUncertainties: [],
    evidenceConflicts: [],
    expectedFutureState: 'No expected future state is available yet.',
    confidence: 'low',
    readiness: 'Uncertain',
    changeHistory: [],
    intelligence: buildRealityObjectIntelligence(objects, generatedAt),
    summary: summarizeRealityModel([], generatedAt),
  };
}

function stableKeyForSource(source: PIERealitySourceObject) {
  return [
    source.organizationId || 'no-org',
    source.projectId || stableProjectId(source.projectName || 'no-project'),
    source.type,
    source.areaName || 'no-area',
    source.location || 'no-location',
    source.name,
  ].join('|').toLowerCase();
}

function stableIdForSource(source: PIERealitySourceObject) {
  return `reality-${normalizeId(stableKeyForSource(source))}`;
}

function stableProjectId(projectName: string) {
  return `project-${normalizeId(projectName || 'unassigned') || 'unassigned'}`;
}

function buildRealityAssertion({
  source,
  objectId,
  organizationId,
  projectId,
  generatedAt,
  evidenceId,
}: {
  source: PIERealitySourceObject;
  objectId: string;
  organizationId: string;
  projectId: string;
  generatedAt: string;
  evidenceId: string;
}): PIERealityAssertion {
  const classification = source.classification || defaultClassificationForSource(source);
  const supportingEvidenceIds = evidenceId ? [evidenceId] : [];
  if (classification === 'fact' && supportingEvidenceIds.length === 0) {
    throw new Error('Reality facts require supporting evidence.');
  }
  if (classification === 'inference' && !(source.summary || source.nextAction)) {
    throw new Error('Reality inferences require an explanation.');
  }
  if (classification === 'prediction' && !source.expectedTimeframe) {
    throw new Error('Reality predictions require an expected timeframe.');
  }

  return {
    id: `assertion-${objectId}-${normalizeId(classification)}-${normalizeId(evidenceId || source.id)}`,
    organizationId,
    projectId,
    objectId,
    statement: source.summary || source.name,
    classification,
    supportingEvidenceIds,
    contradictingEvidenceIds: /contradict|conflict|disputed/i.test(`${source.name} ${source.summary || ''}`)
      ? supportingEvidenceIds
      : [],
    confidence: source.confidence || 'medium',
    source: source.evidenceType || source.type,
    createdAt: generatedAt,
    lastReviewedAt: generatedAt,
    reviewAt: source.stale || source.uncertain ? generatedAt : null,
    expiresAt: source.stale ? generatedAt : null,
    assumptions: source.assumptions || [],
    expectedTimeframe: source.expectedTimeframe || null,
    explanation: source.summary || `Assertion derived from ${source.evidenceType || source.type} evidence.`,
  };
}

function defaultClassificationForSource(
  source: PIERealitySourceObject,
): PIERealityKnowledgeClassification {
  if (source.expectedStatus || source.expectedTimeframe) return 'prediction';
  if (source.uncertain || source.stale) return 'assumption';
  if (source.evidenceId && source.confidence === 'high') return 'fact';
  return 'inference';
}

function buildModelUncertaintyRecords(
  objects: PIERealityObject[],
  organizationId: string,
  projectId: string,
  generatedAt: string,
): PIERealityUncertaintyRecord[] {
  return objects.flatMap(object =>
    object.uncertainty.map(item => ({
      id: `model-${item.id}`,
      organizationId,
      projectId,
      affectedObjectId: object.identity.id,
      affectedAssertionId: object.assertions[0]?.id || null,
      description: item.uncertainty,
      category: object.currentState.stale
        ? 'stale_evidence' as const
        : object.currentState.uncertain
          ? 'weak_evidence' as const
          : 'missing_evidence' as const,
      severity: item.severity === 'high' ? 'high' as const : item.severity === 'medium' ? 'medium' as const : 'low' as const,
      confidenceImpact: object.confidence.level,
      evidenceNeeded: [item.recommendedEvidence],
      likelySourceOfEvidence: item.recommendedEvidence,
      owner: object.owner,
      reviewAt: generatedAt,
      status: 'open' as const,
      createdAt: generatedAt,
    })),
  );
}

function buildModelConflictRecords(
  objects: PIERealityObject[],
  organizationId: string,
  projectId: string,
  generatedAt: string,
): PIERealityConflict[] {
  const contradicted = objects.filter(object =>
    object.currentStatus === 'contradicted' ||
    object.assertions.some(assertion => assertion.contradictingEvidenceIds.length > 0),
  );
  const duplicateCandidates = findDuplicateCandidates(objects);
  return [
    ...contradicted.map(object => ({
      id: `conflict-${object.identity.id}`,
      organizationId,
      projectId,
      affectedObjectIds: [object.identity.id],
      affectedAssertionIds: object.assertions.map(assertion => assertion.id),
      supportingEvidenceSideA: object.assertions.flatMap(assertion => assertion.supportingEvidenceIds),
      supportingEvidenceSideB: object.assertions.flatMap(assertion => assertion.contradictingEvidenceIds),
      conflictType: 'evidence_contradiction' as const,
      severity: object.currentStatus === 'blocked' ? 'critical' as const : 'high' as const,
      confidence: object.confidence.level,
      status: 'open' as const,
      resolutionOwner: object.owner,
      recommendedNextEvidence: [object.nextBestAction.action],
      createdAt: generatedAt,
      resolvedAt: null,
      resolutionExplanation: null,
    })),
    ...duplicateCandidates.map(([left, right]) => ({
      id: `conflict-duplicate-${left.identity.id}-${right.identity.id}`,
      organizationId,
      projectId,
      affectedObjectIds: [left.identity.id, right.identity.id],
      affectedAssertionIds: [...left.assertions, ...right.assertions].map(assertion => assertion.id),
      supportingEvidenceSideA: left.assertions.flatMap(assertion => assertion.supportingEvidenceIds),
      supportingEvidenceSideB: right.assertions.flatMap(assertion => assertion.supportingEvidenceIds),
      conflictType: 'duplicate_object_conflict' as const,
      severity: 'medium' as const,
      confidence: 'medium' as const,
      status: 'open' as const,
      resolutionOwner: left.owner || right.owner,
      recommendedNextEvidence: [`Confirm whether ${left.name} and ${right.name} are the same object.`],
      createdAt: generatedAt,
      resolvedAt: null,
      resolutionExplanation: null,
    })),
  ];
}

function findDuplicateCandidates(objects: PIERealityObject[]): Array<[PIERealityObject, PIERealityObject]> {
  const candidates: Array<[PIERealityObject, PIERealityObject]> = [];
  objects.forEach((left, leftIndex) => {
    objects.slice(leftIndex + 1).forEach(right => {
      const sameContext =
        left.organizationId === right.organizationId &&
        left.projectId === right.projectId &&
        left.type === right.type &&
        left.areaName === right.areaName &&
        normalizeId(left.name) !== normalizeId(right.name) &&
        normalizeId(left.name).includes(normalizeId(right.name).slice(0, 8));
      if (sameContext) candidates.push([left, right]);
    });
  });
  return candidates.slice(0, 8);
}

function summarizeExpectedFutureState(objects: PIERealityObject[]) {
  const expected = objects
    .filter(object => object.expectedState)
    .map(object => `${object.name}: ${object.expectedState?.status}`);
  if (expected.length > 0) return expected.slice(0, 6).join('; ');
  const next = objects
    .filter(object => object.risk === 'high' || object.risk === 'critical' || object.readiness !== 'Ready')
    .map(object => object.nextBestAction.action);
  return next.length > 0
    ? next.slice(0, 6).join('; ')
    : 'Project reality is expected to remain stable with continued monitoring.';
}

function readinessForObjects(objects: PIERealityObject[]): PIERealityReadiness {
  if (objects.some(object => object.readiness === 'Blocked')) return 'Blocked';
  if (objects.some(object => object.readiness === 'Needs Verification')) return 'Needs Verification';
  if (objects.length === 0 || objects.some(object => object.readiness === 'Uncertain')) return 'Uncertain';
  return 'Ready';
}

function inferStatus(source: PIERealitySourceObject): PIERealityObjectStatus {
  const text = `${source.name} ${source.summary || ''}`.toLowerCase();
  if (source.stale || source.uncertain) return 'needs_verification';
  if (/contradict|conflict|does not match|disputed/.test(text)) return 'contradicted';
  if (/blocked|failed|rejected|overdue|open issue|safety concern/.test(text)) return 'blocked';
  if (/risk|at risk|delay|slip|concern/.test(text)) return 'at_risk';
  if (/complete|resolved|approved|accepted|done/.test(text)) return 'complete';
  if (/ready|inspection/.test(text)) return 'ready';
  if (/start|started|progress|active|install|rough-in/.test(text)) return 'in_progress';
  if (/not started|waiting/.test(text)) return 'not_started';
  return 'unknown';
}

function buildInitialObjectIntelligence(
  source: PIERealitySourceObject,
  status: PIERealityObjectStatus,
): PIERealityObjectIntelligence {
  const confidence = source.confidence || 'medium';
  const readiness = status === 'blocked'
    ? 'Blocked'
    : status === 'contradicted'
      ? 'Needs Verification'
    : status === 'needs_verification' || source.uncertain
      ? 'Needs Verification'
      : status === 'unknown'
        ? 'Uncertain'
        : 'Ready';
  const riskLevel = status === 'blocked'
    ? 'critical'
    : status === 'contradicted'
      ? 'high'
    : status === 'at_risk'
      ? 'high'
      : status === 'needs_verification' || source.uncertain
        ? 'medium'
        : 'low';

  return {
    goalsSupported: [],
    relationships: [],
    dependencies: [],
    confidence: {
      level: confidence,
      score: confidence === 'high' ? 75 : confidence === 'medium' ? 55 : 35,
      reasons: ['Initial confidence comes from source evidence.'],
    },
    readiness,
    riskLevel,
    momentum: source.stale ? 'stalled' : status === 'blocked' ? 'blocked' : 'unknown',
    nextBestAction: {
      action: source.nextAction || `Verify ${source.name}.`,
      reason: 'Initial action is based on source evidence before full object intelligence is calculated.',
      priority: riskLevel === 'critical' ? 'critical' : riskLevel === 'high' ? 'high' : 'medium',
      ownerNeeded: Boolean(source.ownerNeeded),
    },
    uncertainty: source.uncertain
      ? [{
          id: `uncertainty-initial-${normalizeId(source.name)}`,
          uncertainty: `${source.name} needs verification.`,
          recommendedEvidence: source.nextAction || `Collect current evidence for ${source.name}.`,
          severity: riskLevel === 'critical' || riskLevel === 'high' ? 'high' : 'medium',
        }]
      : [],
    ownerNeeded: Boolean(source.ownerNeeded),
    summary: `${source.name}: ${readiness}.`,
  };
}

function buildObjectUncertainty(object: PIERealityObject): PIERealityUncertainty[] {
  const uncertainty: PIERealityUncertainty[] = [];
  if (object.currentState.uncertain) {
    uncertainty.push({
      id: `uncertainty-${object.identity.id}`,
      uncertainty: `${object.name} needs verification.`,
      recommendedEvidence: object.currentState.nextAction || `Collect current evidence for ${object.name}.`,
      severity: object.currentStatus === 'blocked' || object.currentStatus === 'at_risk' ? 'high' : 'medium',
    });
  }
  if (object.currentState.stale) {
    uncertainty.push({
      id: `uncertainty-stale-${object.identity.id}`,
      uncertainty: `${object.name} may be stale.`,
      recommendedEvidence: `Refresh evidence for ${object.name}.`,
      severity: 'medium',
    });
  }
  if (object.evidenceLinks.length === 0) {
    uncertainty.push({
      id: `uncertainty-evidence-${object.identity.id}`,
      uncertainty: `${object.name} has no evidence link.`,
      recommendedEvidence: `Attach supporting evidence for ${object.name}.`,
      severity: 'high',
    });
  }
  return dedupeById(uncertainty);
}

function goal(
  id: string,
  goalText: string,
  reason: string,
  priority: PIERealityGoal['priority'],
): PIERealityGoal {
  return { id, goal: goalText, reason, priority };
}

function relationship(
  type: PIERealityRelationshipType,
  targetObjectId: string | null,
  summary: string,
  confidence: ProjectConfidenceLevel,
): PIERealityRelationship {
  return {
    id: `relationship-${type}-${normalizeId(summary)}`,
    type,
    targetObjectId,
    summary,
    confidence,
  };
}

function summarizeObjectRelationships(objects: PIERealityObject[]) {
  const relationshipCount = objects.reduce(
    (total, object) => total + object.intelligence.relationships.length,
    0,
  );
  const dependencyCount = objects.reduce(
    (total, object) => total + object.intelligence.dependencies.length,
    0,
  );
  return `${relationshipCount} object relationship${relationshipCount === 1 ? '' : 's'} and ${dependencyCount} dependenc${dependencyCount === 1 ? 'y' : 'ies'} modeled.`;
}

function actionPriorityScore(priority: PIERealityNextAction['priority']) {
  if (priority === 'critical') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function strongerStatus(
  left: PIERealityObjectStatus,
  right: PIERealityObjectStatus,
): PIERealityObjectStatus {
  const rank: Record<PIERealityObjectStatus, number> = {
    blocked: 9,
    contradicted: 9,
    at_risk: 8,
    needs_verification: 7,
    in_progress: 6,
    ready: 5,
    not_started: 4,
    complete: 3,
    unknown: 2,
    retired: 1,
  };
  return rank[right] > rank[left] ? right : left;
}

function strongerConfidence(
  left: ProjectConfidenceLevel,
  right: ProjectConfidenceLevel,
): ProjectConfidenceLevel {
  const rank: Record<ProjectConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };
  return rank[right] > rank[left] ? right : left;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

function maxDate(left: string, right: string) {
  return new Date(right).getTime() > new Date(left).getTime() ? right : left;
}

function daysBetween(earlier: string, later: string) {
  const left = new Date(earlier).getTime();
  const right = new Date(later).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((right - left) / 86_400_000));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dedupeStrings(items: Array<string | null | undefined>): string[] {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}
