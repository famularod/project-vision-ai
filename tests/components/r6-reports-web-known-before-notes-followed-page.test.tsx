import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  forgetReportSourcesKnownAs,
  isLegacyReportSource,
  legacyReportSourcesOf,
  markReportSnapshotDelivered,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { forgetDAVEWebReportPeriodSession } from '../../services/DAVEWebReportPeriod';
import {
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  forgetDAVEWebReportTabMemory,
} from '../../services/DAVEWebReportSend';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// R6 item 1 (the coordinator's decisions on R5's finding and on review pass 1), on the web Reports page. Since
// schedule batch S5 a task's notes follow it to the row a newer master gives it, and the phone's first sync on that
// build brings them forward in the shared rows. The task's latest note is a fact of a report, so a report approved
// or saved on the web before then was a report "of other facts" afterwards: an approval waiting was replaced, the
// send was not recorded, a saved report read "Refresh required". The page now knows such a report by the 1.0
// fingerprint its facts had before the notes followed, and from the first recognition on only while those notes
// are as they were then. Each case of R5's page file is run here with a report made on the rows as a released build left them
// (the note on the old, hidden row; its fingerprint the 1.0 one) meeting the same rows with the note brought forward.
// The web shell is real; the cloud is an in-memory report_snapshots table. Synthetic data.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children) };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/reports',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() },
}));

const task = (id: string, taskName: string, percentComplete: number): DAVEWebScheduleItem => ({
  id, scheduleProjectName: 'Tower', projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '09/01/2026', finishDate: '06/30/2027', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, progressSource: 'project_manager', priority: 'Medium',
  status: percentComplete >= 100 ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', cloudUpdatedAt: '2026-09-10T12:00:00.000Z',
});
const noteOf = (id: string, message: string, createdAt: string) => ({ id, message, author: 'David', createdAt });
const CREW = noteOf('note-1', 'Crew short Tuesday.', '2026-09-20T10:00:00.000Z');
/** The notes on Pour slab's old row (hidden since a newer master moved the task), and whether they have followed it to its row. */
let oldRowNotes = [CREW];
let notesFollowed = true;
/** As the build before left the rows: the notes stayed on the old row. */
const asTheBuildBeforeLeftThem = <T,>(read: () => T): T => {
  notesFollowed = false;
  try { return read(); } finally { notesFollowed = true; }
};
const webSnapshot = (frame: number, pulledAt: string, pour = 40): DAVEWebReadOnlySnapshot => {
  const oldRow = { ...task('pour-old', 'Pour slab', 40), finishDate: '05/31/2027', activity: oldRowNotes } as DAVEWebScheduleItem;
  const shown = [
    task('frame', 'Frame walls', frame),
    { ...task('pour', 'Pour slab', pour), revisedFromTaskIds: ['pour-old'], ...(notesFollowed ? { activity: oldRowNotes } : {}) } as DAVEWebScheduleItem,
  ];
  return {
    projects: [{ id: 'project-tower', name: 'Tower' } as DAVEWebReadOnlySnapshot['projects'][number]],
    scheduleItems: shown,
    knownScheduleItems: [...shown, oldRow],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: pulledAt,
    tasksPulledAt: pulledAt,
  } as DAVEWebReadOnlySnapshot;
};
/** The report the phone sent at `sentAt`, with Frame walls at `frame`%. */
const phoneSent = (frame: number, sentAt: string) => markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({
  truths: buildDAVEWebReportTruths(webSnapshot(frame, '2026-09-29T15:00:00.000Z'), null),
  scopeKey: 'tower', sourceFingerprint: `phone-${frame}`, capturedAt: '2026-09-29T15:00:00.000Z', reportFormat: 'project_manager',
}), null) as DAVEReportSnapshot, sentAt, 'phone-install');

/** The cloud's report_snapshots table, with its keep-the-later-send trigger. */
let table: Map<string, { snapshot: unknown; deliveredAt: string | null }> | 'missing' = new Map();
const rowKey = (scopeKey: string, format: string) => `${scopeKey}|${format}`;
const sharedRow = () => (table === 'missing' ? undefined : table.get('tower|project_manager'));
const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: webSnapshot(100, '2026-10-01T12:00:00.000Z'),
  freshness: { status: 'connected', lastSuccessfulRefreshAt: null, lastAttemptAt: null, consecutiveFailures: 0 },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  loadReportPeriod: jest.fn(async (scopeKey: string, format: string) => {
    if (table === 'missing') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  }),
  saveReportPeriod: jest.fn(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (table === 'missing') return 'unavailable' as const;
    const existing = table.get(rowKey(row.scopeKey, row.format));
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
    table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved' as const;
  }),
  reportOwnerId: jest.fn(async () => 'owner-1'),
  saveReport: jest.fn(async () => '2026-10-01T12:30:00.000Z'),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(),
  loadDocumentProof: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));

