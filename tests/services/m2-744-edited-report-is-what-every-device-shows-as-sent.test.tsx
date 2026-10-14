/**
 * Open item 7.44 (review pass 9, E9-1; the owner's authorisation of 13 Oct 2026): what was sent is what the app shows
 * as sent, on every device.
 *
 * Before: he edits the report on the phone (Edit Report: a line deleted, a sentence added), approves and sends it.
 * His edit lived in that app session only. The iPad then said "Your other device already sent this report ..."
 * above the report WITHOUT his edit, and the phone, closed and opened again, showed it without his edit too. The
 * client got his words; the copy the app showed as sent was not them.
 *
 * Now the words he approved and sent are kept with the report in the shared report record (report_snapshots: its
 * snapshot, an object the database keeps as it is; no database change), and every device shows a report of those
 * same facts with them. A change to the project makes a new report, written by the app as before. A report sent
 * another way and recorded later (Mark as Sent) keeps the words he approved. The Reports screen is real, on two
 * devices (one app storage each, one in-memory shared record with its keep-the-later-send rule, as the
 * audit-a6-p9 / p10 and b232 rigs stand them up). Made-up project. No network.
 */

const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockLocal().set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockLocal().delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
  };
  return { __esModule: true, default: api, ...api };
});

type MockCloudRow = { snapshot: unknown; deliveredAt: string | null };
const mockCloud = new Map<string, MockCloudRow>();
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, data });
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async (scopeKey: string, format: string) => (
    mockOk({ ownerId: 'owner-1', snapshot: mockCloud.get(`${scopeKey}|${format}`)?.snapshot ?? null })
  )),
  // The shared record keeps the later send (the table's own rule).
  saveReportSnapshotCloud: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
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
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import * as fs from 'fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import {
  buildDAVEReportSnapshot,
  describeReportSendTime,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(240_000);
const SLOW = { timeout: 40_000 } as const;
const OUT = process.env.M2_OUT_DIR || '';
const keep = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const setClock = (iso: string) => {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'],
  });
};
afterEach(() => jest.useRealTimers());

let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => { void recordScheduleCloudPull(new Date().toISOString()); });
});
afterEach(() => stopAppDownloads());

const task = (id: string, taskName: string, area: string, percent: number, finish: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const TASKS = [
  task('frame', 'Frame walls', 'Level 2', 100, '09/30/2026'),
  task('pour', 'Pour slab', 'Level 1', 40, '12/09/2026'),
  task('roof', 'Set roof', 'Roof', 0, '03/31/2027'),
];
const update = (id: string, at: string, notes: string) => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date: at, photos: [], recipients: { contactIds: [] }, notes,
  status: 'sent', scheduleItemId: 'pour', scheduleTaskName: 'Pour slab', selectedAreaName: 'Level 1',
}) as unknown as ProjectUpdate;
const UPDATES = [update('u1', '2026-10-01', 'Slab forms are set on the east bay.')];
const ONE_MORE = [update('u2', '2026-10-06', 'Rebar is tied on the east bay.'), ...UPDATES];

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};

