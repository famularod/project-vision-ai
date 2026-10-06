/**
 * @jest-environment node
 */
import { reportPeriodSentAt, type DAVEReportSnapshot, type DAVEReportSnapshotTask } from '../../services/DAVEReportSnapshot';
import { daveWebReportKeptInTabOnlyNote, daveWebReportPeriodNote, readDAVEWebReportPeriod } from '../../services/DAVEWebReportPeriod';
import {
  approveDAVEWebReportPeriod,
  daveWebReportOlderPeriodLeftInBrowser,
  daveWebReportPeriodKeptInTabOnly,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  daveWebStoredReportValue,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// Review N4 of reports (6 Oct 2026), L2 (Low, caused by 46e3332 and de5f6f5,
// with the sentence of 4cc5d40). On the web, with the browser's storage full
// as a report is sent, the tab kept the new period in its own memory and the
// browser kept what it had: the period of the report BEFORE. Once the tab
// was closed the next report counted from that earlier report, repeated what
// the newer one had covered, and the page said "this counts from the last
// report sent from this computer, on Sep 7" (the last one was Sep 14), after
// promising "no 'since the last report' section until one is sent from here
// again".
// A period the browser cannot replace with a newer send is now removed from
// it, so the period can go to "none kept" and never back; and what the page
// says about where the next report counts from is true with the shared
// record installed, missing, or out of reach at the next open, and when the
// browser refuses the removal as well.
// A browser storage with a real quota (the pass-4 reviewer's), an in-memory
// report_snapshots table through the web's own wrapper. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

/** A browser profile's storage with a quota in characters (keys and values), as a browser counts it. */
function profileStorage(quota: number) {
  const values = new Map<string, string>();
  const used = () => [...values].reduce((total, [key, value]) => total + key.length + value.length, 0);
  const state = { removalRefused: false as boolean | 'silently', everythingRefused: false };
  return {
    values, used, state,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.everythingRefused) throw new Error('The storage failed.');
      const after = used() - (values.has(key) ? key.length + values.get(key)!.length : 0) + key.length + value.length;
      if (after > quota) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (state.removalRefused === 'silently') return;
      if (state.removalRefused || state.everythingRefused) throw new Error('The storage failed.');
      values.delete(key);
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}
type Profile = ReturnType<typeof profileStorage>;

/** The cloud's report_snapshots table: installed or not, in reach or not; it keeps the later send. */
let table = new Map<string, { snapshot: unknown; deliveredAt: string | null }>();
let tableState: 'present' | 'missing' | 'down' = 'present';
const load = async (scopeKey: string, format: string) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be read.');
  return { ownerId: 'owner-1', snapshot: table.get(`${scopeKey}|${format}`)?.snapshot ?? null };
};
const save = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be saved.');
  const existing = table.get(`${row.scopeKey}|${row.format}`);
  if (!(existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt))) {
    table.set(`${row.scopeKey}|${row.format}`, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
  }
  return 'saved' as const;
};

function task(index: number, percent: number): DAVEReportSnapshotTask {
  return {
    taskId: `3f2b6c1e-8a4d-4f7b-9c${String(index).padStart(2, '0')}-5d1e7a9b${String(index).padStart(4, '0')}`,
    projectName: 'Tower', taskName: `Level ${1 + (index % 4)} framing ${index}`, areaName: `Level ${1 + (index % 4)} East`, owner: 'Acme Framing',
    status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', percentComplete: percent,
    finishDate: `10/${String(1 + (index % 28)).padStart(2, '0')}/2026`, urgency: 'upcoming', approvalStatus: 'Not Required', estimatedScheduleImpactDays: null,
    contentKey: `task-content/1:${(index * 2654435761 >>> 0).toString(16).padStart(8, '0')}`, activityKey: 'task-activity/1:0a1b2c3d',
  } as DAVEReportSnapshotTask;
}
function report(changed: number, capturedAt: string, fingerprint: string): DAVEReportSnapshot {
  return {
    version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt, sourceFingerprint: fingerprint, reportFormat: 'project_manager',
    tasks: Array.from({ length: 40 }, (_, index) => task(index, index < changed ? 50 + changed : 0)),
  } as DAVEReportSnapshot;
}

const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as const };
const PERIOD_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1:tower:project_manager';
const OWN_SENDS_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1';
const SEP_7 = '2026-09-07T15:05:00.000Z';
const SEP_14 = '2026-09-14T15:05:00.000Z';
const NO_SINCE_UNTIL_SENT_AGAIN = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open. After that, the next report from this computer has no \"since the last report\" section until one is sent from here again. Clearing other sites' data in this browser makes room.";
const MAY_COUNT_FROM_EARLIER = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open. After that, the next report from this computer may count from an earlier report and repeat what the last one covered: this browser would not clear the earlier one.";
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };

