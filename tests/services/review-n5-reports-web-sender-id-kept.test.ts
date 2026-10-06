/**
 * @jest-environment node
 */
import { type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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

// Review N5 of reports (6 Oct 2026), finding D (Low, rare, older: 46e3332).
// The browser's storage refused writes when this browser first made its
// sender id, so the id lived in that tab only. A report sent later from that
// tab, once the storage worked, was stored carrying that id. The next tab
// found no id in the browser, made a second one, and read this computer's
// own last report as another device's: with no shared record at all the page
// said "Not counted yet: this device hasn't received your other device's
// latest changes." until its download finished, and sharing that report
// again was not "already recorded".
// The id the tab's sends carry is now stored as soon as the storage takes
// it: never a second one.
// A browser storage that can refuse, an in-memory report_snapshots table
// (not installed here) through the web's own wrapper. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

let values = new Map<string, string>();
/** 'stuck': writes and removals refused; 'silent': writes taken in silence and not kept. */
let storage: 'ok' | 'stuck' | 'silent' = 'ok';
const profile = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (storage === 'stuck') throw new Error('The storage failed.');
    if (storage === 'ok') values.set(key, value);
  },
  removeItem: (key: string) => {
    if (storage === 'stuck') throw new Error('The storage failed.');
    if (storage === 'ok') values.delete(key);
  },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};
const load = async () => 'unavailable' as const;
const save = async () => 'unavailable' as const;

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
  storage = 'ok';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
});

const SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';
const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as const };
const report = (fingerprint: string, capturedAt: string) =>
  ({ version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt, sourceFingerprint: fingerprint, reportFormat: 'project_manager', tasks: [] }) as unknown as DAVEReportSnapshot;
const tab = () => ({ storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) });
type Tab = ReturnType<typeof tab>;
const SEP_7 = '2026-09-07T15:05:00.000Z';
const SEP_14 = '2026-09-14T15:05:00.000Z';
/** He approves a report and sends it; the id the send carries. */
async function approveAndSend(store: Tab, fingerprint: string, basis: string | null, sentAt: string): Promise<string | null | undefined> {
  expect((await approveDAVEWebReportPeriod(store, report(fingerprint, sentAt), basis)).status).toBe('saved');
  const sent = await recordDAVEWebReportSend(store, PERIOD, fingerprint, sentAt);
  expect(sent?.status).toBe('saved');
  return sent?.status === 'saved' ? sent.snapshot?.sentBy : null;
}
/** The tab is closed; a new tab of the same browser reads the period. */
async function inTheNextTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  return (await loadDAVEWebReportPeriod(tab(), 'tower', 'project_manager')).snapshot;
}

describe('review N5 D: a report this browser sent is this browser\'s in the next tab', () => {
  it('the id was made while the storage refused; a report sent once it works is known as this computer\'s own', async () => {
    storage = 'stuck';
    const store = tab();
    const firstId = await approveAndSend(store, 'fp-1', null, SEP_7);
    expect(firstId).toEqual(expect.any(String));
    expect(values.has(SENDER_ID_KEY)).toBe(false);
    // The storage works again; the next report goes out from the same tab.
    storage = 'ok';
    const secondId = await approveAndSend(store, 'fp-2', SEP_7, SEP_14);
    // One id for this browser: the one its sends carry is the one the browser now keeps.
    expect(secondId).toBe(firstId);
    expect(values.get(SENDER_ID_KEY)).toBe(firstId);

    const period = await inTheNextTab();
    expect(period?.deliveredAt).toBe(SEP_14);
    expect(period?.sentBy).toBe(values.get(SENDER_ID_KEY));
    // Known as its own: no wait for "your other device's changes", and sharing it again is "already recorded".
    expect(daveWebOwnReportSends().has(SEP_14)).toBe(true);
    expect(daveWebReportSentHereAt(period, 'fp-2')).toBe(SEP_14);
    // And no second id was made by the new tab.
    expect(values.get(SENDER_ID_KEY)).toBe(firstId);
  });

  it('it is stored on the tab\'s next use of the storage, before any further send', async () => {
    storage = 'stuck';
    const store = tab();
    const firstId = await approveAndSend(store, 'fp-1', null, SEP_7);
    storage = 'ok';
    await loadDAVEWebReportPeriod(store, 'tower', 'project_manager');
    expect(values.get(SENDER_ID_KEY)).toBe(firstId);
  });

  it('another tab gave the browser an id meanwhile: that one is the browser\'s, and this tab sends under it from then on', async () => {
    storage = 'stuck';
    const store = tab();
    const firstId = await approveAndSend(store, 'fp-1', null, SEP_7);
    storage = 'ok';
    values.set(SENDER_ID_KEY, 'the-other-tabs-id');
    const secondId = await approveAndSend(store, 'fp-2', SEP_7, SEP_14);
    expect(secondId).toBe('the-other-tabs-id');
    expect(secondId).not.toBe(firstId);
    expect(values.get(SENDER_ID_KEY)).toBe('the-other-tabs-id');
    const period = await inTheNextTab();
    expect(daveWebOwnReportSends().has(SEP_14)).toBe(true);
    expect(daveWebReportSentHereAt(period, 'fp-2')).toBe(SEP_14);
  });

  it('while the storage keeps refusing the tab goes on with its one id', async () => {
    storage = 'stuck';
    const store = tab();
    const firstId = await approveAndSend(store, 'fp-1', null, SEP_7);
    const secondId = await approveAndSend(store, 'fp-2', SEP_7, SEP_14);
    expect(firstId).toEqual(expect.any(String));
    expect(secondId).toBe(firstId);
    expect(values.has(SENDER_ID_KEY)).toBe(false);
  });

  it('a storage that takes the id in silence and keeps nothing has not taken it: the tab keeps its own', async () => {
    storage = 'stuck';
    const store = tab();
    await store.storage.setItem(SENDER_ID_KEY, 'made-in-this-tab');
    storage = 'silent';
    expect(await store.storage.getItem(SENDER_ID_KEY)).toBe('made-in-this-tab');
    expect(await store.storage.getItem(SENDER_ID_KEY)).toBe('made-in-this-tab');
    expect(values.has(SENDER_ID_KEY)).toBe(false);
  });

  it('with the storage working from the start nothing changes: the id is made once and kept', async () => {
    const store = tab();
    const firstId = await approveAndSend(store, 'fp-1', null, SEP_7);
    expect(values.get(SENDER_ID_KEY)).toBe(firstId);
    const period = await inTheNextTab();
    expect(period?.sentBy).toBe(firstId);
    expect(daveWebOwnReportSends().has(SEP_7)).toBe(true);
    expect(values.get(SENDER_ID_KEY)).toBe(firstId);
  });
});
