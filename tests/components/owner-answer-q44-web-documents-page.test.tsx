import { render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Owner answer Q44 (6 Oct 2026), on the web's Documents page itself: a
// compliance document the phone archived is hidden on every device and kept
// in the cloud, so the page does not list it and the side bar does not count
// it. With no archived mark (before the owner's database change) the page is
// what it was. Synthetic data; the shell harness of
// web-ws1-upload-review-returning-task.test.tsx.

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
  updateDocument: jest.fn(async () => undefined),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(async (_prepared: DAVEWebPreparedUpload) => undefined),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

function sharedDocument(id: string, category: string): DAVEWebReferenceDocument {
  return {
    id, name: id, originalFileName: `${id}.pdf`, uri: '', mimeType: 'application/pdf', category, notes: '', isCurrent: false,
    importedAt: '2026-10-05T15:59:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: null,
    cloudUpdatedAt: '2026-10-05T16:00:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
  };
}

function workspace(archivedDocumentIds?: readonly string[]) {
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
    scheduleItems: [], knownScheduleItems: [], projectUpdates: [],
    referenceDocuments: [sharedDocument('Grading permit', 'Permit Card'), sharedDocument('Site contract', 'Contract')],
    ...(archivedDocumentIds ? { archivedDocumentIds } : {}),
    refreshedAt: '2026-10-06T12:00:00.000Z',
  };
}

describe('the web Documents page and an archived compliance document (owner answer Q44)', () => {
  it('with no archived mark (before the database change) both documents are listed', () => {
    workspace();
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.queryAllByText('Grading permit').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Site contract').length).toBeGreaterThan(0);
    screen.unmount();
  });

  it('the document the cloud marks archived is not listed anywhere on the page; the other one is', () => {
    workspace(['Grading permit']);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.queryAllByText('Grading permit').length).toBe(0);
    expect(screen.queryAllByText(/Grading permit/).length).toBe(0);
    expect(screen.queryAllByText('Site contract').length).toBeGreaterThan(0);
    screen.unmount();
  });

  it('restored (the mark gone at the next read): listed again', () => {
    workspace(['Grading permit']);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.queryAllByText('Grading permit').length).toBe(0);
    workspace([]);
    screen.rerender(<DesktopReadOnlyShell page="documents" />);
    expect(screen.queryAllByText('Grading permit').length).toBeGreaterThan(0);
    screen.unmount();
  });
});


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
});
