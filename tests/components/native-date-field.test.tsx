import { act, fireEvent, render } from '@testing-library/react-native';

import { NativeDateField } from '../../components/native-date-field';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <View {...props} />,
  };
});

describe('NativeDateField', () => {
  it('uses the calendar selection and preserves MM/DD/YYYY storage', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <NativeDateField
        label="Finish / Due Date"
        value=""
        onChange={onChange}
        testID="finish-date"
      />,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Select finish / due date' }),
    );
    await act(() => {
      screen.getByTestId('finish-date-picker').props.onChange(
        { type: 'set' },
        new Date(2026, 6, 31, 12),
      );
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Use Date' }));

    expect(onChange).toHaveBeenCalledWith('07/31/2026');
  });

  it('shows and clears an existing saved date', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <NativeDateField
        label="Finish / Due Date"
        value="07/24/2026"
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Jul 24, 2026')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Clear finish / due date' }),
    );

    expect(onChange).toHaveBeenCalledWith('');
  });
});
