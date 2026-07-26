import { act, renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import {
  appNavigationReducer,
  type AppNavigationState,
  useAndroidHardwareBack,
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
      appNavigationReducer({ screen: 'Home', returnScreen: 'Home', backStack: [] }, {
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

  it('returns through the same canonical nested destinations as visible Back controls', () => {
    const state: AppNavigationState = {
      screen: 'Home',
      returnScreen: 'Home',
      backStack: [],
    };
    let next = appNavigationReducer(state, {
      type: 'navigate',
      screen: 'ProjectDocuments',
    });
    expect(next.backStack).toEqual(['Home', 'ProjectWorkspace']);

    next = appNavigationReducer(next, { type: 'go_back' });
    expect(next.screen).toBe('ProjectWorkspace');
    next = appNavigationReducer(next, { type: 'go_back' });
    expect(next.screen).toBe('Home');
    expect(appNavigationReducer(next, { type: 'go_back' })).toBe(next);
  });

  it('resets tab routes to Home and supports a context-specific detail return', () => {
    const nested = appNavigationReducer(
      { screen: 'ProjectDocuments', returnScreen: 'Home', backStack: ['Home', 'ProjectWorkspace'] },
      { type: 'navigate', screen: 'Schedule' },
    );
    expect(nested.backStack).toEqual(['Home']);
    expect(appNavigationReducer(nested, { type: 'go_back' }).screen).toBe('Home');

    const detail = appNavigationReducer(nested, {
      type: 'navigate',
      screen: 'UpdateDetail',
      backTarget: 'Schedule',
    });
    expect(detail.backStack).toEqual(['Home', 'Schedule']);
    expect(appNavigationReducer(detail, { type: 'go_back' }).screen).toBe('Schedule');
  });

  it('returns false at Home after repeated hook-level Back operations', async () => {
    const { result } = await renderHook(() => useAppNavigation('Home'));
    let handled = true;
    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(false);

    act(() => result.current.setScreen('Admin'));
    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(true);
    expect(result.current.screen).toBe('Home');
    act(() => {
      handled = result.current.goBack();
    });
    expect(handled).toBe(false);
  });

  it('consumes Back while a capture/modal guard is active and removes its listener', async () => {
    const listeners: Array<Parameters<typeof BackHandler.addEventListener>[1]> = [];
    const hardwareBackEvent = {
      type: 'hardwareBackPress',
      timeStamp: 0,
    };
    const remove = jest.fn();
    const addListener = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(
      (_event, handler) => {
        listeners.push(handler);
        return { remove };
      },
    );
    const onBack = jest.fn(() => false);
    const { rerender, unmount } = await renderHook(
      ({ blocked }: { blocked: boolean }) => useAndroidHardwareBack({
        onBack,
        blocked,
        enabled: true,
      }),
      { initialProps: { blocked: true } },
    );

    expect(listeners).toHaveLength(1);
    expect(listeners[0](hardwareBackEvent)).toBe(true);
    expect(onBack).not.toHaveBeenCalled();
    rerender({ blocked: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(2);
    expect(listeners[1](hardwareBackEvent)).toBe(false);
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
    addListener.mockRestore();
  });
});
