import type { ReferenceDocument, ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { parseFlexibleDate } from '../utils/date';
import {
  currentScheduleDocumentsByProject,
  scheduleDocumentAddsToMaster,
  scheduleProjectScopeKey,
} from './PIEScheduleReconciliation';
import type { PIEScheduleImportBatch } from './PIEScheduleImportBatch';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';
import { sameScheduleCalendarDay } from './ScheduleCalendarDay';
import { scheduleProgressIsManagers, scheduleRowStatesPercent } from './ScheduleProgressSource';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';

/**
 * Owner answer Q22 (30 Sep 2026): "a shorter schedule should be made to
 * compliment the master long term schedule", clarified "merge into master".
 * A lookahead and the master both stay in effect for the project. A task in
 * both files shows once, with the lookahead's newer dates and progress;
 * tasks only in the lookahead are added; the master's other tasks stay.
 *
 * The task keeps one record, the master's: approving a lookahead restates
 * the master's task in place (its dates, and its progress by the rule of
 * whole-app audit A5 pass 4: the newer file's over a file's, only upward
 * over the manager's) and notes what the task said before, so progress
 * recorded on it is never split between two copies, survives a new master
 * or a new lookahead, and deleting the lookahead gives the task back its
 * master dates.
 *
 * Whole-app audit A5 pass 5 (30 Sep 2026): the lookahead also notes the
 * percent it gave (none when its file states no percent), and deleting it
 * gives back the percent before it when the task still has the one it gave
 * and the manager has not recorded progress since (H1). Dates compare by
 * calendar day (A12 M2).
 */
export type ScheduleImportRole = 'master' | 'lookahead';

function key(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function percentOf(item: Pick<ScheduleItem, 'percentComplete'>): number {
  const value = Number(item.percentComplete);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function sameDates(
  left: Pick<ScheduleItem, 'startDate' | 'finishDate'>,
  right: Pick<ScheduleItem, 'startDate' | 'finishDate'>,
): boolean {
  return sameScheduleCalendarDay(left.startDate, right.startDate) && sameScheduleCalendarDay(left.finishDate, right.finishDate);
}

type LookaheadEntry = ScheduleLookaheadOverlay['lookaheads'][number];

/**
 * The percent a lookahead gave the task, or null when it gave none. A
 * lookahead approved before the percent was noted (undefined) is taken to
 * have given the task's percent while it is the latest, for its delete.
 */
function percentGiven(entry: LookaheadEntry, latest: boolean, item: ScheduleItem): number | null {
  if (entry.percentComplete === undefined) return latest ? percentOf(item) : null;
  return entry.percentComplete === null ? null : percentOf({ percentComplete: entry.percentComplete });
}

/**
 * Whether the task's percent is one a lookahead stated, which a master
 * repeating its old percent leaves. Before the percent was noted, a 0% was
 * a file with no % column, not a statement (A5 pass 5 H1).
 */
function percentHeldFromLookahead(item: ScheduleItem, overlay: ScheduleLookaheadOverlay): boolean {
  const entries = overlay.lookaheads;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.percentComplete === undefined) {
      return index === entries.length - 1 && percentOf(item) > 0 && percentOf(item) !== overlay.masterPercentComplete;
    }
    if (entry.percentComplete !== null) return percentOf({ percentComplete: entry.percentComplete }) === percentOf(item);
  }
  return false;
}

function overlayOf(item: ScheduleItem): ScheduleLookaheadOverlay | null {
  const overlay = item.lookaheadOverlay;
  return overlay && Array.isArray(overlay.lookaheads) ? overlay : null;
}

function withOverlay(item: ScheduleItem, overlay: ScheduleLookaheadOverlay | null): ScheduleItem {
  const { lookaheadOverlay: _previous, ...rest } = item;
  return overlay && overlay.lookaheads.length > 0 ? { ...rest, lookaheadOverlay: overlay } : rest;
}

/**
 * The master's task restated by a lookahead row, in place: the row's dates,
 * the area when the task had none, the lookahead added to the imports the
 * task belongs to (a task entered by hand keeps its own provenance), and a
 * note of the lookahead and of what the task said before the first one.
 * Progress is the caller's (fileProgressFor), and givenPercent the percent
 * it gave the task, or null when it left progress alone.
 */
export function scheduleTaskRestatedByLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
  approvedAt: string,
  givenPercent: number | null = null,
): ScheduleItem {
  const batchId = typeof row.importBatchId === 'string' ? row.importBatchId.trim() : '';
  const owned = Boolean(key(task.importBatchId) || key(task.sourceDocumentId));
  const previous = overlayOf(task);
  const overlay: ScheduleLookaheadOverlay = {
    masterStartDate: previous ? previous.masterStartDate : task.startDate,
    masterFinishDate: previous ? previous.masterFinishDate : task.finishDate,
    masterPercentComplete: previous ? previous.masterPercentComplete : percentOf(task),
    lookaheads: [
      ...(previous?.lookaheads || []).filter(entry => key(entry.batchId) !== key(batchId)),
      { batchId, startDate: row.startDate, finishDate: row.finishDate, percentComplete: givenPercent },
    ],
  };
  return withOverlay({
    ...task,
    startDate: row.startDate,
    finishDate: row.finishDate,
    locationName: key(task.locationName) ? task.locationName : row.locationName,
    ...(owned && batchId ? { alsoImportedInBatchIds: [...(task.alsoImportedInBatchIds || []), batchId] } : {}),
    updatedAt: approvedAt,
  }, overlay);
}

