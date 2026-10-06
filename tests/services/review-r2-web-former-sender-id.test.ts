/**
 * @jest-environment node
 */
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebOwnReportSends,
  daveWebReportSentHereAt,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// R2 item 2 (9 Oct 2026; pass 6 saw it, "two tabs"). A tab made the browser's
// sender id while the browser's storage refused writes, and sent a report to
// the shared record under it. Another tab gave the browser an id first. The
// first tab then moved to the browser's id (N5 D), but its one earlier report
// stayed under the old id, and later tabs took that report for another
// device's. The old id is now kept as the browser's former id, and the tab's
// list of own sends is written, so that report is this browser's own.
// A browser storage that can refuse, an in-memory report_snapshots table
// through the web's own wrapper. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

let values = new Map<string, string>();
let stuck = false;
const profile = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { if (stuck) throw new Error('The storage failed.'); values.set(key, value); },
  removeItem: (key: string) => { if (stuck) throw new Error('The storage failed.'); values.delete(key); },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
let table = new Map<string, { snapshot: unknown; deliveredAt: string | null }>();
const load = async (scopeKey: string, format: string) => ({ ownerId: 'owner-1', snapshot: table.get(`${scopeKey}|${format}`)?.snapshot ?? null });
const save = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
  table.set(`${row.scopeKey}|${row.format}`, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
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
  table = new Map();
  stuck = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
});

const SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';
const FORMER_ID_KEY = '@vitruvius/report-sender-id/former/v1';
const SENT_AT = '2026-09-07T15:05:00.000Z';
const report = (fingerprint: string) =>
  ({ version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt: '2026-09-07T15:00:00.000Z', sourceFingerprint: fingerprint, reportFormat: 'project_manager', tasks: [] }) as unknown as DAVEReportSnapshot;
const tab = () => ({ storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) });
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
/** The first tab: the browser refuses writes, the tab makes its own id and sends a report, which reaches the shared record. */
async function firstTabSendsWhileTheBrowserRefuses() {
  stuck = true;
  const store = tab();
  expect((await approveDAVEWebReportPeriod(store, report('facts'), null)).status).toBe('saved');
  const sent = await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: 'project_manager' }, 'facts', SENT_AT);
  await settle();
  const tabsId = sent?.status === 'saved' ? sent.snapshot?.sentBy : null;
  expect(tabsId).toEqual(expect.any(String));
  expect(table.get('tower|project_manager')?.deliveredAt).toBe(SENT_AT);
  return { store, tabsId: tabsId as string };
}
/** The tab is closed; a later tab of the same browser reads the period (from the shared record). */
async function inALaterTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  return (await loadDAVEWebReportPeriod(tab(), 'tower', 'project_manager')).snapshot;
}

describe('R2 item 2: the one report a tab sent under its own id stays this browser\'s after the tab takes the browser\'s id', () => {
  it('another tab gave the browser an id first: the earlier report is still this computer\'s own in a later tab', async () => {
    const { store, tabsId } = await firstTabSendsWhileTheBrowserRefuses();
    // The storage works again, and another tab has given the browser an id meanwhile.
    stuck = false;
    values.set(SENDER_ID_KEY, 'the-other-tabs-id');
    // The first tab uses the storage again: it takes the browser's id, and its old one is kept as the former id.
    await loadDAVEWebReportPeriod(store, 'tower', 'project_manager');
    expect(values.get(SENDER_ID_KEY)).toBe('the-other-tabs-id');
    expect(values.get(FORMER_ID_KEY)).toBe(tabsId);

    const period = await inALaterTab();
    expect(period?.deliveredAt).toBe(SENT_AT);
    expect(period?.sentBy).toBe(tabsId);
    // Known as its own: no wait for "your other device's changes", and sharing it again is "already recorded".
    expect(daveWebOwnReportSends().has(SENT_AT)).toBe(true);
    expect(daveWebReportSentHereAt(period, 'facts')).toBe(SENT_AT);
  });

  it('guard: a report under an id that was never this browser\'s is another device\'s', async () => {
    const phones = { ...report('phone-facts'), deliveredAt: SENT_AT, sentBy: 'phone-install' } as DAVEReportSnapshot;
    table.set('tower|project_manager', { snapshot: phones, deliveredAt: SENT_AT });
    values.set(SENDER_ID_KEY, 'this-browsers-id');
    values.set(FORMER_ID_KEY, 'an-id-this-browser-once-had');
    const period = await inALaterTab();
    expect(period?.deliveredAt).toBe(SENT_AT);
    expect(daveWebOwnReportSends().has(SENT_AT)).toBe(false);
  });

  it('guard: a report under the former id that is not on this browser\'s list of own sends is not taken as its own', async () => {
    const other = { ...report('other-facts'), deliveredAt: SENT_AT, sentBy: 'an-id-this-browser-once-had' } as DAVEReportSnapshot;
    table.set('tower|project_manager', { snapshot: other, deliveredAt: SENT_AT });
    values.set(SENDER_ID_KEY, 'this-browsers-id');
    values.set(FORMER_ID_KEY, 'an-id-this-browser-once-had');
    await inALaterTab();
    expect(daveWebOwnReportSends().has(SENT_AT)).toBe(false);
  });

  it('guard: no second tab, the storage simply works again: one id, no former id (as N5 D left it)', async () => {
    const { store, tabsId } = await firstTabSendsWhileTheBrowserRefuses();
    stuck = false;
    await loadDAVEWebReportPeriod(store, 'tower', 'project_manager');
    expect(values.get(SENDER_ID_KEY)).toBe(tabsId);
    expect(values.has(FORMER_ID_KEY)).toBe(false);
    const period = await inALaterTab();
    expect(daveWebOwnReportSends().has(SENT_AT)).toBe(true);
    expect(period?.sentBy).toBe(tabsId);
  });
});
