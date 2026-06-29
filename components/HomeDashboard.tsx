import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from './AppHeader';
import { AttentionCard } from './AttentionCard';
import { Screen } from './layout/Screen';
import { RecentActivity } from './RecentActivity';
import {
  type ProjectSyncFreshnessMetadata,
} from '../services/ProjectIntelligenceEngine';
import { buildRuntime } from '../services/PIERuntime';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import {
  buildScheduleSummary,
  type ScheduleSummary,
  type ScheduleSummaryTask,
} from '../utils/schedule';

type ProjectStats = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
  lastUpdate?: string;
};

type IconName = keyof typeof Ionicons.glyphMap;

type RecommendedAction = {
  title: string;
  detail: string;
  actionLabel: string;
  icon: IconName;
  onPress: () => void;
};

type HomeDashboardProps = {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  projectStatsByName: Record<string, ProjectStats>;
  unfinishedDraft: ProjectUpdate | null;
  draftSavedAt: string | null;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: () => void;
  onUpdateProject: (projectName: string) => void;
  onOpenProject: (projectName: string) => void;
  onViewProjects: () => void;
  onSchedule: () => void;
  onProjectAssistant: () => void;
  onAIProjectCoach: () => void;
  onAIExecutiveBrief: () => void;
};

const EMPTY_PROJECT_STATS: ProjectStats = {
  updates: 0,
  photos: 0,
  openActions: 0,
  overdueActions: 0,
  dueThisWeek: 0,
};

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primarySoft: '#EAF4FF',
  primary: '#007AFF',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  danger: '#FF3B30',
  fill: '#F2F2F7',
};

