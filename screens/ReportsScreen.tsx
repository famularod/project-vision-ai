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
import {
  colors,
  spacing,
  typography,
} from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

type ReportCardProps = {
  title: string;
  description: string;
  icon: IconName;
  onPress?: () => void;
};

export function ReportsScreen({
  contentStyle,
  onGenerateExecutiveReport,
  onWeeklyExecutiveReport,
  onProjectHealthReport,
  onCriticalPathReport,
  onMilestoneReport,
  onSavedUpdates,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  onGenerateExecutiveReport: () => void;
  onWeeklyExecutiveReport: () => void;
  onProjectHealthReport: () => void;
  onCriticalPathReport: () => void;
  onMilestoneReport: () => void;
  onSavedUpdates: () => void;
}) {
  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Reports"
        subtitle="Generate executive views, review project health, and open saved update history."
      />

      <View style={styles.grid}>
        <ReportCard
          title="Generate Executive Report"
          description="Create an AI-assisted executive brief from current project data."
          icon="sparkles-outline"
          onPress={onGenerateExecutiveReport}
        />

        <ReportCard
          title="Weekly Executive Report"
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
          title="Saved Updates / History"
          description="Open saved project updates, previous messages, and update history."
          icon="time-outline"
          onPress={onSavedUpdates}
        />
      </View>
    </Screen>
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
  grid: {
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
