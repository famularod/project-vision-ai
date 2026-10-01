import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { daysUntilDate } from '../utils/date';
import {
  classifyDAVEBlocker,
  classifyDAVECompletion,
  classifyDAVEImplementation,
  classifyDAVEIssue,
  classifyDAVESafety,
  isDAVECurrentCertainAssertion,
  parseDAVEAssertions,
  type DAVEAssertionParseResult,
} from './DAVEAssertionParser';
import {
  scheduleProgressIsComplete,
  scheduleProgressRecordedByManager,
  scheduleProgressSetByScheduleFile,
} from './ScheduleProgressInvariant';
import { scheduleProgressJudgedAt } from './ScheduleProgressSource';
import { reconcileDAVEScheduleRecords } from './DAVEScheduleRecovery';
import { photoDisplayResultCanInformProject } from './PhotoAssessment';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { scheduleTaskLinks, type ScheduleTaskLink } from './ScheduleTaskRevisions';

export type PIEScheduleFieldSignal =
  | 'complete'
  | 'in_progress'
  | 'blocked'
  | 'issue'
  | 'unknown';

export type PIEScheduleReconciliationWarningType =
  | 'schedule_status_conflict'
  | 'field_progress_not_reflected'
  | 'field_issue_threatens_schedule'
  | 'scheduled_work_without_recent_evidence'
  | 'schedule_mapping_incomplete';

export type PIEScheduleFieldMatch = {
  scheduleItemId: string;
  updateId: string;
  photoIds: string[];
  projectName: string;
  areaName: string | null;
  capturedAt: string | null;
  signal: PIEScheduleFieldSignal;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  matchBasis: 'explicit_task_id' | 'stored_task_name' | 'semantic_fallback';
  taskTokenOverlap: number;
  projectMatched: boolean;
  areaMatched: boolean;
  summary: string;
};

export type PIEScheduleReconciliationWarning = {
  id: string;
  type: PIEScheduleReconciliationWarningType;
  scheduleItemId: string;
  updateId: string | null;
  projectName: string;
  areaName: string | null;
  taskName: string;
  title: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: 'low' | 'medium' | 'high';
  suggestedAction: string;
  evidenceIds: string[];
};

export type PIEScheduleReconciliationResult = {
  generatedAt: string;
  projectName: string;
  scheduleItemCount: number;
  updateCount: number;
  matchedItemCount: number;
  unmatchedUrgentItemCount: number;
  matches: PIEScheduleFieldMatch[];
  warnings: PIEScheduleReconciliationWarning[];
  summary: string;
};

export function scheduleHasAuthoritativeProgressJudgment(item: ScheduleItem) {
  if (scheduleProgressRecordedByManager(item)) return true;
  // A percent an approved schedule file set is the scheduler's, and the task
  // says so; it is not the manager's judgment (A10 pass 3 M1).
  if (scheduleProgressSetByScheduleFile(item)) return false;
  // A task a schedule file brought in, or marked as the import's, holds the
  // file's percent until the manager records one (whole-app audit A10 pass
  // 4, 30 Sep 2026): an untouched master task at 30%, or one a lookahead
  // raised, read as the manager's judgment.
  if (item.progressSource === 'schedule_import' || scheduleItemHasImportRecord(item)) return false;

  // Older records did not preserve progress provenance. A saved in-progress
  // percentage on a task entered by hand is still an explicit professional
  // judgment, not a DAVE guess.
  return item.status === 'In Progress' && boundedPercent(item.percentComplete) > 0;
}

/** Whether a schedule file brought the task in: its import, source document or file. */
function scheduleItemHasImportRecord(item: ScheduleItem) {
  return scheduleItemImportBatchIds(item).length > 0 ||
    Boolean(normalize(item.sourceDocumentId || '') || normalize(item.importedFrom || ''));
}

/**
 * Which saved copy of a task shows keeps the rank sync gives it
 * (DAVEScheduleRecovery): a task the manager tracked stays ranked after an
 * approved file raises it. Only the summaries read the file's percent as the
 * schedule's (scheduleHasAuthoritativeProgressJudgment).
 */
function scheduleProgressHoldsManagerRank(item: ScheduleItem) {
  if (item.progressSource === 'project_manager') return true;
  return item.status === 'In Progress' && boundedPercent(item.percentComplete) > 0;
}

export function scheduleCompletionOverridesFieldMatch(
  item: ScheduleItem,
  match: Pick<PIEScheduleFieldMatch, 'capturedAt'> | null,
) {
  if (!scheduleProgressIsComplete(item)) return false;

  const verification = item.completionVerification;
  const pmVerified = verification?.status === 'pm_verified';
  const pmRecorded = scheduleProgressRecordedByManager(item);
  // A file's completion, from the import or from an approved update (A10 pass 3 M1).
  const fileSet = scheduleProgressSetByScheduleFile(item);
  const scheduleImported = item.progressSource === 'schedule_import' || fileSet;
  if (!pmVerified && !pmRecorded && !scheduleImported) return false;

  const completionAt = timestamp(
    pmVerified
      ? verification?.verifiedAt || verification?.reportedAt || null
      : pmRecorded || fileSet
        // When the manager judged it, for a percent given back later (A10 pass 5 L1).
        ? scheduleProgressJudgedAt(item) || item.importedAt || item.createdAt || null
        : item.importedAt || item.createdAt || null,
  );
  const fieldAt = timestamp(match?.capturedAt || null);

  // A PM's completion decision is authoritative when chronology is unavailable.
  // Imported schedule completion is trusted only when its source time proves it
  // is at least as new as the contradictory field evidence.
  if (completionAt === 0 || fieldAt === 0) return pmVerified || pmRecorded;
  return completionAt >= fieldAt;
}

