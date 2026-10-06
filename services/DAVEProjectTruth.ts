import type {
  DAVECompletionVerificationStatus,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  scheduleDocumentAddsToMaster,
  scheduleDocumentRetiredForProject,
  scheduleHasAuthoritativeProgressJudgment,
  scheduleLookaheadReplacedFor,
} from './PIEScheduleReconciliation';
import { photoGpsOrUpdate } from './DraftPhotoGps';
import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import {
  buildProjectIntelligence,
  type DAVEProjectIntelligence,
} from './DAVEIntelligence';
import type { DAVEDailyBriefDocument } from './DAVEDailyBrief';
import type { PIECoreOutput } from './PIECoreIntelligence';
import type { PIERuntimeState } from './PIERuntime';
import {
  canonicalizeDAVEScheduleItems,
} from './DAVEIdentity';
import {
  buildDAVEEvidenceCorrelations,
  type DAVEEvidenceCorrelationResult,
  type DAVETaskEvidenceCorrelation,
} from './DAVEEvidenceCorrelation';
import {
  buildDAVEProjectReasoning,
  type DAVEProjectReasoning,
} from './DAVEProjectReasoning';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import { scheduleProgressJudgedAt } from './ScheduleProgressSource';
import { scheduleTaskEarlierIds, scheduleTaskLinks } from './ScheduleTaskRevisions';
import { scheduleItemImportBatchIds, scheduleTaskAddedByLookaheadsOnly } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay } from './ScheduleCalendarDay';
import { photoDisplayResultCanInformProject } from './PhotoAssessment';
import {
  DEFAULT_PROJECT_TIME_ZONE,
  projectDateRelativeDays,
  type ProjectTimeZone,
} from './ProjectDateTime';
import { scheduleTaskDurationWeight } from './dave-project-schedule-rollup';

export const DAVE_PROJECT_TRUTH_VERSION = 'dave-project-truth/1.0' as const;

export type DAVEEvidenceDisposition =
  | 'connected'
  | 'unresolved'
  | 'duplicate'
  | 'rejected';

export type DAVEEvidenceKind =
  | 'update'
  | 'photo'
  | 'gps'
  | 'schedule'
  | 'document'
  | 'memory'
  | 'photo-comparison';

export type DAVEEvidenceLedgerRecord = {
  id: string;
  kind: DAVEEvidenceKind;
  sourceRecordId: string;
  projectName: string | null;
  areaName: string | null;
  taskId: string | null;
  equipmentKeys: string[];
  capturedAt: string | null;
  summary: string;
  disposition: DAVEEvidenceDisposition;
  dispositionReason: string;
  confidence: 'high' | 'medium' | 'low';
};

export type DAVEEvidenceAccounting = {
  total: number;
  connected: number;
  unresolved: number;
  duplicate: number;
  rejected: number;
  records: DAVEEvidenceLedgerRecord[];
  unresolvedRecords: DAVEEvidenceLedgerRecord[];
  coveragePercent: number;
};

export type DAVEEntityLink = {
  id: string;
  sourceEvidenceId: string;
  targetType: 'project' | 'area' | 'schedule-task' | 'equipment';
  targetId: string;
  targetLabel: string;
  confidence: 'high' | 'medium' | 'low';
  basis: string;
  needsVerification: boolean;
};

export type DAVEPhotoComparisonTruth = {
  photoId: string;
  updateId: string;
  areaName: string | null;
  taskId: string | null;
  observation: string;
  changeFromPrior: string | null;
  progressClaim: 'supported' | 'unsupported' | 'unable_to_determine';
  comparablePriorAvailable: boolean;
  limitations: string[];
  evidenceClass: 'observation' | 'interpretation' | 'uncertainty';
  needsVerification: boolean;
};

export type DAVEScheduleTruth = {
  taskId: string;
  /**
   * The ids this task had before new masters moved its dates, oldest first
   * (revisedFromTaskIds, as the import recorded them; ScheduleTaskRevisions).
   * Absent when there are none. Whole-app audit A6 pass 12 L1 (30 Sep 2026):
   * "since the last report" pairs a revised task with the earlier report's
   * task by these, as field updates do, before any guess by name.
   */
  earlierTaskIds?: string[];
  /**
   * The saved tasks David said at import review this task is not (owner
   * answer Q30: a same-named row he called a new task; notRevisionOfTaskIds).
   * Absent when there are none. Review N1 M3 (3 Oct 2026): "since the last
   * report" never pairs it by name with an earlier report's task.
   */
  notTaskIds?: string[];
  /**
   * Owner answer 3 Oct 2026 (report wording after a lookahead is replaced):
   * true while the task is on the dates a lookahead gave it. Absent
   * otherwise. Left out of the report's fingerprint.
   */
  onLookaheadDates?: true;
  /**
   * The dates the replaced lookahead gave this task, while it is shown on the
   * master schedule's dates again because a newer lookahead no longer lists
   * it (owner answer Q25; the shown copy's savedLookaheadDates). The report
   * says "finish is back to the master schedule's …", never "finish changed".
   * Absent otherwise. Left out of the report's fingerprint.
   */
  replacedLookaheadDates?: { startDate: string; finishDate: string };
  taskName: string;
  itemType: ScheduleItem['itemType'];
  areaName: string | null;
  owner: string | null;
  assignee: string | null;
  contractor: string | null;
  trade: string | null;
  nextAction: string | null;
  status: ScheduleItem['status'];
  percentComplete: number;
  durationWeight: number;
  startDate: string | null;
  finishDate: string | null;
  baselineStartDate: string | null;
  baselineFinishDate: string | null;
  isMilestone: boolean;
  predecessorTaskIds: string[];
  approvalStatus: string | null;
  workflowStage: string | null;
  responseDueDate: string | null;
  referenceNumber: string | null;
  checklistTotal: number;
  checklistComplete: number;
  estimatedScheduleImpactDays: number | null;
  impactConfidence: string | null;
  impactNotes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  latestActivityAt: string | null;
  latestActivitySummary: string | null;
  urgency: 'overdue' | 'due_soon' | 'upcoming' | 'not_urgent';
  /**
   * A lookahead's detail task (one it added that no master lists): listed,
   * but not part of the project's % Complete, which the master's scope sets
   * (owner answer Q25, 2 Oct 2026). Absent otherwise.
   */
  lookaheadDetail?: true;
  completionState:
    | 'scheduled'
    | 'reported_complete'
    | 'evidence_supported'
    | 'pm_verified'
    | 'rejected'
    | 'conflicting_evidence';
  relatedEvidenceIds: string[];
  needsVerification: boolean;
  contradiction: string | null;
};

export type DAVEVerificationRequest = {
  id: string;
  subjectType: 'evidence' | 'photo' | 'schedule-task' | 'conflict';
  subjectId: string;
  title: string;
  reason: string;
  requestedAction: string;
  priority: 'high' | 'medium' | 'low';
};

export type DAVEPMBriefing = {
  headline: string;
  currentReality: string;
  whatChanged: string[];
  schedule: string;
  commitments: string[];
  risksAndConflicts: string[];
  verificationNeeded: string[];
  nextActions: string[];
  evidenceCoverage: string;
  confidence: 'high' | 'medium' | 'low';
};

