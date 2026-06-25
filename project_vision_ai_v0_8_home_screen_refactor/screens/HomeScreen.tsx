import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen({
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
  styles,
  colors,
  EMPTY_PROJECT_STATS,
  formatSavedTime,
  DashboardMetric,
  QuickActionButton,
  EmptyState,
  ProjectAttentionCard,
  ActivityRow,
}: {
  contentStyle: StyleProp<ViewStyle>;
  projects: string[];
  savedUpdates: any[];
  projectStatsByName: Record<string, any>;
  unfinishedDraft: any | null;
  draftSavedAt: string | null;
  referenceDocumentCount: number;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  onNewUpdate: () => void;
  onUpdateProject: (projectName: string) => void;
  onViewProjects: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
  styles: Record<string, any>;
  colors: Record<string, any>;
  EMPTY_PROJECT_STATS: any;
  formatSavedTime: (value: string | null) => string;
  DashboardMetric: React.ComponentType<any>;
  QuickActionButton: React.ComponentType<any>;
  EmptyState: React.ComponentType<any>;
  ProjectAttentionCard: React.ComponentType<any>;
  ActivityRow: React.ComponentType<any>;
}) {
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

  const recentUpdates = savedUpdates.slice(0, 5);

  return (
    <ScrollView
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>
          Project Photo Update Tool
        </Text>

        <Text style={styles.title}>
          Dashboard
        </Text>

        <Text style={styles.subtitle}>
          What needs attention right now.
        </Text>
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

      <View style={styles.dashboardSummaryCard}>
        <View style={styles.dashboardSummaryHeader}>
          <View>
            <Text style={styles.panelTitle}>
              Executive Summary
            </Text>

            <Text style={styles.bodyText}>
              {projects.length} active project
              {projects.length === 1 ? '' : 's'} under management
            </Text>
          </View>

          <TouchableOpacity
            style={styles.dashboardManageButton}
            onPress={onViewProjects}
          >
            <Text style={styles.dashboardManageText}>
              Manage
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dashboardMetricGrid}>
          <DashboardMetric
            label="Open Issues"
            value={totals.openActions}
            icon="alert-circle-outline"
            danger={totals.openActions > 0}
          />

          <DashboardMetric
            label="Overdue"
            value={totals.overdueActions}
            icon="time-outline"
            danger={totals.overdueActions > 0}
          />

          <DashboardMetric
            label="Due 7 Days"
            value={totals.dueThisWeek}
            icon="calendar-outline"
          />

          <DashboardMetric
            label="Photos"
            value={totals.photos}
            icon="images-outline"
          />

          <DashboardMetric
            label="Updates"
            value={totals.updates}
            icon="document-text-outline"
          />

          <DashboardMetric
            label="Documents"
            value={referenceDocumentCount}
            icon="documents-outline"
          />
        </View>
      </View>

      <Text style={styles.sectionLabel}>
        Quick Actions
      </Text>

      <View style={styles.quickActionGrid}>
        <QuickActionButton
          label="New Update"
          icon="camera-outline"
          onPress={onNewUpdate}
          primary
        />

        <QuickActionButton
          label="Projects"
          icon="search-outline"
          onPress={onViewProjects}
        />

        <QuickActionButton
          label="Documents"
          icon="documents-outline"
          onPress={onReferenceDocuments}
        />

        <QuickActionButton
          label="Schedule"
          icon="calendar-outline"
          onPress={onSchedule}
        />
      </View>

      <Text style={styles.sectionLabel}>
        Projects Needing Attention
      </Text>

      {projectsNeedingAttention.length === 0 ? (
        <EmptyState
          title="No urgent project items"
          text="Open issues, overdue items, and due-this-week actions will appear here."
        />
      ) : (
        projectsNeedingAttention.map(item => (
          <ProjectAttentionCard
            key={item.project}
            project={item.project}
            stats={item.stats}
            onPress={() => onUpdateProject(item.project)}
          />
        ))
      )}

      <Text style={styles.sectionLabel}>
        Recent Activity
      </Text>

      {recentUpdates.length === 0 ? (
        <EmptyState
          title="No updates yet"
          text="Create the first project update to start building project history."
        />
      ) : (
        recentUpdates.map(update => (
          <ActivityRow
            key={update.id}
            update={update}
          />
        ))
      )}
    </ScrollView>
  );
}
