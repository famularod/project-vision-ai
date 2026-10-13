import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';

// Second review of the web area, F7, the sentence only (7 Oct 2026; caused by the fix for review pass 1, M1).
//
// With a project chosen at the top, the Schedule editor offers as a new predecessor a task that already comes
// after the item THROUGH a task filed under another schedule name (the editor works out "comes after" within
// the tasks it is handed). The save is then rightly refused by the check against the cloud: the link would
// close a circle. But the refusal said the other links were made "on another device or in another browser
// tab", which is not so: they are in the schedule this very tab shows.
//
// The refusal now says that only when it is so: when the circle is closed by a link this tab's own schedule
// does not hold. When every link of the circle is in the schedule this tab shows, it says the true reason and
// names the same tasks, without blaming another device. What the editor offers, and how a circle is found, are
// unchanged (recorded for another batch). Synthetic data; the reviewer's own case 10.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
const mockAuth: Record<string, any> = {
  userEmail: 'david@example.com',
  snapshot: null,
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTasks: jest.fn(),
  refreshSnapshot: jest.fn(async () => true),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));

const NORTH = 'Harbor North';
const NORTH_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
/** A Microsoft Project master files its rows under its own root name, with the building as the project. */
const ROOT = 'PLZ 2400 Harbor Project';

function task(id: string, taskName: string, scheduleProjectName: string, predecessors: string[], days: [string, string]): DAVEWebScheduleItem {
  return {
    id,
    projectId: NORTH_ID,
    itemType: 'Task',
    scheduleProjectName,
    projectName: NORTH,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName,
    startDate: days[0],
    finishDate: days[1],
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
    // The master's rows came from its file.
    ...(scheduleProjectName === ROOT ? { importBatchId: 'batch-master', importedFrom: 'Harbor master.mpp' } : {}),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
  } as DAVEWebScheduleItem;
}

/** The schedule this tab's workspace shows, whatever is chosen at the top. */
function workspaceShows(shown: DAVEWebScheduleItem[]) {
  mockAuth.snapshot = {
    projects: [{ id: NORTH_ID, name: NORTH }, { id: null, name: ROOT }],
    openCloudProjects: [{ id: NORTH_ID, name: NORTH }],
    scheduleItems: shown,
    knownScheduleItems: shown,
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-10-06T14:00:02.000Z',
  };
  return shown;
}
/** What the cloud holds when the save asks it. */
const cloudHolds = (tasks: DAVEWebScheduleItem[]) =>
  jest.mocked(loadDAVEWebReadOnlySnapshot).mockResolvedValue({ scheduleItems: tasks, knownScheduleItems: tasks } as never);
/** The page as the workspace hands it its tasks: those of the project chosen at the top (all of them with none chosen). */
const page = (chosen: string | null, shown: DAVEWebScheduleItem[]) => (
  <DesktopSchedulePage
    tasks={(chosen ? scheduleTasksForParentProject(chosen, shown) : shown) as DAVEWebScheduleItem[]}
    projects={[NORTH, ROOT]}
    selectedProject={chosen}
  />
);
const boxes = (screen: ReturnType<typeof render>) => screen.queryAllByRole('checkbox');
const textOf = (node: { props: { children?: unknown } }): string => {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') out.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk((value as { props?: { children?: unknown } }).props?.children);
  };
  walk(node.props.children);
  return out.join('');
};
const notSaved = (screen: ReturnType<typeof render>) => screen.queryAllByText(/^Not saved\./).map(node => textOf(node));

/** Excavation (the master's) starts after Punch walk; Grading starts after Excavation. */
const excavation = () => task('excavation', 'Excavation', ROOT, ['punch'], ['2026-10-19', '2026-10-23']);
const grading = (after: string[] = ['excavation']) => task('grading', 'Grading', NORTH, after, ['2026-10-26', '2026-10-27']);
const punch = () => task('punch', 'Punch walk', NORTH, [], ['2026-10-12', '2026-10-16']);

/** He opens Punch walk, ticks Grading as its predecessor, and saves. */
async function ticksGradingOnPunchWalkAndSaves(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getByLabelText('Edit Punch walk'));
  const offered = boxes(screen).find(box => textOf(box).includes('Grading'));
  expect(offered).toBeTruthy();
  fireEvent.press(offered!);
  await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.updateTask.mockResolvedValue(undefined);
});