export type DAVEProjectTruth = {
  schemaVersion: typeof DAVE_PROJECT_TRUTH_VERSION;
  projectId: string;
  projectName: string;
  generatedAt: string;
  intelligence: DAVEProjectIntelligence;
  evidence: DAVEEvidenceAccounting;
  entityLinks: DAVEEntityLink[];
  photoComparisons: DAVEPhotoComparisonTruth[];
  correlations: DAVEEvidenceCorrelationResult;
  reasoning: DAVEProjectReasoning;
  schedule: DAVEScheduleTruth[];
  /**
   * Only on a truth built for a report (`reportLookaheadReplacement`), from
   * every saved task: what a newer lookahead replaced (owner answer 3 Oct
   * 2026). Left out of the report's fingerprint.
   */
  lookaheadReplacement?: DAVELookaheadReplacementTruth;
  verificationQueue: DAVEVerificationRequest[];
  briefing: DAVEPMBriefing;
};

/**
 * Owner answer 3 Oct 2026 (report wording after a lookahead is replaced):
 * "Don't mention them". The detail tasks only a replaced lookahead listed
 * leave the task list when a newer lookahead replaces it (owner answer Q25),
 * and the report said each "was removed from the current project plan" and
 * counted "-1 completed" for one that was done. The report needs to know
 * which saved tasks left that way, and how each stands, to say nothing of
 * them except a completion made since the last report.
 */
export type DAVELookaheadReplacementTruth = {
  /** The lookaheads (by import) replaced for this project. */
  replaced: string[];
  /** The saved detail tasks not shown because every lookahead that listed them was replaced. */
  tasksLeft: DAVETaskLeftByLookahead[];
};

export type DAVETaskLeftByLookahead = {
  taskId: string;
  earlierTaskIds?: string[];
  taskName: string;
  areaName: string | null;
  status: string;
  percentComplete: number;
  /** The newest lookahead (by import) that listed it. */
  lookahead: string;
};

