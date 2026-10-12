/**
 * R7 item D (the coordinator's decision on review pass 1, F4).
 *
 * Under Completed Work a task reads "Last updated <day>". The day was the
 * moment's day in UTC, so a task he completed at 6:30 in the evening Pacific
 * time, or one a master schedule approved that evening completed, read as
 * updated the next day. A moment is now written as the day it was on the
 * device; a date with no time is written exactly as before.
 *
 * Every moment the line can take its day from: a master schedule approved
 * (R5 item 3), his own 100%, a note typed on the task, and the task's own
 * last save. The real CSV reader, shown list, Project Truth and report.
 * Synthetic data.
 *
 * The time zone is the one the test process runs in. Run as it is on his Mac
 * (Pacific time), and with TZ=America/Los_Angeles, TZ=Asia/Tokyo and TZ=UTC
 * set before node starts.
 */
import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
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

const IMPORTED = '2026-09-20T15:00:00.000Z';
const NOW = '2026-10-03T16:00:00.000Z';
/** Thursday 1 Oct 2026, 6:30 in the evening in Los Angeles: already 2 Oct in UTC and in Tokyo. */
const EVENING_PACIFIC = '2026-10-02T01:30:00.000Z';
/** Thursday 1 Oct 2026, 4:30 in the afternoon in UTC, 9:30 in the morning in Los Angeles: already 2 Oct in Tokyo. */
const AFTERNOON_UTC = '2026-10-01T16:30:00.000Z';
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** The day each moment was, where the answer is known by hand. */
const BY_HAND: Record<string, { evening: string; afternoon: string }> = {
  'America/Los_Angeles': { evening: 'Oct 1, 2026', afternoon: 'Oct 1, 2026' },
  'Asia/Tokyo': { evening: 'Oct 2, 2026', afternoon: 'Oct 2, 2026' },
  UTC: { evening: 'Oct 2, 2026', afternoon: 'Oct 1, 2026' },
};
/** And in any other zone: the day the moment was there. */
const dayHere = (moment: string) => new Date(moment).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const EVENING_DAY = BY_HAND[ZONE]?.evening ?? dayHere(EVENING_PACIFIC);
const AFTERNOON_DAY = BY_HAND[ZONE]?.afternoon ?? dayHere(AFTERNOON_UTC);

const DOCUMENT = {
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1',
} as unknown as ReferenceDocument;

/** The Completed Work lines of a report whose one task, Paint, is complete, with `change` saved on it. */
function completedWork(change: Partial<ScheduleItem>): string[] {
  const items = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,09/21/2026,09/30/2026,100'].join('\n'),
    sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls(undefined), activity: [], ...change,
  } as ScheduleItem));
  const shown = selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: [DOCUMENT] }) as ScheduleItem[];
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
    knownScheduleItems: items, knownScheduleDocuments: [DOCUMENT], projectAreas: [], referenceDocuments: [DOCUMENT], now: NOW,
  });
  return [...buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null, scheduleItems: shown }).completedWork];
}
const LINE = (day: string) => [`Paint (Lot): Complete; 100% complete. Last updated ${day}.`];

describe(`R7 item D: "Last updated <day>" is the day it was on the device (this run: ${ZONE})`, () => {
  it('(the rig) the two moments are on different days in UTC, and where the answer is known by hand it is the one the device gives', () => {
    expect(EVENING_PACIFIC.slice(0, 10)).toBe('2026-10-02');
    expect(AFTERNOON_UTC.slice(0, 10)).toBe('2026-10-01');
    expect([EVENING_DAY, AFTERNOON_DAY]).toEqual([dayHere(EVENING_PACIFIC), dayHere(AFTERNOON_UTC)]);
  });

  it('a master schedule approved that evening completed the task (R5 item 3): the day he approved it', () => {
    expect(completedWork({ fileProgressPeak: { percentComplete: 100, statedAt: EVENING_PACIFIC } } as Partial<ScheduleItem>)).toEqual(LINE(EVENING_DAY));
    expect(completedWork({ fileProgressPeak: { percentComplete: 100, statedAt: AFTERNOON_UTC } } as Partial<ScheduleItem>)).toEqual(LINE(AFTERNOON_DAY));
  });

  it('he confirmed 100% himself that evening: that day', () => {
    expect(completedWork({ progressSource: 'project_manager', progressConfirmedAt: EVENING_PACIFIC, progressConfirmedBy: 'David' })).toEqual(LINE(EVENING_DAY));
    expect(completedWork({ progressSource: 'project_manager', progressConfirmedAt: AFTERNOON_UTC, progressConfirmedBy: 'David' })).toEqual(LINE(AFTERNOON_DAY));
  });

  it('a note typed on the task that evening: that day', () => {
    const note = (createdAt: string) => ({ activity: [{ id: 'note-1', message: 'Touch-up done.', author: 'David', createdAt }] }) as Partial<ScheduleItem>;
    expect(completedWork(note(EVENING_PACIFIC))).toEqual(LINE(EVENING_DAY));
    expect(completedWork(note(AFTERNOON_UTC))).toEqual(LINE(AFTERNOON_DAY));
  });

  it('nothing but the task\'s own last save, that evening: that day', () => {
    expect(completedWork({ updatedAt: EVENING_PACIFIC })).toEqual(LINE(EVENING_DAY));
    expect(completedWork({ updatedAt: AFTERNOON_UTC })).toEqual(LINE(AFTERNOON_DAY));
  });

  it('guard: a date with no time is written as that calendar day, in every time zone, exactly as before', () => {
    expect(completedWork({ progressSource: 'project_manager', progressConfirmedAt: '2026-10-01', progressConfirmedBy: 'David' })).toEqual(LINE('Oct 1, 2026'));
    expect(completedWork({ updatedAt: '2026-10-02' })).toEqual(LINE('Oct 2, 2026'));
  });

  it('guard: the newest of the moments is still the one written', () => {
    expect(completedWork({
      progressSource: 'project_manager', progressConfirmedAt: AFTERNOON_UTC, progressConfirmedBy: 'David',
      activity: [{ id: 'note-1', message: 'Touch-up done.', author: 'David', createdAt: EVENING_PACIFIC }],
    } as Partial<ScheduleItem>)).toEqual(LINE(EVENING_DAY));
  });
});
