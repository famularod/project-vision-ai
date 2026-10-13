/**
 * Independent review R08 (Build 229), Build 231 E1 item 10, in the desktop
 * schedule editor: a duration of a billion working days was accepted and
 * the change preview then counted them out one day at a time. The editor
 * now refuses a duration, lag or date beyond what the schedule supports,
 * with a plain sentence, before anything is calculated or saved.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { SCHEDULE_DURATION_RANGE_TEXT, SCHEDULE_LAG_RANGE_TEXT } from '../../services/ScheduleInputLimits';

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

function scheduleItem(id: string, overrides: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-20',
    finishDate: '2026-07-24',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 5,
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

const pour = scheduleItem('pour', { taskName: 'Pour slab' });
const frame = scheduleItem('frame', {
  taskName: 'Frame walls',
  startDate: '2026-07-27',
  finishDate: '2026-07-29',
  durationDays: 3,
  dependencies: [{ predecessorItemId: 'pour', type: 'FS', lagDays: 0 }],
});
const roof = scheduleItem('roof', {
  taskName: 'Roof',
  startDate: '2026-07-30',
  finishDate: '2026-07-31',
  durationDays: 2,
  dependencies: [{ predecessorItemId: 'frame', type: 'FS', lagDays: 0 }],
});

/** Counts every one-day step of a date, and stops the work with an error past `limit` of them. */
function watchDaySteps(limit: number) {
  const real = Date.prototype.setUTCDate;
  const watch = { steps: 0, restore: () => spy.mockRestore() };
  const spy = jest.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (this: Date, day: number) {
    watch.steps += 1;
    if (watch.steps > limit) throw new Error(`More than ${limit} one-day steps: the preview is not bounded.`);
    return real.call(this, day);
  });
  return watch;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
  mockCreateTask.mockResolvedValue(undefined);
});

function editFrame() {
  const screen = render(<DesktopSchedulePage tasks={[pour, frame, roof]} projects={[PROJECT]} selectedProject={PROJECT} />);
  fireEvent.press(screen.getByLabelText('Edit Frame walls'));
  return screen;
}

function addTask() {
  const screen = render(<DesktopSchedulePage tasks={[pour]} projects={[PROJECT]} selectedProject={PROJECT} />);
  fireEvent.press(screen.getByText('Add Task'));
  fireEvent.changeText(screen.getByLabelText('Name'), 'Site fence');
  return screen;
}

