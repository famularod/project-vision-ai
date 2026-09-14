import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { buildECOSDocumentReadiness } from '../services/ECOSDocumentReadiness';
import { resolveECOSCustomerDocumentStatus } from '../services/ECOSDocumentOnboarding';
import { colors, radius, spacing } from '../theme';
import type { ReferenceDocument } from '../types';

export function MobileDocumentECOSStatus({
  document,
  onMakeCurrent,
}: Readonly<{
  document: ReferenceDocument | null;
  onMakeCurrent?: () => void;
}>) {
  if (!document) {
    return (
      <View style={styles.card} testID="mobile-document-ecos-status">
        <StatusHeading label="Waiting" progress={null} />
        <Text style={styles.detail}>
          The protected file is uploading. ECOS preparation begins after the shared document record is saved.
        </Text>
      </View>
    );
  }

  const status = resolveECOSCustomerDocumentStatus(document);
  const readiness = buildECOSDocumentReadiness(document);
  const progress = boundedProgress(document.ecosHostedIndexProgressPercent);

  return (
    <View style={styles.card} testID="mobile-document-ecos-status">
      <StatusHeading label={status} progress={progress} />
      <Text style={styles.detail}>{customerDetail(document, readiness.detail)}</Text>

      {document.isCurrent ? (
        <View style={styles.currentRow} accessibilityLabel="Current for ECOS">
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.currentText}>Current for ECOS</Text>
        </View>
      ) : readiness.canMakeCurrent && onMakeCurrent ? (
        <Pressable
          style={({ pressed }) => [styles.makeCurrentButton, pressed && styles.pressed]}
          onPress={onMakeCurrent}
          accessibilityRole="button"
          accessibilityLabel="Make Current for ECOS"
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.surface} />
          <Text style={styles.makeCurrentText}>Make Current for ECOS</Text>
        </Pressable>
      ) : (
        <Text style={styles.safetyText}>
          {onMakeCurrent
            ? 'Make Current becomes available only after ECOS preparation and Assurance checks are complete.'
            : 'Manage this shared document in the desktop Documents workspace.'}
        </Text>
      )}
    </View>
  );
}

function StatusHeading({ label, progress }: Readonly<{ label: string; progress: number | null }>) {
  return (
    <View style={styles.headingRow}>
      <View style={styles.iconBubble}>
        <Ionicons name="sparkles-outline" size={17} color={colors.primary} />
      </View>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>ECOS preparation</Text>
        <Text style={styles.status}>{label}</Text>
      </View>
      {progress != null ? <Text style={styles.progress}>{progress}%</Text> : null}
    </View>
  );
}

function boundedProgress(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function customerDetail(document: ReferenceDocument, fallback: string) {
  if (document.ecosHostedIndexStatus === 'Waiting') {
    return 'The drawing is safely stored and waiting for hosted ECOS preparation.';
  }
  if (document.ecosHostedIndexStatus === 'Preparing') {
    return 'Vitruvius is preparing searchable pages, visual coverage, and verified sheet identity in the background.';
  }
  if (document.ecosHostedIndexStatus === 'Reconnect Files') {
    return 'Reconnect the source file from the desktop Documents workspace so preparation can continue.';
  }
  if (document.ecosHostedIndexStatus === 'Temporarily Unavailable') {
    return 'The drawing is safe. Hosted preparation will resume automatically when capacity is available.';
  }
  if (document.ecosHostedIndexStatus === 'Needs Review') {
    return 'Review the highlighted drawing details before ECOS can use this revision.';
  }
  if (
    document.ecosHostedIndexStatus === 'Prepared with limitations' ||
    document.ecosHostedIndexStatus === 'Ready with limitations'
  ) {
    return document.ecosHostedIndexCustomerMessage?.trim() || limitationDetail(
      document.ecosHostedIndexLimitationCount,
    );
  }
  return fallback;
}

function limitationDetail(value: unknown) {
  const count = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
  return `${count} accepted page${count === 1 ? '' : 's'} passed ECOS Assurance with review limitations.`;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1 },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  status: { color: colors.text, fontSize: 15, fontWeight: '900' },
  progress: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  detail: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
  safetyText: { color: colors.mutedText, fontSize: 12, lineHeight: 18 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  currentText: { color: colors.success, fontSize: 14, fontWeight: '900' },
  makeCurrentButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  makeCurrentText: { color: colors.surface, fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