export function scheduleProgressOverridesFieldMatch(
  item: ScheduleItem,
  match: Pick<PIEScheduleFieldMatch, 'capturedAt'> | null,
) {
  if (!scheduleProgressRecordedByManager(item)) return false;
  // When the manager judged it: a percent given back by a lookahead's delete,
  // or over a lower file, is not newer than a field report made since (A10 pass 5 L1).
  const progressAt = timestamp(
    scheduleProgressJudgedAt(item) || item.importedAt || item.createdAt || null,
  );
  const fieldAt = timestamp(match?.capturedAt || null);
  if (progressAt === 0 || fieldAt === 0) return true;
  return progressAt >= fieldAt;
}

const DAY_MS = 86_400_000;
const RECENT_EVIDENCE_DAYS = 14;
const NEAR_TERM_DAYS = 14;
const MATCH_BASIS_RANK: Record<PIEScheduleFieldMatch['matchBasis'], number> = {
  explicit_task_id: 0,
  stored_task_name: 1,
  semantic_fallback: 2,
};
const MATCH_CONFIDENCE_RANK: Record<PIEScheduleFieldMatch['confidence'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};
const TASK_STOP_WORDS = new Set([
  'and', 'the', 'for', 'from', 'into', 'with', 'work', 'area', 'project',
  'building', 'location', 'install', 'installation', 'complete', 'completed',
  'progress', 'update', 'phase', 'level', 'floor', 'room',
]);

export function selectAuthoritativeScheduleItems({
  scheduleItems = [],
  scheduleDocuments = [],
}: {
  scheduleItems?: ScheduleItem[];
  scheduleDocuments?: ReferenceDocument[];
}) {
  const scheduleSources = scheduleDocuments.filter(scheduleDocumentIsScheduleLike);
  const currentByProject = currentScheduleDocumentsByProject(scheduleSources);
  // Owner answer Q22 (30 Sep 2026): each lookahead adds to its projects' master.
  const lookaheads = scheduleSources.filter(scheduleDocumentAddsToMaster);
  const activeSchedules = [...currentScheduleDocumentWinners(scheduleSources), ...lookaheads];
  const activeScheduleSources = new Set(
    activeSchedules
      .flatMap(document => [document.name, document.originalFileName])
      .map(normalize)
      .filter(Boolean),
  );
  const knownScheduleSources = new Set(
    scheduleSources
      .flatMap(document => [document.name, document.originalFileName])
      .map(normalize)
      .filter(Boolean),
  );
  const activeDocumentIds = new Set(activeSchedules.map(document => normalize(document.id)).filter(Boolean));

  // The schedule documents that contain a task: its own source document and
  // import, and any later import it was found unchanged in (whole-app audit
  // A5 pass 2: a revision used to take unchanged tasks over).
  const containingDocuments = (item: ScheduleItem) => {
    const sourceDocumentId = normalize(item.sourceDocumentId || '');
    const batchIds = scheduleItemImportBatchIds(item).map(normalize);
    return scheduleSources.filter(document =>
      (Boolean(sourceDocumentId) && normalize(document.id) === sourceDocumentId) ||
      (Boolean(normalize(document.importBatchId || '')) && batchIds.includes(normalize(document.importBatchId || ''))));
  };
  // Shown when the current schedule for the task's own project contains it;
  // with none current for that project, when any current schedule does. A
  // lookahead's tasks always show: it adds to the master (Q22).
  const containedByCurrentSchedule = (item: ScheduleItem, containing: readonly ReferenceDocument[]) => {
    if (containing.some(scheduleDocumentAddsToMaster)) return true;
    const current = currentByProject.get(normalize(item.scheduleProjectName || item.projectName || ''));
    if (current) return containing.includes(current);
    return containing.some(document => activeDocumentIds.has(normalize(document.id)));
  };
  const itemHasActiveProvenance = (item: ScheduleItem) => {
    const containing = containingDocuments(item);
    return containing.length > 0 && containedByCurrentSchedule(item, containing);
  };
  const itemHasOrphanedProvenance = (item: ScheduleItem) => (
    containingDocuments(item).length === 0 &&
    Boolean(normalize(item.sourceDocumentId || '') || scheduleItemImportBatchIds(item).length > 0)
  );
  const activeOccurrenceKeys = new Set(
    scheduleItems
      .filter(itemHasActiveProvenance)
      .map(scheduleOccurrenceKey),
  );
  const authoritativeOrphanOccurrenceKeys = new Set(
    scheduleItems
      .filter(item => (
        itemHasOrphanedProvenance(item) &&
        scheduleProgressHoldsManagerRank(item)
      ))
      .map(scheduleOccurrenceKey),
  );

  const selectedItems = scheduleSources.length === 0
    ? selectLatestImportedScheduleBatches(scheduleItems)
    : activeSchedules.length === 0
      ? scheduleItems.filter(item =>
          !normalize(item.importedFrom || '') &&
          !normalize(item.importBatchId || '') &&
          !normalize(item.sourceDocumentId || ''))
    : scheduleItems.filter(item => {
    const occurrenceKey = scheduleOccurrenceKey(item);
    if (
      itemHasActiveProvenance(item) &&
      authoritativeOrphanOccurrenceKeys.has(occurrenceKey)
    ) return false;
    if (
      itemHasOrphanedProvenance(item) &&
      activeOccurrenceKeys.has(occurrenceKey)
    ) return scheduleProgressHoldsManagerRank(item);

    const containing = containingDocuments(item);
    if (containing.length > 0) return containedByCurrentSchedule(item, containing);
    const importedFrom = normalize(item.importedFrom || '');
    return !importedFrom ||
      !knownScheduleSources.has(importedFrom) ||
      activeScheduleSources.has(importedFrom);
  });

  return dedupeScheduleItems(lookaheads.length > 0
    ? withoutLookaheadDuplicates(selectedItems, currentByProject, containingDocuments)
    : selectedItems);
}

/**
 * One task where the master and a lookahead each hold a copy (owner answer
 * Q22). A lookahead import restates the master's task in place, so this is
 * only the copy a later import left behind: a new master that changed the
 * task's dates, or an older master made current again. The copy from the
 * newest file shows. Nothing is folded when a file lists the same task name
 * twice in the same area: those may be two tasks.
 */
