import type { DAVEBriefNavigationTarget, DAVEBriefSourceType } from './DAVEDailyBrief';
import {
  buildDAVECommunicationCenter,
  type DAVECommunicationDraft,
  type DAVECommunicationStatement,
} from './DAVECommunicationCenter';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import type { DAVEProjectTimelineEvent } from './DAVEProjectTimeline';

export type DAVEAskIntent =
  | 'summarize_project'
  | 'what_changed'
  | 'why_at_risk'
  | 'next_action'
  | 'project_status'
  | 'needs_attention'
  | 'latest_field_update'
  | 'open_commitments'
  | 'evidence_confidence'
  | 'overdue_commitments'
  | 'safety_issues'
  | 'missing_evidence'
  | 'recommendation_reason'
  | 'supporting_evidence'
  | 'happened_this_week'
  | 'since_last_update'
  | 'draft_owner_update'
  | 'draft_contractor_follow_up'
  | 'unknown';

export type DAVEAskEvidence = {
  sourceType: DAVEBriefSourceType;
  recordId: string;
  summary: string;
  timelineEventId: string | null;
};

export type DAVEAskTimelineReference = {
  id: string;
  timestamp: string;
  eventType: string;
  title: string;
};

export type DAVEAskNavigationTarget = {
  target: DAVEBriefNavigationTarget;
  sourceRecordId: string;
  timelineEventId: string | null;
};

export type DAVEAskAnswer = {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  supportingEvidence: DAVEAskEvidence[];
  timelineReferences: DAVEAskTimelineReference[];
  recommendedNextAction: string | null;
  navigationTargets: DAVEAskNavigationTarget[];
};

export type DAVEAskRequest = {
  question: string;
  intelligence: DAVEProjectIntelligence;
  interface?: 'text' | 'voice';
};

const UNKNOWN_ANSWER = "I don't have enough project evidence to answer that.";

export function askDAVE(request: DAVEAskRequest): DAVEAskAnswer {
  const intent = routeDAVEAskIntent(request.question);
  if (intent === 'unknown') return unknownAnswer(request.intelligence);
  const intelligence = request.intelligence;
  const result = answerForIntent(intent, intelligence);
  return withEvidenceQuality(result, intelligence);
}

export const answerDAVEQuestion = askDAVE;

export function routeDAVEAskIntent(question: string): DAVEAskIntent {
  const value = question.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!value) return 'unknown';
  if (/draft.*owner.*update|owner.*update.*draft/.test(value)) return 'draft_owner_update';
  if (/draft.*contractor.*follow|contractor.*follow.*draft/.test(value)) return 'draft_contractor_follow_up';
  if (/summari[sz]e.*project|project.*summary/.test(value)) return 'summarize_project';
  if (/what changed|changes?/.test(value)) return 'what_changed';
  if (/why.*at risk|at risk.*why/.test(value)) return 'why_at_risk';
  if (/what should i do next|next action|what.*do next|what(?: s| is).*next|coming up|upcoming work|due soon/.test(value)) return 'next_action';
  if (/project status|project health|how.*project.*(?:doing|going)|how are we doing|how are things going|on track/.test(value)) return 'project_status';
  if (/what.*need.*attention|needs attention|open issues?|open problems?|what.*concern|what.*risk|what.*block|what.*problem/.test(value)) return 'needs_attention';
  if (/what happened.*this week|this week.*happened/.test(value)) return 'happened_this_week';
  if (/what happened.*since.*last update|since.*last update/.test(value)) return 'since_last_update';
  if (/latest.*(?:field )?update|last.*(?:field )?update|most recent.*update|recent field activity/.test(value)) return 'latest_field_update';
  if (/open.*commitments?|commitments?.*open|current commitments?|who.*promised|what.*promised/.test(value)) return 'open_commitments';
  if (/how confident|evidence strength|can i trust|how reliable|confidence.*evidence/.test(value)) return 'evidence_confidence';
  if (/commitments?.*overdue|overdue.*commitments?|what.*overdue|what.*late|behind schedule/.test(value)) return 'overdue_commitments';
  if (/safety.*issues?|issues?.*safety/.test(value)) return 'safety_issues';
  if (/evidence.*missing|missing.*evidence/.test(value)) return 'missing_evidence';
  if (/why.*recommend|recommend.*why/.test(value)) return 'recommendation_reason';
  if (/show.*supporting evidence|supporting evidence/.test(value)) return 'supporting_evidence';
  return 'unknown';
}

