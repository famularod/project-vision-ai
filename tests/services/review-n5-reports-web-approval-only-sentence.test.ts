/**
 * @jest-environment node
 */
import { reportPeriodSentAt, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { daveWebReportKeptInTabOnlyNote, daveWebReportPeriodNote, readDAVEWebReportPeriod } from '../../services/DAVEWebReportPeriod';
import {
  approveDAVEWebReportPeriod,
  daveWebReportOlderPeriodLeftInBrowser,
  daveWebReportOnlyApprovalKeptInTab,
  daveWebReportPeriodKeptInTabOnly,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportTabMemory,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// Review N5 of reports (6 Oct 2026), finding C (Low, wording; the sentence
// is 4cc5d40's, and 7addf20 made it true after a send). On the web, with the
// browser's storage full, no shared record, and the last report SENT kept in
// the browser, he approves the next report and has not sent it yet. The page
// said "this computer remembers its last report only while this tab stays
// open. After that, the next report from this computer has no 'since the
// last report' section until one is sent from here again." Not so: only the
// approval is in the tab. Close it and the next tab counts from the last
// report sent, as it should.
// A browser storage that can fill up, an in-memory report_snapshots table
// through the web's own wrapper. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

let values = new Map<string, string>();
/** true: every write is refused. 'for a period': there is room for a short value (the list of own sends), not for a period. */
let full: boolean | 'for a period' = false;
const profile = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (full === true || (full === 'for a period' && value.length > 120)) throw new Error('QuotaExceededError');
    values.set(key, value);
  },
  removeItem: (key: string) => { values.delete(key); },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
let table = new Map<string, { snapshot: unknown; deliveredAt: string | null }>();
let tableState: 'present' | 'missing' = 'missing';
const load = async (scopeKey: string, format: string) => (tableState === 'missing'
  ? 'unavailable' as const
  : { ownerId: 'owner-1', snapshot: table.get(`${scopeKey}|${format}`)?.snapshot ?? null });
const save = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
  if (tableState === 'missing') return 'unavailable' as const;
  const existing = table.get(`${row.scopeKey}|${row.format}`);
  if (!(existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt))) {
    table.set(`${row.scopeKey}|${row.format}`, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
  }
  return 'saved' as const;
};

const root = globalThis as unknown as { localStorage?: unknown };
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
});
beforeEach(() => {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  values = new Map();
  full = false;
  table = new Map();
  tableState = 'missing';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
});

type Format = 'project_manager' | 'executive';
const report = (fingerprint: string, capturedAt: string, reportFormat: Format = 'project_manager') =>
  ({ version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt, sourceFingerprint: fingerprint, reportFormat, tasks: [] }) as unknown as DAVEReportSnapshot;
const tab = () => ({ storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) });
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
const SEP_7 = '2026-09-07T15:05:00.000Z';
const SEP_14 = '2026-09-14T15:05:00.000Z';
const TAB_ONLY_APPROVAL = "This browser's storage for Vitruvius is full or switched off, so this computer remembers this approval only while this tab stays open.";
const TAB_ONLY_REPORT = "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open.";
const APPROVAL_GOES = `${TAB_ONLY_APPROVAL} After that, the approval is gone: the report has to be approved again, and it still counts from the last report this computer knows it sent. Clearing other sites' data in this browser makes room.`;
const NO_SINCE_UNTIL_SENT_AGAIN = `${TAB_ONLY_REPORT} After that, the next report from this computer has no "since the last report" section until one is sent from here again. Clearing other sites' data in this browser makes room.`;
/** What the page says under "Since the last report" about the browser's storage, as the page asks for it. */
const said = (shared: 'unavailable' | 'checked' | 'unchecked') =>
  (daveWebReportPeriodKeptInTabOnly() ? daveWebReportKeptInTabOnlyNote(shared, daveWebReportOlderPeriodLeftInBrowser()) : null);
/** The tab is closed; what a new tab of the same browser counts from, and says. */
async function inTheNextTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  const read = await readDAVEWebReportPeriod(tab(), 'tower', 'project_manager');
  if (read.status !== 'loaded') throw new Error('The period was not read.');
  return { countsFrom: reportPeriodSentAt(read.snapshot), approvalWaiting: read.snapshot?.deliveredAt === null, note: daveWebReportPeriodNote(read) };
}
/** Report 1 is approved and sent with room in the browser; the browser then fills up; report 2 is approved, not sent. */
async function lastReportKeptThenTheNextApprovedWithTheBrowserFull() {
  const store = tab();
  await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
  await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
  await settle();
  expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
  full = true;
  expect((await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7)).status).toBe('saved');
  await settle();
  expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
  return store;
}

describe('review N5 C: the tab says what is true while only an approval is held in it', () => {
  it('no shared record: the approval goes with the tab, and the next report still counts from the last one sent', async () => {
    await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(true);
    expect(said('unavailable')).toBe(APPROVAL_GOES);
    expect(said('unavailable')).not.toMatch(/has no "since the last report" section/);
    // And so it is in the next tab.
    const next = await inTheNextTab();
    expect(next.countsFrom).toBe(SEP_7);
    expect(next.approvalWaiting).toBe(false);
    expect(next.note).toMatch(/^Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, /);
  });

  it('with the shared record in reach, or out of reach: the same first words, and what is so for a report sent now', async () => {
    tableState = 'present';
    await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(true);
    expect(said('checked')).toBe(`${TAB_ONLY_APPROVAL} Reports recorded as sent still reach your other devices, and this computer reads them back from there.`);
    expect(said('unchecked')).toBe(`${TAB_ONLY_APPROVAL} The shared record can't be reached right now, so a report sent now reaches your other devices only once it can be reached again: keep this tab open until then.`);
  });

  it('once he sends it from this tab, the tab holds a report sent: the earlier promise, which is then true', async () => {
    const store = await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-2', SEP_14);
    await settle();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    const next = await inTheNextTab();
    expect(next.countsFrom).toBeNull();
  });
});

