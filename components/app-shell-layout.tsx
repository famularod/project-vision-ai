import { createContext, type ReactNode, useContext } from 'react';

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