describe('second review, web F7 (the sentence): a new link refused because it would close a circle says the true reason', () => {
  it('the reviewer’s case: the circle runs through a task filed under another schedule name, all of it in the schedule this tab shows: the refusal names the tasks and does not blame another device or tab', async () => {
    const shown = workspaceShows([excavation(), grading(), punch()]);
    cloudHolds(shown);
    const screen = render(page(NORTH, shown));

    await ticksGradingOnPunchWalkAndSaves(screen);

    expect(notSaved(screen)).toEqual([
      'Not saved. “Grading” already comes after “Punch walk” (through “Excavation”). Making “Punch walk” start after “Grading” as well would put them in a circle, and the schedule could not place either one. Untick “Grading” and save again, or remove the other link first.',
    ]);
    expect(screen.queryByText(/another device|another browser tab/)).toBeNull();
    // Refused as before: nothing is written, and what he ticked is kept.
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
    expect(screen.getByText('Edit schedule item')).toBeTruthy();
  });

  it('guard: one of the links of the circle really was made elsewhere since (this tab’s schedule does not hold it): the refusal still says so', async () => {
    // This tab: Grading does not start after Excavation. Another tab has just saved that link.
    const shown = workspaceShows([excavation(), grading([]), punch()]);
    cloudHolds([excavation(), grading(), punch()]);
    const screen = render(page(NORTH, shown));

    await ticksGradingOnPunchWalkAndSaves(screen);

    expect(notSaved(screen)).toEqual([
      'Not saved. “Grading” already comes after “Punch walk” (through “Excavation”), on another device or in another browser tab. Making “Punch walk” start after “Grading” as well would put them in a circle, and the schedule could not place either one. Untick “Grading” and save again, or remove the other link first.',
    ]);
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
  });

  it('the same through Apply My Changes (another device changed Punch walk meanwhile, and he ticks Grading before applying): the true reason, and nothing is written', async () => {
    const shown = workspaceShows([excavation(), grading(), punch()]);
    cloudHolds(shown);
    // The phone's newer version of Punch walk, which this tab reads after its save is refused.
    const phoneVersion = { ...punch(), notes: 'Phone note', cloudUpdatedAt: '2026-10-06T14:05:01.000Z' } as DAVEWebScheduleItem;
    let showTasks: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
    function Workspace() {
      const [tasks, setTasks] = useState(shown);
      showTasks = next => act(() => setTasks(next));
      return page(NORTH, tasks);
    }
    mockAuth.updateTask.mockRejectedValueOnce(new DAVEWebTaskMutationError('conflict', 'This task changed on another device.'));
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      showTasks(workspaceShows([excavation(), grading(), phoneVersion]));
      return true;
    });
    const screen = render(<Workspace />);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Walk Co');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByText('Choose how to resolve this edit')).toBeTruthy());
    mockAuth.updateTask.mockClear();

    fireEvent.press(boxes(screen).find(box => textOf(box).includes('Grading'))!);
    await act(async () => { fireEvent.press(screen.getByText('Apply My Changes')); });

    expect(notSaved(screen)).toEqual([
      'Not saved. “Grading” already comes after “Punch walk” (through “Excavation”). Making “Punch walk” start after “Grading” as well would put them in a circle, and the schedule could not place either one. Untick “Grading” and save again, or remove the other link first.',
    ]);
    expect(mockAuth.updateTask).not.toHaveBeenCalled();
  });

  it('guard: what the editor offers is unchanged: with the project chosen Grading is still offered, and under All projects it is not', async () => {
    const shown = workspaceShows([excavation(), grading(), punch()]);
    cloudHolds(shown);

    const chosen = render(page(NORTH, shown));
    fireEvent.press(chosen.getByLabelText('Edit Punch walk'));
    expect(boxes(chosen).map(box => textOf(box))).toEqual(['Grading']);
    chosen.unmount();

    const all = render(page(null, shown));
    fireEvent.press(all.getByLabelText('Edit Punch walk'));
    expect(boxes(all).map(box => textOf(box))).toEqual([]);
  });

  it('guard: a link that closes no circle is saved as before', async () => {
    const shown = workspaceShows([task('excavation', 'Excavation', ROOT, [], ['2026-10-19', '2026-10-23']), grading(), punch()]);
    cloudHolds(shown);
    const screen = render(page(NORTH, shown));

    await ticksGradingOnPunchWalkAndSaves(screen);

    expect(notSaved(screen)).toEqual([]);
    expect(mockAuth.updateTask).toHaveBeenCalledTimes(1);
    expect((mockAuth.updateTask.mock.calls[0][0] as DAVEWebScheduleItem).dependencies?.map(link => link.predecessorItemId)).toEqual(['grading']);
  });
});
