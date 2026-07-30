import type { DAVEProjectTruth } from './DAVEProjectTruth';
import type { PIEReportDraft } from './PIEReporter';
import {
  buildScheduleTaskAccounting,
  scheduleTaskDurationWeight,
} from './dave-project-schedule-rollup';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  type DAVEReportPeriodComparison,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

export const DAVE_REPORT_INTELLIGENCE_VERSION = 'dave-report-intelligence/2.0' as const;
export const DAVE_REPORT_SOURCE_VERSION = 'dave-report-source/1.0' as const;

export type DAVEReportAction = Readonly<{
  id: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  action: string;
  owner: string;
  timing: string;
  dueDate: string | null;
  issue: string;
  impact: string;
  consequence: string;
  smallestNextAction: string;
  sourceTaskId: string;
  scheduleImpactDays: number | null;
  confidence: 'high' | 'medium' | 'low';
}>;

export type DAVEReportProjectCondition = Readonly<{
  projectName: string;
  currentReality: string;
  schedule: string;
  percentComplete: number;
  forecastFinish: string | null;
  baselineFinish: string | null;
  forecastVarianceDays: number | null;
}>;

export type DAVEReportMilestone = Readonly<{
  id: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  finishDate: string | null;
  status: string;
  percentComplete: number;
  state: 'complete' | 'missed' | 'due_soon' | 'upcoming' | 'undated';
}>;

export type DAVEReportRecentChange = Readonly<{
  id: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  occurredAt: string | null;
  summary: string;
  source: 'approved_report_comparison' | 'task_activity' | 'task_revision' | 'project_update';
}>;

export type DAVEReportControlMetrics = Readonly<{
  pendingApprovals: number;
  responsesDue: number;
  unassignedOpenWork: number;
  incompleteChecklistItems: number;
  scheduleImpactItems: number;
  totalEstimatedScheduleImpactDays: number;
}>;

export type DAVEReportWorkAreaProgress = Readonly<{
  id: string;
  projectName: string;
  areaName: string;
  taskCount: number;
  completeTaskCount: number;
  averagePercent: number;
  completed: boolean;
  calculation: 'schedule_duration_weighted_average';
}>;

export type DAVEReportDashboardMetrics = Readonly<{
  taskStatus: Readonly<{
    total: number;
    complete: number;
    open: number;
    inProgress: number;
    notStarted: number;
    waiting: number;
  }>;
  scheduleHealth: Readonly<{
    onTrack: number;
    blocked: number;
    dueSoon: number;
    overdue: number;
  }>;
  attention: Readonly<{
    risks: number;
    decisions: number;
    verification: number;
  }>;
  controls: DAVEReportControlMetrics;
  workAreas: readonly DAVEReportWorkAreaProgress[];
}>;

export type DAVEReportBriefing = Readonly<{
  version: typeof DAVE_REPORT_INTELLIGENCE_VERSION;
  generatedAt: string;
  scopeLabel: string;
  overallCondition: 'critical' | 'attention' | 'stable' | 'insufficient_evidence';
  conditionLabel: string;
  executiveSnapshot: string;
  reportingPeriod: DAVEReportPeriodComparison;
  dashboard: DAVEReportDashboardMetrics;
  projectConditions: readonly DAVEReportProjectCondition[];
  recentChanges: readonly DAVEReportRecentChange[];
  milestones: readonly DAVEReportMilestone[];
  currentWork: readonly string[];
  whatChanged: readonly string[];
  schedulePosition: readonly string[];
  criticalRisks: readonly string[];
  decisionsRequired: readonly string[];
  nextActions: readonly DAVEReportAction[];
}>;

/**
 * Identifies the semantic project facts used to prepare a report. Volatile
 * refresh times and collection ordering are ignored so a routine sync does
 * not make a report stale, while a meaningful fact change does.
 */
export function buildDAVEReportSourceFingerprint(
  truths: readonly DAVEProjectTruth[],
): string {
  const truthFingerprints = truths
    .map(truth => ({
      projectName: normalized(truth.projectName),
      fingerprint: stableHash(stableStringify(canonicalizeReportSourceValue(
        withoutVolatileReportSourceFields(truth),
      ))),
    }))
    .sort((left, right) => left.projectName.localeCompare(right.projectName));

  return `${DAVE_REPORT_SOURCE_VERSION}:${stableHash(stableStringify(truthFingerprints))}`;
}

