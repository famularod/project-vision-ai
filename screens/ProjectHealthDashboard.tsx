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
import { HealthScoreGauge } from '../components/HealthScoreGauge';
import { KPICard } from '../components/KPICard';
import {
  OpenActionsCard,
  OpenActionSummary,
} from '../components/OpenActionsCard';
import { RiskIndicator } from '../components/RiskIndicator';
import {
  SafetyIssueSummary,
  SafetyOverviewCard,
} from '../components/SafetyOverviewCard';
import {
  ScreenTitle,
  SecondaryButton,
  colors,
} from '../components/ProjectDetailsCard';
import { TrendCard } from '../components/TrendCard';
import {
  UpcomingMilestone,
  UpcomingMilestonesCard,
} from '../components/UpcomingMilestonesCard';
import { analyzeProjectCoach } from '../services/AIProjectCoach';
import { generateWeeklyExecutiveReport } from '../services/WeeklyExecutiveReportService';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
} from '../utils/date';

const UPCOMING_MILESTONE_WINDOW_DAYS = 14;
const RECENT_UPDATE_WINDOW_DAYS = 14;

type ProjectAnalysis = {
  projectName: string;
  score: number;
  risks: string[];
  recommendations: string[];
};

function isSameProject(projectName: string, nextProjectName: string) {
  return projectName.trim().toLowerCase() === nextProjectName.trim().toLowerCase();
}

function hasUpdateContent(update: ProjectUpdate) {
  return update.photos.length > 0 || update.notes.trim().length > 0;
}

function isActionCategory(photo: UpdatePhoto) {
  return photo.category === 'Open Issue' || photo.category === 'Safety Concern';
}

function hasActionDetails(photo: UpdatePhoto) {
  return Boolean(
    photo.actionRequired.trim() ||
      photo.actionOwner.trim() ||
      photo.actionDueDate.trim(),
  );
}

function isOpenAction(photo: UpdatePhoto) {
  return (
    isActionCategory(photo) &&
    photo.actionStatus !== 'Closed' &&
    hasActionDetails(photo)
  );
}

function isOpenSafetyIssue(photo: UpdatePhoto) {
  return photo.category === 'Safety Concern' && photo.actionStatus !== 'Closed';
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function daysSinceDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((today.getTime() - date.getTime()) / 86400000));
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const key = item.trim().toLowerCase();

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function projectNamesFromData({
  projects,
  savedUpdates,
  scheduleItems,
  currentUpdate,
}: {
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
}) {
  const projectNames: string[] = [];
  const addProjectName = (projectName: string) => {
    const trimmed = projectName.trim();

    if (
      trimmed &&
      !projectNames.some(existing => isSameProject(existing, trimmed))
    ) {
      projectNames.push(trimmed);
    }
  };

  projects.forEach(addProjectName);
  savedUpdates.forEach(update => addProjectName(update.projectName));
  scheduleItems.forEach(item => addProjectName(item.projectName));

  if (currentUpdate && hasUpdateContent(currentUpdate)) {
    addProjectName(currentUpdate.projectName);
  }

  return projectNames.length > 0 ? projectNames : ['Selected Project'];
}

function updatesWithCurrent({
  savedUpdates,
  currentUpdate,
}: {
  savedUpdates: ProjectUpdate[];
  currentUpdate: ProjectUpdate | null;
}) {
  if (
    !currentUpdate ||
    !hasUpdateContent(currentUpdate) ||
    savedUpdates.some(update => update.id === currentUpdate.id)
  ) {
    return savedUpdates;
  }

  return [currentUpdate, ...savedUpdates];
}

function averageScore(projects: ProjectAnalysis[]) {
  if (projects.length === 0) return 0;

  return Math.round(
    projects.reduce((total, project) => total + project.score, 0) /
      projects.length,
  );
}

function projectAnalyses({
  projectNames,
  savedUpdates,
  scheduleItems,
  currentUpdate,
}: {
  projectNames: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
}): ProjectAnalysis[] {
  return projectNames.map(projectName => {
    const analysis = analyzeProjectCoach({
      projectName,
      updates: savedUpdates,
      scheduleItems,
      currentUpdate:
        currentUpdate && isSameProject(projectName, currentUpdate.projectName)
          ? currentUpdate
          : null,
    });

    return {
      projectName,
      score: analysis.score,
      risks: analysis.risks,
      recommendations: analysis.recommendations,
    };
  });
}

