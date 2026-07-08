import type {
  PIEMemoryRecallResult,
  PIEPastCorrection,
  PIEPastRecommendation,
  PIERelevantMemory,
} from './PIEMemoryRecall';
import type { PIELearningResult } from './PIELearningEngine';
import type {
  PIEBeliefChange,
  PIELessonLearned,
  PIERecommendationImprovement,
  PIEReflectionResult,
} from './PIEReflectionEngine';
import type { PIEEvidenceTimeline } from './PIEEvidenceTimeline';
import type {
  PIERealityModel,
  PIERealityObjectIntelligenceResult,
} from './PIERealityModel';
import type { PIESituationResult } from './PIESituationIntelligence';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';

export type PIEPatternType =
  | 'schedule_slippage'
  | 'contractor_slowdown'
  | 'inspection_risk'
  | 'recurring_safety_issue'
  | 'missing_evidence'
  | 'repeated_user_correction'
  | 'recurring_blocker'
  | 'recovery_sequence'
  | 'successful_resolution'
  | 'failed_recommendation'
  | 'communication_gap'
  | 'resource_constraint'
  | 'quality_concern';

export type PIEPatternConfidence = ProjectConfidenceLevel;

export type PIEPatternEvidence = {
  id: string;
  source: string;
  summary: string;
  dateTime: string | null;
  confidence: PIEPatternConfidence;
};

export type PIEPatternSimilarity = {
  score: number;
  sharedTerms: string[];
  sharedSourceCount: number;
  confidence: PIEPatternConfidence;
};

export type PIEPatternOutcome = {
  id: string;
  outcome: 'worked' | 'failed' | 'unknown' | 'recovered' | 'worsened';
  summary: string;
  confidence: PIEPatternConfidence;
};

export type PIEPatternTimeline = {
  firstSeen: string | null;
  lastSeen: string | null;
  occurrenceCount: number;
  trend: 'better' | 'worse' | 'recurring' | 'resolved' | 'unknown';
  events: PIEPatternEvidence[];
};

export type PIEPattern = {
  id: string;
  type: PIEPatternType;
  title: string;
  summary: string;
  evidence: PIEPatternEvidence[];
  timeline: PIEPatternTimeline;
  outcome: PIEPatternOutcome;
  confidence: PIEPatternConfidence;
};

export type PIEPatternMatch = {
  id: string;
  pattern: PIEPattern;
  similarity: PIEPatternSimilarity;
  explanation: string;
  currentEvidence: string;
  confidence: PIEPatternConfidence;
};

export type PIEPatternSignal = {
  id: string;
  type: PIEPatternType;
  signal: string;
  severity: 'low' | 'medium' | 'high';
  evidenceIds: string[];
  confidence: PIEPatternConfidence;
};

export type PIEPatternRecommendation = {
  id: string;
  recommendation: string;
  reason: string;
  basedOnPatternIds: string[];
  confidence: PIEPatternConfidence;
};

export type PIEPatternBeliefInfluence = {
  id: string;
  beliefType: string;
  influence: 'strengthen' | 'weaken' | 'challenge';
  reason: string;
  patternIds: string[];
  confidence: PIEPatternConfidence;
};

export type PIEPatternWarning = {
  id: string;
  warning: string;
  patternType: PIEPatternType;
  whatToVerify: string;
  confidence: PIEPatternConfidence;
};

export type PIEPatternIntelligenceInput = {
  currentEvidenceSummary?: string | null;
  projectName?: string | null;
  areaName?: string | null;
  memoryRecall?: PIEMemoryRecallResult | null;
  reflection?: PIEReflectionResult | null;
  pastReflections?: PIEReflectionResult[];
  lessonsLearned?: PIELessonLearned[];
  beliefChanges?: PIEBeliefChange[];
  recommendationImprovements?: PIERecommendationImprovement[];
  pastCorrections?: PIEPastCorrection[];
  pastRecommendations?: PIEPastRecommendation[];
  learningResult?: PIELearningResult | null;
  evidenceTimeline?: PIEEvidenceTimeline | null;
  realityModel?: PIERealityModel | null;
  objectIntelligence?: PIERealityObjectIntelligenceResult | null;
  situationIntelligence?: PIESituationResult | null;
};

