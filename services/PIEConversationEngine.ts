import type {
  ContactBook,
  ProjectArea,
  ProjectContact,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import {
  analyzeProjectIntelligence,
  type ProjectConfidenceLevel,
  type ProjectIntelligenceSummary,
  type ProjectReportHistoryMetadata,
  type ProjectSyncFreshnessMetadata,
} from './ProjectIntelligenceEngine';
import {
  buildPIEDecisionQueue,
  getCommunicationDecisions,
  getCriticalDecisions,
  getNextBestAction,
  getProjectWalkDecision,
  getUserApprovalRequiredDecisions,
  type PIEDecision,
  type PIEDecisionQueue,
  type PIENextBestAction,
} from './PIEDecisionEngine';
import {
  buildPIEMemory,
  getMemoryGaps,
  getMemoryInsights,
  getProjectPatterns,
  getTimelineSegments,
  type PIEMemoryGap,
  type PIEMemoryInsight,
  type PIEMemoryPattern,
  type PIEMemorySnapshot,
  type PIEProjectTimelineSegment,
} from './PIEMemoryEngine';
import {
  buildPIEReasoning,
  getPIEConcerns,
  getPIEQuestions,
  getPIERecommendations,
  type PIEConcern,
  type PIEEvidence,
  type PIEQuestion,
  type PIEReasoningResult,
  type PIEThoughtRecommendation,
} from './PIEReasoningEngine';
import {
  buildProjectEvents,
  getProjectStory,
  type ProjectEvent,
  type ProjectStory,
} from './ProjectEventService';

export type PIEConversationIntent =
  | 'morning-brief'
  | 'project-status'
  | 'project-story'
  | 'next-best-action'
  | 'current-risks'
  | 'current-concerns'
  | 'communication'
  | 'project-walk'
  | 'executive-summary'
  | 'customer-update'
  | 'general-question';

export type PIEConversationPriority = 'low' | 'medium' | 'high';

export type PIEConversationContext = {
  projectName?: string | null;
  projectNames?: string[];
  intent?: PIEConversationIntent;
  question?: string | null;
  updates?: ProjectUpdate[];
  scheduleItems?: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook | ProjectContact[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  projectEvents?: ProjectEvent[];
  now?: Date;
};

export type PIEConversationQuestion = {
  id: string;
  question: string;
  reason: string;
  priority: PIEConversationPriority;
  confidence: ProjectConfidenceLevel;
  source: 'reasoning' | 'memory' | 'location' | 'conversation';
};

export type PIEConversationSuggestion = {
  id: string;
  label: string;
  detail: string;
  intent: PIEConversationIntent;
  priority: PIEConversationPriority;
  requiresApproval: boolean;
  confidence: ProjectConfidenceLevel;
};

export type PIEConversationResponse = {
  id: string;
  projectName: string;
  intent: PIEConversationIntent;
  title: string;
  summary: string;
  whatPIEKnows: string;
  whatChanged: string;
  whatConcernsPIE: string;
  whatPIERecommends: string;
  whatPIENeedsFromYou: string;
  confidence: ProjectConfidenceLevel;
  confidenceSummary: string;
  evidence: string[];
  uncertainty: string[];
  suggestedNextAction: string;
  questions: PIEConversationQuestion[];
  suggestions: PIEConversationSuggestion[];
  generatedAt: string;
};

export type PIEConversationSummary = {
  projectName: string;
  intent: PIEConversationIntent;
  headline: string;
  bullets: string[];
  confidence: ProjectConfidenceLevel;
  generatedAt: string;
};

export type PIEConversationState = {
  projectName: string;
  projectNames: string[];
  intent: PIEConversationIntent;
  question: string | null;
  generatedAt: string;
  evidence: PIEEvidence[];
  projectEvents: ProjectEvent[];
  projectStory: ProjectStory;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  memory: PIEMemorySnapshot;
  decisionQueue: PIEDecisionQueue;
  nextBestAction: PIENextBestAction;
  concerns: PIEConcern[];
  questions: PIEQuestion[];
  recommendations: PIEThoughtRecommendation[];
  memoryGaps: PIEMemoryGap[];
  memoryInsights: PIEMemoryInsight[];
  timelineSegments: PIEProjectTimelineSegment[];
  patterns: PIEMemoryPattern[];
  criticalDecisions: PIEDecision[];
  communicationDecisions: PIEDecision[];
  projectWalkDecision: PIEDecision | null;
  approvalRequiredDecisions: PIEDecision[];
};

export type PIEConversation = {
  id: string;
  projectName: string;
  intent: PIEConversationIntent;
  question: string | null;
  state: PIEConversationState;
  response: PIEConversationResponse;
  summary: PIEConversationSummary;
  questions: PIEConversationQuestion[];
  suggestions: PIEConversationSuggestion[];
  generatedAt: string;
};

export const PIE_CONVERSATION_INTENTS: PIEConversationIntent[] = [
  'morning-brief',
  'project-status',
  'project-story',
  'next-best-action',
  'current-risks',
  'current-concerns',
  'communication',
  'project-walk',
  'executive-summary',
  'customer-update',
  'general-question',
];

export function buildConversation(
  context: PIEConversationContext,
): PIEConversation {
  const state = buildConversationState(context);
  const response = responseForIntent(state);
  const summary = responseSummary(response);

  return {
    id: conversationId(state.intent, state.projectName, state.generatedAt),
    projectName: state.projectName,
    intent: state.intent,
    question: state.question,
    state,
    response,
    summary,
    questions: response.questions,
    suggestions: response.suggestions,
    generatedAt: state.generatedAt,
  };
}

export function buildMorningBrief(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'morning-brief',
  }));
}

