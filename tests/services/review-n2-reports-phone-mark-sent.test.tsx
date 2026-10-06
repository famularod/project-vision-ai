// Review N2 of reports (5 Oct 2026, Low, a limit of bf4b7a2): Mark as Sent
// was offered only on the device whose approval saved the report. Approved
// on the iPad and emailed (Mail said "Saved"), then approved on the phone
// (the same report: nothing new to save there) and emailed from the phone:
// the phone, the device he sent from, offered no Mark as Sent, and nothing
// said so. The device that approves the report already waiting in the shared
// period now keeps it too, as the web does (b1281f0), and offers Mark as Sent.
// A device that only reads the other device's approval is still not offered it.
// The Reports screen is real; the cloud is an in-memory report_snapshots
// table (the harness of everyday-1-report-mark-sent). Synthetic data.

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
import { markReportSnapshotDelivered, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { saveDAVEReportSnapshot } from '../../services/DAVEReportSnapshotRepository';
import { forgetAllReportSessionState, ownReportSendTimes } from '../../services/ReportSessionState';
import {
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;
const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';

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
const period = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  // Owner answer 2 Oct (report heading): the written report's heading is "SINCE THE LAST REPORT" (was "SINCE THE LAST APPROVED REPORT"); pin updated deliberately.
  return (await screen.findByText(/SINCE THE LAST REPORT/, {}, SLOW)).props.children as string;
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
/** The iPad approves the report and emails it; Mail says "Saved" (a draft). */
const approvedAndEmailedOnTheIpad = async () => {
  visit('ipad', tower(0));
  await approve();
  await share('Email Report');
  await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
  expect(screen.getByRole('button', MARK_AS_SENT)).toBeTruthy();
};

describe('review N2 (Low): Mark as Sent is offered on the device he emailed from, when the other device approved the report first', () => {
  it('the reviewer\'s steps (seed 41): approved and emailed on the iPad, then on the phone: the phone offers Mark as Sent and records the send', async () => {
    setClock('2026-10-05T14:00:00.000Z');
    await approvedAndEmailedOnTheIpad();
    const approval = cloudRow()?.snapshot as DAVEReportSnapshot;

    // The phone opens Reports and reads the iPad's approval: reading alone offers nothing (everyday item 1).
    setClock('2026-10-05T14:10:00.000Z');
    visit('phone', tower(0));
    await approvable();
    await settle();
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
    expect(local('phone')).toBeNull();

    // He approves the same report on the phone and emails it from there; Mail says "Saved".
    onEmailReport.mockClear();
    await approve();
    await share('Email Report');
    expect(onEmailReport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', MARK_AS_SENT, SLOW)).toBeTruthy();
    expect(screen.getByText('Sent it another way?')).toBeTruthy();
    // The phone keeps the approval it gave: the same report, not yet sent.
    expect(local('phone')).toMatchObject({ deliveredAt: null, sourceFingerprint: approval.sourceFingerprint, capturedAt: approval.capturedAt });
    expect(cloudRow()?.deliveredAt ?? null).toBeNull();

    setClock('2026-10-05T14:20:00.000Z');
    await markSent('now');
    await waitFor(() => expect(local('phone')?.deliveredAt).toBe('2026-10-05T14:20:00.000Z'), SLOW);
    // Recorded as the phone's own send, for every device.
    expect(local('phone')?.sentBy).toBe(mockDevices.get('phone')?.get(SENDER_ID_KEY));
    expect(ownReportSendTimes().has('2026-10-05T14:20:00.000Z')).toBe(true);
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe('2026-10-05T14:20:00.000Z'), SLOW);
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
    expect(screen.getByText(/^Recorded as sent today at /)).toBeTruthy();

    // The iPad's next report counts from it, and its own Mark as Sent for that report is gone.
    visit('ipad', tower(1));
    const onIpad = await period();
    expect(onIpad).toContain('+1 completed; ');
    expect(onIpad).toContain('Frame walls was completed.');
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });

  it('it is still offered on the phone in a later app session', async () => {
    await approvedAndEmailedOnTheIpad();
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await screen.findByRole('button', MARK_AS_SENT, SLOW);
    // The next morning, a new app session on the phone.
    visit('phone', tower(0));
    await approvable();
    expect(await screen.findByRole('button', MARK_AS_SENT, SLOW)).toBeTruthy();
  });

  it('marked on the iPad first: the phone does not record the same report a second time, and says the other device already sent it', async () => {
    setClock('2026-10-05T14:00:00.000Z');
    await approvedAndEmailedOnTheIpad();
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await screen.findByRole('button', MARK_AS_SENT, SLOW);
    // Meanwhile he marks it sent on the iPad (its record reaches the shared period).
    mockDevice = 'ipad';
    await saveDAVEReportSnapshot(markReportSnapshotDelivered(local('ipad') as DAVEReportSnapshot, '2026-10-05T14:05:00.000Z', 'ipad-install'));
    await settle();
    expect(cloudRow()?.deliveredAt).toBe('2026-10-05T14:05:00.000Z');

    mockDevice = 'phone';
    setClock('2026-10-05T14:30:00.000Z');
    await markSent('now');
    expect(await screen.findByText(/^Your other device already sent this report at .*\. Approve it only if you want to send it a second time\.$/, {}, SLOW)).toBeTruthy();
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
    expect(local('phone')?.deliveredAt).toBeNull();
    expect(cloudRow()?.deliveredAt).toBe('2026-10-05T14:05:00.000Z');
    expect(cloudRow()?.snapshot.sentBy).toBe('ipad-install');
  });

  it('Copy Report from the phone records one send, as before, and leaves nothing waiting', async () => {
    await approvedAndEmailedOnTheIpad();
    visit('phone', tower(0));
    await approve();
    await share('Copy Report');
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    await settle();
    await settle();
    const sentAt = local('phone')?.deliveredAt as string;
    expect(local('phone')?.sentBy).toBe(mockDevices.get('phone')?.get(SENDER_ID_KEY));
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(sentAt), SLOW);
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
    expect(onCopyReport).toHaveBeenCalledTimes(1);
  });

  it('Copy Report pressed before the phone has finished keeping the approval: the send is still what this phone ends up with', async () => {
    await approvedAndEmailedOnTheIpad();
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
    finishWrite();
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    await settle();
    await settle();
    // Not the approval written over the send.
    expect(local('phone')?.deliveredAt).toEqual(expect.any(String));
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });

  it('without the shared table each device keeps its own approval, as before', async () => {
    mockCloudState = 'missing_table';
    visit('ipad', tower(0));
    await approve();
    await share('Email Report');
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    expect(await screen.findByRole('button', MARK_AS_SENT, SLOW)).toBeTruthy();
    expect(local('phone')?.deliveredAt).toBeNull();
    expect(mockCloud.size).toBe(0);
  });
});