export type PIEPatternIntelligence = {
  generatedAt: string;
  currentEvidenceSummary: string;
  patterns: PIEPattern[];
  patternMatches: PIEPatternMatch[];
  earlyWarnings: PIEPatternWarning[];
  signals: PIEPatternSignal[];
  recurringIssues: PIEPattern[];
  successfulRecoveryPatterns: PIEPattern[];
  failedPatterns: PIEPattern[];
  patternBasedRecommendations: PIEPatternRecommendation[];
  beliefInfluences: PIEPatternBeliefInfluence[];
  patternConfidence: PIEPatternConfidence;
  summary: string;
};

const PATTERN_RULES: Array<{
  type: PIEPatternType;
  title: string;
  terms: string[];
  warning: string;
  recommendation: string;
}> = [
  {
    type: 'schedule_slippage',
    title: 'Schedule Slippage',
    terms: ['late', 'delay', 'delayed', 'behind', 'overdue', 'slip', 'due'],
    warning: 'Schedule slippage signals are recurring.',
    recommendation: 'Verify blockers and recovery plan before assuming schedule recovery.',
  },
  {
    type: 'contractor_slowdown',
    title: 'Contractor Slowdown',
    terms: ['contractor', 'crew', 'manpower', 'slow', 'stalled', 'waiting'],
    warning: 'Contractor progress may be slowing.',
    recommendation: 'Verify manpower, contractor commitment, and material availability.',
  },
  {
    type: 'inspection_risk',
    title: 'Inspection Risk',
    terms: ['inspection', 'inspect', 'rough-in', 'permit', 'signoff', 'failed'],
    warning: 'Inspection readiness may be at risk.',
    recommendation: 'Verify inspection prerequisites and supporting photo evidence.',
  },
  {
    type: 'recurring_safety_issue',
    title: 'Recurring Safety Issue',
    terms: ['safety', 'hazard', 'blocked', 'housekeeping', 'unsafe', 'concern'],
    warning: 'A safety concern appears to be recurring.',
    recommendation: 'Confirm whether the safety concern is still present and assign follow-up.',
  },
  {
    type: 'missing_evidence',
    title: 'Missing Evidence',
    terms: ['missing', 'unknown', 'unclear', 'need photo', 'no photo', 'verify'],
    warning: 'PIE still lacks enough evidence to confirm the condition.',
    recommendation: 'Collect targeted evidence before making a strong recommendation.',
  },
  {
    type: 'repeated_user_correction',
    title: 'Repeated User Correction',
    terms: ['corrected', 'correction', 'wrong area', 'wrong project', 'user corrected'],
    warning: 'The user has corrected PIE on similar context before.',
    recommendation: 'Lower confidence and ask for confirmation before acting.',
  },
  {
    type: 'recurring_blocker',
    title: 'Recurring Blocker',
    terms: ['blocked', 'blocker', 'waiting', 'hold', 'cannot proceed'],
    warning: 'A blocker appears more than once.',
    recommendation: 'Identify owner, dependency, and next unblock action.',
  },
  {
    type: 'recovery_sequence',
    title: 'Recovery Sequence',
    terms: ['resumed', 'recovered', 'back on track', 'started again', 'progress resumed'],
    warning: 'Recovery may be starting after a prior delay.',
    recommendation: 'Monitor whether the recovery sequence continues in the next update.',
  },
  {
    type: 'successful_resolution',
    title: 'Successful Resolution',
    terms: ['resolved', 'complete', 'completed', 'closed', 'fixed'],
    warning: 'A prior issue may have been resolved.',
    recommendation: 'Confirm closure with current evidence before removing follow-up.',
  },
  {
    type: 'failed_recommendation',
    title: 'Failed Recommendation',
    terms: ['failed', 'did not work', 'wrong', 'not completed', 'rejected'],
    warning: 'A prior recommendation may not have worked.',
    recommendation: 'Review what changed before repeating the same recommendation.',
  },
  {
    type: 'communication_gap',
    title: 'Communication Gap',
    terms: ['no response', 'follow up', 'waiting response', 'communicate', 'question'],
    warning: 'Communication follow-up may be missing.',
    recommendation: 'Identify who needs the update and what action is expected.',
  },
  {
    type: 'resource_constraint',
    title: 'Resource Constraint',
    terms: ['material', 'materials', 'equipment', 'crew', 'resource', 'delivery'],
    warning: 'Resource constraints may affect progress.',
    recommendation: 'Verify material, equipment, and crew availability.',
  },
  {
    type: 'quality_concern',
    title: 'Quality Concern',
    terms: ['quality', 'defect', 'rework', 'incorrect', 'damaged', 'punch'],
    warning: 'A quality concern may be recurring.',
    recommendation: 'Capture evidence and verify whether rework is required.',
  },
];

