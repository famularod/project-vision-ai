import { daveProjectTruthAsBuilt, daveProjectTruthCountsOtherUpdatesThanBefore, type DAVEProjectTruth } from './DAVEProjectTruth';
import type { PIEReportDraft } from './PIEReporter';
import {
  buildScheduleTaskAccounting,
  scheduleTaskDurationWeight,
} from './dave-project-schedule-rollup';
import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import { scheduleProgressJudgedAt } from './ScheduleProgressSource';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  rememberLegacyReportSource,
  rememberVersion2ReportSource,
  daveReportSnapshotScopeKey,
  reportPeriodWaitingForOtherDevice,
  reportTaskEarlierRows,
  reportTasksAddedByLookahead,
  reportTasksLeftByLookahead,
  type DAVEReportPeriodComparison,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

export const DAVE_REPORT_INTELLIGENCE_VERSION = 'dave-report-intelligence/2.0' as const;
/**
 * 3.0 (HIGH item 1, the owner's instruction of 13 Oct 2026, the three high
 * items): of Project Truth, what a report prints, and every record it is made
 * from; no longer what Project Truth counts from "now" and no output prints
 * (reportSourceFactsOf3, below). Then what the phone's written report prints
 * that Project Truth does not hold (writtenReportFacts).
 * 2.0 (R4 item 4a): the fingerprint no longer follows the order the tasks
 * were saved in, nor the id each device files the project under. It is still
 * worked out beside 3.0, and a report made under it is known by it for the
 * same facts (DAVEReportSnapshot, sameReportSource). 1.0 is still worked out
 * for R7's rule, and none of its names stands (R10).
 */
export const DAVE_REPORT_SOURCE_VERSION = 'dave-report-source/3.0' as const;
const DAVE_VERSION_2_REPORT_SOURCE_VERSION = 'dave-report-source/2.0' as const;
const DAVE_LEGACY_REPORT_SOURCE_VERSION = 'dave-report-source/1.0' as const;

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
  /**
   * How many changes there were in the period; `recentChanges` lists the
   * first 12, and the written report names six and counts the rest (A6 pass 8 L1).
   */
  recentChangeCount?: number;
  milestones: readonly DAVEReportMilestone[];
  completedWork: readonly string[];
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
  // HIGH item 1b: with each project's facts, the ORDER the "since the last report" lines are written in (a task's
  // saved time, of an open task, is held as that and nothing more).
  const fingerprint = `${DAVE_REPORT_SOURCE_VERSION}:${stableHash(stableStringify({
    projects: hashOfProjects(truths, truth => reportSourceFactsOf3(truth), LEFT_OUT_OF_REPORT_SOURCE_3_0),
    recentChangesOrder: recentChangesOrder(truths),
  }))}`;
  // R7 item A (the coordinator's decision on review pass 1, F0): a 1.0 fingerprint is a name of these facts only
  // where this build's report counts the same field updates as Build 230's did for the same saved data. Where it
  // counts even one that Build 230 left out, the 1.0 fingerprint is of a report without it, blind to whatever
  // happens to it: no 1.0 name stands, and a report made on Build 230 is another report.
  const countsWhatBuild230Counted = !truths.some(daveProjectTruthCountsOtherUpdatesThanBefore);
  // The 1.0 fingerprint of the same facts, so a report made under it is still known (R4 item 4a).
  // R10: no longer offered (EARLIER_VERSION_NAMES_STAND). This is the one place today's facts are given a 1.0 name.
  rememberLegacyReportSource(fingerprint, EARLIER_VERSION_NAMES_STAND && countsWhatBuild230Counted ? buildDAVELegacyReportSourceFingerprint(truths) : null);
  // HIGH item 1 (d): the 2.0 fingerprint of the same facts, so that a report approved or sent under 2.0 (Builds 231
  // and 232) is known for exactly what 2.0 itself knew it, until the next report replaces it. Its name stands
  // (unlike 1.0's): this version changes when a report is offered, not one word of it.
  rememberVersion2ReportSource(fingerprint, buildDAVEVersion2ReportSourceFingerprint(truths));
  return fingerprint;
}

/**
 * The fingerprint as version 2.0 wrote it, unchanged (Builds 231 and 232): of
 * every fact of each truth but the time it was worked out, Project Truth's own
 * summary lines and its links. A report truth's `writtenReportFacts` came with
 * 3.0 and is left out by name, so this is still 2.0 to the byte. Only to know a
 * report made under 2.0 for the same facts.
 */
export function buildDAVEVersion2ReportSourceFingerprint(
  truths: readonly DAVEProjectTruth[],
): string {
  return `${DAVE_VERSION_2_REPORT_SOURCE_VERSION}:${hashOfProjects(truths, reportSourceFactsOf, LEFT_OUT_OF_REPORT_SOURCE_2_0)}`;
}

/** Each project's facts hashed, in the order of the projects' names, and hashed together. */
function hashOfProjects(
  truths: readonly DAVEProjectTruth[],
  factsOf: (truth: DAVEProjectTruth) => unknown,
  leftOut: ReadonlySet<string>,
): string {
  const truthFingerprints = truths
    .map(truth => ({
      projectName: normalized(truth.projectName),
      fingerprint: stableHash(stableStringify(canonicalizeReportSourceValue(
        withoutVolatileReportSourceFields(factsOf(truth), leftOut),
      ))),
    }))
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
  return stableHash(stableStringify(truthFingerprints));
}

