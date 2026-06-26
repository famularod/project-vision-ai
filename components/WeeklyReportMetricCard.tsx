import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

type MetricTone = 'neutral' | 'warning' | 'danger' | 'success';

const toneColors: Record<MetricTone, string> = {
  neutral: colors.primary,
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
};

export function WeeklyReportMetricCard({
  label,
  value,
  subtitle,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  subtitle: string;
  icon: IconName;
  tone?: MetricTone;
}) {
  const color = toneColors[tone];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons
          name={icon}
          size={19}
          color={color}
        />

        <Text
          style={[
            styles.value,
            { color },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.76}
        >
          {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        </Text>
      </View>

      <Text style={styles.label}>
        {label}
      </Text>

      <Text style={styles.subtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 9,
  },

  value: {
    flex: 1,
    textAlign: 'right',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },

  label: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 4,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
});
