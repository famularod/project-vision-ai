// R4 item 4a, on the phone's Reports screen: an approval stands through a sync
// that only reorders the saved tasks, and an approval made before the update
// (under fingerprint version 1.0, kept on the device) is still this report's
// approval after it. Synthetic data, the real Reports screen.

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
import type { ScheduleItem } from '../../types';

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
    updates={[]}
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

describe('R4 item 4a on the Reports screen: a sync that only reorders the saved tasks', () => {
  it('keeps the approval, the saved approval and the order of Current Work', async () => {
    const view = render(screenFor(SAVED));
    await approve();
    await waitFor(() => expect(stored()).not.toBeNull(), SLOW);
    const approved = stored();
    expect(approved?.sourceFingerprint).toMatch(/^dave-report-source\/2\.0:/);
    const before = await currentWork();
    expect(before).toEqual(['Excavate', 'Frame walls', 'Pour slab', 'Roofing']);
    view.rerender(screenFor(REORDERED));
    await settle();
    await settle();
    await shareable();
    // Still approved: Share is offered, and Approve is not asked for again.
    expect(screen.getByRole('button', { name: 'Share Report' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve Report' })).toBeNull();
    expect(stored()).toEqual(approved);
    expect((await screen.findByText(/CURRENT WORK/, {}, SLOW)).props.children).toContain('• Excavate');
    await copy();
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    // The delivered mark is saved a few turns after the send resolves.
    await waitFor(() => expect(stored()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(stored()).toMatchObject({ sourceFingerprint: approved?.sourceFingerprint, deliveredAt: expect.any(String) });
    view.unmount();
  });
});

describe('R4 item 4a on the Reports screen: an approval made before the update', () => {
  /** Approved on the build before: the same approval, kept on the device under the 1.0 fingerprint of its facts. */
  const approvedBeforeTheUpdate = async () => {
    const first = render(screenFor(SAVED));
    await approve();
    await waitFor(() => expect(stored()).not.toBeNull(), SLOW);
    const [key, approval] = storedEntry()!;
    const underOne = legacyReportSourcesOf(approval.sourceFingerprint)[0];
    expect(isLegacyReportSource(underOne)).toBe(true);
    first.unmount();
    mockStorage.set(key, JSON.stringify({ ...approval, sourceFingerprint: underOne }));
    // The app was updated and opened again: nothing of the session is left.
    forgetAllReportSessionState();
    return underOne;
  };

  it('approving the same report again replaces nothing and warns of nothing; sending it records that approval as sent', async () => {
    const underOne = await approvedBeforeTheUpdate();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = render(screenFor(SAVED));
    await approve();
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ sourceFingerprint: underOne, deliveredAt: null });
    await copy();
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(stored()?.deliveredAt).toEqual(expect.any(String)), SLOW);
    expect(stored()).toMatchObject({ sourceFingerprint: underOne, deliveredAt: expect.any(String) });
    alert.mockRestore();
    view.unmount();
  });

  it('guard: when the facts have changed since, approving does warn that an approved report was never recorded as sent', async () => {
    await approvedBeforeTheUpdate();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = render(screenFor(SAVED.map(item => (item.id === 'pour' ? { ...item, percentComplete: 70 } : item))));
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1), SLOW);
    alert.mockRestore();
    view.unmount();
  });
});