/**
 * R10 (the coordinator's decision on reports review pass 3, P3-2): NO EARLIER-VERSION NAME EVER STANDS. The 1.0
 * fingerprint says the saved FACTS are the ones the released build reported, and they are, to the byte. But the
 * words are written again by this build, which words and orders the same facts differently: at the hand-over, one
 * report in four shown as "already sent" did not read as the report that build sent, and the phone keeps no text
 * of a sent report to tell them apart. So a report approved, sent or saved under 1.0 is never taken for the report
 * on screen: every asker (sameReportSource, and what is built on it) is told "not that report", and each
 * project's current report is offered once after the update. "Since the last report" still counts from the last
 * report sent, a 1.0 one included: its saved record and send time are read as before (reportBaselineSnapshot).
 * Left in place and now without effect, to go in a later round: the 1.0 fingerprint of today's facts worked out
 * here, R7 item A's rule above, the names kept in DAVEReportSnapshot (rememberLegacyReportSource,
 * legacyReportSourcesOf, the 1.0 arm of sameReportSource), and R9's "read as an earlier version's report".
 */
const EARLIER_VERSION_NAMES_STAND: boolean = false;

/**
 * The fingerprint as version 1.0 wrote it, unchanged: of the truths as they
 * were built, in saved order, with the id each device files the project
 * under. Only to know a report made under 1.0 for the same facts.
 */
export function buildDAVELegacyReportSourceFingerprint(
  truths: readonly DAVEProjectTruth[],
): string {
  const truthFingerprints = truths
    .map(daveProjectTruthAsBuilt)
    .map(truth => ({
      projectName: normalized(truth.projectName),
      fingerprint: stableHash(stableStringify(canonicalizeReportSourceValue(
        withoutVolatileReportSourceFields(truth),
      ))),
    }))
    .sort((left, right) => left.projectName.localeCompare(right.projectName));

  return `${DAVE_LEGACY_REPORT_SOURCE_VERSION}:${stableHash(stableStringify(truthFingerprints))}`;
}

/**
 * What version 2.0 hashes of a truth (R4 item 4a): every fact, without
 *  - `briefing`, Project Truth's own summary lines. They are written from
 *    the facts hashed beside them, and take "the first" of each list;
 *  - `entityLinks`, the links from each record to the project, its tasks
 *    and the work areas saved on the device. They too are worked out from
 *    the facts hashed beside them, and from the phone's saved work areas,
 *    which the web does not download: with them in, a project with GPS work
 *    areas never had the same fingerprint on the phone and on the web; and
 *  - the id the truth is filed under, wherever an id carries it
 *    ("timeline:<project id>:…"). The phone files a report's truth under
 *    "report:<name>" and the web under the cloud project's id, so the two
 *    never agreed on the fingerprint of the same facts.
 */
function reportSourceFactsOf(truth: DAVEProjectTruth): unknown {
  const { briefing: _briefing, entityLinks: _entityLinks, ...facts } = truth as DAVEProjectTruth & Record<string, unknown>;
  return withoutReportProjectId(truth, facts);
}

/**
 * What version 3.0 hashes of a truth (HIGH item 1, the owner's instruction of
 * 13 Oct 2026; reports review pass 3, P3-4): every record the report is made
 * from, and of what Project Truth works out from them, exactly what a report
 * prints. Version 2.0 held all of Project Truth, and much of it is counted
 * from "now" and printed by no output: its own reading of the project (the
 * `intelligence`: "3 in the last 14 days", "Updated recently", its evidence
 * score, its state and confidence, the attention and uncertainty items of its
 * daily brief), its reasoning about each task (a recommendation's timing, a
 * challenge, a connection, the smallest next action) and the verification
 * list made from that. So the report sent yesterday was offered again on most
 * mornings, some of them with no word of it changed. Here, as 2.0:
 *  - the records: the evidence ledger (every field update, photo, GPS fix,
 *    photo analysis, task, document and memory), the photo comparisons, the
 *    correlations, the tasks' earlier rows, the lookahead facts, the drawings
 *    cited, and the facts of each schedule document (Project Truth keeps them
 *    in its intelligence: `referenceDocuments`, R7 item C);
 *  - the tasks as the report has them, but for one distinction no output
 *    prints: a task due in 8 to 21 days is "upcoming", and one due later
 *    "not urgent" (the report reads only "overdue" and "due within 7 days");
 * and, in place of the rest, what the report prints of it:
 *  - the decisions the report lists, each as printed: task, area, action,
 *    owner, timing, consequence (`listedDecision`, the briefing's own rule);
 *  - Project Truth's own risk lines and "what changed" lines, as printed.
 * What the clock moves AND a report prints stays (a task now overdue or due
 * within 7 days, "Today", a risk line): a report that reads differently is
 * another report.
 */