const onCopyReport = jest.fn(async (_report: { title: string; body: string }) => 'completed' as const);
// Mail "Saved" (a draft): not a send.
const onEmailReport = jest.fn(async (_report: { title: string; body: string }) => 'unknown' as const);
const reportsScreen = (updates: ProjectUpdate[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={TASKS as never}
    knownScheduleItems={TASKS as never}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={onEmailReport as never}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

let current: ReturnType<typeof render> | null = null;
/** Opens Reports afresh on `device`: a new app session there (closed and opened again), its own storage kept. */
const visit = (device: string, updates: ProjectUpdate[] = UPDATES) => {
  current?.unmount();
  forgetAllReportSessionState();
  mockDevice = device;
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
  current = render(reportsScreen(updates));
  return current;
};
afterEach(() => { current?.unmount(); current = null; });
beforeEach(() => {
  mockDevices.clear();
  mockCloud.clear();
  mockDevice = 'phone';
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  onEmailReport.mockClear();
});

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const approvable = () => screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
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
const cloudRow = () => mockCloud.get('tower|project_manager') as { snapshot: DAVEReportSnapshot; deliveredAt: string | null } | undefined;
const lastCopied = () => onCopyReport.mock.calls.at(-1)?.[0] ?? null;
const ALREADY_SENT = (sentAt: string) => `Your other device already sent this report ${describeReportSendTime(sentAt)}. Approve it only if you want to send it a second time.`;
const HIS_SENTENCE = 'NOTE FROM THE OFFICE: the crane is booked for Friday.';
const HIS_TITLE = 'Tower update for the owner';

/** Edit Report: he deletes the line naming Frame walls, adds his sentence at the end, and retitles it. Returns the edited text. */
const edit = async (approvedAlready = false) => {
  if (!approvedAlready) await approvable();
  fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
  const body = await screen.findByPlaceholderText('Report body', {}, SLOW);
  const original = body.props.value as string;
  const deleted = original.split('\n').find(line => line.includes('Frame walls'));
  expect(deleted).toBeTruthy();
  const edited = `${original.split('\n').filter(line => line !== deleted).join('\n')}\n${HIS_SENTENCE}`;
  fireEvent.changeText(body, edited);
  fireEvent.changeText(screen.getByPlaceholderText('Report title'), HIS_TITLE);
  return { original, deleted: deleted as string, edited };
};
/** The report as the screen shows it under "Full written report". */
const shownReport = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  const found = await screen.findAllByText(/CURRENT WORK|NOTE FROM THE OFFICE/, {}, SLOW);
  // The whole written report is the longest text that holds a heading of it.
  const text = found.map(node => String(node.props.children)).sort((left, right) => right.length - left.length)[0];
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  return text;
};
/** He sends it again from this device (the screen says he may): what goes out. */
const sendAgain = async () => {
  onCopyReport.mockClear();
  await approve();
  await share('Copy Report');
  return lastCopied();
};

/** The phone edits, approves and copies at 10:00; returns what went out and when it was recorded. */
const phoneSendsHisEdit = async () => {
  setClock('2026-10-05T17:00:00.000Z');
  visit('phone');
  const { original, deleted, edited } = await edit();
  await approve();
  await share('Copy Report');
  await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
  const sent = lastCopied();
  expect(sent).toEqual(expect.objectContaining({ title: HIS_TITLE, body: edited }));
  return { original, deleted, edited, sentAt: cloudRow()?.deliveredAt as string };
};

describe('7.44: what was sent is what the app shows as sent, on every device', () => {
  it('the iPad says "already sent" above his words, and sends his words if he sends it again', async () => {
    const { original, deleted, edited, sentAt } = await phoneSendsHisEdit();
    keep('744-phone-sent.txt', edited);
    setClock('2026-10-05T17:30:00.000Z');
    current?.unmount();
    current = null;
    mockDevice = 'ipad';
    await act(async () => { await recordScheduleCloudPull(new Date().toISOString()); });
    visit('ipad');
    await screen.findByText(ALREADY_SENT(sentAt), {}, SLOW);
    const shown = await shownReport();
    keep('744-ipad-shown.txt', shown);
    expect(shown).toBe(edited);
    expect(shown).toContain(HIS_SENTENCE);
    expect(shown.split('\n')).not.toContain(deleted);
    expect(shown).not.toBe(original);
    expect(await sendAgain()).toEqual(expect.objectContaining({ title: HIS_TITLE, body: edited }));
    // A second send records nothing more.
    expect(cloudRow()?.deliveredAt).toBe(sentAt);
  });

  it('the phone, closed and opened again, shows the report with his words', async () => {
    const { edited } = await phoneSendsHisEdit();
    setClock('2026-10-05T18:00:00.000Z');
    visit('phone');
    const shown = await shownReport();
    keep('744-phone-after-restart.txt', shown);
    expect(shown).toBe(edited);
    expect(await sendAgain()).toEqual(expect.objectContaining({ title: HIS_TITLE, body: edited }));
  });

  it('a change to the project after the send: the app\'s own new report, without his words, and not "already sent"', async () => {
    const { sentAt } = await phoneSendsHisEdit();
    setClock('2026-10-06T15:00:00.000Z');
    current?.unmount();
    current = null;
    mockDevice = 'ipad';
    await act(async () => { await recordScheduleCloudPull(new Date().toISOString()); });
    visit('ipad', ONE_MORE);
    await approvable();
    expect(screen.queryByText(ALREADY_SENT(sentAt))).toBeNull();
    const shown = await shownReport();
    expect(shown).not.toContain(HIS_SENTENCE);
    expect(shown).toContain('Frame walls');
  });

  it('sent another way (Mail saved a draft), recorded after a restart with Mark as Sent: his words are kept', async () => {
    setClock('2026-10-05T17:00:00.000Z');
    visit('phone');
    const { edited } = await edit();
    await approve();
    await share('Email Report');
    expect(onEmailReport.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ title: HIS_TITLE, body: edited }));
    expect(cloudRow()?.deliveredAt ?? null).toBeNull();

    // The next morning, a new app session: he sent the Mail draft and says so.
    setClock('2026-10-06T09:00:00.000Z');
    visit('phone');
    await approvable();
    fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    await settle();
    await settle();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    const sentAt = cloudRow()?.deliveredAt as string;

    current?.unmount();
    current = null;
    mockDevice = 'ipad';
    await act(async () => { await recordScheduleCloudPull(new Date().toISOString()); });
    visit('ipad');
    await screen.findByText(ALREADY_SENT(sentAt), {}, SLOW);
    expect(await shownReport()).toBe(edited);
  });

  it('approved as written, then edited and approved again, sent by Mail and recorded later: his words are kept', async () => {
    setClock('2026-10-05T17:00:00.000Z');
    visit('phone');
    await approve();
    // He changes his mind before sending: Edit Report takes the approval back; he approves his edit.
    const { edited } = await edit(true);
    await approve();
    await share('Email Report');
    expect(onEmailReport.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ title: HIS_TITLE, body: edited }));

    setClock('2026-10-06T09:00:00.000Z');
    visit('phone');
    await approvable();
    fireEvent.press(await screen.findByRole('button', { name: 'Mark as Sent' }, SLOW));
    fireEvent.press(screen.getByRole('button', { name: 'Record as Sent' }));
    await settle();
    await settle();
    await waitFor(() => expect(cloudRow()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(await shownReport()).toBe(edited);
  });

  it('a send records only the words it carried; the report before keeps none', () => {
    const facts = buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'dave-report-source/3.0:aaa', reportFormat: 'project_manager' });
    const approved = reportSnapshotToSave({ ...facts, editedText: { title: 'T', body: 'His words' } } as DAVEReportSnapshot, null) as DAVEReportSnapshot;
    expect(approved.editedText).toEqual({ title: 'T', body: 'His words' });
    // Sent from the app with the app's own text (or by the computer, which writes its own): his earlier words are not claimed.
    expect(markReportSnapshotDelivered(approved, '2026-10-05T17:00:00.000Z', 'phone-1').editedText).toBeUndefined();
    const sent = markReportSnapshotDelivered(approved, '2026-10-05T17:00:00.000Z', 'phone-1', null, { title: 'T', body: 'His words' });
    expect(sent.editedText).toEqual({ title: 'T', body: 'His words' });
    // The next approval keeps the sent report as the one before, for its tasks only: without his words.
    const next = reportSnapshotToSave(
      buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'dave-report-source/3.0:bbb', reportFormat: 'project_manager' }),
      sent,
    ) as DAVEReportSnapshot;
    expect(next.supersedes?.sourceFingerprint).toBe('dave-report-source/3.0:aaa');
    expect(next.supersedes?.editedText).toBeUndefined();
  });
});
