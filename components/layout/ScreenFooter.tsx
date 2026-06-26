import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../theme';

export function ScreenFooter({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <View style={styles.footer}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
});
