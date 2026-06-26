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
import { WeeklyReportActionList } from '../components/WeeklyReportActionList';
import { WeeklyReportMetricCard } from '../components/WeeklyReportMetricCard';
import { WeeklyReportSection } from '../components/WeeklyReportSection';
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

function healthTone(score: number) {
  if (score < 60) return 'danger';
  if (score < 75) return 'warning';

  return 'success';
}

export function WeeklyExecutiveReportScreen({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onPortfolioDashboard,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack: () => void;
  onPortfolioDashboard?: () => void;
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

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Weekly Executive Report"
        subtitle={`Rule-based report for ${report.periodLabel}. Generated locally from existing project data.`}
      />

      <SecondaryButton
        label="Back to Home"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      {onPortfolioDashboard ? (
        <SecondaryButton
          label="Portfolio"
          icon="albums-outline"
          onPress={onPortfolioDashboard}
        />
      ) : null}

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          Executive Summary
        </Text>

        <Text style={styles.summaryText}>
          {report.executiveSummary}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <WeeklyReportMetricCard
          label="Overall Health"
          value={`${report.metrics.overallHealthScore}/100`}
          subtitle="AI Project Coach average"
          icon="pulse-outline"
          tone={healthTone(report.metrics.overallHealthScore)}
        />

        <WeeklyReportMetricCard
          label="Projects At Risk"
          value={report.metrics.projectsNeedingAttention}
          subtitle="Below attention threshold"
          icon="alert-circle-outline"
          tone={report.metrics.projectsNeedingAttention > 0 ? 'warning' : 'success'}
        />

        <WeeklyReportMetricCard
          label="Updates This Week"
          value={report.metrics.updatesThisWeek}
          subtitle="Saved updates and current draft"
          icon="newspaper-outline"
          tone={report.metrics.updatesThisWeek > 0 ? 'success' : 'warning'}
        />

        <WeeklyReportMetricCard
          label="Photos This Week"
          value={report.metrics.photosThisWeek}
          subtitle="Photos in weekly updates"
          icon="images-outline"
          tone={report.metrics.photosThisWeek > 0 ? 'success' : 'neutral'}
        />

        <WeeklyReportMetricCard
          label="Open Actions"
          value={report.metrics.openActionItems}
          subtitle="Unresolved action items"
          icon="checkbox-outline"
          tone={report.metrics.openActionItems > 0 ? 'warning' : 'success'}
        />

        <WeeklyReportMetricCard
          label="Overdue Actions"
          value={report.metrics.overdueActionItems}
          subtitle="Open items past due"
          icon="timer-outline"
          tone={report.metrics.overdueActionItems > 0 ? 'danger' : 'success'}
        />

        <WeeklyReportMetricCard
          label="Safety Concerns"
          value={report.metrics.safetyConcerns}
          subtitle="Open safety items"
          icon="shield-checkmark-outline"
          tone={report.metrics.safetyConcerns > 0 ? 'danger' : 'success'}
        />

        <WeeklyReportMetricCard
          label="Upcoming Milestones"
          value={report.metrics.upcomingMilestones}
          subtitle="Due in the next 14 days"
          icon="flag-outline"
          tone={report.metrics.upcomingMilestones > 0 ? 'warning' : 'neutral'}
        />

        <WeeklyReportMetricCard
          label="Documents This Week"
          value={report.metrics.documentsThisWeek}
          subtitle="Reference documents updated"
          icon="documents-outline"
          tone={report.metrics.documentsThisWeek > 0 ? 'success' : 'neutral'}
        />
      </View>

      <WeeklyReportSection
        title="Recent Updates"
        subtitle="Updates captured inside the weekly reporting window."
      >
        <WeeklyReportActionList
          items={report.recentUpdates}
          icon="time-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Projects Needing Attention"
        subtitle="Projects below the weekly attention threshold."
      >
        <WeeklyReportActionList
          items={report.projectsNeedingAttention}
          tone={report.metrics.projectsNeedingAttention > 0 ? 'warning' : 'success'}
          icon={report.metrics.projectsNeedingAttention > 0 ? 'alert-circle-outline' : 'checkmark-circle-outline'}
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Open Action Items"
        subtitle="Unresolved action items surfaced from project updates."
      >
        <WeeklyReportActionList
          items={report.openActionItems}
          tone={report.metrics.openActionItems > 0 ? 'warning' : 'success'}
          icon="checkbox-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Overdue Action Items"
        subtitle="Open action items with due dates before today."
      >
        <WeeklyReportActionList
          items={report.overdueActionItems}
          tone={report.metrics.overdueActionItems > 0 ? 'danger' : 'success'}
          icon={report.metrics.overdueActionItems > 0 ? 'timer-outline' : 'checkmark-circle-outline'}
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Safety Concerns"
        subtitle="Open safety concerns from weekly project data."
      >
        <WeeklyReportActionList
          items={report.safetyConcerns}
          tone={report.metrics.safetyConcerns > 0 ? 'danger' : 'success'}
          icon="shield-checkmark-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Upcoming Milestones"
        subtitle="Schedule items due soon and not marked complete."
      >
        <WeeklyReportActionList
          items={report.upcomingMilestones}
          tone={report.metrics.upcomingMilestones > 0 ? 'warning' : 'neutral'}
          icon="flag-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Reference Documents"
        subtitle="Document activity during the weekly reporting window."
      >
        <WeeklyReportActionList
          items={report.documentUpdates}
          icon="documents-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Key Accomplishments"
        subtitle="Positive signals from updates, photos, documents, and project health."
      >
        <WeeklyReportActionList
          items={report.keyAccomplishments}
          tone="success"
          icon="checkmark-circle-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Top Risks"
        subtitle="Risk items that should remain visible at executive level."
      >
        <WeeklyReportActionList
          items={report.topRisks}
          tone={report.topRisks[0]?.startsWith('No major') ? 'success' : 'warning'}
          icon="warning-outline"
        />
      </WeeklyReportSection>

      <WeeklyReportSection
        title="Recommended Executive Actions"
        subtitle="Top actions generated by deterministic local rules."
      >
        <WeeklyReportActionList
          items={report.recommendedExecutiveActions}
          icon="flag-outline"
        />
      </WeeklyReportSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
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

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
});
