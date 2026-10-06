/**
 * @jest-environment node
 */
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { carryUpDAVEReportPeriod, saveDAVEReportSnapshot, type DAVEReportSnapshotCloud } from '../../services/DAVEReportSnapshotStore';
import { daveWebReportSendsNotSharedWarning } from '../../services/DAVEWebReportPeriod';
import {
  approveDAVEWebReportPeriod,
  daveWebOwnReportSends,
  daveWebReportPeriodsKeptHere,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
  loadDAVEWebReportPeriod,
  recordDAVEWebReportSend,
  shareDAVEWebReportSendsBeforeSignOut,
} from '../../services/DAVEWebReportSend';

// Review N2 of reports (5 Oct 2026, Low, caused by b1281f0). A report sent
// from the web while the shared record could not be reached is kept in this
// browser; the page says "Your other devices count from it once this computer
// reaches the shared record again". Sign Out of This Computer removes the
// account's report periods from the browser (a privacy rule, and it stays),
// so a sign-out before the record was reached again lost the send for good
// (the reviewer's seeds 1044 and 12). The record is now tried once more
// before the sign-out, and what still could not be confirmed is returned for
// the page to say. Checked here with the shared table present, missing, not
// reachable, and failing part-way. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type Row = { ownerId: string; snapshot: DAVEReportSnapshot; deliveredAt: string | null };
/** The cloud's report_snapshots table, one row per owner, projects and format, with its keep-the-later-send rule. */
let table = new Map<string, Row>();
let signedIn = 'owner-1';
let tableState: 'present' | 'missing' | 'down' = 'present';
let readFails: (scopeKey: string, format: string) => boolean = () => false;
let writeFails: (scopeKey: string, format: string) => boolean = () => false;
let writeIsLost = false;
let readNeverAnswers = false;
let writeNeverAnswers = false;
const writes: Array<{ ownerId: string; scopeKey: string; format: string }> = [];
const rowKey = (ownerId: string, scopeKey: string, format: string) => `${ownerId}|${scopeKey}|${format}`;
const cloud: DAVEReportSnapshotCloud = {
  async read(scopeKey: string, reportFormat: DAVEReportFormat) {
    if (readNeverAnswers) return new Promise<never>(() => undefined);
    if (tableState === 'missing') return null;
    if (tableState === 'down' || readFails(scopeKey, reportFormat as string)) throw new Error('The shared report period could not be read.');
    return { ownerId: signedIn, snapshot: table.get(rowKey(signedIn, scopeKey, reportFormat as string))?.snapshot ?? null };
  },
  async write(snapshot: DAVEReportSnapshot, expectedOwnerId?: string) {
    const format = snapshot.reportFormat as string;
    if (writeNeverAnswers) return new Promise<never>(() => undefined);
    if (tableState === 'missing') return 'unavailable';
    if (tableState === 'down' || writeFails(snapshot.scopeKey, format)) throw new Error('The shared report period could not be saved.');
    if (expectedOwnerId && expectedOwnerId !== signedIn) throw new Error('The signed-in account changed before the report period was shared.');
    writes.push({ ownerId: signedIn, scopeKey: snapshot.scopeKey, format });
    if (writeIsLost) return 'saved';
    const key = rowKey(signedIn, snapshot.scopeKey, format);
    const existing = table.get(key);
    const deliveredAt = reportPeriodSentAt(snapshot);
    if (existing?.deliveredAt && (!deliveredAt || deliveredAt < existing.deliveredAt)) return 'saved';
    table.set(key, { ownerId: signedIn, snapshot: JSON.parse(JSON.stringify(snapshot)), deliveredAt });
    return 'saved';
  },
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
  readFails = () => false;
  writeFails = () => false;
  writeIsLost = false;
  readNeverAnswers = false;
  writeNeverAnswers = false;
  writes.length = 0;
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
const store = () => ({ storage: daveWebReportStorage(ownerId), cloud });
const report = (fingerprint: string, reportFormat: DAVEReportFormat = 'project_manager', scopeKey = 'tower') => buildDAVEReportSnapshot({
  truths: [], scopeKey, sourceFingerprint: fingerprint, capturedAt: '2026-10-05T12:00:00.000Z', reportFormat,
});
const keysOf = (owner: string) => [...profile.keys()].filter(key => key.startsWith(`@vitruvius/web/${owner}/`));
const sharedSend = (reportFormat = 'project_manager', owner = 'owner-1') => table.get(rowKey(owner, 'tower', reportFormat))?.deliveredAt ?? null;
/** Let the background writes of an approval or a send settle. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };

/** He approves on the web; the shared record then cannot be reached; he shares the report (a send). */
async function sentWhileTheRecordWasDown(sentAt: string, reportFormat: DAVEReportFormat = 'project_manager') {
  await approveDAVEWebReportPeriod(store(), report(`facts-${reportFormat}`, reportFormat), null);
  await settle();
  tableState = 'down';
  await expect(recordDAVEWebReportSend(store(), { scopeKey: 'tower', reportFormat }, `facts-${reportFormat}`, sentAt)).resolves.toMatchObject({ status: 'saved' });
  await settle();
  // Recorded on this computer; the shared record still has only the approval.
  expect(sharedSend(reportFormat)).toBeNull();
  expect(table.get(rowKey('owner-1', 'tower', reportFormat))?.snapshot.deliveredAt).toBeNull();
  // What is written from here on is the sign-out's own doing.
  writes.length = 0;
}
const SENT_AT = '2026-10-05T14:14:00.000Z';

describe('review N2 (Low): before Sign Out removes the report periods, a send that has not reached the shared record is tried once more', () => {
  it('the reviewer\'s seed 1044, with the record reachable again at sign-out: the send is carried up, and nothing needs saying', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    expect(daveWebReportPeriodsKeptHere()).toBe(true);

    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(sharedSend()).toBe(SENT_AT);

    // The sign-out then removes the account's periods from this browser, as before (review N1).
    forgetDAVEWebReportPeriods('owner-1');
    expect(keysOf('owner-1')).toEqual([]);
    expect(daveWebReportPeriodsKeptHere()).toBe(false);
    // Signed in again, this computer reads the send back from the shared record, and knows it as its own.
    const again = await loadDAVEWebReportPeriod(store(), 'tower', 'project_manager');
    expect(again.snapshot?.deliveredAt).toBe(SENT_AT);
    expect(again.shared).toBe('checked');
    expect(daveWebOwnReportSends().has(SENT_AT)).toBe(true);
  });

  it('the record still cannot be reached: the send is returned to be said, and nothing is removed', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    const kept = keysOf('owner-1').length;
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([
      { scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT },
    ]);
    expect(sharedSend()).toBeNull();
    expect(keysOf('owner-1')).toHaveLength(kept);
    // A later try, with the record back, carries it up.
    tableState = 'present';
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(sharedSend()).toBe(SENT_AT);
  });

  it('before the shared table exists: nothing is carried up and nothing is said (the period was this computer\'s alone)', async () => {
    tableState = 'missing';
    await approveDAVEWebReportPeriod(store(), report('facts'), null);
    await recordDAVEWebReportSend(store(), { scopeKey: 'tower', reportFormat: 'project_manager' }, 'facts', SENT_AT);
    await settle();
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(table.size).toBe(0);
    expect(writes).toEqual([]);
  });

  it('a send that reached the shared record when it was made: read once, written again by no one', async () => {
    await approveDAVEWebReportPeriod(store(), report('facts'), null);
    await recordDAVEWebReportSend(store(), { scopeKey: 'tower', reportFormat: 'project_manager' }, 'facts', SENT_AT);
    await settle();
    expect(sharedSend()).toBe(SENT_AT);
    writes.length = 0;
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(writes).toEqual([]);
  });

  it('the phone has sent a later report meanwhile: this computer\'s older send is not written over it, and nothing is said', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    const phones = markReportSnapshotDelivered(reportSnapshotToSave(report('phone-facts'), null) as DAVEReportSnapshot, '2026-10-05T15:00:00.000Z', 'phone-install');
    table.set(rowKey('owner-1', 'tower', 'project_manager'), { ownerId: 'owner-1', snapshot: phones, deliveredAt: '2026-10-05T15:00:00.000Z' });
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(sharedSend()).toBe('2026-10-05T15:00:00.000Z');
    expect(writes).toEqual([]);
  });
});

