/**
 * Audit round 2, A5 pass 12 leftovers K1 (1 Oct 2026): the web Schedule page
 * grouped tasks by their Microsoft Project root.
 *
 * A combined Microsoft Project master uploaded on the web keeps its root
 * ("2400 Compliance Project") as every row's schedule project, with Harbor
 * North or Harbor South as the row's app project
 * (audit-r2-a5p12-root-keying-lookahead-and-health.test.ts runs that upload).
 * The web lists the root as the project. The Schedule page put both
 * buildings' tasks under one "2400 Compliance Project" heading, the twin
 * Install HVAC rows side by side with nothing to tell them apart, and the
 * editor showed the root as the task's project and offered the other
 * building's tasks as phases and predecessors.
 *
 * Now each task shows under its building (its app project), the editor shows
 * the building and offers that building's tasks, and saving keeps the task's
 * stored names. A CSV master (no root) shows as before. Synthetic data.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));
const mockUpdateTask = jest.fn();
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({ userEmail: 'pm@example.com', createTask: jest.fn(), updateTask: mockUpdateTask }),
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
/** The combined master's rows: the same three tasks in each building, on the same dates, under one root. */
const combined = ['Harbor North', 'Harbor South'].flatMap((building, index) => [
  task(`${index}-slab`, building, ROOT, 'POUR SLAB', '09/03/2026'),
  task(`${index}-hvac`, building, ROOT, 'INSTALL HVAC', '10/07/2026'),
  task(`${index}-punch`, building, ROOT, 'PUNCH LIST', '12/18/2026'),
]);
const heading = (screen: ReturnType<typeof render>, name: string) =>
  screen.queryAllByText(name).filter(node => node.parent?.parent && within(node.parent.parent as never).queryByText(/ items$/));
const itemsUnder = (screen: ReturnType<typeof render>, name: string) =>
  heading(screen, name).map(node => within(node.parent!.parent as never).getByText(/ items$/).props.children.join(''));
/** The editor's predecessor choices, by task id order of the page. */
const predecessorChoices = (screen: ReturnType<typeof render>) => screen.getAllByRole('checkbox')
  .map(choice => within(choice).queryByText(/POUR SLAB|INSTALL HVAC|PUNCH LIST/)?.props.children)
  .filter(Boolean)
  .map(children => [children].flat().join(''));

