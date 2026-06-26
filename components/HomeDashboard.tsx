import { Ionicons } from '@expo/vector-icons';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from './AppHeader';
import { AttentionCard } from './AttentionCard';
import { ExecutiveSummary } from './ExecutiveSummary';
import { QuickActions } from './QuickActions';
import { RecentActivity } from './RecentActivity';

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
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  danger: '#FF3B30',
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
}: HomeDashboardProps) {
  const totals = projects.reduce(
    (summary, project) => {
      const stats = projectStatsByName[project] || EMPTY_PROJECT_STATS;

      summary.updates += stats.updates;
      summary.photos += stats.photos;
      summary.openActions += stats.openActions;
      summary.overdueActions += stats.overdueActions;
      summary.dueThisWeek += stats.dueThisWeek;

      return summary;
    },
    {
      updates: 0,
      photos: 0,
      openActions: 0,
      overdueActions: 0,
      dueThisWeek: 0,
    },
  );

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

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
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

      <ExecutiveSummary
        projects={projects}
        totals={totals}
        referenceDocumentCount={referenceDocumentCount}
        onViewProjects={onViewProjects}
      />

      <QuickActions
        onNewUpdate={onNewUpdate}
        onViewProjects={onViewProjects}
        onReferenceDocuments={onReferenceDocuments}
        onSchedule={onSchedule}
        onAIProjectCoach={onAIProjectCoach}
        onAIExecutiveBrief={onAIExecutiveBrief}
        onProjectHealthDashboard={onProjectHealthDashboard}
        onWeeklyExecutiveReport={onWeeklyExecutiveReport}
      />

      <AttentionCard
        projectsNeedingAttention={projectsNeedingAttention}
        onUpdateProject={onUpdateProject}
      />

      <RecentActivity updates={savedUpdates} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
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

  rowMain: {
    flex: 1,
  },
});
