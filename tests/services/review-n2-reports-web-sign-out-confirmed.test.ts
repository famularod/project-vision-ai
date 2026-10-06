/**
 * @jest-environment node
 */
import {
  buildDAVEReportSnapshot,
  reportPeriodSentAt,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  approveDAVEWebReportPeriod,
  daveWebReportPeriodsKeptHere,
  daveWebReportSendSeenInSharedRecord,
  daveWebReportSnapshotCloud,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
  shareDAVEWebReportSendsBeforeSignOut,
} from '../../services/DAVEWebReportSend';

// Review N2 follow-up (5 Oct 2026, to finding 5). Sign Out's warning "A report
// sent from this computer may not have reached your other devices" appeared
// whenever the shared record could not be reached at sign-out, also for a
// send that had reached it earlier: 8 of the 11 times in the reviewer's
// sequences. This browser now keeps what it has seen of the shared record
// (the send it runs from), and the warning is given only for a send it has
// not seen there. Checked here through the web's own cloud wrapper over an
// in-memory report_snapshots table. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type Row = { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
let table = new Map<string, Row>();
let signedIn = 'owner-1';
let tableState: 'present' | 'missing' | 'down' = 'present';
/** The record takes the row but its answer never reaches this computer. */
let answerLost = false;
/** The record answers "saved" but does not keep the row. */
let writeIsLost = false;
/** Holds the next read's answer back until released. */
let heldRead: { release: () => void } | null = null;
let holdNextRead = false;
const rowKey = (ownerId: string, scopeKey: string, format: string) => `${ownerId}|${scopeKey}|${format}`;
const load = async (scopeKey: string, format: string) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be read.');
  const answer = { ownerId: signedIn, snapshot: table.get(rowKey(signedIn, scopeKey, format))?.snapshot ?? null };
  if (holdNextRead) {
    holdNextRead = false;
    await new Promise<void>(resolve => { heldRead = { release: resolve }; });
  }
  return answer;
};
const save = async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null; expectedOwnerId?: string }) => {
  if (tableState === 'missing') return 'unavailable' as const;
  if (tableState === 'down') throw new Error('The shared report period could not be saved.');
  if (row.expectedOwnerId && row.expectedOwnerId !== signedIn) throw new Error('The signed-in account changed before the report period was shared.');
  if (!writeIsLost) {
    const key = rowKey(signedIn, row.scopeKey, row.format);
    const existing = table.get(key);
    if (!(existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt))) {
      table.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    }
  }
  if (answerLost) throw new Error('The shared report period could not be saved.');
  return 'saved' as const;
};

let profile = new Map<string, string>();
const root = globalThis as unknown as { localStorage?: unknown };
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterAll(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
});
beforeEach(() => {
  table = new Map();
  signedIn = 'owner-1';
  tableState = 'present';
  answerLost = false;
  writeIsLost = false;
  heldRead = null;
  holdNextRead = false;
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
  forgetDAVEWebReportPeriods('owner-2');
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
});

const ownerId = async () => signedIn;
/** The page's own store: this browser's storage, and the shared record through the web's wrapper. */
const store = () => ({ storage: daveWebReportStorage(ownerId), cloud: daveWebReportSnapshotCloud(load, save) });
const PERIOD = { scopeKey: 'tower', reportFormat: 'project_manager' as DAVEReportFormat };
const report = (fingerprint: string) => buildDAVEReportSnapshot({
  truths: [], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt: '2026-10-05T12:00:00.000Z', reportFormat: 'project_manager',
});
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
const sharedSend = (owner = 'owner-1') => table.get(rowKey(owner, 'tower', 'project_manager'))?.deliveredAt ?? null;
const keysOf = (owner: string) => [...profile.keys()].filter(key => key.startsWith(`@vitruvius/web/${owner}/`));
const SENT_AT = '2026-10-05T14:14:00.000Z';
const WARNED = [{ scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT }];
/** What Sign Out asks before it goes ahead (through a wrapper of its own, as the Settings page makes one). */
const atSignOut = () => shareDAVEWebReportSendsBeforeSignOut(ownerId, daveWebReportSnapshotCloud(load, save));

/** He approves and sends a report from this computer. */
async function approveAndSend(sentAt = SENT_AT) {
  const page = store();
  await approveDAVEWebReportPeriod(page, report('facts'), reportPeriodSentAt((await loadDAVEWebReportPeriod(page, 'tower', 'project_manager')).snapshot));
  await settle();
  await expect(recordDAVEWebReportSend(page, PERIOD, 'facts', sentAt)).resolves.toMatchObject({ status: 'saved' });
  await settle();
  return page;
}