function reportSourceFactsOf3(truth: DAVEProjectTruth): unknown {
  const {
    briefing, entityLinks: _entityLinks, intelligence, reasoning, verificationQueue: _verificationQueue, schedule, evidence, correlations, ...facts
  } = truth as DAVEProjectTruth & Record<string, unknown>;
  // HIGH item 1b (open item 7.46; the coordinator's decision): a record saved again with nothing a report prints
  // changed moves nothing. Of a task: who last saved its settings (never printed); its saved time and the moment its
  // percent was confirmed, for a task not complete (printed for a completed task only, in Completed Work's "Last
  // updated" and its order; for any task the saved time decides only the order of the "since the last report" lines,
  // held once for the report, recentChangesOrder). Of a schedule file: its notes (never printed).
  const open = new Set((schedule ?? []).filter(task => !scheduleProgressIsComplete(task)).map(task => task.taskId));
  const recordAsPrinted = (record: DAVEProjectTruth['evidence']['records'][number]) => {
    if (record.kind === 'schedule' && open.has(record.taskId ?? '')) {
      const { capturedAt: _confirmedAt, ...kept } = record;
      return kept;
    }
    if (record.kind === 'document') {
      const { equipmentKeys: _wordsOfItsNameAndNotes, ...kept } = record;
      return kept;
    }
    return record;
  };
  // (A truth made by hand, as some tests make one, may lack a part: it is read as empty.)
  return withoutReportProjectId(truth, {
    ...facts,
    schedule: (schedule ?? []).map(task => {
      const { updatedBy: _savedBy, updatedAt, ...kept } = task;
      return {
        ...kept,
        ...(open.has(task.taskId) ? {} : { updatedAt }),
        urgency: task.urgency === 'upcoming' ? 'not_urgent' as const : task.urgency,
      };
    }),
    evidence: evidence
      ? { ...evidence, records: (evidence.records ?? []).map(recordAsPrinted), unresolvedRecords: (evidence.unresolvedRecords ?? []).map(recordAsPrinted) }
      : evidence,
    correlations: correlations
      ? {
          ...correlations,
          tasks: (correlations.tasks ?? []).map(correlation => (open.has(correlation.taskId)
            ? {
                ...correlation,
                evidence: correlation.evidence.map(claim => {
                  if (claim.id !== `correlation:schedule:${correlation.taskId}`) return claim;
                  const { recordedAt: _confirmedOrSavedAt, ...kept } = claim;
                  return kept;
                }),
              }
            : correlation)),
        }
      : correlations,
    referenceDocuments: (intelligence?.referenceDocuments ?? []).map(document => {
      const { notes: _notes, ...kept } = document as ReferenceDocument;
      return kept;
    }),
    listedDecisions: uniqueBy([...(reasoning?.criticalDecisions ?? []), ...(reasoning?.decisions ?? [])], decision => decision.taskId)
      .filter(listedDecision)
      .map(decision => ({
        taskId: decision.taskId,
        taskName: decision.taskName,
        areaName: decision.areaName,
        action: decision.recommendation.action,
        owner: decision.recommendation.owner,
        timing: decision.recommendation.timing,
        consequence: decision.recommendation.consequenceOfInaction,
      })),
    printedProjectTruthLines: {
      risks: (briefing?.risksAndConflicts ?? []).map(item => toPMReportLanguage(item)).filter(Boolean),
      whatChanged: (briefing?.whatChanged ?? []).map(item => toPMReportLanguage(item)).filter(Boolean),
    },
  });
}

/**
 * HIGH item 1b: the order of the "since the last report" lines, as buildRecentChanges writes them: every task of the
 * report by its latest activity or saved time, newest first (projects by name where two are of one moment, then the
 * report's own task order). The saved time of a task not complete is in version 3.0 as this order and nothing more:
 * saved again later with nothing changed, it moves nothing a report prints, unless it moves the task in this order.
 */
function recentChangesOrder(truths: readonly DAVEProjectTruth[]): string[] {
  return truths
    .flatMap(truth => (truth.schedule ?? []).map((task, index) => ({
      project: normalized(truth.projectName),
      index,
      key: `${normalized(truth.projectName)}|${task.taskId}`,
      at: dateValue(latestDate([task.latestActivityAt, task.updatedAt])) ?? 0,
    })))
    .sort((left, right) => right.at - left.at || left.project.localeCompare(right.project) || left.index - right.index)
    .map(entry => entry.key);
}

/** `facts` without the id the truth is filed under, wherever an id carries it (see reportSourceFactsOf). */
function withoutReportProjectId(truth: DAVEProjectTruth, facts: Record<string, unknown>): unknown {
  const projectId = typeof truth.projectId === 'string' ? truth.projectId : '';
  if (!projectId) return facts;
  // As written, and as an id inside an id carries it: encoded once, twice ("report%253Aalpha") or three times.
  const once = encodeURIComponent(projectId);
  const twice = encodeURIComponent(once);
  const forms = [encodeURIComponent(twice), twice, once, projectId].filter((form, index, all) => all.indexOf(form) === index);
  const withoutProjectId = (text: string) => forms.reduce((value, form) => value.split(form).join(REPORT_SOURCE_PROJECT_ID), text);
  const isIdKey = (key: string) => key === 'id' || /Ids?$/.test(key);
  const walk = (value: unknown, inId: boolean): unknown => {
    if (typeof value === 'string') return inId ? withoutProjectId(value) : value;
    if (Array.isArray(value)) return value.map(item => walk(item, inId));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, walk(child, isIdKey(key))]));
    }
    return value;
  };
  return walk(facts, false);
}
const REPORT_SOURCE_PROJECT_ID = '<project>';

