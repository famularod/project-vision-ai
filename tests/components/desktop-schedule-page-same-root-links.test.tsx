/**
 * Audit round 2, A5 pass 13 L1 (1 Oct 2026), caused by 4dfe2cf (A5 pass 12
 * K1): the web Schedule page now groups a combined Microsoft Project master's
 * tasks by building, and so broke links made under one root before then.
 *
 * Every row of the master carries its root ("2400 Compliance Project") as its
 * schedule project and Harbor North or Harbor South as its app project. While
 * the page grouped by root, David added a phase under the root holding a
 * North and a South task, and set North's Punch list to follow South's
 * Install HVAC. Grouped by building, the phase's children showed as orphan
 * rows with "1 hierarchy issue need review." in each building, and the editor
 * neither listed the South predecessor nor let it be unchecked, though saving
 * kept it.
 *
 * Now a parent or predecessor under the same root counts as present: no
 * orphan row and no issue banner. The editor lists the task's existing
 * same-root parent and predecessors, labelled with their building, so they can
 * be seen and removed. Grouping for display stays by building. Synthetic data.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
const mockUpdateTask = jest.fn();
let mockSnapshot: unknown = null;
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({ userEmail: 'pm@example.com', createTask: jest.fn(), updateTask: mockUpdateTask, snapshot: mockSnapshot }),
}));

const ROOT = '2400 Compliance Project';
function task(id: string, projectName: string, scheduleProjectName: string | null, taskName: string, finishDate: string,
  extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id, projectId: `cloud-${projectName}`, itemType: 'Task', scheduleProjectName, projectName, projectTimeZone: 'America/Los_Angeles',
    locationName: '', taskName, startDate: finishDate, finishDate, milestone: '', owner: '', contractor: '', durationDays: 3,
    percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
    importBatchId: 'batch-master-c', sourceDocumentId: 'MASTER C', createdAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z', cloudUpdatedAt: '2026-09-15T12:00:01.000Z', ...extra,
  } as DAVEWebScheduleItem;
}
const combined = ['Harbor North', 'Harbor South'].flatMap((building, index) => [
  task(`${index}-slab`, building, ROOT, 'POUR SLAB', '09/03/2026', { wbsCode: `${index ? 'S' : 'N'}.1` }),
  task(`${index}-hvac`, building, ROOT, 'INSTALL HVAC', '10/07/2026', { wbsCode: `${index ? 'S' : 'N'}.2` }),
  task(`${index}-punch`, building, ROOT, 'PUNCH LIST', '12/18/2026', { wbsCode: `${index ? 'S' : 'N'}.3` }),
]);
/** A phase added under the root while the page grouped by root: it took the root as its project, both ways. */
const rootPhase = task('phase-mep', ROOT, ROOT, 'MEP ROUGH-IN', '', { isSummary: true, wbsCode: 'P.1', projectId: 'cloud-Harbor North' });
const withPhase = [
  rootPhase,
  ...combined.map(item => item.id.endsWith('-hvac') ? { ...item, parentItemId: rootPhase.id } : item),
];
/** North's Punch list follows South's Install HVAC (set while the page grouped by root). */
const withCrossLink = combined.map(item => item.id === '0-punch'
  ? { ...item, dependencies: [{ predecessorItemId: '1-hvac', type: 'FS' as const }] }
  : item);

const heading = (screen: ReturnType<typeof render>, name: string) =>
  screen.queryAllByText(name).filter(node => node.parent?.parent && within(node.parent.parent as never).queryByText(/ items$/));
const itemsUnder = (screen: ReturnType<typeof render>, name: string) =>
  heading(screen, name).map(node => within(node.parent!.parent as never).getByText(/ items$/).props.children.join(''));
const isOrphanRow = (row: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(row.props.style as never) as { borderLeftWidth?: number } | undefined)?.borderLeftWidth === 4;
const predecessorChoices = (screen: ReturnType<typeof render>) => screen.getAllByRole('checkbox').map(choice => ({
  label: within(choice).getAllByText(/./).map(node => [node.props.children].flat().join('')).join(''),
  checked: Boolean(choice.props.accessibilityState?.checked),
}));
const selectOptions = (screen: ReturnType<typeof render>, label: string) =>
  [screen.getByLabelText(label).props.children].flat().map((option: { props: { value: string; children: string } }) =>
    ({ value: option.props.value, label: option.props.children }));

describe('A5 p13 L1: a phase added under the root, holding a task of each building', () => {
  beforeEach(() => mockUpdateTask.mockReset());

  it('its children are not orphan rows, and neither building shows a hierarchy issue', () => {
    const screen = render(<DesktopSchedulePage tasks={withPhase} projects={[ROOT]} selectedProject={ROOT} />);
    // Grouping for display stays by building; the phase keeps its own (root) project.
    expect(itemsUnder(screen, 'Harbor North')).toEqual(['3 items']);
    expect(itemsUnder(screen, 'Harbor South')).toEqual(['3 items']);
    expect(itemsUnder(screen, ROOT)).toEqual(['1 items']);
    expect(screen.queryByText(/hierarchy issue/)).toBeNull();
    const hvacRows = screen.getAllByLabelText('Edit INSTALL HVAC');
    expect(hvacRows).toHaveLength(2);
    expect(hvacRows.map(isOrphanRow)).toEqual([false, false]);
  });

  it('the editor shows the phase as the task\'s parent, labelled with its project, and it can be cleared', async () => {
    const screen = render(<DesktopSchedulePage tasks={withPhase} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getAllByLabelText('Edit INSTALL HVAC')[0]);
    expect(screen.getByLabelText('Parent phase').props.value).toBe(rootPhase.id);
    expect(selectOptions(screen, 'Parent phase')).toEqual([
      { value: '', label: 'No parent phase' },
      { value: rootPhase.id, label: `MEP ROUGH-IN (${ROOT})` },
    ]);
    fireEvent(screen.getByLabelText('Parent phase'), 'change', { target: { value: '' } });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: '0-hvac', projectName: 'Harbor North', scheduleProjectName: ROOT, parentItemId: null,
    })));
  });

  it('a parent that is missing, or under another root, is still an issue', () => {
    const tasks = [
      task('other-phase', 'Other Tower', 'Other Root', 'OTHER PHASE', '', { isSummary: true }),
      ...combined.map(item => item.id === '0-hvac'
        ? { ...item, parentItemId: 'other-phase' }
        : item.id === '1-hvac' ? { ...item, parentItemId: 'deleted-phase' } : item),
    ];
    const screen = render(<DesktopSchedulePage tasks={tasks} projects={[ROOT]} selectedProject={ROOT} />);
    expect(screen.getAllByText('1 hierarchy issue need review.')).toHaveLength(2);
    expect(screen.getAllByLabelText('Edit INSTALL HVAC').map(isOrphanRow)).toEqual([true, true]);
  });
});

