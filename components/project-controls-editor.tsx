import { createElement, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createProjectControlChecklistItem,
  emptyProjectControls,
  normalizeProjectControls,
  PROJECT_CONTROL_APPROVAL_STATUSES,
  PROJECT_CONTROL_IMPACT_CONFIDENCE,
  PROJECT_CONTROL_LINK_KINDS,
  PROJECT_CONTROL_RESOURCE_KINDS,
  PROJECT_CONTROL_WORKFLOW_STAGES,
  projectControlReadiness,
  reviseProjectControls,
  setProjectControlChecklistCompletion,
} from '../services/VitruviusProjectControls';
import {
  applyProjectControlTemplate,
  projectControlTemplate,
} from '../services/ProjectControlTemplates';
import { colors, radius, spacing } from '../theme';
import type {
  ProjectControlApprovalStatus,
  ProjectControlImpactConfidence,
  ProjectControlLinkedRecordKind,
  ProjectControlResourceKind,
  ProjectControls,
  ProjectControlWorkflowStage,
  ScheduleItem,
} from '../types';
import { NativeDateField } from './native-date-field';

export function ProjectControlsSummary({ item }: { item: ScheduleItem }) {
  const controls = normalizeProjectControls(item.projectControls);
  const readiness = projectControlReadiness(item);
  const parts = [
    controls.assignee || item.owner.trim() || 'Unassigned',
    controls.trade || item.contractor.trim(),
    controls.approvalStatus !== 'Not Required' ? controls.approvalStatus : '',
    controls.checklist.length
      ? `${readiness.completedChecks}/${readiness.totalChecks} checks`
      : '',
  ].filter(Boolean);

  return (
    <View style={[
      styles.summary,
      !readiness.ready && styles.summaryNeedsAttention,
    ]}>
      <Text style={styles.summaryTitle}>
        {readiness.ready ? 'Project controls ready' : 'Project controls need attention'}
      </Text>
      <Text style={styles.summaryText}>{parts.join(' • ')}</Text>
      {readiness.missing.length ? (
        <Text style={styles.summaryWarning}>
          Add {readiness.missing.join(', ')}.
        </Text>
      ) : null}
    </View>
  );
}

