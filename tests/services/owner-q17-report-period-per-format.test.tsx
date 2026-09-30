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
import {
  buildDAVEReportSnapshot,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  loadDAVEReportSnapshot,
  saveDAVEReportSnapshot,
} from '../../services/DAVEReportSnapshotRepository';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import type { ScheduleItem } from '../../types';

// Owner answer Q17 (30 Sep 2026): every report format shared one "since the
// last report" period, so sending an Executive Summary started the next
// period of the team's Project Manager report, which then skipped changes
// the team never saw. Each format now keeps its own period. A period saved
// before this change (one for all formats) is each format's starting
// baseline until that format's first send.

const PREFIX = '@vitruvius/report-snapshots/v1:';
const SHARED_KEY = `${PREFIX}tower`;
const keyFor = (format: DAVEReportFormat) => `${SHARED_KEY}:${format}`;

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
});

describe('the repository keeps one period per report format', () => {
  const truth = (completed: number) => ({
    projectName: 'Tower',
    schedule: ['a', 'b', 'c'].map((id, index) => ({
      taskId: id, taskName: `Task ${id}`, areaName: 'L2', owner: '',
      status: index < completed ? 'Complete' : 'In Progress', percentComplete: index < completed ? 100 : 40,
      finishDate: null, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
    })),
  }) as never;
  const snap = (fingerprint: string, completed: number, capturedAt: string, reportFormat?: DAVEReportFormat) =>
    buildDAVEReportSnapshot({ truths: [truth(completed)], scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt, reportFormat });
  const sent = (snapshot: DAVEReportSnapshot | null, at: string) => markReportSnapshotDelivered(snapshot as DAVEReportSnapshot, at);

  it('a send of one format leaves the other format\'s period alone, under keys the per-account prefix covers', async () => {
    await saveDAVEReportSnapshot(sent(reportSnapshotToSave(snap('f0', 0, '2026-09-21T10:00:00.000Z', 'project_manager'), null), '2026-09-21T11:00:00.000Z'));
    await saveDAVEReportSnapshot(sent(reportSnapshotToSave(snap('f1', 1, '2026-09-24T10:00:00.000Z', 'executive'), null), '2026-09-24T11:00:00.000Z'));
    expect(Array.from(mockStorage.keys()).sort()).toEqual([keyFor('executive'), keyFor('project_manager')]);
    expect(Array.from(mockStorage.keys()).every(key => key.startsWith(PREFIX))).toBe(true);
    await expect(loadDAVEReportSnapshot('tower', 'project_manager')).resolves.toMatchObject({ sourceFingerprint: 'f0', reportFormat: 'project_manager' });
    await expect(loadDAVEReportSnapshot('tower', 'executive')).resolves.toMatchObject({ sourceFingerprint: 'f1', reportFormat: 'executive' });
    // A snapshot of the other format is never what an approval supersedes.
    const executive = await loadDAVEReportSnapshot('tower', 'executive');
    expect(reportSnapshotToSave(snap('f2', 2, '2026-09-28T10:00:00.000Z', 'project_manager'), executive)?.supersedes).toBeUndefined();
    expect(reportSnapshotToSave(snap('f1', 1, '2026-09-28T10:00:00.000Z', 'project_manager'), executive)).not.toBeNull();
  });

  it('a period saved before Q17 is each format\'s baseline until that format\'s first send, and is never rewritten', async () => {
    const legacy = sent(snap('f0', 0, '2026-09-21T10:00:00.000Z'), '2026-09-21T11:00:00.000Z');
    mockStorage.set(SHARED_KEY, JSON.stringify(legacy));
    const legacyRaw = mockStorage.get(SHARED_KEY);
    const pm = await loadDAVEReportSnapshot('tower', 'project_manager');
    expect(pm).toEqual({ ...legacy, reportFormat: 'project_manager' });
    await expect(loadDAVEReportSnapshot('tower', 'executive')).resolves.toEqual({ ...legacy, reportFormat: 'executive' });

    // The Project Manager report is approved: until it is sent its period still runs from the shared baseline.
    const approved = reportSnapshotToSave(snap('f1', 1, '2026-09-24T10:00:00.000Z', 'project_manager'), pm);
    await saveDAVEReportSnapshot(approved as DAVEReportSnapshot);
    expect(reportBaselineSnapshot(await loadDAVEReportSnapshot('tower', 'project_manager'), 'f2')?.sourceFingerprint).toBe('f0');
    await saveDAVEReportSnapshot(sent(approved, '2026-09-24T11:00:00.000Z'));
    expect(reportBaselineSnapshot(await loadDAVEReportSnapshot('tower', 'project_manager'), 'f2')?.sourceFingerprint).toBe('f1');
    // The Executive Summary has not been sent since: it still runs from the shared baseline.
    expect(reportBaselineSnapshot(await loadDAVEReportSnapshot('tower', 'executive'), 'f2')?.sourceFingerprint).toBe('f0');
    expect(mockStorage.get(SHARED_KEY)).toBe(legacyRaw);
  });

  it('a shared approval that was never sent, sent now as one format, is that format\'s alone', async () => {
    const owned = sent(snap('f0', 0, '2026-09-21T10:00:00.000Z'), '2026-09-21T11:00:00.000Z');
    const unsent = reportSnapshotToSave(snap('f1', 1, '2026-09-29T10:00:00.000Z'), owned) as DAVEReportSnapshot;
    mockStorage.set(SHARED_KEY, JSON.stringify(unsent));
    const legacyRaw = mockStorage.get(SHARED_KEY);
    // The screen's delivered mark, as the Project Manager report.
    await saveDAVEReportSnapshot(sent(await loadDAVEReportSnapshot('tower', 'project_manager'), '2026-09-30T09:00:00.000Z'));
    expect(reportBaselineSnapshot(await loadDAVEReportSnapshot('tower', 'project_manager'), 'f2')?.sourceFingerprint).toBe('f1');
    // The executives never received f1: their period still runs from f0.
    expect(reportBaselineSnapshot(await loadDAVEReportSnapshot('tower', 'executive'), 'f2')?.sourceFingerprint).toBe('f0');
    expect(mockStorage.get(SHARED_KEY)).toBe(legacyRaw);
  });

  it('a format key holds only that format, and the shared key only a format-less period', async () => {
    mockStorage.set(keyFor('project_manager'), JSON.stringify(snap('f0', 0, '2026-09-21T10:00:00.000Z', 'executive')));
    await expect(loadDAVEReportSnapshot('tower', 'project_manager')).resolves.toBeNull();
    mockStorage.clear();
    mockStorage.set(SHARED_KEY, JSON.stringify(snap('f0', 0, '2026-09-21T10:00:00.000Z', 'executive')));
    await expect(loadDAVEReportSnapshot('tower', 'project_manager')).resolves.toBeNull();
  });
});

