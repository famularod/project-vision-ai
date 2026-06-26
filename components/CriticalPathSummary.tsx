import { StyleSheet, Text, View } from 'react-native';
import type { CriticalPathSummaryData } from '../services/CriticalPathService';
import { colors } from './ProjectDetailsCard';

export function CriticalPathSummary({
  summary,
}: {
  summary: CriticalPathSummaryData;
}) {
  const confidenceColor =
    summary.scheduleConfidenceScore >= 80
      ? colors.success
      : summary.scheduleConfidenceScore >= 60
        ? colors.warning
        : colors.danger;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Critical Path Summary
      </Text>

      <Text style={styles.subtitle}>
        Sequence and completion confidence are inferred locally from schedule dates, progress, actions, and update freshness.
      </Text>

      <View style={styles.primaryRow}>
        <SummaryMetric
          label="Schedule Confidence"
          value={`${summary.scheduleConfidenceScore}/100`}
          color={confidenceColor}
        />
        <SummaryMetric
          label="Estimated Completion"
          value={summary.estimatedCompletionDate}
        />
      </View>

      <View style={styles.metricGrid}>
        <SummaryMetric label="Critical Tasks" value={summary.criticalTasks} color={colors.danger} />
        <SummaryMetric label="Blocking Tasks" value={summary.blockingTasks} color={colors.warning} />
        <SummaryMetric label="Delayed Milestones" value={summary.delayedMilestones} color={colors.danger} />
        <SummaryMetric
          label="Longest Remaining Path"
          value={summary.longestRemainingPathDays > 0 ? `${summary.longestRemainingPathDays} days` : 'None'}
          detail={summary.longestRemainingPathProject || 'No active project path'}
        />
      </View>

      <Text style={styles.confidenceText}>
        {summary.completionConfidence}
      </Text>
    </View>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  color = colors.text,
}: {
  label: string;
  value: string | number;
  detail?: string;
  color?: string;
}) {
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
        {value}
      </Text>

      {detail ? (
        <Text style={styles.metricDetail}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.line,
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
    marginBottom: 12,
  },

  primaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.line,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderLeftWidth: 1,
    borderColor: colors.line,
  },

  metric: {
    flex: 1,
    minWidth: '50%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },

  metricLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  metricValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },

  metricDetail: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    marginTop: 2,
  },

  confidenceText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    marginTop: 10,
  },
});