export function buildProjectStatus(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'project-status',
  }));
}

export function buildProjectStoryConversation(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'project-story',
  }));
}

export function buildDecisionConversation(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'next-best-action',
  }));
}

export function buildCommunicationConversation(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'communication',
  }));
}

export function buildProjectWalkConversation(
  context: PIEConversationContext,
): PIEConversationResponse {
  return responseForIntent(buildConversationState({
    ...context,
    intent: 'project-walk',
  }));
}

function buildConversationState({
  projectName,
  projectNames = [],
  intent,
  question = null,
  updates = [],
  scheduleItems = [],
  currentUpdate = null,
  projectAreas = [],
  contacts,
  referenceDocuments = [],
  reportHistory = [],
  syncMetadata = null,
  projectEvents,
  now = new Date(),
}: PIEConversationContext): PIEConversationState {
  const generatedAt = now.toISOString();
  const resolvedProjectName = resolveProjectName({
    projectName,
    projectNames,
    currentUpdate,
    updates,
    scheduleItems,
  });
  const allProjectNames = uniqueText([
    resolvedProjectName,
    ...projectNames,
    ...updates.map(update => update.projectName),
    ...scheduleItems.map(item => item.projectName),
  ]);
  const events =
    projectEvents ??
    buildProjectEvents({
      projectNames: allProjectNames,
      updates,
      scheduleItems,
      contacts,
      referenceDocuments,
      reportHistory,
      syncMetadata,
      now,
    });
  const projectStory = getProjectStory(events, {
    projectName: resolvedProjectName,
    now,
  });
  const intelligence = analyzeProjectIntelligence({
    projectName: resolvedProjectName,
    updates,
    scheduleItems,
    currentUpdate,
    projectAreas,
    contacts,
    referenceDocuments,
    reportHistory,
    syncMetadata,
    projectEvents: events,
    now,
  });
  const reasoning = buildPIEReasoning({
    projectName: resolvedProjectName,
    intelligence,
    projectEvents: events,
    updates,
    scheduleItems,
    referenceDocuments,
    now,
  });
  const memory = buildPIEMemory({
    projectName: resolvedProjectName,
    intelligence,
    reasoning,
    projectEvents: events,
    updates,
    scheduleItems,
    referenceDocuments,
    reportHistory,
    now,
  });
  const decisionQueue = buildPIEDecisionQueue({
    projectName: resolvedProjectName,
    intelligence,
    reasoning,
    memory,
    projectEvents: events,
    now,
  });

  return {
    projectName: resolvedProjectName,
    projectNames: allProjectNames,
    intent: intent ?? inferIntent(question),
    question,
    generatedAt,
    evidence: reasoning.evidence,
    projectEvents: events,
    projectStory,
    intelligence,
    reasoning,
    memory,
    decisionQueue,
    nextBestAction: getNextBestAction(decisionQueue),
    concerns: getPIEConcerns(reasoning),
    questions: getPIEQuestions(reasoning),
    recommendations: getPIERecommendations(reasoning),
    memoryGaps: getMemoryGaps(memory),
    memoryInsights: getMemoryInsights(memory),
    timelineSegments: getTimelineSegments(memory),
    patterns: getProjectPatterns(memory),
    criticalDecisions: getCriticalDecisions(decisionQueue),
    communicationDecisions: getCommunicationDecisions(decisionQueue),
    projectWalkDecision: getProjectWalkDecision(decisionQueue),
    approvalRequiredDecisions: getUserApprovalRequiredDecisions(decisionQueue),
  };
}

