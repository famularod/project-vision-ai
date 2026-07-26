import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  type PIELiveAuthorityPolicy,
  type PIELiveAuthorityStateName,
  usePIELiveAuthority,
} from '../providers/PIELiveAuthorityProvider';
import { colors, radius, spacing, typography } from '../theme';

type LiveAuthorityStatusBannerViewProps = {
  state: PIELiveAuthorityStateName;
  policy: PIELiveAuthorityPolicy;
  retryPending: boolean;
  cloudExpected: boolean;
  localAuthorityExpected?: boolean;
  degradedLocalAcknowledged: boolean;
  onRetry: () => void;
  onAcknowledge: () => void;
  safeAreaTop?: number;
};

export function LiveAuthorityStatusBanner() {
  const authority = usePIELiveAuthority();
  const insets = useSafeAreaInsets();

  return (
    <LiveAuthorityStatusBannerView
      state={authority.state}
      policy={authority.policy}
      retryPending={authority.retryPending}
      cloudExpected={authority.cloudExpected}
      localAuthorityExpected={authority.localAuthorityExpected}
      degradedLocalAcknowledged={authority.degradedLocalAcknowledged}
      onRetry={() => {
        void authority.refreshAuthority('manual_retry');
      }}
      onAcknowledge={authority.acknowledgeDegradedLocal}
      safeAreaTop={insets.top}
    />
  );
}

export function LiveAuthorityStatusBannerView({
  state,
  policy,
  retryPending,
  cloudExpected,
  localAuthorityExpected = false,
  degradedLocalAcknowledged,
  onRetry,
  onAcknowledge,
  safeAreaTop = 0,
}: LiveAuthorityStatusBannerViewProps) {
  const degraded =
    state === 'degraded_local_only' || state === 'queued_for_cloud';
  const globallyActionable =
    degraded ||
    state === 'unavailable' ||
    state === 'persistence_failed';
  // Stale reasoning, human-review conflicts, and account-scope blocks belong
  // beside the feature they affect. Showing them above every screen makes a
  // project-review state look like an app-wide sync failure.
  //
  // Combined portfolio reports are intentionally computed in memory rather
  // than persisted as a synthetic cloud project. That is the normal authority
  // model for this report, not a recoverable app-wide failure. Showing a
  // warning or retry control here creates an acknowledgement loop whenever the
  // selected project set changes.
  if (!globallyActionable || localAuthorityExpected) return null;

  const acknowledgementRequired = degraded && !degradedLocalAcknowledged;
  const retryAllowed =
    state === 'unavailable' ||
    state === 'persistence_failed' ||
    (degraded && cloudExpected && !localAuthorityExpected);
  const message = policy.userMessage;

  return (
    <View
      accessibilityRole="alert"
      testID="live-authority-status-banner"
      style={[
        styles.banner,
        { marginTop: Math.max(spacing.sm, safeAreaTop + spacing.sm) },
        acknowledgementRequired ? styles.warningBanner : styles.statusBanner,
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>
          {acknowledgementRequired
            ? 'Saved device data needs acknowledgement'
            : degraded
              ? 'Using saved device data'
              : 'Project understanding needs attention'}
        </Text>
        <Text style={styles.message}>{message}</Text>
      </View>

      {acknowledgementRequired ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Acknowledge saved device data"
          onPress={onAcknowledge}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Acknowledge</Text>
        </TouchableOpacity>
      ) : retryAllowed ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry project understanding"
          disabled={retryPending}
          onPress={onRetry}
          style={[styles.button, retryPending && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>
            {retryPending ? 'Retrying…' : 'Retry'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  warningBanner: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
  },
  statusBanner: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.body,
    fontWeight: '800',
    color: colors.text,
  },
  message: {
    ...typography.caption,
    marginTop: 2,
    color: colors.mutedText,
  },
  button: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    ...typography.body,
    fontWeight: '800',
    color: colors.surface,
  },
});
