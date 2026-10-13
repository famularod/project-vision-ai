import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useState } from 'react';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';

// Review pass 1, web M1 (6 Oct 2026; caused by WS1 item 8). The web's Schedule page is handed the tasks of the
// project chosen at the top of the workspace, and its editor took "not among the tasks I was handed" for "no longer
// in the schedule": with a project chosen, a predecessor that is alive and shown, but filed under another schedule
// name, was listed as "A task no longer in the schedule" with the instruction to untick it. The case found: a task
// added by hand on the web (filed under its building's name) that starts after a task of a Microsoft Project master
// (filed under the master's own root name).
// Now the editor tells a live predecessor from a dead one by the schedule the workspace shows, whatever is chosen at
// the top. Synthetic data; the harness of web-ws1-task-link-circle-editor.test.tsx.

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
  scheduleProjectName: string,
  predecessors: string[] = [],
  extra: Partial<DAVEWebScheduleItem> = {},
): DAVEWebScheduleItem {
  const imported = scheduleProjectName === ROOT;
  return {
    id,
    projectId: NORTH_ID,
    itemType: 'Task',
    scheduleProjectName,
    projectName: NORTH,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'Lot',
    taskName,
    startDate: imported ? '2026-10-05' : '2026-10-12',
    finishDate: imported ? '2026-10-09' : '2026-10-16',
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
    ...(imported ? { importBatchId: 'batch-master', importedFrom: 'Harbor master.mpp' } : {}),
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    cloudUpdatedAt: '2026-10-01T12:00:01.000Z',
    ...extra,
  } as DAVEWebScheduleItem;
}

/**
 * A master filed under its own root name lists Excavation for Harbor North. "Punch walk" and "Fence" were added by
 * hand on the web for Harbor North (a new web task is filed under the project's name), and Punch walk starts after
 * Excavation.
 */
const harbor = () => [
  task('excavation', 'Excavation', ROOT),
  task('punch', 'Punch walk', NORTH, ['excavation']),
  task('fence', 'Fence', NORTH),
];

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

/** The workspace's snapshot: the tasks shown (every project), and every saved row. */
function workspaceHolds(shown: DAVEWebScheduleItem[], hiddenRows: DAVEWebScheduleItem[] = []) {
  mockAuth.snapshot = {
    projects: [{ id: NORTH_ID, name: NORTH }],
    openCloudProjects: [{ id: NORTH_ID, name: NORTH }],
    scheduleItems: shown,
    knownScheduleItems: [...shown, ...hiddenRows],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-10-06T14:00:02.000Z',
  };
}
/** The page as the shell renders it for the project chosen at the top (null: All projects). */
function page(shown: DAVEWebScheduleItem[], chosen: string | null, hiddenRows: DAVEWebScheduleItem[] = []) {
  workspaceHolds(shown, hiddenRows);
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
const NO_LONGER = /no longer in the schedule/;
const DEAD = 'A task no longer in the schedule';
async function save(screen: ReturnType<typeof render>) {
  await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
  await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(1));
}