function responseForIntent(
  state: PIEConversationState,
): PIEConversationResponse {
  switch (state.intent) {
    case 'morning-brief':
      return morningBriefResponse(state);
    case 'project-status':
      return projectStatusResponse(state);
    case 'project-story':
      return projectStoryResponse(state);
    case 'next-best-action':
      return decisionResponse(state);
    case 'current-risks':
      return riskResponse(state);
    case 'current-concerns':
      return concernResponse(state);
    case 'communication':
      return communicationResponse(state, 'Project Communication');
    case 'project-walk':
      return projectWalkResponse(state);
    case 'executive-summary':
      return executiveSummaryResponse(state);
    case 'customer-update':
      return customerUpdateResponse(state);
    case 'general-question':
    default:
      return generalQuestionResponse(state);
  }
}

function morningBriefResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'Morning Brief',
    summary: `${state.projectName}: ${healthLabel(state.intelligence)} health, ${state.intelligence.confidence.score}% PIE confidence, next action is ${state.nextBestAction.title}.`,
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: concernLine(state),
    whatPIERecommends: decisionLine(state),
    whatPIENeedsFromYou: needsLine(state),
    suggestedNextAction: state.nextBestAction.suggestedNextAction,
  });
}

function projectStatusResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'Project Status',
    summary: projectStatusLine(state),
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: concernLine(state),
    whatPIERecommends: decisionLine(state),
    whatPIENeedsFromYou: needsLine(state),
    suggestedNextAction: state.nextBestAction.suggestedNextAction,
  });
}

function projectStoryResponse(state: PIEConversationState) {
  const story = state.memory.story;

  return createResponse(state, {
    title: 'Project Story',
    summary: story.whatHappened,
    whatPIEKnows: `${story.whatHappened} Current phase: ${phaseLabel(story.currentPhase)}.`,
    whatChanged: story.whatChangedOverTime,
    whatConcernsPIE: story.majorRisks[0] || concernLine(state),
    whatPIERecommends: `Likely next step: ${story.likelyNextStep}.`,
    whatPIENeedsFromYou:
      story.unresolvedQuestions[0] || needsLine(state),
    suggestedNextAction: story.likelyNextStep,
  });
}

function decisionResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'Next Best Action',
    summary: `${state.nextBestAction.title}: ${state.nextBestAction.summary}`,
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: decisionConcernLine(state),
    whatPIERecommends: decisionLine(state),
    whatPIENeedsFromYou: approvalNeedLine(state),
    suggestedNextAction: state.nextBestAction.suggestedNextAction,
  });
}

function riskResponse(state: PIEConversationState) {
  const risk = state.intelligence.riskSignals[0] ?? null;

  return createResponse(state, {
    title: 'Current Risks',
    summary: risk
      ? `${risk.label}: ${risk.message}`
      : 'PIE does not see an urgent risk from current local evidence.',
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: risk
      ? `${risk.message} ${risk.suggestedAction}`
      : concernLine(state),
    whatPIERecommends: risk?.suggestedAction || decisionLine(state),
    whatPIENeedsFromYou: needsLine(state),
    suggestedNextAction:
      risk?.suggestedAction || state.nextBestAction.suggestedNextAction,
  });
}

