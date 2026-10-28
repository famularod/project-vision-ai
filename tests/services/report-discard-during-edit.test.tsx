// 7.45: mounted edit/discard lifecycle with synthetic saved field notes.
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
}));
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
  saveReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
}));
let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { buildRuntime } from '../../services/PIERuntime';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(120_000);

const task = (id: string, taskName: string, finishDate: string, percentComplete = 40) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const SAVED = [task('pour', 'Pour slab', '2027-06-30'), task('frame', 'Frame walls', '2027-03-31'), task('roof', 'Roofing', '2027-06-30'), task('dig', 'Excavate', '2026-12-15')];
const onCopyReport = jest.fn(async () => 'completed' as const);
const onEmailReport = jest.fn(async () => 'completed' as const);
const onTextReport = jest.fn(async () => 'completed' as const);
const onOutlookReport = jest.fn(async () => 'unknown' as const);
const onDownloadWordReport = jest.fn(async () => 'unknown' as const);
const shares = [onCopyReport, onEmailReport, onTextReport, onOutlookReport, onDownloadWordReport];
let notes: ProjectUpdate[] = [];
const screenFor = (scheduleItems: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={notes}
    scheduleItems={scheduleItems}
    knownScheduleItems={scheduleItems}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport}
    onEmailReport={onEmailReport}
    onTextReport={onTextReport}
    onDownloadWordReport={onDownloadWordReport}
    onOutlookReport={onOutlookReport}
  />
);
const settled = async () => {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull());
};

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  onCopyReport.mockClear();

});


// The provider boundary is local; both the incoming runtime/report and the screen's
// Project Truth/fingerprint are built by production code from synthetic saved notes.
function publishNotes(next: ProjectUpdate[]) {
  notes = next;
  const runtime = buildRuntime({ projectName: 'Tower', projectNames: ['Tower'], updates: notes,
    scheduleItems: SAVED, knownScheduleItems: SAVED, reportType: 'daily_project_update',
    now: new Date('2026-10-17T12:00:00Z') });
  mockAuthority = { state: 'ready', policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: runtime.response.reportDraft, runtime, executiveJudgmentRecord: null };
}
const freshNote: ProjectUpdate = { id: 'fresh-note', projectName: 'Tower', date: '2026-10-17T11:00:00Z',
  photos: [], notes: 'The north gate inspection was completed today.', recipients: { contactIds: [] }, status: 'sent' };

it('7.45: discards stale manual text on the mounted screen after a saved field note arrives', async () => {
  publishNotes([]);
  const view = render(screenFor(SAVED));
  await settled();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  fireEvent.changeText(screen.getByPlaceholderText('Report body'), 'My manual report words.');
  publishNotes([freshNote]);
  view.rerender(screenFor(SAVED));
  await screen.findByText('Project facts changed after you edited this report. Discard your edits to use the current report before approval.');
  expect(screen.getByPlaceholderText('Report body').props.value).toBe('My manual report words.');
  const discard = screen.getByRole('button', { name: 'Discard report edits' });
  fireEvent.press(discard);
  await settled();
  expect(screen.queryByPlaceholderText('Report body')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard report edits' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  const current = screen.getByPlaceholderText('Report body').props.value;
  expect(current).not.toContain('My manual report words.');
  expect(current).toContain('north gate inspection');
  expect(notes).toEqual([freshNote]);
  for (const share of shares) expect(share).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: /^Mark reviewed:/ }).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Approve Report' }).props.accessibilityState.disabled).toBe(true);
  view.unmount();
});

it.each(['', 'Same facts, my own wording'])('discard cancels a %p edit without altering saved facts or approval', async text => {
  publishNotes([freshNote]);
  const view = render(screenFor(SAVED));
  await settled();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  const original = screen.getByPlaceholderText('Report body').props.value;
  expect(screen.queryByRole('button', { name: 'Discard report edits' })).toBeNull();
  fireEvent.changeText(screen.getByPlaceholderText('Report body'), text);
  fireEvent.press(screen.getByRole('button', { name: 'Discard report edits' }));
  expect(screen.queryByPlaceholderText('Report body')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  expect(screen.getByPlaceholderText('Report body').props.value).toBe(original);
  expect(screen.queryByRole('button', { name: 'Discard report edits' })).toBeNull();
  expect(notes).toEqual([freshNote]);
  for (const share of shares) expect(share).not.toHaveBeenCalled();
  view.unmount();
  // Canceled edits are also cleared from the session restore path.
  const remounted = render(screenFor(SAVED));
  await settled();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  expect(screen.getByPlaceholderText('Report body').props.value).toBe(original);
  expect(screen.queryByRole('button', { name: 'Discard report edits' })).toBeNull();
  remounted.unmount();
});
