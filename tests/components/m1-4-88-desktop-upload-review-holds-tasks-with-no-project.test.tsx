import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item 4.88 (review pass 6, what is left of O-3; 13 Oct 2026), on the page itself: Add Project Documents,
// Schedules. A file with no Project column holds the upload until each task has a project, says so in its own words,
// and is then saved as a full schedule only for the project its tasks were given; with one project ticked one button
// gives it to them. A row naming a project of his that is not ticked is held with no one button, and the page says
// which project and how to tick it. Made-up projects; the shell harness of the earlier high-2 page tests.

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
function csvFile(name: string, header: string, lines: readonly string[]) {
  const text = [header, ...lines].join('\n');
  const bytes = new TextEncoder().encode(text);
  return { name, type: 'text/csv', size: bytes.byteLength, text, arrayBuffer: async () => bytes.buffer.slice(0) };
}
const noProjectColumn = () => csvFile('Field plan.csv', 'Task,Area,Start,Finish,Percent Complete', [
  'Pour footings,Lot,10/26/2026,10/30/2026,', 'Set steel,Lot,11/02/2026,11/06/2026,', 'Deck and detail,Lot,11/09/2026,11/13/2026,',
]);
const millRows = () => csvFile('Field plan.csv', 'Task,Project,Area,Start,Finish,Percent Complete', [
  `Mill gutters,${MILL},Lot,11/02/2026,11/06/2026,`, `Mill doors,${MILL},Lot,11/09/2026,11/13/2026,`,
]);

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
const FULL = 'Full schedule (replaces). Use this file as the whole schedule for its projects. It is saved as a prior version first, and replaces the schedule in use for them when you choose Make Current Schedule.';

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

describe('the desktop\'s upload review holds a task the file names no project for, or names an unticked project for (open item 4.88)', () => {
  it('PG1: every project ticked, no Project column: held in its own words; each task given Garden shed, the full schedule is for Garden shed only', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, PROJECTS, noProjectColumn());

    expect(screen.getAllByText('Needs Project (the file names no project) · Lot')).toHaveLength(3);
    expect(screen.getByText('3 tasks need a project before you can upload: the file names no project for them. Choose a project for each of them above.')).toBeTruthy();
    expect(screen.queryByText(/^Use .* for (all \d+ tasks|the task) (named|with no project)/)).toBeNull();
    expect(uploadButtonDisabled(screen)).toBe(true);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();

    // Each task offers the ticked projects (the last three choices so named; the first is the page's own filter).
    for (let index = 0; index < 3; index += 1) fireEvent.press(screen.getAllByRole('radio', { name: SHED }).slice(-3)[index]);
    expect(screen.getByText('3 tasks with no project in the file will be saved under Garden shed.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(FULL));
    expect(screen.getByText('Every task as listed above is for Garden shed, so as a full schedule it will be saved for Garden shed only, not for every project ticked above.')).toBeTruthy();
    expect(uploadButtonDisabled(screen)).toBe(false);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect(uploaded.document).toMatchObject({ projectNames: [SHED], projectName: SHED });
    expect(uploaded.scheduleItems.map(item => [item.projectName, item.scheduleProjectName])).toEqual([[SHED, SHED], [SHED, SHED], [SHED, SHED]]);
  });

  it('PG2: one project ticked, no Project column: one button gives it to the three tasks, then the upload goes for that project', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], noProjectColumn());

    expect(uploadButtonDisabled(screen)).toBe(true);
    fireEvent.press(screen.getByText('Use 6101 Quay Works for all 3 tasks with no project in the file'));
    expect(screen.getByText('3 tasks with no project in the file will be saved under 6101 Quay Works.')).toBeTruthy();
    expect(uploadButtonDisabled(screen)).toBe(false);
    await pressUpload(screen);
    const uploaded = mockAuth.uploadDocument.mock.calls[0][0] as DAVEWebPreparedUpload;
    expect(uploaded.document.projectNames).toEqual([QUAY]);
    expect(uploaded.scheduleItems.map(item => item.projectName)).toEqual([QUAY, QUAY, QUAY]);
  });

  it('PG3: Quay ticked, rows that name Mill Yard: held, no one button, and a grey line says Mill Yard is not ticked and how to tick it', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], millRows());

    expect(screen.getAllByText('Needs Project (the file names "6102 Mill Yard") · Lot')).toHaveLength(2);
    expect(screen.getByText('2 tasks need a project before you can upload: the file names their project "6102 Mill Yard", which is one of your projects but is not ticked. Choose a project for each of them above.')).toBeTruthy();
    expect(screen.getByText('"6102 Mill Yard" in the file is your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.')).toBeTruthy();
    expect(screen.queryByText(/^Use .* for (all \d+ tasks|the task) (named|with no project)/)).toBeNull();
    expect(uploadButtonDisabled(screen)).toBe(true);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();
  });
});