function answerForIntent(intent: Exclude<DAVEAskIntent, 'unknown'>, intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  switch (intent) {
    case 'summarize_project':
      return summarizeProject(intelligence);
    case 'what_changed':
      return whatChanged(intelligence);
    case 'why_at_risk':
      return explainRisk(intelligence);
    case 'next_action':
      return nextAction(intelligence);
    case 'project_status':
      return projectStatus(intelligence);
    case 'needs_attention':
      return needsAttention(intelligence);
    case 'latest_field_update':
      return latestFieldUpdate(intelligence);
    case 'open_commitments':
      return openCommitments(intelligence);
    case 'evidence_confidence':
      return evidenceConfidence(intelligence);
    case 'overdue_commitments':
      return overdueCommitments(intelligence);
    case 'safety_issues':
      return safetyIssues(intelligence);
    case 'missing_evidence':
      return missingEvidence(intelligence);
    case 'recommendation_reason':
      return recommendationReason(intelligence);
    case 'supporting_evidence':
      return showSupportingEvidence(intelligence);
    case 'happened_this_week':
      return happenedThisWeek(intelligence);
    case 'since_last_update':
      return sinceLastUpdate(intelligence);
    case 'draft_owner_update':
      return communicationDraft(intelligence, 'owner_update');
    case 'draft_contractor_follow_up':
      return communicationDraft(intelligence, 'contractor_follow_up');
  }
}

function projectStatus(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const reality = intelligence.projectReality;
  const schedule = intelligence.scheduleSummary;
  const scheduleFacts = schedule.taskCount > 0 ? [
    `Schedule records show ${schedule.completedCount} of ${schedule.taskCount} tasks complete and ${schedule.percentComplete}% overall progress.`,
    `${schedule.overdueCount} incomplete ${schedule.overdueCount === 1 ? 'task is' : 'tasks are'} overdue; ${schedule.dueSoonCount} ${schedule.dueSoonCount === 1 ? 'task is' : 'tasks are'} due within 7 days; ${schedule.waitingCount} ${schedule.waitingCount === 1 ? 'task is' : 'tasks are'} waiting.`,
    ...(schedule.forecastFinishDate ? [`Latest scheduled finish is ${schedule.forecastFinishDate}.`] : []),
  ] : ['No schedule tasks are assigned to this project.'];
  const latestFieldEvent = intelligence.timeline.find(item =>
    item.eventType === 'update_recorded' || item.eventType === 'qualified_photo_observation',
  );
  const facts = [
    ...scheduleFacts,
    ...(latestFieldEvent ? [`Latest field evidence: ${latestFieldEvent.summary}`] : ['No field update is currently recorded for this project.']),
    `${reality.openCommitments.length} open recorded ${reality.openCommitments.length === 1 ? 'commitment' : 'commitments'}.`,
  ];
  const interpretations = [
    `Schedule health is ${schedule.health}. Evidence-backed project status is ${reality.state}.`,
    `Field-status confidence is ${reality.confidence}; evidence strength is ${intelligence.evidenceQuality.strength}.`,
  ];
  const scheduleRecommendation = schedule.overdueCount > 0
    ? `Set recovery plans for ${schedule.overdueCount} overdue ${schedule.overdueCount === 1 ? 'task' : 'tasks'}, starting with ${schedule.overdueTasks.slice(0, 3).map(item => item.taskName).join(', ')}.`
    : schedule.dueSoonCount > 0
      ? `Confirm readiness for ${schedule.dueSoonCount} ${schedule.dueSoonCount === 1 ? 'task' : 'tasks'} due within 7 days.`
      : null;
  const recommendation = scheduleRecommendation
    ? [scheduleRecommendation]
    : reality.topRecommendation ? [reality.topRecommendation.action] : [];
  const scheduleEvidence = [...schedule.overdueTasks, ...schedule.dueSoonTasks].map(item => ({
    sourceType: 'schedule' as const,
    recordId: item.id,
    summary: `${item.taskName}: ${item.status}, ${item.percentComplete}% complete${item.finishDate ? `, due ${item.finishDate}` : ''}.`,
  }));
  const supportingEvidence = [...reality.supportingEvidence, ...scheduleEvidence];
  return answerFromEvents(
    sectionedAnswer(facts, [], interpretations, recommendation),
    intelligence,
    timelineForRecordIds(intelligence, supportingEvidence.map(item => item.recordId)),
    supportingEvidence,
    recommendation[0] || null,
    [intelligence.evidenceQuality.limitation, ...reality.uncertainties.map(item => item.text)],
  );
}

