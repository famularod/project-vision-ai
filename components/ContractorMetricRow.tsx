import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';

export function ContractorMetricRow({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const color = {
    default: colors.primary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];

  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <Ionicons name={icon} size={17} color={color} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={[styles.value, { color }]}>{value.toLocaleString('en-US')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  label: typography.body,
  value: typography.metric,
});
