import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';

// Open item 3.4 (14 Oct 2026), the computer's timeline (Gantt) view. A link between a task he made by hand (filed
// under its building's name) and a task from a master (filed under the master's own name) read "Critical path is
// unavailable ... Punch walk references missing predecessor <id>", whatever was chosen at the top; and with a project
// chosen the Impact preview read "Needs correction" and every "Apply dates" was switched off. A hand-made task is a
// real task: the link now counts like any other. Synthetic data; the harness of web-ws3-schedule-editor-live-predecessor.

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

function task(id: string, taskName: string, scheduleProjectName: string, predecessors: string[] = [], extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id, projectId: NORTH_ID, itemType: 'Task', scheduleProjectName, projectName: NORTH, projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot', taskName, startDate: '2026-10-19', finishDate: '2026-10-23', milestone: '', owner: 'Project manager',
    contractor: '', durationDays: 5, percentComplete: 0, progressSource: 'project_manager', progressConfirmedAt: '2026-10-01T12:00:00.000Z',
    progressConfirmedBy: 'David', priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
    dependencies: predecessors.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 0 })),
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}

/**
 * A master filed under its own name: Survey, then Excavation (Excavation must move: Survey now finishes on the 14th).
 * Added by hand on the computer for Harbor North: Punch walk, after Excavation; and Fence.
 */
const harbor = () => [
  task('survey', 'Survey', ROOT, [], { startDate: '2026-10-05', finishDate: '2026-10-14', durationDays: 8 }),
  task('excavation', 'Excavation', ROOT, ['survey'], { startDate: '2026-10-12', finishDate: '2026-10-16' }),
  task('punch', 'Punch walk', NORTH, ['excavation']),
  task('fence', 'Fence', NORTH, [], { startDate: '2026-10-05', finishDate: '2026-10-07', durationDays: 3 }),
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
  mockAuth.updateTasks.mockImplementation(async (updates: unknown[]) => updates.length);
});

/** The page as the shell renders it for the project chosen at the top (null: All projects). */
function page(shown: DAVEWebScheduleItem[], chosen: string | null) {
  mockAuth.snapshot = {
    projects: [{ id: NORTH_ID, name: NORTH }], openCloudProjects: [{ id: NORTH_ID, name: NORTH }],
    scheduleItems: shown, knownScheduleItems: shown, projectUpdates: [], referenceDocuments: [], refreshedAt: '2026-10-06T14:00:02.000Z',
  };
  const handed = chosen ? scheduleTasksForParentProject(chosen, shown) as DAVEWebScheduleItem[] : shown;
  const screen = render(<DesktopSchedulePage tasks={handed} projects={[NORTH]} selectedProject={chosen} />);
  fireEvent.press(screen.getByText('Gantt'));
  return screen;
}
const UNAVAILABLE = /Critical path is unavailable|missing predecessor|Needs correction/;
const applyButtons = (screen: ReturnType<typeof render>) =>
  screen.queryAllByLabelText(/^Apply calculated dates for /).map(button => ({
    label: button.props.accessibilityLabel,
    disabled: Boolean(button.props.accessibilityState?.disabled ?? button.props.disabled),
  }));

describe('the Gantt view and a link between a hand-made task and a master\'s task (open item 3.4)', () => {
  it('Harbor North chosen: the critical path is calculated, and "Apply dates" for Punch walk is on and saves its dates', async () => {
    const screen = page(harbor(), NORTH);

    expect(screen.queryAllByText(UNAVAILABLE)).toHaveLength(0);
    expect(screen.getByText('Critical path (1)')).toBeTruthy();
    expect(screen.getAllByText('CRITICAL')).toHaveLength(1);

    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('Safe to review')).toBeTruthy();
    expect(screen.queryAllByText(UNAVAILABLE)).toHaveLength(0);
    expect(screen.getByText('After Excavation')).toBeTruthy();
    expect(applyButtons(screen)).toEqual([{ label: 'Apply calculated dates for Punch walk', disabled: false }]);

    await act(async () => { fireEvent.press(screen.getByText('Apply dates')); });
    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
    const saved = mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem;
    // Excavation moves to 15-21 Oct after Survey; Punch walk then starts on the 22nd, five working days.
    expect([saved.id, saved.startDate, saved.finishDate, saved.dependencies]).toEqual(['punch', '2026-10-22', '2026-10-28', harbor()[2].dependencies]);
  });

  it('All projects: the critical path is calculated, through both schedules', () => {
    const screen = page(harbor(), null);

    expect(screen.queryAllByText(UNAVAILABLE)).toHaveLength(0);
    expect(screen.getByText('Critical path (3)')).toBeTruthy();
  });

  it('the master\'s name chosen, with a master\'s task that waits for a hand-made task: the same', () => {
    const shown = [
      task('mockup', 'Mockup panel', NORTH, [], { startDate: '2026-10-05', finishDate: '2026-10-09' }),
      task('survey', 'Survey', ROOT, ['mockup'], { startDate: '2026-10-05', finishDate: '2026-10-09' }),
    ];
    const screen = page(shown, ROOT);

    expect(screen.queryAllByText(UNAVAILABLE)).toHaveLength(0);
    expect(screen.getByText('Critical path (1)')).toBeTruthy();
    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('After Mockup panel')).toBeTruthy();
    expect(applyButtons(screen)).toEqual([{ label: 'Apply calculated dates for Survey', disabled: false }]);
  });

  it('Harbor North chosen: the Lookahead tab marks Punch walk critical, as the Gantt does', () => {
    const screen = page(harbor(), NORTH);
    fireEvent.press(screen.getByText('Lookahead'));

    expect(screen.getAllByText('CRITICAL')).toHaveLength(1);
  });

  it('guard: a predecessor in no schedule shown is still a missing predecessor, and "Apply dates" stays off', () => {
    const shown = [
      ...harbor().map(item => item.id === 'punch'
        ? { ...item, dependencies: [...(item.dependencies ?? []), { predecessorItemId: 'deleted-task', type: 'FS' as const, lagDays: 0 }] }
        : item),
      // Gate must move after Fence: a change "Apply dates" would offer.
      task('gate', 'Gate', NORTH, ['fence'], { startDate: '2026-10-06', finishDate: '2026-10-06', durationDays: 1 }),
    ];
    const screen = page(shown, NORTH);

    expect(screen.getByText('Critical path is unavailable')).toBeTruthy();
    expect(screen.getAllByText(/Punch walk references missing predecessor deleted-task\./).length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Impact preview (1)'));
    expect(screen.getByText('Needs correction')).toBeTruthy();
    expect(applyButtons(screen)).toEqual([{ label: 'Apply calculated dates for Gate', disabled: true }]);
  });
});
