import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';

// Open item 3.6 (14 Oct 2026), on the computer. A link to a phase could not be saved: the editor said "“Sitework” is a
// phase, and this schedule can only place an item after tasks and milestones ... Untick it below, then save." and Save
// read "Correct Schedule Issues"; the Gantt said the critical path counts tasks and milestones only. The coordinator's
// rule: a task may follow a phase, as in Microsoft Project; it starts after every task in the phase is finished. A
// phase may not follow one of its own tasks, and no link may make a circle. Synthetic data; made-up names.

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

function task(id: string, taskName: string, predecessors: string[] = [], extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id, projectId: NORTH_ID, itemType: 'Task', scheduleProjectName: NORTH, projectName: NORTH, projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot', taskName, startDate: '2026-10-05', finishDate: '2026-10-09', milestone: '', owner: 'Project manager',
    contractor: '', durationDays: 5, percentComplete: 0, progressSource: 'project_manager', progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'David', priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}
const phase = (id: string, taskName: string, extra: Partial<DAVEWebScheduleItem> = {}) =>
  task(id, taskName, [], { isSummary: true, ...extra });

/** Sitework holds Grading and Trenching (to Wed 14 Oct). Paving starts after Sitework. Fence waits for nothing. */
const site = (filedAs = NORTH) => [
  phase('sitework', 'Sitework', { scheduleProjectName: filedAs, wbsCode: '1' }),
  task('grading', 'Grading', [], { scheduleProjectName: filedAs, parentItemId: 'sitework', wbsCode: '1.1' }),
  task('trenching', 'Trenching', [], { scheduleProjectName: filedAs, parentItemId: 'sitework', wbsCode: '1.2', finishDate: '2026-10-14', durationDays: 8 }),
  task('paving', 'Paving', ['sitework'], { startDate: '2026-10-12', finishDate: '2026-10-16', wbsCode: '2' }),
  task('fence', 'Fence', [], { wbsCode: '3' }),
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
});

function page(shown: DAVEWebScheduleItem[], chosen: string | null = null) {
  mockAuth.snapshot = {
    projects: [{ id: NORTH_ID, name: NORTH }], openCloudProjects: [{ id: NORTH_ID, name: NORTH }],
    scheduleItems: shown, knownScheduleItems: shown, projectUpdates: [], referenceDocuments: [], refreshedAt: '2026-10-06T14:00:02.000Z',
  };
  jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue({ scheduleItems: shown, knownScheduleItems: shown } as never);
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
const OLD_RULE = /can only place an item after tasks and milestones|counts tasks and milestones only|missing predecessor/;

describe('the Schedule editor: a task may start after a phase (open item 3.6)', () => {
  it('a saved link to a phase is listed, ticked, and saved: nothing tells him to untick it', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toContainEqual({ text: '1 · Sitework (a phase)', checked: true });
    expect(screen.queryAllByText(OLD_RULE)).toHaveLength(0);
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(saveButton(screen)).toEqual(['Save Changes']);

    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect([saved().id, linksOf(saved())]).toEqual(['paving', ['sitework']]);
  });

  it('a phase is offered as a new predecessor, and the link is saved', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByLabelText('Edit Fence'));

    expect(predecessorChoices(screen)).toContainEqual({ text: '1 · Sitework (a phase)', checked: false });
    fireEvent.press(screen.getByLabelText('Sitework, a phase'));
    expect(saveButton(screen)).toEqual(['Save Changes']);
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect([saved().id, linksOf(saved())]).toEqual(['fence', ['sitework']]);
  });

  it('a task in a phase is not offered its own phase, nor a task that waits for that phase', () => {
    const screen = page(site());
    fireEvent.press(screen.getByLabelText('Edit Grading'));

    const texts = predecessorChoices(screen).map(choice => choice.text);
    expect(texts.some(text => text.includes('Sitework'))).toBe(false);
    expect(texts.some(text => text.includes('Paving'))).toBe(false);
  });

  it('a new task ticked to start after Sitework, then put in Sitework: not saved, and he is told why', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByText('Add Task'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Curb');
    fireEvent.press(screen.getByLabelText('Sitework, a phase'));
    act(() => { screen.getByLabelText('Parent phase').props.onChange({ target: { value: 'sitework' } }); });

    // Still listed, ticked, so that he can untick it.
    expect(predecessorChoices(screen)).toContainEqual({ text: '1 · Sitework (a phase)', checked: true });
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });
    expect(screen.getByText('Not saved. This item is in the phase “Sitework”, so it cannot also start after “Sitework” is finished: that is a circle. Untick “Sitework” and save again.')).toBeTruthy();
    expect(mockAuth.createTask).not.toHaveBeenCalled();
  });

  it('a task that starts after Sitework, put in Sitework in the form: the preview names the circle, and Save is held', () => {
    const screen = page(site());
    fireEvent.press(screen.getByLabelText('Edit Paving'));
    act(() => { screen.getByLabelText('Parent phase').props.onChange({ target: { value: 'sitework' } }); });

    expect(screen.getByText('• Paving is in the phase Sitework, so it cannot start after Sitework is finished: that is a circle.')).toBeTruthy();
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);
    // Unticking Sitework frees it.
    fireEvent.press(screen.getByLabelText('Sitework, a phase'));
    expect(saveButton(screen)).toEqual(['Save Changes']);
  });

  it('Harbor North chosen, the phase in the master filed under its own name: the link is listed with where it is filed, and Save is free', () => {
    const screen = page(site(ROOT), NORTH);
    fireEvent.press(screen.getByLabelText('Edit Paving'));

    expect(predecessorChoices(screen)).toContainEqual({ text: `1 · Sitework (a phase, ${ROOT})`, checked: true });
    expect(screen.queryAllByText(OLD_RULE)).toHaveLength(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);
  });
});

