import { createContext, type ReactNode, useContext } from 'react';
import type { Edge } from 'react-native-safe-area-context';

export const APP_SHELL_BREAKPOINTS = {
  medium: 600,
  wide: 900,
} as const;

export type AppShellSizeClass = 'compact' | 'medium' | 'wide';

export type AppShellLayout = {
  sizeClass: AppShellSizeClass;
  viewportWidth: number;
  navigationPlacement: 'bottom' | 'rail';
  expandedRail: boolean;
};

const DEFAULT_APP_SHELL_LAYOUT = appShellLayoutForWidth(390);
const AppShellLayoutContext = createContext<AppShellLayout>(DEFAULT_APP_SHELL_LAYOUT);

export function appShellLayoutForWidth(width: number): AppShellLayout {
  const viewportWidth = Number.isFinite(width) && width > 0 ? width : 390;

  if (viewportWidth < APP_SHELL_BREAKPOINTS.medium) {
    return {
      sizeClass: 'compact',
      viewportWidth,
      navigationPlacement: 'bottom',
      expandedRail: false,
    };
  }

  if (viewportWidth < APP_SHELL_BREAKPOINTS.wide) {
    return {
      sizeClass: 'medium',
      viewportWidth,
      navigationPlacement: 'rail',
      expandedRail: false,
    };
  }

  return {
    sizeClass: 'wide',
    viewportWidth,
    navigationPlacement: 'rail',
    expandedRail: true,
  };
}

export function appShellContentTopPadding({
  layout,
  safeAreaTop,
  platform,
}: {
  layout: AppShellLayout;
  safeAreaTop: number;
  platform: 'android' | 'ios' | 'macos' | 'web' | 'windows';
}) {
  if (layout.navigationPlacement === 'bottom') {
    // The compact branded header already owns the top safe area. Adding it
    // again to each screen creates a large blank band below the brand.
    return 0;
  }

  const normalizedSafeAreaTop =
    Number.isFinite(safeAreaTop) && safeAreaTop > 0 ? safeAreaTop : 0;

  return Math.max(
    normalizedSafeAreaTop + 24,
    platform === 'ios' ? 72 : 48,
  );
}

export function appShellHidesSystemStatusBar({
  layout,
  platform,
}: {
  layout: AppShellLayout;
  platform: string | undefined;
}) {
  return platform === 'ios' && layout.navigationPlacement === 'rail';
}

export function appShellContentSafeAreaEdges(
  layout: AppShellLayout,
): Edge[] {
  // The compact branded header already owns the top safe area. A second top
  // inset inside each screen creates a blank band and clips scrolling content
  // before it reaches the visible header boundary.
  return layout.navigationPlacement === 'bottom'
    ? ['left', 'right']
    : ['top', 'left', 'right'];
}

export function AppShellLayoutProvider({
  children,
  layout,
}: {
  children: ReactNode;
  layout: AppShellLayout;
}) {
  return (
    <AppShellLayoutContext.Provider value={layout}>
      {children}
    </AppShellLayoutContext.Provider>
  );
}

export function useAppShellLayout() {
  return useContext(AppShellLayoutContext);
}
