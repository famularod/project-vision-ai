// R5 item 2. R4 (item 4a) gave the report's fingerprint a new version and kept every report made under the
// earlier one known for the same facts. Four places on the phone's Reports screen where a stored fingerprint meets
// today's had no test of their own (R4's notes): the "already sent" notice, the delivered mark waiting for an
// approval still being kept, the Mark-as-Sent state key, and the notice at a send another device overtook. Each
// is pinned here with a report made by the build before (its fingerprint the earlier version's) meeting the same
// facts today. The Reports screen is real; the cloud is an in-memory report_snapshots table (the harness of
// review-n2-reports-phone-mark-sent). Synthetic data.

const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
/** A write this device's storage has not finished yet: the next write of `key` waits for `until`. */
let mockSlowWrite: { key: string; until: Promise<void> } | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    const device = mockLocal();
    if (mockSlowWrite?.key === key) {
      const { until } = mockSlowWrite;
      mockSlowWrite = null;
      await until;
    }
    device.set(key, value);
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
  // The table's rule (report_snapshots_keep_later_period): a row whose period started from a later send is kept.
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
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props: Record<string, unknown>) => <View {...props} /> };
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { describeReportSendTime, isLegacyReportSource, legacyReportSourcesOf, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import {
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;
const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';

/** Only Date is faked: the screen's own timers stay real. */
const setClock = (iso: string) => {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
};
afterEach(() => jest.useRealTimers());

let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => {
    void recordScheduleCloudPull(new Date().toISOString());
  });
});
afterEach(() => stopAppDownloads());

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
const tower = (completed: number) => [
  task('frame', 'Frame walls', completed >= 1),
  task('pour', 'Pour slab', completed >= 2),
  task('roof', 'Set roof', completed >= 3),
];

const onCopyReport = jest.fn(async () => 'completed' as const);
// Mail "Saved" (a draft), and Outlook "Not yet": neither is a send.
const onEmailReport = jest.fn(async () => 'unknown' as const);
const onOutlookReport = jest.fn(async () => 'unknown' as const);
const reportsScreen = (scheduleItems: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={[]}
    scheduleItems={scheduleItems}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport}
    onEmailReport={onEmailReport}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={onOutlookReport}
  />
);

let current: ReturnType<typeof render> | null = null;
/** Opens Reports afresh on `device` (a new app session there). */
const visit = (device: string, scheduleItems: ScheduleItem[]) => {
  current?.unmount();
  forgetAllReportSessionState();
  mockDevice = device;
  current = render(reportsScreen(scheduleItems));
  return current;
};
afterEach(() => {
  current?.unmount();
  current = null;
});

