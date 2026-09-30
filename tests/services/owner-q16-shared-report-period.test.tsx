// Owner answer Q16 (30 Sep 2026): the owner sends reports from both the phone
// and the iPad, and "since the last report" was kept on each device only, so
// a report from the phone counted from the phone's own last send even after
// the iPad had sent one. The period is now shared through the owner's
// report_snapshots row (per projects and format): the later sent report
// wins, an approval not yet sent never moves the start, and without the
// shared copy (offline, signed out, table not created yet) each device uses
// its own period, as before.

/** Each simulated device has its own local store; one shared fake cloud stands in for report_snapshots. */
const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockLocal().set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockLocal().delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
}));

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
const mockCloud = new Map<string, MockCloudRow>();
let mockCloudState: 'ok' | 'offline' | 'missing_table' = 'ok';
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
const mockMissingTable = { ok: true, configured: true, data: null, stubbed: true, message: 'not available yet' };
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
    if (mockCloudState === 'missing_table') return mockMissingTable;
    return mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null });
  }),
  // The table's rule: a row whose period started from a later send is kept.
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (mockCloudState === 'offline') throw new TypeError('Network request failed');
    if (mockCloudState === 'missing_table') return mockMissingTable;
    const key = `${row.scopeKey}|${row.format}`;
    const existing = mockCloud.get(key);
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return mockOk(null);
    mockCloud.set(key, { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return mockOk(null);
  }),
}));

let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import {
  buildDAVEReportSnapshot,
  laterReportPeriod,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  loadDAVEReportSnapshot,
  saveDAVEReportSnapshot,
  type DAVEReportSnapshotCloud,
} from '../../services/DAVEReportSnapshotRepository';
import { saveReportSnapshotCloud } from '../../services/SupabaseService';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import type { ScheduleItem } from '../../types';

const PREFIX = '@vitruvius/report-snapshots/v1:';
const SHARED_KEY = `${PREFIX}tower`;
const keyFor = (format: DAVEReportFormat) => `${SHARED_KEY}:${format}`;
const onDevice = (device: string) => {
  mockDevice = device;
};

beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockCloudState = 'ok';
  onDevice('phone');
  forgetAllReportSessionState();
});

const truth = (completed: number) => ({
  projectName: 'Tower',
  schedule: ['a', 'b', 'c'].map((id, index) => ({
    taskId: id, taskName: `Task ${id}`, areaName: 'L2', owner: '',
    status: index < completed ? 'Complete' : 'In Progress', percentComplete: index < completed ? 100 : 40,
    finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
  })),
}) as never;
const snap = (fingerprint: string, completed: number, capturedAt: string, reportFormat: DAVEReportFormat | undefined = 'project_manager') =>
  buildDAVEReportSnapshot({ truths: [truth(completed)], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt, reportFormat });
const sent = (snapshot: DAVEReportSnapshot | null, at: string) => markReportSnapshotDelivered(snapshot as DAVEReportSnapshot, at);
const approved = (current: DAVEReportSnapshot, previous: DAVEReportSnapshot | null) =>
  reportSnapshotToSave(current, previous) as DAVEReportSnapshot;

