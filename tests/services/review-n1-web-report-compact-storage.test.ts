/**
 * @jest-environment node
 */
import { buildDAVEReportSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, reportSenderId, saveDAVEReportSnapshot, type DAVEReportSnapshotCloud } from '../../services/DAVEReportSnapshotStore';
import {
  DAVE_WEB_NO_KEYCHAIN,
  approveDAVEWebReportPeriod,
  daveWebReportPeriodKeptInTabOnly,
  daveWebReportStorage,
  daveWebStoredReportValue,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  recordDAVEWebReportSend,
} from '../../services/DAVEWebReportSend';

// Review N1 L1 (3 Oct 2026, caused by 46e3332): the web kept each report
// period in the browser's storage as its JSON, three reports deep: about
// 1,150 characters a task. A browser gives a site some 2.6 to 5.2 million
// characters, so from about 1,500 tasks the period could not be saved and the
// page said "Try Approve again", which never helped. The period now goes in
// compactly and reads back as the same text. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(120_000);

const names = ['Excavate footings', 'Form and pour slab on grade', 'Frame exterior walls', 'Rough-in electrical', 'Install roof trusses', 'Hang and finish drywall', 'MEP rough inspection', 'Set windows and doors'];
/** The report's facts as Project Truth gives them to the saved period: one task in ten moves each week. */
const truthOf = (count: number, round: number) => ({
  projectName: 'Tower',
  schedule: Array.from({ length: count }, (_, n) => ({
    taskId: `3f2a9c1e-7b4d-4e2a-9c1e-${String(n).padStart(12, '0')}`,
    taskName: `${names[n % names.length]} ${1 + Math.floor(n / names.length)}`, areaName: `Level ${1 + (n % 6)}`, owner: 'Dana Alvarez',
    status: 'In Progress', percentComplete: Math.min(99, (n % 9) * 10 + (n % 10 === 0 ? round : 0)),
    startDate: '09/01/2026', finishDate: '06/30/2027', urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
    latestActivityAt: '2026-09-10T12:00:00.000Z', latestActivitySummary: 'Crew on site.',
  })),
}) as never;
const snapshotOf = (count: number, round: number, at: string, format: 'project_manager' | 'executive'): DAVEReportSnapshot =>
  buildDAVEReportSnapshot({ truths: [truthOf(count, round)], scopeKey: 'tower', sourceFingerprint: `facts-${count}-${round}`, capturedAt: at, reportFormat: format });
/** A browser's storage for one site, with a limit in UTF-16 code units (keys and values), as browsers count it. */
const limited = (limitChars: number) => {
  const values = new Map<string, string>();
  const used = () => [...values].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    values, used,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const next = used() - (values.has(key) ? key.length + (values.get(key) as string).length : 0) + key.length + value.length;
      if (next > limitChars) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      values.set(key, value);
    },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
};
const noCloud: DAVEReportSnapshotCloud = { read: async () => null, write: async () => undefined };
const periodKeyOf = (local: ReturnType<typeof limited>, format = 'project_manager') =>
  [...local.values.keys()].find(key => key.includes('report-snapshots/v1:tower') && key.endsWith(format)) as string;

/** Three reports approved and sent in a row in one format, as the web records them. */
async function threeReports(count: number, local: ReturnType<typeof limited>, format: 'project_manager' | 'executive') {
  const store = { storage: daveWebReportStorage(async () => 'owner-1', local as never), cloud: noCloud };
  let since: string | null = null;
  for (let round = 0; round < 3; round += 1) {
    const at = `2026-10-0${round + 1}T12:00:00.000Z`;
    const current = snapshotOf(count, round, at, format);
    await approveDAVEWebReportPeriod(store, current, since);
    const sentAt = `2026-10-0${round + 1}T13:00:00.000Z`;
    const outcome = await recordDAVEWebReportSend(store, { scopeKey: 'tower', reportFormat: format }, current.sourceFingerprint, sentAt);
    if (outcome?.status !== 'saved') throw new Error(`not recorded in round ${round}`);
    since = sentAt;
  }
  return store;
}

afterEach(() => {
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebOwnReportSends();
});

