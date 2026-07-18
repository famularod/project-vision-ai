import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  PIEExecutiveAction,
  PIEExecutiveConstraint,
  PIEExecutiveDecision,
  PIEExecutiveJudgmentAuthority,
  PIEExecutiveJudgmentResult,
  PIEExecutiveOpportunity,
  PIEExecutiveRisk,
  PIETradeoffAnalysis,
} from './PIEExecutiveJudgment';
import type { PIERealityModel } from './PIERealityModel';
import type { PIERealityPersistenceStatus } from './PIERealityModelOrchestrator';
import {
  listPIEExecutiveJudgmentsCloud,
  savePIEExecutiveJudgmentCloud,
} from './SupabaseService';

export type PIEExecutiveJudgmentRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  realityModelId: string;
  realityModelVersion: number;
  realitySnapshotId: string;
  judgmentTime: string;
  situationSummary: string;
  primaryRecommendation: string;
  alternativesConsidered: string[];
  tradeoffs: PIETradeoffAnalysis;
  risks: PIEExecutiveRisk[];
  constraints: PIEExecutiveConstraint[];
  opportunities: PIEExecutiveOpportunity[];
  resourceConsiderations: string[];
  priorityRationale: string;
  escalationRationale: string;
  authorityRequirement: string;
  noActionOption: string;
  confidence: 'low' | 'medium' | 'high';
  uncertainty: string[];
  supportingRealityObjectIds: string[];
  supportingAssertionIds: string[];
  activeConflictIds: string[];
  activeUncertaintyIds: string[];
  evidenceCutoffTime: string;
  persistenceStatus?: PIERealityPersistenceStatus;
  conditionsThatWouldChangeRecommendation: string[];
  supersededBy: string | null;
  supersededAt: string | null;
  immutable: true;
};

export type PIEExecutiveJudgmentRepository = {
  saveIssuedJudgment(record: PIEExecutiveJudgmentRecord): Promise<PIEExecutiveJudgmentRecord>;
  listJudgments(organizationId: string, projectId: string): Promise<PIEExecutiveJudgmentRecord[]>;
  getActiveJudgment(organizationId: string, projectId: string): Promise<PIEExecutiveJudgmentRecord | null>;
};

const EXECUTIVE_JUDGMENT_PREFIX = 'projectVisionAI.pieExecutiveJudgments.v1';

/**
 * Audit P1-38: the cloud judgment table is append-only, so old rows can never
 * be rewritten as superseded. Supersession is therefore DERIVED from the
 * append-only history: a judgment is superseded by the first later judgment
 * with a different primary recommendation. Stored supersededBy values (from
 * legacy local rewrites) are respected when present.
 */
export function resolveJudgmentSupersession(
  records: readonly PIEExecutiveJudgmentRecord[],
): PIEExecutiveJudgmentRecord[] {
  const chronological = [...records].sort((left, right) =>
    left.judgmentTime.localeCompare(right.judgmentTime),
  );
  return records.map(record => {
    if (record.supersededBy) return record;
    const successor = chronological.find(candidate =>
      candidate.id !== record.id &&
      candidate.judgmentTime > record.judgmentTime &&
      candidate.primaryRecommendation !== record.primaryRecommendation,
    );
    if (!successor) return record;
    return {
      ...record,
      supersededBy: successor.id,
      supersededAt: successor.judgmentTime,
    };
  });
}

export const localPIEExecutiveJudgmentRepository: PIEExecutiveJudgmentRepository = {
  async saveIssuedJudgment(record) {
    const records = await listExecutiveJudgmentRecords(record.organizationId, record.projectId);
    const existing = records.find(item => item.id === record.id);
    if (existing) return existing;
    const next = [record, ...supersedeChangedRecommendations(records, record)].slice(0, 100);
    await AsyncStorage.setItem(judgmentKey(record.organizationId, record.projectId), JSON.stringify(next));
    return record;
  },
  async listJudgments(organizationId, projectId) {
    return resolveJudgmentSupersession(
      await listExecutiveJudgmentRecords(organizationId, projectId),
    );
  },
  async getActiveJudgment(organizationId, projectId) {
    const records = resolveJudgmentSupersession(
      await listExecutiveJudgmentRecords(organizationId, projectId),
    );
    return records.find(record => !record.supersededBy) || null;
  },
};

