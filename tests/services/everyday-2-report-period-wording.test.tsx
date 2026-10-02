// Everyday item 2 (2 Oct 2026): the Reporting Period said "Since the report
// approved <date>", with the day that report's facts were captured, where
// the period runs from when it was sent. It names the send now. The written
// report's own heading ("SINCE THE LAST APPROVED REPORT") is report text
// David's client reads and is left as it was (see the report for the owner
// decision); this test pins that it did not move.

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
jest.mock('../../services/SupabaseService', () => ({
  // Before the report_snapshots table: this device's own period.
  loadReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
  saveReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
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
  compareDAVEReportSnapshots,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import type { ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;
const day = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

describe('the period label names when the report was sent (everyday item 2)', () => {
  const truth = (completed: number) => ({
    projectName: 'Tower',
    schedule: ['a', 'b'].map((id, index) => ({
      taskId: id, taskName: `Task ${id}`, areaName: 'L2', owner: '',
      status: index < completed ? 'Complete' : 'In Progress', percentComplete: index < completed ? 100 : 40,
      finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
    })),
  }) as never;
  const snap = (completed: number, capturedAt: string) => buildDAVEReportSnapshot({
    truths: [truth(completed)], scopeKey: 'tower', sourceFingerprint: `f${completed}`, capturedAt, reportFormat: 'project_manager',
  });

  it('a sent report: its send day, not the day its facts were captured', () => {
    // Approved on Sep 28 (facts captured then), sent on Oct 1.
    const sent = markReportSnapshotDelivered(
      reportSnapshotToSave(snap(0, '2026-09-28T15:00:00.000Z'), null) as DAVEReportSnapshot,
      '2026-10-01T15:00:00.000Z',
      'phone',
    );
    const period = compareDAVEReportSnapshots({ current: snap(1, '2026-10-02T15:00:00.000Z'), previous: sent });
    expect(period.label).toBe(`Since the report sent ${day('2026-10-01T15:00:00.000Z')}`);
    expect(period.label).not.toContain('approved');
    // What the period counts is unchanged: it still starts from the report's facts.
    expect(period.startedAt).toBe('2026-09-28T15:00:00.000Z');
    expect(period.completeDelta).toBe(1);
  });

  it('a report saved before sends were recorded counts as sent when captured; an approval never sent says so', () => {
    const legacy = snap(0, '2026-09-10T15:00:00.000Z');
    expect(compareDAVEReportSnapshots({ current: snap(1, '2026-10-02T15:00:00.000Z'), previous: legacy }).label)
      .toBe(`Since the report sent ${day('2026-09-10T15:00:00.000Z')}`);
    const neverSent = reportSnapshotToSave(snap(0, '2026-09-20T15:00:00.000Z'), null) as DAVEReportSnapshot;
    expect(compareDAVEReportSnapshots({ current: snap(1, '2026-10-02T15:00:00.000Z'), previous: neverSent }).label)
      .toBe(`Since the report approved ${day('2026-09-20T15:00:00.000Z')}`);
  });
});

describe('on the Reports screen (everyday item 2)', () => {
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
  const tower = (completed: number) => [task('frame', 'Frame walls', completed >= 1), task('pour', 'Pour slab', completed >= 2)];
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
      onCopyReport={async () => 'completed'}
      onEmailReport={async () => 'unknown'}
      onTextReport={async () => 'completed'}
      onDownloadWordReport={async () => 'unknown'}
      onOutlookReport={async () => 'unknown'}
    />
  );
  let current: ReturnType<typeof render> | null = null;
  const visit = (scheduleItems: ScheduleItem[]) => {
    current?.unmount();
    forgetAllReportSessionState();
    current = render(reportsScreen(scheduleItems));
  };
  const setClock = (iso: string) => jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
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
  const share = async (label: 'Copy Report' | 'Email Report') => {
    fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
    fireEvent.press(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
    await settle();
    await settle();
  };
  beforeEach(() => {
    mockDevices.clear();
    mockDevice = 'phone';
    mockAuthority = {
      state: 'ready',
      policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
      reportDraft: draft,
      runtime: { response: { reportDraft: draft } },
      executiveJudgmentRecord: null,
    };
  });
  afterEach(() => {
    current?.unmount();
    current = null;
    jest.useRealTimers();
  });

  it('a report copied on Sep 30 reads "Since the report sent Sep 30, 2026" the next day; the written heading is unchanged', async () => {
    setClock('2026-09-30T15:00:00.000Z');
    visit(tower(0));
    await approve();
    await share('Copy Report');
    setClock('2026-10-01T15:00:00.000Z');
    visit(tower(1));
    expect(await screen.findByText(`Since the report sent ${day('2026-09-30T15:00:00.000Z')}`, {}, SLOW)).toBeTruthy();
    expect(screen.queryByText(/^Since the report approved/)).toBeNull();
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
    const body = (await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW)).props.children as string;
    expect(body).toContain('+1 completed; ');
  });

  it('a report approved on Sep 28 and marked sent on Oct 1 reads "Since the report sent Oct 1, 2026"', async () => {
    setClock('2026-09-28T15:00:00.000Z');
    visit(tower(0));
    await approve();
    await share('Email Report');
    setClock('2026-10-01T15:00:00.000Z');
    fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    await settle();
    await settle();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark as Sent' })).toBeNull(), SLOW);
    setClock('2026-10-02T15:00:00.000Z');
    visit(tower(1));
    expect(await screen.findByText(`Since the report sent ${day('2026-10-01T15:00:00.000Z')}`, {}, SLOW)).toBeTruthy();
  });
});
