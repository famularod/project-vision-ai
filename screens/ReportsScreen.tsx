import { Ionicons } from '@expo/vector-icons';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { PIEPanel } from '../components/PIEPanel';
import {
  colors,
  spacing,
  typography,
} from '../theme';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import type { ProjectSyncFreshnessMetadata } from '../services/ProjectIntelligenceEngine';
import { buildRuntime } from '../services/PIERuntime';

type IconName = keyof typeof Ionicons.glyphMap;

type ReportCardProps = {
  title: string;
  description: string;
  icon: IconName;
  onPress?: () => void;
};

export function ReportsScreen({
  contentStyle,
  projectName,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas,
  contacts,
  referenceDocuments,
  syncMetadata,
  onGenerateExecutiveReport,
  onWeeklyExecutiveReport,
  onProjectHealthReport,
  onCriticalPathReport,
  onMilestoneReport,
  onSavedUpdates,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projectName: string;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate?: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  onGenerateExecutiveReport: () => void;
  onWeeklyExecutiveReport: () => void;
  onProjectHealthReport: () => void;
  onCriticalPathReport: () => void;
  onMilestoneReport: () => void;
  onSavedUpdates: () => void;
}) {
  const runtime = buildRuntime({
    projectName,
    updates,
    scheduleItems,
    currentUpdate,
    projectAreas,
    contacts,
    referenceDocuments,
    syncMetadata,
    surface: 'reports',
  });
  const openDecisions = runtime.priorityQueue.approvalRequired.length;
  const openQuestions = runtime.reasoning.questions.length;
  const communicationReady =
    runtime.intelligence.communicationReadiness.level === 'ready';

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Review"
        subtitle="Review, approve, and communicate what PIE has prepared."
      />

      <PIEPanel
        projectName={projectName}
        updates={updates}
        scheduleItems={scheduleItems}
        currentUpdate={currentUpdate}
        projectAreas={projectAreas}
        contacts={contacts}
        referenceDocuments={referenceDocuments}
        syncMetadata={syncMetadata}
        title="PIE has prepared"
        subtitle="Executive Report, Customer Update, and Project Summary are ready for review."
      />

      <ScreenCard style={styles.preparedCard}>
        <Text style={styles.preparedTitle}>
          PIE Prepared Items
        </Text>

        <View style={styles.preparedList}>
          <PreparedReportItem title="Executive Report" />
          <PreparedReportItem title="Customer Update" />
          <PreparedReportItem title="Project Summary" />
          <PreparedReportItem title={`${openDecisions} open decision${openDecisions === 1 ? '' : 's'}`} />
          <PreparedReportItem title={`${openQuestions} question${openQuestions === 1 ? '' : 's'} needing answers`} />
          <PreparedReportItem title={communicationReady ? 'Communication readiness: ready for review' : 'Communication readiness: needs more evidence'} />
        </View>
      </ScreenCard>

      <TouchableOpacity
        style={styles.primaryReviewButton}
        onPress={onGenerateExecutiveReport}
        accessibilityRole="button"
        accessibilityLabel="Review Executive Brief"
      >
        <View style={styles.primaryReviewIcon}>
          <Ionicons
            name="sparkles-outline"
            size={24}
            color="#FFFFFF"
          />
        </View>

        <View style={styles.primaryReviewTextGroup}>
          <Text style={styles.primaryReviewTitle}>
            Review Executive Brief
          </Text>

          <Text
            style={styles.primaryReviewSubtitle}
            numberOfLines={2}
          >
            Verify PIE's priority, evidence, decisions, and approval-required items.
          </Text>
        </View>

        <Ionicons
          name="chevron-forward-outline"
          size={22}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      <View style={styles.reviewActionStack}>
        <ReportCard
          title="Weekly Executive Review"
          description="Summarize weekly progress, risks, schedule movement, and action items."
          icon="newspaper-outline"
          onPress={onWeeklyExecutiveReport}
        />

        <ReportCard
          title="Project Health Report"
          description="Review risk, overdue work, stale updates, safety items, and status signals."
          icon="pulse-outline"
          onPress={onProjectHealthReport}
        />

        <ReportCard
          title="Photo Log Report"
          description="Coming Soon: exportable photo logs grouped by project, area, and date."
          icon="images-outline"
        />

        <ReportCard
          title="Open Issues Report"
          description="Coming Soon: unresolved action items, safety concerns, and blockers."
          icon="alert-circle-outline"
        />

        <ReportCard
          title="Critical Path Report"
          description="Analyze schedule drivers, blocked work, dependencies, and float risk."
          icon="git-branch-outline"
          onPress={onCriticalPathReport}
        />

        <ReportCard
          title="Milestone Report"
          description="Track milestone progress, dates, slippage, and upcoming checkpoints."
          icon="flag-outline"
          onPress={onMilestoneReport}
        />

        <ReportCard
          title="Saved History"
          description="Open saved project updates, previous messages, and update history."
          icon="time-outline"
          onPress={onSavedUpdates}
        />
      </View>
    </Screen>
  );
}

