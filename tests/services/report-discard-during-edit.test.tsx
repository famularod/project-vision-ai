// R4 item 4a, on the phone's Reports screen: an approval stands through a sync
// that only reorders the saved tasks, and an approval made before the update
// (under fingerprint version 1.0, kept on the device) is still this report's
// approval after it. Synthetic data, the real Reports screen.
//
// R10 (the coordinator's decision on review pass 3, P3-2) reversed the second half: NO EARLIER-VERSION NAME EVER
// STANDS. An approval made before the update is another report's approval, for the same facts too: the words this
// build writes for them are not always the ones the build before sent. The two tests of that half say so now.

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
import { Alert } from 'react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { isLegacyReportSource, legacyReportSourcesOf, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { buildRuntime } from '../../services/PIERuntime';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};
const task = (id: string, taskName: string, finishDate: string, percentComplete = 40) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const SAVED = [task('pour', 'Pour slab', '2027-06-30'), task('frame', 'Frame walls', '2027-03-31'), task('roof', 'Roofing', '2027-06-30'), task('dig', 'Excavate', '2026-12-15')];
/** The same rows as a download leaves them: in another order. */
const REORDERED = [SAVED[2], SAVED[0], SAVED[3], SAVED[1]];
const onCopyReport = jest.fn(async () => 'completed' as const);
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
    onEmailReport={async () => 'completed'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);
/** The reporting-period snapshot this device keeps, with the key it is kept under. */
const storedEntry = (): [string, DAVEReportSnapshot] | null => {
  for (const [key, raw] of mockStorage) {
    try {
      const value = JSON.parse(raw) as DAVEReportSnapshot;
      if (value && value.scopeKey === 'tower' && Array.isArray(value.tasks)) return [key, value];
    } catch {
      // not a snapshot
    }
  }
  return null;
};
const stored = () => storedEntry()?.[1] ?? null;
const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const shareable = () => screen.findByRole('button', { name: 'Share Report' }, SLOW);
const approve = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await shareable();
};
const copy = async () => {
  fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  await settle();
  await settle();
};
const currentWork = async () => {
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  const body = (await screen.findByText(/CURRENT WORK/, {}, SLOW)).props.children as string;
  return body.slice(body.indexOf('CURRENT WORK')).split('\n').filter(line => line.startsWith('• ')).map(line => line.slice(2).split(' (')[0]).slice(0, 4);
};

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
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
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  fireEvent.changeText(screen.getByPlaceholderText('Report body'), 'My manual report words.');
  publishNotes([freshNote]);
  view.rerender(screenFor(SAVED));
  await screen.findByText('Project facts changed after you edited this report. Discard your edits to use the current report before approval.');
  expect(screen.getByPlaceholderText('Report body').props.value).toBe('My manual report words.');
  const discard = screen.getByRole('button', { name: 'Discard report edits' });
  fireEvent.press(discard);
  await approvable();
  expect(screen.queryByPlaceholderText('Report body')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Discard report edits' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Edit Report' }));
  const current = screen.getByPlaceholderText('Report body').props.value;
  expect(current).not.toContain('My manual report words.');
  expect(current).toContain('north gate inspection');
  expect(notes).toEqual([freshNote]);
  expect(onCopyReport).not.toHaveBeenCalled();
  view.unmount();
});