export function buildPIEPatternIntelligence(
  input: PIEPatternIntelligenceInput,
): PIEPatternIntelligence {
  const currentEvidenceSummary = input.currentEvidenceSummary ||
    input.memoryRecall?.summaryForPIE ||
    'No current evidence summary provided.';
  const patterns = [
    ...identifyRecurringIssues(input),
    ...identifySuccessfulRecoveryPatterns(input),
    ...identifyFailedPatterns(input),
  ];
  const patternMatches = findMatchingPatterns(input, patterns);
  const earlyWarnings = detectEarlyWarnings(input, patternMatches);
  const signals = patternMatches.map((match, index) => ({
    id: `pattern-signal-${index + 1}`,
    type: match.pattern.type,
    signal: match.pattern.summary,
    severity: match.similarity.score >= 8 ? 'high' as const : match.similarity.score >= 5 ? 'medium' as const : 'low' as const,
    evidenceIds: match.pattern.evidence.map(item => item.id),
    confidence: match.confidence,
  }));
  const timelineSignals = (input.evidenceTimeline?.momentumSignals || [])
    .filter(signal => signal !== 'stable')
    .map((signal, index) => ({
      id: `pattern-signal-timeline-${index + 1}`,
      type: signal === 'repeated_same_issue'
        ? 'recurring_blocker' as const
        : signal === 'progress_slowing' || signal === 'area_going_stale'
          ? 'schedule_slippage' as const
          : 'missing_evidence' as const,
      signal: `Timeline momentum: ${signal.replace(/_/g, ' ')}.`,
      severity: signal === 'repeated_same_issue' || signal === 'area_going_stale'
        ? 'high' as const
        : 'medium' as const,
      evidenceIds: input.evidenceTimeline?.recentChanges.map(change => change.toEventId) || [],
      confidence: input.evidenceTimeline?.summary.confidence || 'medium',
    }));
  const patternBasedRecommendations = buildPatternBasedRecommendations(patternMatches, earlyWarnings);
  const beliefInfluences = buildPatternBeliefInfluences(patternMatches, earlyWarnings);
  const patternConfidence = scorePatternConfidence(patternMatches, earlyWarnings);

  return {
    generatedAt: new Date().toISOString(),
    currentEvidenceSummary,
    patterns,
    patternMatches,
    earlyWarnings,
    signals: [...signals, ...timelineSignals],
    recurringIssues: patterns.filter(pattern =>
      pattern.timeline.trend === 'recurring' || pattern.timeline.trend === 'worse',
    ),
    successfulRecoveryPatterns: patterns.filter(pattern =>
      pattern.type === 'recovery_sequence' || pattern.type === 'successful_resolution',
    ),
    failedPatterns: patterns.filter(pattern => pattern.type === 'failed_recommendation'),
    patternBasedRecommendations,
    beliefInfluences,
    patternConfidence,
    summary: summarizePatternIntelligence(patternMatches, earlyWarnings, patternBasedRecommendations),
  };
}

export function findMatchingPatterns(
  input: PIEPatternIntelligenceInput,
  patterns: PIEPattern[] = identifyRecurringIssues(input),
): PIEPatternMatch[] {
  const current = input.currentEvidenceSummary ||
    input.memoryRecall?.summaryForPIE ||
    '';

  return patterns
    .map(pattern => {
      const similarity = compareCurrentToHistorical(current, pattern);
      return {
        id: `pattern-match-${pattern.id}`,
        pattern,
        similarity,
        explanation: explainPatternMatch(pattern, similarity),
        currentEvidence: current,
        confidence: similarity.confidence,
      };
    })
    .filter(match => match.similarity.score >= 3 || match.pattern.timeline.occurrenceCount >= 2)
    .sort((a, b) => b.similarity.score - a.similarity.score)
    .slice(0, 8);
}

