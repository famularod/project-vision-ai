import { fireEvent, render } from '@testing-library/react-native';

import {
  ScheduleTaskListControls,
  type ScheduleTaskView,
  type ScheduleWorkspaceView,
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
        onNeedsAttentionPress={jest.fn()}
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
        onNeedsAttentionPress={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    expect(screen.queryByText('Work requiring attention')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show attention open tasks' })).toBeNull();
  });

  it('uses the compact Needs Attention metric as a task-list control', async () => {
    const onNeedsAttentionPress = jest.fn();
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
        onViewChange={jest.fn()}
        onFilterChange={jest.fn()}
        onNeedsAttentionPress={onNeedsAttentionPress}
        onAddTask={jest.fn()}
      />,
    );

    const needsAttention = screen.getByRole('button', {
      name: 'Needs Attention: 2. Show tasks that need attention',
    });

    await fireEvent.press(needsAttention);
    expect(onNeedsAttentionPress).toHaveBeenCalledTimes(1);
  });

  it('uses the summary cards as the open-task filters', async () => {
    const onViewChange = jest.fn<void, [ScheduleTaskView]>();
    const onFilterChange = jest.fn();
    const screen = await render(
      <ScheduleTaskListControls
        taskCount={6}
        dueSoonCount={1}
        overdueCount={1}
        needsActionCount={2}
        openTaskCount={2}
        completedTaskCount={4}
        activeView="Open Tasks"
        activeFilter="Attention"
        onViewChange={onViewChange}
        onFilterChange={onFilterChange}
        onNeedsAttentionPress={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByRole('button', {
      name: 'Tasks: 6. Show all open tasks',
    }));
    await fireEvent.press(screen.getByRole('button', {
      name: 'Due 7 Days: 1. Show tasks due within 7 days',
    }));
    await fireEvent.press(screen.getByRole('button', {
      name: 'Overdue: 1. Show overdue tasks',
    }));

    expect(onViewChange).toHaveBeenCalledTimes(3);
    expect(onViewChange).toHaveBeenNthCalledWith(1, 'Open Tasks');
    expect(onFilterChange).toHaveBeenNthCalledWith(1, 'All');
    expect(onFilterChange).toHaveBeenNthCalledWith(2, '7 Days');
    expect(onFilterChange).toHaveBeenNthCalledWith(3, 'Overdue');
    expect(screen.queryByText('Work requiring attention')).toBeNull();
  });

  it('makes timeline and lookahead visible from the mobile task destination', async () => {
    const onWorkspaceViewChange = jest.fn<void, [ScheduleWorkspaceView]>();
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
        workspaceView="Tasks"
        onWorkspaceViewChange={onWorkspaceViewChange}
        onViewChange={jest.fn()}
        onFilterChange={jest.fn()}
        onNeedsAttentionPress={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    expect(screen.getByText('Tasks & Schedule')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Timeline schedule view' }));
    expect(onWorkspaceViewChange).toHaveBeenCalledWith('Timeline');
    await fireEvent.press(screen.getByRole('tab', { name: 'Lookahead schedule view' }));
    expect(onWorkspaceViewChange).toHaveBeenCalledWith('Lookahead');
  });

  it('hides task-only controls while a planning view is active', async () => {
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
        workspaceView="Timeline"
        onWorkspaceViewChange={jest.fn()}
        onViewChange={jest.fn()}
        onFilterChange={jest.fn()}
        onNeedsAttentionPress={jest.fn()}
        onAddTask={jest.fn()}
      />,
    );

    expect(screen.queryByText('Work requiring attention')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Open Tasks, 2 tasks' })).toBeNull();
  });
});
