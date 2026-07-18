import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppShellFrame } from '../../components/app-shell-frame';

// Ionicons loads its native font asynchronously on mount. This suite exercises
// shell navigation, so keep that external font lifecycle outside the test.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('AppShellFrame', () => {
  it('renders the active screen content and delegates primary navigation', async () => {
    const onScreenChange = jest.fn();
    const screen = await render(
      <AppShellFrame
        currentScreen="Home"
        onScreenChange={onScreenChange}
        onTalk={jest.fn()}
      >
        <Text>Current project overview</Text>
      </AppShellFrame>,
    );

    expect(screen.getByText('Current project overview')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Tasks' }));
    expect(onScreenChange).toHaveBeenCalledWith('Schedule');
  });
});