function withoutLookaheadDuplicates(
  items: readonly ScheduleItem[],
  currentByProject: ReadonlyMap<string, ReferenceDocument>,
  containingDocuments: (item: ScheduleItem) => ReferenceDocument[],
): ScheduleItem[] {
  const groups = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const project = normalize(item.scheduleProjectName || item.projectName || '');
    const key = [project, normalize(item.locationName || ''), normalize(item.taskName || '')].join('|');
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  const hidden = new Set<ScheduleItem>();
  groups.forEach(group => {
    if (group.length < 2) return;
    const master = currentByProject.get(normalize(group[0].scheduleProjectName || group[0].projectName || ''));
    const sources = new Map(group.map(item => [item, containingDocuments(item)
      .filter(document => document === master || scheduleDocumentAddsToMaster(document))] as const));
    if ([...sources.values()].some(documents => documents.length === 0)) return;
    const perFile = new Map<string, number>();
    sources.forEach(documents => documents.forEach(document => perFile.set(document.id, (perFile.get(document.id) || 0) + 1)));
    if ([...perFile.values()].some(count => count > 1)) return;
    const statedAt = (item: ScheduleItem) => Math.max(...(sources.get(item) || []).map(document => timestamp(document.importedAt)));
    const inMaster = (item: ScheduleItem) => Boolean(master && sources.get(item)?.includes(master));
    const shown = [...group].sort((left, right) =>
      (statedAt(right) - statedAt(left)) || (Number(inMaster(right)) - Number(inMaster(left))))[0];
    group.forEach(item => { if (item !== shown) hidden.add(item); });
  });
  return items.filter(item => !hidden.has(item));
}

function scheduleOccurrenceKey(item: ScheduleItem) {
  return [
    normalize(item.scheduleProjectName || item.projectName || ''),
    normalize(item.locationName || ''),
    normalize(item.taskName || ''),
    normalize(item.startDate || ''),
    normalize(item.finishDate || ''),
    normalize(item.milestone || ''),
  ].join('|');
}

function selectLatestImportedScheduleBatches(
  scheduleItems: readonly ScheduleItem[],
): ScheduleItem[] {
  const latestBatchBySource = new Map<string, {
    batchId: string;
    importedAt: number;
  }>();

  scheduleItems.forEach(item => {
    const source = normalize(item.importedFrom || '');
    const batchId = normalize(item.importBatchId || '');
    if (!source || !batchId) return;
    const importedAt = timestamp(item.importedAt || item.createdAt || null);
    const current = latestBatchBySource.get(source);
    if (
      !current ||
      importedAt > current.importedAt ||
      (importedAt === current.importedAt && batchId > current.batchId)
    ) {
      latestBatchBySource.set(source, { batchId, importedAt });
    }
  });

  return scheduleItems.filter(item => {
    const source = normalize(item.importedFrom || '');
    const batchId = normalize(item.importBatchId || '');
    if (!source || !batchId) return true;
    return latestBatchBySource.get(source)?.batchId === batchId;
  });
}

/**
 * For each project, the newest marked-current schedule that covers it
 * (schedules with no project form one shared scope, key ''). Until 30 Sep
 * 2026 a single app-wide winner was kept, so importing a second project's
 * schedule hid the first project's whole schedule (whole-app audit A5); then
 * a schedule that shared any project with a newer one lost every project, so
 * a newer single-project schedule retired a combined master for the other
 * project too (A5 pass 2). Now each project picks its own. A project a
 * schedule is retired for (retiredForProjectNames, owner answer Q15) is not
 * one it competes for, so a rollback to an older single-project schedule wins
 * there while the combined schedule stays current for its other projects.
 */
export function currentScheduleDocumentsByProject<T extends ReferenceDocument>(
  documents: readonly T[],
): Map<string, T> {
  const current = new Map<string, T>();
  documents
    // A lookahead adds to the master and never replaces it (owner answer Q22).
    .filter(document => scheduleDocumentIsScheduleLike(document) && document.isCurrent && !scheduleDocumentAddsToMaster(document))
    .sort(compareScheduleDocumentAuthority)
    .forEach(document => {
      const scope = scheduleDocumentScope(document);
      const retired = new Set(scheduleDocumentRetiredProjectNames(document).map(normalize));
      (scope.length > 0 ? scope.filter(project => !retired.has(project)) : ['']).forEach(project => {
        if (!current.has(project)) current.set(project, document);
      });
    });
  return current;
}

/**
 * The projects a schedule no longer speaks for (owner answer Q15, 30 Sep
 * 2026): making one project's schedule current leaves a combined schedule
 * current for its other projects, and the cloud records the chosen
 * schedule's projects on it. Only names in its own project list count.
 */
export function scheduleDocumentRetiredProjectNames(document: ReferenceDocument): string[] {
  // A lookahead is in effect for all its projects, whatever the cloud recorded (owner answer Q22).
  if (scheduleDocumentAddsToMaster(document)) return [];
  const listed: unknown[] = Array.isArray(document.retiredForProjectNames) ? document.retiredForProjectNames : [];
  const retired = new Set(listed
    .filter((name): name is string => typeof name === 'string')
    .map(normalize)
    .filter(Boolean));
  if (retired.size === 0) return [];
  return scheduleDocumentScopeNames(document).filter(name => retired.has(normalize(name)));
}

/**
 * Current, not retired for any of its projects and, given the schedules,
 * the one each of its projects shows: Make Current has nothing left to do.
 *
 * Whole-app audit A5 pass 4 #2 (30 Sep 2026): a newer partial schedule (a
 * three-week lookahead for Alpha) wins Alpha from the combined master by
 * date, so Alpha's master tasks outside the lookahead disappeared, while the
 * master still read "Active schedule" and Set Active and Make Current were
 * hidden: deleting the lookahead was the only way back. The cloud's
 * activation of a schedule already current retires the others covering its
 * projects, so offering it again is all it takes.
 */