/**
 * A full schedule's row that says what the master said before a lookahead
 * restated the task: the new master did not change the task, so the
 * lookahead's dates stay. With the row's percent the same too, the master's
 * old percent is not taken over the percent a lookahead stated; a task that
 * holds no lookahead's percent takes the master's (A5 pass 5 H1).
 */
export function scheduleRowRepeatsMasterBeforeLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
): { dates: boolean; percent: boolean } {
  const overlay = overlayOf(task);
  if (!overlay) return { dates: false, percent: false };
  const dates = sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row);
  return {
    dates,
    percent: dates && scheduleRowStatesPercent(row) && percentOf(row) === overlay.masterPercentComplete &&
      percentHeldFromLookahead(task, overlay),
  };
}

/**
 * A full schedule that states the task takes over from the lookaheads' note
 * of what the master said: its dates and percent are what the master says
 * now (a row stating no percent leaves the noted percent). The same task
 * when nothing changes.
 */
export function scheduleTaskMasterRestated(task: ScheduleItem, row: ScheduleItem): ScheduleItem {
  const overlay = overlayOf(task);
  if (!overlay) return task;
  const masterPercentComplete = scheduleRowStatesPercent(row) ? percentOf(row) : overlay.masterPercentComplete;
  if (
    sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row) &&
    overlay.masterPercentComplete === masterPercentComplete
  ) return task;
  return withOverlay(task, {
    ...overlay,
    masterStartDate: row.startDate,
    masterFinishDate: row.finishDate,
    masterPercentComplete,
  });
}

type LookaheadDeleted = Readonly<{ item: ScheduleItem; datesBack: boolean; percentBack: boolean }>;

function tasksAfterLookaheadDeleted(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  updatedAt: string,
): LookaheadDeleted[] {
  const batchId = key(document.importBatchId);
  if (!batchId) return [];
  return items.flatMap(item => {
    const overlay = overlayOf(item);
    const index = overlay ? overlay.lookaheads.findIndex(entry => key(entry.batchId) === batchId) : -1;
    if (!overlay || index < 0) return [];
    const entries = overlay.lookaheads;
    const remaining = entries.filter((_, position) => position !== index);
    const top = index === entries.length - 1 && sameDates(item, entries[index]);
    const back = remaining[remaining.length - 1] ||
      { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate };
    const datesBack = top && !sameDates(item, back);
    // The percent it gave, when no later lookahead gave one, the task still has it, and it is not the manager's own (H1).
    const given = percentGiven(entries[index], index === entries.length - 1, item);
    const laterGave = entries.slice(index + 1).some((entry, offset) =>
      percentGiven(entry, index + 1 + offset === entries.length - 1, item) !== null);
    const earlier = entries.slice(0, index).map((entry, position) => percentGiven(entry, false, item))
      .filter((value): value is number => value !== null);
    const backPercent = earlier.length > 0 ? earlier[earlier.length - 1] : overlay.masterPercentComplete;
    const percentBack = given !== null && !laterGave && given === percentOf(item) && backPercent !== percentOf(item) &&
      !scheduleProgressIsManagers(item);
    const progress = percentBack ? reconcileScheduleProgress(item.status, backPercent) : null;
    return [{
      datesBack,
      percentBack,
      item: withOverlay({
        ...item,
        ...(top ? { startDate: back.startDate, finishDate: back.finishDate } : {}),
        ...(progress ? {
          percentComplete: progress.percentComplete,
          status: progress.status,
          ...(item.progressSource === 'project_manager' ? { progressConfirmedAt: updatedAt } : {}),
        } : {}),
        updatedAt,
      }, { ...overlay, lookaheads: remaining }),
    }];
  });
}

