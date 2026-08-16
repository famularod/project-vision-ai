import { useCallback, useEffect, useReducer } from 'react';
import { BackHandler, Platform } from 'react-native';

import type { AppScreen } from '../types/app-navigation';

export type AppNavigationState = {
  screen: AppScreen;
  returnScreen: AppScreen;
  backStack: AppScreen[];
};

export type AppNavigationOptions = {
  /** Override for screens whose visible Back destination is context-specific. */
  backTarget?: AppScreen;
};

export type AppNavigationAction =
  | {
      type: 'navigate';
      screen: AppScreen;
      backTarget?: AppScreen;
    }
  | { type: 'go_back' }
  | {
      type: 'remember_return_screen';
      screen: AppScreen;
    };

export function appNavigationReducer(
  state: AppNavigationState,
  action: AppNavigationAction,
): AppNavigationState {
  if (action.type === 'navigate') {
    if (action.screen === state.screen) return state;
    return {
      ...state,
      screen: action.screen,
      backStack: backStackForScreen(
        action.screen,
        state.returnScreen,
        action.backTarget,
      ),
    };
  }

  if (action.type === 'go_back') {
    if (state.backStack.length === 0) return state;
    return {
      ...state,
      screen: state.backStack[state.backStack.length - 1],
      backStack: state.backStack.slice(0, -1),
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
    backStack: backStackForScreen(initialScreen, initialScreen),
  });
  const setScreen = useCallback((nextScreen: AppScreen, options?: AppNavigationOptions) => {
    dispatch({ type: 'navigate', screen: nextScreen, backTarget: options?.backTarget });
  }, []);
  const setReturnScreen = useCallback((nextScreen: AppScreen) => {
    dispatch({ type: 'remember_return_screen', screen: nextScreen });
  }, []);
  const goBack = useCallback(() => {
    if (state.backStack.length === 0) return false;
    dispatch({ type: 'go_back' });
    return true;
  }, [state.backStack.length]);

  return {
    ...state,
    setScreen,
    setReturnScreen,
    goBack,
  };
}

export function useAndroidHardwareBack({
  onBack,
  blocked = false,
  enabled = Platform.OS === 'android',
}: {
  onBack: () => boolean;
  blocked?: boolean;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (blocked) return true;
      return onBack();
    });
    return () => subscription.remove();
  }, [blocked, enabled, onBack]);
}

function backStackForScreen(
  screen: AppScreen,
  returnScreen: AppScreen,
  explicitBackTarget?: AppScreen,
): AppScreen[] {
  if (screen === 'Home') return [];
  const target = explicitBackTarget || defaultBackTarget(screen, returnScreen);
  if (!target || target === screen) return [];
  return [...backStackForScreen(target, 'Home'), target];
}

function defaultBackTarget(
  screen: AppScreen,
  returnScreen: AppScreen,
): AppScreen | null {
  if (screen === 'ProjectDocuments') return 'ProjectWorkspace';
  if (screen === 'Diagnostics') return 'Admin';
  if (screen === 'Contacts') return returnScreen === 'Contacts' ? 'Home' : returnScreen;
  if (screen === 'UpdateDetail') return 'SavedUpdates';
  if (screen === 'BuildUpdate') return 'AddPhotos';
  return 'Home';
}
