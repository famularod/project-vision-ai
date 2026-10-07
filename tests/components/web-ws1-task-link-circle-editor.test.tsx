import { useState } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

// Open item, web batch WS1 item 7 (6 Oct 2026), in the web's Schedule page
// editor.
//
// REPRODUCED FIRST (it was reported by reading only): Framing is saved to
// start after Survey, and Survey to start after Framing (two links made in
// two places). Opening either one, the other was not in the list of
// predecessors at all (the editor does not offer a task that comes after
// the item), so the link could not be unticked, and Save read "Correct
// Schedule Issues" and was disabled: he could not get out of the circle on
// the web. The first test below fails on the code before this fix.
//
// And the save that would make a circle: a predecessor ticked here that the
// cloud, by then, holds the other way round is refused with a sentence.
// Synthetic data; the harness of audit-round2-schedule-builder.test.tsx.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockUpdateTask = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'david@example.com',
    snapshot: { projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: 'Alpha' }] },
    createTask: jest.fn(),
    updateTask: mockUpdateTask,
    updateTasks: jest.fn(),
    refreshSnapshot: jest.fn(async () => true),
  }),
}));
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));

const PROJECT = 'Alpha';

function task(id: string, taskName: string, predecessors: string[] = []): DAVEWebScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName,
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
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
  } as DAVEWebScheduleItem;
}

const cloudNow = (tasks: DAVEWebScheduleItem[]) =>
  jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue({ scheduleItems: tasks, knownScheduleItems: tasks } as never);
const page = (tasks: DAVEWebScheduleItem[]) =>
  render(<DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />);
const predecessorChoices = (screen: ReturnType<typeof render>) => screen.getAllByRole('checkbox').map(choice => ({
  text: within(choice).getByText(/\S/).props.children.join(''),
  checked: choice.props.accessibilityState.checked,
}));
const saved = () => mockUpdateTask.mock.calls[0][0] as DAVEWebScheduleItem;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateTask.mockResolvedValue(undefined);
});

describe('a circle already saved: the editor always lets him remove the link (WS1 item 7)', () => {
  const inCircle = () => [task('framing', 'Framing', ['survey']), task('survey', 'Survey', ['framing']), task('roofing', 'Roofing')];

  it('the link is listed, ticked and named as a circle; unticking it frees Save, and the link is removed', async () => {
    const screen = page(inCircle());
    fireEvent.press(screen.getByLabelText('Edit Framing'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Roofing', checked: false },
      { text: 'Survey (circular link)', checked: true },
    ]);
    expect(screen.getByText('“Survey” is set to finish before this item and also to start after it. That is a circle, and the schedule cannot place it. Untick it below, then save.')).toBeTruthy();
    // While the circle stands the save is held, as before.
    expect(screen.getByText('Correct Schedule Issues')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Survey, circular link'));
    expect(screen.getByLabelText('Survey, circular link').props.accessibilityState.checked).toBe(false);
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect([saved().id, saved().dependencies]).toEqual(['framing', []]);
    // Taking a link away asks the cloud nothing.
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });

  it('the same from the other task of the circle', () => {
    const screen = page(inCircle());
    fireEvent.press(screen.getByLabelText('Edit Survey'));
    expect(predecessorChoices(screen)).toContainEqual({ text: 'Framing (circular link)', checked: true });
  });

  it('the other link arrives while his editor is open with the task ticked: it stays listed, named as a circle, and he can untick it', async () => {
    let show: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
    function Workspace() {
      const [tasks, setTasks] = useState([task('framing', 'Framing'), task('survey', 'Survey'), task('roofing', 'Roofing')]);
      show = setTasks;
      return <DesktopSchedulePage tasks={tasks} projects={[PROJECT]} selectedProject={PROJECT} />;
    }
    const screen = render(<Workspace />);
    fireEvent.press(screen.getByLabelText('Edit Framing'));
    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    expect(predecessorChoices(screen)).toEqual([{ text: 'Roofing', checked: false }, { text: 'Survey', checked: true }]);

    // Another tab saves "Survey starts after Framing", and this tab's schedule refreshes under the open editor.
    act(() => show([task('framing', 'Framing'), task('survey', 'Survey', ['framing']), task('roofing', 'Roofing')]));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Roofing', checked: false }, { text: 'Survey (circular link)', checked: true }]);
    expect(screen.getByText(/“Survey” is set to finish before this item and also to start after it\. That is a circle/)).toBeTruthy();
    expect(screen.getByText('Correct Schedule Issues')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Survey, circular link'));
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(saved().dependencies).toEqual([]);
  });

  it('guard: with no circle a task that comes after the item is still not offered as its predecessor', () => {
    const screen = page([task('framing', 'Framing'), task('survey', 'Survey', ['framing']), task('roofing', 'Roofing')]);
    fireEvent.press(screen.getByLabelText('Edit Framing'));
    expect(predecessorChoices(screen)).toEqual([{ text: 'Roofing', checked: false }]);
    expect(screen.queryByText(/That is a circle/)).toBeNull();
  });
});

describe('a link that would close a circle with what the cloud holds now is refused (WS1 item 7)', () => {
  const REFUSED = 'Not saved. “Framing” is already set to start after “Survey”, on another device or in another browser tab. Making “Survey” start after “Framing” as well would put them in a circle, and the schedule could not place either one. Untick “Framing” and save again, or remove the other link first.';
  /** This tab's copy: no link either way. */
  const mine = () => [task('framing', 'Framing'), task('survey', 'Survey')];

  async function tickFramingOnSurveyAndSave(screen: ReturnType<typeof render>) {
    fireEvent.press(screen.getByLabelText('Edit Survey'));
    fireEvent.press(screen.getAllByRole('checkbox')[0]);
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
  }

  it('another tab has just set Framing to start after Survey: the save is refused, and what he ticked is kept', async () => {
    cloudNow([task('framing', 'Framing', ['survey']), task('survey', 'Survey')]);
    const screen = page(mine());
    await tickFramingOnSurveyAndSave(screen);

    expect(await screen.findByText(REFUSED)).toBeTruthy();
    expect(mockUpdateTask).not.toHaveBeenCalled();
    expect(screen.getByText('Edit schedule item')).toBeTruthy();
    expect(predecessorChoices(screen)).toEqual([{ text: 'Framing', checked: true }]);
  });

  it('the cloud holds no link the other way: saved', async () => {
    cloudNow(mine());
    const screen = page(mine());
    await tickFramingOnSurveyAndSave(screen);

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(saved().dependencies?.map(link => link.predecessorItemId)).toEqual(['framing']);
    expect(loadDAVEWebReadOnlySnapshot).toHaveBeenCalledTimes(1);
  });

  it('the cloud could not be read: not saved, and he is told why', async () => {
    jest.mocked(loadDAVEWebReadOnlySnapshot).mockRejectedValue(new Error('network'));
    const screen = page(mine());
    await tickFramingOnSurveyAndSave(screen);

    expect(await screen.findByText('Not saved. Vitruvius could not read the latest schedule to check this new link against it. Check your connection and try again.')).toBeTruthy();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('guard: a save that adds no link does not read the cloud', async () => {
    const screen = page(mine());
    fireEvent.press(screen.getByLabelText('Edit Survey'));
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Survey Co');
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });

    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledTimes(1));
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });
});