describe('review N1 L1: the web keeps a report period compactly, and reads back the same period', () => {
  it('three reports deep, 1,000 tasks: under a third of the characters, and the period read back is the one saved', async () => {
    const local = limited(Number.MAX_SAFE_INTEGER);
    const store = await threeReports(1000, local, 'project_manager');
    const stored = local.values.get(periodKeyOf(local)) as string;
    const period = (await loadDAVEReportPeriod('tower', 'project_manager', store.storage, noCloud)).snapshot as DAVEReportSnapshot;
    const asJson = JSON.stringify(period);
    // What it was: the period's own JSON, over 1,000 characters a task.
    expect(asJson.length / 1000).toBeGreaterThan(1000);
    expect(stored.length).toBeLessThan(asJson.length / 3);
    expect(stored.length / 1000).toBeLessThan(400);
    // Read back, it is the same text, character for character: three reports, every task and field.
    expect(daveWebStoredReportValue(stored)).toBe(asJson);
    expect(period.deliveredAt).toBe('2026-10-03T13:00:00.000Z');
    expect(period.tasks).toHaveLength(1000);
    expect(period.supersedes?.tasks).toHaveLength(1000);
    expect(period.supersedes?.supersedes?.tasks).toHaveLength(1000);
    expect(period.tasks[10]).toEqual(snapshotOf(1000, 2, '2026-10-03T12:00:00.000Z', 'project_manager').tasks[10]);
  });

  it('at a browser\'s limit (2,621,440 characters): 2,000 tasks in both formats are saved, where 1,500 could not be', async () => {
    const local = limited(2_621_440);
    await threeReports(2000, local, 'project_manager');
    await threeReports(2000, local, 'executive');
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
    expect(local.used()).toBeLessThan(2_621_440);
    expect(periodKeyOf(local, 'executive')).toBeTruthy();
  });

  it('a period saved before this change, and values that are not periods, are read and kept as they are', async () => {
    const local = limited(Number.MAX_SAFE_INTEGER);
    const storage = daveWebReportStorage(async () => 'owner-1', local as never);
    const before = { ...snapshotOf(3, 0, '2026-10-01T12:00:00.000Z', 'project_manager'), deliveredAt: '2026-10-01T13:00:00.000Z' } as DAVEReportSnapshot;
    local.values.set('@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1:tower:project_manager', JSON.stringify(before));
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, noCloud)).resolves.toMatchObject({ snapshot: { deliveredAt: '2026-10-01T13:00:00.000Z' } });
    const senderId = await reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN);
    expect(local.values.get('@vitruvius/report-sender-id/v1')).toBe(senderId);
    await storage.setItem('list', '["2026-10-01T13:00:00.000Z"]');
    expect(local.values.get('@vitruvius/web/owner-1/list')).toBe('["2026-10-01T13:00:00.000Z"]');
  });

  it('a period that would not read back as the same text is written as it is', async () => {
    const local = limited(Number.MAX_SAFE_INTEGER);
    const storage = daveWebReportStorage(async () => 'owner-1', local as never);
    const spaced = JSON.stringify(snapshotOf(40, 0, '2026-10-01T12:00:00.000Z', 'project_manager'), null, 1);
    await storage.setItem('spaced', spaced);
    expect(local.values.get('@vitruvius/web/owner-1/spaced')).toBe(spaced);
    await expect(storage.getItem('spaced')).resolves.toBe(spaced);
  });

  it('when the browser still cannot take it: saved for the tab, read back, and the page can say so', async () => {
    const local = limited(50_000);
    const storage = daveWebReportStorage(async () => 'owner-1', local as never);
    const approval = { ...snapshotOf(1000, 0, '2026-10-01T12:00:00.000Z', 'project_manager'), deliveredAt: null } as DAVEReportSnapshot;
    await expect(saveDAVEReportSnapshot(approval, storage, noCloud)).resolves.toBeUndefined();
    expect(local.values.size).toBe(0);
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(true);
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, noCloud)).resolves.toMatchObject({ snapshot: { deliveredAt: null } });
    forgetDAVEWebReportPeriods('owner-1');
    expect(daveWebReportPeriodKeptInTabOnly()).toBe(false);
  });
});