describe('R08: editing a task with tasks after it', () => {
  it.each(['1000000000', '2601', '1e9', '999999999999999999999999'])(
    'a duration of %s shows the plain sentence at once, calculates nothing and cannot be saved (was: counted out day by day)',
    async typed => {
      const screen = editFrame();
      const watch = watchDaySteps(20_000);
      try {
        await act(async () => { fireEvent.changeText(screen.getByLabelText('Duration (working days)'), typed); });
      } finally {
        watch.restore();
      }
      expect(watch.steps).toBe(0);
      expect(screen.getByText('Needs correction')).toBeTruthy();
      expect(screen.getByText(`• ${SCHEDULE_DURATION_RANGE_TEXT}`)).toBeTruthy();
      expect(screen.getByText('Project finish: Not calculated')).toBeTruthy();
      await act(async () => { fireEvent.press(screen.getByText('Correct Schedule Issues')); });
      expect(mockUpdateTask).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Start date', '0202-10-05'],
    ['Finish date', '9999-12-31'],
  ])('%s set to %s shows the plain sentence, calculates nothing and cannot be saved', async (label, value) => {
    const screen = editFrame();
    const watch = watchDaySteps(20_000);
    try {
      await act(async () => { fireEvent(screen.getByLabelText(label), 'change', { target: { value } }); });
    } finally {
      watch.restore();
    }
    expect(watch.steps).toBe(0);
    expect(screen.getByText(`• ${label} must be a real date from 2000 through 2100.`)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Correct Schedule Issues')); });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it.each([
    ['Duration (working days)', 'five', SCHEDULE_DURATION_RANGE_TEXT],
    ['Duration (working days)', '-3', SCHEDULE_DURATION_RANGE_TEXT],
    ['Lag after predecessors', '99999', SCHEDULE_LAG_RANGE_TEXT],
    ['Lag after predecessors', '1e2', SCHEDULE_LAG_RANGE_TEXT],
  ])('%s typed as "%s" is refused at Save with the plain sentence (was: saved as blank, 0 or 365)', async (label, typed, sentence) => {
    const screen = editFrame();
    fireEvent.changeText(screen.getByLabelText(label), typed);
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('a baseline date outside 2000 through 2100 is refused at Save with the plain sentence', async () => {
    const screen = editFrame();
    fireEvent(screen.getByLabelText('Baseline start'), 'change', { target: { value: '1999-12-31' } });
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    expect(screen.getByText('Baseline start must be a real date from 2000 through 2100.')).toBeTruthy();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('a task stored with a duration beyond the limit opens with the sentence showing, and saves once it is corrected', async () => {
    const imported = { ...frame, durationDays: 1_000_000_000 };
    const watch = watchDaySteps(20_000);
    let screen!: ReturnType<typeof render>;
    try {
      screen = render(<DesktopSchedulePage tasks={[pour, imported, roof]} projects={[PROJECT]} selectedProject={PROJECT} />);
      await act(async () => { fireEvent.press(screen.getByLabelText('Edit Frame walls')); });
    } finally {
      watch.restore();
    }
    expect(screen.getByLabelText('Duration (working days)').props.value).toBe('1000000000');
    expect(screen.getByText(`• ${SCHEDULE_DURATION_RANGE_TEXT}`)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '3');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({ id: 'frame', durationDays: 3 });
  });

  // Guards: these already hold on 594a71d.
  it('the supported maximum is previewed and saved', async () => {
    const screen = editFrame();
    fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '2600');
    expect(screen.getByText('Ready to review')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({ id: 'frame', durationDays: 2_600 });
  });

  it('a blank duration and the largest lag are saved', async () => {
    const screen = editFrame();
    fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '');
    fireEvent.changeText(screen.getByLabelText('Lag after predecessors'), '365');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(mockUpdateTask.mock.calls[0][0]).toMatchObject({
      durationDays: null,
      dependencies: [{ predecessorItemId: 'pour', type: 'FS', lagDays: 365 }],
    });
  });
});

describe('R08: adding a task', () => {
  it.each([
    ['Duration (working days)', '1000000000', SCHEDULE_DURATION_RANGE_TEXT],
    ['Duration (working days)', '2601', SCHEDULE_DURATION_RANGE_TEXT],
    ['Lag after predecessors', '366', SCHEDULE_LAG_RANGE_TEXT],
  ])('%s of %s is refused with the plain sentence and nothing is created (was: created)', async (label, typed, sentence) => {
    const screen = addTask();
    fireEvent.changeText(screen.getByLabelText(label), typed);
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('a start date in the year 0202 is refused with the plain sentence and nothing is created (was: created)', async () => {
    const screen = addTask();
    fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '0202-10-05' } });
    fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '0202-10-09' } });
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });
    expect(screen.getByText('Start date must be a real date from 2000 through 2100.')).toBeTruthy();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  // Guard: this already holds on 594a71d.
  it('an ordinary task is created', async () => {
    const screen = addTask();
    fireEvent(screen.getByLabelText('Start date'), 'change', { target: { value: '2026-10-05' } });
    fireEvent(screen.getByLabelText('Finish date'), 'change', { target: { value: '2026-10-09' } });
    fireEvent.changeText(screen.getByLabelText('Duration (working days)'), '5');
    await act(async () => { fireEvent.press(screen.getByText('Create Task')); });
    await waitFor(() => expect(mockCreateTask).toHaveBeenCalledTimes(1));
    expect(mockCreateTask.mock.calls[0][0]).toMatchObject({ taskName: 'Site fence', durationDays: 5, startDate: '10/05/2026' });
  });
});
