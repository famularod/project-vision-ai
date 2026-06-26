import { StyleSheet, Text, View } from 'react-native';
import type { DelayAnalysis } from '../services/DelayAnalysisService';
import { ScreenCard } from './layout/ScreenCard';
import {
  colors,
  spacing,
  typography,
} from '../theme';

export function DelaySummaryCard({
  summary,
}: {
  summary: DelayAnalysis['summary'];
}) {
  return (
    <ScreenCard style={styles.card}>
      <Text style={styles.title}>
        Delay Summary
      </Text>

      <Text style={styles.summary}>
        {summary.executiveSummary}
      </Text>

      <View style={styles.grid}>
        <Metric label="Delayed Items" value={summary.totalDelayedItems} />
        <Metric label="Critical Delays" value={summary.criticalDelays} tone="danger" />
        <Metric label="At Risk" value={summary.atRiskDelays} tone="warning" />
        <Metric label="Average Days Late" value={summary.averageDaysLate} tone="danger" />
      </View>
    </ScreenCard>
  );
}

function Metric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const color = {
    default: colors.primary,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];

  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>
        {label}
      </Text>

      <Text
        style={[
          styles.metricValue,
          { color },
        ]}
      >
        {value.toLocaleString('en-US')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },

  title: typography.h2,

  summary: {
    ...typography.body,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
  },

  metric: {
    width: '50%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },

  metricLabel: typography.label,

  metricValue: {
    ...typography.metric,
    marginTop: spacing.xxs,
  },
});
