import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Open item 2.34 (review pass 6, O-8; 13 Oct 2026), on the page itself: Documents, an older schedule file, Edit
// Project Document Details. Its Category was offered for change, and filed as a Report its tasks were listed again
// on every device (each one a newer schedule moved, twice). The form now shows the Category as it is, says why it
// stays, and saves the rest as before; a document that is not a schedule with tasks keeps every category choice.
// Made-up projects; the shell harness of desktop-lookahead-document.test.tsx.

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
// CHANGED by review pass H4, H4S-1 (14 Oct 2026): the words now speak of the category and the projects.
const STAYS = 'This schedule file has tasks, so its category and projects stay as they are. Changed, its tasks could show again on every device (some twice, or on old dates), and Make Current on it could hide another project\'s tasks. To file it differently, delete it with its tasks, then upload it again.';

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
    referenceDocuments: [master, older, memo],
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

describe('the Category of a schedule file with tasks stays as it is on the computer (open item 2.34)', () => {
  it('an older schedule file: no other Category is offered, the form says why, and Save Document Details keeps it under Schedules', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await openDetails(screen, 'Alpha rev 1');

    // (No document here is filed as a Permit Card or a Drawing, so only the form could offer those.)
    expect(screen.queryAllByRole('radio', { name: 'Permit Card' })).toHaveLength(0);
    expect(screen.queryAllByRole('radio', { name: 'Drawing' })).toHaveLength(0);
    expect(screen.getByText(STAYS)).toBeTruthy();
    // CHANGED by review pass H4, H4S-1 (14 Oct 2026): its Projects stay too, so the form offers no
    // project and nothing to save (before: he ticked Beta as well and Save Document Details kept the category only).
    expect(screen.queryAllByRole('checkbox', { name: /Beta$/ })).toHaveLength(0);
    expect(screen.queryByText('Save Document Details')).toBeNull();
    expect(mockAuth.updateDocument).not.toHaveBeenCalled();
  });

  it('unchanged: a document that is not a schedule with tasks keeps every category choice and is saved under the one chosen', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await openDetails(screen, 'Site memo');

    expect(screen.queryByText(STAYS)).toBeNull();
    fireEvent.press(screen.getAllByRole('radio', { name: 'Permit Card' }).slice(-1)[0]);
    await act(async () => { fireEvent.press(screen.getByText('Save Document Details')); });
    expect(mockAuth.updateDocument.mock.calls[0][0]).toMatchObject({ id: 'Site memo', category: 'Permit Card' });
  });
});