export function buildDAVEReportBriefing({
  truths,
  selectedProjectNames,
  previousSnapshot,
}: {
  truths: readonly DAVEProjectTruth[];
  selectedProjectNames?: readonly string[];
  previousSnapshot?: DAVEReportSnapshot | null;
}): DAVEReportBriefing {
  const projectNames = unique(
    (selectedProjectNames?.length ? selectedProjectNames : truths.map(truth => truth.projectName))
      .map(clean)
      .filter(Boolean),
  );
  const generatedAt = truths.map(truth => truth.generatedAt).sort().at(-1) || new Date().toISOString();
  const snapshotScopeKey = daveReportSnapshotScopeKey(projectNames);
  const currentSnapshot = buildDAVEReportSnapshot({
    truths,
    scopeKey: snapshotScopeKey,
    sourceFingerprint: buildDAVEReportSourceFingerprint(truths),
    capturedAt: generatedAt,
  });
  const reportingPeriod = compareDAVEReportSnapshots({
    current: currentSnapshot,
    previous: previousSnapshot,
  });
  const projectConditions = truths.map(projectConditionFromTruth);
  const criticalDecisions = truths.flatMap(truth => truth.reasoning.criticalDecisions);
  const actionDecisions = uniqueBy([
    ...criticalDecisions,
    ...truths.flatMap(truth => truth.reasoning.decisions),
  ], decision => `${truthProjectName(truths, decision.taskId)}|${decision.taskId}`);
  const reportableActionDecisions = actionDecisions.filter(decision =>
    decision.confidence !== 'low' &&
    isReportableCurrentState(decision.recommendation.action) &&
    !isVerificationOnlyAction(decision.recommendation.action),
  );
  const reasoningActions = reportableActionDecisions.map(decision => ({
      id: `report-action:${decision.taskId}`,
      projectName: truthProjectName(truths, decision.taskId),
      taskName: decision.taskName,
      areaName: decision.areaName,
      action: decision.recommendation.action,
      owner: decision.recommendation.owner,
      timing: decision.recommendation.timing,
      dueDate: null,
      issue: decision.taskName,
      impact: decision.recommendation.consequenceOfInaction,
      consequence: decision.recommendation.consequenceOfInaction,
      smallestNextAction: decision.recommendation.smallestNextAction,
      sourceTaskId: decision.taskId,
      scheduleImpactDays: null,
      confidence: decision.confidence,
    }));
  const scheduleActions = truths.flatMap(truth => truth.schedule
    .filter(task => !scheduleProgressIsComplete(task))
    .filter(task => task.urgency === 'overdue' || task.urgency === 'due_soon' || task.status === 'Waiting')
    .sort((left, right) => reportScheduleActionRank(left) - reportScheduleActionRank(right))
    .map(task => scheduleBackedReportAction(truth.projectName, task)));
  const nextActions = uniqueBy(
    [...scheduleActions, ...reasoningActions],
    item => `${normalized(item.projectName)}|${normalized(item.taskName)}|${normalized(item.action)}`,
  ).slice(0, 8);
  const decisionsRequired = unique(reportableActionDecisions
    .filter(decision => /\b(?:approve|authorize|decide|select)\b/i.test(decision.recommendation.action))
    .map(decision =>
      `${truthProjectName(truths, decision.taskId)} — ${decision.taskName}: ${decision.recommendation.action}`,
    )).slice(0, 8);
  const recentChanges = buildRecentChanges({ truths, reportingPeriod });
  const milestones = buildReportMilestones(truths);
  const currentWork = unique(truths.flatMap(truth => truth.schedule
    .filter(task => !scheduleProgressIsComplete(task))
    .sort((left, right) => reportScheduleActionRank(left) - reportScheduleActionRank(right))
    .map(task => reportTaskFact(truth.projectName, task, truths.length > 1))),
  ).slice(0, 12);
  const scheduleConcerns = truths.flatMap(truth => truth.schedule
    .filter(task => !scheduleProgressIsComplete(task))
    .filter(task => task.urgency === 'overdue' || task.status === 'Waiting' || Boolean(task.contradiction))
    .sort((left, right) => reportScheduleActionRank(left) - reportScheduleActionRank(right))
    .map(task => reportTaskConcern(truth.projectName, task, truths.length > 1)));
  const statedRisks = truths.flatMap(truth => truth.briefing.risksAndConflicts
    .map(item => toPMReportLanguage(item))
    .filter(Boolean)
    .map(item => `${truths.length > 1 ? `${truth.projectName}: ` : ''}${item}`));
  const criticalRisks = unique([...scheduleConcerns, ...statedRisks]).slice(0, 8);
  const dashboard = buildDashboardMetrics({
    truths,
    risks: criticalRisks.length,
    decisions: decisionsRequired.length,
    verification: 0,
  });
  const hasCriticalScheduleImpact = dashboard.controls.totalEstimatedScheduleImpactDays > 0 ||
    dashboard.scheduleHealth.overdue > 0 ||
    dashboard.scheduleHealth.blocked > 0;
  const overallCondition = conditionFor({
    truths,
    criticalDecisions: decisionsRequired.length,
    establishedRisks: criticalRisks.length,
    activeScheduleConcern:
      dashboard.scheduleHealth.overdue > 0 ||
      dashboard.scheduleHealth.dueSoon > 0 ||
      dashboard.taskStatus.waiting > 0,
    hasCriticalScheduleImpact,
  });

  return Object.freeze({
    version: DAVE_REPORT_INTELLIGENCE_VERSION,
    generatedAt,
    scopeLabel: projectNames.length > 1 ? `${projectNames.length} projects` : projectNames[0] || 'Selected project',
    overallCondition,
    conditionLabel: conditionLabel(overallCondition),
    executiveSnapshot: executiveSnapshotFor({
      scopeLabel: projectNames.length > 1 ? `${projectNames.length} projects` : projectNames[0] || 'Selected project',
      condition: overallCondition,
      dashboard,
    }),
    reportingPeriod,
    dashboard,
    projectConditions,
    recentChanges,
    milestones,
    currentWork,
    whatChanged: unique([
      ...recentChanges.map(change => change.summary),
      ...truths.flatMap(truth =>
      truth.briefing.whatChanged
        .map(item => toPMReportLanguage(item))
        .filter(Boolean)
        .map(item => `${truths.length > 1 ? `${truth.projectName}: ` : ''}${item}`),
      ),
    ]).slice(0, 8),
    schedulePosition: projectConditions.map(condition =>
      `${projectConditions.length > 1 ? `${condition.projectName}: ` : ''}${condition.schedule}`,
    ),
    criticalRisks,
    decisionsRequired,
    nextActions,
  });
}

