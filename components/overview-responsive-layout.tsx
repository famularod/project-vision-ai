import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme';
import { useAppShellLayout } from './app-shell-layout';

export function OverviewResponsiveFrame({ children }: { children: ReactNode }) {
  const { sizeClass } = useAppShellLayout();
  const isWide = sizeClass === 'wide';

  return (
    <View
      style={[styles.frame, isWide && styles.frameWide]}
      testID="overview-responsive-frame"
    >
      {children}
    </View>
  );
}

export function OverviewResponsiveWorkspace({ children }: { children: ReactNode }) {
  const { sizeClass } = useAppShellLayout();
  const isWide = sizeClass === 'wide';

  return (
    <View
      style={[styles.workspace, isWide && styles.workspaceWide]}
      testID="overview-responsive-workspace"
    >
      {children}
    </View>
  );
}

export function OverviewResponsiveColumn({
  children,
  priority,
}: {
  children: ReactNode;
  priority: 'primary' | 'secondary';
}) {
  const { sizeClass } = useAppShellLayout();
  const isWide = sizeClass === 'wide';

  return (
    <View
      style={[
        styles.column,
        isWide && (
          priority === 'primary'
            ? styles.primaryColumnWide
            : styles.secondaryColumnWide
        ),
      ]}
      testID={`overview-${priority}-column`}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
  },
  frameWide: {
    alignSelf: 'center',
    maxWidth: 1240,
  },
  workspace: {
    width: '100%',
  },
  workspaceWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xl,
  },
  column: {
    minWidth: 0,
    width: '100%',
  },
  primaryColumnWide: {
    flex: 1.15,
    width: 'auto',
  },
  secondaryColumnWide: {
    flex: 0.85,
    width: 'auto',
  },
});
