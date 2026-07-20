import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { ScheduleWideWorkspace } from '../../components/schedule-workspace-layout';
import type { ScheduleItem } from '../../types';

const taskA: ScheduleItem = {
  id: 'task-a',
  projectName: 'Project A',
  locationName: 'Canopy A',
  taskName: 'Install panels',
  startDate: '',
  finishDate: '07/30/2026',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 25,
  priority: 'Medium',
  status: 'In Progress',
  notes: '',
  createdAt: '2026-07-19T12:00:00.000Z',
};

describe('ScheduleWideWorkspace', () => {
  it('provides an accessible task master list and controlled inspector selection', async () => {
    const screen = await render(<WorkspaceProbe />);

    expect(screen.getByTestId('schedule-wide-workspace')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'TASK INSPECTOR' })).toBeTruthy();
    expect(screen.getByText('Task controls')).toBeTruthy();
    expect(screen.getByText('Schedule tools')).toBeTruthy();
    expect(screen.getByText('Inspecting task-a')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Open task Install rails' }));

    expect(screen.getByText('Inspecting task-b')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Open task Install rails' }).props
        .accessibilityState,
    ).toEqual({ selected: true });
  });

  it('shows project headings when All Projects tasks are grouped', async () => {
    const screen = await render(
      <ScheduleWideWorkspace
        items={[
          { ...taskA, id: 'task-b', projectName: 'Project B' },
          taskA,
        ]}
        selectedTaskId="task-a"
        onSelectTask={jest.fn()}
        masterHeader={<Text>All Tasks</Text>}
        inspector={<Text>Inspector</Text>}
        inspectorFooter={null}
        emptyState={<Text>No tasks</Text>}
        groupByProject
      />,
    );

    expect(screen.getByRole('header', { name: 'Project A' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Project B' })).toBeTruthy();
    expect(screen.getAllByText('1 task')).toHaveLength(2);
  });
});

function WorkspaceProbe() {
  const [selectedTaskId, setSelectedTaskId] = useState('task-a');
  const items = [taskA, { ...taskA, id: 'task-b', taskName: 'Install rails' }];

  return (
    <ScheduleWideWorkspace
      items={items}
      selectedTaskId={selectedTaskId}
      onSelectTask={setSelectedTaskId}
      masterHeader={<Text>Task controls</Text>}
      inspector={<Text>{`Inspecting ${selectedTaskId}`}</Text>}
      inspectorFooter={<Text>Schedule tools</Text>}
      emptyState={<Text>No tasks</Text>}
    />
  );
}
