/**
 * @jest-environment node
 */
import {
  forgetReportSourcesKnownAs, rememberReportSourceBeforeNotesFollowed, reportSourceKnownAs, reportSourcesBeforeNotesFollowedOf, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebReportSentHereAt,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// R6 item 1 (the coordinator's decisions on R5's finding and on review pass 1): the web's own record of a send, and
// a report made before a task's notes followed it. Since schedule batch S5 the first sync on the new build brings a
// task's notes forward to the row shown, which moves two facts of a report; the app keeps the 1.0 fingerprint of the
// facts as they were before as one more name of today's, never taken alone for a saved report (DAVEReportSnapshot). The
// places where the web's record of a send meets today's fingerprint are R5 item 2's: this browser's list of the
// reports it sent, and the checks made as a send is recorded. Each is exercised here with a report a released build
// made before the notes followed meeting the same facts today; and, once it has been recognised, meeting facts whose
// left-out note has changed, which is another report.
// A browser storage and an in-memory shared record. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

let values = new Map<string, string>();
const profile = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
/** The shared record's one row for this period, or 'missing' when reports are not shared between devices. */
let shared: DAVEReportSnapshot | null | 'missing' = 'missing';
const load = async () => (shared === 'missing' ? 'unavailable' as const : { ownerId: 'owner-1', snapshot: shared });
const save = async (row: { snapshot: unknown }) => {
  if (shared === 'missing') return 'unavailable' as const;
  shared = JSON.parse(JSON.stringify(row.snapshot)) as DAVEReportSnapshot;
  return 'saved' as const;
};
const root = globalThis as unknown as { localStorage?: unknown };
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
});

/** The facts on the page today (the notes on the task's row), and the 1.0 fingerprint a released build gave the same facts before the notes followed. */
const TODAY = 'dave-report-source/2.0:0a1b2c3d';
const BUILD_BEFORE = 'dave-report-source/1.0:4e5f6a7b';
/** Other facts, today's and before. */
const OTHER_TODAY = 'dave-report-source/2.0:99999999';
const OTHER_BEFORE = 'dave-report-source/1.0:88888888';
/** Today's facts once the note left out has changed (a note added on the old row, or reworded): the name of before is the same. */
const NOTE_CHANGED = 'dave-report-source/2.0:5a5a5a5a';

beforeEach(() => {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  values = new Map();
  shared = 'missing';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  // As the page does whenever it works out today's fingerprint: the one the facts had before the notes followed is
  // worked out beside it, with the key of the notes on the tasks' earlier rows as they are.
  forgetReportSourcesKnownAs();
  rememberReportSourceBeforeNotesFollowed(TODAY, BUILD_BEFORE, 'the-notes-as-they-were');
  rememberReportSourceBeforeNotesFollowed(OTHER_TODAY, OTHER_BEFORE, 'the-notes-as-they-were');
  rememberReportSourceBeforeNotesFollowed(NOTE_CHANGED, BUILD_BEFORE, 'one-of-the-notes-changed');
});

const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as const };
const at = (n: number) => new Date(Date.parse('2026-09-01T15:00:00.000Z') + n * 86_400_000).toISOString();
const report = (n: number, sourceFingerprint: string, more: Partial<DAVEReportSnapshot> = {}) => ({
  version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt: at(n), sourceFingerprint, reportFormat: 'project_manager', tasks: [], ...more,
}) as unknown as DAVEReportSnapshot;
const tab = () => ({ storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) });
/** He approves and sends a report with these facts (one a day). */
async function send(store: ReturnType<typeof tab>, n: number, fingerprint: string) {
  const period = (await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot;
  const before = period?.deliveredAt ?? null;
  expect((await approveDAVEWebReportPeriod(store, report(n, fingerprint), before)).status).toBe('saved');
  expect((await recordDAVEWebReportSend(store, PERIOD, fingerprint, at(n)))?.status).toBe('saved');
}
/** The tab is closed; a new tab of the same browser reads the period. */
async function inTheNextTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  return (await loadDAVEWebReportPeriod(tab(), 'tower', 'project_manager')).snapshot;
}

