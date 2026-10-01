import type { ScheduleItem } from '../types';
import { mergeProjectControlsRevisions } from './VitruviusProjectControls';
import { scheduleTaskEarlierIdsOfBoth, scheduleTaskProjectKey } from './ScheduleTaskRevisions';
import { laterScheduleImportSourceRow } from './ScheduleImportProvenance';

const SCHEDULE_STATUSES = new Set<ScheduleItem['status']>([
  'Not Started',
  'In Progress',
  'Waiting',
  'Complete',
]);

/**
 * Cloud schedule rows are operational records. Do not turn incomplete legacy
 * payloads into live 0% tasks by applying the UI normalizer's defaults.
 */
export function isDAVESafeCloudScheduleRecord(value: unknown): value is ScheduleItem {
  if (!isRecord(value)) return false;
  const projectName = text(value.projectName) || text(value.scheduleProjectName);
  return Boolean(
    text(value.id) &&
    text(value.taskName) &&
    projectName &&
    SCHEDULE_STATUSES.has(value.status as ScheduleItem['status']) &&
    typeof value.percentComplete === 'number' &&
    Number.isFinite(value.percentComplete) &&
    value.percentComplete >= 0 &&
    value.percentComplete <= 100 &&
    (
      value.progressSource === undefined ||
      value.progressSource === null ||
      value.progressSource === 'project_manager' ||
      value.progressSource === 'schedule_import'
    )
  );
}

/**
 * Reconciles repeated imports without conflating legitimate same-named work in
 * different projects or areas. PM-confirmed progress always outranks imports;
 * otherwise the newer, better-scoped import wins.
 */
export function reconcileDAVEScheduleRecords(
  records: readonly ScheduleItem[],
): ScheduleItem[] {
  const unique = uniqueScheduleRecords(records);
  // Whole-app audit A5 pass 17 L2 (1 Oct 2026): every saved task was compared
  // with every other, about 1.6 s at 3,300 saved tasks, at approval, startup,
  // cloud apply and every shown-task selection. A copy only ever supersedes
  // one from the same file with the same task name (each check below
  // requires both), so the tasks are indexed by those first; the result is
  // the same.
  const byFileAndTask = new Map<string, ScheduleItem[]>();
  unique.forEach(record => {
    const key = fileAndTaskKey(record);
    const list = byFileAndTask.get(key);
    if (list) list.push(record); else byFileAndTask.set(key, [record]);
  });
  return unique.filter(record => !isSuperseded(record, byFileAndTask.get(fileAndTaskKey(record)) || []));
}

/**
 * The same result by comparing every saved task with every other, as before
 * A5 pass 17 L2: the reference the index is tested against. Not used by the
 * app.
 */
export function reconcileDAVEScheduleRecordsUnindexed(
  records: readonly ScheduleItem[],
): ScheduleItem[] {
  const unique = uniqueScheduleRecords(records);
  return unique.filter(record => !isSuperseded(record, unique));
}

function uniqueScheduleRecords(records: readonly ScheduleItem[]): ScheduleItem[] {
  const byId = new Map<string, ScheduleItem>();
  records.forEach(record => {
    const id = normalized(record.id);
    if (!id) return;
    const current = byId.get(id);
    if (!current || compareScheduleAuthority(record, current) >= 0) {
      byId.set(id, record);
    }
  });
  return [...byId.values()];
}

function fileAndTaskKey(record: ScheduleItem): string {
  return `${normalized(record.importedFrom)}\n${normalizedTask(record.taskName)}`;
}

function isSuperseded(record: ScheduleItem, candidates: readonly ScheduleItem[]): boolean {
  return isSupersededLegacyAlias(record, candidates) ||
    isSupersededByPMRecord(record, candidates) ||
    isSupersededAssignedLegacyDuplicate(record, candidates);
}

/**
 * Startup recovery is intentionally local-first. A present local key — even
 * an empty array — represents device truth and cannot receive cloud-only rows
 * automatically. Explicit Sync may opt in to safe cloud-only additions.
 */
