/**
 * Whole-app audit A12 pass 4 L1 and L2 (30 Sep 2026): one reading of a
 * stored schedule date as a calendar day, shared by the web's date boxes,
 * its same-day check and the schedule import's comparisons.
 *
 * The Schedule Builder's date box read a stored date with the browser's own
 * date parser, which shows a day for 2026-10-05 08:00, 10/5/2026 8:00 AM,
 * Mon 10/5/26 and 2026-10-5; the same-day check did not recognise those, so
 * any builder save rewrote them as 10/05/2026. The browser parser also reads
 * "Phase 2" as 1 Feb 2001 and "Week 41" as 1 Jan 2041. Now the box and the
 * check use the same reading, and text that names no day reads as no day.
 *
 * Run in Los Angeles, UTC+14 and UTC-11: jest cannot change the time zone
 * inside a run, so this file is run three times with TZ set (see the A12
 * pass 4 report). The describe title names the zone it ran in.
 */
import {
  sameScheduleCalendarDay,
  scheduleCalendarDay,
  scheduleCalendarDayKey,
} from '../../services/ScheduleCalendarDay';
import {
  daveWebScheduleDateForSave,
  daveWebScheduleDatesMatch,
} from '../../services/DAVEWebTaskEditing';

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const OCT_5_FORMS = [
  '2026-10-05',
  '10/05/2026',
  '10/5/2026',
  '10/05/26',
  'Oct 5, 2026',
  '5 Oct 2026',
  '2026-10-05T00:00:00.000Z',
  '2026-10-05T23:30:00-05:00',
  // The four the builder's box showed but its same-day check missed.
  '2026-10-05 08:00',
  '10/5/2026 8:00 AM',
  'Mon 10/5/26',
  '2026-10-5',
  // More of the same shapes.
  '10/5/2026, 8:00 AM',
  '10/5/2026 8 AM',
  'Monday, October 5, 2026',
  '2026/10/05',
];

describe(`a stored schedule date read as a calendar day (A12 pass 4 L1, ${ZONE})`, () => {
  test.each(OCT_5_FORMS)('%s is 5 Oct 2026', form => {
    expect(scheduleCalendarDay(form)).toBe('2026-10-05');
    expect(scheduleCalendarDayKey(form)).toBe('2026-10-05');
    expect(daveWebScheduleDatesMatch('2026-10-05', form)).toBe(true);
    expect(daveWebScheduleDatesMatch(form, '10/05/2026')).toBe(true);
  });

  test.each(OCT_5_FORMS)('an unchanged day keeps the stored %s exactly', form => {
    expect(daveWebScheduleDateForSave('2026-10-05', form)).toBe(form);
  });

  test.each(['TBD', 'Phase 2', 'Week 41', 'Oct 5', '13/45/2026', '2026-13-45', '', '   '])(
    '%j names no day',
    text => {
      expect(scheduleCalendarDay(text)).toBeNull();
      expect(daveWebScheduleDatesMatch('2026-10-05', text)).toBe(false);
    },
  );

  test('a different day still differs, and is written in the task’s format', () => {
    expect(daveWebScheduleDatesMatch('2026-10-06', 'Mon 10/5/26')).toBe(false);
    expect(daveWebScheduleDatesMatch('2026-10-04', '2026-10-05 08:00')).toBe(false);
    expect(daveWebScheduleDateForSave('2026-10-07', '10/5/2026 8:00 AM')).toBe('10/07/2026');
    expect(daveWebScheduleDateForSave('2026-10-07', '2026-10-5')).toBe('2026-10-07');
    expect(daveWebScheduleDateForSave('2026-10-07', 'TBD')).toBe('10/07/2026');
  });

  test('the import’s comparisons are unchanged for text that is not a date', () => {
    expect(sameScheduleCalendarDay('TBD', ' tbd ')).toBe(true);
    expect(sameScheduleCalendarDay('Phase 2', 'phase  2')).toBe(true);
    expect(sameScheduleCalendarDay('13/45/2026', '2026-13-45')).toBe(false);
    expect(sameScheduleCalendarDay('', '')).toBe(true);
    expect(sameScheduleCalendarDay('Mon 10/5/26', '10/05/2026')).toBe(true);
  });
});