describe('A5 p13 L1: North\'s Punch list follows South\'s Install HVAC', () => {
  beforeEach(() => mockUpdateTask.mockReset());

  it('the editor lists the South predecessor, labelled with its building and checked, beside North\'s own tasks', () => {
    const screen = render(<DesktopSchedulePage tasks={withCrossLink} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getAllByLabelText('Edit PUNCH LIST')[0]);
    expect(predecessorChoices(screen)).toEqual([
      { label: 'N.1 · POUR SLAB', checked: false },
      { label: 'N.2 · INSTALL HVAC', checked: false },
      { label: 'S.2 · INSTALL HVAC (Harbor South)', checked: true },
    ]);
  });

  it('unchecking it and saving drops the link', async () => {
    const screen = render(<DesktopSchedulePage tasks={withCrossLink} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getAllByLabelText('Edit PUNCH LIST')[0]);
    fireEvent.press(screen.getAllByRole('checkbox')[2]);
    expect(predecessorChoices(screen)[2]).toEqual({ label: 'S.2 · INSTALL HVAC (Harbor South)', checked: false });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: '0-punch', projectName: 'Harbor North', dependencies: [],
    })));
  });

  it('left checked, saving keeps it', async () => {
    const screen = render(<DesktopSchedulePage tasks={withCrossLink} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getAllByLabelText('Edit PUNCH LIST')[0]);
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: '0-punch', dependencies: [expect.objectContaining({ predecessorItemId: '1-hvac' })],
    })));
  });

  it('a task with no cross-building link is offered its own building\'s tasks only, as before', () => {
    const screen = render(<DesktopSchedulePage tasks={withCrossLink} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getAllByLabelText('Edit PUNCH LIST')[1]);
    expect(predecessorChoices(screen).map(choice => choice.label)).toEqual(['S.1 · POUR SLAB', 'S.2 · INSTALL HVAC']);
  });
});

/**
 * Owner answer Q29 (2 Oct 2026): a hand link follows its task to the row a new
 * master saved for it. A link saved before then can still point at the old
 * row the master hid: the page reads it as the task's row shown, never
 * "Missing", and opening the task in the editor checks that row, so a save
 * stores the link on it.
 */
describe('owner answer Q29: a link to a row a newer master hid', () => {
  beforeEach(() => mockUpdateTask.mockReset());
  const excavate = task('g-excavate', 'Alpha', 'Alpha', 'Excavate', '10/05/2026', { wbsCode: '1.1' });
  const fFraming = task('f-framing', 'Alpha', 'Alpha', 'Framing', '10/16/2026', { wbsCode: '1.2' });
  const gFraming = task('g-framing', 'Alpha', 'Alpha', 'Framing', '10/18/2026', { wbsCode: '1.2', revisedFromTaskIds: ['f-framing'] });
  const roofing = task('g-roofing', 'Alpha', 'Alpha', 'Roofing', '10/30/2026', {
    wbsCode: '1.3', dependencies: [{ predecessorItemId: 'f-framing', type: 'FS' }],
  });
  const shownTasks = [excavate, gFraming, roofing];

  it('reads the row shown for the task, not "Missing"; with no saved rows known, "Missing" as before', () => {
    mockSnapshot = { knownScheduleItems: [...shownTasks, fFraming] };
    const screen = render(<DesktopSchedulePage tasks={shownTasks} projects={['Alpha']} selectedProject="Alpha" />);
    expect(screen.queryByText('Missing')).toBeNull();
    mockSnapshot = null;
    const before = render(<DesktopSchedulePage tasks={[excavate, roofing]} projects={['Alpha']} selectedProject="Alpha" />);
    expect(before.getByText('Missing')).toBeTruthy();
  });

  it('the editor checks the row shown, and saving stores the link on it', async () => {
    mockSnapshot = { knownScheduleItems: [...shownTasks, fFraming] };
    const screen = render(<DesktopSchedulePage tasks={shownTasks} projects={['Alpha']} selectedProject="Alpha" />);
    fireEvent.press(screen.getByLabelText('Edit Roofing'));
    expect(predecessorChoices(screen)).toEqual([
      { label: '1.1 · Excavate', checked: false },
      { label: '1.2 · Framing', checked: true },
    ]);
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 'g-roofing', dependencies: [{ predecessorItemId: 'g-framing', type: 'FS', lagDays: 0 }],
    })));
    mockSnapshot = null;
  });
});
