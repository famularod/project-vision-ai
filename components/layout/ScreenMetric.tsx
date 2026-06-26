import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../../theme';

export function ScreenMetric({
  label,
  value,
  detail,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}) {
  const color = {
    default: colors.primary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];

  return (
    <View style={styles.metric}>
      <View style={styles.labelRow}>
        {icon ? (
          <View style={styles.iconWrap}>
            {icon}
          </View>
        ) : null}

        <Text style={styles.label}>
          {label}
        </Text>
      </View>

      <Text
        style={[
          styles.value,
          { color },
        ]}
      >
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </Text>

      {detail ? (
        <Text style={styles.detail}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  metric: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 148,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },

  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },

  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: typography.label,

  value: typography.metric,

  detail: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});