function projectConditionFromTruth(
  truth: DAVEProjectTruth,
): DAVEReportProjectCondition {
  const accounting = buildScheduleTaskAccounting(truth.schedule);
  if (accounting.total === 0) {
    return Object.freeze({
      projectName: truth.projectName,
      currentReality: 'No schedule tasks are assigned to this project.',
      schedule: 'No current schedule dates are available.',
      percentComplete: 0,
      forecastFinish: null,
      baselineFinish: null,
      forecastVarianceDays: null,
    });
  }

  const currentParts = [
    `${accounting.complete} of ${accounting.total} tasks complete`,
    accounting.inProgress > 0 ? `${accounting.inProgress} in progress` : '',
    accounting.waiting > 0 ? `${accounting.waiting} waiting` : '',
    accounting.notStarted > 0 ? `${accounting.notStarted} not started` : '',
  ].filter(Boolean);
  const overdue = truth.schedule.filter(task =>
    !scheduleProgressIsComplete(task) && task.urgency === 'overdue',
  ).length;
  const dueSoon = truth.schedule.filter(task =>
    !scheduleProgressIsComplete(task) && task.urgency === 'due_soon',
  ).length;
  const scheduleParts = [
    overdue > 0 ? `${overdue} ${taskWord(overdue)} overdue` : '',
    dueSoon > 0 ? `${dueSoon} due within 7 days` : '',
    accounting.waiting > 0 ? `${accounting.waiting} waiting` : '',
  ].filter(Boolean);
  const totalWeight = truth.schedule.reduce(
    (total, task) => total + scheduleTaskDurationWeight({ durationDays: task.durationWeight }),
    0,
  );
  const weightedProgress = truth.schedule.reduce(
    (total, task) =>
      total + scheduleTaskDurationWeight({ durationDays: task.durationWeight }) * boundedPercent(task.percentComplete),
    0,
  );
  const forecastFinish = latestDate(truth.schedule.map(task => task.finishDate));
  const baselineFinish = latestDate(truth.schedule.map(task => task.baselineFinishDate));

  return Object.freeze({
    projectName: truth.projectName,
    currentReality: `${currentParts.join('; ')}.`,
    schedule: scheduleParts.length > 0
      ? `${scheduleParts.join('; ')}.`
      : accounting.open === 0
        ? 'All scheduled tasks are complete.'
        : `${accounting.open} open ${taskWord(accounting.open)}; none overdue or due within 7 days.`,
    percentComplete: totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0,
    forecastFinish,
    baselineFinish,
    forecastVarianceDays: dateDifferenceDays(baselineFinish, forecastFinish),
  });
}

function reportTaskFact(
  projectName: string,
  task: DAVEProjectTruth['schedule'][number],
  includeProject: boolean,
) {
  const prefix = includeProject ? `${projectName} — ` : '';
  const area = task.areaName ? ` (${task.areaName})` : '';
  const parts = [
    task.status,
    `${boundedPercent(task.percentComplete)}% complete`,
    task.finishDate ? `due ${task.finishDate}` : '',
  ].filter(Boolean);
  return `${prefix}${task.taskName}${area}: ${parts.join('; ')}.`;
}