let profile = new Map<string, string>();
beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock; open?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
  browserWindow.open = jest.fn();
});
beforeEach(() => {
  forgetReportSourcesKnownAs();
  oldRowNotes = [CREW];
  notesFollowed = true;
  table = new Map();
  profile = new Map();
  forgetDAVEWebReportPeriods('owner-1');
  forgetDAVEWebReportTabMemory();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => profile.get(key) ?? null,
    setItem: (key: string, value: string) => { profile.set(key, value); },
    removeItem: (key: string) => { profile.delete(key); },
    key: (index: number) => [...profile.keys()][index] ?? null,
    get length() { return profile.size; },
  };
  forgetDAVEWebOwnReportSends();
  forgetDAVEWebReportPeriodSession();
  mockAuth.refreshSnapshot.mockClear();
  mockAuth.loadReportPeriod.mockImplementation(async (scopeKey: string, format: string) => {
    if (table === 'missing') return 'unavailable' as const;
    return { ownerId: 'owner-1', snapshot: table.get(rowKey(scopeKey, format))?.snapshot ?? null };
  });
  mockAuth.saveReportPeriod.mockImplementation(async (row: { scopeKey: string; format: string; snapshot: unknown; deliveredAt: string | null }) => {
    if (table === 'missing') return 'unavailable' as const;
    const existing = table.get(rowKey(row.scopeKey, row.format));
    if (existing?.deliveredAt && (!row.deliveredAt || row.deliveredAt < existing.deliveredAt)) return 'saved' as const;
    table.set(rowKey(row.scopeKey, row.format), { snapshot: JSON.parse(JSON.stringify(row.snapshot)), deliveredAt: row.deliveredAt });
    return 'saved' as const;
  });
  mockAuth.saveReport.mockClear();
  mockAuth.saveReportPeriod.mockClear();
  mockAuth.snapshot = webSnapshot(100, '2026-10-01T12:00:00.000Z');
  (globalThis as { navigator?: unknown }).navigator = { clipboard: { writeText: jest.fn(async () => undefined) } };
  (globalThis as unknown as { window: { open: jest.Mock } }).window.open.mockClear();
});

