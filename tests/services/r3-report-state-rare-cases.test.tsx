// R3 item 2 (open item, three rare report-state cases on the phone, recorded
// 30 Sep by A6 passes 3 and 4): a send whose scope changed before the mail
// screen came back; an advisory that clears by itself; a "ready" report with
// report generation off. Synthetic data, the real Reports screen.

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
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { evaluateReportApprovalPolicy } from '../../services/ReportApprovalPolicy';
import {
  forgetAllReportSessionState,
  forgetApprovalEndedByUnreviewedAdvisory,
  recallReportSessionState,
  rememberReportAcknowledgement,
  rememberReportApproval,
} from '../../services/ReportSessionState';
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
const task = (id: string, projectName: string, taskName: string, percentComplete = 40) => ({
  id, projectName, locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const TASKS = [task('pour', 'Tower', 'Pour slab'), task('frame', 'Tower', 'Frame walls'), task('dig', 'Annex', 'Excavate')];

type Outcome = 'completed' | 'unknown';
const screenFor = (
  selected: string[],
  onEmailReport: () => Promise<Outcome> = async () => 'completed',
  reportType: 'daily_project_update' | 'combined_project_update' = 'daily_project_update',
) => (
  <ReportsScreen
    projectName="Tower"
    reportType={reportType}
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower', 'Annex']}
    selectedProjectNames={selected}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={[]}
    scheduleItems={TASKS.filter(item => selected.includes(item.projectName))}
    onSavedUpdates={() => undefined}
    onCopyReport={async () => 'completed'}
    onEmailReport={onEmailReport}
    onTextReport={async () => 'completed'}
    onDownloadWordReport={async () => 'unknown'}
    onOutlookReport={async () => 'unknown'}
  />
);
/** Every reporting-period snapshot this device keeps, by the projects it is for. */
const stored = (scopeKey: string): DAVEReportSnapshot | null => {
  for (const raw of mockStorage.values()) {
    try {
      const value = JSON.parse(raw) as DAVEReportSnapshot;
      if (value && value.scopeKey === scopeKey && Array.isArray(value.tasks)) return value;
    } catch {
      // not a snapshot
    }
  }
  return null;
};
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
const ready = (overrides: Record<string, unknown> = {}) => ({
  state: 'ready',
  policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
  reportDraft: draft,
  runtime: { response: { reportDraft: draft } },
  executiveJudgmentRecord: null,
  ...overrides,
});
const OFFLINE_ADVISORY = /Cloud confirmation is not available right now/;

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  mockAuthority = ready();
});

