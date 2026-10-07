import { scheduleCalendarDay } from './ScheduleCalendarDay';

/**
 * What the schedule accepts for a task's duration, a link's lag and a date
 * (independent review R08, Build 229: the desktop editor took a duration of
 * a billion working days, and the preview then counted them out one day at
 * a time and did not finish).
 *
 * - Duration: up to 2,600 working days, which is ten years of weekdays. No
 *   single line of a job schedule runs longer, and a whole multi-year job
 *   entered as one line still fits. The calculation walks a duration day by
 *   day, so at the limit that is 2,600 steps for a task.
 * - Lag: up to 365 working days, what the calculation already kept a link's
 *   lag to (it silently cut a longer one down).
 * - Dates: a real calendar day from 2000 through 2100. The timeline draws
 *   one column per day between the first and last date, so a year typed as
 *   0202 made hundreds of thousands of columns.
 */
export const SCHEDULE_MAX_DURATION_WORKING_DAYS = 2_600;
export const SCHEDULE_MAX_LAG_WORKING_DAYS = 365;
export const SCHEDULE_FIRST_YEAR = 2000;
export const SCHEDULE_LAST_YEAR = 2100;

export const SCHEDULE_DURATION_RANGE_TEXT =
  'Enter the duration in working days as a number from 0 to 2,600, or leave it blank.';
export const SCHEDULE_LAG_RANGE_TEXT =
  'Enter the lag in working days as a number from 0 to 365.';

export function scheduleDateRangeText(label: string): string {
  return `${label} must be a real date from ${SCHEDULE_FIRST_YEAR} through ${SCHEDULE_LAST_YEAR}.`;
}

/** Digits with an optional decimal part: "5", "2.5". Not "1e9", "-3", "five". */
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;

function boxNumber(text: string): number | null {
  const trimmed = text.trim();
  return PLAIN_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Why a typed duration cannot be used, or null when it can. A blank box is
 * allowed: the task's dates give its duration.
 */
export function scheduleDurationBoxProblem(text: string): string | null {
  if (!text.trim()) return null;
  const days = boxNumber(text);
  return days === null || !scheduleDurationIsSupported(days) ? SCHEDULE_DURATION_RANGE_TEXT : null;
}

/** Why a typed lag cannot be used, or null when it can. A blank box is no lag. */
export function scheduleLagBoxProblem(text: string): string | null {
  if (!text.trim()) return null;
  const days = boxNumber(text);
  return days === null || days > SCHEDULE_MAX_LAG_WORKING_DAYS ? SCHEDULE_LAG_RANGE_TEXT : null;
}

/**
 * Whether a duration, typed, stored or imported, is one the calculation
 * takes. Not set (null, 0) is supported: the dates are used instead.
 */
export function scheduleDurationIsSupported(days: unknown): boolean {
  if (days === null || days === undefined) return true;
  return typeof days === 'number' && Number.isFinite(days) && days >= 0 &&
    Math.round(days) <= SCHEDULE_MAX_DURATION_WORKING_DAYS;
}

/** Whether a calendar day (YYYY-MM-DD, or a Date read in UTC) is in the years the schedule takes. */
export function scheduleDayIsSupported(day: string | Date): boolean {
  const year = typeof day === 'string' ? Number(day.slice(0, 4)) : day.getUTCFullYear();
  return Number.isFinite(year) && year >= SCHEDULE_FIRST_YEAR && year <= SCHEDULE_LAST_YEAR;
}

/**
 * A month/day/year date whose year has one or three digits: "05/01/202".
 * That is how the schedule import writes back a year below 1000 (it read
 * "5/1/0202" as 1 May 202). No date reader takes it as a day, but it is one,
 * in a year the schedule does not take.
 */
const SHORT_YEAR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d|\d{3})$/;

/**
 * Whether a schedule date, however it is written ("5/1/0202", "0202-05-01",
 * "May 1, 0202", "05/01/202"), names a real day outside the years the
 * schedule takes. Text that names no day at all (blank, "TBD") is not such
 * a date.
 */
export function scheduleDateIsOutsideSupportedYears(value: unknown): boolean {
  const day = scheduleCalendarDay(value);
  if (day !== null) return !scheduleDayIsSupported(day);
  const short = typeof value === 'string' ? value.trim().match(SHORT_YEAR_DATE) : null;
  return Boolean(short && Number(short[1]) >= 1 && Number(short[1]) <= 12 && Number(short[2]) >= 1 && Number(short[2]) <= 31);
}

export type ScheduleDateToCheck = Readonly<{
  which: 'start' | 'finish' | 'both';
  /** The date exactly as it is written. */
  value: string;
  /** What the review says about it. */
  text: string;
}>;

/**
 * The dates of a task that a person should look at before it is taken into
 * the schedule: a real day outside 2000 through 2100, which is nearly always
 * a mistyped year (review pass 1, L3: the import took "5/1/0202" without a
 * word). The date is only pointed out. It is never changed for him, and the
 * task is not refused.
 */
export function scheduleDatesToCheck(
  item: Readonly<{ startDate?: string | null; finishDate?: string | null }>,
): ScheduleDateToCheck[] {
  const start = (item.startDate || '').trim();
  const finish = (item.finishDate || '').trim();
  const startOutside = scheduleDateIsOutsideSupportedYears(start);
  const finishOutside = scheduleDateIsOutsideSupportedYears(finish);
  const say = (which: ScheduleDateToCheck['which'], value: string): ScheduleDateToCheck => ({
    which,
    value,
    text: `Check this date: the ${which === 'both' ? 'date' : `${which} date`} ${value} is outside ${SCHEDULE_FIRST_YEAR} to ${SCHEDULE_LAST_YEAR}.`,
  });
  if (startOutside && finishOutside && (scheduleCalendarDay(start) ?? start) === (scheduleCalendarDay(finish) ?? finish)) {
    return [say('both', start)];
  }
  return [
    ...(startOutside ? [say('start', start)] : []),
    ...(finishOutside ? [say('finish', finish)] : []),
  ];
}