export type BuildDAVEProjectTruthInput = {
  projectId: string;
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  /** Every saved task, hidden ones included: the name fallback checks the update's own schedule (A10 pass 6 L2). */
  knownScheduleItems?: readonly ScheduleItem[];
  /**
   * A truth for a report: with every saved task (`knownScheduleItems`) it
   * also says which detail tasks left because a newer lookahead replaced
   * theirs (owner answer 3 Oct 2026). Not asked for elsewhere: the saved
   * Project Truth does not carry it.
   */
  reportLookaheadReplacement?: boolean;
  /**
   * Every saved schedule, as the shown task list was worked out from them
   * (`referenceDocuments` may be this project's only, renamed to it): which
   * lookahead a newer one replaced is read from these when given.
   */
  knownScheduleDocuments?: readonly ReferenceDocument[];
  projectAreas?: ProjectArea[];
  referenceDocuments?: ReferenceDocument[];
  projectDocuments?: DAVEDailyBriefDocument[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  runtime?: PIERuntimeState | null;
  core?: PIECoreOutput | null;
  now?: string;
  projectTimeZone?: ProjectTimeZone | string;
};

export function buildDAVEProjectTruth(input: BuildDAVEProjectTruthInput): DAVEProjectTruth {
  const generatedAt = validDate(input.now) || input.runtime?.generatedAt || new Date().toISOString();
  const projectKey = normalizedKey(input.projectName);
  const updates = input.updates.filter(update => projectMatches(projectKey, update.projectName));
  const canonicalScheduleItems = canonicalizeDAVEScheduleItems(input.scheduleItems, {
    projectNames: Array.from(new Set([
      input.projectName,
      ...input.scheduleItems.flatMap(item => [item.scheduleProjectName || '', item.projectName]),
    ].filter(Boolean))),
    projectAreas: input.projectAreas || [],
  }).items;
  const scheduleItems = canonicalScheduleItems.filter(item => scheduleMatchesProject(projectKey, item));
  const projectTimeZone = input.projectTimeZone ||
    scheduleItems.find(item => item.projectTimeZone)?.projectTimeZone ||
    DEFAULT_PROJECT_TIME_ZONE;
  const scopedUpdateIds = new Set(updates.map(update => update.id));
  const captureMemories = (input.captureMemories ?? []).filter(memory =>
    projectMatches(projectKey, memory.recommendedProject.value),
  );
  const projectDocuments = (input.projectDocuments ?? []).filter(document =>
    !document.isArchived && (
      document.projectId === input.projectId ||
      (!document.projectId && Boolean(document.updateId && scopedUpdateIds.has(document.updateId)))
    ),
  );
  const scheduleSources = new Set(
    scheduleItems.map(item => normalizedKey(item.importedFrom || '')).filter(Boolean),
  );
  // A lookahead is in effect by its role (Q22) while it is the newest for the project (owner answer Q25).
  const lookaheadReplaced = scheduleLookaheadReplacedFor(input.referenceDocuments ?? []);
  const inEffect = (document: ReferenceDocument) => scheduleDocumentAddsToMaster(document)
    ? !lookaheadReplaced(document, input.projectName)
    : document.isCurrent;
  const referenceDocuments = (input.referenceDocuments ?? []).filter(document => {
    // Report artifacts are derived outputs. They must not participate in the
    // current-truth fingerprint that governs their own freshness.
    if (normalizedKey(document.category) === 'report') return false;
    if (!inEffect(document)) return false;
    // A combined schedule retired for this project is current only for its others (owner answer Q15).
    if (scheduleDocumentRetiredForProject(document, input.projectName)) return false;
    const explicitProjectId = clean(document.projectId);
    const explicitProjectName = clean(document.projectName);
    const explicitProjectNames = (document.projectNames ?? []).map(clean).filter(Boolean);
    if (explicitProjectId || explicitProjectName || explicitProjectNames.length > 0) {
      return explicitProjectId === input.projectId ||
        projectMatches(projectKey, explicitProjectName) ||
        explicitProjectNames.some(name => projectMatches(projectKey, name));
    }
    return [document.originalFileName, document.name]
      .map(value => normalizedKey(value || ''))
      .filter(Boolean)
      .some(source => scheduleSources.has(source));
  });
  const intelligence = buildProjectIntelligence({
    projectId: input.projectId,
    projectName: input.projectName,
    updates,
    documents: [
      ...projectDocuments,
      ...referenceDocuments.map(document => ({
        id: document.id,
        projectId: input.projectId,
        name: document.name,
        category: document.category,
        status: 'reference',
        createdAt: document.importedAt,
        importedAt: document.importedAt,
        isArchived: !inEffect(document),
      })),
    ],
    scheduleItems,
    captureMemories,
    referenceDocuments: referenceDocuments.map(document => ({
      ...document,
      projectId: document.projectId || input.projectId,
      projectName: document.projectName || input.projectName,
    })),
    now: generatedAt,
    projectTimeZone,
  });
  const records = buildEvidenceLedger({
    ...input,
    updates,
    scheduleItems,
    captureMemories,
    projectDocuments,
    referenceDocuments,
  });
  const entityLinks = buildEntityLinks(input.projectName, records, scheduleItems, input.projectAreas ?? []);
  const photoComparisons = buildPhotoComparisons(updates, entityLinks);
  const correlations = buildDAVEEvidenceCorrelations({
    scheduleItems,
    knownScheduleItems: input.knownScheduleItems,
    updates,
    now: generatedAt,
  });
  const reasoning = buildDAVEProjectReasoning({
    projectId: input.projectId,
    projectName: input.projectName,
    scheduleItems,
    updates,
    correlations,
    now: generatedAt,
    projectTimeZone,
  });
  const schedule = buildScheduleTruth(
    scheduleItems,
    records,
    entityLinks,
    correlations,
    generatedAt,
    projectTimeZone,
    input.knownScheduleItems,
  );
  const lookaheadReplacement = input.reportLookaheadReplacement && input.knownScheduleItems
    ? tasksLeftByLookaheadReplacement(input, projectKey, scheduleItems)
    : null;
  const evidence = summarizeEvidence(records);
  const verificationQueue = buildVerificationQueue(evidence, photoComparisons, schedule, reasoning);
  const briefing = buildPMBriefing({
    projectName: input.projectName,
    intelligence,
    evidence,
    photoComparisons,
    correlations,
    reasoning,
    schedule,
    verificationQueue,
    runtime: input.runtime,
    core: input.core,
  });

  return deepFreeze({
    schemaVersion: DAVE_PROJECT_TRUTH_VERSION,
    projectId: input.projectId,
    projectName: input.projectName,
    generatedAt,
    intelligence,
    evidence,
    entityLinks,
    photoComparisons,
    correlations,
    reasoning,
    schedule,
    ...(lookaheadReplacement ? { lookaheadReplacement } : {}),
    verificationQueue,
    briefing,
  });
}

/** A stable-order view's truth as it was built (R4 item 4a); kept beside the view, never inside it. */
const truthAsBuilt = new WeakMap<DAVEProjectTruth, DAVEProjectTruth>();

/** A task date as a number, read the same way on every device ("10/08/2026", "2026-10-08…"); unreadable or blank: null. */
function stableDateValue(value: string | null | undefined): number | null {
  const text = (value || '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : null;
}
const plainOrder = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The tasks in an order that does not depend on the order they were saved in:
 * by finish date, then start date (a task with no date last), then name,
 * area and id. Compared by code unit, never by locale, so the phone and the
 * web put them in the same order.
 */
function scheduleTruthInStableOrder(schedule: readonly DAVEScheduleTruth[]): DAVEScheduleTruth[] {
  const key = (task: DAVEScheduleTruth) => [
    stableDateValue(task.finishDate) ?? Number.MAX_SAFE_INTEGER,
    stableDateValue((task as { startDate?: string | null }).startDate) ?? Number.MAX_SAFE_INTEGER,
  ] as const;
  return [...schedule].sort((left, right) => {
    const [leftFinish, leftStart] = key(left);
    const [rightFinish, rightStart] = key(right);
    return leftFinish - rightFinish || leftStart - rightStart ||
      plainOrder(left.taskName, right.taskName) || plainOrder(left.areaName || '', right.areaName || '') || plainOrder(left.taskId, right.taskId);
  });
}

/**
 * The truth a report is written from, with nothing in it left in the order
 * the tasks happened to be saved in (R4 item 4a, the owner's open item "task
 * save order can reorder Current Work lines"). The app saves tasks in the
 * order a sync leaves them. Project Truth kept that order in its lists, and
 * its own summary lines took "the first" of them ("The schedule state for
 * <the first saved task> is not corroborated ...", the first five risks), so
 * a sync that only reordered the rows changed the written report and its
 * fingerprint, and Reports offered a fresh report for the same facts.
 *
 * The lists are put in a stable order and the summary lines and the
 * verification queue written again from them, by the same code. Nothing is
 * added or dropped. The truth as built (as the build before built it,
 * `asBuiltBefore`) is kept beside the view (`daveProjectTruthAsBuilt`) for
 * the earlier fingerprint version only.
 * For a report's truth (built without a runtime or core), as the report
 * recipe builds it.
 */
export function daveProjectTruthInStableOrder(
  truth: DAVEProjectTruth,
  /** The same project's truth as the build before scoped its updates, where that differs (for the 1.0 fingerprint). */
  asBuiltBefore: DAVEProjectTruth = truth,
): DAVEProjectTruth {
  if (truthAsBuilt.has(truth)) return truth;
  const schedule = scheduleTruthInStableOrder(truth.schedule);
  const place = new Map(schedule.map((task, index) => [task.taskId, index]));
  const byTask = <T extends { taskId: string }>(items: readonly T[]): T[] => [...items].sort((left, right) =>
    (place.get(left.taskId) ?? Number.MAX_SAFE_INTEGER) - (place.get(right.taskId) ?? Number.MAX_SAFE_INTEGER) || plainOrder(left.taskId, right.taskId));
  const byText = <T,>(items: readonly T[]): T[] => items.map(item => ({ item, text: JSON.stringify(item) }))
    .sort((left, right) => plainOrder(left.text, right.text)).map(entry => entry.item);
  const reasoning = { ...truth.reasoning, decisions: byTask(truth.reasoning.decisions), criticalDecisions: byTask(truth.reasoning.criticalDecisions) };
  const correlations = { ...truth.correlations, tasks: byTask(truth.correlations.tasks) };
  const photoComparisons = byText(truth.photoComparisons);
  const byId = <T extends { id: string }>(items: readonly T[]): T[] => [...items].sort((left, right) => plainOrder(left.id, right.id));
  const evidence = { ...truth.evidence, records: byId(truth.evidence.records), unresolvedRecords: byId(truth.evidence.unresolvedRecords) };
  const verificationQueue = buildVerificationQueue(evidence, photoComparisons, schedule, reasoning);
  const stable = deepFreeze({
    ...truth,
    evidence,
    photoComparisons,
    correlations,
    reasoning,
    schedule,
    verificationQueue,
    briefing: buildPMBriefing({
      projectName: truth.projectName,
      intelligence: truth.intelligence,
      evidence,
      photoComparisons,
      correlations,
      reasoning,
      schedule,
      verificationQueue,
    }),
  }) as DAVEProjectTruth;
  truthAsBuilt.set(stable, asBuiltBefore);
  return stable;
}

/** The truth as the build before built it, for a stable-order view; any other truth is its own. */
export function daveProjectTruthAsBuilt(truth: DAVEProjectTruth): DAVEProjectTruth {
  return truthAsBuilt.get(truth) ?? truth;
}

/**
 * The saved detail tasks of this project that are not shown because every
 * lookahead that listed them was replaced by a newer one (owner answer Q25),
 * and the lookaheads replaced for it (owner answer 3 Oct 2026). A task a
 * lookahead added (importedAsLookahead) is its detail; a task some schedule
 * in effect still lists, or whose lookahead was deleted rather than
 * replaced, is not one of these. Read from the saved tasks and schedules as
 * the shown list is, with nothing written.
 */
function tasksLeftByLookaheadReplacement(
  input: BuildDAVEProjectTruthInput,
  projectKey: string,
  shown: readonly ScheduleItem[],
): DAVELookaheadReplacementTruth {
  const documents = input.knownScheduleDocuments ?? input.referenceDocuments ?? [];
  const lookaheads = documents.filter(scheduleDocumentAddsToMaster);
  const replacedFor = scheduleLookaheadReplacedFor(documents);
  const idKey = (value: unknown) => (clean(typeof value === 'string' ? value : '') || '').toLowerCase();
  const keyOf = (document: ReferenceDocument) => idKey(document.importBatchId) || idKey(document.id);
  const replaced = lookaheads.filter(document => replacedFor(document, input.projectName));
  // A lookahead is only ever replaced by a newer one.
  if (lookaheads.length < 2) return { replaced: [], tasksLeft: [] };
  const shownIds = new Set(shown.flatMap(item => [item.id.trim(), ...scheduleTaskEarlierIds(item)]));
  const candidates = (input.knownScheduleItems ?? []).filter(item =>
    item.importedAsLookahead === true && !shownIds.has(item.id.trim()));
  // The task's own project decides, as when the shown list is worked out (PIEScheduleReconciliation).
  const leftWith = new Map<string, ReferenceDocument>();
  candidates.forEach(item => {
    const batches = scheduleItemImportBatchIds(item).map(idKey);
    const source = idKey(item.sourceDocumentId);
    const holding = documents.filter(document =>
      (Boolean(source) && idKey(document.id) === source) ||
      (Boolean(idKey(document.importBatchId)) && batches.includes(idKey(document.importBatchId))));
    const project = item.projectName || item.scheduleProjectName || '';
    // Every schedule that lists it is a lookahead replaced for its project: nothing else took it off the list.
    if (holding.length === 0 || !holding.every(document => scheduleDocumentAddsToMaster(document) && replacedFor(document, project))) return;
    leftWith.set(item.id, [...holding].sort((left, right) => (clean(right.importedAt) || '').localeCompare(clean(left.importedAt) || ''))[0]);
  });
  const left = candidates.filter(item => leftWith.has(item.id));
  const ofProject = left.length === 0 ? [] : canonicalizeDAVEScheduleItems([...left], {
    projectNames: Array.from(new Set([
      input.projectName,
      ...left.flatMap(item => [item.scheduleProjectName || '', item.projectName]),
    ].filter(Boolean))),
    projectAreas: input.projectAreas || [],
  }).items.filter(item => scheduleMatchesProject(projectKey, item));
  const tasksLeft = ofProject.map((item): DAVETaskLeftByLookahead => {
    const earlierTaskIds = scheduleTaskEarlierIds(item);
    return {
      taskId: item.id,
      ...(earlierTaskIds.length > 0 ? { earlierTaskIds } : {}),
      taskName: item.taskName,
      areaName: clean(item.locationName),
      status: item.status,
      percentComplete: item.percentComplete,
      lookahead: keyOf(leftWith.get(item.id)!),
    };
  });
  return {
    replaced: uniqueText([...replaced.map(keyOf), ...tasksLeft.map(task => task.lookahead)]).sort(),
    tasksLeft,
  };
}

function buildEvidenceLedger(
  input: BuildDAVEProjectTruthInput & {
    updates: ProjectUpdate[];
    scheduleItems: ScheduleItem[];
    captureMemories: readonly DAVEConfirmedCaptureMemory[];
    projectDocuments: DAVEDailyBriefDocument[];
    referenceDocuments: ReferenceDocument[];
  },
): DAVEEvidenceLedgerRecord[] {
  const records: DAVEEvidenceLedgerRecord[] = [];
  // The task an update's task id answers to now: a new master saves a moved task under a new id (A10 pass 5 M1).
  const linkOf = scheduleTaskLinks(input.scheduleItems, input.knownScheduleItems);
  for (const update of input.updates) {
    const areaName = clean(update.selectedAreaName);
    const taskId = linkOf(update)?.item.id || clean(update.scheduleItemId);
    records.push(record({
      id: `update:${update.id}`,
      kind: 'update',
      sourceRecordId: update.id,
      projectName: update.projectName,
      areaName,
      taskId,
      text: update.notes,
      capturedAt: update.date,
      summary: clean(update.notes) || `Field update with ${update.photos.length} photo${update.photos.length === 1 ? '' : 's'}.`,
      connected: Boolean(areaName || update.scheduleItemId || update.notes.trim() || update.photos.length),
      reason: areaName || update.scheduleItemId
        ? 'Connected by confirmed project, area, or schedule context.'
        : 'Project is known, but no area or task relationship is recorded.',
    }));
    for (const photo of update.photos) {
      records.push(photoRecord(update, photo, taskId));
      const gps = photoGpsOrUpdate(photo, update);
      if (gps.gpsLatitude !== null && gps.gpsLongitude !== null) {
        records.push(record({
          id: `gps:${photo.id}`,
          kind: 'gps',
          sourceRecordId: photo.id,
          projectName: update.projectName,
          areaName: clean(photo.selectedAreaName) || areaName,
          taskId,
          text: `${gps.gpsLatitude},${gps.gpsLongitude}`,
          capturedAt: photo.locationCapturedAt || update.locationCapturedAt || update.date,
          summary: `GPS evidence captured${clean(photo.selectedAreaName) || areaName ? ` for ${clean(photo.selectedAreaName) || areaName}` : ''}.`,
          connected: Boolean(clean(photo.selectedAreaName) || areaName),
          reason: clean(photo.selectedAreaName) || areaName
            ? 'GPS is connected to a confirmed area.'
            : 'GPS exists, but it is not connected to a confirmed project area.',
        }));
      }
      const photoIntelligence = photo.photoIntelligence;
      if (photoIntelligence && photoDisplayResultCanInformProject(photoIntelligence)) {
        records.push(record({
          id: `photo-comparison:${photo.id}`,
          kind: 'photo-comparison',
          sourceRecordId: photo.id,
          projectName: update.projectName,
          areaName: clean(photo.selectedAreaName) || areaName,
          taskId,
          text: photoIntelligenceText(photo),
          capturedAt: photoIntelligence.updatedAt,
          summary: photoIntelligence.visibleChange || photoIntelligence.currentObservation || photoIntelligence.summary,
          connected: Boolean(clean(photo.selectedAreaName) || areaName),
          reason: clean(photo.selectedAreaName) || areaName
            ? 'Photo analysis is connected to project and area evidence.'
            : 'Photo analysis is missing a confirmed area relationship.',
        }));
      }
    }
  }
  for (const item of input.scheduleItems) {
    const pmProgressJudgment = scheduleHasAuthoritativeProgressJudgment(item);
    records.push(record({
      id: `schedule:${item.id}`,
      kind: 'schedule',
      sourceRecordId: item.id,
      projectName: input.projectName,
      areaName: clean(item.locationName),
      taskId: item.id,
      text: `${item.taskName} ${item.milestone} ${item.notes} ${item.owner} ${item.contractor}`,
      // Dated when the manager judged it, not when a delete gave it back (A10 pass 5 L1).
      capturedAt: scheduleProgressJudgedAt(item) || item.importedAt || item.createdAt,
      summary: `${item.taskName}: ${item.status}, ${item.percentComplete}% complete${item.finishDate ? `, due ${item.finishDate}` : ''}${pmProgressJudgment ? ' — project manager judgment.' : '.'}`,
      connected: Boolean(item.taskName.trim()),
      reason: item.taskName.trim()
        ? pmProgressJudgment
          ? 'The project manager progress judgment is direct project evidence.'
          : 'Schedule activity is connected to the project.'
        : 'Schedule activity has no usable task name.',
    }));
  }
  for (const document of input.projectDocuments) {
    records.push(record({
      id: `document:${document.id}`,
      kind: 'document',
      sourceRecordId: document.id,
      projectName: input.projectName,
      areaName: null,
      taskId: null,
      text: `${document.name} ${document.category}`,
      capturedAt: document.updatedAt || document.createdAt,
      summary: `${document.category}: ${document.name}.`,
      connected: true,
      reason: 'Document is assigned to the project.',
    }));
  }
  for (const document of input.referenceDocuments) {
    records.push(record({
      id: `document:${document.id}`,
      kind: 'document',
      sourceRecordId: document.id,
      projectName: input.projectName,
      areaName: null,
      taskId: null,
      text: `${document.name} ${document.originalFileName} ${document.category} ${document.notes}`,
      capturedAt: document.importedAt,
      summary: `${document.category}: ${document.name}.`,
      connected: true,
      reason: 'Current reference document is available to project intelligence.',
    }));
  }
  for (const memory of input.captureMemories) {
    records.push(record({
      id: `memory:${memory.id}`,
      kind: 'memory',
      sourceRecordId: memory.id,
      projectName: memory.recommendedProject.value,
      areaName: memory.recommendedLocation.value,
      taskId: null,
      text: [memory.transcript, ...Object.values(memory.fields)].filter(Boolean).join(' '),
      capturedAt: memory.confirmedAt,
      summary: memorySummary(memory),
      connected: memory.recommendedProject.confirmed,
      reason: memory.recommendedProject.confirmed
        ? 'PM-confirmed memory is connected to the project.'
        : 'Memory project relationship is not confirmed.',
    }));
  }
  return markDuplicates(records);
}

function photoRecord(update: ProjectUpdate, photo: UpdatePhoto, taskId: string | null): DAVEEvidenceLedgerRecord {
  const areaName = clean(photo.selectedAreaName) || clean(update.selectedAreaName);
  return record({
    id: `photo:${photo.id}`,
    kind: 'photo',
    sourceRecordId: photo.id,
    projectName: update.projectName,
    areaName,
    taskId,
    text: `${photo.caption} ${photo.actionRequired} ${photoIntelligenceText(photo)}`,
    capturedAt: photo.locationCapturedAt || update.date,
    summary: clean(photo.caption) || clean(photo.photoIntelligence?.currentObservation) || 'Field photo.',
    connected: Boolean(areaName || update.scheduleItemId),
    reason: areaName || update.scheduleItemId
      ? 'Photo is connected to an area or schedule activity.'
      : 'Photo is stored with the project, but has no confirmed area or task relationship.',
  });
}

function record(input: {
  id: string;
  kind: DAVEEvidenceKind;
  sourceRecordId: string;
  projectName: string | null;
  areaName: string | null;
  taskId: string | null;
  text: string;
  capturedAt: string | null;
  summary: string;
  connected: boolean;
  reason: string;
}): DAVEEvidenceLedgerRecord {
  return {
    id: input.id,
    kind: input.kind,
    sourceRecordId: input.sourceRecordId,
    projectName: clean(input.projectName),
    areaName: clean(input.areaName),
    taskId: clean(input.taskId),
    equipmentKeys: extractEntityKeys(input.text),
    capturedAt: clean(input.capturedAt),
    summary: clean(input.summary) || 'Evidence record.',
    disposition: input.connected ? 'connected' : 'unresolved',
    dispositionReason: input.reason,
    confidence: input.connected
      ? input.areaName || input.taskId ? 'high' : 'medium'
      : 'low',
  };
}

function markDuplicates(records: DAVEEvidenceLedgerRecord[]) {
  const seen = new Set<string>();
  return records.map(item => {
    const key = `${item.kind}:${normalizedKey(item.summary)}:${item.capturedAt || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      return item;
    }
    return {
      ...item,
      disposition: 'duplicate' as const,
      dispositionReason: 'The same evidence content and capture time already exist.',
      confidence: 'high' as const,
    };
  });
}

function buildEntityLinks(
  projectName: string,
  records: DAVEEvidenceLedgerRecord[],
  scheduleItems: ScheduleItem[],
  projectAreas: ProjectArea[],
): DAVEEntityLink[] {
  const links: DAVEEntityLink[] = [];
  for (const evidence of records) {
    if (evidence.disposition === 'rejected' || evidence.disposition === 'duplicate') continue;
    links.push(link(evidence, 'project', normalizedKey(projectName), projectName, 'high', 'Confirmed project scope.'));
    const area = bestNamedMatch(
      [evidence.areaName, evidence.summary],
      projectAreas.map(item => ({ id: item.id, label: item.name })),
    );
    if (area) {
      links.push(link(evidence, 'area', area.id, area.label, area.confidence, area.basis));
    }
    const task = evidence.taskId
      ? scheduleItems.find(item => item.id === evidence.taskId)
      : bestNamedMatch(
          [evidence.summary, ...evidence.equipmentKeys],
          scheduleItems.map(item => ({ id: item.id, label: `${item.taskName} ${item.locationName}` })),
        );
    if (task) {
      const resolved = 'taskName' in task
        ? { id: task.id, label: task.taskName, confidence: 'high' as const, basis: 'Stored schedule task identifier.' }
        : task;
      links.push(link(evidence, 'schedule-task', resolved.id, resolved.label, resolved.confidence, resolved.basis));
    }
    for (const key of evidence.equipmentKeys) {
      links.push(link(evidence, 'equipment', key, key.toUpperCase(), 'medium', 'Construction equipment identifier appears in source text.'));
    }
  }
  return uniqueBy(links, item => `${item.sourceEvidenceId}:${item.targetType}:${item.targetId}`);
}

function link(
  evidence: DAVEEvidenceLedgerRecord,
  targetType: DAVEEntityLink['targetType'],
  targetId: string,
  targetLabel: string,
  confidence: DAVEEntityLink['confidence'],
  basis: string,
): DAVEEntityLink {
  return {
    id: `link:${evidence.id}:${targetType}:${targetId}`,
    sourceEvidenceId: evidence.id,
    targetType,
    targetId,
    targetLabel,
    confidence,
    basis,
    needsVerification: confidence === 'low',
  };
}

function bestNamedMatch(
  evidenceValues: Array<string | null>,
  candidates: Array<{ id: string; label: string }>,
) {
  let best: { id: string; label: string; confidence: 'high' | 'medium' | 'low'; basis: string; score: number } | null = null;
  for (const candidate of candidates) {
    for (const value of evidenceValues.filter(Boolean) as string[]) {
      const score = similarity(value, candidate.label);
      if (score < 0.45 || (best && best.score >= score)) continue;
      best = {
        ...candidate,
        score,
        confidence: score >= 0.9 ? 'high' : score >= 0.65 ? 'medium' : 'low',
        basis: score >= 0.9
          ? 'Exact normalized name match.'
          : `Shared construction terms (${Math.round(score * 100)}% match).`,
      };
    }
  }
  return best;
}

function buildPhotoComparisons(updates: ProjectUpdate[], links: DAVEEntityLink[]): DAVEPhotoComparisonTruth[] {
  return updates.flatMap(update => update.photos
    .filter(photo => photoDisplayResultCanInformProject(photo.photoIntelligence))
    .map(photo => {
    const intelligence = photo.photoIntelligence;
    const taskLink = links.find(item => item.sourceEvidenceId === `photo:${photo.id}` && item.targetType === 'schedule-task');
    const observation = clean(intelligence?.currentObservation) || clean(intelligence?.visibleChange) || clean(photo.caption) || 'No specific visible condition was recorded.';
    const hasPriorPhoto = Boolean(
      intelligence?.priorUpdateUsed || intelligence?.priorEvidenceId,
    );
    const hasComparablePrior = photoDisplayResultCanInformProject(intelligence);
    const safeVisualEvidence = intelligence?.provenance === 'visual_only' || intelligence?.provenance === 'visual_and_caption';
    const progressClaim = safeVisualEvidence && hasComparablePrior
      ? intelligence?.projectProgress || 'unable_to_determine'
      : 'unable_to_determine';
    const limitations = uniqueText([
      ...(intelligence?.captureLimitations ?? []),
      !hasPriorPhoto ? 'No confirmed prior photo is available.' : null,
      hasPriorPhoto && !hasComparablePrior
        ? 'The prior photo is not sufficiently comparable to support a change or progress conclusion.'
        : null,
      !safeVisualEvidence && intelligence ? 'The result is not supported by visual evidence alone.' : null,
      !taskLink ? 'The photo is not confidently connected to a schedule activity.' : null,
    ]);
    return {
      photoId: photo.id,
      updateId: update.id,
      areaName: clean(photo.selectedAreaName) || clean(update.selectedAreaName),
      taskId: taskLink?.targetId || clean(update.scheduleItemId),
      observation,
      changeFromPrior: hasComparablePrior
        ? clean(intelligence?.changedFromPrior) || clean(intelligence?.visibleChange)
        : null,
      progressClaim,
      comparablePriorAvailable: hasComparablePrior,
      limitations,
      evidenceClass: safeVisualEvidence ? 'observation' : intelligence ? 'interpretation' : 'uncertainty',
      needsVerification: progressClaim !== 'supported' || limitations.length > 0,
    };
  }));
}

function buildScheduleTruth(
  scheduleItems: ScheduleItem[],
  records: DAVEEvidenceLedgerRecord[],
  links: DAVEEntityLink[],
  correlations: DAVEEvidenceCorrelationResult,
  now: string,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
  /** Every saved task, for what David said of a task's earlier rows (review N2); none: the shown tasks' own. */
  knownScheduleItems: readonly ScheduleItem[] = scheduleItems,
): DAVEScheduleTruth[] {
  const today = new Date(now);
  // A lookahead's detail task is listed but leaves % Complete to the master's scope (owner answer Q25).
  const lookaheadDetail = scheduleTaskAddedByLookaheadsOnly(scheduleItems);
  // Review N2 (5 Oct 2026): David's answer "this row is a new task" (owner answer Q30) stays with the task. It was
  // kept on the row he answered for only; the next master re-dated that task as a new row, which answers to the
  // first by its earlier ids but carried no answer, and the report paired it by name with the same-named task
  // the master had dropped: "Pour slab was completed" and a finish change of weeks, with the dropped task never
  // said removed. A row is none of the tasks its earlier rows were said not to be.
  const saidNotById = new Map<string, readonly string[]>();
  knownScheduleItems.forEach(item => {
    if (Array.isArray(item.notRevisionOfTaskIds) && item.notRevisionOfTaskIds.length > 0) saidNotById.set(item.id.trim(), item.notRevisionOfTaskIds);
  });
  return scheduleItems.map(item => {
    const relatedEvidenceIds = links
      .filter(link => link.targetType === 'schedule-task' && link.targetId === item.id)
      .map(link => link.sourceEvidenceId)
      .filter(id => id !== `schedule:${item.id}`);
    const verification = item.completionVerification;
    const correlation = correlations.tasks.find(value => value.taskId === item.id);
    const completionState: DAVEScheduleTruth['completionState'] = correlationCompletionState(
      correlation,
      verification?.status,
    );
    const conflicting = completionState === 'conflicting_evidence';
    const correlationEvidenceIds = correlation?.corroboratingEvidenceIds ?? [];
    const controls = item.projectControls;
    const latestActivity = [...(item.activity ?? [])]
      .filter(activity => clean(activity.createdAt))
      .sort((left, right) =>
        (clean(right.createdAt) || '').localeCompare(clean(left.createdAt) || ''),
      )[0];
    const earlierTaskIds = scheduleTaskEarlierIds(item);
    const notTaskIds = uniqueText([
      ...(Array.isArray(item.notRevisionOfTaskIds) ? item.notRevisionOfTaskIds : []),
      ...earlierTaskIds.flatMap(id => saidNotById.get(id) ?? []),
    ].map(id => clean(id)));
    // Owner answer 3 Oct 2026: shown back on the master's dates (the replaced lookahead's are kept on the shown
    // copy), or on the dates the latest lookahead in its note gave it.
    const replacedLookaheadDates = item.savedLookaheadDates
      ? { startDate: item.savedLookaheadDates.startDate, finishDate: item.savedLookaheadDates.finishDate }
      : null;
    const latestLookahead = item.lookaheadOverlay?.lookaheads?.at(-1);
    const onLookaheadDates = !replacedLookaheadDates && Boolean(latestLookahead) &&
      sameScheduleCalendarDay(item.startDate, latestLookahead!.startDate) && sameScheduleCalendarDay(item.finishDate, latestLookahead!.finishDate);
    return {
      taskId: item.id,
      ...(earlierTaskIds.length > 0 ? { earlierTaskIds } : {}),
      ...(notTaskIds.length > 0 ? { notTaskIds } : {}),
      ...(onLookaheadDates ? { onLookaheadDates: true as const } : {}),
      ...(replacedLookaheadDates ? { replacedLookaheadDates } : {}),
      taskName: item.taskName,
      itemType: item.itemType || 'Task',
      areaName: clean(item.locationName),
      owner: clean(item.owner) || clean(item.contractor),
      assignee: clean(controls?.assignee),
      contractor: clean(item.contractor),
      trade: clean(controls?.trade),
      nextAction: clean(item.nextAction),
      status: item.status,
      percentComplete: item.percentComplete,
      durationWeight: scheduleTaskDurationWeight(item),
      startDate: clean(item.startDate),
      finishDate: clean(item.finishDate),
      baselineStartDate: clean(item.baselineStartDate),
      baselineFinishDate: clean(item.baselineFinishDate),
      isMilestone: Boolean(item.isMilestone),
      predecessorTaskIds: uniqueText(
        (item.dependencies ?? []).map(dependency => clean(dependency.predecessorItemId)),
      ),
      approvalStatus: clean(controls?.approvalStatus),
      workflowStage: clean(controls?.workflowStage),
      responseDueDate: clean(controls?.responseDueDate),
      referenceNumber: clean(controls?.referenceNumber),
      checklistTotal: controls?.checklist?.length ?? 0,
      checklistComplete: controls?.checklist?.filter(check => check.completed).length ?? 0,
      estimatedScheduleImpactDays: finiteNumber(controls?.estimatedScheduleImpactDays),
      impactConfidence: clean(controls?.impactConfidence),
      impactNotes: clean(controls?.impactNotes),
      updatedAt: clean(item.updatedAt) || clean(item.createdAt),
      updatedBy: clean(controls?.updatedBy),
      latestActivityAt: clean(latestActivity?.createdAt),
      latestActivitySummary: clean(latestActivity?.message),
      urgency: taskUrgency(item, today, projectTimeZone),
      ...(lookaheadDetail(item) ? { lookaheadDetail: true as const } : {}),
      completionState: conflicting ? 'conflicting_evidence' : completionState,
      relatedEvidenceIds: uniqueText([...relatedEvidenceIds, ...correlationEvidenceIds]),
      needsVerification:
        conflicting || completionState === 'reported_complete' ||
        (completionState === 'evidence_supported' && verification?.status !== 'pm_verified'),
      contradiction: correlation?.contradiction || (conflicting
        ? 'Current project records disagree about task completion.'
        : null),
    };
  });
}

function correlationCompletionState(
  correlation: DAVETaskEvidenceCorrelation | undefined,
  verificationStatus: DAVECompletionVerificationStatus | undefined,
): DAVEScheduleTruth['completionState'] {
  if (correlation?.conclusion === 'verified_complete') return 'pm_verified';
  if (correlation?.conclusion === 'completion_supported') return 'evidence_supported';
  if (correlation?.conclusion === 'completion_reported') return 'reported_complete';
  if (correlation?.conclusion === 'not_complete' && verificationStatus === 'rejected') return 'rejected';
  if (correlation?.conclusion === 'conflicting_evidence') return 'conflicting_evidence';
  return verificationStatus || 'scheduled';
}

function buildVerificationQueue(
  evidence: DAVEEvidenceAccounting,
  photoComparisons: DAVEPhotoComparisonTruth[],
  schedule: DAVEScheduleTruth[],
  reasoning: DAVEProjectReasoning,
): DAVEVerificationRequest[] {
  const unresolved = evidence.unresolvedRecords.slice(0, 10).map(item => ({
    id: `verify:${item.id}`,
    subjectType: 'evidence' as const,
    subjectId: item.sourceRecordId,
    title: `Connect ${evidenceKindLabel(item.kind)}`,
    reason: item.dispositionReason,
    requestedAction: item.areaName ? 'Confirm the related task.' : 'Confirm the project area or task.',
    priority: item.kind === 'photo' || item.kind === 'gps' ? 'medium' as const : 'low' as const,
  }));
  const photos = photoComparisons.filter(item => item.needsVerification).slice(0, 10).map(item => ({
    id: `verify:photo:${item.photoId}`,
    subjectType: 'photo' as const,
    subjectId: item.photoId,
    title: 'Verify photo comparison',
    reason: item.limitations[0] || 'The visible progress claim is not sufficiently supported.',
    requestedAction: item.comparablePriorAvailable
      ? 'Confirm the interpretation or capture a clearer repeat photo.'
      : 'Capture a repeat photo from the same position for comparison.',
    priority: 'medium' as const,
  }));
  const tasks = schedule.filter(item => item.needsVerification).map(item => {
    const decision = reasoning.decisions.find(value => value.taskId === item.taskId);
    return ({
    id: `verify:task:${item.taskId}`,
    subjectType: item.contradiction ? 'conflict' as const : 'schedule-task' as const,
    subjectId: item.taskId,
    title: `Verify ${item.taskName}`,
    reason: item.contradiction || decision?.conclusion || `Completion is currently ${item.completionState.replace(/_/g, ' ')}.`,
    requestedAction: decision?.recommendation.smallestNextAction || 'Confirm in the field, attach a supporting photo, or correct the task status.',
    priority: item.urgency === 'overdue' ? 'high' as const : 'medium' as const,
  });
  });
  return uniqueBy([...tasks, ...unresolved, ...photos], item => item.id)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

function buildPMBriefing(input: {
  projectName: string;
  intelligence: DAVEProjectIntelligence;
  evidence: DAVEEvidenceAccounting;
  photoComparisons: DAVEPhotoComparisonTruth[];
  correlations: DAVEEvidenceCorrelationResult;
  reasoning: DAVEProjectReasoning;
  schedule: DAVEScheduleTruth[];
  verificationQueue: DAVEVerificationRequest[];
  runtime?: PIERuntimeState | null;
  core?: PIECoreOutput | null;
}): DAVEPMBriefing {
  const overdue = input.schedule.filter(item => item.urgency === 'overdue' && !scheduleProgressIsComplete(item));
  const dueSoon = input.schedule.filter(item => item.urgency === 'due_soon' && !scheduleProgressIsComplete(item));
  const conflicts = input.schedule.filter(item => item.contradiction);
  const observations = input.photoComparisons
    .filter(item => item.evidenceClass === 'observation')
    .map(item => `${item.areaName ? `${item.areaName}: ` : ''}${item.changeFromPrior || item.observation}`);
  const correlatedChanges = input.correlations.tasks.flatMap(item => {
    if (item.conclusion === 'verified_complete') return [`${item.taskName} was verified complete.`];
    if (item.conclusion === 'completion_supported') return [`${item.taskName} appears complete in current field records and is ready for PM approval.`];
    if (item.conclusion === 'completion_reported') return [`${item.taskName} is marked complete and is awaiting PM approval.`];
    if (item.conclusion === 'progress_observed') return [`${item.taskName} shows visible progress.`];
    if (item.conclusion === 'conflicting_evidence') return [`${item.taskName} has conflicting current status information.`];
    return [];
  });
  const state = input.intelligence.projectReality.state;
  const confidence = input.core?.confidence || input.runtime?.overallConfidence || input.intelligence.projectReality.confidence;
  const nextActions = uniqueText([
    ...input.reasoning.criticalDecisions.slice(0, 2).map(item => `${item.recommendation.action} Owner: ${item.recommendation.owner}. ${item.recommendation.timing}.`),
    ...input.schedule
      .filter(item => item.urgency === 'overdue' || item.urgency === 'due_soon' || item.status === 'Waiting')
      .flatMap(item => item.nextAction ? [`${item.taskName}: ${item.nextAction}`] : []),
    ...overdue.slice(0, 2).map(item => `Resolve overdue work: ${item.taskName}${item.owner ? ` with ${item.owner}` : ''}.`),
    ...conflicts.slice(0, 2).map(item => `Resolve the recorded status conflict for ${item.taskName}.`),
    input.core?.bestNextStep,
    input.runtime?.nextBestAction.summary,
    input.intelligence.projectReality.topRecommendation?.action,
  ]).slice(0, 3);
  const risks = uniqueText([
    ...input.reasoning.criticalDecisions.flatMap(item => item.challenges.slice(0, 1).map(challenge => `${item.taskName}: ${challenge.impact}`)),
    ...conflicts.map(item =>
      `${item.taskName}${item.areaName ? ` (${item.areaName})` : ''}: ${item.contradiction} ` +
      'Check the field condition or correct the task status.',
    ),
    ...input.core?.situationRisks.map(item => `${item.risk}: ${item.whyItMatters}`) ?? [],
    ...input.runtime?.evidenceConflicts.map(item => item.summary) ?? [],
    ...input.intelligence.projectReality.blockers.map(item => item.text),
  ]).slice(0, 5);
  return {
    headline: `${input.projectName}: ${state}.`,
    currentReality: input.reasoning.criticalDecisions[0]?.conclusion || input.core?.situationSummary.whatUserShouldKnowNow ||
      input.runtime?.intelligentSummary.projectStatus ||
      `${input.intelligence.scheduleSummary.percentComplete}% scheduled completion; ${input.intelligence.projectReality.openCommitments.length} open commitment${input.intelligence.projectReality.openCommitments.length === 1 ? '' : 's'}.`,
    whatChanged: uniqueText([...correlatedChanges, ...observations]).slice(0, 5).length > 0
      ? uniqueText([...correlatedChanges, ...observations]).slice(0, 5)
      : uniqueText([input.runtime?.intelligentSummary.whatChanged, ...input.intelligence.dailyBrief.changedItems.map(item => item.text)]).slice(0, 5),
    schedule: overdue.length > 0
      ? `${overdue.length} overdue; ${dueSoon.length} due within 7 days; ${conflicts.length} status conflict${conflicts.length === 1 ? '' : 's'} need review.`
      : `${dueSoon.length} due within 7 days; ${input.schedule.filter(scheduleProgressIsComplete).length} of ${input.schedule.length} activities complete.`,
    commitments: input.intelligence.commitments
      .filter(item => item.status !== 'Completed')
      .slice(0, 5)
      .map(item => `${item.description}${item.owner ? ` — ${item.owner}` : ''}${item.dueDate ? ` — due ${item.dueDate}` : ''}`),
    risksAndConflicts: risks,
    verificationNeeded: input.verificationQueue
      .filter(item => item.subjectType === 'conflict' || item.subjectType === 'schedule-task')
      .slice(0, 5)
      .map(item => `${item.title}: ${item.requestedAction}`),
    nextActions,
    evidenceCoverage: `${input.evidence.connected} of ${input.evidence.total} recent records are assigned to project work. ${input.evidence.unresolved} record${input.evidence.unresolved === 1 ? '' : 's'} still need a project, work area, or task assignment.`,
    confidence,
  };
}

function summarizeEvidence(records: DAVEEvidenceLedgerRecord[]): DAVEEvidenceAccounting {
  const count = (value: DAVEEvidenceDisposition) => records.filter(item => item.disposition === value).length;
  const connected = count('connected');
  const actionableTotal = records.length - count('duplicate') - count('rejected');
  return {
    total: records.length,
    connected,
    unresolved: count('unresolved'),
    duplicate: count('duplicate'),
    rejected: count('rejected'),
    records,
    unresolvedRecords: records.filter(item => item.disposition === 'unresolved'),
    coveragePercent: actionableTotal > 0 ? Math.round((connected / actionableTotal) * 100) : 100,
  };
}

function taskUrgency(
  item: ScheduleItem,
  now: Date,
  projectTimeZone: ProjectTimeZone | string,
): DAVEScheduleTruth['urgency'] {
  if (scheduleProgressIsComplete(item) || !item.finishDate) return 'not_urgent';
  const days = projectDateRelativeDays(
    item.finishDate,
    now,
    item.projectTimeZone || projectTimeZone,
  );
  if (days === null) return 'not_urgent';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon';
  if (days <= 21) return 'upcoming';
  return 'not_urgent';
}

function memorySummary(memory: DAVEConfirmedCaptureMemory) {
  return clean(memory.fields.commitment) || clean(memory.fields.decision) ||
    clean(memory.fields.issue) || clean(memory.fields.risk) ||
    clean(memory.fields.followUp) || clean(memory.fields.generalMemory) || memory.transcript;
}

function photoIntelligenceText(photo: UpdatePhoto) {
  const value = photo.photoIntelligence;
  return value ? [
    value.summary,
    value.visibleChange,
    value.currentObservation,
    value.changedFromPrior,
    ...(value.additions ?? []),
    ...(value.removals ?? []),
    value.possibleProgress,
    ...(value.possibleConcerns ?? []),
  ].filter(Boolean).join(' ') : '';
}

function extractEntityKeys(value: string) {
  const matches = value.toLowerCase().match(/\b(?:ahu|rtu|vav|ef|fan|pump|panel|xfmr|transformer|unit|equipment)[\s#-]*[a-z0-9.-]+\b/g) ?? [];
  return uniqueText(matches.map(normalizedKey));
}

function similarity(left: string, right: string) {
  const leftKey = normalizedKey(left);
  const rightKey = normalizedKey(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)) return 1;
  const leftTokens = new Set(leftKey.split(' ').filter(token => token.length > 1));
  const rightTokens = new Set(rightKey.split(' ').filter(token => token.length > 1));
  const shared = [...leftTokens].filter(token => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size, 1);
}

function scheduleMatchesProject(projectKey: string, item: ScheduleItem) {
  const explicitProjects = [item.scheduleProjectName, item.projectName]
    .map(value => normalizedKey(value || ''))
    .filter(Boolean);
  if (explicitProjects.length > 0) return explicitProjects.some(value => value === projectKey);
  const locationKey = normalizedKey(item.locationName || '');
  return Boolean(locationKey && locationKey === projectKey);
}

function projectMatches(projectKey: string, value: string | null | undefined) {
  const valueKey = normalizedKey(value || '');
  return Boolean(valueKey && valueKey === projectKey);
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/\b(building|project|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function clean(value: string | null | undefined) {
  const next = value?.trim();
  return next || null;
}

function validDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function evidenceKindLabel(kind: DAVEEvidenceKind) {
  return kind.replace(/-/g, ' ');
}

function priorityRank(value: DAVEVerificationRequest['priority']) {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2;
}

function uniqueText(values: Array<string | null | undefined>) {
  return [...new Set(values.map(value => clean(value)).filter(Boolean) as string[])];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter(value => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  Object.values(value as object).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
