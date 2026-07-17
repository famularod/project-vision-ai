import { act, renderHook } from '@testing-library/react-native';

import {
  appNavigationReducer,
  useAppNavigation,
} from '../../hooks/use-app-navigation';

describe('app navigation controller', () => {
  it('moves between typed application screens', async () => {
    const { result } = await renderHook(() => useAppNavigation('Home'));

    expect(result.current.screen).toBe('Home');

    await act(() => {
      result.current.setScreen('Schedule');
    });

    expect(result.current.screen).toBe('Schedule');
  });

  it('keeps navigation transitions deterministic outside React', () => {
    expect(
      appNavigationReducer({ screen: 'Home', returnScreen: 'Home' }, {
        type: 'navigate',
        screen: 'ProjectWorkspace',
      }).screen,
    ).toBe('ProjectWorkspace');
  });

  it('remembers where a temporary screen should return', async () => {
    const { result } = await renderHook(() => useAppNavigation('Home'));

    await act(() => {
      result.current.setReturnScreen('BuildUpdate');
      result.current.setScreen('Contacts');
    });

    expect(result.current.screen).toBe('Contacts');
    expect(result.current.returnScreen).toBe('BuildUpdate');
  });
});
