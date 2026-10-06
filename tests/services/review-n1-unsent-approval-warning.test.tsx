// Review N1 L5 (3 Oct 2026, a limit of everyday item 1). Only the newest
// approval can be marked sent, so approving the next report first lost the
// earlier one's send: Monday's report went out from a saved Mail draft; on
// Tuesday he approved the next report before marking Monday's, and Monday's
// could no longer be recorded (its time was refused, and "just now"
// recorded Tuesday's report, never sent). The safer of the two fixes: he is
// told before an approval replaces an approved report that is not recorded
// as sent, and can go back and mark it first. The harness is everyday-1's.

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
import { Alert, type AlertButton } from 'react-native';
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { approvalReplacesUnsentApproval, unsentApprovalWarning } from '../../services/ReportManualSend';
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



describe('review N1 L5: before an approval replaces an approved report that is not recorded as sent, he is told', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
  afterEach(() => { alert.mockRestore(); });
  const question = () => alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];

  /** Monday: approved and put in a Mail draft ("Saved"); he sends the draft from Mail later. Tuesday: Frame walls is complete. */
  async function mondayDraftThenTuesday() {
    setClock('2026-10-01T14:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    const monday = local('phone') as DAVEReportSnapshot;
    expect(monday.deliveredAt).toBeNull();
    setClock('2026-10-02T09:00:00.000Z');
    visit('phone', tower(1));
    await approvable();
    await screen.findByText(/This approved report \(project facts as of Oct 1 at /, {}, SLOW);
    return monday;
  }

  it('Approve on Tuesday asks first; Go Back leaves the approval of Monday, its send is marked, and Tuesday counts from it', async () => {
    const monday = await mondayDraftThenTuesday();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await settle();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = question();
    expect(title).toBe('An approved report is not recorded as sent');
    expect(message).toMatch(/^The report you approved with the project facts as of Oct 1 at .* isn't recorded as sent\. If you sent it, go back and use Mark as Sent first\. Once you approve this report, that one can no longer be recorded as sent, and the next report will repeat what it covered\.$/);
    expect(buttons.map(button => button.text)).toEqual(['Go Back', 'Approve Anyway']);
    // Nothing is approved or replaced until he answers; Go Back only closes the question.
    expect(buttons[0].onPress).toBeUndefined();
    expect(local('phone')?.sourceFingerprint).toBe(monday.sourceFingerprint);
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();

    // He marks Monday's report sent at 4:30 PM on Monday: recorded, as its own facts.
    await markSent(new Date('2026-10-01T16:30:00.000Z'));
    await waitFor(() => expect(local('phone')?.deliveredAt).toBe('2026-10-01T16:30:00.000Z'), SLOW);
    expect(local('phone')?.sourceFingerprint).toBe(monday.sourceFingerprint);

    // Tuesday's report now counts from Monday's, and is approved with no question.
    expect(await period()).toContain('Frame walls was completed.');
    alert.mockClear();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(local('phone')?.deliveredAt).toBeNull(), SLOW);
    expect(local('phone')?.supersedes?.deliveredAt).toBe('2026-10-01T16:30:00.000Z');
  });

  it('Approve Anyway approves the report on screen, as before', async () => {
    const monday = await mondayDraftThenTuesday();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await settle();
    const [, , buttons] = question();
    await act(async () => { buttons[1].onPress?.(); });
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    await waitFor(() => expect(local('phone')?.sourceFingerprint).not.toBe(monday.sourceFingerprint), SLOW);
    expect(local('phone')?.deliveredAt).toBeNull();
  });

  it('never asked when nothing would be lost: no unsent approval, or the same report approved again', async () => {
    setClock('2026-10-01T14:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    expect(alert).not.toHaveBeenCalled();
    const monday = local('phone') as DAVEReportSnapshot;
    // The same facts the next morning: approving again would replace nothing.
    setClock('2026-10-02T09:00:00.000Z');
    visit('phone', tower(0));
    await approve();
    expect(alert).not.toHaveBeenCalled();
    expect(local('phone')?.sourceFingerprint).toBe(monday.sourceFingerprint);
    expect(approvalReplacesUnsentApproval(monday, monday.sourceFingerprint)).toBe(false);
    expect(approvalReplacesUnsentApproval(null, 'any')).toBe(false);
    expect(unsentApprovalWarning({ capturedAt: '2026-10-01T14:00:00.000Z' }, new Date('2026-10-02T09:00:00.000Z'))).toContain('project facts as of Oct 1 at ');
  });
});
