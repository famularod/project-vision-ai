import type { ReactElement, ReactNode } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ProjectPhotoImage } from './ProjectPhotoImage';
import type { DAVEUpdatePhotoComparison } from '../services/DAVEUpdateWorkspace';
import { colors, radius, spacing } from '../theme';
import type { UpdatePhoto } from '../types';

type IdentifiedUpdate = { id: string };

export type UpdatePhotoComparisonViewModel = {
  /** This device's file for the photo, or '' when it holds none. */
  priorUri: string;
  /** The photo itself, so a cloud-only photo signs its preview when shown (A4 pass 7 M2). */
  priorPhoto?: Partial<UpdatePhoto>;
  priorLabel: string;
  currentUri: string;
  currentPhoto?: Partial<UpdatePhoto>;
  currentLabel: string;
  summary: string | null;
  confidence: string | null;
  comparability: string | null;
};

/**
 * The comparison as shown. Its photos used to be passed as their `uri`, which
 * is empty for a photo taken on the other device, so both sides were blank
 * there (whole-app audit A4 pass 7 M2, 30 Sep 2026).
 */
export function updatePhotoComparisonViewModel(
  comparison: DAVEUpdatePhotoComparison<Partial<UpdatePhoto>> | null,
  formatDate: (date: string) => string,
  localUri: (photo: Partial<UpdatePhoto>) => string,
): UpdatePhotoComparisonViewModel | null {
  if (!comparison) return null;
  return {
    priorUri: localUri(comparison.priorPhoto),
    priorPhoto: comparison.priorPhoto,
    priorLabel: formatDate(comparison.priorUpdateDate),
    currentUri: localUri(comparison.currentPhoto),
    currentPhoto: comparison.currentPhoto,
    currentLabel: formatDate(comparison.currentUpdateDate),
    summary: comparison.summary,
    confidence: comparison.comparisonConfidence,
    comparability: comparison.comparability,
  };
}

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
          photo={comparison.priorPhoto}
        />
        <EvidencePhoto
          label="Current evidence"
          detail={comparison.currentLabel}
          uri={comparison.currentUri}
          photo={comparison.currentPhoto}
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
  photo,
}: {
  label: string;
  detail: string;
  uri: string;
  photo?: Partial<UpdatePhoto>;
}) {
  return (
    <View style={styles.evidencePhoto}>
      <ProjectPhotoImage
        photo={photo ?? {}}
        localUri={uri}
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