function needsAttention(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const items = intelligence.dailyBrief.attentionItems;
  const schedule = intelligence.scheduleSummary;
  const scheduleTasks = [...schedule.overdueTasks, ...schedule.dueSoonTasks]
    .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
  if (items.length === 0 && schedule.overdueCount === 0 && schedule.dueSoonCount === 0 && schedule.waitingCount === 0) {
    return answerFromEvents(
      `Facts\n${intelligence.dailyBrief.emptyStates.attention}`,
      intelligence,
      [],
      [],
      intelligence.actionCenter.recommendedAction,
      intelligence.actionCenter.limitations,
    );
  }
  const evidenceItems = items.map(item => evidenceFromDailyItem(intelligence, item));
  const scheduleEvidenceItems = scheduleTaskEvidence(scheduleTasks);
  const scheduleFacts = [
    ...(schedule.overdueCount > 0 ? [`${schedule.overdueCount} incomplete schedule ${schedule.overdueCount === 1 ? 'task is' : 'tasks are'} overdue.`] : []),
    ...(schedule.dueSoonCount > 0 ? [`${schedule.dueSoonCount} incomplete schedule ${schedule.dueSoonCount === 1 ? 'task is' : 'tasks are'} due within 7 days.`] : []),
    ...(schedule.waitingCount > 0 ? [`${schedule.waitingCount} schedule ${schedule.waitingCount === 1 ? 'task is' : 'tasks are'} waiting.`] : []),
  ];
  const actions = [
    ...items.map(item => item.actionText),
    ...(schedule.overdueCount > 0 ? ['Confirm the current field status of overdue scheduled work.'] : []),
    ...(schedule.dueSoonCount > 0 ? ['Confirm readiness for work due within 7 days.'] : []),
  ];
  return answerFromEvents(
    sectionedAnswer([...scheduleFacts, ...items.map(item => item.text)], [], [], actions),
    intelligence,
    timelineForRecordIds(intelligence, [
      ...items.map(item => item.sourceRecordId),
      ...scheduleTasks.map(item => item.id),
    ]),
    [...scheduleEvidenceItems, ...evidenceItems],
    actions[0] || null,
    items.flatMap(item => item.limitations),
  );
}

function latestFieldUpdate(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const fieldEvents = intelligence.timeline.filter(item =>
    item.eventType === 'update_recorded' ||
    item.eventType === 'qualified_photo_observation' ||
    item.eventType === 'action_created' ||
    item.eventType === 'action_completed' ||
    item.eventType === 'safety_issue_opened' ||
    item.eventType === 'safety_issue_resolved',
  ).slice(0, 6);
  return timelineAnswer(
    fieldEvents,
    intelligence,
    'No evidence-backed field update is recorded for this project.',
  );
}

function openCommitments(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const commitments = intelligence.projectReality.openCommitments;
  if (commitments.length === 0) {
    return answerFromEvents(
      'Facts\nNo open commitments are recorded.',
      intelligence,
      [],
      [],
      null,
      ['This answer reflects confirmed project memories and structured update actions only.'],
    );
  }
  const evidenceItems = commitments.flatMap(item => item.linkedEvidence.map(link => ({
    sourceType: link.type,
    recordId: link.recordId,
    summary: `${link.type} record linked to ${item.description}.`,
  })));
  return answerFromEvents(
    sectionedAnswer(commitments.map(item =>
      `${item.description} — owner: ${item.owner}; due: ${item.dueDate}; status: ${item.status}.`), [], [], []),
    intelligence,
    timelineForRecordIds(intelligence, evidenceItems.map(item => item.recordId)),
    evidenceItems,
    commitments[0]?.recommendedFollowUpAction || null,
    ['An open recorded status should be confirmed before treating the underlying work as incomplete.'],
  );
}

