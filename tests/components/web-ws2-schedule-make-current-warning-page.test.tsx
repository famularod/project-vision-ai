import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebReadOnlySnapshot, DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebScheduleRetirementCheck } from '../../services/DAVEWebScheduleActivation';

// Open item, web batch WS2 item 3 (6 Oct 2026), on the Documents page: Make
// Current Schedule asks first when it would retire ANOTHER project's
// schedule, naming the project, with Cancel. What it asks is the phone's
// sentence (tested in web-ws2-schedule-make-current-warning.test.ts); here,
// the page. Synthetic data; the harness of desktop-lookahead-document.test.tsx.

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

jest.mock('../../services/DAVEWebScheduleActivation', () => ({
  daveWebScheduleRetirementCheck: jest.fn(),
}));

function scheduleDocument(
  id: string,
  extra: Partial<DAVEWebReferenceDocument> = {},
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
    projectName: 'Alpha',
    projectNames: ['Alpha'],
    importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
    linkedScheduleItems: [],
    importedScheduleItemCount: 2,
    ...extra,
  };
}

const combined = scheduleDocument('Combined', { isCurrent: true, projectName: null, projectNames: ['Alpha', 'Beta'], importedAt: '2026-09-01T12:00:00.000Z' });
const alpha2 = scheduleDocument('Alpha rev 2', { importedAt: '2026-10-01T12:00:00.000Z' });
const ASKED = 'The schedule now current for Beta will be retired too. Beta is left with no current schedule and shows no schedule tasks until you set one.';

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
  setCurrentSchedule: jest.fn(async (_document: DAVEWebReferenceDocument) => 'schedule'),
  setCurrentDocument: jest.fn(async () => undefined),
  updateDocument: jest.fn(async () => undefined),
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

jest.setTimeout(30_000);

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
    referenceDocuments: [combined, alpha2],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
});

const asks = () => jest.mocked(daveWebScheduleRetirementCheck).mockResolvedValue({ ok: true, effects: [{ projectName: 'Beta', fallbackSchedule: null }], message: ASKED });
async function pressMakeCurrent(screen: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(screen.getAllByText('Make Current Schedule')[0]); });
}

describe('Make Current Schedule on the web asks before it retires another project\'s schedule (WS2 item 3)', () => {
  it('names the other project and what it is left with, and makes nothing current until he answers', async () => {
    asks();
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await pressMakeCurrent(screen);

    expect(screen.getByText('Change the current schedule?')).toBeTruthy();
    expect(screen.getByText('Making “Alpha rev 2” current changes more than its own project.')).toBeTruthy();
    expect(screen.getByText(ASKED)).toBeTruthy();
    expect(jest.mocked(daveWebScheduleRetirementCheck).mock.calls[0][0].id).toBe('Alpha rev 2');
    expect(mockAuth.setCurrentSchedule).not.toHaveBeenCalled();
  });

  it('Cancel leaves every schedule as it was', async () => {
    asks();
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await pressMakeCurrent(screen);
    fireEvent.press(screen.getByLabelText('Cancel making this schedule current'));

    expect(screen.queryByText('Change the current schedule?')).toBeNull();
    expect(mockAuth.setCurrentSchedule).not.toHaveBeenCalled();
  });

  it('"Make Current Anyway" makes it current, without asking the cloud a second time', async () => {
    asks();
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await pressMakeCurrent(screen);
    await act(async () => { fireEvent.press(screen.getByLabelText('Make Alpha rev 2 current anyway')); });

    expect(mockAuth.setCurrentSchedule).toHaveBeenCalledTimes(1);
    expect(mockAuth.setCurrentSchedule.mock.calls[0][0].id).toBe('Alpha rev 2');
    expect(daveWebScheduleRetirementCheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Change the current schedule?')).toBeNull();
  });

  it('when the cloud cannot say, nothing is made current and he is told', async () => {
    jest.mocked(daveWebScheduleRetirementCheck).mockResolvedValue({ ok: false, message: 'The shared schedules could not be read. Try again shortly.' });
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await pressMakeCurrent(screen);

    expect(screen.getByText('The shared schedules could not be read. Try again shortly.')).toBeTruthy();
    expect(mockAuth.setCurrentSchedule).not.toHaveBeenCalled();
  });

  it('guard: with no other project touched it is made current at once, as before', async () => {
    jest.mocked(daveWebScheduleRetirementCheck).mockResolvedValue({ ok: true, effects: [], message: '' });
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await pressMakeCurrent(screen);

    expect(mockAuth.setCurrentSchedule).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Change the current schedule?')).toBeNull();
  });
});
