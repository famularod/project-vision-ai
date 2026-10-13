/**
 * Independent review F03 (Build 229), Build 231 E1 item 11: on the desktop
 * schedule page the editor's labels were sibling text, not tied to their
 * input boxes, so a screen reader could reach a box without naming it.
 * Every box in the schedule editor is now found by its label.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockCreateTask = jest.fn();
const mockUpdateTask = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    snapshot: { projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: '2321 Compliance Project' }] },
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    updateTasks: jest.fn(),
    refreshSnapshot: jest.fn(async () => true),
  }),
}));

const PROJECT = '2321 Compliance Project';

const stored: DAVEWebScheduleItem = {
  id: 'paving',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: PROJECT,
  projectName: PROJECT,
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'North Lot',
  taskName: 'Place asphalt',
  wbsCode: '1.2',
  startDate: '10/05/2026',
  finishDate: '10/09/2026',
  milestone: '',
  owner: 'Paving crew',
  contractor: 'Blacktop Co',
  durationDays: 5,
  percentComplete: 40,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-09-30T12:00:00.000Z',
  progressConfirmedBy: 'PM',
  priority: 'Medium',
  status: 'In Progress',
  notes: 'Night work',
  nextAction: '',
  activity: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
  cloudUpdatedAt: '2026-09-30T12:00:01.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
  mockCreateTask.mockResolvedValue(undefined);
});

function openEditor() {
  const screen = render(<DesktopSchedulePage tasks={[stored]} projects={[PROJECT]} selectedProject={PROJECT} />);
  fireEvent.press(screen.getByLabelText('Edit Place asphalt'));
  return screen;
}

describe('F03: every box in the desktop schedule editor is named by its label', () => {
  it.each([
    ['Name', 'Place asphalt'],
    ['WBS', '1.2'],
    ['Owner', 'Paving crew'],
    ['Duration (working days)', '5'],
    ['Lag after predecessors', '0'],
    ['Contractor', 'Blacktop Co'],
    ['Percent complete', '40'],
    ['Planning notes', 'Night work'],
  ])('the "%s" box is found by its label and holds its own value (was: no name)', (label, value) => {
    const screen = openEditor();
    expect(screen.getByLabelText(label).props.value).toBe(value);
  });

  it('no text box in the editor is left without a name', () => {
    const screen = openEditor();
    const unnamed = screen.UNSAFE_getAllByType(TextInput)
      .filter(input => !String(input.props.accessibilityLabel ?? input.props['aria-label'] ?? '').trim())
      .map(input => input.props.value);
    expect(unnamed).toEqual([]);
  });

  it('a box found by its label is the box that is saved', async () => {
    const screen = openEditor();
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Asphalt Partners');
    fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '6');
    fireEvent.changeText(screen.getByLabelText('Planning notes'), 'Day work');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({ contractor: 'Asphalt Partners', durationDays: 6, notes: 'Day work' });
  });

  it('the status choices are a named group of radio buttons, one checked (was: unnamed, no role)', () => {
    const screen = openEditor();
    expect(screen.getByLabelText('Status').props.accessibilityRole).toBe('radiogroup');
    const states = (['Not Started', 'In Progress', 'Waiting', 'Complete'] as const)
      .map(status => [status, screen.getByRole('radio', { name: status }).props.accessibilityState?.checked]);
    expect(states).toEqual([['Not Started', false], ['In Progress', true], ['Waiting', false], ['Complete', false]]);
  });

  // Guards: these already hold on 594a71d.
  it.each(['Project', 'Parent phase', 'Area', 'Start date', 'Finish date', 'Baseline start', 'Baseline finish'])(
    'the "%s" control is still named',
    label => {
      expect(openEditor().getByLabelText(label)).toBeTruthy();
    },
  );

  it('a new milestone and a new phase name their boxes too', () => {
    const screen = render(<DesktopSchedulePage tasks={[stored]} projects={[PROJECT]} selectedProject={PROJECT} />);
    fireEvent.press(screen.getByText('Add Milestone'));
    expect(screen.getByLabelText('Milestone date')).toBeTruthy();
    expect(screen.getByLabelText('Name').props.value).toBe('');
    fireEvent.press(screen.getByText('Add Phase'));
    expect(screen.getByLabelText('Name').props.value).toBe('');
    expect(screen.queryByLabelText('Duration (working days)')).toBeNull();
  });
});