// The whole Reports screen renders; a loaded machine needs more than the defaults.
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

const task = (id: string, taskName: string, complete: boolean, projectName = 'Tower') => ({
  id, projectName, locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: complete ? 100 : 40, priority: 'Medium', status: complete ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
/** The Tower plan with the first `completed` of Frame walls, Pour slab, Set roof complete. */
const tower = (completed: number) => [
  task('frame', 'Frame walls', completed >= 1),
  task('pour', 'Pour slab', completed >= 2),
  task('roof', 'Set roof', completed >= 3),
];

const onCopyReport = jest.fn(async () => 'completed' as const);
type Visit = Readonly<{
  format: DAVEReportFormat;
  scheduleItems: ScheduleItem[];
  reportType?: 'daily_project_update' | 'combined_project_update';
  selectedProjectNames?: string[];
}>;
const reportsScreen = ({ format, scheduleItems, reportType = 'daily_project_update', selectedProjectNames = ['Tower'] }: Visit) => (
  <ReportsScreen
    projectName={selectedProjectNames[0]}
    reportType={reportType}
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower', 'Annex']}
    selectedProjectNames={selectedProjectNames}
    onToggleProject={() => undefined}
    reportFormat={format}
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

let current: ReturnType<typeof render> | null = null;
/** Opens the Reports tab afresh, as after visiting another tab. */
const visit = (props: Visit) => {
  current?.unmount();
  current = render(reportsScreen(props));
  return current;
};
afterEach(() => {
  current?.unmount();
  current = null;
});

const approvable = () =>
  screen.findByText('Copy, Email, and Text unlock after approval. No report is sent automatically.', {}, SLOW);
const shareable = () => screen.findByRole('button', { name: 'Share Report' }, SLOW);
const approve = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
  await shareable();
};
const startCopy = () => {
  // The share choices stay open on the same screen after an earlier send.
  if (!screen.queryByRole('button', { name: 'Copy Report' })) {
    fireEvent.press(screen.getByRole('button', { name: 'Share Report' }));
  }
  fireEvent.press(screen.getByRole('button', { name: 'Copy Report' }));
};
const settle = () => act(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});
const approveAndSend = async () => {
  await approve();
  startCopy();
  await waitFor(() => expect(screen.queryByText('Waiting for the selected share action to finish.')).toBeNull(), SLOW);
  // The delivered mark saves after the send resolves.
  await settle();
};
/** The written report's period, once the period has loaded. */
const period = async () => {
  await approvable();
  fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
  const body = await screen.findByText(/SINCE THE LAST APPROVED REPORT/, {}, SLOW);
  return body.props.children as string;
};
const stored = (key: string) => {
  const raw = mockStorage.get(key);
  return raw ? JSON.parse(raw) as DAVEReportSnapshot : null;
};

beforeEach(() => {
  onCopyReport.mockClear();
  mockAuthority = {
    state: 'ready',
    policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: draft,
    runtime: { response: { reportDraft: draft } },
    executiveJudgmentRecord: null,
  };
});

describe('each report format keeps its own period on the Reports screen (owner answer Q17)', () => {
  it('sending one format never resets the other, and each format\'s next report counts from its own last send', async () => {
    const view = visit({ format: 'project_manager', scheduleItems: tower(0) });
    await approveAndSend();

    // The owner switches to Executive Summary on the same screen. The
    // executives have not had a report: theirs establishes its own baseline,
    // not "+1 since the team's report".
    view.rerender(reportsScreen({ format: 'executive', scheduleItems: tower(1) }));
    expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');
    await approveAndSend();

    // The team's report runs from the team's last report (nothing done), not the Executive Summary (one done).
    visit({ format: 'project_manager', scheduleItems: tower(2) });
    const pm = await period();
    expect(pm).toContain('+2 completed; ');
    expect(pm).toContain('Frame walls was completed.');
    await approveAndSend();

    // The reverse: the executives' report runs from their last report (one done), not the team's (two done).
    visit({ format: 'executive', scheduleItems: tower(3) });
    const executive = await period();
    expect(executive).toContain('+2 completed; ');
    expect(executive).toContain('Pour slab was completed.');
    expect(executive).not.toContain('Frame walls was completed.');
    visit({ format: 'project_manager', scheduleItems: tower(3) });
    expect(await period()).toContain('+1 completed; ');

    expect(onCopyReport).toHaveBeenCalledTimes(3);
    expect(Array.from(mockStorage.keys()).sort()).toEqual([keyFor('executive'), keyFor('project_manager')]);
    expect(stored(keyFor('project_manager'))?.deliveredAt).not.toBeNull();
    expect(stored(keyFor('executive'))?.deliveredAt).not.toBeNull();
  });

  it('a period saved before Q17 carries into both formats until each one\'s first send', async () => {
    // What the app saved before this change: the same period, under the shared key and with no format.
    visit({ format: 'project_manager', scheduleItems: tower(0) });
    await approveAndSend();
    const { reportFormat: _format, ...legacy } = stored(keyFor('project_manager')) as DAVEReportSnapshot;
    mockStorage.clear();
    mockStorage.set(SHARED_KEY, JSON.stringify(legacy));
    const legacyRaw = mockStorage.get(SHARED_KEY);

    visit({ format: 'executive', scheduleItems: tower(1) });
    expect(await period()).toContain('+1 completed; ');
    visit({ format: 'project_manager', scheduleItems: tower(1) });
    expect(await period()).toContain('+1 completed; ');
    await approveAndSend();

    // The Executive Summary has never been sent: it still runs from the shared baseline.
    visit({ format: 'executive', scheduleItems: tower(2) });
    const executive = await period();
    expect(executive).toContain('+2 completed; ');
    expect(executive).toContain('Frame walls was completed.');
    visit({ format: 'project_manager', scheduleItems: tower(2) });
    expect(await period()).toContain('+1 completed; ');

    visit({ format: 'executive', scheduleItems: tower(2) });
    await approveAndSend();
    visit({ format: 'executive', scheduleItems: tower(3) });
    expect(await period()).toContain('+1 completed; ');

    expect(mockStorage.get(SHARED_KEY)).toBe(legacyRaw);
    expect(stored(keyFor('project_manager'))?.deliveredAt).not.toBeNull();
    expect(stored(keyFor('executive'))?.deliveredAt).not.toBeNull();
  });

  it('a single report and a combined report of the same one project share that format\'s period', async () => {
    visit({ format: 'project_manager', scheduleItems: tower(0) });
    await approveAndSend();
    visit({ format: 'project_manager', scheduleItems: tower(1), reportType: 'combined_project_update' });
    expect(await period()).toContain('+1 completed; ');
    visit({ format: 'executive', scheduleItems: tower(1), reportType: 'combined_project_update' });
    expect(await period()).toContain('This approval establishes the baseline for the next reporting period.');
  });

  it('a send still open when the owner switches format marks the format that was sent, not the one on screen', async () => {
    let finishCopy: (outcome: 'completed') => void = () => undefined;
    onCopyReport.mockImplementationOnce(() => new Promise<'completed'>(resolve => {
      finishCopy = resolve;
    }));
    // Both formats approved on the same facts, so they share a fingerprint.
    const view = visit({ format: 'executive', scheduleItems: tower(1) });
    await approve();
    await waitFor(() => expect(stored(keyFor('executive'))).not.toBeNull(), SLOW);
    view.rerender(reportsScreen({ format: 'project_manager', scheduleItems: tower(1) }));
    await approve();
    await waitFor(() => expect(stored(keyFor('project_manager'))).not.toBeNull(), SLOW);
    startCopy();

    view.rerender(reportsScreen({ format: 'executive', scheduleItems: tower(1) }));
    await shareable();
    await act(async () => {
      finishCopy('completed');
    });
    await waitFor(() => expect(stored(keyFor('project_manager'))?.deliveredAt).not.toBeNull(), SLOW);
    await settle();
    expect(stored(keyFor('executive'))?.deliveredAt).toBeNull();
  });

  it('nor is the other format\'s approval that is still saving when the send completes', async () => {
    let finishCopy: (outcome: 'completed') => void = () => undefined;
    onCopyReport.mockImplementationOnce(() => new Promise<'completed'>(resolve => {
      finishCopy = resolve;
    }));
    const view = visit({ format: 'project_manager', scheduleItems: tower(1) });
    await approve();
    await waitFor(() => expect(stored(keyFor('project_manager'))).not.toBeNull(), SLOW);
    startCopy();

    view.rerender(reportsScreen({ format: 'executive', scheduleItems: tower(1) }));
    await approvable();
    let finishSave: () => void = () => undefined;
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (key: string, value: string) => {
      await new Promise<void>(resolve => {
        finishSave = resolve;
      });
      mockStorage.set(key, value);
    });
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    // Whole-app audit A6 pass 7: Approve first reads the other device's last report, so the save
    // starts a moment after the press; the send completes once it is under way, as intended here.
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(keyFor('executive'), expect.any(String)), SLOW);
    await act(async () => {
      finishCopy('completed');
    });
    await waitFor(() => expect(stored(keyFor('project_manager'))?.deliveredAt).not.toBeNull(), SLOW);
    await act(async () => {
      finishSave();
    });
    await waitFor(() => expect(stored(keyFor('executive'))).not.toBeNull(), SLOW);
    await settle();
    expect(stored(keyFor('executive'))?.deliveredAt).toBeNull();
  });
});