describe('review N2 (Low): the shared record failing part-way at sign-out', () => {
  it('it can be read but not written: the send is returned', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    writeFails = () => true;
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([
      { scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT },
    ]);
    expect(sharedSend()).toBeNull();
  });

  it('the write is answered but the record does not have it when read back: the send is returned', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    writeIsLost = true;
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([
      { scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT },
    ]);
  });

  it('one format\'s period is carried up and the other\'s is not: only the other is returned', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    await sentWhileTheRecordWasDown('2026-10-05T14:20:00.000Z', 'executive');
    tableState = 'present';
    writeFails = (_scopeKey, format) => format === 'executive';
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([
      { scopeKey: 'tower', reportFormat: 'executive', sentAt: '2026-10-05T14:20:00.000Z' },
    ]);
    expect(sharedSend('project_manager')).toBe(SENT_AT);
    expect(sharedSend('executive')).toBeNull();
  });

  it('two sends not confirmed: both are returned, the newest first', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    await sentWhileTheRecordWasDown('2026-10-05T14:20:00.000Z', 'executive');
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([
      { scopeKey: 'tower', reportFormat: 'executive', sentAt: '2026-10-05T14:20:00.000Z' },
      { scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT },
    ]);
  });

  it('the record never answers: the sign-out is not held up for more than the four seconds a read is given', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    readNeverAnswers = true;
    jest.useFakeTimers();
    try {
      const tried = shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud);
      await jest.advanceTimersByTimeAsync(4000);
      await expect(tried).resolves.toEqual([{ scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the record is read but the write never answers: not held up for more than four seconds more, and the send is returned', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    writeNeverAnswers = true;
    jest.useFakeTimers();
    try {
      const tried = shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud);
      await jest.advanceTimersByTimeAsync(4000);
      await expect(tried).resolves.toEqual([{ scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('who is signed in cannot be confirmed: nothing is tried and nothing is said', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    await expect(shareDAVEWebReportSendsBeforeSignOut(async () => { throw new Error('offline'); }, cloud)).resolves.toEqual([]);
    expect(writes).toEqual([]);
    expect(sharedSend()).toBeNull();
    // Nor is the sign-out held up when that question is never answered.
    jest.useFakeTimers();
    try {
      const tried = shareDAVEWebReportSendsBeforeSignOut(() => new Promise<string>(() => undefined), cloud);
      await jest.advanceTimersByTimeAsync(4000);
      await expect(tried).resolves.toEqual([]);
    } finally {
      jest.useRealTimers();
    }
    expect(writes).toEqual([]);
  });
});

describe('review N2 (Low): only the signed-in account\'s own sends, into its own record', () => {
  it('another account\'s period kept in this browser is neither carried up nor said', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    // owner-2 is signed in now; owner-1's period is still in the browser (its sign-in was ended elsewhere).
    signedIn = 'owner-2';
    forgetDAVEWebOwnReportSends();
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(writes).toEqual([]);
    expect(sharedSend('project_manager', 'owner-2')).toBeNull();
    expect(sharedSend('project_manager', 'owner-1')).toBeNull();
    expect(keysOf('owner-1').length).toBeGreaterThan(0);
  });

  it('the account that answers the shared record is not the one whose periods these are: nothing is written', async () => {
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    // The check is made for owner-1, but the signed-in client has become owner-2's.
    signedIn = 'owner-2';
    const tried = await shareDAVEWebReportSendsBeforeSignOut(async () => 'owner-1', cloud);
    expect(writes).toEqual([]);
    expect([...table.keys()].filter(key => key.startsWith('owner-2|'))).toEqual([]);
    // It could not be confirmed for owner-1, so it is said.
    expect(tried).toEqual([{ scopeKey: 'tower', reportFormat: 'project_manager', sentAt: SENT_AT }]);
  });

  it('the phone\'s send kept here under this computer\'s approval is not this computer\'s to report', async () => {
    const phones = markReportSnapshotDelivered(reportSnapshotToSave(report('phone-facts'), null) as DAVEReportSnapshot, '2026-10-05T09:00:00.000Z', 'phone-install');
    table.set(rowKey('owner-1', 'tower', 'project_manager'), { ownerId: 'owner-1', snapshot: phones, deliveredAt: '2026-10-05T09:00:00.000Z' });
    // Approved here on the phone's period, not sent.
    await approveDAVEWebReportPeriod(store(), report('web-facts'), '2026-10-05T09:00:00.000Z');
    await settle();
    tableState = 'down';
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
  });
});

describe('review N2 (Low): the pieces', () => {
  it('whether this browser keeps a report period at all is known at once', async () => {
    expect(daveWebReportPeriodsKeptHere()).toBe(false);
    await saveDAVEReportSnapshot(reportSnapshotToSave(report('facts'), null) as DAVEReportSnapshot, daveWebReportStorage(ownerId), cloud);
    expect(daveWebReportPeriodsKeptHere()).toBe(true);
    forgetDAVEWebReportPeriods('owner-1');
    expect(daveWebReportPeriodsKeptHere()).toBe(false);
    // A tab that cannot keep site data holds it in its own memory.
    const tabOnly = daveWebReportStorage(ownerId, null);
    await saveDAVEReportSnapshot(reportSnapshotToSave(report('facts'), null) as DAVEReportSnapshot, tabOnly, cloud);
    expect(daveWebReportPeriodsKeptHere()).toBe(true);
    forgetDAVEWebReportPeriods('owner-1');
    expect(daveWebReportPeriodsKeptHere()).toBe(false);
  });

  it('a period kept only in this tab\'s memory (the browser\'s storage full) is carried up too', async () => {
    const full = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: full });
    await sentWhileTheRecordWasDown(SENT_AT);
    tableState = 'present';
    await expect(shareDAVEWebReportSendsBeforeSignOut(ownerId, cloud)).resolves.toEqual([]);
    expect(sharedSend()).toBe(SENT_AT);
  });

  it('carrying a period up says what became of it', async () => {
    const storage = daveWebReportStorage(ownerId);
    await expect(carryUpDAVEReportPeriod('tower', 'project_manager', storage, cloud)).resolves.toBe('shared');
    await sentWhileTheRecordWasDown(SENT_AT);
    await expect(carryUpDAVEReportPeriod('tower', 'project_manager', storage, cloud)).resolves.toBe('not_reached');
    tableState = 'missing';
    await expect(carryUpDAVEReportPeriod('tower', 'project_manager', storage, cloud)).resolves.toBe('unavailable');
    tableState = 'present';
    await expect(carryUpDAVEReportPeriod('tower', 'project_manager', storage, cloud)).resolves.toBe('shared');
    expect(sharedSend()).toBe(SENT_AT);
  });

  it('what he is told: which report, what signing out removes, what his other devices will and will not count, and how to keep it', () => {
    const one = daveWebReportSendsNotSharedWarning([SENT_AT]);
    expect(one.title).toBe('A report sent from this computer may not have reached your other devices');
    expect(one.lines).toHaveLength(3);
    expect(one.lines[0]).toMatch(/^Vitruvius tried again just now and could not confirm that the report sent from this computer (at|on) .* is in the record your devices share\.$/);
    expect(one.lines[1]).toBe(
      "Signing out removes this computer's own record of it. If the shared record does not have it, your other devices will not count from it: " +
      'the next report on every device will count from the report before it, and may repeat what it covered.',
    );
    expect(one.lines[2]).toBe('Cancel and sign out a little later so Vitruvius can try again, or sign out now.');
    const two = daveWebReportSendsNotSharedWarning(['2026-10-05T14:20:00.000Z', SENT_AT]);
    expect(two.title).toBe('Reports sent from this computer may not have reached your other devices');
    expect(two.lines[0]).toMatch(/could not confirm that 2 reports sent from this computer \(the latest (at|on) .*\) are in the record your devices share\.$/);
    expect(two.lines[1]).toContain('will not count from them');
  });
});
