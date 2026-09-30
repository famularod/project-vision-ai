import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Owner answer Q15 (30 Sep 2026), on the web: a combined Alpha+Beta schedule
// that stays current for Beta after Alpha's own schedule is made current is
// labelled "Current for Beta" and can be made current again; the notice after
// Make Current names the combined schedule that stays current only when the
// cloud's response says it did. Synthetic data; same shell harness as
// desktop-revised-schedule-make-current.test.tsx.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/documents',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
}));

function scheduleDocument(
  id: string,
  projectNames: string[],
  extra: Partial<DAVEWebReferenceDocument>,
): DAVEWebReferenceDocument {
  return {
    id,
    name: id,
    originalFileName: `${id}.csv`,
    uri: '',
    mimeType: 'text/csv',
    category: 'Schedules',
    notes: '',
    isCurrent: false,
    importedAt: '2026-09-01T12:00:00.000Z',
    projectId: null,
    projectName: projectNames.length === 1 ? projectNames[0] : null,
    projectNames,
    importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
    linkedScheduleItems: [],
    importedScheduleItemCount: 2,
    ...extra,
  };
}

const master = scheduleDocument('Combined master', ['Alpha', 'Beta'], { isCurrent: true, importedAt: '2026-09-10T12:00:00.000Z' });
const alphaOwn = scheduleDocument('Alpha rev 2', ['Alpha'], {});

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: null as DAVEWebReadOnlySnapshot | null,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-09-30T12:00:00.000Z',
    lastAttemptAt: '2026-09-30T12:00:00.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  setCurrentSchedule: jest.fn(async () => 'project'),
  setCurrentDocument: jest.fn(async () => undefined),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

function withDocuments(referenceDocuments: DAVEWebReferenceDocument[]) {
  mockAuth.snapshot = {
    projects: [
      { id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number],
      { id: 'beta', name: 'Beta' } as DAVEWebReadOnlySnapshot['projects'][number],
    ],
    scheduleItems: [],
    projectUpdates: [],
    referenceDocuments,
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
}

describe('a combined schedule current for some of its projects, on the web (owner answer Q15)', () => {
  beforeAll(() => {
    type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
    const root = globalThis as unknown as { window?: unknown };
    const browserWindow = (root.window ?? {}) as TestWindow;
    root.window = browserWindow;
    browserWindow.addEventListener = jest.fn();
    browserWindow.removeEventListener = jest.fn();
  });

  it('is labelled with the projects it is still current for, and offers Make Current again', async () => {
    withDocuments([{ ...master, retiredForProjectNames: ['Alpha'] }, { ...alphaOwn, isCurrent: true }]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.getAllByText('Current for Beta').length).toBeGreaterThan(0);
    expect(screen.queryByText('Make Current Schedule')).toBeNull();

    fireEvent.press(screen.getByLabelText('View Combined master'));
    fireEvent.press(await screen.findByText('Make Current Schedule'));
    await waitFor(() => expect(mockAuth.setCurrentSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'Combined master' })));
  });

  // Whole-app audit A5 pass 4 #2 (30 Sep 2026): a newer lookahead for Alpha
  // wins Alpha by date; the master read "Current" and offered no Make Current.
  it('a master a newer Alpha lookahead replaces for Alpha reads "Current for Beta" and offers Make Current', async () => {
    const lookahead = scheduleDocument('Alpha 3-week lookahead', ['Alpha'], { isCurrent: true, importedAt: '2026-09-20T12:00:00.000Z' });
    withDocuments([master, lookahead]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.getAllByText('Current for Beta').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('View Combined master'));
    fireEvent.press(await screen.findByText('Make Current Schedule'));
    await waitFor(() => expect(mockAuth.setCurrentSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'Combined master' })));
  });

  it('a schedule current everywhere offers no Make Current', async () => {
    withDocuments([master, alphaOwn]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('View Combined master'));
    expect(screen.queryByText('Current for Beta')).toBeNull();
    // Only Alpha rev 2, a prior version, offers it.
    expect(screen.getAllByText('Make Current Schedule')).toHaveLength(1);
  });

  it.each([
    ['after the migration', 'project', '“Alpha rev 2” is now the current schedule for Alpha. “Combined master” stays current for Beta. Earlier schedules remain available as history.'],
    ['before the migration', 'schedule', '“Alpha rev 2” is now the current schedule for Alpha. Earlier schedules remain available as history.'],
  ])('%s, the notice says what the cloud did', async (_state, scope, notice) => {
    withDocuments([master, alphaOwn]);
    mockAuth.setCurrentSchedule.mockResolvedValueOnce(scope);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByText('Make Current Schedule'));
    expect(await screen.findByText(notice)).toBeTruthy();
  });
});