function formatSavedTime(value: string | null) {
  if (!value) return 'Recently';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Recently';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatProjectDate(value: string | null | undefined) {
  if (!value) return 'No updates yet';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function matchesProjectName(value: string, projectName: string) {
  return value.trim().toLowerCase() === projectName.trim().toLowerCase();
}

function sortUpdatesNewestFirst(
  left: ProjectUpdate,
  right: ProjectUpdate,
) {
  return new Date(right.date).getTime() - new Date(left.date).getTime();
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';

  return 'Good evening';
}

function getProjectHealth(
  stats: ProjectStats,
  scheduleSummary: ScheduleSummary | null,
) {
  const scheduleOverdue = scheduleSummary?.overdueCount ?? 0;
  const scheduleDueSoon = scheduleSummary?.upcoming7Count ?? 0;

  if (stats.overdueActions > 0 || scheduleOverdue > 0) {
    return {
      label: 'Red',
      detail: 'Needs attention',
      color: colors.danger,
      backgroundColor: '#FFEDEC',
    };
  }

  if (stats.openActions > 0 || stats.dueThisWeek > 0 || scheduleDueSoon > 0) {
    return {
      label: 'Yellow',
      detail: 'Watch closely',
      color: colors.warning,
      backgroundColor: colors.warningSoft,
    };
  }

  return {
    label: 'Green',
    detail: 'On track',
    color: '#248A3D',
    backgroundColor: '#EAF7ED',
  };
}

function getNextMilestone(summary: ScheduleSummary | null) {
  if (!summary) return null;

  return summary.milestoneTasks.find(
    task =>
      !task.isCompleted &&
      task.daysUntilDue !== null &&
      task.daysUntilDue >= 0,
  ) || null;
}

function buildRecommendedAction({
  activeProjectName,
  currentProjectStats,
  currentProjectScheduleSummary,
  unfinishedDraft,
  projectsNeedingAttention,
  scheduleSummary,
  onResumeDraft,
  onUpdateProject,
  onOpenProject,
  onViewProjects,
  onSchedule,
  onAIExecutiveBrief,
}: {
  activeProjectName: string | null;
  currentProjectStats: ProjectStats;
  currentProjectScheduleSummary: ScheduleSummary | null;
  unfinishedDraft: ProjectUpdate | null;
  projectsNeedingAttention: { project: string; stats: ProjectStats }[];
  scheduleSummary: ScheduleSummary;
  onResumeDraft: () => void;
  onUpdateProject: (projectName: string) => void;
  onOpenProject: (projectName: string) => void;
  onViewProjects: () => void;
  onSchedule: () => void;
  onAIExecutiveBrief: () => void;
}): RecommendedAction {
  if (unfinishedDraft) {
    return {
      title: 'Resume unfinished update',
      detail: `Continue the saved update for ${unfinishedDraft.projectName}.`,
      actionLabel: 'Resume Draft',
      icon: 'play-outline',
      onPress: onResumeDraft,
    };
  }

  if (!activeProjectName) {
    return {
      title: 'Open a project',
      detail: 'Choose a project so updates and reports have context.',
      actionLabel: 'View Projects',
      icon: 'folder-open-outline',
      onPress: onViewProjects,
    };
  }

  if (
    (currentProjectScheduleSummary?.overdueCount ?? 0) > 0 ||
    scheduleSummary.overdueCount > 0
  ) {
    return {
      title: 'Review overdue schedule items',
      detail: 'Start with overdue work before capturing routine progress.',
      actionLabel: 'View Schedule',
      icon: 'calendar-outline',
      onPress: onSchedule,
    };
  }

  const attentionProject = projectsNeedingAttention[0]?.project;

  if (
    currentProjectStats.overdueActions > 0 ||
    currentProjectStats.openActions > 0 ||
    attentionProject
  ) {
    const projectToOpen = attentionProject || activeProjectName;

    return {
      title: 'Open Project Overview',
      detail: `Review what needs attention on ${projectToOpen}.`,
      actionLabel: 'Open Project',
      icon: 'reader-outline',
      onPress: () => onOpenProject(projectToOpen),
    };
  }

  if (currentProjectStats.updates === 0) {
    return {
      title: "Capture today's progress",
      detail: `Start the first update for ${activeProjectName}.`,
      actionLabel: 'Capture Update',
      icon: 'camera-outline',
      onPress: () => onUpdateProject(activeProjectName),
    };
  }

  return {
    title: 'Generate executive report',
    detail: 'Turn recent activity into a clear project communication.',
    actionLabel: 'Generate Report',
    icon: 'newspaper-outline',
    onPress: onAIExecutiveBrief,
  };
}

function confidenceLabel(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'strong';
  if (level === 'medium') return 'usable';

  return 'limited';
}

export function HomeDashboard({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  projectAreas,
  contacts,
  referenceDocuments,
  syncMetadata,
  projectStatsByName,
  unfinishedDraft,
  draftSavedAt,
  onResumeDraft,
  onDiscardDraft,
  onNewUpdate,
  onUpdateProject,
  onOpenProject,
  onViewProjects,
  onSchedule,
  onProjectAssistant,
  onAIProjectCoach,
  onAIExecutiveBrief,
}: HomeDashboardProps) {
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const projectsNeedingAttention = projects
    .map(project => ({
      project,
      stats: projectStatsByName[project] || EMPTY_PROJECT_STATS,
    }))
    .filter(
      item =>
        item.stats.overdueActions > 0 ||
        item.stats.openActions > 0 ||
        item.stats.dueThisWeek > 0,
    )
    .sort((a, b) => {
      if (b.stats.overdueActions !== a.stats.overdueActions) {
        return b.stats.overdueActions - a.stats.overdueActions;
      }

      if (b.stats.dueThisWeek !== a.stats.dueThisWeek) {
        return b.stats.dueThisWeek - a.stats.dueThisWeek;
      }

      return b.stats.openActions - a.stats.openActions;
    })
    .slice(0, 5);
  const draftProject = projects.find(project =>
    unfinishedDraft?.projectName &&
    matchesProjectName(project, unfinishedDraft.projectName),
  );
  const latestActivityProject = savedUpdates
    .map(update => update.projectName)
    .find(projectName =>
      projects.some(project => matchesProjectName(project, projectName)),
    );
  const activeProjectName =
    draftProject || latestActivityProject || projects[0] || null;
  const currentProject = activeProjectName || 'No active project';
  const runtime = buildRuntime({
    projectName: activeProjectName || currentProject,
    projectNames: projects,
    updates: savedUpdates,
    scheduleItems,
    currentUpdate: unfinishedDraft,
    projectAreas,
    contacts,
    referenceDocuments,
    syncMetadata,
    surface: 'home',
  });
  const currentProjectStats =
    activeProjectName
      ? projectStatsByName[activeProjectName] || EMPTY_PROJECT_STATS
      : EMPTY_PROJECT_STATS;
  const scheduleSummary = buildScheduleSummary(scheduleItems);
  const currentProjectScheduleSummary = activeProjectName
    ? buildScheduleSummary(scheduleItems, { projectName: activeProjectName })
    : null;
  const currentProjectUpdates = activeProjectName
    ? savedUpdates
        .filter(update =>
          matchesProjectName(update.projectName, activeProjectName),
        )
        .sort(sortUpdatesNewestFirst)
    : [];
  const latestProjectUpdate = currentProjectUpdates[0] || null;
  const latestUpdateDate =
    currentProjectStats.lastUpdate || latestProjectUpdate?.date || null;
  const projectHealth = activeProjectName
    ? getProjectHealth(currentProjectStats, currentProjectScheduleSummary)
    : {
        label: 'Not Set',
        detail: 'Open a project',
        color: colors.muted,
        backgroundColor: colors.fill,
      };
  const nextMilestone = getNextMilestone(currentProjectScheduleSummary);
  const nextMilestoneText = nextMilestone
    ? `${nextMilestone.title} | ${nextMilestone.dueLabel}`
    : currentProjectScheduleSummary?.totalItems
      ? 'No upcoming milestone'
      : 'Schedule Required';
  const recommendedAction = buildRecommendedAction({
    activeProjectName,
    currentProjectStats,
    currentProjectScheduleSummary,
    unfinishedDraft,
    projectsNeedingAttention,
    scheduleSummary,
    onResumeDraft,
    onUpdateProject,
    onOpenProject,
    onViewProjects,
    onSchedule,
    onAIExecutiveBrief,
  });
  const topPriority =
    runtime.priorityQueue.currentPriority?.title ||
    runtime.nextBestAction.title ||
    recommendedAction.title;
  const currentConfidence =
    `${runtime.intelligence.confidence.score}% ${confidenceLabel(runtime.overallConfidence)}`;
  const currentMission = runtime.currentMission;
  const missionBlockers =
    runtime.missionBlockers.length > 0
      ? runtime.missionBlockers
          .slice(0, 2)
          .map(blocker => blocker.title)
          .join(' | ')
      : 'No mission blockers from current evidence';
  const todayPriorities = [
    topPriority,
    runtime.currentMission.recommendedActions[0]?.recommendation,
    runtime.nextBestAction.suggestedNextAction,
  ].filter((item, index, items): item is string =>
    Boolean(item && items.indexOf(item) === index),
  ).slice(0, 3);
  const attentionProjectNames =
    projectsNeedingAttention.length > 0
      ? projectsNeedingAttention.map(item => item.project).slice(0, 3)
      : ['No project currently needs high attention from local evidence'];
  const startCapture = () =>
    activeProjectName ? onUpdateProject(activeProjectName) : onNewUpdate();

  return (
    <Screen contentStyle={contentStyle}>
      <AppHeader />

      <View style={styles.morningBriefCard}>
        <View style={styles.morningBriefHeader}>
          <View style={styles.morningBriefIcon}>
            <Ionicons
              name="sparkles-outline"
              size={24}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.morningBriefGreeting}>
              {getGreeting()}
            </Text>

            <Text style={styles.morningBriefSubtitle}>
              PIE Briefing: here is what matters today.
            </Text>
          </View>
        </View>

        <View style={styles.briefLineList}>
          <BriefLine
            icon="flag-outline"
            label="Current Mission"
            value={`${currentMission.title}: ${currentMission.purpose}`}
          />

          <BriefLine
            icon="trending-up-outline"
            label="Mission Progress"
            value={`${runtime.missionProgress.score}% - ${runtime.missionProgress.summary}`}
          />

          <BriefLine
            icon="ban-outline"
            label="Mission Blockers"
            value={missionBlockers}
          />

          <BriefLine
            icon="shield-checkmark-outline"
            label="Trust Score"
            value={`${runtime.trustScore.overallScore}% ${confidenceLabel(runtime.trustScore.level)}`}
          />

          <BriefLine
            icon="bulb-outline"
            label="Understanding"
            value={`${runtime.understandingScore.score}% ${confidenceLabel(runtime.understandingScore.level)}`}
          />

          <BriefLine
            icon="pulse-outline"
            label="Confidence"
            value={currentConfidence}
          />

          <BriefLine
            icon="briefcase-outline"
            label="Preparedness"
            value={`${runtime.preparednessScore.score}% ${confidenceLabel(runtime.preparednessScore.level)}`}
          />

          <BriefLine
            icon={recommendedAction.icon}
            label="Top Priority"
            value={topPriority}
          />

          <BriefLine
            icon="git-branch-outline"
            label="What Changed"
            value={runtime.response.whatChanged}
          />

          <BriefLine
            icon="alert-circle-outline"
            label="What Concerns PIE"
            value={runtime.response.whatConcernsPIE}
          />

          <BriefLine
            icon="checkmark-circle-outline"
            label="What PIE Recommends"
            value={runtime.response.whatPIERecommends}
          />

          <BriefLine
            icon="hand-left-outline"
            label="What PIE Needs"
            value={runtime.response.whatPIENeedsFromYou}
          />
        </View>
      </View>

      <HomePieListCard
        title="Today's Priorities"
        icon="flag-outline"
        items={todayPriorities}
      />

      <HomePieListCard
        title="Projects Needing Attention"
        icon="alert-circle-outline"
        items={attentionProjectNames}
      />

      <TouchableOpacity
        style={styles.captureHeroButton}
        onPress={startCapture}
      >
        <View style={styles.captureHeroIcon}>
          <Ionicons
            name="camera-outline"
            size={27}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.captureHeroTitle}>
            Begin Project Walk
          </Text>

          <Text
            style={styles.captureHeroSubtitle}
            numberOfLines={2}
          >
            {activeProjectName
              ? `Walk ${activeProjectName} and capture what changed`
              : 'Choose a project and capture what changed'}
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={24}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      <View style={styles.todaySecondaryActions}>
        <TouchableOpacity
          style={styles.todaySecondaryButton}
          onPress={onAIExecutiveBrief}
        >
          <Ionicons
            name="newspaper-outline"
            size={18}
            color={colors.primary}
          />

          <Text
            style={styles.todaySecondaryText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.84}
          >
            Review Prepared Updates
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.todaySecondaryButton}
          onPress={onViewProjects}
        >
          <Ionicons
            name="folder-open-outline"
            size={18}
            color={colors.primary}
          />

          <Text
            style={styles.todaySecondaryText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.84}
          >
            View Projects
          </Text>
        </TouchableOpacity>
      </View>

      {unfinishedDraft ? (
        <View style={styles.draftRecoveryCard}>
          <View style={styles.draftRecoveryHeader}>
            <View style={styles.draftIcon}>
              <Ionicons
                name="document-text-outline"
                size={22}
                color={colors.warning}
              />
            </View>

            <View style={styles.rowMain}>
              <Text style={styles.draftRecoveryTitle}>
                Unfinished Update
              </Text>

              <Text style={styles.draftRecoveryProject}>
                {unfinishedDraft.projectName}
              </Text>
            </View>
          </View>

          <View style={styles.draftStatsRow}>
            <Text style={styles.draftStatText}>
              {unfinishedDraft.photos.length} photo
              {unfinishedDraft.photos.length === 1 ? '' : 's'}
            </Text>

            <Text style={styles.draftStatDot}>•</Text>

            <Text style={styles.draftStatText}>
              Last saved {formatSavedTime(draftSavedAt)}
            </Text>
          </View>

          <View style={styles.draftActionRow}>
            <TouchableOpacity
              style={styles.resumeDraftButton}
              onPress={onResumeDraft}
            >
              <Ionicons
                name="play-outline"
                size={18}
                color="#FFFFFF"
              />

              <Text style={styles.resumeDraftText}>
                Resume Draft
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.discardDraftButton}
              onPress={onDiscardDraft}
            >
              <Ionicons
                name="trash-outline"
                size={18}
                color={colors.danger}
              />

              <Text style={styles.discardDraftText}>
                Discard
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.currentProjectCard}>
        <View style={styles.currentProjectHeader}>
          <View style={styles.currentProjectIcon}>
            <Ionicons
              name="business-outline"
              size={24}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.currentProjectEyebrow}>
              Current Project
            </Text>

            <Text
              style={styles.currentProjectName}
              numberOfLines={2}
            >
              {currentProject}
            </Text>
          </View>
        </View>

        <View style={styles.projectSignalList}>
          <View style={styles.projectSignalRow}>
            <Text style={styles.projectSignalLabel}>
              Health
            </Text>

            <View
              style={[
                styles.healthBadge,
                { backgroundColor: projectHealth.backgroundColor },
              ]}
            >
              <View
                style={[
                  styles.healthDot,
                  { backgroundColor: projectHealth.color },
                ]}
              />

              <Text
                style={[
                  styles.healthBadgeText,
                  { color: projectHealth.color },
                ]}
              >
                {projectHealth.label} · {projectHealth.detail}
              </Text>
            </View>
          </View>

          <View style={styles.projectSignalRow}>
            <Text style={styles.projectSignalLabel}>
              Last update
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={1}
            >
              {formatProjectDate(latestUpdateDate)}
            </Text>
          </View>

          <View style={styles.projectSignalRow}>
            <Text style={styles.projectSignalLabel}>
              Next milestone
            </Text>

            <Text
              style={styles.projectSignalValue}
              numberOfLines={2}
            >
              {nextMilestoneText}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.openProjectButton}
          onPress={() =>
            activeProjectName
              ? onOpenProject(activeProjectName)
              : onViewProjects()
          }
        >
          <Ionicons
            name="folder-open-outline"
            size={20}
            color={colors.primary}
          />

          <Text style={styles.openProjectButtonText}>
            {activeProjectName ? 'Open Project' : 'View Projects'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.secondaryActionsPanel}>
        <TouchableOpacity
          style={styles.moreActionsButton}
          onPress={() => setSecondaryActionsOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel="Show more Home actions"
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={colors.primary}
          />

          <Text
            style={styles.moreActionsText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            More
          </Text>
        </TouchableOpacity>

        {secondaryActionsOpen ? (
          <View style={styles.secondaryActionMenu}>
            <TouchableOpacity
              style={styles.secondaryMenuAction}
              onPress={onProjectAssistant}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={18}
                color={colors.primary}
              />

              <Text
                style={styles.secondaryMenuText}
                numberOfLines={1}
              >
                Project Assistant
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryMenuAction}
              onPress={onAIExecutiveBrief}
            >
              <Ionicons
                name="newspaper-outline"
                size={18}
                color={colors.primary}
              />

              <Text
                style={styles.secondaryMenuText}
                numberOfLines={1}
              >
                Generate Report
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryMenuAction}
              onPress={onAIProjectCoach}
            >
              <Ionicons
                name="bulb-outline"
                size={18}
                color={colors.primary}
              />

              <Text
                style={styles.secondaryMenuText}
                numberOfLines={1}
              >
                AI Coach
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <AttentionCard
        projectsNeedingAttention={projectsNeedingAttention}
        onUpdateProject={onUpdateProject}
      />

      <ScheduleAttentionCard
        summary={scheduleSummary}
        onSchedule={onSchedule}
      />

      <RecentActivity updates={savedUpdates} />
    </Screen>
  );
}

