/**
 * @jest-environment node
 */
import { buildDAVEReportSnapshot, type DAVEReportFormat, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebReportSendReachedShared,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  onDAVEWebReportSharedRecordSeen,
  recordDAVEWebReportSend,
  type DAVEWebSharedRecordSeen,
} from '../../services/DAVEWebReportSend';

// Review N2 follow-up (5 Oct 2026). "Recorded as sent ... The next report on
// every device runs from this one." was worded from the page's last read of
// the shared record, not from whether this send's own write arrived. Here:
// where a send just recorded stands in the shared record (the answer to its
// own write, waited for a moment), and the word that goes out when the record
// is later seen to run from it. In-memory report_snapshots table, through the
// web's own cloud wrapper. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type Row = { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
let table = new Map<string, Row>();
let tableState: 'present' | 'missing' | 'down' = 'present';
/** Holds the answer to the next write of a sent report back until released. */
let holdSendAnswer = false;
let heldAnswer: { release: () => void } | null = null;
const load = async (scopeKey: string, format: string) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be read.');
  return { ownerId: 'owner-1', snapshot: table.get(`${scopeKey}|${format}`)?.snapshot ?? null };
};
const save = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be saved.');
  table.set(`${row.scopeKey}|${row.format}`, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
  if (holdSendAnswer && row.deliveredAt) {
    holdSendAnswer = false;
    await new Promise<void>(resolve => { heldAnswer = { release: resolve }; });
  }
  return 'saved' as const;
};

let profile = new Map<string, string>();
const root = globalThis as unknown as { localStorage?: unknown };
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
});
let stopListening: () => void = () => undefined;
let heard: DAVEWebSharedRecordSeen[] = [];
beforeEach(() => {
  table = new Map();
  tableState = 'present';
  holdSendAnswer = false;
  heldAnswer = null;
  profile = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => profile.get(key) ?? null,
      setItem: (key: string, value: string) => { profile.set(key, value); },
      removeItem: (key: string) => { profile.delete(key); },
      key: (index: number) => [...profile.keys()][index] ?? null,
      get length() { return profile.size; },
    },
  });
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  heard = [];
  stopListening = onDAVEWebReportSharedRecordSeen(seen => { heard.push(seen); });
});
afterEach(() => stopListening());

const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as DAVEReportFormat };
const SENT_AT = '2026-10-05T14:14:00.000Z';
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
const report = () => buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'facts', capturedAt: '2026-10-05T12:00:00.000Z', reportFormat: 'project_manager' });
/** The page's store; he approves the report on it. */
async function approved() {
  const page = { storage: daveWebReportStorage(async () => 'owner-1'), cloud: daveWebReportSnapshotCloud(load, save) };
  await approveDAVEWebReportPeriod(page, report(), null);
  await settle();
  return page;
}

describe('review N2 follow-up: where a send just recorded stands in the shared record', () => {
  it('the record accepted it: checked', async () => {
    const page = await approved();
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await expect(daveWebReportSendReachedShared(page.cloud, PERIOD, SENT_AT)).resolves.toBe('checked');
    expect(table.get('tower|project_manager')?.deliveredAt).toBe(SENT_AT);
    expect(heard).toContainEqual({ ...PERIOD, sentAt: SENT_AT });
  });

  it('the record cannot be reached: unchecked, though the page had read it a moment before', async () => {
    const page = await approved();
    tableState = 'down';
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await expect(daveWebReportSendReachedShared(page.cloud, PERIOD, SENT_AT)).resolves.toBe('unchecked');
    expect(heard).not.toContainEqual({ ...PERIOD, sentAt: SENT_AT });
  });

  it('reports are not shared between his devices yet: unavailable', async () => {
    tableState = 'missing';
    const page = await approved();
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await expect(daveWebReportSendReachedShared(page.cloud, PERIOD, SENT_AT)).resolves.toBe('unavailable');
  });

  it('the answer is slow: unchecked after the wait, and the page is told when it does arrive', async () => {
    const page = await approved();
    holdSendAnswer = true;
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await expect(daveWebReportSendReachedShared(page.cloud, PERIOD, SENT_AT, 20)).resolves.toBe('unchecked');
    expect(heard).not.toContainEqual({ ...PERIOD, sentAt: SENT_AT });
    (heldAnswer as unknown as { release: () => void }).release();
    await settle();
    expect(heard).toContainEqual({ ...PERIOD, sentAt: SENT_AT });
    await expect(daveWebReportSendReachedShared(page.cloud, PERIOD, SENT_AT)).resolves.toBe('checked');
  });

  it('a page that has stopped listening is told nothing more', async () => {
    const page = await approved();
    stopListening();
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await settle();
    expect(heard).not.toContainEqual({ ...PERIOD, sentAt: SENT_AT });
  });

  it('a shared record this module did not wrap says nothing of arrival: unchecked', async () => {
    const page = await approved();
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await expect(daveWebReportSendReachedShared({ read: async () => null, write: async () => undefined }, PERIOD, SENT_AT)).resolves.toBe('unchecked');
  });
});
