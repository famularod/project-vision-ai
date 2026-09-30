import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Whole-app audit A5 pass 3 F5 (30 Sep 2026): Make Current counted only the
// tasks unique to a schedule's import, so a revision whose every task was
// unchanged (each re-homed into it, none of its own) said "Task Review
// Required" and could not be made current. It now counts every task the
// import contains. Synthetic data.

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
  name: string,
  isCurrent: boolean,
  importedAt: string,
  importedScheduleItemCount: number,
): DAVEWebReferenceDocument {
  return {
    id,
    name,
    originalFileName: `${name}.csv`,
    uri: '',
    mimeType: 'text/csv',
    category: 'Schedules',
    notes: '',
    isCurrent,
    importedAt,
    projectId: null,
    projectName: 'Alpha Tower',
    projectNames: ['Alpha Tower'],
    importBatchId: `batch-${id}`,
    cloudUpdatedAt: importedAt,
    // The one task is in both imports, so neither has a task of its own.
    linkedScheduleItems: [],
    importedScheduleItemCount,
  };
}

const framing: DAVEWebScheduleItem = {
  id: 'task-framing',
  scheduleProjectName: 'Alpha Tower',
  projectName: 'Alpha Tower',
  locationName: 'Level 1',
  taskName: 'Frame walls',
  startDate: '09/01/2026',
  finishDate: '09/05/2026',
  milestone: '',
  owner: 'Framing Co',
  contractor: '',
  percentComplete: 60,
  progressSource: 'project_manager',
  priority: 'High',
  status: 'In Progress',
  notes: '',
  importBatchId: 'batch-schedule-r1',
  alsoImportedInBatchIds: ['batch-schedule-r2'],
  sourceDocumentId: 'schedule-r1',
  createdAt: '2026-09-01T12:00:00.000Z',
  cloudUpdatedAt: '2026-09-10T12:00:00.000Z',
};

const current = scheduleDocument('schedule-r1', 'Alpha schedule r1', true, '2026-09-01T12:00:00.000Z', 1);
const unchangedRevision = scheduleDocument('schedule-r2', 'Alpha schedule r2', false, '2026-09-20T12:00:00.000Z', 1);
const emptyImport = scheduleDocument('schedule-empty', 'Alpha schedule scan', false, '2026-09-21T12:00:00.000Z', 0);

const snapshot: DAVEWebReadOnlySnapshot = {
  projects: [{ id: 'project-alpha', name: 'Alpha Tower' } as DAVEWebReadOnlySnapshot['projects'][number]],
  scheduleItems: [framing],
  projectUpdates: [],
  referenceDocuments: [current, unchangedRevision, emptyImport],
  refreshedAt: '2026-09-30T12:00:00.000Z',
};

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: snapshot.refreshedAt,
    lastAttemptAt: snapshot.refreshedAt,
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  setCurrentSchedule: jest.fn(async () => undefined),
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

describe('Make Current for a revised schedule (audit A5 pass 3 F5)', () => {
  beforeAll(() => {
    type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
    const root = globalThis as unknown as { window?: unknown };
    const browserWindow = (root.window ?? {}) as TestWindow;
    root.window = browserWindow;
    browserWindow.addEventListener = jest.fn();
    browserWindow.removeEventListener = jest.fn();
  });

  it('offers Make Current Schedule for a revision whose every task is unchanged, and makes it current', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);

    // One prior version with tasks, one with none: only the empty one needs review.
    expect(screen.getAllByText('Make Current Schedule')).toHaveLength(1);
    expect(screen.getAllByText('Task Review Required')).toHaveLength(1);

    fireEvent.press(screen.getByText('Make Current Schedule'));
    await waitFor(() => expect(mockAuth.setCurrentSchedule).toHaveBeenCalledWith(unchangedRevision));
    expect(screen.queryByText('Review and save the imported schedule tasks before making this schedule current.')).toBeNull();
  });
});