describe('R3 item 2a: a send whose scope changed before the mail screen came back is recorded as sent', () => {
  /** A mail screen that stays open until the test closes it. */
  const mailScreen = () => {
    let close: (outcome: Outcome) => void = () => undefined;
    const opened = new Promise<Outcome>(resolve => { close = resolve; });
    return { onEmailReport: jest.fn(() => opened), close: (outcome: Outcome) => close(outcome) };
  };
  const startEmail = async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
    fireEvent.press(screen.getByRole('button', { name: 'Email Report' }));
    await settle();
  };

  it('another project was added to the report while Mail was open: Tower\'s report is the one recorded', async () => {
    const mail = mailScreen();
    const view = render(screenFor(['Tower'], mail.onEmailReport));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    await startEmail();
    await waitFor(() => expect(mail.onEmailReport).toHaveBeenCalledTimes(1), SLOW);
    // The selection changes under the open mail screen (a tap before Mail came up, or a sync).
    view.rerender(screenFor(['Tower', 'Annex'], mail.onEmailReport, 'combined_project_update'));
    await approvable();
    await act(async () => { mail.close('completed'); });
    await waitFor(() => expect(stored('tower')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    // The combined report he now looks at was never sent.
    expect(stored('annex|tower')?.deliveredAt ?? null).toBeNull();
    view.unmount();
  });

  it('the report type changed while Mail was open (same project): still recorded', async () => {
    const mail = mailScreen();
    const view = render(screenFor(['Tower'], mail.onEmailReport));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    await startEmail();
    await waitFor(() => expect(mail.onEmailReport).toHaveBeenCalledTimes(1), SLOW);
    view.rerender(screenFor(['Tower'], mail.onEmailReport, 'combined_project_update'));
    await settle();
    await act(async () => { mail.close('completed'); });
    await waitFor(() => expect(stored('tower')?.deliveredAt).toEqual(expect.any(String)), SLOW);
    view.unmount();
  });

  it('guard: Mail closed without sending records nothing', async () => {
    const mail = mailScreen();
    const view = render(screenFor(['Tower'], mail.onEmailReport));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    await startEmail();
    view.rerender(screenFor(['Tower', 'Annex'], mail.onEmailReport, 'combined_project_update'));
    await approvable();
    await act(async () => { mail.close('unknown'); });
    await settle();
    await settle();
    expect(stored('tower')?.deliveredAt).toBeNull();
    view.unmount();
  });
});

describe('R3 item 2b: an advisory that clears by itself does not bring the earlier approval back', () => {
  const offline = () => ready({ state: 'degraded_local_only', policy: { reportGenerationAllowed: false, layer4DecisionCreationAllowed: false } });

  it('in one visit: approved, the connection drops and returns; he is asked to approve again', async () => {
    const view = render(screenFor(['Tower']));
    await approve();
    mockAuthority = offline();
    view.rerender(screenFor(['Tower']));
    await screen.findByText(OFFLINE_ADVISORY, {}, SLOW);
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    // It clears without Mark reviewed.
    mockAuthority = ready();
    view.rerender(screenFor(['Tower']));
    await approvable();
    expect(screen.queryByText(OFFLINE_ADVISORY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeTruthy();
    view.unmount();
  });

  it('on the next visit: the advisory was there when he came back and cleared while he looked', async () => {
    const first = render(screenFor(['Tower']));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    first.unmount();
    mockAuthority = offline();
    const back = render(screenFor(['Tower']));
    await screen.findByText(OFFLINE_ADVISORY, {}, SLOW);
    await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW);
    await settle();
    mockAuthority = ready();
    back.rerender(screenFor(['Tower']));
    await approvable();
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    back.unmount();
  });

  it('guard: leaving Reports and coming back with nothing new to review keeps the approval', async () => {
    const first = render(screenFor(['Tower']));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    first.unmount();
    const back = render(screenFor(['Tower']));
    await shareable();
    back.unmount();
  });

  it('guard: an advisory he marked reviewed before approving does not undo the approval when he comes back', async () => {
    mockAuthority = offline();
    const first = render(screenFor(['Tower']));
    fireEvent.press(await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW));
    await approve();
    await waitFor(() => expect(stored('tower')).not.toBeNull(), SLOW);
    first.unmount();
    const back = render(screenFor(['Tower']));
    await shareable();
    back.unmount();
  });

  it('guard: project data loading for a moment does not undo the approval', async () => {
    const view = render(screenFor(['Tower']));
    await approve();
    mockAuthority = ready({ state: 'loading', policy: { reportGenerationAllowed: false, layer4DecisionCreationAllowed: false } });
    view.rerender(screenFor(['Tower']));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull(), SLOW);
    await settle();
    mockAuthority = ready();
    view.rerender(screenFor(['Tower']));
    await shareable();
    view.unmount();
  });
});

describe('R3 item 2b: while project data is loading nothing is decided', () => {
  it('guard: an item in a report still being worked out during loading does not undo the approval', async () => {
    const view = render(screenFor(['Tower']));
    await approve();
    // Loading, and the report being rebuilt carries an item for a moment.
    const rebuilding = { ...draft, needsReview: true, reviewFlags: ['One action needs verification.'] };
    mockAuthority = ready({
      state: 'loading', policy: { reportGenerationAllowed: false, layer4DecisionCreationAllowed: false },
      reportDraft: rebuilding, runtime: { response: { reportDraft: rebuilding } },
    });
    view.rerender(screenFor(['Tower']));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull(), SLOW);
    await settle();
    // Loaded: the report is the one he approved.
    mockAuthority = ready();
    view.rerender(screenFor(['Tower']));
    await shareable();
    view.unmount();
  });
});