export function scheduleDocumentIsCurrentEverywhere(
  document: ReferenceDocument,
  documents?: readonly ReferenceDocument[],
): boolean {
  // A lookahead is in effect by its role: there is nothing to make current (Q22).
  if (scheduleDocumentAddsToMaster(document)) return true;
  if (!document.isCurrent || scheduleDocumentRetiredProjectNames(document).length > 0) return false;
  return !documents || scheduleDocumentProjectsShownElsewhere(document, documents).length === 0;
}

/**
 * The projects of a current schedule that show another, newer current
 * schedule instead (A5 pass 4 #2); '' for a schedule with no project.
 */
function scheduleDocumentProjectsShownElsewhere(
  document: ReferenceDocument,
  documents: readonly ReferenceDocument[],
): string[] {
  if (!document.isCurrent || !scheduleDocumentIsScheduleLike(document)) return [];
  const listed = documents.some(candidate => candidate.id === document.id) ? documents : [...documents, document];
  const current = currentScheduleDocumentsByProject(listed);
  const retired = new Set(scheduleDocumentRetiredProjectNames(document).map(normalize));
  const names = scheduleDocumentScopeNames(document);
  return (names.length > 0 ? names : [''])
    .filter(name => !retired.has(normalize(name)) && current.get(normalize(name))?.id !== document.id);
}

/** Whether the schedule was retired for this project (Q15). */
export function scheduleDocumentRetiredForProject(
  document: ReferenceDocument,
  projectName: string,
): boolean {
  const key = normalize(projectName || '');
  return Boolean(key) && scheduleDocumentIsScheduleLike(document) &&
    scheduleDocumentRetiredProjectNames(document).some(name => normalize(name) === key);
}

/**
 * "Current", or "Current for Beta" for a combined schedule retired for some
 * of its projects or, given the schedules, one a newer schedule replaces for
 * some of them (A5 pass 4 #2).
 */
export function scheduleDocumentCurrentLabel(
  document: ReferenceDocument,
  label: string,
  documents?: readonly ReferenceDocument[],
): string {
  if (scheduleDocumentAddsToMaster(document)) {
    const projects = scheduleDocumentScopeNames(document);
    return `Lookahead: adds to the master schedule${projects.length > 0 ? ` for ${projects.join(', ')}` : ''}`;
  }
  const retired = new Set([
    ...scheduleDocumentRetiredProjectNames(document),
    ...(documents ? scheduleDocumentProjectsShownElsewhere(document, documents) : []),
  ].map(normalize));
  if (retired.size === 0) return label;
  const remaining = scheduleDocumentScopeNames(document).filter(name => !retired.has(normalize(name)));
  return remaining.length > 0 ? `${label} for ${remaining.join(', ')}` : label;
}

/** The current schedule documents that drive intelligence: each is current for at least one project. */
export function currentScheduleDocumentWinners<T extends ReferenceDocument>(
  documents: readonly T[],
): T[] {
  return [...new Set(currentScheduleDocumentsByProject(documents).values())]
    .sort(compareScheduleDocumentAuthority);
}

/** The key currentScheduleDocumentsByProject files a project name under. */
export function scheduleProjectScopeKey(projectName: string): string {
  return normalize(projectName);
}

function scheduleDocumentScope(document: ReferenceDocument): string[] {
  const names = (document.projectNames || []).map(normalize).filter(Boolean);
  if (names.length > 0) return [...new Set(names)];
  const single = normalize(document.projectName || '');
  return single ? [single] : [];
}

/** scheduleDocumentScope with each project as the document spells it. */
function scheduleDocumentScopeNames(document: ReferenceDocument): string[] {
  const listed = (document.projectNames || []).filter(name => typeof name === 'string' && normalize(name));
  const names = listed.length > 0 ? listed : [document.projectName || ''].filter(name => normalize(name));
  return names
    .map(name => name.trim())
    .filter((name, index, all) => all.findIndex(other => normalize(other) === normalize(name)) === index);
}

export function reconcileCurrentScheduleDocuments<T extends ReferenceDocument>(
  documents: readonly T[],
): T[] {
  const winners = new Set(currentScheduleDocumentWinners(documents).map(document => document.id));
  if (winners.size === 0) return [...documents];
  // A lookahead keeps the flag the cloud gave it (owner answer Q22).
  return documents.map(document => scheduleDocumentIsScheduleLike(document) && !scheduleDocumentAddsToMaster(document)
    ? { ...document, isCurrent: winners.has(document.id) }
    : document);
}

/**
 * A schedule David marked "Lookahead / partial (adds to the master)" at
 * import review (owner answer Q22, 30 Sep 2026). It is in effect for its
 * projects for as long as it is kept, whatever its current flag (the cloud's
 * activation of a master can clear that flag): it never replaces the master,
 * a new master does not retire it, and it is never sent to the cloud's
 * activation. Every schedule imported before has no role: a full schedule.
 */
export function scheduleDocumentAddsToMaster(document: ReferenceDocument): boolean {
  return document.scheduleRole === 'lookahead' && scheduleDocumentIsScheduleLike(document);
}

export function scheduleDocumentIsScheduleLike(document: ReferenceDocument): boolean {
  if (document.category === 'Schedules' || document.category === 'Schedule') return true;
  // Only an uncategorised document may be a schedule by its name: a drawing
  // named "E-601 Panel Schedule" retired the master, and a message screenshot
  // ("Schedule message - ...", never current) hid every task approved from
  // it (whole-app audit A5 pass 2).
  if (document.category && document.category !== 'Other') return false;
  if (/^\[Schedule communication screenshot\]/.test(document.notes || '')) return false;
  return /\b(schedule|look[\s-]?ahead)\b/i.test(
    `${document.name} ${document.originalFileName}`,
  );
}

