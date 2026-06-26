import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type {
  PortfolioProject,
  PortfolioProjectStatus,
} from '../services/PortfolioDashboardService';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

const statusMeta: Record<
  PortfolioProjectStatus,
  {
    color: string;
    icon: IconName;
  }
> = {
  Healthy: {
    color: colors.success,
    icon: 'checkmark-circle-outline',
  },
  Warning: {
    color: colors.warning,
    icon: 'alert-circle-outline',
  },
  Critical: {
    color: colors.danger,
    icon: 'warning-outline',
  },
  Completed: {
    color: colors.primary,
    icon: 'checkmark-done-circle-outline',
  },
  'On Hold': {
    color: colors.muted,
    icon: 'pause-circle-outline',
  },
};

export function PortfolioProjectCard({
  project,
}: {
  project: PortfolioProject;
}) {
  const meta = statusMeta[project.status];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerMain}>
          <Text style={styles.projectName}>
            {project.projectName}
          </Text>

          <Text style={styles.lastUpdate}>
            Last update: {project.lastUpdate}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            { backgroundColor: `${meta.color}1A` },
          ]}
        >
          <Ionicons
            name={meta.icon}
            size={14}
            color={meta.color}
          />

          <Text
            style={[
              styles.statusText,
              { color: meta.color },
            ]}
          >
            {project.status}
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text
          style={[
            styles.scoreValue,
            { color: healthColor(project.healthScore) },
          ]}
        >
          {project.healthScore}
        </Text>

        <Text style={styles.scoreLabel}>
          /100 AI health - {project.aiHealthIndicator}
        </Text>
      </View>

      <View style={styles.metricRow}>
        <ProjectMetric
          label="Open"
          value={project.openItems}
          danger={project.openItems > 0}
        />

        <ProjectMetric
          label="Overdue"
          value={project.overdueItems}
          danger={project.overdueItems > 0}
        />

        <ProjectMetric
          label="Safety"
          value={project.safetyIssues}
          danger={project.safetyIssues > 0}
        />
      </View>

      <View style={styles.milestoneRow}>
        <Ionicons
          name="flag-outline"
          size={16}
          color={colors.primary}
        />

        <Text
          style={styles.milestoneText}
          numberOfLines={2}
        >
          {project.nextMilestone}
        </Text>
      </View>
    </View>
  );
}

function healthColor(score: number) {
  if (score < 60) return colors.danger;
  if (score < 75) return colors.warning;

  return colors.success;
}

function ProjectMetric({
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
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },

  headerMain: {
    flex: 1,
  },

  projectName: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },

  lastUpdate: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },

  statusText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },

  scoreValue: {
    fontSize: 30,
    lineHeight: 35,
    fontWeight: '900',
  },

  scoreLabel: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 5,
    marginLeft: 4,
  },

  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 11,
  },

  metric: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    padding: 9,
  },

  metricValue: {
    color: colors.primary,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },

  metricValueDanger: {
    color: colors.danger,
  },

  metricLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    marginTop: 2,
    textTransform: 'uppercase',
  },

  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    padding: 10,
  },

  milestoneText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