function openActionsFromUpdates(updates: ProjectUpdate[]): OpenActionSummary[] {
  return updates.flatMap(update =>
    update.photos
      .filter(isOpenAction)
      .map(photo => {
        const daysUntilDue = photo.actionDueDate.trim()
          ? daysUntilDate(photo.actionDueDate)
          : null;

        return {
          id: `${update.id}-${photo.id}`,
          title: photo.actionRequired || photo.caption || photo.category,
          projectName: update.projectName,
          owner: photo.actionOwner,
          dueLabel: photo.actionDueDate.trim()
            ? dueStatusText(photo.actionDueDate)
            : 'No due date',
          status: photo.actionStatus,
          isOverdue: daysUntilDue !== null && daysUntilDue < 0,
        };
      }),
  );
}

function safetyIssuesFromUpdates(updates: ProjectUpdate[]): SafetyIssueSummary[] {
  return updates.flatMap(update =>
    update.photos
      .filter(isOpenSafetyIssue)
      .map(photo => ({
        id: `${update.id}-${photo.id}`,
        title: photo.actionRequired || photo.caption || photo.category,
        projectName: update.projectName,
        owner: photo.actionOwner,
        status: photo.actionStatus,
      })),
  );
}

function upcomingMilestonesFromSchedule(
  scheduleItems: ScheduleItem[],
): UpcomingMilestone[] {
  return scheduleItems
    .map(item => ({
      item,
      days: daysUntilDate(item.finishDate),
    }))
    .filter(
      entry =>
        entry.item.status !== 'Complete' &&
        entry.days !== null &&
        entry.days >= 0 &&
        entry.days <= UPCOMING_MILESTONE_WINDOW_DAYS,
    )
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
    .map(({ item }) => ({
      id: item.id,
      title: item.milestone || item.taskName,
      projectName: item.projectName,
      dueLabel: dueStatusText(item.finishDate),
      status: item.status,
      percentComplete: item.percentComplete,
    }));
}

function recentUpdatesCount(updates: ProjectUpdate[]) {
  return updates.filter(update => {
    const days = daysSinceDate(update.date);

    return days !== null && days <= RECENT_UPDATE_WINDOW_DAYS;
  }).length;
}

function trendDirection(delta: number) {
  if (delta > 2) return 'up';
  if (delta < -2) return 'down';

  return 'flat';
}

function executivePriorities({
  projectsAtRisk,
  openActions,
  safetyIssues,
  upcomingMilestones,
  recentCount,
  analyses,
}: {
  projectsAtRisk: ProjectAnalysis[];
  openActions: OpenActionSummary[];
  safetyIssues: SafetyIssueSummary[];
  upcomingMilestones: UpcomingMilestone[];
  recentCount: number;
  analyses: ProjectAnalysis[];
}) {
  const priorities: string[] = [];

  projectsAtRisk.forEach(project => {
    const action = project.recommendations[0] || project.risks[0];

    if (action) {
      priorities.push(`${project.projectName}: ${action}`);
    }
  });

  if (safetyIssues.length > 0) {
    priorities.push(
      `Resolve or assign ${countLabel(safetyIssues.length, 'open safety issue')}.`,
    );
  }

  if (openActions.length > 0) {
    priorities.push(
      `Close, assign, or re-date ${countLabel(openActions.length, 'open action item')}.`,
    );
  }

  if (upcomingMilestones.length > 0) {
    priorities.push(
      `Confirm readiness for ${countLabel(upcomingMilestones.length, 'upcoming milestone')}.`,
    );
  }

  if (recentCount === 0) {
    priorities.push('Capture a current update for executive visibility.');
  }

  analyses.forEach(project => {
    const action = project.recommendations[0];

    if (action) {
      priorities.push(`${project.projectName}: ${action}`);
    }
  });

  const uniquePriorities = uniqueItems(priorities);

  return uniquePriorities.length > 0
    ? uniquePriorities.slice(0, 5)
    : ['Continue the current update cadence and monitor project conditions.'];
}

