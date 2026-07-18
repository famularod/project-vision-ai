import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { StartupHydrationFailure } from '../services/StartupRecovery';
import { colors } from '../theme';

export function StartupHydrationBoundary({
  ready,
  failures,
  onRetry,
  children,
}: {
  ready: boolean;
  failures: readonly StartupHydrationFailure[];
  onRetry: () => void;
  children: ReactNode;
}) {
  if (ready) return <>{children}</>;

  const blocked = failures.length > 0;
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View
          style={styles.card}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={blocked ? 'Saved data recovery required' : 'Restoring saved project data'}
        >
          {blocked ? null : <ActivityIndicator size="large" color={colors.primary} />}
          <Text style={styles.title}>
            {blocked ? 'Saved data needs recovery' : 'Restoring your project data…'}
          </Text>
          <Text style={styles.body}>
            {blocked
              ? 'DAVE could not safely read all saved information on this phone. Nothing will be saved, synced, restored, backed up, or exported until recovery succeeds.'
              : 'DAVE is safely loading projects, updates, schedules, documents, and contacts before opening the workspace.'}
          </Text>
          {failures.map(failure => (
            <View key={failure.key} style={styles.failureRow}>
              <Text style={styles.failureTitle}>{failure.label}</Text>
              <Text style={styles.failureText}>
                {failure.state === 'corrupt_quarantined'
                  ? 'The unreadable copy was kept aside instead of being replaced.'
                  : 'Phone storage could not be read. Try again.'}
              </Text>
            </View>
          ))}
          {blocked ? (
            <TouchableOpacity
              style={styles.button}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry saved data recovery"
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>Retry Recovery</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: {
    gap: 12,
    padding: 22,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 24, lineHeight: 30, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 16, lineHeight: 23 },
  failureRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
  },
  failureTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  failureText: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 3 },
  button: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '800' },
});