function concernResponse(state: PIEConversationState) {
  const concern = state.concerns[0] ?? null;

  return createResponse(state, {
    title: 'Current Concerns',
    summary: concern
      ? `${concern.title}: ${concern.summary}`
      : 'PIE does not see an urgent concern from current local evidence.',
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: concern
      ? `${concern.summary} Impact: ${concern.impact}`
      : concernLine(state),
    whatPIERecommends:
      concern?.suggestedNextAction || decisionLine(state),
    whatPIENeedsFromYou: needsLine(state),
    suggestedNextAction:
      concern?.suggestedNextAction || state.nextBestAction.suggestedNextAction,
  });
}

function communicationResponse(
  state: PIEConversationState,
  title: string,
) {
  const readiness = state.intelligence.communicationReadiness;
  const decision = state.communicationDecisions[0] ?? null;

  return createResponse(state, {
    title,
    summary: readiness.message,
    whatPIEKnows: `Communication readiness is ${readiness.level} at ${readiness.score}%. ${readiness.strengths[0] || projectStatusLine(state)}`,
    whatChanged: changedLine(state),
    whatConcernsPIE:
      readiness.missingItems[0] ||
      decision?.summary ||
      'PIE does not see a blocking communication concern.',
    whatPIERecommends:
      decision?.suggestedNextAction ||
      state.reasoning.communicationInsight.summary ||
      decisionLine(state),
    whatPIENeedsFromYou:
      readiness.missingItems[0] ||
      approvalNeedLine(state),
    suggestedNextAction:
      decision?.suggestedNextAction || state.nextBestAction.suggestedNextAction,
  });
}

function projectWalkResponse(state: PIEConversationState) {
  const location = state.intelligence.locationIntelligence;
  const walkDecision = state.projectWalkDecision;

  return createResponse(state, {
    title: 'Project Walk',
    summary: walkDecision
      ? walkDecision.summary
      : 'PIE can prepare a field walk from current project memory and location context.',
    whatPIEKnows: `PIE believes the current area is ${location.currentArea || 'not confirmed'}. GPS status: ${location.gpsStatus}. Location confidence is ${location.confidenceScore}%.`,
    whatChanged: changedLine(state),
    whatConcernsPIE: concernLine(state),
    whatPIERecommends:
      walkDecision?.suggestedNextAction ||
      'Begin a project walk and verify current progress, inspection status, open risks, and next actions.',
    whatPIENeedsFromYou:
      location.confirmationPrompt ||
      state.memoryGaps[0]?.suggestedAction ||
      'Review PIE output before saving any field update.',
    suggestedNextAction:
      walkDecision?.suggestedNextAction || 'Begin Project Walk',
  });
}

function executiveSummaryResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'Executive Summary',
    summary: `${state.projectName}: ${healthLabel(state.intelligence)} health, ${state.nextBestAction.title}.`,
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: concernLine(state),
    whatPIERecommends: decisionLine(state),
    whatPIENeedsFromYou:
      state.intelligence.communicationReadiness.missingItems[0] ||
      approvalNeedLine(state),
    suggestedNextAction: 'Review and approve the executive summary before sharing.',
  });
}

function customerUpdateResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'Customer Update',
    summary: `${state.projectName}: PIE can prepare a customer-safe update from current project evidence.`,
    whatPIEKnows: customerSafeStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE:
      state.intelligence.communicationReadiness.missingItems[0] ||
      concernLine(state),
    whatPIERecommends:
      'Prepare a clear customer update, then have the project manager review and approve it.',
    whatPIENeedsFromYou:
      state.intelligence.communicationReadiness.missingItems[0] ||
      'Approve the customer update before anything is sent.',
    suggestedNextAction: 'Review Customer Update',
  });
}