function reportTaskConcern(
  projectName: string,
  task: DAVEProjectTruth['schedule'][number],
  includeProject: boolean,
) {
  const prefix = includeProject ? `${projectName} — ` : '';
  const area = task.areaName ? ` (${task.areaName})` : '';
  const percent = `${boundedPercent(task.percentComplete)}% complete`;
  if (task.contradiction) {
    return `${prefix}${task.taskName}${area} has conflicting status information; the schedule shows ${task.status.toLowerCase()} at ${percent}.`;
  }
  if (task.urgency === 'overdue' && task.status === 'Waiting') {
    return `${prefix}${task.taskName}${area} is overdue and waiting at ${percent}.`;
  }
  if (task.urgency === 'overdue') {
    return `${prefix}${task.taskName}${area} is overdue at ${percent}.`;
  }
  return `${prefix}${task.taskName}${area} is waiting at ${percent}.`;
}

function taskWord(count: number) {
  return count === 1 ? 'task' : 'tasks';
}

function buildDashboardMetrics({
  truths,
  risks,
  decisions,
  verification,
}: {
  truths: readonly DAVEProjectTruth[];
  risks: number;
  decisions: number;
  verification: number;
}): DAVEReportDashboardMetrics {
  const tasks = truths.flatMap(truth => truth.schedule.map(task => ({
    ...task,
    projectName: truth.projectName,
  })));
  const accounting = buildScheduleTaskAccounting(tasks);
  const overdue = tasks.filter(task => !scheduleProgressIsComplete(task) && task.urgency === 'overdue').length;
  const dueSoon = tasks.filter(task => !scheduleProgressIsComplete(task) && task.urgency === 'due_soon').length;
  const blocked = tasks.filter(task => !scheduleProgressIsComplete(task) && task.status === 'Waiting').length;
  const onTrack = tasks.filter(task =>
    !scheduleProgressIsComplete(task) &&
    task.status !== 'Waiting' &&
    task.urgency !== 'overdue' &&
    task.urgency !== 'due_soon',
  ).length;
  const areaMap = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const areaName = clean(task.areaName) || 'Unassigned area';
    const key = `${normalized(task.projectName)}|${normalized(areaName)}`;
    areaMap.set(key, [...(areaMap.get(key) || []), { ...task, areaName }]);
  }
  const workAreas = Array.from(areaMap.entries()).map(([key, areaTasks]) => {
    const totalWeight = areaTasks.reduce(
      (total, task) => total + scheduleTaskDurationWeight({ durationDays: task.durationWeight }),
      0,
    );
    const weightedProgress = areaTasks.reduce(
      (total, task) => total +
        scheduleTaskDurationWeight({ durationDays: task.durationWeight }) * boundedPercent(task.percentComplete),
      0,
    );
    const averagePercent = totalWeight > 0
      ? Math.round(weightedProgress / totalWeight)
      : 0;
    const completeTaskCount = areaTasks.filter(scheduleProgressIsComplete).length;
    return {
      id: `report-area:${key}`,
      projectName: areaTasks[0]?.projectName || 'Project',
      areaName: areaTasks[0]?.areaName || 'Unassigned area',
      taskCount: areaTasks.length,
      completeTaskCount,
      averagePercent,
      completed: completeTaskCount === areaTasks.length && areaTasks.length > 0,
      calculation: 'schedule_duration_weighted_average' as const,
    };
  }).sort((left, right) =>
    Number(left.completed) - Number(right.completed) ||
    left.averagePercent - right.averagePercent ||
    left.areaName.localeCompare(right.areaName),
  );
  const controls = Object.freeze({
    pendingApprovals: tasks.filter(task =>
      !scheduleProgressIsComplete(task) &&
      ['draft', 'pending', 'changes requested'].includes(normalized(task.approvalStatus)),
    ).length,
    responsesDue: tasks.filter(task =>
      !scheduleProgressIsComplete(task) &&
      Boolean(clean(task.responseDueDate)),
    ).length,
    unassignedOpenWork: tasks.filter(task =>
      !scheduleProgressIsComplete(task) &&
      !clean(task.assignee) &&
      !clean(task.owner),
    ).length,
    incompleteChecklistItems: tasks.reduce(
      (total, task) => total + Math.max(
        0,
        (finiteNumber(task.checklistTotal) ?? 0) -
          (finiteNumber(task.checklistComplete) ?? 0),
      ),
      0,
    ),
    scheduleImpactItems: tasks.filter(task =>
      !scheduleProgressIsComplete(task) &&
      (
        finiteNumber(task.estimatedScheduleImpactDays) !== null ||
        Boolean(clean(task.impactNotes))
      ),
    ).length,
    totalEstimatedScheduleImpactDays: tasks.reduce(
      (total, task) => total + Math.max(0, finiteNumber(task.estimatedScheduleImpactDays) ?? 0),
      0,
    ),
  });

  return Object.freeze({
    taskStatus: Object.freeze({
      total: accounting.total,
      complete: accounting.complete,
      open: accounting.open,
      inProgress: accounting.inProgress,
      notStarted: accounting.notStarted,
      waiting: accounting.waiting,
    }),
    scheduleHealth: Object.freeze({ onTrack, blocked, dueSoon, overdue }),
    attention: Object.freeze({ risks, decisions, verification }),
    controls,
    workAreas: Object.freeze(workAreas.map(item => Object.freeze(item))),
  });
}

