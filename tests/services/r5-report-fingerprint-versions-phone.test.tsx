// R5 item 2. R4 (item 4a) gave the report's fingerprint a new version and kept every report made under the
// earlier one known for the same facts. Four places on the phone's Reports screen where a stored fingerprint meets
// today's had no test of their own (R4's notes): the "already sent" notice, the delivered mark waiting for an
// approval still being kept, the Mark-as-Sent state key, and the notice at a send another device overtook. Each
// is pinned here with a report made by the build before (its fingerprint the earlier version's) meeting the same
// facts today. The Reports screen is real; the cloud is an in-memory report_snapshots table (the harness of
// review-n2-reports-phone-mark-sent). Synthetic data.
//
// R10 (the coordinator's decision on review pass 3, P3-2) reversed all of it: NO EARLIER-VERSION NAME EVER STANDS. A
// report the build before approved, sent or saved is never taken for the report on screen, for the same facts too
// (the words this build writes for them are not always the ones that build sent). At each of the four places the
// report made by the build before is now another report, and each test says what the screen does then.

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
import { Alert } from 'react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { describeReportSendTime, earlierReportSourcesOf, isLegacyReportSource, isVersion2ReportSource, legacyReportSourcesOf, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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
/**
 * A fingerprint of the earlier version for the facts of `snapshot`. (It was the one the app itself offered as a name
 * of those facts. It offers none now (R10), so any stands in: the app no longer reads which. The real one, worked out
 * from the facts, is in r10-report-an-earlier-build-saved-is-offered-once.)
 */