export function buildDAVEReportBriefing({
  truths,
  selectedProjectNames,
  previousSnapshot,
  readAsEarlierVersionReport = false,
  waitingForOtherDevice = false,
  scheduleItems,
}: {
  truths: readonly DAVEProjectTruth[];
  selectedProjectNames?: readonly string[];
  previousSnapshot?: DAVEReportSnapshot | null;
  /**
   * This report is read as the saved report an earlier version made
   * (`reportReadAsEarlierVersionReport`, asked where `previousSnapshot` is
   * chosen): no live earlier row is read for a task that is back (R9).
   */
  readAsEarlierVersionReport?: boolean;
  /**
   * The report this one counts from was sent by the other device after this
   * device last downloaded the tasks: "since the last report" is not counted
   * until it has them (whole-app audit A6 pass 10 M1, M2).
   */
  waitingForOtherDevice?: boolean;
  /**
   * The saved tasks the truths were made from, read only for when each
   * task's progress was confirmed (whole-app audit A6 pass 14 L4): Project
   * Truth keeps no such time, and a field added there would move the
   * report's fingerprint. Without them, Completed Work's dates read as
   * before.
   */
  scheduleItems?: readonly Pick<ScheduleItem, 'id' | 'progressConfirmedAt' | 'progressJudgment' | 'fileProgressPeak'>[];
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
  const comparison = compareDAVEReportSnapshots({
    current: currentSnapshot,
    previous: previousSnapshot,
    // The detail tasks a replaced lookahead took with it are not said (owner answer 3 Oct 2026).
    tasksLeftByLookahead: reportTasksLeftByLookahead(truths),
    // How a task that is back last stood, and which tasks began as a lookahead's own row (R5 item 1).
    earlierRows: reportTaskEarlierRows(truths),
    lookaheadAddedTaskIds: reportTasksAddedByLookahead(truths),
    currentReadAsEarlierVersionReport: readAsEarlierVersionReport,
  });
  const reportingPeriod = waitingForOtherDevice ? reportPeriodWaitingForOtherDevice(comparison) : comparison;
  const projectConditions = truths.map(projectConditionFromTruth);
  const criticalDecisions = truths.flatMap(truth => truth.reasoning.criticalDecisions);
  const actionDecisions = uniqueBy([
    ...criticalDecisions,
    ...truths.flatMap(truth => truth.reasoning.decisions),
  ], decision => `${truthProjectName(truths, decision.taskId)}|${decision.taskId}`);
  const reportableActionDecisions = actionDecisions.filter(listedDecision);
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
  // Nothing is said to have changed in a period not counted yet (A6 pass 10 M1, M2).
  const allRecentChanges = reportingPeriod.waitingForOtherDevice ? [] : buildRecentChanges({ truths, reportingPeriod });
  const recentChanges = allRecentChanges.slice(0, 12);
  // The period's own list stops at 20; the ones it left out still count.
  // Counted after the de-duplication above, so the report's "And N more
  // changes." is the lines it did not show (A6 pass 9 M1).
  const recentChangeCount = allRecentChanges.length +
    Math.max(0, (reportingPeriod.changeCount ?? 0) - reportingPeriod.changes.length);
  const milestones = buildReportMilestones(truths);
  const lastUpdatedAt = completedTaskLastUpdatedAt(scheduleItems);
  const completedTasks = truths.flatMap(truth => truth.schedule
    .filter(scheduleProgressIsComplete)
    .sort((left, right) => reportCompletedTaskRank(left, lastUpdatedAt) - reportCompletedTaskRank(right, lastUpdatedAt))
    .map(task => ({ truth, task, line: clean(reportCompletedTaskFact(truth.projectName, task, truths.length > 1, lastUpdatedAt)) })));
  // Two different tasks on one line say how many (A6 pass 19 L4); the same task twice says it once.
  const tasksOnLine = new Map<string, Set<string>>();
  completedTasks.forEach(({ task, line }) => tasksOnLine.set(line, new Set([...(tasksOnLine.get(line) || []), task.taskId])));
  const completedWork = unique(completedTasks.map(({ truth, task, line }) =>
    reportCompletedTaskFact(truth.projectName, task, truths.length > 1, lastUpdatedAt, tasksOnLine.get(line)!.size)),
  ).slice(0, 12);
  // Whole-app audit A6 pass 20 L1 (1 Oct 2026): two same-named open tasks in one area with the same status,
  // percent and due date printed one Current Work line. They say how many, as Completed Work does (A6 pass 19 L4).
  const currentTasks = truths.flatMap(truth => truth.schedule
    .filter(task => !scheduleProgressIsComplete(task))
    .sort((left, right) => reportScheduleActionRank(left) - reportScheduleActionRank(right))
    .map(task => ({ truth, task, line: clean(reportTaskFact(truth.projectName, task, truths.length > 1)) })));
  const tasksOnCurrentLine = new Map<string, Set<string>>();
  currentTasks.forEach(({ task, line }) => tasksOnCurrentLine.set(line, new Set([...(tasksOnCurrentLine.get(line) || []), task.taskId])));
  const currentWork = unique(currentTasks.map(({ truth, task, line }) =>
    reportTaskFact(truth.projectName, task, truths.length > 1, tasksOnCurrentLine.get(line)!.size)),
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
    recentChangeCount,
    milestones,
    completedWork,
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

/**
 * Whether the report lists a decision of Project Truth's reasoning (its action plan, its decisions required): one
 * rule for the briefing and for version 3.0 of the fingerprint, which holds what is listed and nothing else of it.
 */
function listedDecision(decision: DAVEProjectTruth['reasoning']['decisions'][number]): boolean {
  return decision.confidence !== 'low' &&
    isReportableCurrentState(decision.recommendation.action) &&
    !isVerificationOnlyAction(decision.recommendation.action);
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
  // The master sets the scope: a lookahead's detail tasks leave % Complete alone (owner answer Q25).
  const scope = tasksSettingScope(truth.schedule);
  const totalWeight = scope.reduce(
    (total, task) => total + scheduleTaskDurationWeight({ durationDays: task.durationWeight }),
    0,
  );
  const weightedProgress = scope.reduce(
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
  /** How many different tasks read this same line (A6 pass 20 L1): "(2 tasks)". */
  tasks = 1,
) {
  const prefix = includeProject ? `${projectName} — ` : '';
  const area = task.areaName ? ` (${task.areaName})` : '';
  const parts = [
    task.status,
    `${boundedPercent(task.percentComplete)}% complete`,
    task.finishDate ? `due ${task.finishDate}` : '',
  ].filter(Boolean);
  return `${prefix}${task.taskName}${area}: ${parts.join('; ')}${tasks > 1 ? ` (${tasks} tasks)` : ''}.`;
}

type CompletedTaskLastUpdatedAt = (task: DAVEProjectTruth['schedule'][number]) => string | null;

/**
 * When a completed task was last updated, as Completed Work says it and
 * orders by it (whole-app audit A6 pass 14 L4, 1 Oct 2026): its latest
 * activity or its progress confirmation, whichever is later; the row's
 * update time only when it has neither. "Delete PDF + Items" stamps the
 * tasks it writes removed ids onto (rows sync by that time), and a completed
 * one read "Last updated Sep 29, 2026." instead of "Sep 26" with nothing
 * changed, and moved to the top of the list (the executive report shows the
 * first 6). The confirmation is when the manager judged the percent
 * (scheduleProgressJudgedAt), read from the saved tasks; with none given,
 * the activity or the update time, whichever is later, as before.
 *
 * R5 item 3 (open item, small): a master schedule that states 100% for a
 * task an import owns, with no percent of his on it, completes the task and
 * records no confirmation time (the percent stands as the file's). With a
 * note on the task from weeks before, Completed Work read "Last updated
 * <the note's date>" for a task completed since. The day that master was
 * approved counts as the confirmation does: the saved task keeps the highest
 * percent a master's file has stated on its row that stood, and when
 * (fileProgressPeak, Build 231). A task a master completed on an earlier
 * build has no such record and reads as before.
 */
function completedTaskLastUpdatedAt(
  scheduleItems: readonly Pick<ScheduleItem, 'id' | 'progressConfirmedAt' | 'progressJudgment' | 'fileProgressPeak'>[] | undefined,
): CompletedTaskLastUpdatedAt {
  if (!scheduleItems) return task => latestDate([task.latestActivityAt, task.updatedAt]);
  const confirmedAt = new Map(scheduleItems.map(item => [item.id, latestDate([scheduleProgressJudgedAt(item), completedByMasterAt(item)])]));
  return task => latestDate([task.latestActivityAt, confirmedAt.get(task.taskId)]) || latestDate([task.updatedAt]);
}

/** When a master schedule's file completed the task on its row, if one did and that percent stood; else null. */
function completedByMasterAt(item: Pick<ScheduleItem, 'fileProgressPeak'>): string | null {
  const peak = item.fileProgressPeak;
  return peak && boundedPercent(peak.percentComplete) >= 100 && typeof peak.statedAt === 'string' ? peak.statedAt : null;
}

function reportCompletedTaskFact(
  projectName: string,
  task: DAVEProjectTruth['schedule'][number],
  includeProject: boolean,
  lastUpdatedAt: CompletedTaskLastUpdatedAt,
  /** How many different tasks read this same line (A6 pass 19 L4): "(2 tasks)". */
  tasks = 1,
) {
  const prefix = includeProject ? `${projectName} — ` : '';
  const area = task.areaName ? ` (${task.areaName})` : '';
  const latestChange = lastUpdatedAt(task);
  const lastUpdated = latestChange
    ? ` Last updated ${formatReportDate(latestChange)}.`
    : '';
  return `${prefix}${task.taskName}${area}: Complete; 100% complete${tasks > 1 ? ` (${tasks} tasks)` : ''}.${lastUpdated}`;
}

function reportCompletedTaskRank(task: DAVEProjectTruth['schedule'][number], lastUpdatedAt: CompletedTaskLastUpdatedAt) {
  const timestamp = dateValue(latestDate([
    lastUpdatedAt(task),
    task.finishDate,
  ]));
  return timestamp === null ? Number.MAX_SAFE_INTEGER : -timestamp;
}

/**
 * The day of `value`, written out ("Oct 1, 2026").
 *
 * R7 item D (the coordinator's decision on review pass 1, F4): a moment (a
 * date with a time of day: when a note was typed, a percent confirmed, a
 * master schedule approved, a task last saved) is written as the day it was
 * on this device. It was written as its day in UTC, so a task completed at
 * 6:30 in the evening Pacific time read "Last updated" the next day. A date
 * with no time is written exactly as before: it names a calendar day, which
 * no time zone moves.
 */
function formatReportDate(value: string) {
  const timestamp = dateValue(value);
  if (timestamp === null) return value;
  const isMoment = /\d{1,2}:\d{2}/.test(value);
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(isMoment ? {} : { timeZone: 'UTC' }),
  });
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

/** The tasks that set a % Complete: all but a lookahead's detail, unless that is every task (owner answer Q25). */
function tasksSettingScope<T extends { lookaheadDetail?: true }>(tasks: readonly T[]): readonly T[] {
  const scope = tasks.filter(task => task.lookaheadDetail !== true);
  return scope.length > 0 ? scope : tasks;
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
    const scope = tasksSettingScope(areaTasks); // owner answer Q25
    const totalWeight = scope.reduce(
      (total, task) => total + scheduleTaskDurationWeight({ durationDays: task.durationWeight }),
      0,
    );
    const weightedProgress = scope.reduce(
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
      .map(reportBulletText)
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
  const reportingMovement = reportPeriodMovementLines(briefing) ?? [REPORT_FIRST_PERIOD_LINE];
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
    ...textSection(REPORT_PERIOD_HEADING, reportingMovement),
    ...textSection('COMPLETED WORK', briefing.completedWork.slice(0, 6), 'No completed work is recorded in the current project scope.'),
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
    ...textSection(REPORT_PERIOD_HEADING, reportingMovement),
    ...textSection('COMPLETED WORK', briefing.completedWork, 'No completed work is recorded in the current project scope.'),
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

/**
 * The written report's "since the last report" heading, in every report the
 * phone writes (the body copied, emailed, texted, shared in Outlook and put in
 * the Word file). Owner answer 2 Oct (report heading): it said "SINCE THE LAST
 * APPROVED REPORT", where the period runs from the last report sent.
 */
export const REPORT_PERIOD_HEADING = 'SINCE THE LAST REPORT';

/**
 * What a first report says under that heading, on the screen and in the
 * written report. Review N1 (3 Oct 2026): it read "This approval establishes
 * the baseline for the next reporting period.", and an approval does not: the
 * period runs from the last report SENT, and an approval never sent starts
 * none (whole-app audit A6 pass 2). It is the send that establishes it.
 */
export const REPORT_FIRST_PERIOD_LINE = 'Sending this report establishes the baseline for the next reporting period.';

/** The changes the written report names; the rest are counted (A6 pass 8 L1). */
const SINCE_LINES = 6;

/**
 * The written report's "since the last report" lines: the counts and the
 * changes it names, or the line saying they are not counted yet while this
 * device waits for the other device's changes (A6 pass 10 M1, M2). Null with
 * no earlier report to count from. Everyday item 3 (2 Oct 2026): the web
 * Reports page writes the same lines as the phone.
 */
export function reportPeriodMovementLines(briefing: DAVEReportBriefing): string[] | null {
  const period = briefing.reportingPeriod;
  if (period.waitingForOtherDevice) return [REPORT_PERIOD_WAITING_LINE];
  if (period.basis !== 'previous_approved_report') return null;
  return [
    `${period.completeDelta >= 0 ? '+' : ''}${period.completeDelta} completed; ` +
      `${period.openDelta >= 0 ? '+' : ''}${period.openDelta} open; ` +
      `${period.overdueDelta >= 0 ? '+' : ''}${period.overdueDelta} overdue.`,
    ...briefing.recentChanges.slice(0, SINCE_LINES).map(change => change.summary),
    ...moreChangesLine(Math.max(briefing.recentChangeCount ?? 0, briefing.recentChanges.length) - SINCE_LINES),
  ];
}

/** "Since the last report" while this device waits for the other device's changes (A6 pass 10 M1, M2). */
export const REPORT_PERIOD_WAITING_LINE =
  "Not counted yet: this device hasn't received your other device's latest changes.";

function moreChangesLine(more: number): string[] {
  return more > 0 ? [`And ${more} more change${more === 1 ? '' : 's'}.`] : [];
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
  // The task each line is about, for lines two tasks share (A6 pass 19 L4).
  const taskIdOf = new Map<DAVEReportRecentChange, string>();
  const comparisonChanges = reportingPeriod.changes.map(change => {
    const line: DAVEReportRecentChange = Object.freeze({
      id: `report-change:${change.id}`,
      projectName: change.projectName,
      taskName: change.taskName,
      areaName: change.areaName,
      occurredAt: reportingPeriod.endedAt,
      summary: `${change.projectName}: ${change.summary}`,
      source: 'approved_report_comparison' as const,
    });
    taskIdOf.set(line, change.taskId);
    return line;
  });
  const reportingPeriodStart = dateValue(reportingPeriod.startedAt);
  // Whole-app audit A6 pass 9 M1 (30 Sep 2026): a task the comparison
  // already reports gets no "was updated." line as well. A revised task is a
  // new row made at the import, so each one read "Frame walls was updated."
  // next to its finish change, and "And N more changes." counted both (8
  // moved: "And 10 more changes." with 2 left).
  const comparedTaskIds = new Set(
    reportingPeriod.changedTaskIds ?? reportingPeriod.changes.map(change => change.taskId),
  );
  // Whole-app audit A6 pass 13 M1 (1 Oct 2026): nor a task that says what
  // it said in the earlier report. "Delete PDF + Items" stamps the tasks it
  // writes removed ids onto (rows sync by that time), and each one read
  // "Pour slab was updated." with nothing changed. A report saved before the
  // content keys lists none here, and counts as before.
  const unchangedTaskIds = new Set(reportingPeriod.unchangedTaskIds ?? []);
  // Whole-app audit A6 pass 14 L2 (1 Oct 2026): a task whose latest activity
  // is not the one the earlier report saved says it, whatever its time (a
  // note made offline on the iPad before the phone's send, received after);
  // one whose activity the earlier report saved does not say it again. Only
  // against a report saved before these keys does the activity's time decide,
  // and (A6 pass 15 L1) for a task paired with a different row of the earlier
  // report across a master change that the report before it does not settle
  // (A6 pass 16 L1): the comparison lists neither. An activity no newer than
  // the one the row saved counts as the same (A6 pass 15 L2).
  const newActivityTaskIds = new Set(reportingPeriod.newActivityTaskIds ?? []);
  const sameActivityTaskIds = new Set(reportingPeriod.sameActivityTaskIds ?? []);
  const taskChanges: DAVEReportRecentChange[] = [];
  for (const truth of truths) {
    for (const task of truth.schedule) {
      const occurredAt = latestDate([task.latestActivityAt, task.updatedAt]);
      const newActivity = newActivityTaskIds.has(task.taskId) ? clean(task.latestActivitySummary) : '';
      if (
        !newActivity &&
        reportingPeriodStart !== null &&
        (dateValue(occurredAt) ?? 0) <= reportingPeriodStart
      ) continue;
      // A6 pass 13: an activity from before the earlier report was said
      // there; a later stamp (a delete writing ids) does not repeat it. Since
      // A6 pass 14 L2 the activity keys decide this, and the time only
      // against a report saved before them.
      const activity = newActivity || (
        reportingPeriodStart === null || (
          !sameActivityTaskIds.has(task.taskId) &&
          (dateValue(task.latestActivityAt) ?? 0) > reportingPeriodStart
        )
          ? clean(task.latestActivitySummary)
          : ''
      );
      if (activity) {
        const line: DAVEReportRecentChange = Object.freeze({
          id: `report-change:${task.taskId}:activity`,
          projectName: truth.projectName,
          taskName: task.taskName,
          areaName: task.areaName,
          occurredAt,
          summary: `${truth.projectName}: ${task.taskName} — ${toPMReportLanguage(activity) || activity}`,
          source: 'task_activity',
        });
        taskIdOf.set(line, task.taskId);
        taskChanges.push(line);
      } else if (occurredAt && !comparedTaskIds.has(task.taskId) && !unchangedTaskIds.has(task.taskId)) {
        const line: DAVEReportRecentChange = Object.freeze({
          id: `report-change:${task.taskId}:revision`,
          projectName: truth.projectName,
          taskName: task.taskName,
          areaName: task.areaName,
          occurredAt,
          summary: `${truth.projectName}: ${task.taskName} was updated.`,
          source: 'task_revision',
        });
        taskIdOf.set(line, task.taskId);
        taskChanges.push(line);
      }
    }
  }

  return sameLineOfSameNamedTasks(
    [...comparisonChanges, ...taskChanges]
      .sort((left, right) => (dateValue(right.occurredAt) ?? 0) - (dateValue(left.occurredAt) ?? 0)),
    taskIdOf,
  );
}

/**
 * Lines once each (whole-app audit A6 pass 9 M1), and the same line of two
 * different same-named tasks told apart (whole-app audit A6 pass 19 L4, 1 Oct
 * 2026). Lines were kept once by name and text, so Pour slab in Lot and Pour
 * slab in Deck, both completed, read "+2 completed" with one "Pour slab was
 * completed." The same task reached twice still says it once. Different tasks
 * in different areas name the area ("Pour slab (Deck) was completed.", and
 * "Pour slab (unassigned area) was completed." for the one with none); in
 * one area they say it once with the count ("Pour slab was completed (2
 * tasks).").
 */
function sameLineOfSameNamedTasks(
  changes: readonly DAVEReportRecentChange[],
  taskIdOf: ReadonlyMap<DAVEReportRecentChange, string>,
): DAVEReportRecentChange[] {
  const lineKey = (change: DAVEReportRecentChange) => `${normalized(change.projectName)}|${change.taskName}|${normalized(change.summary)}`;
  const areaKey = (change: DAVEReportRecentChange) => normalized(change.areaName);
  const perTask = uniqueBy(changes, change => `${lineKey(change)}|${taskIdOf.get(change) ?? change.id}`);
  const tasksOn = new Map<string, DAVEReportRecentChange[]>();
  perTask.forEach(change => tasksOn.set(lineKey(change), [...(tasksOn.get(lineKey(change)) || []), change]));
  const areasNamed = (change: DAVEReportRecentChange) => new Set(tasksOn.get(lineKey(change))!.map(areaKey)).size > 1;
  return uniqueBy(perTask, change => (areasNamed(change) ? `${lineKey(change)}|${areaKey(change)}` : lineKey(change)))
    .map(change => {
      const tasks = tasksOn.get(lineKey(change))!;
      if (tasks.length === 1) return change;
      // Open item (A6 pass 24, wording): beside "Pour slab (Deck) was completed.", the same-named task with no area
      // read "Pour slab was completed.", as a line about Pour slab as a whole. It says it has no area, in the
      // words the report already uses for one ("moved from Lot to unassigned area").
      const area = areasNamed(change) ? ` (${clean(change.areaName) || 'unassigned area'})` : '';
      const inArea = tasks.filter(other => areaKey(other) === areaKey(change)).length;
      const prefix = `${change.projectName}: ${change.taskName}`;
      if (!change.summary.startsWith(prefix)) return change;
      const rest = change.summary.slice(prefix.length);
      const counted = inArea < 2 ? rest : rest.endsWith('.') ? `${rest.slice(0, -1)} (${inArea} tasks).` : `${rest} (${inArea} tasks)`;
      return Object.freeze({ ...change, summary: `${prefix}${area}${counted}` });
    });
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
  if (!text) return false;
  // A safety statement is never dropped for its wording: "An unresolved
  // safety concern is recorded" was filtered out of SCHEDULE RISKS
  // (whole-app audit A6, 29 Sep 2026).
  if (/\bsafety\b/i.test(text)) return true;
  return !NON_REPORTABLE_STATE.test(text);
}

/**
 * A work-area bullet as the report prints it: as written, minus Project
 * Walk drafting headers. Bullets carry the manager's own captions and
 * notes and short engine lines that never need the report-language filter
 * (whole-app audit A6, 29-30 Sep 2026: the filter had deleted the manager's
 * sentences containing "missing", "cannot", "could not", "unknown",
 * "unresolved" or "insufficient", "Guardrail missing at stair 2 landing."
 * left nothing, and rewrote their words; no bullet kind is engine review
 * text).
 */
export function reportBulletText(bullet: Readonly<{ text: string; kind?: string }>): string {
  return stripProjectWalkBoilerplate(bullet.text).replace(/\s{2,}/g, ' ').trim();
}

function reportableCurrentState(value: string) {
  return clean(value)
    .split(/(?<=[.!?;])\s+|,\s+(?:but|however|although)\s+/i)
    .map(clean)
    .filter(isReportableCurrentState)
    .join(' ');
}

export function toPMReportLanguage(value: string) {
  return reportableCurrentState(stripProjectWalkBoilerplate(value))
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

const PROJECT_WALK_FIELD_LABELS =
  'Person or company|Commitment|Due date|Decision|Owner request|Inspection change|Schedule change|Issue|Risk|Follow-up|General note|Field note';

/** A Project Walk update stores drafting headers in its notes; a report reader only needs the note itself. */
export function stripProjectWalkBoilerplate(value: string) {
  if (!/Project Walk draft/i.test(value)) return value;
  return value
    .replace(/Project Walk draft\s*[—–-]\s*review before sending\s*/gi, '')
    .replace(/Prepared from \d+ confirmed field memor(?:y|ies)\.\s*/gi, '')
    .replace(new RegExp(`Confirmed area:\\s*[\\s\\S]*?(?=\\bArea:)`, 'gi'), '')
    .replace(new RegExp(`\\bArea:\\s*[\\s\\S]*?(?=\\b(?:${PROJECT_WALK_FIELD_LABELS}):)`, 'gi'), '')
    .replace(/\b(?:General note|Field note):\s*/gi, '')
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

/**
 * Left out of the report's fingerprint: when the truth was generated, and the
 * ids a task had before new masters moved it (whole-app audit A6 pass 12 L1,
 * 30 Sep 2026). Those say which task a revised row is, not what the report
 * says about it, so an approval given, or a send made on the other device,
 * before the truth carried them is still the same content. So too the tasks
 * David said a row is not (review N1 M3, 3 Oct 2026): which earlier task it
 * is compared with, not what it says.
 */
const VOLATILE_REPORT_SOURCE_FIELDS = new Set([
  'generatedAt', 'earlierTaskIds', 'notTaskIds',
  // Owner answer 3 Oct 2026 (report wording after a lookahead is replaced): where a task's dates come from and
  // which detail tasks left with a lookahead. The dates and the tasks shown are in the fingerprint themselves.
  'onLookaheadDates', 'replacedLookaheadDates', 'lookaheadReplacement',
  // R5 item 1 (the returning task): the earlier rows of the tasks shown, and which tasks' own rows a lookahead
  // added.
  'earlierRows', 'lookaheadAddedTaskIds',
  // (All of the above are left out of version 1.0 so that it stays the released build's. Version 2.0 leaves out
  // only `generatedAt`: R8 items 3 and 4, below.)
]);

/**
 * R8 items 3 and 4 (the coordinator's decisions on review pass 2): what
 * version 2.0 of the fingerprint leaves out, by name: only the time the
 * truth was worked out (and, since 3.0, the written report's facts, which no
 * truth had under 2.0: so 2.0 is what Builds 231 and 232 wrote). Version 1.0
 * leaves out the whole list above, as the released build did, and must go on
 * doing so.
 *
 * The rule (the guard: r8-report-fingerprint-moves-whenever-the-report-does):
 * whenever a change to what the report is made from moves the written report,
 * or what is saved with an approval, version 2.0 moves. So it holds what the
 * list above keeps out of 1.0:
 *  - `earlierRows` (item 3, P2-3): "Paint is back in the project plan." is
 *    followed by what changed since the task last stood ("moved from 60% to
 *    70%"), read from the row it left on. That row was in neither version,
 *    so a late edit to it from another device changed the sentence ("from
 *    50%") while the app still called it the report already sent;
 *  - `earlierTaskIds` and `notTaskIds`: which earlier report's task a task is
 *    compared with, and saved with every approved report;
 *  - `onLookaheadDates`, `replacedLookaheadDates`, `lookaheadReplacement`,
 *    `lookaheadAddedTaskIds`: what the report says, and does not say, after
 *    a lookahead is replaced, and of a task a lookahead had added.
 * Each is worked out from the saved tasks and schedules alone, the same on
 * the phone and on the web.
 */
const LEFT_OUT_OF_REPORT_SOURCE_2_0: ReadonlySet<string> = new Set(['generatedAt', 'writtenReportFacts']);
/** What version 3.0 leaves out by name (HIGH item 1); what it leaves out of Project Truth is in reportSourceFactsOf3. */
const LEFT_OUT_OF_REPORT_SOURCE_3_0: ReadonlySet<string> = new Set(['generatedAt']);

function withoutVolatileReportSourceFields(value: unknown, leftOut: ReadonlySet<string> = VOLATILE_REPORT_SOURCE_FIELDS): unknown {
  if (Array.isArray(value)) return value.map(item => withoutVolatileReportSourceFields(item, leftOut));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !leftOut.has(key))
        .map(([key, child]) => [key, withoutVolatileReportSourceFields(child, leftOut)]),
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
