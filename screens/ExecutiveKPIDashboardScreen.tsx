import { useMemo } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KPIGroupCard } from '../components/KPIGroupCard';
import { KPIStatusRow } from '../components/KPIStatusRow';
import { KPITrendSummary } from '../components/KPITrendSummary';
import {
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import { generateWeeklyExecutiveReport } from '../services/WeeklyExecutiveReportService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

function healthDirection(score: number) {
  if (score >= 75) return 'up';
  if (score < 60) return 'down';

  return 'flat';
}

function healthTone(score: number) {
  if (score >= 75) return 'success';
  if (score < 60) return 'danger';

  return 'warning';
}

function topPriorities(items: string[]) {
  return items.length > 0
    ? items.slice(0, 5)
    : ['Continue the current update cadence and monitor field conditions.'];
}

export function ExecutiveKPIDashboardScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onProjectHealthDashboard,
  onExecutiveBrief,
  onWeeklyReport,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onProjectHealthDashboard?: () => void;
  onExecutiveBrief?: () => void;
  onWeeklyReport?: () => void;
}) {
  const report = useMemo(
    () =>
      generateWeeklyExecutiveReport({
        projects,
        updates: savedUpdates,
        scheduleItems,
        referenceDocuments,
        currentUpdate,
      }),
    [
      currentUpdate,
      projects,
      referenceDocuments,
      savedUpdates,
      scheduleItems,
    ],
  );
  const metrics = report.metrics;
  const priorities = topPriorities(report.recommendedExecutiveActions);

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Executive KPI Dashboard"
        subtitle={`Performance dashboard for ${report.periodLabel}. Generated locally from project, update, schedule, document, action, and safety data.`}
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          KPI Navigation
        </Text>

        <Text style={styles.commandSubtitle}>
          Move between executive views without changing project data.
        </Text>

        <View style={styles.commandRow}>
          <SecondaryButton
            label="Home"
            icon="home-outline"
            onPress={onBack}
            compact
          />

          {onProjectHealthDashboard ? (
            <SecondaryButton
              label="Health"
              icon="pulse-outline"
              onPress={onProjectHealthDashboard}
              compact
            />
          ) : null}
        </View>

        <View style={styles.commandRow}>
          {onExecutiveBrief ? (
            <SecondaryButton
              label="Exec Brief"
              icon="briefcase-outline"
              onPress={onExecutiveBrief}
              compact
            />
          ) : null}

          {onWeeklyReport ? (
            <SecondaryButton
              label="Weekly"
              icon="newspaper-outline"
              onPress={onWeeklyReport}
              compact
            />
          ) : null}
        </View>
      </View>

      <KPITrendSummary
        title="Average Project Health"
        value={`${metrics.overallHealthScore}/100`}
        detail={`${projects.length.toLocaleString('en-US')} active projects measured with AI Project Coach and weekly executive report rules.`}
        direction={healthDirection(metrics.overallHealthScore)}
      />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          KPI Summary
        </Text>

        <Text style={styles.summaryText}>
          {report.executiveSummary}
        </Text>
      </View>

      <KPIGroupCard
        title="Portfolio Performance"
        subtitle="Top-line executive indicators for active work."
      >
        <KPIStatusRow
          label="Total Active Projects"
          value={projects.length}
          detail="Currently active project list"
          icon="business-outline"
        />

        <KPIStatusRow
          label="Average Project Health"
          value={`${metrics.overallHealthScore}/100`}
          detail="AI Project Coach portfolio average"
          icon="pulse-outline"
          tone={healthTone(metrics.overallHealthScore)}
        />

        <KPIStatusRow
          label="Projects At Risk"
          value={metrics.projectsNeedingAttention}
          detail="Projects below the attention threshold"
          icon="alert-circle-outline"
          tone={metrics.projectsNeedingAttention > 0 ? 'warning' : 'success'}
        />
      </KPIGroupCard>

      <KPIGroupCard
        title="Execution Activity"
        subtitle="Weekly update, photo, document, and milestone signals."
      >
        <KPIStatusRow
          label="Updates This Week"
          value={metrics.updatesThisWeek}
          detail="Saved updates and current draft content"
          icon="newspaper-outline"
          tone={metrics.updatesThisWeek > 0 ? 'success' : 'warning'}
        />

        <KPIStatusRow
          label="Photos This Week"
          value={metrics.photosThisWeek}
          detail="Photos attached to weekly updates"
          icon="images-outline"
          tone={metrics.photosThisWeek > 0 ? 'success' : 'neutral'}
        />

        <KPIStatusRow
          label="Upcoming Milestones"
          value={metrics.upcomingMilestones}
          detail="Schedule items due within the report window"
          icon="flag-outline"
          tone={metrics.upcomingMilestones > 0 ? 'warning' : 'neutral'}
        />

        <KPIStatusRow
          label="Documents Added"
          value={metrics.documentsThisWeek}
          detail="Reference documents imported this week"
          icon="documents-outline"
          tone={metrics.documentsThisWeek > 0 ? 'success' : 'neutral'}
        />
      </KPIGroupCard>

      <KPIGroupCard
        title="Risk Controls"
        subtitle="Open action, overdue, and safety indicators requiring management visibility."
      >
        <KPIStatusRow
          label="Open Action Items"
          value={metrics.openActionItems}
          detail="Unresolved action items from project updates"
          icon="checkbox-outline"
          tone={metrics.openActionItems > 0 ? 'warning' : 'success'}
        />

        <KPIStatusRow
          label="Overdue Action Items"
          value={metrics.overdueActionItems}
          detail="Open action items past due"
          icon="timer-outline"
          tone={metrics.overdueActionItems > 0 ? 'danger' : 'success'}
        />

        <KPIStatusRow
          label="Safety Concerns"
          value={metrics.safetyConcerns}
          detail="Open safety concerns in project updates"
          icon="shield-checkmark-outline"
          tone={metrics.safetyConcerns > 0 ? 'danger' : 'success'}
        />
      </KPIGroupCard>

      <KPIGroupCard
        title="Top 5 Management Priorities"
        subtitle="Recommended actions generated by deterministic weekly executive report rules."
      >
        {priorities.map((priority, index) => (
          <KPIStatusRow
            key={`${index}-${priority}`}
            label={`Priority ${index + 1}`}
            value={index + 1}
            detail={priority}
            icon={index === 0 ? 'flag-outline' : 'chevron-forward-circle-outline'}
            tone={index === 0 ? 'warning' : 'neutral'}
          />
        ))}
      </KPIGroupCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
  },

  commandPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  commandTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },

  commandSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
  },

  commandRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    alignItems: 'stretch',
  },

  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  summaryLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
    textTransform: 'uppercase',
  },

  summaryText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