function executiveSnapshotFor({
  scopeLabel,
  condition: _condition,
  dashboard,
}: {
  scopeLabel: string;
  condition: DAVEReportBriefing['overallCondition'];
  dashboard: DAVEReportDashboardMetrics;
}) {
  const status = dashboard.taskStatus;
  const schedule = dashboard.scheduleHealth;
  const facts = [
    status.total ? `${status.complete} of ${status.total} tasks complete` : '',
    status.open ? `${status.open} open` : '',
    status.inProgress ? `${status.inProgress} in progress` : '',
    schedule.blocked ? `${schedule.blocked} blocked` : '',
    schedule.overdue ? `${schedule.overdue} overdue` : '',
    schedule.dueSoon ? `${schedule.dueSoon} due soon` : '',
  ].filter(Boolean);
  return facts.length ? `${scopeLabel}: ${facts.join(', ')}.` : `${scopeLabel} project status.`;
}

export function enhanceDAVEReportDraft(
  draft: PIEReportDraft,
  briefing: DAVEReportBriefing,
  format: 'project_manager' | 'executive',
): PIEReportDraft {
  const title = format === 'executive'
    ? `${briefing.scopeLabel} Executive Status Report`
    : `${briefing.scopeLabel} Project Status Report`;
  return {
    ...draft,
    title,
    subject: title,
    body: formatReportBody(draft, briefing, format),
    daveBriefing: briefing,
  };
}

function formatReportBody(
  draft: PIEReportDraft,
  briefing: DAVEReportBriefing,
  format: 'project_manager' | 'executive',
) {
  const workAreaUpdates = unique(draft.locationGroups.flatMap(group =>
    group.workAreas.flatMap(area => area.bullets
      .map(bullet => toPMReportLanguage(bullet.text))
      .filter(Boolean)
      .map(bullet => `${area.projectName} — ${area.title}: ${bullet}`)),
  ));
  const projectPosition = briefing.projectConditions.map(condition => {
    const dates = [
      condition.forecastFinish ? `forecast finish ${condition.forecastFinish}` : '',
      condition.baselineFinish ? `baseline ${condition.baselineFinish}` : '',
      condition.forecastVarianceDays === null
        ? ''
        : condition.forecastVarianceDays === 0
          ? 'on baseline'
          : `${Math.abs(condition.forecastVarianceDays)} day${Math.abs(condition.forecastVarianceDays) === 1 ? '' : 's'} ${condition.forecastVarianceDays > 0 ? 'late' : 'early'}`,
    ].filter(Boolean);
    return `${condition.projectName}: ${condition.percentComplete}% complete; ${condition.schedule}` +
      `${dates.length ? ` ${dates.join('; ')}.` : ''}`;
  });
  const period = briefing.reportingPeriod;
  const reportingMovement = period.basis === 'previous_approved_report'
    ? [
        `${period.completeDelta >= 0 ? '+' : ''}${period.completeDelta} completed; ` +
          `${period.openDelta >= 0 ? '+' : ''}${period.openDelta} open; ` +
          `${period.overdueDelta >= 0 ? '+' : ''}${period.overdueDelta} overdue.`,
        ...briefing.recentChanges.slice(0, 6).map(change => change.summary),
      ]
    : ['This approval establishes the baseline for the next reporting period.'];
  const actions = (format === 'executive'
    ? briefing.nextActions.slice(0, 4)
    : briefing.nextActions)
    .map(formatReportAction);
  const milestones = (format === 'executive'
    ? briefing.milestones.slice(0, 5)
    : briefing.milestones)
    .map(milestone =>
      `${milestone.projectName} — ${milestone.taskName}: ${milestoneStateLabel(milestone.state)}` +
      `${milestone.finishDate ? `; ${milestone.finishDate}` : ''}.`,
    );
  const executiveLines = [
    draft.openingLine,
    '',
    'EXECUTIVE STATUS',
    briefing.executiveSnapshot,
    '',
    ...textSection('SINCE THE LAST APPROVED REPORT', reportingMovement),
    ...textSection('PROJECT POSITION', projectPosition),
    ...textSection('MANAGEMENT ACTIONS', actions),
    ...textSection('MILESTONES', milestones),
    ...textSection('DECISIONS REQUIRED', briefing.decisionsRequired.slice(0, 4)),
  ];
  const projectManagerLines = [
    draft.openingLine,
    '',
    'CURRENT STATUS',
    briefing.executiveSnapshot,
    '',
    ...textSection('SINCE THE LAST APPROVED REPORT', reportingMovement),
    ...textSection('CURRENT WORK', briefing.currentWork),
    ...textSection('ACTION PLAN', actions),
    ...textSection('MILESTONES', milestones),
    ...textSection('SCHEDULE RISKS', briefing.criticalRisks),
    ...textSection('WORK AREAS / PHOTO NOTES', workAreaUpdates),
  ];
  const lines = format === 'executive' ? executiveLines : projectManagerLines;
  lines.push('', draft.closingLine);
  return lines.filter((value, index, values) => value || values[index - 1]).join('\n').trim();
}

