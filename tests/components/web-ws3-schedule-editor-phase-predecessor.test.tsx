import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';

// Review pass 1, web L4 (6 Oct 2026; caused by WS1 item 7). The web's Schedule editor lists, so that it can always
// be unticked, every predecessor the item already has that the editor would not OFFER as a new one. It labelled
// all of them "(circular link)" with the line "... is set to finish before this item and also to start after it.
// That is a circle ...". The editor does not offer a phase (a summary row) either, and a task that starts after a
// phase is in no circle. A phase is now called a phase, with a line that says what is true of it.
// Synthetic data; the harness of web-ws3-schedule-editor-live-predecessor.test.tsx.

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

const NORTH = 'Harbor North';
const ROOT = 'PLZ 2400 Harbor Project';
const NORTH_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';

function task(
  id: string,
  taskName: string,
  predecessors: string[] = [],
  extra: Partial<DAVEWebScheduleItem> = {},
): DAVEWebScheduleItem {
  return {
    id,
    projectId: NORTH_ID,
    itemType: 'Task',
    scheduleProjectName: NORTH,
    projectName: NORTH,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName,
    startDate: '2026-10-12',
    finishDate: '2026-10-16',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 5,
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'David',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}
const phase = (id: string, taskName: string, predecessors: string[] = [], extra: Partial<DAVEWebScheduleItem> = {}) =>
  task(id, taskName, predecessors, { isSummary: true, startDate: '2026-10-05', finishDate: '2026-10-09', ...extra });

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'david@example.com',
  snapshot: null,
  refreshSnapshot: jest.fn(async () => true),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTasks: jest.fn(),
  deleteTask: jest.fn(),
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
});

function page(shown: DAVEWebScheduleItem[], chosen: string | null = null) {
  mockAuth.snapshot = {
    projects: [{ id: NORTH_ID, name: NORTH }],
    openCloudProjects: [{ id: NORTH_ID, name: NORTH }],
    scheduleItems: shown,
    knownScheduleItems: shown,
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-10-06T14:00:02.000Z',
  };
  const handed = chosen ? scheduleTasksForParentProject(chosen, shown) as DAVEWebScheduleItem[] : shown;
  return render(<DesktopSchedulePage tasks={handed} projects={[NORTH]} selectedProject={chosen} />);
}
const predecessorChoices = (screen: ReturnType<typeof render>) => screen.getAllByRole('checkbox').map(choice => ({
  text: within(choice).getAllByText(/\S/).map(node => [node.props.children].flat().join('')).join(''),
  checked: choice.props.accessibilityState.checked,
}));
const saveButton = (screen: ReturnType<typeof render>) =>
  ['Save Changes', 'Correct Schedule Issues'].filter(label => screen.queryByText(label));
const saved = () => mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
const linksOf = (item: DAVEWebScheduleItem) => (item.dependencies ?? []).map(link => link.predecessorItemId);
const CIRCLE = /circle|circular/i;
const PHASE_LINE = '“Sitework” is a phase, and this schedule can only place an item after tasks and milestones: it cannot place this item while it starts after a phase. Untick it below, then save. To keep the order, tick the task this item should follow instead.';

