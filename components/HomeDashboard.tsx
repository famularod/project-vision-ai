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
import { usePIELiveAuthority } from '../providers/PIELiveAuthorityProvider';
import { buildPIEAttentionState } from '../services/PIEAttentionEngine';
import {
  buildPIEExperience,
  type PIEExperienceAction,
  type PIEExperienceOutput,
} from '../services/PIEExperienceEngine';
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
  onMoreTools: () => void;
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

function readinessLabel(level: 'low' | 'medium' | 'high') {
  if (level === 'high') return 'Ready';
  if (level === 'medium') return 'Needs Verification';

  return 'Uncertain';
}

function missionStatusLabel(status: string) {
  if (status === 'blocked') return 'Blocked';
  if (status === 'ready-for-approval' || status === 'complete') return 'Ready';
  if (status === 'active' || status === 'monitoring') return 'Needs Verification';

  return 'Uncertain';
}

function missionActionLabel(action: PIEExperienceAction) {
  if (action === 'capture') return 'Begin Capture';
  if (action === 'review') return 'Review Draft';
  if (action === 'approve') return 'Approve';
  if (action === 'communicate') return 'Communicate';
  if (action === 'correct') return 'Correct Context';
  if (action === 'wait') return 'Monitor';

  return 'Confirm';
}