describe('the Gantt view: a task that starts after a phase (open item 3.6)', () => {
  it('the critical path is calculated, and "Apply dates" places Paving after the last task in Sitework', async () => {
    const screen = page(site());
    fireEvent.press(screen.getByText('Gantt'));

    expect(screen.queryAllByText(/Critical path is unavailable/)).toHaveLength(0);
    expect(screen.getByText('Critical path (2)')).toBeTruthy();
    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('Safe to review')).toBeTruthy();
    expect(screen.getByText('After Sitework')).toBeTruthy();
    expect(screen.queryAllByText(OLD_RULE)).toHaveLength(0);

    await act(async () => { fireEvent.press(screen.getByText('Apply dates')); });
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    expect([saved().id, saved().startDate, saved().finishDate, linksOf(saved())]).toEqual(['paving', '2026-10-15', '2026-10-21', ['sitework']]);
  });

  it('Harbor North chosen, the phase in the master filed under its own name: the same', () => {
    const screen = page(site(ROOT), NORTH);
    fireEvent.press(screen.getByText('Gantt'));

    expect(screen.queryAllByText(/Critical path is unavailable/)).toHaveLength(0);
    expect(screen.getByText('Critical path (1)')).toBeTruthy();
    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('Safe to review')).toBeTruthy();
    expect(screen.getByText('After Sitework')).toBeTruthy();
  });

  it('a task in a phase set to start after that phase: what he reads, and "Apply dates" stays off', () => {
    const shown = site().map(item => item.id === 'grading' ? { ...item, dependencies: [{ predecessorItemId: 'sitework', type: 'FS' as const, lagDays: 0 }] } : item);
    const screen = page(shown);
    fireEvent.press(screen.getByText('Gantt'));

    const LINE = 'Grading is in the phase Sitework, so it cannot start after Sitework is finished: that is a circle.';
    expect(screen.getByText('Critical path is unavailable')).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`${NORTH}: ${LINE}`)).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('Needs correction')).toBeTruthy();
    expect(screen.getByText(`• ${LINE}`)).toBeTruthy();
    expect(screen.getByLabelText('Apply calculated dates for Paving').props.accessibilityState?.disabled ?? screen.getByLabelText('Apply calculated dates for Paving').props.disabled).toBe(true);
  });
});
