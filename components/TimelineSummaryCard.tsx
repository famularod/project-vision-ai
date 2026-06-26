import { StyleSheet, Text, View } from 'react-native';
import type { ConstructionTimelineSummary } from '../services/ConstructionTimelineService';
import { colors } from './ProjectDetailsCard';

export function TimelineSummaryCard({
  summary,
}: {
  summary: ConstructionTimelineSummary;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>
        Timeline Summary
      </Text>

      <Text style={styles.bodyText}>
        {summary.totalEvents.toLocaleString('en-US')} chronological events across {summary.projectCount.toLocaleString('en-US')} active project{summary.projectCount === 1 ? '' : 's'}, including updates, photos, actions, safety items, schedule milestones, and documents.
      </Text>

      <View style={styles.metricGrid}>
        <SummaryMetric
          label="Events"
          value={summary.totalEvents}
        />

        <SummaryMetric
          label="Risk"
          value={summary.riskEvents}
          danger={summary.riskEvents > 0}
        />

        <SummaryMetric
          label="Photos"
          value={summary.relatedPhotos}
        />

        <SummaryMetric
          label="Actions"
          value={summary.relatedActionItems}
          danger={summary.relatedActionItems > 0}
        />

        <SummaryMetric
          label="Schedule"
          value={summary.scheduleEvents}
        />

        <SummaryMetric
          label="Documents"
          value={summary.documentEvents}
        />
      </View>
    </View>
  );
}

function SummaryMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text
        style={[
          styles.metricValue,
          danger && styles.metricValueDanger,
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

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 14,
  },

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  metric: {
    width: '30%',
    minWidth: 92,
    backgroundColor: colors.fill,
    borderRadius: 8,
    padding: 10,
  },

  metricValue: {
    color: colors.primary,
    fontSize: 21,
    lineHeight: 25,
    fontWeight: '900',
  },

  metricValueDanger: {
    color: colors.danger,
  },

  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    marginTop: 2,
  },
});
