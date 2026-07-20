import { Link, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SCHEDULE_PRIORITIES,
  SCHEDULE_STATUSES,
  type ProjectUpdate,
  type ReferenceDocument,
  type ScheduleItem,
  type SchedulePriority,
  type ScheduleStatus,
  type UpdatePhoto,
} from '../../types';
import type { CloudProject, CloudProjectUpdate } from '../../services/SupabaseService';
import { DAVEWebTaskMutationError } from '../../services/DAVEWebSupabaseClient';
import {
  buildDAVEWebScheduleItem,
  createDAVEWebTaskId,
  DAVEWebTaskValidationError,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import {
  scheduleTaskIsComplete,
  scheduleTasksForParentProject,
} from '../../services/dave-project-schedule-rollup';
import { scheduleProjectScopeNames } from '../../services/PIEScheduleImportBatch';
import { colors, spacing } from '../../theme';
import { daysUntilDate } from '../../utils/date';
import { useDesktopAuth } from './desktop-auth-provider';
import {
  desktopNavigationItems,
  desktopRouteIsActive,
  type DesktopNavigationItem,
  type DesktopReadOnlyPage,
} from './desktop-navigation';

type ReadOnlyPageCopy = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>;

const PAGE_COPY: Record<DesktopReadOnlyPage, ReadOnlyPageCopy> = {
  overview: {
    eyebrow: 'DESKTOP PILOT',
    title: 'DAVE Command Center',
    description: 'A secure, owner-authorized view of the field record with controlled task editing.',
  },
  projects: {
    eyebrow: 'PROJECTS',
    title: 'Authorized projects',
    description: 'Review active projects without changing field data.',
  },
  tasks: {
    eyebrow: 'TASKS & SCHEDULE',
    title: 'Schedule workspace',
    description: 'Create, edit, and safely delete tasks while preserving shared project authority.',
  },
  evidence: {
    eyebrow: 'DAVE EVIDENCE',
    title: 'Field evidence',
    description: 'Review source-backed field updates and their project and area context.',
  },
  photos: {
    eyebrow: 'PHOTOS',
    title: 'Photo evidence',
    description: 'Review authorized photo evidence metadata without changing or downloading source files.',
  },
  documents: {
    eyebrow: 'DOCUMENTS',
    title: 'Project document library',
    description: 'Review authorized document metadata, versions, and import status.',
  },
  reports: {
    eyebrow: 'REPORTS',
    title: 'Report readiness',
    description: 'Review the cloud evidence available to reports; generation and approval remain disabled.',
  },
  settings: {
    eyebrow: 'SETTINGS',
    title: 'Account and cloud sync',
    description: 'Review the browser connection and keep this task-editing workspace aligned with the shared cloud record.',
  },
};

export function DesktopReadOnlyShell({ page }: { page: DesktopReadOnlyPage }) {
  const auth = useDesktopAuth();

  if (auth.phase !== 'ready' || !auth.snapshot) {
    return <DesktopSessionGate />;
  }

  return <AuthorizedDesktopWorkspace page={page} />;
}

function DesktopSessionGate() {
  const auth = useDesktopAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const checking = auth.phase === 'checking' || auth.phase === 'loading';
  const submitting = auth.phase === 'signing_in';

  const submit = async () => {
    if (!email.trim() || !password || submitting) return;
    const accepted = await auth.signInWithPassword(email, password);
    if (accepted) setPassword('');
  };

  return (
    <ScrollView style={styles.gateRoot} contentContainerStyle={styles.gateContent}>
      <View style={styles.gateBrandRow}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
        <View>
          <Text style={styles.brandName}>DAVE</Text>
          <Text style={styles.brandSubtitle}>Project Vision AI</Text>
        </View>
      </View>
      <View style={styles.gateCard}>
        <Text style={styles.eyebrow}>SECURE DESKTOP PILOT</Text>
        <Text style={styles.gateTitle}>Sign in to your authorized workspace</Text>
        <Text style={styles.description}>
          Access is verified by the server before any project record is loaded. Task editing is enabled in this staging pilot; project deletion, uploads, approvals, and sending remain disabled.
        </Text>

        {checking ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.mutedText}>Checking the browser session…</Text>
          </View>
        ) : (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                inputMode="email"
                placeholder="name@example.com"
                placeholderTextColor="#8A909C"
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Email"
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                secureTextEntry
                placeholder="Password"
                placeholderTextColor="#8A909C"
                style={styles.input}
                editable={!submitting}
                accessibilityLabel="Password"
                onSubmitEditing={() => { void submit(); }}
              />
            </View>
            {auth.message ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text style={styles.errorText}>{auth.message}</Text>
              </View>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (!email.trim() || !password || submitting) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              disabled={!email.trim() || !password || submitting}
              onPress={() => { void submit(); }}
              accessibilityRole="button"
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Sign in securely</Text>}
            </Pressable>
          </>
        )}
        <Text style={styles.sessionNote}>
          The session is limited to this browser tab and is removed when the tab closes or you sign out.
        </Text>
      </View>
    </ScrollView>
  );
}