describe('a predecessor that is in the schedule, filed outside the project chosen at the top (review pass 1, web M1)', () => {
  it('Harbor North chosen: Excavation is listed by name with where it is filed, ticked; nothing is called "no longer in the schedule"; Save is free and keeps the link', async () => {
    const screen = page(harbor(), NORTH);
    // The page was handed Harbor North's own two tasks; Excavation is in the workspace's schedule, not among them.
    expect(screen.queryAllByLabelText('Edit Excavation').length).toBe(0);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Fence', checked: false },
      { text: `Excavation (${ROOT})`, checked: true },
    ]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    expect(screen.queryAllByLabelText(DEAD).length).toBe(0);
    expect(screen.queryAllByText(/missing predecessor/).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    await save(screen);
    expect([saved().id, linksOf(saved())]).toEqual(['punch', ['excavation']]);
    // Nothing was added, so the cloud is not asked.
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });

  it('All projects: Excavation is listed by name, ticked, and Save is free and keeps the link', async () => {
    const screen = page(harbor(), null);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Excavation', checked: true },
      { text: 'Fence', checked: false },
    ]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    expect(screen.queryAllByText(/missing predecessor/).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    await save(screen);
    expect(linksOf(saved())).toEqual(['excavation']);
  });

  it('the master\'s own name chosen: a master\'s task that waits for a hand-made task shows it the same way', async () => {
    const screen = page([...harbor(), task('backfill', 'Backfill', ROOT, ['punch'], { startDate: '2026-10-19', finishDate: '2026-10-23' })], ROOT);
    expect(screen.queryAllByLabelText('Edit Punch walk').length).toBe(0);
    fireEvent.press(screen.getByLabelText('Edit Backfill'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Excavation', checked: false },
      { text: `Punch walk (${NORTH})`, checked: true },
    ]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    await save(screen);
    expect([saved().id, linksOf(saved())]).toEqual(['backfill', ['punch']]);
  });

  it('the project chosen at the top is changed while the editor is open: the link is never called missing, and Save stays free and keeps it', async () => {
    const all = harbor();
    workspaceHolds(all);
    let choose: (project: string | null) => void = () => undefined;
    function Workspace() {
      const [chosen, setChosen] = useState<string | null>(null);
      choose = setChosen;
      const handed = chosen ? scheduleTasksForParentProject(chosen, all) as DAVEWebScheduleItem[] : all;
      return <DesktopSchedulePage tasks={handed} projects={[NORTH]} selectedProject={chosen} />;
    }
    const screen = render(<Workspace />);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));
    const excavation = () => predecessorChoices(screen).filter(choice => choice.text.startsWith('Excavation'));
    const sound = () => [screen.queryAllByText(NO_LONGER).length, screen.queryAllByLabelText(DEAD).length, screen.queryAllByText(/missing predecessor|no longer exists/).length];

    expect(excavation()).toEqual([{ text: 'Excavation', checked: true }]);

    // He chooses Harbor North at the top: Excavation is no longer among the tasks the page is handed.
    act(() => choose(NORTH));
    expect(screen.getByText('Edit schedule item')).toBeTruthy();
    expect(excavation()).toEqual([{ text: `Excavation (${ROOT})`, checked: true }]);
    expect(sound()).toEqual([0, 0, 0]);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    // Then the master's own name: now Punch walk itself is not among them, and Excavation is.
    act(() => choose(ROOT));
    expect(screen.getByText('Edit schedule item')).toBeTruthy();
    expect(excavation()).toEqual([{ text: 'Excavation', checked: true }]);
    expect(sound()).toEqual([0, 0, 0]);
    expect(saveButton(screen)).toEqual(['Save Changes']);

    // And back to All projects.
    act(() => choose(null));
    expect(excavation()).toEqual([{ text: 'Excavation', checked: true }]);
    expect(sound()).toEqual([0, 0, 0]);

    act(() => choose(ROOT));
    await save(screen);
    expect([saved().id, linksOf(saved())]).toEqual(['punch', ['excavation']]);
  });

  it('opened with a project chosen, then All projects: the same', async () => {
    const all = harbor();
    workspaceHolds(all);
    let choose: (project: string | null) => void = () => undefined;
    function Workspace() {
      const [chosen, setChosen] = useState<string | null>(NORTH);
      choose = setChosen;
      const handed = chosen ? scheduleTasksForParentProject(chosen, all) as DAVEWebScheduleItem[] : all;
      return <DesktopSchedulePage tasks={handed} projects={[NORTH]} selectedProject={chosen} />;
    }
    const screen = render(<Workspace />);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));
    act(() => choose(null));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Excavation', checked: true }, { text: 'Fence', checked: false }]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    await save(screen);
    expect(linksOf(saved())).toEqual(['excavation']);
  });

  it('the list under the project chosen names the predecessor, not "Missing"', () => {
    const screen = page(harbor(), NORTH);
    expect(screen.queryAllByText('Missing').length).toBe(0);
    expect(screen.getByText('Excavation')).toBeTruthy();
  });

  it('he may still untick it himself: the link is then removed, as any other', async () => {
    const screen = page(harbor(), NORTH);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));
    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    expect(predecessorChoices(screen)[1]).toEqual({ text: `Excavation (${ROOT})`, checked: false });

    await save(screen);
    expect(linksOf(saved())).toEqual([]);
  });

  it('a predecessor in another project altogether (a link made on another device) is listed with its project, and Save is free', async () => {
    const crane = task('crane', 'Tower crane', 'Other Root', [], { projectName: 'Other Tower' });
    const screen = page([...harbor().map(item => (item.id === 'punch' ? task('punch', 'Punch walk', NORTH, ['crane']) : item)), crane], null);
    // The list names it too.
    expect(screen.queryAllByText('Missing').length).toBe(0);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(predecessorChoices(screen)).toEqual([
      { text: 'Excavation', checked: false },
      { text: 'Fence', checked: false },
      { text: 'Tower crane (Other Tower)', checked: true },
    ]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Save Changes']);
    await save(screen);
    expect(linksOf(saved())).toEqual(['crane']);
  });
});

