import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  appendProjectItemActivity,
  closeProjectItemWorkflow,
  projectItemWorkflowIsClosed,
  projectItemWorkflowReadiness,
  reopenProjectItemWorkflow,
  type ProjectItemWorkflowMutationRequest,
} from '../services/ProjectItemWorkflow';
import { colors, radius, spacing } from '../theme';
import { PROJECT_ITEM_TYPES, type ProjectItemType, type ScheduleItem } from '../types';
import {
  ProjectControlsEditor,
  ProjectControlsSummary,
} from './project-controls-editor';

export function ProjectItemTypeBadge({ item }: { item: ScheduleItem }) {
  return (
    <View style={styles.typeBadge}>
      <Text style={styles.typeBadgeText}>{item.itemType || 'Task'}</Text>
    </View>
  );
}

export function ProjectItemNextAction({ item }: { item: ScheduleItem }) {
  if (!item.nextAction?.trim()) return null;

  return (
    <View style={styles.nextActionCard}>
      <Text style={styles.nextActionTitle}>Next action</Text>
      <Text style={styles.nextActionText}>{item.nextAction.trim()}</Text>
    </View>
  );
}

export function ProjectItemSummary({ item }: { item: ScheduleItem }) {
  return (
    <>
      <View style={styles.summaryRow}>
        <ProjectItemTypeBadge item={item} />
      </View>
      <ProjectItemNextAction item={item} />
      <ProjectControlsSummary item={item} />
    </>
  );
}

