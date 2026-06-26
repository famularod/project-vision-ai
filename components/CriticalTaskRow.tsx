import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { CriticalPathTask } from '../services/CriticalPathService';
import { colors } from './ProjectDetailsCard';
import { RiskPriorityBadge } from './RiskPriorityBadge';
import { DependencyIndicator } from './DependencyIndicator';

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function relationship(task: CriticalPathTask) {
  if (task.isBlocking && task.dependentTaskNames.length > 0) {
    return {
      tone: 'blocking' as const,
      label: `Blocking ${countLabel(task.dependentTaskNames.length, 'dependent task')}: ${task.dependentTaskNames.slice(0, 2).join(', ')}`,
    };
  }
  if (task.dependentTaskNames.length > 0) {
    return {
      tone: 'dependency' as const,
      label: `Precedes ${countLabel(task.dependentTaskNames.length, 'inferred dependent task')}: ${task.dependentTaskNames.slice(0, 2).join(', ')}`,
    };
  }
  if (task.predecessorTitle) {
    return {
      tone: 'dependency' as const,
      label: `Inferred dependency on ${task.predecessorTitle}.`,
    };
  }

  return {
    tone: 'clear' as const,
    label: 'No predecessor is inferred from the available schedule data.',
  };
}

export function CriticalTaskRow({
  task,
}: {
  task: CriticalPathTask;
}) {
  const taskRelationship = relationship(task);

  return (
    <View style={styles.row}>
      <View style={styles.headerRow}>
        <View style={styles.titleMain}>
          <Text style={styles.title}>
            {task.title}
          </Text>

          <Text style={styles.project}>
            {task.projectName}
            {task.areaName ? ` - ${task.areaName}` : ''}
          </Text>
        </View>

        <RiskPriorityBadge severity={task.riskLevel} />
      </View>

      <View style={styles.detailRow}>
        <Detail
          icon="person-outline"
          label={`Owner: ${task.owner}`}
        />
        <Detail
          icon="calendar-outline"
          label={`Due: ${task.dueDateLabel}`}
        />
      </View>

      <Text style={styles.status}>
        {task.scheduleStatus} - {task.percentComplete}% complete - {task.daysLabel}
      </Text>

      <DependencyIndicator
        label={taskRelationship.label}
        tone={taskRelationship.tone}
      />

      <Text style={styles.evidence}>
        {countLabel(task.relatedUpdatesCount, 'related update')} - {countLabel(task.relatedPhotosCount, 'photo')} - {countLabel(task.openActionItemsCount, 'open action')}
      </Text>

      {task.blockingIssues.length > 0 ? (
        <Text style={styles.issues}>
          {task.blockingIssues.join(' ')}
        </Text>
      ) : null}

      <View style={styles.actionRow}>
        <Ionicons
          name="arrow-forward-circle-outline"
          size={18}
          color={colors.primary}
        />

        <View style={styles.actionMain}>
          <Text style={styles.actionLabel}>
            Recommended Immediate Action
          </Text>

          <Text style={styles.actionText}>
            {task.recommendedAction}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Detail({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.detail}>
      <Ionicons
        name={icon}
        size={15}
        color={colors.muted}
      />

      <Text style={styles.detailText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 13,
    marginTop: 13,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 7,
  },

  titleMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    marginBottom: 2,
  },

  project: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 5,
  },

  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },

  detailText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },

  status: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 10,
  },

  evidence: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginBottom: 6,
  },

  issues: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginBottom: 9,
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
