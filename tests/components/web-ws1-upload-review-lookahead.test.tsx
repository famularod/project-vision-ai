import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 2 (medium; 6 Oct 2026), on the page itself:
// "Add Project Documents" > Schedules > a file from this computer > "Review
// before upload". "How should Vitruvius use this schedule?" offers Lookahead,
// and what goes to the upload is marked as he chose. Synthetic data; the
// shell harness of desktop-lookahead-document.test.tsx.

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

describe('the web upload review offers Lookahead (WS1 item 2)', () => {
  const master = scheduleDocument('Alpha master', { isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z' });
  const tasks = [
    task('m-framing', 'Framing', '10/15/2026', '10/25/2026', 'batch-Alpha master'),
    task('m-roofing', 'Roofing', '11/02/2026', '11/20/2026', 'batch-Alpha master'),
    task('m-closeout', 'Closeout', '01/04/2027', '01/29/2027', 'batch-Alpha master'),
  ];
  const lookahead = () => csvFile('Alpha 3 Week Lookahead.csv', ['Framing,Alpha,Lot,10/18/2026,10/28/2026,70', 'Rough-in inspection,Alpha,Lot,10/29/2026,10/29/2026,']);
  const FULL = 'Full schedule (replaces). Use this file as the whole schedule for its projects. It is saved as a prior version first, and replaces the schedule in use for them when you choose Make Current Schedule.';
  const LOOKAHEAD = 'Lookahead / partial (adds to the master). Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay. It applies as soon as it is uploaded, and a newer lookahead for the same project replaces it.';

  beforeEach(() => workspace(tasks, [], [master]));

  it('asks how to use the schedule, with the suggestion and its reason, and uploads a lookahead as one', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, lookahead());

    expect(screen.getByText('How should Vitruvius use this schedule?')).toBeTruthy();
    expect(screen.getByText('Suggested: Lookahead / partial (adds to the master), because its name says “3 Week”. You can change this before uploading.')).toBeTruthy();
    expect(screen.getByLabelText(LOOKAHEAD).props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText(FULL).props.accessibilityState.checked).toBe(false);

    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    expect(prepared.document.scheduleRole).toBe('lookahead');
    expect(prepared.document.projectNames).toEqual(['Alpha']);
    expect(prepared.scheduleItems.map(item => [item.taskName, item.importedAsLookahead])).toEqual([['Framing', true], ['Rough-in inspection', true]]);
    expect(screen.getByText('Lookahead and 2 reviewed schedule tasks uploaded. It adds to the master schedule now, so there is nothing to make current.')).toBeTruthy();
  });

  it('"Full schedule" picked instead uploads it as every schedule before: to be made current', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, lookahead());
    fireEvent.press(screen.getByLabelText(FULL));
    expect(screen.getByLabelText(FULL).props.accessibilityState.checked).toBe(true);

    await pressUpload(screen);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    expect(prepared.document.scheduleRole).toBeUndefined();
    expect(prepared.scheduleItems.some(item => item.importedAsLookahead)).toBe(false);
    expect(screen.getByText('Document and 2 reviewed schedule tasks uploaded. Use Make Current when this schedule should replace the active version.')).toBeTruthy();
  });

  it('a lookahead with every task excluded is refused in plain words', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, lookahead());
    fireEvent.press(screen.getAllByText('Exclude')[0]);
    fireEvent.press(screen.getAllByText('Exclude')[0]);
    await pressUpload(screen);

    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText('A lookahead needs at least one task from the file. Keep a task in the list above, or choose Full schedule.')).toBeTruthy();
  });
});