export function ProjectItemDetailsEditor({
  item,
  activityAuthor,
  onUpdate,
}: {
  item: ScheduleItem;
  activityAuthor?: string;
  onUpdate: (
    next: Partial<ScheduleItem>,
    workflowRequest?: ProjectItemWorkflowMutationRequest,
  ) => void;
}) {
  const [activityMessage, setActivityMessage] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState('');
  const readiness = projectItemWorkflowReadiness(item);
  const workflowClosed = projectItemWorkflowIsClosed(item);

  const addActivity = () => {
    const message = activityMessage.trim();
    if (!message) return;
    const createdAt = new Date().toISOString();
    onUpdate({
      activity: appendProjectItemActivity({
        activity: item.activity,
        message,
        author: activityAuthor?.trim() || item.owner.trim() || 'Project manager',
        createdAt,
        id: `activity-${createdAt}-${Math.random().toString(36).slice(2, 10)}`,
      }),
    });
    setActivityMessage('');
  };

  return (
    <View>
      <FieldLabel text="Project item type" />
      <View style={styles.optionGrid}>
        {PROJECT_ITEM_TYPES.map(itemType => {
          const itemTypeSelected = (item.itemType || 'Task') === itemType;
          const itemTypeLocked = readiness.supported &&
            workflowClosed &&
            !itemTypeSelected;
          return (
          <Pressable
            key={itemType}
            style={({ pressed }) => [
              styles.option,
              itemTypeSelected && styles.optionActive,
              itemTypeLocked && styles.optionDisabled,
              pressed && styles.pressed,
            ]}
            disabled={itemTypeLocked}
            onPress={() => {
              if (itemTypeLocked) {
                setWorkflowMessage(
                  `Reopen ${readiness.itemType} before changing its project item type.`,
                );
                return;
              }
              setWorkflowMessage('');
              onUpdate({ itemType: itemType as ProjectItemType });
            }}
            accessibilityRole="button"
            accessibilityState={{
              selected: itemTypeSelected,
              disabled: itemTypeLocked,
            }}
          >
            <Text style={[
              styles.optionText,
              itemTypeSelected && styles.optionTextActive,
            ]}>{itemType}</Text>
          </Pressable>
          );
        })}
      </View>

      <FieldLabel text="Next action" />
      <TextInput
        style={styles.input}
        value={item.nextAction || ''}
        onChangeText={nextAction => onUpdate({ nextAction })}
        placeholder="Smallest accountable next step"
        placeholderTextColor={colors.mutedText}
      />

      <FieldLabel text="Notes" />
      <TextInput
        style={[styles.input, styles.multilineInput]}
        value={item.notes}
        onChangeText={notes => onUpdate({ notes })}
        placeholder="Background, constraints, or details"
        placeholderTextColor={colors.mutedText}
        multiline
      />

      <ProjectControlsEditor
        item={item}
        actor={activityAuthor}
        onUpdate={projectControls => {
          if (
            readiness.supported &&
            !workflowClosed &&
            projectControls.workflowStage === 'Closed'
          ) {
            setWorkflowMessage(
              `Use "Close ${readiness.itemType}" to record the closed workflow stage.`,
            );
            return;
          }
          if (
            readiness.supported &&
            workflowClosed &&
            projectControls.workflowStage !==
              (item.projectControls?.workflowStage || 'Open')
          ) {
            setWorkflowMessage(
              `Use "Reopen ${readiness.itemType}" before changing its workflow stage.`,
            );
            return;
          }
          setWorkflowMessage('');
          onUpdate({ projectControls });
        }}
      />

      {readiness.supported ? (
        <View style={styles.workflowCard}>
          <Text style={styles.workflowTitle}>
            {readiness.itemType} workflow
          </Text>
          <Text style={styles.workflowDetail}>{readiness.message}</Text>
          {!workflowClosed && readiness.missing.slice(0, 4).map(missing => (
            <Text key={missing} style={styles.workflowMissing}>• {missing}</Text>
          ))}
          {workflowMessage ? (
            <Text style={styles.workflowResult}>{workflowMessage}</Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.workflowButton,
              !workflowClosed && !readiness.readyToClose && styles.workflowButtonDisabled,
              pressed && styles.pressed,
            ]}
            disabled={!workflowClosed && !readiness.readyToClose}
            onPress={() => {
              const now = new Date().toISOString();
              const result = workflowClosed
                ? reopenProjectItemWorkflow({
                    item,
                    actor: activityAuthor?.trim() || item.owner.trim() || 'Project manager',
                    now,
                  })
                : closeProjectItemWorkflow({
                    item,
                    actor: activityAuthor?.trim() || item.owner.trim() || 'Project manager',
                    now,
                  });
              setWorkflowMessage(result.message);
              if (result.ok) {
                onUpdate({}, {
                  action: result.action,
                  actor: activityAuthor?.trim() || item.owner.trim() || 'Project manager',
                });
              }
            }}
            accessibilityRole="button"
          >
            <Text style={styles.workflowButtonText}>
              {workflowClosed ? `Reopen ${readiness.itemType}` : `Close ${readiness.itemType}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FieldLabel text="Activity" />
      {(item.activity || []).slice(-3).reverse().map(entry => (
        <View key={entry.id} style={styles.activityCard}>
          <Text style={styles.activityText}>{entry.message}</Text>
          <Text style={styles.activityMeta}>{entry.author} • {formatActivityTime(entry.createdAt)}</Text>
        </View>
      ))}
      <TextInput
        style={[styles.input, styles.multilineInput]}
        value={activityMessage}
        onChangeText={setActivityMessage}
        placeholder="Add a progress note, decision, or follow-up"
        placeholderTextColor={colors.mutedText}
        multiline
      />
      <Pressable
        style={({ pressed }) => [styles.addActivityButton, pressed && styles.pressed]}
        onPress={addActivity}
        accessibilityRole="button"
        accessibilityLabel="Add activity"
      >
        <Text style={styles.addActivityText}>Add Activity</Text>
      </Pressable>
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  typeBadge: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: `${colors.primary}14`, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  typeBadgeText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  nextActionCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, gap: 4, marginTop: spacing.sm, padding: spacing.md },
  nextActionTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  nextActionText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: spacing.md },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionDisabled: { opacity: 0.38 },
  optionText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  optionTextActive: { color: '#FFFFFF' },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  multilineInput: { minHeight: 96, textAlignVertical: 'top' },
  activityCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 4, marginBottom: spacing.sm, padding: spacing.md },
  activityText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  activityMeta: { color: colors.mutedText, fontSize: 12, lineHeight: 17 },
  addActivityButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md },
  addActivityText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  workflowCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, gap: 5, marginTop: spacing.md, padding: spacing.md },
  workflowTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  workflowDetail: { color: colors.text, fontSize: 14, lineHeight: 20 },
  workflowMissing: { color: colors.warning, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  workflowResult: { color: colors.primary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  workflowButton: { minHeight: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md },
  workflowButtonDisabled: { opacity: 0.42 },
  workflowButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
