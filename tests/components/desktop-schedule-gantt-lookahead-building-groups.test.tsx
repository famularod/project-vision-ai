/**
 * Audit round 2, A5 pass 13 (1 Oct 2026), older finding in the same area as
 * L1: the web Schedule page's Gantt and Lookahead views grouped a combined
 * Microsoft Project master's tasks by its root.
 *
 * Every row of the master carries its root ("2400 Compliance Project") as its
 * schedule project and Harbor North or Harbor South as its app project. The
 * Builder shows each building's tasks under it (A5 pass 12 K1), but the Gantt
 * and Lookahead put both buildings' identical tasks side by side under one
 * root heading, and the Lookahead's CSV export named the root as each row's
 * project.
 *
 * Now the web's Gantt and Lookahead group by the task's app project
 * (projectName, the root only when it names none, as scheduleTaskProjectKey
 * keys it). The phone's Timeline and Lookahead use the same two builders with
 * their default, which is unchanged. A CSV master (no root) shows exactly as
 * before. Synthetic data.
 */
import { fireEvent, render, within } from '@testing-library/react-native';

import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { buildVitruviusGanttModel } from '../../services/VitruviusGanttModel';
import { buildVitruviusLookahead, vitruviusLookaheadCsv } from '../../services/VitruviusLookahead';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({ userEmail: 'pm@example.com', createTask: jest.fn(), updateTask: jest.fn() }),
}));

const ROOT = '2400 Compliance Project';
const TODAY = new Date('2026-10-01T18:00:00.000Z');
function task(id: string, projectName: string, scheduleProjectName: string | null, taskName: string, finishDate: string,
  extra: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id, projectId: `cloud-${projectName}`, itemType: 'Task', scheduleProjectName, projectName, projectTimeZone: 'America/Los_Angeles',
    locationName: 'Level 1', taskName, startDate: finishDate, finishDate, milestone: '', owner: '', contractor: '', durationDays: 1,
    percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', nextAction: '', activity: [],
    importBatchId: 'batch-master-c', sourceDocumentId: 'MASTER C', createdAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z', cloudUpdatedAt: '2026-09-15T12:00:01.000Z', ...extra,
  } as DAVEWebScheduleItem;
}
/**
 * The combined master's rows: the same three tasks in each building, on the
 * same dates, under one root. Dates already past, so the Lookahead lists
 * them (as overdue) whatever day the test runs.
 */
const combined = ['Harbor North', 'Harbor South'].flatMap((building, index) => [
  task(`${index}-slab`, building, ROOT, 'POUR SLAB', '2025-09-03'),
  task(`${index}-hvac`, building, ROOT, 'INSTALL HVAC', '2025-10-07'),
  task(`${index}-punch`, building, ROOT, 'PUNCH LIST', '2025-12-18'),
]);
const csvMaster = ['Alpha', 'Beta'].flatMap((project, index) => [
  task(`${index}-a`, project, project, 'POUR SLAB', '2025-09-03'),
  task(`${index}-b`, project, project, 'INSTALL HVAC', '2025-10-07'),
]);

const headingCount = (screen: ReturnType<typeof render>, name: string) =>
  screen.queryAllByText(name)
    .filter(node => node.parent?.parent && within(node.parent.parent as never).queryByText(/ items$/))
    .map(node => within(node.parent!.parent as never).getByText(/ items$/).props.children.join(''));

describe('A5 p13: the web Gantt groups a combined master by building', () => {
  it('each building is labelled once, above its own three rows, and the root is not a label', () => {
    const screen = render(<DesktopSchedulePage tasks={combined} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getByText('Gantt'));
    expect(screen.getAllByText('Harbor North')).toHaveLength(1);
    expect(screen.getAllByText('Harbor South')).toHaveLength(1);
    expect(screen.queryAllByText(ROOT)).toHaveLength(0);
  });

  it('the web\'s grouping: North\'s rows, then South\'s; a single-building master under its building', () => {
    const model = buildVitruviusGanttModel({ items: combined, zoom: 'week', today: TODAY, groupBy: 'appProject' });
    expect(model.rows.map(row => `${row.projectName}: ${row.item.id}`)).toEqual([
      'Harbor North: 0-slab', 'Harbor North: 0-hvac', 'Harbor North: 0-punch',
      'Harbor South: 1-slab', 'Harbor South: 1-hvac', 'Harbor South: 1-punch',
    ]);
    const north = buildVitruviusGanttModel({ items: combined.slice(0, 3), zoom: 'week', today: TODAY, groupBy: 'appProject' });
    expect(new Set(north.rows.map(row => row.projectName))).toEqual(new Set(['Harbor North']));
  });
});

