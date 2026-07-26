import { fireEvent, render } from '@testing-library/react-native';

import { ScheduleTaskEditorModal } from '../../components/schedule-task-editor-modal';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <View {...props} />,
  };
});

describe('ScheduleTaskEditorModal', () => {
  it('uses native calendar controls for both task dates', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select start date' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select finish / due date' })).toBeTruthy();
    expect(screen.getByTestId('new-task-start-date')).toBeTruthy();
    expect(screen.getByTestId('new-task-finish-date')).toBeTruthy();
  });

  it('creates a typed project item with a next accountable action', async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.changeText(screen.getByPlaceholderText('Example: East driveway striping'), 'Missing storefront glass');
    fireEvent.press(screen.getByText('Issue'));
    fireEvent.changeText(screen.getByPlaceholderText('Smallest accountable next step'), 'Confirm delivery date with glazing contractor');
    fireEvent.press(screen.getByText('Save Task'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      itemType: 'Issue',
      taskName: 'Missing storefront glass',
      nextAction: 'Confirm delivery date with glazing contractor',
    }));
  });

  it('exposes labeled inputs, selected radio choices, and accessible actions', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A']}
        projectAreas={[]}
        scheduleItems={[]}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Task or milestone')).toBeTruthy();
    expect(screen.getByLabelText('Percent Complete')).toBeTruthy();
    expect(screen.getByLabelText('Next action')).toBeTruthy();
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Task' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByRole('radio', { name: 'Issue' }).props.accessibilityState).toEqual({
      selected: false,
    });
    expect(screen.getByRole('button', { name: 'Save Task' })).toBeTruthy();
  });

  it('shows project-owned locations when the task project changes', async () => {
    const screen = await render(
      <ScheduleTaskEditorModal
        visible
        projects={['Project A', 'Project B']}
        projectAreas={[
          {
            id: 'area-a',
            name: 'Project A Yard',
            projectName: 'Project A',
            latitude: 34,
            longitude: -118,
            radiusFeet: 250,
          },
          {
            id: 'area-b',
            name: 'Project B Yard',
            projectName: 'Project B',
            latitude: 34,
            longitude: -118,
            radiusFeet: 250,
          },
        ]}
        scheduleItems={[]}
        initialProjectName="Project A"
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Project A Yard')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Choose Project' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Project B' }));
    expect(screen.getByDisplayValue('Project B Yard')).toBeTruthy();
  });

  it('does not erase in-progress input when live project data refreshes', async () => {
    const initialProps = {
      visible: true,
      projects: ['Project A'],
      projectAreas: [{
        id: 'area-a',
        name: 'Original Yard',
        projectName: 'Project A',
        latitude: 34,
        longitude: -118,
        radiusFeet: 250,
      }],
      scheduleItems: [],
      initialProjectName: 'Project A',
      defaultOwner: 'David',
      onClose: jest.fn(),
      onSubmit: jest.fn(),
    };
    const screen = await render(<ScheduleTaskEditorModal {...initialProps} />);

    fireEvent.changeText(screen.getByLabelText('Task or milestone'), 'Typed work in progress');
    fireEvent.changeText(screen.getByLabelText('Location'), 'Manual field area');
    fireEvent.changeText(screen.getByLabelText('Owner'), 'Field superintendent');

    screen.rerender(
      <ScheduleTaskEditorModal
        {...initialProps}
        projectAreas={[
          ...initialProps.projectAreas,
          {
            id: 'area-new',
            name: 'Realtime cloud area',
            projectName: 'Project A',
            latitude: 34.1,
            longitude: -118.1,
            radiusFeet: 250,
          },
        ]}
      />,
    );

    expect(screen.getByDisplayValue('Typed work in progress')).toBeTruthy();
    expect(screen.getByDisplayValue('Manual field area')).toBeTruthy();
    expect(screen.getByDisplayValue('Field superintendent')).toBeTruthy();
  });
});
