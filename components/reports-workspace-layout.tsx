import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

export function ReportsWideWorkspace({
  header,
  report,
  review,
}: {
  header: ReactNode;
  report: ReactNode;
  review: ReactNode;
}) {
  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top', 'left', 'right']}
      testID="reports-wide-workspace"
    >
      <View style={styles.workspace}>
        <ScrollView
          style={styles.reportColumn}
          contentContainerStyle={styles.reportContent}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {header}
          <Text accessibilityRole="header" style={styles.eyebrow}>REPORT PREVIEW</Text>
          {report}
        </ScrollView>

        <ScrollView
          style={styles.reviewColumn}
          contentContainerStyle={styles.reviewContent}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text accessibilityRole="header" style={styles.eyebrow}>REPORT CHECK</Text>
          {review}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
  },
  reportColumn: {
    flex: 1.25,
    minWidth: 0,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  reviewColumn: {
    flex: 0.9,
    minWidth: 360,
    backgroundColor: colors.surface,
  },
  reportContent: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  reviewContent: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    color: colors.tertiaryText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
