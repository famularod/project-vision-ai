import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { ScreenCard } from './layout/ScreenCard';
import { ScreenHeader } from './layout/ScreenHeader';

export function ProjectDocumentsHeader<T extends string>({
  projectName,
  categories,
  selectedCategory,
  onCategoryChange,
  onBack,
  onUpload,
  onTakePhoto,
  showActions = true,
}: {
  projectName: string;
  categories: readonly T[];
  selectedCategory: T | null;
  onCategoryChange: (category: T | null) => void;
  onBack: () => void;
  onUpload: () => void;
  onTakePhoto: () => void;
  showActions?: boolean;
}) {
  return (
    <View style={styles.header} testID="project-documents-header">
      <ScreenHeader
        title="Project Documents"
        subtitle={projectName}
        onBack={onBack}
      />

      {showActions ? (
        <ProjectDocumentActions onUpload={onUpload} onTakePhoto={onTakePhoto} />
      ) : null}

      <ScreenCard style={styles.statusCard}>
        <Text accessibilityRole="header" style={styles.statusTitle}>Document Status</Text>
        <Text selectable style={styles.statusText}>
          New files are saved on this device first, then synced to the shared project record. Existing cloud files can be downloaded and opened on any authorized device.
        </Text>
      </ScreenCard>

      <Text accessibilityRole="header" style={styles.categoryTitle}>Category</Text>
      <View style={styles.categoryWrap} accessibilityRole="radiogroup">
        <CategoryButton
          label="All"
          selected={selectedCategory === null}
          onPress={() => onCategoryChange(null)}
          accessibilityLabel="Show all document categories"
        />
        {categories.map(category => (
          <CategoryButton
            key={category}
            label={category}
            selected={selectedCategory === category}
            onPress={() => onCategoryChange(category)}
            accessibilityLabel={`Show ${category} documents`}
          />
        ))}
      </View>
    </View>
  );
}

export function ProjectDocumentActions({
  onUpload,
  onTakePhoto,
  wide = false,
}: {
  onUpload: () => void;
  onTakePhoto: () => void;
  wide?: boolean;
}) {
  return (
    <View
      style={[styles.actionRow, wide && styles.actionRowWide]}
      testID="project-document-actions"
    >
      <DocumentAction
        label="Add Document"
        icon="document-attach-outline"
        primary
        wide={wide}
        onPress={onUpload}
      />
      <DocumentAction
        label="Take Photo of Document"
        icon="camera-outline"
        wide={wide}
        onPress={onTakePhoto}
      />
    </View>
  );
}

function DocumentAction({
  label,
  icon,
  primary = false,
  wide = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  wide?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
        wide && styles.actionWide,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons
        name={icon}
        size={19}
        color={primary ? colors.surface : colors.primary}
      />
      <Text
        style={[styles.actionText, primary && styles.actionTextPrimary]}
        numberOfLines={wide ? 1 : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryButton({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.categoryButton,
        selected && styles.categoryButtonSelected,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[
        styles.categoryText,
        selected && styles.categoryTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionRowWide: {
    minWidth: 190,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  action: {
    minHeight: 48,
    flexGrow: 1,
    flexBasis: 160,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  actionPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  actionWide: {
    minWidth: 190,
    maxWidth: 250,
    flexGrow: 1,
    flexBasis: 190,
  },
  actionText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  actionTextPrimary: {
    color: colors.surface,
  },
  statusCard: {
    marginBottom: 0,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    paddingBottom: spacing.xs,
  },
  statusText: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
  },
  categoryTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  categoryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  categoryButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  categoryText: {
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: '800',
  },
  categoryTextSelected: {
    color: colors.primary,
  },
  pressed: {
    opacity: 0.72,
  },
});