export function detectEarlyWarnings(
  input: PIEPatternIntelligenceInput,
  matches: PIEPatternMatch[] = findMatchingPatterns(input),
): PIEPatternWarning[] {
  return matches
    .filter(match =>
      match.pattern.timeline.trend === 'worse' ||
      match.pattern.timeline.trend === 'recurring' ||
      match.pattern.type === 'failed_recommendation' ||
      match.pattern.type === 'inspection_risk' ||
      match.pattern.type === 'recurring_safety_issue',
    )
    .map((match, index) => {
      const rule = PATTERN_RULES.find(item => item.type === match.pattern.type);
      return {
        id: `pattern-warning-${index + 1}`,
        warning: rule?.warning || 'A recurring pattern may affect this condition.',
        patternType: match.pattern.type,
        whatToVerify: rule?.recommendation || 'Verify whether the historical condition applies now.',
        confidence: match.confidence,
      };
    });
}

export function compareCurrentToHistorical(
  currentEvidenceSummary: string,
  pattern: PIEPattern,
): PIEPatternSimilarity {
  const currentTerms = significantTerms(currentEvidenceSummary);
  const historicalTerms = significantTerms([
    pattern.summary,
    ...pattern.evidence.map(item => item.summary),
  ].join(' '));
  const sharedTerms = currentTerms.filter(term => historicalTerms.includes(term));
  return scorePatternSimilarity(sharedTerms, pattern);
}

export function scorePatternSimilarity(
  sharedTerms: string[],
  pattern: PIEPattern,
): PIEPatternSimilarity {
  const sharedSourceCount = new Set(pattern.evidence.map(item => item.source)).size;
  const occurrenceScore = Math.min(4, pattern.timeline.occurrenceCount);
  const termScore = Math.min(4, sharedTerms.length);
  const sourceScore = Math.min(2, sharedSourceCount);
  const score = termScore + occurrenceScore + sourceScore;

  return {
    score,
    sharedTerms,
    sharedSourceCount,
    confidence: confidenceFromScore(score),
  };
}

export function buildPatternTimeline(evidence: PIEPatternEvidence[]): PIEPatternTimeline {
  const dated = evidence
    .filter(item => item.dateTime)
    .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
  const summary = evidence.map(item => item.summary).join(' ').toLowerCase();
  const trend = /resolved|complete|fixed|recovered|resumed/.test(summary)
    ? 'better'
    : /worse|failed|blocked|overdue|delay|unsafe/.test(summary)
      ? 'worse'
      : evidence.length >= 2
        ? 'recurring'
        : 'unknown';

  return {
    firstSeen: dated[0]?.dateTime || null,
    lastSeen: dated[dated.length - 1]?.dateTime || null,
    occurrenceCount: evidence.length,
    trend,
    events: evidence,
  };
}

export function buildPatternBasedRecommendations(
  matches: PIEPatternMatch[],
  warnings: PIEPatternWarning[] = [],
): PIEPatternRecommendation[] {
  return matches.slice(0, 5).map((match, index) => {
    const rule = PATTERN_RULES.find(item => item.type === match.pattern.type);
    const warning = warnings.find(item => item.patternType === match.pattern.type);
    return {
      id: `pattern-recommendation-${index + 1}`,
      recommendation: rule?.recommendation || 'Use historical context before recommending action.',
      reason: warning?.warning || match.explanation,
      basedOnPatternIds: [match.pattern.id],
      confidence: match.confidence,
    };
  });
}

export function buildPatternBeliefInfluences(
  matches: PIEPatternMatch[],
  warnings: PIEPatternWarning[] = [],
): PIEPatternBeliefInfluence[] {
  return matches.slice(0, 6).map((match, index) => {
    const warning = warnings.find(item => item.patternType === match.pattern.type);
    const influence = match.pattern.outcome.outcome === 'worked' || match.pattern.outcome.outcome === 'recovered'
      ? 'strengthen'
      : warning || match.pattern.timeline.trend === 'worse' || match.pattern.outcome.outcome === 'failed'
        ? 'weaken'
        : 'challenge';

    return {
      id: `pattern-belief-influence-${index + 1}`,
      beliefType: match.pattern.type,
      influence,
      reason: warning?.warning || match.explanation,
      patternIds: [match.pattern.id],
      confidence: match.confidence,
    };
  });
}

export function explainPatternMatch(
  pattern: PIEPattern,
  similarity: PIEPatternSimilarity,
): string {
  if (similarity.sharedTerms.length > 0) {
    return `${pattern.title} matched prior evidence through ${similarity.sharedTerms.slice(0, 4).join(', ')}.`;
  }

  return `${pattern.title} appeared ${pattern.timeline.occurrenceCount} time${pattern.timeline.occurrenceCount === 1 ? '' : 's'} in prior context.`;
}

