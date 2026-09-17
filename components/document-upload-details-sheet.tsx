import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createECOSMobileDrawingControls,
  type ECOSMobileDrawingControls,
  validateECOSMobileDrawingControls,
} from '../services/ECOSMobileDrawingOnboarding';
import type { ProjectDocumentCategory } from '../services/ProjectDocumentClassification';
import { colors, radius, spacing } from '../theme';
import { ProjectActionSheet } from './project-action-sheet';

export type MobileDocumentReplacementOption = Readonly<{
  id: string;
  name: string;
  revision: string | null;
  isCurrent: boolean;
}>;

export function DocumentUploadDetailsSheet({
  visible,
  projects,
  selectedProjects,
  categories,
  selectedCategory,
  drawingControls,
  replacementDocuments = [],
  onCategoryChange,
  onDrawingControlsChange,
  onToggleProject,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  projects: string[];
  selectedProjects: ReadonlySet<string>;
  categories: readonly ProjectDocumentCategory[];
  selectedCategory: ProjectDocumentCategory;
  drawingControls?: ECOSMobileDrawingControls;
  replacementDocuments?: readonly MobileDocumentReplacementOption[];
  onCategoryChange: (category: ProjectDocumentCategory) => void;
  onDrawingControlsChange?: (next: ECOSMobileDrawingControls) => void;
  onToggleProject: (projectName: string) => void;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const controls = drawingControls || createECOSMobileDrawingControls();
  const drawingValidation = selectedCategory === 'Drawing'
    ? validateECOSMobileDrawingControls(controls)
    : null;
  const confirmDisabled = selectedProjects.size === 0 ||
    confirming ||
    Boolean(drawingValidation && !drawingValidation.valid);

  function updateDrawingControls(next: Partial<ECOSMobileDrawingControls>) {
    onDrawingControlsChange?.(Object.freeze({ ...controls, ...next }));
  }

  async function confirmUpload() {
    if (confirmDisabled) return;
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

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
              disabled={confirming}
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

      {selectedCategory === 'Drawing' ? (
        <View style={styles.drawingCard} testID="mobile-drawing-control">
          <Text style={styles.drawingTitle}>Drawing Control</Text>
          <Text style={styles.help}>
            Confirm any details suggested from the filename. For a multi-sheet set, enter its set identifier; Vitruvius identifies each sheet during preparation. Discipline can include multiple trades.
          </Text>

          <Field
            label="Drawing number"
            value={controls.drawingNumber}
            placeholder="A2.01"
            required
            autoCapitalize="characters"
            onChangeText={drawingNumber => updateDrawingControls({ drawingNumber })}
          />
          <Field
            label="Revision"
            value={controls.drawingRevision}
            placeholder="3"
            required
            onChangeText={drawingRevision => updateDrawingControls({ drawingRevision })}
          />
          <Field
            label="Discipline"
            value={controls.drawingDiscipline}
            placeholder="Architectural"
            onChangeText={drawingDiscipline => updateDrawingControls({ drawingDiscipline })}
          />

          <Text style={styles.sectionLabel}>Issue status · Required</Text>
          <View style={styles.categoryWrap} accessibilityRole="radiogroup">
            {(['Draft', 'For Review', 'For Construction', 'As-Built', 'Superseded'] as const)
              .map(status => {
                const selected = controls.drawingStatus === status;
                return (
                  <Pressable
                    key={status}
                    style={({ pressed }) => [
                      styles.category,
                      selected && styles.categorySelected,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => updateDrawingControls({ drawingStatus: status })}
                    disabled={confirming}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Set drawing issue status to ${status}`}
                  >
                    <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                      {status}
                    </Text>
                  </Pressable>
                );
              })}
          </View>

          <Field
            label="Issue date"
            value={controls.drawingIssuedAt}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            onChangeText={drawingIssuedAt => updateDrawingControls({ drawingIssuedAt })}
          />

          {drawingValidation && !drawingValidation.valid ? (
            <Text style={styles.validationText}>{drawingValidation.message}</Text>
          ) : null}
        </View>
      ) : null}

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
            disabled={confirming}
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

      {selectedCategory === 'Drawing' ? (
        <View style={styles.versionCard}>
          <Text style={styles.sectionLabel}>Version intent</Text>
          <Text style={styles.help}>
            Choose a current drawing only when this file is its next revision. The existing revision remains current until the new drawing is fully prepared and you choose Make Current.
          </Text>
          <View style={styles.versionOptions} accessibilityRole="radiogroup">
            <Pressable
              style={({ pressed }) => [
                styles.versionChoice,
                !controls.replacementDocumentId && styles.categorySelected,
                pressed && styles.pressed,
              ]}
              onPress={() => updateDrawingControls({ replacementDocumentId: null })}
              disabled={confirming}
              accessibilityRole="radio"
              accessibilityState={{ selected: !controls.replacementDocumentId }}
              accessibilityLabel="Upload as a new drawing"
            >
              <Text style={[
                styles.categoryText,
                !controls.replacementDocumentId && styles.categoryTextSelected,
              ]}>New drawing</Text>
            </Pressable>
            {replacementDocuments.map(document => {
              const selected = controls.replacementDocumentId === document.id;
              return (
                <Pressable
                  key={document.id}
                  style={({ pressed }) => [
                    styles.versionChoice,
                    selected && styles.categorySelected,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => updateDrawingControls({ replacementDocumentId: document.id })}
                  disabled={confirming}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Upload as the next revision of ${document.name}`}
                >
                  <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                    {document.isCurrent ? 'Current · ' : ''}{document.name}
                    {document.revision ? ` · Rev ${document.revision}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {selectedProjects.size > 1 ? (
            <Text style={styles.help}>
              Select one project at a time to identify a replacement revision safely.
            </Text>
          ) : replacementDocuments.length === 0 ? (
            <Text style={styles.help}>No existing drawing revision is available for this project.</Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.confirmButton,
          confirmDisabled && styles.confirmButtonDisabled,
          pressed && !confirmDisabled && styles.pressed,
        ]}
        onPress={() => void confirmUpload()}
        disabled={confirmDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: confirmDisabled, busy: confirming }}
        accessibilityLabel={confirmButtonLabel(selectedCategory, selectedProjects.size, confirming, drawingValidation?.valid ?? true)}
      >
        <Ionicons name="checkmark-done-outline" size={20} color={colors.surface} />
        <Text style={styles.confirmText}>
          {confirmButtonLabel(selectedCategory, selectedProjects.size, confirming, drawingValidation?.valid ?? true)}
        </Text>
      </Pressable>
    </ProjectActionSheet>
  );
}

function confirmButtonLabel(
  category: ProjectDocumentCategory,
  projectCount: number,
  confirming: boolean,
  drawingValid: boolean,
) {
  if (confirming) return category === 'Schedule' ? 'Reading Schedule…' : 'Adding Document…';
  if (projectCount === 0) return 'Select at least one project';
  if (category === 'Drawing' && !drawingValid) return 'Complete Drawing Details';
  return `Add ${category} to ${projectCount} Project${projectCount === 1 ? '' : 's'}`;
}

function Field({
  label,
  required = false,
  ...inputProps
}: Readonly<{
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numbers-and-punctuation';
  onChangeText: (value: string) => void;
}>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{required ? ' · Required' : ' · Optional'}</Text>
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={colors.mutedText}
        accessibilityLabel={label}
      />
    </View>
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
  drawingCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  drawingTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    paddingBottom: spacing.xs,
  },
  field: { paddingTop: spacing.md },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
    paddingBottom: spacing.xs,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
  },
  validationText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    paddingTop: spacing.md,
  },
  versionCard: { paddingTop: spacing.sm },
  versionOptions: { gap: spacing.xs, paddingTop: spacing.sm },
  versionChoice: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
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
