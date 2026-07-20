import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectDocumentCategory } from '../services/ProjectDocumentClassification';
import { colors, radius, spacing } from '../theme';
import { ProjectActionSheet } from './project-action-sheet';

export function DocumentUploadDetailsSheet({
  visible,
  projects,
  selectedProjects,
  categories,
  selectedCategory,
  onCategoryChange,
  onToggleProject,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  projects: string[];
  selectedProjects: ReadonlySet<string>;
  categories: readonly ProjectDocumentCategory[];
  selectedCategory: ProjectDocumentCategory;
  onCategoryChange: (category: ProjectDocumentCategory) => void;
  onToggleProject: (projectName: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ProjectActionSheet visible={visible} title="Document Details" onClose={onClose}>
      <Text style={styles.help}>
        Choose what this document is before adding it to the project record.
      </Text>

      <Text style={styles.sectionLabel}>Document Type</Text>
      <View style={styles.categoryWrap} accessibilityRole="radiogroup">
        {categories.map(category => {
          const selected = category === selectedCategory;
          return (
            <Pressable
              key={category}
              style={({ pressed }) => [
                styles.category,
                selected && styles.categorySelected,
                pressed && styles.pressed,
              ]}
              onPress={() => onCategoryChange(category)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Classify document as ${category}`}
            >
              <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                {category}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>{projects.length === 1 ? 'Project' : 'Projects'}</Text>
      <Text style={styles.help}>
        {projects.length === 1
          ? 'This attachment will stay with the current project and field update.'
          : 'This document will be added to every project you select below.'}
      </Text>

      {projects.map(projectName => {
        const selected = selectedProjects.has(projectName);
        return (
          <Pressable
            key={projectName}
            style={({ pressed }) => [
              styles.projectRow,
              selected && styles.projectRowSelected,
              pressed && styles.pressed,
            ]}
            onPress={() => onToggleProject(projectName)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`Add document to ${projectName}`}
          >
            <Text style={styles.projectName}>{projectName}</Text>
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={selected ? colors.primary : colors.mutedText}
            />
          </Pressable>
        );
      })}

      <Pressable
        style={({ pressed }) => [
          styles.confirmButton,
          selectedProjects.size === 0 && styles.confirmButtonDisabled,
          pressed && selectedProjects.size > 0 && styles.pressed,
        ]}
        onPress={onConfirm}
        disabled={selectedProjects.size === 0}
        accessibilityRole="button"
        accessibilityState={{ disabled: selectedProjects.size === 0 }}
      >
        <Ionicons name="checkmark-done-outline" size={20} color={colors.surface} />
        <Text style={styles.confirmText}>
          {selectedProjects.size > 0
            ? `Add ${selectedCategory} to ${selectedProjects.size} Project${selectedProjects.size === 1 ? '' : 's'}`
            : 'Select at least one project'}
        </Text>
      </Pressable>
    </ProjectActionSheet>
  );
}

const styles = StyleSheet.create({
  help: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  categoryWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  category: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  categorySelected: {
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
  projectRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  projectRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  projectName: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  confirmButton: {
    minHeight: 54,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmText: {
    flexShrink: 1,
    color: colors.surface,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