export function recoverDAVEScheduleRecords({
  local,
  cloud,
  deletedIds = [],
  allowCloudOnly,
}: {
  local: readonly ScheduleItem[];
  cloud: readonly ScheduleItem[];
  deletedIds?: readonly string[];
  allowCloudOnly: boolean;
}): ScheduleItem[] {
  const deleted = new Set(deletedIds.map(normalized).filter(Boolean));
  const localRecords = local.filter(record => !deleted.has(normalized(record.id)));
  if (!allowCloudOnly) return reconcileDAVEScheduleRecords(localRecords);

  const combined = new Map<string, ScheduleItem>();
  cloud.forEach(record => {
    const id = normalized(record.id);
    if (id && !deleted.has(id)) combined.set(id, record);
  });
  localRecords.forEach(record => {
    const id = normalized(record.id);
    const cloudRecord = combined.get(id);
    if (!cloudRecord) {
      combined.set(id, record);
      return;
    }
    combined.set(id, mergeScheduleRevisions(record, cloudRecord));
  });
  return reconcileDAVEScheduleRecords([...combined.values()]);
}

/**
 * Select only local task revisions that would actually change cloud truth.
 * Recovery may return cloud-only rows so another device can hydrate them; it
 * must never cause those same rows to be written back during Full Sync.
 */
export function daveScheduleItemsNeedingCloudUpload({
  local,
  cloud,
  deletedIds = [],
}: {
  local: readonly ScheduleItem[];
  cloud: readonly ScheduleItem[];
  deletedIds?: readonly string[];
}): ScheduleItem[] {
  const deleted = new Set(deletedIds.map(normalized).filter(Boolean));
  const cloudById = new Map(
    cloud
      .map(record => [normalized(record.id), record] as const)
      .filter(([id]) => Boolean(id) && !deleted.has(id)),
  );

  return local.flatMap(record => {
    const id = normalized(record.id);
    if (!id || deleted.has(id)) return [];
    const remote = cloudById.get(id);
    if (!remote) return [record];
    const authoritative = recoverDAVEScheduleRecords({
      local: [record],
      cloud: [remote],
      allowCloudOnly: true,
    }).find(candidate => normalized(candidate.id) === id);
    if (!authoritative) return [];
    return stableMeaning(authoritative) === stableMeaning(remote)
      ? []
      : [authoritative];
  });
}

/**
 * A task note and PM progress can be changed independently on different
 * devices. The shared row has one `updatedAt`, so choosing the entire newest
 * row would let a note-only edit roll back newer progress. Keep the newest
 * authorized row as the base, but preserve the independently newer progress
 * confirmation.
 */
function mergeScheduleRevisions(
  local: ScheduleItem,
  cloud: ScheduleItem,
): ScheduleItem {
  const base = compareScheduleAuthority(local, cloud) >= 0 ? local : cloud;
  const noteSource = compareRecordRevision(local, cloud) >= 0 ? local : cloud;
  const progressSource = compareProgressAuthority(local, cloud) >= 0 ? local : cloud;

  const alsoImportedInBatchIds = [...new Set([
    ...(local.alsoImportedInBatchIds || []),
    ...(cloud.alsoImportedInBatchIds || []),
  ])];
  // The row its latest import gave it, from whichever copy has it (A7 pass 22 L-3).
  const alsoImportedSourceRow = laterScheduleImportSourceRow(base, base === local ? cloud : local);
  // Every id either copy knows the task had before a new master moved it (A10 pass 5 M1).
  const revisedFromTaskIds = scheduleTaskEarlierIdsOfBoth(base, base === local ? cloud : local);
  // When the manager judged a percent given back later goes with that percent (A10 pass 5 L1).
  const { progressJudgment: _baseJudgment, ...baseRecord } = base;
  return {
    ...baseRecord,
    notes: noteSource.notes,
    status: progressSource.status,
    percentComplete: progressSource.percentComplete,
    progressSource: progressSource.progressSource,
    progressConfirmedAt: progressSource.progressConfirmedAt,
    progressConfirmedBy: progressSource.progressConfirmedBy,
    ...(progressSource.progressJudgment ? { progressJudgment: progressSource.progressJudgment } : {}),
    completionVerification: progressSource.completionVerification,
    projectControls: mergeScheduleProjectControls(local, cloud, base),
    // Every import either copy knows the task belongs to (whole-app audit A5 pass 2).
    ...(alsoImportedInBatchIds.length > 0 ? { alsoImportedInBatchIds } : {}),
    ...(alsoImportedSourceRow ? { alsoImportedSourceRow } : {}),
    ...(revisedFromTaskIds.length > 0 ? { revisedFromTaskIds } : {}),
  };
}

function stableMeaning(value: ScheduleItem) {
  return JSON.stringify(sortRecord(value));
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecord(entry)]),
  );
}

