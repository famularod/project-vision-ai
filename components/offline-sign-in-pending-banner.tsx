import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNativeWorkspaceSignInPending } from './native-workspace-owner';
import { colors, radius, spacing, typography } from '../theme';

/**
 * Owner answer Q13 (30 Sep 2026): the workspace opened with no signal on a
 * sign-in that could not refresh. Shown until the sign-in refreshes by itself
 * when there is signal; nothing uploads meanwhile.
 */
export function OfflineSignInPendingBanner() {
  const pending = useNativeWorkspaceSignInPending();
  const insets = useSafeAreaInsets();
  if (!pending) return null;
  return (
    <View
      accessibilityRole="alert"
      testID="offline-sign-in-pending-banner"
      style={[styles.banner, { marginTop: Math.max(spacing.sm, insets.top + spacing.sm) }]}
    >
      <Text style={styles.title}>Offline, sign-in pending</Text>
      <Text style={styles.message}>
        Your work is saved on this phone. Uploads wait until your sign-in refreshes, which happens by itself when there is signal.
      </Text>
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
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft,
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
});
