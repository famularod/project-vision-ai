import type { DAVEProjectTruth } from './DAVEProjectTruth';
import type { PIEReportDraft } from './PIEReporter';
import {
  buildScheduleTaskAccounting,
  scheduleTaskDurationWeight,
} from './dave-project-schedule-rollup';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

export const DAVE_REPORT_INTELLIGENCE_VERSION = 'dave-report-intelligence/1.2' as const;
export const DAVE_REPORT_SOURCE_VERSION = 'dave-report-source/1.0' as const;

export type DAVEReportAction = Readonly<{
  id: string;
  projectName: string;
  taskName: string;
  areaName: string | null;
  action: string;
  owner: string;
  timing: string;
  consequence: string;
  smallestNextAction: string;
  confidence: 'high' | 'medium' | 'low';
}>;

export type DAVEReportProjectCondition = Readonly<{
  projectName: string;
  currentReality: string;
  schedule: string;
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
  workAreas: readonly DAVEReportWorkAreaProgress[];
}>;

export type DAVEReportBriefing = Readonly<{
  version: typeof DAVE_REPORT_INTELLIGENCE_VERSION;
  generatedAt: string;
  scopeLabel: string;
  overallCondition: 'critical' | 'attention' | 'stable' | 'insufficient_evidence';
  conditionLabel: string;
  executiveSnapshot: string;
  dashboard: DAVEReportDashboardMetrics;
  projectConditions: readonly DAVEReportProjectCondition[];
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
}: {
  truths: readonly DAVEProjectTruth[];
  selectedProjectNames?: readonly string[];
}): DAVEReportBriefing {
  const projectNames = unique(
    (selectedProjectNames?.length ? selectedProjectNames : truths.map(truth => truth.projectName))
      .map(clean)
      .filter(Boolean),
  );
  const generatedAt = truths.map(truth => truth.generatedAt).sort().at(-1) || new Date().toISOString();
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
      consequence: decision.recommendation.consequenceOfInaction,
      smallestNextAction: decision.recommendation.smallestNextAction,
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
  const overallCondition = conditionFor({
    truths,
    criticalDecisions: decisionsRequired.length,
    establishedRisks: criticalRisks.length,
    activeScheduleConcern:
      dashboard.scheduleHealth.overdue > 0 ||
      dashboard.scheduleHealth.dueSoon > 0 ||
      dashboard.taskStatus.waiting > 0,
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
    dashboard,
    projectConditions,
    currentWork,
    whatChanged: unique(truths.flatMap(truth =>
      truth.briefing.whatChanged
        .map(item => toPMReportLanguage(item))
        .filter(Boolean)
        .map(item => `${truths.length > 1 ? `${truth.projectName}: ` : ''}${item}`),
    )).slice(0, 8),
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

  return Object.freeze({
    projectName: truth.projectName,
    currentReality: `${currentParts.join('; ')}.`,
    schedule: scheduleParts.length > 0
      ? `${scheduleParts.join('; ')}.`
      : accounting.open === 0
        ? 'All scheduled tasks are complete.'
        : `${accounting.open} open ${taskWord(accounting.open)}; none overdue or due within 7 days.`,
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
  const attentionNeeded = unique([
    ...briefing.criticalRisks,
    ...briefing.decisionsRequired,
  ]).slice(0, 4);
  const workAreaUpdates = unique(draft.locationGroups.flatMap(group =>
    group.workAreas.flatMap(area => area.bullets
      .map(bullet => toPMReportLanguage(bullet.text))
      .filter(Boolean)
      .map(bullet => `${area.projectName} — ${area.title}: ${bullet}`)),
  )).slice(0, 6);
  const currentReality = unique(briefing.projectConditions
    .map(item => item.currentReality)
    .filter(Boolean));
  const lines = [
    draft.openingLine,
    '',
    'PROJECT STATUS',
    briefing.executiveSnapshot,
    '',
    ...textSection('CURRENT CONDITIONS', currentReality),
    ...textSection('ACTIVE WORK', briefing.currentWork.slice(0, 6)),
    ...textSection('RECENT CHANGES', briefing.whatChanged.slice(0, 4)),
    ...textSection('SCHEDULE ISSUES', attentionNeeded),
    ...textSection('NEXT STEPS', briefing.nextActions.slice(0, 4).map(action =>
      `${action.action} — ${action.owner}, ${action.timing}.`,
    )),
  ];
  if (format === 'project_manager' && workAreaUpdates.length) {
    lines.push(...textSection('WORK AREAS / PHOTO NOTES', workAreaUpdates));
  }
  lines.push('', draft.closingLine);
  return lines.filter((value, index, values) => value || values[index - 1]).join('\n').trim();
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
}: {
  truths: readonly DAVEProjectTruth[];
  criticalDecisions: number;
  establishedRisks: number;
  activeScheduleConcern: boolean;
}): DAVEReportBriefing['overallCondition'] {
  if (!truths.length) return 'insufficient_evidence';
  if (establishedRisks > 0) return 'critical';
  if (criticalDecisions > 0 || activeScheduleConcern) return 'attention';
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
  const owner = clean(task.owner) || 'Project manager';
  const pmNextAction = clean(task.nextAction);
  if (task.urgency === 'overdue') {
    return Object.freeze({
      id: `report-schedule-action:${task.taskId}`,
      projectName,
      taskName: task.taskName,
      areaName: task.areaName,
      action: pmNextAction || `Set a recovery date and accountable next step for ${task.taskName}.`,
      owner,
      timing: 'Today',
      consequence: `${task.taskName} remains overdue without a recovery plan.`,
      smallestNextAction: pmNextAction || 'Assign the recovery owner and date.',
      confidence: 'high',
    });
  }
  if (task.status === 'Waiting') {
    return Object.freeze({
      id: `report-schedule-action:${task.taskId}`,
      projectName,
      taskName: task.taskName,
      areaName: task.areaName,
      action: pmNextAction || `Resolve the blocker holding ${task.taskName}.`,
      owner,
      timing: 'Today',
      consequence: `${task.taskName} cannot advance while the blocker remains open.`,
      smallestNextAction: pmNextAction || 'Name the blocker and responsible party.',
      confidence: 'high',
    });
  }
  return Object.freeze({
    id: `report-schedule-action:${task.taskId}`,
    projectName,
    taskName: task.taskName,
    areaName: task.areaName,
    action: pmNextAction || `Prepare the crew, materials, and access for ${task.taskName}.`,
    owner,
    timing: task.finishDate ? `Before ${task.finishDate}` : 'Within 7 days',
    consequence: `${task.taskName} may miss its scheduled finish without advance coordination.`,
    smallestNextAction: pmNextAction || 'Confirm crew, materials, and access.',
    confidence: 'high',
  });
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
