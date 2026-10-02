import type { ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { mergeProjectControlsRevisions } from './VitruviusProjectControls';
import { scheduleTaskEarlierIds, scheduleTaskEarlierIdsOfBoth, scheduleTaskProjectKey } from './ScheduleTaskRevisions';
import { laterScheduleImportSourceRow, scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import {
  SCHEDULE_CARRIED_PROGRESS_FIELDS,
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleManagersOwnPercent,
  scheduleManagersPercentUnderFileOfBoth,
  scheduleProgressCarriedFrom,
  scheduleProgressFlooredAtManagers,
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
  const copies = rowCopiesById([...local, ...cloud]);
  localRecords.forEach(record => {
    const id = normalized(record.id);
    const cloudRecord = combined.get(id);
    if (!cloudRecord) {
      combined.set(id, record);
      return;
    }
    combined.set(id, mergedWithCarriedProgressWeighedAgain(record, cloudRecord, copies, deleted));
  });
  return progressCarriedToRevisedTasks(reconcileDAVEScheduleRecords([...combined.values()]), deletedRowsHeld(local, cloud, deleted));
}

function rowCopiesById(records: readonly ScheduleItem[]): Map<string, ScheduleItem[]> {
  const copies = new Map<string, ScheduleItem[]>();
  records.forEach(record => {
    const id = normalized(record.id);
    if (id) copies.set(id, [...(copies.get(id) || []), record]);
  });
  return copies;
}

/**
 * Whole-app audit A7 pass 26 M-1 (1 Oct 2026): a percent carried from an
 * earlier row is that row's, not a statement of this row's own. As David's,
 * the carried copy outranked the cloud's whole, so its old notes, owner,
 * dates and lookahead note beat the other device's newer ones. A local copy
 * whose progress is the one an earlier row it answers to holds (its percent,
 * status, who stated it and when it was judged) is now merged with the
 * cloud's copy's progress instead, the copy edited later leading (the
 * cloud's when neither was); the carry then weighs that earlier row again
 * against the merged row (progressCarriedToRevisedTasks), so the percent
 * stays wherever its rule still holds and the cloud's newer edits stay with
 * it.
 */
function mergedWithCarriedProgressWeighedAgain(
  record: ScheduleItem,
  cloudRecord: ScheduleItem,
  copies: ReadonlyMap<string, readonly ScheduleItem[]>,
  deleted: ReadonlySet<string> = new Set(),
): ScheduleItem {
  // A copy changed here since the cloud's (a percent given back, an edit) is his word, weighed alone (A7 pass 29 L1).
  const carried = !changedHereSince(record, cloudRecord) && carriedProgressHeld(record, copies, deleted);
  if (!carried) return mergeScheduleRevisions(record, cloudRecord);
  const progress = Object.fromEntries(SCHEDULE_CARRIED_PROGRESS_FIELDS.map(field => [field, cloudRecord[field]]));
  const own = { ...record, ...progress } as ScheduleItem;
  // With the same progress, the copy edited later leads; the cloud's when neither was.
  const merged = recordRevisionTimestamp(own) > recordRevisionTimestamp(cloudRecord)
    ? mergeScheduleRevisions(own, cloudRecord)
    : mergeScheduleRevisions(cloudRecord, own);
  if (carried === 'from row') return merged;
  // Its earlier row is gone: the carried percent is weighed against the merged copy by the carry's rule, as the carry
  // weighs that row against it, and as its own upload weighs it against the cloud's copy (A7 pass 28 L).
  const weighed = !keepsHisPercentUnderFile(merged, record) &&
    scheduleProgressCarriedFrom(record, merged, merged.updatedAt ?? '', { fileProgressDated: restatedSinceImport(merged) });
  return weighed ? { ...weighed, progressCarriedFrom: record.progressCarriedFrom } : lookaheadFlooredAtManagersPercentOf(record, merged) ?? merged;
}

/**
 * Whole-app audit A7 pass 29 L1 (Low, caused by f81ccc1; with F's row kept,
 * from 30170fc): a carry put David's 30% on G's row and landed, and F was
 * deleted. Lookahead L stated 60% there. The phone, offline, deleted L, which
 * gave back his 30% with when he judged it, so the copy read as the carried
 * one again (the carry's mark, or F's row still holding the 30%). Back
 * online, the refresh or the startup cloud load ran before the upload,
 * weighed the copy as a carry and showed the cloud's 60%; a note or Sync Now
 * in that window put the 60% on every device. A copy changed on the device
 * after the cloud's copy last changed (a percent given back, an edit) is
 * David's word, waiting to go up: it is weighed alone, as Sync Now's upload
 * check weighs it (A7 pass 27 L2) and as its queued upload sends it. A
 * carried copy keeps the row's own stamp (withOwnStamp), so it reads newer
 * than the cloud's copy only when that copy has no stamp: no one has edited
 * the row, and his percent outranks the import's either way. Any other
 * carried copy is weighed as before.
 */
function changedHereSince(record: ScheduleItem, cloudRecord: ScheduleItem): boolean {
  return timestamp(record.updatedAt) > timestamp(cloudRecord.updatedAt);
}

/** Whether a copy's progress is David's from an earlier row it answers to (A7 pass 26 M-1). */
function holdsCarriedProgress(
  record: ScheduleItem,
  copies: ReadonlyMap<string, readonly ScheduleItem[]>,
  deleted: ReadonlySet<string> = new Set(),
): boolean {
  return carriedProgressHeld(record, copies, deleted) !== null;
}

/**
 * Whole-app audit A7 pass 28 L (Low, caused by b3d1970; the A7 pass 27 L2
 * fix, a735da5, did not cover it): the phone, offline, approved master G and
 * deleted F with its items while David's 30% on F's row went up from the
 * online iPad. The iPad heard G's row, then F's deletion over realtime, and
 * carried the 30% to G's row; it lost signal before that upload ran. The
 * phone then approved lookahead L stating 60% on new dates and typed a note.
 * Back online, the iPad's reconnect upload (or Retry Sync) rightly refused
 * the carry, but Sync Now sent the iPad's old copy whole over everything
 * (two Sync Nows did the same): a carried copy was known only by the earlier
 * row still holding that percent, and F's row was gone, so the copy read as
 * David's own word on G's row and outranked the cloud's. The carry now marks
 * the row it gives the percent to (progressCarriedFrom: that row and when
 * David judged the percent), and the mark goes with the percent. A copy whose
 * percent is still the marked one (David's, judged then), whose marked row
 * this sync knows as deleted and no longer has, is a carried copy: merged
 * with the cloud's copy's progress, then the carried percent weighed against
 * that by the carry's rule, as the carry's own upload weighs it, so a refused
 * carry leaves the cloud's copy, and one that still stands goes up with the
 * cloud's newer edits. A copy whose earlier row still holds the percent is
 * weighed as before ("from row"); any other copy, as before.
 */
function carriedProgressHeld(
  record: ScheduleItem,
  copies: ReadonlyMap<string, readonly ScheduleItem[]>,
  deleted: ReadonlySet<string>,
): 'from row' | 'marked' | null {
  if (!scheduleProgressIsManagers(record)) return null;
  const earlierIds = scheduleTaskEarlierIds(record).map(normalized);
  if (earlierIds.some(id => (copies.get(id) || []).some(earlier => progressTakenFrom(record, earlier)))) return 'from row';
  const mark = record.progressCarriedFrom;
  const marked = mark ? normalized(mark.taskId) : '';
  return marked && earlierIds.includes(marked) && deleted.has(marked) && !copies.has(marked) &&
    timestamp(mark!.judgedAt) === timestamp(scheduleProgressJudgedAt(record)) ? 'marked' : null;
}

/** Whether a row holds the progress David stated on an earlier row (the carry's, or an import's that kept it). */
function progressTakenFrom(row: ScheduleItem, earlier: ScheduleItem): boolean {
  return scheduleProgressIsManagers(earlier) &&
    boundedPercent(Number(row.percentComplete)) === boundedPercent(Number(earlier.percentComplete)) &&
    row.status === earlier.status &&
    (row.progressConfirmedBy ?? null) === (earlier.progressConfirmedBy ?? null) &&
    timestamp(scheduleProgressJudgedAt(row)) === timestamp(scheduleProgressJudgedAt(earlier));
}

/**
 * The deleted rows this device still holds and this sync drops (A5 pass 23
 * M), each with the cloud's copy merged in when it has one: they lend
 * David's percent to the newest row kept that answers to them, and are never
 * returned. Once dropped, a row lends nothing more.
 */
function deletedRowsHeld(local: readonly ScheduleItem[], cloud: readonly ScheduleItem[], deleted: ReadonlySet<string>): ScheduleItem[] {
  if (deleted.size === 0) return [];
  const cloudById = new Map(cloud.map(record => [normalized(record.id), record] as const));
  return local.flatMap(record => {
    const id = normalized(record.id);
    if (!deleted.has(id)) return [];
    const cloudRecord = cloudById.get(id);
    return [cloudRecord ? mergeScheduleRevisions(record, cloudRecord) : record];
  });
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
 *
 * Whole-app audit A6 pass 23 M1 (1 Oct 2026, older; the part of A6 pass 22
 * M1 left): the same 30%, entered on the offline iPad before G, was still
 * lost when Framing had an earlier lookahead both devices saw. G's new row
 * takes the task's lookahead note at its own import (A5 pass 8 L3), and any
 * note counted as a restatement since the import, so G's import time
 * outranked the 30%. Restated since its import now means what happened
 * after it (restatedSinceImport): a later file it also belongs to, or a
 * lookahead no master has replaced since; a note the import brought along
 * is not a statement.
 *
 * Whole-app audit A5 pass 23 L1 (1 Oct 2026, caused by 3035b7a): on one
 * device, David's 50% on F's row, then master G moved Framing at 100% and
 * master H moved it again at 10%. Approval showed 10% (G's 100% was a
 * file's, and a newer master replaces a file's percent either way, owner
 * answer Q32), but the next refresh or restart carried the 50% from F's row
 * past G's to H's, and the next Sync Now uploaded it. The same on two
 * devices, with the 50% on the iPad and G and H approved on the phone. A row
 * between the old row and the newest that holds a file's percent above
 * David's, stated after he judged his (fileStatedAbove; at first "at or
 * above", A5 pass 24 L1), now keeps
 * his percent from passing it: that file took his percent over there, as
 * approval does. A file percent below his there still lets it pass (A6 pass
 * 22 M1).
 *
 * Whole-app audit A5 pass 23 M (1 Oct 2026, older): the same 30% on the
 * offline iPad, and after approving G David deleted F with its items on the
 * phone or the web, as the delete question invites. F's row was dropped as
 * deleted before the carry ran, so both devices showed G's row at 0% and the
 * 30% was gone, with no notice. A deleted row this sync drops now lends
 * David's percent, by the same rule, to the newest row kept that answers to
 * it (G's row; or H's, when G was the one deleted); the deleted row itself
 * never comes back, and a row nothing answers to lends nothing. A percent
 * of his judged before the newest row's import does not pass a row between
 * that this device no longer has: what David or a file said there is gone,
 * and deleting a hidden master's rows must not bring back an older percent
 * of his that a later one, on a deleted row, had replaced (found by the A7
 * pass 26 comparisons). A percent he judged after that import is newer than
 * anything said there, and passes.
 *
 * Owner answer Q22 and the A5 recorded Low R-c (cab99c0) on Full Sync: a
 * lookahead never takes a task below the percent David entered himself
 * (lookaheadFlooredAtManagersPercentOf).
 *
 * Whole-app audit A7 pass 26 follow-up (Low, caused by dbf7192; owner answer
 * Q32, option b): a percent David entered on an old row that the other
 * device's newer row already held, as a file's, when he entered it changed
 * nothing on one device, so it does not carry; a newer master's percent
 * stands, below his too (enteredAsFileShowedIt). A lookahead is still
 * floored at it (owner answer Q22).
 */
function progressCarriedToRevisedTasks(records: ScheduleItem[], deleted: readonly ScheduleItem[] = []): ScheduleItem[] {
  // Only rows kept answer; a deleted row only lends its percent (A5 pass 23 M).
  const answering = new Map<string, ScheduleItem[]>();
  records.forEach(record => scheduleTaskEarlierIds(record).forEach(id => {
    const key = normalized(id);
    answering.set(key, [...(answering.get(key) || []), record]);
  }));
  if (answering.size === 0) return records;
  // Each row's latest David percent from the rows it answers to (it alone, as the newest row of the task).
  const known = new Map([...records, ...deleted].map(record => [normalized(record.id), record] as const));
  const from = new Map<ScheduleItem, ScheduleItem>();
  [...records, ...deleted].forEach(earlier => {
    const moved = scheduleProgressIsManagers(earlier) ? answering.get(normalized(earlier.id)) : undefined;
    if (!moved) return;
    const superseded = new Set(moved.flatMap(scheduleTaskEarlierIds).map(normalized));
    const newest = moved.filter(record => !superseded.has(normalized(record.id)));
    if (newest.length !== 1) return;
    // A percent judged before the newest row's import passes only rows between that this device still knows (A5 pass 23 M),
    // or whose word a later row between it knows holds as his own (A5 pass 24 L3).
    if (timestamp(scheduleProgressJudgedAt(earlier)) <= timestamp(newest[0].importedAt || newest[0].createdAt) &&
      rowsBetweenUnheard(rowsBetween(earlier, newest[0], known))) return;
    const taken = from.get(newest[0]);
    if (!taken || timestamp(scheduleProgressJudgedAt(earlier)) > timestamp(scheduleProgressJudgedAt(taken))) from.set(newest[0], earlier);
  });
  if (from.size === 0) return records;
  return records.map(record => {
    const earlier = from.get(record);
    if (!earlier) return record;
    // His percent there was the one a file had already given the task: no word of his to carry (A7 pass 26 follow-up, Q32 b).
    const noWordOfHis = enteredAsFileShowedIt(earlier, record, known);
    // A newer percent of his on a row between stands over this one there (A5 pass 24 L3).
    if (rowsBetween(earlier, record, known).some(row => row !== undefined && scheduleProgressIsManagers(row) &&
      timestamp(scheduleProgressJudgedAt(row)) > timestamp(scheduleProgressJudgedAt(earlier)))) return record;
    // A file that stated more than his percent after he judged it took the task over, row by row (A5 pass 23 L1, A5 pass 24 L1),
    // as did one whose percent replaced it, or a later one of his, there or on this row (A5 pass 25 L1).
    const takenOver = rowsBetween(earlier, record, known).some(row => row !== undefined &&
      (fileStatedAbove(row, earlier) || keepsHisPercentUnderFile(row, earlier))) || keepsHisPercentUnderFile(record, earlier);
    // A row no file restated since its own import holds what that import gave: weighed as the import weighs it.
    const carriedFrom = !noWordOfHis && !takenOver && scheduleProgressCarriedFrom(earlier, record, record.updatedAt ?? '', {
      fileProgressDated: restatedSinceImport(record),
    });
    // The row given his percent says where it came from, also once that row is deleted (A7 pass 28 L).
    const carried = (carriedFrom && { ...carriedFrom, progressCarriedFrom: { taskId: earlier.id, judgedAt: scheduleProgressJudgedAt(earlier) } }) ||
      lookaheadFlooredAtManagersPercentOf(earlier, record);
    if (!carried) return record;
    const stamped = withOwnStamp(carried, record);
    rowsTakingCarriedProgress.set(stamped, record);
    return stamped;
  });
}

/**
 * Whole-app audit A7 pass 26 L-2 (1 Oct 2026, caused by 3035b7a; A5 pass 23
 * L2 and A6 pass 23 L1 the same): the carried row was stamped with each
 * device's clock at each merge, so every refresh re-saved the task list, and
 * after a sync round the two devices' copies differed only in that stamp, so
 * the next sync moved the report's fingerprint once. The carried row keeps
 * the row's own stamp, the same on every device and at every merge: the
 * carry changes only its progress, which carries its own time (when David
 * judged it), so a copy carried later never reads as a newer edit of the
 * task's notes, owner, dates or lookahead note. A row no one edited since its
 * import has no stamp (approval and the web's upload add rows unstamped): it
 * is stamped one millisecond after its import and the carried percent, the
 * same everywhere. Stamped at its import, it tied with a copy of the same row
 * that a merge left unstamped, each device kept its own copy, and every Full
 * Sync wrote the row again (found by the A5 pass 23 reviewer's generator).
 */
function withOwnStamp(carried: ScheduleItem, record: ScheduleItem): ScheduleItem {
  if (typeof record.updatedAt === 'string' && record.updatedAt.trim()) return { ...carried, updatedAt: record.updatedAt };
  // Newer than an unstamped copy of the same row, which would otherwise tie with it.
  const latest = Math.max(timestamp(record.importedAt), timestamp(record.createdAt), timestamp(carried.progressConfirmedAt));
  return latest > 0 ? { ...carried, updatedAt: new Date(latest + 1).toISOString() } : carried;
}

function laterStamp(...values: Array<string | null | undefined>): string {
  return values.reduce<string>((later, value) =>
    typeof value === 'string' && timestamp(value) > timestamp(later) ? value : later, values.find(value => typeof value === 'string') ?? '');
}

/**
 * Whole-app audit A7 pass 27 M (Medium, older; the realtime gap the A5 pass
 * 23 M fix left): the phone, offline, approved master G and deleted F with
 * its items, while David's 30% on F's row went up from the online iPad. When
 * the phone synced, the cloud dropped F's row with its deletion, and the
 * iPad's realtime applier, hearing of the deletion, removed F's row as it
 * stood: nothing carried the 30% to G's row, so the web, the iPad and the
 * phone showed 0% for good (a refresh instead of realtime gave 30%). The
 * tasks after a deletion heard over realtime: the deleted row is gone, and
 * lends David's percent to the newest row kept that answers to it by the
 * rule the sync merge uses (A5 pass 23 M), so the app sends it up as a
 * carried percent (ScheduleProgressCarryUpload). Only rows that answer to
 * the deleted row change here; a refresh or Full Sync weighs the rest.
 */
export function scheduleItemsAfterCloudDeletion(items: readonly ScheduleItem[], deletedId: string): ScheduleItem[] {
  const id = normalized(deletedId);
  const removed = items.filter(item => normalized(item.id) === id);
  const kept = items.filter(item => normalized(item.id) !== id);
  if (removed.length === 0 || !id) return kept;
  const lent = progressCarriedToRevisedTasks(kept, removed);
  return lent.map((row, index) => scheduleTaskEarlierIds(kept[index]).some(earlier => normalized(earlier) === id) ? row : kept[index]);
}

/**
 * The rows a recovery merge gave a carried percent (A7 pass 26 M-1), each
 * with the row as it was before: the app sends each to the cloud as a change
 * of its progress alone (ScheduleProgressCarryUpload).
 */
const rowsTakingCarriedProgress = new WeakMap<ScheduleItem, ScheduleItem>();

export function scheduleItemsTakingCarriedProgress(
  items: readonly ScheduleItem[],
): Array<Readonly<{ item: ScheduleItem; before: ScheduleItem }>> {
  return items.flatMap(item => {
    const before = rowsTakingCarriedProgress.get(item);
    return before ? [{ item, before }] : [];
  });
}

/**
 * The cloud's copy of a row with the percent this device carried to it, or
 * null when the cloud's own progress stands (A7 pass 26 M-1). While the
 * cloud's copy still holds the progress the merge carried over (carriedOver),
 * the carry stands as the merge decided it: a lookahead approved since that
 * left the progress alone changes nothing. Otherwise the merge's rule is
 * weighed against the cloud's copy as it is now, so a percent David entered
 * since, a file's higher percent or a newer lookahead's stated percent is
 * never overwritten.
 */
export function scheduleProgressCarriedOntoCloudCopy(
  carried: ScheduleItem,
  cloudCopy: ScheduleItem,
  carriedOver?: Partial<ScheduleItem>,
): ScheduleItem | null {
  const at = laterStamp(carried.updatedAt, cloudCopy.updatedAt);
  const unchanged = carriedOver && SCHEDULE_CARRIED_PROGRESS_FIELDS.every(field =>
    JSON.stringify(cloudCopy[field] ?? null) === JSON.stringify(carriedOver[field] ?? null));
  if (unchanged) {
    const progress = Object.fromEntries(SCHEDULE_CARRIED_PROGRESS_FIELDS.map(field => [field, carried[field]]));
    return { ...cloudCopy, ...progress, updatedAt: at };
  }
  const weighed = scheduleProgressCarriedFrom(carried, cloudCopy, at, { fileProgressDated: restatedSinceImport(cloudCopy) });
  // With the row it was carried from (A7 pass 28 L).
  return weighed && carried.progressCarriedFrom ? { ...weighed, progressCarriedFrom: carried.progressCarriedFrom } : weighed;
}

/**
 * Owner answer Q22 and the A5 recorded Low R-c (cab99c0) on Full Sync: a
 * lookahead never takes a task below the percent David entered himself,
 * also when a master's higher percent replaced his. On one device, David's
 * 70%, master G stating 80% (above it, so the task took 80% and kept his 70%
 * under it), then lookahead L stating 40% gives 70%. With his 70% entered on
 * the offline iPad before G, and G and L approved on the phone, Full Sync
 * showed L's 40%: the phone's row never had his percent under G's, and the
 * carry does not pass a file statement newer than his percent. When the
 * carry stops there, a newest row whose percent a lookahead approved since
 * its import gave, below his, is now floored at his percent, as on one
 * device (scheduleProgressFlooredAtManagers): the lookahead's percent still,
 * his kept under it. A master's percent below his stands (owner answer Q32,
 * option b: the newest master wins), as does a lookahead's at or above his,
 * and his own on the row. A row where a file replaced a percent he entered
 * on that row itself ("Schedule update") keeps that percent as its floor, his
 * later word there: the import applies it.
 */
function lookaheadFlooredAtManagersPercentOf(earlier: ScheduleItem, record: ScheduleItem): ScheduleItem | null {
  if (!scheduleProgressIsManagers(earlier) || record.progressConfirmedBy === SCHEDULE_UPDATE_PROGRESS_CONFIRMER) return null;
  const percent = boundedPercent(Number(record.percentComplete));
  const lookaheads = record.lookaheadOverlay?.lookaheads;
  const givenByLookahead = Array.isArray(lookaheads) && lookaheads.some(entry =>
    !entry?.datesReplacedByMaster && typeof entry?.percentComplete === 'number' && boundedPercent(entry.percentComplete) === percent);
  if (!givenByLookahead) return null;
  const floored = scheduleProgressFlooredAtManagers(record, boundedPercent(Number(earlier.percentComplete)), scheduleProgressJudgedAt(earlier));
  return floored ? { ...record, ...floored } : null;
}

/**
 * Whole-app audit A7 pass 26 follow-up (Low, caused by dbf7192; owner answer
 * Q32, option b): David's 70% on Framing; the iPad approved master G, which
 * moved Framing at 80% (a file's percent above his, so the task took it).
 * Before the phone heard of G, David entered 80% on the phone's old row, and
 * then the iPad approved master H, which moved Framing at 70%. One device
 * doing the same in time order already shows G's 80% when he enters 80%, so
 * his entry changes nothing: the percent is still G's, and the newer master
 * H replaces it with 70% (Q32, option b: the newest master wins). Full Sync
 * carried the phone's 80% to H's row as a percent of David's that H's import
 * never saw (A6 pass 22 M1), so both devices kept 80%. A percent of his that
 * the row the other device showed when he judged it (the newest row then
 * imported, its file's word not restated since) already held as a file's,
 * with the same status, now carries nothing: what the masters approved
 * since state stands, below his percent too. A lookahead approved since is
 * still floored at it, as at 1d4b016 (owner answer Q22): blocking the floor
 * too took a task below his percent where one device showed a newer master
 * in between and his entry was a real change (found by the A5 pass 23
 * generator, its seed 856). A percent
 * that differs from it is his own new word and carries as before, a newer
 * master's lower percent never replacing it, as on one device (A6 pass 22
 * M1); so does one a master stating no percent passed on (A6 pass 23 M1).
 * A row this device no longer has there leaves it as before.
 */
function enteredAsFileShowedIt(earlier: ScheduleItem, newest: ScheduleItem, known: ReadonlyMap<string, ScheduleItem>): boolean {
  const judgedAt = timestamp(scheduleProgressJudgedAt(earlier));
  const rows = [...rowsBetween(earlier, newest, known), newest];
  if (!judgedAt || rows.some(row => row === undefined)) return false;
  const importedAt = (row: ScheduleItem) => timestamp(row.importedAt || row.createdAt);
  // The row one device showed when he judged his percent: the newest imported by then.
  const shown = (rows as ScheduleItem[]).filter(row => importedAt(row) <= judgedAt)
    .reduce<ScheduleItem | null>((latest, row) => (!latest || importedAt(row) >= importedAt(latest) ? row : latest), null);
  return Boolean(shown) && !scheduleProgressIsManagers(shown!) && !restatedSinceImport(shown!) &&
    timestamp(shown!.progressConfirmedAt) <= judgedAt &&
    boundedPercent(Number(shown!.percentComplete)) === boundedPercent(Number(earlier.percentComplete)) &&
    shown!.status === earlier.status;
}

/**
 * Whole-app audit A5 pass 24 L3 (Low, caused by ef943e5): (a) David's 30% on
 * the phone's master row P1 (moved from F's), then P2 moved Framing on with
 * it; the phone deleted F and P1 with their items; the offline iPad, which
 * never had P1, had his newer 10% on F's row; then the phone's P5 moved
 * Framing again. One device shows 10%, but Full Sync kept 30%: P1, a row
 * between that the iPad does not know, stopped the 10% (A5 pass 23 M), though
 * P2, which the iPad knows, holds what P1 passed on, his older 30%. A row
 * between this device does not know stops a percent judged before the newest
 * row's import only while no row it knows after it holds a percent of his
 * own: such a row shows what was said there. (b) A deleted row passed his
 * older 90% to the newest row past a row between holding his newer 50%
 * (which, answered by sibling rows, carries nothing itself); one device shows
 * the newer word. A newer percent of his on a row between now stops the
 * older one (progressCarriedToRevisedTasks).
 */
function rowsBetweenUnheard(between: ReadonlyArray<ScheduleItem | undefined>): boolean {
  const lastUnknown = between.reduce<number>((last, row, index) => (row === undefined ? index : last), -1);
  return lastUnknown >= 0 && !between.slice(lastUnknown + 1).some(row => row !== undefined && scheduleProgressIsManagers(row));
}

/** The rows between a row and the newest that answers to it: undefined where this device no longer has one. */
function rowsBetween(earlier: ScheduleItem, newest: ScheduleItem, known: ReadonlyMap<string, ScheduleItem>): Array<ScheduleItem | undefined> {
  const before = new Set([normalized(earlier.id), ...scheduleTaskEarlierIds(earlier).map(normalized)]);
  return scheduleTaskEarlierIds(newest).map(normalized).filter(id => !before.has(id)).map(id => known.get(id));
}

/**
 * A row holding a percent its own file stated, above David's on the earlier
 * row, after he judged it (A5 pass 23 L1). The file stated it when
 * the row was imported, or when an approval confirmed it ("Schedule update").
 * Once a lookahead restated the row since, the master's percent its note
 * keeps is what the file stated. A percent the row took from a lookahead note
 * its import brought along (the note's master percent is not the row's) is
 * not its file's statement (A6 pass 23 M1).
 *
 * Whole-app audit A5 pass 24 L1 (Low, caused by dc3f469): David's 30% on the
 * iPad; the phone, not having heard it, approved G moving Framing at 30%,
 * then H moving it at 20%. One device keeps his 30%: a file stating his own
 * percent changes nothing at approval, so it stays his, and a newer master's
 * lower percent never replaces his own. Full Sync read G's 30% as having
 * taken his percent over, and showed H's 20% everywhere. A file percent equal
 * to his is no take-over; only one above his is.
 */
function fileStatedAbove(row: ScheduleItem, earlier: ScheduleItem): boolean {
  if (scheduleProgressIsManagers(row)) return false;
  const note = row.lookaheadOverlay;
  const restated = restatedSinceImport(row);
  const notedPercent = boundedPercent(Number(note?.masterPercentComplete));
  if (note && !restated && notedPercent !== boundedPercent(Number(row.percentComplete))) return false;
  const notedIsDavids = note?.masterProgressSource === 'project_manager' && note.masterProgressConfirmedBy !== SCHEDULE_UPDATE_PROGRESS_CONFIRMER;
  const stated = note && restated && !notedIsDavids ? notedPercent : boundedPercent(Number(row.percentComplete));
  if (stated <= boundedPercent(Number(earlier.percentComplete))) return false;
  const statedAt = Math.max(timestamp(row.progressConfirmedAt), timestamp(row.importedAt || row.createdAt));
  return statedAt > timestamp(scheduleProgressJudgedAt(earlier));
}

/**
 * Whole-app audit A5 pass 25 L1 (Low, partly caused by d3db006): on one
 * device, David's 30% on Framing; master G moved it at 40%, a file's percent
 * above his, so the task took 40% and kept his 30% under it; master H listed
 * Framing on G's dates at 30%, restating G's row in place; master I moved it
 * at 10%. Approval showed 10% (owner answer Q32, option b: a newer master
 * replaces a file's percent), but the next refresh, restart or Full Sync
 * carried his old 30% past G's row to I's and sent it up, so the web and the
 * iPad showed 30% too: the take-over check (fileStatedAbove) reads only what
 * a row between holds now, H's 30%, which is no longer above his (A5 pass 24
 * L1), and H at 25% was missed the same way. G's row and I's row both keep
 * his 30% under the file's percent (managersPercentUnderFile), with when he
 * judged it: a file's percent replaced that entry of his there. A row between
 * or the newest row that shows a file's percent and keeps, under it, his
 * percent from the earlier row or a later one of his (judged at or after it)
 * has now taken it over, as approval did. A floor saved before its time was
 * kept (A6 pass 24 L1) changes nothing here.
 */
function keepsHisPercentUnderFile(row: ScheduleItem, earlier: ScheduleItem): boolean {
  if (scheduleProgressIsManagers(row) || row.managersPercentUnderFileJudgedAt === undefined) return false;
  const under = scheduleManagersOwnPercent(row);
  return Boolean(under) && timestamp(under!.judgedAt) >= timestamp(scheduleProgressJudgedAt(earlier));
}

/**
 * Whether a file restated the row after its own import (A6 pass 23 M1): a
 * later file it also belongs to, or a lookahead whose dates no master has
 * replaced. The lookaheads a new master's row takes over at its import are
 * marked replaced by a master (scheduleTaskMasterRestated), so the note it
 * brought along does not count; a note the app cannot read counts, as before.
 */
function restatedSinceImport(record: ScheduleItem): boolean {
  if (scheduleItemImportBatchIds(record).length > 1) return true;
  const note = record.lookaheadOverlay;
  if (!note) return false;
  return Array.isArray(note.lookaheads) ? note.lookaheads.some(entry => !entry?.datesReplacedByMaster) : true;
}

/**
 * Select only local task revisions that would actually change cloud truth.
 * Recovery may return cloud-only rows so another device can hydrate them; it
 * must never cause those same rows to be written back during Full Sync.
 *
 * Whole-app audit A7 pass 27 L2 (Low, older; what A7 pass 26 M-1 left): the
 * iPad's carried 30% on G's row waited on its queue when it went offline;
 * the phone then approved lookahead L stating 60% on new dates and typed a
 * note. Back online, the iPad's queue-only upload (the reconnect upload, or
 * Retry Sync) rightly refused the carry, but the iPad kept its copy, and
 * Sync Now weighed that copy against the cloud's alone: as David's percent
 * it outranked the cloud's whole, so L's dates, its 60% and both notes were
 * written over everywhere (Sync Now with no queue-only upload first kept
 * them). A copy whose percent is carried from an earlier row it answers to,
 * older than the cloud's copy (a carried row keeps the row's own stamp), is
 * now weighed with every task, as the download weighs it
 * (mergedWithCarriedProgressWeighedAgain, then the carry): what the carry
 * still gives goes up with the cloud's newer edits, and a refused one leaves
 * the cloud's copy as it is. Weighed with only the rows it answers to, a
 * percent carried to a row with sibling rows (which the download does not
 * carry) went up; and a percent of his given back on the device after the
 * cloud's copy last changed (deleting a lookahead gives back his percent
 * before it, stamped 1 ms after the lookahead's, and it also reads as taken
 * from his earlier row) lost to the cloud's (both found by the A7 pass 27
 * comparisons). Any other copy, and a copy changed on the device after the
 * cloud's, is weighed alone, as before.
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

  const copies = rowCopiesById([...local, ...cloud]);
  // What the download makes of every task, worked out once, when a copy holds a carried percent (A7 pass 27 L2).
  let downloaded: Map<string, ScheduleItem> | null = null;
  const asDownloaded = () => downloaded ??= new Map(recoverDAVEScheduleRecords({ local, cloud, deletedIds, allowCloudOnly: true })
    .map(row => [normalized(row.id), row] as const));
  return local.flatMap(record => {
    const id = normalized(record.id);
    if (!id || deleted.has(id)) return [];
    const remote = cloudById.get(id);
    if (!remote) return [record];
    // A carried percent on a copy older than the cloud's is weighed with every task, as the download weighs it (A7 pass 27 L2).
    const authoritative = holdsCarriedProgress(record, copies, deleted) && timestamp(remote.updatedAt) > timestamp(record.updatedAt)
      ? asDownloaded().get(id)
      : recoverDAVEScheduleRecords({
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
  // The row a carried percent came from goes with that percent, last, as the carry adds it (A7 pass 28 L).
  const { progressJudgment: _baseJudgment, progressCarriedFrom: _baseCarriedFrom, ...baseRecord } = base;
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
    // David's own percent a file's replaced goes with that file's percent (A5 recorded Low R-c, cab99c0), unless the
    // other copy knows a later entry of his (A6 pass 24 L1).
    ...scheduleManagersPercentUnderFileOfBoth(progressSource, progressSource === local ? cloud : local),
    projectControls: mergeScheduleProjectControls(local, cloud, base),
    // Every import either copy knows the task belongs to (whole-app audit A5 pass 2).
    ...(alsoImportedInBatchIds.length > 0 ? { alsoImportedInBatchIds } : {}),
    ...(alsoImportedSourceRow ? { alsoImportedSourceRow } : {}),
    ...(revisedFromTaskIds.length > 0 ? { revisedFromTaskIds } : {}),
    ...(progressSource.progressCarriedFrom ? { progressCarriedFrom: progressSource.progressCarriedFrom } : {}),
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
