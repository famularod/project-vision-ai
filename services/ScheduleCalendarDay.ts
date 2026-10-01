import { parseFlexibleDate } from '../utils/date';

/**
 * Whole-app audit A12 M2, schedule side (30 Sep 2026): the web schedule
 * builder saves a task's dates as 2026-10-05, files and the phone as
 * 10/05/2026, so a revised upload compared them as text, found every such
 * task "changed" and made a second copy of it; a lookahead's delete and a
 * new master's repeat check missed them the same way.
 *
 * A schedule date's calendar day, as YYYY-MM-DD: ISO or M/D/YYYY (two-digit
 * years too), with or without a time after it (the day written is the day
 * meant: no time-zone shift), and the "Oct 5, 2026" form imports stored
 * until 30 Sep 2026. Anything else (blank, "TBD", an impossible date) is its
 * own text, trimmed, lower-cased and single-spaced.
 */
export function scheduleCalendarDayKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const day = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s]\d{1,2}:\d{2}.*)?$/i)?.[1] ??
    text.match(/^(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))(?:,?\s+\d{1,2}:\d{2}.*)?$/i)?.[1] ??
    text;
  const parsed = day ? parseFlexibleDate(day) : null;
  if (!parsed) return text.toLowerCase().replace(/\s+/g, ' ');
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** The same calendar day, whichever way each is written. */
export function sameScheduleCalendarDay(left: unknown, right: unknown): boolean {
  return scheduleCalendarDayKey(left) === scheduleCalendarDayKey(right);
}