function evidenceConfidence(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const quality = intelligence.evidenceQuality;
  const facts = quality.signals.map(item => `${item.label}: ${item.value} (${item.quality}).`);
  return answerFromEvents(
    sectionedAnswer(facts, [], [`Overall evidence strength is ${quality.strength} (${quality.score} of ${quality.maximumScore}).`], []),
    intelligence,
    [],
    intelligence.projectReality.supportingEvidence,
    intelligence.actionCenter.recommendedAction,
    uniqueStrings([quality.limitation, ...quality.signals.map(item => item.whyItMatters || '')]),
  );
}

function summarizeProject(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const events = intelligence.timeline.slice(0, 5);
  const facts = events.filter(item => item.evidenceClass === 'fact' && item.eventType !== 'qualified_photo_observation')
    .slice(0, 2).map(item => item.summary);
  const observations = events.filter(item => item.eventType === 'qualified_photo_observation')
    .slice(0, 2).map(item => item.summary);
  const interpretations = intelligence.projectReality.supportingEvidence.length > 0
    ? [`Project Reality is ${intelligence.projectReality.state} with ${intelligence.projectReality.confidence} confidence.`]
    : [];
  const recommendation = intelligence.actionCenter.recommendedAction
    ? [intelligence.actionCenter.recommendedAction]
    : [];
  return answerFromEvents(
    sectionedAnswer(facts, observations, interpretations, recommendation),
    intelligence,
    events,
    intelligence.actionCenter.supportingEvidence,
    recommendation[0] || null,
    intelligence.actionCenter.limitations,
  );
}

function whatChanged(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const items = intelligence.dailyBrief.changedItems;
  if (items.length === 0) {
    return answerFromEvents(
      intelligence.dailyBrief.emptyStates.changed,
      intelligence,
      [],
      [],
      null,
      ['No qualified recent change event is available.'],
    );
  }
  const observations = items.filter(item => item.evidenceClass === 'observation').map(item => item.text);
  const facts = items.filter(item => item.evidenceClass === 'fact').map(item => item.text);
  const events = timelineForRecordIds(intelligence, items.map(item => item.sourceRecordId));
  return answerFromEvents(
    sectionedAnswer(facts, observations, [], []),
    intelligence,
    events,
    items.map(item => evidenceFromDailyItem(intelligence, item)),
    null,
    items.flatMap(item => item.limitations),
  );
}

function explainRisk(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const reality = intelligence.projectReality;
  const overdue = reality.openCommitments.filter(item => item.status === 'Overdue');
  const interpretations = reality.state === 'At Risk'
    ? ['Project Reality is interpreted as At Risk.']
    : [`Project Reality is ${reality.state}, not At Risk, based on current structured evidence.`];
  const facts = overdue.map(item => `${item.description} is recorded overdue with due date ${item.dueDate}.`);
  const evidenceItems = [
    ...reality.supportingEvidence,
    ...overdue.flatMap(item => item.linkedEvidence.map(link => ({
      sourceType: link.type,
      recordId: link.recordId,
      summary: `${link.type} record linked to ${item.description}.`,
    }))),
  ];
  const events = timelineForRecordIds(intelligence, evidenceItems.map(item => item.recordId));
  return answerFromEvents(
    sectionedAnswer(facts, [], interpretations, []),
    intelligence,
    events,
    evidenceItems,
    null,
    reality.uncertainties.map(item => item.text),
  );
}

function nextAction(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const schedule = intelligence.scheduleSummary;
  const nextScheduledTask = schedule.overdueTasks[0] || schedule.dueSoonTasks[0];
  if (nextScheduledTask) {
    const recommendation = schedule.overdueTasks.length > 0
      ? `Set the recovery date and next accountable step for overdue task: ${nextScheduledTask.taskName}.`
      : `Confirm readiness for upcoming task: ${nextScheduledTask.taskName}.`;
    const evidence = scheduleTaskEvidence([nextScheduledTask]);
    return answerFromEvents(
      sectionedAnswer([], [], [], [recommendation]),
      intelligence,
      timelineForRecordIds(intelligence, [nextScheduledTask.id]),
      evidence,
      recommendation,
      ['Schedule status is not proof of field completion; confirm against current evidence.'],
    );
  }
  const action = intelligence.actionCenter;
  if (!action.recommendedAction) return unknownAnswer(intelligence);
  return answerFromEvents(
    sectionedAnswer([], [], [], [action.recommendedAction]),
    intelligence,
    timelineForRecordIds(intelligence, action.supportingEvidence.map(item => item.recordId)),
    action.supportingEvidence,
    action.recommendedAction,
    action.limitations,
  );
}

