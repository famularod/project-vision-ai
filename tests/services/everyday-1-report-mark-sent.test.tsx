// Everyday item 1 (2 Oct 2026): after Mail "Saved" (a draft), Outlook "Not
// yet", or a Word file sent from a laptop, nothing recorded that the report
// went out, and the next report repeated what the client already had.
// Reports now offers "Mark as Sent" for the approval this device saved: the
// owner says when (just now, or a time he picks), and it is recorded exactly
// as a send from the app: this install's sender id, its own-send list, and
// the shared period (report_snapshots, or this device's own copy without the
// table). Never on its own, never for another device's approval, and not
// over a later send from the other device.

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
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  otherDeviceSendNotReceived,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  reportSnapshotSentHere,
  saveDAVEReportSnapshot,
} from '../../services/DAVEReportSnapshotRepository';
import {
  manualReportMarkTime,
  manualReportSendTime,
  manualReportSendWindow,
  reportApprovalAwaitingSend,
} from '../../services/ReportManualSend';
import { forgetAllReportSessionState, ownReportSendTimes } from '../../services/ReportSessionState';
import {
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
} from '../../services/ScheduleCloudPull';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;
const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';
const OWN_SENDS_KEY = '@vitruvius/report-snapshots/own-sends/v1';
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

describe('Mark as Sent on the Reports screen (everyday item 1)', () => {
  it('a Mail draft sent later is recorded with the time he gives, and the iPad\'s next report counts from it', async () => {
    setClock('2026-10-01T14:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    // Mail said "Saved": nothing was recorded, and nothing is until he says so.
    expect(local('phone')?.deliveredAt).toBeNull();
    expect(screen.getByText('Sent it another way?')).toBeTruthy();
    await settle();
    expect(local('phone')?.deliveredAt).toBeNull();

    // The next morning, in a new app session: he sent the draft at 4:30 PM yesterday.
    setClock('2026-10-02T09:00:00.000Z');
    visit('phone', tower(0));
    await approvable();
    await markSent(new Date('2026-10-01T16:30:40.000Z'));
    await waitFor(() => expect(local('phone')?.deliveredAt).toBe('2026-10-01T16:30:00.000Z'), SLOW);
    const marked = local('phone') as DAVEReportSnapshot;
    // Recorded as a send: this install's sender id, its own-send list, and the shared period.
    expect(marked.sentBy).toBe(mockDevices.get('phone')?.get(SENDER_ID_KEY));
    expect(marked.markedSentAt).toBe('2026-10-02T09:00:00.000Z');
    expect(JSON.parse(mockDevices.get('phone')?.get(OWN_SENDS_KEY) ?? '[]')).toEqual(['2026-10-01T16:30:00.000Z']);
    expect(ownReportSendTimes().has('2026-10-01T16:30:00.000Z')).toBe(true);
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe('2026-10-01T16:30:00.000Z'), SLOW);
    expect(screen.queryByRole('button', { name: 'Mark as Sent' })).toBeNull();
    expect(screen.getByText(/^Recorded as sent Oct 1 at /)).toBeTruthy();
    expect(onEmailReport).toHaveBeenCalledTimes(1);

    // After a relaunch the phone still knows it as its own send.
    await expect(reportSnapshotSentHere(marked)).resolves.toBe(true);

    // The iPad counts from it, as from a send made in the app.
    visit('ipad', tower(1));
    const onIpad = await period();
    expect(onIpad).toContain('+1 completed; ');
    expect(onIpad).toContain('Frame walls was completed.');
  });

  it('Outlook "Not yet", then "just now": recorded as a send at that moment, with nothing extra', async () => {
    visit('phone', tower(0));
    await approve();
    await share('Email from Outlook (work)');
    expect(local('phone')?.deliveredAt).toBeNull();
    const before = Date.now();
    await markSent('now');
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    const marked = local('phone') as DAVEReportSnapshot;
    expect(Date.parse(marked.deliveredAt as string)).toBeGreaterThanOrEqual(before);
    expect(marked.markedSentAt).toBeUndefined();
    // The approval still stands on the period its own send starts, as after a send from the app.
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
  });

  it('a time before the report\'s facts, or in the future, is refused and nothing is recorded', async () => {
    setClock('2026-10-01T14:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    setClock('2026-10-01T18:00:00.000Z');
    await markSent(new Date('2026-10-01T13:00:00.000Z'));
    expect(await screen.findByText(/^Choose today at .* or later: this report has the project facts as they were then\.$/, {}, SLOW)).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: 'Sent earlier' }));
    act(() => {
      screen.getByTestId('report-mark-sent-picker').props.onChange({ type: 'set' }, new Date('2026-10-01T19:00:00.000Z'));
    });
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    expect(await screen.findByText('Choose a time that has already passed.', {}, SLOW)).toBeTruthy();
    await settle();
    expect(local('phone')?.deliveredAt).toBeNull();
    expect(cloudRow()?.deliveredAt ?? null).toBeNull();
  });

  it('offered only on the device that approved it: another device reading the shared approval is not offered it', async () => {
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
    // The laptop has no period of its own and reads the phone's approval from the shared copy.
    visit('laptop', tower(0));
    await approvable();
    await settle();
    expect(screen.queryByRole('button', { name: 'Mark as Sent' })).toBeNull();
    expect(screen.queryByText('Sent it another way?')).toBeNull();
  });

  it('not recorded over a later send from the other device: the period counts from that one', async () => {
    setClock('2026-10-01T09:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await waitFor(() => expect(cloudRow()?.snapshot.deliveredAt).toBeNull(), SLOW);
    // While the phone shows its approval, the iPad sends a report at noon.
    setClock('2026-10-01T12:00:00.000Z');
    mockDevice = 'ipad';
    const ipadApproval = reportSnapshotToSave(buildDAVEReportSnapshot({
      truths: [], scopeKey: 'tower', sourceFingerprint: 'ipad-noon', capturedAt: '2026-10-01T11:59:00.000Z', reportFormat: 'project_manager',
    }), null) as DAVEReportSnapshot;
    await saveDAVEReportSnapshot(markReportSnapshotDelivered(ipadApproval, '2026-10-01T12:00:00.000Z', 'ipad-install'));
    await settle();
    expect(cloudRow()?.deliveredAt).toBe('2026-10-01T12:00:00.000Z');

    mockDevice = 'phone';
    setClock('2026-10-01T15:00:00.000Z');
    await markSent(new Date('2026-10-01T14:00:00.000Z'));
    expect(await screen.findByText(/^Your other device sent a report at .*, after this one was approved, so this one was not recorded as sent\./, {}, SLOW)).toBeTruthy();
    expect(local('phone')?.deliveredAt).toBeNull();
    expect(cloudRow()?.deliveredAt).toBe('2026-10-01T12:00:00.000Z');
    expect(cloudRow()?.snapshot.sourceFingerprint).toBe('ipad-noon');
  });

  it('without the shared table (or offline) it is recorded on this device, as a send is', async () => {
    mockCloudState = 'missing_table';
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await markSent('now');
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(mockCloud.size).toBe(0);
    visit('phone', tower(1));
    expect(await period()).toContain('+1 completed; ');

    mockCloudState = 'offline';
    await approve();
    await share('Email Report');
    await markSent('now');
    await waitFor(() => expect(local('phone')?.sourceFingerprint).not.toBe(undefined), SLOW);
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(screen.getByText(/^Recorded as sent today at /)).toBeTruthy();
  });
});