describe('A5 p12 K1: the web Schedule page shows a combined Microsoft Project master\'s tasks under their buildings', () => {
  beforeEach(() => mockUpdateTask.mockReset());

  it('the scenario: the web\'s read lists the root as the project, the buildings only as cloud projects', async () => {
    const master = { id: 'MASTER C', name: 'MASTER C', category: 'Schedules', isCurrent: true, projectNames: ['Harbor North', 'Harbor South'],
      importBatchId: 'batch-master-c', importedAt: '2026-09-15T12:00:00.000Z' };
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: ['Harbor North', 'Harbor South'].map(name => ({ id: `cloud-${name}`, name, archived: false })),
      scheduleItems: combined.map(item => ({ id: item.id, updated_at: item.updatedAt, item_data: item })),
      projectUpdates: [],
      referenceDocuments: [{ id: master.id, name: master.name, category: 'Schedules', updated_at: master.importedAt, document_data: master }],
      syncTombstones: [],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    // So the Documents page's project choice is the root too: its area hints, keyed by the root, match it (left as is).
    expect(snapshot.projects.map(project => project.name)).toEqual([ROOT]);
    expect(snapshot.openCloudProjects?.map(project => project.name)).toEqual(['Harbor North', 'Harbor South']);
    expect(snapshot.scheduleItems).toHaveLength(6);
  });

  it('with the root chosen (the web lists it as the project), each building is its own group and the root has none', () => {
    const screen = render(<DesktopSchedulePage tasks={combined} projects={[ROOT]} selectedProject={ROOT} />);
    expect(itemsUnder(screen, 'Harbor North')).toEqual(['3 items']);
    expect(itemsUnder(screen, 'Harbor South')).toEqual(['3 items']);
    expect(itemsUnder(screen, ROOT)).toEqual([]);
  });

  it('with no project chosen, the same', () => {
    const screen = render(<DesktopSchedulePage tasks={combined} projects={[ROOT]} selectedProject={null} />);
    expect(itemsUnder(screen, 'Harbor North')).toEqual(['3 items']);
    expect(itemsUnder(screen, 'Harbor South')).toEqual(['3 items']);
    expect(itemsUnder(screen, ROOT)).toEqual([]);
  });

  it('the editor shows the task\'s building, offers that building\'s tasks only, and saving keeps its stored names', async () => {
    const screen = render(<DesktopSchedulePage tasks={combined} projects={[ROOT]} selectedProject={ROOT} />);
    // North's Install HVAC is the first of the two twins on the page.
    fireEvent.press(screen.getAllByLabelText('Edit INSTALL HVAC')[0]);
    expect(screen.getByLabelText('Project').props.value).toBe('Harbor North');
    expect(predecessorChoices(screen)).toEqual(['POUR SLAB', 'PUNCH LIST']);
    fireEvent(screen.getByLabelText('Area'), 'change', { target: { value: 'Level 2' } });
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: '0-hvac', projectName: 'Harbor North', scheduleProjectName: ROOT, projectId: 'cloud-Harbor North', locationName: 'Level 2',
    })));
    expect(screen.queryByText(/Move work between projects/)).toBeNull();
  });

  it('a predecessor in the other building under the same root (set while the page grouped by root) is not shown as missing', () => {
    const tasks = combined.map(item => item.id === '0-punch'
      ? { ...item, dependencies: [{ predecessorItemId: '1-hvac', type: 'FS' as const }] }
      : item.id === '1-hvac' ? { ...item, wbsCode: 'S.2' } : item);
    const screen = render(<DesktopSchedulePage tasks={tasks} projects={[ROOT]} selectedProject={ROOT} />);
    // Its own WBS cell, and Punch list's predecessor label.
    expect(screen.getAllByText('S.2')).toHaveLength(2);
    expect(screen.queryByText('Missing')).toBeNull();
  });

  it('a single-building Microsoft Project master shows under its building too', () => {
    const north = combined.filter(item => item.projectName === 'Harbor North');
    const screen = render(<DesktopSchedulePage tasks={north} projects={[ROOT]} selectedProject={ROOT} />);
    expect(itemsUnder(screen, 'Harbor North')).toEqual(['3 items']);
    expect(itemsUnder(screen, ROOT)).toEqual([]);
  });
});

describe('A5 p12 K1: a CSV master shows as before', () => {
  const csv = ['Alpha', 'Beta'].flatMap((project, index) => [
    task(`${index}-a`, project, project, 'POUR SLAB', '09/03/2026'),
    task(`${index}-b`, project, project, 'INSTALL HVAC', '10/07/2026'),
  ]);

  it('one group per project, the chosen project with no items still shown while there are none', () => {
    const screen = render(<DesktopSchedulePage tasks={csv} projects={['Alpha', 'Beta']} selectedProject={null} />);
    expect(itemsUnder(screen, 'Alpha')).toEqual(['2 items']);
    expect(itemsUnder(screen, 'Beta')).toEqual(['2 items']);
    const empty = render(<DesktopSchedulePage tasks={[]} projects={['Alpha', 'Beta']} selectedProject="Alpha" />);
    expect(itemsUnder(empty, 'Alpha')).toEqual(['0 items']);
  });

  it('the editor shows the project and its own tasks', () => {
    const screen = render(<DesktopSchedulePage tasks={csv.filter(item => item.projectName === 'Alpha')} projects={['Alpha']} selectedProject="Alpha" />);
    fireEvent.press(screen.getByLabelText('Edit INSTALL HVAC'));
    expect(screen.getByLabelText('Project').props.value).toBe('Alpha');
    expect(predecessorChoices(screen)).toEqual(['POUR SLAB']);
  });
});
