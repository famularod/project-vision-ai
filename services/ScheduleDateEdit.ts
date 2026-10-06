import type { ScheduleItem } from '../types';
import { sameScheduleCalendarDay, scheduleCalendarDay } from './ScheduleCalendarDay';

/**
 * Review N1 M1 (3 Oct 2026, caused by ada8ef6, owner answer Q25): a task a
 * lookahead moved keeps, in its note, the dates that lookahead gave it and
 * the master's dates from before. While the lookahead is in effect the task
 * shows the lookahead's dates; once a newer lookahead replaces it, the
 * master's (the saved task still holds the lookahead's). A task save that
 * changes one date changes it on the saved task, so changing only Finish on
 * a task shown on the master's dates left Start on the replaced lookahead's
 * day, on every device.
 *
 * The phone's date fields now send the other date as shown. A save that
 * still brings one date alone (Talk, anything that holds no shown copy) is
 * noted on the lookahead's entry in the task's note: which date he set, and
 * when (dateByHand). When the tasks are shown, a date changed after that
 * lookahead was replaced started from the master's dates: his date stands
 * and the other shows the master's. One changed while the lookahead was in
 * effect is a hand move, as before: both dates as saved, replaced or not.
 * Nothing else of the note changes, so a later lookahead or master that
 * restates the task supersedes his date as it did.
 *
 * With the saved other date across his new one (a Finish before the
 * lookahead's Start, a Start after its Finish), the other date he saw was
 * the master's: both are saved, when the master's does not cross it too.
 *
 * The same edit when it changes neither date, when the task has no lookahead
 * note, or when it is not on the dates its latest lookahead gave.
 *
 * Review N2 F2 and F3 (5 Oct 2026; residue of 3e1b312, gap in ada8ef6). The
 * phone's "Delete PDF Only" saves dates through this same task save, and
 * passes the two dates only (scheduleItemsAfterScheduleDeleted, fileOnly),
 * so what such a save means is noted here, as for a date changed alone, and
 * the web's delete, which saves the whole task, reads the same note from the
 * same rule:
 * - F2. Both dates set to the master's dates the note keeps, on a task saved
 *   on its latest lookahead's dates (the dates shown under a replaced
 *   lookahead, saved when its file is deleted alone; or typed so by hand).
 *   The entry stayed as it was, so after a later lookahead moved the task
 *   and was deleted with its items, the task went back to the first
 *   lookahead's dates: a file deleted earlier, dates David had not seen
 *   since it was replaced. The entry now notes when the task left
 *   (datesLeftAt), and that delete gives the master's dates back.
 * - F3. Both dates set to the dates the task is already on, its latest
 *   lookahead's (the lookahead in effect deleted alone keeps its tasks on
 *   its dates). With the file gone nothing said when that lookahead was
 *   imported, so a newer lookahead that left the task out never returned it
 *   to the master's dates, while that lookahead's own detail tasks did
 *   leave. An entry says when its lookahead was imported (importedAt,
 *   scheduleTaskRestatedByLookahead) and such a save notes nothing. One
 *   made before that review does not: it notes when the dates were kept
 *   (datesKeptAt), and a lookahead imported after that is newer than the
 *   one deleted.
 * Both dates set to anything else is a hand move, as before.
 */
export function scheduleEditWithDateChangedAlone(
  current: ScheduleItem,
  edit: Partial<ScheduleItem>,
  /** When the save is made. */
  at = new Date().toISOString(),
): Partial<ScheduleItem> {
  const startAlone = typeof edit.startDate === 'string' && edit.finishDate === undefined;
  const finishAlone = typeof edit.finishDate === 'string' && edit.startDate === undefined;
  const overlay = current.lookaheadOverlay;
  const entries = Array.isArray(overlay?.lookaheads) ? overlay!.lookaheads : [];
  const latest = entries[entries.length - 1];
  if (!overlay || !latest || 'lookaheadOverlay' in edit) return edit;
  if (!sameScheduleCalendarDay(current.startDate, latest.startDate) || !sameScheduleCalendarDay(current.finishDate, latest.finishDate)) return edit;
  if (typeof edit.startDate === 'string' && typeof edit.finishDate === 'string') {
    const setTo = (days: Pick<ScheduleItem, 'startDate' | 'finishDate'>) =>
      sameScheduleCalendarDay(edit.startDate, days.startDate) && sameScheduleCalendarDay(edit.finishDate, days.finishDate);
    const kept = setTo(latest);
    if (kept ? Boolean(latest.importedAt) : !setTo({ startDate: overlay.masterStartDate, finishDate: overlay.masterFinishDate })) return edit;
    const noted = kept ? { datesKeptAt: at } : { datesLeftAt: at };
    return { ...edit, lookaheadOverlay: { ...overlay, lookaheads: [...entries.slice(0, -1), { ...latest, ...noted }] } };
  }
  if (startAlone === finishAlone) return edit;
  const field = startAlone ? 'startDate' as const : 'finishDate' as const;
  const value = edit[field] as string;
  // (Noted even when he sets the day the saved task already has: shown on the master's dates, that day is a change.)
  const his = scheduleCalendarDay(value);
  const crossed = (other: string) => {
    const day = scheduleCalendarDay(other);
    return Boolean(his && day && (startAlone ? his > day : his < day));
  };
  // The other date as the master's when the lookahead's would cross his: it was the master's he saw.
  if (crossed(startAlone ? current.finishDate : current.startDate)) {
    const masters = startAlone ? overlay.masterFinishDate : overlay.masterStartDate;
    return crossed(masters) ? edit : { ...edit, ...(startAlone ? { finishDate: masters } : { startDate: masters }) };
  }
  return {
    ...edit,
    lookaheadOverlay: {
      ...overlay,
      lookaheads: [...entries.slice(0, -1), { ...latest, dateByHand: { field, at } }],
    },
  };
}
