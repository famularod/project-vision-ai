import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import {
  isDAVECurrentCertainAssertion,
  parseDAVEAssertions,
  type DAVENormalizedAssertion,
} from './DAVEAssertionParser';

export type PIEEvidenceQualityLevel =
  | 'strong'
  | 'good'
  | 'weak'
  | 'stale'
  | 'conflicting'
  | 'insufficient';

export type PIEEvidenceFreshness = {
  score: number;
  level: PIEEvidenceQualityLevel;
  reason: string;
  ageDays: number | null;
};

export type PIEEvidenceReliability = {
  score: number;
  level: PIEEvidenceQualityLevel;
  reason: string;
};

export type PIEEvidenceCompleteness = {
  score: number;
  level: PIEEvidenceQualityLevel;
  missing: string[];
  reason: string;
};

export type PIEEvidenceRelevance = {
  score: number;
  level: PIEEvidenceQualityLevel;
  reason: string;
};

export type PIEEvidenceConflict = {
  id: string;
  evidenceIds: string[];
  summary: string;
  severity: 'low' | 'medium' | 'high';
};

export type PIEEvidenceQualityFactor = {
  id: string;
  factor:
    | 'freshness'
    | 'project'
    | 'area'
    | 'gps'
    | 'photo'
    | 'schedule'
    | 'user_confirmation'
    | 'prior_match'
    | 'ocr_review'
    | 'prior_correction'
    | 'conflict';
  scoreImpact: number;
  reason: string;
};

export type PIEEvidenceQualityScore = {
  value: number;
  level: PIEEvidenceQualityLevel;
  confidence: ProjectConfidenceLevel;
};

export type PIEEvidenceQualityInput = {
  id: string;
  source: string;
  summary: string;
  projectName?: string | null;
  areaName?: string | null;
  capturedAt?: string | null;
  gpsConfirmed?: boolean;
  photoSupported?: boolean;
  scheduleSupported?: boolean;
  userConfirmed?: boolean;
  matchesPriorEvidence?: boolean;
  unreviewedOCR?: boolean;
  correctedPreviously?: boolean;
  confidence?: ProjectConfidenceLevel;
};

export type PIEEvidenceQualityItem = {
  evidence: PIEEvidenceQualityInput;
  score: PIEEvidenceQualityScore;
  freshness: PIEEvidenceFreshness;
  completeness: PIEEvidenceCompleteness;
  reliability: PIEEvidenceReliability;
  relevance: PIEEvidenceRelevance;
  factors: PIEEvidenceQualityFactor[];
  usefulnessRank: number;
};

export type PIEEvidenceQualityResult = {
  generatedAt: string;
  summary: string;
  items: PIEEvidenceQualityItem[];
  strongEvidence: PIEEvidenceQualityItem[];
  weakEvidence: PIEEvidenceQualityItem[];
  conflictingEvidence: PIEEvidenceConflict[];
  staleEvidence: PIEEvidenceQualityItem[];
  evidenceReadiness: PIEEvidenceQualityLevel;
  averageScore: number;
};

