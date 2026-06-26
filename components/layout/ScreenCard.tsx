import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import {
  colors,
  radius,
  shadows,
  spacing,
} from '../../theme';

export function ScreenCard({
  children,
  style,
  bordered = true,
  padded = true,
  elevated = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bordered?: boolean;
  padded?: boolean;
  elevated?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        bordered && styles.bordered,
        elevated && styles.elevated,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },

  padded: {
    padding: spacing.md,
  },

  bordered: {
    borderWidth: 1,
    borderColor: colors.border,
  },

  elevated: {
    ...shadows.small,
  },
});
