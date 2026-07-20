import { render } from '@testing-library/react-native';

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
});