describe('R6 item 1: this browser\'s list of the reports it sent, and a report sent before the notes followed', () => {
  it('a report sent before the notes followed, from before the three a period remembers, is still known as sent from here by today\'s fingerprint of its facts', async () => {
    const store = tab();
    // The first was sent by the build before: its place in the list is under the fingerprint its facts had then.
    await send(store, 1, BUILD_BEFORE);
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:0000000${n}`);
    const period = await inTheNextTab();
    // The period remembers the last three; the first is known by the list alone.
    expect([period?.deliveredAt, period?.supersedes?.deliveredAt, period?.supersedes?.supersedes?.deliveredAt]).toEqual([at(5), at(4), at(3)]);
    expect(daveWebReportSentHereAt(period, TODAY)).toBe(at(1));
    expect(daveWebReportSentHereAt(period, BUILD_BEFORE)).toBe(at(1));
  });

  it('guard: never for other facts', async () => {
    const store = tab();
    await send(store, 1, BUILD_BEFORE);
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:0000000${n}`);
    const period = await inTheNextTab();
    expect(daveWebReportSentHereAt(period, OTHER_TODAY)).toBeNull();
    expect(daveWebReportSentHereAt(period, OTHER_BEFORE)).toBeNull();
  });

  it('guard: one way by construction: only a fingerprint a released build wrote (1.0) is ever taken as the name facts had before', async () => {
    const store = tab();
    // A report this build sent, of other facts, from before the three a period remembers.
    await send(store, 1, OTHER_TODAY);
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:0000000${n}`);
    const period = await inTheNextTab();
    // Were it ever handed in as "the name today's facts had before", it is not taken: it is not a 1.0 fingerprint.
    rememberReportSourceBeforeNotesFollowed(TODAY, OTHER_TODAY, 'the-notes-as-they-were');
    expect(reportSourcesBeforeNotesFollowedOf(TODAY)).toEqual([]);
    expect(sameReportSource(OTHER_TODAY, TODAY)).toBe(false);
    expect(daveWebReportSentHereAt(period, TODAY)).toBeNull();
  });
});

describe('R6 item 1: recording a send of an approval made before the notes followed', () => {
  it('the approval waiting on this computer is this report\'s: another device\'s later report stops it, and is named', async () => {
    shared = null;
    const store = tab();
    // Approved here by the build before, and not sent.
    expect((await approveDAVEWebReportPeriod(store, report(1, BUILD_BEFORE), null)).status).toBe('saved');
    // The phone sent a later report of other facts.
    shared = report(2, OTHER_TODAY, { deliveredAt: at(2), sentBy: 'phone-install' });
    const outcome = await recordDAVEWebReportSend(store, PERIOD, TODAY, at(3));
    // (Not known as this computer's approval, the send read as "could not record that this report was sent": null.)
    expect(outcome).toMatchObject({ status: 'later_send', later: { deliveredAt: at(2), sentBy: 'phone-install' } });
  });

  it('with nothing sent since, that approval is recorded as sent, as it was approved', async () => {
    const store = tab();
    expect((await approveDAVEWebReportPeriod(store, report(1, BUILD_BEFORE), null)).status).toBe('saved');
    const outcome = await recordDAVEWebReportSend(store, PERIOD, TODAY, at(3));
    expect(outcome).toMatchObject({ status: 'saved', snapshot: { sourceFingerprint: BUILD_BEFORE, deliveredAt: at(3) } });
    expect(daveWebReportSentHereAt((await inTheNextTab()), TODAY)).toBe(at(3));
  });

  it('the approval waiting only in the shared record (approved in another browser before the update) is this report\'s, and its send is recorded', async () => {
    // This computer holds no copy of it.
    shared = report(1, BUILD_BEFORE, { deliveredAt: null });
    const store = tab();
    const outcome = await recordDAVEWebReportSend(store, PERIOD, TODAY, at(3));
    // (Not known as this report's approval, nothing was recorded: null, and the page said it could not record the send.)
    expect(outcome).toMatchObject({ status: 'saved', snapshot: { sourceFingerprint: BUILD_BEFORE, deliveredAt: at(3) } });
    expect(shared).toMatchObject({ sourceFingerprint: BUILD_BEFORE, deliveredAt: at(3) });
  });

  it('guard: an approval of other facts waiting in the shared record is not this report\'s', async () => {
    shared = report(1, OTHER_BEFORE, { deliveredAt: null });
    expect(await recordDAVEWebReportSend(tab(), PERIOD, TODAY, at(3))).toBeNull();
    expect(shared).toMatchObject({ sourceFingerprint: OTHER_BEFORE, deliveredAt: null });
    expect(sameReportSource(OTHER_BEFORE, TODAY)).toBe(false);
  });

  it('guard: once that approval has been recognised as today\'s facts, facts whose left-out note has changed since are another report: nothing is recorded for them', async () => {
    shared = report(1, BUILD_BEFORE, { deliveredAt: null });
    const store = tab();
    // The page reads the period and compares: recognised, and today's full fingerprint and the notes' key are kept beside it.
    const waiting = (await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot;
    expect(sameReportSource(waiting?.sourceFingerprint, TODAY)).toBe(true);
    expect(reportSourceKnownAs(BUILD_BEFORE)).toBe(TODAY);
    // A note is added on the old row and brought forward: other facts, with the same name of before.
    expect(sameReportSource(BUILD_BEFORE, NOTE_CHANGED)).toBe(false);
    expect(await recordDAVEWebReportSend(store, PERIOD, NOTE_CHANGED, at(3))).toBeNull();
    expect(shared).toMatchObject({ sourceFingerprint: BUILD_BEFORE, deliveredAt: null });
    // Today's facts as they were recognised are still that approval's.
    expect(await recordDAVEWebReportSend(store, PERIOD, TODAY, at(3))).toMatchObject({ status: 'saved', snapshot: { sourceFingerprint: BUILD_BEFORE, deliveredAt: at(3) } });
  });

  it('guard: nor is a report this browser sent then known as sent from here for those changed facts, by the period or by the list; and the next tab remembers what it was recognised as', async () => {
    const store = tab();
    await send(store, 1, BUILD_BEFORE);
    expect(daveWebReportSentHereAt(await inTheNextTab(), TODAY)).toBe(at(1));
    expect(daveWebReportSentHereAt(await inTheNextTab(), NOTE_CHANGED)).toBeNull();
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:1000000${n}`);
    // From before the three the period remembers: by this browser's own list alone.
    forgetReportSourcesKnownAs();
    const period = await inTheNextTab();
    expect(reportSourceKnownAs(BUILD_BEFORE)).toBe(TODAY);
    expect(daveWebReportSentHereAt(period, NOTE_CHANGED)).toBeNull();
    expect(daveWebReportSentHereAt(period, TODAY)).toBe(at(1));
  });
});