export function identifyRecurringIssues(input: PIEPatternIntelligenceInput): PIEPattern[] {
  const evidence = collectPatternEvidence(input);
  return PATTERN_RULES
    .filter(rule => !['recovery_sequence', 'successful_resolution', 'failed_recommendation'].includes(rule.type))
    .map(rule => buildPatternFromRule(rule, evidence))
    .filter((pattern): pattern is PIEPattern => Boolean(pattern));
}

export function identifySuccessfulRecoveryPatterns(input: PIEPatternIntelligenceInput): PIEPattern[] {
  const evidence = collectPatternEvidence(input);
  return PATTERN_RULES
    .filter(rule => rule.type === 'recovery_sequence' || rule.type === 'successful_resolution')
    .map(rule => buildPatternFromRule(rule, evidence))
    .filter((pattern): pattern is PIEPattern => Boolean(pattern));
}

export function identifyFailedPatterns(input: PIEPatternIntelligenceInput): PIEPattern[] {
  const evidence = collectPatternEvidence(input);
  return PATTERN_RULES
    .filter(rule => rule.type === 'failed_recommendation')
    .map(rule => buildPatternFromRule(rule, evidence))
    .filter((pattern): pattern is PIEPattern => Boolean(pattern));
}

function buildPatternFromRule(
  rule: typeof PATTERN_RULES[number],
  evidence: PIEPatternEvidence[],
): PIEPattern | null {
  const matchingEvidence = evidence.filter(item =>
    includesAnyTerm(item.summary, rule.terms),
  );

  if (matchingEvidence.length === 0) return null;

  const timeline = buildPatternTimeline(matchingEvidence);
  return {
    id: `pattern-${rule.type}`,
    type: rule.type,
    title: rule.title,
    summary: `${rule.title} appears in ${matchingEvidence.length} historical item${matchingEvidence.length === 1 ? '' : 's'}.`,
    evidence: matchingEvidence,
    timeline,
    outcome: inferPatternOutcome(rule.type, matchingEvidence),
    confidence: confidenceFromScore(matchingEvidence.length + new Set(matchingEvidence.map(item => item.source)).size),
  };
}

function collectPatternEvidence(input: PIEPatternIntelligenceInput): PIEPatternEvidence[] {
  const memoryEvidence = [
    ...(input.memoryRecall?.memories || []),
    ...(input.memoryRecall?.similarPastSituations || []),
  ].map(memoryToPatternEvidence);
  const historicalProjectContext = 'historical project events and report_history are pattern sources';
  const lessons = [
    ...(input.lessonsLearned || []),
    ...(input.memoryRecall?.pastLessons || []).map(lesson => ({
      id: lesson.id,
      event: lesson.event as PIELessonLearned['event'],
      lesson: lesson.lesson,
      whatPIEShouldDoDifferently: lesson.shouldDoDifferently,
      confidence: lesson.confidence,
    })),
    ...(input.reflection?.lessonsLearned || []),
    ...(input.pastReflections || []).flatMap(reflection => reflection.lessonsLearned),
  ].map((lesson, index) => ({
    id: `pattern-lesson-${lesson.id || index}`,
    source: 'reflection_lesson',
    summary: `${lesson.lesson} ${lesson.whatPIEShouldDoDifferently}`,
    dateTime: null,
    confidence: lesson.confidence,
  }));
  const corrections = [
    ...(input.pastCorrections || []),
    ...(input.memoryRecall?.pastCorrections || []),
  ].map(correction => ({
    id: `pattern-correction-${correction.id}`,
    source: 'user_correction',
    summary: correction.summary,
    dateTime: null,
    confidence: correction.confidence,
  }));
  const recommendations = [
    ...(input.pastRecommendations || []),
    ...(input.memoryRecall?.pastRecommendations || []),
  ].map(recommendation => ({
    id: `pattern-recommendation-${recommendation.id}`,
    source: 'recommendation',
    summary: `${recommendation.recommendation} ${recommendation.suggestedNextAction}`,
    dateTime: null,
    confidence: recommendation.confidence,
  }));
  const beliefChanges = [
    ...(input.beliefChanges || []),
    ...(input.reflection?.beliefChanges || []),
    ...(input.pastReflections || []).flatMap(reflection => reflection.beliefChanges),
  ].map(change => ({
    id: `pattern-belief-${change.id}`,
    source: 'reflection_belief_change',
    summary: `${change.previousBelief} ${change.updatedBelief} ${change.reason} ${change.verificationNeeded || ''}`,
    dateTime: null,
    confidence: change.direction === 'unchanged' ? 'medium' as const : 'high' as const,
  }));
  const improvements = [
    ...(input.recommendationImprovements || []),
    ...(input.reflection?.recommendationImprovements || []),
    ...(input.pastReflections || []).flatMap(reflection => reflection.recommendationImprovements),
  ].map(improvement => ({
    id: `pattern-improvement-${improvement.id}`,
    source: 'recommendation_improvement',
    summary: `${improvement.recommendation} ${improvement.reason} ${improvement.recommendedNextEvidence}`,
    dateTime: null,
    confidence: 'medium' as const,
  }));
  const learningEvidence = [
    ...(input.learningResult?.memoryConsolidation || []),
    ...(input.learningResult?.patternUpdates || []),
    ...(input.learningResult?.recommendationImprovements || []),
  ].map((item, index) => ({
    id: `pattern-learning-${'id' in item ? item.id : index}`,
    source: 'continuous_learning',
    summary: 'summary' in item
      ? `${item.summary} ${'influence' in item ? item.influence : ''}`
      : 'pattern' in item
        ? `${item.pattern} ${item.reason}`
        : `${item.recommendationPattern} ${item.improvement}`,
    dateTime: input.learningResult?.generatedAt || null,
    confidence: item.confidence,
  }));

  return dedupePatternEvidence([
    {
      id: 'pattern-source-historical-project-context',
      source: 'historical_project_context',
      summary: historicalProjectContext,
      dateTime: null,
      confidence: 'medium',
    },
    ...memoryEvidence,
    ...lessons,
    ...corrections,
    ...recommendations,
    ...beliefChanges,
    ...improvements,
    ...learningEvidence,
  ]);
}

