import type { ProjectUpdate, ScheduleItem } from '../types';
import type {
  DAVEEvidenceCorrelationResult,
  DAVETaskEvidenceClaim,
  DAVETaskEvidenceCorrelation,
} from './DAVEEvidenceCorrelation';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import {
  DEFAULT_PROJECT_TIME_ZONE,
  projectDateRelativeDays,
  type ProjectTimeZone,
} from './ProjectDateTime';

export const DAVE_PROJECT_REASONING_VERSION = 'dave-project-reasoning/1.0' as const;

export type DAVEReasoningKnowledgeClass =
  | 'known_fact'
  | 'supported_conclusion'
  | 'reasonable_inference'
  | 'unresolved_uncertainty';

export type DAVEReasoningRelationship =
  | 'supports'
  | 'contradicts'
  | 'depends_on'
  | 'delays'
  | 'completes'
  | 'changes';

export type DAVEReasoningConnection = Readonly<{
  id: string;
  fromEvidenceId: string;
  toTaskId: string;
  relationship: DAVEReasoningRelationship;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}>;

export type DAVEReasoningHypothesis = Readonly<{
  id: string;
  statement: string;
  score: number;
  supportingEvidenceIds: readonly string[];
  counterEvidenceIds: readonly string[];
  assumptions: readonly string[];
}>;

export type DAVEReasoningChallenge = Readonly<{
  id: string;
  kind: 'missing_evidence' | 'source_conflict' | 'stale_evidence' | 'alternative_explanation' | 'authority_gap';
  question: string;
  impact: string;
  smallestUsefulEvidence: string;
}>;

export type DAVEReasonedRecommendation = Readonly<{
  action: string;
  owner: string;
  timing: string;
  consequenceOfInaction: string;
  smallestNextAction: string;
}>;

export type DAVETaskReasonedDecision = Readonly<{
  taskId: string;
  taskName: string;
  areaName: string | null;
  classification: DAVEReasoningKnowledgeClass;
  conclusion: string;
  confidence: 'high' | 'medium' | 'low';
  selectedHypothesisId: string;
  hypotheses: readonly DAVEReasoningHypothesis[];
  challenges: readonly DAVEReasoningChallenge[];
  connections: readonly DAVEReasoningConnection[];
  reasoningSteps: readonly string[];
  recommendation: DAVEReasonedRecommendation;
  learningCues: readonly string[];
}>;

export type DAVEProjectReasoning = Readonly<{
  version: typeof DAVE_PROJECT_REASONING_VERSION;
  projectId: string;
  projectName: string;
  generatedAt: string;
  decisions: readonly DAVETaskReasonedDecision[];
  facts: readonly string[];
  supportedConclusions: readonly string[];
  inferences: readonly string[];
  uncertainties: readonly string[];
  criticalDecisions: readonly DAVETaskReasonedDecision[];
  learnedOutcomeCount: number;
  summary: string;
}>;

export function buildDAVEProjectReasoning({
  projectId,
  projectName,
  scheduleItems,
  updates = [],
  correlations,
  now = new Date().toISOString(),
  projectTimeZone = DEFAULT_PROJECT_TIME_ZONE,
}: {
  projectId: string;
  projectName: string;
  scheduleItems: readonly ScheduleItem[];
  updates?: readonly ProjectUpdate[];
  correlations: DAVEEvidenceCorrelationResult;
  now?: string;
  projectTimeZone?: ProjectTimeZone | string;
}): DAVEProjectReasoning {
  const generatedAt = validTimestamp(now) ? new Date(now).toISOString() : new Date().toISOString();
  const correlationByTask = new Map(correlations.tasks.map(item => [item.taskId, item]));
  const decisions = scheduleItems.map(item => reasonAboutTask(
    item,
    correlationByTask.get(item.id) || emptyCorrelation(item),
    generatedAt,
    projectTimeZone,
  ));
  const facts = unique(decisions.flatMap(decision => decision.reasoningSteps.filter(step => step.startsWith('Fact:'))));
  const supportedConclusions = decisions.filter(item => item.classification === 'supported_conclusion').map(item => item.conclusion);
  const inferences = decisions.filter(item => item.classification === 'reasonable_inference').map(item => item.conclusion);
  const uncertainties = decisions.filter(item => item.classification === 'unresolved_uncertainty').map(item => item.conclusion);
  const criticalDecisions = decisions.filter(item =>
    item.classification === 'unresolved_uncertainty' ||
    item.recommendation.timing === 'Now' ||
    item.recommendation.timing === 'Today',
  );
  const learnedOutcomeCount = decisions.reduce((total, item) => total + item.learningCues.length, 0);

  return deepFreeze({
    version: DAVE_PROJECT_REASONING_VERSION,
    projectId,
    projectName,
    generatedAt,
    decisions,
    facts,
    supportedConclusions,
    inferences,
    uncertainties,
    criticalDecisions,
    learnedOutcomeCount,
    summary: `${decisions.length} task${decisions.length === 1 ? '' : 's'} reasoned across ${correlations.evidenceCount} evidence record${correlations.evidenceCount === 1 ? '' : 's'}; ${supportedConclusions.length} supported conclusion${supportedConclusions.length === 1 ? '' : 's'}, ${inferences.length} inference${inferences.length === 1 ? '' : 's'}, and ${uncertainties.length} unresolved uncertaint${uncertainties.length === 1 ? 'y' : 'ies'}.`,
  });
}

