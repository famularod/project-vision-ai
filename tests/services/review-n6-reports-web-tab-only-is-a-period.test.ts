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

// Review N6 of reports (7 Oct 2026), finding 3 (Low, wording, older; C's
// neighbour; the sentence is 4cc5d40's). On the web with no shared record: a
// report is sent while the browser's storage is full; room comes back; he
// approves the next report, so the browser holds the period again. The page
// still said "This browser's storage for Vitruvius is full or switched off,
// so this computer remembers its last report only while this tab stays open.
// After that, the next report from this computer has no 'since the last
// report' section until one is sent from here again." Neither half was so:
// the next tab counts from the last report sent. All the tab still held was
// its list of this browser's own sends, and any of the account's keys held
// in the tab counted as a period.
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
const SEP_21 = '2026-09-21T15:00:00.000Z';
/** Report 1 goes out with room in the browser; report 2 goes out with the browser full. */
async function secondReportSentWithTheBrowserFull() {
  const store = tab();
  await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
  await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
  await settle();
  full = true;
  await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7);
  await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-2', SEP_14);
  await settle();
  return store;
}

describe('review N6 3: the storage sentence is said only while the tab holds a period the browser does not', () => {
  it('sent while full, room again, the next report approved: the browser has the period, and nothing is said', async () => {
    const store = await secondReportSentWithTheBrowserFull();
    // While it is full the tab holds the report sent, and says so.
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
    // Room again; he approves the next report (not sent yet): the browser takes the period.
    full = false;
    expect((await approveDAVEWebReportPeriod(store, report('fp-3', SEP_21), SEP_14)).status).toBe('saved');
    await settle();
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
    expect(said('unavailable')).toBeNull();
    // And so it is: the next tab counts from the last report sent, with its approval waiting.
    const next = await inTheNextTab();
    expect(next.countsFrom).toBe(SEP_14);
    expect(next.approvalWaiting).toBe(true);
  });

  it('what this browser has seen of the shared record, held in the tab, is no period either', async () => {
    tableState = 'present';
    const phones = { ...report('phone', '2026-09-07T15:00:00.000Z'), deliveredAt: SEP_7, sentBy: 'phone-install' } as DAVEReportSnapshot;
    table.set('tower|project_manager', { snapshot: phones, deliveredAt: SEP_7 });
    // The browser is full; the page only reads the period (nothing approved, nothing sent).
    full = true;
    const read = await readDAVEWebReportPeriod(tab(), 'tower', 'project_manager');
    await settle();
    expect(read.status === 'loaded' && reportPeriodSentAt(read.snapshot)).toBe(SEP_7);
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
    expect(said('checked')).toBeNull();
  });

  it('the list of own sends held in the tab beside an approval does not hide that only an approval is held', async () => {
    const store = tab();
    await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await settle();
    // The browser fills; it refuses the account's list of own sends, and then the next approval.
    full = true;
    await store.storage.setItem('@vitruvius/report-snapshots/own-sends/v1', JSON.stringify([SEP_7, SEP_14]));
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
    expect((await approveDAVEWebReportPeriod(store, report('fp-2', '2026-09-14T15:00:00.000Z'), SEP_7)).status).toBe('saved');
    await settle();
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(daveWebReportOnlyApprovalKeptInTab()).toBe(true);
    expect(said('unavailable')).toBe(APPROVAL_GOES);
  });

  it('guard: an approval or a report sent that the browser refused is a period, and the sentence is said', async () => {
    full = true;
    const store = tab();
    await approveDAVEWebReportPeriod(store, report('fp-1', '2026-09-07T15:00:00.000Z'), null);
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'fp-1', SEP_7);
    await settle();
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    expect(said('unavailable')).toBe(NO_SINCE_UNTIL_SENT_AGAIN);
  });
});
