import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReferenceDocument } from '../../types';
import {
  buildECOSDocumentOnboardingSummary,
  type ECOSCustomerDocumentStatus,
} from '../../services/ECOSDocumentOnboarding';
import { colors, spacing } from '../../theme';
import { desktopSurfaces } from './desktop-surface-palette';

export type DesktopDocumentPreparationProgress = Readonly<{
  running: boolean;
  total: number;
  processed: number;
  failed: number;
  currentDocumentName: string | null;
  currentDocumentProgress: number;
}>;

export function DesktopDocumentOnboarding({
  documents,
  uploadOpen,
  preparationPendingCount,
  progress,
  disabled = false,
  onAddDocuments,
  onCloseAddDocuments,
  onReviewExceptions,
  onContinuePreparation,
}: {
  documents: readonly ReferenceDocument[];
  uploadOpen: boolean;
  preparationPendingCount: number;
  progress: DesktopDocumentPreparationProgress | null;
  disabled?: boolean;
  onAddDocuments: () => void;
  onCloseAddDocuments: () => void;
  onReviewExceptions: () => void;
  onContinuePreparation: () => void;
}) {
  const summary = buildECOSDocumentOnboardingSummary(documents);
  const attentionCount = summary.reviewCount + summary.reconnectCount;
  const showContinue = !progress?.running && preparationPendingCount > 0;

  return (
    <View style={styles.card} testID="desktop-document-onboarding">
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>Prepare project documents</Text>
          <Text style={styles.headline}>{summary.headline}</Text>
          <Text style={styles.detail}>{summary.detail}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, disabled && styles.disabled]}
            onPress={onAddDocuments}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Add Project Documents"
          >
            <Ionicons name="cloud-upload-outline" size={20} color={desktopSurfaces.onAccent} />
            <Text style={styles.primaryButtonText}>Add Project Documents</Text>
          </Pressable>
          {uploadOpen ? (
            <Pressable
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
              onPress={onCloseAddDocuments}
              accessibilityRole="button"
              accessibilityLabel="Close document form"
            >
              <Text style={styles.textButtonLabel}>Close document form</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {summary.statusCounts.length > 0 ? (
        <View style={styles.statusList} accessibilityLabel="Project document preparation statuses">
          {summary.statusCounts.map(item => (
            <View key={item.status} style={[styles.statusItem, statusStyle(item.status)]}>
              <Text style={styles.statusCount}>{item.count}</Text>
              <View style={styles.statusCopy}>
                <Text style={styles.statusLabel}>{item.status}</Text>
                <Text style={styles.statusMessage}>{item.message}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {progress ? (
        <View style={styles.progressCard} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {progress.running ? (
            <ActivityIndicator color={desktopSurfaces.accent} />
          ) : (
            <Ionicons
              name={progress.failed > 0 ? 'time-outline' : 'checkmark-circle-outline'}
              size={21}
              color={progress.failed > 0 ? colors.warning : colors.success}
            />
          )}
          <View style={styles.statusCopy}>
            <Text style={styles.progressTitle}>{preparationProgressTitle(progress)}</Text>
            <Text style={styles.statusMessage}>{preparationProgressDetail(progress)}</Text>
          </View>
        </View>
      ) : null}

      {attentionCount > 0 || showContinue ? (
        <View style={styles.secondaryActions}>
          {attentionCount > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={onReviewExceptions}
              accessibilityRole="button"
              accessibilityLabel={`Review ${attentionCount} document item${attentionCount === 1 ? '' : 's'}`}
            >
              <Ionicons name="alert-circle-outline" size={19} color={desktopSurfaces.accent} />
              <Text style={styles.secondaryButtonText}>Review {attentionCount} item{attentionCount === 1 ? '' : 's'}</Text>
            </Pressable>
          ) : null}
          {showContinue ? (
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, disabled && styles.disabled]}
              onPress={onContinuePreparation}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Continue preparing ${preparationPendingCount} project document${preparationPendingCount === 1 ? '' : 's'}`}
            >
              <Ionicons name="refresh-circle-outline" size={19} color={desktopSurfaces.accent} />
              <Text style={styles.secondaryButtonText}>Continue preparation</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function preparationProgressTitle(progress: DesktopDocumentPreparationProgress) {
  if (progress.running) return 'Preparing project documents';
  if (progress.failed > 0) return 'Some documents will continue automatically';
  return 'Document preparation complete';
}

function preparationProgressDetail(progress: DesktopDocumentPreparationProgress) {
  if (progress.running) {
    const position = Math.min(progress.processed + 1, progress.total);
    const percent = Math.max(0, Math.min(100, Math.round(progress.currentDocumentProgress * 100)));
    return progress.currentDocumentName
      ? `${position} of ${progress.total}: ${progress.currentDocumentName} · ${percent}%`
      : `${progress.processed} of ${progress.total} documents prepared. You can leave this page.`;
  }
  if (progress.failed > 0) {
    return 'Your files are safe. Vitruvius saved completed work and will retry unfinished preparation.';
  }
  return `${progress.processed} project document${progress.processed === 1 ? '' : 's'} prepared.`;
}

function statusStyle(status: ECOSCustomerDocumentStatus) {
  if (status === 'Ready for ECOS' || status === 'Prepared') return styles.statusReady;
  if (
    status === 'Needs Review' ||
    status === 'Reconnect Files' ||
    status === 'Prepared with limitations' ||
    status === 'Ready with limitations'
  ) return styles.statusReview;
  if (status === 'Temporarily Unavailable') return styles.statusUnavailable;
  return styles.statusPreparing;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: desktopSurfaces.borderStrong,
    borderRadius: 16,
    backgroundColor: desktopSurfaces.cardBlue,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  headingCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 480, gap: spacing.xs },
  title: { color: desktopSurfaces.text, fontSize: 20, fontWeight: '900' },
  headline: { color: desktopSurfaces.text, fontSize: 15, fontWeight: '800' },
  detail: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20 },
  actions: { alignItems: 'flex-end', gap: spacing.xs },
  primaryButton: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: desktopSurfaces.accent,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: { color: desktopSurfaces.onAccent, fontSize: 15, fontWeight: '900' },
  textButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm },
  textButtonLabel: { color: desktopSurfaces.accent, fontSize: 13, fontWeight: '800' },
  statusList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusItem: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 220,
    minWidth: 210,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  statusPreparing: { borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card },
  statusReady: { borderColor: colors.success, backgroundColor: colors.successSoft },
  statusReview: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  statusUnavailable: { borderColor: colors.border, backgroundColor: desktopSurfaces.card },
  statusCount: { color: desktopSurfaces.text, fontSize: 22, fontWeight: '900', minWidth: 28 },
  statusCopy: { flexGrow: 1, flexShrink: 1, gap: 2 },
  statusLabel: { color: desktopSurfaces.text, fontSize: 14, fontWeight: '900' },
  statusMessage: { color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 17 },
  progressCard: {
    borderWidth: 1,
    borderColor: desktopSurfaces.borderStrong,
    borderRadius: 12,
    backgroundColor: desktopSurfaces.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  progressTitle: { color: desktopSurfaces.text, fontSize: 14, fontWeight: '900' },
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: desktopSurfaces.borderStrong,
    borderRadius: 10,
    backgroundColor: desktopSurfaces.card,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  secondaryButtonText: { color: desktopSurfaces.accent, fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