export function evaluateEvidenceQuality(
  evidence: PIEEvidenceQualityInput[],
  generatedAt: string = new Date().toISOString(),
): PIEEvidenceQualityResult {
  const conflicts = detectEvidenceConflicts(evidence);
  const items = evidence.map(item => {
    const freshness = scoreEvidenceFreshness(item, generatedAt);
    const completeness = scoreEvidenceCompleteness(item);
    const reliability = scoreEvidenceReliability(item);
    const relevance = scoreEvidenceRelevance(item);
    const factors = buildQualityFactors(item, conflicts);
    const value = clampScore(
      Math.round(
        freshness.score * 0.25 +
          completeness.score * 0.25 +
          reliability.score * 0.3 +
          relevance.score * 0.2 +
          factors.reduce((total, factor) => total + factor.scoreImpact, 0),
      ),
    );

    return {
      evidence: item,
      score: {
        value,
        level: qualityLevelFromScore(value, conflicts.some(conflict => conflict.evidenceIds.includes(item.id)), freshness),
        confidence: confidenceFromScore(value),
      },
      freshness,
      completeness,
      reliability,
      relevance,
      factors,
      usefulnessRank: 0,
    };
  });
  const ranked = rankEvidenceByUsefulness(items);
  const averageScore = ranked.length > 0
    ? Math.round(ranked.reduce((total, item) => total + item.score.value, 0) / ranked.length)
    : 0;

  return {
    generatedAt,
    summary: summarizeEvidenceQuality(ranked, conflicts),
    items: ranked,
    strongEvidence: ranked.filter(item => item.score.level === 'strong' || item.score.level === 'good'),
    weakEvidence: ranked.filter(item =>
      item.score.level === 'weak' ||
      item.score.level === 'insufficient',
    ),
    conflictingEvidence: conflicts,
    staleEvidence: ranked.filter(item => item.score.level === 'stale'),
    evidenceReadiness: evidenceReadinessFromItems(ranked, conflicts),
    averageScore,
  };
}

export function scoreEvidenceFreshness(
  evidence: PIEEvidenceQualityInput,
  generatedAt: string = new Date().toISOString(),
): PIEEvidenceFreshness {
  const ageDays = ageInDays(evidence.capturedAt, generatedAt);

  if (ageDays === null) {
    return {
      score: 35,
      level: 'weak',
      reason: 'Evidence has no timestamp.',
      ageDays,
    };
  }

  if (ageDays <= 3) return { score: 95, level: 'strong', reason: 'Evidence is recent.', ageDays };
  if (ageDays <= 14) return { score: 80, level: 'good', reason: 'Evidence is reasonably current.', ageDays };
  if (ageDays <= 45) return { score: 55, level: 'weak', reason: 'Evidence is aging.', ageDays };
  return { score: 25, level: 'stale', reason: 'Evidence is stale.', ageDays };
}

export function scoreEvidenceCompleteness(
  evidence: PIEEvidenceQualityInput,
): PIEEvidenceCompleteness {
  const missing = [
    evidence.projectName ? null : 'project',
    evidence.areaName ? null : 'area',
    evidence.capturedAt ? null : 'timestamp',
    evidence.photoSupported ? null : 'supporting photo',
  ].filter((item): item is string => Boolean(item));
  const score = clampScore(100 - missing.length * 18);

  return {
    score,
    level: score >= 85 ? 'strong' : score >= 70 ? 'good' : score >= 45 ? 'weak' : 'insufficient',
    missing,
    reason: missing.length === 0 ? 'Evidence has project, area, time, and photo support.' : `Missing ${missing.join(', ')}.`,
  };
}

export function scoreEvidenceReliability(
  evidence: PIEEvidenceQualityInput,
): PIEEvidenceReliability {
  let score = evidence.confidence === 'high' ? 75 : evidence.confidence === 'low' ? 45 : 60;
  if (evidence.gpsConfirmed) score += 10;
  if (evidence.userConfirmed) score += 10;
  if (evidence.scheduleSupported) score += 8;
  if (evidence.photoSupported) score += 8;
  if (evidence.matchesPriorEvidence) score += 6;
  if (evidence.unreviewedOCR) score -= 18;
  if (evidence.correctedPreviously) score -= 20;
  score = clampScore(score);

  return {
    score,
    level: score >= 85 ? 'strong' : score >= 70 ? 'good' : score >= 45 ? 'weak' : 'insufficient',
    reason: reliabilityReason(evidence),
  };
}

export function scoreEvidenceRelevance(
  evidence: PIEEvidenceQualityInput,
): PIEEvidenceRelevance {
  let score = 45;
  if (evidence.projectName) score += 20;
  if (evidence.areaName) score += 15;
  if (/schedule|photo|gps|issue|safety|decision|owner|critical|overdue/i.test(evidence.summary)) score += 15;
  if (evidence.summary.trim().length > 30) score += 5;
  score = clampScore(score);

  return {
    score,
    level: score >= 85 ? 'strong' : score >= 70 ? 'good' : score >= 45 ? 'weak' : 'insufficient',
    reason: evidence.projectName || evidence.areaName
      ? 'Evidence is tied to project or area context.'
      : 'Evidence has limited project or area context.',
  };
}