/** One shared copy for the repository tests, with the table's keep-the-later-send rule. */
function memoryCloud(ownerId = 'owner-1') {
  const rows = new Map<string, DAVEReportSnapshot>();
  const cloud = {
    rows,
    read: jest.fn(async (scopeKey: string, format: DAVEReportFormat) =>
      ({ ownerId, snapshot: rows.get(`${scopeKey}|${format}`) ?? null })),
    write: jest.fn(async (snapshot: DAVEReportSnapshot, _expectedOwnerId?: string) => {
      const key = `${snapshot.scopeKey}|${snapshot.reportFormat}`;
      const existing = rows.get(key);
      const existingSent = reportPeriodSentAt(existing);
      const nextSent = reportPeriodSentAt(snapshot);
      if (existingSent && (!nextSent || nextSent < existingSent)) return;
      rows.set(key, JSON.parse(JSON.stringify(snapshot)));
    }),
  };
  return cloud;
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the shared period: the later sent report wins (repository)', () => {
  it('a send on one device is where the other device\'s next report counts from', async () => {
    const cloud = memoryCloud();
    const ipad = memoryStorage();
    const phone = memoryStorage();
    // The phone sent Monday's report; the iPad sends Tuesday's.
    const monday = sent(approved(snap('f0', 0, '2026-09-28T09:00:00.000Z'), null), '2026-09-28T10:00:00.000Z');
    await saveDAVEReportSnapshot(monday, phone, cloud);
    const onIpad = await loadDAVEReportSnapshot('tower', 'project_manager', ipad, cloud);
    expect(onIpad?.sourceFingerprint).toBe('f0');
    const tuesdayApproval = approved(snap('f1', 1, '2026-09-29T09:00:00.000Z'), onIpad);
    await saveDAVEReportSnapshot(tuesdayApproval, ipad, cloud);
    await saveDAVEReportSnapshot(sent(tuesdayApproval, '2026-09-29T10:00:00.000Z'), ipad, cloud);
    await flush();

    const onPhone = await loadDAVEReportSnapshot('tower', 'project_manager', phone, cloud);
    expect(reportBaselineSnapshot(onPhone, 'f2')?.sourceFingerprint).toBe('f1');
    // The other format's period is its own row, untouched.
    await expect(loadDAVEReportSnapshot('tower', 'executive', phone, cloud)).resolves.toBeNull();
    expect(Array.from(cloud.rows.keys())).toEqual(['tower|project_manager']);
  });

  it('an approval not yet sent never moves the period\'s start, wherever it is read', async () => {
    const sentReport = sent(approved(snap('f0', 0, '2026-09-28T09:00:00.000Z'), null), '2026-09-28T10:00:00.000Z');
    const pending = approved(snap('f1', 1, '2026-09-29T09:00:00.000Z'), sentReport);
    expect(reportPeriodSentAt(pending)).toBe('2026-09-28T10:00:00.000Z');
    // Against this device's sent report: a tie, and this device's own copy stays.
    expect(laterReportPeriod(sentReport, pending)).toBe(sentReport);
    // On a device with an older send, the pending approval brings the later send it superseded, not itself.
    const older = sent(approved(snap('fx', 0, '2026-09-20T09:00:00.000Z'), null), '2026-09-20T10:00:00.000Z');
    expect(reportBaselineSnapshot(laterReportPeriod(older, pending), 'f1')?.sourceFingerprint).toBe('f0');
    expect(reportBaselineSnapshot(laterReportPeriod(older, pending), 'f2')?.sourceFingerprint).toBe('f0');
    // A first approval never sent has no start at all: it never replaces a sent period.
    const firstPending = approved(snap('f9', 2, '2026-09-30T09:00:00.000Z'), null);
    expect(laterReportPeriod(older, firstPending)).toBe(older);
    // The local pending approval is kept over the same sent report from the cloud, so its send can be marked.
    expect(laterReportPeriod(pending, sentReport)).toBe(pending);

    // And in the shared copy: a late approval upload after the send is skipped.
    const cloud = memoryCloud();
    const device = memoryStorage();
    await saveDAVEReportSnapshot(sent(pending, '2026-09-29T10:00:00.000Z'), device, cloud);
    await saveDAVEReportSnapshot(pending, device, cloud);
    await flush();
    expect(cloud.rows.get('tower|project_manager')?.deliveredAt).toBe('2026-09-29T10:00:00.000Z');
  });

  it('a legacy snapshot counts as sent when captured; a delivered one by its send', () => {
    const legacy = snap('f0', 0, '2026-09-10T09:00:00.000Z');
    expect(reportPeriodSentAt(legacy)).toBe('2026-09-10T09:00:00.000Z');
    const later = sent(approved(snap('f1', 1, '2026-09-11T09:00:00.000Z'), legacy), '2026-09-11T10:00:00.000Z');
    expect(laterReportPeriod(legacy, later)).toBe(later);
    expect(laterReportPeriod(later, legacy)).toBe(later);
  });

  it('offline, unreadable or slow: this device\'s own period, as before', async () => {
    const device = memoryStorage();
    const own = sent(approved(snap('f0', 0, '2026-09-28T09:00:00.000Z'), null), '2026-09-28T10:00:00.000Z');
    device.values.set(keyFor('project_manager'), JSON.stringify(own));
    const failing: DAVEReportSnapshotCloud = {
      read: jest.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      write: jest.fn(async () => {
        throw new TypeError('Network request failed');
      }),
    };
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', device, failing)).resolves.toEqual(own);
    // The approval still saves on this device; the upload is retried later.
    const next = approved(snap('f1', 1, '2026-09-29T09:00:00.000Z'), own);
    await expect(saveDAVEReportSnapshot(next, device, failing)).resolves.toBeUndefined();
    expect(JSON.parse(device.values.get(keyFor('project_manager')) as string)).toEqual(next);

    // Unavailable (signed out, not configured, table missing): own period, and nothing is uploaded.
    const unavailable = { read: jest.fn(async () => null), write: jest.fn(async () => undefined) };
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', device, unavailable)).resolves.toEqual(next);
    expect(unavailable.write).not.toHaveBeenCalled();

    // A shared copy that never answers is given four seconds.
    jest.useFakeTimers();
    try {
      const hanging = { read: jest.fn(() => new Promise<never>(() => undefined)), write: jest.fn(async () => undefined) };
      const load = loadDAVEReportSnapshot('tower', 'project_manager', device, hanging);
      await jest.advanceTimersByTimeAsync(4000);
      await expect(load).resolves.toEqual(next);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a period saved on this device before Q16 is carried up on first use; a later shared send is kept', async () => {
    const cloud = memoryCloud();
    const phone = memoryStorage();
    // Saved before Q17: one period for every format, under the shared key.
    const { reportFormat: _format, ...legacy } = sent(snap('f0', 0, '2026-09-21T09:00:00.000Z'), '2026-09-21T10:00:00.000Z');
    phone.values.set(SHARED_KEY, JSON.stringify(legacy));
    const loaded = await loadDAVEReportSnapshot('tower', 'executive', phone, cloud);
    expect(loaded).toEqual({ ...legacy, reportFormat: 'executive' });
    await flush();
    // Uploaded as that format's row, for the account the read was made for.
    expect(cloud.write).toHaveBeenCalledWith({ ...legacy, reportFormat: 'executive' }, 'owner-1');
    expect(cloud.rows.get('tower|executive')?.sourceFingerprint).toBe('f0');
    // The shared key on the device is never rewritten.
    expect(phone.setItem).not.toHaveBeenCalled();

    // The shared row is older than this device's send: this device's wins and replaces it.
    const ipadOlder = sent(approved(snap('fi', 0, '2026-09-15T09:00:00.000Z'), null), '2026-09-15T10:00:00.000Z');
    cloud.rows.set('tower|project_manager', ipadOlder);
    const own = sent(approved(snap('f1', 1, '2026-09-25T09:00:00.000Z'), null), '2026-09-25T10:00:00.000Z');
    phone.values.set(keyFor('project_manager'), JSON.stringify(own));
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', phone, cloud)).resolves.toEqual(own);
    await flush();
    expect(cloud.rows.get('tower|project_manager')?.sourceFingerprint).toBe('f1');

    // The shared row is later: it wins, and this device's older one is not uploaded over it.
    const ipadLater = sent(approved(snap('f2', 2, '2026-09-29T09:00:00.000Z'), own), '2026-09-29T10:00:00.000Z');
    cloud.rows.set('tower|project_manager', ipadLater);
    cloud.write.mockClear();
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', phone, cloud)).resolves.toEqual(ipadLater);
    await flush();
    expect(cloud.write).not.toHaveBeenCalled();
  });

  it('a shared row of another format, projects or version is ignored', async () => {
    const cloud = memoryCloud();
    const device = memoryStorage();
    cloud.rows.set('tower|project_manager', { ...snap('f0', 0, '2026-09-28T09:00:00.000Z', 'executive'), deliveredAt: '2026-09-28T10:00:00.000Z' });
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', device, cloud)).resolves.toBeNull();
    cloud.rows.set('tower|project_manager', { ...snap('f0', 0, '2026-09-28T09:00:00.000Z'), version: 'other' } as never);
    await expect(loadDAVEReportSnapshot('tower', 'project_manager', device, cloud)).resolves.toBeNull();
  });
});