describe('a predecessor that is no longer in the schedule can still be removed (WS1 item 8 stands)', () => {
  const withDeadLink = () => harbor().map(item => (item.id === 'punch' ? task('punch', 'Punch walk', NORTH, ['excavation', 'deleted-task']) : item));

  it.each([['Harbor North chosen', NORTH, `Excavation (${ROOT})`], ['All projects', null, 'Excavation']] as const)(
    '%s: only the dead link is called "no longer in the schedule"; unticking it frees Save, and the live link stays',
    async (_label, chosen, excavationText) => {
      const screen = page(withDeadLink(), chosen);
      fireEvent.press(screen.getByLabelText('Edit Punch walk'));

      expect(screen.getByText('This item is set to start after a task that is no longer in the schedule (deleted, or on a schedule that is not the current one). The schedule cannot place it until that link is removed. Untick it below, then save.')).toBeTruthy();
      expect(predecessorChoices(screen).filter(choice => choice.checked)).toEqual(expect.arrayContaining([
        { text: DEAD, checked: true },
        { text: excavationText, checked: true },
      ]));
      expect(screen.getAllByLabelText(DEAD)).toHaveLength(1);
      expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);

      fireEvent.press(screen.getByLabelText(DEAD));
      expect(saveButton(screen)).toEqual(['Save Changes']);
      await save(screen);
      expect(linksOf(saved())).toEqual(['excavation']);
    },
  );

  it('guard: the list still reads "Missing" for it', () => {
    const screen = page(harbor().map(item => (item.id === 'punch' ? task('punch', 'Punch walk', NORTH, ['deleted-task']) : item)), NORTH);
    expect(screen.getByText('Missing')).toBeTruthy();
  });

  it('guard: a task that is only hidden (saved on a schedule that is not the current one; no task shown answers to it) is still "no longer in the schedule"', () => {
    const hidden = task('old-grading', 'Grading', ROOT, [], { importBatchId: 'batch-older-master' });
    const screen = page(harbor().map(item => (item.id === 'punch' ? task('punch', 'Punch walk', NORTH, ['old-grading']) : item)), NORTH, [hidden]);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(screen.getByLabelText(DEAD).props.accessibilityState.checked).toBe(true);
    expect(screen.getAllByText(NO_LONGER).length).toBeGreaterThan(0);
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);
  });

  it('guard: a link that names an earlier row of the task itself is still "no longer in the schedule"', () => {
    const shown = harbor().map(item => (item.id === 'punch' ? task('punch', 'Punch walk', NORTH, ['punch-earlier-row'], { revisedFromTaskIds: ['punch-earlier-row'] }) : item));
    const screen = page(shown, NORTH, [task('punch-earlier-row', 'Punch walk', NORTH)]);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(screen.getByLabelText(DEAD).props.accessibilityState.checked).toBe(true);
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);
  });
});

describe('a link that names a row a master has since replaced (owner answer Q29), with a project chosen at the top', () => {
  it('is the task\'s row shown, wherever that is filed: listed by name, and saved on that row without asking the cloud', async () => {
    const shown = [
      task('excavation', 'Excavation', ROOT, [], { revisedFromTaskIds: ['excavation-earlier-row'] }),
      task('punch', 'Punch walk', NORTH, ['excavation-earlier-row']),
    ];
    const screen = page(shown, NORTH, [task('excavation-earlier-row', 'Excavation', ROOT, [], { importBatchId: 'batch-older-master' })]);
    expect(screen.queryAllByText('Missing').length).toBe(0);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(predecessorChoices(screen)).toEqual([{ text: `Excavation (${ROOT})`, checked: true }]);
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    await save(screen);
    expect(linksOf(saved())).toEqual(['excavation']);
    expect(loadDAVEWebReadOnlySnapshot).not.toHaveBeenCalled();
  });
});

describe('a circle through a task filed under another schedule name', () => {
  // Punch walk starts after Excavation, and Excavation was set, elsewhere, to start after Punch walk.
  const circle = () => [task('excavation', 'Excavation', ROOT, ['punch']), task('punch', 'Punch walk', NORTH, ['excavation'])];

  it.each([['Harbor North chosen', NORTH], ['All projects', null]] as const)('%s: it is named as a circle, and Save is held until it is unticked', async (_label, chosen) => {
    const screen = page(circle(), chosen);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));

    expect(predecessorChoices(screen)).toEqual([{ text: 'Excavation (circular link)', checked: true }]);
    expect(screen.getByText('“Excavation” is set to finish before this item and also to start after it. That is a circle, and the schedule cannot place it. Untick it below, then save.')).toBeTruthy();
    expect(screen.queryAllByText(NO_LONGER).length).toBe(0);
    expect(saveButton(screen)).toEqual(['Correct Schedule Issues']);

    fireEvent.press(screen.getByLabelText('Excavation, circular link'));
    expect(saveButton(screen)).toEqual(['Save Changes']);
    await save(screen);
    expect(linksOf(saved())).toEqual([]);
  });
});