function AuthorizedDesktopWorkspace({ page }: { page: DesktopReadOnlyPage }) {
  const auth = useDesktopAuth();
  const pathname = usePathname();
  const router = useRouter();
  const params = useLocalSearchParams<{ project?: string | string[] }>();
  const { width } = useWindowDimensions();
  const usesSidebar = width >= 900;
  const snapshot = auth.snapshot!;
  const projectNames = useMemo(
    () => snapshot.projects.map(project => project.name).filter(Boolean),
    [snapshot.projects],
  );
  const requestedProject = Array.isArray(params.project) ? params.project[0] : params.project;
  const selectedProject = requestedProject && projectNames.includes(requestedProject)
    ? requestedProject
    : null;
  const copy = PAGE_COPY[page];

  const selectProject = (projectName: string | null) => {
    router.setParams(projectName ? { project: projectName } : { project: undefined });
  };

  return (
    <View style={[styles.root, usesSidebar && styles.rootWide]}>
      {usesSidebar ? <DesktopSidebar pathname={pathname} selectedProject={selectedProject} /> : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {!usesSidebar ? <DesktopTopNavigation pathname={pathname} selectedProject={selectedProject} /> : null}
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow} accessibilityRole="header">{copy.eyebrow}</Text>
            <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
            <Text style={styles.description}>{copy.description}</Text>
          </View>
          <View style={styles.accountPanel}>
            <View style={styles.readOnlyBadge} accessibilityLabel="Controlled task editing pilot">
              <Text style={styles.readOnlyBadgeText}>TASK EDITING</Text>
            </View>
            <Text style={styles.accountEmail} numberOfLines={1}>{auth.userEmail}</Text>
            <Pressable onPress={() => { void auth.signOutOfDesktop(); }} accessibilityRole="button">
              <Text style={styles.textButton}>Sign out</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.safetyBanner} accessibilityRole="alert">
          <Text style={styles.safetyTitle}>Owner-authorized staging session</Text>
          <Text style={styles.safetyDetail}>
            Task creation, editing, and tombstone-protected deletion are enabled. Project deletion, file uploads, report approval, and sending remain disabled.
          </Text>
        </View>

        <View style={styles.filterPanel}>
          <View style={styles.filterHeadingRow}>
            <View>
              <Text style={styles.cardTitle}>Project scope</Text>
              <Text style={styles.mutedText}>{selectedProject ?? 'All authorized projects'}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              onPress={() => { void auth.refreshSnapshot(); }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Refresh</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectChoices}>
            <ProjectChoice label="All projects" active={!selectedProject} onPress={() => selectProject(null)} />
            {projectNames.map(projectName => (
              <ProjectChoice
                key={projectName}
                label={projectName}
                active={selectedProject === projectName}
                onPress={() => selectProject(projectName)}
              />
            ))}
          </ScrollView>
        </View>

        <DesktopPageData page={page} selectedProject={selectedProject} />
        <Text style={styles.refreshNote}>
          Last refreshed {formatDateTime(snapshot.refreshedAt)}. Session expires {formatSessionExpiry(auth.sessionExpiresAt)}.
        </Text>
      </ScrollView>
    </View>
  );
}

