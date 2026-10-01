import Ionicons from '@expo/vector-icons/Ionicons';
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
  ProjectUpdate,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import { PROJECT_ITEM_TYPES } from '../types';
import { useAddTaskLocation } from '../hooks/use-add-task-location';
import type { AddTaskGpsFix } from '../services/AreaSuggestion';
import { projectAreasForProject } from '../services/DAVEProjectAreaScope';
import {
  checkScheduleTaskProject,
  defaultScheduleTaskProject,
  openScheduleTaskProjects,
} from '../services/ScheduleTaskProject';
import type { DAVETaskFillPatch } from '../services/DAVETaskFieldParser';
import { applyProjectControlTemplateToControls } from '../services/ProjectControlTemplates';
import {
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
} from '../services/ScheduleProgressInvariant';
import { parseFlexibleDate } from '../utils/date';
import {
  DAVETaskFillAssistant,
  type DAVETaskFillProjectRecord,
} from './dave-task-fill-assistant';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';
import { NativeDateField } from './native-date-field';

const PRIORITIES: SchedulePriority[] = ['Low', 'Medium', 'High'];
const STATUSES: ScheduleStatus[] = ['Not Started', 'In Progress', 'Waiting', 'Complete'];
const NO_CLOSED_PROJECTS: readonly string[] = [];

