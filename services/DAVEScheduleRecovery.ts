import type { ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { mergeProjectControlsRevisions } from './VitruviusProjectControls';
import { scheduleTaskEarlierIds, scheduleTaskEarlierIdsOfBoth, scheduleTaskProjectKey } from './ScheduleTaskRevisions';
import { laterScheduleImportSourceRow, scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import {
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleProgressCarriedFrom,
  scheduleProgressIsManagers,
  scheduleProgressJudgedAt,
} from './ScheduleProgressSource';

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
  return progressCarriedToRevisedTasks(reconcileDAVEScheduleRecords([...combined.values()]));
}

/**
 * Whole-app audit A6 pass 22 M1 (1 Oct 2026, older): master F was current on
 * both devices; the phone approved master G, which moved Framing to new
 * dates, so Framing got a new row answering to the old one
 * (revisedFromTaskIds) and the old row was hidden. The iPad, offline since
 * before G, had David's 30% on the row it showed, the old one. After Full
 * Sync both devices showed Framing at 0%, Not Started, and the report said
 * only that the finish changed: the 30% stayed on the hidden old row. Set
 * Active and Make Current carry progress from the row a schedule hides to
 * the row it shows (ScheduleImportMerge), but Full Sync had no carry. The
 * newest row that answers to a row holding David's own percent now takes it
 * by the same rule (scheduleProgressCarriedFrom): only when it was stated
 * after the newest row's, never lowering a higher percent a file gave (a
 * newer lookahead's percent stands), confirmed as that rule confirms it, so
 * a second Full Sync either way changes nothing. A newest row no file has
 * restated since its own import (the 30% entered before G, not yet synced)
 * is weighed as that import weighs a percent of David's: its file's percent
 * stands only above his, whenever he entered it.
 */
function progressCarriedToRevisedTasks(records: ScheduleItem[]): ScheduleItem[] {
  const answering = new Map<string, ScheduleItem[]>();
  records.forEach(record => scheduleTaskEarlierIds(record).forEach(id => {
    const key = normalized(id);
    answering.set(key, [...(answering.get(key) || []), record]);
  }));
  if (answering.size === 0) return records;
  // Each row's latest David percent from the rows it answers to (it alone, as the newest row of the task).
  const from = new Map<ScheduleItem, ScheduleItem>();
  records.forEach(earlier => {
    const moved = scheduleProgressIsManagers(earlier) ? answering.get(normalized(earlier.id)) : undefined;
    if (!moved) return;
    const superseded = new Set(moved.flatMap(scheduleTaskEarlierIds).map(normalized));
    const newest = moved.filter(record => !superseded.has(normalized(record.id)));
    if (newest.length !== 1) return;
    const taken = from.get(newest[0]);
    if (!taken || timestamp(scheduleProgressJudgedAt(earlier)) > timestamp(scheduleProgressJudgedAt(taken))) from.set(newest[0], earlier);
  });
  if (from.size === 0) return records;
  const now = new Date().toISOString();
  return records.map(record => {
    const earlier = from.get(record);
    // A row no file restated since its own import holds what that import gave: weighed as the import weighs it.
    const untouched = scheduleItemImportBatchIds(record).length <= 1 && !record.lookaheadOverlay;
    return (earlier && scheduleProgressCarriedFrom(earlier, record, now, { fileProgressDated: !untouched })) || record;
  });
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
  // What a master said under a lookahead, from the copy that has it (A7 pass 24 L-3).
  // With David's own later percent on the other copy's task (A6 pass 22 L1).
  const lookaheadOverlay = lookaheadNoteWithPercentOf(lookaheadNoteOfBoth(base, base === local ? cloud : local), base, base === local ? cloud : local);
  return {
    ...baseRecord,
    ...(lookaheadOverlay !== base.lookaheadOverlay ? { lookaheadOverlay } : {}),
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

/**
 * Whole-app audit A7 pass 24 L-3 (1 Oct 2026): a master that lists a task on
 * the dates a lookahead gave it restates the task in place: its lookahead
 * note takes the master's dates and marks the earlier lookaheads' dates
 * replaced (A6 pass 19 M1, A5 pass 20 P1), and updatedAt stays, as for the
 * imports it joins (alsoImportedInBatchIds). Full Sync on a device still
 * holding the copy from before the master tied, kept that copy's note and
 * wrote it to the cloud: no marks and the old master's dates, so deleting
 * the lookaheads showed the replaced dates again. Of two copies of a note,
 * the base copy's stands, with the marks the other copy has on the same
 * lookaheads (same dates); when the other copy alone has seen a master (it
 * has marks the base lacks, and lacks none the base has), it also gives what
 * that master says (the master's dates, percent and who stated it). The same
 * note when the other copy adds nothing.
 *
 * Whole-app audit A5 pass 21 R2 (1 Oct 2026, caused by a3239e3): David's 40%,
 * then lookahead L1; on the phone master G restated Framing and marked L1; on
 * the iPad, without G's copy, David entered 50% and approved L2 at 70%. Full
 * Sync took the phone's percent with G's dates, David's older 40% and who
 * stated it, so deleting L2 gave back 40%, not 50%, and the merged row went
 * to the cloud. The other copy still gives the master's dates, the master
 * file's own percent and the marks; the percent noted, its status and who
 * stated it when stay with the base copy when it confirmed them later
 * (masterProgressConfirmedAt) than the other copy's note and than David's
 * own percent on the other copy; otherwise the other copy's, as before. A
 * file's percent that a master only the other copy saw restated carries no
 * time of its own: the other copy's, as before, unless it is at or below
 * David's own percent the base copy notes (Q22).
 *
 * Whole-app audit A5 pass 22 L2 (1 Oct 2026, from a3239e3; R2 left it
 * open): David's 40%, then lookahead L1. On the iPad David entered 50%
 * (10 Sep) and approved L2 at 70%; on the phone, which never saw the 50%,
 * master G (14 Sep) listed Framing on L1's dates at 45%, over the phone's
 * 40%, so its note kept David's rank with "Schedule update" as who confirmed
 * it. Full Sync weighed the two by time (14 Sep after 10 Sep) and kept G's
 * 45%, so deleting L2 showed 45% on both devices. A master's percent that
 * stands over David's ("Schedule update") is now weighed against David's own
 * percent on the other copy as Q22 says: only above it, whichever copy holds
 * it (the base copy holding K's 45% over David's 50% on the other copy kept
 * 45% too). David's own later percent still stands as before.
 */
function lookaheadNoteOfBoth(base: ScheduleItem, other: ScheduleItem): ScheduleItem['lookaheadOverlay'] {
  const own = base.lookaheadOverlay;
  const theirs = other.lookaheadOverlay;
  if (!own || !theirs || !Array.isArray(own.lookaheads) || !Array.isArray(theirs.lookaheads)) return own;
  const entryKey = (entry: { batchId: string; startDate: string; finishDate: string }) =>
    `${normalized(entry.batchId)}\n${text(entry.startDate)}\n${text(entry.finishDate)}`;
  const marked = new Map(theirs.lookaheads.filter(entry => entry.datesReplacedByMaster).map(entry => [entryKey(entry), entry.datesReplacedByMaster!]));
  const gained = own.lookaheads.filter(entry => !entry.datesReplacedByMaster && marked.has(entryKey(entry)));
  if (gained.length === 0) return own;
  const theirKeys = new Set(theirs.lookaheads.map(entryKey));
  const behind = own.lookaheads.some(entry => entry.datesReplacedByMaster && theirKeys.has(entryKey(entry)) && !marked.has(entryKey(entry)));
  const { lookaheads: _theirs, ...theirMaster } = theirs;
  // A percent this copy confirmed later than the other copy's note, and than David's own percent on the other
  // copy, stays with who stated it (A5 pass 21 R2). When the other copy notes a file's percent that a master only
  // it saw stated, that master stamped no time to compare: the other copy's, as before, unless it is at or below
  // David's own here (Q22: never below what David entered).
  const ownAt = timestamp(own.masterProgressConfirmedAt);
  const masterStatedUnseen = theirs.masterProgressSource !== 'project_manager' &&
    theirs.masterFilePercentComplete !== own.masterFilePercentComplete;
  const ownIsDavids = own.masterProgressSource === 'project_manager' && own.masterProgressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER;
  // A master's percent over David's, which keeps his rank ("Schedule update"), stands against David's own on the
  // other copy only above it, whichever copy holds it (A5 pass 22 L2, Q22).
  const ownPercent = boundedPercent(Number(own.masterPercentComplete));
  const theirPercent = boundedPercent(Number(theirs.masterPercentComplete));
  const theirsIsDavids = theirs.masterProgressSource === 'project_manager' && theirs.masterProgressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER;
  const theirsMastersBelowOwn = !theirsIsDavids && theirs.masterProgressSource === 'project_manager' && ownIsDavids && theirPercent <= ownPercent;
  const ownMastersBelowTheirs = !ownIsDavids && own.masterProgressSource === 'project_manager' && theirsIsDavids && ownPercent <= theirPercent;
  const ownPercentNewer = ownAt > (scheduleProgressIsManagers(other) ? timestamp(scheduleProgressJudgedAt(other)) : 0) && (masterStatedUnseen
    ? ownIsDavids && theirPercent <= ownPercent
    : (ownAt > timestamp(theirs.masterProgressConfirmedAt) || theirsMastersBelowOwn) && !ownMastersBelowTheirs);
  const {
    masterPercentComplete: _percent, masterStatus: _status, masterProgressSource: _source,
    masterProgressConfirmedBy: _by, masterProgressConfirmedAt: _at, ...theirMasterFile
  } = theirMaster;
  return {
    ...own,
    ...(behind ? {} : ownPercentNewer ? theirMasterFile : theirMaster),
    lookaheads: own.lookaheads.map(entry => gained.includes(entry) ? { ...entry, datesReplacedByMaster: marked.get(entryKey(entry)) } : entry),
  };
}

/**
 * Whole-app audit A6 pass 22 L1 (1 Oct 2026, older; the gap A5 pass 21 R2
 * left): David's 40%, then lookahead L1 on both devices. The phone recorded
 * 60% (16 Sep); the offline iPad approved L2 at 70% (17 Sep), and its note
 * took the 40% it held then. Full Sync kept the iPad's note, never weighing
 * David's percent on the phone's task itself, so deleting L2 gave 40% ("moved
 * from 70% to 40% complete"), not 60%; with master G on the phone and 50% on
 * the iPad, also 40%. The merged note now keeps David's latest own percent
 * known on either copy: the other copy's note's, when he stated it later
 * than the merged note's percent was stated, and the other copy's task's,
 * when this copy approved a lookahead the other never saw (its note was
 * brought up to this copy's percent then) and sync orders it after this
 * copy's own percent. The note's dates, marks and the lookaheads' percents
 * stay; the same note otherwise. Of two copies of a note, both devices end
 * with the same one.
 */
function lookaheadNoteWithPercentOf(
  note: ScheduleItem['lookaheadOverlay'],
  base: ScheduleItem,
  other: ScheduleItem,
): ScheduleItem['lookaheadOverlay'] {
  if (!note || !Array.isArray(note.lookaheads)) return note;
  const theirs = other.lookaheadOverlay;
  type Stated = Pick<ScheduleLookaheadOverlay, 'masterPercentComplete' | 'masterStatus' | 'masterProgressSource' | 'masterProgressConfirmedBy' | 'masterProgressConfirmedAt'>;
  const candidates: Stated[] = [];
  // David's own percent on the other copy's note.
  if (theirs && theirs.masterProgressSource === 'project_manager' && theirs.masterProgressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER) {
    candidates.push({
      masterPercentComplete: theirs.masterPercentComplete, masterStatus: theirs.masterStatus, masterProgressSource: theirs.masterProgressSource,
      masterProgressConfirmedBy: theirs.masterProgressConfirmedBy, masterProgressConfirmedAt: theirs.masterProgressConfirmedAt,
    });
  }
  // David's own percent on the other copy's task, later than this copy's own (as sync orders his percents), when this
  // copy approved a lookahead the other never saw (its note was brought up to this copy's percent then).
  const theirBatches = new Set((theirs?.lookaheads || []).map(entry => normalized(entry.batchId)));
  const unseen = note.lookaheads.some(entry => !theirBatches.has(normalized(entry.batchId)));
  if (unseen && scheduleProgressIsManagers(other) && (!scheduleProgressIsManagers(base) || compareProgressAuthority(other, base) > 0)) {
    candidates.push({
      masterPercentComplete: boundedPercent(Number(other.percentComplete)), masterStatus: other.status,
      masterProgressSource: other.progressSource ?? null, masterProgressConfirmedBy: other.progressConfirmedBy ?? null,
      masterProgressConfirmedAt: scheduleProgressJudgedAt(other),
    });
  }
  const latest = candidates.reduce<Stated | null>((best, candidate) =>
    !best || timestamp(candidate.masterProgressConfirmedAt) > timestamp(best.masterProgressConfirmedAt) ? candidate : best, null);
  if (!latest || timestamp(latest.masterProgressConfirmedAt) <= timestamp(note.masterProgressConfirmedAt)) return note;
  // A file's percent with no time of its own stands over a lower one of David's, as above (A5 pass 21 R2, Q22).
  if (!note.masterProgressConfirmedAt && note.masterProgressSource !== 'project_manager' &&
    boundedPercent(Number(note.masterPercentComplete)) > boundedPercent(Number(latest.masterPercentComplete))) return note;
  if ((Object.keys(latest) as Array<keyof Stated>).every(field => note[field] === latest[field])) return note;
  return { ...note, ...latest };
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