describe('review N5 C: found in the reviewer\'s random runs of the browser\'s storage', () => {
  it('a new tab opened with the browser already full, then an approval: the same true sentence', async () => {
    const first = tab();
    await approveDAVEWebReportPeriod(first, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(first, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await settle();
    // The browser fills; he closes the tab, opens a new one and approves the next report there.
    full = true;
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    const store = tab();
    await readDAVEWebReportPeriod(store, 'tower', 'project_manager');
    expect((await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7)).status).toBe('saved');
    await settle();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(true);
    expect(said('unavailable')).toBe(APPROVAL_GOES);
    expect((await inTheNextTab()).countsFrom).toBe(SEP_7);
  });

  it('what the browser holds is read from the storage that refused the approval, not from another one this page once used', async () => {
    // An earlier storage object (as a test, or a browser profile swapped under the page, would leave behind), with
    // an older period of the same account under the same key.
    const earlier = new Map<string, string>();
    const earlierStorage = {
      getItem: (key: string) => earlier.get(key) ?? null,
      setItem: (key: string, value: string) => { earlier.set(key, value); },
      removeItem: (key: string) => { earlier.delete(key); },
    };
    const before = { storage: daveWebReportStorage(async () => 'owner-1', earlierStorage), cloud: daveWebReportSnapshotCloud(load, save) };
    await approveDAVEWebReportPeriod(before, report('fp-0', '2026-08-31T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(before, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-0', '2026-08-31T15:05:00.000Z');
    await settle();
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    // The browser's storage as the page finds it now: a new object, registered after that one.
    const now = new Map<string, string>();
    const nowStorage = {
      getItem: (key: string) => now.get(key) ?? null,
      setItem: (key: string, value: string) => { if (full) throw new Error('QuotaExceededError'); now.set(key, value); },
      removeItem: (key: string) => { now.delete(key); },
    };
    const store = { storage: daveWebReportStorage(async () => 'owner-1', nowStorage), cloud: daveWebReportSnapshotCloud(load, save) };
    await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await settle();
    full = true;
    expect((await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7)).status).toBe('saved');
    await settle();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(true);
  });
});

describe('review N5 C: an approval over a report that only the tab holds', () => {
  it('report 2 was sent from this tab with no room for its period, and report 3 is approved: the last report goes with the tab, and the page says so', async () => {
    const store = await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    // Room for the short list of this browser's own sends, none for a period.
    full = 'for a period';
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-2', SEP_14);
    await settle();
    expect(JSON.parse(values.get('@vitruvius/web/owner-1/@vitruvius/report-snapshots/own-sends/v1') ?? '[]')).toEqual([SEP_7, SEP_14]);
    expect((await approveDAVEWebReportPeriod(store, report('fp-3', '2026-09-21T15:00:00.000Z'), SEP_14)).status).toBe('saved');
    await settle();
    // All the tab holds is an approval, but the report it counts from is in the tab only too.
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    expect((await inTheNextTab()).countsFrom).toBeNull();
  });
});

describe('review N5 C: the other states keep their words', () => {
  it('a first report approved with the browser full, none sent before: "no since section", which is so', async () => {
    full = true;
    await approveDAVEWebReportPeriod(tab(), report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    expect((await inTheNextTab()).countsFrom).toBeNull();
  });

  it('the browser full from the start, the last report sent known from the shared record only: the report words, as before', async () => {
    tableState = 'present';
    const phones = { ...report('phone', '2026-09-07T15:00:00.000Z'), deliveredAt: SEP_7, sentBy: 'phone-install' } as DAVEReportSnapshot;
    table.set('tower|project_manager', { snapshot: phones, deliveredAt: SEP_7 });
    full = true;
    await approveDAVEWebReportPeriod(tab(), report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7);
    await settle();
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('checked')).toBe(`${TAB_ONLY_REPORT} Reports recorded as sent still reach your other devices, and this computer reads them back from there.`);
  });

  it('a report SENT that the tab holds over the same send in the browser is not called an approval', async () => {
    const store = tab();
    await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await settle();
    // The browser refuses a later write of that same sent report (here with a note added to it).
    const key = '@vitruvius/report-snapshots/v1:tower:project_manager';
    const sent = JSON.parse(await store.storage.getItem(key) as string) as Record<string, unknown>;
    full = true;
    await store.storage.setItem(key, JSON.stringify({ ...sent, markedSentAt: '2026-09-07T16:00:00.000Z' }));
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
  });

  it('an approval held for one format and a report SENT held for the other: the report words', async () => {
    const store = await lastReportKeptThenTheNextApprovedWithTheBrowserFull();
    await approveDAVEWebReportPeriod(store, report('fp-e', '2026-09-14T15:00:00.000Z', 'executive'), null);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'executive' }, 'fp-e', SEP_14);
    await settle();
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
  });

  it('with room in the browser nothing is held in the tab, and nothing is said', async () => {
    const store = tab();
    await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7);
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(false);
    expect(said('unavailable')).toBeNull();
  });
});