/**
 * The tasks a deleted lookahead restated, without it (Delete PDF + Items).
 * A task on the dates the lookahead gave, that no later lookahead restated,
 * goes back to the dates before it: the previous lookahead's, or the
 * master's. A task still at the percent it gave goes back to the percent
 * before it (A5 pass 5 H1). Dates and progress the manager changed since
 * are kept.
 */
export function scheduleItemsAfterLookaheadDeleted(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  updatedAt = new Date().toISOString(),
): ScheduleItem[] {
  return tasksAfterLookaheadDeleted(items, document, updatedAt).map(entry => entry.item);
}

/**
 * What "Delete PDF + Items" also does to the tasks a lookahead changed, for
 * the delete question: only the tasks whose dates or progress go back, not
 * those the delete removes (removed) or whose dates the manager changed
 * since (whole-app audit A5 pass 5 L1). A lookahead's own task restated by a
 * later one goes back to the earlier lookahead's dates, so none is called a
 * master task.
 */
export function scheduleLookaheadDeleteNote(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  removed: readonly ScheduleItem[] = [],
): string {
  if (!scheduleDocumentAddsToMaster(document)) return '';
  const removedIds = new Set(removed.map(item => item.id));
  const back = tasksAfterLookaheadDeleted(items.filter(item => !removedIds.has(item.id)), document, '')
    .filter(entry => entry.datesBack || entry.percentBack);
  if (back.length === 0) return '';
  const dates = back.filter(entry => entry.datesBack).length;
  const percents = back.filter(entry => entry.percentBack).length;
  const what = percents === 0 ? 'dates'
    : dates === 0 ? 'progress'
      : dates === back.length && percents === back.length ? 'dates and progress' : 'dates or progress';
  return ` Delete PDF + Items also puts back the earlier ${what} of ${back.length} ${back.length === 1 ? 'task' : 'tasks'} this lookahead changed.`;
}

/** Whether approving this import adds to the master: its document, or the one an earlier Accept Selected saved. */
export function scheduleImportAddsToMaster(
  batch: Pick<PIEScheduleImportBatch, 'id' | 'documents'>,
  savedDocuments: readonly ReferenceDocument[],
): boolean {
  if (batch.documents.some(scheduleDocumentAddsToMaster)) return true;
  if (batch.documents.some(document => document.category === 'Schedules')) return false;
  return savedDocuments.some(document => key(document.importBatchId) === key(batch.id) && scheduleDocumentAddsToMaster(document));
}

/** The import with its schedule file marked as David chose at review. */
export function withScheduleImportRole<T extends Pick<PIEScheduleImportBatch, 'documents'>>(
  batch: T,
  role: ScheduleImportRole,
): T {
  return {
    ...batch,
    documents: batch.documents.map(document => document.category === 'Schedules'
      ? { ...document, scheduleRole: role }
      : document),
  };
}

/** Whether the review asks how the schedule is used: an import that brings a schedule file. */
export function scheduleImportAsksRole(batch: Pick<PIEScheduleImportBatch, 'kind' | 'documents'>): boolean {
  return batch.kind === 'schedule_file' && batch.documents.some(document => document.category === 'Schedules');
}

export type ScheduleImportRoleSuggestion = Readonly<{
  role: ScheduleImportRole;
  /** Plain words: "Suggested: … because …". */
  reason: string;
}>;

const DAY_MS = 86_400_000;
/** A file covering at most nine weeks, and at most half the master's span, reads as a lookahead. */
const LOOKAHEAD_MAX_DAYS = 63;
const WEEK_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/**
 * The words of a file name that call it a lookahead (whole-app audit A5
 * pass 5 M3, 30 Sep 2026): "lookahead", "look-ahead" or "look ahead", or a
 * span of at most six weeks ("3 Week", "six wk"). "12 Week Schedule" is a
 * full schedule's span, and the "30 Wk" of "2026-09-30 Wk 40" is a date's
 * day. The first such words in the name, or null.
 */
