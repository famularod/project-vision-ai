import { parsePlainDate } from './ProjectDateTime';

/** A weekday written before the date: "Mon 10/5/26", "Monday, October 5, 2026". */
const LEADING_WEEKDAY = /^(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+/i;
/** A clock time after the date: "T08:00:00Z", " 08:00", ", 8:00 AM", " 8 AM". */
const TRAILING_TIME = /(?:t|\s+|,\s*)\d{1,2}:\d{2}.*$|(?:\s+|,\s*)\d{1,2}\s*[ap]\.?m\.?$/i;

/**
 * The calendar day a schedule date names, as YYYY-MM-DD, or null when it
 * names none (blank, "TBD", "Phase 2", an impossible date, a day with no
 * year). One reading for the web's date boxes, its same-day check and the
 * schedule import (whole-app audit A12 pass 4 L1 and L2, 30 Sep 2026): the
 * web's boxes had used the browser's date parser, which shows a day for
 * forms the check did not recognise, and reads "Phase 2" as 1 Feb 2001.
 *
 * ISO (2026-10-05, 2026-10-5, 2026/10/05), M/D/YYYY or M/D/YY, and month
 * names (Oct 5, 2026; 5 Oct 2026), each with or without a weekday in front
 * or a time after it. The day written is the day meant: a time or zone
 * after it never moves it to another day, in any time zone.
 */
export function scheduleCalendarDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ')
    .replace(LEADING_WEEKDAY, '')
    .replace(TRAILING_TIME, '')
    .trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return parsePlainDate(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`);
  }
  return parsePlainDate(text);
}

/**
 * Whole-app audit A12 M2, schedule side (30 Sep 2026): the web schedule
 * builder saves a task's dates as 2026-10-05, files and the phone as
 * 10/05/2026, so a revised upload compared them as text, found every such
 * task "changed" and made a second copy of it; a lookahead's delete and a
 * new master's repeat check missed them the same way.
 *
 * A schedule date's calendar day, as YYYY-MM-DD (scheduleCalendarDay).
 * Anything that names no day (blank, "TBD", an impossible date) is its own
 * text, trimmed, lower-cased and single-spaced.
 */
export function scheduleCalendarDayKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return scheduleCalendarDay(value) ?? value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The same calendar day, whichever way each is written. */
export function sameScheduleCalendarDay(left: unknown, right: unknown): boolean {
  return scheduleCalendarDayKey(left) === scheduleCalendarDayKey(right);
}
