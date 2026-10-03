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

let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import {
  approvedReportFingerprint,
  forgetAllReportSessionState,
  recallReportSessionState,
  rememberReportAcknowledgement,
  rememberReportApproval,
} from '../../services/ReportSessionState';
import type { ScheduleItem } from '../../types';

// Whole-app audit A6 pass 6 (30 Sep 2026): a report sent after a change the
// text does not show (stage, checklist, assignee) stayed "never sent", and the
// next report's period repeated what the client already had.
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: '2026-09-30T12:00:00.000Z',
};

const controls = (overrides: Record<string, unknown> = {}) => ({
  version: 1, assignee: 'Dana', trade: 'Concrete', watchers: [], approvers: [],
  approvalStatus: 'Not Required', workflowStage: 'Open', referenceNumber: '', responseDueDate: '',
  checklist: [{ id: 'c1', label: 'Forms inspected', completed: false }],
  linkedRecords: [], resources: [], estimatedCostImpact: null, estimatedScheduleImpactDays: null,
  impactConfidence: 'Medium', impactNotes: '', revision: 1, updatedAt: null, updatedBy: null,
  ...overrides,
});

const task = (id: string, taskName: string, overrides: Record<string, unknown> = {}) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: 40, priority: 'Medium', status: 'In Progress', notes: '',
  projectControls: controls(), createdAt: '2026-09-01T12:00:00.000Z',
  ...overrides,
}) as unknown as ScheduleItem;
const done = { status: 'Complete', percentComplete: 100 };

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
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport}
    onEmailReport={async () => 'completed'}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);

// The whole Reports screen renders; a loaded machine needs more than the defaults.
jest.setTimeout(120_000);
const SLOW = { timeout: 30_000 } as const;

/** The one reporting-period snapshot the screen keeps for this scope. */
const stored = (): DAVEReportSnapshot | null => {
  const raw = Array.from(mockStorage.values())[0];
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};
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
  // The delivered mark saves after the send resolves.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};
const writtenReport = async () => {
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  // Owner answer 2 Oct (report heading): the written report's heading is "SINCE THE LAST REPORT" (was "SINCE THE LAST APPROVED REPORT"); pin updated deliberately.
  return screen.findByText(/SINCE THE LAST REPORT/, {}, SLOW);
};

const facts = (pour: Record<string, unknown> = {}, frame: Record<string, unknown> = {}) => [
  task('pour', 'Pour slab', pour),
  task('frame', 'Frame walls', frame),
];

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

describe('a report sent after a change its text does not show is recorded as sent (A6 pass 6)', () => {
  it('a stage and checklist change after approval, on a later visit: the approved report is the one sent, and the next period starts from it', async () => {
    const view = render(screenFor(facts()));
    await approve();
    await copy();
    const first = stored();
    expect(first?.deliveredAt).not.toBeNull();

    view.rerender(screenFor(facts({}, done)));
    await approve();
    await waitFor(() => expect(stored()?.sourceFingerprint).not.toBe(first?.sourceFingerprint), SLOW);
    const approved = stored();
    expect(approved?.deliveredAt).toBeNull();
    view.unmount();

    // Opening Schedule to move the stage and tick the checklist, then back.
    const inReview = controls({ workflowStage: 'In Review', checklist: [{ id: 'c1', label: 'Forms inspected', completed: true }] });
    const back = render(screenFor(facts({ projectControls: inReview }, done)));
    await shareable();
    await copy();
    expect(onCopyReport).toHaveBeenCalledTimes(2);
    expect(stored()).toMatchObject({ sourceFingerprint: approved?.sourceFingerprint });
    expect(stored()?.deliveredAt).not.toBeNull();

    // The next report compares against what the client has: one more completion, not two.
    back.rerender(screenFor(facts({ ...done, projectControls: inReview }, done)));
    await approvable();
    const body = await writtenReport();
    expect(body).toHaveTextContent(/\+1 completed; /);
    expect(body).not.toHaveTextContent(/\+2 completed; /);
  });

  it('a sync landing between Approve and Share in the same visit: the approved report is recorded as sent', async () => {
    const view = render(screenFor(facts()));
    await approve();
    await waitFor(() => expect(stored()).not.toBeNull(), SLOW);
    const approved = stored();

    view.rerender(screenFor(facts({ projectControls: controls({ assignee: 'Rui', referenceNumber: 'RFI-12' }) })));
    await copy();
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ sourceFingerprint: approved?.sourceFingerprint });
    expect(stored()?.deliveredAt).not.toBeNull();
  });

  it('an earlier approval is not marked sent when a re-approval of changed text could not be saved', async () => {
    const view = render(screenFor(facts()));
    await approve();
    await waitFor(() => expect(stored()).not.toBeNull(), SLOW);
    const earlier = stored();

    view.rerender(screenFor(facts({}, done)));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    await approve();
    await screen.findByText(/its reporting-period snapshot could not be saved on this device/, {}, SLOW);
    await copy();
    expect(onCopyReport).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual(earlier);
    expect(stored()?.deliveredAt).toBeNull();
  });

  it('a review item that arrives after approval revokes it, in this visit and the next', async () => {
    const view = render(screenFor(facts()));
    await approve();
    mockAuthority = {
      ...mockAuthority,
      reportDraft: { ...draft, needsReview: true, reviewFlags: ['One action needs verification.'] },
    };
    view.rerender(screenFor(facts()));
    const reviewed = await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW);
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    fireEvent.press(reviewed);
    await approvable();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    view.unmount();

    render(screenFor(facts()));
    await approvable();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(onCopyReport).not.toHaveBeenCalled();
  });
});

describe('approvedReportFingerprint', () => {
  beforeEach(() => forgetAllReportSessionState());

  it('is the facts the standing approval was given on, only for the approved text', () => {
    rememberReportApproval('daily|pm|p', 'text-a', 'f1');
    const state = recallReportSessionState('daily|pm|p');
    expect(approvedReportFingerprint(state, 'text-a')).toBe('f1');
    expect(approvedReportFingerprint(state, 'text-b')).toBeNull();
    expect(approvedReportFingerprint(null, 'text-a')).toBeNull();
    // Re-approving other text replaces it; no fingerprint given is none.
    rememberReportApproval('daily|pm|p', 'text-b', 'f2');
    expect(approvedReportFingerprint(recallReportSessionState('daily|pm|p'), 'text-b')).toBe('f2');
    rememberReportApproval('daily|pm|p', 'text-c');
    expect(approvedReportFingerprint(recallReportSessionState('daily|pm|p'), 'text-c')).toBeNull();
    // A revoked approval keeps no facts.
    rememberReportAcknowledgement('daily|pm|p', { fingerprint: 'f3', ids: ['r1'] });
    rememberReportApproval('daily|pm|p', 'text-c', 'f3');
    rememberReportApproval('daily|pm|p', null, 'f3');
    expect(recallReportSessionState('daily|pm|p')).toMatchObject({ approvedTextKey: null, approvedFingerprint: null });
  });
});