describe('the rules behind it (everyday item 1)', () => {
  const approvalAt = (capturedAt: string, previous: DAVEReportSnapshot | null) => reportSnapshotToSave(buildDAVEReportSnapshot({
    truths: [], scopeKey: 'tower', sourceFingerprint: `f-${capturedAt}`, capturedAt, reportFormat: 'project_manager',
  }), previous) as DAVEReportSnapshot;

  it('the window runs from the report\'s facts, after the send its period counts from, to now', () => {
    const lastSent = markReportSnapshotDelivered(approvalAt('2026-09-29T09:00:00.000Z', null), '2026-09-30T17:00:00.000Z', 'phone');
    const approval = approvalAt('2026-09-30T16:00:00.000Z', lastSent);
    const now = new Date('2026-10-01T09:00:00.000Z');
    // The facts were current before the last send: the window starts just after that send.
    expect(manualReportSendWindow(approval, now)).toEqual({ earliest: '2026-09-30T17:00:00.001Z', latest: '2026-10-01T09:00:00.000Z' });
    expect(manualReportSendTime(new Date('2026-09-30T17:00:30.000Z'), approval, now)).toEqual({ ok: true, sentAt: '2026-09-30T17:00:00.001Z' });
    expect(manualReportSendTime(new Date('2026-09-30T16:59:00.000Z'), approval, now).ok).toBe(false);
    expect(manualReportSendTime('now', approval, now)).toEqual({ ok: true, sentAt: '2026-10-01T09:00:00.000Z' });
    // A clock moved back before the approval: nothing can be recorded.
    expect(manualReportSendWindow(approval, new Date('2026-09-30T10:00:00.000Z'))).toBeNull();
    expect(manualReportSendTime('now', approval, new Date('2026-09-30T10:00:00.000Z')).ok).toBe(false);
    // Only an approval not yet sent waits to be marked.
    expect(reportApprovalAwaitingSend(approval)).toBe(approval);
    expect(reportApprovalAwaitingSend(lastSent)).toBeNull();
    expect(reportApprovalAwaitingSend(null)).toBeNull();
    expect(manualReportMarkTime('2026-10-01T09:00:00.000Z', now)).toBeNull();
    expect(manualReportMarkTime('2026-09-30T18:00:00.000Z', now)).toBe('2026-10-01T09:00:00.000Z');
  });

  it('the other device waits for a download made after he recorded it, not just after the time he named', () => {
    const approval = approvalAt('2026-10-01T14:00:00.000Z', null);
    const marked = markReportSnapshotDelivered(approval, '2026-10-01T16:30:00.000Z', 'phone', '2026-10-02T09:00:00.000Z');
    const behind = (pulledAt: string, send: DAVEReportSnapshot) => otherDeviceSendNotReceived({
      period: send, currentFingerprint: 'ipad-now', ownSends: new Set(), pulledAt,
    });
    // The iPad downloaded at 8 PM, after the send he named but before his record: it may not have the phone's changes.
    expect(behind('2026-10-01T20:00:00.000Z', marked)).toBe(marked);
    expect(behind('2026-10-02T09:05:00.000Z', marked)).toBeNull();
    // A send from the app is unchanged: a download after it counts.
    const appSend = markReportSnapshotDelivered(approval, '2026-10-01T16:30:00.000Z', 'phone');
    expect(appSend.markedSentAt).toBeUndefined();
    expect(behind('2026-10-01T20:00:00.000Z', appSend)).toBeNull();
    // A later send replaces the mark entirely.
    expect(markReportSnapshotDelivered(marked, '2026-10-03T10:00:00.000Z', 'ipad').markedSentAt).toBeUndefined();
  });
});
