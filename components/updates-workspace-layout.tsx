import type { ReactElement, ReactNode } from 'react';
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing } from '../theme';

type IdentifiedUpdate = { id: string };

export type UpdatePhotoComparisonViewModel = {
  priorUri: string;
  priorLabel: string;
  currentUri: string;
  currentLabel: string;
  summary: string | null;
  confidence: string | null;
  comparability: string | null;
};

export function UpdatesWideWorkspace<T extends IdentifiedUpdate>({
  items,
  selectedUpdateId,
  onSelectUpdate,
  renderMasterItem,
  masterHeader,
  inspector,
  comparison,
  emptyState,
}: {
  items: T[];
  selectedUpdateId: string | null;
  onSelectUpdate: (updateId: string) => void;
  renderMasterItem: (input: {
    item: T;
    index: number;
    selected: boolean;
    onSelect: () => void;
  }) => ReactElement;
  masterHeader: ReactElement;
  inspector: ReactNode;
  comparison: UpdatePhotoComparisonViewModel | null;
  emptyState: ReactElement;
}) {
  return (
    <View style={styles.workspace} testID="updates-wide-workspace">
      <View style={styles.masterColumn}>
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => renderMasterItem({
            item,
            index,
            selected: item.id === selectedUpdateId,
            onSelect: () => onSelectUpdate(item.id),
          })}
          ListHeaderComponent={masterHeader}
          ListEmptyComponent={emptyState}
          contentContainerStyle={styles.masterContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>

      <ScrollView
        style={styles.inspectorColumn}
        contentContainerStyle={styles.inspectorContent}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text accessibilityRole="header" style={styles.inspectorEyebrow}>UPDATE INSPECTOR</Text>
        {comparison ? <UpdatePhotoComparison comparison={comparison} /> : null}
        {inspector}
      </ScrollView>
    </View>
  );
}

export function UpdatePhotoComparison({
  comparison,
}: {
  comparison: UpdatePhotoComparisonViewModel;
}) {
  return (
    <View style={styles.comparisonCard} testID="update-photo-comparison">
      <View style={styles.comparisonHeading}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.comparisonTitle}>Source-backed photo comparison</Text>
          <Text style={styles.comparisonCaption}>
            These are the exact current and prior photos recorded by the analysis.
          </Text>
        </View>
        {comparison.confidence ? (
          <View style={styles.confidencePill}>
            <Text style={styles.confidenceText}>{comparison.confidence}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.photoPair}>
        <EvidencePhoto
          label="Previous evidence"
          detail={comparison.priorLabel}
          uri={comparison.priorUri}
        />
        <EvidencePhoto
          label="Current evidence"
          detail={comparison.currentLabel}
          uri={comparison.currentUri}
        />
      </View>

      {comparison.summary ? (
        <Text style={styles.comparisonSummary} selectable>
          {comparison.summary}
        </Text>
      ) : null}
      {comparison.comparability ? (
        <Text style={styles.comparisonCaption} selectable>
          Comparability: {comparison.comparability}
        </Text>
      ) : null}
    </View>
  );
}

function EvidencePhoto({
  label,
  detail,
  uri,
}: {
  label: string;
  detail: string;
  uri: string;
}) {
  return (
    <View style={styles.evidencePhoto}>
      <Image
        source={{ uri }}
        style={styles.comparisonImage}
        resizeMode="cover"
        accessible
        accessibilityLabel={`${label}, ${detail}`}
      />
      <Text style={styles.evidenceLabel}>{label}</Text>
      <Text style={styles.comparisonCaption} numberOfLines={2}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  masterColumn: {
    width: 420,
    maxWidth: '42%',
    minWidth: 350,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.surface,
  },
  masterContent: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  separator: {
    height: spacing.sm,
  },
  inspectorColumn: {
    flex: 1,
    minWidth: 0,
  },
  inspectorContent: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  inspectorEyebrow: {
    color: colors.tertiaryText,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  comparisonCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
    padding: spacing.lg,
  },
  comparisonHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headingCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  comparisonTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  comparisonCaption: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
  },
  confidencePill: {
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  confidenceText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  photoPair: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  evidencePhoto: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  comparisonImage: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  evidenceLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  comparisonSummary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
});