describe('A5 p13: the web Lookahead groups a combined master by building', () => {
  it('a heading per building with its three rows, none for the root', () => {
    const screen = render(<DesktopSchedulePage tasks={combined} projects={[ROOT]} selectedProject={ROOT} />);
    fireEvent.press(screen.getByText('Lookahead'));
    expect(headingCount(screen, 'Harbor North')).toEqual(['3 items']);
    expect(headingCount(screen, 'Harbor South')).toEqual(['3 items']);
    expect(screen.queryAllByText(ROOT)).toHaveLength(0);
  });

  it('the web\'s rows and CSV export name the building', () => {
    const lookahead = buildVitruviusLookahead({ items: combined, weeks: 3, today: TODAY, groupBy: 'appProject' });
    expect(lookahead.rows.map(row => `${row.projectName}: ${row.item.id}`)).toEqual([
      'Harbor North: 0-slab', 'Harbor South: 1-slab',
      'Harbor North: 0-hvac', 'Harbor South: 1-hvac',
      'Harbor North: 0-punch', 'Harbor South: 1-punch',
    ]);
    const csv = vitruviusLookaheadCsv(lookahead);
    expect(csv).toContain('"Harbor North","Level 1","","POUR SLAB"');
    expect(csv).not.toContain(ROOT);
  });
});

describe('A5 p13: unchanged where it should be', () => {
  it('the phone\'s Timeline and Lookahead (the builders\' default) still group a combined master by its root', () => {
    const model = buildVitruviusGanttModel({ items: combined, zoom: 'week', today: TODAY });
    expect(new Set(model.rows.map(row => row.projectName))).toEqual(new Set([ROOT]));
    const lookahead = buildVitruviusLookahead({ items: combined, weeks: 3, today: TODAY });
    expect(new Set(lookahead.rows.map(row => row.projectName))).toEqual(new Set([ROOT]));
  });

  it('a CSV master: the web\'s grouping gives exactly the default model, and one heading per project', () => {
    expect(buildVitruviusGanttModel({ items: csvMaster, zoom: 'week', today: TODAY, groupBy: 'appProject' }))
      .toEqual(buildVitruviusGanttModel({ items: csvMaster, zoom: 'week', today: TODAY }));
    expect(buildVitruviusLookahead({ items: csvMaster, weeks: 6, today: TODAY, groupBy: 'appProject' }))
      .toEqual(buildVitruviusLookahead({ items: csvMaster, weeks: 6, today: TODAY }));
    const screen = render(<DesktopSchedulePage tasks={csvMaster} projects={['Alpha', 'Beta']} selectedProject={null} />);
    fireEvent.press(screen.getByText('Lookahead'));
    expect(headingCount(screen, 'Alpha')).toEqual(['2 items']);
    expect(headingCount(screen, 'Beta')).toEqual(['2 items']);
    fireEvent.press(screen.getByText('Gantt'));
    expect(screen.getAllByText('Alpha')).toHaveLength(1);
    expect(screen.getAllByText('Beta')).toHaveLength(1);
  });

  it('a task naming no schedule project: the phone keeps "Unassigned Project", the web shows its project', () => {
    const manual = [task('m-1', 'Alpha', null, 'WALKTHROUGH', '2025-09-03')];
    expect(buildVitruviusGanttModel({ items: manual, zoom: 'week', today: TODAY }).rows[0]?.projectName).toBe('Unassigned Project');
    expect(buildVitruviusGanttModel({ items: manual, zoom: 'week', today: TODAY, groupBy: 'appProject' }).rows[0]?.projectName).toBe('Alpha');
  });
});
