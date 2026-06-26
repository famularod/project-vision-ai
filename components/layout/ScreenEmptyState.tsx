import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../../theme';

export function ScreenEmptyState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {title}
      </Text>

      <Text style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },

  title: {
    ...typography.h3,
    marginBottom: spacing.xs,
  },

  text: typography.body,
});
