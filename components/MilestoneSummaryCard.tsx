import { StyleSheet, Text, View } from 'react-native';
import type { MilestoneTrackingSummary } from '../services/MilestoneTrackingService';
import { colors } from './ProjectDetailsCard';

export function MilestoneSummaryCard({
  summary,
}: {
  summary: MilestoneTrackingSummary;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Milestone Summary
      </Text>

      <Text style={styles.subtitle}>
        Local schedule signals based on due dates, current status, priority, and progress.
      </Text>

      <View style={styles.metricGrid}>
        <SummaryMetric label="Total" value={summary.total} />
        <SummaryMetric label="Completed" value={summary.completed} tone="success" />
        <SummaryMetric label="Upcoming" value={summary.upcoming} tone="primary" />
        <SummaryMetric label="Overdue" value={summary.overdue} tone="danger" />
        <SummaryMetric label="At Risk" value={summary.atRisk} tone="warning" />
      </View>
    </View>
  );
}

function SummaryMetric({
  label,
  value,
  tone = 'text',
}: {
  label: string;
  value: number;
  tone?: 'text' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  const toneColor = {
    text: colors.text,
    primary: colors.primary,
    success: colors.success,
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
          { color: toneColor },
        ]}
      >
        {value.toLocaleString('en-US')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 15,
    marginBottom: 14,
  },

  title: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 4,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.line,
  },

  metric: {
    width: '50%',
    minHeight: 59,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },

  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  metricValue: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '900',
  },
});
