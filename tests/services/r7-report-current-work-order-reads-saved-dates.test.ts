/**
 * R7 item E (review pass 1, F8).
 *
 * Current Work lists the soonest finish first (R4 item 4a). The order read a
 * task's dates only as 10/08/2026 or 2026-10-08, so a task whose finish was
 * saved as "Nov 8, 2026" (schedule imports saved dates that way until
 * 30 Sep 2026, and those rows are still saved) was listed last, as if it had
 * no date. The order now reads a date as the rest of the app does
 * (scheduleCalendarDay): every form the app has saved a task's date in. A
 * date that names no day still goes last.
 *
 * The real CSV reader, shown list, the one report recipe and the report.
 * Synthetic data.
 */
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

const NOW = '2026-09-01T18:00:00.000Z';
const IMPORTED = '2026-08-20T15:00:00.000Z';
const DOCUMENT = {
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1',
} as unknown as ReferenceDocument;
/** Tasks all well in the future (none overdue or due soon on 1 Sep 2026), so Current Work is one group. */
const ITEMS = (normalizeScheduleImport({
  contents: [
    'Task,Project,Area,Start,Finish,Percent Complete',
    'Paint,Alpha,Lot,11/02/2026,11/20/2026,',       // m1-1
    'Drywall,Alpha,Lot,11/01/2026,11/10/2026,',     // m1-2
    'Framing,Alpha,Lot,11/03/2026,11/20/2026,',     // m1-3
    'Punch list,Alpha,Lot,,,',                       // m1-4  no dates
    'Cleanup,Alpha,Lot,11/04/2026,11/12/2026,',     // m1-5
  ].join('\n'),
  sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
}).items as ScheduleItem[]).map((item, index) => ({
  ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls(undefined), activity: [],
} as ScheduleItem));
/** The same saved tasks with Framing's dates saved another way. */
const withFraming = (startDate: string, finishDate: string) => ITEMS.map(item => (item.id === 'm1-3' ? { ...item, startDate, finishDate } : item));

function report(items: ScheduleItem[]) {
  const shown = selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: [DOCUMENT] }) as ScheduleItem[];
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
    knownScheduleItems: items, knownScheduleDocuments: [DOCUMENT], projectAreas: [], referenceDocuments: [DOCUMENT], now: NOW,
  });
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null, scheduleItems: shown });
  return {
    order: truths[0].schedule.map(task => task.taskId),
    /** The task each Current Work line is about, in the order written. */
    currentWork: briefing.currentWork.map(line => line.split(' (')[0].split(':')[0]),
    fingerprint: buildDAVEReportSourceFingerprint(truths),
  };
}

describe('R7 item E: Current Work lists a task by its finish, whichever way the date was saved', () => {
  it('(the rig) with every date as files and the phone save it: by finish, then start; the task with no date last', () => {
    const read = report(ITEMS);
    expect(read.order).toEqual(['m1-2', 'm1-5', 'm1-1', 'm1-3', 'm1-4']);
    expect(read.currentWork).toEqual(['Drywall', 'Cleanup', 'Paint', 'Framing', 'Punch list']);
  });

  it('a finish saved as "Nov 8, 2026" (rows imported before 30 Sep 2026) is listed where 8 Nov belongs: first, not last', () => {
    const read = report(withFraming('Nov 3, 2026', 'Nov 8, 2026'));
    expect(read.order).toEqual(['m1-3', 'm1-2', 'm1-5', 'm1-1', 'm1-4']);
    expect(read.currentWork).toEqual(['Framing', 'Drywall', 'Cleanup', 'Paint', 'Punch list']);
    // (It read: Drywall, Cleanup, Paint, then Punch list and Framing among the undated.)
  });

  it.each([
    ['as files and the phone save it', '11/03/2026', '11/08/2026'],
    ['as the web\'s schedule builder saves it', '2026-11-03', '2026-11-08'],
    ['as imports saved it until 30 Sep 2026', 'Nov 3, 2026', 'Nov 8, 2026'],
    ['the month written out', 'November 3, 2026', 'November 8, 2026'],
    ['the day first', '3 Nov 2026', '8 Nov 2026'],
    ['typed short', '11/3/26', '11/8/26'],
    ['with slashes, the year first', '2026/11/03', '2026/11/08'],
    ['with a weekday in front', 'Tue 11/3/2026', 'Sunday, November 8, 2026'],
    ['with a time after it', '2026-11-03T08:00:00.000Z', '11/08/2026 5:00 PM'],
  ])('the same day %s: the same place in the list', (_how, startDate, finishDate) => {
    expect(report(withFraming(startDate, finishDate)).order).toEqual(['m1-3', 'm1-2', 'm1-5', 'm1-1', 'm1-4']);
  });

  it('two tasks on one finish are still told apart by their start, whichever way each was saved', () => {
    // Framing finishes with Paint (20 Nov) and starts a day later: after Paint. Its start a day earlier: before Paint.
    expect(report(withFraming('Nov 3, 2026', 'Nov 20, 2026')).order).toEqual(['m1-2', 'm1-5', 'm1-1', 'm1-3', 'm1-4']);
    expect(report(withFraming('Nov 1, 2026', 'Nov 20, 2026')).order).toEqual(['m1-2', 'm1-5', 'm1-3', 'm1-1', 'm1-4']);
  });

  it.each([
    ['a word', 'TBD'],
    ['a phase', 'Phase 2'],
    ['an impossible date', '13/45/2026'],
    ['a day with no year', 'Nov 8'],
  ])('guard: a finish that names no day (%s) still goes last, with the task that has no date', (_what, finishDate) => {
    const read = report(withFraming('', finishDate));
    expect(read.order.slice(0, 3)).toEqual(['m1-2', 'm1-5', 'm1-1']);
    expect([...read.order.slice(3)].sort()).toEqual(['m1-3', 'm1-4']);
  });

  it('guard: the order does not follow the order the tasks were saved in', () => {
    const saved = withFraming('Nov 3, 2026', 'Nov 8, 2026');
    const first = report(saved);
    expect(report([...saved].reverse()).order).toEqual(first.order);
    expect(report([...saved].reverse()).fingerprint).toBe(first.fingerprint);
  });
});
