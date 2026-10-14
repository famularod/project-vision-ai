import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { extractECOSWebDocument } from '../../services/ECOSWebDocumentExtraction';

// High item 2, after the second independent review (the owner's instruction of 13 Oct 2026, the three high items;
// open item 2.33), on the page itself. PG5: the ticks changed while the file was still being read: the review made
// with the old ticks is not kept, and the file is chosen again with the ticks shown. PG7: a file name the app only
// guesses at gets a neutral line that names no project. PG8: one task given under two spellings of one unknown name
// is listed once. Made-up projects; the shell harness of the earlier high-2 page tests.

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
const tick = (screen: ReturnType<typeof render>, project: string) => fireEvent.press(screen.getByRole('checkbox', { name: new RegExp(`${project}$`) }));
const TICKS_CHANGED = 'The ticked projects changed while the file was being read, so its review was cleared. Choose the file again.';

describe('the desktop\'s upload review names only what the file names, and follows the ticks shown (High item 2, after the second review)', () => {
  it('PG5: Quay ticked, the file "6102" chosen; while it is read Mill is ticked and Quay unticked: the old review is not kept; chosen again, it is Mill\'s', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Add Project Documents'));
    await chooseSlowly(screen, fieldPlan('6102'), () => { tick(screen, MILL); tick(screen, QUAY); });

    expect(await screen.findByText(TICKS_CHANGED)).toBeTruthy();
    expect(screen.queryByText('Review before upload')).toBeNull();
    const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
    await act(async () => { input.props.onChange({ target: { files: [fieldPlan('6102')], value: 'Field plan.csv' } }); });
    expect(await screen.findByText('Review before upload')).toBeTruthy();
    fireEvent.press(screen.getByText('Use 6102 Mill Yard for all 3 tasks named "6102"'));
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect(uploaded.document.projectNames).toEqual([MILL]);
    expect(uploaded.scheduleItems.map(item => item.projectName)).toEqual([MILL, MILL, MILL]);
  });

  it('PG7: Quay ticked, the file "6102": no button, and the grey line names no project of his', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], fieldPlan('6102'));

    expect(screen.queryByText(/^Use .* for (all \d+ tasks|the task) named /)).toBeNull();
    expect(screen.getByText('"6102" in the file may stand for one of your other projects, so there is no button for all of them. Choose the project on each of these tasks above; if the right project is not offered, tick it under Projects above and choose the file again.')).toBeTruthy();
    expect(screen.queryByText(/looks like your project/)).toBeNull();
  });

  it('PG8: one task under "Shed Annex" and "Shed-Annex" on one day is listed once, and the one button gives both tasks Quay Works', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], csvFile('Field plan.csv', ['Footings,Shed Annex,Lot,10/26/2026,10/30/2026,', 'Footings,Shed-Annex,Lot,10/26/2026,10/30/2026,', 'Frame,Shed Annex,Lot,11/02/2026,11/06/2026,']));

    expect(screen.getAllByText('Footings')).toHaveLength(1);
    fireEvent.press(screen.getByText('Use 6101 Quay Works for all 2 tasks named "Shed Annex"'));
    await pressUpload(screen);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect(uploaded.scheduleItems.map(item => [item.taskName, item.projectName])).toEqual([['Footings', QUAY], ['Frame', QUAY]]);
  });
});