function formatReportAction(action: DAVEReportAction) {
  const context = [action.projectName, action.areaName].filter(Boolean).join(' — ');
  const due = action.dueDate ? ` Due ${action.dueDate}.` : '';
  const impact = clean(action.impact);
  return `${context}: ${action.taskName}. Issue: ${action.issue} ` +
    `${impact ? `Impact: ${impact} ` : ''}` +
    `Action: ${action.action} Owner: ${action.owner}.${due}`;
}

function milestoneStateLabel(state: DAVEReportMilestone['state']) {
  if (state === 'complete') return 'Complete';
  if (state === 'missed') return 'Missed';
  if (state === 'due_soon') return 'Due soon';
  if (state === 'upcoming') return 'Upcoming';
  return 'No date';
}

function textSection(title: string, items: readonly string[], emptyText?: string) {
  const values = items.length ? items : emptyText ? [emptyText] : [];
  if (!values.length) return [];
  return [title, ...values.map(item => `• ${item}`), ''];
}

function conditionFor({
  truths,
  criticalDecisions,
  establishedRisks,
  activeScheduleConcern,
  hasCriticalScheduleImpact,
}: {
  truths: readonly DAVEProjectTruth[];
  criticalDecisions: number;
  establishedRisks: number;
  activeScheduleConcern: boolean;
  hasCriticalScheduleImpact: boolean;
}): DAVEReportBriefing['overallCondition'] {
  if (!truths.length) return 'insufficient_evidence';
  if (hasCriticalScheduleImpact) return 'critical';
  if (criticalDecisions > 0 || establishedRisks > 0 || activeScheduleConcern) return 'attention';
  return 'stable';
}

function conditionLabel(condition: DAVEReportBriefing['overallCondition']) {
  if (condition === 'critical') return 'Immediate Attention';
  if (condition === 'attention') return 'Active Work';
  if (condition === 'stable') return 'On Track';
  return 'Current Status';
}

function reportScheduleActionRank(task: DAVEProjectTruth['schedule'][number]) {
  if (task.urgency === 'overdue') return 0;
  if (task.status === 'Waiting') return 1;
  if (task.urgency === 'due_soon') return 2;
  return 3;
}

