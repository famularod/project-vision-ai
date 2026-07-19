import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import type { DAVEProjectOperationalStatusName } from '../services/DAVEProjectOperationalStatus';
import type { DAVEProjectScheduleHealth } from '../services/dave-project-schedule-rollup';
import type {
  DAVEProjectDailyBriefAttentionItem,
  DAVEProjectDailyBriefItem,
} from '../services/DAVEDailyBrief';
import { colors } from '../theme';

export function DAVEProjectStatusLoadingScreen({
  contentStyle,
  greeting,
  dateLabel,
  onSettings,
}: {
  contentStyle: StyleProp<ViewStyle>;
  greeting: string;
  dateLabel: string;
  onSettings: () => void;
}) {
  return (
    <View style={styles.page}>
      <LinearGradient
        colors={['#E4E9FA', '#EEEBFB', 'rgba(245,245,247,0)']}
        locations={[0, 0.4, 1]}
        style={styles.gradient}
      />
      <ScrollView style={styles.frame} contentContainerStyle={contentStyle}>
        <View style={styles.greetingHeader}>
          <View style={styles.greetingCopy}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.date}>{dateLabel}</Text>
          </View>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            accessibilityHint="Opens app settings"
          >
            <Ionicons name="settings-outline" size={21} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View
          style={styles.loadingPanel}
          accessible
          accessibilityLabel="Restoring project status"
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.loadingTitleRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingTitle}>Restoring project status…</Text>
          </View>
          <Text style={styles.loadingText}>
            Loading projects, schedules, documents, and field updates before showing project health.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

export function DAVEProjectDataLoadingPanel({
  contentStyle,
}: {
  contentStyle: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView style={styles.frame} contentContainerStyle={contentStyle}>
      <View
        style={styles.loadingPanel}
        accessible
        accessibilityLabel="Restoring project data"
        accessibilityState={{ busy: true }}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.loadingTitleRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingTitle}>Restoring project data…</Text>
        </View>
        <Text style={styles.loadingText}>
          Loading the saved project snapshot before showing status or reports.
        </Text>
      </View>
    </ScrollView>
  );
}

export function DAVEProjectTaskOperationalSummary({
  status,
  scheduleStatus,
  percentComplete,
  operationalReason,
  scheduleReason,
  needsVerification,
  verificationSummary,
}: {
  status: DAVEProjectOperationalStatusName;
  scheduleStatus: DAVEProjectScheduleHealth;
  percentComplete: number;
  operationalReason: string;
  scheduleReason: string;
  needsVerification: boolean;
  verificationSummary: string | null;
}) {
  const statusColor = status === 'Blocked'
    ? colors.danger
    : status === 'At Risk'
      ? colors.warning
      : status === 'Needs Setup'
        ? colors.mutedText
        : colors.success;
  const showScheduleReason = scheduleReason.trim() !== operationalReason.trim();

  return (
    <>
      <View style={styles.taskHeader}>
        <View style={styles.taskHeaderCopy}>
          <Text style={styles.taskEyebrow}>PROJECT CONTROL</Text>
          <Text style={styles.taskTitle}>Tasks and Schedule</Text>
        </View>
        <View style={[styles.healthPill, { backgroundColor: `${statusColor}1A` }]}>
          <Text style={[styles.healthText, { color: statusColor }]}>{status}</Text>
        </View>
      </View>
      <Text style={styles.progressValue}>{percentComplete}% complete</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percentComplete}%` }]} />
      </View>
      <Text style={styles.operationalReason}>{operationalReason}</Text>
      <Text style={styles.scheduleStatus}>Schedule: {scheduleStatus}</Text>
      {showScheduleReason ? <Text style={styles.reason}>{scheduleReason}</Text> : null}
      {needsVerification ? (
        <View style={styles.verificationNotice}>
          <Ionicons name="warning-outline" size={18} color={colors.warning} />
          <View style={styles.verificationCopy}>
            <Text style={styles.verificationTitle}>Needs Verification</Text>
            <Text style={styles.reason}>{verificationSummary}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

export function DAVEProjectNeedsVerificationLabel() {
  return <Text style={styles.verificationLabel}>Needs Verification</Text>;
}

export function DailyBriefSection({
  title,
  items,
  emptyText,
  onOpen,
}: {
  title: string;
  items: Array<DAVEProjectDailyBriefItem | DAVEProjectDailyBriefAttentionItem>;
  emptyText: string;
  onOpen: (item: DAVEProjectDailyBriefItem | DAVEProjectDailyBriefAttentionItem) => void;
}) {
  return (
    <View>
      <Text style={styles.sectionLabel}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.detailText}>{emptyText}</Text>
      ) : items.map(item => (
        <TouchableOpacity
          key={item.id}
          style={styles.briefRow}
          onPress={() => onOpen(item)}
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${item.text}`}
        >
          <View style={styles.verificationCopy}>
            <Text style={styles.detailText}>• {item.text}</Text>
            {'whyItMatters' in item ? (
              <Text style={styles.briefSubtext}>{item.whyItMatters} {item.actionText}</Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.mutedText} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function WorkspaceCardSkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading project priority">
      <View style={[styles.skeletonLine, { width: '72%' }]} />
      <View style={[styles.skeletonLine, { width: '94%' }]} />
      <View style={[styles.skeletonLine, { width: '58%' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  gradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },
  frame: { flex: 1 },
  greetingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  greetingCopy: { flex: 1 },
  greeting: { color: colors.text, fontSize: 26, fontWeight: '700' },
  date: { color: colors.mutedText, fontSize: 13, marginTop: 2 },
  settingsButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(32,83,158,0.18)',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 13,
  },
  loadingPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 16,
  },
  loadingTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 10 },
  loadingTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  loadingText: { color: colors.mutedText, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskHeader: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  taskHeaderCopy: { flex: 1 },
  taskEyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  taskTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  healthPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  healthText: { fontSize: 12, fontWeight: '900' },
  progressValue: { color: colors.text, fontSize: 25, fontWeight: '900' },
  progressTrack: { backgroundColor: colors.border, borderRadius: 999, height: 8, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.primary, borderRadius: 999, height: '100%' },
  scheduleStatus: { color: colors.text, fontSize: 14, fontWeight: '800' },
  operationalReason: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  reason: { color: colors.mutedText, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  verificationNotice: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  verificationCopy: { flex: 1 },
  verificationTitle: { color: colors.warning, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  verificationLabel: { color: colors.warning, fontSize: 12, fontWeight: '800', marginBottom: 5 },
  sectionLabel: { color: colors.text, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  detailText: { color: colors.mutedText, fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 7 },
  briefSubtext: { color: colors.mutedText, fontSize: 13, fontWeight: '500', marginTop: 4 },
  briefRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 9,
    minHeight: 60,
    padding: 12,
  },
  skeleton: { gap: 9, paddingVertical: 8 },
  skeletonLine: { backgroundColor: colors.surfaceMuted, borderRadius: 6, height: 12 },
});