function compareScheduleDocumentAuthority(left: ReferenceDocument, right: ReferenceDocument) {
  const timeDifference = timestamp(right.importedAt) - timestamp(left.importedAt);
  return timeDifference || normalize(left.id).localeCompare(normalize(right.id));
}

export function buildPIEScheduleReconciliation({
  scheduleItems = [],
  updates = [],
  projectName = null,
  now = new Date(),
}: {
  scheduleItems?: ScheduleItem[];
  updates?: ProjectUpdate[];
  projectName?: string | null;
  now?: Date;
} = {}): PIEScheduleReconciliationResult {
  const normalizedProject = normalize(projectName || '');
  const scopedScheduleItems = dedupeScheduleItems(scheduleItems).filter(item =>
    !normalizedProject ||
    normalize(item.projectName) === normalizedProject ||
    normalize(item.locationName) === normalizedProject,
  );
  const scopedScheduleAreas = new Set(
    scopedScheduleItems.map(item => normalize(item.locationName)).filter(Boolean),
  );
  const scopedUpdates = updates.filter(update =>
    !normalizedProject ||
    normalize(update.projectName) === normalizedProject ||
    scopedScheduleAreas.has(normalize(update.projectName)) ||
    [update.selectedAreaName, ...update.photos.map(photo => photo.selectedAreaName)]
      .filter((area): area is string => Boolean(area))
      .some(area => scopedScheduleAreas.has(normalize(area))),
  );
  const matches: PIEScheduleFieldMatch[] = [];
  const warnings: PIEScheduleReconciliationWarning[] = [];
  // The task each update's task id answers to now: a new master saves a moved task under a new id (A10 pass 5 M1).
  const linkOf = scheduleTaskLinks(scopedScheduleItems);
  const links = new Map(scopedUpdates.map(update => [update, linkOf(update)] as const));

  scopedScheduleItems.forEach(item => {
    const itemMatches = scopedUpdates
      .map(update => matchScheduleItemToUpdate(item, update, links.get(update) ?? null))
      .filter((match): match is PIEScheduleFieldMatch => Boolean(match))
      .sort((left, right) =>
        MATCH_BASIS_RANK[left.matchBasis] - MATCH_BASIS_RANK[right.matchBasis] ||
        MATCH_CONFIDENCE_RANK[left.confidence] - MATCH_CONFIDENCE_RANK[right.confidence] ||
        timestamp(right.capturedAt) - timestamp(left.capturedAt) ||
        right.score - left.score,
      );
    const bestMatch = itemMatches[0] || null;
    const daysUntilFinish = relativeDays(item.finishDate, now, item.projectTimeZone);
    const urgent =
      !scheduleProgressIsComplete(item) &&
      daysUntilFinish !== null &&
      daysUntilFinish <= NEAR_TERM_DAYS;

    matches.push(...itemMatches.slice(0, 1));

    if (!item.projectName.trim() || !item.locationName.trim() || !item.finishDate.trim()) {
      warnings.push(makeWarning({
        item,
        match: bestMatch,
        type: 'schedule_mapping_incomplete',
        title: 'Schedule activity needs mapping',
        summary: `${scheduleLabel(item)} is missing project, area, or finish-date information needed for reliable field comparison.`,
        severity: urgent ? 'high' : 'medium',
        suggestedAction: 'Review the activity and add its project, area, and finish date.',
      }));
    }

    if (bestMatch?.confidence === 'high' || bestMatch?.confidence === 'medium') {
      if (
        scheduleProgressIsComplete(item) &&
        ['blocked', 'issue', 'in_progress'].includes(bestMatch.signal) &&
        !scheduleCompletionOverridesFieldMatch(item, bestMatch)
      ) {
        warnings.push(makeWarning({
          item,
          match: bestMatch,
          type: 'schedule_status_conflict',
          title: 'Field evidence conflicts with schedule status',
          summary: `${scheduleLabel(item)} is marked Complete, but a later or more reliable task-specific field update indicates ${signalLabel(bestMatch.signal)}.`,
          severity: bestMatch.signal === 'blocked' || bestMatch.signal === 'issue' ? 'critical' : 'high',
          suggestedAction: 'Verify the field condition before relying on the Complete schedule status.',
        }));
      }

      if (
        !scheduleProgressIsComplete(item) &&
        bestMatch.signal === 'complete' &&
        !scheduleProgressOverridesFieldMatch(item, bestMatch)
      ) {
        warnings.push(makeWarning({
          item,
          match: bestMatch,
          type: 'field_progress_not_reflected',
          title: 'Possible progress is not reflected in the schedule',
          summary: `Recent field evidence may show ${scheduleLabel(item)} complete while the schedule remains ${item.status} at ${boundedPercent(item.percentComplete)}%.`,
          severity: 'medium',
          suggestedAction: 'Review the field evidence and update the schedule only after confirmation.',
        }));
      } else if (
        item.status === 'Not Started' &&
        bestMatch.signal === 'in_progress' &&
        !scheduleProgressOverridesFieldMatch(item, bestMatch)
      ) {
        warnings.push(makeWarning({
          item,
          match: bestMatch,
          type: 'field_progress_not_reflected',
          title: 'Field progress may be ahead of the schedule',
          summary: `Recent field evidence indicates ${scheduleLabel(item)} may be in progress while the schedule remains Not Started.`,
          severity: 'medium',
          suggestedAction: 'Confirm current progress and revise schedule status or percent complete if appropriate.',
        }));
      }

      if (
        urgent &&
        (bestMatch.signal === 'blocked' || bestMatch.signal === 'issue')
      ) {
        warnings.push(makeWarning({
          item,
          match: bestMatch,
          type: 'field_issue_threatens_schedule',
          title: 'Field condition may threaten scheduled work',
          summary: `${scheduleLabel(item)} is ${dueWindowLabel(daysUntilFinish)}, and matching field evidence indicates ${signalLabel(bestMatch.signal)}.`,
          severity: daysUntilFinish !== null && daysUntilFinish < 0 ? 'critical' : 'high',
          suggestedAction: 'Confirm the blocker, owner, and recovery date before the next report.',
        }));
      }
    }

    if (
      urgent &&
      !scheduleHasAuthoritativeProgressJudgment(item) &&
      !hasRecentStrongEvidence(bestMatch, now)
    ) {
      warnings.push(makeWarning({
        item,
        match: bestMatch,
        type: 'scheduled_work_without_recent_evidence',
        title: 'Scheduled work lacks recent field evidence',
        summary: bestMatch
          ? `${scheduleLabel(item)} is ${dueWindowLabel(daysUntilFinish)}, but its latest task-specific field evidence is older than ${RECENT_EVIDENCE_DAYS} days.`
          : `${scheduleLabel(item)} is ${dueWindowLabel(daysUntilFinish)}, but no task-specific field update confirms current status.`,
        severity: daysUntilFinish !== null && daysUntilFinish < 0 ? 'high' : 'medium',
        suggestedAction: `Capture or review current evidence for ${item.locationName.trim() || 'the scheduled area'}.`,
      }));
    }
  });

  const uniqueWarnings = dedupeWarnings(warnings);
  const matchedItemCount = new Set(matches.map(match => match.scheduleItemId)).size;
  const unmatchedUrgentItemCount = uniqueWarnings.filter(
    warning => warning.type === 'scheduled_work_without_recent_evidence',
  ).length;

  return {
    generatedAt: now.toISOString(),
    projectName: projectName || 'All Projects',
    scheduleItemCount: scopedScheduleItems.length,
    updateCount: scopedUpdates.length,
    matchedItemCount,
    unmatchedUrgentItemCount,
    matches,
    warnings: uniqueWarnings,
    summary: reconciliationSummary({
      scheduleItemCount: scopedScheduleItems.length,
      matchedItemCount,
      warningCount: uniqueWarnings.length,
      unmatchedUrgentItemCount,
    }),
  };
}