function mergeScheduleProjectControls(
  local: ScheduleItem,
  cloud: ScheduleItem,
  base: ScheduleItem,
) {
  if (!local.projectControls && !cloud.projectControls) {
    return base.projectControls;
  }
  if (!local.projectControls) return cloud.projectControls;
  if (!cloud.projectControls) return local.projectControls;
  return mergeProjectControlsRevisions(
    local.projectControls,
    cloud.projectControls,
  );
}

function compareRecordRevision(left: ScheduleItem, right: ScheduleItem) {
  const authorityDifference = scheduleAuthorityRank(left) - scheduleAuthorityRank(right);
  if (authorityDifference !== 0) return authorityDifference;
  return recordRevisionTimestamp(left) - recordRevisionTimestamp(right);
}

function compareProgressAuthority(left: ScheduleItem, right: ScheduleItem) {
  const leftAuthority = scheduleAuthorityRank(left);
  const rightAuthority = scheduleAuthorityRank(right);
  const timeDifference = progressTimestamp(left) - progressTimestamp(right);
  // A later explicit PM correction may reopen an earlier PM verification.
  if (leftAuthority > 0 && rightAuthority > 0 && timeDifference !== 0) {
    return timeDifference;
  }

  const authorityDifference = leftAuthority - rightAuthority;
  if (authorityDifference !== 0) return authorityDifference;
  if (timeDifference !== 0) return timeDifference;
  return compareScheduleAuthority(left, right);
}

function isSupersededLegacyAlias(
  record: ScheduleItem,
  records: readonly ScheduleItem[],
) {
  const source = normalized(record.importedFrom);
  const task = normalizedTask(record.taskName);
  if (!source || !task || scheduleAuthorityRank(record) > 0) return false;

  const project = projectKey(record);
  const area = normalized(record.locationName);
  const recordTime = scheduleTimestamp(record);

  return records.some(candidate => {
    if (candidate.id === record.id) return false;
    if (normalized(candidate.importedFrom) !== source) return false;
    if (normalizedTask(candidate.taskName) !== task) return false;
    const candidateAuthority = scheduleAuthorityRank(candidate);
    const recordAuthority = scheduleAuthorityRank(record);
    if (candidateAuthority < recordAuthority) return false;
    if (
      candidateAuthority === recordAuthority &&
      !isLowInformationLegacyAlias(record) &&
      scheduleTimestamp(candidate) < recordTime
    ) return false;

    const candidateProject = projectKey(candidate);
    const candidateArea = normalized(candidate.locationName);
    if (!sameImportedOccurrence(candidate, record, true)) return false;
    if (!project) return Boolean(candidateProject);
    return candidateProject === project && !area && Boolean(candidateArea);
  });
}

function isSupersededByPMRecord(
  record: ScheduleItem,
  records: readonly ScheduleItem[],
) {
  if (scheduleAuthorityRank(record) > 0 || !normalized(record.importedFrom)) return false;
  return records.some(candidate =>
    candidate.id !== record.id &&
    scheduleAuthorityRank(candidate) > scheduleAuthorityRank(record) &&
    sameAssignedScope(candidate, record) &&
    sameImportedOccurrence(candidate, record),
  );
}

function isSupersededAssignedLegacyDuplicate(
  record: ScheduleItem,
  records: readonly ScheduleItem[],
) {
  if (
    !normalized(record.importedFrom) ||
    !projectKey(record) ||
    normalized(record.importBatchId) ||
    normalized(record.sourceDocumentId)
  ) return false;
  return records.some(candidate =>
    candidate.id !== record.id &&
    !normalized(candidate.importBatchId) &&
    !normalized(candidate.sourceDocumentId) &&
    sameAssignedScope(candidate, record) &&
    sameImportedOccurrence(candidate, record) &&
    compareScheduleAuthority(candidate, record) > 0,
  );
}

function sameAssignedScope(left: ScheduleItem, right: ScheduleItem) {
  return projectKey(left) === projectKey(right) &&
    normalized(left.locationName) === normalized(right.locationName);
}

/**
 * The app project a row belongs to, the schedule's root only when it names
 * none (whole-app audit round 2, A5 pass 11 M-a, 30 Sep 2026): a Microsoft
 * Project master files Harbor North's and Harbor South's rows under one root
 * summary row, and both keep that root as scheduleProjectName. Keyed by the
 * root, both buildings' "Install HVAC" on the same dates were one task, so
 * once David entered 40% on North's, South's was dropped as superseded on
 * every device. The same key as the merge and the delete (A8 pass 9).
 */
