import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockCreateTask = jest.fn();
const mockUpdateTask = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
  }),
}));

const phase: DAVEWebScheduleItem = scheduleItem('phase', {
  taskName: 'Site work',
  wbsCode: '1',
  isSummary: true,
});
const task: DAVEWebScheduleItem = scheduleItem('task', {
  taskName: 'Place asphalt',
  wbsCode: '1.1',
  parentItemId: phase.id,
  dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
});
const predecessor: DAVEWebScheduleItem = scheduleItem('predecessor', {
  taskName: 'Prepare subgrade',
  wbsCode: '1.0',
  parentItemId: phase.id,
  status: 'Complete',
  percentComplete: 100,
});

describe('DesktopSchedulePage', () => {
  beforeEach(() => {
    mockCreateTask.mockReset();
    mockUpdateTask.mockReset();
  });

  test('presents the hierarchy as a schedule builder with planning controls', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    expect(screen.getByText('Schedule Builder')).toBeTruthy();
    expect(screen.getByText('Site work')).toBeTruthy();
    expect(screen.getByText('Place asphalt')).toBeTruthy();
    expect(screen.getByText('Prepare subgrade')).toBeTruthy();
    expect(screen.getByText('Relationships')).toBeTruthy();
  });

  test('opens a planning editor for a new task and a selected existing row', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByText('Add Task'));
    expect(screen.getByText('Add task')).toBeTruthy();
    expect(screen.getByText('Finish-to-start predecessors')).toBeTruthy();

    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    expect(screen.getByText('Edit schedule item')).toBeTruthy();
    expect(screen.getByDisplayValue('Place asphalt')).toBeTruthy();
    expect(screen.getByLabelText('Project').props.disabled).toBe(true);
    expect(screen.getByText(/Project cannot be changed while editing/)).toBeTruthy();
    expect(screen.getByText('Baseline start')).toBeTruthy();
    expect(screen.getByText('Baseline finish')).toBeTruthy();
  });

  test('offers existing project areas while preserving custom area entry', async () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    const areaInput = screen.getByLabelText('Area');
    expect(areaInput.props.list).toBe('vitruvius-schedule-area-options');
    expect(screen.getByText('Choose an existing project area or type a new area.')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType('option' as never).some(
      option => option.props.value === 'North Lot',
    )).toBe(true);

    fireEvent(areaInput, 'change', { target: { value: 'South Service Yard' } });
    expect(screen.getByLabelText('Area').props.value).toBe('South Service Yard');
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        locationName: 'South Service Yard',
      }),
    ));
  });

  test('switches to a split Gantt timeline with day, week, and month zoom', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByText('Gantt'));

    expect(screen.getByText('Gantt Timeline')).toBeTruthy();
    expect(screen.getByText('Project timeline')).toBeTruthy();
    expect(screen.getByText('Day')).toBeTruthy();
    expect(screen.getByText('Week')).toBeTruthy();
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByLabelText('Open timeline item Place asphalt')).toBeTruthy();
    expect(screen.getByText(/Critical path/)).toBeTruthy();

    fireEvent.press(screen.getByText(/Impact preview/));
    expect(screen.getByText('Dependency impact preview')).toBeTruthy();
    expect(screen.getByText(/one task at a time/)).toBeTruthy();
    expect(screen.getByLabelText('Apply calculated dates for Place asphalt')).toBeTruthy();
  });

  test('applies one reviewed dependency date change through the authorized task path', async () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByText('Gantt'));
    fireEvent.press(screen.getByText(/Impact preview/));
    fireEvent.press(screen.getByLabelText('Apply calculated dates for Place asphalt'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        startDate: '2026-07-22',
        finishDate: '2026-07-23',
      }),
    ));
  });

  test('does not present an invalid dependency network as a valid critical path', () => {
    const cycleA = scheduleItem('cycle-a', {
      taskName: 'Cycle A',
      dependencies: [{ predecessorItemId: 'cycle-b', type: 'FS' }],
    });
    const cycleB = scheduleItem('cycle-b', {
      taskName: 'Cycle B',
      dependencies: [{ predecessorItemId: 'cycle-a', type: 'FS' }],
    });
    const screen = render(
      <DesktopSchedulePage
        tasks={[cycleA, cycleB]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByText('Gantt'));

    expect(screen.getByText('Critical path is unavailable')).toBeTruthy();
    expect(screen.getByText(/Correct the dependency network/)).toBeTruthy();
  });

  test('captures current task dates as the baseline without duplicate entry', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    expect(screen.getByLabelText('Baseline start').props.value).toBe('');
    expect(screen.getByLabelText('Baseline finish').props.value).toBe('');

    fireEvent.press(screen.getByLabelText('Use current dates as baseline'));

    expect(screen.getByLabelText('Baseline start').props.value).toBe('2026-07-20');
    expect(screen.getByLabelText('Baseline finish').props.value).toBe('2026-07-21');
  });

  test('previews an unsafe edit and blocks save until the schedule issue is corrected', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
    fireEvent(screen.getByLabelText('Finish date'), 'change', {
      target: { value: '2026-07-19' },
    });

    expect(screen.getByText('Change impact preview')).toBeTruthy();
    expect(screen.getByText('Needs correction')).toBeTruthy();
    expect(screen.getByText('• Place asphalt finishes before it starts.')).toBeTruthy();

    const blockedSaveLabel = screen.getByText('Correct Schedule Issues');
    expect(blockedSaveLabel).toBeDisabled();
    fireEvent.press(blockedSaveLabel);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  test('saves a milestone as a zero-duration dated schedule item', async () => {
    const milestone = scheduleItem('milestone', {
      taskName: 'Building dried in',
      startDate: '2026-07-25',
      finishDate: '',
      durationDays: null,
      isMilestone: true,
      milestone: 'Building dried in',
    });
    const screen = render(
      <DesktopSchedulePage
        tasks={[milestone]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByLabelText('Edit Building dried in'));
    fireEvent.press(screen.getByText('Save Changes'));

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: milestone.id,
        startDate: '2026-07-25',
        finishDate: '2026-07-25',
        durationDays: 0,
        isMilestone: true,
      }),
    ));
  });

  test('builds a PM-facing three- or six-week construction lookahead', () => {
    const screen = render(
      <DesktopSchedulePage
        tasks={[phase, predecessor, task]}
        projects={['2321 Compliance Project']}
        selectedProject="2321 Compliance Project"
      />,
    );

    fireEvent.press(screen.getByText('Lookahead'));

    expect(screen.getByText('Construction Lookahead')).toBeTruthy();
    expect(screen.getByText('3-week construction lookahead')).toBeTruthy();
    expect(screen.getByText('Export CSV')).toBeTruthy();
    expect(screen.getByText('Print')).toBeTruthy();
    expect(screen.getByText('Open in window')).toBeTruthy();
    expect(screen.getByLabelText('Open lookahead item Place asphalt')).toBeTruthy();

    fireEvent.press(screen.getByText('6 Weeks'));
    expect(screen.getByText('6-week construction lookahead')).toBeTruthy();
  });
});

function scheduleItem(
  id: string,
  overrides: Partial<DAVEWebScheduleItem> = {},
): DAVEWebScheduleItem {
  return {
    id,
    itemType: 'Task',
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 2,
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-24T12:00:00.000Z',
    progressConfirmedBy: 'PM',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    cloudUpdatedAt: '2026-07-24T12:00:01.000Z',
    ...overrides,
  };
}
