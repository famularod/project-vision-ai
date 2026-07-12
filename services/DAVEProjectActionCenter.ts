import type {
  DAVEBriefNavigationTarget,
  DAVEBriefSourceType,
  DAVEProjectDailyBrief,
  DAVEProjectDailyBriefAttentionItem,
} from './DAVEDailyBrief';
import type { DAVEProjectEvidenceQuality } from './DAVEProjectEvidenceQuality';
import type { DAVEProjectCommitment } from './DAVEProjectCommitments';
import type { DAVEProjectReality, DAVEProjectRealityState } from './DAVEProjectReality';

export type DAVEActionCenterConfidence = 'high' | 'medium' | 'low';

export type DAVEActionCenterEvidence = {
  sourceType: DAVEBriefSourceType;
  recordId: string;
  summary: string;
};

export type DAVEProjectActionCenter = {
  realityState: DAVEProjectRealityState;
  priority: string;
  reason: string;
  supportingEvidence: DAVEActionCenterEvidence[];
  recommendedAction: string | null;
  navigationTarget: DAVEBriefNavigationTarget;
  confidence: DAVEActionCenterConfidence | null;
  limitations: string[];
};

export type BuildProjectActionCenterInput = {
  dailyBrief: DAVEProjectDailyBrief;
  evidenceQuality: DAVEProjectEvidenceQuality;
  commitments: DAVEProjectCommitment[];
  attentionItems: DAVEProjectDailyBriefAttentionItem[];
  reality?: DAVEProjectReality;
};

type PriorityCandidate = Omit<DAVEProjectActionCenter, 'realityState'> & {
  id: string;
  rank: number;
  tieBreak: string;
};

export function buildProjectActionCenter(
  input: BuildProjectActionCenterInput,
): DAVEProjectActionCenter {
  const reality = input.reality || input.dailyBrief.reality;
  const commitments = reality?.openCommitments || input.commitments;
  const evidenceQuality = reality?.evidenceSummary || input.evidenceQuality;
  const candidates = dedupeCandidates([
    ...attentionCandidates(input.attentionItems),
    ...commitmentCandidates(commitments),
  ]).sort((a, b) => a.rank - b.rank || a.tieBreak.localeCompare(b.tieBreak) || a.id.localeCompare(b.id));
  const selected = candidates[0];

  if (!selected) {
    return {
      realityState: reality?.state || input.dailyBrief.realityState || 'At Risk',
      priority: 'No priority today.',
      reason: 'No open evidence-backed attention item or commitment is recorded for this project.',
      supportingEvidence: [],
      recommendedAction: null,
      navigationTarget: 'project_workspace',
      confidence: null,
      limitations: input.dailyBrief.evidenceSummary.latestUpdateAt
        ? []
        : ['No recent project update is available to support a priority.'],
    };
  }

  const evidenceConfidence = reality?.confidence || confidenceForStrength(evidenceQuality.strength);
  const limitations = [...selected.limitations];
  const realityRecommendation = reality?.topRecommendation;
  if (evidenceQuality.strength === 'Low') {
    limitations.push('Overall project evidence is weak; verify the supporting record before acting.');
  } else if (evidenceQuality.strength === 'Medium') {
    limitations.push('Project evidence is partial; confirm the supporting record before changing status.');
  }

  return {
    realityState: reality?.state || input.dailyBrief.realityState || 'At Risk',
    priority: selected.priority,
    reason: realityRecommendation?.reason || selected.reason,
    supportingEvidence: realityRecommendation?.supportingEvidence.length
      ? realityRecommendation.supportingEvidence
      : selected.supportingEvidence,
    recommendedAction: realityRecommendation?.action || selected.recommendedAction,
    navigationTarget: realityRecommendation?.navigationTarget || selected.navigationTarget,
    confidence: evidenceConfidence,
    limitations: uniqueStrings(limitations),
  };
}

function attentionCandidates(items: DAVEProjectDailyBriefAttentionItem[]): PriorityCandidate[] {
  return items.map(item => {
    const safety = item.category === 'safety_concern';
    const blocker = /block/i.test(item.category) || /block/i.test(item.text);
    const failedAnalysis = item.category === 'analysis';
    const stale = item.category === 'stale_evidence' || /stale|current evidence/i.test(item.text);
    const overdue = /overdue|past its due date/i.test(item.text);
    const rank = safety ? 0 : blocker ? 1 : overdue ? 2 : failedAnalysis ? 4 : stale ? 5 : 6;
    return {
      id: `attention:${item.id}`,
      rank,
      tieBreak: item.timestamp || '',
      priority: item.text,
      reason: item.whyItMatters,
      supportingEvidence: [{
        sourceType: item.sourceType,
        recordId: item.sourceRecordId,
        summary: item.evidence.trim() || 'Recorded attention item in the supporting project update.',
      }],
      recommendedAction: item.actionText,
      navigationTarget: item.navigationTarget,
      confidence: null,
      limitations: item.limitations,
    };
  });
}

function commitmentCandidates(commitments: DAVEProjectCommitment[]): PriorityCandidate[] {
  return commitments
    .filter(commitment => commitment.status !== 'Completed')
    .map(commitment => ({
      id: `commitment:${commitment.id}`,
      rank: commitment.status === 'Overdue' ? 2 : 6,
      tieBreak: commitment.dueDate || '9999-12-31',
      priority: commitment.status === 'Overdue'
        ? `Overdue commitment: ${commitment.description}`
        : `Open commitment: ${commitment.description}`,
      reason: commitment.status === 'Overdue'
        ? `The recorded due date ${commitment.dueDate} has passed and no closed status is recorded.`
        : 'The commitment is recorded as open.',
      supportingEvidence: commitment.linkedEvidence.map(evidence => ({
        sourceType: sourceTypeForCommitmentEvidence(evidence.type),
        recordId: evidence.recordId,
        summary: `${evidence.type} record linked to the commitment.`,
      })),
      recommendedAction: commitment.recommendedFollowUpAction,
      navigationTarget: 'update_detail' as const,
      confidence: null,
      limitations: ['The recorded status is not independent proof that the underlying work occurred.'],
    }));
}

function sourceTypeForCommitmentEvidence(type: 'update' | 'photo' | 'document'): DAVEBriefSourceType {
  return type;
}

function confidenceForStrength(strength: DAVEProjectEvidenceQuality['strength']): DAVEActionCenterConfidence {
  if (strength === 'High') return 'high';
  if (strength === 'Medium') return 'medium';
  return 'low';
}

function dedupeCandidates(items: PriorityCandidate[]): PriorityCandidate[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const evidenceKey = item.supportingEvidence
      .map(evidence => `${evidence.sourceType}:${evidence.recordId}`)
      .sort()
      .join('|');
    const key = `${item.navigationTarget}:${evidenceKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