describe('a predecessor that is a phase (review pass 1, web L4)', () => {
  // As a Microsoft Project file links them, or as set on another device: Paving starts after the phase Sitework.
  const paving = () => [phase('sitework', 'Sitework'), task('grading', 'Grading', [], { parentItemId: 'sitework', startDate: '2026-10-05', finishDate: '2026-10-09' }), task('paving', 'Paving', ['sitework'])];

  it('is listed as a phase, ticked, with a line that says what is true of it; nothing calls it a circle', () => {
    const screen = page(paving());
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Grading', checked: false },
      { text: 'Sitework (a phase)', checked: true },
    ]);
    expect(screen.getByText(PHASE_LINE)).toBeTruthy();
    expect(screen.queryAllByText(CIRCLE).length).toBe(0);
    expect(screen.queryAllByLabelText('Sitework, circular link').length).toBe(0);
    // What the line says is so: the save is held while the item starts after the phase.
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);
  });

  it('the "Change impact preview" box says the same of it: a phase, by its name, not a "missing predecessor" with an id', () => {
    const screen = page(paving());
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(screen.getByText(/Paving starts after the phase Sitework, and the critical path counts tasks and milestones only\./)).toBeTruthy();
    expect(screen.queryAllByText(/missing predecessor/).length).toBe(0);
  });

  it('unticking it frees Save and takes the line away; the task is saved without the link', async () => {
    const screen = page(paving());
    fireEvent.press(screen.getByLabelText('Edit Paving'));
    fireEvent.press(screen.getByLabelText('Sitework, a phase'));

    expect(predecessorChoices(screen)).toContainEqual({ text: 'Sitework (a phase)', checked: false });
    expect(screen.queryAllByText(PHASE_LINE).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    // He keeps the order with the task the item should follow, as the line suggested (a new link: the cloud is read).
    fireEvent.press(screen.getAllByRole('checkbox')[0]);
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue({ scheduleItems: paving(), knownScheduleItems: paving() } as never);
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect([saved().id, linksOf(saved())]).toEqual(['paving', ['grading']]);
  });

  it('two phases: the line names both, and says "them"', () => {
    const screen = page([phase('sitework', 'Sitework'), phase('utilities', 'Utilities'), task('paving', 'Paving', ['sitework', 'utilities'])]);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(screen.getByText('“Sitework” and “Utilities” are phases, and this schedule can only place an item after tasks and milestones: it cannot place this item while it starts after a phase. Untick them below, then save. To keep the order, tick the tasks this item should follow instead.')).toBeTruthy();
    expect(screen.queryAllByText(CIRCLE).length).toBe(0);
  });

  it('a phase filed outside the project chosen at the top is a phase too, with where it is filed', () => {
    const shown = [phase('sitework', 'Sitework', [], { scheduleProjectName: ROOT }), task('paving', 'Paving', ['sitework'])];
    const screen = page(shown, NORTH);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toEqual([{ text: `Sitework (a phase, ${ROOT})`, checked: true }]);
    expect(screen.getByText(PHASE_LINE)).toBeTruthy();
    expect(screen.queryAllByText(CIRCLE).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);

    fireEvent.press(screen.getByLabelText('Sitework, a phase'));
    expect(saveButton(screen)).toEqual(['Save Changes']);
  });

  it('a phase in another building under the same schedule is a phase too, with its building', () => {
    // A combined master: every row is filed under the master's root name, each with its building as its project.
    const shown = [
      phase('sitework-south', 'Sitework', [], { scheduleProjectName: ROOT, projectName: 'Harbor South' }),
      task('paving', 'Paving', ['sitework-south'], { scheduleProjectName: ROOT }),
    ];
    const screen = page(shown);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Sitework (a phase, Harbor South)', checked: true }]);
    expect(screen.getByText(PHASE_LINE)).toBeTruthy();
    expect(screen.queryAllByText(CIRCLE).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);
  });

  it('guard: a phase that also comes after the item IS a circle, and is called one', () => {
    // Sitework was set, elsewhere, to start after Paving as well.
    const screen = page([phase('sitework', 'Sitework', ['paving']), task('paving', 'Paving', ['sitework'])]);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Sitework (circular link)', checked: true }]);
    expect(screen.getByText('“Sitework” is set to finish before this item and also to start after it. That is a circle, and the schedule cannot place it. Untick it below, then save.')).toBeTruthy();
    expect(screen.queryAllByText(/is a phase/).length).toBe(0);
  });

  it('guard: a circle between two tasks is still named a circle', () => {
    const screen = page([task('framing', 'Framing', ['survey']), task('survey', 'Survey', ['framing'])]);
    fireEvent.press(screen.getByLabelText('Edit Framing'));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Survey (circular link)', checked: true }]);
    expect(screen.queryAllByText(/a phase/).length).toBe(0);
  });

  it('guard: a phase is still not offered as a new predecessor', () => {
    const screen = page([phase('sitework', 'Sitework'), task('grading', 'Grading'), task('paving', 'Paving')]);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Grading', checked: false }]);
    expect(screen.queryAllByText(/is a phase/).length).toBe(0);
  });
});