export function createPIEExecutiveJudgmentRepository(input: {
  cloudEnabled?: boolean;
  identityTrusted?: boolean;
} = {}): PIEExecutiveJudgmentRepository {
  const useCloud = Boolean(input.cloudEnabled && input.identityTrusted);

  if (!useCloud) return localPIEExecutiveJudgmentRepository;

  return {
    async saveIssuedJudgment(record) {
      const localRecord = await localPIEExecutiveJudgmentRepository.saveIssuedJudgment(record);
      const cloudResult = await savePIEExecutiveJudgmentCloud(localRecord);
      if (!cloudResult.ok && cloudResult.configured) {
        throw new Error(cloudResult.error || cloudResult.message || 'Executive Judgment cloud persistence failed.');
      }
      return cloudResult.data || localRecord;
    },
    async listJudgments(organizationId, projectId) {
      const cloudResult = await listPIEExecutiveJudgmentsCloud(organizationId, projectId);
      if (cloudResult.ok && cloudResult.data && cloudResult.data.length > 0) {
        // Audit P1-38: append-only cloud rows carry no supersession; derive it.
        return resolveJudgmentSupersession(cloudResult.data);
      }
      return localPIEExecutiveJudgmentRepository.listJudgments(organizationId, projectId);
    },
    async getActiveJudgment(organizationId, projectId) {
      const cloudResult = await listPIEExecutiveJudgmentsCloud(organizationId, projectId);
      if (cloudResult.ok && cloudResult.data && cloudResult.data.length > 0) {
        const resolved = resolveJudgmentSupersession(cloudResult.data);
        return resolved.find(record => !record.supersededBy) || null;
      }
      return localPIEExecutiveJudgmentRepository.getActiveJudgment(organizationId, projectId);
    },
  };
}

export async function persistStructuredExecutiveJudgment(input: {
  result: PIEExecutiveJudgmentResult;
  realityModel: PIERealityModel;
  situationSummary: string;
  repository?: PIEExecutiveJudgmentRepository;
  cloudEnabled?: boolean;
  identityTrusted?: boolean;
}): Promise<PIEExecutiveJudgmentRecord> {
  const record = buildExecutiveJudgmentRecord(input);
  const repository = input.repository || createPIEExecutiveJudgmentRepository({
    cloudEnabled: input.cloudEnabled,
    identityTrusted: input.identityTrusted,
  });
  return repository.saveIssuedJudgment(record);
}

