import { useCallback, useReducer } from 'react';

import type { AppScreen } from '../types/app-navigation';

export type AppNavigationState = {
  screen: AppScreen;
  returnScreen: AppScreen;
};

export type AppNavigationAction =
  | {
      type: 'navigate';
      screen: AppScreen;
    }
  | {
      type: 'remember_return_screen';
      screen: AppScreen;
    };

export function appNavigationReducer(
  state: AppNavigationState,
  action: AppNavigationAction,
): AppNavigationState {
  if (action.type === 'navigate') {
    return {
      ...state,
      screen: action.screen,
    };
  }

  return {
    ...state,
    returnScreen: action.screen,
  };
}

export function useAppNavigation(initialScreen: AppScreen = 'Home') {
  const [state, dispatch] = useReducer(appNavigationReducer, {
    screen: initialScreen,
    returnScreen: initialScreen,
  });
  const setScreen = useCallback((nextScreen: AppScreen) => {
    dispatch({ type: 'navigate', screen: nextScreen });
  }, []);
  const setReturnScreen = useCallback((nextScreen: AppScreen) => {
    dispatch({ type: 'remember_return_screen', screen: nextScreen });
  }, []);

  return {
    ...state,
    setScreen,
    setReturnScreen,
  };
}