function overdueCommitments(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const overdue = intelligence.commitments.filter(item => item.status === 'Overdue');
  const overdueScheduleTasks = intelligence.scheduleSummary.overdueTasks;
  if (overdue.length === 0 && intelligence.scheduleSummary.overdueCount === 0) {
    return answerFromEvents('Facts\nNo overdue schedule tasks or commitments are recorded.', intelligence, [], [], null,
      ['This reflects current structured schedule and commitment records.']);
  }
  const facts = [
    ...(intelligence.scheduleSummary.overdueCount > 0
      ? [`${intelligence.scheduleSummary.overdueCount} incomplete schedule ${intelligence.scheduleSummary.overdueCount === 1 ? 'task is' : 'tasks are'} overdue.`]
      : []),
    ...overdueScheduleTasks.map(item =>
      `${item.taskName} — due: ${item.finishDate || 'date unavailable'}; status: ${item.status}; ${item.percentComplete}% complete.`),
    ...overdue.map(item => `${item.description} — owner: ${item.owner}; due: ${item.dueDate}; status: Overdue.`),
  ];
  const evidenceItems = overdue.flatMap(item => item.linkedEvidence.map(link => ({
    sourceType: link.type,
    recordId: link.recordId,
    summary: `${link.type} record linked to ${item.description}.`,
  })));
  const scheduleEvidenceItems = scheduleTaskEvidence(overdueScheduleTasks);
  return answerFromEvents(
    sectionedAnswer(facts, [], [], []),
    intelligence,
    timelineForRecordIds(intelligence, [
      ...scheduleEvidenceItems.map(item => item.recordId),
      ...evidenceItems.map(item => item.recordId),
    ]),
    [...scheduleEvidenceItems, ...evidenceItems],
    null,
    ['An overdue schedule or commitment status does not prove that the underlying work is incomplete; confirm against current field evidence.'],
  );
}

function scheduleTaskEvidence(
  tasks: DAVEProjectIntelligence['scheduleSummary']['overdueTasks'],
): DAVEAskEvidence[] {
  return tasks.map(item => ({
    sourceType: 'schedule',
    recordId: item.id,
    summary: `${item.taskName}: ${item.status}, ${item.percentComplete}% complete${item.finishDate ? `, due ${item.finishDate}` : ''}.`,
    timelineEventId: null,
  }));
}

function safetyIssues(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const safety = intelligence.projectReality.blockers.filter(item => item.category === 'safety');
  if (safety.length === 0) {
    return answerFromEvents('Facts\nNo open safety issue is recorded in current project intelligence.',
      intelligence, [], [], null, ['This answer is limited to recorded structured evidence.']);
  }
  const evidenceItems = safety.map(item => ({
    sourceType: item.sourceType,
    recordId: item.sourceRecordId,
    summary: item.text,
  }));
  return answerFromEvents(
    sectionedAnswer(safety.map(item => item.text), [], [], []),
    intelligence,
    timelineForRecordIds(intelligence, safety.map(item => item.sourceRecordId)),
    evidenceItems,
    intelligence.projectReality.topRecommendation?.action || null,
    [],
  );
}

function missingEvidence(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const weakSignals = intelligence.evidenceQuality.signals.filter(item => item.quality !== 'strong');
  const facts = weakSignals.map(item => `${item.label}: ${item.value}.`);
  const uncertainties = intelligence.projectReality.uncertainties.map(item => item.text);
  return answerFromEvents(
    sectionedAnswer(facts, [], uncertainties, []),
    intelligence,
    timelineForRecordIds(intelligence, intelligence.projectReality.uncertainties.map(item => item.sourceRecordId)),
    intelligence.projectReality.uncertainties.map(item => ({
      sourceType: item.sourceType,
      recordId: item.sourceRecordId,
      summary: item.text,
    })),
    null,
    weakSignals.map(item => item.whyItMatters).filter((item): item is string => Boolean(item)),
  );
}

function recommendationReason(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const recommendation = intelligence.projectReality.topRecommendation;
  if (!recommendation) return unknownAnswer(intelligence);
  return answerFromEvents(
    sectionedAnswer([], [], [recommendation.reason], [recommendation.action]),
    intelligence,
    timelineForRecordIds(intelligence, recommendation.supportingEvidence.map(item => item.recordId)),
    recommendation.supportingEvidence,
    recommendation.action,
    recommendation.limitations,
  );
}