function generalQuestionResponse(state: PIEConversationState) {
  return createResponse(state, {
    title: 'PIE Response',
    summary: state.question
      ? `PIE reviewed the project for: ${state.question}`
      : 'PIE reviewed the current project intelligence.',
    whatPIEKnows: projectStatusLine(state),
    whatChanged: changedLine(state),
    whatConcernsPIE: concernLine(state),
    whatPIERecommends: decisionLine(state),
    whatPIENeedsFromYou: needsLine(state),
    suggestedNextAction: state.nextBestAction.suggestedNextAction,
    uncertainty:
      state.question && state.intent === 'general-question'
        ? ['PIE can only answer from current local project evidence in this version.']
        : undefined,
  });
}

function createResponse(
  state: PIEConversationState,
  input: {
    title: string;
    summary: string;
    whatPIEKnows: string;
    whatChanged: string;
    whatConcernsPIE: string;
    whatPIERecommends: string;
    whatPIENeedsFromYou: string;
    suggestedNextAction: string;
    uncertainty?: string[];
  },
): PIEConversationResponse {
  const questions = conversationQuestions(state);
  const suggestions = conversationSuggestions(state);

  return {
    id: conversationId(state.intent, state.projectName, state.generatedAt),
    projectName: state.projectName,
    intent: state.intent,
    title: input.title,
    summary: compactSentence(input.summary),
    whatPIEKnows: compactSentence(input.whatPIEKnows),
    whatChanged: compactSentence(input.whatChanged),
    whatConcernsPIE: compactSentence(input.whatConcernsPIE),
    whatPIERecommends: compactSentence(input.whatPIERecommends),
    whatPIENeedsFromYou: compactSentence(input.whatPIENeedsFromYou),
    confidence: state.decisionQueue.confidence,
    confidenceSummary: `${state.decisionQueue.confidence} confidence from ${state.evidence.length} evidence signal${state.evidence.length === 1 ? '' : 's'} and ${state.projectEvents.length} event${state.projectEvents.length === 1 ? '' : 's'}.`,
    evidence: evidenceLines(state).slice(0, 5),
    uncertainty: compactList([
      ...(input.uncertainty ?? []),
      ...uncertaintyLines(state),
    ]).slice(0, 4),
    suggestedNextAction: input.suggestedNextAction,
    questions,
    suggestions,
    generatedAt: state.generatedAt,
  };
}

function responseSummary(
  response: PIEConversationResponse,
): PIEConversationSummary {
  return {
    projectName: response.projectName,
    intent: response.intent,
    headline: response.summary,
    bullets: compactList([
      response.whatPIEKnows,
      response.whatChanged,
      response.whatConcernsPIE,
      response.whatPIERecommends,
      response.whatPIENeedsFromYou,
    ]),
    confidence: response.confidence,
    generatedAt: response.generatedAt,
  };
}

function projectStatusLine(state: PIEConversationState) {
  const intelligence = state.intelligence;
  const progress =
    intelligence.metrics.averageScheduleProgress === null
      ? 'progress is not calculated'
      : `${intelligence.metrics.averageScheduleProgress}% average schedule progress`;

  return `${healthLabel(intelligence)} health, ${scheduleLabel(intelligence.scheduleStatus)} schedule, ${progress}, ${intelligence.updateCount} update${intelligence.updateCount === 1 ? '' : 's'}, ${intelligence.photoCount} photo${intelligence.photoCount === 1 ? '' : 's'}.`;
}

function customerSafeStatusLine(state: PIEConversationState) {
  const intelligence = state.intelligence;

  return `${healthLabel(intelligence)} project health with ${scheduleLabel(intelligence.scheduleStatus)} schedule status and ${lastUpdateLabel(intelligence)}.`;
}

function changedLine(state: PIEConversationState) {
  if (state.memory.story.whatChangedOverTime) {
    return state.memory.story.whatChangedOverTime;
  }

  if (state.projectStory.latestActivityAt) {
    return `Latest activity was ${formatShortDate(state.projectStory.latestActivityAt)}.`;
  }

  return 'PIE does not have enough timeline history to compare change over time yet.';
}

