/**
 * Review pass 1, L3 (older), on screen. A task that already holds a year
 * outside 2000 through 2100 no longer stretches the timeline; it stays
 * listed. And a file with such a date says "check this date" in the import
 * review on the phone, the iPad and the web, before it is approved.
 */
import { act, fireEvent, render } from '@testing-library/react-native';

import { AppShellLayoutProvider, appShellLayoutForWidth } from '../../components/app-shell-layout';
import { MobileSchedulePlanning } from '../../components/mobile-schedule-planning';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import type { ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => ({
    userEmail: 'pm@example.com',
    snapshot: { projects: [{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: 'Lot 9' }] },
    createTask: jest.fn(),
    updateTask: jest.fn(),
    updateTasks: jest.fn(),
    refreshSnapshot: jest.fn(async () => true),
  }),
}));

const PROJECT = 'Lot 9';

function scheduleItem(id: string, overrides: Partial<DAVEWebScheduleItem> = {}): DAVEWebScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    itemType: 'Task',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Pad',
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
const stray = scheduleItem('stray', { taskName: 'Stray date', startDate: '0202-05-01', finishDate: '0202-05-04' });

/** Stops a runaway timeline at once instead of after minutes. */
function boundedDaySteps<T>(limit: number, work: () => T): T {
  const real = Date.prototype.setUTCDate;
  let steps = 0;
  const spy = jest.spyOn(Date.prototype, 'setUTCDate').mockImplementation(function (this: Date, day: number) {
    steps += 1;
    if (steps > limit) throw new Error(`More than ${limit} one-day steps: the timeline is not bounded.`);
    return real.call(this, day);
  });
  try {
    return work();
  } finally {
    spy.mockRestore();
  }
}

describe('L3: the desktop Gantt with a task dated in the year 0202', () => {
  it('draws the weeks the other tasks need, lists the task, and says it has no place on the timeline (was: about 95,000 week columns)', () => {
    const screen = boundedDaySteps(50_000, () => {
      const page = render(<DesktopSchedulePage tasks={[pour, stray]} projects={[PROJECT]} selectedProject={PROJECT} />);
      fireEvent.press(page.getByText('Gantt'));
      return page;
    });
    // Two week columns, each with its heading: the weeks of 13 and 20 July.
    expect(screen.getAllByText(/^Week of /).map(node => node.props.children)).toEqual(['Week of Jul 13', 'Week of Jul 20']);
    expect(screen.getByLabelText('Open timeline item Stray date')).toBeTruthy();
    expect(screen.getByLabelText('Open timeline item Pour slab')).toBeTruthy();
    expect(screen.getAllByText('Set dates to place this item')).toHaveLength(1);
  });
});

describe('L3: the phone and iPad Timeline with the same task', () => {
  it('shows the span of the other tasks and still lists the task with its own date', () => {
    const screen = boundedDaySteps(50_000, () => render(
      <AppShellLayoutProvider layout={appShellLayoutForWidth(390)}>
        <MobileSchedulePlanning items={[pour, stray] as ScheduleItem[]} view="Timeline" onOpenTask={jest.fn()} />
      </AppShellLayoutProvider>,
    ));
    expect(screen.getByText('Jul 13, 2026 – Jul 26, 2026')).toBeTruthy();
    expect(screen.getByLabelText('Open timeline task Stray date, 0% complete')).toBeTruthy();
    expect(screen.getByText('May 1, 202 – May 4, 202')).toBeTruthy();
  });
});

