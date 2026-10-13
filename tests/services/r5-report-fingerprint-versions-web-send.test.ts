/**
 * @jest-environment node
 */
import { rememberLegacyReportSource, sameReportSource, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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

// R5 item 2. R4 (item 4a) made the report's fingerprint follow neither the order the tasks are saved in nor the id
// each device files the project under, and kept every report made under the earlier version known for the same
// facts. Three of the places where the web's own record of a send compares a stored fingerprint with today's had
// no test of their own (R4's notes): this browser's list of the reports it sent, and the two checks made as a
// send is recorded. Each is pinned here with a report made by the build before meeting the same facts today.
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

/** The facts on the page today, and the fingerprint the build before gave the same facts. */
const TODAY = 'dave-report-source/2.0:0a1b2c3d';
const BUILD_BEFORE = 'dave-report-source/1.0:4e5f6a7b';
/** Other facts, under each version. */
const OTHER_TODAY = 'dave-report-source/2.0:99999999';
const OTHER_BEFORE = 'dave-report-source/1.0:88888888';

beforeEach(() => {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  values = new Map();
  shared = 'missing';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  // As the page does whenever it works out today's fingerprint: the earlier version's is worked out beside it.
  rememberLegacyReportSource(TODAY, BUILD_BEFORE);
  rememberLegacyReportSource(OTHER_TODAY, OTHER_BEFORE);
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

describe('R5 item 2: this browser\'s list of the reports it sent, and a report sent before the update', () => {
  it('a report sent under the earlier version, from before the three a period remembers, is still known as sent from here by today\'s fingerprint of its facts', async () => {
    const store = tab();
    // The first was sent by the build before: its place in the list is under the fingerprint that build gave it.
    await send(store, 1, BUILD_BEFORE);
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:0000000${n}`);
    const period = await inTheNextTab();
    // The period remembers the last three; the first is known by the list alone.
    expect([period?.deliveredAt, period?.supersedes?.deliveredAt, period?.supersedes?.supersedes?.deliveredAt]).toEqual([at(5), at(4), at(3)]);
    expect(daveWebReportSentHereAt(period, TODAY)).toBe(at(1));
    expect(daveWebReportSentHereAt(period, BUILD_BEFORE)).toBe(at(1));
  });

  it('guard: never for other facts, under either version', async () => {
    const store = tab();
    await send(store, 1, BUILD_BEFORE);
    for (let n = 2; n <= 5; n += 1) await send(store, n, `dave-report-source/2.0:0000000${n}`);
    const period = await inTheNextTab();
    expect(daveWebReportSentHereAt(period, OTHER_TODAY)).toBeNull();
    expect(daveWebReportSentHereAt(period, OTHER_BEFORE)).toBeNull();
  });
});

describe('R5 item 2: recording a send of an approval made before the update', () => {
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

  it('guard: an approval of other facts waiting in the shared record is not this report\'s, under either version', async () => {
    shared = report(1, OTHER_BEFORE, { deliveredAt: null });
    expect(await recordDAVEWebReportSend(tab(), PERIOD, TODAY, at(3))).toBeNull();
    expect(shared).toMatchObject({ sourceFingerprint: OTHER_BEFORE, deliveredAt: null });
    expect(sameReportSource(OTHER_BEFORE, TODAY)).toBe(false);
  });
});