function lookaheadNameWords(name: string): string | null {
  const found: Array<{ index: number; words: string }> = [];
  const looks = /look[\s_-]?ahead/gi;
  for (let match = looks.exec(name); match; match = looks.exec(name)) found.push({ index: match.index, words: match[0] });
  const weeks = /(\d{1,2}|one|two|three|four|five|six)[\s_-]?(?:weeks?|wks?)(?![a-z])/gi;
  for (let match = weeks.exec(name); match; match = weeks.exec(name)) {
    const before = name.slice(0, match.index);
    if (/[a-z0-9]$/i.test(before) || /\d[-/.]$/.test(before)) continue;
    const count = Number(match[1]) || WEEK_WORDS[match[1].toLowerCase()] || 0;
    if (count >= 1 && count <= 6) found.push({ index: match.index, words: match[0] });
  }
  return found.sort((left, right) => left.index - right.index)[0]?.words ?? null;
}

function span(items: readonly ScheduleItem[]): { from: number; to: number } | null {
  const times = items.flatMap(item => [item.startDate, item.finishDate])
    .map(value => (typeof value === 'string' ? parseFlexibleDate(value)?.getTime() : undefined))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return times.length > 0 ? { from: Math.min(...times), to: Math.max(...times) } : null;
}

function days(range: { from: number; to: number }): number {
  return Math.max(1, Math.round((range.to - range.from) / DAY_MS) + 1);
}

function spanWords(count: number): string {
  if (count < 14) return `${count} ${count === 1 ? 'day' : 'days'}`;
  if (count < 120) return `${Math.round(count / 7)} weeks`;
  return `about ${Math.round(count / 30.4)} months`;
}

/**
 * The review's default (owner answer Q22): a full schedule, unless one of
 * the file's projects already has a master and the file's dates read as a
 * lookahead: a few weeks (at most nine) where the master covers at least
 * twice as long. A name that says so ("3 Week Lookahead") is the reason
 * given, but never decides alone (whole-app audit A5 pass 5 M3: "Alpha 12
 * Week Schedule rev2" and "Schedule Update 2026-09-30 Wk 40" were suggested
 * as lookaheads). David can change it.
 */
export function suggestScheduleImportRole({
  batch,
  documents,
  scheduleItems,
}: Readonly<{
  batch: Pick<PIEScheduleImportBatch, 'documents' | 'items'>;
  /** The schedules saved now. */
  documents: readonly ReferenceDocument[];
  /** The tasks saved now. */
  scheduleItems: readonly ScheduleItem[];
}>): ScheduleImportRoleSuggestion {
  const file = batch.documents.find(document => document.category === 'Schedules');
  const projects = [...new Map([
    ...batch.items.map(item => item.scheduleProjectName || item.projectName || ''),
    ...(file?.projectNames || []),
  ].map(name => name.trim()).filter(Boolean).map(name => [key(name), name] as const)).values()];
  const current = currentScheduleDocumentsByProject(documents);
  const masters = projects
    .map(project => ({ project, master: current.get(scheduleProjectScopeKey(project)) }))
    .filter((entry): entry is { project: string; master: ReferenceDocument } => Boolean(entry.master));
  if (masters.length === 0) {
    return {
      role: 'master',
      reason: `there is no master schedule${projects.length > 0 ? ` for ${projects.join(', ')}` : ''} yet`,
    };
  }
  const named = lookaheadNameWords(`${file?.name || ''} ${file?.originalFileName || ''}`);
  const fileSpan = span(batch.items);
  const [longest] = masters.map(({ project, master }) => {
    const batchId = key(master.importBatchId);
    const rows = scheduleItems.filter(item =>
      key(item.scheduleProjectName || item.projectName) === key(project) &&
      ((Boolean(batchId) && scheduleItemImportBatchIds(item).map(key).includes(batchId)) ||
        key(item.sourceDocumentId) === key(master.id)));
    const range = span(rows);
    return { project, days: range ? days(range) : 0 };
  }).sort((left, right) => right.days - left.days);
  if (!fileSpan || longest.days === 0) {
    return { role: 'master', reason: `its dates could not be compared with the master for ${longest.project}` };
  }
  const fileDays = days(fileSpan);
  const words = `its dates cover ${spanWords(fileDays)} and the master for ${longest.project} covers ${spanWords(longest.days)}`;
  return fileDays <= LOOKAHEAD_MAX_DAYS && longest.days >= fileDays * 2
    ? { role: 'lookahead', reason: named ? `its name says “${named.trim()}”` : words }
    : { role: 'master', reason: words };
}
