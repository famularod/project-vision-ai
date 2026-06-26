import { StyleSheet, Text, View } from 'react-native';
import type {
  PortfolioDashboard,
} from '../services/PortfolioDashboardService';
import { colors } from './ProjectDetailsCard';

export function PortfolioSummaryCard({
  summary,
}: {
  summary: PortfolioDashboard['summary'];
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>
        Executive Summary
      </Text>

      <View style={styles.healthRow}>
        <Text style={styles.healthScore}>
          {summary.overallHealthScore}
        </Text>

        <Text style={styles.healthSuffix}>
          /100 portfolio health
        </Text>
      </View>

      <View style={styles.scoreTrack}>
        <View
          style={[
            styles.scoreFill,
            {
              width: `${summary.overallHealthScore}%`,
              backgroundColor: scoreColor(summary.overallHealthScore),
            },
          ]}
        />
      </View>

      <View style={styles.metricGrid}>
        <SummaryMetric
          label="Total"
          value={summary.totalProjects}
        />

        <SummaryMetric
          label="Active"
          value={summary.activeProjects}
        />

        <SummaryMetric
          label="Completed"
          value={summary.completedProjects}
        />

        <SummaryMetric
          label="On Hold"
          value={summary.onHoldProjects}
          warning={summary.onHoldProjects > 0}
        />
      </View>
    </View>
  );
}

function scoreColor(score: number) {
  if (score < 60) return colors.danger;
  if (score < 75) return colors.warning;

  return colors.success;
}

function SummaryMetric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text
        style={[
          styles.metricValue,
          warning && styles.metricValueWarning,
        ]}
      >
        {value.toLocaleString('en-US')}
      </Text>

      <Text style={styles.metricLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  healthRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },

  healthScore: {
    color: colors.text,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '900',
  },

  healthSuffix: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 7,
    marginLeft: 5,
  },

  scoreTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.fill,
    overflow: 'hidden',
    marginBottom: 14,
  },

  scoreFill: {
    height: '100%',
    borderRadius: 999,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  metric: {
    flex: 1,
    minWidth: 92,
    backgroundColor: colors.fill,
    borderRadius: 8,
    padding: 10,
  },

  metricValue: {
    color: colors.primary,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
  },

  metricValueWarning: {
    color: colors.warning,
  },

  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
