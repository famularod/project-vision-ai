import type { ReferenceDocument, ScheduleItem, ScheduleLookaheadOverlay } from '../types';
import { parseFlexibleDate } from '../utils/date';
import {
  currentScheduleDocumentsByProject,
  scheduleDocumentAddsToMaster,
  scheduleProjectScopeKey,
} from './PIEScheduleReconciliation';
import type { PIEScheduleImportBatch } from './PIEScheduleImportBatch';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';

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
  return key(left.startDate) === key(right.startDate) && key(left.finishDate) === key(right.finishDate);
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
 * Progress is the caller's (fileProgressFor).
 */
export function scheduleTaskRestatedByLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
  approvedAt: string,
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
      { batchId, startDate: row.startDate, finishDate: row.finishDate },
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
 * old percent is not taken over the lookahead's.
 */
export function scheduleRowRepeatsMasterBeforeLookahead(
  task: ScheduleItem,
  row: ScheduleItem,
): { dates: boolean; percent: boolean } {
  const overlay = overlayOf(task);
  if (!overlay) return { dates: false, percent: false };
  const dates = sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row);
  return { dates, percent: dates && percentOf(row) === overlay.masterPercentComplete };
}

/**
 * A full schedule that states the task takes over from the lookaheads' note
 * of what the master said: its dates and percent are what the master says
 * now. The same task when nothing changes.
 */
export function scheduleTaskMasterRestated(task: ScheduleItem, row: ScheduleItem): ScheduleItem {
  const overlay = overlayOf(task);
  if (!overlay) return task;
  if (
    sameDates({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate }, row) &&
    overlay.masterPercentComplete === percentOf(row)
  ) return task;
  return withOverlay(task, {
    ...overlay,
    masterStartDate: row.startDate,
    masterFinishDate: row.finishDate,
    masterPercentComplete: percentOf(row),
  });
}

/**
 * The tasks a deleted lookahead restated, without it (Delete PDF + Items).
 * A task on the dates the lookahead gave, that no later lookahead restated,
 * goes back to the dates before it: the previous lookahead's, or the
 * master's. Dates the manager changed since are kept, as is its progress.
 */
export function scheduleItemsAfterLookaheadDeleted(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  updatedAt = new Date().toISOString(),
): ScheduleItem[] {
  const batchId = key(document.importBatchId);
  if (!batchId) return [];
  return items.flatMap(item => {
    const overlay = overlayOf(item);
    const index = overlay ? overlay.lookaheads.findIndex(entry => key(entry.batchId) === batchId) : -1;
    if (!overlay || index < 0) return [];
    const remaining = overlay.lookaheads.filter((_, position) => position !== index);
    const top = index === overlay.lookaheads.length - 1 && sameDates(item, overlay.lookaheads[index]);
    const back = remaining[remaining.length - 1] ||
      { startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate };
    return [withOverlay({
      ...item,
      ...(top ? { startDate: back.startDate, finishDate: back.finishDate } : {}),
      updatedAt,
    }, { ...overlay, lookaheads: remaining })];
  });
}

/** What "Delete PDF + Items" also does to a lookahead's master tasks, for the delete question. */
export function scheduleLookaheadDeleteNote(items: readonly ScheduleItem[], document: ReferenceDocument): string {
  if (!scheduleDocumentAddsToMaster(document)) return '';
  const count = scheduleItemsAfterLookaheadDeleted(items, document).length;
  if (count === 0) return '';
  return ` Delete PDF + Items also puts the ${count} master ${count === 1 ? 'task' : 'tasks'} this lookahead updated back on the master schedule's dates.`;
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
const LOOKAHEAD_NAME = /\blook[\s_-]?ahead\b|\b(?:\d{1,2}|two|three|four|six)[\s_-]?(?:week|wk)s?\b/i;
/** A file covering at most nine weeks, and at most half the master's span, reads as a lookahead. */
const LOOKAHEAD_MAX_DAYS = 63;

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
 * the file's projects already has a master and the file reads as a
 * lookahead, by its name ("3 Week Lookahead") or by covering a few weeks
 * where the master covers far longer. David can change it.
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
  const named = `${file?.name || ''} ${file?.originalFileName || ''}`.match(LOOKAHEAD_NAME);
  if (named) return { role: 'lookahead', reason: `its name says “${named[0].trim()}”` };
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
    ? { role: 'lookahead', reason: words }
    : { role: 'master', reason: words };
}