let profile: Profile;
const tab = () => ({ storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) });
/** The tab is closed; a new tab of the same browser opens Reports. */
function newTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  return tab();
}
/** What the profile keeps for the period: the send it runs from, 'approval not sent', or 'nothing'. */
function keptInProfile(): string {
  const raw = daveWebStoredReportValue(profile.values.get(PERIOD_KEY));
  if (raw === null) return 'nothing';
  return reportPeriodSentAt(JSON.parse(raw) as DAVEReportSnapshot) ?? 'approval not sent';
}
/** Other sites' data (and Vitruvius's other periods) fill what is left of the profile. */
function fillTheProfile() {
  profile.values.set('other-site-data', 'x'.repeat(60_000 - profile.used() - 'other-site-data'.length - 10));
}
/** Report 1 is approved and sent with room in the browser; then the browser fills up. */
async function firstReportSentThenTheBrowserFills() {
  const store = tab();
  expect((await approveDAVEWebReportPeriod(store, report(5, '2026-09-07T15:00:00.000Z', 'fp-1'), null)).status).toBe('saved');
  expect((await recordDAVEWebReportSend(store, PERIOD, 'fp-1', SEP_7))?.status).toBe('saved');
  await settle();
  expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
  expect(keptInProfile()).toBe(SEP_7);
  fillTheProfile();
  return store;
}
/** Report 2 is approved and sent a week later: the browser has no room for it. */
async function secondReportSent(store: ReturnType<typeof tab>) {
  expect((await approveDAVEWebReportPeriod(store, report(12, '2026-09-14T15:00:00.000Z', 'fp-2'), SEP_7)).status).toBe('saved');
  expect((await recordDAVEWebReportSend(store, PERIOD, 'fp-2', SEP_14))?.status).toBe('saved');
  await settle();
  // This tab knows the second send.
  expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
  expect(reportPeriodSentAt((await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot)).toBe(SEP_14);
}
/** What the page says about the period in a tab, and the send it counts from. */
async function onThePage(store: ReturnType<typeof tab>) {
  const read = await readDAVEWebReportPeriod(store, 'tower', 'project_manager');
  if (read.status !== 'loaded') throw new Error('The period was not read.');
  return { countsFrom: reportPeriodSentAt(read.snapshot), shared: read.shared, note: daveWebReportPeriodNote(read) };
}

const root = globalThis as unknown as { localStorage?: unknown };
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
});
beforeEach(() => {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  table = new Map();
  tableState = 'present';
  profile = profileStorage(60_000);
  // The browser's own storage, as the page finds it.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
});

describe('review N4 L2: a newer report the browser cannot keep does not leave the report before standing as the latest', () => {
  it('reports not shared between his devices: after the tab is closed the period is "none kept", never the report before', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    await secondReportSent(store);
    // The browser no longer holds the report before as if it were the last.
    expect(keptInProfile()).toBe('nothing');
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(false);
    // What the page says in this tab, and it is so:
    expect(daveWebReportKeptInTabOnlyNote('unavailable', daveWebReportOlderPeriodLeftInBrowser())).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    const later = await onThePage(newTab());
    expect(later.countsFrom).toBeNull();
    expect(later.note).toBe("Reports aren't shared between your devices yet, and this computer has no record of one sent from here, so this report has no \"since the last report\" section.");
    expect(later.note).not.toMatch(/Sep 7/);
  });

  it('shared record in reach: the send reaches it and is read back; the browser keeps no earlier period beside it', async () => {
    const store = await firstReportSentThenTheBrowserFills();
    await secondReportSent(store);
    expect(table.get('tower|project_manager')?.deliveredAt).toBe(SEP_14);
    expect(keptInProfile()).toBe('nothing');
    expect(daveWebReportKeptInTabOnlyNote('checked', daveWebReportOlderPeriodLeftInBrowser())).toMatch(/Reports recorded as sent still reach your other devices, and this computer reads them back from there\.$/);
    const later = await onThePage(newTab());
    expect(later).toMatchObject({ countsFrom: SEP_14, shared: 'checked', note: '' });
  });

  it('shared record out of reach at the next open: no "since" section and a true line, not the report before', async () => {
    const store = await firstReportSentThenTheBrowserFills();
    await secondReportSent(store);
    tableState = 'down';
    const later = await onThePage(newTab());
    expect(later.countsFrom).toBeNull();
    expect(later.shared).toBe('unchecked');
    expect(later.note).toBe("Couldn't check your last report, so this report has no \"since the last report\" section. It is checked again on the next refresh.");
    // Once it is in reach again the period is the report he sent last.
    tableState = 'present';
    expect(await onThePage(tab())).toMatchObject({ countsFrom: SEP_14, shared: 'checked' });
  });

  it('shared record out of reach as it is sent: the tab says the send has yet to reach his other devices', async () => {
    const store = await firstReportSentThenTheBrowserFills();
    tableState = 'down';
    await secondReportSent(store);
    expect(keptInProfile()).toBe('nothing');
    expect(daveWebReportKeptInTabOnlyNote('unchecked', daveWebReportOlderPeriodLeftInBrowser())).toBe(
      "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open. The shared record can't be reached right now, so a report sent now reaches your other devices only once it can be reached again: keep this tab open until then.",
    );
    // And so it does, from this tab, when the record is in reach again.
    tableState = 'present';
    await loadDAVEWebReportPeriod(store, 'tower', 'project_manager');
    await settle();
    expect(table.get('tower|project_manager')?.deliveredAt).toBe(SEP_14);
  });
});

