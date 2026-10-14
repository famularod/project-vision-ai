import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Build 232 round, item 10b, part 2 (13 Oct 2026), on the page itself: "Add
// Project Documents" > Schedules > every project ticked > a file whose rows
// are all one project's > "Review before upload". A full schedule is saved
// for the project its rows name (review pass 4, O-3: saved for every ticked
// project, Make Current Schedule then hid the other projects' tasks), and the
// review says so in one line before he uploads, where the suggestion is.
// Made-up projects; the shell harness of web-ws1-upload-review-lookahead.test.tsx.

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

const LONG = '4410 Harbor Retrofit';
const MID = '4475 Depot Retrofit';
const NEW = 'Pilot project';
const PROJECTS = [LONG, MID, NEW];

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

/** "Add Project Documents", every project ticked (the form starts with the first one ticked), then the file. */
async function chooseFileForEveryProject(screen: ReturnType<typeof render>, file: ReturnType<typeof csvFile>) {
  fireEvent.press(screen.getByLabelText('Add Project Documents'));
  expect(screen.getByRole('checkbox', { name: new RegExp(`${LONG}$`) }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(screen.getByRole('checkbox', { name: new RegExp(`${MID}$`) }));
  fireEvent.press(screen.getByRole('checkbox', { name: new RegExp(`${NEW}$`) }));
  PROJECTS.forEach(project => expect(screen.getByRole('checkbox', { name: new RegExp(`${project}$`) }).props.accessibilityState.checked).toBe(true));
  const input = screen.UNSAFE_getByProps({ 'aria-label': 'Choose file from this computer' });
  await act(async () => { input.props.onChange({ target: { files: [file], value: file.name } }); });
  expect(await screen.findByText('Review before upload')).toBeTruthy();
}

async function pressUpload(screen: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(screen.getByText('Upload Reviewed Document')); });
}

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
  const tasks = [task('a1', LONG, '03/02/2026', '03/20/2026'), task('a2', LONG, '06/01/2027', '07/01/2027'), task('b1', MID, '06/01/2026', '06/12/2026'), task('b2', MID, '10/19/2026', '10/30/2026')];
  mockAuth.snapshot = {
    projects: PROJECTS.map(name => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name }) as DAVEWebReadOnlySnapshot['projects'][number]),
    scheduleItems: tasks,
    knownScheduleItems: tasks,
    projectUpdates: [],
    referenceDocuments: [master(LONG), master(MID)],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
});

describe('the desktop\'s upload review says which projects a full schedule is saved for (Build 232 item 10b)', () => {
  const FULL = 'Full schedule (replaces). Use this file as the whole schedule for its projects. It is saved as a prior version first, and replaces the schedule in use for them when you choose Make Current Schedule.';
  const LOOKAHEAD = 'Lookahead / partial (adds to the master). Keep the master schedule. A task in both files shows once, with this file’s dates and progress. Tasks only in this file are added. The master’s other tasks stay. It applies as soon as it is uploaded, and a newer lookahead for the same project replaces it.';
  const SUGGESTED = 'Suggested: Full schedule (replaces), because there is no master schedule for Pilot project yet. You can change this before uploading.';
  const SAVED_FOR = 'Every task in this file is for Pilot project, so as a full schedule it will be saved for Pilot project only, not for every project ticked above.';
  const forTheNewProject = () => csvFile('Schedule A.csv', [`Pour footings,${NEW},Lot,10/26/2026,10/30/2026,`, `Set steel,${NEW},Lot,11/02/2026,11/06/2026,`, `Deck and detail,${NEW},Lot,11/09/2026,11/13/2026,`]);

  it('every project ticked, a file whose rows are all one project\'s: the line is under the suggestion, and the upload is for that project', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFileForEveryProject(screen, forTheNewProject());

    expect(screen.getByLabelText(FULL).props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(SUGGESTED)).toBeTruthy();
    expect(screen.getByText(SAVED_FOR)).toBeTruthy();
    // Lookahead chosen: a lookahead was always saved for its rows' projects, and the line is about a full schedule.
    fireEvent.press(screen.getByLabelText(LOOKAHEAD));
    expect(screen.queryByText(SAVED_FOR)).toBeNull();
    fireEvent.press(screen.getByLabelText(FULL));
    expect(screen.getByText(SAVED_FOR)).toBeTruthy();

    await pressUpload(screen);
    expect(mockAuth.uploadDocument).toHaveBeenCalledTimes(1);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    expect(prepared.document).toMatchObject({ projectNames: [NEW], projectName: NEW });
    expect(prepared.document.scheduleRole).toBeUndefined();
    expect(prepared.scheduleItems.map(item => item.projectName)).toEqual([NEW, NEW, NEW]);
  });

  it('a task given to another ticked project in the review: the line names both, and once the rows name every ticked project it is gone and every ticked project is saved', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFileForEveryProject(screen, forTheNewProject());
    // Each task offers the ticked projects (the last three choices so named; the first is the page's own project
    // filter). The first task goes to the second project, then the second task to the first.
    const taskChoice = (taskIndex: number, project: string) => screen.getAllByRole('radio', { name: project }).slice(-3)[taskIndex];
    fireEvent.press(taskChoice(0, MID));
    expect(screen.getByText('Every task in this file is for 4475 Depot Retrofit and Pilot project, so as a full schedule it will be saved for 4475 Depot Retrofit and Pilot project only, not for every project ticked above.')).toBeTruthy();
    fireEvent.press(taskChoice(1, LONG));
    expect(screen.queryByText(/^Every task in this file is for /)).toBeNull();

    await pressUpload(screen);
    const prepared = mockAuth.uploadDocument.mock.calls[0][0];
    expect(prepared.document).toMatchObject({ projectNames: PROJECTS, projectName: null });
    expect(prepared.scheduleItems.map(item => item.projectName)).toEqual([MID, LONG, NEW]);
  });
});
