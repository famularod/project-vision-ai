import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Review pass H4, H4S-2 (Low, caused by M1; 14 Oct 2026), on the page itself (the review's K8): Add Project Documents,
// Schedules, 6101 Quay Works ticked, a Microsoft Project PDF whose top line is 6102 Mill Yard with its tasks under it.
// The tasks said "the file names no project" and a button offered to file them all under Quay with one press. Now they
// say the file names 6102 Mill Yard, a grey line says how to tick it, there is no button, and Upload stays held.
// Made-up projects; the shell harness of the 4.88 page test, with the fourth review's PDF reading.

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
  // A PDF hands its positioned pages over, as the browser's reader would (the fourth review's page rig).
  extractECOSWebDocument: jest.fn(async ({ file }: { file: { text: string; pages?: unknown[] } }) => ({
    extractedText: file.text,
    extractedPages: file.pages ?? [],
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

type PickedFile = { name: string; type: string; size: number; text: string; pages?: unknown[]; arrayBuffer: () => Promise<ArrayBuffer> };
type Row = readonly [name: string, indent: number, start: string, finish: string];
/** A Microsoft Project PDF as the browser hands it over: its positioned page (review pass 10's page builder). */
function pdfFile(rows: readonly Row[]): PickedFile {
  const regions: unknown[] = [];
  const addRegion = (text: string, x: number, y: number, width = 0.04) => {
    regions.push({ id: `region-${regions.length + 1}`, text, label: text, x, y, width, height: 0.01, source: 'embedded_text', confidence: 1 });
  };
  ([['ID', 0.03], ['Task Name', 0.05], ['Duration', 0.31], ['Start', 0.36], ['Finish', 0.41], ['%', 0.46]] as const).forEach(([text, x]) => addRegion(text, x, 0.02));
  rows.forEach(([taskName, indent, start, finish], index) => {
    const id = String(index + 1);
    const y = 0.05 + index * 0.02;
    const taskX = 0.05 + indent * 0.007;
    regions.push({
      id: `activity-${id}`, text: `${id} ${taskName}`, label: `${id} ${taskName}`, x: 0.03, y, width: 0.26, height: 0.01, source: 'embedded_text', confidence: 1,
      constituentEvidence: [
        { id: `activity-${id}-id`, text: id, source: 'embedded_text', confidence: 1, bounds: { x: 0.03, y, width: 0.012, height: 0.01 } },
        { id: `activity-${id}-task`, text: taskName, source: 'embedded_text', confidence: 1, bounds: { x: taskX, y, width: 0.29 - taskX, height: 0.01 } },
      ],
    });
    addRegion('3 days', 0.31, y); addRegion(start, 0.36, y); addRegion(finish, 0.41, y); addRegion('0%', 0.46, y, 0.025);
  });
  const page = { pageNumber: 1, text: (regions as { text: string }[]).map(region => region.text).join('\n'), regions };
  const bytes = new TextEncoder().encode(page.text.padEnd(page.text.length + 40_000, ' '));
  return { name: 'Campus plan.pdf', type: 'application/pdf', size: bytes.byteLength, text: page.text, pages: [page], arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer };
}
const millPlan = () => pdfFile([[MILL, 0, '10/26/2026', '11/13/2026'], ['Pour deck', 1, '10/26/2026', '10/30/2026'], ['Framing', 1, '11/02/2026', '11/13/2026']]);

/** "Add Project Documents", the given projects ticked (the form starts with the first one ticked), then the file. */
async function chooseFile(screen: ReturnType<typeof render>, ticked: readonly string[], file: PickedFile) {
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

describe('a PDF whose top line is a project of his that is not ticked, on the page (review pass H4, H4S-2)', () => {
  it('PG-K8: Quay ticked, the PDF\'s top line 6102 Mill Yard: the tasks name it, the grey line says how to tick it, no button, Upload held', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    await chooseFile(screen, [QUAY], millPlan());

    expect(screen.getAllByText('Needs Project (the file names "6102 Mill Yard")')).toHaveLength(2);
    expect(screen.queryByText(/the file names no project/)).toBeNull();
    expect(screen.getByText('2 tasks need a project before you can upload: the file names their project "6102 Mill Yard", which is one of your projects but is not ticked. Choose a project for each of them above.')).toBeTruthy();
    expect(screen.getByText('"6102 Mill Yard" in the file is your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.')).toBeTruthy();
    expect(screen.queryByText(/^Use .* for (all \d+ tasks|the task) (named|with no project)/)).toBeNull();
    expect(uploadButtonDisabled(screen)).toBe(true);
    await pressUpload(screen);
    expect(mockAuth.uploadDocument).not.toHaveBeenCalled();
  });
});
