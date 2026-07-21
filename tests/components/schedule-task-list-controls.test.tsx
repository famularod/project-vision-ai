import { fireEvent, render } from '@testing-library/react-native';

import {
  ScheduleTaskListControls,
  type ScheduleTaskView,
} from '../../components/schedule-task-list-controls';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('ScheduleTaskListControls', () => {
  it('provides separate open and completed task tabs with their counts', async () => {
    const onViewChange = jest.fn<void, [ScheduleTaskView]>();
    const screen = await render(
      <ScheduleTaskListControls
        taskCount={6}
        dueSoonCount={1}
        overdueCount={1}
        needsActionCount={2}
        openTaskCount={2}
        completedTaskCount={4}
        activeView="Open Tasks"
        activeFilter="All"
        onViewChange={onViewChange}
        onFilterChange={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    const completedTab = screen.getByRole('tab', {
      name: 'Completed Tasks, 4 tasks',
    });
    expect(screen.getByRole('tab', { name: 'Open Tasks, 2 tasks' })).toBeTruthy();
    expect(completedTab).toBeTruthy();

    await fireEvent.press(completedTab);
    expect(onViewChange).toHaveBeenCalledWith('Completed Tasks');
  });

  it('hides open-task quick filters while completed tasks are selected', async () => {
    const screen = await render(
      <ScheduleTaskListControls
        taskCount={6}
        dueSoonCount={1}
        overdueCount={1}
        needsActionCount={2}
        openTaskCount={2}
        completedTaskCount={4}
        activeView="Completed Tasks"
        activeFilter="Attention"
        onViewChange={jest.fn()}
        onFilterChange={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    expect(screen.queryByText('Work requiring attention')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show attention open tasks' })).toBeNull();
  });
});