function scheduleBackedReportAction(
  projectName: string,
  task: DAVEProjectTruth['schedule'][number],
): DAVEReportAction {
  const owner = clean(task.assignee) || clean(task.owner) ||
    clean(task.contractor) || clean(task.trade) || 'Project manager';
  const pmNextAction = clean(task.nextAction);
  const dueDate = clean(task.responseDueDate) || clean(task.finishDate) || null;
  const scheduleImpactDays = finiteNumber(task.estimatedScheduleImpactDays);
  const recordedImpact = clean(task.impactNotes);
  if (task.urgency === 'overdue') {
    const issue = `${task.taskName} is overdue at ${boundedPercent(task.percentComplete)}% complete.`;
    const impact = recordedImpact ||
      `${task.taskName} remains overdue without a recovery date or accountable next step.`;
    return Object.freeze({
      id: `report-schedule-action:${task.taskId}`,
      projectName,
      taskName: task.taskName,
      areaName: task.areaName,
      action: pmNextAction || `Set a recovery date and accountable next step for ${task.taskName}.`,
      owner,
      timing: 'Today',
      dueDate,
      issue,
      impact,
      consequence: impact,
      smallestNextAction: pmNextAction || 'Assign the recovery owner and date.',
      sourceTaskId: task.taskId,
      scheduleImpactDays,
      confidence: 'high',
    });
  }
  if (task.status === 'Waiting') {
    const issue = `${task.taskName} is waiting at ${boundedPercent(task.percentComplete)}% complete.`;
    const impact = recordedImpact ||
      `${task.taskName} cannot advance while the blocker remains open.`;
    return Object.freeze({
      id: `report-schedule-action:${task.taskId}`,
      projectName,
      taskName: task.taskName,
      areaName: task.areaName,
      action: pmNextAction || `Resolve the blocker holding ${task.taskName}.`,
      owner,
      timing: 'Today',
      dueDate,
      issue,
      impact,
      consequence: impact,
      smallestNextAction: pmNextAction || 'Name the blocker and responsible party.',
      sourceTaskId: task.taskId,
      scheduleImpactDays,
      confidence: 'high',
    });
  }
  const issue = `${task.taskName} is due within 7 days at ${boundedPercent(task.percentComplete)}% complete.`;
  const impact = recordedImpact ||
    `${task.taskName} may miss its scheduled finish without advance coordination.`;
  return Object.freeze({
    id: `report-schedule-action:${task.taskId}`,
    projectName,
    taskName: task.taskName,
    areaName: task.areaName,
    action: pmNextAction || `Prepare the crew, materials, and access for ${task.taskName}.`,
    owner,
    timing: task.finishDate ? `Before ${task.finishDate}` : 'Within 7 days',
    dueDate,
    issue,
    impact,
    consequence: impact,
    smallestNextAction: pmNextAction || 'Confirm crew, materials, and access.',
    sourceTaskId: task.taskId,
    scheduleImpactDays,
    confidence: 'high',
  });
}

function buildRecentChanges({
  truths,
  reportingPeriod,
}: {
  truths: readonly DAVEProjectTruth[];
  reportingPeriod: DAVEReportPeriodComparison;
}): DAVEReportRecentChange[] {
  const comparisonChanges = reportingPeriod.changes.map(change => Object.freeze({
    id: `report-change:${change.id}`,
    projectName: change.projectName,
    taskName: change.taskName,
    areaName: change.areaName,
    occurredAt: reportingPeriod.endedAt,
    summary: `${change.projectName}: ${change.summary}`,
    source: 'approved_report_comparison' as const,
  }));
  const reportingPeriodStart = dateValue(reportingPeriod.startedAt);
  const taskChanges: DAVEReportRecentChange[] = [];
  for (const truth of truths) {
    for (const task of truth.schedule) {
      const occurredAt = latestDate([task.latestActivityAt, task.updatedAt]);
      if (
        reportingPeriodStart !== null &&
        (dateValue(occurredAt) ?? 0) <= reportingPeriodStart
      ) continue;
      const activity = clean(task.latestActivitySummary);
      if (activity) {
        taskChanges.push(Object.freeze({
          id: `report-change:${task.taskId}:activity`,
          projectName: truth.projectName,
          taskName: task.taskName,
          areaName: task.areaName,
          occurredAt,
          summary: `${truth.projectName}: ${task.taskName} — ${toPMReportLanguage(activity) || activity}`,
          source: 'task_activity',
        }));
      } else if (occurredAt) {
        taskChanges.push(Object.freeze({
          id: `report-change:${task.taskId}:revision`,
          projectName: truth.projectName,
          taskName: task.taskName,
          areaName: task.areaName,
          occurredAt,
          summary: `${truth.projectName}: ${task.taskName} was updated.`,
          source: 'task_revision',
        }));
      }
    }
  }

  return uniqueBy(
    [...comparisonChanges, ...taskChanges]
      .sort((left, right) => (dateValue(right.occurredAt) ?? 0) - (dateValue(left.occurredAt) ?? 0)),
    change => `${normalized(change.projectName)}|${change.taskName}|${normalized(change.summary)}`,
  ).slice(0, 12);
}

