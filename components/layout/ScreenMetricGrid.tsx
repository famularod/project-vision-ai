import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../theme';

export function ScreenMetricGrid({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <View style={styles.grid}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
});