function projectKey(record: ScheduleItem) {
  return scheduleTaskProjectKey(record);
}

function sameImportedOccurrence(
  left: ScheduleItem,
  right: ScheduleItem,
  allowOneSidedLegacyProvenance = false,
) {
  if (
    normalized(left.importedFrom) !== normalized(right.importedFrom) ||
    normalizedTask(left.taskName) !== normalizedTask(right.taskName) ||
    normalized(left.startDate) !== normalized(right.startDate) ||
    normalized(left.finishDate) !== normalized(right.finishDate) ||
    normalized(left.milestone) !== normalized(right.milestone)
  ) {
    return false;
  }

  // Once immutable provenance exists, it is the activity boundary. Never
  // collapse otherwise identical rows from separate imports or documents.
  const leftBatch = normalized(left.importBatchId);
  const rightBatch = normalized(right.importBatchId);
  if (
    leftBatch !== rightBatch &&
    (!allowOneSidedLegacyProvenance || (leftBatch && rightBatch))
  ) return false;
  const leftDocument = normalized(left.sourceDocumentId);
  const rightDocument = normalized(right.sourceDocumentId);
  if (
    leftDocument !== rightDocument &&
    (!allowOneSidedLegacyProvenance || (leftDocument && rightDocument))
  ) return false;
  return true;
}

function isLowInformationLegacyAlias(record: ScheduleItem) {
  return !projectKey(record) &&
    boundedPercent(record.percentComplete) === 0 && record.status === 'Not Started';
}

function compareScheduleAuthority(left: ScheduleItem, right: ScheduleItem) {
  const leftAuthority = scheduleAuthorityRank(left);
  const rightAuthority = scheduleAuthorityRank(right);
  const leftTime = scheduleTimestamp(left);
  const rightTime = scheduleTimestamp(right);

  // A later explicit PM correction may reopen an earlier PM verification.
  // Imported rows still cannot outrank any PM-authored judgment by recency.
  if (leftAuthority > 0 && rightAuthority > 0 && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  const authorityDifference = leftAuthority - rightAuthority;
  if (authorityDifference !== 0) return authorityDifference;

  const timeDifference = leftTime - rightTime;
  if (timeDifference !== 0) return timeDifference;

  const scopeDifference = scheduleScopeRank(left) - scheduleScopeRank(right);
  if (scopeDifference !== 0) return scopeDifference;

  const progressDifference = boundedPercent(left.percentComplete) - boundedPercent(right.percentComplete);
  if (progressDifference !== 0) return progressDifference;
  return normalized(left.id).localeCompare(normalized(right.id));
}

function scheduleAuthorityRank(record: ScheduleItem) {
  if (
    record.completionVerification?.status === 'pm_verified' &&
    record.status === 'Complete' && boundedPercent(record.percentComplete) === 100
  ) return 2;
  if (record.progressSource === 'project_manager') return 1;
  return 0;
}

function scheduleTimestamp(record: ScheduleItem) {
  const values = record.progressSource === 'project_manager'
    ? [
        record.updatedAt,
        record.progressConfirmedAt,
        record.completionVerification?.status === 'pm_verified'
          ? record.completionVerification.verifiedAt || record.completionVerification.reportedAt
          : null,
        record.importedAt,
        record.createdAt,
      ]
    : record.completionVerification?.status === 'pm_verified'
      ? [record.updatedAt, record.completionVerification.verifiedAt || record.completionVerification.reportedAt]
      : [record.updatedAt, record.importedAt, record.createdAt];
  return Math.max(0, ...values.map(value => {
    const parsed = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }));
}

function recordRevisionTimestamp(record: ScheduleItem) {
  return timestamp(record.updatedAt) ||
    timestamp(record.importedAt) ||
    timestamp(record.createdAt);
}

function progressTimestamp(record: ScheduleItem) {
  return Math.max(
    timestamp(record.progressConfirmedAt),
    record.completionVerification?.status === 'pm_verified'
      ? timestamp(
          record.completionVerification.verifiedAt ||
          record.completionVerification.reportedAt,
        )
      : 0,
    record.progressSource === 'schedule_import' ? timestamp(record.importedAt) : 0,
  );
}

function timestamp(value: unknown) {
  const parsed = value ? new Date(String(value)).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function scheduleScopeRank(record: ScheduleItem) {
  return Number(Boolean(projectKey(record))) * 2 +
    Number(Boolean(normalized(record.locationName)));
}

function boundedPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizedTask(value: unknown) {
  return normalized(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