function buildReportMilestones(
  truths: readonly DAVEProjectTruth[],
): DAVEReportMilestone[] {
  return truths.flatMap(truth => truth.schedule
    .filter(task => task.isMilestone || normalized(task.itemType) === 'milestone')
    .map(task => Object.freeze({
      id: `report-milestone:${task.taskId}`,
      projectName: truth.projectName,
      taskName: task.taskName,
      areaName: task.areaName,
      finishDate: clean(task.finishDate) || null,
      status: task.status,
      percentComplete: boundedPercent(task.percentComplete),
      state: (
        scheduleProgressIsComplete(task)
          ? 'complete'
          : task.urgency === 'overdue'
            ? 'missed'
            : task.urgency === 'due_soon'
              ? 'due_soon'
              : task.finishDate
                ? 'upcoming'
                : 'undated'
      ) as DAVEReportMilestone['state'],
    })))
    .sort((left, right) =>
      milestoneRank(left.state) - milestoneRank(right.state) ||
      (dateValue(left.finishDate) ?? Number.MAX_SAFE_INTEGER) -
        (dateValue(right.finishDate) ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 12);
}

function milestoneRank(state: DAVEReportMilestone['state']) {
  if (state === 'missed') return 0;
  if (state === 'due_soon') return 1;
  if (state === 'upcoming') return 2;
  if (state === 'undated') return 3;
  return 4;
}

export function buildPMReportReviewWarnings(values: readonly string[]): string[] {
  return unique(values.map(value => {
    const normalizedValue = normalized(value);
    if (!normalizedValue) return '';
    if (/no supporting|no evidence|missing supporting/.test(normalizedValue)) {
      return 'Add a current project update before sharing.';
    }
    if (/missing project|project assignment/.test(normalizedValue)) {
      return 'Assign each included item to the correct project.';
    }
    if (/owner|assigned/.test(normalizedValue)) {
      return 'Assign an owner to each report action.';
    }
    if (/work area|location|area/.test(normalizedValue)) {
      return 'Assign each included item to the correct work area.';
    }
    if (/schedule|date|impact|conflict|completion|status/.test(normalizedValue)) {
      return 'Resolve the highlighted schedule or status conflict before sharing.';
    }
    if (/photo|image/.test(normalizedValue)) {
      return 'Confirm the report includes the project photos needed for this update.';
    }
    if (/grammar|typo|wording|unclear/.test(normalizedValue)) {
      return 'Edit unclear report wording before approval.';
    }
    if (/confidence|uncertain|unknown|review|verify|validation/.test(normalizedValue)) {
      return 'Review the highlighted project detail and correct anything inaccurate.';
    }
    return 'Review the highlighted report detail before sharing.';
  }));
}

const NON_REPORTABLE_STATE =
  /\b(?:cannot|could not|insufficient|low confidence|missing|needs? (?:confirmation|verification|validation|review)|not (?:confirmed|verified)|unconfirmed|uncertain|uncertainty|unknown|unresolved|unsupported|unable to determine|verification (?:is )?required|verify before|requires? additional evidence|no (?:current|material field change|project|reliable|reportable change|schedule|supporting) evidence|no (?:active |current |material )?(?:issue|problem|risk))\b/i;

function isReportableCurrentState(value: string) {
  const text = clean(value);
  return Boolean(text) && !NON_REPORTABLE_STATE.test(text);
}

function reportableCurrentState(value: string) {
  return clean(value)
    .split(/(?<=[.!?;])\s+|,\s+(?:but|however|although)\s+/i)
    .map(clean)
    .filter(isReportableCurrentState)
    .join(' ');
}

export function toPMReportLanguage(value: string) {
  return reportableCurrentState(value)
    .replace(/correlated across multiple source types/gi, 'matched to the task')
    .replace(/source-backed/gi, 'recorded')
    .replace(/field evidence/gi, 'field update')
    .replace(/supporting evidence/gi, 'project records')
    .replace(/\bevidence\b/gi, 'project record')
    .replace(/supported conclusions?/gi, 'current status')
    .replace(/unresolved uncertainties?/gi, 'open questions')
    .replace(/\binferences?\b/gi, 'assessments')
    .replace(/\bverification\b/gi, 'review')
    .replace(/\bverify\b/gi, 'confirm')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isVerificationOnlyAction(value: string) {
  return /\b(?:confirm|validate|verification|verify)\b/i.test(value) ||
    /\breview\b.*\b(?:evidence|status|completion|confidence|claim)\b/i.test(value);
}

function truthProjectName(truths: readonly DAVEProjectTruth[], taskId: string) {
  return truths.find(truth => truth.reasoning.decisions.some(decision => decision.taskId === taskId))?.projectName || 'Project';
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function boundedPercent(value: unknown) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, numeric));
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestDate(values: readonly (string | null | undefined)[]) {
  const dates = values
    .map(value => ({ value: clean(value), timestamp: dateValue(value) }))
    .filter((entry): entry is { value: string; timestamp: number } => entry.timestamp !== null)
    .sort((left, right) => right.timestamp - left.timestamp);
  return dates[0]?.value || null;
}

function dateDifferenceDays(from: string | null, to: string | null) {
  const fromValue = dateValue(from);
  const toValue = dateValue(to);
  if (fromValue === null || toValue === null) return null;
  return Math.round((toValue - fromValue) / (24 * 60 * 60 * 1000));
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function uniqueBy<T>(values: readonly T[], keyFor: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function withoutVolatileReportSourceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileReportSourceFields);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, child]) => [key, withoutVolatileReportSourceFields(child)]),
    );
  }
  return value;
}

function canonicalizeReportSourceValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalizeReportSourceValue)
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, canonicalizeReportSourceValue(child)]),
    );
  }
  return value;
}