export function detectEvidenceConflicts(
  evidence: PIEEvidenceQualityInput[],
): PIEEvidenceConflict[] {
  const signals = evidence.flatMap(item =>
    parseDAVEAssertions(item.summary).assertions
      .filter(isDAVECurrentCertainAssertion)
      .map(assertion => evidenceAuthoritySignal(item.id, assertion))
      .filter((signal): signal is EvidenceAuthoritySignal => Boolean(signal)),
  );
  const conflictEvidenceIds = new Set<string>();

  for (let leftIndex = 0; leftIndex < signals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < signals.length; rightIndex += 1) {
      const left = signals[leftIndex];
      const right = signals[rightIndex];
      if (
        left.stance !== right.stance &&
        left.subject === right.subject
      ) {
        conflictEvidenceIds.add(left.evidenceId);
        conflictEvidenceIds.add(right.evidenceId);
      }
    }
  }

  return conflictEvidenceIds.size > 0
    ? [{
        id: 'evidence-conflict-status',
        evidenceIds: [...conflictEvidenceIds],
        summary: 'Evidence contains contradictory current status assertions for the same subject.',
        severity: 'high',
      }]
    : [];
}

type EvidenceAuthoritySignal = Readonly<{
  evidenceId: string;
  subject: string | null;
  stance: 'positive' | 'negative';
}>;

function evidenceAuthoritySignal(
  evidenceId: string,
  assertion: DAVENormalizedAssertion,
): EvidenceAuthoritySignal | null {
  const positiveStatuses = new Set([
    'complete',
    'approved',
    'outcome_succeeded',
    'blocker_resolved',
    'unblocked',
    'safety_clear',
    'issue_clear',
  ]);
  const negativeStatuses = new Set([
    'incomplete',
    'not_started',
    'in_progress',
    'not_approved',
    'outcome_failed',
    'outcome_partial',
    'blocked',
    'delayed',
    'blocker_unresolved',
    'safety_issue_present',
    'issue_present',
  ]);

  if (positiveStatuses.has(assertion.status)) {
    return { evidenceId, subject: assertion.subject, stance: 'positive' };
  }
  if (negativeStatuses.has(assertion.status)) {
    return { evidenceId, subject: assertion.subject, stance: 'negative' };
  }
  return null;
}

export function rankEvidenceByUsefulness(
  items: PIEEvidenceQualityItem[],
): PIEEvidenceQualityItem[] {
  return [...items]
    .sort((left, right) => right.score.value - left.score.value)
    .map((item, index) => ({
      ...item,
      usefulnessRank: index + 1,
    }));
}

export function summarizeEvidenceQuality(
  items: PIEEvidenceQualityItem[],
  conflicts: PIEEvidenceConflict[] = [],
): string {
  if (items.length === 0) return 'No evidence is available to score.';
  if (conflicts.length > 0) return 'Evidence needs review because conflicting signals were detected.';

  const strongCount = items.filter(item => item.score.level === 'strong' || item.score.level === 'good').length;
  const staleCount = items.filter(item => item.score.level === 'stale').length;

  return `${strongCount} of ${items.length} evidence item${items.length === 1 ? '' : 's'} are strong or good. ${staleCount} stale item${staleCount === 1 ? '' : 's'} detected.`;
}

