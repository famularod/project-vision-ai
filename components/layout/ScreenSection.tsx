import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  spacing,
  typography,
} from '../../theme';

export function ScreenSection({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.title}>
          {title}
        </Text>
      ) : null}

      {subtitle ? (
        <Text style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },

  title: {
    ...typography.h3,
    marginBottom: spacing.xxs,
  },

  subtitle: {
    ...typography.body,
    marginBottom: spacing.sm,
  },
});
