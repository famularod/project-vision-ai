import { Ionicons } from '@expo/vector-icons';
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
import type { ScheduleItem } from '../types';
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

type DashboardUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: unknown[];
  selectedAreaName?: string | null;
};

type HomeDashboardProps = {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: DashboardUpdate[];
  scheduleItems: ScheduleItem[];
  projectStatsByName: Record<string, ProjectStats>;
  unfinishedDraft: DashboardUpdate | null;
  draftSavedAt: string | null;
  referenceDocumentCount: number;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: () => void;
  onUpdateProject: (projectName: string) => void;
  onViewProjects: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
  onAIProjectCoach: () => void;
  onAIExecutiveBrief: () => void;
  onProjectHealthDashboard: () => void;
  onWeeklyExecutiveReport: () => void;
  onExecutiveKPIDashboard: () => void;
  onConstructionTimeline: () => void;
  onMilestoneTracking: () => void;
  onDelayAnalysis: () => void;
  onContractorPerformance: () => void;
  onProjectRiskMatrix: () => void;
  onPortfolioDashboard: () => void;
  onAdmin: () => void;
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

export function HomeDashboard({
  contentStyle,
  projects,
  savedUpdates,
  scheduleItems,
  projectStatsByName,
  unfinishedDraft,
  draftSavedAt,
  referenceDocumentCount,
  onResumeDraft,
  onDiscardDraft,
  onNewUpdate,
  onUpdateProject,
  onViewProjects,
  onReferenceDocuments,
  onSchedule,
  onAIProjectCoach,
  onAIExecutiveBrief,
  onProjectHealthDashboard,
  onWeeklyExecutiveReport,
  onExecutiveKPIDashboard,
  onConstructionTimeline,
  onMilestoneTracking,
  onDelayAnalysis,
  onContractorPerformance,
  onProjectRiskMatrix,
  onPortfolioDashboard,
  onAdmin,
}: HomeDashboardProps) {
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
    project.toLowerCase() === unfinishedDraft.projectName.toLowerCase(),
  );
  const latestActivityProject = savedUpdates
    .map(update => update.projectName)
    .find(projectName =>
      projects.some(project => project.toLowerCase() === projectName.toLowerCase()),
    );
  const currentProject =
    draftProject ||
    latestActivityProject ||
    projects[0] ||
    'No active project';
  const currentProjectStats =
    projectStatsByName[currentProject] || EMPTY_PROJECT_STATS;
  const hasActiveProject = projects.length > 0;
  const scheduleSummary = buildScheduleSummary(scheduleItems);

  return (
    <Screen contentStyle={contentStyle}>
      <AppHeader />

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

      <View style={styles.workflowCard}>
        <View style={styles.workflowHeader}>
          <View style={styles.captureIcon}>
            <Ionicons
              name="camera-outline"
              size={24}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.workflowEyebrow}>
              Current Project
            </Text>

            <Text
              style={styles.workflowProject}
              numberOfLines={2}
            >
              {currentProject}
            </Text>

            <Text style={styles.workflowMeta}>
              {currentProjectStats.updates} updates | {currentProjectStats.openActions} open | {currentProjectStats.overdueActions} overdue
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.captureUpdateButton}
          onPress={() =>
            hasActiveProject
              ? onUpdateProject(currentProject)
              : onNewUpdate()
          }
        >
          <Ionicons
            name="camera-outline"
            size={23}
            color="#FFFFFF"
          />

          <Text style={styles.captureUpdateText}>
            Capture Update
          </Text>
        </TouchableOpacity>

        <View style={styles.dailyActionRow}>
          <TouchableOpacity
            style={styles.dailyActionButton}
            onPress={onWeeklyExecutiveReport}
          >
            <Ionicons
              name="newspaper-outline"
              size={20}
              color={colors.primary}
            />

            <Text style={styles.dailyActionText}>
              Generate Report
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dailyActionButton}
            onPress={onAIProjectCoach}
          >
            <Ionicons
              name="bulb-outline"
              size={20}
              color={colors.primary}
            />

            <Text style={styles.dailyActionText}>
              AI Coach
            </Text>
          </TouchableOpacity>
        </View>
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

  dailyActionRow: {
    flexDirection: 'row',
    gap: 10,
  },

  dailyActionButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
  },

  dailyActionText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
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
