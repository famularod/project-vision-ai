import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type {
  ProjectItemType,
  ProjectArea,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import { PROJECT_ITEM_TYPES } from '../types';
import { projectAreasForProject } from '../services/DAVEProjectAreaScope';
import { applyProjectControlTemplateToControls } from '../services/ProjectControlTemplates';
import { parseFlexibleDate } from '../utils/date';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';
import { NativeDateField } from './native-date-field';

const PRIORITIES: SchedulePriority[] = ['Low', 'Medium', 'High'];
const STATUSES: ScheduleStatus[] = ['Not Started', 'In Progress', 'Waiting', 'Complete'];

export function ScheduleTaskEditorModal({
  visible,
  projects,
  projectAreas,
  scheduleItems,
  initialProjectName,
  defaultOwner,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  projects: string[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  initialProjectName?: string | null;
  defaultOwner?: string;
  onClose: () => void;
  onSubmit: (item: Partial<ScheduleItem>) => void;
}) {
  const defaultProjectName = initialProjectName || projects[0] || '';
  const defaultProjectAreas = projectAreasForProject({
    projectAreas,
    projectName: defaultProjectName,
    scheduleItems,
  });
  const [taskName, setTaskName] = useState('');
  const [itemType, setItemType] = useState<ProjectItemType>('Task');
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [locationName, setLocationName] = useState(defaultProjectAreas[0]?.name || '');
  const [startDate, setStartDate] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [milestone, setMilestone] = useState('');
  const [owner, setOwner] = useState(defaultOwner || '');
  const [contractor, setContractor] = useState('');
  const [percentComplete, setPercentComplete] = useState('0');
  const [priority, setPriority] = useState<SchedulePriority>('Medium');
  const [status, setStatus] = useState<ScheduleStatus>('Not Started');
  const [notes, setNotes] = useState('');
  const [nextAction, setNextAction] = useState('');
  const wasVisibleRef = useRef(false);
  const initializedProjectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      initializedProjectRef.current = null;
      return;
    }

    const normalizedInitialProject = defaultProjectName.trim().toLowerCase();
    const opened = !wasVisibleRef.current;
    const initialScopeChanged =
      initializedProjectRef.current !== normalizedInitialProject;
    wasVisibleRef.current = true;

    if (!opened && !initialScopeChanged) return;

    initializedProjectRef.current = normalizedInitialProject;
    setProjectName(defaultProjectName);
    setLocationName(defaultProjectAreas[0]?.name || '');
    setOwner(defaultOwner || '');
  }, [
    defaultOwner,
    defaultProjectAreas,
    defaultProjectName,
    visible,
  ]);

  const projectOptions = useMemo(() => uniqueOptions(projects), [projects]);
  const scopedProjectAreas = useMemo(() => projectAreasForProject({
    projectAreas,
    projectName,
    scheduleItems,
  }), [projectAreas, projectName, scheduleItems]);
  const scopedScheduleItems = useMemo(() => {
    const target = projectName.trim().toLowerCase();
    if (!target) return scheduleItems;
    return scheduleItems.filter(item =>
      (item.scheduleProjectName?.trim() || item.projectName.trim()).toLowerCase() === target,
    );
  }, [projectName, scheduleItems]);
  const locationOptions = useMemo(() => uniqueOptions([
    ...scopedProjectAreas.map(area => area.name),
    ...scopedScheduleItems.map(item => item.locationName),
  ]), [scopedProjectAreas, scopedScheduleItems]);
  const ownerOptions = useMemo(() => uniqueOptions([
    defaultOwner || '',
    ...scheduleItems.map(item => item.owner),
  ]), [defaultOwner, scheduleItems]);
  const contractorOptions = useMemo(
    () => uniqueOptions(scheduleItems.map(item => item.contractor)),
    [scheduleItems],
  );
  const milestoneOptions = useMemo(
    () => uniqueOptions(scheduleItems.map(item => item.milestone)),
    [scheduleItems],
  );

  function reset() {
    setTaskName('');
    setItemType('Task');
    setProjectName(defaultProjectName);
    setLocationName(defaultProjectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('');
    setOwner(defaultOwner || '');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes('');
    setNextAction('');
  }

  function submit() {
    if (!taskName.trim()) {
      Alert.alert('Task needed', 'Enter the task or milestone first.');
      return;
    }
    if (finishDate.trim() && !parseFlexibleDate(finishDate)) {
      Alert.alert('Invalid finish date', 'Use MM/DD/YYYY for the finish or due date.');
      return;
    }
    if (startDate.trim() && !parseFlexibleDate(startDate)) {
      Alert.alert('Invalid start date', 'Use MM/DD/YYYY for the start date.');
      return;
    }
    onSubmit({
      taskName,
      itemType,
      projectName,
      locationName,
      startDate,
      finishDate,
      milestone,
      owner,
      contractor,
      percentComplete: Number(percentComplete) || 0,
      priority,
      status,
      notes,
      nextAction,
      projectControls: itemType === 'Task'
        ? null
        : applyProjectControlTemplateToControls({
            itemType,
            actor: owner.trim() || defaultOwner?.trim() || 'Project manager',
            now: new Date().toISOString(),
          }),
    });
    reset();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingModalCard
          containerStyle={styles.keyboard}
          frameStyle={styles.scroll}
          contentContainerStyle={styles.content}
        >
          <View style={styles.panel}>
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text style={styles.title}>Add Task</Text>
                <Text style={styles.help}>Choose an existing value or type a new one.</Text>
              </View>
              <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Close Add Task">
                <Ionicons name="close-outline" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Label text="Task or milestone" />
            <Input accessibilityLabel="Task or milestone" value={taskName} onChange={setTaskName} placeholder="Example: East driveway striping" />
            <Label text="Project item type" />
            <Chips values={PROJECT_ITEM_TYPES} selected={itemType} onSelect={value => setItemType(value as ProjectItemType)} />
            <ChoiceOrText
              label="Project"
              value={projectName}
              onChange={value => {
                setProjectName(value);
                const nextAreas = projectAreasForProject({
                  projectAreas,
                  projectName: value,
                  scheduleItems,
                });
                setLocationName(nextAreas[0]?.name || '');
              }}
              options={projectOptions}
              placeholder="Project name"
            />
            <ChoiceOrText label="Location" value={locationName} onChange={setLocationName} options={locationOptions} placeholder="Location / work area" />

            <View style={styles.twoColumns}>
              <View style={styles.dateColumn}>
                <NativeDateField label="Start Date" value={startDate} onChange={setStartDate} testID="new-task-start-date" />
              </View>
              <View style={styles.dateColumn}>
                <NativeDateField label="Finish / Due Date" value={finishDate} onChange={setFinishDate} testID="new-task-finish-date" />
                <Chips values={['Today', '+7 Days', '+14 Days', '+30 Days']} selected="" selectionMode="button" onSelect={label => {
                  const days = label === 'Today' ? 0 : Number(label.match(/\d+/)?.[0] || 0);
                  setFinishDate(appDateFromToday(days));
                }} />
              </View>
            </View>

            <ChoiceOrText label="Owner" value={owner} onChange={setOwner} options={ownerOptions} placeholder="PLZ owner or internal owner" />
            <ChoiceOrText label="Contractor" value={contractor} onChange={setContractor} options={contractorOptions} placeholder="Contractor / responsible company" />
            <Label text="Percent Complete" />
            <Input accessibilityLabel="Percent Complete" value={percentComplete} onChange={value => setPercentComplete(value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="0" numeric maxLength={3} />
            <Chips values={['0', '25', '50', '75', '100']} selected={percentComplete} onSelect={setPercentComplete} suffix="%" />
            <Label text="Priority" />
            <Chips values={PRIORITIES} selected={priority} onSelect={value => setPriority(value as SchedulePriority)} />
            <ChoiceOrText label="Milestone" value={milestone} onChange={setMilestone} options={milestoneOptions} placeholder="Optional milestone" />
            <Label text="Status" />
            <Chips values={STATUSES} selected={status} onSelect={value => setStatus(value as ScheduleStatus)} />
            <Label text="Next action" />
            <Input accessibilityLabel="Next action" value={nextAction} onChange={setNextAction} placeholder="Smallest accountable next step" />
            <Label text="Notes" />
            <TextInput accessibilityLabel="Notes" style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Schedule notes, constraints, or next step." placeholderTextColor={colors.mutedText} multiline />
            <TouchableOpacity style={styles.saveButton} onPress={submit} accessibilityRole="button" accessibilityLabel="Save Task">
              <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
              <Text style={styles.saveText}>Save Task</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingModalCard>
      </SafeAreaView>
    </Modal>
  );
}

function Label({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>;
}

function Input({ accessibilityLabel, value, onChange, placeholder, numeric, maxLength = 10 }: {
  accessibilityLabel: string; value: string; onChange: (value: string) => void; placeholder: string; numeric?: boolean; maxLength?: number;
}) {
  return <TextInput accessibilityLabel={accessibilityLabel} style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.mutedText} keyboardType={numeric ? 'number-pad' : 'default'} maxLength={numeric ? maxLength : undefined} />;
}

function ChoiceOrText({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return <View><Label text={label} /><View style={styles.choiceRow}><View style={styles.flex}><Input accessibilityLabel={label} value={value} onChange={onChange} placeholder={placeholder} /></View><TouchableOpacity style={styles.iconButton} onPress={() => setOpen(value => !value)} accessibilityRole="button" accessibilityLabel={`Choose ${label}`} accessibilityState={{ expanded: open }}><Ionicons name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} color={colors.primary} /></TouchableOpacity></View>{open ? options.length ? <Chips values={options} selected={value} onSelect={option => { onChange(option); setOpen(false); }} /> : <Text style={styles.help}>No saved choices yet. Type a new value above.</Text> : null}</View>;
}

function Chips({ values, selected, onSelect, suffix = '', selectionMode = 'radio' }: {
  values: readonly string[]; selected: string; onSelect: (value: string) => void; suffix?: string; selectionMode?: 'radio' | 'button';
}) {
  return <View style={styles.chips}>{values.map(value => {
    const isSelected = selected === value;
    return <TouchableOpacity
      key={value}
      style={[styles.chip, isSelected && styles.chipActive]}
      onPress={() => onSelect(value)}
      accessibilityRole={selectionMode === 'radio' ? 'radio' : 'button'}
      accessibilityLabel={`${value}${suffix}`}
      accessibilityState={selectionMode === 'radio' ? { selected: isSelected } : undefined}
    ><Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{value}{suffix}</Text></TouchableOpacity>;
  })}</View>;
}

function uniqueOptions(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function appDateFromToday(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 }, keyboard: { flex: 1 }, scroll: { flex: 1 }, content: { alignSelf: 'center', maxWidth: 840, padding: 16, width: '100%' },
  panel: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' }, flex: { flex: 1 }, title: { color: colors.text, fontSize: 22, fontWeight: '800' }, help: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 4 },
  label: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 }, notes: { minHeight: 112, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, dateColumn: { flexBasis: 260, flexGrow: 1, minWidth: 0 }, choiceRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, iconButton: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 48, minWidth: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }, chip: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 44, paddingHorizontal: 11, paddingVertical: 8 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.text, fontSize: 13, fontWeight: '700' }, chipTextActive: { color: '#FFFFFF' },
  saveButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 18, minHeight: 52, paddingHorizontal: 18 }, saveText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
});