function DesktopPageData({
  page,
  selectedProject,
}: {
  page: DesktopReadOnlyPage;
  selectedProject: string | null;
}) {
  const auth = useDesktopAuth();
  const { snapshot } = auth;
  if (!snapshot) return null;

  const projects = snapshot.projects.filter(project => matchesProject(project.name, selectedProject));
  const selectedScopes = selectedProject
    ? scheduleProjectScopeNames(selectedProject, [...snapshot.scheduleItems])
    : [];
  const tasks = selectedProject
    ? scheduleTasksForParentProject(selectedProject, [...snapshot.scheduleItems])
    : snapshot.scheduleItems;
  const updates = snapshot.projectUpdates.filter(update => matchesProjectScope(update.projectName, selectedScopes));
  const documents = snapshot.referenceDocuments.filter(document => matchesProjectScope(document.projectName, selectedScopes));
  const photos = updates.flatMap(update => update.updateData.photos.map(photo => ({ update, photo })));
  const completedTasks = tasks.filter(taskIsComplete);
  const openTaskCount = tasks.length - completedTasks.length;

  if (page === 'overview') {
    return (
      <>
        <View style={styles.metricGrid}>
          <MetricCard label="Active projects" value={projects.length} />
          <MetricCard label="Total tasks" value={tasks.length} />
          <MetricCard label="Complete tasks" value={completedTasks.length} />
          <MetricCard label="Open tasks" value={openTaskCount} />
          <MetricCard label="Field updates" value={updates.length} />
          <MetricCard label="Documents" value={documents.length} />
        </View>
        <View style={styles.accountingBanner} accessibilityRole="summary">
          <Text style={styles.accountingTitle}>Cloud task accounting</Text>
          <Text style={styles.accountingDetail}>
            {tasks.length} total = {completedTasks.length} complete + {openTaskCount} open. Deleted tasks, unsafe legacy rows, superseded imports, and prior schedule versions are excluded.
          </Text>
        </View>
        <Section title="Current attention" detail="Incomplete and overdue work appears first.">
          <TaskList tasks={tasks.filter(task => !taskIsComplete(task)).slice(0, 12)} />
        </Section>
        <Section title="Recent field evidence" detail="Latest authorized updates from the shared cloud record.">
          <EvidenceList updates={updates.slice(0, 8)} />
        </Section>
      </>
    );
  }

  if (page === 'projects') {
    return (
      <Section title={`${projects.length} authorized project${projects.length === 1 ? '' : 's'}`} detail="Archived projects are excluded from the pilot.">
        <View style={styles.cardGrid}>
          {projects.map(project => <ProjectCard key={project.id ?? project.name} project={project} tasks={tasks} updates={updates} />)}
          {projects.length === 0 ? <EmptyState text="No authorized active projects match this scope." /> : null}
        </View>
      </Section>
    );
  }

  if (page === 'tasks') {
    return (
      <TaskEditingWorkspace
        tasks={sortTasksForReview(tasks) as DAVEWebScheduleItem[]}
        projects={snapshot.projects.map(project => project.name)}
        selectedProject={selectedProject}
      />
    );
  }

  if (page === 'evidence') {
    return (
      <Section title={`${updates.length} field update${updates.length === 1 ? '' : 's'}`} detail="Newest source-backed updates appear first.">
        <EvidenceList updates={updates} />
      </Section>
    );
  }

  if (page === 'photos') {
    return (
      <Section title={`${photos.length} photo record${photos.length === 1 ? '' : 's'}`} detail="Metadata is shown without exposing private storage paths or enabling downloads.">
        <PhotoList photos={photos} />
      </Section>
    );
  }

  if (page === 'documents') {
    return (
      <Section title={`${documents.length} document${documents.length === 1 ? '' : 's'}`} detail="Document uploads and downloads remain disabled during the read-only pilot.">
        <DocumentList documents={documents} />
      </Section>
    );
  }

  if (page === 'settings') {
    return (
      <>
        <Section title="Cloud connection" detail="This browser reads the owner-authorized cloud record and can modify schedule tasks only.">
          <View style={styles.cardGrid}>
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Signed-in account</Text>
              <Text style={styles.dataDetail}>{auth.userEmail || 'Authorized account'}</Text>
              <StatusBadge label="Owner verified" tone="good" />
            </View>
            <View style={styles.dataCard}>
              <Text style={styles.cardTitle}>Last cloud refresh</Text>
              <Text style={styles.dataDetail}>{formatDateTime(snapshot.refreshedAt)}</Text>
              <StatusBadge label="Task editing enabled" tone="attention" />
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, styles.syncButton, pressed && styles.buttonPressed]}
            onPress={() => { void auth.refreshSnapshot(); }}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Sync from Cloud Now</Text>
          </Pressable>
        </Section>
        <View style={styles.syncBoundaryBanner} accessibilityRole="alert">
          <Text style={styles.syncBoundaryTitle}>What this sync does</Text>
          <Text style={styles.syncBoundaryDetail}>
            The website pulls the latest cloud records automatically every 12 seconds while open. Task changes made here save directly to the shared cloud record. A change that still exists only on an iPhone or iPad must be uploaded with Sync Now on that device first.
          </Text>
        </View>
      </>
    );
  }

  return (
    <>
      <View style={styles.metricGrid}>
        <MetricCard label="Projects in scope" value={projects.length} />
        <MetricCard label="Tasks available" value={tasks.length} />
        <MetricCard label="Evidence records" value={updates.length} />
        <MetricCard label="Photo records" value={photos.length} />
      </View>
      <Section title="Report boundary" detail="The current cloud sync contract does not store approved report artifacts as an owner-scoped collection.">
        <EmptyState text="Report generation, editing, approval, distribution, and audit history remain unavailable until the Phase 4 mutation and retention review." />
      </Section>
    </>
  );
}

function ProjectChoice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, active && styles.choiceActive, pressed && styles.buttonPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.sectionDetail}>{detail}</Text>
      {children}
    </View>
  );
}

function ProjectCard({
  project,
  tasks,
  updates,
}: {
  project: CloudProject;
  tasks: readonly ScheduleItem[];
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
}) {
  const projectTasks = scheduleTasksForParentProject(project.name, [...tasks]);
  const projectScopes = scheduleProjectScopeNames(project.name, [...tasks]);
  const completed = projectTasks.filter(taskIsComplete).length;
  return (
    <View style={styles.dataCard}>
      <Text style={styles.dataTitle}>{project.name}</Text>
      <Text style={styles.dataMeta}>{project.status ?? 'Active'} · {completed} of {projectTasks.length} tasks complete</Text>
      <Text style={styles.dataDetail}>{updates.filter(update => matchesProjectScope(update.projectName, projectScopes)).length} field updates</Text>
    </View>
  );
}

type TaskFormState = Omit<DAVEWebTaskDraft, 'percentComplete'> & {
  percentComplete: string;
};