function BriefLine({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.briefLine}>
      <View style={styles.briefLineIcon}>
        <Ionicons
          name={icon}
          size={18}
          color={colors.primary}
        />
      </View>

      <View style={styles.briefLineContent}>
        <Text
          style={styles.briefLineLabel}
          numberOfLines={1}
        >
          {label}
        </Text>

        <Text
          style={styles.briefLineValue}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function HomePieListCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: IconName;
  items: string[];
}) {
  return (
    <View style={styles.homePieListCard}>
      <View style={styles.homePieListHeader}>
        <View style={styles.homePieListIcon}>
          <Ionicons
            name={icon}
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.homePieListTitle}>
            {title}
          </Text>

          <View style={styles.homePieList}>
            {items.map(item => (
              <View
                key={item}
                style={styles.homePieListItem}
              >
                <View style={styles.homePieListBullet} />

                <Text style={styles.homePieListText}>
                  {item}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function ScheduleAttentionCard({
  summary,
  onSchedule,
}: {
  summary: ScheduleSummary;
  onSchedule: () => void;
}) {
  if (summary.overdueCount === 0 && summary.upcoming30Count === 0) {
    return null;
  }

  const upcomingTasks = summary.upcomingTasks.slice(0, 3);

  return (
    <View style={styles.scheduleAttentionCard}>
      <View style={styles.scheduleAttentionHeader}>
        <View style={styles.scheduleAttentionIcon}>
          <Ionicons
            name={summary.overdueCount > 0 ? 'alert-circle-outline' : 'time-outline'}
            size={22}
            color={summary.overdueCount > 0 ? colors.danger : colors.warning}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.scheduleAttentionTitle}>
            Schedule Attention
          </Text>

          <Text style={styles.scheduleAttentionMeta}>
            {summary.overdueCount > 0
              ? `${summary.overdueCount} overdue | `
              : ''}
            {summary.upcoming7Count} due in 7 days | {summary.upcoming30Count} due in 30 days
          </Text>
        </View>
      </View>

      {upcomingTasks.length > 0 ? (
        <View style={styles.scheduleTaskList}>
          {upcomingTasks.map(task => (
            <ScheduleAttentionTask
              key={task.item.id}
              task={task}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.scheduleEmptyText}>
          No upcoming dated tasks. Review overdue items in Schedule.
        </Text>
      )}

      <TouchableOpacity
        style={styles.scheduleAttentionButton}
        onPress={onSchedule}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={colors.primary}
        />

        <Text style={styles.scheduleAttentionButtonText}>
          View Schedule Summary
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function ScheduleAttentionTask({
  task,
}: {
  task: ScheduleSummaryTask;
}) {
  return (
    <View style={styles.scheduleTaskRow}>
      <View style={styles.scheduleTaskBullet} />

      <View style={styles.rowMain}>
        <Text
          style={styles.scheduleTaskTitle}
          numberOfLines={1}
        >
          {task.title}
        </Text>

        <Text
          style={styles.scheduleTaskMeta}
          numberOfLines={1}
        >
          {task.projectName} | {task.dueLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  draftRecoveryCard: {
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: '#FFD8A3',
    borderRadius: 12,
    padding: 15,
    marginBottom: 14,
  },

  draftRecoveryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },

  draftIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  draftRecoveryTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },

  draftRecoveryProject: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },

  draftStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 13,
  },

  draftStatText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },

  draftStatDot: {
    color: colors.muted,
    fontSize: 13,
    paddingHorizontal: 7,
  },

  draftActionRow: {
    flexDirection: 'row',
    gap: 9,
  },

  resumeDraftButton: {
    flex: 1,
    backgroundColor: colors.warning,
    borderRadius: 9,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  resumeDraftText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },

  discardDraftButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },

  discardDraftText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '800',
  },

  morningBriefCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 14,
  },

  morningBriefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 13,
  },

  morningBriefIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  morningBriefGreeting: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },

  morningBriefSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 3,
  },

  briefLineList: {
    gap: 10,
  },

  briefLine: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 11,
    backgroundColor: colors.fill,
    padding: 10,
  },

  briefLineIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  briefLineContent: {
    flex: 1,
    minWidth: 0,
  },

  briefLineLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },

  briefLineValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    marginTop: 2,
  },

  homePieListCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CFE7FF',
    padding: 14,
    marginBottom: 14,
  },

  homePieListHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  homePieListIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  homePieListTitle: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  homePieList: {
    gap: 8,
    marginTop: 5,
  },

  homePieListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  homePieListBullet: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 8,
  },

  homePieListText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    flex: 1,
  },

  captureHeroButton: {
    minHeight: 76,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },

  captureHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  captureHeroTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
  },

  captureHeroSubtitle: {
    color: '#EAF4FF',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 3,
  },

  todaySecondaryActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },

  todaySecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CFE7FF',
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
  },

  todaySecondaryText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    flexShrink: 1,
  },

  currentProjectCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 14,
  },

  currentProjectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },

  currentProjectIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  currentProjectEyebrow: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  currentProjectName: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    marginTop: 2,
  },

  projectSignalList: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    gap: 11,
  },

  projectSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  projectSignalLabel: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  projectSignalValue: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'right',
  },

  healthBadge: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },

  healthBadgeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },

  openProjectButton: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primarySoft,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    marginTop: 15,
  },

  openProjectButtonText: {
    color: colors.primary,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },

  recommendationCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 14,
  },

  recommendationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  recommendationIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  recommendationEyebrow: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  recommendationTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
    marginTop: 2,
  },

  recommendationDetail: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: 5,
  },

  recommendationButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    marginTop: 14,
  },

  recommendationButtonText: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },

  workflowCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 16,
  },

  workflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },

  captureIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  workflowEyebrow: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  workflowProject: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '900',
    marginTop: 2,
  },

  workflowMeta: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 5,
  },

  captureUpdateButton: {
    minHeight: 58,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 16,
    marginBottom: 12,
  },

  captureUpdateText: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },

  secondaryActionsPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },

  assistantActionButton: {
    flex: 1,
    minWidth: 210,
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  secondaryActionTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    minWidth: 0,
  },

  secondaryActionDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 2,
    minWidth: 0,
  },

  moreActionsButton: {
    width: 86,
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 9,
  },

  moreActionsText: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    minWidth: 0,
  },

  secondaryActionMenu: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  secondaryMenuAction: {
    flexGrow: 1,
    minWidth: 148,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
  },

  secondaryMenuText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    minWidth: 0,
  },

  rowMain: {
    flex: 1,
  },

  scheduleAttentionCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 16,
  },

  scheduleAttentionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },

  scheduleAttentionIcon: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scheduleAttentionTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  scheduleAttentionMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 3,
  },

  scheduleTaskList: {
    gap: 9,
  },

  scheduleTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  scheduleTaskBullet: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.warning,
  },

  scheduleTaskTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },

  scheduleTaskMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  scheduleEmptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },

  scheduleAttentionButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    marginTop: 13,
  },

  scheduleAttentionButtonText: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
});