// The whole Reports screen renders; a loaded machine needs more than the defaults.
jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
const task = (id: string, taskName: string, complete: boolean) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: complete ? 100 : 40, priority: 'Medium', status: complete ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
/** The Tower plan with the first `completed` of Frame walls, Pour slab, Set roof complete. */
const tower = (completed: number) => [
  task('frame', 'Frame walls', completed >= 1),
  task('pour', 'Pour slab', completed >= 2),
  task('roof', 'Set roof', completed >= 3),
];

const onCopyReport = jest.fn(async () => 'completed' as const);
const reportsScreen = (format: DAVEReportFormat, scheduleItems: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat={format}
    onReportFormatChange={() => undefined}
    updates={[]}
    scheduleItems={scheduleItems}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport}
    onEmailReport={async () => 'completed'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

let current: ReturnType<typeof render> | null = null;
/** Opens the Reports tab afresh on `device` (a new app session there: nothing remembered in memory). */
const visit = (device: string, scheduleItems: ScheduleItem[], format: DAVEReportFormat = 'project_manager') => {
  current?.unmount();
  forgetAllReportSessionState();
  onDevice(device);
  current = render(reportsScreen(format, scheduleItems));
  return current;
};
afterEach(() => {
  current?.unmount();
  current = null;
});

const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const approve = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
};
const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approveAndSend = async () => {
  await approve();
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  // The delivered mark saves (and uploads) after the send resolves.
  await settle();
  await settle();
};
/** The written report's period, once the period has loaded. */
const period = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  const body = await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW);
  return body.props.children as string;
};
const cloudRow = (format: DAVEReportFormat = 'project_manager') =>
  mockCloud.get(`tower|${format}`) as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;
