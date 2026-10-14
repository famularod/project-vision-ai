import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Review pass H4, H4S-1 (Medium, older; open item 2.42; 14 Oct 2026), on the page itself: Documents, a REPLACED
// lookahead or an older master, Edit Project Document Details. Its Projects were offered for change; a replaced
// lookahead moved to another project came back into effect on every device. The form now shows the Category and the
// Projects of a schedule file with tasks as they are, says why, and offers nothing to save; any other document keeps
// every choice. Made-up projects; the shell harness of the 2.34 page test.

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

function scheduleDocument(id: string, extra: Partial<DAVEWebReferenceDocument> = {}): DAVEWebReferenceDocument {
  return {
    id, name: id, originalFileName: `${id}.csv`, uri: '', mimeType: 'text/csv', category: 'Schedules', notes: '', isCurrent: false,
    importedAt: '2026-09-01T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 3, ...extra,
  };
}

const master = scheduleDocument('Alpha master', { isCurrent: true, importedAt: '2026-09-20T12:00:00.000Z' });
// The older master: the newer one moved two of its tasks, and its own copies of them are its linked tasks.
const older = scheduleDocument('Alpha rev 1', { linkedScheduleItems: [{ id: 'rev1-paint', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }, { id: 'rev1-roof', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }] });
const memo = scheduleDocument('Site memo', { category: 'Report', originalFileName: 'Site memo.pdf', mimeType: 'application/pdf', importBatchId: null, importedScheduleItemCount: 0 });
const replaced = scheduleDocument('Alpha look 1', { scheduleRole: 'lookahead', importedAt: '2026-09-09T12:00:00.000Z', lookaheadReplaced: 'Replaced by the lookahead of Sep 10, 2026',
  linkedScheduleItems: [{ id: 'look1-detail', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }] });
const newer = scheduleDocument('Alpha look 2', { scheduleRole: 'lookahead', importedAt: '2026-09-10T12:00:00.000Z' });
const STAY = 'This schedule file has tasks, so its category and projects stay as they are. Changed, its tasks could show again on every device (some twice, or on old dates), and Make Current on it could hide another project\'s tasks. To file it differently, delete it with its tasks, then upload it again.';

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
  updateDocument: jest.fn(async (_document: DAVEWebReferenceDocument) => undefined),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] as DAVEWebReadOnlySnapshot['projects'],
    scheduleItems: [],
    projectUpdates: [],
    referenceDocuments: [master, older, replaced, newer, memo],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
});

async function openDetails(screen: ReturnType<typeof render>, name: string) {
  fireEvent.press(screen.getByLabelText(`View ${name}`));
  fireEvent.press(await screen.findByLabelText(`Edit project document details for ${name}`));
  expect(screen.getByText('ECOS document details')).toBeTruthy();
}

// The first render of the whole desktop shell in a file is slow on a busy machine.
jest.setTimeout(60_000);

describe('the Projects of a schedule file with tasks stay as they are on the computer (review pass H4, H4S-1)', () => {
  it('a replaced lookahead and an older master: the Projects are shown, not offered; the form says why and saves nothing', async () => {
    for (const name of ['Alpha look 1', 'Alpha rev 1']) {
      const screen = render(<DesktopReadOnlyShell page="documents" />);
      await openDetails(screen, name);
      expect([name, screen.queryAllByRole('checkbox', { name: /Beta$/ }).length]).toEqual([name, 0]);
      expect([name, screen.queryAllByRole('radio', { name: 'Permit Card' }).length]).toEqual([name, 0]);
      expect(screen.getByText(STAY)).toBeTruthy();
      expect(screen.queryByText('Save Document Details')).toBeNull();
      fireEvent.press(screen.getByText('Cancel'));
      expect(screen.queryByText('ECOS document details')).toBeNull();
      expect(mockAuth.updateDocument).not.toHaveBeenCalled();
      screen.unmount();
    }
  });

  it('unchanged: a document that is not a schedule with tasks still offers its Projects and saves the ones ticked', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await openDetails(screen, 'Site memo');
    expect(screen.queryByText(STAY)).toBeNull();
    fireEvent.press(screen.getByRole('checkbox', { name: /Beta$/ }));
    await act(async () => { fireEvent.press(screen.getByText('Save Document Details')); });
    expect([...new Set(mockAuth.updateDocument.mock.calls[0][0].projectNames)]).toEqual(['Alpha', 'Beta']);
  });
});
