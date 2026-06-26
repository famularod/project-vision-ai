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
import type {
  ProjectUpdate,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  formatDisplayDate,
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

function displayDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? formatDisplayDate(date)
    : date;
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
    if (seen.has(item)) return false;

    seen.add(item);
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
      .map(photo => ({
        id: `${update.id}-${photo.id}`,
        title: photo.actionRequired || photo.caption || photo.category,
        projectName: update.projectName,
        owner: photo.actionOwner,
        dueLabel: photo.actionDueDate.trim()
          ? dueStatusText(photo.actionDueDate)
          : 'No due date',
        status: photo.actionStatus,
      })),
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

function recentUpdateItems(updates: ProjectUpdate[]) {
  return [...updates]
    .filter(update => update.date.trim())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(update => {
      const days = daysSinceDate(update.date);
      const dateText = displayDate(update.date);
      const ageText =
        days === null
          ? dateText
          : days === 0
            ? 'Today'
            : `${countLabel(days, 'day')} ago`;

      return `${update.projectName || 'No project'}: ${dateText} (${ageText}), ${countLabel(update.photos.length, 'photo')}.`;
    });
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
  currentUpdate,
  onBack,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  onBack?: () => void;
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
    const safetyIssues = safetyIssuesFromUpdates(allUpdates);
    const upcomingMilestones = upcomingMilestonesFromSchedule(scheduleItems);
    const projectsAtRisk = analyses
      .filter(project => project.score < 70)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
    const recentCount = recentUpdatesCount(allUpdates);
    const priorities = executivePriorities({
      projectsAtRisk,
      openActions,
      safetyIssues,
      upcomingMilestones,
      recentCount,
      analyses,
    });

    return {
      analyses,
      projectNames,
      score,
      previousScore,
      openActions,
      safetyIssues,
      upcomingMilestones,
      projectsAtRisk,
      recentCount,
      recentItems: recentUpdateItems(allUpdates),
      priorities,
    };
  }, [currentUpdate, projects, savedUpdates, scheduleItems]);

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
        subtitle="Rule-based health summary generated from project updates, action items, safety concerns, and schedule data."
      />

      {onBack ? (
        <SecondaryButton
          label="Back"
          icon="arrow-back-outline"
          onPress={onBack}
        />
      ) : null}

      <HealthScoreGauge
        score={dashboard.score}
        title="Overall Health Score"
        subtitle={`${countLabel(dashboard.projectNames.length, 'project')} analyzed with the existing AI Project Coach rules.`}
      />

      <View style={styles.kpiGrid}>
        <KPICard
          label="Projects At Risk"
          value={dashboard.projectsAtRisk.length}
          subtitle="Projects scoring below 70"
          icon="alert-circle-outline"
          tone={dashboard.projectsAtRisk.length > 0 ? 'warning' : 'success'}
        />

        <KPICard
          label="Open Action Items"
          value={dashboard.openActions.length}
          subtitle="Unresolved issue or safety actions"
          icon="checkbox-outline"
          tone={dashboard.openActions.length > 0 ? 'warning' : 'success'}
        />

        <KPICard
          label="Safety Issues"
          value={dashboard.safetyIssues.length}
          subtitle="Open safety concern photos"
          icon="shield-checkmark-outline"
          tone={dashboard.safetyIssues.length > 0 ? 'danger' : 'success'}
        />

        <KPICard
          label="Upcoming Milestones"
          value={dashboard.upcomingMilestones.length}
          subtitle={`Due within ${UPCOMING_MILESTONE_WINDOW_DAYS} days`}
          icon="flag-outline"
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
        value={`${dashboard.recentCount} in the last ${RECENT_UPDATE_WINDOW_DAYS} days`}
        detail="Latest saved updates and the current draft are included when they have content."
        direction={dashboard.recentCount > 0 ? 'up' : 'flat'}
        icon="time-outline"
        items={
          dashboard.recentItems.length > 0
            ? dashboard.recentItems
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
          Deterministic priorities assembled from risks, open actions, safety issues, milestones, and update cadence.
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