describe('L3: the import review on the phone and iPad', () => {
  const batch = (items: Partial<ScheduleItem>[]): PIEScheduleImportBatch => ({
    id: 'uploaded-schedule-1',
    kind: 'schedule_file',
    sourceCount: 1,
    sourceLabel: 'lot-9.csv',
    message: `${items.length} schedule items prepared.`,
    documents: [],
    items: items.map((item, index) => ({
      id: `row-${index + 1}`, taskName: `Row ${index + 1}`, projectName: PROJECT, locationName: 'North Pad',
      startDate: '07/21/2026', finishDate: '07/22/2026', milestone: '', owner: 'David', contractor: '', durationDays: 1,
      percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', createdAt: '2026-07-21T12:00:00.000Z',
      ...item,
    })) as ScheduleItem[],
  });

  const review = async (incoming: PIEScheduleImportBatch, onApprove = jest.fn(async () => undefined)) => {
    const view = render(
      <ScheduleImportFlow
        screenshotImportAvailable={false}
        onImportFile={jest.fn(() => Promise.resolve(null))}
        onImportScreenshots={jest.fn(() => Promise.resolve(null))}
        onAddManually={jest.fn()}
        onApprove={onApprove}
        onCancel={jest.fn()}
        incomingBatch={incoming}
        onIncomingBatchConsumed={jest.fn()}
      />,
    );
    expect(await view.findByText('Review Imported Schedule')).toBeTruthy();
    return { view, onApprove };
  };

  it('a start date of 5/1/0202 is flagged on its row with the date named (was: "Ready to add", nothing said)', async () => {
    const { view } = await review(batch([
      { taskName: 'Pour slab' },
      { taskName: 'Grade pad', startDate: '5/1/0202', finishDate: '07/22/2026' },
    ]));
    expect(view.getByText('Needs date check')).toBeTruthy();
    expect(view.getByText('Check this date: the start date 5/1/0202 is outside 2000 to 2100.')).toBeTruthy();
    expect(view.getAllByText('Ready to add')).toHaveLength(1);
    expect(view.getByText('1 source • 1 ready • 1 need review')).toBeTruthy();
  });

  it('a finish date of 12/31/9999 is flagged the same way, and its box is marked when the row is opened', async () => {
    const { view } = await review(batch([{ taskName: 'Close out', finishDate: '12/31/9999' }]));
    expect(view.getByText('Check this date: the finish date 12/31/9999 is outside 2000 to 2100.')).toBeTruthy();
    fireEvent.press(view.getByText('Review or edit'));
    expect(view.getByDisplayValue('12/31/9999')).toBeTruthy();
    // Still said with the boxes open, and gone once the date is corrected.
    expect(view.getByText('Check this date: the finish date 12/31/9999 is outside 2000 to 2100.')).toBeTruthy();
    fireEvent.changeText(view.getByDisplayValue('12/31/9999'), '12/31/2026');
    expect(view.queryByText(/Check this date/)).toBeNull();
    expect(view.getByText('Ready to add')).toBeTruthy();
  });

  it('a CSV\'s "5/1/0202", which the import writes back as 05/01/202: the row said only "Needs date"; it now says which date and why', async () => {
    const { view } = await review(batch([{ taskName: 'Grade pad', startDate: '05/01/202' }]));
    expect(view.getByText('Needs date')).toBeTruthy();
    expect(view.getByText('Check this date: the start date 05/01/202 is outside 2000 to 2100.')).toBeTruthy();
  });

  it('the flag does not stop the import: Accept All saves the rows with their dates exactly as written', async () => {
    const { view, onApprove } = await review(batch([
      { taskName: 'Pour slab' },
      { taskName: 'Grade pad', startDate: '5/1/0202', finishDate: '5/4/0202' },
    ]));
    await act(async () => { fireEvent.press(view.getByText('Accept All (2)')); });
    expect(onApprove).toHaveBeenCalledTimes(1);
    const approved = (onApprove.mock.calls[0] as unknown as [PIEScheduleImportBatch])[0];
    expect(approved.items.map(item => [item.taskName, item.startDate, item.finishDate])).toEqual([
      ['Pour slab', '07/21/2026', '07/22/2026'],
      ['Grade pad', '5/1/0202', '5/4/0202'],
    ]);
  });

  // Guard: this already holds.
  it('ordinary dates are not flagged', async () => {
    const { view } = await review(batch([{ taskName: 'Pour slab' }, { taskName: 'Frame walls' }]));
    expect(view.queryByText(/Check this date/)).toBeNull();
    expect(view.getAllByText('Ready to add')).toHaveLength(2);
  });
});
