import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// T1b (14 Oct 2026), review pass 6 H6S-1 (caused by d9557b83, open item 3.6), the reviewer's cases on the computer's
// Schedule page (his rig, hrv6s-circle). A circle through a phase could be saved: (a) a new task ticked to start after
// Paving (which starts after the phase Sitework) and THEN put in Sitework; (b) from a tab that had not seen Paving
// linked to Sitework, Fence (after Paving) put in Sitework. Then the Gantt named Paving and Sitework, never the task
// that closed the circle, and "Apply dates" was off. Now both are refused, naming that task. Synthetic data.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children) };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/schedule',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({ loadDAVEWebReadOnlySnapshot: jest.fn() }));

const YARD = 'Alpha Yard';
const YARD_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';

function task(id: string, taskName: string, predecessors: string[] = [], extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id, projectId: YARD_ID, itemType: 'Task', scheduleProjectName: YARD, projectName: YARD, projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot', taskName, startDate: '2026-10-05', finishDate: '2026-10-09', milestone: '', owner: 'Project manager',
    contractor: '', durationDays: 5, percentComplete: 0, progressSource: 'project_manager', progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'David', priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}
const phase = (id: string, taskName: string, extra: Partial<DAVEWebScheduleItem> = {}) => task(id, taskName, [], { isSummary: true, ...extra });
/** Sitework holds Grading and Trenching. Paving starts after Sitework. Fence starts after Paving. */
const site = (pavingAfterSitework = true) => [
  phase('sitework', 'Sitework', { wbsCode: '1' }),
  task('grading', 'Grading', [], { parentItemId: 'sitework', wbsCode: '1.1' }),
  task('trenching', 'Trenching', [], { parentItemId: 'sitework', wbsCode: '1.2', finishDate: '2026-10-14', durationDays: 8 }),
  task('paving', 'Paving', pavingAfterSitework ? ['sitework'] : [], { startDate: '2026-10-15', finishDate: '2026-10-21', wbsCode: '2' }),
  task('fence', 'Fence', ['paving'], { startDate: '2026-10-22', finishDate: '2026-10-28', wbsCode: '3' }),
];

const mockAuth: Record<string, any> = {
  phase: 'ready', userEmail: 'david@example.com', snapshot: null, refreshSnapshot: jest.fn(async () => true),
  createTask: jest.fn(), updateTask: jest.fn(), updateTasks: jest.fn(), deleteTask: jest.fn(),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({ useDesktopAuth: () => mockAuth }));

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
  mockAuth.createTask.mockResolvedValue(undefined);
});

/** `shown`: what this tab shows; `cloud`: what the cloud holds when the save reads it. */
function page(shown: DAVEWebScheduleItem[], cloud: DAVEWebScheduleItem[] = shown) {
  mockAuth.snapshot = {
    projects: [{ id: YARD_ID, name: YARD }], openCloudProjects: [{ id: YARD_ID, name: YARD }],
    scheduleItems: shown, knownScheduleItems: shown, projectUpdates: [], referenceDocuments: [], refreshedAt: '2026-10-06T14:00:02.000Z',
  };
  jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue({ scheduleItems: cloud, knownScheduleItems: cloud } as never);
  return render(<DesktopSchedulePage tasks={shown} projects={[YARD]} selectedProject={null} />);
}
const choose = (screen: ReturnType<typeof render>, name: string) => fireEvent.press(screen.getAllByRole('checkbox').find(choice =>
  within(choice).getAllByText(/\S/).some(node => [node.props.children].flat().join('').includes(name)))!);
const putIn = (screen: ReturnType<typeof render>, phaseId: string) =>
  act(() => { screen.getByLabelText('Parent phase').props.onChange({ target: { value: phaseId } }); });

const CURB = '“Curb” would close a circle: “Curb” is in the phase “Sitework”, “Paving” starts after the phase “Sitework”, and “Curb” starts after “Paving”. The schedule could not place them. Untick “Paving”, or choose another parent phase for “Curb”, and save again.';
const FENCE = '“Fence” would close a circle: “Fence” is in the phase “Sitework”, “Paving” starts after the phase “Sitework”, and “Fence” starts after “Paving”. The schedule could not place them. Untick “Paving”, or choose another parent phase for “Fence”, and save again.';
const ELSEWHERE = 'With what has been saved on another device or in another browser tab, ';

describe('every save road refuses a circle through a phase (T1b; the reviewer\'s cases)', () => {
  it('C1: a new task ticked after Paving, then put in Sitework: Create Task is refused, naming Curb; nothing is saved', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Curb');
    choose(screen, 'Paving');
    putIn(screen, 'sitework');
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });

    expect(screen.getByText(`Not saved. ${CURB}`)).toBeTruthy();
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });

  it('C1 from a tab that has not seen Paving linked to Sitework: refused by the cloud\'s links, and it says so', async () => {
    const screen = page(site(false), site(true));
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Curb');
    choose(screen, 'Paving');
    putIn(screen, 'sitework');
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });

    expect(screen.getByText(`Not saved. ${ELSEWHERE}${CURB}`)).toBeTruthy();
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });

  it('C4: Fence put in Sitework from a tab that has not seen Paving linked to Sitework: Save Changes reads the cloud and is refused', async () => {
    const screen = page(site(false), site(true));
    fireEvent.press(screen.getByLabelText('Edit Fence'));
    putIn(screen, 'sitework');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(screen.getByText(`Not saved. ${ELSEWHERE}${FENCE}`)).toBeTruthy());
    expect(jest.mocked(loadDAVEWebReadOnlySnapshot)).toHaveBeenCalledTimes(1);
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
  });

  it('C3 control: in a tab that shows the link, Save stays held ("Correct Schedule Issues")', () => {
    const screen = page(site());
    fireEvent.press(screen.getByLabelText('Edit Fence'));
    putIn(screen, 'sitework');

    expect(screen.getByText('Correct Schedule Issues')).toBeTruthy();
  });

  it('guard: a new task put in Sitework that waits for nothing in a circle is created', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Curb');
    choose(screen, 'Grading');
    putIn(screen, 'sitework');
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });

    await waitFor(() => expect(mockAuth.createTask).toHaveBeenCalledTimes(1));
    const created = mockAuth.createTask.mock.calls[0][0] as DAVEWebScheduleItem;
    expect([created.taskName, created.parentItemId, (created.dependencies ?? []).map(link => link.predecessorItemId)]).toEqual(['Curb', 'sitework', ['grading']]);
  });

  it('C5: a circle already in the cloud: the Gantt names every task in it, Curb included', () => {
    const screen = page([...site(), task('curb', 'Curb', ['paving'], { parentItemId: 'sitework', wbsCode: '1.3' })]);
    fireEvent.press(screen.getByText('Gantt'));

    expect(screen.getByText('Critical path is unavailable')).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`${YARD}: Paving starts after the phase Sitework, Curb starts after Paving, and Curb is in the phase Sitework: that is a circle`)).length).toBeGreaterThan(0);
  });
});