function showSupportingEvidence(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const evidenceItems = intelligence.actionCenter.supportingEvidence.length > 0
    ? intelligence.actionCenter.supportingEvidence
    : intelligence.projectReality.supportingEvidence;
  if (evidenceItems.length === 0) return unknownAnswer(intelligence);
  return answerFromEvents(
    sectionedAnswer(evidenceItems.map(item => item.summary), [], [], []),
    intelligence,
    timelineForRecordIds(intelligence, evidenceItems.map(item => item.recordId)),
    evidenceItems,
    null,
    [],
  );
}

function happenedThisWeek(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const cutoff = new Date(intelligence.generatedAt).getTime() - 7 * 24 * 60 * 60 * 1000;
  const events = intelligence.timeline.filter(item => timestampMs(item.timestamp) >= cutoff).slice(0, 8);
  return timelineAnswer(events, intelligence, 'No evidence-backed timeline events were recorded this week.');
}

function sinceLastUpdate(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const lastUpdateAt = intelligence.dailyBrief.evidenceSummary.latestUpdateAt;
  if (!lastUpdateAt) return unknownAnswer(intelligence);
  const cutoff = timestampMs(lastUpdateAt);
  const events = intelligence.timeline.filter(item =>
    timestampMs(item.timestamp) > cutoff && item.eventType !== 'recommendation_generated').slice(0, 8);
  return timelineAnswer(events, intelligence, 'No later evidence-backed events are recorded after the latest update.');
}

function timelineAnswer(
  events: DAVEProjectTimelineEvent[],
  intelligence: DAVEProjectIntelligence,
  emptyText: string,
): DAVEAskAnswer {
  if (events.length === 0) return answerFromEvents(`Facts\n${emptyText}`, intelligence, [], [], null, []);
  const facts = events.filter(item => item.evidenceClass === 'fact' && item.eventType !== 'qualified_photo_observation')
    .map(item => item.summary);
  const observations = events.filter(item => item.eventType === 'qualified_photo_observation').map(item => item.summary);
  const interpretations = events.filter(item => item.evidenceClass === 'interpretation').map(item => item.summary);
  const recommendations = events.filter(item => item.evidenceClass === 'recommendation').map(item => item.summary);
  return answerFromEvents(
    sectionedAnswer(facts, observations, interpretations, recommendations),
    intelligence,
    events,
    events.flatMap(item => item.evidence),
    null,
    events.flatMap(item => item.limitations),
  );
}

function communicationDraft(
  intelligence: DAVEProjectIntelligence,
  draftType: 'owner_update' | 'contractor_follow_up',
): DAVEAskAnswer {
  const center = buildDAVECommunicationCenter(intelligence);
  const draft = center.drafts.find(item => item.draftType === draftType)!;
  return answerFromDraft(draft, intelligence);
}

function answerFromDraft(draft: DAVECommunicationDraft, intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  const answer = sectionedAnswer(
    draft.facts.map(item => item.text),
    draft.observations.map(item => item.text),
    draft.interpretations.map(item => item.text),
    draft.recommendations.map(item => item.text),
  );
  const timelineIds = new Set(draft.evidenceUsed.map(item => item.timelineEventId).filter(Boolean));
  const events = intelligence.timeline.filter(item => timelineIds.has(item.id));
  return answerFromEvents(
    `${draft.title}\n${answer}`,
    intelligence,
    events,
    draft.evidenceUsed,
    draft.recommendations[0]?.text || null,
    draft.knownLimitations,
  );
}

function answerFromEvents(
  answer: string,
  intelligence: DAVEProjectIntelligence,
  events: DAVEProjectTimelineEvent[],
  evidenceItems: Array<{ sourceType: DAVEBriefSourceType; recordId: string; summary: string; timelineEventId?: string | null }>,
  recommendedNextAction: string | null,
  limitations: string[],
): DAVEAskAnswer {
  const evidence = normalizeEvidence(intelligence, evidenceItems, events);
  return {
    answer,
    confidence: intelligence.projectReality.confidence,
    limitations: uniqueStrings(limitations),
    supportingEvidence: evidence,
    timelineReferences: uniqueTimelineReferences(events),
    recommendedNextAction,
    navigationTargets: navigationTargets(intelligence, evidence, events),
  };
}

