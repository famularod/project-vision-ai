// R5, an item added by the coordinator. An R4 screen test ("guard: when the facts have changed since, approving does
// warn that an approved report was never recorded as sent") failed once in a full battery under load: no warning
// came in 30 seconds. It was not slowness, and not the test: it was a race in the app.
//
// Approving over an approved report that was never recorded as sent warns first (review N1 L5). Whether there is
// such a report on this device is read from the device's storage AFTER the reporting period has loaded, and
// Approve Report was already enabled while that read was on its way. A tap in that moment approved with no
// warning, and the earlier approval could no longer be marked sent. Approve now waits for the answer: until it
// is known the button is disabled and the line under it reads "Checking the reporting period."
//
// Here the read is held on purpose. The Reports screen is real. Synthetic data.

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
/** The shared period's report (the other device's), when a test puts one there; else reports are not shared yet. */
let mockShared: unknown = null;
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async () => (mockShared
    ? { ok: true, configured: true, data: { ownerId: 'owner-1', snapshot: mockShared } }
    : { ok: true, configured: true, data: null, stubbed: true })),
  saveReportSnapshotCloud: jest.fn(async () => (mockShared
    ? { ok: true, configured: true, data: null }
    : { ok: true, configured: true, data: null, stubbed: true })),
}));
/** While set, the check "did this device save the approval waiting to be sent?" does not answer until it resolves. */
let mockSavedHereHeld: Promise<void> | null = null;
jest.mock('../../services/DAVEReportSnapshotRepository', () => {
  const actual = jest.requireActual('../../services/DAVEReportSnapshotRepository');
  return {
    ...actual,
    reportApprovalSavedHere: jest.fn(async (...args: unknown[]) => {
      if (mockSavedHereHeld) await mockSavedHereHeld;
      return actual.reportApprovalSavedHere(...args);
    }),
  };
});
let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
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

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  onCopyReport.mockClear();
  mockSavedHereHeld = null;
  mockShared = null;
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

const UNSENT_WARNING_TITLE = 'An approved report is not recorded as sent';
const CHECKING = 'Checking the reporting period.';
/** The line under the button once the reporting period has loaded: Approve is waiting for the answer, or is offered. */
const periodLoaded = () => screen.findByText(/^(Checking the reporting period\.|Copy, Email, and Text unlock after approval\. No report is sent automatically\.)$/, {}, SLOW);
const approveButton = () => screen.getByRole('button', { name: 'Approve Report' });
/** An approval this device saved and never sent: approved in an earlier app session. */
const approvedEarlierAndNotSent = async () => {
  const first = render(screenFor(SAVED));
  await approvable();
  fireEvent.press(approveButton());
  await shareable();
  await waitFor(() => expect(stored()).not.toBeNull(), SLOW);
  first.unmount();
  forgetAllReportSessionState();
  return stored() as DAVEReportSnapshot;
};
const CHANGED = SAVED.map(item => (item.id === 'pour' ? { ...item, percentComplete: 70 } : item));

describe('R5 (added item): Approve waits until the app knows whether an approved report was never recorded as sent', () => {
  it('while that is still being read, Approve Report cannot be pressed; once it is known, approving warns', async () => {
    const earlier = await approvedEarlierAndNotSent();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    // The device is slow to say whether it saved the approval that is waiting.
    let answer: () => void = () => undefined;
    mockSavedHereHeld = new Promise<void>(resolve => { answer = resolve; });
    const view = render(screenFor(CHANGED));
    // The reporting period has loaded; the answer has not come.
    await periodLoaded();
    expect(screen.queryByText('The reporting period is still loading.')).toBeNull();
    // (Before: Approve Report was enabled here, and a tap approved with no warning.)
    expect(approveButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(CHECKING)).toBeTruthy();
    // A tap now does nothing: no approval without the warning.
    fireEvent.press(approveButton());
    await settle();
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(stored()).toEqual(earlier);
    // The answer arrives: Approve is offered, and warns.
    await act(async () => { answer(); });
    await approvable();
    expect(approveButton().props.accessibilityState).toMatchObject({ disabled: false });
    fireEvent.press(approveButton());
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe(UNSENT_WARNING_TITLE);
    // Nothing is approved until he answers the warning.
    await settle();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(stored()).toEqual(earlier);
    alert.mockRestore();
    view.unmount();
  });

  it('the approval waiting was made on the other device and is not kept here: once that is known Approve is offered, and there is nothing to warn of', async () => {
    const onTheOtherDevice = await approvedEarlierAndNotSent();
    // It is in the shared period only: this device holds no copy of it.
    mockShared = onTheOtherDevice;
    mockStorage.clear();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    let answer: () => void = () => undefined;
    mockSavedHereHeld = new Promise<void>(resolve => { answer = resolve; });
    const view = render(screenFor(CHANGED));
    await periodLoaded();
    expect(approveButton().props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => { answer(); });
    await approvable();
    fireEvent.press(approveButton());
    await shareable();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    view.unmount();
  });

  it('guard: with no approval waiting to be sent there is nothing to read, and Approve is offered as soon as the period has loaded', async () => {
    mockSavedHereHeld = new Promise<void>(() => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = render(screenFor(SAVED));
    await approvable();
    expect(screen.queryByText(CHECKING)).toBeNull();
    fireEvent.press(approveButton());
    await shareable();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    view.unmount();
  });

  it('guard: the same report as the approval waiting (nothing would be replaced) is approved with no warning once the answer is known', async () => {
    await approvedEarlierAndNotSent();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    let answer: () => void = () => undefined;
    mockSavedHereHeld = new Promise<void>(resolve => { answer = resolve; });
    const view = render(screenFor(SAVED));
    await periodLoaded();
    expect(approveButton().props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => { answer(); });
    await approvable();
    fireEvent.press(approveButton());
    await shareable();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
    view.unmount();
  });
});