const local = (device: string, key: string) => {
  const raw = mockDevices.get(device)?.get(key);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};

beforeEach(() => {
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

describe('the phone and the iPad share "since the last report" on the Reports screen (owner answer Q16)', () => {
  it('a send on the iPad, then a report on the phone, counts from the iPad\'s send; the other format keeps its own', async () => {
    visit('phone', tower(0));
    await approveAndSend();

    // The iPad has never sent a report: it counts from the phone's send.
    visit('ipad', tower(1));
    const onIpad = await period();
    expect(onIpad).toContain('+1 completed; ');
    expect(onIpad).toContain('Frame walls was completed.');
    await approveAndSend();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('ipad', keyFor('project_manager'))?.deliveredAt), SLOW);

    // The phone counts from the iPad's send (one done since), not its own last send (two done since).
    visit('phone', tower(2));
    const onPhone = await period();
    expect(onPhone).toContain('+1 completed; ');
    expect(onPhone).toContain('Pour slab was completed.');
    expect(onPhone).not.toContain('Frame walls was completed.');

    // Owner answer Q17 still holds: the Executive Summary has no report yet on either device.
    visit('phone', tower(2), 'executive');
    expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    // Each device's own copy stays under the prefix the per-account storage list covers.
    for (const device of ['phone', 'ipad']) {
      expect(Array.from(mockDevices.get(device)?.keys() ?? [])).toEqual([keyFor('project_manager')]);
    }
    expect(keyFor('project_manager').startsWith(PREFIX)).toBe(true);
  });

  it('an approval on the iPad that was never sent does not move the phone\'s period', async () => {
    visit('phone', tower(0));
    await approveAndSend();
    visit('ipad', tower(1));
    await approve();
    await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
    // The shared row still starts from the phone's send.
    expect(cloudRow()?.deliveredAt).toBe(local('phone', keyFor('project_manager'))?.deliveredAt);

    visit('phone', tower(1));
    const onPhone = await period();
    expect(onPhone).toContain('+1 completed; ');
    expect(onPhone).toContain('Frame walls was completed.');

    // A device with no period of its own reads the pending approval's start, not the approval.
    visit('laptop', tower(1));
    expect(await period()).toContain('+1 completed; ');
  });

  it('offline, each device counts from its own sends; the next open online shares them', async () => {
    mockCloudState = 'offline';
    visit('phone', tower(0));
    await approveAndSend();
    expect(cloudRow()).toBeUndefined();
    visit('phone', tower(1));
    expect(await period()).toContain('+1 completed; ');
    visit('ipad', tower(1));
    expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');

    // Back online: the phone's next open carries its send up, and the iPad counts from it.
    mockCloudState = 'ok';
    visit('phone', tower(1));
    await period();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone', keyFor('project_manager'))?.deliveredAt), SLOW);
    visit('ipad', tower(1));
    expect(await period()).toContain('+1 completed; ');
  });

  it('before the SQL is applied (no table) the app behaves as before, quietly', async () => {
    mockCloudState = 'missing_table';
    const errors = jest.spyOn(console, 'error');
    const warnings = jest.spyOn(console, 'warn');
    try {
      visit('phone', tower(0));
      await approveAndSend();
      visit('phone', tower(1));
      expect(await period()).toContain('+1 completed; ');
      expect(local('phone', keyFor('project_manager'))?.deliveredAt).not.toBeNull();
      expect(screen.queryByText(/could not be (saved|read)/)).toBeNull();
      visit('ipad', tower(1));
      expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');
      expect(mockCloud.size).toBe(0);
      // Tried on approval and on send, and quietly skipped; the open never uploads without the table.
      expect(jest.mocked(saveReportSnapshotCloud)).toHaveBeenCalledTimes(2);
      expect(errors).not.toHaveBeenCalled();
      // The reanimated test mock warns with empty text on every render; nothing else is logged.
      expect(warnings.mock.calls.filter(args => args.join(' ').trim())).toEqual([]);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it('a period on the phone from before the update carries over, and a later send on the iPad is kept', async () => {
    // Before this update the phone had sent a report; the cloud has nothing.
    visit('phone', tower(0));
    mockCloudState = 'offline';
    await approveAndSend();
    mockCloudState = 'ok';
    expect(cloudRow()).toBeUndefined();

    visit('phone', tower(1));
    await period();
    await waitFor(() => expect(cloudRow()?.snapshot.sourceFingerprint).toBe(local('phone', keyFor('project_manager'))?.sourceFingerprint), SLOW);

    // The iPad had an older send of its own: the phone's later one wins there.
    onDevice('ipad');
    const ipadOlder = sent(approved(snap('ipad-old', 0, '2026-09-01T09:00:00.000Z'), null), '2026-09-01T10:00:00.000Z');
    mockLocal().set(keyFor('project_manager'), JSON.stringify(ipadOlder));
    visit('ipad', tower(1));
    expect(await period()).toContain('+1 completed; ');
    expect(cloudRow()?.snapshot.sourceFingerprint).not.toBe('ipad-old');
    await approveAndSend();

    // The phone's own older send never replaces the iPad's later one.
    visit('phone', tower(1));
    await period();
    await settle();
    expect(cloudRow()?.snapshot.sourceFingerprint).toBe(local('ipad', keyFor('project_manager'))?.sourceFingerprint);
    expect(cloudRow()?.deliveredAt).toBe(local('ipad', keyFor('project_manager'))?.deliveredAt);
  });
});
