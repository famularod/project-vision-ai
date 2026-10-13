/**
 * Review pass 1, L3 (older), the door a file comes in by: the schedule
 * import's date reader takes a year such as 0202 or 9999 ("5/1/0202" is read
 * as 1 May 0202), and nothing in the review said so. A date outside 2000
 * through 2100 is now flagged "check this date" in the review, on the phone,
 * the iPad and the web, before the import is approved. The date itself is
 * never changed for him, and the flag does not stop the import.
 */
import {
  scheduleImportBatchCounts,
  scheduleImportItemHasCoreFacts,
  scheduleImportItemIsReady,
  scheduleImportReviewFields,
} from '../../services/PIEScheduleImportBatch';
import { scheduleDatesToCheck } from '../../services/ScheduleInputLimits';
import {
  scheduleImportDateWarnings,
  validateScheduleImportScope,
} from '../../services/ScheduleImportScopeGuard';
import type { ScheduleItem } from '../../types';

function row(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    scheduleProjectName: 'Lot 9',
    projectName: 'Lot 9',
    locationName: 'North Pad',
    taskName: id,
    startDate: '07/20/2026',
    finishDate: '07/24/2026',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 5,
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}

const START = (value: string) => `Check this date: the start date ${value} is outside 2000 to 2100.`;
const FINISH = (value: string) => `Check this date: the finish date ${value} is outside 2000 to 2100.`;

describe('L3: which dates are to be checked', () => {
  it.each([
    ['5/1/0202', '07/24/2026', [START('5/1/0202')]],
    ['0202-05-01', '2026-07-24', [START('0202-05-01')]],
    ['07/20/2026', '12/31/9999', [FINISH('12/31/9999')]],
    ['12/31/1999', '1/3/2000', [START('12/31/1999')]],
    ['12/30/2100', '1/2/2101', [FINISH('1/2/2101')]],
    ['May 1, 0202', 'May 4, 0202', [START('May 1, 0202'), FINISH('May 4, 0202')]],
    ['Mon 5/1/0202', '', [START('Mon 5/1/0202')]],
    // How the import itself writes back a year below 1000: three digits, which no date reader takes as a day.
    ['05/01/202', '07/24/2026', [START('05/01/202')]],
    ['07/20/2026', '12/31/999', [FINISH('12/31/999')]],
  ])('start "%s", finish "%s"', (startDate, finishDate, expected) => {
    expect(scheduleDatesToCheck({ startDate, finishDate }).map(check => check.text)).toEqual(expected);
  });

  it('one day written once for both: asked once', () => {
    expect(scheduleDatesToCheck({ startDate: '5/1/0202', finishDate: '0202-05-01' }).map(check => check.text))
      .toEqual(['Check this date: the date 5/1/0202 is outside 2000 to 2100.']);
  });

  it.each([
    ['07/20/2026', '07/24/2026'],
    ['1/1/2000', '12/31/2100'],
    ['', ''],
    ['TBD', 'Phase 2'],
    ['13/45/2026', '2/30/2026'],
    ['7/20/26', '7/24/26'],
    ['13/01/202', '0/5/202'],
  ])('start "%s", finish "%s": nothing to check here', (startDate, finishDate) => {
    expect(scheduleDatesToCheck({ startDate, finishDate })).toEqual([]);
  });
});

describe('L3: the review on the phone and iPad', () => {
  const typo = row('typo', { taskName: 'Grade pad', startDate: '5/1/0202', finishDate: '5/4/0202' });

  it('the row reads "Needs date check" and counts as needing review (was: "Ready to add")', () => {
    expect(scheduleImportReviewFields(typo)).toEqual(['date check']);
    expect(scheduleImportItemIsReady(typo)).toBe(false);
    expect(scheduleImportBatchCounts([row('fine'), typo])).toEqual({ total: 2, ready: 1, needsReview: 1 });
  });

  it('it is a flag, not a refusal: the import can still be accepted as it is', () => {
    expect(scheduleImportItemHasCoreFacts(typo)).toBe(true);
    // It is not one of the date faults that stop an import (a date that cannot be read, a finish before the start).
    expect(scheduleImportDateWarnings(typo)).toEqual([]);
  });

  it('the import\'s warnings name the task and the date, and the date is kept exactly as written', () => {
    const validation = validateScheduleImportScope({
      items: [row('fine'), typo, row('late', { taskName: 'Close out', finishDate: '12/31/9999' })],
      selectedProjects: [{ id: 'lot-9', name: 'Lot 9' }],
    });
    expect(validation.warnings.map(warning => [warning.itemId, warning.code, warning.field, warning.sourceValue, warning.message])).toEqual([
      ['typo', 'start_date_out_of_range', 'start_date', '5/1/0202', 'Grade pad. Check this date: the start date 5/1/0202 is outside 2000 to 2100. It is kept as written.'],
      ['typo', 'finish_date_out_of_range', 'finish_date', '5/4/0202', 'Grade pad. Check this date: the finish date 5/4/0202 is outside 2000 to 2100. It is kept as written.'],
      ['late', 'finish_date_out_of_range', 'finish_date', '12/31/9999', 'Close out. Check this date: the finish date 12/31/9999 is outside 2000 to 2100. It is kept as written.'],
    ]);
    expect(validation.items.map(item => [item.startDate, item.finishDate])).toEqual([
      ['07/20/2026', '07/24/2026'],
      ['5/1/0202', '5/4/0202'],
      ['07/20/2026', '12/31/9999'],
    ]);
  });

  it('a row with a real fault as well reads "Needs date", as before', () => {
    const broken = row('broken', { startDate: '5/1/0202', finishDate: 'soon' });
    expect(scheduleImportReviewFields(broken)).toEqual(['date']);
    expect(scheduleImportItemHasCoreFacts(broken)).toBe(false);
  });

  it('a CSV\'s "5/1/0202", which the import writes back as 05/01/202: already "Needs date", and now told why, once', () => {
    const written = row('written', { taskName: 'Grade pad', startDate: '05/01/202' });
    expect(scheduleImportReviewFields(written)).toEqual(['date']);
    expect(scheduleDatesToCheck(written).map(check => check.text)).toEqual([START('05/01/202')]);
    const validation = validateScheduleImportScope({ items: [written], selectedProjects: [{ id: 'lot-9', name: 'Lot 9' }] });
    // The unreadable-date warning it already had; not a second one for the same date.
    expect(validation.warnings.map(warning => warning.message)).toEqual(['Start date "05/01/202" is invalid and needs review.']);
  });

  // Guards: these already hold.
  it('an ordinary row is ready, and a row with no finish date still needs a date', () => {
    expect(scheduleImportReviewFields(row('fine'))).toEqual([]);
    expect(scheduleImportReviewFields(row('undated', { finishDate: '' }))).toEqual(['date']);
  });
});