const since = () => within(screen.getByLabelText('Since the last report'));
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); });
const copied = () => (globalThis as unknown as { navigator: { clipboard: { writeText: jest.Mock } } }).navigator.clipboard.writeText;
const PHONE_AT_10 = () => new Map([['tower|project_manager', { snapshot: phoneSent(40, '2026-10-01T10:00:00.000Z'), deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
type SavedReport = { id: string; projectName: string | null; report: Record<string, unknown> };
const savedReports = () => (mockAuth.saveReport as jest.Mock).mock.calls as unknown as Array<[SavedReport]>;
const lastSaved = () => savedReports()[savedReports().length - 1][0];

const sharedSnapshot = () => sharedRow()?.snapshot as DAVEReportSnapshot | undefined;
const QUESTION = 'Was the report sent?';
const NOT_RECORDED = /^This computer could not record that this report was sent/;
const setNavigator = (value: unknown) => { (globalThis as { navigator?: unknown }).navigator = value; };

/** This tab approves the report on its page (Pour slab at 50%), on the rows as the build before left them. */
async function approveHereAt50BeforeTheUpdate() {
  table = PHONE_AT_10();
  mockAuth.snapshot = asTheBuildBeforeLeftThem(() => webSnapshot(100, '2026-10-01T12:00:00.000Z', 50));
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return view;
}
/** Report history holding the report `saved` (as the page saved it). */
const historyOf = (saved: SavedReport) => [{
  id: saved.id, name: String(saved.report.title), originalFileName: 'report.md', uri: '', mimeType: 'text/markdown',
  category: 'Report', notes: 'Approved project report', isCurrent: true, importedAt: String(saved.report.generatedAt),
  projectId: null, projectName: saved.projectName, importBatchId: null, webVersionGroupId: 'report:portfolio',
  webReport: saved.report, cloudUpdatedAt: '2026-10-01T12:30:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
}] as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'];

/** The report as a released build saved it: its facts under the 1.0 fingerprint, the rest of its source as it is. */
const savedByTheReleasedBuild = (saved: SavedReport): SavedReport => {
  const [facts, ...rest] = String(saved.report.sourceFingerprint).split(':media-');
  const [earlier] = legacyReportSourcesOf(facts);
  expect(isLegacyReportSource(earlier)).toBe(true);
  return { ...saved, report: { ...saved.report, sourceFingerprint: [earlier, ...rest].join(':media-') } };
};
const NOT_YET_WITH_MARK = 'Nothing was recorded. Once you send it, use Mark as Sent.';
const PROMISE_WITH_MARK = 'If you sent it, the next report on every device runs from this one. If not, nothing is recorded: once you send it, use Mark as Sent.';
const RECORDED = /^Recorded as sent .*\. The next report on every device runs from this one\.$/;
const SENT_FROM_HERE = /^This report was sent from this computer .*\. Sharing it again is not counted as another send\.$/;
const SHARED_AGAIN = /^Shared again\. This report was already recorded as sent .*, so this is not counted as another send\.$/;
const AT_50 = () => webSnapshot(100, '2026-10-01T12:00:00.000Z', 50);
/**
 * The approval waiting in the shared record for the report now on the page (Pour slab 50%), as the build before
 * made it from another browser: on the rows as that build left them, counting from the phone's 10:00 report.
 */
function approvalMadeBeforeTheUpdateWaits(page: () => DAVEWebReadOnlySnapshot = AT_50) {
  const truths = asTheBuildBeforeLeftThem(() => buildDAVEWebReportTruths(page(), null));
  const before = buildDAVELegacyReportSourceFingerprint(truths);
  expect(isLegacyReportSource(before)).toBe(true);
  // The same rows with the note brought forward are other facts, by the 1.0 fingerprint too.
  expect(before).not.toBe(buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(page(), null)));
  const approval = reportSnapshotToSave(buildDAVEReportSnapshot({
    truths, scopeKey: 'tower', sourceFingerprint: before, capturedAt: '2026-10-01T11:00:00.000Z', reportFormat: 'project_manager',
  }), phoneSent(40, '2026-10-01T10:00:00.000Z')) as DAVEReportSnapshot;
  expect(approval.deliveredAt).toBeNull();
  table = new Map([['tower|project_manager', { snapshot: approval, deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
  mockAuth.snapshot = page();
  return approval;
}
/** He opens Reports after the phone's first sync on the new build and approves the report on the page: the same rows, the note brought forward. */
async function approveTheSameReportHere() {
  const view = render(<DesktopReadOnlyShell page="reports" />);
  await waitFor(() => expect(since().getByText('Tower: Frame walls was completed.')).toBeTruthy());
  fireEvent.press(screen.getByText('Review & Prepare Report'));
  fireEvent.press(screen.getByText('Approve Report'));
  await screen.findByText('Share Approved Report');
  await settle();
  return view;
}

describe('R6 item 1 (web page): a report made before a task\'s notes followed it, the same rows with the notes brought forward', () => {
  it('the approval stands on the period its own send starts: shared, it is recorded, stays the approved report, and a second share is not another send', async () => {
    const approval = approvalMadeBeforeTheUpdateWaits();
    await approveTheSameReportHere();
    // Nothing replaced the approval: it is still the one made before the update. (It was replaced by a new one.)
    expect(sharedSnapshot()).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: null });
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED);
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(sharedSnapshot()).toMatchObject({ sourceFingerprint: approval.sourceFingerprint, deliveredAt: expect.any(String) });
    // Still the approved report on the page, known as sent from here.
    expect(screen.getByText(SENT_FROM_HERE)).toBeTruthy();
    expect(screen.getByText('Share Approved Report')).toBeTruthy();
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(SHARED_AGAIN)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(2);
  });

  it('after that send he corrects a word in the report and approves it again: it stands on the period its send started, and is not refused as "facts changed"', async () => {
    approvalMadeBeforeTheUpdateWaits();
    await approveTheSameReportHere();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(RECORDED);
    await settle();
    fireEvent.press(screen.getByText('Edit Report'));
    fireEvent.changeText(screen.getByLabelText('Report body'), `${String(screen.getByLabelText('Report body').props.value)}\nSee you Thursday.`);
    fireEvent.press(screen.getByText('Approve Report'));
    // (Left on the period it was approved on, it read "Project facts changed after this report was prepared ...".)
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText(/^Project facts changed after this report was prepared/)).toBeNull();
    // Still that report, already sent: sharing it is not another send.
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(SHARED_AGAIN)).toBeTruthy();
    await settle();
  });

  it('"Was the report sent?" for that report promises Mark as Sent, and "Not yet" says to use it: its approval is the one waiting here', async () => {
    approvalMadeBeforeTheUpdateWaits();
    setNavigator({ share: jest.fn(async () => undefined) });
    await approveTheSameReportHere();
    fireEvent.press(screen.getByText('Share Approved Report'));
    await screen.findByText(QUESTION);
    await settle();
    expect(screen.getByText(PROMISE_WITH_MARK)).toBeTruthy();
    fireEvent.press(screen.getByText('Not yet'));
    await settle();
    expect(screen.getByText(NOT_YET_WITH_MARK)).toBeTruthy();
    expect(screen.getByLabelText('Mark as Sent')).toBeTruthy();
  });

  it('an approved report saved before the update, with no approval of it on record: opened from Report history it is still current, and shared, this computer takes it as its approval and records the send', async () => {
    // Approved on this computer before the update (the page saves the report with its source).
    const first = await approveHereAt50BeforeTheUpdate();
    const saved = savedByTheReleasedBuild(lastSaved());
    first.unmount();
    // This browser's site data was cleared since, so no approval of it is kept here or in the shared record (the
    // phone's 10:00 report is). And the phone's first sync on the new build has brought the note forward.
    forgetDAVEWebReportPeriods('owner-1');
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebOwnReportSends();
    forgetDAVEWebReportPeriodSession();
    profile.clear();
    table = PHONE_AT_10();
    copied().mockClear();
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T12:00:00.000Z', 50), referenceDocuments: historyOf(saved) };
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    // (It read "Refresh required": "Project facts changed after this draft was prepared ...".)
    expect(screen.queryByText('Refresh required')).toBeNull();
    fireEvent.press(screen.getByText('Share Approved Report'));
    expect(await screen.findByText(RECORDED)).toBeTruthy();
    await settle();
    expect(copied()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NOT_RECORDED)).toBeNull();
    expect(sharedSnapshot()).toMatchObject({ deliveredAt: expect.any(String), supersedes: { deliveredAt: '2026-10-01T10:00:00.000Z' } });
  });

  it('guard: once this browser has recognised that saved report, a note that reaches the old row and is brought forward makes it need a refresh, whatever its clock says', async () => {
    const first = await approveHereAt50BeforeTheUpdate();
    const saved = savedByTheReleasedBuild(lastSaved());
    first.unmount();
    table = PHONE_AT_10();
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-01T12:00:00.000Z', 50), referenceDocuments: historyOf(saved) };
    const recognised = render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await screen.findByText('Share Approved Report');
    await settle();
    expect(screen.queryByText('Refresh required')).toBeNull();
    recognised.unmount();
    // The page is opened again another day; a note typed on another device (its clock says before the report was
    // saved) has reached the old row and followed the task.
    forgetDAVEWebReportTabMemory();
    forgetDAVEWebReportPeriodSession();
    forgetReportSourcesKnownAs();
    oldRowNotes = [CREW, noteOf('note-2', 'Second pass started.', '2026-10-01T09:00:00.000Z')];
    mockAuth.snapshot = { ...webSnapshot(100, '2026-10-02T13:00:00.000Z', 50), referenceDocuments: historyOf(saved) };
    render(<DesktopReadOnlyShell page="reports" />);
    await settle();
    fireEvent.press(screen.getByText('Open'));
    await settle();
    expect(await screen.findByText('Refresh required')).toBeTruthy();
  });

  it('guard: an approval made on this build (its fingerprint today\'s version) is never known through the name of before: with the note brought forward it is replaced, as any approval of other facts is', async () => {
    // Made here on this build before the phone's first sync, on the rows as the build before left them.
    const truths = asTheBuildBeforeLeftThem(() => buildDAVEWebReportTruths(AT_50(), null));
    const approval = reportSnapshotToSave(buildDAVEReportSnapshot({
      truths, scopeKey: 'tower', sourceFingerprint: buildDAVEReportSourceFingerprint(truths), capturedAt: '2026-10-01T11:00:00.000Z', reportFormat: 'project_manager',
    }), phoneSent(40, '2026-10-01T10:00:00.000Z')) as DAVEReportSnapshot;
    table = new Map([['tower|project_manager', { snapshot: approval, deliveredAt: '2026-10-01T10:00:00.000Z' as string | null }]]);
    mockAuth.snapshot = AT_50();
    await approveTheSameReportHere();
    expect(sharedSnapshot()?.sourceFingerprint).not.toBe(approval.sourceFingerprint);
  });
});