function matchScheduleItemToUpdate(
  item: ScheduleItem,
  update: ProjectUpdate,
  /** The task the update's task id answers to now (A10 pass 5 M1). */
  link: ScheduleTaskLink | null,
): PIEScheduleFieldMatch | null {
  const explicitScheduleItemId = update.scheduleItemId?.trim() || '';
  // The task itself, or the row a new master saved it as; a row saved before
  // that matches by the update's stored task name below (A10 pass 5 M1).
  const linkedHere = link?.item === item;
  const explicitTaskMatched = Boolean(
    explicitScheduleItemId &&
    (explicitScheduleItemId === item.id || (linkedHere && link?.basis === 'earlier_task_id')),
  );
  if (explicitScheduleItemId && !explicitTaskMatched && !linkedHere) return null;

  const projectMatched =
    Boolean(item.projectName.trim()) &&
    [update.projectName, update.scheduleProjectName || '']
      .some(project => normalize(item.projectName) === normalize(project));

  const updateAreaNames = unique([
    update.selectedAreaName || '',
    ...update.photos.map(photo => photo.selectedAreaName || ''),
  ]).filter(Boolean);
  const areaMatched = Boolean(item.locationName.trim()) && updateAreaNames.some(
    area => sameName(area, item.locationName),
  );
  const confirmedAreaMismatch =
    Boolean(item.locationName.trim()) &&
    updateAreaNames.length > 0 &&
    !areaMatched;
  if (!explicitTaskMatched && confirmedAreaMismatch) return null;

  const scopedEvidence = updateEvidenceForScheduleItem(item, update);

  const legacyProjectAreaMatched =
    Boolean(item.locationName.trim()) &&
    sameName(item.locationName, update.projectName);
  const storedTaskNameMatched = Boolean(
    update.scheduleTaskName?.trim() &&
    normalize(update.scheduleTaskName) === normalize(scheduleLabel(item)),
  );
  if (!explicitTaskMatched && !projectMatched && !legacyProjectAreaMatched) return null;
  const fieldText = scopedEvidence.matchText;
  const overlap = scheduleTaskTokenOverlap(item, fieldText);
  const taskMatched = overlap >= 0.34;

  if (
    !explicitTaskMatched &&
    !storedTaskNameMatched &&
    !taskMatched &&
    !(areaMatched && overlap >= 0.14)
  ) return null;

  const matchBasis = explicitTaskMatched
    ? 'explicit_task_id' as const
    : storedTaskNameMatched
      ? 'stored_task_name' as const
      : 'semantic_fallback' as const;
  const score = explicitTaskMatched
    ? 100
    : storedTaskNameMatched
      ? Math.min(99, Math.round(90 + (areaMatched ? 5 : 0) + overlap * 4))
      : Math.min(100, Math.round(
          (projectMatched ? 40 : 28) +
          (areaMatched || legacyProjectAreaMatched ? 25 : 0) +
          overlap * 35,
        ));
  const confidence = matchBasis !== 'semantic_fallback' || score >= 82
    ? 'high'
    : score >= 65
      ? 'medium'
      : 'low';
  const signal = fieldSignal(
    item,
    scopedEvidence.signalText,
    scopedEvidence.photos,
    storedTaskNameMatched,
  );

  return {
    scheduleItemId: item.id,
    updateId: update.id,
    photoIds: scopedEvidence.photos.map(photo => photo.id),
    projectName: update.projectName,
    areaName: scopedEvidence.areaName,
    capturedAt: updateTimestamp(update),
    signal,
    score,
    confidence,
    matchBasis,
    taskTokenOverlap: Math.round(overlap * 100) / 100,
    projectMatched,
    areaMatched,
    summary: conciseEvidenceSummary(update, signal, scopedEvidence),
  };
}

type ScheduleItemUpdateEvidence = {
  photos: ProjectUpdate['photos'];
  includeUpdateText: boolean;
  matchText: string;
  signalText: string;
  areaName: string | null;
};