const underTheEarlierVersion = (snapshot: DAVEReportSnapshot) => {
  expect(legacyReportSourcesOf(snapshot.sourceFingerprint)).toEqual([]);
  const earlier = 'dave-report-source/1.0:0badc0de';
  expect(isLegacyReportSource(earlier)).toBe(true);
  return earlier;
};
/** Approve pressed where an approval not recorded as sent would be replaced: he is asked, and answers "Approve Anyway". */
const approveAnyway = async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1), SLOW);
  const [title, , buttons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
  expect(title).toBe('An approved report is not recorded as sent');
  expect(buttons.map(button => button.text)).toEqual(['Go Back', 'Approve Anyway']);
  await act(async () => { buttons[1].onPress?.(); });
  alert.mockRestore();
  await screen.findByRole('button', { name: 'Share Report' }, SLOW);
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

describe('R5 item 2 (phone), reversed by R10: a report made under the earlier fingerprint version is another report, the same facts today or not', () => {
  // (This said: "the report on screen is the one the other device sent before the update, and the screen says so".)
  it('the "already sent" notice: the report the other device sent before the update is not taken for the one on screen; the notice is not shown and Approve is offered', async () => {
    const sent = await sentFromTheIpadBeforeTheUpdate();
    onCopyReport.mockClear();
    visit('phone', tower(0));
    await approvable();
    await settle();
    expect(screen.queryByText(ALREADY_SENT(sent.deliveredAt as string))).toBeNull();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
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

  // (This said: "it is not sent again, and is said already sent, not 'now covers what changed'".)
  it('at a send the other device, on the build before, overtook with the same facts: it is not sent, and is said to cover what changed since that send, not "already sent"', async () => {
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
    expect(screen.queryByText(ALREADY_SENT_NOT_AGAIN(sentAt))).toBeNull();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
    expect(screen.getByText(`Your other device sent a report ${describeReportSendTime(sentAt)}, so this report was not sent. It now covers what changed since then. Review it, then approve.`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
  });

  // (This said the phone keeps the approval the other device made before the update, and the send is recorded on it.)
  it('an approval the other device made before the update is another report\'s: this phone approves its own (nothing of this phone\'s is replaced, so nothing is asked); Copy pressed before the phone has finished keeping it: the send is what this phone ends up with', async () => {
    const approval = await approvedOnTheIpadBeforeTheUpdate();
    visit('phone', tower(0));
    await approvable();
    // The phone's storage is slow to take the approval it keeps.
    let finishWrite: () => void = () => undefined;
    mockSlowWrite = { key: KEY, until: new Promise<void>(resolve => { finishWrite = resolve; }) };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await screen.findByRole('button', { name: 'Share Report' }, SLOW);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    await share('Copy Report');
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    expect(mockSlowWrite).toBeNull();
    await act(async () => { finishWrite(); });
    await waitFor(() => expect(local('phone')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    await settle();
    await settle();
    // This phone's own approval, under today's fingerprint, recorded as sent; not an approval written over the send.
    expect(local('phone')?.sourceFingerprint).toMatch(/^dave-report-source\/3\.0:/);
    expect(local('phone')?.sourceFingerprint).not.toBe(approval.sourceFingerprint);
    expect(local('phone')).toMatchObject({ deliveredAt: expect.any(String) });
    await waitFor(() => expect(cloudRow()?.deliveredAt).toBe(local('phone')?.deliveredAt), SLOW);
    expect(screen.queryByRole('button', MARK_AS_SENT)).toBeNull();
  });

  // (This said approving the same report again replaces nothing, and Mark as Sent records the send on the earlier approval.)
  it('an approval this phone made before the update, the same facts today: Approve asks first; approved anyway it is this build\'s approval, Mark as Sent records it, and it stands on the period that send starts', async () => {
    setClock('2026-10-05T14:00:00.000Z');
    // Approved on this phone by the build before, emailed (Mail said "Saved"), never recorded as sent.
    visit('phone', tower(0));
    await approve();
    await share('Email Report');
    await waitFor(() => expect(local('phone')?.deliveredAt).toBeNull(), SLOW);
    const approval = { ...(local('phone') as DAVEReportSnapshot), sourceFingerprint: underTheEarlierVersion(local('phone') as DAVEReportSnapshot) };
    mockDevices.get('phone')?.set(KEY, JSON.stringify(approval));
    sharedMadeByTheBuildBefore();
    // The app is updated and opened again; he approves the report for the same facts (he is asked first) and records the send.
    setClock('2026-10-05T14:10:00.000Z');
    visit('phone', tower(0));
    await approvable();
    await approveAnyway();
    await settle();
    await waitFor(() => expect(local('phone')?.sourceFingerprint).toMatch(/^dave-report-source\/3\.0:/), SLOW);
    expect(local('phone')?.sourceFingerprint).not.toBe(approval.sourceFingerprint);
    expect(local('phone')).toMatchObject({ deliveredAt: null });
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

/**
 * HIGH item 1 (d) (the owner's instruction of 13 Oct 2026, the three high items). The fingerprint's version 3.0 came
 * with an update, and a report the other device approved or sent on Builds 231 or 232 carries a 2.0 fingerprint. For
 * the same facts today it IS the report on screen, exactly where 2.0 itself said so: the update offers nothing again
 * that the build before would not have offered. (1.0 is untouched: R10 above.)
 */
describe('HIGH item 1 (phone): a report made under 2.0 is today\'s report for the same facts, and only for them', () => {
  /** The iPad, on Build 232, sends the report: the shared period is its send, under the 2.0 fingerprint of the same facts. */
  const sentFromTheIpadUnderVersion2 = async () => {
    visit('ipad', tower(0));
    await approve();
    await share('Copy Report');
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    const row = cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string | null };
    // The 2.0 fingerprint the app works out beside today's for these very facts (the 2.0 code, unchanged).
    const version2 = earlierReportSourcesOf(row.snapshot.sourceFingerprint).find(isVersion2ReportSource) as string;
    expect(version2).toMatch(/^dave-report-source\/2\.0:[0-9a-f]{8}$/);
    const snapshot = { ...row.snapshot, sourceFingerprint: version2 };
    mockCloud.set('tower|project_manager', { snapshot, deliveredAt: row.deliveredAt });
    return snapshot;
  };

  it('the "already sent" notice: the report the iPad sent on the build before, the same facts today, is the report on screen, and the screen says so', async () => {
    const sent = await sentFromTheIpadUnderVersion2();
    onCopyReport.mockClear();
    visit('phone', tower(0));
    expect(await screen.findByText(ALREADY_SENT(sent.deliveredAt as string), {}, SLOW)).toBeTruthy();
  });

  it('guard: once a task changes it is another report, and the notice is not shown', async () => {
    await sentFromTheIpadUnderVersion2();
    visit('phone', tower(1));
    await approvable();
    await settle();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
  });
});

/**
 * HIGH item 1c (reports review pass 1, H1R-2): a task saved again with nothing changed, on another device, after the
 * period's last report: no line of "since the last report" prints for it, so the report on screen IS that report. The
 * phone works its fingerprint out against the report the period's last one counted from (the shared period), as every
 * device does.
 */
describe('HIGH item 1c (phone): a task saved again with nothing changed after a real period', () => {
  // Tasks a master brought in (so a task saved again does not refresh what its record is "as of": a task entered by
  // hand is dated by its saved time, and saving it again takes "Old project record ..." off SCHEDULE RISKS: a word).
  const imported = (items: ScheduleItem[]) => items.map(item => ({ ...item, importedAt: '2026-09-01T12:00:00.000Z' } as ScheduleItem));
  const resaved = (items: ScheduleItem[]) => items.map(item => (item.id === 'roof' ? { ...item, updatedAt: new Date(Date.now() + 120_000).toISOString() } as ScheduleItem : item));
  /** The iPad sends R1 (nothing completed), then R2 with Frame walls completed, counting from R1. */
  const twoReportsFromTheIpad = async () => {
    visit('ipad', imported(tower(0)));
    await approve();
    await share('Copy Report');
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    visit('ipad', imported(tower(1)));
    await approve();
    await share('Copy Report');
    await waitFor(() => expect(cloudRow()?.snapshot.supersedes?.deliveredAt).toEqual(expect.any(String)), SLOW);
    return cloudRow() as { snapshot: DAVEReportSnapshot; deliveredAt: string };
  };

  it('Set roof saved again on another device, nothing changed: the phone says the other device already sent this report', async () => {
    const r2 = await twoReportsFromTheIpad();
    visit('phone', resaved(imported(tower(1))));
    expect(await screen.findByText(ALREADY_SENT(r2.deliveredAt), {}, SLOW)).toBeTruthy();
  });

  it('guard: a task completed since: not the report sent, and the notice is not shown', async () => {
    await twoReportsFromTheIpad();
    visit('phone', imported(tower(2)));
    await approvable();
    await settle();
    expect(screen.queryByText(/already sent this report/)).toBeNull();
  });
});