function TaskEditingWorkspace({
  tasks,
  projects,
  selectedProject,
}: {
  tasks: readonly DAVEWebScheduleItem[];
  projects: readonly string[];
  selectedProject: string | null;
}) {
  const auth = useDesktopAuth();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DAVEWebScheduleItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DAVEWebScheduleItem | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const projectOptions = uniqueOptions([
    ...(selectedProject ? [selectedProject] : []),
    ...projects,
    ...tasks.map(task => task.scheduleProjectName || task.projectName),
  ]);
  const locationOptions = uniqueOptions(tasks.map(task => task.locationName));
  const ownerOptions = uniqueOptions(tasks.map(task => task.owner));
  const contractorOptions = uniqueOptions(tasks.map(task => task.contractor));

  const openCreate = () => {
    setEditingTask(null);
    setDeleteCandidate(null);
    setNotice(null);
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduleItem) => {
    setEditingTask(task as DAVEWebScheduleItem);
    setDeleteCandidate(null);
    setNotice(null);
    setEditorOpen(true);
  };

  const saveTask = async (draft: DAVEWebTaskDraft) => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const item = buildDAVEWebScheduleItem({
        draft,
        current: editingTask,
        id: editingTask?.id ?? createDAVEWebTaskId(),
        now: new Date().toISOString(),
        actor: auth.userEmail || 'Project manager',
      });
      if (editingTask) await auth.updateTask(item);
      else await auth.createTask(item);
      setEditorOpen(false);
      setEditingTask(null);
      setNotice({
        tone: 'good',
        text: editingTask ? 'Task updated and synced to the cloud.' : 'Task created and synced to the cloud.',
      });
    } catch (error) {
      if (
        error instanceof DAVEWebTaskMutationError &&
        (error.code === 'conflict' || error.code === 'deleted' || error.code === 'not_found')
      ) {
        await auth.refreshSnapshot().catch(() => undefined);
      }
      setNotice({ tone: 'danger', text: taskMutationMessage(error) });
    } finally {
      setPending(false);
    }
  };

  const deleteTask = async () => {
    if (!deleteCandidate || pending) return;
    setPending(true);
    setNotice(null);
    try {
      await auth.deleteTask(deleteCandidate);
      setDeleteCandidate(null);
      setNotice({ tone: 'good', text: 'Task deleted and protected from returning on another device.' });
    } catch (error) {
      if (error instanceof DAVEWebTaskMutationError) {
        await auth.refreshSnapshot().catch(() => undefined);
      }
      setNotice({ tone: 'danger', text: taskMutationMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Section
      title={`${tasks.length} schedule item${tasks.length === 1 ? '' : 's'}`}
      detail="Task changes save directly to the owner-authorized cloud record and appear on active mobile devices within the shared refresh window."
    >
      <View style={styles.taskActionRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.addTaskButton, pressed && styles.buttonPressed]}
          onPress={openCreate}
          disabled={pending}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>+ Add Task</Text>
        </Pressable>
        <Text style={styles.taskSyncHint}>Automatic cloud refresh: every 12 seconds</Text>
      </View>

      {notice ? (
        <View style={notice.tone === 'good' ? styles.successBanner : styles.errorBanner} accessibilityRole="alert">
          <Text style={notice.tone === 'good' ? styles.successText : styles.errorText}>{notice.text}</Text>
        </View>
      ) : null}

      {deleteCandidate ? (
        <View style={styles.deleteConfirm} accessibilityRole="alert">
          <View style={styles.dataGrow}>
            <Text style={styles.deleteConfirmTitle}>Delete “{deleteCandidate.taskName}”?</Text>
            <Text style={styles.dataDetail}>A permanent deletion marker prevents this task from returning after another device syncs.</Text>
          </View>
          <View style={styles.inlineButtons}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              onPress={() => setDeleteCandidate(null)}
              disabled={pending}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
              onPress={() => { void deleteTask(); }}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Delete Task</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      {editorOpen ? (
        <TaskEditor
          key={editingTask?.id ?? 'new-task'}
          task={editingTask}
          defaultProject={selectedProject || projectOptions[0] || ''}
          projectOptions={projectOptions}
          locationOptions={locationOptions}
          ownerOptions={ownerOptions}
          contractorOptions={contractorOptions}
          pending={pending}
          onCancel={() => {
            if (pending) return;
            setEditorOpen(false);
            setEditingTask(null);
          }}
          onSave={saveTask}
        />
      ) : null}

      <TaskList
        tasks={tasks}
        onEdit={openEdit}
        onDelete={task => {
          setEditorOpen(false);
          setEditingTask(null);
          setNotice(null);
          setDeleteCandidate(task as DAVEWebScheduleItem);
        }}
      />
    </Section>
  );
}

function TaskEditor({
  task,
  defaultProject,
  projectOptions,
  locationOptions,
  ownerOptions,
  contractorOptions,
  pending,
  onCancel,
  onSave,
}: {
  task: DAVEWebScheduleItem | null;
  defaultProject: string;
  projectOptions: readonly string[];
  locationOptions: readonly string[];
  ownerOptions: readonly string[];
  contractorOptions: readonly string[];
  pending: boolean;
  onCancel: () => void;
  onSave: (draft: DAVEWebTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskFormState>(() => taskFormState(task, defaultProject));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  const updateField = <K extends keyof TaskFormState,>(key: K, value: TaskFormState[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
  };

  const submit = async () => {
    setValidationMessage(null);
    const percentComplete = Number(draft.percentComplete);
    if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
      setValidationMessage('Percent complete must be a number from 0 to 100.');
      return;
    }
    try {
      await onSave({ ...draft, percentComplete });
    } catch (error) {
      setValidationMessage(taskMutationMessage(error));
    }
  };

  return (
    <View style={styles.editorCard}>
      <Text style={styles.editorTitle}>{task ? 'Edit Task' : 'Add Task'}</Text>
      <Text style={styles.sectionDetail}>Choose an existing value when available, or type the correct value manually.</Text>

      <LabeledTextField label="Task name" value={draft.taskName} onChangeText={value => updateField('taskName', value)} />
      <ChoiceOrTypeField label="Project" value={draft.projectName} options={projectOptions} onChange={value => updateField('projectName', value)} />
      <ChoiceOrTypeField label="Location / area" value={draft.locationName} options={locationOptions} onChange={value => updateField('locationName', value)} optional />

      <View style={styles.twoColumnFields}>
        <View style={styles.flexField}>
          <LabeledTextField label="Start date" value={draft.startDate} onChangeText={value => updateField('startDate', value)} placeholder="YYYY-MM-DD" optional />
        </View>
        <View style={styles.flexField}>
          <LabeledTextField label="Finish / due date" value={draft.finishDate} onChangeText={value => updateField('finishDate', value)} placeholder="YYYY-MM-DD" optional />
        </View>
      </View>

      <ChoiceOrTypeField label="Owner" value={draft.owner} options={ownerOptions} onChange={value => updateField('owner', value)} optional />
      <ChoiceOrTypeField label="Contractor" value={draft.contractor} options={contractorOptions} onChange={value => updateField('contractor', value)} optional />
      <LabeledTextField label="Milestone" value={draft.milestone} onChangeText={value => updateField('milestone', value)} optional />

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Status</Text>
        <OptionButtons<ScheduleStatus>
          options={SCHEDULE_STATUSES}
          value={draft.status}
          onChange={value => updateField('status', value)}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Priority</Text>
        <OptionButtons<SchedulePriority>
          options={SCHEDULE_PRIORITIES}
          value={draft.priority}
          onChange={value => updateField('priority', value)}
        />
      </View>
      <LabeledTextField
        label="Percent complete"
        value={draft.percentComplete}
        onChangeText={value => updateField('percentComplete', value)}
        placeholder="0"
        numeric
      />
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes <Text style={styles.optionalLabel}>(optional)</Text></Text>
        <TextInput
          value={draft.notes}
          onChangeText={value => updateField('notes', value)}
          multiline
          numberOfLines={4}
          placeholder="Jobsite note"
          placeholderTextColor="#8A909C"
          style={[styles.input, styles.notesInput]}
        />
      </View>

      {validationMessage ? (
        <View style={styles.errorBanner} accessibilityRole="alert"><Text style={styles.errorText}>{validationMessage}</Text></View>
      ) : null}
      <View style={styles.inlineButtons}>
        <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={onCancel} disabled={pending} accessibilityRole="button">
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.primaryButton, styles.saveTaskButton, pressed && styles.buttonPressed]} onPress={() => { void submit(); }} disabled={pending} accessibilityRole="button">
          {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{task ? 'Save Task Changes' : 'Create Task'}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function LabeledTextField({
  label,
  value,
  onChangeText,
  placeholder,
  optional = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  optional?: boolean;
  numeric?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label} {optional ? <Text style={styles.optionalLabel}>(optional)</Text> : null}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8A909C"
        keyboardType={numeric ? 'number-pad' : 'default'}
        inputMode={numeric ? 'numeric' : 'text'}
        style={styles.input}
      />
    </View>
  );
}

function ChoiceOrTypeField({
  label,
  value,
  options,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label} {optional ? <Text style={styles.optionalLabel}>(optional)</Text> : null}</Text>
      {options.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
          {options.map(option => (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={({ pressed }) => [styles.smallChoice, normalizedName(value) === normalizedName(option) && styles.choiceActive, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: normalizedName(value) === normalizedName(option) }}
            >
              <Text style={[styles.choiceText, normalizedName(value) === normalizedName(option) && styles.choiceTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={`Type ${label.toLowerCase()}`}
        placeholderTextColor="#8A909C"
        style={styles.input}
      />
    </View>
  );
}

function OptionButtons<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map(option => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={({ pressed }) => [styles.smallChoice, value === option && styles.choiceActive, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option }}
        >
          <Text style={[styles.choiceText, value === option && styles.choiceTextActive]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function taskFormState(task: DAVEWebScheduleItem | null, defaultProject: string): TaskFormState {
  return {
    taskName: task?.taskName ?? '',
    projectName: task?.scheduleProjectName || task?.projectName || defaultProject,
    locationName: task?.locationName ?? '',
    startDate: task?.startDate ?? '',
    finishDate: task?.finishDate ?? '',
    milestone: task?.milestone ?? '',
    owner: task?.owner ?? '',
    contractor: task?.contractor ?? '',
    percentComplete: String(task?.percentComplete ?? 0),
    priority: task?.priority ?? 'Medium',
    status: task?.status ?? 'Not Started',
    notes: task?.notes ?? '',
  };
}

function taskMutationMessage(error: unknown): string {
  if (error instanceof DAVEWebTaskMutationError || error instanceof DAVEWebTaskValidationError) {
    return error.message;
  }
  return 'The task could not be saved. Refresh the workspace and try again.';
}

function uniqueOptions(values: readonly (string | null | undefined)[]) {
  const options = new Map<string, string>();
  values.forEach(value => {
    const text = value?.trim();
    const key = normalizedName(text);
    if (text && key && !options.has(key)) options.set(key, text);
  });
  return [...options.values()];
}

function TaskList({
  tasks,
  onEdit,
  onDelete,
}: {
  tasks: readonly ScheduleItem[];
  onEdit?: (task: ScheduleItem) => void;
  onDelete?: (task: ScheduleItem) => void;
}) {
  if (tasks.length === 0) return <EmptyState text="No schedule items match this scope." />;
  return (
    <View style={styles.list}>
      {tasks.map(task => (
        <View key={task.id} style={styles.dataCard}>
          <View style={styles.dataRow}>
            <View style={styles.dataGrow}>
              <Text style={styles.dataTitle}>{task.taskName}</Text>
              <Text style={styles.dataMeta}>{task.projectName}{task.locationName ? ` · ${task.locationName}` : ''}</Text>
            </View>
            <StatusBadge label={task.status} tone={taskIsComplete(task) ? 'good' : taskIsOverdue(task) ? 'danger' : 'attention'} />
          </View>
          <Text style={styles.dataDetail}>{task.percentComplete}% complete · Finish {formatDate(task.finishDate)} · {task.priority} priority</Text>
          {task.owner ? <Text style={styles.dataMeta}>Owner: {task.owner}</Text> : null}
          {onEdit || onDelete ? (
            <View style={styles.taskCardActions}>
              {onEdit ? (
                <Pressable style={({ pressed }) => [styles.secondaryButton, styles.compactActionButton, pressed && styles.buttonPressed]} onPress={() => onEdit(task)} accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>Edit</Text>
                </Pressable>
              ) : null}
              {onDelete ? (
                <Pressable style={({ pressed }) => [styles.deleteTextButton, pressed && styles.buttonPressed]} onPress={() => onDelete(task)} accessibilityRole="button">
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function EvidenceList({ updates }: { updates: readonly CloudProjectUpdate<ProjectUpdate>[] }) {
  if (updates.length === 0) return <EmptyState text="No field evidence matches this scope." />;
  return (
    <View style={styles.list}>
      {updates.map(update => (
        <View key={update.id} style={styles.dataCard}>
          <View style={styles.dataRow}>
            <View style={styles.dataGrow}>
              <Text style={styles.dataTitle}>{update.projectName}</Text>
              <Text style={styles.dataMeta}>{update.areaName || 'No area'} · {formatDateTime(update.updatedAt ?? update.updateData.date)}</Text>
            </View>
            <StatusBadge label={`${update.updateData.photos.length} photo${update.updateData.photos.length === 1 ? '' : 's'}`} tone="neutral" />
          </View>
          <Text style={styles.dataDetail}>{update.updateData.notes?.trim() || 'No field note recorded.'}</Text>
          {update.updateData.scheduleTaskName ? <Text style={styles.dataMeta}>Task: {update.updateData.scheduleTaskName}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function PhotoList({
  photos,
}: {
  photos: readonly { update: CloudProjectUpdate<ProjectUpdate>; photo: UpdatePhoto }[];
}) {
  if (photos.length === 0) return <EmptyState text="No photo evidence matches this scope." />;
  return (
    <View style={styles.cardGrid}>
      {photos.map(({ update, photo }) => (
        <View key={`${update.id}:${photo.id}`} style={styles.dataCard}>
          <Text style={styles.dataTitle}>{photo.caption?.trim() || 'Project photo'}</Text>
          <Text style={styles.dataMeta}>{update.projectName}{update.areaName ? ` · ${update.areaName}` : ''}</Text>
          <Text style={styles.dataDetail}>{photo.category} · Captured {formatDateTime(update.updateData.date)}</Text>
          {photo.actionRequired ? <Text style={styles.dataMeta}>Action: {photo.actionRequired}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function DocumentList({ documents }: { documents: readonly ReferenceDocument[] }) {
  if (documents.length === 0) return <EmptyState text="No documents match this scope." />;
  return (
    <View style={styles.list}>
      {documents.map(document => (
        <View key={document.id} style={styles.dataCard}>
          <View style={styles.dataRow}>
            <View style={styles.dataGrow}>
              <Text style={styles.dataTitle}>{document.name}</Text>
              <Text style={styles.dataMeta}>{document.projectName || 'Shared project document'} · {document.category}</Text>
            </View>
            <StatusBadge label={document.isCurrent ? 'Current' : 'Prior version'} tone={document.isCurrent ? 'good' : 'neutral'} />
          </View>
          <Text style={styles.dataDetail}>Imported {formatDateTime(document.importedAt)}</Text>
          {document.notes ? <Text style={styles.dataMeta}>{document.notes}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'good' | 'attention' | 'danger' | 'neutral' }) {
  return (
    <View style={[styles.statusBadge, styles[`statusBadge_${tone}`]]}>
      <Text style={[styles.statusBadgeText, styles[`statusBadgeText_${tone}`]]}>{label}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return <View style={styles.emptyState}><Text style={styles.emptyStateText}>{text}</Text></View>;
}

function DesktopSidebar({ pathname, selectedProject }: { pathname: string; selectedProject: string | null }) {
  return (
    <View style={styles.sidebar}>
      <View style={styles.gateBrandRow}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View>
        <View><Text style={styles.brandName}>DAVE</Text><Text style={styles.brandSubtitle}>Project Vision AI</Text></View>
      </View>
      <View style={styles.navigation} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} selectedProject={selectedProject} />
        ))}
      </View>
      <Text style={styles.pilotNote}>Phase 4 · Controlled task-editing pilot</Text>
    </View>
  );
}

function DesktopTopNavigation({ pathname, selectedProject }: { pathname: string; selectedProject: string | null }) {
  return (
    <View style={styles.topNavigation}>
      <View style={styles.compactBrand}><View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View><Text style={styles.brandName}>DAVE</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNavigationLinks}>
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} selectedProject={selectedProject} compact />
        ))}
      </ScrollView>
    </View>
  );
}

function DesktopNavigationLink({
  pathname,
  item,
  selectedProject,
  compact = false,
}: {
  pathname: string;
  item: DesktopNavigationItem;
  selectedProject: string | null;
  compact?: boolean;
}) {
  const active = desktopRouteIsActive(pathname, item.href);
  const href = selectedProject ? { pathname: item.href, params: { project: selectedProject } } : item.href;
  return (
    <Link href={href} asChild>
      <Pressable
        style={({ pressed }) => [compact ? styles.topNavigationLink : styles.navigationLink, active && styles.navigationLinkActive, pressed && styles.buttonPressed]}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.navigationLabel, active && styles.navigationLabelActive]}>{item.label}</Text>
      </Pressable>
    </Link>
  );
}

function matchesProject(projectName: string | null | undefined, selectedProject: string | null): boolean {
  return !selectedProject || normalizedName(projectName) === normalizedName(selectedProject);
}

function matchesProjectScope(projectName: string | null | undefined, scopeProjects: readonly string[]): boolean {
  if (scopeProjects.length === 0) return true;
  const projectKey = normalizedName(projectName);
  return scopeProjects.some(scope => normalizedName(scope) === projectKey);
}

function taskIsComplete(task: ScheduleItem): boolean {
  return scheduleTaskIsComplete(task);
}

function taskIsOverdue(task: ScheduleItem): boolean {
  if (taskIsComplete(task)) return false;
  const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
  return days !== null && days < 0;
}

function normalizedName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sortTasksForReview(tasks: readonly ScheduleItem[]): ScheduleItem[] {
  return [...tasks].sort((a, b) => {
    const completedDifference = Number(taskIsComplete(a)) - Number(taskIsComplete(b));
    if (completedDifference !== 0) return completedDifference;
    const overdueDifference = Number(taskIsOverdue(b)) - Number(taskIsOverdue(a));
    if (overdueDifference !== 0) return overdueDifference;
    return Date.parse(a.finishDate) - Date.parse(b.finishDate);
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatSessionExpiry(expiresAt: number | null): string {
  if (!expiresAt) return 'after the current tab closes';
  return new Date(expiresAt * 1000).toLocaleString();
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%', backgroundColor: '#F3F5F9' },
  rootWide: { flexDirection: 'row' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1540, alignSelf: 'center', padding: spacing.xl, gap: spacing.xl },
  gateRoot: { flex: 1, minHeight: '100%', backgroundColor: '#F3F5F9' },
  gateContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  gateBrandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gateCard: { width: '100%', maxWidth: 560, borderRadius: 24, borderWidth: 1, borderColor: '#D9DFEA', backgroundColor: '#FFFFFF', padding: spacing.xxl, gap: spacing.lg },
  gateTitle: { color: '#171A21', fontSize: 32, lineHeight: 39, fontWeight: '900' },
  sidebar: { width: 258, minHeight: '100%', backgroundColor: '#FFFFFF', borderRightWidth: 1, borderRightColor: '#D9DFEA', padding: spacing.lg, gap: spacing.xxl },
  brandMark: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#087EF5', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  brandName: { color: '#171A21', fontSize: 17, fontWeight: '900', letterSpacing: 0.4 },
  brandSubtitle: { color: '#6F7480', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  navigation: { gap: spacing.xs },
  navigationLink: { minHeight: 48, borderRadius: 12, justifyContent: 'center', paddingHorizontal: spacing.md },
  topNavigationLink: { minHeight: 42, borderRadius: 12, justifyContent: 'center', paddingHorizontal: spacing.md },
  navigationLinkActive: { backgroundColor: '#E7F2FF' },
  navigationLabel: { color: '#5C6370', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  navigationLabelActive: { color: '#0874DF' },
  pilotNote: { color: '#727886', fontSize: 12, lineHeight: 17, marginTop: 'auto' },
  compactBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.md },
  topNavigation: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D9DFEA', borderRadius: 16, padding: spacing.sm, flexDirection: 'row', alignItems: 'center' },
  topNavigationLinks: { gap: spacing.xs, alignItems: 'center' },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg },
  titleBlock: { flex: 1, minWidth: 280, maxWidth: 820 },
  eyebrow: { color: '#0874DF', fontSize: 12, lineHeight: 17, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: '#171A21', fontSize: 38, lineHeight: 44, fontWeight: '900', marginTop: spacing.xs },
  description: { color: '#666D79', fontSize: 17, lineHeight: 25, marginTop: spacing.sm },
  accountPanel: { alignItems: 'flex-end', gap: spacing.xs, maxWidth: 280 },
  accountEmail: { color: '#5C6370', fontSize: 13, lineHeight: 18, maxWidth: 260 },
  readOnlyBadge: { borderRadius: 999, backgroundColor: '#E7F2FF', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  readOnlyBadgeText: { color: '#0874DF', fontSize: 12, lineHeight: 16, fontWeight: '900', letterSpacing: 0.8 },
  textButton: { color: '#0874DF', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  safetyBanner: { borderRadius: 18, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', padding: spacing.lg, gap: spacing.xs },
  safetyTitle: { color: '#195B35', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  safetyDetail: { color: '#37684B', fontSize: 14, lineHeight: 21, maxWidth: 1000 },
  filterPanel: { borderRadius: 18, borderWidth: 1, borderColor: '#D9DFEA', backgroundColor: '#FFFFFF', padding: spacing.lg, gap: spacing.md },
  filterHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  projectChoices: { gap: spacing.sm },
  choice: { borderRadius: 999, borderWidth: 1, borderColor: '#CDD4DF', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: '#FFFFFF' },
  choiceActive: { borderColor: '#087EF5', backgroundColor: '#E7F2FF' },
  choiceText: { color: '#5C6370', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  choiceTextActive: { color: '#0874DF' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  metricCard: { flexGrow: 1, flexBasis: 190, minHeight: 132, borderRadius: 20, backgroundColor: '#194A91', padding: spacing.lg, justifyContent: 'space-between' },
  metricValue: { color: '#FFFFFF', fontSize: 36, lineHeight: 42, fontWeight: '900' },
  metricLabel: { color: '#D8E6FA', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  accountingBanner: { borderRadius: 18, borderWidth: 1, borderColor: '#8CB9ED', backgroundColor: '#EDF6FF', padding: spacing.lg, gap: spacing.xs },
  accountingTitle: { color: '#164F86', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  accountingDetail: { color: '#315F88', fontSize: 14, lineHeight: 21 },
  section: { gap: spacing.md },
  sectionTitle: { color: '#171A21', fontSize: 24, lineHeight: 31, fontWeight: '900' },
  sectionDetail: { color: '#6A717E', fontSize: 15, lineHeight: 22 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  list: { gap: spacing.md },
  dataCard: { flexGrow: 1, flexBasis: 320, borderRadius: 18, borderWidth: 1, borderColor: '#D9DFEA', backgroundColor: '#FFFFFF', padding: spacing.lg, gap: spacing.sm },
  dataRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  dataGrow: { flex: 1 },
  dataTitle: { color: '#1B1F27', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  cardTitle: { color: '#1B1F27', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  dataMeta: { color: '#737A87', fontSize: 13, lineHeight: 19 },
  dataDetail: { color: '#4E5562', fontSize: 15, lineHeight: 22 },
  taskActionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  addTaskButton: { minWidth: 180 },
  taskSyncHint: { color: '#68717E', fontSize: 13, lineHeight: 19 },
  taskCardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  compactActionButton: { minWidth: 90 },
  deleteTextButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md },
  deleteText: { color: '#B52D2D', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  deleteConfirm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#E5A4A4', backgroundColor: '#FFF3F3', padding: spacing.lg, gap: spacing.lg },
  deleteConfirmTitle: { color: '#8F2222', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  dangerButton: { minHeight: 42, borderRadius: 12, backgroundColor: '#C73535', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  editorCard: { borderRadius: 20, borderWidth: 1, borderColor: '#9ABFE9', backgroundColor: '#F8FBFF', padding: spacing.xl, gap: spacing.lg },
  editorTitle: { color: '#171A21', fontSize: 24, lineHeight: 31, fontWeight: '900' },
  twoColumnFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  flexField: { flexGrow: 1, flexBasis: 280 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  smallChoice: { minHeight: 38, borderRadius: 999, borderWidth: 1, borderColor: '#CDD4DF', paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: '#FFFFFF' },
  optionalLabel: { color: '#7B828E', fontWeight: '500' },
  notesInput: { minHeight: 112, paddingTop: spacing.md, textAlignVertical: 'top' },
  inlineButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  saveTaskButton: { minWidth: 190 },
  successBanner: { borderRadius: 12, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', padding: spacing.md },
  successText: { color: '#195B35', fontSize: 14, lineHeight: 21 },
  statusBadge: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  statusBadge_good: { backgroundColor: '#EAF8EF' },
  statusBadge_attention: { backgroundColor: '#FFF3DD' },
  statusBadge_danger: { backgroundColor: '#FDEBEB' },
  statusBadge_neutral: { backgroundColor: '#EEF1F5' },
  statusBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  statusBadgeText_good: { color: '#217342' },
  statusBadgeText_attention: { color: '#956000' },
  statusBadgeText_danger: { color: '#B52D2D' },
  statusBadgeText_neutral: { color: '#5D6571' },
  emptyState: { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C9D0DB', backgroundColor: '#F8F9FB', padding: spacing.xl },
  emptyStateText: { color: '#666D79', fontSize: 15, lineHeight: 23 },
  fieldGroup: { gap: spacing.xs },
  fieldLabel: { color: '#2B3038', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#C9D0DB', borderRadius: 12, backgroundColor: '#FFFFFF', color: '#171A21', fontSize: 16, paddingHorizontal: spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  mutedText: { color: '#747B87', fontSize: 14, lineHeight: 20 },
  errorBanner: { borderRadius: 12, borderWidth: 1, borderColor: '#E5A4A4', backgroundColor: '#FDEEEE', padding: spacing.md },
  errorText: { color: '#9B2525', fontSize: 14, lineHeight: 21 },
  primaryButton: { minHeight: 52, borderRadius: 12, backgroundColor: '#087EF5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '900' },
  syncButton: { alignSelf: 'flex-start', minWidth: 240 },
  syncBoundaryBanner: { borderRadius: 18, borderWidth: 1, borderColor: '#E7B766', backgroundColor: '#FFF7E8', padding: spacing.lg, gap: spacing.xs },
  syncBoundaryTitle: { color: '#7B4D00', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  syncBoundaryDetail: { color: '#72551F', fontSize: 14, lineHeight: 21, maxWidth: 1000 },
  secondaryButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: '#BFC8D5', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: '#0874DF', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  buttonDisabled: { opacity: 0.48 },
  buttonPressed: { opacity: 0.72 },
  sessionNote: { color: '#747B87', fontSize: 12, lineHeight: 18 },
  refreshNote: { color: '#747B87', fontSize: 12, lineHeight: 18, paddingBottom: spacing.xl },
});
