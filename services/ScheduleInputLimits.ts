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