describe('a phase, whose predecessors are not in its form', () => {
  it('guard: a phase saved elsewhere with a predecessor it would not be offered is still saved, its links as stored', async () => {
    // Set on another device: the phase Sitework waits for the phase Mobilization, and Mobilization for Sitework.
    const shown = [
      task('mobilization', 'Mobilization', NORTH, ['sitework'], { isSummary: true }),
      task('sitework', 'Sitework', NORTH, ['mobilization'], { isSummary: true }),
    ];
    const screen = page(shown, null);
    fireEvent.press(screen.getByLabelText('Edit Sitework'));
    fireEvent.changeText(screen.getByLabelText('Name'), 'Sitework and utilities');

    expect(saveButton(screen)).toEqual(['Save Changes']);
    await save(screen);
    expect([saved().taskName, linksOf(saved())]).toEqual(['Sitework and utilities', ['mobilization']]);
  });
});

describe('another device changed the item while he edits it, after the project chosen at the top stopped listing it', () => {
  // Opened under All projects; then the master's own name is chosen at the top, which does not list Punch walk.
  async function refusedSaveUnderTheMastersName() {
    let all = harbor();
    workspaceHolds(all);
    let choose: (project: string | null) => void = () => undefined;
    let show: (tasks: DAVEWebScheduleItem[]) => void = () => undefined;
    function Workspace() {
      const [chosen, setChosen] = useState<string | null>(null);
      const [shown, setShown] = useState(all);
      choose = setChosen;
      show = setShown;
      const handed = chosen ? scheduleTasksForParentProject(chosen, shown) as DAVEWebScheduleItem[] : shown;
      return <DesktopSchedulePage tasks={handed} projects={[NORTH]} selectedProject={chosen} />;
    }
    const screen = render(<Workspace />);
    fireEvent.press(screen.getByLabelText('Edit Punch walk'));
    act(() => choose(ROOT));
    fireEvent.changeText(screen.getByLabelText('Contractor'), 'Walk Co');
    // The phone typed a note meanwhile: the save is refused, and the refresh brings the phone's version.
    mockAuth.updateTask.mockRejectedValueOnce(new DAVEWebTaskMutationError('conflict', 'This task changed on another device.'));
    mockAuth.refreshSnapshot.mockImplementation(async () => {
      all = all.map(item => (item.id === 'punch' ? { ...item, notes: 'From the phone', cloudUpdatedAt: '2026-10-06T18:00:00.000Z' } : item));
      workspaceHolds(all);
      act(() => show(all));
      return true;
    });
    await act(async () => { fireEvent.press(screen.getByText('Save Changes')); });
    expect(await screen.findByText('Another device changed this schedule item while you were editing. Choose which version to continue with.')).toBeTruthy();
    return screen;
  }

  it('Load Latest Version loads it: it is still in the shared record', async () => {
    const screen = await refusedSaveUnderTheMastersName();
    fireEvent.press(screen.getByText('Load Latest Version'));

    expect(screen.getByText('The latest shared version is loaded. Review it before saving.')).toBeTruthy();
    expect(screen.queryAllByText('This schedule item is no longer in the shared record.').length).toBe(0);
    expect(screen.getByLabelText('Planning notes').props.value).toBe('From the phone');
  });

  it('Apply My Changes puts his field over the phone\'s version, and the link stays', async () => {
    const screen = await refusedSaveUnderTheMastersName();
    await act(async () => { fireEvent.press(screen.getByText('Apply My Changes')); });

    await waitFor(() => expect(mockAuth.updateTask).toHaveBeenCalledTimes(2));
    const applied = mockAuth.updateTask.mock.calls[1][0] as DAVEWebScheduleItem;
    expect([applied.id, applied.contractor, applied.notes, linksOf(applied), applied.cloudUpdatedAt])
      .toEqual(['punch', 'Walk Co', 'From the phone', ['excavation'], '2026-10-06T18:00:00.000Z']);
    expect(screen.queryAllByText('This schedule item is no longer in the shared record.').length).toBe(0);
  });
});