function concernLine(state: PIEConversationState) {
  const concern = state.concerns[0];
  const risk = state.intelligence.riskSignals[0];

  if (concern) return `${concern.title}: ${concern.summary}`;
  if (risk) return `${risk.label}: ${risk.message}`;

  return 'PIE does not see an urgent concern from current local evidence.';
}

function decisionConcernLine(state: PIEConversationState) {
  const critical = state.criticalDecisions[0];

  if (critical) return `${critical.title}: ${critical.summary}`;

  return concernLine(state);
}

function decisionLine(state: PIEConversationState) {
  const action = state.nextBestAction;
  const approval = action.userApprovalRequired
    ? 'User approval is required.'
    : 'User approval is not required for PIE to suggest this.';

  return `${action.title}: ${action.summary} ${approval}`;
}

function needsLine(state: PIEConversationState) {
  const question = state.questions[0];
  const gap = state.memoryGaps[0];
  const locationPrompt = state.intelligence.locationIntelligence.confirmationPrompt;
  const missingCommunication =
    state.intelligence.communicationReadiness.missingItems[0];

  if (question) return question.question;
  if (locationPrompt) return locationPrompt;
  if (gap) return gap.suggestedAction;
  if (missingCommunication) return missingCommunication;

  return approvalNeedLine(state);
}

function approvalNeedLine(state: PIEConversationState) {
  const approval = state.approvalRequiredDecisions[0];

  if (approval) {
    return `Review and approve: ${approval.title}. PIE will not complete this automatically.`;
  }

  return 'Continue monitoring or capture current field progress if conditions changed.';
}

function evidenceLines(state: PIEConversationState) {
  const evidence = state.evidence.map(item =>
    `${item.title}: ${item.detail}`,
  );
  const events = state.projectEvents.slice(0, 3).map(event =>
    `${event.title}: ${event.description}`,
  );

  return compactList([
    ...evidence,
    ...events,
    state.intelligence.healthSignal.message,
  ]);
}

function uncertaintyLines(state: PIEConversationState) {
  return compactList([
    state.decisionQueue.confidence === 'low'
      ? 'PIE confidence is low because project context is incomplete.'
      : null,
    state.memoryGaps[0]
      ? `${state.memoryGaps[0].title}: ${state.memoryGaps[0].impact}`
      : null,
    state.intelligence.communicationReadiness.level !== 'ready'
      ? state.intelligence.communicationReadiness.message
      : null,
    state.intelligence.locationIntelligence.needsConfirmation
      ? state.intelligence.locationIntelligence.confirmationPrompt
      : null,
  ]);
}

function conversationQuestions(
  state: PIEConversationState,
): PIEConversationQuestion[] {
  const reasoningQuestions: PIEConversationQuestion[] = state.questions
    .slice(0, 3)
    .map(question => ({
      id: question.id,
      question: question.question,
      reason: question.reason,
      priority: question.priority,
      confidence: question.confidence,
      source: 'reasoning',
    }));
  const gapQuestions: PIEConversationQuestion[] = state.memoryGaps
    .slice(0, 2)
    .map(gap => ({
      id: gap.id,
      question: gap.suggestedAction,
      reason: gap.impact,
      priority: gap.priority,
      confidence: gap.confidence,
      source: 'memory',
    }));
  const locationQuestion = state.intelligence.locationIntelligence.confirmationPrompt
    ? [{
        id: 'confirm-location',
        question: state.intelligence.locationIntelligence.confirmationPrompt,
        reason: 'PIE location confidence is not high enough to assume the area.',
        priority: 'medium' as const,
        confidence: state.intelligence.locationIntelligence.confidence,
        source: 'location' as const,
      }]
    : [];

  return uniqueById([
    ...reasoningQuestions,
    ...locationQuestion,
    ...gapQuestions,
  ]).slice(0, 5);
}

