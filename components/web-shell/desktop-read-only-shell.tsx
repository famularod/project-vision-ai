import { Link, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createElement, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  PROJECT_ITEM_TYPES,
  SCHEDULE_PRIORITIES,
  SCHEDULE_STATUSES,
  type ProjectItemType,
  type ProjectUpdate,
  type ScheduleItem,
  type SchedulePriority,
  type ScheduleStatus,
  type UpdatePhoto,
} from '../../types';
import type { CloudProject, CloudProjectUpdate } from '../../services/SupabaseService';
import {
  DAVEWebDocumentMutationError,
  DAVEWebTaskMutationError,
} from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import { groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
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
import { projectUpdateBelongsToParentProject } from '../../services/DAVEProjectUpdateScope';
import { scheduleProjectScopeNames } from '../../services/PIEScheduleImportBatch';
import { scheduleDocumentIsScheduleLike } from '../../services/PIEScheduleReconciliation';
import {
  formatVitruviusDesktopGreeting,
  readVitruviusDesktopDisplayName,
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY,
  writeVitruviusDesktopDisplayName,
} from '../../services/VitruviusDesktopPreferences';
import {
  buildDAVEWebTaskRenderPage,
  DAVE_WEB_TASK_PAGE_SIZE,
  type DAVEWebTaskRenderGroup,
} from '../../services/DAVEWebTaskPagination';
import { presentDAVEWebFreshness } from '../../services/DAVEWebFreshness';
import {
  buildDAVEWebReportDraft,
  buildDAVEWebReportSource,
  buildDAVEWebTruthDiagnostics,
  createDAVEWebBackup,
  createDAVEWebId,
  DAVE_WEB_DOCUMENT_CATEGORIES,
  daveWebReportSourceIsCurrent,
  formatDAVEWebReport,
  prepareDAVEWebDocumentUpload,
  reportRecordFromDocument,
  validateDAVEWebBackup,
  type DAVEWebBackup,
  type DAVEWebPreparedUpload,
  type DAVEWebReportRecord,
  type DAVEWebReportSource,
} from '../../services/DAVEWebOperations';
import { colors, spacing } from '../../theme';
import { daysUntilDate } from '../../utils/date';
import { PRODUCT_BRAND } from '../../product-brand';
import {
  VITRUVIUS_BRAND_DARK_BLUE,
  VITRUVIUS_BRAND_SOFT_BLUE,
} from '../vitruvius-brand-lockup';
import { useDesktopAuth } from './desktop-auth-provider';
import { DesktopConnectionStatus } from './desktop-connection-status';
import { DesktopOverviewPage } from './desktop-overview-page';
import { DesktopSchedulePage } from './desktop-schedule-page';
import { desktopSurfaces } from './desktop-surface-palette';
import {
  desktopNavigationItems,
  desktopRouteIsActive,
  desktopWorkspaceLayout,
  desktopWorkspaceScopeKey,
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
    eyebrow: 'PORTFOLIO',
    title: 'Project Health',
    description: 'A current view of project progress, priorities, and recent field activity.',
  },
  projects: {
    eyebrow: 'PROJECTS',
    title: 'Projects',
    description: 'Review the current status, progress, and activity for each active project.',
  },
  tasks: {
    eyebrow: 'PROJECT CONTROL',
    title: 'Tasks',
    description: 'Plan and manage project work by project and area, with completed work kept in its own view.',
  },
  schedule: {
    eyebrow: 'PLANNING',
    title: 'Project Schedule',
    description: 'Build and control the project plan with phases, milestones, relationships, and timeline views.',
  },
  evidence: {
    eyebrow: 'FIELD ACTIVITY',
    title: 'Field Activity',
    description: 'Review recent field updates with their project, area, task, and photo context.',
  },
  photos: {
    eyebrow: 'PHOTOS',
    title: 'Project Photos',
    description: 'Review photos organized by the project updates that captured them.',
  },
  documents: {
    eyebrow: 'DOCUMENTS',
    title: 'Project Documents',
    description: 'Review current documents, prior versions, and schedule imports.',
  },
  reports: {
    eyebrow: 'REPORTS',
    title: 'Project Reports',
    description: 'Review project facts and report status from the shared project record.',
  },
  settings: {
    eyebrow: 'SETTINGS',
    title: 'Account and Sync',
    description: 'Review the signed-in account and keep this computer aligned with the shared project record.',
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
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>{PRODUCT_BRAND.monogram}</Text></View>
        <View>
          <Text style={styles.brandName}>{PRODUCT_BRAND.name}</Text>
          <Text style={styles.brandSubtitle}>{PRODUCT_BRAND.subtitle}</Text>
        </View>
      </View>
      <View style={styles.gateCard}>
        <Text style={styles.eyebrow}>VITRUVIUS PROJECT INTELLIGENCE</Text>
        <Text style={styles.gateTitle}>Sign in to your project workspace</Text>
        <Text style={styles.description}>
          Use the same account as your Vitruvius iPhone or iPad app to review projects and manage tasks from this computer.
        </Text>

        {checking ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={desktopSurfaces.accent} />
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
              {submitting ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : <Text style={styles.primaryButtonText}>Sign in securely</Text>}
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
  const { usesSidebar, compactContent } = desktopWorkspaceLayout(width);
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
  const [displayName, setDisplayName] = useState(() =>
    readVitruviusDesktopDisplayName(),
  );

  useEffect(() => {
    const readLatestPreference = (event?: StorageEvent) => {
      if (event && event.key !== VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY) return;
      setDisplayName(readVitruviusDesktopDisplayName());
    };
    window.addEventListener('storage', readLatestPreference);
    return () => window.removeEventListener('storage', readLatestPreference);
  }, []);

  const saveDisplayName = (value: string) => {
    const saved = writeVitruviusDesktopDisplayName(value);
    setDisplayName(saved);
    return saved;
  };

  const selectProject = (projectName: string | null) => {
    router.setParams(projectName ? { project: projectName } : { project: undefined });
  };

  return (
    <View style={[styles.root, usesSidebar && styles.rootWide]}>
      {usesSidebar ? <DesktopSidebar pathname={pathname} selectedProject={selectedProject} /> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, compactContent && styles.contentCompact]}
      >
        {!usesSidebar ? <DesktopTopNavigation pathname={pathname} selectedProject={selectedProject} /> : null}
        <View style={[styles.topRow, compactContent && styles.topRowCompact]}>
          <View style={[styles.titleBlock, compactContent && styles.titleBlockCompact]}>
            {page === 'overview' ? (
              <>
                <Text style={styles.title} accessibilityRole="header">
                  {formatVitruviusDesktopGreeting(new Date(), displayName)}
                </Text>
                <Text style={styles.overviewDate}>{formatDesktopDate(new Date())}</Text>
              </>
            ) : (
              <>
                <Text style={styles.eyebrow} accessibilityRole="header">{copy.eyebrow}</Text>
                <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
                <Text style={styles.description}>{copy.description}</Text>
              </>
            )}
          </View>
        </View>

        {auth.freshness.status !== 'connected' && auth.message ? (
          <View
            style={[
              styles.freshnessBanner,
              auth.freshness.status === 'stale' && styles.freshnessBannerStale,
            ]}
            accessibilityRole="alert"
          >
            <Ionicons
              name={auth.freshness.status === 'stale' ? 'cloud-offline-outline' : 'sync-outline'}
              size={20}
              color={auth.freshness.status === 'stale' ? colors.danger : colors.warning}
            />
            <Text style={styles.freshnessBannerText}>{auth.message}</Text>
          </View>
        ) : null}

        {page !== 'settings' ? (
          <View style={[styles.contextBar, compactContent && styles.contextBarCompact]}>
            <View style={styles.contextScope}>
              <Text style={styles.projectFilterLabel}>PROJECT</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={compactContent}
                style={compactContent ? styles.projectChoiceScrollerCompact : undefined}
                contentContainerStyle={styles.projectChoices}
              >
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
            <View style={styles.contextUtilities}>
              <DesktopConnectionStatus freshness={auth.freshness} />
              <RefreshProjectDataButton onPress={() => { void auth.refreshSnapshot(); }} />
              <Link href="/settings" asChild>
                <Pressable
                  style={({ pressed }) => [styles.settingsButton, pressed && styles.buttonPressed]}
                  accessibilityRole="link"
                  accessibilityLabel="Open settings"
                >
                  <Ionicons name="settings-outline" size={20} color={desktopSurfaces.accent} />
                </Pressable>
              </Link>
            </View>
          </View>
        ) : null}

        <DesktopPageData
          key={desktopWorkspaceScopeKey(page, selectedProject)}
          page={page}
          selectedProject={selectedProject}
          displayName={displayName}
          onSaveDisplayName={saveDisplayName}
        />
      </ScrollView>
    </View>
  );
}

function DesktopPageData({
  page,
  selectedProject,
  displayName,
  onSaveDisplayName,
}: {
  page: DesktopReadOnlyPage;
  selectedProject: string | null;
  displayName: string;
  onSaveDisplayName: (value: string) => string;
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
  const updates = selectedProject
    ? snapshot.projectUpdates.filter(update =>
        projectUpdateBelongsToParentProject({
          update: update.updateData,
          projectName: selectedProject,
          scheduleItems: snapshot.scheduleItems,
        }),
      )
    : snapshot.projectUpdates;
  const documents = snapshot.referenceDocuments.filter(document => documentMatchesProjectScope(document, selectedScopes));
  const photos = updates.flatMap(update => update.updateData.photos.map(photo => ({ update, photo })));
  if (page === 'overview') {
    return (
      <DesktopOverviewPage
        projects={projects}
        tasks={tasks}
        updates={updates}
        documents={documents}
        selectedProject={selectedProject}
      />
    );
  }

  if (page === 'projects') {
    return (
      <ProjectsWorkspace
        projects={projects}
        tasks={tasks}
        updates={updates}
        documents={documents}
      />
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

  if (page === 'schedule') {
    return (
      <DesktopSchedulePage
        tasks={sortTasksForReview(tasks) as DAVEWebScheduleItem[]}
        projects={snapshot.projects.map(project => project.name)}
        selectedProject={selectedProject}
      />
    );
  }

  if (page === 'evidence') {
    return <FieldActivityWorkspace updates={updates} />;
  }

  if (page === 'photos') {
    return <PhotoWorkspace photos={photos} />;
  }

  if (page === 'documents') {
    return (
      <Section title={`${documents.length} document${documents.length === 1 ? '' : 's'}`} detail="Upload, classify, version, and safely remove project documents from the shared record.">
        <DocumentManagementWorkspace
          documents={documents}
          projects={snapshot.projects.map(project => project.name)}
          selectedProject={selectedProject}
        />
      </Section>
    );
  }

  if (page === 'settings') {
    return (
      <SettingsWorkspace
        snapshot={snapshot}
        displayName={displayName}
        onSaveDisplayName={onSaveDisplayName}
      />
    );
  }

  if (page === 'reports') {
    return (
      <ReportWorkspace
        snapshot={snapshot}
        selectedProject={selectedProject}
        documents={documents}
      />
    );
  }

  return null;
}

function ProjectChoice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.choice, active && styles.choiceActive, pressed && styles.buttonPressed]}
      accessibilityRole="radio"
      accessibilityLabel={`Filter by ${label}`}
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

type WorkspaceMetric = Readonly<{
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number | string;
  tone?: 'primary' | 'success' | 'warning' | 'neutral';
}>;

function WorkspaceSummary({ metrics }: { metrics: readonly WorkspaceMetric[] }) {
  return (
    <View style={styles.workspaceSummary}>
      {metrics.map(metric => {
        const tone = metric.tone || 'primary';
        return (
          <View key={metric.label} style={styles.workspaceMetric}>
            <View style={[styles.workspaceMetricIcon, styles[`workspaceMetricIcon_${tone}`]]}>
              <Ionicons name={metric.icon} size={20} color={workspaceMetricIconColor(tone)} />
            </View>
            <View style={styles.workspaceMetricCopy}>
              <Text style={styles.workspaceMetricValue}>{metric.value}</Text>
              <Text style={styles.workspaceMetricLabel}>{metric.label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function workspaceMetricIconColor(tone: NonNullable<WorkspaceMetric['tone']>): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'neutral') return colors.mutedText;
  return desktopSurfaces.accent;
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

function ProjectsWorkspace({
  projects,
  tasks,
  updates,
  documents,
}: {
  projects: readonly CloudProject[];
  tasks: readonly ScheduleItem[];
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
  documents: readonly DAVEWebReferenceDocument[];
}) {
  const completed = tasks.filter(taskIsComplete).length;
  const open = tasks.length - completed;
  const overdue = tasks.filter(taskIsOverdue).length;
  const dueSoon = tasks.filter(task => {
    if (taskIsComplete(task)) return false;
    const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
    return days !== null && days >= 0 && days <= 7;
  }).length;

  return (
    <Section
      title={`${projects.length} active project${projects.length === 1 ? '' : 's'}`}
      detail="Compare progress, current workload, and recent field activity across the active portfolio."
    >
      <WorkspaceSummary metrics={[
        { icon: 'checkbox-outline', label: 'Total Tasks', value: tasks.length },
        { icon: 'checkmark-circle-outline', label: 'Completed', value: completed, tone: 'success' },
        { icon: 'list-outline', label: 'Open', value: open },
        { icon: 'alert-circle-outline', label: 'Overdue', value: overdue, tone: overdue ? 'warning' : 'neutral' },
        { icon: 'calendar-outline', label: 'Due 7 Days', value: dueSoon, tone: dueSoon ? 'warning' : 'neutral' },
      ]} />
      <View style={styles.portfolioGrid}>
        {projects.map(project => (
          <ProjectPortfolioCard
            key={project.id ?? project.name}
            project={project}
            tasks={tasks}
            updates={updates}
            documents={documents}
          />
        ))}
        {projects.length === 0 ? <EmptyState text="No active projects match this view." /> : null}
      </View>
    </Section>
  );
}

function ProjectPortfolioCard({
  project,
  tasks,
  updates,
  documents,
}: {
  project: CloudProject;
  tasks: readonly ScheduleItem[];
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
  documents: readonly DAVEWebReferenceDocument[];
}) {
  const router = useRouter();
  const projectTasks = scheduleTasksForParentProject(project.name, [...tasks]);
  const projectScopes = scheduleProjectScopeNames(project.name, [...tasks]);
  const projectUpdates = updates
    .filter(update =>
      projectUpdateBelongsToParentProject({
        update: update.updateData,
        projectName: project.name,
        scheduleItems: tasks,
      }),
    )
    .sort(compareCloudUpdatesNewestFirst);
  const projectDocuments = documents.filter(document => documentMatchesProjectScope(document, projectScopes));
  const completed = projectTasks.filter(taskIsComplete).length;
  const open = projectTasks.length - completed;
  const overdue = projectTasks.filter(taskIsOverdue).length;
  const dueSoon = projectTasks.filter(task => {
    if (taskIsComplete(task)) return false;
    const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const areaCount = uniqueOptions(projectTasks.map(task => task.locationName)).length;
  const percent = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
  const health = overdue ? 'At Risk' : open ? 'Active' : projectTasks.length ? 'Complete' : 'Needs Setup';
  const healthTone: 'good' | 'attention' | 'danger' | 'neutral' = overdue
    ? 'danger'
    : open
      ? 'attention'
      : projectTasks.length
        ? 'good'
        : 'neutral';
  const latestActivity = projectUpdates[0]?.updatedAt
    ?? projectUpdates[0]?.updateData.date
    ?? project.updatedAt
    ?? project.createdAt;

  return (
    <View style={styles.portfolioCard}>
      <View style={styles.portfolioCardHeader}>
        <View style={styles.portfolioProjectIcon}>
          <Ionicons name="business-outline" size={25} color={desktopSurfaces.accent} />
        </View>
        <View style={styles.dataGrow}>
          <Text style={styles.portfolioProjectName}>{project.name}</Text>
          <Text style={styles.dataMeta}>Last activity {formatDateTime(latestActivity)}</Text>
        </View>
        <StatusBadge label={health} tone={healthTone} />
      </View>

      <View style={styles.portfolioProgressHeading}>
        <Text style={styles.portfolioProgressText}>{percent}% complete</Text>
        <Text style={styles.dataMeta}>{completed} of {projectTasks.length} tasks</Text>
      </View>
      <View style={styles.portfolioProgressTrack}>
        <View style={[styles.portfolioProgressFill, { width: `${percent}%` }]} />
      </View>

      <View style={styles.portfolioFacts}>
        <ProjectFact icon="list-outline" label="Open" value={open} />
        <ProjectFact icon="alert-circle-outline" label="Overdue" value={overdue} tone={overdue ? 'danger' : 'default'} />
        <ProjectFact icon="calendar-outline" label="Due soon" value={dueSoon} />
        <ProjectFact icon="map-outline" label="Areas" value={areaCount} />
        <ProjectFact icon="pulse-outline" label="Updates" value={projectUpdates.length} />
        <ProjectFact icon="folder-open-outline" label="Documents" value={projectDocuments.length} />
      </View>

      <View style={styles.portfolioActions}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.portfolioPrimaryAction, pressed && styles.buttonPressed]}
          onPress={() => router.push({ pathname: '/', params: { project: project.name } })}
          accessibilityRole="button"
        >
          <View style={styles.buttonLabelRow}>
            <Text style={styles.primaryButtonText}>Open Project</Text>
            <Ionicons name="arrow-forward" size={18} color={desktopSurfaces.onAccent} />
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => router.push({ pathname: '/tasks', params: { project: project.name } })}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>View Tasks</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProjectFact({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
  tone?: 'default' | 'danger';
}) {
  return (
    <View style={styles.projectFact}>
      <Ionicons name={icon} size={18} color={tone === 'danger' ? colors.danger : desktopSurfaces.accent} />
      <View>
        <Text style={[styles.projectFactValue, tone === 'danger' && styles.projectFactValueDanger]}>{value}</Text>
        <Text style={styles.projectFactLabel}>{label}</Text>
      </View>
    </View>
  );
}

type TaskFormState = Omit<DAVEWebTaskDraft, 'percentComplete'> & {
  percentComplete: string;
};

type TaskWorkspaceStatusFilter = 'all' | 'overdue' | ScheduleStatus;
type TaskConflictDraft = Readonly<{
  taskId: string;
  draft: DAVEWebTaskDraft;
}>;

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
  const { width } = useWindowDimensions();
  const compactTaskWorkspace = width < 1120;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DAVEWebScheduleItem | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DAVEWebScheduleItem | null>(null);
  const [taskView, setTaskView] = useState<'open' | 'completed'>('open');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskWorkspaceStatusFilter>('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | SchedulePriority>('all');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [conflictDraft, setConflictDraft] = useState<TaskConflictDraft | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const projectOptions = uniqueOptions([
    ...(selectedProject ? [selectedProject] : []),
    ...projects,
    ...tasks.map(task => task.scheduleProjectName || task.projectName),
  ]);
  const locationOptions = uniqueOptions(tasks.map(task => task.locationName));
  const ownerOptions = uniqueOptions(tasks.map(task => task.owner));
  const contractorOptions = uniqueOptions(tasks.map(task => task.contractor));
  const openTasks = useMemo(() => tasks.filter(task => !taskIsComplete(task)), [tasks]);
  const completedTasks = useMemo(() => tasks.filter(taskIsComplete), [tasks]);
  const overdueTasks = useMemo(() => openTasks.filter(taskIsOverdue), [openTasks]);
  const inProgressTasks = useMemo(
    () => openTasks.filter(task => task.status === 'In Progress'),
    [openTasks],
  );
  const taskViewItems = taskView === 'completed' ? completedTasks : openTasks;
  const areaOptions = uniqueOptions(taskViewItems.map(task => task.locationName));
  const visibleTasks = useMemo(() => {
    const query = normalizedName(searchQuery);
    return taskViewItems.filter(task => {
      if (query && !taskSearchText(task).includes(query)) return false;
      if (areaFilter !== 'all' && normalizedName(task.locationName) !== normalizedName(areaFilter)) return false;
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (statusFilter === 'overdue' && !taskIsOverdue(task)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'overdue' && task.status !== statusFilter) return false;
      return true;
    });
  }, [areaFilter, priorityFilter, searchQuery, statusFilter, taskViewItems]);
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
  const filtersActive = Boolean(
    searchQuery.trim() ||
    statusFilter !== 'all' ||
    areaFilter !== 'all' ||
    priorityFilter !== 'all',
  );
  useEffect(() => {
    if (
      !editorOpen &&
      selectedTaskId &&
      !visibleTasks.some(task => task.id === selectedTaskId)
    ) {
      setSelectedTaskId(null);
    }
  }, [editorOpen, selectedTaskId, visibleTasks]);

  const openCreate = () => {
    setEditingTask(null);
    setSelectedTaskId(null);
    setDeleteCandidate(null);
    setNotice(null);
    setConflictDraft(null);
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduleItem) => {
    setEditingTask(task as DAVEWebScheduleItem);
    setSelectedTaskId(task.id);
    setDeleteCandidate(null);
    setNotice(null);
    setConflictDraft(null);
    setEditorOpen(true);
  };

  const openDetails = (task: ScheduleItem) => {
    setSelectedTaskId(task.id);
    setEditingTask(null);
    setEditorOpen(false);
    setDeleteCandidate(null);
    setConflictDraft(null);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAreaFilter('all');
    setPriorityFilter('all');
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
      setSelectedTaskId(item.id);
      setEditorOpen(false);
      setEditingTask(null);
      setConflictDraft(null);
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
      if (
        editingTask &&
        error instanceof DAVEWebTaskMutationError &&
        error.code === 'conflict'
      ) {
        setConflictDraft({ taskId: editingTask.id, draft });
        setNotice({
          tone: 'danger',
          text: 'Another device changed this task while you were editing. Choose which version to continue with.',
        });
        return;
      }
      setNotice({ tone: 'danger', text: taskMutationMessage(error) });
    } finally {
      setPending(false);
    }
  };

  const loadLatestAfterConflict = () => {
    if (!conflictDraft) return;
    const latest = tasks.find(task => task.id === conflictDraft.taskId) ?? null;
    if (!latest) {
      setEditorOpen(false);
      setEditingTask(null);
      setConflictDraft(null);
      setNotice({
        tone: 'danger',
        text: 'This task is no longer available in the shared record.',
      });
      return;
    }
    setEditingTask(latest);
    setEditorRevision(value => value + 1);
    setConflictDraft(null);
    setNotice({
      tone: 'good',
      text: 'The latest shared version is loaded. Review it before saving.',
    });
  };

  const applyMyChangesAfterConflict = async () => {
    if (!conflictDraft || pending) return;
    const latest = tasks.find(task => task.id === conflictDraft.taskId) ?? null;
    if (!latest) {
      setConflictDraft(null);
      setEditorOpen(false);
      setEditingTask(null);
      setNotice({
        tone: 'danger',
        text: 'This task is no longer available in the shared record.',
      });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const item = buildDAVEWebScheduleItem({
        draft: conflictDraft.draft,
        current: latest,
        id: latest.id,
        now: new Date().toISOString(),
        actor: auth.userEmail || 'Project manager',
      });
      await auth.updateTask(item);
      setSelectedTaskId(item.id);
      setEditorOpen(false);
      setEditingTask(null);
      setConflictDraft(null);
      setNotice({
        tone: 'good',
        text: 'Your changes were applied to the latest shared version and synced.',
      });
    } catch (error) {
      await auth.refreshSnapshot().catch(() => undefined);
      setNotice({
        tone: 'danger',
        text: error instanceof DAVEWebTaskMutationError && error.code === 'conflict'
          ? 'The task changed again. Review the refreshed version before trying once more.'
          : taskMutationMessage(error),
      });
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
      if (selectedTaskId === deleteCandidate.id) setSelectedTaskId(null);
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
      title={`${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
      detail="Changes sync automatically to the shared project record and appear on active Vitruvius devices."
    >
      <WorkspaceSummary metrics={[
        { icon: 'play-circle-outline', label: 'In Progress', value: inProgressTasks.length },
        { icon: 'checkmark-circle-outline', label: 'Completed', value: completedTasks.length, tone: 'success' },
        { icon: 'alert-circle-outline', label: 'Overdue', value: overdueTasks.length, tone: overdueTasks.length ? 'warning' : 'neutral' },
      ]} />
      <View style={styles.taskActionRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.addTaskButton, pressed && styles.buttonPressed]}
          onPress={openCreate}
          disabled={pending}
          accessibilityRole="button"
        >
          <View style={styles.buttonLabelRow}>
            <Ionicons name="add-circle-outline" size={20} color={desktopSurfaces.onAccent} />
            <Text style={styles.primaryButtonText}>Add Task</Text>
          </View>
        </Pressable>
        <View style={styles.taskSearchField}>
          <Ionicons name="search-outline" size={20} color={colors.mutedText} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search task, project, area, owner, or contractor"
            placeholderTextColor="#7D8794"
            style={styles.taskSearchInput}
            accessibilityLabel="Search tasks"
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              style={({ pressed }) => [styles.clearSearchButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Clear task search"
            >
              <Ionicons name="close" size={18} color={colors.mutedText} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.taskControlsRow}>
        <View style={styles.taskViewTabs} accessibilityRole="tablist">
          <TaskViewTab
            label="Open Tasks"
            count={openTasks.length}
            active={taskView === 'open'}
            onPress={() => {
              setTaskView('open');
              setStatusFilter('all');
            }}
          />
          <TaskViewTab
            label="Completed Tasks"
            count={completedTasks.length}
            active={taskView === 'completed'}
            onPress={() => {
              setTaskView('completed');
              setStatusFilter('all');
            }}
          />
        </View>
        <View style={styles.taskFilters}>
          <TaskFilterSelect
            label="Status"
            value={statusFilter}
            options={[
              { value: 'all', label: 'All statuses' },
              ...(taskView === 'open'
                ? [
                    { value: 'overdue', label: 'Overdue' },
                    { value: 'Not Started', label: 'Not started' },
                    { value: 'In Progress', label: 'In progress' },
                    { value: 'Waiting', label: 'Waiting' },
                  ]
                : [{ value: 'Complete', label: 'Complete' }]),
            ]}
            onChange={value => setStatusFilter(value as TaskWorkspaceStatusFilter)}
          />
          <TaskFilterSelect
            label="Area"
            value={areaFilter}
            options={[
              { value: 'all', label: 'All areas' },
              ...areaOptions.map(area => ({ value: area, label: area })),
            ]}
            onChange={setAreaFilter}
          />
          <TaskFilterSelect
            label="Priority"
            value={priorityFilter}
            options={[
              { value: 'all', label: 'All priorities' },
              ...SCHEDULE_PRIORITIES.map(priority => ({ value: priority, label: priority })),
            ]}
            onChange={value => setPriorityFilter(value as 'all' | SchedulePriority)}
          />
          {filtersActive ? (
            <Pressable
              onPress={clearFilters}
              style={({ pressed }) => [styles.clearFiltersButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.taskResultCount}>
        Showing {visibleTasks.length} of {taskViewItems.length} {taskView === 'completed' ? 'completed' : 'open'} tasks
      </Text>

      {notice ? (
        <View style={notice.tone === 'good' ? styles.successBanner : styles.errorBanner} accessibilityRole="alert">
          <Text style={notice.tone === 'good' ? styles.successText : styles.errorText}>{notice.text}</Text>
        </View>
      ) : null}

      {conflictDraft ? (
        <View style={styles.conflictResolutionCard} accessibilityRole="alert">
          <View style={styles.dataGrow}>
            <Text style={styles.conflictResolutionTitle}>Choose how to resolve this edit</Text>
            <Text style={styles.dataDetail}>
              Load the latest task to review the other device’s changes, or apply your form values to that latest version.
            </Text>
          </View>
          <View style={styles.inlineButtons}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              onPress={loadLatestAfterConflict}
              disabled={pending}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>Load Latest Version</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={() => { void applyMyChangesAfterConflict(); }}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? (
                <ActivityIndicator color={desktopSurfaces.onAccent} />
              ) : (
                <Text style={styles.primaryButtonText}>Apply My Changes</Text>
              )}
            </Pressable>
          </View>
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
              {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : <Text style={styles.primaryButtonText}>Delete Task</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.taskWorkspaceBody}>
        <View style={styles.taskListPane}>
          <GroupedTaskList
            key={`${taskView}:${selectedProject ?? 'all-projects'}:${searchQuery}:${statusFilter}:${areaFilter}:${priorityFilter}`}
            tasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            autoExpandMatches={filtersActive}
            onSelect={openDetails}
            onEdit={openEdit}
            onDelete={task => {
              setEditorOpen(false);
              setEditingTask(null);
              setNotice(null);
              setDeleteCandidate(task as DAVEWebScheduleItem);
            }}
          />
        </View>
        {editorOpen || selectedTask || !compactTaskWorkspace ? (
          <View
            style={[
              styles.taskInspectorPane,
              compactTaskWorkspace && styles.taskInspectorPaneCompact,
              editorOpen && styles.taskInspectorPaneEditing,
            ]}
          >
            {editorOpen ? (
              <TaskEditor
                key={`${editingTask?.id ?? 'new-task'}:${editorRevision}`}
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
                  setConflictDraft(null);
                }}
                onSave={saveTask}
              />
            ) : selectedTask ? (
              <TaskDetailsPanel
                task={selectedTask}
                onClose={() => setSelectedTaskId(null)}
                onEdit={() => openEdit(selectedTask)}
                onDelete={() => {
                  setNotice(null);
                  setDeleteCandidate(selectedTask);
                }}
              />
            ) : (
              <TaskInspectorEmpty onAddTask={openCreate} />
            )}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function TaskViewTab({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.taskViewTab, active && styles.taskViewTabActive, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.taskViewTabText, active && styles.taskViewTabTextActive]}>{label}</Text>
      <View style={[styles.taskViewCount, active && styles.taskViewCountActive]}>
        <Text style={[styles.taskViewCountText, active && styles.taskViewCountTextActive]}>{count}</Text>
      </View>
    </Pressable>
  );
}

function TaskFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.taskFilterField}>
      <Text style={styles.taskFilterLabel}>{label}</Text>
      {createElement(
        'select' as any,
        {
          value,
          onChange: (event: any) => onChange(event.target.value),
          'aria-label': `Filter tasks by ${label.toLowerCase()}`,
          style: {
            height: 40,
            minWidth: label === 'Area' ? 170 : 142,
            border: `1px solid ${desktopSurfaces.border}`,
            borderRadius: 10,
            background: desktopSurfaces.input,
            color: desktopSurfaces.text,
            fontSize: 13,
            fontWeight: 700,
            padding: '0 32px 0 12px',
            fontFamily: 'inherit',
          },
        },
        options.map(option => createElement(
          'option' as any,
          { key: option.value, value: option.value },
          option.label,
        )),
      )}
    </View>
  );
}

function WorkspaceFilterSelect({
  label,
  value,
  options,
  onChange,
  accessibilitySubject,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  accessibilitySubject: string;
}) {
  return (
    <View style={styles.taskFilterField}>
      <Text style={styles.taskFilterLabel}>{label}</Text>
      {createElement(
        'select' as any,
        {
          value,
          onChange: (event: any) => onChange(event.target.value),
          'aria-label': `Filter ${accessibilitySubject} by ${label.toLowerCase()}`,
          style: {
            height: 40,
            minWidth: label === 'Area' ? 170 : 150,
            border: `1px solid ${desktopSurfaces.border}`,
            borderRadius: 10,
            background: desktopSurfaces.input,
            color: desktopSurfaces.text,
            fontSize: 13,
            fontWeight: 700,
            padding: '0 32px 0 12px',
            fontFamily: 'inherit',
          },
        },
        options.map(option => createElement(
          'option' as any,
          { key: option.value, value: option.value },
          option.label,
        )),
      )}
    </View>
  );
}

function GroupedTaskList({
  tasks,
  selectedTaskId,
  autoExpandMatches,
  onSelect,
  onEdit,
  onDelete,
}: {
  tasks: readonly ScheduleItem[];
  selectedTaskId?: string | null;
  autoExpandMatches?: boolean;
  onSelect?: (task: ScheduleItem) => void;
  onEdit?: (task: ScheduleItem) => void;
  onDelete?: (task: ScheduleItem) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = useMemo(
    () => buildDAVEWebTaskRenderPage(tasks, pageIndex),
    [tasks, pageIndex],
  );
  const projectGroups = useMemo(() => {
    const grouped = new Map<string, DAVEWebTaskRenderGroup[]>();
    for (const group of page.groups) {
      const projectAreas = grouped.get(group.projectName) ?? [];
      projectAreas.push(group);
      grouped.set(group.projectName, projectAreas);
    }
    return [...grouped.entries()].map(([projectName, areas]) => ({
      projectName,
      projectTaskCount: areas[0]?.projectTaskCount ?? areas.reduce(
        (total, area) => total + area.areaTaskCount,
        0,
      ),
      areas,
    }));
  }, [page.groups]);
  const projectNames = useMemo(
    () => projectGroups.map(group => group.projectName),
    [projectGroups],
  );
  const areaKeys = useMemo(
    () => projectGroups.flatMap(project => (
      project.areas.map(area => taskAreaGroupKey(project.projectName, area.areaName))
    )),
    [projectGroups],
  );
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(projectNames),
  );
  const [knownProjects, setKnownProjects] = useState<Set<string>>(
    () => new Set(projectNames),
  );
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(
    () => new Set(autoExpandMatches ? areaKeys : []),
  );
  useEffect(() => {
    if (page.pageIndex !== pageIndex) setPageIndex(page.pageIndex);
  }, [page.pageIndex, pageIndex]);
  useEffect(() => {
    const newProjects = projectNames.filter(projectName => !knownProjects.has(projectName));
    if (newProjects.length === 0) return;
    setKnownProjects(current => new Set([...current, ...newProjects]));
    setExpandedProjects(current => new Set([...current, ...newProjects]));
  }, [knownProjects, projectNames]);
  useEffect(() => {
    if (!autoExpandMatches) return;
    setExpandedProjects(current => new Set([...current, ...projectNames]));
    setExpandedAreas(current => new Set([...current, ...areaKeys]));
  }, [areaKeys, autoExpandMatches, projectNames]);
  useEffect(() => {
    if (!selectedTaskId) return;
    for (const project of projectGroups) {
      const selectedArea = project.areas.find(area => (
        area.data.some(task => task.id === selectedTaskId)
      ));
      if (!selectedArea) continue;
      setExpandedProjects(current => new Set(current).add(project.projectName));
      setExpandedAreas(current => (
        new Set(current).add(taskAreaGroupKey(project.projectName, selectedArea.areaName))
      ));
      break;
    }
  }, [projectGroups, selectedTaskId]);
  if (tasks.length === 0) return <EmptyState text="No tasks are in this view." />;

  const expandAll = () => {
    setExpandedProjects(new Set(projectNames));
    setExpandedAreas(new Set(areaKeys));
  };
  const collapseAll = () => {
    setExpandedProjects(new Set());
    setExpandedAreas(new Set());
  };
  const toggleProject = (projectName: string) => {
    setExpandedProjects(current => toggleSetValue(current, projectName));
  };
  const toggleArea = (projectName: string, areaName: string) => {
    setExpandedAreas(current => toggleSetValue(
      current,
      taskAreaGroupKey(projectName, areaName),
    ));
  };

  return (
    <View style={styles.taskGroups}>
      <View style={styles.taskHierarchyToolbar}>
        <View style={styles.taskHierarchyToolbarCopy}>
          <Text style={styles.taskHierarchyToolbarTitle}>Tasks by project and area</Text>
          <Text style={styles.taskHierarchyToolbarDetail}>
            Select an area to show its tasks.
          </Text>
        </View>
        <View style={styles.taskHierarchyActions}>
          <Pressable
            style={({ pressed }) => [styles.taskHierarchyButton, pressed && styles.buttonPressed]}
            onPress={expandAll}
            accessibilityRole="button"
          >
            <Text style={styles.taskHierarchyButtonText}>Expand all</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.taskHierarchyButton, pressed && styles.buttonPressed]}
            onPress={collapseAll}
            accessibilityRole="button"
          >
            <Text style={styles.taskHierarchyButtonText}>Collapse all</Text>
          </Pressable>
        </View>
      </View>
      {projectGroups.map(project => {
        const projectExpanded = expandedProjects.has(project.projectName);
        return (
          <View key={project.projectName} style={styles.taskProjectGroup}>
            <Pressable
              style={({ pressed }) => [
                styles.taskProjectHeading,
                pressed && styles.taskHierarchyHeadingPressed,
              ]}
              onPress={() => toggleProject(project.projectName)}
              accessibilityRole="button"
              accessibilityLabel={`${projectExpanded ? 'Collapse' : 'Expand'} ${project.projectName}`}
              accessibilityState={{ expanded: projectExpanded }}
            >
              <View style={styles.taskProjectHeadingCopy}>
                <Ionicons
                  name={projectExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={20}
                  color={desktopSurfaces.accentText}
                />
                <Text style={styles.taskProjectTitle}>{project.projectName}</Text>
              </View>
              <Text style={styles.taskProjectCount}>
                {project.projectTaskCount} {project.projectTaskCount === 1 ? 'task' : 'tasks'}
              </Text>
            </Pressable>
            {projectExpanded ? project.areas.map(area => {
              const areaKey = taskAreaGroupKey(project.projectName, area.areaName);
              const areaExpanded = expandedAreas.has(areaKey);
              return (
                <View key={areaKey} style={styles.taskGroup}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.taskAreaHeading,
                      pressed && styles.taskHierarchyHeadingPressed,
                    ]}
                    onPress={() => toggleArea(project.projectName, area.areaName)}
                    accessibilityRole="button"
                    accessibilityLabel={`${areaExpanded ? 'Collapse' : 'Expand'} ${area.areaName}`}
                    accessibilityState={{ expanded: areaExpanded }}
                  >
                    <View style={styles.taskAreaHeadingCopy}>
                      <Ionicons
                        name={areaExpanded ? 'chevron-down' : 'chevron-forward'}
                        size={18}
                        color={desktopSurfaces.accent}
                      />
                      <Text style={styles.taskAreaTitle}>{area.areaName}</Text>
                    </View>
                    <Text style={styles.taskAreaCount}>
                      {area.areaTaskCount} {area.areaTaskCount === 1 ? 'task' : 'tasks'}
                    </Text>
                  </Pressable>
                  {areaExpanded ? (
                    <View style={styles.taskAreaContent}>
                      <TaskList
                        tasks={area.data}
                        selectedTaskId={selectedTaskId}
                        onSelect={onSelect}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </View>
                  ) : null}
                </View>
              );
            }) : null}
          </View>
        );
      })}
      {page.pageCount > 1 ? (
        <View style={styles.taskPaginationFooter}>
          <Text style={styles.dataDetail}>
            Showing {page.firstRenderedTaskNumber}–{page.lastRenderedTaskNumber} of {page.totalTaskCount} tasks
          </Text>
          <View style={styles.inlineButtons}>
            {page.hasPreviousPage ? (
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={() => setPageIndex(page.pageIndex - 1)}
                accessibilityRole="button"
                accessibilityLabel="Show previous task page"
              >
                <Text style={styles.secondaryButtonText}>Previous</Text>
              </Pressable>
            ) : null}
            {page.hasNextPage ? (
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={() => setPageIndex(page.pageIndex + 1)}
                accessibilityRole="button"
                accessibilityLabel={`Show next ${Math.min(
                  DAVE_WEB_TASK_PAGE_SIZE,
                  page.totalTaskCount - page.lastRenderedTaskNumber,
                )} tasks`}
              >
                <Text style={styles.secondaryButtonText}>Next</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function taskAreaGroupKey(projectName: string, areaName: string): string {
  return `${projectName}\u0000${areaName}`;
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
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
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Project item type</Text>
        <OptionButtons<ProjectItemType>
          options={PROJECT_ITEM_TYPES}
          value={draft.itemType}
          onChange={value => updateField('itemType', value)}
        />
      </View>
      <ChoiceOrTypeField label="Project" value={draft.projectName} options={projectOptions} onChange={value => updateField('projectName', value)} />
      <ChoiceOrTypeField label="Location / area" value={draft.locationName} options={locationOptions} onChange={value => updateField('locationName', value)} optional />

      <View style={styles.twoColumnFields}>
        <View style={styles.flexField}>
          <WebDateField label="Start date" value={draft.startDate} onChange={value => updateField('startDate', value)} optional />
        </View>
        <View style={styles.flexField}>
          <WebDateField label="Finish / due date" value={draft.finishDate} onChange={value => updateField('finishDate', value)} optional />
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
      <LabeledTextField
        label="Next action"
        value={draft.nextAction}
        onChangeText={value => updateField('nextAction', value)}
        placeholder="Smallest accountable next step"
        optional
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

      {task?.activity?.length ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Recent activity</Text>
          {task.activity.slice(-3).reverse().map(entry => (
            <View key={entry.id} style={styles.activityEntry}>
              <Text style={styles.dataDetail}>{entry.message}</Text>
              <Text style={styles.dataMeta}>{entry.author} · {formatDateTime(entry.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Add activity <Text style={styles.optionalLabel}>(optional)</Text></Text>
        <TextInput
          value={draft.activityMessage}
          onChangeText={value => updateField('activityMessage', value)}
          multiline
          numberOfLines={3}
          placeholder="Progress note, decision, or follow-up"
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
          {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : <Text style={styles.primaryButtonText}>{task ? 'Save Task Changes' : 'Create Task'}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function WebDateField({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label} {optional ? <Text style={styles.optionalLabel}>(optional)</Text> : null}</Text>
      {createElement('input' as any, {
        type: 'date',
        value: dateInputValue(value),
        onChange: (event: any) => onChange(event.target.value),
        'aria-label': label,
        style: {
          minHeight: 52,
          border: `1px solid ${desktopSurfaces.border}`,
          borderRadius: 12,
          background: desktopSurfaces.input,
          color: desktopSurfaces.text,
          fontSize: 16,
          padding: '0 16px',
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        },
      })}
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
        accessibilityLabel={label}
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
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option}`}
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
        accessibilityLabel={`${label}, custom value`}
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
          accessibilityRole="radio"
          accessibilityLabel={option}
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
    itemType: task?.itemType ?? 'Task',
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
    nextAction: task?.nextAction ?? '',
    activityMessage: '',
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
  selectedTaskId,
  onSelect,
  onEdit,
  onDelete,
}: {
  tasks: readonly ScheduleItem[];
  selectedTaskId?: string | null;
  onSelect?: (task: ScheduleItem) => void;
  onEdit?: (task: ScheduleItem) => void;
  onDelete?: (task: ScheduleItem) => void;
}) {
  if (tasks.length === 0) return <EmptyState text="No tasks match this view." />;
  return (
    <View style={styles.list}>
      {tasks.map(task => (
        <View
          key={task.id}
          style={[
            styles.dataCard,
            styles.taskListCard,
            selectedTaskId === task.id && styles.taskListCardSelected,
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.taskCardMain, pressed && styles.taskCardMainPressed]}
            onPress={() => onSelect?.(task)}
            accessibilityRole={onSelect ? 'button' : undefined}
            accessibilityLabel={onSelect ? `View details for ${task.taskName}` : undefined}
          >
            <View style={styles.dataRow}>
              <View style={styles.dataGrow}>
                <Text style={styles.dataTitle}>{task.taskName}</Text>
                <Text style={styles.dataMeta}>{task.projectName}{task.locationName ? ` · ${task.locationName}` : ''}</Text>
              </View>
              <View style={styles.taskBadgeColumn}>
                <StatusBadge label={task.itemType || 'Task'} tone="neutral" />
                <TaskStatusBadge task={task} />
              </View>
            </View>
            <View style={styles.taskCompactFacts}>
              <Text style={styles.dataDetail}>{task.percentComplete}% complete</Text>
              <Text style={styles.taskFactDivider}>•</Text>
              <Text style={styles.dataDetail}>Finish {formatDate(task.finishDate)}</Text>
              <Text style={styles.taskFactDivider}>•</Text>
              <Text style={styles.dataDetail}>{task.priority} priority</Text>
              {task.owner ? (
                <>
                  <Text style={styles.taskFactDivider}>•</Text>
                  <Text style={styles.dataDetail}>Owner {task.owner}</Text>
                </>
              ) : null}
            </View>
            {task.nextAction?.trim() ? <Text style={styles.taskNextAction} numberOfLines={2}>Next: {task.nextAction.trim()}</Text> : null}
          </Pressable>
          {onSelect || onEdit || onDelete ? (
            <View style={styles.taskCardActions}>
              {onSelect ? (
                <Pressable style={({ pressed }) => [styles.taskDetailsButton, pressed && styles.buttonPressed]} onPress={() => onSelect(task)} accessibilityRole="button">
                  <Text style={styles.taskDetailsButtonText}>View details</Text>
                </Pressable>
              ) : null}
              {onEdit ? (
                <Pressable style={({ pressed }) => [styles.taskTextAction, pressed && styles.buttonPressed]} onPress={() => onEdit(task)} accessibilityRole="button">
                  <Text style={styles.taskTextActionLabel}>Edit</Text>
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

function TaskInspectorEmpty({ onAddTask }: { onAddTask: () => void }) {
  return (
    <View style={styles.taskInspectorEmpty}>
      <View style={styles.taskInspectorEmptyIcon}>
        <Ionicons name="reader-outline" size={28} color={desktopSurfaces.accent} />
      </View>
      <Text style={styles.taskInspectorEmptyTitle}>Select a task</Text>
      <Text style={styles.taskInspectorEmptyText}>
        Review details, current status, responsibility, notes, and recent activity without leaving this page.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        onPress={onAddTask}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryButtonText}>Add a New Task</Text>
      </Pressable>
    </View>
  );
}

function TaskDetailsPanel({
  task,
  onClose,
  onEdit,
  onDelete,
}: {
  task: DAVEWebScheduleItem;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const latestActivity = task.activity?.[task.activity.length - 1] ?? null;
  return (
    <View style={styles.taskDetailsPanel}>
      <View style={styles.taskDetailsHeader}>
        <View style={styles.dataGrow}>
          <Text style={styles.taskDetailsEyebrow}>{task.itemType || 'Task'}</Text>
          <Text style={styles.taskDetailsTitle}>{task.taskName}</Text>
          <Text style={styles.dataMeta}>
            {task.scheduleProjectName || task.projectName}{task.locationName ? ` · ${task.locationName}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.taskInspectorClose, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Close task details"
        >
          <Ionicons name="close" size={20} color={colors.mutedText} />
        </Pressable>
      </View>

      <View style={styles.taskDetailsBadges}>
        <TaskStatusBadge task={task} />
        <StatusBadge label={`${task.priority} priority`} tone={task.priority === 'High' ? 'attention' : 'neutral'} />
      </View>

      <View style={styles.taskProgressHeader}>
        <Text style={styles.taskProgressLabel}>Progress</Text>
        <Text style={styles.taskProgressValue}>{task.percentComplete}%</Text>
      </View>
      <View style={styles.taskProgressTrack}>
        <View style={[styles.taskProgressFill, { width: `${Math.max(0, Math.min(task.percentComplete, 100))}%` }]} />
      </View>

      <View style={styles.taskDetailsFacts}>
        <TaskDetailFact label="Start" value={formatDate(task.startDate)} />
        <TaskDetailFact label="Finish / due" value={formatDate(task.finishDate)} />
        <TaskDetailFact label="Owner" value={task.owner || 'Unassigned'} />
        <TaskDetailFact label="Contractor" value={task.contractor || 'Not assigned'} />
      </View>

      {task.nextAction?.trim() ? (
        <View style={styles.taskDetailsCallout}>
          <Text style={styles.taskDetailsCalloutLabel}>Next action</Text>
          <Text style={styles.taskDetailsCalloutText}>{task.nextAction.trim()}</Text>
        </View>
      ) : null}

      {task.notes?.trim() ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Notes</Text>
          <Text style={styles.taskDetailsSectionText}>{task.notes.trim()}</Text>
        </View>
      ) : null}

      {latestActivity ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Latest activity</Text>
          <Text style={styles.taskDetailsSectionText}>{latestActivity.message}</Text>
          <Text style={styles.dataMeta}>{latestActivity.author} · {formatDateTime(latestActivity.createdAt)}</Text>
        </View>
      ) : null}

      <View style={styles.taskInspectorActions}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.taskInspectorEditButton, pressed && styles.buttonPressed]}
          onPress={onEdit}
          accessibilityRole="button"
        >
          <View style={styles.buttonLabelRow}>
            <Ionicons name="create-outline" size={18} color={desktopSurfaces.onAccent} />
            <Text style={styles.primaryButtonText}>Edit Task</Text>
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.deleteTextButton, pressed && styles.buttonPressed]}
          onPress={onDelete}
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TaskDetailFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.taskDetailFact}>
      <Text style={styles.taskDetailFactLabel}>{label}</Text>
      <Text style={styles.taskDetailFactValue}>{value}</Text>
    </View>
  );
}

type FieldActivityKindFilter = 'all' | 'photos' | 'tasks' | 'notes';
type PhotoActionFilter = 'all' | 'needs_action' | 'no_action';
type PhotoWorkspaceItem = Readonly<{
  update: CloudProjectUpdate<ProjectUpdate>;
  photo: UpdatePhoto;
}>;

function FieldActivityWorkspace({ updates }: { updates: readonly CloudProjectUpdate<ProjectUpdate>[] }) {
  const { width } = useWindowDimensions();
  const compactWorkspace = width < 1120;
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<FieldActivityKindFilter>('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const sortedUpdates = useMemo(() => [...updates].sort(compareCloudUpdatesNewestFirst), [updates]);
  const photoCount = updates.reduce((total, update) => total + update.updateData.photos.length, 0);
  const areaOptions = uniqueOptions(updates.map(fieldUpdateAreaName));
  const linkedTaskCount = updates.filter(update => Boolean(update.updateData.scheduleTaskName?.trim())).length;
  const visibleUpdates = useMemo(() => {
    const query = normalizedName(searchQuery);
    return sortedUpdates.filter(update => {
      if (query && !fieldUpdateSearchText(update).includes(query)) return false;
      if (areaFilter !== 'all' && normalizedName(fieldUpdateAreaName(update)) !== normalizedName(areaFilter)) return false;
      if (kindFilter === 'photos' && update.updateData.photos.length === 0) return false;
      if (kindFilter === 'tasks' && !update.updateData.scheduleTaskName?.trim()) return false;
      if (kindFilter === 'notes' && !update.updateData.notes?.trim()) return false;
      return true;
    });
  }, [areaFilter, kindFilter, searchQuery, sortedUpdates]);
  const selectedUpdate = updates.find(update => update.id === selectedUpdateId) ?? null;
  const filtersActive = Boolean(searchQuery.trim() || kindFilter !== 'all' || areaFilter !== 'all');

  useEffect(() => {
    if (selectedUpdateId && !visibleUpdates.some(update => update.id === selectedUpdateId)) {
      setSelectedUpdateId(null);
    }
  }, [selectedUpdateId, visibleUpdates]);

  return (
    <Section
      title={`${updates.length} field update${updates.length === 1 ? '' : 's'}`}
      detail="The newest field records appear first, with project, area, task, notes, and photo context kept together."
    >
      <WorkspaceSummary metrics={[
        { icon: 'camera-outline', label: 'Photos', value: photoCount },
        { icon: 'map-outline', label: 'Areas', value: areaOptions.length },
        { icon: 'checkbox-outline', label: 'Task Updates', value: linkedTaskCount, tone: linkedTaskCount ? 'success' : 'neutral' },
      ]} />
      <WorkspaceSearch
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
        placeholder="Search project, area, task, note, or photo"
        accessibilityLabel="Search field activity"
      />
      <View style={styles.taskControlsRow}>
        <View style={styles.taskFilters}>
          <WorkspaceFilterSelect
            label="Update type"
            value={kindFilter}
            options={[
              { value: 'all', label: 'All updates' },
              { value: 'photos', label: 'With photos' },
              { value: 'tasks', label: 'Task updates' },
              { value: 'notes', label: 'With notes' },
            ]}
            onChange={value => setKindFilter(value as FieldActivityKindFilter)}
            accessibilitySubject="field activity"
          />
          <WorkspaceFilterSelect
            label="Area"
            value={areaFilter}
            options={[
              { value: 'all', label: 'All areas' },
              ...areaOptions.map(area => ({ value: area, label: area })),
            ]}
            onChange={setAreaFilter}
            accessibilitySubject="field activity"
          />
          {filtersActive ? (
            <Pressable
              onPress={() => {
                setSearchQuery('');
                setKindFilter('all');
                setAreaFilter('all');
              }}
              style={({ pressed }) => [styles.clearFiltersButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.taskResultCount}>Showing {visibleUpdates.length} of {updates.length} field updates</Text>
      <View style={styles.taskWorkspaceBody}>
        <View style={styles.taskListPane}>
          <EvidenceList
            updates={visibleUpdates}
            selectedUpdateId={selectedUpdateId}
            onSelect={update => setSelectedUpdateId(update.id)}
          />
        </View>
        {selectedUpdate || !compactWorkspace ? (
          <View style={[styles.taskInspectorPane, compactWorkspace && styles.taskInspectorPaneCompact]}>
            {selectedUpdate ? (
              <FieldActivityDetailsPanel
                update={selectedUpdate}
                onClose={() => setSelectedUpdateId(null)}
              />
            ) : (
              <WorkspaceInspectorEmpty
                icon="pulse-outline"
                title="Select a field update"
                detail="Choose an update to review its note, linked task, area, and photo details."
              />
            )}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function EvidenceList({
  updates,
  selectedUpdateId,
  onSelect,
}: {
  updates: readonly CloudProjectUpdate<ProjectUpdate>[];
  selectedUpdateId: string | null;
  onSelect: (update: CloudProjectUpdate<ProjectUpdate>) => void;
}) {
  if (updates.length === 0) return <EmptyState text="No field activity matches these filters." />;
  return (
    <View style={styles.evidenceList}>
      {updates.map(update => {
        const selected = selectedUpdateId === update.id;
        const note = update.updateData.notes?.trim();
        return (
          <Pressable
            key={update.id}
            style={({ pressed }) => [
              styles.dataCard,
              styles.evidenceCard,
              selected && styles.evidenceCardSelected,
              pressed && styles.taskCardMainPressed,
            ]}
            onPress={() => onSelect(update)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`View ${update.projectName} field update from ${formatDateTime(fieldUpdateTime(update))}`}
          >
            <View style={styles.evidenceCardHeader}>
              <View style={styles.evidenceIcon}>
                <Ionicons name={update.updateData.photos.length ? 'camera-outline' : 'document-text-outline'} size={21} color={desktopSurfaces.accent} />
              </View>
              <View style={styles.dataGrow}>
                <Text style={styles.dataTitle}>{update.projectName}</Text>
                <Text style={styles.dataMeta}>{fieldUpdateAreaName(update)}</Text>
              </View>
              <StatusBadge label={`${update.updateData.photos.length} photo${update.updateData.photos.length === 1 ? '' : 's'}`} tone="neutral" />
            </View>
            <Text style={styles.evidenceDate}>{formatDateTime(fieldUpdateTime(update))}</Text>
            <Text style={note ? styles.dataDetail : styles.emptyRecordText} numberOfLines={3}>
              {note || 'No field note was added.'}
            </Text>
            <View style={styles.evidenceCardFooter}>
              {update.updateData.scheduleTaskName ? (
                <View style={styles.linkedTaskPill}>
                  <Ionicons name="checkbox-outline" size={16} color={desktopSurfaces.accent} />
                  <Text style={styles.linkedTaskText} numberOfLines={2}>{update.updateData.scheduleTaskName}</Text>
                </View>
              ) : <View />}
              <Text style={styles.viewDetailsText}>View update</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function FieldActivityDetailsPanel({
  update,
  onClose,
}: {
  update: CloudProjectUpdate<ProjectUpdate>;
  onClose: () => void;
}) {
  const note = update.updateData.notes?.trim();
  return (
    <View style={styles.taskDetailsPanel}>
      <WorkspaceInspectorHeader
        eyebrow="FIELD UPDATE"
        title={update.projectName}
        onClose={onClose}
      />
      <View style={styles.taskDetailsFacts}>
        <TaskDetailFact label="Area" value={fieldUpdateAreaName(update)} />
        <TaskDetailFact label="Recorded" value={formatDateTime(fieldUpdateTime(update))} />
        <TaskDetailFact label="Photos" value={String(update.updateData.photos.length)} />
      </View>
      {update.updateData.scheduleTaskName ? (
        <View style={styles.taskDetailsCallout}>
          <Text style={styles.taskDetailsCalloutLabel}>Linked task</Text>
          <Text style={styles.taskDetailsCalloutText}>{update.updateData.scheduleTaskName}</Text>
        </View>
      ) : null}
      <View style={styles.taskDetailsSection}>
        <Text style={styles.taskDetailsSectionTitle}>Field note</Text>
        <Text style={note ? styles.taskDetailsSectionText : styles.emptyRecordText}>
          {note || 'No field note was added.'}
        </Text>
      </View>
      {update.updateData.photos.length ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Photos in this update</Text>
          <View style={styles.evidenceInspectorPhotos}>
            {update.updateData.photos.slice(0, 3).map(photo => (
              <View key={photo.id} style={styles.evidenceInspectorPhoto}>
                <SignedPhotoPreview
                  photo={photo}
                  projectName={update.projectName}
                  areaName={fieldUpdateAreaName(update)}
                />
                <Text style={styles.dataMeta} numberOfLines={2}>{photo.caption?.trim() || photo.category}</Text>
              </View>
            ))}
          </View>
          {update.updateData.photos.length > 3 ? (
            <Text style={styles.dataMeta}>+{update.updateData.photos.length - 3} more photos in this update</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function PhotoWorkspace({ photos }: { photos: readonly PhotoWorkspaceItem[] }) {
  const { width } = useWindowDimensions();
  const compactWorkspace = width < 1120;
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState<PhotoActionFilter>('all');
  const [selectedPhotoKey, setSelectedPhotoKey] = useState<string | null>(null);
  const sortedPhotos = useMemo(() => [...photos].sort(comparePhotoItemsNewestFirst), [photos]);
  const areaOptions = uniqueOptions(photos.map(photoAreaName));
  const categoryOptions = uniqueOptions(photos.map(({ photo }) => photo.category));
  const updateCount = new Set(photos.map(({ update }) => update.id)).size;
  const actionCount = photos.filter(({ photo }) => Boolean(photo.actionRequired?.trim())).length;
  const visiblePhotos = useMemo(() => {
    const query = normalizedName(searchQuery);
    return sortedPhotos.filter(item => {
      if (query && !photoSearchText(item).includes(query)) return false;
      if (areaFilter !== 'all' && normalizedName(photoAreaName(item)) !== normalizedName(areaFilter)) return false;
      if (categoryFilter !== 'all' && normalizedName(item.photo.category) !== normalizedName(categoryFilter)) return false;
      if (actionFilter === 'needs_action' && !item.photo.actionRequired?.trim()) return false;
      if (actionFilter === 'no_action' && item.photo.actionRequired?.trim()) return false;
      return true;
    });
  }, [actionFilter, areaFilter, categoryFilter, searchQuery, sortedPhotos]);
  const selectedPhoto = photos.find(item => photoItemKey(item) === selectedPhotoKey) ?? null;
  const priorPhoto = selectedPhoto ? priorComparablePhotoFor(selectedPhoto, photos) : null;
  const filtersActive = Boolean(
    searchQuery.trim() ||
    areaFilter !== 'all' ||
    categoryFilter !== 'all' ||
    actionFilter !== 'all',
  );

  useEffect(() => {
    if (selectedPhotoKey && !visiblePhotos.some(item => photoItemKey(item) === selectedPhotoKey)) {
      setSelectedPhotoKey(null);
    }
  }, [selectedPhotoKey, visiblePhotos]);

  return (
    <Section
      title={`${photos.length} project photo${photos.length === 1 ? '' : 's'}`}
      detail="Photos stay tied to the project, area, task, and field update that created them."
    >
      <WorkspaceSummary metrics={[
        { icon: 'map-outline', label: 'Areas', value: areaOptions.length },
        { icon: 'pulse-outline', label: 'Field Updates', value: updateCount },
        { icon: 'flag-outline', label: 'Need Action', value: actionCount, tone: actionCount ? 'warning' : 'neutral' },
      ]} />
      <WorkspaceSearch
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
        placeholder="Search project, area, task, caption, or note"
        accessibilityLabel="Search project photos"
      />
      <View style={styles.taskControlsRow}>
        <View style={styles.taskFilters}>
          <WorkspaceFilterSelect
            label="Area"
            value={areaFilter}
            options={[
              { value: 'all', label: 'All areas' },
              ...areaOptions.map(area => ({ value: area, label: area })),
            ]}
            onChange={setAreaFilter}
            accessibilitySubject="project photos"
          />
          <WorkspaceFilterSelect
            label="Category"
            value={categoryFilter}
            options={[
              { value: 'all', label: 'All categories' },
              ...categoryOptions.map(category => ({ value: category, label: category })),
            ]}
            onChange={setCategoryFilter}
            accessibilitySubject="project photos"
          />
          <WorkspaceFilterSelect
            label="Action"
            value={actionFilter}
            options={[
              { value: 'all', label: 'All photos' },
              { value: 'needs_action', label: 'Needs action' },
              { value: 'no_action', label: 'No action' },
            ]}
            onChange={value => setActionFilter(value as PhotoActionFilter)}
            accessibilitySubject="project photos"
          />
          {filtersActive ? (
            <Pressable
              onPress={() => {
                setSearchQuery('');
                setAreaFilter('all');
                setCategoryFilter('all');
                setActionFilter('all');
              }}
              style={({ pressed }) => [styles.clearFiltersButton, pressed && styles.buttonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.taskResultCount}>Showing {visiblePhotos.length} of {photos.length} project photos</Text>
      <View style={styles.taskWorkspaceBody}>
        <View style={styles.taskListPane}>
          <PhotoList
            photos={visiblePhotos}
            selectedPhotoKey={selectedPhotoKey}
            onSelect={item => setSelectedPhotoKey(photoItemKey(item))}
          />
        </View>
        {selectedPhoto || !compactWorkspace ? (
          <View style={[styles.photoInspectorPane, compactWorkspace && styles.taskInspectorPaneCompact]}>
            {selectedPhoto ? (
              <PhotoDetailsPanel
                item={selectedPhoto}
                priorItem={priorPhoto}
                onClose={() => setSelectedPhotoKey(null)}
              />
            ) : (
              <WorkspaceInspectorEmpty
                icon="images-outline"
                title="Select a project photo"
                detail="Choose a photo to review its field context and the closest earlier photo from the same project and area."
              />
            )}
          </View>
        ) : null}
      </View>
    </Section>
  );
}

function PhotoList({
  photos,
  selectedPhotoKey,
  onSelect,
}: {
  photos: readonly PhotoWorkspaceItem[];
  selectedPhotoKey: string | null;
  onSelect: (item: PhotoWorkspaceItem) => void;
}) {
  if (photos.length === 0) return <EmptyState text="No project photos match these filters." />;
  return (
    <View style={styles.photoGrid}>
      {photos.map(item => {
        const { update, photo } = item;
        const selected = selectedPhotoKey === photoItemKey(item);
        return (
          <Pressable
            key={photoItemKey(item)}
            style={({ pressed }) => [
              styles.photoCard,
              selected && styles.photoCardSelected,
              pressed && styles.photoCardPressed,
            ]}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`View ${photo.caption?.trim() || 'project photo'} from ${photoAreaName(item)}`}
          >
            <SignedPhotoPreview
              photo={photo}
              projectName={update.projectName}
              areaName={photoAreaName(item)}
            />
            <View style={styles.photoCardBody}>
              <Text style={styles.dataTitle}>{photo.caption?.trim() || 'Project photo'}</Text>
              <Text style={styles.dataMeta}>{update.projectName} · {photoAreaName(item)}</Text>
              <Text style={styles.dataDetail}>{photo.category} · {formatDateTime(photoCaptureTime(item))}</Text>
              {update.updateData.scheduleTaskName ? (
                <View style={styles.linkedTaskPill}>
                  <Ionicons name="checkbox-outline" size={16} color={desktopSurfaces.accent} />
                  <Text style={styles.linkedTaskText} numberOfLines={2}>{update.updateData.scheduleTaskName}</Text>
                </View>
              ) : null}
              {photo.actionRequired ? (
                <View style={styles.photoActionCard}>
                  <Ionicons name="flag-outline" size={17} color={colors.warning} />
                  <Text style={styles.photoActionText}>{photo.actionRequired}</Text>
                </View>
              ) : null}
              <Text style={styles.viewDetailsText}>View photo details</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PhotoDetailsPanel({
  item,
  priorItem,
  onClose,
}: {
  item: PhotoWorkspaceItem;
  priorItem: PhotoWorkspaceItem | null;
  onClose: () => void;
}) {
  const { update, photo } = item;
  const intelligence = photo.photoIntelligence;
  return (
    <View style={styles.taskDetailsPanel}>
      <WorkspaceInspectorHeader
        eyebrow="PROJECT PHOTO"
        title={photo.caption?.trim() || 'Project photo'}
        onClose={onClose}
      />
      <View style={styles.taskDetailsFacts}>
        <TaskDetailFact label="Project" value={update.projectName} />
        <TaskDetailFact label="Area" value={photoAreaName(item)} />
        <TaskDetailFact label="Captured" value={formatDateTime(photoCaptureTime(item))} />
        <TaskDetailFact label="Category" value={photo.category} />
      </View>
      {update.updateData.scheduleTaskName ? (
        <View style={styles.taskDetailsCallout}>
          <Text style={styles.taskDetailsCalloutLabel}>Linked task</Text>
          <Text style={styles.taskDetailsCalloutText}>{update.updateData.scheduleTaskName}</Text>
        </View>
      ) : null}
      <View style={styles.photoComparisonContext}>
        <Text style={styles.taskDetailsSectionTitle}>Chronological context</Text>
        <Text style={styles.photoComparisonExplanation}>
          {priorItem
            ? 'An earlier photo from the same project and area is shown below. The order comes from recorded capture times; no visual change is assumed.'
            : 'No earlier photo from the same project and area is in this workspace. This photo is shown as a baseline, not a comparison.'}
        </Text>
        <ComparisonPhoto label="Selected photo" item={item} />
        {priorItem ? <ComparisonPhoto label="Earlier photo" item={priorItem} /> : null}
      </View>
      {update.updateData.notes?.trim() ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Field note</Text>
          <Text style={styles.taskDetailsSectionText}>{update.updateData.notes.trim()}</Text>
        </View>
      ) : null}
      {photo.actionRequired?.trim() ? (
        <View style={styles.photoActionCard}>
          <Ionicons name="flag-outline" size={17} color={colors.warning} />
          <View style={styles.dataGrow}>
            <Text style={styles.taskDetailsSectionTitle}>Action needed</Text>
            <Text style={styles.photoActionText}>{photo.actionRequired}</Text>
            {photo.actionOwner?.trim() ? <Text style={styles.dataMeta}>Owner: {photo.actionOwner}</Text> : null}
          </View>
        </View>
      ) : null}
      {intelligence ? (
        <View style={styles.taskDetailsSection}>
          <View style={styles.photoAnalysisHeading}>
            <Text style={styles.taskDetailsSectionTitle}>Recorded photo analysis</Text>
            <StatusBadge label={photoAnalysisStatusLabel(intelligence.status)} tone={photoAnalysisStatusTone(intelligence.status)} />
          </View>
          <Text style={styles.taskDetailsSectionText}>{intelligence.summary}</Text>
          {intelligence.visibleChange?.trim() ? (
            <Text style={styles.photoAnalysisObservation}>{intelligence.visibleChange}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ComparisonPhoto({ label, item }: { label: string; item: PhotoWorkspaceItem }) {
  return (
    <View style={styles.comparisonPhoto}>
      <View style={styles.comparisonPhotoHeading}>
        <Text style={styles.comparisonPhotoLabel}>{label}</Text>
        <Text style={styles.dataMeta}>{formatDateTime(photoCaptureTime(item))}</Text>
      </View>
      <SignedPhotoPreview
        photo={item.photo}
        projectName={item.update.projectName}
        areaName={photoAreaName(item)}
      />
    </View>
  );
}

function WorkspaceSearch({
  value,
  onChange,
  onClear,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.workspaceSearchField}>
      <Ionicons name="search-outline" size={20} color={colors.mutedText} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#7D8794"
        style={styles.taskSearchInput}
        accessibilityLabel={accessibilityLabel}
      />
      {value ? (
        <Pressable
          onPress={onClear}
          style={({ pressed }) => [styles.clearSearchButton, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${accessibilityLabel.toLowerCase()}`}
        >
          <Ionicons name="close" size={18} color={colors.mutedText} />
        </Pressable>
      ) : null}
    </View>
  );
}

function WorkspaceInspectorHeader({
  eyebrow,
  title,
  onClose,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.taskDetailsHeader}>
      <View style={styles.dataGrow}>
        <Text style={styles.taskDetailsEyebrow}>{eyebrow}</Text>
        <Text style={styles.taskDetailsTitle}>{title}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.taskInspectorClose, pressed && styles.buttonPressed]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close details"
      >
        <Ionicons name="close" size={20} color={colors.mutedText} />
      </Pressable>
    </View>
  );
}

function WorkspaceInspectorEmpty({
  icon,
  title,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
}) {
  return (
    <View style={styles.taskInspectorEmpty}>
      <View style={styles.taskInspectorEmptyIcon}>
        <Ionicons name={icon} size={25} color={desktopSurfaces.accent} />
      </View>
      <Text style={styles.taskInspectorEmptyTitle}>{title}</Text>
      <Text style={styles.taskInspectorEmptyText}>{detail}</Text>
    </View>
  );
}

function SignedPhotoPreview({
  photo,
  projectName,
  areaName,
}: {
  photo: UpdatePhoto;
  projectName: string;
  areaName: string;
}) {
  const auth = useDesktopAuth();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>(
    photo.cloudStoragePath ? 'loading' : 'unavailable',
  );

  useEffect(() => {
    const path = photo.cloudStoragePath?.trim();
    if (!path) {
      setSignedUrl(null);
      setState('unavailable');
      return;
    }
    let active = true;
    setState('loading');
    void auth.getArtifactUrl('project-photos', path)
      .then(url => {
        if (!active) return;
        setSignedUrl(url);
        setState('ready');
      })
      .catch(() => {
        if (!active) return;
        setSignedUrl(null);
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [auth.getArtifactUrl, photo.cloudStoragePath]);

  const label = `${photo.caption?.trim() || 'Project photo'} for ${projectName}${areaName ? `, ${areaName}` : ''}`;
  if (state === 'ready' && signedUrl) {
    return (
      <View style={styles.photoVisual}>
        <Image
          source={{ uri: signedUrl }}
          style={styles.photoImage}
          resizeMode="cover"
          accessible
          accessibilityLabel={label}
        />
        <View style={styles.photoAreaOverlay}>
          <Text style={styles.photoVisualArea} numberOfLines={1}>{areaName || 'Project area'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.photoVisual, styles.photoVisualUnavailable]} accessibilityLabel={label}>
      {state === 'loading' ? (
        <ActivityIndicator color={desktopSurfaces.accent} accessibilityLabel="Loading protected project photo" />
      ) : (
        <View style={styles.photoUnavailable}>
          <Ionicons name="image-outline" size={30} color={desktopSurfaces.accent} />
          <Text style={styles.photoUnavailableText}>
            {state === 'error' ? 'Photo temporarily unavailable' : 'Photo file unavailable'}
          </Text>
        </View>
      )}
      <Text style={styles.photoVisualAreaUnavailable} numberOfLines={1}>{areaName || 'Project area'}</Text>
    </View>
  );
}

type DocumentStatusFilter = 'all' | 'current' | 'prior' | 'other';

function DocumentManagementWorkspace({
  documents,
  projects,
  selectedProject,
}: {
  documents: readonly DAVEWebReferenceDocument[];
  projects: readonly string[];
  selectedProject: string | null;
}) {
  const auth = useDesktopAuth();
  const { width } = useWindowDimensions();
  const compactWorkspace = width < 1120;
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocumentStatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>('Schedules');
  const [uploadProjects, setUploadProjects] = useState<string[]>(
    selectedProject ? [selectedProject] : projects[0] ? [projects[0]] : [],
  );
  const [replacementId, setReplacementId] = useState<string>('');
  const [preparedUpload, setPreparedUpload] = useState<DAVEWebPreparedUpload | null>(null);
  const [preparedBytes, setPreparedBytes] = useState<ArrayBuffer | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const groups = useMemo(() => groupDAVEWebDocuments(documents), [documents]);
  const categoryOptions = useMemo(
    () => uniqueOptions(documents.map(document => document.category)),
    [documents],
  );
  const visibleDocuments = useMemo(() => {
    const query = normalizedName(searchQuery);
    return documents.filter(document => {
      if (query && !documentSearchText(document).includes(query)) return false;
      if (categoryFilter !== 'all' && normalizedName(document.category) !== normalizedName(categoryFilter)) return false;
      return statusFilter === 'all' || documentStatusKind(document) === statusFilter;
    });
  }, [categoryFilter, documents, searchQuery, statusFilter]);
  const visibleGroups = useMemo(
    () => groupDAVEWebDocuments(visibleDocuments),
    [visibleDocuments],
  );
  const selectedDocument = selectedDocumentId
    ? documents.find(document => document.id === selectedDocumentId) ?? null
    : null;
  const deleteCandidate = deleteCandidateId
    ? documents.find(document => document.id === deleteCandidateId) ?? null
    : null;
  const protectedCurrentSchedule = Boolean(
    deleteCandidate?.isCurrent && scheduleDocumentIsScheduleLike(deleteCandidate),
  );
  const linkedTasksAreRevisionSafe = Boolean(
    deleteCandidate?.linkedScheduleItems.every(item => Boolean(item.cloudUpdatedAt)),
  );

  useEffect(() => {
    if (selectedDocumentId && !documents.some(document => document.id === selectedDocumentId)) {
      setSelectedDocumentId(null);
    }
  }, [documents, selectedDocumentId]);

  async function chooseUploadFile(file: File | null) {
    if (!file) return;
    setNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const textReadable = /(?:csv|json|text|tab-separated|plain)/i.test(file.type) || /\.(?:csv|json|tsv|txt)$/i.test(file.name);
      const contents = textReadable ? await file.text() : null;
      const fingerprint = await fingerprintBytes(bytes);
      const replacement = documents.find(document => document.id === replacementId) || null;
      const prepared = prepareDAVEWebDocumentUpload({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        contents,
        category: uploadCategory,
        projectNames: uploadProjects,
        projects,
        fingerprint,
        versionGroupId: replacement?.webVersionGroupId || replacement?.id || null,
      });
      setPreparedUpload(prepared);
      setPreparedBytes(bytes);
    } catch (error) {
      setPreparedUpload(null);
      setPreparedBytes(null);
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'The document could not be prepared.' });
    }
  }

  async function uploadPreparedDocument() {
    if (!preparedUpload || !preparedBytes || uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      await auth.uploadDocument(preparedUpload, preparedBytes);
      setNotice({
        tone: 'good',
        text: preparedUpload.scheduleItems.length > 0
          ? `Document and ${preparedUpload.scheduleItems.length} reviewed schedule task${preparedUpload.scheduleItems.length === 1 ? '' : 's'} uploaded. Use Make Current when this schedule should replace the active version.`
          : 'Document uploaded and classified in the shared project record.',
      });
      setPreparedUpload(null);
      setPreparedBytes(null);
      setUploadOpen(false);
      setReplacementId('');
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
    } finally {
      setUploading(false);
    }
  }

  async function makeCurrent(document: DAVEWebReferenceDocument) {
    if (uploading || document.linkedScheduleItems.length === 0) return;
    setUploading(true);
    setNotice(null);
    try {
      await auth.setCurrentSchedule(document);
      setNotice({ tone: 'good', text: `“${document.name}” is now the current schedule. The prior schedule remains available as history.` });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
      await auth.refreshSnapshot();
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete(deleteLinkedTasks: boolean) {
    if (!deleteCandidate || protectedCurrentSchedule || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      await auth.deleteDocument(deleteCandidate, deleteLinkedTasks);
      const taskCount = deleteLinkedTasks ? deleteCandidate.linkedScheduleItems.length : 0;
      if (selectedDocumentId === deleteCandidate.id) setSelectedDocumentId(null);
      setDeleteCandidateId(null);
      setNotice({
        tone: 'good',
        text: taskCount > 0
          ? `Document and ${taskCount} linked task${taskCount === 1 ? '' : 's'} deleted and protected from returning.`
          : 'Document deleted and protected from returning on another device.',
      });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
      await auth.refreshSnapshot();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <WorkspaceSummary metrics={[
        { icon: 'checkmark-circle-outline', label: 'Current Schedule', value: groups.currentSchedule.length, tone: groups.currentSchedule.length ? 'success' : 'warning' },
        { icon: 'time-outline', label: 'Prior Versions', value: groups.priorScheduleVersions.length, tone: 'neutral' },
        { icon: 'checkbox-outline', label: 'Linked Tasks', value: documents.reduce((total, document) => total + document.linkedScheduleItems.length, 0) },
      ]} />
      <View style={styles.taskActionRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.addTaskButton, pressed && styles.buttonPressed]}
          onPress={() => setUploadOpen(current => !current)}
          accessibilityRole="button"
        >
          <View style={styles.buttonLabelRow}>
            <Ionicons name={uploadOpen ? 'close-circle-outline' : 'cloud-upload-outline'} size={20} color={desktopSurfaces.onAccent} />
            <Text style={styles.primaryButtonText}>{uploadOpen ? 'Close Upload' : 'Upload Document'}</Text>
          </View>
        </Pressable>
        <Text style={styles.taskSyncHint}>Files are limited to 25 MB and saved in protected project storage.</Text>
      </View>

      {uploadOpen ? (
        <View style={styles.editorCard}>
          <Text style={styles.editorTitle}>Add Project Document</Text>
          <Text style={styles.sectionDetail}>Classify the file, choose its project, and review schedule activities before anything is saved.</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Document type</Text>
            <OptionButtons<string> options={DAVE_WEB_DOCUMENT_CATEGORIES} value={uploadCategory} onChange={value => {
              setUploadCategory(value);
              setPreparedUpload(null);
              setPreparedBytes(null);
            }} />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Projects</Text>
            <Text style={styles.sectionDetail}>Select every project covered by this document. Schedule tasks keep their individual project assignment.</Text>
            <View style={styles.optionRow}>
              {projects.map(project => {
                const selected = uploadProjects.some(value => normalizedName(value) === normalizedName(project));
                return (
                  <Pressable
                    key={project}
                    style={({ pressed }) => [styles.smallChoice, selected && styles.choiceActive, pressed && styles.buttonPressed]}
                    onPress={() => {
                      setUploadProjects(current => selected
                        ? current.filter(value => normalizedName(value) !== normalizedName(project))
                        : [...current, project]);
                      setPreparedUpload(null);
                      setPreparedBytes(null);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{selected ? '✓ ' : ''}{project}</Text>
                  </Pressable>
                );
              })}
            </View>
            {uploadProjects.length === 0 ? <Text style={styles.errorText}>Select at least one project before choosing a file.</Text> : null}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Replace / create next version <Text style={styles.optionalLabel}>(optional)</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              <Pressable
                style={({ pressed }) => [styles.smallChoice, !replacementId && styles.choiceActive, pressed && styles.buttonPressed]}
                onPress={() => setReplacementId('')}
                accessibilityRole="radio"
                accessibilityLabel="Create a new document version group"
                accessibilityState={{ selected: !replacementId }}
              >
                <Text style={[styles.choiceText, !replacementId && styles.choiceTextActive]}>New document</Text>
              </Pressable>
              {documents.filter(document => normalizedName(document.category) === normalizedName(uploadCategory)).map(document => (
                <Pressable
                  key={document.id}
                  style={({ pressed }) => [styles.smallChoice, replacementId === document.id && styles.choiceActive, pressed && styles.buttonPressed]}
                  onPress={() => setReplacementId(document.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Create the next version of ${document.name}`}
                  accessibilityState={{ selected: replacementId === document.id }}
                >
                  <Text style={[styles.choiceText, replacementId === document.id && styles.choiceTextActive]}>{document.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <WebFilePicker
            label="Choose file"
            accept=".pdf,.csv,.tsv,.txt,.json,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
            onFile={file => { void chooseUploadFile(file); }}
          />
          {preparedUpload ? (
            <View style={styles.uploadReview}>
              <Text style={styles.cardTitle}>Review before upload</Text>
              <Text style={styles.dataDetail}>{preparedUpload.document.originalFileName} · {preparedUpload.document.category} · {formatFileSize(preparedUpload.document.sizeBytes || 0)}</Text>
              <Text style={preparedUpload.extractionStatus === 'needs_manual_review' ? styles.errorText : styles.dataMeta}>{preparedUpload.reviewMessage}</Text>
              {preparedUpload.scheduleItems.length > 0 ? (
                <View style={styles.list}>
                  {preparedUpload.scheduleItems.map((item, index) => (
                    <View key={item.id} style={[styles.dataCard, styles.taskListCard]}>
                      <View style={styles.dataRow}>
                        <View style={styles.dataGrow}>
                          <Text style={styles.dataTitle}>{item.taskName}</Text>
                          <Text style={styles.dataMeta}>{item.projectName}{item.locationName ? ` · ${item.locationName}` : ''}</Text>
                          <Text style={styles.dataDetail}>{item.status} · {item.percentComplete}% · Finish {formatDate(item.finishDate)}</Text>
                          {uploadProjects.length > 1 ? (
                            <View style={[styles.optionRow, styles.taskProjectChoices]}>
                              {uploadProjects.map(project => {
                                const selected = normalizedName(item.projectName) === normalizedName(project);
                                return (
                                  <Pressable
                                    key={`${item.id}:${project}`}
                                    style={({ pressed }) => [styles.smallChoice, selected && styles.choiceActive, pressed && styles.buttonPressed]}
                                    onPress={() => setPreparedUpload(current => current ? {
                                      ...current,
                                      scheduleItems: current.scheduleItems.map((task, taskIndex) => taskIndex === index
                                        ? { ...task, projectName: project, scheduleProjectName: project }
                                        : task),
                                    } : current)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected }}
                                  >
                                    <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{project}</Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                        <Pressable
                          style={({ pressed }) => [styles.deleteTextButton, pressed && styles.buttonPressed]}
                          onPress={() => setPreparedUpload(current => current ? {
                            ...current,
                            scheduleItems: current.scheduleItems.filter((_, taskIndex) => taskIndex !== index),
                          } : current)}
                        >
                          <Text style={styles.deleteText}>Exclude</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, uploading && styles.buttonDisabled]}
                onPress={() => { void uploadPreparedDocument(); }}
                disabled={uploading}
                accessibilityRole="button"
              >
                {uploading ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : <Text style={styles.primaryButtonText}>Upload Reviewed Document</Text>}
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {notice ? (
        <View style={notice.tone === 'good' ? styles.successBanner : styles.errorBanner} accessibilityRole="alert">
          <Text style={notice.tone === 'good' ? styles.successText : styles.errorText}>{notice.text}</Text>
        </View>
      ) : null}

      {deleteCandidate ? (
        <View style={styles.deleteConfirm} accessibilityRole="alert">
          <View style={styles.dataGrow}>
            <Text style={styles.deleteConfirmTitle}>Delete “{deleteCandidate.name}”?</Text>
            <Text style={styles.dataDetail}>Imported {formatDateTime(deleteCandidate.importedAt)}.</Text>
            {protectedCurrentSchedule ? (
              <Text style={styles.errorText}>This is the current schedule and is protected. Keep it; obsolete prior versions can be deleted below.</Text>
            ) : (
              <Text style={styles.dataMeta}>
                A permanent cloud deletion marker prevents this document from returning on another signed-in device.
                {deleteCandidate.linkedScheduleItems.length > 0
                  ? ` This import has ${deleteCandidate.linkedScheduleItems.length} linked task${deleteCandidate.linkedScheduleItems.length === 1 ? '' : 's'}.`
                  : ' No linked imported tasks were found.'}
                {deleteCandidate.linkedScheduleItems.length > 0 && !linkedTasksAreRevisionSafe
                  ? ' Those legacy tasks do not have safe cloud revisions, so this page will keep them.'
                  : ''}
              </Text>
            )}
          </View>
          <View style={styles.inlineButtons}>
            <Pressable
              style={({ pressed }) => [styles.secondaryButton, styles.compactActionButton, pressed && styles.buttonPressed]}
              onPress={() => setDeleteCandidateId(null)}
              disabled={deleting}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>{protectedCurrentSchedule ? 'Keep Current Schedule' : 'Cancel'}</Text>
            </Pressable>
            {!protectedCurrentSchedule ? (
              <Pressable
                style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
                onPress={() => { void confirmDelete(false); }}
                disabled={deleting}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>
                  {deleting ? 'Deleting…' : deleteCandidate.linkedScheduleItems.length > 0 ? 'Delete Document Only' : 'Delete Document'}
                </Text>
              </Pressable>
            ) : null}
            {!protectedCurrentSchedule && deleteCandidate.linkedScheduleItems.length > 0 && linkedTasksAreRevisionSafe ? (
              <Pressable
                style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
                onPress={() => { void confirmDelete(true); }}
                disabled={deleting}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>
                  {`Delete Document + ${deleteCandidate.linkedScheduleItems.length} Task${deleteCandidate.linkedScheduleItems.length === 1 ? '' : 's'}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.taskControlsRow}>
        <WorkspaceSearch
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={() => setSearchQuery('')}
          placeholder="Search document, project, category, note, or file name"
          accessibilityLabel="Search project documents"
        />
        <View style={styles.taskFilters}>
          <WorkspaceFilterSelect
            label="Status"
            value={statusFilter}
            onChange={value => setStatusFilter(value as DocumentStatusFilter)}
            accessibilitySubject="documents"
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'current', label: 'Current schedule' },
              { value: 'prior', label: 'Prior schedules' },
              { value: 'other', label: 'Other documents' },
            ]}
          />
          <WorkspaceFilterSelect
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            accessibilitySubject="documents"
            options={[
              { value: 'all', label: 'All categories' },
              ...categoryOptions.map(category => ({ value: category, label: category })),
            ]}
          />
          {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all' ? (
            <Pressable
              style={({ pressed }) => [styles.clearFiltersButton, pressed && styles.buttonPressed]}
              onPress={() => {
                setSearchQuery('');
                setStatusFilter('all');
                setCategoryFilter('all');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.taskResultCount}>
        Showing {visibleDocuments.length} of {documents.length} project documents
      </Text>

      <View style={styles.taskWorkspaceBody}>
        <View style={styles.taskListPane}>
          <View style={styles.documentGroups}>
            <DocumentGroup
              title="Current schedule"
              detail="The schedule currently used for project planning. It is protected from deletion."
              documents={visibleGroups.currentSchedule}
              emptyText="No current schedule matches this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={document => setSelectedDocumentId(document.id)}
            />
            <DocumentGroup
              title={`Prior schedule versions (${visibleGroups.priorScheduleVersions.length})`}
              detail="Earlier schedule imports kept for project history."
              documents={visibleGroups.priorScheduleVersions}
              emptyText="No prior schedule versions match this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={document => setSelectedDocumentId(document.id)}
              onDelete={openDeleteCandidate}
              onMakeCurrent={document => { void makeCurrent(document); }}
            />
            <DocumentGroup
              title={`Other project documents (${visibleGroups.otherDocuments.length})`}
              detail="Permits, drawings, contracts, and other project records."
              documents={visibleGroups.otherDocuments}
              emptyText="No other documents match this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={document => setSelectedDocumentId(document.id)}
              onDelete={openDeleteCandidate}
            />
          </View>
        </View>
        <View style={[styles.taskInspectorPane, compactWorkspace && styles.taskInspectorPaneCompact]}>
          {selectedDocument ? (
            <DocumentDetailsPanel
              document={selectedDocument}
              onClose={() => setSelectedDocumentId(null)}
              onDelete={
                selectedDocument.isCurrent && scheduleDocumentIsScheduleLike(selectedDocument)
                  ? undefined
                  : openDeleteCandidate
              }
              onMakeCurrent={
                scheduleDocumentIsScheduleLike(selectedDocument) && !selectedDocument.isCurrent
                  ? document => { void makeCurrent(document); }
                  : undefined
              }
              pending={uploading}
            />
          ) : (
            <WorkspaceInspectorEmpty
              icon="document-text-outline"
              title="Select a document"
              detail="Choose a document to review its projects, version, linked tasks, notes, and file actions."
            />
          )}
        </View>
      </View>
    </>
  );

  function openDeleteCandidate(document: DAVEWebReferenceDocument) {
    setNotice(null);
    setDeleteCandidateId(document.id);
  }
}

function DocumentGroup({
  title,
  detail,
  documents,
  emptyText,
  selectedDocumentId,
  onSelect,
  onDelete,
  onMakeCurrent,
}: {
  title: string;
  detail: string;
  documents: readonly DAVEWebReferenceDocument[];
  emptyText: string;
  selectedDocumentId: string | null;
  onSelect: (document: DAVEWebReferenceDocument) => void;
  onDelete?: (document: DAVEWebReferenceDocument) => void;
  onMakeCurrent?: (document: DAVEWebReferenceDocument) => void;
}) {
  return (
    <View style={styles.documentGroup}>
      <View style={styles.documentGroupHeading}>
        <Text style={styles.documentGroupTitle}>{title}</Text>
        <Text style={styles.documentGroupDetail}>{detail}</Text>
      </View>
      <DocumentList
        documents={documents}
        selectedDocumentId={selectedDocumentId}
        onSelect={onSelect}
        onDelete={onDelete}
        onMakeCurrent={onMakeCurrent}
        emptyText={emptyText}
      />
    </View>
  );
}

function DocumentList({
  documents,
  selectedDocumentId,
  onSelect,
  onDelete,
  onMakeCurrent,
  emptyText = 'No documents match this scope.',
}: {
  documents: readonly DAVEWebReferenceDocument[];
  selectedDocumentId: string | null;
  onSelect: (document: DAVEWebReferenceDocument) => void;
  onDelete?: (document: DAVEWebReferenceDocument) => void;
  onMakeCurrent?: (document: DAVEWebReferenceDocument) => void;
  emptyText?: string;
}) {
  if (documents.length === 0) return <EmptyState text={emptyText} />;
  return (
    <View style={styles.list}>
      {documents.map(document => (
        <View
          key={document.id}
          style={[
            styles.dataCard,
            styles.taskListCard,
            styles.documentListCard,
            selectedDocumentId === document.id && styles.taskListCardSelected,
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.documentListMain, pressed && styles.taskCardMainPressed]}
            onPress={() => onSelect(document)}
            accessibilityRole="button"
            accessibilityLabel={`View ${document.name}`}
          >
            <View style={styles.dataRow}>
              <View style={styles.documentTitleRow}>
                <View style={styles.documentIcon}>
                  <Ionicons name={scheduleDocumentIsScheduleLike(document) ? 'calendar-outline' : 'document-text-outline'} size={22} color={desktopSurfaces.accent} />
                </View>
                <View style={styles.dataGrow}>
                  <Text style={styles.dataTitle}>{document.name}</Text>
                  <Text style={styles.dataMeta}>{documentProjectLabel(document)} · {document.category}</Text>
                  <Text style={styles.dataMeta}>
                    Imported {formatDateTime(document.importedAt)}
                    {document.linkedScheduleItems.length > 0
                      ? ` · ${document.linkedScheduleItems.length} linked task${document.linkedScheduleItems.length === 1 ? '' : 's'}`
                      : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.documentListStatus}>
                <StatusBadge
                  label={documentStatusLabel(document)}
                  tone={document.isCurrent && scheduleDocumentIsScheduleLike(document) ? 'good' : 'neutral'}
                />
                <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
              </View>
            </View>
          </Pressable>
          {onDelete ? (
            <View style={styles.taskCardActions}>
              {onMakeCurrent ? (
                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed, document.linkedScheduleItems.length === 0 && styles.buttonDisabled]}
                  onPress={() => onMakeCurrent(document)}
                  disabled={document.linkedScheduleItems.length === 0}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>{document.linkedScheduleItems.length > 0 ? 'Make Current Schedule' : 'Task Review Required'}</Text>
                </Pressable>
              ) : null}
              <Pressable style={({ pressed }) => [styles.taskDetailsButton, pressed && styles.buttonPressed]} onPress={() => onSelect(document)}>
                <Text style={styles.taskDetailsButtonText}>View details</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function DocumentDetailsPanel({
  document,
  onClose,
  onDelete,
  onMakeCurrent,
  pending,
}: {
  document: DAVEWebReferenceDocument;
  onClose: () => void;
  onDelete?: (document: DAVEWebReferenceDocument) => void;
  onMakeCurrent?: (document: DAVEWebReferenceDocument) => void;
  pending: boolean;
}) {
  const isSchedule = scheduleDocumentIsScheduleLike(document);
  const projectLabel = documentProjectLabel(document);
  const sizeLabel = document.sizeBytes ? formatFileSize(document.sizeBytes) : 'Not recorded';

  return (
    <View style={styles.taskDetailsPanel}>
      <WorkspaceInspectorHeader
        eyebrow={isSchedule ? 'Schedule document' : 'Project document'}
        title={document.name}
        onClose={onClose}
      />
      <View style={styles.taskDetailsBadges}>
        <StatusBadge
          label={documentStatusLabel(document)}
          tone={document.isCurrent && isSchedule ? 'good' : 'neutral'}
        />
        <StatusBadge label={document.category} tone="neutral" />
      </View>
      <View style={styles.taskDetailsFacts}>
        <TaskDetailFact label="Projects" value={projectLabel} />
        <TaskDetailFact label="Imported" value={formatDateTime(document.importedAt)} />
        <TaskDetailFact label="Linked Tasks" value={String(document.linkedScheduleItems.length)} />
        <TaskDetailFact label="File Size" value={sizeLabel} />
      </View>
      {document.notes ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Document note</Text>
          <Text style={styles.taskDetailsSectionText}>{document.notes}</Text>
        </View>
      ) : null}
      {document.webContentReview ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Upload review</Text>
          <Text style={styles.taskDetailsSectionText}>{document.webContentReview}</Text>
        </View>
      ) : null}
      <View style={styles.taskDetailsSection}>
        <Text style={styles.taskDetailsSectionTitle}>File actions</Text>
        <DocumentArtifactActions document={document} />
      </View>
      <View style={styles.taskInspectorActions}>
        {onMakeCurrent ? (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              styles.taskInspectorEditButton,
              pressed && styles.buttonPressed,
              (pending || document.linkedScheduleItems.length === 0) && styles.buttonDisabled,
            ]}
            onPress={() => onMakeCurrent(document)}
            disabled={pending || document.linkedScheduleItems.length === 0}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {document.linkedScheduleItems.length > 0 ? 'Make Current Schedule' : 'Task Review Required'}
            </Text>
          </Pressable>
        ) : null}
        {document.isCurrent && isSchedule ? (
          <View style={styles.documentProtectedNotice}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.success} />
            <Text style={styles.documentProtectedText}>Current schedule · protected from deletion</Text>
          </View>
        ) : null}
        {onDelete ? (
          <Pressable
            style={({ pressed }) => [styles.deleteTextButton, pressed && styles.buttonPressed]}
            onPress={() => onDelete(document)}
            accessibilityRole="button"
          >
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function DocumentArtifactActions({ document }: { document: DAVEWebReferenceDocument }) {
  const auth = useDesktopAuth();
  const [pendingAction, setPendingAction] = useState<'open' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storagePath = document.storagePath?.trim() || '';

  const access = async (action: 'open' | 'download') => {
    if (!storagePath || pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      const url = await auth.getArtifactUrl('project-documents', storagePath);
      openSignedArtifact(url, action === 'download' ? document.originalFileName || document.name : null);
    } catch {
      setError('The protected document is temporarily unavailable. Refresh and try again.');
    } finally {
      setPendingAction(null);
    }
  };

  if (!storagePath) {
    return (
      <View style={styles.artifactUnavailable}>
        <Ionicons name="cloud-offline-outline" size={17} color={colors.mutedText} />
        <Text style={styles.dataMeta}>Original file unavailable for this legacy record.</Text>
      </View>
    );
  }

  return (
    <View style={styles.artifactAccess}>
      <View style={styles.inlineButtonsLeft}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => { void access('open'); }}
          disabled={Boolean(pendingAction)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${document.name}`}
        >
          <Text style={styles.secondaryButtonText}>{pendingAction === 'open' ? 'Opening…' : 'Open'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => { void access('download'); }}
          disabled={Boolean(pendingAction)}
          accessibilityRole="button"
          accessibilityLabel={`Download ${document.name}`}
        >
          <Text style={styles.secondaryButtonText}>{pendingAction === 'download' ? 'Preparing…' : 'Download'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.artifactError} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

function ReportFactCard({
  icon,
  title,
  items,
  emptyText,
  tone = 'neutral',
  maxItems = 6,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  items: readonly string[];
  emptyText: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  maxItems?: number;
}) {
  const visibleItems = items.slice(0, maxItems);
  const remainingCount = Math.max(0, items.length - visibleItems.length);
  return (
    <View style={[styles.reportFactCard, styles[`reportFactCard_${tone}`]]}>
      <View style={styles.reportFactHeading}>
        <View style={[styles.reportFactIcon, styles[`reportFactIcon_${tone}`]]}>
          <Ionicons
            name={icon}
            size={20}
            color={tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.success : desktopSurfaces.accent}
          />
        </View>
        <Text style={styles.reportFactTitle}>{title}</Text>
      </View>
      <View style={styles.reportFactList}>
        {visibleItems.length > 0 ? visibleItems.map((item, index) => (
          <View key={`${title}:${index}:${item}`} style={styles.reportFactRow}>
            <View style={styles.reportFactBullet} />
            <Text style={styles.reportFactText}>{item}</Text>
          </View>
        )) : (
          <Text style={styles.reportFactEmpty}>{emptyText}</Text>
        )}
        {remainingCount > 0 ? (
          <Text style={styles.reportFactMore}>
            {remainingCount} more item{remainingCount === 1 ? '' : 's'} included in the formal report.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ReportWorkspace({
  snapshot,
  selectedProject,
  documents,
}: {
  snapshot: NonNullable<ReturnType<typeof useDesktopAuth>['snapshot']>;
  selectedProject: string | null;
  documents: readonly DAVEWebReferenceDocument[];
}) {
  const auth = useDesktopAuth();
  const briefing = useMemo(
    () => buildDAVEWebReportDraft(snapshot, selectedProject),
    [selectedProject, snapshot],
  );
  const generatedBody = useMemo(() => formatDAVEWebReport(briefing), [briefing]);
  const currentReportSource = useMemo(
    () => buildDAVEWebReportSource(snapshot, selectedProject),
    [selectedProject, snapshot],
  );
  const reportDocuments = documents.filter(document => reportRecordFromDocument(document));
  const [reportId, setReportId] = useState(() => createDAVEWebId('web-report'));
  const [reportTitle, setReportTitle] = useState(`${briefing.scopeLabel} Project Report`);
  const [reportBody, setReportBody] = useState(generatedBody);
  const [reportGeneratedAt, setReportGeneratedAt] = useState(briefing.generatedAt);
  const [expectedRevision, setExpectedRevision] = useState<string | null>(null);
  const [audit, setAudit] = useState<DAVEWebReportRecord['audit']>([]);
  const [reportSource, setReportSource] = useState<DAVEWebReportSource>(currentReportSource);
  const [reportStatus, setReportStatus] = useState<DAVEWebReportRecord['status']>('draft');
  const [pending, setPending] = useState(false);
  const [editingReportBody, setEditingReportBody] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  const resetFromCurrentTruth = () => {
    setReportId(createDAVEWebId('web-report'));
    setReportTitle(`${briefing.scopeLabel} Project Report`);
    setReportBody(generatedBody);
    setReportGeneratedAt(briefing.generatedAt);
    setExpectedRevision(null);
    setAudit([]);
    setReportSource(currentReportSource);
    setReportStatus('draft');
    setNotice({ tone: 'good', text: 'A fresh draft was generated from the latest reconciled project record.' });
  };

  const save = async (status: 'draft' | 'approved') => {
    if (pending || !reportTitle.trim() || !reportBody.trim()) return;
    if (status === 'approved' && !daveWebReportSourceIsCurrent(reportSource.fingerprint, currentReportSource)) {
      setNotice({
        tone: 'danger',
        text: 'Project facts changed after this report was prepared. Regenerate it from current facts before approval.',
      });
      return;
    }
    setPending(true);
    setNotice(null);
    const now = new Date().toISOString();
    const nextAudit = [
      ...audit,
      {
        id: createDAVEWebId('report-audit'),
        action: status === 'approved' ? 'approved' as const : expectedRevision ? 'edited' as const : 'created' as const,
        actor: auth.userEmail || 'Project manager',
        at: now,
      },
    ];
    const report: DAVEWebReportRecord = {
      status,
      title: reportTitle.trim(),
      body: reportBody.trim(),
      generatedAt: reportGeneratedAt,
      sourceRefreshedAt: reportSource.refreshedAt,
      sourceFingerprint: reportSource.fingerprint,
      sourceScopeKey: reportSource.scopeKey,
      sourceTaskIds: reportSource.taskIds,
      sourceUpdateIds: reportSource.updateIds,
      sourceDocumentIds: reportSource.documentIds,
      audit: nextAudit,
    };
    try {
      const savedRevision = await auth.saveReport({
        id: reportId,
        projectName: selectedProject,
        report,
        expectedCloudUpdatedAt: expectedRevision,
      });
      setAudit(nextAudit);
      setExpectedRevision(savedRevision);
      setReportStatus(status);
      setNotice({ tone: 'good', text: status === 'approved' ? 'Report approved and saved with its source snapshot and audit history.' : 'Report draft saved to the shared project record.' });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
      await auth.refreshSnapshot();
    } finally {
      setPending(false);
    }
  };

  const openReport = (document: DAVEWebReferenceDocument) => {
    const report = reportRecordFromDocument(document);
    if (!report) return;
    setReportId(document.id);
    setReportTitle(report.title);
    setReportBody(report.body);
    setReportGeneratedAt(report.generatedAt);
    setExpectedRevision(document.cloudUpdatedAt);
    setAudit(report.audit);
    setReportStatus(report.status);
    setReportSource({
      version: 'dave-web-report-source/1.0',
      scopeKey: report.sourceScopeKey || currentReportSource.scopeKey,
      refreshedAt: report.sourceRefreshedAt,
      fingerprint: report.sourceFingerprint || '',
      taskIds: Object.freeze([...report.sourceTaskIds]),
      updateIds: Object.freeze([...report.sourceUpdateIds]),
      documentIds: Object.freeze([...(report.sourceDocumentIds || [])]),
    });
    setNotice(null);
    setComposerOpen(true);
  };

  const shareApprovedReport = async () => {
    if (reportStatus !== 'approved') return;
    setNotice(null);
    try {
      const shareData = {
        title: reportTitle.trim(),
        text: reportBody.trim(),
      };
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share(shareData);
        setNotice({ tone: 'good', text: 'The approved report was handed to the system share menu.' });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}`);
        setNotice({ tone: 'good', text: 'The approved report was copied for project communication.' });
        return;
      }
      throw new Error('Sharing is unavailable in this browser.');
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError';
      if (!cancelled) {
        setNotice({
          tone: 'danger',
          text: 'The approved report could not be shared. Download it and attach the saved file instead.',
        });
      }
    }
  };

  const prepareApprovedReportEmail = () => {
    if (reportStatus !== 'approved' || typeof window === 'undefined') return;
    const subject = encodeURIComponent(reportTitle.trim());
    const body = encodeURIComponent(reportBody.trim().slice(0, 12_000));
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
    setNotice({
      tone: 'good',
      text: 'An email draft was opened. Review the recipients and content before sending.',
    });
  };

  const reportFactsAreCurrent = daveWebReportSourceIsCurrent(
    reportSource.fingerprint,
    currentReportSource,
  );
  const conditionTone = briefing.overallCondition === 'critical'
    ? 'danger'
    : briefing.overallCondition === 'attention'
      ? 'attention'
      : briefing.overallCondition === 'stable'
        ? 'good'
        : 'neutral';
  const risksAndDecisions = [
    ...briefing.criticalRisks.map(risk => `Risk: ${risk}`),
    ...briefing.decisionsRequired.map(decision => `Decision: ${decision}`),
  ];
  const visibleNextActions = briefing.nextActions.slice(0, 5);

  return (
    <>
      <WorkspaceSummary metrics={[
        { icon: 'list-outline', label: 'Total Tasks', value: briefing.dashboard.taskStatus.total },
        { icon: 'checkmark-circle-outline', label: 'Completed', value: briefing.dashboard.taskStatus.complete, tone: 'success' },
        { icon: 'alert-circle-outline', label: 'Overdue', value: briefing.dashboard.scheduleHealth.overdue, tone: briefing.dashboard.scheduleHealth.overdue > 0 ? 'warning' : 'neutral' },
        { icon: 'time-outline', label: 'Due Soon', value: briefing.dashboard.scheduleHealth.dueSoon, tone: briefing.dashboard.scheduleHealth.dueSoon > 0 ? 'warning' : 'neutral' },
      ]} />

      <View style={styles.reportExecutiveCard}>
        <View style={styles.reportExecutiveHeading}>
          <View style={styles.dataGrow}>
            <Text style={styles.reportExecutiveEyebrow}>CURRENT PROJECT CONDITION</Text>
            <Text style={styles.reportExecutiveTitle}>{briefing.scopeLabel}</Text>
          </View>
          <StatusBadge label={briefing.conditionLabel} tone={conditionTone} />
        </View>
        <Text style={styles.reportExecutiveSnapshot}>{briefing.executiveSnapshot}</Text>
        {briefing.projectConditions.length > 1 ? (
          <View style={styles.reportProjectConditions}>
            {briefing.projectConditions.map(condition => (
              <View key={condition.projectName} style={styles.reportProjectCondition}>
                <Text style={styles.reportProjectConditionName}>{condition.projectName}</Text>
                <Text style={styles.reportProjectConditionText}>{condition.currentReality}</Text>
                <Text style={styles.dataMeta}>{condition.schedule}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.reportPMGrid}>
        <ReportFactCard
          icon="construct-outline"
          title="Current work"
          items={briefing.currentWork}
          emptyText="No active work is recorded in this project scope."
        />
        <ReportFactCard
          icon="swap-vertical-outline"
          title="What changed"
          items={briefing.whatChanged}
          emptyText="No material project changes are recorded."
        />
        <ReportFactCard
          icon="calendar-outline"
          title="Schedule position"
          items={briefing.schedulePosition}
          emptyText="No schedule exceptions require attention."
          tone={briefing.dashboard.scheduleHealth.overdue > 0 ? 'warning' : 'neutral'}
        />
        <ReportFactCard
          icon="warning-outline"
          title="Risks and decisions"
          items={risksAndDecisions}
          emptyText="No current risks or decisions require project manager action."
          tone={briefing.criticalRisks.length > 0 ? 'danger' : briefing.decisionsRequired.length > 0 ? 'warning' : 'success'}
        />
      </View>

      <View style={styles.reportNextActionsCard}>
        <View style={styles.reportFactHeading}>
          <View style={[styles.reportFactIcon, styles.reportFactIcon_neutral]}>
            <Ionicons name="arrow-forward-circle-outline" size={21} color={desktopSurfaces.accent} />
          </View>
          <View style={styles.dataGrow}>
            <Text style={styles.reportFactTitle}>Next actions</Text>
            <Text style={styles.dataMeta}>The most useful actions for the current project condition.</Text>
          </View>
        </View>
        {visibleNextActions.length > 0 ? (
          <View style={styles.reportActionList}>
            {visibleNextActions.map((action, index) => (
              <View key={action.id} style={styles.reportPMAction}>
                <View style={styles.reportPMActionNumber}>
                  <Text style={styles.reportPMActionNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.dataGrow}>
                  <Text style={styles.reportPMActionTitle}>{action.action}</Text>
                  <Text style={styles.dataMeta}>{action.projectName}{action.areaName ? ` · ${action.areaName}` : ''}{action.taskName ? ` · ${action.taskName}` : ''}</Text>
                  <Text style={styles.reportPMActionMeta}>{action.owner} · {action.timing}</Text>
                </View>
              </View>
            ))}
            {briefing.nextActions.length > visibleNextActions.length ? (
              <Text style={styles.reportFactMore}>
                {briefing.nextActions.length - visibleNextActions.length} more action{briefing.nextActions.length - visibleNextActions.length === 1 ? '' : 's'} included in the formal report.
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.reportFactEmpty}>No next actions are currently required.</Text>
        )}
      </View>

      <View style={styles.reportPrepareBar}>
        <View style={styles.dataGrow}>
          <Text style={styles.cardTitle}>Formal project report</Text>
          <Text style={styles.dataMeta}>Review, edit, save, approve, or download a report prepared from the current facts above.</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, styles.reportPrepareButton, pressed && styles.buttonPressed]}
          onPress={() => setComposerOpen(current => !current)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{composerOpen ? 'Close Report Workspace' : 'Review & Prepare Report'}</Text>
        </Pressable>
      </View>

      {composerOpen ? (
        <Section title="Prepare Report" detail="This draft uses the current task, schedule, and field-update facts shown above.">
          <View style={styles.editorCard}>
            <LabeledTextField
              label="Report title"
              value={reportTitle}
              onChangeText={value => {
                setReportTitle(value);
                setReportStatus('draft');
              }}
            />
            <View style={styles.reportComposer}>
              <View style={styles.reportPreviewColumn}>
                <View style={styles.reportPreviewHeader}>
                  <View>
                    <Text style={styles.cardTitle}>Report preview</Text>
                    <Text style={styles.dataMeta}>Prepared {formatDateTime(reportGeneratedAt)}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, styles.compactActionButton, pressed && styles.buttonPressed]}
                    onPress={() => setEditingReportBody(current => !current)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryButtonText}>{editingReportBody ? 'Close Editor' : 'Edit Report'}</Text>
                  </Pressable>
                </View>
                {editingReportBody ? (
                  <TextInput
                    value={reportBody}
                    onChangeText={value => {
                      setReportBody(value);
                      setReportStatus('draft');
                    }}
                    multiline
                    numberOfLines={24}
                    style={[styles.input, styles.reportInput]}
                    accessibilityLabel="Report body"
                  />
                ) : (
                  <ScrollView style={styles.reportPreviewScroll} nestedScrollEnabled>
                    <Text style={styles.reportPreviewText} selectable>{plainReportPreview(reportBody)}</Text>
                  </ScrollView>
                )}
              </View>
              <View style={styles.reportReviewPanel}>
                <View style={styles.reportReviewHeading}>
                  <View style={styles.reportReviewIcon}>
                    <Ionicons name={reportFactsAreCurrent ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={24} color={reportFactsAreCurrent ? colors.success : colors.warning} />
                  </View>
                  <View style={styles.dataGrow}>
                    <Text style={styles.cardTitle}>{reportFactsAreCurrent ? 'Ready for review' : 'Refresh required'}</Text>
                    <Text style={styles.dataMeta}>{reportSource.taskIds.length} tasks · {reportSource.updateIds.length} field updates</Text>
                  </View>
                </View>
                <Text style={styles.reportReviewText}>
                  {reportFactsAreCurrent
                    ? 'The draft matches the latest project facts. Review the wording, then save or approve it.'
                    : 'Project facts changed after this draft was prepared. Regenerate it before approval.'}
                </Text>
                <View style={styles.reportActionStack}>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]} onPress={resetFromCurrentTruth} disabled={pending}>
                    <Text style={styles.secondaryButtonText}>Regenerate from Current Facts</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]} onPress={() => downloadText(`${safeDownloadName(reportTitle)}.md`, reportBody)}>
                    <Text style={styles.secondaryButtonText}>Download Draft</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]} onPress={() => { void save('draft'); }} disabled={pending}>
                    <Text style={styles.secondaryButtonText}>Save Draft</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.primaryButton, styles.reportActionButton, pressed && styles.buttonPressed]} onPress={() => { void save('approved'); }} disabled={pending}>
                    {pending ? <ActivityIndicator color={desktopSurfaces.onAccent} /> : <Text style={styles.primaryButtonText}>Approve Report</Text>}
                  </Pressable>
                  {reportStatus === 'approved' ? (
                    <>
                      <Pressable
                        style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]}
                        onPress={() => { void shareApprovedReport(); }}
                        disabled={pending}
                        accessibilityRole="button"
                      >
                        <Text style={styles.secondaryButtonText}>Share Approved Report</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]}
                        onPress={prepareApprovedReportEmail}
                        disabled={pending}
                        accessibilityRole="button"
                      >
                        <Text style={styles.secondaryButtonText}>Prepare Email</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            </View>
            {!reportFactsAreCurrent ? (
              <View style={styles.errorBanner} accessibilityRole="alert">
                <Text style={styles.errorText}>Project facts changed after this draft was prepared. Regenerate from current facts before approval.</Text>
              </View>
            ) : null}
            {notice ? (
              <View style={notice.tone === 'good' ? styles.successBanner : styles.errorBanner} accessibilityRole="alert">
                <Text style={notice.tone === 'good' ? styles.successText : styles.errorText}>{notice.text}</Text>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}

      <Section title={`Report history (${reportDocuments.length})`} detail="Open a saved draft or approved report, or download a copy for project communication.">
        <View style={styles.list}>
          {reportDocuments.map(document => {
            const report = reportRecordFromDocument(document)!;
            return (
              <View key={document.id} style={[styles.dataCard, styles.taskListCard]}>
                <View style={styles.dataRow}>
                  <View style={styles.dataGrow}>
                    <Text style={styles.dataTitle}>{report.title}</Text>
                    <Text style={styles.dataMeta}>Prepared {formatDateTime(report.generatedAt)} · {report.audit.length} recorded review event{report.audit.length === 1 ? '' : 's'}</Text>
                    <Text style={styles.dataMeta}>Based on {report.sourceTaskIds.length} tasks and {report.sourceUpdateIds.length} field updates</Text>
                  </View>
                  <StatusBadge label={report.status === 'approved' ? 'Approved' : 'Draft'} tone={report.status === 'approved' ? 'good' : 'attention'} />
                </View>
                <View style={styles.taskCardActions}>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => openReport(document)}>
                    <Text style={styles.secondaryButtonText}>Open</Text>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => downloadText(`${safeDownloadName(report.title)}.md`, report.body)}>
                    <Text style={styles.secondaryButtonText}>Download</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {reportDocuments.length === 0 ? <EmptyState text="No saved report artifacts yet. Generate and save a draft above." /> : null}
        </View>
      </Section>
    </>
  );
}

function SettingsWorkspace({
  snapshot,
  displayName,
  onSaveDisplayName,
}: {
  snapshot: NonNullable<ReturnType<typeof useDesktopAuth>['snapshot']>;
  displayName: string;
  onSaveDisplayName: (value: string) => string;
}) {
  const auth = useDesktopAuth();
  const refreshAge = formatRelativeRefresh(snapshot.refreshedAt);
  const freshness = presentDAVEWebFreshness(auth.freshness);
  const [displayNameDraft, setDisplayNameDraft] = useState(displayName);
  const [displayNameNotice, setDisplayNameNotice] = useState('');

  useEffect(() => {
    setDisplayNameDraft(displayName);
  }, [displayName]);

  const saveName = () => {
    const saved = onSaveDisplayName(displayNameDraft);
    setDisplayNameDraft(saved);
    setDisplayNameNotice(
      saved
        ? `Overview will greet you as ${saved}.`
        : 'The Overview will use a general greeting.',
    );
  };

  return (
    <View style={styles.settingsWorkspace}>
      <Section
        title="Personalization"
        detail="Choose the name Vitruvius uses in the Overview greeting on this computer."
      >
        <View style={styles.displayNameRow}>
          <View style={styles.displayNameField}>
            <Text style={styles.fieldLabel}>Display name</Text>
            <TextInput
              value={displayNameDraft}
              onChangeText={value => {
                setDisplayNameDraft(value);
                setDisplayNameNotice('');
              }}
              placeholder="Enter your name"
              placeholderTextColor="#7D8794"
              maxLength={50}
              autoCapitalize="words"
              style={styles.input}
              accessibilityLabel="Display name"
              onSubmitEditing={saveName}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              styles.saveDisplayNameButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={saveName}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Save Name</Text>
          </Pressable>
        </View>
        <Text style={styles.dataMeta}>
          This preference is saved in Vitruvius on this computer. It does not change your sign-in email.
        </Text>
        {displayNameNotice ? (
          <View style={styles.successBanner} accessibilityRole="alert">
            <Text style={styles.successText}>{displayNameNotice}</Text>
          </View>
        ) : null}
      </Section>

      <View style={styles.syncHero}>
        <View style={styles.syncHeroHeading}>
          <View style={styles.syncHeroIcon}>
            <Ionicons name={freshness.icon} size={30} color={desktopSurfaces.accent} />
          </View>
          <View style={styles.dataGrow}>
            <Text style={styles.syncHeroEyebrow}>SHARED PROJECT RECORD</Text>
            <Text style={styles.syncHeroTitle}>{freshness.title}</Text>
            <Text style={styles.syncHeroDetail}>
              {freshness.detail} Signed in as {auth.userEmail || 'the authorized owner'} · refreshed {refreshAge}.
            </Text>
          </View>
          <StatusBadge label={freshness.badge} tone={freshness.tone} />
        </View>

        <View style={styles.settingsActions}>
          <Pressable
            style={({ pressed }) => [styles.primaryButton, styles.syncButton, pressed && styles.buttonPressed]}
            onPress={() => { void auth.refreshSnapshot(); }}
            accessibilityRole="button"
          >
            <View style={styles.buttonLabelRow}>
              <Ionicons name="sync-outline" size={19} color={desktopSurfaces.onAccent} />
              <Text style={styles.primaryButtonText}>Sync Now</Text>
            </View>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={() => { void auth.signOutOfDesktop(); }}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.syncGuideGrid}>
        <View style={styles.syncGuideCard}>
          <View style={styles.syncGuideIcon}>
            <Ionicons name="desktop-outline" size={22} color={desktopSurfaces.accent} />
          </View>
          <View style={styles.dataGrow}>
            <Text style={styles.cardTitle}>This computer</Text>
            <Text style={styles.syncGuideText}>Refreshes the shared cloud record automatically every 12 seconds while Vitruvius is open.</Text>
          </View>
        </View>
        <View style={styles.syncGuideCard}>
          <View style={styles.syncGuideIcon}>
            <Ionicons name="phone-portrait-outline" size={22} color={desktopSurfaces.accent} />
          </View>
          <View style={styles.dataGrow}>
            <Text style={styles.cardTitle}>iPhone and iPad</Text>
            <Text style={styles.syncGuideText}>Changes saved to the cloud appear here automatically. Use Sync Now on a device for changes that are still saved only on that device.</Text>
          </View>
        </View>
      </View>

      <OperationsWorkspace snapshot={snapshot} />
    </View>
  );
}

function OperationsWorkspace({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useDesktopAuth>['snapshot']>;
}) {
  const auth = useDesktopAuth();
  const diagnostics = useMemo(() => buildDAVEWebTruthDiagnostics(snapshot), [snapshot]);
  const [backup, setBackup] = useState<DAVEWebBackup | null>(null);
  const [restorePhrase, setRestorePhrase] = useState('');
  const [pending, setPending] = useState(false);
  const [dataCheckStatus, setDataCheckStatus] = useState<
    'idle' | 'running' | 'success' | 'error'
  >('idle');
  const [dataCheckCompletedAt, setDataCheckCompletedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  const runDataCheck = async () => {
    if (dataCheckStatus === 'running') return;
    setDataCheckStatus('running');
    setDataCheckCompletedAt(null);
    const refreshed = await auth.refreshSnapshot().catch(() => false);
    if (refreshed) {
      setDataCheckCompletedAt(new Date());
      setDataCheckStatus('success');
    } else {
      setDataCheckStatus('error');
    }
  };

  const readBackup = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = validateDAVEWebBackup(JSON.parse(await file.text()));
      setBackup(parsed);
      setRestorePhrase('');
      setNotice({ tone: 'good', text: `Data export validated: ${parsed.projects.length} projects, ${parsed.scheduleItems.length} tasks, ${parsed.referenceDocuments.length} documents.` });
    } catch (error) {
      setBackup(null);
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'The data export could not be validated.' });
    }
  };

  const restoreTasks = async () => {
    if (!backup || restorePhrase !== 'RESTORE MISSING TASKS' || pending) return;
    setPending(true);
    try {
      const restored = await auth.restoreMissingTasks(backup.scheduleItems as DAVEWebScheduleItem[]);
      setNotice({ tone: 'good', text: restored > 0 ? `${restored} missing task${restored === 1 ? '' : 's'} restored. Existing task IDs were left unchanged.` : 'No missing task IDs were found; nothing was changed.' });
      setBackup(null);
      setRestorePhrase('');
    } catch (error) {
      setNotice({ tone: 'danger', text: taskMutationMessage(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Section title="Data health" detail="Confirm that the shared record is consistent before reviewing project totals or creating a data export.">
        <View style={styles.cardGrid}>
          <View style={[styles.dataCard, styles.gridDataCard]}>
            <View style={styles.dataHealthHeading}>
              <View style={styles.dataHealthIcon}>
                <Ionicons name="shield-checkmark-outline" size={22} color={diagnostics.conflicts.length ? colors.danger : colors.success} />
              </View>
              <View style={styles.dataGrow}>
                <Text style={styles.cardTitle}>Shared record check</Text>
                <Text style={styles.dataDetail}>
                  {diagnostics.conflicts.length === 0
                    ? 'Project and task totals agree with the current shared record.'
                    : `${diagnostics.conflicts.length} record conflict${diagnostics.conflicts.length === 1 ? '' : 's'} need review.`}
                </Text>
              </View>
            </View>
            <StatusBadge label={diagnostics.conflicts.length === 0 ? 'No current conflicts' : `${diagnostics.conflicts.length} conflict${diagnostics.conflicts.length === 1 ? '' : 's'}`} tone={diagnostics.conflicts.length === 0 ? 'good' : 'danger'} />
          </View>
          <View style={[styles.dataCard, styles.gridDataCard]}>
            <View style={styles.dataHealthHeading}>
              <View style={styles.dataHealthIcon}>
                <Ionicons name="lock-closed-outline" size={22} color={desktopSurfaces.accent} />
              </View>
              <View style={styles.dataGrow}>
                <Text style={styles.cardTitle}>Protected changes</Text>
                <Text style={styles.dataDetail}>Task, document, report, and deletion changes are checked before they modify the shared record.</Text>
              </View>
            </View>
            <StatusBadge label="Owner authorized" tone="good" />
          </View>
        </View>
        {diagnostics.conflicts.map(conflict => <View key={conflict} style={styles.errorBanner}><Text style={styles.errorText}>{conflict}</Text></View>)}
        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            styles.syncButton,
            pressed && styles.buttonPressed,
            dataCheckStatus === 'running' && styles.buttonDisabled,
          ]}
          onPress={() => { void runDataCheck(); }}
          disabled={dataCheckStatus === 'running'}
          accessibilityRole="button"
          accessibilityLabel="Run shared record data check"
        >
          <View style={styles.buttonLabelRow}>
            {dataCheckStatus === 'running' ? (
              <ActivityIndicator size="small" color={desktopSurfaces.accent} />
            ) : (
              <Ionicons name="refresh-outline" size={18} color={desktopSurfaces.accent} />
            )}
            <Text style={styles.secondaryButtonText}>
              {dataCheckStatus === 'running' ? 'Checking Shared Record…' : 'Run Data Check'}
            </Text>
          </View>
        </Pressable>
        {dataCheckStatus === 'success' ? (
          <View style={styles.dataCheckSuccess} accessibilityRole="alert">
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <View style={styles.dataGrow}>
              <Text style={styles.dataCheckSuccessTitle}>Data check complete</Text>
              <Text style={styles.dataCheckSuccessText}>
                Checked {dataCheckCompletedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                {' '}{snapshot.projects.length} projects, {snapshot.scheduleItems.length} tasks, and {diagnostics.conflicts.length} current {diagnostics.conflicts.length === 1 ? 'conflict' : 'conflicts'}.
              </Text>
            </View>
          </View>
        ) : null}
        {dataCheckStatus === 'error' ? (
          <View style={styles.errorBanner} accessibilityRole="alert">
            <Text style={styles.errorText}>
              The shared record could not be refreshed. Your current workspace was not changed. Try the data check again.
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title="Data export and recovery" detail="Download an unencrypted JSON export of project records and media metadata, or validate a previous export before restoring missing tasks. Photo and document files are not included.">
        <View style={styles.inlineButtonsLeft}>
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => {
            const created = createDAVEWebBackup(snapshot);
            downloadText(`vitruvius-data-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(created, null, 2), 'application/json');
          }}>
            <View style={styles.buttonLabelRow}>
              <Ionicons name="download-outline" size={18} color={desktopSurfaces.accent} />
              <Text style={styles.secondaryButtonText}>Download Data Export</Text>
            </View>
          </Pressable>
          <WebFilePicker label="Choose Vitruvius data export" accept=".json,application/json" onFile={file => { void readBackup(file); }} />
        </View>
        {backup ? (
          <View style={styles.editorCard}>
            <Text style={styles.cardTitle}>Validated recovery preview</Text>
            <Text style={styles.dataDetail}>{backup.projects.length} projects · {backup.scheduleItems.length} tasks · {backup.projectUpdates.length} field updates · {backup.referenceDocuments.length} documents</Text>
            <Text style={styles.dataMeta}>For safety, this recovery restores missing task IDs only. It does not overwrite newer tasks, restore deleted IDs, or replace documents.</Text>
            <LabeledTextField label="Type RESTORE MISSING TASKS to continue" value={restorePhrase} onChangeText={setRestorePhrase} />
            <View style={styles.inlineButtons}>
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => setBackup(null)} disabled={pending}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed, restorePhrase !== 'RESTORE MISSING TASKS' && styles.buttonDisabled]} onPress={() => { void restoreTasks(); }} disabled={pending || restorePhrase !== 'RESTORE MISSING TASKS'}>
                <Text style={styles.primaryButtonText}>{pending ? 'Restoring…' : 'Restore Missing Tasks'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {notice ? (
          <View style={notice.tone === 'good' ? styles.successBanner : styles.errorBanner}><Text style={notice.tone === 'good' ? styles.successText : styles.errorText}>{notice.text}</Text></View>
        ) : null}
      </Section>
    </>
  );
}

function WebFilePicker({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File | null) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {createElement('input' as any, {
        type: 'file',
        accept,
        'aria-label': label,
        onChange: (event: any) => onFile(event.target.files?.[0] || null),
        style: {
          minHeight: 52,
          border: `1px solid ${desktopSurfaces.border}`,
          borderRadius: 12,
          background: desktopSurfaces.input,
          color: desktopSurfaces.text,
          fontSize: 14,
          padding: 12,
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
        },
      })}
    </View>
  );
}

function documentMutationMessage(error: unknown): string {
  if (error instanceof DAVEWebDocumentMutationError) return error.message;
  return 'The document could not be deleted. Refresh the workspace and try again.';
}

function StatusBadge({ label, tone }: { label: string; tone: 'good' | 'attention' | 'danger' | 'neutral' }) {
  return (
    <View style={[styles.statusBadge, styles[`statusBadge_${tone}`]]}>
      <Text style={[styles.statusBadgeText, styles[`statusBadgeText_${tone}`]]}>{label}</Text>
    </View>
  );
}

function TaskStatusBadge({ task }: { task: ScheduleItem }) {
  const isComplete = taskIsComplete(task);
  const isOverdue = taskIsOverdue(task);
  const isNotStarted = task.status === 'Not Started';
  const tone = isComplete ? 'completed' : isOverdue ? 'overdue' : isNotStarted ? 'notStarted' : 'inProgress';
  const label = isComplete ? 'Completed' : task.status;

  return (
    <View
      style={[styles.taskStatusBadge, styles[`taskStatusBadge_${tone}`]]}
      accessibilityRole="text"
      accessibilityLabel={`Task status: ${label}`}
    >
      <Text style={[styles.taskStatusBadgeText, styles[`taskStatusBadgeText_${tone}`]]}>{label}</Text>
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
        <View style={[styles.brandMark, styles.sidebarBrandMark]}><Text style={[styles.brandMarkText, styles.sidebarBrandMarkText]}>{PRODUCT_BRAND.monogram}</Text></View>
        <View><Text style={[styles.brandName, styles.sidebarBrandName]}>{PRODUCT_BRAND.name}</Text><Text style={[styles.brandSubtitle, styles.sidebarBrandSubtitle]}>{PRODUCT_BRAND.subtitle}</Text></View>
      </View>
      <View style={styles.navigation} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} selectedProject={selectedProject} />
        ))}
      </View>
      <Text style={styles.pilotNote}>{PRODUCT_BRAND.name} · {PRODUCT_BRAND.subtitle}</Text>
    </View>
  );
}

function RefreshProjectDataButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.refreshIconButton, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Refresh project data"
    >
      <Ionicons name="refresh" size={20} color={desktopSurfaces.accent} />
    </Pressable>
  );
}

function DesktopTopNavigation({ pathname, selectedProject }: { pathname: string; selectedProject: string | null }) {
  return (
    <View style={styles.topNavigation}>
      <View style={styles.compactBrand}><View style={[styles.brandMark, styles.sidebarBrandMark]}><Text style={[styles.brandMarkText, styles.sidebarBrandMarkText]}>{PRODUCT_BRAND.monogram}</Text></View><Text style={[styles.brandName, styles.sidebarBrandName]}>{PRODUCT_BRAND.name}</Text></View>
      <View style={styles.topNavigationLinks} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} selectedProject={selectedProject} compact />
        ))}
      </View>
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
        <Ionicons
          name={item.icon}
          size={compact ? 19 : 25}
          color={active ? desktopSurfaces.accent : desktopSurfaces.sidebarMuted}
        />
        <Text
          style={[
            styles.navigationLabel,
            !compact && styles.navigationLabelSidebar,
            active && styles.navigationLabelActive,
          ]}
        >
          {item.label}
        </Text>
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

function documentMatchesProjectScope(document: DAVEWebReferenceDocument, scopeProjects: readonly string[]): boolean {
  if (scopeProjects.length === 0) return true;
  const documentProjects = [document.projectName || '', ...(document.projectNames || [])]
    .map(normalizedName)
    .filter(Boolean);
  return documentProjects.some(project => scopeProjects.some(scope => normalizedName(scope) === project));
}

function documentProjectLabel(document: DAVEWebReferenceDocument): string {
  const names = [...new Map(
    [document.projectName || '', ...(document.projectNames || [])]
      .map(name => [normalizedName(name), name.trim()] as const)
      .filter(([key]) => Boolean(key)),
  ).values()];
  if (names.length === 0) return 'Shared project document';
  if (names.length === 1) return names[0];
  return `${names.length} projects · ${names.join(' + ')}`;
}

function documentStatusKind(document: DAVEWebReferenceDocument): Exclude<DocumentStatusFilter, 'all'> {
  if (!scheduleDocumentIsScheduleLike(document)) return 'other';
  return document.isCurrent ? 'current' : 'prior';
}

function documentStatusLabel(document: DAVEWebReferenceDocument): string {
  const kind = documentStatusKind(document);
  if (kind === 'current') return 'Current';
  if (kind === 'prior') return 'Prior version';
  return 'Document';
}

function documentSearchText(document: DAVEWebReferenceDocument): string {
  return normalizedName([
    document.name,
    document.originalFileName,
    document.category,
    documentProjectLabel(document),
    document.notes,
    document.webContentReview,
    documentStatusLabel(document),
  ].filter(Boolean).join(' '));
}

function taskIsComplete(task: ScheduleItem): boolean {
  return scheduleTaskIsComplete(task);
}

function taskIsOverdue(task: ScheduleItem): boolean {
  if (taskIsComplete(task)) return false;
  const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
  return days !== null && days < 0;
}

function taskSearchText(task: ScheduleItem): string {
  return normalizedName([
    task.taskName,
    task.itemType,
    task.scheduleProjectName,
    task.projectName,
    task.locationName,
    task.owner,
    task.contractor,
    task.milestone,
    task.nextAction,
    task.notes,
  ].filter(Boolean).join(' '));
}

function normalizedName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function fieldUpdateAreaName(update: CloudProjectUpdate<ProjectUpdate>): string {
  return update.areaName?.trim()
    || update.updateData.selectedAreaName?.trim()
    || 'No area assigned';
}

function fieldUpdateTime(update: CloudProjectUpdate<ProjectUpdate>): string {
  return update.updatedAt
    || update.updateData.locationCapturedAt
    || update.updateData.date;
}

function fieldUpdateSearchText(update: CloudProjectUpdate<ProjectUpdate>): string {
  return normalizedName([
    update.projectName,
    fieldUpdateAreaName(update),
    update.updateData.scheduleTaskName,
    update.updateData.notes,
    ...update.updateData.photos.flatMap(photo => [
      photo.caption,
      photo.category,
      photo.actionRequired,
      photo.actionOwner,
    ]),
  ].filter(Boolean).join(' '));
}

function photoItemKey(item: PhotoWorkspaceItem): string {
  return `${item.update.id}:${item.photo.id}`;
}

function photoAreaValue(item: PhotoWorkspaceItem): string {
  return item.photo.selectedAreaName?.trim()
    || item.update.areaName?.trim()
    || item.update.updateData.selectedAreaName?.trim()
    || '';
}

function photoAreaName(item: PhotoWorkspaceItem): string {
  return photoAreaValue(item) || 'No area assigned';
}

function photoCaptureTime(item: PhotoWorkspaceItem): string {
  return item.photo.locationCapturedAt
    || item.update.updateData.locationCapturedAt
    || item.update.updatedAt
    || item.update.updateData.date;
}

function photoSearchText(item: PhotoWorkspaceItem): string {
  return normalizedName([
    item.update.projectName,
    photoAreaName(item),
    item.update.updateData.scheduleTaskName,
    item.update.updateData.notes,
    item.photo.caption,
    item.photo.category,
    item.photo.actionRequired,
    item.photo.actionOwner,
    item.photo.photoIntelligence?.summary,
    item.photo.photoIntelligence?.visibleChange,
  ].filter(Boolean).join(' '));
}

function comparePhotoItemsNewestFirst(a: PhotoWorkspaceItem, b: PhotoWorkspaceItem): number {
  const aTime = Date.parse(photoCaptureTime(a)) || 0;
  const bTime = Date.parse(photoCaptureTime(b)) || 0;
  return bTime - aTime;
}

function priorComparablePhotoFor(
  selected: PhotoWorkspaceItem,
  photos: readonly PhotoWorkspaceItem[],
): PhotoWorkspaceItem | null {
  const selectedTime = Date.parse(photoCaptureTime(selected));
  const projectKey = normalizedName(selected.update.projectName);
  const areaKey = normalizedName(photoAreaValue(selected));
  if (!projectKey || !areaKey || Number.isNaN(selectedTime)) return null;

  return [...photos]
    .filter(candidate => {
      if (photoItemKey(candidate) === photoItemKey(selected)) return false;
      if (candidate.update.id === selected.update.id) return false;
      if (normalizedName(candidate.update.projectName) !== projectKey) return false;
      if (normalizedName(photoAreaValue(candidate)) !== areaKey) return false;
      const candidateTime = Date.parse(photoCaptureTime(candidate));
      return !Number.isNaN(candidateTime) && candidateTime < selectedTime;
    })
    .sort(comparePhotoItemsNewestFirst)[0] ?? null;
}

function photoAnalysisStatusLabel(
  status: NonNullable<UpdatePhoto['photoIntelligence']>['status'],
): string {
  if (status === 'analysis_complete') return 'Analysis complete';
  if (status === 'completed_with_limitations') return 'Limited comparison';
  if (status === 'comparison_unavailable') return 'Comparison unavailable';
  if (status === 'analysis_failed_retry') return 'Retry needed';
  if (status === 'no_suitable_prior_photo') return 'Baseline only';
  return 'Analyzing';
}

function photoAnalysisStatusTone(
  status: NonNullable<UpdatePhoto['photoIntelligence']>['status'],
): 'good' | 'attention' | 'danger' | 'neutral' {
  if (status === 'analysis_complete') return 'good';
  if (status === 'analysis_failed_retry') return 'danger';
  if (status === 'completed_with_limitations' || status === 'comparison_unavailable') return 'attention';
  return 'neutral';
}

function compareCloudUpdatesNewestFirst(
  a: CloudProjectUpdate<ProjectUpdate>,
  b: CloudProjectUpdate<ProjectUpdate>,
): number {
  const aTime = Date.parse(a.updatedAt ?? a.updateData.date ?? '') || 0;
  const bTime = Date.parse(b.updatedAt ?? b.updateData.date ?? '') || 0;
  return bTime - aTime;
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

function formatDesktopDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function fingerprintBytes(bytes: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  const view = new Uint8Array(bytes);
  let hash = 2166136261;
  for (const value of view) hash = Math.imul(hash ^ value, 16777619);
  return `fallback-${(hash >>> 0).toString(16)}-${bytes.byteLength}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeDownloadName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'vitruvius-report';
}

function plainReportPreview(value: string): string {
  return value
    .split('\n')
    .map(line => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '• ')
      .replace(/^\d+\.\s+/, match => match))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function downloadText(fileName: string, contents: string, mimeType = 'text/markdown') {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([contents], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function openSignedArtifact(url: string, downloadName: string | null) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!downloadName) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRelativeRefresh(value: string | null | undefined): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'recently';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return formatDateTime(value);
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%', backgroundColor: desktopSurfaces.canvas },
  rootWide: { flexDirection: 'row' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1440, alignSelf: 'center', padding: spacing.xxl, gap: spacing.lg },
  contentCompact: { padding: spacing.sm, gap: spacing.md },
  gateRoot: { flex: 1, minHeight: '100%', backgroundColor: desktopSurfaces.canvas },
  gateContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xl },
  gateBrandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gateCard: { width: '100%', maxWidth: 560, borderRadius: 24, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.xxl, gap: spacing.lg, boxShadow: desktopSurfaces.shadowStrong },
  gateTitle: { color: '#171A21', fontSize: 32, lineHeight: 39, fontWeight: '900' },
  sidebar: { width: 280, minHeight: '100%', backgroundColor: desktopSurfaces.sidebar, borderRightWidth: 1, borderRightColor: desktopSurfaces.sidebarDeep, padding: spacing.lg, gap: spacing.xl, boxShadow: desktopSurfaces.sidebarShadow },
  brandMark: { width: 56, height: 56, borderRadius: 17, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: VITRUVIUS_BRAND_SOFT_BLUE, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: VITRUVIUS_BRAND_DARK_BLUE, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  sidebarBrandMark: { backgroundColor: VITRUVIUS_BRAND_SOFT_BLUE },
  sidebarBrandMarkText: { color: VITRUVIUS_BRAND_DARK_BLUE, fontSize: 40, lineHeight: 46 },
  sidebarBrandName: { color: desktopSurfaces.sidebarText },
  sidebarBrandSubtitle: { color: desktopSurfaces.sidebarMuted },
  brandName: { color: '#171A21', fontSize: 17, fontWeight: '900', letterSpacing: 0.4 },
  brandSubtitle: { color: '#6F7480', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  navigation: { gap: spacing.xs },
  navigationLink: { minHeight: 64, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: spacing.md, justifyContent: 'flex-start', paddingHorizontal: spacing.md },
  topNavigationLink: { flexGrow: 1, flexBasis: 132, minWidth: 0, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingHorizontal: spacing.sm },
  navigationLinkActive: { backgroundColor: desktopSurfaces.selected, borderLeftWidth: 4, borderLeftColor: desktopSurfaces.accent },
  navigationLabel: { color: desktopSurfaces.sidebarMuted, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  navigationLabelSidebar: { fontSize: 17, lineHeight: 23, fontWeight: '900' },
  navigationLabelActive: { color: desktopSurfaces.accent },
  pilotNote: { color: desktopSurfaces.sidebarMuted, fontSize: 12, lineHeight: 17, marginTop: 'auto', paddingHorizontal: spacing.xs },
  compactBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  topNavigation: { backgroundColor: desktopSurfaces.sidebar, borderWidth: 1, borderColor: desktopSurfaces.border, borderRadius: 14, padding: spacing.sm, gap: spacing.sm, boxShadow: desktopSurfaces.shadow },
  topNavigationLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  topRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg, borderLeftWidth: 5, borderLeftColor: desktopSurfaces.accent, borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.header, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  topRowCompact: { flexDirection: 'column', flexWrap: 'nowrap', gap: spacing.sm },
  titleBlock: { flex: 1, minWidth: 0, maxWidth: 820 },
  titleBlockCompact: { width: '100%', maxWidth: '100%' },
  eyebrow: { color: desktopSurfaces.accent, fontSize: 12, lineHeight: 17, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: desktopSurfaces.text, fontSize: 36, lineHeight: 42, fontWeight: '900', marginTop: spacing.xs },
  description: { color: desktopSurfaces.textMuted, fontSize: 16, lineHeight: 23, marginTop: spacing.xs },
  overviewDate: { color: colors.mutedText, fontSize: 15, lineHeight: 21, fontWeight: '600', marginTop: 4 },
  settingsButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center' },
  displayNameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.md },
  displayNameField: { flexGrow: 1, flexBasis: 360, minWidth: 260, gap: spacing.xs },
  saveDisplayNameButton: { minWidth: 150 },
  textButton: { color: desktopSurfaces.accent, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  freshnessBanner: { borderRadius: 14, borderWidth: 1, borderColor: '#E4C17E', backgroundColor: '#FFF8E8', padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  freshnessBannerStale: { borderColor: '#E5A4A4', backgroundColor: '#FFF3F3' },
  freshnessBannerText: { flex: 1, color: '#5D4A23', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  contextBar: { minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.toolbar, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  contextBarCompact: { alignItems: 'stretch', flexDirection: 'column' },
  contextScope: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contextUtilities: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  projectChoiceScrollerCompact: { width: '100%', minWidth: 0 },
  projectFilterLabel: { color: desktopSurfaces.textMuted, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  projectChoices: { flexGrow: 1, gap: spacing.sm, alignItems: 'center' },
  refreshIconButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center' },
  choice: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: desktopSurfaces.card, justifyContent: 'center' },
  choiceActive: { borderColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.selected },
  choiceText: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  choiceTextActive: { color: desktopSurfaces.accent },
  projectHealthCard: { borderRadius: 22, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.lg, boxShadow: desktopSurfaces.shadow },
  projectHealthHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  projectHealthEyebrow: { color: desktopSurfaces.accent, fontSize: 12, lineHeight: 17, fontWeight: '900', letterSpacing: 1.4 },
  projectHealthTitle: { color: desktopSurfaces.text, fontSize: 26, lineHeight: 32, fontWeight: '900', marginTop: 2 },
  projectHealthMark: { color: desktopSurfaces.accent, fontSize: 32, lineHeight: 34, fontWeight: '700' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metricCard: { flexGrow: 1, flexBasis: 150, minHeight: 74, justifyContent: 'space-between', gap: spacing.xs },
  metricValue: { color: desktopSurfaces.text, fontSize: 30, lineHeight: 36, fontWeight: '900' },
  metricLabel: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  accountingBanner: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.accentSoft, padding: spacing.lg, gap: spacing.xs },
  accountingTitle: { color: desktopSurfaces.accentText, fontSize: 17, lineHeight: 23, fontWeight: '900' },
  accountingDetail: { color: desktopSurfaces.accentText, fontSize: 14, lineHeight: 21 },
  section: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.section, padding: spacing.xl, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  sectionTitle: { color: '#171A21', fontSize: 24, lineHeight: 31, fontWeight: '900' },
  sectionDetail: { color: '#6A717E', fontSize: 15, lineHeight: 22 },
  workspaceSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginVertical: spacing.xs },
  workspaceMetric: { flexGrow: 1, flexBasis: 180, minHeight: 78, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, boxShadow: desktopSurfaces.shadow },
  workspaceMetricIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  workspaceMetricIcon_primary: { backgroundColor: desktopSurfaces.accentSoft },
  workspaceMetricIcon_success: { backgroundColor: colors.successSoft },
  workspaceMetricIcon_warning: { backgroundColor: colors.warningSoft },
  workspaceMetricIcon_neutral: { backgroundColor: desktopSurfaces.selected },
  workspaceMetricCopy: { flex: 1, minWidth: 0 },
  workspaceMetricValue: { color: colors.text, fontSize: 24, lineHeight: 29, fontWeight: '900' },
  workspaceMetricLabel: { color: colors.mutedText, fontSize: 12, lineHeight: 17, fontWeight: '800', marginTop: 2 },
  portfolioGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.lg },
  portfolioCard: { flexGrow: 1, flexBasis: 520, minWidth: 0, borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, borderTopWidth: 5, borderTopColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.card, padding: spacing.xl, gap: spacing.lg, boxShadow: desktopSurfaces.shadow },
  portfolioCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  portfolioProjectIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  portfolioProjectName: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: '900' },
  portfolioProgressHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  portfolioProgressText: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  portfolioProgressTrack: { height: 10, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' },
  portfolioProgressFill: { height: '100%', borderRadius: 999, backgroundColor: desktopSurfaces.accent },
  portfolioFacts: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 16, backgroundColor: desktopSurfaces.cardBlue, padding: spacing.sm, gap: spacing.xs },
  projectFact: { flexGrow: 1, flexBasis: 124, minWidth: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm },
  projectFactValue: { color: colors.text, fontSize: 18, lineHeight: 22, fontWeight: '900' },
  projectFactValueDanger: { color: colors.danger },
  projectFactLabel: { color: colors.mutedText, fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 1 },
  portfolioActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  portfolioPrimaryAction: { minWidth: 220, flexBasis: 250, backgroundColor: desktopSurfaces.accent },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  list: { gap: spacing.sm },
  dataCard: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.sm, boxShadow: desktopSurfaces.shadow },
  gridDataCard: { flexGrow: 1, flexBasis: 320 },
  taskListCard: { padding: 0, gap: 0, overflow: 'hidden' },
  taskListCardSelected: { borderColor: desktopSurfaces.accent, boxShadow: '0 0 0 2px rgba(212,90,10,0.14)' },
  taskCardMain: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  taskCardMainPressed: { backgroundColor: desktopSurfaces.cardMuted },
  taskBadgeColumn: { alignItems: 'flex-end', gap: spacing.xs },
  taskNextAction: { color: desktopSurfaces.accentText, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  taskCompactFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  taskFactDivider: { color: '#A2A9B3', fontSize: 13, lineHeight: 20 },
  taskProjectChoices: { marginTop: spacing.sm },
  buttonLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  workspaceSearchField: { width: '100%', minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.input, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  evidenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  evidenceList: { gap: spacing.sm },
  evidenceCard: { flexGrow: 1, flexBasis: 430, minWidth: 0, maxWidth: 680, borderLeftWidth: 4, borderLeftColor: desktopSurfaces.accent },
  evidenceCardSelected: { maxWidth: '100%', borderColor: desktopSurfaces.accent, boxShadow: '0 0 0 2px rgba(212,90,10,0.14)' },
  evidenceCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  evidenceIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  evidenceDate: { color: colors.tertiaryText, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  emptyRecordText: { color: colors.tertiaryText, fontSize: 14, lineHeight: 21, fontStyle: 'italic' },
  linkedTaskPill: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 12, backgroundColor: desktopSurfaces.accentSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  linkedTaskText: { flexShrink: 1, color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  evidenceCardFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  viewDetailsText: { color: desktopSurfaces.accent, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  evidenceInspectorPhotos: { gap: spacing.sm },
  evidenceInspectorPhoto: { borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, overflow: 'hidden', gap: spacing.xs, paddingBottom: spacing.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  photoCard: { flexGrow: 1, flexBasis: 340, minWidth: 0, maxWidth: 460, borderRadius: 20, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, overflow: 'hidden', boxShadow: desktopSurfaces.shadow },
  photoCardSelected: { borderColor: desktopSurfaces.accent, boxShadow: '0 0 0 2px rgba(212,90,10,0.17)' },
  photoCardPressed: { opacity: 0.94 },
  photoInspectorPane: { flexGrow: 1, flexBasis: 400, minWidth: 300, maxWidth: 500, alignSelf: 'flex-start', position: 'sticky' as any, top: spacing.lg },
  photoVisual: { minHeight: 140, backgroundColor: desktopSurfaces.sectionStrong, justifyContent: 'flex-end', padding: spacing.lg },
  photoVisualUnavailable: { backgroundColor: desktopSurfaces.sectionStrong },
  photoImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  photoAreaOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: 'rgba(12,25,48,0.58)' },
  photoUnavailable: { flex: 1, minHeight: 82, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  photoUnavailableText: { color: '#5E6875', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  photoVisualIcon: { position: 'absolute', top: spacing.lg, right: spacing.lg, width: 50, height: 50, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  photoVisualArea: { color: desktopSurfaces.onAccent, fontSize: 19, lineHeight: 25, fontWeight: '900', maxWidth: '76%' },
  photoVisualAreaUnavailable: { color: '#334155', fontSize: 17, lineHeight: 23, fontWeight: '900', maxWidth: '76%' },
  photoCardBody: { padding: spacing.lg, gap: spacing.sm },
  photoActionCard: { borderRadius: 12, backgroundColor: colors.warningSoft, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm },
  photoActionText: { flex: 1, color: '#7A4C00', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  photoComparisonContext: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.md, gap: spacing.sm },
  photoComparisonExplanation: { color: '#4E5E70', fontSize: 13, lineHeight: 20 },
  comparisonPhoto: { borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, overflow: 'hidden' },
  comparisonPhotoHeading: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 2 },
  comparisonPhotoLabel: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  photoAnalysisHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  photoAnalysisObservation: { borderRadius: 10, backgroundColor: desktopSurfaces.cardMuted, color: '#3F4C5B', fontSize: 13, lineHeight: 20, padding: spacing.sm },
  documentGroups: { gap: spacing.xl },
  documentGroup: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.sectionStrong, padding: spacing.lg, gap: spacing.sm },
  documentGroupHeading: { gap: 3 },
  documentGroupTitle: { color: '#1B1F27', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  documentGroupDetail: { color: '#737A87', fontSize: 13, lineHeight: 19 },
  documentCard: { paddingVertical: spacing.md, gap: spacing.xs },
  documentListCard: { backgroundColor: desktopSurfaces.card },
  documentListMain: { padding: spacing.md },
  documentListStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  documentTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  documentIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  documentProtectedNotice: { flexGrow: 1, minHeight: 42, borderRadius: 11, backgroundColor: colors.successSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md },
  documentProtectedText: { color: '#246C42', fontSize: 13, lineHeight: 18, fontWeight: '900' },
  artifactAccess: { gap: spacing.xs, marginTop: spacing.xs },
  artifactUnavailable: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  artifactError: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  dataRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  dataGrow: { flex: 1, minWidth: 0 },
  dataTitle: { color: '#1B1F27', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  cardTitle: { color: '#1B1F27', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  dataMeta: { color: '#737A87', fontSize: 13, lineHeight: 19 },
  dataDetail: { color: '#4E5562', fontSize: 15, lineHeight: 22 },
  taskActionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  addTaskButton: { minWidth: 180 },
  taskSyncHint: { color: '#68717E', fontSize: 13, lineHeight: 19 },
  taskSearchField: { flexGrow: 1, flexBasis: 420, minWidth: 260, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.input, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  taskSearchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, paddingVertical: 0, outlineStyle: 'none' } as any,
  clearSearchButton: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  taskControlsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  taskViewTabs: { alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardMuted, padding: 4, gap: 4 },
  taskViewTab: { minHeight: 42, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  taskViewTabActive: { backgroundColor: desktopSurfaces.card, boxShadow: desktopSurfaces.shadow },
  taskViewTabText: { color: '#606875', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  taskViewTabTextActive: { color: desktopSurfaces.accent },
  taskViewCount: { minWidth: 26, height: 24, borderRadius: 12, backgroundColor: desktopSurfaces.selected, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  taskViewCountActive: { backgroundColor: desktopSurfaces.accentSoft },
  taskViewCountText: { color: '#616977', fontSize: 12, lineHeight: 16, fontWeight: '900' },
  taskViewCountTextActive: { color: desktopSurfaces.accent },
  taskFilters: { flexGrow: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'flex-end', gap: spacing.sm },
  taskFilterField: { gap: 3 },
  taskFilterLabel: { color: '#66707C', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  clearFiltersButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearFiltersText: { color: desktopSurfaces.accent, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  taskResultCount: { color: '#68717E', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  taskWorkspaceBody: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.lg },
  taskListPane: { flexGrow: 1, flexBasis: 660, minWidth: 0 },
  taskInspectorPane: { flexGrow: 1, flexBasis: 360, minWidth: 280, maxWidth: 430, alignSelf: 'flex-start', position: 'sticky' as any, top: spacing.lg },
  taskInspectorPaneCompact: { order: -1, flexBasis: '100%', minWidth: 0, maxWidth: '100%', position: 'relative', top: 0 } as any,
  taskInspectorPaneEditing: { position: 'relative' as any, top: 0 },
  taskGroups: { gap: spacing.md },
  taskHierarchyToolbar: { minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  taskHierarchyToolbarCopy: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 1 },
  taskHierarchyToolbarTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
  taskHierarchyToolbarDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  taskHierarchyActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  taskHierarchyButton: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, justifyContent: 'center', paddingHorizontal: spacing.md },
  taskHierarchyButtonText: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  taskProjectGroup: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.sm, gap: spacing.sm, boxShadow: desktopSurfaces.shadow },
  taskProjectHeading: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.header, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  taskProjectHeadingCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  taskProjectTitle: { flex: 1, color: '#171A21', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  taskProjectCount: { color: desktopSurfaces.accentText, fontSize: 13, lineHeight: 19, fontWeight: '900' },
  taskGroup: { borderRadius: 13, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.sm, gap: spacing.sm },
  taskAreaHeading: { minHeight: 48, borderLeftWidth: 5, borderLeftColor: desktopSurfaces.accent, borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.selected, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  taskAreaHeadingCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  taskAreaTitle: { flex: 1, color: '#1B1F27', fontSize: 15, lineHeight: 20, fontWeight: '900' },
  taskAreaCount: { color: desktopSurfaces.accentText, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  taskAreaContent: { gap: spacing.sm },
  taskHierarchyHeadingPressed: { opacity: 0.78 },
  taskPaginationFooter: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.toolbar, padding: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  taskCardActions: { minHeight: 38, borderTopWidth: 1, borderTopColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardMuted, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  taskDetailsButton: { minHeight: 32, borderRadius: 9, backgroundColor: desktopSurfaces.accentSoft, justifyContent: 'center', paddingHorizontal: spacing.sm },
  taskDetailsButtonText: { color: desktopSurfaces.accent, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  taskTextAction: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  taskTextActionLabel: { color: desktopSurfaces.accent, fontSize: 12, lineHeight: 17, fontWeight: '900' },
  compactActionButton: { minWidth: 90 },
  deleteTextButton: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md },
  deleteText: { color: '#B52D2D', fontSize: 14, lineHeight: 20, fontWeight: '900' },
  deleteConfirm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#E5A4A4', backgroundColor: '#FFF3F3', padding: spacing.lg, gap: spacing.lg },
  deleteConfirmTitle: { color: '#8F2222', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  conflictResolutionCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#D5A84C', backgroundColor: '#FFF8E8', padding: spacing.lg, gap: spacing.lg },
  conflictResolutionTitle: { color: '#76510A', fontSize: 18, lineHeight: 24, fontWeight: '900' },
  dangerButton: { minHeight: 42, borderRadius: 12, backgroundColor: '#C73535', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  editorCard: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.xl, gap: spacing.lg },
  editorTitle: { color: '#171A21', fontSize: 24, lineHeight: 31, fontWeight: '900' },
  taskInspectorEmpty: { minHeight: 300, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  taskInspectorEmptyIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  taskInspectorEmptyTitle: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  taskInspectorEmptyText: { maxWidth: 320, color: colors.mutedText, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  taskDetailsPanel: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.md, boxShadow: desktopSurfaces.shadowStrong },
  taskDetailsHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  taskDetailsEyebrow: { color: desktopSurfaces.accent, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  taskDetailsTitle: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: '900', marginTop: 2 },
  taskInspectorClose: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: desktopSurfaces.border, alignItems: 'center', justifyContent: 'center' },
  taskDetailsBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  taskProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  taskProgressLabel: { color: colors.mutedText, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  taskProgressValue: { color: desktopSurfaces.accent, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  taskProgressTrack: { height: 8, borderRadius: 999, backgroundColor: desktopSurfaces.border, overflow: 'hidden' },
  taskProgressFill: { height: '100%', borderRadius: 999, backgroundColor: desktopSurfaces.accent },
  taskDetailsFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  taskDetailFact: { flexGrow: 1, flexBasis: 155, borderRadius: 11, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.sm, gap: 2 },
  taskDetailFactLabel: { color: '#717A87', fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  taskDetailFactValue: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  taskDetailsCallout: { borderRadius: 12, borderLeftWidth: 4, borderLeftColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.accentSoft, padding: spacing.md, gap: 3 },
  taskDetailsCalloutLabel: { color: desktopSurfaces.accentText, fontSize: 10, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  taskDetailsCalloutText: { color: desktopSurfaces.accentText, fontSize: 14, lineHeight: 21, fontWeight: '800' },
  taskDetailsSection: { borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingTop: spacing.md, gap: 4 },
  taskDetailsSectionTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  taskDetailsSectionText: { color: '#4F5865', fontSize: 14, lineHeight: 21 },
  taskInspectorActions: { borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  taskInspectorEditButton: { flexGrow: 1, minWidth: 180 },
  twoColumnFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  flexField: { flexGrow: 1, flexBasis: 280 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  smallChoice: { minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: desktopSurfaces.border, paddingHorizontal: spacing.md, justifyContent: 'center', backgroundColor: desktopSurfaces.input },
  optionalLabel: { color: '#7B828E', fontWeight: '500' },
  activityEntry: { borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.md, gap: 3 },
  notesInput: { minHeight: 112, paddingTop: spacing.md, textAlignVertical: 'top' },
  reportExecutiveCard: { borderRadius: 20, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.xl, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  reportExecutiveHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  reportExecutiveEyebrow: { color: desktopSurfaces.accentText, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  reportExecutiveTitle: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 3 },
  reportExecutiveSnapshot: { color: desktopSurfaces.text, fontSize: 18, lineHeight: 28, fontWeight: '700' },
  reportProjectConditions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  reportProjectCondition: { flexGrow: 1, flexBasis: 300, borderRadius: 13, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.md, gap: 3 },
  reportProjectConditionName: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
  reportProjectConditionText: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 21 },
  reportPMGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: spacing.md },
  reportFactCard: { flexGrow: 1, flexBasis: 430, minWidth: 0, borderRadius: 16, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  reportFactCard_neutral: { borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardBlue },
  reportFactCard_warning: { borderColor: '#E7C982', backgroundColor: '#FFF9EC' },
  reportFactCard_danger: { borderColor: '#E3AAAA', backgroundColor: '#FFF4F4' },
  reportFactCard_success: { borderColor: '#A9D3B8', backgroundColor: '#F2FAF5' },
  reportFactHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportFactIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reportFactIcon_neutral: { backgroundColor: desktopSurfaces.accentSoft },
  reportFactIcon_warning: { backgroundColor: colors.warningSoft },
  reportFactIcon_danger: { backgroundColor: colors.dangerSoft },
  reportFactIcon_success: { backgroundColor: colors.successSoft },
  reportFactTitle: { flex: 1, color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  reportFactList: { gap: spacing.sm },
  reportFactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reportFactBullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: desktopSurfaces.accent, marginTop: 7 },
  reportFactText: { flex: 1, color: '#3E4854', fontSize: 14, lineHeight: 21 },
  reportFactEmpty: { color: colors.mutedText, fontSize: 14, lineHeight: 21, fontStyle: 'italic' },
  reportFactMore: { color: desktopSurfaces.accentText, fontSize: 13, lineHeight: 19, fontWeight: '800', marginTop: spacing.xs },
  reportNextActionsCard: { borderRadius: 17, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardLavender, padding: spacing.lg, gap: spacing.md },
  reportActionList: { gap: spacing.sm },
  reportPMAction: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, borderRadius: 13, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.md },
  reportPMActionNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: desktopSurfaces.accent, alignItems: 'center', justifyContent: 'center' },
  reportPMActionNumberText: { color: desktopSurfaces.onAccent, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  reportPMActionTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
  reportPMActionMeta: { color: desktopSurfaces.accentText, fontSize: 13, lineHeight: 19, fontWeight: '800', marginTop: 2 },
  reportPrepareBar: { borderRadius: 16, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  reportPrepareButton: { minWidth: 240 },
  reportComposer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.lg },
  reportPreviewColumn: { flexGrow: 1, flexBasis: 620, minWidth: 0, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.lg, gap: spacing.md, boxShadow: desktopSurfaces.shadow },
  reportPreviewHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  reportPreviewScroll: { maxHeight: 520 },
  reportPreviewText: { color: colors.text, fontSize: 15, lineHeight: 24, fontFamily: 'system-ui' },
  reportReviewPanel: { flexGrow: 1, flexBasis: 280, maxWidth: 360, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardBlue, padding: spacing.lg, gap: spacing.md },
  reportReviewHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportReviewIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  reportReviewText: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  reportActionStack: { gap: spacing.sm },
  reportActionButton: { width: '100%' },
  reportInput: { minHeight: 520, paddingTop: spacing.md, textAlignVertical: 'top', fontFamily: 'monospace' },
  uploadReview: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardBlue, padding: spacing.lg, gap: spacing.md },
  inlineButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  inlineButtonsLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.md },
  saveTaskButton: { minWidth: 190 },
  successBanner: { borderRadius: 12, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', padding: spacing.md },
  successText: { color: '#195B35', fontSize: 14, lineHeight: 21 },
  statusBadge: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  statusBadge_good: { backgroundColor: '#EAF8EF' },
  statusBadge_attention: { backgroundColor: '#FFF3DD' },
  statusBadge_danger: { backgroundColor: '#FDEBEB' },
  statusBadge_neutral: { backgroundColor: desktopSurfaces.selected },
  statusBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  statusBadgeText_good: { color: '#217342' },
  statusBadgeText_attention: { color: '#956000' },
  statusBadgeText_danger: { color: '#B52D2D' },
  statusBadgeText_neutral: { color: '#5D6571' },
  taskStatusBadge: { minWidth: 116, borderRadius: 999, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  taskStatusBadge_completed: { borderColor: '#86CDA1', backgroundColor: '#E5F7EB' },
  taskStatusBadge_overdue: { borderColor: '#E29A9A', backgroundColor: '#FDE7E7' },
  taskStatusBadge_notStarted: { borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.selected },
  taskStatusBadge_inProgress: { borderColor: '#E3B45A', backgroundColor: '#FFF0D1' },
  taskStatusBadgeText: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  taskStatusBadgeText_completed: { color: '#146B37' },
  taskStatusBadgeText_overdue: { color: '#9C2323' },
  taskStatusBadgeText_notStarted: { color: desktopSurfaces.accentText },
  taskStatusBadgeText_inProgress: { color: '#7A4C00' },
  emptyState: { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, padding: spacing.xl },
  emptyStateText: { color: '#666D79', fontSize: 15, lineHeight: 23 },
  fieldGroup: { gap: spacing.xs },
  fieldLabel: { color: '#2B3038', fontSize: 14, lineHeight: 20, fontWeight: '800' },
  input: { minHeight: 52, borderWidth: 1, borderColor: desktopSurfaces.border, borderRadius: 12, backgroundColor: desktopSurfaces.input, color: desktopSurfaces.text, fontSize: 16, paddingHorizontal: spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  mutedText: { color: '#747B87', fontSize: 14, lineHeight: 20 },
  errorBanner: { borderRadius: 12, borderWidth: 1, borderColor: '#E5A4A4', backgroundColor: '#FDEEEE', padding: spacing.md },
  errorText: { color: '#9B2525', fontSize: 14, lineHeight: 21 },
  primaryButton: { minHeight: 52, borderRadius: 12, backgroundColor: desktopSurfaces.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  primaryButtonText: { color: desktopSurfaces.onAccent, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  syncButton: { alignSelf: 'flex-start', minWidth: 240 },
  settingsWorkspace: { gap: spacing.xl },
  syncHero: { borderRadius: 18, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, borderTopWidth: 5, borderTopColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.cardBlue, padding: spacing.xl, gap: spacing.xl, boxShadow: desktopSurfaces.shadow },
  syncHeroHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md },
  syncHeroIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 5px 14px rgba(23,33,58,0.06)' },
  syncHeroEyebrow: { color: desktopSurfaces.accent, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.2 },
  syncHeroTitle: { color: colors.text, fontSize: 25, lineHeight: 31, fontWeight: '900', marginTop: 2 },
  syncHeroDetail: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 4 },
  settingsActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  syncGuideGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  syncGuideCard: { flexGrow: 1, flexBasis: 420, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.card, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, boxShadow: desktopSurfaces.shadow },
  syncGuideIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: desktopSurfaces.accentSoft, alignItems: 'center', justifyContent: 'center' },
  syncGuideText: { color: colors.mutedText, fontSize: 14, lineHeight: 21, marginTop: 3 },
  dataHealthHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  dataHealthIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: desktopSurfaces.cardMuted, alignItems: 'center', justifyContent: 'center' },
  dataCheckSuccess: { borderRadius: 13, borderWidth: 1, borderColor: '#7CC59A', backgroundColor: '#EFFAF3', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  dataCheckSuccessTitle: { color: '#1F6B3E', fontSize: 15, lineHeight: 21, fontWeight: '900' },
  dataCheckSuccessText: { color: '#35664A', fontSize: 14, lineHeight: 20 },
  syncBoundaryBanner: { borderRadius: 18, borderWidth: 1, borderColor: '#E7B766', backgroundColor: '#FFF7E8', padding: spacing.lg, gap: spacing.xs },
  syncBoundaryTitle: { color: '#7B4D00', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  syncBoundaryDetail: { color: '#72551F', fontSize: 14, lineHeight: 21, maxWidth: 1000 },
  secondaryButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryButtonText: { color: desktopSurfaces.accent, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  buttonDisabled: { opacity: 0.48 },
  buttonPressed: { opacity: 0.72 },
  sessionNote: { color: '#747B87', fontSize: 12, lineHeight: 18 },
});