function buildQualityFactors(
  evidence: PIEEvidenceQualityInput,
  conflicts: PIEEvidenceConflict[],
): PIEEvidenceQualityFactor[] {
  return [
    evidence.projectName ? factor('project', 8, 'Evidence is tied to a project.') : factor('project', -12, 'Evidence is missing a project.'),
    evidence.areaName ? factor('area', 6, 'Evidence is tied to an area.') : factor('area', -8, 'Evidence is missing an area.'),
    evidence.gpsConfirmed ? factor('gps', 8, 'GPS confirms context.') : factor('gps', 0, 'GPS does not confirm context.'),
    evidence.photoSupported ? factor('photo', 8, 'Photo support strengthens evidence.') : factor('photo', -6, 'No supporting photo.'),
    evidence.scheduleSupported ? factor('schedule', 7, 'Schedule support strengthens evidence.') : factor('schedule', 0, 'No schedule support.'),
    evidence.userConfirmed ? factor('user_confirmation', 8, 'User confirmation strengthens evidence.') : factor('user_confirmation', 0, 'No user confirmation.'),
    evidence.matchesPriorEvidence ? factor('prior_match', 5, 'Evidence matches prior evidence.') : factor('prior_match', 0, 'No prior match signal.'),
    evidence.unreviewedOCR ? factor('ocr_review', -15, 'Unreviewed OCR weakens evidence.') : factor('ocr_review', 0, 'No OCR weakness detected.'),
    evidence.correctedPreviously ? factor('prior_correction', -15, 'Prior correction weakens evidence.') : factor('prior_correction', 0, 'No prior correction weakness detected.'),
    conflicts.some(conflict => conflict.evidenceIds.includes(evidence.id)) ? factor('conflict', -25, 'Evidence participates in a conflict.') : factor('conflict', 0, 'No conflict detected.'),
  ];
}

function factor(
  factorName: PIEEvidenceQualityFactor['factor'],
  scoreImpact: number,
  reason: string,
): PIEEvidenceQualityFactor {
  return {
    id: `quality-factor-${factorName}`,
    factor: factorName,
    scoreImpact,
    reason,
  };
}

function qualityLevelFromScore(
  score: number,
  hasConflict: boolean,
  freshness: PIEEvidenceFreshness,
): PIEEvidenceQualityLevel {
  if (hasConflict) return 'conflicting';
  if (freshness.level === 'stale') return 'stale';
  if (score >= 85) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 45) return 'weak';
  return 'insufficient';
}

/**
 * Audit P1-03: readiness reflects the whole evidence base, not the single
 * best item. One strong item among many insufficient ones previously read
 * as strong readiness (reproduced: 1 strong + 9 insufficient = average 25,
 * readiness "strong"). Rules now:
 * - conflicts block readiness entirely;
 * - a majority of insufficient items is itself blocking;
 * - otherwise readiness comes from the weighted average score, and can
 *   never exceed what the average supports.
 */
export function evidenceReadinessFromItems(
  items: PIEEvidenceQualityItem[],
  conflicts: PIEEvidenceConflict[],
): PIEEvidenceQualityLevel {
  if (items.length === 0) return 'insufficient';
  if (conflicts.length > 0) return 'conflicting';
  if (items.every(item => item.score.level === 'stale')) return 'stale';

  const insufficientCount = items.filter(
    item => item.score.level === 'insufficient',
  ).length;
  if (insufficientCount * 2 > items.length) return 'insufficient';

  const averageScore =
    items.reduce((total, item) => total + item.score.value, 0) / items.length;
  if (averageScore >= 85) return 'strong';
  if (averageScore >= 70) return 'good';
  if (averageScore >= 45) return 'weak';
  return 'insufficient';
}

function reliabilityReason(evidence: PIEEvidenceQualityInput) {
  if (evidence.unreviewedOCR) return 'Unreviewed OCR should not be treated as fully reliable.';
  if (evidence.correctedPreviously) return 'Evidence was previously corrected by the user.';
  if (evidence.gpsConfirmed && evidence.photoSupported) return 'GPS and photo support make this evidence reliable.';
  if (evidence.userConfirmed) return 'User confirmation improves reliability.';
  return 'Reliability is based on available source confidence.';
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function ageInDays(capturedAt: string | null | undefined, generatedAt: string) {
  if (!capturedAt) return null;
  const captured = new Date(capturedAt).getTime();
  const generated = new Date(generatedAt).getTime();
  if (!Number.isFinite(captured) || !Number.isFinite(generated)) return null;
  return Math.max(0, Math.round((generated - captured) / 86_400_000));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}