export function ScheduleTaskEditorModal({
  visible,
  projects,
  closedProjects = NO_CLOSED_PROJECTS,
  projectRecords = [],
  projectAreas,
  scheduleItems,
  knownScheduleItems,
  savedUpdates,
  initialProjectName,
  initiallyGuided = false,
  defaultOwner,
  getLocationFix,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  projects: string[];
  /**
   * Closed projects (they may be on `projects` too). Add Task offers and
   * accepts open projects only (whole-app audit A3 pass 6 M1).
   */
  closedProjects?: readonly string[];
  projectRecords?: readonly DAVETaskFillProjectRecord[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  /** Every saved task and the active saved updates: Location's GPS areas are a new update's (Q31 review L3). */
  knownScheduleItems?: readonly ScheduleItem[];
  savedUpdates?: readonly ProjectUpdate[];
  initialProjectName?: string | null;
  initiallyGuided?: boolean;
  defaultOwner?: string;
  /** A new GPS fix, as a new update takes one; none (web, tests) leaves Location blank (Q31). */
  getLocationFix?: () => Promise<AddTaskGpsFix | null>;
  onClose: () => void;
  /** Returns false when the task was not saved; the form then stays open. */
  onSubmit: (item: Partial<ScheduleItem>) => false | void;
}) {
  // The project in view when it is open, otherwise the first open project:
  // a just-closed newest project is no longer the default.
  const defaultProjectName = defaultScheduleTaskProject({
    projects,
    closedProjects,
    projectInView: initialProjectName,
  });
  const [taskName, setTaskName] = useState('');
  const [itemType, setItemType] = useState<ProjectItemType>('Task');
  const [projectName, setProjectName] = useState(defaultProjectName);
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
  // Starts blank, then the area GPS places David in, until he enters his own (owner answer Q31, 1 Oct 2026).
  const location = useAddTaskLocation({
    visible, projectName, projectAreas, scheduleItems: knownScheduleItems ?? scheduleItems, updates: savedUpdates, getLocationFix,
  });
  const locationName = location.value;
  // Whether the form has been filled since it opened.
  const filledRef = useRef(false);

  // Project and owner are filled once, when the form opens. A
  // change to the project lists (the default project closed elsewhere, a new
  // project at the top) changes nothing: the form kept switching project and
  // wiping the typed location and owner. A project closed since stays in the
  // field and Save refuses it (whole-app audit A3 pass 7 L2, 30 Sep 2026).
  // Nor does the project in view: the form covers the screen, so it only
  // changes when the iPad rotates or resizes across the wide layout, which
  // switched the project and kept the old project's location (A3 pass 8 L1).
  // Closing without saving (X, Back) discards the attempt as a save does, so
  // the next Add Task opens fresh (A3 pass 9 L4).
  useEffect(() => {
    if (!visible) {
      if (filledRef.current) reset();
      filledRef.current = false;
      return;
    }
    if (filledRef.current) return;
    filledRef.current = true;
    setProjectName(defaultProjectName);
    location.reset();
    setOwner(defaultOwner || '');
  }, [
    defaultOwner,
    defaultProjectName,
    initialProjectName,
    visible,
  ]);

  const projectOptions = useMemo(
    () => uniqueOptions(openScheduleTaskProjects({ projects, closedProjects })),
    [closedProjects, projects],
  );
  // The chosen project's areas, for the Location field and the fill alike.
  const locationOptions = useMemo(
    () => projectLocationChoices(projectAreas, scheduleItems, projectName),
    [projectAreas, projectName, scheduleItems],
  );
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
  const taskFillCandidates = useMemo(() => scheduleItems.map(item => ({
    id: item.id,
    taskName: item.taskName,
    projectName: item.scheduleProjectName?.trim() || item.projectName,
    locationName: item.locationName,
    status: item.status,
    percentComplete: item.percentComplete,
  })), [scheduleItems]);

  function reset() {
    setTaskName('');
    setItemType('Task');
    setProjectName(defaultProjectName);
    location.reset();
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
    // A typed name must be an open project's; it is saved as that project's
    // exact name. A new or closed name is refused: such a task never uploads.
    const project = checkScheduleTaskProject({
      projectName,
      projects,
      closedProjects,
      projectRecords,
    });
    if (!project.ok) {
      Alert.alert(project.title, project.message);
      return;
    }
    const progress = reconcileScheduleProgress(status, percentComplete);
    const saved = onSubmit({
      taskName,
      itemType,
      projectName: project.projectName,
      locationName,
      startDate,
      finishDate,
      milestone,
      owner,
      contractor,
      percentComplete: progress.percentComplete,
      priority,
      status: progress.status,
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
    if (saved === false) return;
    reset();
    onClose();
  }

  // Returns the fill as applied: the guided questions prefill from it.
  function applyTaskFillPatch(fill: DAVETaskFillPatch): DAVETaskFillPatch {
    const patch = { ...fill };
    // A fill that changes the project keeps a location it names only when
    // it is the new project's (A3 pass 9 L1); one it names otherwise gives
    // way to the area GPS places David in there, else blank, not the first
    // area (Q31). Naming none, the change is the Project field's (Q31 review L1).
    const fillNamesLocation = patch.locationName !== undefined;
    let keepNamedLocation = fillNamesLocation;
    if (patch.projectName !== undefined && !sameName(patch.projectName, projectName)) {
      const target = patch.projectName;
      const named = projectLocationChoices(projectAreas, scheduleItems, target)
        .find(choice => sameName(choice, patch.locationName ?? ''));
      keepNamedLocation = named !== undefined;
      if (named !== undefined) {
        patch.locationName = named;
      } else if (fillNamesLocation) {
        location.reset();
        patch.locationName = location.suggestionFor(target) ?? '';
      } else {
        patch.locationName = location.changeProject(projectName, target);
      }
    }
    if (patch.taskName !== undefined) setTaskName(patch.taskName);
    if (patch.itemType !== undefined) setItemType(patch.itemType);
    if (patch.projectName !== undefined) setProjectName(patch.projectName);
    if (keepNamedLocation && patch.locationName !== undefined) location.set(patch.locationName);
    if (patch.startDate !== undefined) setStartDate(patch.startDate);
    if (patch.finishDate !== undefined) setFinishDate(patch.finishDate);
    if (patch.milestone !== undefined) setMilestone(patch.milestone);
    if (patch.owner !== undefined) setOwner(patch.owner);
    if (patch.contractor !== undefined) setContractor(patch.contractor);
    if (patch.percentComplete !== undefined || patch.status !== undefined) {
      const progress = reconcileScheduleProgressEdit(
        { status, percentComplete: Number(percentComplete) || 0 },
        {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.percentComplete !== undefined
            ? { percentComplete: patch.percentComplete }
            : {}),
        },
      );
      setPercentComplete(String(progress.percentComplete));
      setStatus(progress.status);
    }
    if (patch.priority !== undefined) setPriority(patch.priority);
    if (patch.notes !== undefined) setNotes(patch.notes);
    if (patch.nextAction !== undefined) setNextAction(patch.nextAction);
    return patch;
  }

  function updatePercentComplete(rawValue: string) {
    const value = rawValue.replace(/[^0-9]/g, '').slice(0, 3);
    setPercentComplete(value);
    if (!value) return;
    const progress = reconcileScheduleProgress(status, value);
    setStatus(progress.status);
  }

  function updateStatus(nextStatus: ScheduleStatus) {
    const progress = reconcileScheduleProgressEdit(
      { status, percentComplete: Number(percentComplete) || 0 },
      { status: nextStatus },
    );
    setStatus(progress.status);
    setPercentComplete(String(progress.percentComplete));
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

            <DAVETaskFillAssistant
              active={visible}
              initiallyGuided={initiallyGuided}
              projectNames={projectOptions}
              projectRecords={projectRecords}
              locationNames={locationOptions}
              locationNamesForProject={name => projectLocationChoices(projectAreas, scheduleItems, name)}
              ownerNames={ownerOptions}
              contractorNames={contractorOptions}
              milestoneNames={milestoneOptions}
              taskCandidates={taskFillCandidates}
              currentValues={{
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
              }}
              onApply={applyTaskFillPatch}
            />

            <Label text="Task or milestone" />
            <Input accessibilityLabel="Task or milestone" value={taskName} onChange={setTaskName} placeholder="Example: East driveway striping" />
            <Label text="Project item type" />
            <Chips values={PROJECT_ITEM_TYPES} selected={itemType} onSelect={value => setItemType(value as ProjectItemType)} />
            <ChoiceOrText
              label="Project"
              value={projectName}
              onChange={value => {
                location.changeProject(projectName, value); // his entry stays unless it is the old project's area (Q31 review L1)
                setProjectName(value);
              }}
              options={projectOptions}
              placeholder="Project name"
            />
            <ChoiceOrText label="Location" value={locationName} onChange={location.set} options={locationOptions} placeholder="Location / work area" />
            {location.suggested ? <Text style={styles.help}>Suggested from your location</Text> : null}

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
            <Input accessibilityLabel="Percent Complete" value={percentComplete} onChange={updatePercentComplete} placeholder="0" numeric maxLength={3} />
            <Chips values={['0', '25', '50', '75', '100']} selected={percentComplete} onSelect={updatePercentComplete} suffix="%" />
            <Label text="Priority" />
            <Chips values={PRIORITIES} selected={priority} onSelect={value => setPriority(value as SchedulePriority)} />
            <ChoiceOrText label="Milestone" value={milestone} onChange={setMilestone} options={milestoneOptions} placeholder="Optional milestone" />
            <Label text="Status" />
            <Chips values={STATUSES} selected={status} onSelect={value => updateStatus(value as ScheduleStatus)} />
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

function sameName(a: string, b: string) {
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

// A project's areas and the locations its tasks use (every one with no project).
function projectLocationChoices(projectAreas: ProjectArea[], scheduleItems: ScheduleItem[], projectName: string) {
  const target = projectName.trim().toLowerCase();
  return uniqueOptions([
    ...projectAreasForProject({ projectAreas, projectName, scheduleItems }).map(area => area.name),
    ...scheduleItems
      .filter(item => !target || (item.scheduleProjectName?.trim() || item.projectName.trim()).toLowerCase() === target)
      .map(item => item.locationName),
  ]);
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
