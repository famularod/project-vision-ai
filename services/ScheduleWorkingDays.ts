/**
 * The one rule for counting a schedule's days (the owner's answer to
 * question 41, 13 Oct 2026: "make skipping weekends teh defalut but teh optn
 * to change ti include weekends").
 *
 * A task with a start and a finish date and no length typed in had its
 * length worked out in two places that disagreed: the critical path counted
 * every calendar day and rescheduling counted Monday to Friday, so a task
 * from a Friday to the Monday was 4 days in one and 2 in the other. Both ask
 * here now, and the answer is working days.
 *
 * Which days are working days is said once, in isScheduleWorkingDay: Monday
 * to Friday. Counting weekends too, for a project he chooses, is not built;
 * it would be decided there.
 */

const DAY_MS = 86_400_000;

/** Monday to Friday. A schedule day is midnight UTC of its calendar day, as the schedule's date readers give it. */
export function isScheduleWorkingDay(day: Date): boolean {
  const weekday = day.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * The working days from `start` through `finish`, both days counted: Friday
 * through Monday is 2, a Saturday through its Sunday is 0, and a finish
 * before the start is 0.
 *
 * Worked out, not counted out: every whole week holds five, and at most six
 * days are left over. Dates centuries apart cost what a week costs
 * (independent review R08: a length was once counted out one day at a time
 * and did not finish).
 */
export function scheduleWorkingDaysFromThrough(start: Date, finish: Date): number {
  const days = Math.round((finish.getTime() - start.getTime()) / DAY_MS) + 1;
  if (!(days > 0)) return 0;
  const leftOver = days % 7;
  let count = ((days - leftOver) / 7) * 5;
  for (let index = 0; index < leftOver; index += 1) {
    if (isScheduleWorkingDay(new Date(start.getTime() + index * DAY_MS))) count += 1;
  }
  return count;
}

/**
 * How long a task is, in working days, for every calculation that needs it
 * (the critical path and float; the dates rescheduling gives).
 *
 * - A milestone has no length.
 * - A length typed in (or imported) is used exactly, including fractional
 *   working days. Date-only rescheduling spans every occupied working day.
 *   It is never replaced by what the dates say.
 * - With nothing typed, the dates give it: the working days from the start
 *   through the finish, never less than one (a task wholly on a weekend is
 *   still a day's work).
 * - With no dates to go on, one day.
 *
 * The caller reads the task's dates, each with the date reader it already
 * uses, and passes the days in.
 */
export function scheduleTaskLengthInWorkingDays(
  task: Readonly<{ isMilestone?: boolean | null; durationDays?: number | null }>,
  start: Date | null,
  finish: Date | null,
): number {
  if (task.isMilestone) return 0;
  if (
    typeof task.durationDays === 'number' &&
    Number.isFinite(task.durationDays) &&
    task.durationDays > 0
  ) {
    return task.durationDays;
  }
  return start && finish && finish.getTime() >= start.getTime()
    ? Math.max(1, scheduleWorkingDaysFromThrough(start, finish))
    : 1;
}