describe('review N4 L2: only a period that runs from an earlier send is removed', () => {
  it('an approval the browser cannot keep, not sent: the last report sent stays kept, and is what the next tab counts from', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    expect((await approveDAVEWebReportPeriod(store, report(12, '2026-09-14T15:00:00.000Z', 'fp-2'), SEP_7)).status).toBe('saved');
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(keptInProfile()).toBe(SEP_7);
    const later = await onThePage(newTab());
    expect(later.countsFrom).toBe(SEP_7);
    expect(later.note).toMatch(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, .*\.$/);
  });

  it('a first report approved with room and sent without: the approval stays, to be marked sent again', async () => {
    tableState = 'missing';
    const store = tab();
    expect((await approveDAVEWebReportPeriod(store, report(5, '2026-09-07T15:00:00.000Z', 'fp-1'), null)).status).toBe('saved');
    expect(keptInProfile()).toBe('approval not sent');
    fillTheProfile();
    expect((await recordDAVEWebReportSend(store, PERIOD, 'fp-1', SEP_7))?.status).toBe('saved');
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(keptInProfile()).toBe('approval not sent');
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(false);
  });

  it('the account\'s list of its own sends is no period: the earlier list stays', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    await secondReportSent(store);
    expect(JSON.parse(profile.values.get(OWN_SENDS_KEY) ?? '[]')).toEqual([SEP_7]);
  });
});

describe('review N4 L2: the browser refuses the removal as well', () => {
  it('the tab says the next report may count from an earlier one, and clears it as soon as the browser lets it', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    profile.state.removalRefused = true;
    await secondReportSent(store);
    expect(keptInProfile()).toBe(SEP_7);
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(true);
    // Not "no 'since the last report' section": that would not be so.
    expect(daveWebReportKeptInTabOnlyNote('unavailable', daveWebReportOlderPeriodLeftInBrowser())).toBe(MAY_COUNT_FROM_EARLIER);
    // This tab still counts from the report he sent last.
    expect((await onThePage(store)).countsFrom).toBe(SEP_14);
    // The browser lets go: the earlier period is removed the next time this tab uses its storage.
    profile.state.removalRefused = false;
    expect((await onThePage(store)).countsFrom).toBe(SEP_14);
    expect(keptInProfile()).toBe('nothing');
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(false);
    expect(daveWebReportKeptInTabOnlyNote('unavailable', daveWebReportOlderPeriodLeftInBrowser())).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    expect((await onThePage(newTab())).countsFrom).toBeNull();
  });

  it('a browser that removes nothing and says nothing is taken the same way', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    profile.state.removalRefused = 'silently';
    await secondReportSent(store);
    expect(keptInProfile()).toBe(SEP_7);
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(true);
  });

  it('if the earlier period is still there at the next open, the page does not call it the last report sent from this computer', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    profile.state.removalRefused = true;
    await secondReportSent(store);
    const opened = newTab();
    // A new tab holds nothing of its own, so it has nothing to say about a period it could not clear.
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(false);
    const later = await onThePage(opened);
    // It cannot know better than its own record, and says no more than that.
    expect(later.countsFrom).toBe(SEP_7);
    expect(later.note).toMatch(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /);
    expect(later.note).not.toMatch(/the last report sent from this computer/);
  });

  it('a later period another tab has stored since is not removed by the retry', async () => {
    tableState = 'missing';
    const store = await firstReportSentThenTheBrowserFills();
    profile.state.removalRefused = true;
    await secondReportSent(store);
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(true);
    // The browser has room again, and another tab of it sends a third report.
    profile.state.removalRefused = false;
    profile.values.delete('other-site-data');
    let otherTab: typeof import('../../services/DAVEWebReportSend') | undefined;
    jest.isolateModules(() => { otherTab = require('../../services/DAVEWebReportSend'); });
    const other = otherTab as typeof import('../../services/DAVEWebReportSend');
    const theirs = { storage: other.daveWebReportStorage(async () => 'owner-1'), cloud: other.daveWebReportSnapshotCloud(load, save) };
    // (The other tab reads the browser's own-send list and the period as the browser has them.)
    profile.values.delete(PERIOD_KEY);
    expect((await other.approveDAVEWebReportPeriod(theirs, report(20, '2026-09-21T15:00:00.000Z', 'fp-3'), null)).status).toBe('saved');
    expect((await other.recordDAVEWebReportSend(theirs, PERIOD, 'fp-3', '2026-09-21T15:05:00.000Z'))?.status).toBe('saved');
    expect(keptInProfile()).toBe('2026-09-21T15:05:00.000Z');
    // This tab uses its storage again: the third report's period stays.
    await onThePage(store);
    expect(keptInProfile()).toBe('2026-09-21T15:05:00.000Z');
    expect(daveWebReportOlderPeriodLeftInBrowser()).toBe(false);
  });
});