export function buildExecutiveJudgmentRecord(input: {
  result: PIEExecutiveJudgmentResult;
  realityModel: PIERealityModel;
  situationSummary: string;
}): PIEExecutiveJudgmentRecord {
  const authority = input.result.authority;
  const action = input.result.highestValueAction;
  const decision = input.result.executiveDecisions[0];
  return {
    id: executiveJudgmentRecordId(authority, input.result),
    organizationId: authority.organizationId,
    projectId: authority.projectId,
    realityModelId: authority.realityModelId,
    realityModelVersion: authority.realityModelVersion,
    realitySnapshotId: authority.realitySnapshotId,
    judgmentTime: input.result.generatedAt,
    situationSummary: input.situationSummary,
    primaryRecommendation: action?.action || input.result.executiveJudgment.bestActionIfEvidenceIncomplete,
    alternativesConsidered: action?.governance.alternativesConsidered ||
      input.result.tradeoffAnalysis.options.map(option => option.label),
    tradeoffs: input.result.tradeoffAnalysis,
    risks: input.result.executiveRisks,
    constraints: input.result.executiveConstraints,
    opportunities: input.result.executiveOpportunities,
    resourceConsiderations: input.result.executiveResourceNeeds.map(need => `${need.resource}: ${need.reason}`),
    priorityRationale: input.result.executivePriorities[0]?.reason || input.result.executiveJudgment.explanation.whatMattersMost,
    escalationRationale: input.result.escalationAnalysis.justification,
    authorityRequirement: input.result.escalationAnalysis.shouldEscalate
      ? input.result.escalationAnalysis.target.role
      : decision?.owner || 'User',
    noActionOption: input.result.noActionReasoning.reason,
    confidence: input.result.confidence,
    uncertainty: [
      ...input.result.waitForEvidenceReasoning.evidenceNeeded,
      ...input.result.actionSafetyCheck.warnings,
    ],
    supportingRealityObjectIds: input.realityModel.objects
      .filter(object => referencesObject(action, decision, object.name))
      .map(object => object.identity.id)
      .slice(0, 12),
    // Audit P1-51: assertions are selected ONLY through the chosen
    // supporting objects — never from every Reality object, which attached
    // unrelated or contradictory assertions to the judgment's trace.
    supportingAssertionIds: input.realityModel.objects
      .filter(object => referencesObject(action, decision, object.name))
      .flatMap(object => object.assertions)
      .map(assertion => assertion.id)
      .slice(0, 24),
    activeConflictIds: authority.activeConflictIds,
    activeUncertaintyIds: authority.activeUncertaintyIds,
    evidenceCutoffTime: authority.evidenceCutoffTime,
    persistenceStatus: authority.persistenceStatus,
    conditionsThatWouldChangeRecommendation: action?.governance.whatWouldChangeRecommendation ||
      input.result.waitForEvidenceReasoning.evidenceNeeded,
    supersededBy: null,
    supersededAt: null,
    immutable: true,
  };
}

export function requirePersistedExecutiveJudgment(
  record: PIEExecutiveJudgmentRecord | null | undefined,
): PIEExecutiveJudgmentRecord {
  if (!record) {
    throw new Error('Persisted Executive Judgment is required for downstream decision and communication flows.');
  }
  if (!record.realityModelId || !record.realitySnapshotId || !record.realityModelVersion) {
    throw new Error('Persisted Executive Judgment is missing Reality Model traceability.');
  }
  return record;
}

async function listExecutiveJudgmentRecords(
  organizationId: string,
  projectId: string,
): Promise<PIEExecutiveJudgmentRecord[]> {
  const value = await AsyncStorage.getItem(judgmentKey(organizationId, projectId));
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PIEExecutiveJudgmentRecord[] : [];
  } catch {
    return [];
  }
}

function supersedeChangedRecommendations(
  records: PIEExecutiveJudgmentRecord[],
  next: PIEExecutiveJudgmentRecord,
): PIEExecutiveJudgmentRecord[] {
  return records.map(record => {
    if (record.supersededBy || record.primaryRecommendation === next.primaryRecommendation) {
      return record;
    }
    return {
      ...record,
      supersededBy: next.id,
      supersededAt: next.judgmentTime,
    };
  });
}

function executiveJudgmentRecordId(
  authority: PIEExecutiveJudgmentAuthority,
  result: PIEExecutiveJudgmentResult,
): string {
  return [
    'executive-judgment',
    authority.organizationId,
    authority.projectId,
    `v${authority.realityModelVersion}`,
    hashText(result.highestValueAction?.action || result.executiveJudgmentSummary),
  ].join('-');
}

function judgmentKey(organizationId: string, projectId: string) {
  return `${EXECUTIVE_JUDGMENT_PREFIX}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

function referencesObject(
  action: PIEExecutiveAction | null,
  decision: PIEExecutiveDecision | undefined,
  objectName: string,
): boolean {
  const haystack = `${action?.action || ''} ${action?.why || ''} ${decision?.decision || ''}`.toLowerCase();
  return haystack.includes(objectName.toLowerCase());
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash)}`;
}