function updateEvidenceForScheduleItem(
  item: ScheduleItem,
  update: ProjectUpdate,
): ScheduleItemUpdateEvidence {
  const itemArea = item.locationName.trim();
  const updateArea = update.selectedAreaName?.trim() || '';
  const hasAreaTaggedPhotos = update.photos.some(photo => Boolean(photo.selectedAreaName?.trim()));
  const photos = !itemArea
    ? update.photos
    : update.photos.filter(photo => {
        const photoArea = photo.selectedAreaName?.trim() || '';
        if (photoArea) return sameName(photoArea, itemArea);
        if (updateArea) return sameName(updateArea, itemArea);

        // Preserve legacy records only when the whole update predates area tagging.
        // An untagged photo beside area-tagged photos is ambiguous and must not
        // leak its signal into every same-named task across those areas.
        return !hasAreaTaggedPhotos;
      });
  const includeUpdateText = !itemArea || (
    updateArea
      ? sameName(updateArea, itemArea)
      : !hasAreaTaggedPhotos
  );
  const photoEvidence = photos.flatMap(photo => {
    const intelligence = photoDisplayResultCanInformProject(photo.photoIntelligence)
      ? photo.photoIntelligence
      : null;
    return [
      photo.caption,
      photo.category,
      photo.actionRequired,
      intelligence?.currentObservation,
      intelligence?.visibleChange,
      intelligence?.possibleProgress,
      ...(intelligence?.possibleConcerns || []),
    ];
  });
  const matchingParts = [
    update.scheduleTaskName,
    includeUpdateText ? update.notes : null,
    ...photoEvidence,
  ];
  const signalParts = [
    includeUpdateText ? update.notes : null,
    ...photoEvidence,
  ];
  const taggedPhotoArea = photos
    .map(photo => photo.selectedAreaName?.trim() || '')
    .find(area => Boolean(area));
  const matchedUpdateArea = updateArea && (!itemArea || sameName(updateArea, itemArea))
    ? update.selectedAreaName || null
    : null;

  return {
    photos,
    includeUpdateText,
    matchText: matchingParts.filter(Boolean).join(' '),
    signalText: signalParts.filter(Boolean).join(' '),
    areaName: taggedPhotoArea || matchedUpdateArea || null,
  };
}

function scheduleTaskText(item: ScheduleItem) {
  return [item.taskName, item.milestone]
    .filter(Boolean)
    .join(' ');
}

function fieldSignal(
  item: ScheduleItem,
  text: string,
  photos: ProjectUpdate['photos'],
  storedTaskNameMatched: boolean,
): PIEScheduleFieldSignal {
  const hasOpenIssue = photos.some(photo =>
    (photo.category === 'Open Issue' || photo.category === 'Safety Concern') &&
    photo.actionStatus !== 'Closed',
  );
  if (hasOpenIssue) return 'issue';

  const parsed = parseDAVEAssertions(text);
  const blocker = classifyDAVEBlocker(parsed);
  const safety = classifyDAVESafety(parsed);
  const issue = classifyDAVEIssue(parsed);
  const completion = classifyDAVECompletion(parsed);
  const implementation = classifyDAVEImplementation(parsed);
  const uncertainOrConflicting = [blocker, safety, issue, completion, implementation]
    .some(classification =>
      classification === 'uncertain' || classification === 'conflicting',
    );

  if (uncertainOrConflicting) return 'unknown';
  if (blocker === 'blocked') return 'blocked';
  if (
    safety === 'issue_present' ||
    issue === 'issue_present' ||
    parsed.assertions.some(assertion =>
      assertion.status === 'outcome_failed' && isDAVECurrentCertainAssertion(assertion),
    )
  ) {
    return 'issue';
  }
  if (taskSpecificIncompleteEvidence(item, text, parsed)) return 'in_progress';
  if (completion === 'not_complete') return 'in_progress';
  if (completion === 'complete') {
    if (storedTaskNameMatched || completionEvidenceNamesTask(item, parsed)) {
      return 'complete';
    }
    // A generic whole-area or whole-project completion statement must not
    // fall through to implementation classification and complete a named task.
    return 'unknown';
  }
  if (implementation === 'implemented' || implementation === 'in_progress') {
    return 'in_progress';
  }
  return 'unknown';
}

function completionEvidenceNamesTask(
  item: ScheduleItem,
  parsed: DAVEAssertionParseResult,
) {
  const taskTokens = new Set(tokens(scheduleTaskText(item)));
  if (taskTokens.size === 0) return false;

  return parsed.assertions.some(assertion =>
    assertion.predicate === 'complete' &&
    assertion.status === 'complete' &&
    assertion.polarity === 'affirmed' &&
    isDAVECurrentCertainAssertion(assertion) &&
    tokens(assertion.subject || '').some(token => taskTokens.has(token)),
  );
}

