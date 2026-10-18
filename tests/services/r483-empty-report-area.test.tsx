/** 4.83: production Core / PIEReporter drafts rendered by the actual ReportsScreen.
 * Synthetic local records; storage and cloud transport are memory-only.
 * The preview filters empty cards; report data and the DAVE overview stay intact.
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

import { render, screen } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { recordScheduleCloudPull, registerScheduleCloudPullRequest } from '../../services/ScheduleCloudPull';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(240_000);
const SLOW = { timeout: 5_000 } as const;

let stopAppDownloads: () => void = () => undefined;
beforeEach(() => {
  stopAppDownloads = registerScheduleCloudPullRequest(() => { void recordScheduleCloudPull(new Date().toISOString()); });
});

/** The project's name, set by each test before its records are made. */
let NAME = 'Synthetic Project';
const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner = 'Dana') => ({
  id, projectName: NAME, scheduleProjectName: NAME, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem, at: string, notes: string, photos: unknown[]) => ({
  id, projectName: NAME, scheduleProjectName: NAME, date: at, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;
/** The app's own draft for these updates and tasks, as the provider makes it. */
const appDraft = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const core = buildPIECoreIntelligence({
    runtimeContext: {
      projectName: NAME, projectNames: [NAME], reportType: 'daily_project_update',
      updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    } as never,
    reportType: 'daily_project_update' as never, reportProjectNames: [NAME],
    organizationId: 'local-unverified-anonymous', projectId: 'project-x',
  } as never);
  return core.reportDraft;
};
const authority = (updates: ProjectUpdate[], items: ScheduleItem[]) => {
  const draft = appDraft(updates, items);
  return {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
};

const onCopyReport = jest.fn(async (_report: { body: string }) => 'completed' as const);
/** Email Report: Mail said "Saved" (nothing is recorded until he says it went: Mark as Sent). */
const onEmailReport = jest.fn(async () => 'unknown' as const);
const reportsScreen = (updates: ProjectUpdate[], items: ScheduleItem[]) => (
  <ReportsScreen
    projectName={NAME}
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={[NAME]}
    selectedProjectNames={[NAME]}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={updates as never}
    scheduleItems={items as never}
    knownScheduleItems={items as never}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport as never}
    onEmailReport={onEmailReport as never}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);


afterEach(() => { stopAppDownloads(); forgetAllReportSessionState(); });

test('writer advice-only area does not render an empty Reports work-area card', async () => {
  NAME = 'Synthetic Empty Area';
  mockAuthority = authority([], []);
  const draft = mockAuthority.reportDraft as ReturnType<typeof appDraft>;
  expect(draft.sourceEvidence.map(item => item.id)).toEqual(['runtime-current-situation']);
  expect(draft.locationGroups).toHaveLength(1);
  expect(draft.locationGroups[0].workAreas).toHaveLength(1);
  const emptyArea = draft.locationGroups[0].workAreas[0];
  expect(emptyArea.bullets).toEqual([]);
  expect(emptyArea.imageReferences).toEqual([]);
  expect(emptyArea.actionItems.length).toBeGreaterThan(0);
  const before = JSON.stringify(draft);
  render(reportsScreen([], []));
  await screen.findByRole('button', { name: 'Full written report' }, SLOW);
  expect(screen.queryByRole('button', { name: `${emptyArea.title} work area` })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Work Areas and Photos' })).toBeNull();
  expect(screen.queryByText('0 updates · 0 photos')).toBeNull();
  expect(JSON.stringify(draft)).toBe(before);
});

test.each(['note', 'waiting task', 'future task', 'photo', 'photo only'] as const)('writer %s retains its evidence with consistent visible-card counts', async kind => {
  NAME = `Synthetic ${kind} Area`;
  const item = { ...task('task', 'Frame walls', 'North Wing', 20, '12/31/2026'),
    ...(kind === 'waiting task' ? { status: 'Waiting' } : {}) };
  const isTask = kind === 'waiting task' || kind === 'future task';
  const hasPhoto = kind === 'photo' || kind === 'photo only';
  const updates = isTask ? [] : [update('note', item, '2026-10-16',
    kind === 'note' ? 'Neighbors asked about weekend hours.' : '',
    hasPhoto ? [photo('photo', 'North Wing', '')] : [])];
  const items = isTask ? [item] : [];
  mockAuthority = authority(updates, items);
  const draft = mockAuthority.reportDraft as ReturnType<typeof appDraft>;
  const areas = draft.locationGroups.flatMap(group => group.workAreas);
  expect(areas.some(area => area.bullets.length === 0 && area.imageReferences.length === 0)).toBe(true);
  expect(areas.find(area => area.title === 'North Wing')).toBeDefined();
  // Older drafts can hold photo references with no printed bullet. Keep those cards.
  if (kind === 'photo only') areas.find(area => area.title === 'North Wing')!.bullets = [];
  const before = JSON.stringify(draft);
  render(reportsScreen(updates, items));
  await screen.findByRole('button', { name: 'Full written report' }, SLOW);
  if (kind === 'future task') {
    // The writer makes no printable bullets for this future task. Its empty card
    // also goes, while its actual task details and DAVE area progress remain.
    expect(screen.queryByRole('button', { name: 'North Wing work area' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Work Areas and Photos' })).toBeNull();
    expect(screen.getByText('North Wing')).toBeTruthy();
    expect(screen.getByText(/Frame walls \(North Wing\): In Progress; 20% complete/)).toBeTruthy();
    expect(JSON.stringify(draft)).toBe(before);
    return;
  }
  expect(screen.getByRole('button', { name: 'North Wing work area' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Work Areas and Photos' })).toBeTruthy();
  expect(screen.getByText(`1 area · ${hasPhoto ? 1 : 0} photo${hasPhoto ? '' : 's'}`)).toBeTruthy();
  expect(screen.queryByText('0 updates · 0 photos')).toBeNull();
  if (kind === 'note') expect(screen.getByText('Neighbors asked about weekend hours.', { exact: false })).toBeTruthy();
  if (hasPhoto) expect(screen.getByLabelText('Photo 1 from North Wing')).toBeTruthy();
  expect(JSON.stringify(draft)).toBe(before);
});