beforeEach(() => {
  mockSlowWrite = null;
  mockDevices.clear();
  mockCloud.clear();
  mockCloudState = 'ok';
  mockDevice = 'phone';
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  onEmailReport.mockClear();
  onOutlookReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const approve = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
};
const share = async (label: 'Copy Report' | 'Email Report' | 'Email from Outlook (work)') => {
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
const local = (device: string, key = KEY) => {
  const raw = mockDevices.get(device)?.get(key);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;
const markSent = async (when: 'now' | Date) => {
  fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
  if (when !== 'now') {
    fireEvent.press(screen.getByRole('radio', { name: 'Sent earlier' }));
    act(() => {
      screen.getByTestId('report-mark-sent-picker').props.onChange({ type: 'set' }, when);
    });
  }
  fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
  await settle();
  await settle();
};

const MARK_AS_SENT = { name: 'Mark as Sent' } as const;
/** The fingerprint the build before gave the facts of `snapshot`. */
const underTheEarlierVersion = (snapshot: DAVEReportSnapshot) => {
  const [earlier] = legacyReportSourcesOf(snapshot.sourceFingerprint);
  expect(isLegacyReportSource(earlier)).toBe(true);
  return earlier;
};
/** The shared period's report, as the build before had saved it: the same report under the earlier fingerprint. */
const sharedMadeByTheBuildBefore = () => {
  const row = cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
  const snapshot = { ...row.snapshot, sourceFingerprint: underTheEarlierVersion(row.snapshot) };
  mockCloud.set('tower|project_manager', { snapshot, deliveredAt: row.deliveredAt });
  return snapshot;
};
/** The iPad, on the build before, approves the report and emails it; Mail says "Saved" (a draft). */
const approvedOnTheIpadBeforeTheUpdate = async () => {
  visit('ipad', tower(0));
  await approve();
  await share('Email Report');
  await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
  return sharedMadeByTheBuildBefore();
};
/** The iPad, on the build before, approves and sends the report. */
const sentFromTheIpadBeforeTheUpdate = async () => {
  visit('ipad', tower(0));
  await approve();
  await share('Copy Report');
  await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
  return sharedMadeByTheBuildBefore();
};
const ALREADY_SENT = (sentAt: string) => `Your other device already sent this report ${describeReportSendTime(sentAt)}. Approve it only if you want to send it a second time.`;
const ALREADY_SENT_NOT_AGAIN = (sentAt: string) => `Your other device already sent this report ${describeReportSendTime(sentAt)}, so it was not sent again. Approve it only if you want to send it a second time.`;

describe('R5 item 2 (phone): a report made under the earlier fingerprint version, the same facts today', () => {
  it('the "already sent" notice: the report on screen is the one the other device sent before the update, and the screen says so', async () => {
    const sent = await sentFromTheIpadBeforeTheUpdate();
    onCopyReport.mockClear();
    visit('phone', tower(0));
    expect(await screen.findByText(ALREADY_SENT(sent.deliveredAt as string), {}, SLOW)).toBeTruthy();
    // Not approved here, and nothing waits to be marked sent.
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });

  it('guard: once a task changes it is another report, and the notice is not shown', async () => {
    await sentFromTheIpadBeforeTheUpdate();
    visit('phone', tower(1));
    await approvable();
    await settle();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
  });

  it('at a send the other device overtook with the same report: it is not sent again, and is said already sent, not "now covers what changed"', async () => {
    visit('phone', tower(0));
    await approve();
    await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
    // Meanwhile the iPad, on the build before, sends the same report: the shared period is its send, under the earlier fingerprint.
    const approval = cloudRow()?.snapshot as DAVEReportSnapshot;
    const sentAt = new Date(Date.now() + 60_000).toISOString();
    mockCloud.set('tower|project_manager', {
      snapshot: { ...approval, sourceFingerprint: underTheEarlierVersion(approval), deliveredAt: sentAt, sentBy: 'ipad-install' }, deliveredAt: sentAt,
    });
    await share('Copy Report');
    expect(onCopyReport).not.toHaveBeenCalled();
    expect(screen.getByText(ALREADY_SENT_NOT_AGAIN(sentAt))).toBeTruthy();
    expect(screen.queryByText(/now covers what changed since then/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
  });

  it('Copy pressed before the phone has finished keeping an approval the other device made before the update: the send is what this phone ends up with', async () => {
    const approval = await approvedOnTheIpadBeforeTheUpdate();
    visit('phone', tower(0));
    await approvable();
    // The phone's storage is slow to take the approval it keeps.
    let finishWrite: () => void = () => undefined;
    mockSlowWrite = { key: KEY, until: new Promise<void>(resolve => { finishWrite = resolve; }) };
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    await share('Copy Report');
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    expect(mockSlowWrite).toBeNull();
    await act(async () => { finishWrite(); });
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    await settle();
    await settle();
    // The approval as the other device made it, recorded as sent; not that approval written over the send.
    expect(local('phone')).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: expect.any(String) });
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });

  it('Mark as Sent on an approval this phone made before the update, approved again today: recorded, and the approval stands on the period that send starts', async () => {
    setClock('2026-10-05T14:00:00.000Z');
    // Approved on this phone by the build before, emailed (Mail said "Saved"), never recorded as sent.
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await waitFor(() => expect(local('phone')?.deliveredAt).toBeNull(), SLOW);
    const approval = { ...(local('phone') as DAVEReportSnapshot), sourceFingerprint: underTheEarlierVersion(local('phone') as DAVEReportSnapshot) };
    mockDevices.get('phone')?.set(KEY, JSON.stringify(approval));
    sharedMadeByTheBuildBefore();
    // The app is updated and opened again; he approves the same report (nothing is replaced) and records the send.
    setClock('2026-10-05T14:10:00.000Z');
    visit('phone', tower(0));
    await approve();
    await settle();
    expect(local('phone')).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: null });
    setClock('2026-10-05T14:20:00.000Z');
    await markSent('now');
    await waitFor(() => expect(local('phone')?.deliveredAt).toBe('2026-10-05T14:20:00.000Z'), SLOW);
    expect(screen.getByText(/^Recorded as sent today at /)).toBeTruthy();
    // Still this report's approval: Share is offered, and Approve is not asked for again.
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve Report' })).toBeNull();
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });
});