function withEvidenceQuality(answer: DAVEAskAnswer, intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  if (intelligence.projectReality.confidence !== 'low') return answer;
  const limitation = 'Project evidence is weak; verify the cited records before relying on this answer.';
  return {
    ...answer,
    answer: `Evidence note: Project evidence is weak.\n${answer.answer}`,
    confidence: 'low',
    limitations: uniqueStrings([...answer.limitations, limitation]),
  };
}

function unknownAnswer(intelligence: DAVEProjectIntelligence): DAVEAskAnswer {
  return {
    answer: UNKNOWN_ANSWER,
    confidence: 'low',
    limitations: uniqueStrings([
      'No supported intent and evidence-backed answer matched this question.',
      ...(intelligence.projectReality.confidence === 'low'
        ? ['Project evidence is weak; verify available records before asking a more specific question.']
        : []),
    ]),
    supportingEvidence: [],
    timelineReferences: [],
    recommendedNextAction: null,
    navigationTargets: [],
  };
}

function sectionedAnswer(
  facts: string[],
  observations: string[],
  interpretations: string[],
  recommendations: string[],
): string {
  const sections = [
    section('Facts', facts),
    section('Observations', observations),
    section('Interpretations', interpretations),
    section('Recommendations', recommendations),
  ].filter(Boolean);
  return sections.length > 0 ? sections.join('\n\n') : UNKNOWN_ANSWER;
}

function section(title: string, items: string[]): string {
  return items.length > 0 ? `${title}\n${items.map(item => `• ${item}`).join('\n')}` : '';
}

function normalizeEvidence(
  intelligence: DAVEProjectIntelligence,
  items: Array<{ sourceType: DAVEBriefSourceType; recordId: string; summary: string; timelineEventId?: string | null }>,
  events: DAVEProjectTimelineEvent[],
): DAVEAskEvidence[] {
  const seen = new Set<string>();
  return items.filter(item => item.recordId && item.summary).map(item => {
    const timelineEvent = item.timelineEventId
      ? intelligence.timeline.find(event => event.id === item.timelineEventId)
      : events.find(event => event.evidence.some(citation => citation.recordId === item.recordId)) ||
        intelligence.timeline.find(event => event.evidence.some(citation => citation.recordId === item.recordId));
    return {
      sourceType: item.sourceType,
      recordId: item.recordId,
      summary: item.summary,
      timelineEventId: timelineEvent?.id || null,
    };
  }).filter(item => {
    const key = `${item.sourceType}:${item.recordId}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceFromDailyItem(
  intelligence: DAVEProjectIntelligence,
  item: DAVEProjectIntelligence['dailyBrief']['changedItems'][number],
): DAVEAskEvidence {
  const event = intelligence.timeline.find(candidate =>
    candidate.evidence.some(citation => citation.recordId === item.sourceRecordId));
  return {
    sourceType: item.sourceType,
    recordId: item.sourceRecordId,
    summary: item.text,
    timelineEventId: event?.id || null,
  };
}

function timelineForRecordIds(intelligence: DAVEProjectIntelligence, recordIds: string[]): DAVEProjectTimelineEvent[] {
  const ids = new Set(recordIds);
  return intelligence.timeline.filter(item => item.evidence.some(citation => ids.has(citation.recordId)));
}

function uniqueTimelineReferences(events: DAVEProjectTimelineEvent[]): DAVEAskTimelineReference[] {
  const seen = new Set<string>();
  return events.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id))).map(item => ({
    id: item.id,
    timestamp: item.timestamp,
    eventType: item.eventType,
    title: item.title,
  }));
}

function navigationTargets(
  intelligence: DAVEProjectIntelligence,
  evidenceItems: DAVEAskEvidence[],
  events: DAVEProjectTimelineEvent[],
): DAVEAskNavigationTarget[] {
  const seen = new Set<string>();
  return evidenceItems.map(item => {
    const event = item.timelineEventId
      ? intelligence.timeline.find(candidate => candidate.id === item.timelineEventId)
      : events.find(candidate => candidate.evidence.some(citation => citation.recordId === item.recordId));
    return {
      target: event?.navigationTarget || 'project_workspace',
      sourceRecordId: item.recordId,
      timelineEventId: event?.id || null,
    };
  }).filter(item => {
    const key = `${item.target}:${item.sourceRecordId}:${item.timelineEventId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function timestampMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