function PreparedReportItem({ title }: { title: string }) {
  return (
    <View style={styles.preparedItem}>
      <Ionicons
        name="checkmark-circle-outline"
        size={18}
        color={colors.success}
      />

      <Text
        style={styles.preparedItemText}
        numberOfLines={1}
      >
        {title}
      </Text>
    </View>
  );
}

function ReportCard({
  title,
  description,
  icon,
  onPress,
}: ReportCardProps) {
  const isPlaceholder = !onPress;
  const content = (
    <ScreenCard
      style={[
        styles.card,
        isPlaceholder && styles.placeholderCard,
      ]}
    >
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconBadge,
            isPlaceholder && styles.placeholderIconBadge,
          ]}
        >
          <Ionicons
            name={icon}
            size={24}
            color={isPlaceholder ? colors.mutedText : colors.primary}
          />
        </View>

        <View style={styles.cardTextGroup}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle}>
              {title}
            </Text>

            {isPlaceholder ? (
              <View style={styles.comingSoonPill}>
                <Text style={styles.comingSoonText}>
                  Coming Soon
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.cardDescription}>
            {description}
          </Text>
        </View>

        {!isPlaceholder ? (
          <Ionicons
            name="chevron-forward-outline"
            size={22}
            color={colors.tertiaryText}
          />
        ) : null}
      </View>
    </ScreenCard>
  );

  if (isPlaceholder) {
    return (
      <View style={styles.cardShell}>
        {content}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.cardShell}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  preparedCard: {
    gap: spacing.sm,
  },

  preparedTitle: {
    ...typography.h3,
  },

  preparedList: {
    gap: spacing.xs,
  },

  preparedItem: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  preparedItemText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    flex: 1,
  },

  primaryReviewButton: {
    minHeight: 76,
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  primaryReviewIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryReviewTextGroup: {
    flex: 1,
    minWidth: 0,
  },

  primaryReviewTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },

  primaryReviewSubtitle: {
    color: '#EAF4FF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: spacing.xxs,
  },

  reviewActionStack: {
    gap: spacing.sm,
  },

  cardShell: {
    width: '100%',
  },

  card: {
    minHeight: 92,
    marginBottom: 0,
  },

  placeholderCard: {
    backgroundColor: colors.surfaceMuted,
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },

  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  placeholderIconBadge: {
    backgroundColor: colors.border,
  },

  cardTextGroup: {
    flex: 1,
    gap: spacing.xs,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  cardTitle: {
    ...typography.h3,
    fontSize: 17,
    lineHeight: 23,
    flexShrink: 1,
  },

  cardDescription: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },

  comingSoonPill: {
    borderRadius: 999,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },

  comingSoonText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },
});
