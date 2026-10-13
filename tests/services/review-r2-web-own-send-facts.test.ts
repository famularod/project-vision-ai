/**
 * @jest-environment node
 */
import { reportPeriodSentAt, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebOwnSendFactsKept,
  daveWebReportSentHereAt,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// R2 item 1 (9 Oct 2026, the owner's answer to R1 item 3). On the web a
// report from before the three sent reports a period remembers could not be
// known as sent from here. This browser now keeps, for each account, a list
// of the last 50 reports it sent: when, for which projects and format, and
// the fingerprint of their facts. It is bounded, each account's own, removed
// with the report periods at sign-out, and when the browser's storage will
// not take it the three are what is known. A browser storage that can
// refuse; reports not shared between devices here. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

let values = new Map<string, string>();
/** The browser refuses any value written under a key that contains this text. */
let refuses: string | null = null;
const profile = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { if (refuses && key.includes(refuses)) throw new Error('QuotaExceededError'); values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
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
let signedIn = 'owner-1';
beforeEach(() => {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  values = new Map();
  refuses = null;
  signedIn = 'owner-1';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
});

const LIST = 'own-send-facts';
const listKey = (owner: string) => `@vitruvius/web/${owner}/@vitruvius/report-snapshots/own-send-facts/v1`;
const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as const };
const at = (n: number) => new Date(Date.parse('2026-09-01T15:00:00.000Z') + n * 86_400_000).toISOString();
const report = (n: number) => ({ version: 'dave-report-snapshot/1.0', scopeKey: 'tower', capturedAt: at(n), sourceFingerprint: `facts-${n}`, reportFormat: 'project_manager', tasks: [] }) as unknown as DAVEReportSnapshot;
const tab = () => ({ storage: daveWebReportStorage(async () => signedIn), cloud: daveWebReportSnapshotCloud(load, save) });
/** He approves and sends report `n` (one a day). */
async function send(store: ReturnType<typeof tab>, n: number) {
  const before = reportPeriodSentAt((await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot);
  expect((await approveDAVEWebReportPeriod(store, report(n), before)).status).toBe('saved');
  expect((await recordDAVEWebReportSend(store, PERIOD, `facts-${n}`, at(n)))?.status).toBe('saved');
}
/** The tab is closed; a new tab of the same browser reads the period. */
async function inTheNextTab() {
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  return (await loadDAVEWebReportPeriod(tab(), 'tower', 'project_manager')).snapshot;
}

describe('R2 item 1: this browser\'s list of the reports it sent', () => {
  it('the first of five reports is still known as sent from here in the next tab (the period remembers three)', async () => {
    const store = tab();
    for (let n = 1; n <= 5; n += 1) await send(store, n);
    const period = await inTheNextTab();
    expect(daveWebReportSentHereAt(period, 'facts-5')).toBe(at(5));
    expect(daveWebReportSentHereAt(period, 'facts-1')).toBe(at(1));
    expect(daveWebReportSentHereAt(period, 'facts-never-sent')).toBeNull();
    expect(daveWebOwnSendFactsKept()).toBe(true);
    // Only when, which projects and format, and the facts' fingerprint are kept: no report text, no tasks.
    const kept = JSON.parse(values.get(listKey('owner-1')) as string) as Array<Record<string, unknown>>;
    expect(kept[0]).toEqual({ sentAt: at(1), scopeKey: 'tower', reportFormat: 'project_manager', fingerprint: 'facts-1' });
  });

  it('bounded: the last 50 are kept, the one before them is not', async () => {
    const store = tab();
    for (let n = 1; n <= 51; n += 1) await send(store, n);
    expect(JSON.parse(values.get(listKey('owner-1')) as string)).toHaveLength(50);
    const period = await inTheNextTab();
    expect(daveWebReportSentHereAt(period, 'facts-2')).toBe(at(2));
    expect(daveWebReportSentHereAt(period, 'facts-1')).toBeNull();
  }, 30000);

  it('each account\'s own: another account signed in on this browser knows none of them', async () => {
    const store = tab();
    for (let n = 1; n <= 5; n += 1) await send(store, n);
    signedIn = 'owner-2';
    const theirs = await inTheNextTab();
    expect(theirs).toBeNull();
    expect(daveWebOwnSendFactsKept()).toBe(false);
    expect(values.has(listKey('owner-2'))).toBe(false);
    expect(daveWebReportSentHereAt({ ...report(1), deliveredAt: at(9) } as DAVEReportSnapshot, 'facts-1')).toBeNull();
  });

  it('another account takes over the same tab with no sign-out between them: the tab\'s copy is that account\'s alone', async () => {
    const store = tab();
    for (let n = 1; n <= 5; n += 1) await send(store, n);
    expect(daveWebOwnSendFactsKept()).toBe(true);
    signedIn = 'owner-2';
    await loadDAVEWebReportPeriod(tab(), 'tower', 'project_manager');
    expect(daveWebOwnSendFactsKept()).toBe(false);
    expect(daveWebReportSentHereAt({ ...report(1), deliveredAt: at(9) } as DAVEReportSnapshot, 'facts-1')).toBeNull();
    // The first account's list is still in the browser, under its own prefix.
    expect(values.has(listKey('owner-1'))).toBe(true);
  });

  it('Sign Out of This Computer removes it with the report periods, from the browser and from the tab', async () => {
    const store = tab();
    for (let n = 1; n <= 5; n += 1) await send(store, n);
    expect(values.has(listKey('owner-1'))).toBe(true);
    forgetDAVEWebReportPeriods('owner-1');
    expect([...values.keys()].filter(key => key.startsWith('@vitruvius/web/owner-1/'))).toEqual([]);
    expect(daveWebOwnSendFactsKept()).toBe(false);
  });

  it('the browser refuses the list: known while the tab lasts, and after that the three the period remembers', async () => {
    refuses = LIST;
    const store = tab();
    for (let n = 1; n <= 5; n += 1) await send(store, n);
    expect(values.has(listKey('owner-1'))).toBe(false);
    // In the tab that sent them.
    const here = (await loadDAVEWebReportPeriod(store, 'tower', 'project_manager')).snapshot;
    expect(daveWebReportSentHereAt(here, 'facts-1')).toBe(at(1));
    // In the next tab: the three, as before.
    const period = await inTheNextTab();
    expect(daveWebReportSentHereAt(period, 'facts-3')).toBe(at(3));
    expect(daveWebReportSentHereAt(period, 'facts-1')).toBeNull();
    expect(daveWebOwnSendFactsKept()).toBe(false);
  });
});
