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
}: {
  projectName: string;
  categories: readonly T[];
  selectedCategory: T | null;
  onCategoryChange: (category: T | null) => void;
  onBack: () => void;
  onUpload: () => void;
  onTakePhoto: () => void;
}) {
  return (
    <View style={styles.header} testID="project-documents-header">
      <ScreenHeader
        title="Project Documents"
        subtitle={projectName}
        onBack={onBack}
      />

      <View style={styles.actionRow}>
        <DocumentAction
          label="Upload Document"
          icon="document-attach-outline"
          primary
          onPress={onUpload}
        />
        <DocumentAction
          label="Take Photo of Document"
          icon="camera-outline"
          onPress={onTakePhoto}
        />
      </View>

      <ScreenCard style={styles.statusCard}>
        <Text style={styles.statusTitle}>Document Status</Text>
        <Text selectable style={styles.statusText}>
          Local only, Document upload pending, Document upload failed · Retry, and Uploaded documents remain visible here. Failed uploads can be retried without duplicating the document record.
        </Text>
      </ScreenCard>

      <Text style={styles.categoryTitle}>Category</Text>
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

function DocumentAction({
  label,
  icon,
  primary = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.action,
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
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>
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