function conversationSuggestions(
  state: PIEConversationState,
): PIEConversationSuggestion[] {
  const decisions = [
    state.decisionQueue.decisions[0],
    ...state.criticalDecisions,
    ...state.communicationDecisions,
    state.projectWalkDecision,
  ].filter((decision): decision is PIEDecision => Boolean(decision));

  return uniqueById(decisions.map(decision => ({
    id: decision.id,
    label: decision.title,
    detail: decision.summary,
    intent: intentFromDecision(decision),
    priority: decision.priority === 'critical' ? 'high' : decision.priority,
    requiresApproval: decision.userApproval.required,
    confidence: decision.confidence,
  }))).slice(0, 5);
}

function intentFromDecision(decision: PIEDecision): PIEConversationIntent {
  if (decision.impact.area === 'communication') return 'communication';
  if (decision.impact.area === 'project-walk') return 'project-walk';
  if (decision.impact.area === 'safety') return 'current-risks';
  if (decision.impact.area === 'schedule') return 'current-risks';

  return 'next-best-action';
}

function inferIntent(question: string | null | undefined): PIEConversationIntent {
  const normalized = question?.trim().toLowerCase() || '';

  if (!normalized) return 'general-question';
  if (includesAny(normalized, ['morning', 'brief', 'today'])) {
    return 'morning-brief';
  }
  if (includesAny(normalized, ['status', 'health', 'progress'])) {
    return 'project-status';
  }
  if (includesAny(normalized, ['story', 'history', 'over time', 'remember'])) {
    return 'project-story';
  }
  if (includesAny(normalized, ['next', 'priority', 'what should i do'])) {
    return 'next-best-action';
  }
  if (includesAny(normalized, ['risk', 'behind', 'overdue'])) {
    return 'current-risks';
  }
  if (includesAny(normalized, ['concern', 'attention', 'worry'])) {
    return 'current-concerns';
  }
  if (includesAny(normalized, ['communicate', 'boss', 'customer', 'report'])) {
    return 'communication';
  }
  if (includesAny(normalized, ['walk', 'field', 'site'])) {
    return 'project-walk';
  }
  if (includesAny(normalized, ['executive', 'leadership'])) {
    return 'executive-summary';
  }
  if (includesAny(normalized, ['customer', 'client'])) {
    return 'customer-update';
  }

  return 'general-question';
}

function resolveProjectName({
  projectName,
  projectNames,
  currentUpdate,
  updates,
  scheduleItems,
}: {
  projectName?: string | null;
  projectNames: string[];
  currentUpdate: ProjectUpdate | null;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
}) {
  return (
    projectName?.trim() ||
    currentUpdate?.projectName.trim() ||
    projectNames.find(name => name.trim())?.trim() ||
    updates.find(update => update.projectName.trim())?.projectName.trim() ||
    scheduleItems.find(item => item.projectName.trim())?.projectName.trim() ||
    'Project'
  );
}

function healthLabel(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.healthStatus === 'healthy') return 'Healthy';
  if (intelligence.healthStatus === 'watch') return 'Watch';
  if (intelligence.healthStatus === 'at-risk') return 'At risk';

  return 'Unknown';
}

function scheduleLabel(status: ProjectIntelligenceSummary['scheduleStatus']) {
  if (status === 'not-available') return 'not available';
  if (status === 'on-track') return 'on track';
  if (status === 'due-soon') return 'due soon';

  return status;
}

function lastUpdateLabel(intelligence: ProjectIntelligenceSummary) {
  if (!intelligence.lastUpdate) return 'no saved update yet';

  return `last update ${formatShortDate(intelligence.lastUpdate)}`;
}

function phaseLabel(value: string) {
  return value
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'an unknown date';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function compactSentence(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function compactList(values: Array<string | null | undefined>) {
  return uniqueText(
    values
      .map(value => value?.replace(/\s+/g, ' ').trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const text = value?.trim();
    if (!text) return;

    const key = text.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  items.forEach(item => {
    if (seen.has(item.id)) return;

    seen.add(item.id);
    result.push(item);
  });

  return result;
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some(candidate => value.includes(candidate));
}

function conversationId(
  intent: PIEConversationIntent,
  projectName: string,
  generatedAt: string,
) {
  return [
    'pie-conversation',
    intent,
    projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    generatedAt,
  ].join(':');
}
