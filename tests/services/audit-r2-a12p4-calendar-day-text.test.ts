/**
 * Whole-app audit A12 pass 4 residual R1 (30 Sep 2026): a schedule date's
 * day as text (formatScheduleCalendarDay), used by the web's Tasks page and
 * its schedule-upload review. The browser's parser had shown 2026-10-05 as
 * 4 Oct west of UTC and "Week 41" as 1 Jan 2041.
 *
 * Run in Los Angeles, UTC+14 and UTC-11 by setting TZ for the jest run;
 * the describe title names the zone it ran in.
 */
import { formatScheduleCalendarDay } from '../../services/ScheduleCalendarDay';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const day = (year: number, month: number, dayOfMonth: number) =>
  new Date(year, month - 1, dayOfMonth).toLocaleDateString();

describe(`a schedule date's day as text (A12 pass 4 R1, ${ZONE})`, () => {
  test.each([
    '2026-10-05',
    '10/05/2026',
    'Oct 5, 2026',
    '2026-10-05T00:00:00.000Z',
    '2026-10-05T23:30:00-07:00',
    'Mon 10/5/26',
  ])('%s is 5 Oct', value => {
    expect(formatScheduleCalendarDay(value)).toBe(day(2026, 10, 5));
  });

  test.each(['', '   ', 'TBD', 'Week 41', 'Phase 2', '2026-02-30', null, undefined])(
    '%p names no day',
    value => {
      expect(formatScheduleCalendarDay(value)).toBeNull();
    },
  );
});