function taskSpecificIncompleteEvidence(
  item: ScheduleItem,
  text: string,
  parsed: DAVEAssertionParseResult,
) {
  const taskTokens = new Set(tokens(scheduleTaskText(item)));
  if (taskTokens.size === 0) return false;

  const hasUnfinishedAssertion = parsed.assertions.some(assertion => {
    if (
      !assertion.subject ||
      !isDAVECurrentCertainAssertion(assertion) ||
      !tokens(assertion.subject).some(token => taskTokens.has(token))
    ) {
      return false;
    }
    return assertion.status === 'incomplete' ||
      assertion.status === 'not_started' ||
      assertion.status === 'not_implemented' ||
      assertion.status === 'in_progress';
  });
  if (hasUnfinishedAssertion) return true;

  const normalizedText = normalize(text);
  return Array.from(taskTokens).some(token => {
    const taskTerm = `${escapeRegExp(token)}(?:s|es)?`;
    const namedException = new RegExp(
      `\\b(?:except|excluding|without|missing|no|exception\\s+of)\\b(?:\\s+[a-z0-9]+){0,5}\\s+${taskTerm}\\b`,
    );
    const namedNegative = new RegExp(
      `\\b${taskTerm}\\b\\s+(?:(?:has|have|is|are)\\s+)?not\\s+(?:been\\s+)?(?:installed|complete|completed|done|finished|present|visible)\\b`,
    );
    const namedIncomplete = new RegExp(
      `\\b${taskTerm}\\b\\s+(?:is|are)\\s+(?:missing|absent|incomplete|pending)\\b`,
    );
    return namedException.test(normalizedText) ||
      namedNegative.test(normalizedText) ||
      namedIncomplete.test(normalizedText);
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasRecentStrongEvidence(match: PIEScheduleFieldMatch | null, now: Date) {
  if (!match || match.confidence === 'low') return false;
  const capturedAt = timestamp(match.capturedAt);
  if (!capturedAt) return false;
  return now.getTime() - capturedAt <= RECENT_EVIDENCE_DAYS * DAY_MS;
}

function makeWarning({
  item,
  match,
  type,
  title,
  summary,
  severity,
  suggestedAction,
}: {
  item: ScheduleItem;
  match: PIEScheduleFieldMatch | null;
  type: PIEScheduleReconciliationWarningType;
  title: string;
  summary: string;
  severity: PIEScheduleReconciliationWarning['severity'];
  suggestedAction: string;
}): PIEScheduleReconciliationWarning {
  return {
    id: `schedule-reconciliation-${type}-${item.id}`,
    type,
    scheduleItemId: item.id,
    updateId: match?.updateId || null,
    projectName: item.projectName || match?.projectName || 'Unassigned Project',
    areaName: item.locationName || match?.areaName || null,
    taskName: scheduleLabel(item),
    title,
    summary,
    severity,
    confidence: match?.confidence || (type === 'schedule_mapping_incomplete' ? 'high' : 'medium'),
    suggestedAction,
    evidenceIds: [
      `schedule:${item.id}`,
      match ? `update:${match.updateId}` : null,
      ...(match?.photoIds || []).map(id => `photo:${id}`),
    ].filter((id): id is string => Boolean(id)),
  };
}

function conciseEvidenceSummary(
  update: ProjectUpdate,
  signal: PIEScheduleFieldSignal,
  evidence: ScheduleItemUpdateEvidence,
) {
  const text = (evidence.includeUpdateText ? update.notes.trim() : '') ||
    evidence.photos.find(photo => photo.caption.trim())?.caption ||
    `Field update indicates ${signalLabel(signal)}.`;
  return shorten(text, 180);
}

function scheduleTaskTokenOverlap(item: ScheduleItem, fieldText: string) {
  const areaTokens = new Set(tokens(item.locationName));
  const leftTokens = tokens(scheduleTaskText(item)).filter(token => !areaTokens.has(token));
  if (leftTokens.length === 0) return 0;
  const rightTokens = new Set(tokens(fieldText));
  return leftTokens.filter(token => rightTokens.has(token)).length / leftTokens.length;
}

function tokens(value: string) {
  return unique(
    normalize(value)
      .split(/[^a-z0-9]+/)
      .map(canonicalToken)
      .filter(token => token.length >= 3 && !TASK_STOP_WORDS.has(token)),
  );
}

function canonicalToken(token: string) {
  if (/^electr(ic|ical|ician|icians)$/.test(token)) return 'electric';
  if (/^inspect(ion|ions|ed|ing|or|ors)?$/.test(token)) return 'inspect';
  if (/^install(ation|ations|ed|ing|s)?$/.test(token)) return 'install';
  if (/^barricade(s|d)?$/.test(token)) return 'barricade';
  if (/^concrete$/.test(token)) return 'concrete';
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
  return token;
}

function dedupeScheduleItems(items: ScheduleItem[]) {
  return reconcileDAVEScheduleRecords(items);
}

function updateTimestamp(update: ProjectUpdate) {
  return update.workflowTimestamps?.sendResolvedAt ||
    update.workflowTimestamps?.sendTappedAt ||
    update.workflowTimestamps?.firstPhotoAddedAt ||
    update.locationCapturedAt ||
    update.date ||
    null;
}

function relativeDays(value: string, now: Date, projectTimeZone?: string | null) {
  return daysUntilDate(value, now, projectTimeZone || undefined);
}

function dueWindowLabel(days: number | null) {
  if (days === null) return 'missing a reliable finish date';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `due in ${days} day${days === 1 ? '' : 's'}`;
}

function signalLabel(signal: PIEScheduleFieldSignal) {
  if (signal === 'in_progress') return 'work still in progress';
  if (signal === 'complete') return 'possible completion';
  if (signal === 'blocked') return 'blocked or waiting work';
  if (signal === 'issue') return 'an open issue';
  return 'an uncertain field condition';
}

function reconciliationSummary({
  scheduleItemCount,
  matchedItemCount,
  warningCount,
  unmatchedUrgentItemCount,
}: {
  scheduleItemCount: number;
  matchedItemCount: number;
  warningCount: number;
  unmatchedUrgentItemCount: number;
}) {
  if (scheduleItemCount === 0) return 'No schedule activities are available for field reconciliation.';
  if (warningCount === 0) {
    return `${matchedItemCount} of ${scheduleItemCount} schedule activities have task-specific field evidence, with no reconciliation warnings detected.`;
  }
  return `${warningCount} schedule reconciliation warning${warningCount === 1 ? '' : 's'} detected; ${matchedItemCount} activities matched field evidence and ${unmatchedUrgentItemCount} urgent activities lack recent task-specific evidence.`;
}

function dedupeWarnings(warnings: PIEScheduleReconciliationWarning[]) {
  const seen = new Set<string>();
  return warnings.filter(warning => {
    const key = `${warning.type}:${warning.scheduleItemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scheduleLabel(item: ScheduleItem) {
  return item.taskName.trim() || item.milestone.trim() || 'Untitled schedule activity';
}

function boundedPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function sameName(left: string, right: string) {
  return normalize(left) === normalize(right);
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
}

function timestamp(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function shorten(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
