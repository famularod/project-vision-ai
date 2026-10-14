import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { extractECOSWebDocument } from '../../services/ECOSWebDocumentExtraction';

// Review pass H3, H3S-4 (Low, older; 13 Oct 2026), on the page itself: Add Project Documents, Schedules, a file whose
// reading takes a moment (a photo or a PDF); while it is read he switches the document type to Permit Card. The
// review made for a schedule then appeared under Permit Card, listing schedule tasks, and Upload saved a schedule.
// As review pass 2's ticks (2c): a review made under another document type than the one shown is cleared, with a
// notice, and he chooses the file again. Changed and changed back while reading, the review stands. Made-up projects;
// the shell harness of the high-2c page test.

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
  formatVitruviusDesktopGreeting: () => 'Good morning',
  readVitruviusDesktopDisplayName: () => 'Manager',
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

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const PROJECTS = [QUAY, MILL, SHED];

function master(project: string): DAVEWebReferenceDocument {
  return {
    id: `${project} master`, name: `${project} master`, originalFileName: `${project} master.csv`, uri: '', mimeType: 'text/csv',
    category: 'Schedules', notes: '', isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z', projectId: null,
    projectName: project, projectNames: [project], importBatchId: `batch-${project}`, cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
    linkedScheduleItems: [], importedScheduleItemCount: 2,
  };
}

function task(id: string, project: string, startDate: string, finishDate: string): DAVEWebScheduleItem {
  return {
    id, itemType: 'Task', taskName: `Task ${id}`, projectId: null, projectName: project, scheduleProjectName: project,
    locationName: 'Lot', startDate, finishDate, milestone: '', owner: '', contractor: '', percentComplete: 0,
    priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', importedFrom: `${project} master.csv`,
    importBatchId: `batch-${project}`, importedAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
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

/** A file from this computer, as the browser's file input hands it over. */
function csvFile(name: string, lines: readonly string[]) {
  const text = ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n');
  const bytes = new TextEncoder().encode(text);
  return { name, type: 'text/csv', size: bytes.byteLength, text, arrayBuffer: async () => bytes.buffer.slice(0) };
}

/** "Add Project Documents", the given projects ticked (the form starts with the first one ticked), then the file. */
async function chooseFile(screen: ReturnType<typeof render>, ticked: readonly string[], file: ReturnType<typeof csvFile>) {
  fireEvent.press(screen.getByLabelText('Add Project Documents'));
  expect(screen.getByRole('checkbox', { name: new RegExp(`${QUAY}$`) }).props.accessibilityState.checked).toBe(true);
  ticked.filter(project => project !== QUAY).forEach(project => fireEvent.press(screen.getByRole('checkbox', { name: new RegExp(`${project}$`) })));
  const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
  await act(async () => { input.props.onChange({ target: { files: [file], value: file.name } }); });
  expect(await screen.findByText('Review before upload')).toBeTruthy();
}

async function pressUpload(screen: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(screen.getByText('Upload Reviewed Document')); });
}

const uploadButtonDisabled = (screen: ReturnType<typeof render>) => Boolean(screen.getByRole('button', { name: 'Upload Reviewed Document' }).props.accessibilityState?.disabled);
const fieldPlan = (project: string) => csvFile('Field plan.csv', [
  `Pour footings,${project},Lot,10/26/2026,10/30/2026,`, `Set steel,${project},Lot,11/02/2026,11/06/2026,`, `Deck and detail,${project},Lot,11/09/2026,11/13/2026,`,
]);

// The first render of the whole desktop shell in a file is slow on a busy machine.
jest.setTimeout(60_000);

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
  const tasks = [task('q1', QUAY, '03/02/2026', '03/20/2026'), task('q2', QUAY, '06/01/2027', '07/01/2027'), task('m1', MILL, '06/01/2026', '06/12/2026'), task('m2', MILL, '10/19/2026', '10/30/2026')];
  const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  mockAuth.snapshot = {
    projects: PROJECTS.map(name => ({ id: id(name), name }) as DAVEWebReadOnlySnapshot['projects'][number]),
    openCloudProjects: PROJECTS.map(name => ({ id: id(name), name })),
    scheduleItems: tasks,
    knownScheduleItems: tasks,
    projectUpdates: [],
    referenceDocuments: [master(QUAY), master(MILL)],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
});

/** The file is chosen, but the browser has not finished reading it: the ticks are changed meanwhile. */
async function chooseSlowly(screen: ReturnType<typeof render>, file: ReturnType<typeof csvFile>, meanwhile: () => void) {
  let release: () => void = () => undefined;
  (extractECOSWebDocument as jest.Mock).mockImplementationOnce(({ file: chosen }: { file: { text: string } }) => new Promise(resolve => {
    release = () => resolve({ extractedText: chosen.text, extractedPages: [], extractionStatus: 'complete', extractionMethod: 'text', sourcePageCount: 1, searchablePageCount: 1 });
  }));
  const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
  await act(async () => { input.props.onChange({ target: { files: [file], value: file.name } }); });
  meanwhile();
  // The rest of the read (the fingerprint, the review) runs inside act, so the page has settled before it is read.
  await act(async () => {
    release();
    for (let turn = 0; turn < 10; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
  });
}
const TYPE_CHANGED = 'The document type changed while the file was being read, so its review was cleared. Choose the file again.';
const quayPlan = () => fieldPlan(QUAY);

describe('the desktop\'s upload review follows the document type shown (review pass H3, H3S-4)', () => {
  it('PGT1: a schedule file for Quay; while it is read he picks Permit Card: the review is cleared and nothing is uploaded; chosen again, it is a Permit Card', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Add Project Documents'));
    await chooseSlowly(screen, quayPlan(), () => { fireEvent.press(screen.getByRole('radio', { name: 'Permit Card' })); });

    expect(await screen.findByText(TYPE_CHANGED)).toBeTruthy();
    expect(screen.queryByText('Review before upload')).toBeNull();
    expect(screen.queryByText(/schedule activit(y|ies) extracted/)).toBeNull();
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();

    // He chooses the file again, under the type shown: it is reviewed and uploaded as a Permit Card, with no schedule task.
    const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
    await act(async () => { input.props.onChange({ target: { files: [quayPlan()], value: 'Field plan.csv' } }); });
    expect(await screen.findByText('Review before upload')).toBeTruthy();
    expect(screen.queryByText(TYPE_CHANGED)).toBeNull();
    await pressUpload(screen);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect([uploaded.document.category, uploaded.scheduleItems.length]).toEqual(['Permit Card', 0]);
  });

  it('PGT2 (unchanged): the type changed and changed back while the file is read: the review stands, as a schedule, with no notice', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Add Project Documents'));
    await chooseSlowly(screen, quayPlan(), () => {
      fireEvent.press(screen.getByRole('radio', { name: 'Permit Card' }));
      fireEvent.press(screen.getByRole('radio', { name: 'Schedules' }));
    });

    expect(await screen.findByText('Review before upload')).toBeTruthy();
    expect(screen.queryByText(TYPE_CHANGED)).toBeNull();
    await pressUpload(screen);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect([uploaded.document.category, uploaded.scheduleItems.map(item => item.projectName)]).toEqual(['Schedules', [QUAY, QUAY, QUAY]]);
  });
});