function memoryToPatternEvidence(memory: PIERelevantMemory): PIEPatternEvidence {
  return {
    id: `pattern-memory-${memory.id}`,
    source: memory.source,
    summary: memory.summary,
    dateTime: memory.dateTime,
    confidence: memory.confidence,
  };
}

function inferPatternOutcome(
  type: PIEPatternType,
  evidence: PIEPatternEvidence[],
): PIEPatternOutcome {
  const text = evidence.map(item => item.summary).join(' ').toLowerCase();
  const outcome = type === 'failed_recommendation' || /failed|wrong|rejected|not completed/.test(text)
    ? 'failed'
    : /resolved|complete|fixed/.test(text)
      ? 'worked'
      : /recovered|resumed|back on track/.test(text)
        ? 'recovered'
        : /worse|overdue|blocked|unsafe/.test(text)
          ? 'worsened'
          : 'unknown';

  return {
    id: `pattern-outcome-${type}`,
    outcome,
    summary: outcome === 'unknown'
      ? 'Historical outcome is not clear yet.'
      : `Historical outcome appears to have ${outcome.replace(/_/g, ' ')}.`,
    confidence: confidenceFromScore(evidence.length),
  };
}

function summarizePatternIntelligence(
  matches: PIEPatternMatch[],
  warnings: PIEPatternWarning[],
  recommendations: PIEPatternRecommendation[],
) {
  if (matches.length === 0) {
    return 'No recurring historical pattern was strong enough to influence the current recommendation.';
  }

  return [
    `${matches.length} pattern match${matches.length === 1 ? '' : 'es'} found.`,
    warnings[0]?.warning,
    recommendations[0]?.recommendation,
  ].filter(Boolean).join(' ');
}

function scorePatternConfidence(
  matches: PIEPatternMatch[],
  warnings: PIEPatternWarning[],
): PIEPatternConfidence {
  const score = matches.reduce((sum, match) => sum + match.similarity.score, 0) +
    warnings.length * 2;
  return confidenceFromScore(score / Math.max(1, matches.length));
}

function significantTerms(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 3 && !['this', 'that', 'with', 'from', 'have', 'been', 'should'].includes(term)),
  ));
}

function includesAnyTerm(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some(term => lower.includes(term));
}

function dedupePatternEvidence(evidence: PIEPatternEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter(item => {
    const key = `${item.source}-${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(item.summary.trim());
  });
}

function confidenceFromScore(score: number): PIEPatternConfidence {
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}