function reasonAboutTask(
  item: ScheduleItem,
  correlation: DAVETaskEvidenceCorrelation,
  now: string,
  projectTimeZone: ProjectTimeZone | string,
): DAVETaskReasonedDecision {
  const connections = buildConnections(item, correlation, now, projectTimeZone);
  const hypotheses = buildHypotheses(item, correlation);
  const selected = selectHypothesis(correlation, hypotheses);
  const challenges = challengeConclusion(item, correlation, selected, now);
  const classification = classifyConclusion(item, correlation);
  const confidence = challengedConfidence(correlation.confidence, challenges, classification);
  const conclusion = conclusionText(item, correlation);
  const recommendation = recommendationFor(item, correlation, challenges, now, projectTimeZone);
  const learningCues = outcomeLearningCues(item);
  const reasoningSteps = unique([
    `Fact: The schedule records ${item.status} at ${item.percentComplete}% for ${item.taskName}.`,
    ...correlation.evidence.filter(value => value.kind !== 'schedule').map(evidenceStep),
    ...connections.filter(item => item.relationship === 'contradicts').map(item => `Conflict: ${item.reason}`),
    `Alternative considered: ${hypotheses.find(value => value.id !== selected.id)?.statement || 'No credible alternative has enough evidence.'}`,
    `Conclusion: ${conclusion}`,
    `Decision: ${recommendation.action}`,
  ]);

  return deepFreeze({
    taskId: item.id,
    taskName: item.taskName,
    areaName: clean(item.locationName),
    classification,
    conclusion,
    confidence,
    selectedHypothesisId: selected.id,
    hypotheses,
    challenges,
    connections,
    reasoningSteps,
    recommendation,
    learningCues,
  });
}

function buildConnections(
  item: ScheduleItem,
  correlation: DAVETaskEvidenceCorrelation,
  now: string,
  projectTimeZone: ProjectTimeZone | string,
) {
  const hasReportedComplete = correlation.evidence.some(value => value.authority === 'reported' && value.stance === 'complete');
  return correlation.evidence.map(evidence => {
    let relationship: DAVEReasoningRelationship = 'supports';
    let reason = `${evidence.kind.replace(/_/g, ' ')} evidence supports the recorded task context.`;
    if (evidence.authority === 'verified' && evidence.stance === 'complete') {
      relationship = 'completes';
      reason = 'A project-manager verification record authorizes the completed state.';
    } else if (
      (evidence.stance === 'not_complete' && (hasReportedComplete || scheduleProgressIsComplete(item))) ||
      (evidence.stance === 'in_progress' && item.status === 'Not Started')
    ) {
      relationship = 'contradicts';
      reason = evidence.stance === 'not_complete'
        ? 'This source reports remaining work against a completion claim.'
        : 'This source shows progress against a not-started schedule state.';
    } else if (item.status === 'Waiting' && evidence.kind === 'schedule') {
      relationship = 'depends_on';
      reason = 'Waiting status indicates an unresolved dependency that must be identified.';
    } else if (isOverdue(item, new Date(now), projectTimeZone)) {
      relationship = 'delays';
      reason = 'The recorded finish date has passed while the task remains open.';
    } else if (evidence.kind !== 'schedule' && evidence.stance === 'in_progress') {
      relationship = 'changes';
      reason = 'New field evidence changes DAVE’s understanding of task progress.';
    }
    return Object.freeze({
      id: `reasoning-connection:${item.id}:${evidence.id}:${relationship}`,
      fromEvidenceId: evidence.id,
      toTaskId: item.id,
      relationship,
      confidence: evidence.authority === 'verified' ? 'high' : evidence.authority === 'observed' ? 'medium' : correlation.confidence,
      reason,
    });
  });
}

