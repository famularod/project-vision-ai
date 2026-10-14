import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// High item 2 (the owner's instruction of 13 Oct 2026, the three high items; open item 2.33), on the page itself:
// "Add Project Documents" > Schedules > ticks > a file whose Project column names no project of his ("6101" for
// 6101 Quay Works) > "Review before upload". Each such task is listed as needing a project, "Upload Reviewed
// Document" is held with one line saying how many and why, and with one project ticked and one name in the file
// one button gives them that project. Nothing is given a project without his press. Made-up projects; the shell
// harness of b232-10b-desktop-upload-review-says-which-projects.test.tsx.

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
const uploadedRows = () => (mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload).scheduleItems.map(item => [item.taskName, item.projectName, item.scheduleProjectName]);
const fieldPlan = (project: string) => csvFile('Field plan.csv', [
  `Pour footings,${project},Lot,10/26/2026,10/30/2026,`, `Set steel,${project},Lot,11/02/2026,11/06/2026,`, `Deck and detail,${project},Lot,11/09/2026,11/13/2026,`,
]);
const HELD_6101 = '3 tasks need a project before you can upload: the file names their project "6101", which is not one of your open projects. Choose a project for each of them above.';

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

describe('the desktop\'s upload review holds a task whose project is none of his (High item 2)', () => {
  it('one project ticked, the file says "6101": each task "Needs Project", the upload held with one line, then the one button', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], fieldPlan('6101'));

    expect(screen.getAllByText('Needs Project (the file names "6101") · Lot')).toHaveLength(3);
    expect(screen.getByText(HELD_6101)).toBeTruthy();
    expect(uploadButtonDisabled(screen)).toBe(true);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Use 6101 Quay Works for all 3 tasks named "6101"'));
    expect(screen.queryByText(HELD_6101)).toBeNull();
    expect(screen.queryByText(/^Use 6101 Quay Works for/)).toBeNull();
    expect(screen.getAllByText('6101 Quay Works · Lot')).toHaveLength(3);
    expect(screen.getByText('3 tasks named "6101" in the file will be saved under 6101 Quay Works.')).toBeTruthy();
    expect(uploadButtonDisabled(screen)).toBe(false);

    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadedRows()).toEqual([['Pour footings', QUAY, QUAY], ['Set steel', QUAY, QUAY], ['Deck and detail', QUAY, QUAY]]);
    expect((mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload).document.projectNames).toEqual([QUAY]);
  });

  it('one project ticked and two names in the file: no one button; each task offers the ticked project, and the upload waits for the last', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], csvFile('Field plan.csv', [`Pour footings,6101,Lot,10/26/2026,10/30/2026,`, `Set steel,Quay,Lot,11/02/2026,11/06/2026,`]));

    expect(screen.getByText('2 tasks need a project before you can upload: the file names their projects "6101" and "Quay", which are not among your open projects. Choose a project for each of them above.')).toBeTruthy();
    expect(screen.queryByText(/^Use 6101 Quay Works for/)).toBeNull();
    // The page's own project filter has the first radio of that name; each waiting task has one.
    const choice = (index: number) => screen.getAllByRole('radio', { name: QUAY }).slice(-2)[index];
    fireEvent.press(choice(0));
    expect(uploadButtonDisabled(screen)).toBe(true);
    expect(screen.getByText('1 task needs a project before you can upload: the file names its project "Quay", which is not one of your open projects. Choose a project for it above.')).toBeTruthy();
    fireEvent.press(screen.getAllByRole('radio', { name: QUAY }).slice(-1)[0]);
    expect(uploadButtonDisabled(screen)).toBe(false);
    expect(screen.getByText('1 task named "6101" in the file will be saved under 6101 Quay Works. 1 task named "Quay" in the file will be saved under 6101 Quay Works.')).toBeTruthy();

    await pressUpload(screen);
    expect(uploadedRows()).toEqual([['Pour footings', QUAY, QUAY], ['Set steel', QUAY, QUAY]]);
  });

  it('every project ticked and two unknown names: held until he gives each task a project; then uploaded under the projects he chose', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, PROJECTS, csvFile('Field plan.csv', [`Footings,6101,Lot,10/26/2026,10/30/2026,`, `Frame,Shed,Lot,11/02/2026,11/06/2026,`, `Roof on,6101,Lot,11/09/2026,11/13/2026,`]));

    expect(screen.getByText('3 tasks need a project before you can upload: the file names their projects "6101" and "Shed", which are not among your open projects. Choose a project for each of them above.')).toBeTruthy();
    expect(screen.queryByText(/^Use .* for (all \d+ tasks|the task) named /)).toBeNull();
    const taskChoice = (taskIndex: number, project: string) => screen.getAllByRole('radio', { name: project }).slice(-3)[taskIndex];
    fireEvent.press(taskChoice(0, SHED));
    fireEvent.press(taskChoice(1, SHED));
    expect(uploadButtonDisabled(screen)).toBe(true);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();
    fireEvent.press(taskChoice(2, MILL));
    expect(uploadButtonDisabled(screen)).toBe(false);

    await pressUpload(screen);
    expect(uploadedRows()).toEqual([['Footings', SHED, SHED], ['Frame', SHED, SHED], ['Roof on', MILL, MILL]]);
  });

  it('a name the desktop lists only because tasks were saved under it is not one of his open projects: its tasks wait', async () => {
    // As in an account where an earlier upload already filed tasks under "6101": the desktop lists "6101" (no cloud row).
    const snapshot = mockAuth.snapshot!;
    mockAuth.snapshot = { ...snapshot, projects: [...snapshot.projects, { id: null, name: '6101' } as DAVEWebReadOnlySnapshot['projects'][number]] };
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], fieldPlan('6101'));

    expect(screen.getByText(HELD_6101)).toBeTruthy();
    expect(uploadButtonDisabled(screen)).toBe(true);
  });
});