describe('R3 item 2b: which approvals an unreviewed item ends', () => {
  const approved = () => {
    rememberReportAcknowledgement('scope', { fingerprint: 'facts-1', ids: ['flag:seen'] });
    rememberReportApproval('scope', 'text-a', 'facts-1', '2026-09-28T15:00:00.000Z');
  };
  const standing = () => recallReportSessionState('scope')?.approvedTextKey ?? null;

  it('an item he never marked reviewed ends the approval of this text on this period', () => {
    approved();
    expect(forgetApprovalEndedByUnreviewedAdvisory('scope', 'text-a', '2026-09-28T15:00:00.000Z', ['flag:seen', 'authority:degraded_local_only'])).toBe(true);
    expect(standing()).toBeNull();
    // What he marked reviewed is kept.
    expect(recallReportSessionState('scope')?.acknowledgement?.ids).toEqual(['flag:seen']);
  });

  it('an item he marked reviewed does not, whatever the facts are by now', () => {
    approved();
    expect(forgetApprovalEndedByUnreviewedAdvisory('scope', 'text-a', '2026-09-28T15:00:00.000Z', ['flag:seen'])).toBe(false);
    expect(standing()).toBe('text-a');
  });

  it('an approval of other text, or given on another period, is left to its own rules', () => {
    approved();
    expect(forgetApprovalEndedByUnreviewedAdvisory('scope', 'text-b', '2026-09-28T15:00:00.000Z', ['authority:stale_model'])).toBe(false);
    expect(forgetApprovalEndedByUnreviewedAdvisory('scope', 'text-a', '2026-09-30T15:00:00.000Z', ['authority:stale_model'])).toBe(false);
    expect(forgetApprovalEndedByUnreviewedAdvisory('scope', 'text-a', null, ['authority:stale_model'])).toBe(false);
    expect(forgetApprovalEndedByUnreviewedAdvisory('other scope', 'text-a', '2026-09-28T15:00:00.000Z', ['authority:stale_model'])).toBe(false);
    expect(standing()).toBe('text-a');
  });
});

describe('R3 item 2c: a "ready" report with report generation off says so', () => {
  const NOTICE = /could not finish checking its own reading of this project/;
  const clean = { needsReview: false, reviewFlags: [] };

  it('the policy shows one item to review, and approval follows it', () => {
    const policy = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: 'ready' });
    expect(policy.allowed).toBe(false);
    expect(policy.items).toHaveLength(1);
    expect(policy.items[0]).toMatchObject({ kind: 'advisory', text: expect.stringMatching(NOTICE) });
    expect(policy.message).toMatch(/1 item needs your review below/);
    const reviewed = evaluateReportApprovalPolicy({
      report: clean, reportGenerationAllowed: false, authorityState: 'ready', acknowledgedItemIds: [policy.items[0].id],
    });
    expect(reviewed.allowed).toBe(true);
  });

  it('guard: ready with generation on shows nothing; the other states keep their own sentence, once', () => {
    expect(evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: true, authorityState: 'ready' })).toMatchObject({ allowed: true, items: [] });
    const offline = evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: 'degraded_local_only' });
    expect(offline.items).toHaveLength(1);
    expect(offline.items[0].text).toMatch(OFFLINE_ADVISORY);
    expect(evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: 'loading' }).items).toEqual([]);
    expect(evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false, authorityState: 'blocked_identity' }).items).toEqual([]);
    expect(evaluateReportApprovalPolicy({ report: clean, reportGenerationAllowed: false }).items).toEqual([]);
  });

  it('on the screen: the notice is shown with Mark reviewed, and the report can then be approved', async () => {
    mockAuthority = ready({ policy: { reportGenerationAllowed: false, layer4DecisionCreationAllowed: false } });
    const view = render(screenFor(['Tower']));
    await screen.findByText(NOTICE, {}, SLOW);
    expect(screen.queryByRole('button', { name: 'Share Report' })).toBeNull();
    fireEvent.press(await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW));
    await approve();
    view.unmount();
  });
});
