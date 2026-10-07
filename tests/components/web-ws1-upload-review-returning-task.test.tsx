import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 1 (6 Oct 2026), on the page itself: "Add
// Project Documents" > Schedules > a file from this computer > "Review before
// upload" > "Upload Reviewed Document". A task one master left out and the
// file lists again is asked about in the phone's words, and Upload waits for
// his answer. Synthetic data; the shell harness of
// desktop-lookahead-document.test.tsx.

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

jest.mock('../../services/ECOSWebDocumentExtraction', () => ({
  ...jest.requireActual('../../services/ECOSWebDocumentExtraction'),
  extractECOSWebDocument: jest.fn(async ({ file }: { file: { text: string } }) => ({
    extractedText: file.text,
    extractedPages: [],
    extractionStatus: 'complete',
    extractionMethod: 'text',
    sourcePageCount: 1,
    searchablePageCount: 1,
  })),
}));

function scheduleDocument(id: string, extra: Partial<DAVEWebReferenceDocument> = {}): DAVEWebReferenceDocument {
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

function task(id: string, taskName: string, startDate: string, finishDate: string, importBatchId: string, extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id,
    itemType: 'Task',
    taskName,
    projectId: 'alpha',
    projectName: 'Alpha',
    scheduleProjectName: 'Alpha',
    locationName: 'Lot',
    startDate,
    finishDate,
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    importedFrom: `${importBatchId}.csv`,
    importBatchId,
    importedAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}

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

function workspace(shown: DAVEWebScheduleItem[], hidden: DAVEWebScheduleItem[], referenceDocuments: DAVEWebReferenceDocument[]) {
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
    scheduleItems: shown,
    knownScheduleItems: [...shown, ...hidden],
    projectUpdates: [],
    referenceDocuments,
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
}

/** A file from this computer, as the browser's file input hands it over. */
function csvFile(name: string, lines: readonly string[]) {
  const text = ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n');
  const bytes = new TextEncoder().encode(text);
  return { name, type: 'text/csv', size: bytes.byteLength, text, arrayBuffer: async () => bytes.buffer.slice(0) };
}

async function chooseFile(screen: ReturnType<typeof render>, file: ReturnType<typeof csvFile>) {
  fireEvent.press(screen.getByLabelText('Add Project Documents'));
  const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
  await act(async () => { input.props.onChange({ target: { files: [file], value: file.name } }); });
  expect(await screen.findByText('Review before upload')).toBeTruthy();
}

async function pressUpload(screen: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(screen.getByText('Upload Reviewed Document')); });
}

// The first render of the whole desktop shell in a file is slow on a busy machine.
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
});

describe('the web upload review asks about a task that was on an earlier schedule (WS1 item 1)', () => {
  const F = scheduleDocument('Master F', { importedAt: '2026-09-01T12:00:00.000Z' });
  const G = scheduleDocument('Master G', { isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z' });
  const framing = task('g-framing', 'Framing', '11/02/2026', '11/06/2026', 'batch-Master G');
  const paint = task('f-paint', 'Paint', '11/02/2026', '11/06/2026', 'batch-Master F', {
    percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', notes: 'Primer on',
  });
  const H = () => csvFile('Master H.csv', ['Framing,Alpha,Lot,11/02/2026,11/06/2026,', 'Paint,Alpha,Lot,11/09/2026,11/13/2026,']);
  const SAME = 'Earlier Paint, 11/2–11/6 · 60% · “Primer on”: The same task: 11/9–11/13 · no %';
  const NEW = 'Earlier Paint, 11/2–11/6 · 60% · “Primer on”: New work';

  beforeEach(() => workspace([framing], [paint], [F, G]));

  it('shows the phone\'s check with what the task had, "New work" selected, and Upload waits', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, H());

    expect(screen.getByText('Paint in Lot was on an earlier schedule: the same task, or new work?')).toBeTruthy();
    expect(screen.getByText('This task was on an earlier schedule and is not in your list now. If this file brings the same task back, its percent, notes and what you set on it come back with it. Nothing is carried unless you say it is the same task.')).toBeTruthy();
    expect(screen.getByText('Earlier Paint: 11/2–11/6 · 60% · “Primer on”')).toBeTruthy();
    expect(screen.getByLabelText(SAME).props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText(NEW).props.accessibilityState.checked).toBe(true);

    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm whether Paint in Lot is the same task or new work before uploading.')).toBeTruthy();
  });

  it('"The same task" goes to the upload as his answer for that row', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, H());
    fireEvent.press(screen.getByLabelText(SAME));
    await pressUpload(screen);

    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    const row = prepared.scheduleItems.find(item => item.taskName === 'Paint')!;
    expect(prepared.pairingChoices).toEqual({ [row.id]: 'f-paint' });
  });

  it('"New work", confirmed, goes to the upload as a new task', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, H());
    fireEvent.press(screen.getByLabelText('Confirm: Paint in Lot was on an earlier schedule: the same task, or new work?'));
    await pressUpload(screen);

    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    const row = prepared.scheduleItems.find(item => item.taskName === 'Paint')!;
    expect(prepared.pairingChoices).toEqual({ [row.id]: null });
  });
});