export function ProjectControlsEditor({
  item,
  actor,
  onUpdate,
}: {
  item: ScheduleItem;
  actor?: string;
  onUpdate: (projectControls: ProjectControls) => void;
}) {
  const controls = useMemo(
    () => normalizeProjectControls(item.projectControls),
    [item.projectControls],
  );
  const [open, setOpen] = useState(false);
  const [checkLabel, setCheckLabel] = useState('');
  const [linkedRecordLabel, setLinkedRecordLabel] = useState('');
  const [linkedRecordKind, setLinkedRecordKind] =
    useState<ProjectControlLinkedRecordKind>('Drawing');
  const [resourceName, setResourceName] = useState('');
  const [resourceKind, setResourceKind] =
    useState<ProjectControlResourceKind>('Crew');
  const [watchersText, setWatchersText] = useState(controls.watchers.join(', '));
  const [approversText, setApproversText] = useState(controls.approvers.join(', '));
  const [assigneeText, setAssigneeText] = useState(controls.assignee);
  const [tradeText, setTradeText] = useState(controls.trade);
  const [referenceNumberText, setReferenceNumberText] =
    useState(controls.referenceNumber);
  const [impactNotesText, setImpactNotesText] = useState(controls.impactNotes);
  const [scheduleImpactText, setScheduleImpactText] = useState(
    numberText(controls.estimatedScheduleImpactDays),
  );
  const watcherValue = controls.watchers.join(', ');
  const approverValue = controls.approvers.join(', ');
  useEffect(() => setWatchersText(watcherValue), [watcherValue]);
  useEffect(() => setApproversText(approverValue), [approverValue]);
  useEffect(() => setAssigneeText(controls.assignee), [controls.assignee]);
  useEffect(() => setTradeText(controls.trade), [controls.trade]);
  useEffect(
    () => setReferenceNumberText(controls.referenceNumber),
    [controls.referenceNumber],
  );
  useEffect(() => setImpactNotesText(controls.impactNotes), [controls.impactNotes]);
  useEffect(
    () => setScheduleImpactText(numberText(controls.estimatedScheduleImpactDays)),
    [controls.estimatedScheduleImpactDays],
  );
  const update = (patch: Partial<ProjectControls>) => onUpdate(reviseProjectControls({
    current: controls,
    patch,
    actor: actor?.trim() || item.owner.trim() || 'Project manager',
    now: new Date().toISOString(),
  }));
  const readiness = projectControlReadiness({ ...item, projectControls: controls });
  const selectedTemplate = projectControlTemplate(item.itemType);

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [styles.headingButton, pressed && styles.pressed]}
        onPress={() => setOpen(value => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headingMain}>
          <Text style={styles.heading}>Project controls</Text>
          <Text style={styles.headingDetail}>
            {controls.assignee || item.owner.trim() || 'Unassigned'}
            {controls.trade ? ` • ${controls.trade}` : ''}
            {controls.checklist.length
              ? ` • ${readiness.completedChecks}/${readiness.totalChecks} checks`
              : ''}
          </Text>
        </View>
        <Text style={styles.expandText}>{open ? 'Hide' : 'Review'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.editor}>
          <View style={styles.workflowTemplate}>
            <View style={styles.workflowTemplateCopy}>
              <Text style={styles.workflowTemplateEyebrow}>
                {item.itemType || 'Task'} WORKFLOW
              </Text>
              <Text style={styles.workflowTemplateTitle}>
                {selectedTemplate.title}
              </Text>
              <Text style={styles.workflowTemplateDetail}>
                {selectedTemplate.purpose}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.templateButton,
                pressed && styles.pressed,
              ]}
              onPress={() => onUpdate(applyProjectControlTemplate({
                item: { ...item, projectControls: controls },
                actor: actor?.trim() || item.owner.trim() || 'Project manager',
                now: new Date().toISOString(),
              }))}
              accessibilityRole="button"
              accessibilityLabel={`Apply recommended ${item.itemType || 'Task'} setup`}
            >
              <Text style={styles.templateButtonText}>Apply recommended setup</Text>
            </Pressable>
          </View>

          <SectionTitle
            title="Accountability"
            detail="Who owns the next result and who must review it."
          />
          <Field
            label="Assigned to"
            value={assigneeText}
            onChangeText={setAssigneeText}
            onBlur={() => update({ assignee: assigneeText.trim() })}
            placeholder="Person responsible"
          />
          <Field
            label="Trade / company"
            value={tradeText}
            onChangeText={setTradeText}
            onBlur={() => update({ trade: tradeText.trim() })}
            placeholder="Trade or responsible company"
          />
          <Field
            label="Watchers"
            value={watchersText}
            onChangeText={setWatchersText}
            onBlur={() => update({ watchers: splitList(watchersText) })}
            placeholder="Names or emails, separated by commas"
          />
          <Field
            label="Approvers"
            value={approversText}
            onChangeText={setApproversText}
            onBlur={() => update({ approvers: splitList(approversText) })}
            placeholder="Required reviewers, separated by commas"
          />
          <ChoiceRow<ProjectControlApprovalStatus>
            label="Approval"
            options={PROJECT_CONTROL_APPROVAL_STATUSES}
            value={controls.approvalStatus}
            onChange={approvalStatus => update({ approvalStatus })}
          />

          <SectionTitle
            title="Workflow"
            detail="Track the response, review, and field-ready state."
          />
          <ChoiceRow<ProjectControlWorkflowStage>
            label="Workflow stage"
            options={PROJECT_CONTROL_WORKFLOW_STAGES}
            value={controls.workflowStage}
            onChange={workflowStage => update({ workflowStage })}
          />
          <Field
            label="Reference number"
            value={referenceNumberText}
            onChangeText={setReferenceNumberText}
            onBlur={() => update({ referenceNumber: referenceNumberText.trim() })}
            placeholder="RFI, submittal, inspection, or decision number"
          />
          <CrossPlatformDateField
            label="Response due date"
            value={controls.responseDueDate}
            onChange={responseDueDate => update({ responseDueDate })}
          />

          <SectionTitle
            title="Field checklist"
            detail="Reusable jobsite checks retained with this item."
          />
          {controls.checklist.map(check => (
            <View key={check.id} style={styles.recordRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.checkButton,
                  check.completed && styles.checkButtonComplete,
                  pressed && styles.pressed,
                ]}
                onPress={() => update({
                  checklist: setProjectControlChecklistCompletion({
                    items: controls.checklist,
                    itemId: check.id,
                    completed: !check.completed,
                    actor: actor?.trim() || item.owner.trim() || 'Project manager',
                    now: new Date().toISOString(),
                  }),
                })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: check.completed }}
              >
                <Text style={[
                  styles.checkMark,
                  check.completed && styles.checkMarkComplete,
                ]}>{check.completed ? '✓' : ''}</Text>
              </Pressable>
              <Text style={[
                styles.recordText,
                check.completed && styles.recordTextComplete,
              ]}>{check.label}</Text>
              <Pressable
                onPress={() => update({
                  checklist: controls.checklist.filter(item => item.id !== check.id),
                })}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${check.label}`}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <AddRow
            value={checkLabel}
            onChangeText={setCheckLabel}
            placeholder="Add a check"
            buttonLabel="Add Check"
            onAdd={() => {
              const next = createProjectControlChecklistItem({
                label: checkLabel,
                id: createLocalId('check'),
              });
              if (!next) return;
              update({ checklist: [...controls.checklist, next] });
              setCheckLabel('');
            }}
          />

          <SectionTitle
            title="Plan and resources"
            detail="Connect field work to a plan reference and the people or equipment required."
          />
          {controls.linkedRecords.map(record => (
            <RecordRow
              key={record.id}
              prefix={record.kind}
              label={record.label}
              onRemove={() => update({
                linkedRecords: controls.linkedRecords.filter(item => item.id !== record.id),
              })}
            />
          ))}
          <ChoiceRow<ProjectControlLinkedRecordKind>
            label="Record type"
            options={PROJECT_CONTROL_LINK_KINDS}
            value={linkedRecordKind}
            onChange={setLinkedRecordKind}
          />
          <AddRow
            value={linkedRecordLabel}
            onChangeText={setLinkedRecordLabel}
            placeholder="Drawing, document, photo, or schedule reference"
            buttonLabel="Link Record"
            onAdd={() => {
              const label = linkedRecordLabel.trim();
              if (!label) return;
              update({
                linkedRecords: [...controls.linkedRecords, {
                  id: createLocalId('link'),
                  kind: linkedRecordKind,
                  label,
                  revision: null,
                }],
              });
              setLinkedRecordLabel('');
            }}
          />
          {controls.resources.map(resource => (
            <RecordRow
              key={resource.id}
              prefix={resource.kind}
              label={resource.name}
              onRemove={() => update({
                resources: controls.resources.filter(item => item.id !== resource.id),
              })}
            />
          ))}
          <ChoiceRow<ProjectControlResourceKind>
            label="Resource type"
            options={PROJECT_CONTROL_RESOURCE_KINDS}
            value={resourceKind}
            onChange={setResourceKind}
          />
          <AddRow
            value={resourceName}
            onChangeText={setResourceName}
            placeholder="Person, crew, company, or equipment"
            buttonLabel="Add Resource"
            onAdd={() => {
              const name = resourceName.trim();
              if (!name) return;
              update({
                resources: [...controls.resources, {
                  id: createLocalId('resource'),
                  name,
                  kind: resourceKind,
                  allocationPercent: null,
                }],
              });
              setResourceName('');
            }}
          />

          <SectionTitle
            title="Impact"
            detail="Record schedule exposure, confidence, and mitigation. Cost and payroll are intentionally excluded from this release."
          />
          <Field
            label="Schedule impact (days)"
            value={scheduleImpactText}
            onChangeText={setScheduleImpactText}
            onBlur={() => update({
              estimatedScheduleImpactDays: optionalNumber(scheduleImpactText),
            })}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <ChoiceRow<ProjectControlImpactConfidence>
            label="Impact confidence"
            options={PROJECT_CONTROL_IMPACT_CONFIDENCE}
            value={controls.impactConfidence}
            onChange={impactConfidence => update({ impactConfidence })}
          />
          <Field
            label="Impact notes"
            value={impactNotesText}
            onChangeText={setImpactNotesText}
            onBlur={() => update({ impactNotes: impactNotesText.trim() })}
            placeholder="Assumptions, exposure, or mitigation"
            multiline
          />

          <Text style={styles.auditText}>
            Revision {controls.revision}
            {controls.updatedBy ? ` • ${controls.updatedBy}` : ''}
            {controls.updatedAt ? ` • ${formatDateTime(controls.updatedAt)}` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionHeading}>{title}</Text>
      <Text style={styles.sectionDetail}>{detail}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad';
  onBlur?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
        multiline={multiline}
        keyboardType={keyboardType}
        onBlur={onBlur}
      />
    </View>
  );
}

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.optionGrid}>
        {options.map(option => (
          <Pressable
            key={option}
            style={({ pressed }) => [
              styles.option,
              value === option && styles.optionActive,
              pressed && styles.pressed,
            ]}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option }}
          >
            <Text style={[
              styles.optionText,
              value === option && styles.optionTextActive,
            ]}>{option}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CrossPlatformDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  if (Platform.OS !== 'web') {
    return <NativeDateField label={label} value={value} onChange={onChange} />;
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {createElement('input' as any, {
        type: 'date',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        'aria-label': label,
        style: webDateStyle,
      })}
    </View>
  );
}

function AddRow({
  value,
  onChangeText,
  placeholder,
  buttonLabel,
  onAdd,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  buttonLabel: string;
  onAdd: () => void;
}) {
  return (
    <View style={styles.addRow}>
      <TextInput
        style={[styles.input, styles.addInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedText}
      />
      <Pressable
        style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        onPress={onAdd}
        accessibilityRole="button"
      >
        <Text style={styles.addButtonText}>{buttonLabel}</Text>
      </Pressable>
    </View>
  );
}

function RecordRow({
  prefix,
  label,
  onRemove,
}: {
  prefix: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <View style={styles.recordRow}>
      <Text style={styles.recordPrefix}>{prefix}</Text>
      <Text style={styles.recordText}>{label}</Text>
      <Pressable onPress={onRemove} accessibilityRole="button">
        <Text style={styles.removeText}>Remove</Text>
      </Pressable>
    </View>
  );
}

function splitList(value: string) {
  return [...new Set(value.split(',').map(part => part.trim()).filter(Boolean))];
}

function createLocalId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function numberText(value: number | null) {
  return value === null ? '' : String(value);
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const webDateStyle = {
  minHeight: 48,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  background: colors.surfaceMuted,
  color: colors.text,
  fontSize: 16,
  padding: '0 16px',
  width: '100%',
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
  container: { marginTop: spacing.md },
  headingButton: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}0A`,
    padding: spacing.md,
  },
  headingMain: { flex: 1, gap: 3 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '900' },
  headingDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  expandText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  editor: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  workflowTemplate: {
    borderWidth: 1,
    borderColor: `${colors.primary}55`,
    borderRadius: radius.md,
    backgroundColor: `${colors.primary}0D`,
    padding: spacing.md,
    gap: spacing.md,
  },
  workflowTemplateCopy: {
    gap: 4,
  },
  workflowTemplateEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  workflowTemplateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  workflowTemplateDetail: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
  },
  templateButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  templateButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '900',
  },
  summary: {
    borderWidth: 1,
    borderColor: `${colors.success}55`,
    borderRadius: radius.md,
    backgroundColor: `${colors.success}10`,
    gap: 3,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  summaryNeedsAttention: {
    borderColor: `${colors.warning}66`,
    backgroundColor: `${colors.warning}12`,
  },
  summaryTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  summaryText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  summaryWarning: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  sectionTitle: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 3,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionHeading: { color: colors.text, fontSize: 17, fontWeight: '900' },
  sectionDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  field: { gap: 6, marginTop: spacing.sm },
  label: { color: colors.text, fontSize: 14, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  multilineInput: { minHeight: 88, textAlignVertical: 'top' },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  optionText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  optionTextActive: { color: '#FFFFFF' },
  addRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs, marginTop: spacing.sm },
  addInput: { flex: 1 },
  addButton: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  addButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  recordRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  recordPrefix: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  recordText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  recordTextComplete: { color: colors.mutedText, textDecorationLine: 'line-through' },
  removeText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  checkButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 8,
  },
  checkButtonComplete: { backgroundColor: colors.success, borderColor: colors.success },
  checkMark: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  checkMarkComplete: { color: '#FFFFFF' },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexField: { flex: 1, minWidth: 180 },
  auditText: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.lg,
    textAlign: 'right',
  },
  pressed: { opacity: 0.72 },
});

// Keeps initial drafts explicit and type-safe for consumers that need a value.
export const EMPTY_PROJECT_CONTROLS = emptyProjectControls();