describe('review N2 follow-up: Sign Out warns only for a send this computer has not seen in the shared record', () => {
  it('the send reached the record when it was made, and the record cannot be reached at sign-out: nothing is said', async () => {
    await approveAndSend();
    expect(sharedSend()).toBe(SENT_AT);
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });

  it('the same in a later visit: what it saw is kept in this browser, not only in the tab', async () => {
    await approveAndSend();
    // A new tab, days later: nothing in memory; Reports is not opened; the record cannot be reached.
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });

  it('sent while the record could not be reached: said, as before', async () => {
    const page = store();
    await approveDAVEWebReportPeriod(page, report('facts'), null);
    await settle();
    tableState = 'down';
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await settle();
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(false);
    await expect(atSignOut()).resolves.toEqual(WARNED);
    // The record comes back: carried up, and from then on it is known to be there.
    tableState = 'present';
    await expect(atSignOut()).resolves.toEqual([]);
    expect(sharedSend()).toBe(SENT_AT);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });

  it('the record took the send but its answer was lost: not known until a later read shows it there', async () => {
    const page = store();
    await approveDAVEWebReportPeriod(page, report('facts'), null);
    await settle();
    answerLost = true;
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await settle();
    expect(sharedSend()).toBe(SENT_AT);
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(false);
    answerLost = false;
    // The page reads the period again (a refresh): the record is seen to run from it.
    await loadDAVEWebReportPeriod(page, 'tower', 'project_manager');
    await settle();
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });

  it('the record said "saved" and did not keep it: a later read takes that back, and Sign Out says so', async () => {
    const page = store();
    await approveDAVEWebReportPeriod(page, report('facts'), null);
    await settle();
    writeIsLost = true;
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await settle();
    expect(sharedSend()).toBeNull();
    // Taken on the record's word for now.
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    // A read made afterwards shows the record without it.
    await store().cloud.read('tower', 'project_manager');
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(false);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual(WARNED);
  });

  it('a read asked before the send was accepted, answered after it, takes nothing back', async () => {
    const page = store();
    await approveDAVEWebReportPeriod(page, report('facts'), null);
    await settle();
    // A read is on its way (it will show the record as it was) when the send is recorded and accepted.
    holdNextRead = true;
    const earlierRead = page.cloud.read('tower', 'project_manager');
    await settle();
    await recordDAVEWebReportSend(page, PERIOD, 'facts', SENT_AT);
    await settle();
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    (heldRead as unknown as { release: () => void }).release();
    await earlierRead;
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
  });

  it('an earlier write of the period, accepted after the send, takes nothing back', async () => {
    const page = await approveAndSend();
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    // The approval's own write (the period as it was before the send) is answered late: the record keeps the send.
    await expect(page.cloud.write(report('facts'))).resolves.toBe('saved');
    expect(sharedSend()).toBe(SENT_AT);
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });

  it('the phone has since sent a later report: this computer\'s send is not in question either', async () => {
    await approveAndSend();
    const page = store();
    const phones = { ...report('phone-facts'), deliveredAt: '2026-10-05T15:00:00.000Z', sentBy: 'phone-install' } as DAVEReportSnapshot;
    table.set(rowKey('owner-1', 'tower', 'project_manager'), { snapshot: phones, deliveredAt: '2026-10-05T15:00:00.000Z' });
    await loadDAVEWebReportPeriod(page, 'tower', 'project_manager');
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
  });
});

describe('review N2 follow-up: what this browser keeps of the shared record goes with the account at sign-out', () => {
  it('removed with the account\'s periods; an answer that arrives after the sign-out writes nothing back', async () => {
    const page = await approveAndSend();
    expect(keysOf('owner-1').some(key => key.includes('shared-seen'))).toBe(true);
    // A read is on its way when he signs out.
    holdNextRead = true;
    const lateRead = page.cloud.read('tower', 'project_manager');
    await settle();
    forgetDAVEWebReportPeriods('owner-1');
    expect(keysOf('owner-1')).toEqual([]);
    (heldRead as unknown as { release: () => void }).release();
    await lateRead;
    await settle();
    expect(keysOf('owner-1')).toEqual([]);
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(false);
  });

  it('kept for each account: another account\'s is not this account\'s', async () => {
    await approveAndSend();
    expect(daveWebReportSendSeenInSharedRecord('owner-2', PERIOD, SENT_AT)).toBe(false);
    forgetDAVEWebReportPeriods('owner-2');
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
  });

  it('a browser that has only read the shared record keeps no period: Sign Out still goes ahead in the same press', async () => {
    const phones = { ...report('phone-facts'), deliveredAt: '2026-10-05T09:00:00.000Z', sentBy: 'phone-install' } as DAVEReportSnapshot;
    table.set(rowKey('owner-1', 'tower', 'project_manager'), { snapshot: phones, deliveredAt: '2026-10-05T09:00:00.000Z' });
    await loadDAVEWebReportPeriod(store(), 'tower', 'project_manager');
    expect(keysOf('owner-1').some(key => key.includes('shared-seen'))).toBe(true);
    expect(daveWebReportPeriodsKeptHere()).toBe(false);
  });

  it('with the browser\'s storage full it is kept for the tab, as a period is', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined, key: () => null, length: 0 },
    });
    await approveAndSend();
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(true);
    tableState = 'down';
    await expect(atSignOut()).resolves.toEqual([]);
    forgetDAVEWebReportPeriods('owner-1');
    expect(daveWebReportSendSeenInSharedRecord('owner-1', PERIOD, SENT_AT)).toBe(false);
  });
});