function buildTodayScheduleSummary({
  scheduleItems,
  scheduleSummary,
  runtimeSummary,
}: {
  scheduleItems: ScheduleItem[];
  scheduleSummary: ScheduleSummary;
  runtimeSummary: string;
}) {
  if (scheduleItems.length === 0) return runtimeSummary;

  const loadedCount =
    scheduleSummary.totalItems > 0
      ? scheduleSummary.totalItems
      : scheduleItems.length;

  if (scheduleSummary.totalItems === 0) {
    return `Schedule loaded: ${loadedCount} activities. PIE is preparing schedule insights.`;
  }

  return `Schedule loaded: ${loadedCount} activities. ${scheduleSummary.upcoming7Count} upcoming in 7 days, ${scheduleSummary.upcoming14Count} upcoming in 14 days, ${scheduleSummary.overdueCount} overdue, ${scheduleSummary.criticalPathItems.length} critical.`;
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
  onMoreTools,
}: HomeDashboardProps) {
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const liveAuthority = usePIELiveAuthority();
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
  const runtime = liveAuthority.runtime;
  if (!runtime) {
    return (
      <Screen contentStyle={contentStyle}>
        <AppHeader />

        <View style={styles.morningBriefCard}>
          <Text style={styles.morningBriefGreeting}>
            {getGreeting()}, David.
          </Text>

          <Text style={styles.morningBriefSubtitle}>
            {liveAuthority.policy.userMessage}
          </Text>
        </View>
      </Screen>
    );
  }
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
  const currentMission = runtime.currentMission;
  const scheduleBriefSummary = buildTodayScheduleSummary({
    scheduleItems,
    scheduleSummary,
    runtimeSummary: runtime.scheduleIntelligence.executiveSummary,
  });
  const missionBlockers =
    runtime.missionBlockers.length > 0
      ? runtime.missionBlockers
          .slice(0, 2)
          .map(blocker => blocker.title)
          .join(' | ')
      : 'No mission blockers from current evidence';
  const criticalItemsSummary = [
    scheduleSummary.criticalPathItems.length > 0
      ? `${scheduleSummary.criticalPathItems.length} critical schedule item${scheduleSummary.criticalPathItems.length === 1 ? '' : 's'}.`
      : null,
    scheduleSummary.overdueCount > 0
      ? `${scheduleSummary.overdueCount} overdue.`
      : null,
    projectsNeedingAttention.length > 0
      ? `${projectsNeedingAttention.length} project${projectsNeedingAttention.length === 1 ? '' : 's'} need attention.`
      : null,
  ].filter(Boolean).join(' ') || 'No critical item from current evidence.';
  const reportReadySummary =
    runtime.response.reportNeedsReview
      ? 'Report needs review before communication.'
      : runtime.response.reportReadiness === 'high'
        ? 'Report is ready for review.'
        : 'Report is not ready yet.';
  const evidenceNeededSummary =
    runtime.recommendedEvidence[0] ||
    runtime.response.whatPIENeedsFromYou ||
    missionBlockers;
  const readinessSummary = [
    `Trust: ${readinessLabel(runtime.trustScore.level)}`,
    `Understanding: ${readinessLabel(runtime.understandingScore.level)}`,
    `Preparedness: ${readinessLabel(runtime.preparednessScore.level)}`,
  ];
  const missionReadinessSummary =
    `${missionStatusLabel(runtime.missionProgress.status)} | ${readinessSummary.join(' | ')}`;
  const todayPriorities = [
    topPriority,
    runtime.scheduleIntelligence.recommendedWalkAreas[0]
      ? `Walk ${runtime.scheduleIntelligence.recommendedWalkAreas[0]} based on imported schedule.`
      : null,
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
  const attentionState = liveAuthority.attention || buildPIEAttentionState({
    runtime,
  });
  const experienceOutput = liveAuthority.experience || buildPIEExperience({
    runtime,
    attentionState,
    context: {
      surface: 'today',
      hasRecentGreeting: true,
      locationEvidenceNeeded: runtime.recommendedWalkAreas.length > 0,
    },
  });
  const missionSupportingItems = [
    liveAuthority.degraded ? liveAuthority.policy.userMessage : null,
    experienceOutput.reason,
    runtime.recommendedEvidence[0],
    scheduleSummary.upcoming7Count > 0
      ? `${scheduleSummary.upcoming7Count} schedule item${scheduleSummary.upcoming7Count === 1 ? '' : 's'} due within 7 days.`
      : null,
  ].filter((item): item is string => Boolean(item));
  const photoProgressCard =
    liveAuthority.core?.longitudinalPhotoIntelligence.conciseProgressCard;
  const photoProgressEvent =
    liveAuthority.core?.photoProgressEvents[0] || null;
  const handleExperienceAction = (action: PIEExperienceAction) => {
    if (action === 'capture') {
      startCapture();
      return;
    }

    if (
      action === 'approve' ||
      action === 'communicate' ||
      action === 'review'
    ) {
      onAIExecutiveBrief();
      return;
    }

    if (action === 'correct') {
      onViewProjects();
      return;
    }

    if (action === 'wait') {
      onProjectAssistant();
      return;
    }

    if (activeProjectName) {
      onOpenProject(activeProjectName);
      return;
    }

    onViewProjects();
  };
  return (
    <Screen contentStyle={contentStyle}>
      <AppHeader />

      <PIEMissionCard
        experience={experienceOutput}
        greeting={`${getGreeting()}, David.`}
        missionTitle={currentMission.title || recommendedAction.title}
        missionPurpose={currentMission.purpose || experienceOutput.primaryMessage}
        supportingItems={missionSupportingItems}
        onPrimaryAction={() =>
          handleExperienceAction(experienceOutput.primaryAction)
        }
        onSecondaryAction={
          experienceOutput.secondaryAction
            ? () => handleExperienceAction(experienceOutput.secondaryAction!)
            : undefined
        }
      />

      {photoProgressCard?.visible ? (
        <View style={styles.morningBriefCard}>
          <View style={styles.morningBriefHeader}>
            <View style={styles.morningBriefIcon}>
              <Ionicons
                name="images-outline"
                size={24}
                color={colors.primary}
              />
            </View>

            <View style={styles.rowMain}>
              <Text style={styles.morningBriefGreeting}>
                {photoProgressCard.title}
              </Text>

              <Text style={styles.morningBriefSubtitle}>
                {photoProgressCard.summary}
              </Text>
            </View>
          </View>

          {photoProgressEvent ? (
            <View style={styles.briefLineList}>
              <Text style={styles.briefLine}>
                Observation: {photoProgressEvent.observation}
              </Text>

              <Text style={styles.briefLine}>
                Verification: {photoProgressEvent.reviewStatus.replace(/_/g, ' ')}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.scheduleAttentionButton}
            onPress={() => activeProjectName ? onOpenProject(activeProjectName) : onViewProjects()}
            activeOpacity={0.85}
          >
            <Ionicons
              name="arrow-forward-outline"
              size={18}
              color={colors.primary}
            />

            <Text style={styles.scheduleAttentionButtonText}>
              {photoProgressCard.primaryAction}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.morningBriefCard}>
        <View style={styles.morningBriefHeader}>
          <View style={styles.morningBriefIcon}>
            <Ionicons
              name="list-outline"
              size={24}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.morningBriefGreeting}>
              Supporting Summary
            </Text>

            <Text style={styles.morningBriefSubtitle}>
              Small signals behind today's mission.
            </Text>
          </View>
        </View>

        <View style={styles.briefLineList}>
          <BriefLine
            icon="alert-circle-outline"
            label="Critical Items"
            value={criticalItemsSummary}
            onPress={
              scheduleSummary.criticalPathItems.length > 0 ||
              scheduleSummary.overdueCount > 0
                ? onSchedule
                : onViewProjects
            }
            detailItems={[
              ...scheduleSummary.criticalPathItems.slice(0, 3).map(task =>
                `${task.title} | ${task.dueLabel} | ${task.item.owner || 'Owner not set'} | Schedule impact | Review schedule evidence.`,
              ),
              ...projectsNeedingAttention.slice(0, 3).map(item =>
                `${item.project} | Needs attention | ${item.stats.openActions} open action${item.stats.openActions === 1 ? '' : 's'} | Open project.`,
              ),
            ]}
          />

          <BriefLine
            icon="newspaper-outline"
            label="Report Ready"
            value={reportReadySummary}
            onPress={onAIExecutiveBrief}
            detailItems={[
              runtime.response.reportNeedsReview
                ? 'Report needs review | Correct uncertain items | Approve before sharing.'
                : 'Report ready | Review draft | Approve before sharing.',
            ]}
          />

          <BriefLine
            icon="calendar-outline"
            label="Schedule Loaded"
            value={scheduleBriefSummary}
            onPress={onSchedule}
            detailItems={[
              ...scheduleSummary.overdueTasks.slice(0, 3).map(task =>
                `${task.title} | ${task.dueLabel} | ${task.item.owner || 'Owner not set'} | Overdue schedule item | Review schedule.`,
              ),
              ...scheduleSummary.upcomingTasks.slice(0, 3).map(task =>
                `${task.title} | ${task.dueLabel} | ${task.item.owner || 'Owner not set'} | Upcoming work | Capture evidence if needed.`,
              ),
            ]}
          />

          <BriefLine
            icon="hand-left-outline"
            label="Evidence Needed"
            value={evidenceNeededSummary}
            onPress={startCapture}
            detailItems={[
              runtime.recommendedEvidence[0] || 'Capture one current photo or note for the active project.',
              runtime.response.whatPIENeedsFromYou || 'PIE will infer project, area, evidence type, and related schedule item where possible.',
            ]}
          />

          <BriefLine
            icon="shield-checkmark-outline"
            label="Readiness"
            value={missionReadinessSummary}
            onPress={onProjectAssistant}
            detailItems={[
              `Project status: ${projectHealth.label} - ${projectHealth.detail}.`,
              `Mission status: ${missionStatusLabel(runtime.missionProgress.status)}.`,
              'Open details to see why PIE recommends the next action.',
            ]}
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
              onPress={onMoreTools}
            >
              <Ionicons
                name="ellipsis-horizontal-circle-outline"
                size={18}
                color={colors.primary}
              />

              <Text
                style={styles.secondaryMenuText}
                numberOfLines={1}
              >
                More Tools
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

function PIEMissionCard({
  experience,
  greeting,
  missionTitle,
  missionPurpose,
  supportingItems,
  onPrimaryAction,
  onSecondaryAction,
}: {
  experience: PIEExperienceOutput;
  greeting: string;
  missionTitle: string;
  missionPurpose: string;
  supportingItems: string[];
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
}) {
  const nextStepState = experience.nextState;

  return (
    <View style={styles.missionCard}>
      <View style={styles.missionHeader}>
        <View style={styles.missionIcon}>
          <Ionicons
            name="sparkles-outline"
            size={22}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.missionGreeting}>
            {greeting}
          </Text>

          <Text style={styles.missionSubtitle}>
            What should I do now?
          </Text>
        </View>
      </View>

      <Text style={styles.missionLabel}>
        Today's mission
      </Text>

      <Text style={styles.missionTitle}>
        {missionTitle}
      </Text>

      <Text style={styles.missionPurpose}>
        {missionPurpose || experience.primaryMessage}
      </Text>

      <View style={styles.missionWhyBlock}>
        <Text style={styles.missionWhyTitle}>
          Why
        </Text>

        {[experience.reason, ...supportingItems]
          .filter((item, index, items) => item.trim() && items.indexOf(item) === index)
          .slice(0, 3)
          .map((item, index) => (
            <View
              key={`${item}-${index}`}
              style={styles.missionWhyRow}
            >
              <View style={styles.missionWhyDot} />

              <Text style={styles.missionWhyText}>
                {item}
              </Text>
            </View>
          ))}
      </View>

      <TouchableOpacity
        style={styles.missionPrimaryButton}
        onPress={onPrimaryAction}
        accessibilityRole="button"
        accessibilityLabel={missionActionLabel(experience.primaryAction)}
        accessibilityHint={`Next: ${nextStepState.replace('_', ' ')}`}
      >
        <Text style={styles.missionPrimaryText}>
          {missionActionLabel(experience.primaryAction)}
        </Text>

        <Ionicons
          name="arrow-forward-outline"
          size={18}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      {experience.secondaryAction && onSecondaryAction ? (
        <TouchableOpacity
          style={styles.missionSecondaryButton}
          onPress={onSecondaryAction}
          accessibilityRole="button"
          accessibilityLabel={missionActionLabel(experience.secondaryAction)}
        >
          <Text style={styles.missionSecondaryText}>
            {missionActionLabel(experience.secondaryAction)}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function BriefLine({
  icon,
  label,
  value,
  onPress,
  detailItems = [],
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  detailItems?: string[];
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <View style={styles.briefLineMain}>
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

        <Ionicons
          name={open ? 'chevron-up-outline' : 'chevron-down-outline'}
          size={18}
          color={colors.muted}
        />
      </View>

      {open && detailItems.length > 0 ? (
        <View style={styles.briefDetailList}>
          {detailItems.slice(0, 4).map(item => (
            <Text
              key={item}
              style={styles.briefDetailText}
            >
              {item}
            </Text>
          ))}

          {onPress ? (
            <TouchableOpacity
              style={styles.briefDetailButton}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={`Open ${label} details`}
            >
              <Text style={styles.briefDetailButtonText}>
                Open Details
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <TouchableOpacity
      style={styles.briefLine}
      onPress={() => setOpen(value => !value)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint="Shows the items behind this summary"
    >
      {content}
    </TouchableOpacity>
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
  missionCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },

  missionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },

  missionIcon: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  missionGreeting: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },

  missionSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 3,
  },

  missionLabel: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  missionTitle: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    marginBottom: 7,
  },

  missionPurpose: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    marginBottom: 15,
  },

  missionWhyBlock: {
    borderRadius: 12,
    backgroundColor: colors.fill,
    padding: 12,
    gap: 8,
    marginBottom: 15,
  },

  missionWhyTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  missionWhyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },

  missionWhyDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 7,
  },

  missionWhyText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    flex: 1,
  },

  missionPrimaryButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },

  missionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
  },

  missionSecondaryButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 8,
  },

  missionSecondaryText: {
    color: colors.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },

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
    borderRadius: 11,
    backgroundColor: colors.fill,
    padding: 10,
  },

  briefLineMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
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

  briefDetailList: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 10,
    paddingTop: 10,
    gap: 8,
  },

  briefDetailText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  briefDetailButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
  },

  briefDetailButtonText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
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
