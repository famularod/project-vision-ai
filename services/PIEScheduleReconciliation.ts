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
} from './DAVEAssertionParser';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';
import { reconcileDAVEScheduleRecords } from './DAVEScheduleRecovery';

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
  if (item.progressSource === 'project_manager') return true;

  // Older records did not preserve progress provenance. A saved in-progress
  // percentage is still an explicit professional judgment, not a DAVE guess.
  return item.status === 'In Progress' && boundedPercent(item.percentComplete) > 0;
}

export function scheduleCompletionOverridesFieldMatch(
  item: ScheduleItem,
  match: Pick<PIEScheduleFieldMatch, 'capturedAt'> | null,
) {
  if (!scheduleProgressIsComplete(item)) return false;

  const verification = item.completionVerification;
  const pmVerified = verification?.status === 'pm_verified';
  const pmRecorded = item.progressSource === 'project_manager';
  if (!pmVerified && !pmRecorded) return false;

  const completionAt = timestamp(
    pmVerified
      ? verification?.verifiedAt || verification?.reportedAt || null
      : item.progressConfirmedAt || item.importedAt || item.createdAt || null,
  );
  const fieldAt = timestamp(match?.capturedAt || null);

  // A PM's completion decision is authoritative when chronology is unavailable.
  // When both timestamps exist, only genuinely newer field evidence can reopen it.
  if (completionAt === 0 || fieldAt === 0) return true;
  return completionAt >= fieldAt;
}

const DAY_MS = 86_400_000;
const RECENT_EVIDENCE_DAYS = 14;
const NEAR_TERM_DAYS = 14;
const MATCH_BASIS_RANK: Record<PIEScheduleFieldMatch['matchBasis'], number> = {
  explicit_task_id: 0,
  stored_task_name: 1,
  semantic_fallback: 2,
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
  const activeSchedules = scheduleSources
    .filter(document => document.isCurrent)
    .sort(compareScheduleDocumentAuthority)
    .slice(0, 1);
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
  const activeBatchIds = new Set(activeSchedules.map(document => normalize(document.importBatchId || '')).filter(Boolean));
  const knownBatchIds = new Set(scheduleSources.map(document => normalize(document.importBatchId || '')).filter(Boolean));
  const activeDocumentIds = new Set(activeSchedules.map(document => normalize(document.id)).filter(Boolean));
  const knownDocumentIds = new Set(scheduleSources.map(document => normalize(document.id)).filter(Boolean));

  const selectedItems = scheduleSources.length === 0
    ? selectLatestImportedScheduleBatches(scheduleItems)
    : activeSchedules.length === 0
      ? scheduleItems.filter(item =>
          !normalize(item.importedFrom || '') &&
          !normalize(item.importBatchId || '') &&
          !normalize(item.sourceDocumentId || ''))
    : scheduleItems.filter(item => {
    const sourceDocumentId = normalize(item.sourceDocumentId || '');
    if (sourceDocumentId && knownDocumentIds.has(sourceDocumentId)) {
      return activeDocumentIds.has(sourceDocumentId);
    }
    const importBatchId = normalize(item.importBatchId || '');
    if (importBatchId && knownBatchIds.has(importBatchId)) {
      return activeBatchIds.has(importBatchId);
    }
    const importedFrom = normalize(item.importedFrom || '');
    return !importedFrom ||
      !knownScheduleSources.has(importedFrom) ||
      activeScheduleSources.has(importedFrom);
  });

  return dedupeScheduleItems(selectedItems);
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

export function reconcileCurrentScheduleDocuments<T extends ReferenceDocument>(
  documents: readonly T[],
): T[] {
  const winner = documents
    .filter(document => scheduleDocumentIsScheduleLike(document) && document.isCurrent)
    .sort(compareScheduleDocumentAuthority)[0];
  if (!winner) return [...documents];
  return documents.map(document => scheduleDocumentIsScheduleLike(document)
    ? { ...document, isCurrent: document.id === winner.id }
    : document);
}

export function scheduleDocumentIsScheduleLike(document: ReferenceDocument): boolean {
  if (document.category === 'Schedules') return true;
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

  scopedScheduleItems.forEach(item => {
    const itemMatches = scopedUpdates
      .map(update => matchScheduleItemToUpdate(item, update))
      .filter((match): match is PIEScheduleFieldMatch => Boolean(match))
      .sort((left, right) =>
        MATCH_BASIS_RANK[left.matchBasis] - MATCH_BASIS_RANK[right.matchBasis] ||
        right.score - left.score ||
        timestamp(right.capturedAt) - timestamp(left.capturedAt),
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
          summary: `${scheduleLabel(item)} is marked Complete, but the best task-specific field update indicates ${signalLabel(bestMatch.signal)}.`,
          severity: bestMatch.signal === 'blocked' || bestMatch.signal === 'issue' ? 'critical' : 'high',
          suggestedAction: 'Verify the field condition before relying on the Complete schedule status.',
        }));
      }

      if (
        !scheduleProgressIsComplete(item) &&
        bestMatch.signal === 'complete'
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
        bestMatch.signal === 'in_progress'
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
): PIEScheduleFieldMatch | null {
  const explicitScheduleItemId = update.scheduleItemId?.trim() || '';
  const explicitTaskMatched = Boolean(
    explicitScheduleItemId && explicitScheduleItemId === item.id,
  );
  if (explicitScheduleItemId && !explicitTaskMatched) return null;

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
  const signal = fieldSignal(scopedEvidence.signalText, scopedEvidence.photos);

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
  const photoEvidence = photos.flatMap(photo => [
      photo.caption,
      photo.category,
      photo.actionRequired,
      photo.photoIntelligence?.currentObservation,
      photo.photoIntelligence?.visibleChange,
      photo.photoIntelligence?.possibleProgress,
      ...(photo.photoIntelligence?.possibleConcerns || []),
    ]);
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
  text: string,
  photos: ProjectUpdate['photos'],
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
  if (completion === 'not_complete') return 'in_progress';
  if (completion === 'complete') return 'complete';
  if (implementation === 'implemented' || implementation === 'in_progress') {
    return 'in_progress';
  }
  return 'unknown';
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
