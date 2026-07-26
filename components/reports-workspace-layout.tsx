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
      <ScrollView
        style={styles.workspace}
        contentContainerStyle={styles.workspaceContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="reports-wide-scroll"
      >
        <View style={styles.page}>
          {header}

          <View
            style={[styles.section, styles.reviewSection]}
            testID="reports-wide-review-section"
          >
            <Text accessibilityRole="header" style={styles.eyebrow}>REPORT CHECK</Text>
            {review}
          </View>

          <View
            style={styles.section}
            testID="reports-wide-preview-section"
          >
            <Text accessibilityRole="header" style={styles.eyebrow}>REPORT PREVIEW</Text>
            {report}
          </View>
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
  workspace: {
    flex: 1,
    minHeight: 0,
  },
  workspaceContent: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  page: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  reviewSection: {
    width: '100%',
  },
  eyebrow: {
    color: colors.tertiaryText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
});