function buildHypotheses(item: ScheduleItem, correlation: DAVETaskEvidenceCorrelation): DAVEReasoningHypothesis[] {
  const nonSchedule = correlation.evidence.filter(value => value.kind !== 'schedule');
  const completion = nonSchedule.filter(value => value.stance === 'complete').map(value => value.id);
  const contrary = nonSchedule.filter(value => value.stance === 'not_complete').map(value => value.id);
  const visual = nonSchedule.filter(value => value.authority === 'observed').map(value => value.id);
  const values: DAVEReasoningHypothesis[] = [
    hypothesis(item.id, 'schedule-current', `The schedule status for ${item.taskName} is still current.`, nonSchedule.length ? 45 : 65, [`correlation:schedule:${item.id}`], [...completion, ...contrary, ...visual], ['The schedule was updated after the field condition changed.']),
    hypothesis(item.id, 'reported-condition', `The newest field or communication report accurately describes ${item.taskName}.`, completion.length || contrary.length ? 70 : visual.length ? 60 : 20, [...completion, ...contrary, ...visual], [], ['The source refers to the same scope and area.']),
    hypothesis(item.id, 'alternative-scope', `The evidence describes visible or partial scope, not contractual completion of ${item.taskName}.`, visual.length ? 65 : 35, visual, completion, ['Some required work may be hidden, inspection-based, or outside the photograph.']),
    hypothesis(item.id, 'insufficient-evidence', `There is not enough current evidence to determine the actual condition of ${item.taskName}.`, correlation.conclusion === 'conflicting_evidence' || correlation.conclusion === 'schedule_only' ? 85 : 30, [], [...correlation.corroboratingEvidenceIds], ['No additional reliable source is available.']),
  ];
  return values.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function selectHypothesis(correlation: DAVETaskEvidenceCorrelation, hypotheses: readonly DAVEReasoningHypothesis[]) {
  const suffix = correlation.conclusion === 'conflicting_evidence' || correlation.conclusion === 'schedule_only'
    ? 'insufficient-evidence'
    : correlation.conclusion === 'progress_observed'
      ? 'alternative-scope'
      : correlation.conclusion === 'not_complete' || correlation.conclusion.includes('completion') || correlation.conclusion === 'verified_complete'
        ? 'reported-condition'
        : 'schedule-current';
  return hypotheses.find(value => value.id.endsWith(suffix)) || hypotheses[0];
}

function challengeConclusion(
  item: ScheduleItem,
  correlation: DAVETaskEvidenceCorrelation,
  selected: DAVEReasoningHypothesis,
  now: string,
) {
  const challenges: DAVEReasoningChallenge[] = [];
  const external = correlation.evidence.filter(value => value.kind !== 'schedule');
  if (!external.length) challenges.push(challenge(item.id, 'missing_evidence', 'What current field evidence confirms the schedule status?', 'DAVE cannot distinguish an accurate schedule from a stale one.', 'One current field update or task-connected photo.'));
  if (correlation.conclusion === 'conflicting_evidence') challenges.push(challenge(item.id, 'source_conflict', 'Which source reflects the current field condition?', 'Acting on the wrong source could close unfinished work or chase already completed work.', 'A PM inspection, current verification photo, or explicit correction.'));
  if (external.some(value => isStale(value.recordedAt, now))) challenges.push(challenge(item.id, 'stale_evidence', 'Has the condition changed since the latest supporting evidence?', 'Old evidence may support a conclusion that is no longer true.', 'One current status confirmation from the responsible owner.'));
  if (external.some(value => value.authority === 'observed')) challenges.push(challenge(item.id, 'alternative_explanation', 'Could the photograph show only visible partial scope?', 'Hidden connections, testing, inspection, and acceptance criteria may remain.', 'A closeout record or PM verification of the full task scope.'));
  if (correlation.conclusion === 'completion_reported' || correlation.conclusion === 'completion_supported') challenges.push(challenge(item.id, 'authority_gap', 'Who has authority to confirm this work complete?', 'A report or photograph cannot independently authorize contractual completion.', 'Named PM verification or rejection.'));
  const hasAuthoritativePMJudgment = external.some(value => value.authority === 'verified');
  if (!hasAuthoritativePMJudgment && selected.supportingEvidenceIds.length === 1 && external.length > 0) challenges.push(challenge(item.id, 'alternative_explanation', 'Is one source enough to rule out a different explanation?', 'A single source can be incomplete, stale, or refer to different scope.', 'One independent corroborating source.'));
  return uniqueBy(challenges, value => `${value.kind}:${value.question}`);
}

function classifyConclusion(item: ScheduleItem, correlation: DAVETaskEvidenceCorrelation): DAVEReasoningKnowledgeClass {
  if (correlation.conclusion === 'verified_complete' || correlation.conclusion === 'completion_supported' || correlation.conclusion === 'progress_observed') return 'supported_conclusion';
  if (correlation.conclusion === 'completion_reported') return 'reasonable_inference';
  if (correlation.conclusion === 'not_complete' && (
    item.completionVerification?.status === 'rejected' ||
    correlation.evidence.some(value => value.authority === 'verified' && value.stance === 'not_complete')
  )) return 'supported_conclusion';
  return 'unresolved_uncertainty';
}

function conclusionText(item: ScheduleItem, correlation: DAVETaskEvidenceCorrelation) {
  if (correlation.conclusion === 'verified_complete') return `${item.taskName} is verified complete.`;
  if (correlation.conclusion === 'completion_supported') return `${item.taskName} appears complete in current field records and is ready for PM approval.`;
  if (correlation.conclusion === 'completion_reported') return `${item.taskName} is marked complete and is awaiting PM approval.`;
  if (correlation.conclusion === 'progress_observed') return `${item.taskName} shows visible progress; full completion has not been recorded.`;
  if (correlation.conclusion === 'not_complete') return `${item.taskName} remains open.`;
  if (correlation.conclusion === 'conflicting_evidence') return `${item.taskName} has conflicting current status information.`;
  return `The schedule state for ${item.taskName} is not corroborated by current field evidence.`;
}

function recommendationFor(
  item: ScheduleItem,
  correlation: DAVETaskEvidenceCorrelation,
  challenges: readonly DAVEReasoningChallenge[],
  now: string,
  projectTimeZone: ProjectTimeZone | string,
): DAVEReasonedRecommendation {
  const owner = clean(item.owner) || clean(item.contractor) || 'Project manager';
  const timing = correlation.conclusion === 'conflicting_evidence'
    ? 'Now'
    : timingFor(item, now, projectTimeZone);
  const smallest = challenges[0]?.smallestUsefulEvidence || 'Record the next accountable status update.';
  const pmNextAction = clean(item.nextAction);
  if (correlation.conclusion === 'verified_complete') return { action: 'Preserve the verification and monitor downstream work.', owner, timing: 'No immediate action', consequenceOfInaction: 'No immediate consequence is identified from this task.', smallestNextAction: 'Confirm the next dependent activity is ready.' };
  if (correlation.needsVerification || challenges.length) return { action: correlation.requestedAction || 'Verify the current task condition.', owner: 'Project manager', timing, consequenceOfInaction: isOverdue(item, new Date(now), projectTimeZone) ? 'The project may continue relying on an overdue or incorrect task status.' : 'Downstream decisions may rely on an unsupported task status.', smallestNextAction: smallest };
  return { action: pmNextAction || 'Continue the planned work and capture the next material change.', owner, timing, consequenceOfInaction: 'DAVE may lose visibility into progress and emerging delay.', smallestNextAction: pmNextAction || smallest };
}

function outcomeLearningCues(item: ScheduleItem) {
  const verification = item.completionVerification;
  if (verification?.status === 'pm_verified') return [`Learned outcome: ${item.taskName} was accepted after PM verification; preserve its evidence pattern and verifier.`];
  if (verification?.status === 'rejected') return [`Learned outcome: the completion claim for ${item.taskName} was rejected; similar uncorroborated claims must remain open.`];
  return [];
}

function evidenceStep(evidence: DAVETaskEvidenceClaim) {
  const prefix = evidence.authority === 'verified' ? 'Fact' : evidence.authority === 'observed' ? 'Observation' : 'Report';
  return `${prefix}: ${evidence.summary}`;
}

function hypothesis(taskId: string, suffix: string, statement: string, score: number, supportingEvidenceIds: string[], counterEvidenceIds: string[], assumptions: string[]): DAVEReasoningHypothesis {
  return Object.freeze({ id: `hypothesis:${taskId}:${suffix}`, statement, score, supportingEvidenceIds: unique(supportingEvidenceIds), counterEvidenceIds: unique(counterEvidenceIds), assumptions });
}

function challenge(taskId: string, kind: DAVEReasoningChallenge['kind'], question: string, impact: string, smallestUsefulEvidence: string): DAVEReasoningChallenge {
  return Object.freeze({ id: `challenge:${taskId}:${kind}:${stableHash(question)}`, kind, question, impact, smallestUsefulEvidence });
}

function emptyCorrelation(item: ScheduleItem): DAVETaskEvidenceCorrelation {
  return { taskId: item.id, taskName: item.taskName, areaName: clean(item.locationName), conclusion: 'schedule_only', confidence: 'low', explanation: 'Only schedule evidence is available.', evidence: [], corroboratingEvidenceIds: [], contradiction: null, needsVerification: false, requestedAction: null };
}

function challengedConfidence(base: 'high' | 'medium' | 'low', challenges: readonly DAVEReasoningChallenge[], classification: DAVEReasoningKnowledgeClass) {
  if (classification === 'unresolved_uncertainty') return 'low';
  if (challenges.some(value => value.kind === 'source_conflict')) return 'low';
  if (base === 'high' && challenges.length > 1) return 'medium';
  return base;
}

function timingFor(
  item: ScheduleItem,
  now: string,
  projectTimeZone: ProjectTimeZone | string,
) {
  if (item.status === 'Waiting' || isOverdue(item, new Date(now), projectTimeZone)) return 'Today';
  if (!item.finishDate) return 'Within 24 hours';
  const days = projectDateRelativeDays(
    item.finishDate,
    now,
    item.projectTimeZone || projectTimeZone,
  );
  if (days === null) return 'Within 24 hours';
  if (days <= 1) return 'Today';
  if (days <= 7) return `Before ${item.finishDate}`;
  return 'At the next field update';
}

function isOverdue(
  item: ScheduleItem,
  now: Date,
  projectTimeZone: ProjectTimeZone | string,
) {
  const days = projectDateRelativeDays(
    item.finishDate,
    now,
    item.projectTimeZone || projectTimeZone,
  );
  return !scheduleProgressIsComplete(item) && days !== null && days < 0;
}

function isStale(recordedAt: string | null, now: string) {
  if (!recordedAt || !validTimestamp(recordedAt)) return true;
  return new Date(now).getTime() - new Date(recordedAt).getTime() > 7 * 86_400_000;
}

function clean(value: string | null | undefined) { const next = value?.trim(); return next || null; }
function validTimestamp(value: string) { return Boolean(value.trim()) && Number.isFinite(new Date(value).getTime()); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function uniqueBy<T>(values: T[], key: (value: T) => string) { const seen = new Set<string>(); return values.filter(value => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; }); }
function stableHash(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
function deepFreeze<T>(value: T, seen = new Set<object>()): T { if (!value || typeof value !== 'object') return value; if (seen.has(value as object)) return value; seen.add(value as object); Object.values(value as object).forEach(item => deepFreeze(item, seen)); return Object.freeze(value); }
