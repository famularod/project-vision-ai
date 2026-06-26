import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { MilestoneRecord } from '../services/MilestoneTrackingService';
import { colors } from './ProjectDetailsCard';
import { MilestoneStatusBadge, milestoneStatusColor } from './MilestoneStatusBadge';

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function MilestoneCard({
  milestone,
}: {
  milestone: MilestoneRecord;
}) {
  const statusColor = milestoneStatusColor(milestone.status);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.title}>
            {milestone.title}
          </Text>

          <Text style={styles.project}>
            {milestone.projectName}
            {milestone.areaName ? ` • ${milestone.areaName}` : ''}
          </Text>
        </View>

        <MilestoneStatusBadge status={milestone.status} />
      </View>

      <View style={styles.dueRow}>
        <Ionicons
          name="calendar-outline"
          size={17}
          color={statusColor}
        />

        <Text style={styles.dueText}>
          Due {milestone.dueDateLabel}
        </Text>

        <Text
          style={[
            styles.daysText,
            { color: statusColor },
          ]}
        >
          {milestone.daysLabel}
        </Text>
      </View>

      <Text style={styles.progressText}>
        {milestone.scheduleStatus} • {milestone.percentComplete}% complete • {milestone.priority} priority
      </Text>

      <View style={styles.metricRow}>
        <MiniMetric
          label="Updates"
          value={countLabel(milestone.relatedUpdatesCount, 'update')}
        />
        <MiniMetric
          label="Photos"
          value={countLabel(milestone.relatedPhotosCount, 'photo')}
        />
        <MiniMetric
          label="Actions"
          value={countLabel(milestone.relatedActionItemsCount, 'action')}
        />
      </View>

      <View style={styles.actionRow}>
        <Ionicons
          name="arrow-forward-circle-outline"
          size={18}
          color={colors.primary}
        />

        <View style={styles.actionMain}>
          <Text style={styles.actionLabel}>
            Recommended Next Action
          </Text>

          <Text style={styles.actionText}>
            {milestone.recommendedNextAction}
          </Text>
        </View>
      </View>
    </View>
  );
}

function MiniMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniLabel}>
        {label}
      </Text>

      <Text style={styles.miniValue}>
        {value}
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

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },

  headerMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 3,
  },

  project: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 7,
  },

  dueText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  daysText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textAlign: 'right',
  },

  progressText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 12,
  },

  metricRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    marginBottom: 12,
  },

  miniMetric: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 5,
  },

  miniLabel: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  miniValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  actionMain: {
    flex: 1,
  },

  actionLabel: {
    color: colors.primary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 2,
  },

  actionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