describe('the combined report\'s memory ignores selection order (whole-app audit A6 pass 6 #6)', () => {
  it('toggling a project off and on restores the edits, review marks and approval for that set', async () => {
    mockAuthority = {
      ...mockAuthority,
      reportDraft: { ...draft, needsReview: true, reviewFlags: ['One action needs verification.'] },
    };
    const facts = [...tower(1), task('grade', 'Grade site', false, 'Annex')];
    const combined = (selectedProjectNames: string[]): Visit =>
      ({ format: 'project_manager', scheduleItems: facts, reportType: 'combined_project_update', selectedProjectNames });

    const view = visit(combined(['Tower', 'Annex']));
    fireEvent.press(await screen.findByRole('button', { name: 'Edit Report' }, SLOW));
    fireEvent.changeText(await screen.findByPlaceholderText('Report body', {}, SLOW), 'Owner-edited combined report.');
    fireEvent.press(await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW));
    await approvable();
    fireEvent.press(screen.getByRole('button', { name: 'Approve Report' }));
    await shareable();

    // Tower off, then on again: it is now last in the selection.
    view.rerender(reportsScreen(combined(['Annex'])));
    await screen.findByRole('button', { name: /^Mark reviewed:/ }, SLOW);
    view.rerender(reportsScreen(combined(['Annex', 'Tower'])));
    await shareable();
    expect(screen.queryByRole('button', { name: /^Mark reviewed:/ })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Full written report' }));
    expect(screen.getByText('Owner-edited combined report.')).toBeTruthy();
  });
});
