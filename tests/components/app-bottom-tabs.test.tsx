import { fireEvent, render } from '@testing-library/react-native';
import { AppBottomTabs } from '../../components/app-bottom-tabs';

// Ionicons loads its native font asynchronously on mount. This suite exercises
// tab behavior, so keep that external font lifecycle outside the test.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('AppBottomTabs', () => {
  it('routes the primary tabs and exposes the current selection', async () => {
    const onChange = jest.fn();
    const onTalk = jest.fn();
    const screen = await render(
      <AppBottomTabs current="Schedule" onChange={onChange} onTalk={onTalk} />,
    );

    expect(screen.getByRole('tab', { name: 'Tasks' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'Overview' }).props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(screen.getByRole('tab', { name: 'Reports' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Talk to project assistant' }));

    expect(onChange).toHaveBeenCalledWith('Reports');
    expect(onTalk).toHaveBeenCalledTimes(1);
  });
});
