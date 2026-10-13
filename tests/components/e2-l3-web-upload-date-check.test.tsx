import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review pass 1, L3 (older), on the web: "Add Project Documents" > Schedules >
// a file from this computer > "Review before upload". A task whose date is
// outside 2000 through 2100 (a year typed 0202 in the file) is flagged "check
// this date" on its row before the upload. The date is not changed, and the
// upload is not refused. Synthetic data; the shell harness of
// web-ws1-upload-review-lookahead.test.tsx.

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

describe('L3: the web upload review flags a date outside 2000 through 2100', () => {
  const master = scheduleDocument('Alpha master', { isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z' });
  beforeEach(() => workspace([task('m-framing', 'Framing', '10/15/2026', '10/25/2026', 'batch-Alpha master')], [], [master]));

  it('a start of 5/1/0202 and a finish of 12/31/9999 are each named on their row (was: nothing said)', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, csvFile('Alpha schedule.csv', [
      'Grade pad,Alpha,Lot,5/1/0202,10/20/2026,',
      'Close out,Alpha,Lot,10/21/2026,12/31/9999,',
      'Roofing,Alpha,Lot,11/02/2026,11/20/2026,',
    ]));
    const flags = screen.getAllByText(/^Check this date: /).map(node => String(node.props.children));
    expect(flags).toHaveLength(2);
    // The import writes a year below 1000 back with three digits; the review names the date as it now holds it.
    expect(flags).toEqual([
      'Check this date: the start date 05/01/202 is outside 2000 to 2100.',
      'Check this date: the finish date 12/31/9999 is outside 2000 to 2100.',
    ]);
  });

  it('the flag does not stop the upload, and the dates go up exactly as the review held them', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, csvFile('Alpha schedule.csv', ['Grade pad,Alpha,Lot,5/1/0202,5/4/0202,']));
    expect(screen.getAllByText(/^Check this date: /)).toHaveLength(2);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const [uploaded] = mockAuth.uploadDocument.mock.calls[0][0].scheduleItems;
    expect([uploaded.startDate, uploaded.finishDate]).toEqual(['05/01/202', '05/04/202']);
  });

  it('a row he excludes takes its flag with it', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, csvFile('Alpha schedule.csv', [
      'Grade pad,Alpha,Lot,5/1/0202,5/4/0202,',
      'Roofing,Alpha,Lot,11/02/2026,11/20/2026,',
    ]));
    fireEvent.press(screen.getAllByText('Exclude')[0]);
    expect(screen.queryByText(/^Check this date: /)).toBeNull();
  });

  // Guard: this already holds.
  it('ordinary dates are not flagged', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, csvFile('Alpha schedule.csv', ['Roofing,Alpha,Lot,11/02/2026,11/20/2026,']));
    expect(screen.queryByText(/^Check this date: /)).toBeNull();
  });
});
