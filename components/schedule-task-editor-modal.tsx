import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../theme';
import type {
  ProjectArea,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import { normalizeDateInput, parseFlexibleDate } from '../utils/date';
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
  const [taskName, setTaskName] = useState('');
  const [projectName, setProjectName] = useState(initialProjectName || projects[0] || '');
  const [locationName, setLocationName] = useState(projectAreas[0]?.name || '');
  const [startDate, setStartDate] = useState('');
  const [finishDate, setFinishDate] = useState('');
  const [milestone, setMilestone] = useState('');
  const [owner, setOwner] = useState(defaultOwner || '');
  const [contractor, setContractor] = useState('');
  const [percentComplete, setPercentComplete] = useState('0');
  const [priority, setPriority] = useState<SchedulePriority>('Medium');
  const [status, setStatus] = useState<ScheduleStatus>('Not Started');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (initialProjectName) setProjectName(initialProjectName);
    setOwner(defaultOwner || '');
  }, [defaultOwner, initialProjectName, visible]);

  const projectOptions = useMemo(() => uniqueOptions(projects), [projects]);
  const locationOptions = useMemo(() => uniqueOptions([
    ...projectAreas.map(area => area.name),
    ...scheduleItems.map(item => item.locationName),
  ]), [projectAreas, scheduleItems]);
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
    setProjectName(initialProjectName || projects[0] || '');
    setLocationName(projectAreas[0]?.name || '');
    setStartDate('');
    setFinishDate('');
    setMilestone('');
    setOwner(defaultOwner || '');
    setContractor('');
    setPercentComplete('0');
    setPriority('Medium');
    setStatus('Not Started');
    setNotes('');
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
            <Input value={taskName} onChange={setTaskName} placeholder="Example: East driveway striping" />
            <ChoiceOrText label="Project" value={projectName} onChange={setProjectName} options={projectOptions} placeholder="Project name" />
            <ChoiceOrText label="Location" value={locationName} onChange={setLocationName} options={locationOptions} placeholder="Location / work area" />

            <View style={styles.twoColumns}>
              <View style={styles.flex}>
                <Label text="Start" />
                <Input value={startDate} onChange={value => setStartDate(normalizeDateInput(value))} placeholder="MM/DD/YYYY" numeric />
              </View>
              <View style={styles.flex}>
                <NativeDateField label="Finish / Due" value={finishDate} onChange={setFinishDate} testID="new-task-finish-date" />
                <Chips values={['Today', '+7 Days', '+14 Days', '+30 Days']} selected="" onSelect={label => {
                  const days = label === 'Today' ? 0 : Number(label.match(/\d+/)?.[0] || 0);
                  setFinishDate(appDateFromToday(days));
                }} />
              </View>
            </View>

            <ChoiceOrText label="Owner" value={owner} onChange={setOwner} options={ownerOptions} placeholder="PLZ owner or internal owner" />
            <ChoiceOrText label="Contractor" value={contractor} onChange={setContractor} options={contractorOptions} placeholder="Contractor / responsible company" />
            <Label text="Percent Complete" />
            <Input value={percentComplete} onChange={value => setPercentComplete(value.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="0" numeric maxLength={3} />
            <Chips values={['0', '25', '50', '75', '100']} selected={percentComplete} onSelect={setPercentComplete} suffix="%" />
            <Label text="Priority" />
            <Chips values={PRIORITIES} selected={priority} onSelect={value => setPriority(value as SchedulePriority)} />
            <ChoiceOrText label="Milestone" value={milestone} onChange={setMilestone} options={milestoneOptions} placeholder="Optional milestone" />
            <Label text="Status" />
            <Chips values={STATUSES} selected={status} onSelect={value => setStatus(value as ScheduleStatus)} />
            <Label text="Notes" />
            <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Schedule notes, constraints, or next step." placeholderTextColor={colors.mutedText} multiline />
            <TouchableOpacity style={styles.saveButton} onPress={submit} accessibilityRole="button">
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

function Input({ value, onChange, placeholder, numeric, maxLength = 10 }: {
  value: string; onChange: (value: string) => void; placeholder: string; numeric?: boolean; maxLength?: number;
}) {
  return <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.mutedText} keyboardType={numeric ? 'number-pad' : 'default'} maxLength={numeric ? maxLength : undefined} />;
}

function ChoiceOrText({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return <View><Label text={label} /><View style={styles.choiceRow}><View style={styles.flex}><Input value={value} onChange={onChange} placeholder={placeholder} /></View><TouchableOpacity style={styles.iconButton} onPress={() => setOpen(value => !value)} accessibilityLabel={`Choose ${label}`} accessibilityState={{ expanded: open }}><Ionicons name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} color={colors.primary} /></TouchableOpacity></View>{open ? options.length ? <Chips values={options} selected={value} onSelect={option => { onChange(option); setOpen(false); }} /> : <Text style={styles.help}>No saved choices yet. Type a new value above.</Text> : null}</View>;
}

function Chips({ values, selected, onSelect, suffix = '' }: {
  values: readonly string[]; selected: string; onSelect: (value: string) => void; suffix?: string;
}) {
  return <View style={styles.chips}>{values.map(value => <TouchableOpacity key={value} style={[styles.chip, selected === value && styles.chipActive]} onPress={() => onSelect(value)}><Text style={[styles.chipText, selected === value && styles.chipTextActive]}>{value}{suffix}</Text></TouchableOpacity>)}</View>;
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
  twoColumns: { flexDirection: 'row', gap: 10 }, choiceRow: { alignItems: 'center', flexDirection: 'row', gap: 8 }, iconButton: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 48, minWidth: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }, chip: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, chipActive: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.text, fontSize: 13, fontWeight: '700' }, chipTextActive: { color: '#FFFFFF' },
  saveButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 18, minHeight: 52, paddingHorizontal: 18 }, saveText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
});