export function ProjectHealthDashboard({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  referenceDocuments,
  currentUpdate,
  onBack,
  onAIProjectCoach,
  onExecutiveBrief,
  onWeeklyReport,
  onExecutiveKPIDashboard,
  onConstructionTimeline,
  onProjectRiskMatrix,
  onPortfolioDashboard,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  currentUpdate: ProjectUpdate | null;
  onBack?: () => void;
  onAIProjectCoach?: () => void;
  onExecutiveBrief?: () => void;
  onWeeklyReport?: () => void;
  onExecutiveKPIDashboard?: () => void;
  onConstructionTimeline?: () => void;
  onProjectRiskMatrix?: () => void;
  onPortfolioDashboard?: () => void;
}) {
  const dashboard = useMemo(() => {
    const projectNames = projectNamesFromData({
      projects,
      savedUpdates,
      scheduleItems,
      currentUpdate,
    });
    const allUpdates = updatesWithCurrent({
      savedUpdates,
      currentUpdate,
    });
    const analyses = projectAnalyses({
      projectNames,
      savedUpdates,
      scheduleItems,
      currentUpdate,
    });
    const savedOnlyAnalyses = projectAnalyses({
      projectNames,
      savedUpdates,
      scheduleItems,
      currentUpdate: null,
    });
    const score = averageScore(analyses);
    const previousScore = averageScore(savedOnlyAnalyses);
    const openActions = openActionsFromUpdates(allUpdates);
    const overdueActions = openActions.filter(action => action.isOverdue);
    const safetyIssues = safetyIssuesFromUpdates(allUpdates);
    const upcomingMilestones = upcomingMilestonesFromSchedule(scheduleItems);
    const projectsAtRisk = analyses
      .filter(project => project.score < 70)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    const recentCount = recentUpdatesCount(allUpdates);
    const weeklyReport = generateWeeklyExecutiveReport({
      projects,
      updates: savedUpdates,
      scheduleItems,
      referenceDocuments,
      currentUpdate,
    });
    const priorities = uniqueItems([
      ...weeklyReport.recommendedExecutiveActions,
      ...executivePriorities({
        projectsAtRisk,
        openActions,
        safetyIssues,
        upcomingMilestones,
        recentCount,
        analyses,
      }),
    ]).slice(0, 5);

    const priorityItems =
      priorities.length > 0
        ? priorities
        : ['Continue the current update cadence and monitor project conditions.'];

    return {
      projectNames,
      score,
      previousScore,
      openActions,
      overdueActions,
      safetyIssues,
      upcomingMilestones,
      projectsAtRisk,
      recentCount,
      priorities: priorityItems,
      weeklyReport,
    };
  }, [
    currentUpdate,
    projects,
    referenceDocuments,
    savedUpdates,
    scheduleItems,
  ]);

  const weeklyMetrics = dashboard.weeklyReport.metrics;
  const scoreDelta = dashboard.score - dashboard.previousScore;
  const deltaText =
    scoreDelta === 0
      ? 'Stable'
      : `${scoreDelta > 0 ? '+' : ''}${scoreDelta} pts`;

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenTitle
        title="Project Health Dashboard"
        subtitle="Executive command center generated from project updates, schedule data, action items, safety concerns, and local AI Project Coach rules."
      />

      <View style={styles.commandPanel}>
        <Text style={styles.commandTitle}>
          Command Center
        </Text>

        <Text style={styles.commandSubtitle}>
          Jump between executive views without changing project data.
        </Text>

        <View style={styles.commandRow}>
          {onBack ? (
            <SecondaryButton
              label="Home"
              icon="home-outline"
              onPress={onBack}
              compact
            />
          ) : null}

          {onAIProjectCoach ? (
            <SecondaryButton
              label="AI Coach"
              icon="bulb-outline"
              onPress={onAIProjectCoach}
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
              label="Weekly Report"
              icon="newspaper-outline"
              onPress={onWeeklyReport}
              compact
            />
          ) : null}
        </View>

        {onExecutiveKPIDashboard || onConstructionTimeline ? (
          <View style={styles.commandRow}>
            {onExecutiveKPIDashboard ? (
              <SecondaryButton
                label="KPI Dashboard"
                icon="stats-chart-outline"
                onPress={onExecutiveKPIDashboard}
                compact
              />
            ) : null}

            {onConstructionTimeline ? (
              <SecondaryButton
                label="Timeline"
                icon="git-branch-outline"
                onPress={onConstructionTimeline}
                compact
              />
            ) : null}
          </View>
        ) : null}

        {onProjectRiskMatrix || onPortfolioDashboard ? (
          <View style={styles.commandRow}>
            {onProjectRiskMatrix ? (
              <SecondaryButton
                label="Risk Matrix"
                icon="warning-outline"
                onPress={onProjectRiskMatrix}
                compact
              />
            ) : null}

            {onPortfolioDashboard ? (
              <SecondaryButton
                label="Portfolio"
                icon="albums-outline"
                onPress={onPortfolioDashboard}
                compact
              />
            ) : null}
          </View>
        ) : null}
      </View>

      <HealthScoreGauge
        score={dashboard.score}
        title="Overall Health Score"
        subtitle={`${countLabel(dashboard.projectNames.length, 'project')} analyzed with AI Project Coach rules and weekly executive report signals.`}
      />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>
          Executive Readout
        </Text>

        <Text style={styles.summaryText}>
          {dashboard.weeklyReport.executiveSummary}
        </Text>
      </View>

      <View style={styles.kpiGrid}>
        <KPICard
          label="Projects At Risk"
          value={weeklyMetrics.projectsNeedingAttention}
          subtitle="Projects below attention threshold"
          icon="alert-circle-outline"
          tone={weeklyMetrics.projectsNeedingAttention > 0 ? 'warning' : 'success'}
        />

        <KPICard
          label="Open Action Items"
          value={weeklyMetrics.openActionItems}
          subtitle="Unresolved issue or safety actions"
          icon="checkbox-outline"
          tone={weeklyMetrics.openActionItems > 0 ? 'warning' : 'success'}
        />

        <KPICard
          label="Overdue Actions"
          value={weeklyMetrics.overdueActionItems}
          subtitle="Open items past due"
          icon="timer-outline"
          tone={weeklyMetrics.overdueActionItems > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Safety Concerns"
          value={weeklyMetrics.safetyConcerns}
          subtitle="Open safety concern photos"
          icon="shield-checkmark-outline"
          tone={weeklyMetrics.safetyConcerns > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Upcoming Milestones"
          value={weeklyMetrics.upcomingMilestones}
          subtitle={`Due within ${UPCOMING_MILESTONE_WINDOW_DAYS} days`}
          icon="flag-outline"
          tone={weeklyMetrics.upcomingMilestones > 0 ? 'warning' : 'neutral'}
        />

        <KPICard
          label="Recent Updates"
          value={weeklyMetrics.updatesThisWeek}
          subtitle={`${weeklyMetrics.photosThisWeek.toLocaleString('en-US')} photos this week`}
          icon="time-outline"
          tone={weeklyMetrics.updatesThisWeek > 0 ? 'success' : 'warning'}
        />
      </View>

      <TrendCard
        title="Health Trend"
        value={deltaText}
        detail="Compares current health against the saved-only baseline, so in-progress draft content can move the trend."
        direction={trendDirection(scoreDelta)}
      />

      <TrendCard
        title="Recent Updates"
        value={`${weeklyMetrics.updatesThisWeek} this week`}
        detail={`Weekly report period: ${dashboard.weeklyReport.periodLabel}. Latest saved updates and the current draft are included when they have content.`}
        direction={weeklyMetrics.updatesThisWeek > 0 ? 'up' : 'flat'}
        icon="time-outline"
        items={
          dashboard.weeklyReport.recentUpdates.length > 0
            ? dashboard.weeklyReport.recentUpdates
            : ['No recent updates detected from the current local data.']
        }
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          Projects At Risk
        </Text>

        <Text style={styles.panelSubtitle}>
          Lowest health scores from the AI Project Coach analysis.
        </Text>

        {dashboard.projectsAtRisk.length > 0 ? (
          dashboard.projectsAtRisk.map(project => (
            <RiskIndicator
              key={project.projectName}
              title={project.projectName}
              subtitle={project.risks[0] || 'Risk details are not available.'}
              score={project.score}
              tone={project.score < 60 ? 'danger' : 'warning'}
            />
          ))
        ) : (
          <RiskIndicator
            title="No projects at risk"
            subtitle="No project currently has a health score below 70."
            tone="success"
          />
        )}
      </View>

      <OpenActionsCard
        actions={dashboard.overdueActions.slice(0, 5)}
        title="Overdue Action Items"
        subtitle="Open action items with due dates before today."
        emptyText="No overdue action items detected."
        danger
      />

      <UpcomingMilestonesCard
        milestones={dashboard.upcomingMilestones.slice(0, 5)}
      />

      <OpenActionsCard
        actions={dashboard.openActions.slice(0, 5)}
      />

      <SafetyOverviewCard
        issues={dashboard.safetyIssues.slice(0, 5)}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          Top 5 Executive Priorities
        </Text>

        <Text style={styles.panelSubtitle}>
          Priorities assembled from Weekly Executive Report output, risks, open actions, safety issues, milestones, and update cadence.
        </Text>

        {dashboard.priorities.map((priority, index) => (
          <RiskIndicator
            key={`${index}-${priority}`}
            title={`Priority ${index + 1}`}
            subtitle={priority}
            tone={index === 0 ? 'warning' : 'neutral'}
          />
        ))}
      </View>
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

  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },

  panel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },

  panelSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
});
