import { Link, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createElement, useCallback, useEffect, useMemo, useState } from 'react';
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
  type ProjectItemType,
  type ProjectUpdate,
  type ReferenceDocument,
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
import {
  daveWebDocumentDeletionIsProtected,
  groupDAVEWebDocuments,
} from '../../services/DAVEWebDocumentManagement';
import {
  buildDAVEWebScheduleItem,
  createDAVEWebTaskId,
  DAVEWebTaskValidationError,
  type DAVEWebScheduleItem,
  type DAVEWebTaskDraft,
} from '../../services/DAVEWebTaskEditing';
import {
  buildDAVEProjectScheduleRollup,
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
import { buildDAVETaskAreaSummary } from '../../services/DAVETaskAreaSummary';
import { presentDAVEWebFreshness } from '../../services/DAVEWebFreshness';
import {
  buildDAVEWebReportDraft,
  buildDAVEWebReportSource,
  buildDAVEWebReportTitle,
  buildDAVEWebTruthDiagnostics,
  createDAVEWebBackup,
  createDAVEWebId,
  DAVE_WEB_DOCUMENT_CATEGORIES,
  daveWebReportSourceIsCurrent,
  formatDAVEWebReport,
  prepareDAVEWebDocumentUpload,
  prepareDAVEWebLinkedDocument,
  recoverDAVEWebPreparedUploadBytes,
  reportRecordFromDocument,
  validateDAVEWebBackup,
  type DAVEWebBackup,
  type DAVEWebPreparedUpload,
  type DAVEWebReportAudience,
  type DAVEWebReportRecord,
  type DAVEWebReportSource,
} from '../../services/DAVEWebOperations';
import { colors, spacing } from '../../theme';
import { daysUntilDate } from '../../utils/date';
import { PRODUCT_BRAND, PRODUCT_RELEASE } from '../../product-brand';
import { VitruviusBrandLockup } from '../vitruvius-brand-lockup';
import { useDesktopAuth } from './desktop-auth-provider';
import { DesktopConnectionStatus } from './desktop-connection-status';
import { DesktopOverviewPage } from './desktop-overview-page';
import { DesktopSchedulePage } from './desktop-schedule-page';
import { DesktopAskECOSWorkspace } from './desktop-ask-ecos';
import { DesktopDocumentOnboarding } from './desktop-document-onboarding';
import { DesktopDocumentProofPreview } from './desktop-document-proof-preview';
import { desktopSurfaces } from './desktop-surface-palette';
import { ProjectControlsEditor } from '../project-controls-editor';
import { FieldNotesWorkspace } from '../field-notes-workspace';
import { desktopFieldNoteDataSource } from '../../services/FieldNoteDesktopDataSource';
import { ScheduleTaskAreaSummaryPanel } from '../schedule-workspace-layout';
import { buildVitruviusPortfolioImpact } from '../../services/VitruviusProjectControls';
import { applyProjectControlTemplateToControls } from '../../services/ProjectControlTemplates';
import { buildVitruviusMyWork } from '../../services/VitruviusMyWork';
import { buildVitruviusReviewQueue } from '../../services/VitruviusReviewQueue';
import {
  projectItemWorkflowIsClosed,
  projectItemWorkflowReadiness,
} from '../../services/ProjectItemWorkflow';
import { resolveWebReportWordMedia } from '../../services/ReportWordMedia.web';
import { buildAutomaticReportDrawingReferences } from '../../services/ReportDrawingReferences';
import {
  ECOSDocumentExtractionCancelledError,
  extractECOSWebDocument,
  type ECOSDocumentAnalysisProgress,
} from '../../services/ECOSWebDocumentExtraction';
import { buildECOSDocumentReadiness } from '../../services/ECOSDocumentReadiness';
import { resolveECOSCustomerDocumentStatus } from '../../services/ECOSDocumentOnboarding';
import type { ECOSDocumentCoverageSummary } from '../../services/ECOSDocumentCoverageSummary';
import { buildECOSDocumentReindexPlan } from '../../services/ECOSDocumentReindexPlan';
import { hasCompleteECOSDrawingVisualCoverage } from '../../services/ECOSDrawingVisualCoverage';
import {
  parseECOSDesktopDocumentProofFocus,
  type ECOSDesktopDocumentProofFocus,
} from '../../services/ECOSDesktopProofNavigation';
import type { ECOSProjectIdentity } from '../../services/ECOSDocumentEvidenceBinding';
import {
  disconnectGoogleDriveSession,
  downloadLinkedGoogleDriveDocument,
  GOOGLE_DRIVE_LINK_MAX_BYTES,
  GoogleDriveDocumentError,
  googleDriveSessionIsAuthorized,
  googleDriveWebConfiguration,
  pickGoogleDrivePdf,
  type GoogleDriveDownloadSession,
  type GoogleDriveLinkedSource,
} from '../../services/GoogleDriveWebProvider';
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
  'field-notes': {
    eyebrow: 'FIELD MEMORY',
    title: 'Field Notes',
    description: 'Quickly capture observations and reminders that are not yet part of a project or task.',
  },
  'ask-ecos': {
    eyebrow: 'PROJECT INTELLIGENCE',
    title: 'Ask ECOS',
    description: 'Ask a project question and receive a concise answer tied to exact current evidence.',
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
      <VitruviusBrandLockup large testID="desktop-sign-in-brand-lockup" />
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
  const params = useLocalSearchParams<{
    project?: string | string[];
    proofDocument?: string | string[];
    proofProjectId?: string | string[];
    proofSourceSha256?: string | string[];
    proofEvidenceVersion?: string | string[];
    proofRevision?: string | string[];
    proofPage?: string | string[];
    proofRegion?: string | string[];
    proofSheet?: string | string[];
    proofX?: string | string[];
    proofY?: string | string[];
    proofWidth?: string | string[];
    proofHeight?: string | string[];
  }>();
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
  const proofFocus = useMemo(
    () => parseECOSDesktopDocumentProofFocus(params),
    [
      params.proofDocument,
      params.proofProjectId,
      params.proofSourceSha256,
      params.proofEvidenceVersion,
      params.proofRevision,
      params.proofHeight,
      params.proofPage,
      params.proofRegion,
      params.proofSheet,
      params.proofWidth,
      params.proofX,
      params.proofY,
    ],
  );
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
    router.setParams({
      project: projectName || undefined,
      proofDocument: undefined,
      proofProjectId: undefined,
      proofSourceSha256: undefined,
      proofEvidenceVersion: undefined,
      proofRevision: undefined,
      proofPage: undefined,
      proofRegion: undefined,
      proofSheet: undefined,
      proofX: undefined,
      proofY: undefined,
      proofWidth: undefined,
      proofHeight: undefined,
    });
  };

  return (
    <View style={[styles.root, usesSidebar && styles.rootWide]}>
      {usesSidebar ? (
        <DesktopSidebar
          pathname={pathname}
          selectedProject={selectedProject}
          documentCount={snapshot.referenceDocuments.length}
        />
      ) : null}
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
          proofFocus={proofFocus}
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
  proofFocus,
  displayName,
  onSaveDisplayName,
}: {
  page: DesktopReadOnlyPage;
  selectedProject: string | null;
  proofFocus: ECOSDesktopDocumentProofFocus | null;
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
  const projectIdentities = snapshot.projects.flatMap(project => {
    const id = project.id?.trim() || '';
    const name = project.name?.trim() || '';
    return id && name ? [{ id, name }] : [];
  });
  const photos = updates.flatMap(update => update.updateData.photos.map(photo => ({ update, photo })));
  if (page === 'overview') {
    return (
      <DesktopOverviewPage
        projects={projects}
        tasks={tasks}
        updates={updates}
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

  if (page === 'field-notes') {
    return (
      <FieldNotesWorkspace
        ownerKey={auth.userEmail || 'authorized-desktop-user'}
        projects={snapshot.projects.map(project => project.name)}
        projectRecords={snapshot.projects.map(project => ({
          id: project.id?.trim() || null,
          name: project.name,
        }))}
        initialProjectName={selectedProject}
        scopeProjectName={selectedProject}
        dataSource={desktopFieldNoteDataSource}
        presentation="desktop_inbox"
      />
    );
  }

  if (page === 'ask-ecos') {
    const selectedProjectRecord = selectedProject
      ? snapshot.projects.find(project => matchesProject(project.name, selectedProject)) || null
      : null;
    return (
      <DesktopAskECOSWorkspace
        projectId={selectedProjectRecord?.id || null}
        projectName={selectedProjectRecord?.name || selectedProject}
        onAsk={auth.askProjectQuestion}
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
          tasks={snapshot.scheduleItems}
          projects={snapshot.projects.map(project => project.name)}
          projectIdentities={projectIdentities}
          selectedProject={selectedProject}
          proofFocus={proofFocus}
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
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
  const scheduleRollup = buildDAVEProjectScheduleRollup({
    projectName: project.name,
    items: [...tasks],
  });
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
  const completed = scheduleRollup.completedCount;
  const open = scheduleRollup.openCount;
  const overdue = projectTasks.filter(taskIsOverdue).length;
  const dueSoon = projectTasks.filter(task => {
    if (taskIsComplete(task)) return false;
    const days = daysUntilDate(task.finishDate, new Date(), task.projectTimeZone || undefined);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const areaCount = uniqueOptions(projectTasks.map(task => task.locationName)).length;
  const percent = scheduleRollup.percentComplete;
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
  const [taskView, setTaskView] = useState<'open' | 'mine' | 'reviews' | 'completed'>('open');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskWorkspaceStatusFilter>('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | SchedulePriority>('all');
  const [itemTypeFilter, setItemTypeFilter] = useState<'all' | ProjectItemType>('all');
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
  const desktopDisplayName = readVitruviusDesktopDisplayName();
  const myWork = useMemo(
    () => buildVitruviusMyWork({
      items: tasks,
      displayName: desktopDisplayName,
      email: auth.userEmail,
    }),
    [auth.userEmail, desktopDisplayName, tasks],
  );
  const myWorkTasks = useMemo(
    () => myWork.items.map(row => row.item as DAVEWebScheduleItem),
    [myWork.items],
  );
  const myReviews = useMemo(
    () => buildVitruviusReviewQueue({
      items: tasks,
      displayName: desktopDisplayName,
      email: auth.userEmail,
    }),
    [auth.userEmail, desktopDisplayName, tasks],
  );
  const portfolioImpact = useMemo(
    () => buildVitruviusPortfolioImpact(tasks),
    [tasks],
  );
  const taskViewItems = taskView === 'completed'
    ? completedTasks
    : taskView === 'mine'
      ? myWorkTasks
      : taskView === 'reviews'
        ? myReviews.items.map(item => item as DAVEWebScheduleItem)
      : openTasks;
  const areaOptions = uniqueOptions(taskViewItems.map(task => task.locationName));
  const visibleTasks = useMemo(() => {
    const query = normalizedName(searchQuery);
    return taskViewItems.filter(task => {
      if (query && !taskSearchText(task).includes(query)) return false;
      if (areaFilter !== 'all' && normalizedName(task.locationName) !== normalizedName(areaFilter)) return false;
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
      if (itemTypeFilter !== 'all' && (task.itemType || 'Task') !== itemTypeFilter) return false;
      if (statusFilter === 'overdue' && !taskIsOverdue(task)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'overdue' && task.status !== statusFilter) return false;
      return true;
    });
  }, [areaFilter, itemTypeFilter, priorityFilter, searchQuery, statusFilter, taskViewItems]);
  const taskAreaSummaries = useMemo(() => {
    const groups = new Map<string, {
      projectName: string;
      areaName: string;
      tasks: ScheduleItem[];
    }>();
    visibleTasks.forEach(task => {
      const projectName = task.scheduleProjectName?.trim() || task.projectName.trim() || 'No project';
      const areaName = task.locationName?.trim() || 'No Area Assigned';
      const key = taskAreaGroupKey(projectName, areaName);
      const group = groups.get(key) ?? { projectName, areaName, tasks: [] };
      group.tasks.push(task);
      groups.set(key, group);
    });
    return new Map([...groups.entries()].map(([key, group]) => [
      key,
      buildDAVETaskAreaSummary(group),
    ]));
  }, [visibleTasks]);
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? null;
  const selectedAreaSummary = selectedAreaKey
    ? taskAreaSummaries.get(selectedAreaKey) ?? null
    : null;
  const filtersActive = Boolean(
    searchQuery.trim() ||
    statusFilter !== 'all' ||
    areaFilter !== 'all' ||
    priorityFilter !== 'all' ||
    itemTypeFilter !== 'all',
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
  useEffect(() => {
    if (selectedAreaKey && !taskAreaSummaries.has(selectedAreaKey)) {
      setSelectedAreaKey(null);
    }
  }, [selectedAreaKey, taskAreaSummaries]);

  const openCreate = () => {
    setEditingTask(null);
    setSelectedTaskId(null);
    setSelectedAreaKey(null);
    setDeleteCandidate(null);
    setNotice(null);
    setConflictDraft(null);
    setEditorOpen(true);
  };

  const openEdit = (task: ScheduleItem) => {
    setEditingTask(task as DAVEWebScheduleItem);
    setSelectedTaskId(task.id);
    setSelectedAreaKey(null);
    setDeleteCandidate(null);
    setNotice(null);
    setConflictDraft(null);
    setEditorOpen(true);
  };

  const openDetails = (task: ScheduleItem) => {
    setSelectedTaskId(task.id);
    setSelectedAreaKey(null);
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
    setItemTypeFilter('all');
  };

  const saveTask = async (draft: DAVEWebTaskDraft) => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const selectedProjectId = editingTask?.projectId || auth.snapshot?.projects.find(project =>
        matchesProject(project.name, draft.projectName),
      )?.id || null;
      const item = buildDAVEWebScheduleItem({
        draft: { ...draft, projectId: selectedProjectId },
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

  const addPhotoToTask = async (task: DAVEWebScheduleItem, file: File | null) => {
    if (!file || pending) return;
    setPending(true);
    setNotice(null);
    try {
      await auth.uploadTaskPhoto(
        task,
        file.name || 'task-photo',
        file.type || 'image/jpeg',
        await file.arrayBuffer(),
      );
      setSelectedTaskId(task.id);
      setNotice({
        tone: 'good',
        text: 'Photo added to this task and synced to the shared project record.',
      });
    } catch (error) {
      setNotice({ tone: 'danger', text: taskPhotoMutationMessage(error) });
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
        { icon: 'person-circle-outline', label: 'My Work', value: myWork.counts.open },
        { icon: 'play-circle-outline', label: 'In Progress', value: inProgressTasks.length },
        { icon: 'checkmark-circle-outline', label: 'Completed', value: completedTasks.length, tone: 'success' },
        { icon: 'alert-circle-outline', label: 'Overdue', value: overdueTasks.length, tone: overdueTasks.length ? 'warning' : 'neutral' },
        {
          icon: 'person-outline',
          label: 'Unassigned',
          value: portfolioImpact.unassignedItemCount,
          tone: portfolioImpact.unassignedItemCount ? 'warning' : 'neutral',
        },
        {
          icon: 'shield-checkmark-outline',
          label: 'Approval Needed',
          value: portfolioImpact.pendingApprovalCount,
          tone: portfolioImpact.pendingApprovalCount ? 'warning' : 'neutral',
        },
        {
          icon: 'calendar-outline',
          label: 'Task Delay Estimates',
          value: `${portfolioImpact.taskDelayEstimateDaysTotal} day${portfolioImpact.taskDelayEstimateDaysTotal === 1 ? '' : 's'} total`,
          tone: portfolioImpact.taskDelayEstimateDaysTotal ? 'warning' : 'neutral',
        },
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
            label="My Work"
            count={myWork.counts.open}
            active={taskView === 'mine'}
            onPress={() => {
              setTaskView('mine');
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
          <TaskViewTab
            label="My Reviews"
            count={myReviews.items.length}
            active={taskView === 'reviews'}
            onPress={() => {
              setTaskView('reviews');
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
            label="Work type"
            value={itemTypeFilter}
            options={[
              { value: 'all', label: 'All work types' },
              ...PROJECT_ITEM_TYPES.map(itemType => ({ value: itemType, label: itemType })),
            ]}
            onChange={value => setItemTypeFilter(value as 'all' | ProjectItemType)}
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
        Showing {visibleTasks.length} of {taskViewItems.length}{' '}
        {taskView === 'completed'
          ? 'completed'
          : taskView === 'mine'
            ? 'assigned'
            : taskView === 'reviews'
              ? 'review'
              : 'open'} tasks
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
            key={`${taskView}:${selectedProject ?? 'all-projects'}:${searchQuery}:${statusFilter}:${areaFilter}:${itemTypeFilter}:${priorityFilter}`}
            tasks={visibleTasks}
            selectedTaskId={selectedTaskId}
            selectedAreaKey={selectedAreaKey}
            autoExpandMatches={filtersActive}
            onSelect={openDetails}
            onSelectArea={(projectName, areaName) => {
              const key = taskAreaGroupKey(projectName, areaName);
              setSelectedTaskId(null);
              setEditingTask(null);
              setEditorOpen(false);
              setDeleteCandidate(null);
              setConflictDraft(null);
              setSelectedAreaKey(current => current === key ? null : key);
            }}
            onEdit={openEdit}
            onDelete={task => {
              setEditorOpen(false);
              setEditingTask(null);
              setNotice(null);
              setDeleteCandidate(task as DAVEWebScheduleItem);
            }}
          />
        </View>
        {editorOpen || selectedTask || selectedAreaSummary || !compactTaskWorkspace ? (
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
                actor={auth.userEmail || 'Project manager'}
                pending={pending}
                onAddPhoto={editingTask
                  ? file => addPhotoToTask(editingTask, file)
                  : undefined}
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
                pending={pending}
                onAddPhoto={file => addPhotoToTask(selectedTask, file)}
                onDelete={() => {
                  setNotice(null);
                  setDeleteCandidate(selectedTask);
                }}
              />
            ) : selectedAreaSummary ? (
              <ScheduleTaskAreaSummaryPanel
                summary={selectedAreaSummary}
                onOpenTask={taskId => {
                  const task = tasks.find(item => item.id === taskId);
                  if (task) openDetails(task);
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
  selectedAreaKey,
  autoExpandMatches,
  onSelect,
  onSelectArea,
  onEdit,
  onDelete,
}: {
  tasks: readonly ScheduleItem[];
  selectedTaskId?: string | null;
  selectedAreaKey?: string | null;
  autoExpandMatches?: boolean;
  onSelect?: (task: ScheduleItem) => void;
  onSelectArea?: (projectName: string, areaName: string) => void;
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
                      selectedAreaKey === areaKey && styles.taskAreaHeadingSelected,
                      pressed && styles.taskHierarchyHeadingPressed,
                    ]}
                    onPress={() => {
                      toggleArea(project.projectName, area.areaName);
                      onSelectArea?.(project.projectName, area.areaName);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${areaExpanded ? 'Collapse' : 'Expand'} ${area.areaName}`}
                    accessibilityHint={`Also opens the ${area.areaName} area summary.`}
                    accessibilityState={{
                      expanded: areaExpanded,
                      selected: selectedAreaKey === areaKey,
                    }}
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

function automaticTaskStatus(percentComplete: number): ScheduleStatus {
  if (percentComplete >= 100) return 'Complete';
  if (percentComplete > 0) return 'In Progress';
  return 'Not Started';
}

function TaskEditor({
  task,
  defaultProject,
  projectOptions,
  locationOptions,
  ownerOptions,
  contractorOptions,
  actor,
  pending,
  onAddPhoto,
  onCancel,
  onSave,
}: {
  task: DAVEWebScheduleItem | null;
  defaultProject: string;
  projectOptions: readonly string[];
  locationOptions: readonly string[];
  ownerOptions: readonly string[];
  contractorOptions: readonly string[];
  actor: string;
  pending: boolean;
  onAddPhoto?: (file: File | null) => void;
  onCancel: () => void;
  onSave: (draft: DAVEWebTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TaskFormState>(() => taskFormState(task, defaultProject));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const workflowCandidate = taskEditorWorkflowCandidate(task, draft);
  const structuredWorkflow = draft.itemType !== 'Task';
  const workflowClosed = Boolean(task && projectItemWorkflowIsClosed(task));
  const workflowReadiness = projectItemWorkflowReadiness(workflowCandidate, {
    closingNote: draft.activityMessage,
  });
  const structuredStatusOptions: readonly ScheduleStatus[] = workflowClosed
    ? ['Complete']
    : ['Not Started', 'In Progress', 'Waiting'];
  const parsedPercentComplete = Number(draft.percentComplete);
  const derivedTaskStatus = automaticTaskStatus(
    Number.isFinite(parsedPercentComplete) ? parsedPercentComplete : 0,
  );
  const taskStatusOptions = Array.from(new Set<ScheduleStatus>([
    derivedTaskStatus,
    'Waiting',
  ]));

  const updateField = <K extends keyof TaskFormState,>(key: K, value: TaskFormState[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
  };

  const updatePercentComplete = (value: string) => {
    const normalizedValue = value.replace(/[^0-9]/g, '').slice(0, 3);
    setDraft(previous => {
      if (!normalizedValue) {
        return { ...previous, percentComplete: '' };
      }
      const percentComplete = Number(normalizedValue);
      if (!Number.isFinite(percentComplete)) {
        return { ...previous, percentComplete: normalizedValue };
      }
      return {
        ...previous,
        percentComplete: normalizedValue,
        status: previous.status === 'Waiting' && percentComplete < 100
          ? 'Waiting'
          : automaticTaskStatus(percentComplete),
      };
    });
  };

  const submit = async () => {
    setValidationMessage(null);
    const percentComplete = Number(draft.percentComplete);
    if (!Number.isFinite(percentComplete) || percentComplete < 0 || percentComplete > 100) {
      setValidationMessage('Percent complete must be a number from 0 to 100.');
      return;
    }
    if (structuredWorkflow && !workflowClosed && percentComplete >= 100) {
      setValidationMessage(
        `Use "Close ${draft.itemType}" after the required information is complete.`,
      );
      return;
    }
    try {
      await onSave({
        ...draft,
        percentComplete,
        status: structuredWorkflow
          ? draft.status
          : draft.status === 'Waiting' && percentComplete < 100
            ? 'Waiting'
            : automaticTaskStatus(percentComplete),
      });
    } catch (error) {
      setValidationMessage(taskMutationMessage(error));
    }
  };

  const runWorkflowTransition = async () => {
    setValidationMessage(null);
    if (!workflowClosed && !workflowReadiness.readyToClose) {
      setValidationMessage(workflowReadiness.message);
      return;
    }
    try {
      await onSave({
        ...draft,
        percentComplete: Number(draft.percentComplete),
        workflowAction: workflowClosed ? 'reopen' : 'close',
      });
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
        {workflowClosed ? (
          <View style={styles.workflowProtectedField}>
            <Text style={styles.workflowProtectedValue}>{draft.itemType}</Text>
            <Text style={styles.dataMeta}>
              Reopen this record before changing its project item type.
            </Text>
          </View>
        ) : (
          <OptionButtons<ProjectItemType>
            options={PROJECT_ITEM_TYPES}
            value={draft.itemType}
            onChange={value => {
              setDraft(previous => ({
                ...previous,
                itemType: value,
                projectControls: value === 'Task'
                  ? previous.projectControls
                  : applyProjectControlTemplateToControls({
                      itemType: value,
                      current: previous.projectControls,
                      actor: actor.trim() || previous.owner.trim() || 'Project manager',
                      now: new Date().toISOString(),
                    }),
              }));
              if (value !== 'Task' && (
                draft.status === 'Complete' ||
                Number(draft.percentComplete) >= 100
              )) {
                setDraft(previous => ({
                  ...previous,
                  itemType: value,
                  status: 'In Progress',
                  percentComplete: '99',
                }));
              }
            }}
          />
        )}
      </View>
      <ChoiceOrTypeField label="Project" value={draft.projectName} options={projectOptions} onChange={value => updateField('projectName', value)} />
      <ChoiceOrTypeField label="Location / area" value={draft.locationName} options={locationOptions} onChange={value => updateField('locationName', value)} optional />
      {task && onAddPhoto ? (
        <TaskPhotoPicker
          pending={pending}
          onFile={onAddPhoto}
          detail="Creates a field update linked to this task, project, and area."
        />
      ) : null}

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
          options={structuredWorkflow ? structuredStatusOptions : taskStatusOptions}
          value={draft.status}
          onChange={value => updateField('status', value)}
        />
        {structuredWorkflow ? (
          <Text style={styles.dataMeta}>
            {workflowClosed
              ? `Use "Reopen ${draft.itemType}" to resume this record.`
              : `Use "Close ${draft.itemType}" to record Complete and 100%.`}
          </Text>
        ) : (
          <Text style={styles.dataMeta}>
            Percentage sets Not Started, In Progress, or Complete. Choose Waiting only for a true hold.
          </Text>
        )}
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Priority</Text>
        <OptionButtons<SchedulePriority>
          options={SCHEDULE_PRIORITIES}
          value={draft.priority}
          onChange={value => updateField('priority', value)}
        />
      </View>
      {structuredWorkflow && workflowClosed ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Percent complete</Text>
          <View style={styles.workflowProtectedField}>
            <Text style={styles.workflowProtectedValue}>100%</Text>
            <Text style={styles.dataMeta}>
              Reopen this record before changing progress.
            </Text>
          </View>
        </View>
      ) : (
        <LabeledTextField
          label={structuredWorkflow ? 'Percent complete (0–99)' : 'Percent complete'}
          value={draft.percentComplete}
          onChangeText={updatePercentComplete}
          placeholder="0"
          numeric
        />
      )}
      <LabeledTextField
        label="Next action"
        value={draft.nextAction}
        onChangeText={value => updateField('nextAction', value)}
        placeholder="Smallest accountable next step"
        optional
      />
      <ProjectControlsEditor
        item={{
          ...(task || {
            id: 'draft-project-controls',
            createdAt: new Date().toISOString(),
          }),
          itemType: draft.itemType,
          taskName: draft.taskName,
          scheduleProjectName: draft.projectName,
          projectName: draft.projectName,
          locationName: draft.locationName,
          startDate: draft.startDate,
          finishDate: draft.finishDate,
          milestone: draft.milestone,
          owner: draft.owner,
          contractor: draft.contractor,
          percentComplete: Number(draft.percentComplete) || 0,
          priority: draft.priority,
          status: draft.status,
          notes: draft.notes,
          nextAction: draft.nextAction,
          projectControls: draft.projectControls,
        }}
        actor={actor}
        onUpdate={projectControls => {
          const currentStage = draft.projectControls?.workflowStage || 'Open';
          if (!workflowClosed && projectControls.workflowStage === 'Closed') {
            setValidationMessage(
              `Use "Close ${draft.itemType}" to record the closed workflow stage.`,
            );
            return;
          }
          if (workflowClosed && projectControls.workflowStage !== currentStage) {
            setValidationMessage(
              `Use "Reopen ${draft.itemType}" before changing its workflow stage.`,
            );
            return;
          }
          setValidationMessage(null);
          updateField('projectControls', projectControls);
        }}
      />
      {structuredWorkflow ? (
        <View style={styles.workflowEditorCard}>
          <View style={styles.workflowEditorHeading}>
            <View style={styles.flexCopy}>
              <Text style={styles.fieldLabel}>{draft.itemType} workflow</Text>
              <Text style={styles.dataDetail}>{workflowReadiness.message}</Text>
            </View>
            <StatusBadge
              label={workflowClosed ? 'Closed' : workflowReadiness.readyToClose ? 'Ready' : 'Not Ready'}
              tone={workflowClosed || workflowReadiness.readyToClose ? 'good' : 'attention'}
            />
          </View>
          {!workflowClosed && workflowReadiness.missing.slice(0, 4).map(missing => (
            <Text key={missing} style={styles.workflowMissing}>• {missing}</Text>
          ))}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              !workflowClosed && !workflowReadiness.readyToClose && styles.workflowButtonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => { void runWorkflowTransition(); }}
            disabled={pending || (!workflowClosed && !workflowReadiness.readyToClose)}
            accessibilityRole="button"
          >
            {pending ? (
              <ActivityIndicator color={desktopSurfaces.onAccent} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {workflowClosed ? `Reopen ${draft.itemType}` : `Close ${draft.itemType}`}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
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
      {numeric ? createElement('input', {
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
        placeholder,
        type: 'text',
        inputMode: 'numeric',
        pattern: '[0-9]*',
        maxLength: 3,
        'aria-label': label,
        'data-testid': 'stable-web-numeric-input',
        style: {
          minHeight: 48,
          border: `1px solid ${desktopSurfaces.border}`,
          borderRadius: 12,
          background: desktopSurfaces.input,
          color: desktopSurfaces.text,
          fontSize: 16,
          padding: '0 16px',
          fontFamily: 'inherit',
          width: '100%',
          boxSizing: 'border-box',
          outlineColor: desktopSurfaces.accent,
        },
      }) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8A909C"
          style={styles.input}
          accessibilityLabel={label}
        />
      )}
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
        <View style={[styles.optionRow, styles.choiceFieldOptions]}>
          {options.map(option => (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.smallChoice,
                styles.choiceFieldChoice,
                normalizedName(value) === normalizedName(option) && styles.choiceActive,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option}`}
              accessibilityState={{ selected: normalizedName(value) === normalizedName(option) }}
            >
              <Text
                style={[
                  styles.choiceText,
                  styles.choiceFieldChoiceText,
                  normalizedName(value) === normalizedName(option) && styles.choiceTextActive,
                ]}
              >
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
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
    projectControls: task?.projectControls ?? null,
  };
}

function taskEditorWorkflowCandidate(
  task: DAVEWebScheduleItem | null,
  draft: TaskFormState,
): ScheduleItem {
  const percentComplete = Number(draft.percentComplete);
  return {
    ...(task || {}),
    id: task?.id || 'draft-project-item',
    itemType: draft.itemType,
    scheduleProjectName: draft.projectName,
    projectName: draft.projectName,
    locationName: draft.locationName,
    taskName: draft.taskName,
    startDate: draft.startDate,
    finishDate: draft.finishDate,
    milestone: draft.milestone,
    owner: draft.owner,
    contractor: draft.contractor,
    percentComplete: Number.isFinite(percentComplete) ? percentComplete : 0,
    priority: draft.priority,
    status: draft.status,
    notes: draft.notes,
    nextAction: draft.nextAction,
    activity: task?.activity || [],
    projectControls: draft.projectControls,
    createdAt: task?.createdAt || new Date().toISOString(),
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

const WEB_LIST_PAGE_SIZE = 75;

function useProgressiveListLimit(length: number, resetKey: string) {
  const [limit, setLimit] = useState(WEB_LIST_PAGE_SIZE);
  useEffect(() => setLimit(WEB_LIST_PAGE_SIZE), [resetKey]);
  return {
    limit,
    showMore: length > limit
      ? () => setLimit(current => Math.min(length, current + WEB_LIST_PAGE_SIZE))
      : null,
  };
}

function ProgressiveListFooter({ remaining, onShowMore }: {
  remaining: number;
  onShowMore: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
      onPress={onShowMore}
      accessibilityRole="button"
    >
      <Text style={styles.secondaryButtonText}>Show {Math.min(remaining, WEB_LIST_PAGE_SIZE)} more</Text>
    </Pressable>
  );
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
  const progressive = useProgressiveListLimit(
    tasks.length,
    `${tasks.length}:${tasks[0]?.id || ''}:${tasks[tasks.length - 1]?.id || ''}`,
  );
  if (tasks.length === 0) return <EmptyState text="No tasks match this view." />;
  return (
    <View style={styles.list}>
      {tasks.slice(0, progressive.limit).map(task => (
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
              <Text style={styles.dataDetail}>Start {formatDate(task.startDate)}</Text>
              <Text style={styles.taskFactDivider}>•</Text>
              <Text style={styles.dataDetail}>Finish / Due {formatDate(task.finishDate)}</Text>
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
      {progressive.showMore ? <ProgressiveListFooter remaining={tasks.length - progressive.limit} onShowMore={progressive.showMore} /> : null}
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
  pending,
  onClose,
  onEdit,
  onAddPhoto,
  onDelete,
}: {
  task: DAVEWebScheduleItem;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAddPhoto: (file: File | null) => void;
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

      <TaskPhotoPicker
        pending={pending}
        onFile={onAddPhoto}
        detail="The photo will be saved as a field update linked to this task and its current area."
      />

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
  const progressive = useProgressiveListLimit(
    updates.length,
    `${updates.length}:${updates[0]?.id || ''}:${updates[updates.length - 1]?.id || ''}`,
  );
  if (updates.length === 0) return <EmptyState text="No field activity matches these filters." />;
  return (
    <View style={styles.evidenceList}>
      {updates.slice(0, progressive.limit).map(update => {
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
      {progressive.showMore ? <ProgressiveListFooter remaining={updates.length - progressive.limit} onShowMore={progressive.showMore} /> : null}
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
  const progressive = useProgressiveListLimit(
    photos.length,
    `${photos.length}:${photos[0] ? photoItemKey(photos[0]) : ''}:${photos[photos.length - 1] ? photoItemKey(photos[photos.length - 1]) : ''}`,
  );
  if (photos.length === 0) return <EmptyState text="No project photos match these filters." />;
  return (
    <View style={styles.photoGrid}>
      {photos.slice(0, progressive.limit).map(item => {
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
      {progressive.showMore ? <ProgressiveListFooter remaining={photos.length - progressive.limit} onShowMore={progressive.showMore} /> : null}
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
  const [useOriginal, setUseOriginal] = useState(false);

  useEffect(() => {
    const path = photo.cloudStoragePath?.trim();
    if (!path) {
      setSignedUrl(null);
      setState('unavailable');
      return;
    }
    let active = true;
    setState('loading');
    void auth.getArtifactUrl('project-photos', path, {
      preview: !useOriginal,
    })
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
  }, [auth.getArtifactUrl, photo.cloudStoragePath, useOriginal]);

  const label = `${photo.caption?.trim() || 'Project photo'} for ${projectName}${areaName ? `, ${areaName}` : ''}`;
  if (state === 'ready' && signedUrl) {
    return (
      <View style={styles.photoVisual}>
        <Image
          source={{ uri: signedUrl }}
          style={styles.photoImage}
          resizeMode="cover"
          onError={() => {
            if (!useOriginal) setUseOriginal(true);
            else setState('error');
          }}
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

type DocumentReindexBatchProgress = Readonly<{
  running: boolean;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentDocumentName: string | null;
  currentDocumentProgress: number;
  currentDocumentStatus: string | null;
  failures: readonly string[];
}>;

type DocumentCoverageSummaryState = Readonly<{
  documentId: string;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  summary: ECOSDocumentCoverageSummary | null;
}>;

function DocumentManagementWorkspace({
  documents,
  tasks,
  projects,
  projectIdentities,
  selectedProject,
  proofFocus,
}: {
  documents: readonly DAVEWebReferenceDocument[];
  tasks: readonly DAVEWebScheduleItem[];
  projects: readonly string[];
  projectIdentities: readonly ECOSProjectIdentity[];
  selectedProject: string | null;
  proofFocus: ECOSDesktopDocumentProofFocus | null;
}) {
  const auth = useDesktopAuth();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const compactWorkspace = width < 1120;
  const documentPaneHeight = Math.max(520, height - 260);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [driveSelecting, setDriveSelecting] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocumentStatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>('Schedules');
  const [drawingNumber, setDrawingNumber] = useState('');
  const [drawingRevision, setDrawingRevision] = useState('');
  const [drawingDiscipline, setDrawingDiscipline] = useState('');
  const [drawingStatus, setDrawingStatus] = useState<NonNullable<ReferenceDocument['drawingStatus']>>('For Review');
  const [drawingIssuedAt, setDrawingIssuedAt] = useState('');
  const [uploadProjects, setUploadProjects] = useState<string[]>(
    selectedProject ? [selectedProject] : projects[0] ? [projects[0]] : [],
  );
  const [replacementId, setReplacementId] = useState<string>('');
  const [preparedUpload, setPreparedUpload] = useState<DAVEWebPreparedUpload | null>(null);
  const [preparedBytes, setPreparedBytes] = useState<ArrayBuffer | null>(null);
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [reindexProgress, setReindexProgress] = useState<DocumentReindexBatchProgress | null>(null);
  const driveConfiguration = useMemo(() => googleDriveWebConfiguration(), []);
  const reindexPlan = useMemo(
    () => selectedProject ? buildECOSDocumentReindexPlan(documents, selectedProject) : [],
    [documents, selectedProject],
  );
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
  const preparedFromDrive = preparedUpload?.document.sourceProvider === 'google_drive';
  const deleteCandidate = deleteCandidateId
    ? documents.find(document => document.id === deleteCandidateId) ?? null
    : null;
  const protectedCurrentDocument = Boolean(
    deleteCandidate && daveWebDocumentDeletionIsProtected(deleteCandidate),
  );
  const currentEvidenceDocument = Boolean(
    deleteCandidate?.isCurrent && !protectedCurrentDocument,
  );
  const linkedTasksAreRevisionSafe = Boolean(
    deleteCandidate?.linkedScheduleItems.every(item => Boolean(item.cloudUpdatedAt)),
  );

  const clearDocumentProofRoute = () => {
    router.setParams({
      proofDocument: undefined,
      proofProjectId: undefined,
      proofSourceSha256: undefined,
      proofEvidenceVersion: undefined,
      proofRevision: undefined,
      proofPage: undefined,
      proofRegion: undefined,
      proofSheet: undefined,
      proofX: undefined,
      proofY: undefined,
      proofWidth: undefined,
      proofHeight: undefined,
    });
  };

  const selectDocument = (document: DAVEWebReferenceDocument) => {
    if (proofFocus && proofFocus.documentId !== document.id) clearDocumentProofRoute();
    setSelectedDocumentId(document.id);
  };

  const closeSelectedDocument = () => {
    if (proofFocus) clearDocumentProofRoute();
    setSelectedDocumentId(null);
  };

  useEffect(() => {
    if (selectedDocumentId && !documents.some(document => document.id === selectedDocumentId)) {
      setSelectedDocumentId(null);
    }
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    if (!proofFocus || !documents.some(document => document.id === proofFocus.documentId)) return;
    setSearchQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
    setSelectedDocumentId(proofFocus.documentId);
  }, [documents, proofFocus?.documentId, proofFocus?.pageNumber, proofFocus?.regionId]);

  async function chooseUploadFile(
    file: File | null,
    linkedSource: GoogleDriveLinkedSource | null = null,
    linkedBytes: ArrayBuffer | null = null,
  ) {
    if (!file) return;
    setNotice(null);
    try {
      if (uploadProjects.length === 0) {
        throw new Error('Choose at least one project before selecting the source file.');
      }
      if (normalizedName(uploadCategory) === 'drawing') {
        const missing = [
          drawingNumber.trim() ? null : 'drawing number',
          drawingRevision.trim() ? null : 'revision',
          drawingStatus ? null : 'issue status',
        ].filter(Boolean);
        if (missing.length > 0) {
          throw new Error(`Complete the ${missing.join(', ')} before selecting the drawing file.`);
        }
      }
      const bytes = linkedBytes ?? await file.arrayBuffer();
      const isDrawingUpload = normalizedName(uploadCategory) === 'drawing';
      const candidateAreaNames = uniqueOptions(tasks
        .filter(task => uploadProjects.some(project =>
          normalizedName(task.scheduleProjectName || task.projectName) === normalizedName(project),
        ))
        .map(task => task.locationName));
      // Drawing preparation belongs to the hosted worker. File selection must
      // stay fast and must not make the browser page the indexing engine.
      const extraction = isDrawingUpload
        ? null
        : await extractECOSWebDocument({ file, bytes, candidateAreaNames });
      const contents = extraction?.extractedText || null;
      const fingerprint = await fingerprintBytes(bytes);
      const replacement = documents.find(document => document.id === replacementId) || null;
      const preparationInput = {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        contents,
        extractedPages: extraction?.extractedPages || [],
        category: uploadCategory,
        projectNames: uploadProjects,
        projects,
        fingerprint,
        versionGroupId:
          replacement?.webVersionGroupId || replacement?.drawingNumber?.trim() || replacement?.id || null,
      };
      const prepared = linkedSource
        ? prepareDAVEWebLinkedDocument({
            ...preparationInput,
            externalSource: linkedSource,
            maximumBytes: GOOGLE_DRIVE_LINK_MAX_BYTES,
          })
        : prepareDAVEWebDocumentUpload(preparationInput);
      const preparedWithIntelligence = {
        ...prepared,
        document: isDrawingUpload
          ? {
              ...prepared.document,
              extractionStatus: 'pending' as const,
              extractionMethod: null,
              extractedText: null,
              extractedPages: [],
              sourcePageCount: null,
              searchablePageCount: 0,
              indexedContentSha256: null,
            }
          : {
              ...prepared.document,
              ...extraction,
              indexedContentSha256: fingerprint,
            },
        reviewMessage: isDrawingUpload
          ? `${prepared.reviewMessage} Vitruvius will prepare and verify every drawing page in the background after upload.`
          : extraction?.extractionStatus === 'complete'
            ? `${prepared.reviewMessage} ${extraction.extractedPages?.length || 0} page${extraction.extractedPages?.length === 1 ? '' : 's'} indexed for ECOS answers and citations.`
            : extraction?.extractionStatus === 'partial'
              ? `${prepared.reviewMessage} Document indexing completed with limitations.`
              : extraction?.extractionStatus === 'not_supported'
                ? `${prepared.reviewMessage} This file type will be stored, but ECOS cannot search it.`
                : `${prepared.reviewMessage} ECOS indexing did not finish; retry indexing before making this document current.`,
      };
      setPreparedUpload(normalizedName(uploadCategory) === 'drawing'
        ? {
            ...preparedWithIntelligence,
            document: {
              ...preparedWithIntelligence.document,
              drawingNumber: drawingNumber.trim() || null,
              drawingRevision: drawingRevision.trim() || null,
              drawingDiscipline: drawingDiscipline.trim() || null,
              drawingStatus,
              drawingIssuedAt: drawingIssuedAt.trim() || null,
            },
          }
        : preparedWithIntelligence);
      setPreparedBytes(bytes);
      setPreparedFile(file);
    } catch (error) {
      setPreparedUpload(null);
      setPreparedBytes(null);
      setPreparedFile(null);
      setNotice({ tone: 'danger', text: error instanceof Error ? error.message : 'The document could not be prepared.' });
    }
  }

  async function chooseGoogleDriveFile() {
    if (driveSelecting || uploading) return;
    setDriveSelecting(true);
    setNotice(null);
    try {
      const picked = await pickGoogleDrivePdf();
      await chooseUploadFile(picked.file, picked.source, picked.bytes);
    } catch (error) {
      if (error instanceof GoogleDriveDocumentError && error.code === 'cancelled') return;
      setPreparedUpload(null);
      setPreparedBytes(null);
      setPreparedFile(null);
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'The Google Drive file could not be selected.',
      });
    } finally {
      setDriveSelecting(false);
    }
  }

  async function uploadPreparedDocument() {
    if (!preparedUpload || !preparedBytes || !preparedFile || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    setNotice(null);
    try {
      if (preparedUpload.document.sourceProvider === 'google_drive') {
        await auth.linkDocument(
          preparedUpload,
          preparedBytes,
          preparedFile,
          fraction => setUploadProgress(Math.round(fraction * 100)),
        );
        setNotice({
          tone: 'good',
          text: 'Google Drive document linked. The original remains in Drive, and Vitruvius saved a protected processing copy so ECOS can finish in the background.',
        });
        setPreparedUpload(null);
        setPreparedBytes(null);
        setPreparedFile(null);
        setUploadOpen(false);
        setReplacementId('');
        return;
      }
      const uploadBytes = await recoverDAVEWebPreparedUploadBytes({
        bytes: preparedBytes,
        file: preparedFile,
        expectedSizeBytes: preparedUpload.document.sizeBytes || preparedFile.size,
      });
      if (uploadBytes !== preparedBytes) setPreparedBytes(uploadBytes);
      await auth.uploadDocument(
        preparedUpload,
        uploadBytes,
        preparedFile,
        fraction => setUploadProgress(Math.round(fraction * 100)),
      );
      setNotice({
        tone: 'good',
        text: preparedUpload.scheduleItems.length > 0
          ? `Document and ${preparedUpload.scheduleItems.length} reviewed schedule task${preparedUpload.scheduleItems.length === 1 ? '' : 's'} uploaded. Use Make Current when this schedule should replace the active version.`
          : normalizedName(preparedUpload.document.category) === 'drawing'
            ? 'Drawing uploaded. Vitruvius is preparing it in the background; it will remain unavailable to Ask ECOS until preparation passes and you make this exact revision current.'
            : 'Document uploaded and classified in the shared project record.',
      });
      setPreparedUpload(null);
      setPreparedBytes(null);
      setPreparedFile(null);
      setUploadOpen(false);
      setReplacementId('');
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function makeCurrent(document: DAVEWebReferenceDocument) {
    if (uploading) return;
    const isSchedule = scheduleDocumentIsScheduleLike(document);
    const readiness = buildECOSDocumentReadiness(document);
    if (isSchedule && document.linkedScheduleItems.length === 0) {
      setNotice({ tone: 'danger', text: 'Review and save the imported schedule tasks before making this schedule current.' });
      return;
    }
    if (!isSchedule && !readiness.canMakeCurrent) {
      setNotice({ tone: 'danger', text: readiness.detail });
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      if (isSchedule) await auth.setCurrentSchedule(document);
      else await auth.setCurrentDocument(document);
      setNotice({
        tone: 'good',
        text: isSchedule
          ? `“${document.name}” is now the current schedule. The prior schedule remains available as history.`
          : `“${document.name}” is now current. Vitruvius will use it only after the hosted index confirms this exact source, project, and revision. Prior revisions remain available as history.`,
      });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
      await auth.refreshSnapshot();
    } finally {
      setUploading(false);
    }
  }

  async function performDocumentReindex(
    document: DAVEWebReferenceDocument,
    driveSession: GoogleDriveDownloadSession | null = null,
    onProgress?: (fraction: number) => void,
    onAnalysisProgress?: (progress: ECOSDocumentAnalysisProgress) => void,
  ) {
    const storagePath = document.storagePath?.trim() || '';
    const linkedFromDrive = document.sourceProvider === 'google_drive' && Boolean(document.externalSource);
    if (!storagePath && !linkedFromDrive) {
      throw new Error('The protected source file is unavailable. Upload the original file again.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let indexJobId: string | null = null;
    try {
      let file: File;
      let bytes: ArrayBuffer;
      let refreshedDriveSource: GoogleDriveLinkedSource | null = null;
      if (document.sourceProvider === 'google_drive' && document.externalSource) {
        const picked = driveSession
          ? await driveSession.download(document.externalSource)
          : await downloadLinkedGoogleDriveDocument(document.externalSource);
        file = picked.file;
        bytes = picked.bytes;
        refreshedDriveSource = picked.source;
      } else {
        const url = await auth.getArtifactUrl('project-documents', storagePath);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`The protected source returned HTTP ${response.status}.`);
        const blob = await response.blob();
        file = new File([blob], document.originalFileName, {
          type: document.mimeType || blob.type || 'application/octet-stream',
        });
        bytes = await blob.arrayBuffer();
      }
      const fingerprint = await fingerprintBytes(bytes);
      const drawingIndexJob = normalizedName(document.category) === 'drawing'
        ? await auth.beginOrResumeDocumentIndexJob({
            documentId: document.id,
            sourceSha256: fingerprint,
            sourcePageCount: Math.max(1, document.sourcePageCount || document.extractedPages?.length || 1),
          })
        : null;
      indexJobId = drawingIndexJob?.id || null;
      const projectNames = [document.projectName || '', ...(document.projectNames || [])]
        .map(normalizedName)
        .filter(Boolean);
      const candidateAreaNames = uniqueOptions(tasks
        .filter(task => projectNames.includes(normalizedName(task.scheduleProjectName || task.projectName)))
        .map(task => task.locationName));
      const extraction = await extractECOSWebDocument({
        file,
        bytes,
        candidateAreaNames,
        onProgress,
        onAnalysisProgress,
        resumePages: drawingIndexJob?.completedPages || [],
        onPageExtracted: drawingIndexJob
          ? page => auth.checkpointDocumentIndexPage({ jobId: drawingIndexJob.id, page })
          : undefined,
        analyzeDrawingPage: normalizedName(document.category) === 'drawing'
          ? input => auth.analyzeDrawingPage({
              ...input,
              documentName: document.name || file.name,
              discipline: document.drawingDiscipline?.trim() || null,
            })
          : undefined,
      });
      if (extraction.extractionStatus !== 'complete' && extraction.extractionStatus !== 'partial') {
        throw new Error(extraction.extractionLimitations?.[0] || 'ECOS could not create a searchable index from this file.');
      }
      const drawingVisualCoverageComplete = !drawingIndexJob || (
        (extraction.extractedPages?.length || 0) >= Math.max(1, extraction.sourcePageCount || 0) &&
        (extraction.extractedPages ?? []).every(hasCompleteECOSDrawingVisualCoverage)
      );
      if (drawingIndexJob) {
        if (!drawingVisualCoverageComplete) {
          throw new Error(
            extraction.extractionLimitations?.find(message => message.includes('visual coverage remains incomplete')) ||
            'One or more drawing pages still require high-resolution visual analysis.',
          );
        }
        await auth.setDocumentIndexJobStatus({ jobId: drawingIndexJob.id, status: 'ready' });
        // Save only compact source/readiness metadata before the transactional
        // commit. The verified page checkpoints stay in dedicated tables, so
        // a large drawing never has to cross the network as one record.
        await auth.updateDocument({
          ...document,
          ...(refreshedDriveSource ? { externalSource: refreshedDriveSource } : {}),
          ...extraction,
          extractedText: null,
          extractedPages: [],
          extractionStatus: 'pending',
          searchablePageCount: 0,
          webFileFingerprint: fingerprint,
          indexedContentSha256: fingerprint,
        });
        await auth.commitDocumentIndexJob({
          jobId: drawingIndexJob.id,
          extractionMethod: extraction.extractionMethod,
        });
      } else {
        await auth.updateDocument({
          ...document,
          ...(refreshedDriveSource ? { externalSource: refreshedDriveSource } : {}),
          ...extraction,
          webFileFingerprint: fingerprint,
          indexedContentSha256: fingerprint,
        });
      }
    } catch (error) {
      if (indexJobId) {
        await auth.setDocumentIndexJobStatus({
          jobId: indexJobId,
          status: 'failed',
          failureMessage: error instanceof Error ? error.message : 'The index update did not finish.',
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function reindexDocument(document: DAVEWebReferenceDocument) {
    if (uploading) return;
    setUploading(true);
    setNotice(null);
    setReindexProgress(null);
    try {
      await performDocumentReindex(document);
      setNotice({ tone: 'good', text: `“${document.name}” completed the manual legacy browser re-index fallback.` });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentReindexMessage(error) });
    } finally {
      setUploading(false);
    }
  }

  async function requestHostedDocumentPreparation(requestedPlan: readonly DAVEWebReferenceDocument[] = reindexPlan) {
    if (uploading || requestedPlan.length === 0) return;
    const plan = [...requestedPlan];
    let succeeded = 0;
    let failed = 0;
    let cancelled = false;
    const failures: string[] = [];
    setUploading(true);
    setNotice(null);
    setReindexProgress({
      running: true,
      total: plan.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      currentDocumentName: plan[0]?.name || null,
      currentDocumentProgress: 0,
      currentDocumentStatus: 'Requesting background preparation.',
      failures: [],
    });
    try {
      for (let index = 0; index < plan.length; index += 1) {
        const document = plan[index];
        setReindexProgress({
          running: true,
          total: plan.length,
          processed: index,
          succeeded,
          failed,
          currentDocumentName: document.name,
          currentDocumentProgress: 0,
          currentDocumentStatus: 'Requesting background preparation.',
          failures: [...failures],
        });
        try {
          await auth.enqueueDocumentPreparation(document.id);
          succeeded += 1;
        } catch (error) {
          if (error instanceof ECOSDocumentExtractionCancelledError) {
            cancelled = true;
            break;
          }
          failed += 1;
          failures.push(`${document.name}: ${documentReindexMessage(error)}`);
        }
        setReindexProgress({
          running: true,
          total: plan.length,
          processed: index + 1,
          succeeded,
          failed,
          currentDocumentName: plan[index + 1]?.name || null,
          currentDocumentProgress: 0,
          currentDocumentStatus: plan[index + 1] ? 'Requesting background preparation.' : null,
          failures: [...failures],
        });
      }
      if (!cancelled) {
        setNotice(failed === 0
          ? { tone: 'good', text: `Background preparation was requested for ${succeeded} project document${succeeded === 1 ? '' : 's'}. You can leave this page.` }
          : {
              tone: 'danger',
              text: 'Some documents are temporarily unavailable. Completed work was saved, and Vitruvius will continue unfinished preparation automatically.',
            });
      }
    } catch (error) {
      setNotice({ tone: 'danger', text: documentReindexMessage(error) });
    } finally {
      setReindexProgress(current => current ? {
        ...current,
        running: false,
        processed: succeeded + failed,
        succeeded,
        failed,
        currentDocumentName: null,
        currentDocumentProgress: 1,
        currentDocumentStatus: null,
        failures: [...failures],
      } : null);
      setUploading(false);
    }
  }

  async function saveDocumentDetails(
    document: DAVEWebReferenceDocument,
    next: Partial<ReferenceDocument>,
  ) {
    if (uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      await auth.updateDocument({ ...document, ...next } as DAVEWebReferenceDocument);
      setNotice({
        tone: 'good',
        text: document.isCurrent
          ? `“${document.name}” document details were updated. The current ECOS source now uses the revised information.`
          : `“${document.name}” document details were updated. Review ECOS readiness before making it current.`,
      });
    } catch (error) {
      setNotice({ tone: 'danger', text: documentMutationMessage(error) });
      await auth.refreshSnapshot();
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete(deleteLinkedTasks: boolean) {
    if (!deleteCandidate || protectedCurrentDocument || deleting) return;
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
          : deleteCandidate.sourceProvider === 'google_drive'
            ? 'Document removed from Vitruvius and protected from returning on another device. The original Google Drive file was not deleted.'
            : 'Document and its managed ECOS index were deleted and protected from returning on another device.',
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
      <DesktopDocumentOnboarding
        documents={documents}
        uploadOpen={uploadOpen}
        preparationPendingCount={reindexPlan.length}
        progress={reindexProgress ? {
          running: reindexProgress.running,
          total: reindexProgress.total,
          processed: reindexProgress.processed,
          failed: reindexProgress.failed,
          currentDocumentName: reindexProgress.currentDocumentName,
          currentDocumentProgress: reindexProgress.currentDocumentProgress,
        } : null}
        disabled={uploading}
        onAddDocuments={() => setUploadOpen(true)}
        onCloseAddDocuments={() => setUploadOpen(false)}
        onReviewExceptions={() => {
          const exception = documents.find(document => {
            const status = resolveECOSCustomerDocumentStatus(document);
            return status === 'Needs Review' || status === 'Reconnect Files';
          });
          if (exception) setSelectedDocumentId(exception.id);
        }}
        onContinuePreparation={() => { void requestHostedDocumentPreparation(); }}
      />

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
              setPreparedFile(null);
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
                      setPreparedFile(null);
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
          {normalizedName(uploadCategory) === 'drawing' ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Drawing control</Text>
              <Text style={styles.sectionDetail}>Record the sheet identity and issue status so the field team can distinguish the current revision.</Text>
              <View style={styles.twoColumnFields}>
                <LabeledTextField label="Drawing number" value={drawingNumber} onChangeText={setDrawingNumber} placeholder="A2.01" />
                <LabeledTextField label="Revision" value={drawingRevision} onChangeText={setDrawingRevision} placeholder="3" />
                <LabeledTextField label="Discipline" value={drawingDiscipline} onChangeText={setDrawingDiscipline} placeholder="Architectural" />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Issue status</Text>
                <OptionButtons<NonNullable<ReferenceDocument['drawingStatus']>>
                  options={['Draft', 'For Review', 'For Construction', 'As-Built', 'Superseded']}
                  value={drawingStatus}
                  onChange={setDrawingStatus}
                />
              </View>
              <LabeledTextField label="Issue date" value={drawingIssuedAt} onChangeText={setDrawingIssuedAt} placeholder="YYYY-MM-DD" />
            </View>
          ) : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>File source</Text>
            <Text style={styles.sectionDetail}>Choose one source. Google Drive keeps the original PDF in Drive; Vitruvius saves a protected processing copy so ECOS can continue after you leave this page.</Text>
            <View style={styles.optionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  (!driveConfiguration.configured || driveSelecting || uploading || normalizedName(uploadCategory) === 'schedules') && styles.buttonDisabled,
                ]}
                onPress={() => { void chooseGoogleDriveFile(); }}
                disabled={!driveConfiguration.configured || driveSelecting || uploading || normalizedName(uploadCategory) === 'schedules'}
                accessibilityRole="button"
                accessibilityLabel="Choose a PDF from Google Drive"
              >
                <View style={styles.buttonLabelRow}>
                  {driveSelecting ? <ActivityIndicator color={desktopSurfaces.accent} /> : <Ionicons name="logo-google" size={18} color={desktopSurfaces.accent} />}
                  <Text style={styles.secondaryButtonText}>{driveSelecting ? 'Connecting to Drive…' : 'Link from Google Drive'}</Text>
                </View>
              </Pressable>
            </View>
            {!driveConfiguration.configured ? (
              <Text style={styles.errorText}>Google Drive is temporarily unavailable. Upload a copy from this computer, or contact Vitruvius Support.</Text>
            ) : normalizedName(uploadCategory) === 'schedules' ? (
              <Text style={styles.dataMeta}>Schedule imports continue to use protected upload so their task review and rollback controls remain intact.</Text>
            ) : null}
            <Text style={styles.fieldLabel}>Or upload a copy to Vitruvius</Text>
            <WebFilePicker
              label="Choose file from this computer"
              accept=".pdf,.csv,.tsv,.txt,.json,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
              onFile={file => { void chooseUploadFile(file); }}
            />
          </View>
          {preparedUpload ? (
            <View style={styles.uploadReview}>
              <Text style={styles.cardTitle}>{preparedFromDrive ? 'Review before linking' : 'Review before upload'}</Text>
              <Text style={styles.dataDetail}>{preparedUpload.document.originalFileName} · {preparedUpload.document.category} · {formatFileSize(preparedUpload.document.sizeBytes || 0)}</Text>
              {preparedFromDrive ? <Text style={styles.dataMeta}>Source: Google Drive · Original file stays in Drive</Text> : null}
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
                {uploading ? (
                  <View style={styles.buttonLabelRow}>
                    <ActivityIndicator color={desktopSurfaces.onAccent} />
                    <Text style={styles.primaryButtonText}>
                      {preparedFromDrive ? 'Linking document…' : `Uploading ${uploadProgress ?? 0}%`}
                    </Text>
                  </View>
                ) : <Text style={styles.primaryButtonText}>{preparedFromDrive ? 'Link Reviewed Document' : 'Upload Reviewed Document'}</Text>}
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
            {protectedCurrentDocument ? (
              <Text style={styles.errorText}>This is the current project schedule and is protected. Make a replacement schedule current before deleting this version.</Text>
            ) : (
              <Text style={styles.dataMeta}>
                {currentEvidenceDocument
                  ? 'This document is currently used by ECOS. Deleting it removes its searchable index and citations immediately. '
                  : ''}
                A permanent cloud deletion marker prevents this document from returning on another signed-in device.
                {deleteCandidate.sourceProvider === 'google_drive'
                  ? ' The original Google Drive file will not be deleted.'
                  : ' Its Vitruvius-managed file and ECOS index will be queued for cleanup.'}
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
              <Text style={styles.secondaryButtonText}>{protectedCurrentDocument ? 'Keep Current Document' : 'Cancel'}</Text>
            </Pressable>
            {!protectedCurrentDocument ? (
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
            {!protectedCurrentDocument && deleteCandidate.linkedScheduleItems.length > 0 && linkedTasksAreRevisionSafe ? (
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
              { value: 'current', label: 'Current documents' },
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
        <View style={[
          styles.taskListPane,
          !compactWorkspace && styles.documentListPaneIndependent,
          !compactWorkspace && { maxHeight: documentPaneHeight },
        ]}>
          <View style={styles.documentGroups}>
            <DocumentGroup
              title="Current schedule"
              detail="The schedule currently used for project planning. It is protected from deletion."
              documents={visibleGroups.currentSchedule}
              emptyText="No current schedule matches this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={selectDocument}
            />
            <DocumentGroup
              title={`Prior schedule versions (${visibleGroups.priorScheduleVersions.length})`}
              detail="Earlier schedule imports kept for project history."
              documents={visibleGroups.priorScheduleVersions}
              emptyText="No prior schedule versions match this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={selectDocument}
              onDelete={openDeleteCandidate}
              onMakeCurrent={document => { void makeCurrent(document); }}
            />
            <DocumentGroup
              title={`Other project documents (${visibleGroups.otherDocuments.length})`}
              detail="Permits, drawings, contracts, and other project records."
              documents={visibleGroups.otherDocuments}
              emptyText="No other documents match this view."
              selectedDocumentId={selectedDocumentId}
              onSelect={selectDocument}
              onDelete={openDeleteCandidate}
              onMakeCurrent={document => { void makeCurrent(document); }}
            />
          </View>
        </View>
        <View style={[
          styles.taskInspectorPane,
          compactWorkspace && styles.taskInspectorPaneCompact,
          !compactWorkspace && styles.documentInspectorPaneIndependent,
          !compactWorkspace && { maxHeight: documentPaneHeight },
        ]}>
          {selectedDocument ? (
            <DocumentDetailsPanel
              document={selectedDocument}
              projects={projects}
              projectIdentities={projectIdentities}
              proofFocus={proofFocus?.documentId === selectedDocument.id ? proofFocus : null}
              onClose={closeSelectedDocument}
              onDelete={
                daveWebDocumentDeletionIsProtected(selectedDocument)
                  ? undefined
                  : openDeleteCandidate
              }
              onMakeCurrent={
                !selectedDocument.isCurrent
                  ? document => { void makeCurrent(document); }
                  : undefined
              }
              onReindex={document => { void reindexDocument(document); }}
              onSaveDetails={(document, next) => { void saveDocumentDetails(document, next); }}
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
  const progressive = useProgressiveListLimit(
    documents.length,
    `${documents.length}:${documents[0]?.id || ''}:${documents[documents.length - 1]?.id || ''}`,
  );
  if (documents.length === 0) return <EmptyState text={emptyText} />;
  return (
    <View style={styles.list}>
      {documents.slice(0, progressive.limit).map(document => (
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
                  tone={document.isCurrent ? 'good' : 'neutral'}
                />
                <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
              </View>
            </View>
          </Pressable>
          {onDelete ? (
            <View style={styles.taskCardActions}>
              {onMakeCurrent ? (
                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed, !documentCanBeMadeCurrent(document) && styles.buttonDisabled]}
                  onPress={() => onMakeCurrent(document)}
                  disabled={!documentCanBeMadeCurrent(document)}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>{documentMakeCurrentLabel(document)}</Text>
                </Pressable>
              ) : null}
              <Pressable style={({ pressed }) => [styles.taskDetailsButton, pressed && styles.buttonPressed]} onPress={() => onSelect(document)}>
                <Text style={styles.taskDetailsButtonText}>View details</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteTextButton, pressed && styles.buttonPressed]}
                onPress={() => onDelete(document)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${document.name}`}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {progressive.showMore ? <ProgressiveListFooter remaining={documents.length - progressive.limit} onShowMore={progressive.showMore} /> : null}
    </View>
  );
}

function DocumentDetailsPanel({
  document,
  projects,
  projectIdentities,
  proofFocus,
  onClose,
  onDelete,
  onMakeCurrent,
  onReindex,
  onSaveDetails,
  pending,
}: {
  document: DAVEWebReferenceDocument;
  projects: readonly string[];
  projectIdentities: readonly ECOSProjectIdentity[];
  proofFocus: ECOSDesktopDocumentProofFocus | null;
  onClose: () => void;
  onDelete?: (document: DAVEWebReferenceDocument) => void;
  onMakeCurrent?: (document: DAVEWebReferenceDocument) => void;
  onReindex?: (document: DAVEWebReferenceDocument) => void;
  onSaveDetails?: (document: DAVEWebReferenceDocument, next: Partial<ReferenceDocument>) => void;
  pending: boolean;
}) {
  const auth = useDesktopAuth();
  const isSchedule = scheduleDocumentIsScheduleLike(document);
  const isDrawing = normalizedName(document.category) === 'drawing';
  const hasLocalPageDetails = (document.extractedPages ?? []).length > 0;
  const [coverageSummaryState, setCoverageSummaryState] = useState<DocumentCoverageSummaryState>({
    documentId: document.id,
    status: isDrawing && !hasLocalPageDetails ? 'loading' : 'idle',
    summary: null,
  });

  useEffect(() => {
    if (!isDrawing || hasLocalPageDetails) {
      setCoverageSummaryState({ documentId: document.id, status: 'idle', summary: null });
      return;
    }
    let active = true;
    setCoverageSummaryState({ documentId: document.id, status: 'loading', summary: null });
    void auth.loadDocumentCoverageSummary(document.id, document.cloudUpdatedAt || document.indexedAt || null)
      .then(summary => {
        if (!active) return;
        setCoverageSummaryState({ documentId: document.id, status: 'ready', summary });
      })
      .catch(() => {
        if (!active) return;
        setCoverageSummaryState({ documentId: document.id, status: 'failed', summary: null });
      });
    return () => {
      active = false;
    };
  }, [
    auth.loadDocumentCoverageSummary,
    document.cloudUpdatedAt,
    document.id,
    document.indexedAt,
    hasLocalPageDetails,
    isDrawing,
  ]);

  const activeCoverageState = coverageSummaryState.documentId === document.id
    ? coverageSummaryState
    : { documentId: document.id, status: 'loading' as const, summary: null };
  const cloudSummary = activeCoverageState.status === 'ready'
    ? activeCoverageState.summary
    : null;
  const deletionProtected = daveWebDocumentDeletionIsProtected(document);
  const readiness = buildECOSDocumentReadiness(document, cloudSummary);
  const coverageMetricStatus = hasLocalPageDetails ? 'ready' : activeCoverageState.status;
  const visualCoverageValue = documentCoverageFactValue({
    status: coverageMetricStatus,
    count: readiness.fullVisualCoveragePageCount,
    total: readiness.indexedPageCount,
  });
  const verifiedSheetMappingValue = documentCoverageFactValue({
    status: coverageMetricStatus,
    count: readiness.verifiedSheetPageCount,
    total: readiness.indexedPageCount,
  });
  const sheetMappingConflictValue = documentCoverageConflictValue({
    status: coverageMetricStatus,
    count: readiness.conflictedSheetPageCount,
    total: readiness.indexedPageCount,
  });
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
          tone={document.isCurrent ? 'good' : 'neutral'}
        />
        <StatusBadge label={document.category} tone="neutral" />
      </View>
      <DesktopDocumentProofPreview
        document={document}
        focus={proofFocus}
        projectIdentities={projectIdentities}
        getArtifactUrl={auth.getArtifactUrl}
      />
      <View style={styles.taskDetailsFacts}>
        <TaskDetailFact label="Projects" value={projectLabel} />
        <TaskDetailFact label="Source" value={document.sourceProvider === 'google_drive' ? 'Google Drive' : 'Protected Vitruvius storage'} />
        <TaskDetailFact label="Imported" value={formatDateTime(document.importedAt)} />
        <TaskDetailFact label="Linked Tasks" value={String(document.linkedScheduleItems.length)} />
        <TaskDetailFact label="File Size" value={sizeLabel} />
        <TaskDetailFact
          label="ECOS Index"
          value={document.ecosHostedIndexStatus === 'Preparing'
            ? `Preparing · ${Math.max(0, Math.min(100, Math.round(document.ecosHostedIndexProgressPercent || 0)))}%`
            : document.ecosHostedIndexStatus || readiness.label}
        />
        <TaskDetailFact
          label="Searchable Pages"
          value={`${readiness.searchablePageCount} of ${readiness.sourcePageCount || readiness.indexedPageCount} · ${readiness.pageCoveragePercent}%`}
        />
        {normalizedName(document.category) === 'drawing' ? (
          <>
            <TaskDetailFact
              label="High-Resolution Visual Coverage"
              value={visualCoverageValue}
            />
            <TaskDetailFact
              label="Drawing Analysis"
              value={document.documentVisualIndexVersion === 'ecos-visual-index/3.0'
                ? 'Current'
                : 'Update required'}
            />
            <TaskDetailFact
              label="Verified Sheet Mapping"
              value={verifiedSheetMappingValue}
            />
            <TaskDetailFact
              label="Sheet Mapping Conflicts"
              value={sheetMappingConflictValue}
            />
          </>
        ) : null}
        <TaskDetailFact
          label="Index Confidence"
          value={readiness.averageConfidence == null ? 'Not available' : `${Math.round(readiness.averageConfidence * 100)}%`}
        />
        <TaskDetailFact
          label="Extraction"
          value={document.extractionMethod?.replaceAll('_', ' ') || 'Not available'}
        />
        {document.sourceProvider === 'google_drive' && document.externalSource ? (
          <>
            <TaskDetailFact label="Drive Revision" value={document.externalSource.revisionId || 'Not reported'} />
            <TaskDetailFact label="Drive Modified" value={document.externalSource.modifiedTime ? formatDateTime(document.externalSource.modifiedTime) : 'Not reported'} />
          </>
        ) : null}
        {normalizedName(document.category) === 'drawing' ? (
          <>
            <TaskDetailFact label="Drawing Number" value={document.drawingNumber || 'Not recorded'} />
            <TaskDetailFact label="Revision" value={document.drawingRevision || 'Not recorded'} />
            <TaskDetailFact label="Discipline" value={document.drawingDiscipline || 'Not recorded'} />
            <TaskDetailFact label="Issue Status" value={document.drawingStatus || 'Not recorded'} />
            <TaskDetailFact label="Issue Date" value={document.drawingIssuedAt || 'Not recorded'} />
          </>
        ) : null}
      </View>
      {document.notes ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>Document note</Text>
          <Text style={styles.taskDetailsSectionText}>{document.notes}</Text>
        </View>
      ) : null}
      {document.webContentReview ? (
        <View style={styles.taskDetailsSection}>
          <Text style={styles.taskDetailsSectionTitle}>{document.sourceProvider === 'google_drive' ? 'Link review' : 'Upload review'}</Text>
          <Text style={styles.taskDetailsSectionText}>{document.webContentReview}</Text>
        </View>
      ) : null}
      <View style={styles.taskDetailsSection}>
        <Text style={styles.taskDetailsSectionTitle}>ECOS readiness</Text>
        <Text style={styles.taskDetailsSectionText}>{readiness.detail}</Text>
        {readiness.missingMetadata.map(item => (
          <Text key={item} style={styles.taskDetailsSectionText}>• Missing {item}</Text>
        ))}
        {readiness.limitations.map(item => (
          <Text key={item} style={styles.taskDetailsSectionText}>• {item}</Text>
        ))}
      </View>
      {(!document.isCurrent || !isSchedule) && onSaveDetails ? (
        <DocumentECOSDetailsEditor
          document={document}
          projects={projects}
          pending={pending}
          onSave={next => onSaveDetails(document, next)}
        />
      ) : null}
      <View style={styles.taskDetailsSection}>
        <Text style={styles.taskDetailsSectionTitle}>File actions</Text>
        <DocumentArtifactActions document={document} />
      </View>
      <View style={styles.taskInspectorActions}>
        {onReindex ? (
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              pending && styles.buttonDisabled,
            ]}
            onPress={() => onReindex(document)}
            disabled={pending}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Legacy browser re-index (manual fallback)</Text>
          </Pressable>
        ) : null}
        {onMakeCurrent ? (
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              styles.taskInspectorEditButton,
              pressed && styles.buttonPressed,
              (pending || !documentCanBeMadeCurrent(document)) && styles.buttonDisabled,
            ]}
            onPress={() => onMakeCurrent(document)}
            disabled={pending || !documentCanBeMadeCurrent(document)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {documentMakeCurrentLabel(document)}
            </Text>
          </Pressable>
        ) : null}
        {deletionProtected ? (
          <View style={styles.documentProtectedNotice}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.success} />
            <Text style={styles.documentProtectedText}>
              Current schedule · protected from deletion
            </Text>
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

function documentCoverageFactValue({
  status,
  count,
  total,
}: {
  status: DocumentCoverageSummaryState['status'];
  count: number;
  total: number;
}) {
  if (status === 'loading') return 'Loading page analysis…';
  if (status === 'failed') return 'Temporarily unavailable';
  if (total <= 0) return 'Index summary missing — re-index required';
  return `${count} of ${total} pages`;
}

function documentCoverageConflictValue({
  status,
  count,
  total,
}: {
  status: DocumentCoverageSummaryState['status'];
  count: number;
  total: number;
}) {
  if (status === 'loading') return 'Loading page analysis…';
  if (status === 'failed') return 'Temporarily unavailable';
  if (total <= 0) return 'Index summary missing — re-index required';
  return String(count);
}

function DocumentECOSDetailsEditor({
  document,
  projects,
  pending,
  onSave,
}: {
  document: DAVEWebReferenceDocument;
  projects: readonly string[];
  pending: boolean;
  onSave: (next: Partial<ReferenceDocument>) => void;
}) {
  const initialProjects = [document.projectName || '', ...(document.projectNames || [])]
    .map(value => value.trim())
    .filter(Boolean);
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(document.category);
  const [selectedProjects, setSelectedProjects] = useState<string[]>(initialProjects);
  const [number, setNumber] = useState(document.drawingNumber || '');
  const [revision, setRevision] = useState(document.drawingRevision || '');
  const [discipline, setDiscipline] = useState(document.drawingDiscipline || '');
  const [issueStatus, setIssueStatus] = useState<NonNullable<ReferenceDocument['drawingStatus']>>(
    document.drawingStatus || 'For Review',
  );
  const [issueDate, setIssueDate] = useState(document.drawingIssuedAt || '');

  useEffect(() => {
    setEditing(false);
    setCategory(document.category);
    setSelectedProjects([document.projectName || '', ...(document.projectNames || [])]
      .map(value => value.trim())
      .filter(Boolean));
    setNumber(document.drawingNumber || '');
    setRevision(document.drawingRevision || '');
    setDiscipline(document.drawingDiscipline || '');
    setIssueStatus(document.drawingStatus || 'For Review');
    setIssueDate(document.drawingIssuedAt || '');
  }, [document.cloudUpdatedAt, document.id]);

  if (!editing) {
    return (
      <Pressable
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
        onPress={() => setEditing(true)}
        accessibilityRole="button"
        accessibilityLabel={`Edit project document details for ${document.name}`}
      >
        <Text style={styles.secondaryButtonText}>Edit Project Document Details</Text>
      </Pressable>
    );
  }

  const drawing = normalizedName(category) === 'drawing';
  const canSave = selectedProjects.length > 0 && (!drawing || (
    Boolean(number.trim()) && Boolean(revision.trim()) && Boolean(issueStatus)
  ));
  return (
    <View style={styles.editorCard}>
      <Text style={styles.taskDetailsSectionTitle}>ECOS document details</Text>
      <Text style={styles.sectionDetail}>These fields control project scope, revision authority, and whether ECOS may use this source.</Text>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Category</Text>
        <OptionButtons<string>
          options={DAVE_WEB_DOCUMENT_CATEGORIES}
          value={category}
          onChange={setCategory}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Projects</Text>
        <View style={styles.optionRow}>
          {projects.map(project => {
            const selected = selectedProjects.some(value => normalizedName(value) === normalizedName(project));
            return (
              <Pressable
                key={project}
                style={({ pressed }) => [styles.smallChoice, selected && styles.choiceActive, pressed && styles.buttonPressed]}
                onPress={() => setSelectedProjects(current => selected
                  ? current.filter(value => normalizedName(value) !== normalizedName(project))
                  : [...current, project])}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
              >
                <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{selected ? '✓ ' : ''}{project}</Text>
              </Pressable>
            );
          })}
        </View>
        {selectedProjects.length === 0 ? <Text style={styles.errorText}>Choose at least one project.</Text> : null}
      </View>
      {drawing ? (
        <View style={styles.fieldGroup}>
          <LabeledTextField label="Drawing number" value={number} onChangeText={setNumber} placeholder="A2.01" />
          <LabeledTextField label="Revision" value={revision} onChangeText={setRevision} placeholder="3" />
          <LabeledTextField label="Discipline" value={discipline} onChangeText={setDiscipline} placeholder="Architectural" />
          <Text style={styles.fieldLabel}>Issue status</Text>
          <OptionButtons<NonNullable<ReferenceDocument['drawingStatus']>>
            options={['Draft', 'For Review', 'For Construction', 'As-Built', 'Superseded']}
            value={issueStatus}
            onChange={setIssueStatus}
          />
          <LabeledTextField label="Issue date" value={issueDate} onChangeText={setIssueDate} placeholder="YYYY-MM-DD" />
        </View>
      ) : null}
      <View style={styles.inlineButtons}>
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={() => setEditing(false)}
          disabled={pending}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed, (!canSave || pending) && styles.buttonDisabled]}
          onPress={() => onSave({
            category,
            projectName: selectedProjects[0] || null,
            projectNames: selectedProjects,
            drawingNumber: drawing ? number.trim() || null : null,
            drawingRevision: drawing ? revision.trim() || null : null,
            drawingDiscipline: drawing ? discipline.trim() || null : null,
            drawingStatus: drawing ? issueStatus : null,
            drawingIssuedAt: drawing ? issueDate.trim() || null : null,
          })}
          disabled={!canSave || pending}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{pending ? 'Saving…' : 'Save Document Details'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DocumentArtifactActions({ document }: { document: DAVEWebReferenceDocument }) {
  const auth = useDesktopAuth();
  const [pendingAction, setPendingAction] = useState<'open' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storagePath = document.storagePath?.trim() || '';
  const driveSource = document.sourceProvider === 'google_drive' ? document.externalSource : null;

  const access = async (action: 'open' | 'download') => {
    if ((!storagePath && !driveSource) || pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      if (driveSource) {
        if (action === 'open' && driveSource.webViewLink) {
          openSignedArtifact(driveSource.webViewLink, null);
        } else {
          const picked = await downloadLinkedGoogleDriveDocument(driveSource);
          const objectUrl = URL.createObjectURL(new Blob([picked.bytes], { type: picked.source.mimeType }));
          openSignedArtifact(objectUrl, document.originalFileName || document.name);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }
      } else {
        const url = await auth.getArtifactUrl('project-documents', storagePath);
        openSignedArtifact(url, action === 'download' ? document.originalFileName || document.name : null);
      }
    } catch (error) {
      setError(error instanceof Error
        ? error.message
        : 'The document is temporarily unavailable. Refresh and try again.');
    } finally {
      setPendingAction(null);
    }
  };

  if (!storagePath && !driveSource) {
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
          <Text style={styles.secondaryButtonText}>{pendingAction === 'open' ? 'Opening…' : driveSource ? 'Open in Drive' : 'Open'}</Text>
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
  const [reportAudience, setReportAudience] = useState<DAVEWebReportAudience>('project_manager');
  const generatedTitle = useMemo(
    () => buildDAVEWebReportTitle(briefing, reportAudience),
    [briefing, reportAudience],
  );
  const generatedBody = useMemo(
    () => formatDAVEWebReport(briefing, reportAudience),
    [briefing, reportAudience],
  );
  const currentReportSource = useMemo(
    () => buildDAVEWebReportSource(snapshot, selectedProject),
    [selectedProject, snapshot],
  );
  const reportDocuments = documents.filter(document => reportRecordFromDocument(document));
  const [reportId, setReportId] = useState(() => createDAVEWebId('web-report'));
  const [reportTitle, setReportTitle] = useState(generatedTitle);
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
  const selectedProjectNames = useMemo(
    () => selectedProject
      ? scheduleProjectScopeNames(selectedProject, [...snapshot.scheduleItems])
      : snapshot.projects.map(project => project.name),
    [selectedProject, snapshot.projects, snapshot.scheduleItems],
  );

  const downloadWordReport = async ({
    title,
    body,
    generatedAt,
    updateIds,
  }: {
    title: string;
    body: string;
    generatedAt: string;
    updateIds: readonly string[];
  }) => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const sourceIds = new Set(updateIds);
      const sourceUpdates = snapshot.projectUpdates
        .filter(update => sourceIds.has(update.id) || sourceIds.has(update.updateData.id))
        .map(update => update.updateData);
      const reportPhotoIds = uniqueStrings(
        sourceUpdates.flatMap(update => update.photos.map(photo => photo.id)),
      );
      const drawingReferences = buildAutomaticReportDrawingReferences({
        documents: [...snapshot.referenceDocuments],
        scheduleItems: [...snapshot.scheduleItems],
        selectedProjectNames,
      });
      const resolvedMedia = await resolveWebReportWordMedia({
        updates: sourceUpdates,
        reportPhotoIds,
        drawingReferences,
        getArtifactUrl: auth.getArtifactUrl,
      });
      const {
        buildReportWordBlob,
        summarizeReportWordUnavailableMedia,
      } = await import('../../services/ReportWordDocument');
      const blob = await buildReportWordBlob({
        title,
        body,
        generatedAt,
        media: resolvedMedia.media,
        unavailableMedia: resolvedMedia.unavailableMedia,
      });
      downloadBlob(`${safeDownloadName(title)}.docx`, blob);
      const embeddedPhotos = resolvedMedia.media.filter(item => item.kind === 'photo').length;
      const embeddedDrawings = resolvedMedia.media.filter(item => item.kind === 'drawing').length;
      const embedded = embeddedPhotos + embeddedDrawings;
      const unavailable = resolvedMedia.unavailableMedia.length;
      const unavailableSummary =
        summarizeReportWordUnavailableMedia(resolvedMedia.unavailableMedia);
      const unavailableDetail = unavailable === 1
        ? ` ${resolvedMedia.unavailableMedia[0].label}: ${resolvedMedia.unavailableMedia[0].reason}`
        : '';
      setNotice({
        tone: unavailable ? 'danger' : 'good',
        text: unavailable
          ? `Word report downloaded with ${embedded} embedded source image${embedded === 1 ? '' : 's'}. ${unavailableSummary}${unavailableDetail} Each unavailable source image is listed in Media Requiring Review.`
          : `Word report downloaded with ${embeddedPhotos} embedded project photo${embeddedPhotos === 1 ? '' : 's'} and ${embeddedDrawings} current drawing excerpt${embeddedDrawings === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error && error.message.trim()
          ? `The Word report could not be prepared: ${error.message.trim()}`
          : 'The Word report could not be prepared from the current project files.',
      });
    } finally {
      setPending(false);
    }
  };

  const resetFromCurrentTruth = () => {
    setReportId(createDAVEWebId('web-report'));
    setReportTitle(generatedTitle);
    setReportBody(generatedBody);
    setReportGeneratedAt(briefing.generatedAt);
    setExpectedRevision(null);
    setAudit([]);
    setReportSource(currentReportSource);
    setReportStatus('draft');
    setNotice({ tone: 'good', text: 'A fresh draft was generated from the latest reconciled project record.' });
  };

  const applyReportAudience = (audience: DAVEWebReportAudience) => {
    if (audience === reportAudience) return;
    const nextTitle = buildDAVEWebReportTitle(briefing, audience);
    const nextBody = formatDAVEWebReport(briefing, audience);
    setReportAudience(audience);
    setReportId(createDAVEWebId('web-report'));
    setReportTitle(nextTitle);
    setReportBody(nextBody);
    setReportGeneratedAt(briefing.generatedAt);
    setExpectedRevision(null);
    setAudit([]);
    setReportSource(currentReportSource);
    setReportStatus('draft');
    setEditingReportBody(false);
    setNotice({
      tone: 'good',
      text: audience === 'executive'
        ? 'An executive summary was generated from the current project facts.'
        : 'A detailed project manager report was generated from the current project facts.',
    });
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
      audience: reportAudience,
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
    const savedAudience: DAVEWebReportAudience = report.audience
      || (report.title.toLowerCase().includes('executive') ? 'executive' : 'project_manager');
    setReportAudience(savedAudience);
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
            <View style={styles.reportAudienceField}>
              <View>
                <Text style={styles.cardTitle}>Report audience</Text>
                <Text style={styles.dataMeta}>Choose the level of detail before reviewing or downloading the report.</Text>
              </View>
              <View style={styles.reportAudienceChoices}>
                <Pressable
                  style={({ pressed }) => [
                    styles.reportAudienceChoice,
                    reportAudience === 'project_manager' && styles.reportAudienceChoiceActive,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => applyReportAudience('project_manager')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reportAudience === 'project_manager' }}
                  accessibilityLabel="Project Manager report"
                >
                  <Text style={[
                    styles.reportAudienceChoiceTitle,
                    reportAudience === 'project_manager' && styles.reportAudienceChoiceTitleActive,
                  ]}>Project Manager</Text>
                  <Text style={styles.reportAudienceChoiceDetail}>
                    Detailed task status, completed work, schedule position, risks, decisions, and next actions.
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.reportAudienceChoice,
                    reportAudience === 'executive' && styles.reportAudienceChoiceActive,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => applyReportAudience('executive')}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reportAudience === 'executive' }}
                  accessibilityLabel="Executive Summary report"
                >
                  <Text style={[
                    styles.reportAudienceChoiceTitle,
                    reportAudience === 'executive' && styles.reportAudienceChoiceTitleActive,
                  ]}>Executive Summary</Text>
                  <Text style={styles.reportAudienceChoiceDetail}>
                    Concise project condition, completed work, material changes, schedule, risks, and management actions.
                  </Text>
                </Pressable>
              </View>
            </View>
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
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, styles.reportActionButton, pressed && styles.buttonPressed]}
                    onPress={() => {
                      void downloadWordReport({
                        title: reportTitle,
                        body: reportBody,
                        generatedAt: reportGeneratedAt,
                        updateIds: reportSource.updateIds,
                      });
                    }}
                    disabled={pending}
                  >
                    <Text style={styles.secondaryButtonText}>Download Word Report</Text>
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
                    <Text style={styles.dataMeta}>
                      {report.audience === 'executive' ? 'Executive Summary' : 'Project Manager'} · Prepared {formatDateTime(report.generatedAt)} · {report.audit.length} recorded review event{report.audit.length === 1 ? '' : 's'}
                    </Text>
                    <Text style={styles.dataMeta}>Based on {report.sourceTaskIds.length} tasks and {report.sourceUpdateIds.length} field updates</Text>
                  </View>
                  <StatusBadge label={report.status === 'approved' ? 'Approved' : 'Draft'} tone={report.status === 'approved' ? 'good' : 'attention'} />
                </View>
                <View style={styles.taskCardActions}>
                  <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => openReport(document)}>
                    <Text style={styles.secondaryButtonText}>Open</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                    onPress={() => {
                      void downloadWordReport({
                        title: report.title,
                        body: report.body,
                        generatedAt: report.generatedAt,
                        updateIds: report.sourceUpdateIds,
                      });
                    }}
                    disabled={pending}
                  >
                    <Text style={styles.secondaryButtonText}>Download Word Report</Text>
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
  const [driveDisconnectPending, setDriveDisconnectPending] = useState(false);
  const [driveConnectionState, setDriveConnectionState] = useState<
    'connected' | 'disconnected' | 'uncertain'
  >(() => googleDriveSessionIsAuthorized() ? 'connected' : 'disconnected');
  const [driveConnectionNotice, setDriveConnectionNotice] = useState('');

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

  const disconnectDrive = async () => {
    if (driveDisconnectPending) return;
    setDriveDisconnectPending(true);
    setDriveConnectionNotice('');
    const result = await disconnectGoogleDriveSession();
    setDriveConnectionState(result.status === 'local_disconnect' ? 'uncertain' : 'disconnected');
    setDriveConnectionNotice(result.message);
    setDriveDisconnectPending(false);
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
            <Text style={styles.syncGuideText}>Keeps the shared cloud record current through live updates and a periodic safety refresh while Vitruvius is open.</Text>
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

      <Section
        title="Connected document sources"
        detail="Vitruvius uses a temporary, in-memory Google Drive permission only for files you choose. Disconnecting does not delete the files or the project records already created from them."
      >
        <View style={styles.dataCard}>
          <View style={styles.dataHealthHeading}>
            <View style={styles.dataHealthIcon}>
              <Ionicons name="logo-google" size={22} color={desktopSurfaces.accent} />
            </View>
            <View style={styles.dataGrow}>
              <Text style={styles.cardTitle}>Google Drive</Text>
              <Text style={styles.dataDetail}>
                {driveConnectionState === 'connected'
                  ? 'A temporary Google Drive connection is active in this browser tab.'
                  : driveConnectionState === 'uncertain'
                    ? 'This browser no longer holds the Drive credential, but Google did not confirm remote revocation.'
                    : 'No active Google Drive connection is stored in this browser tab.'}
              </Text>
            </View>
            <StatusBadge
              label={driveConnectionState === 'connected' ? 'Connected' : driveConnectionState === 'uncertain' ? 'Review Google account' : 'Disconnected'}
              tone={driveConnectionState === 'connected' ? 'good' : driveConnectionState === 'uncertain' ? 'attention' : 'neutral'}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              styles.syncButton,
              pressed && styles.buttonPressed,
              driveDisconnectPending && styles.buttonDisabled,
            ]}
            onPress={() => { void disconnectDrive(); }}
            disabled={driveDisconnectPending}
            accessibilityRole="button"
            accessibilityLabel="Disconnect Google Drive from Vitruvius"
          >
            <View style={styles.buttonLabelRow}>
              {driveDisconnectPending ? (
                <ActivityIndicator size="small" color={desktopSurfaces.accent} />
              ) : (
                <Ionicons name="unlink-outline" size={18} color={desktopSurfaces.accent} />
              )}
              <Text style={styles.secondaryButtonText}>
                {driveDisconnectPending ? 'Disconnecting…' : 'Disconnect Google Drive'}
              </Text>
            </View>
          </Pressable>
        </View>
        {driveConnectionNotice ? (
          <View
            style={driveConnectionState === 'uncertain' ? styles.errorBanner : styles.successBanner}
            accessibilityRole="alert"
          >
            <Text style={driveConnectionState === 'uncertain' ? styles.errorText : styles.successText}>
              {driveConnectionNotice}
            </Text>
          </View>
        ) : null}
      </Section>

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

function TaskPhotoPicker({
  pending,
  detail,
  onFile,
}: {
  pending: boolean;
  detail: string;
  onFile: (file: File | null) => void;
}) {
  return (
    <View style={styles.taskPhotoPicker}>
      <View style={styles.buttonLabelRow}>
        <Ionicons name="camera-outline" size={20} color={desktopSurfaces.accent} />
        <Text style={styles.taskDetailsSectionTitle}>Add a Photo</Text>
      </View>
      <Text style={styles.dataMeta}>{detail}</Text>
      <WebFilePicker
        label={pending ? 'Uploading photo…' : 'Choose task photo'}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        onFile={onFile}
      />
    </View>
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

function documentReindexMessage(error: unknown): string {
  if (error instanceof GoogleDriveDocumentError) {
    if (error.code === 'cancelled') return 'No source file was selected.';
    if (error.code === 'permission_denied' || error.code === 'not_found') {
      return 'Reconnect this source file so Vitruvius can continue preparing it.';
    }
    if (error.code === 'too_large' || error.code === 'unsupported') return error.message;
    return 'This source file is temporarily unavailable. Vitruvius will retry unfinished preparation.';
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Document preparation is taking longer than expected. Vitruvius saved completed work and will continue automatically.';
  }
  return 'Document preparation is temporarily unavailable. Vitruvius saved completed work and will continue automatically.';
}

function taskPhotoMutationMessage(error: unknown): string {
  if (error instanceof DAVEWebDocumentMutationError) return error.message;
  return 'The task photo could not be saved. Refresh the workspace and try again.';
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

function DesktopSidebar({
  pathname,
  selectedProject,
  documentCount,
}: {
  pathname: string;
  selectedProject: string | null;
  documentCount: number;
}) {
  return (
    <View style={styles.sidebar}>
      <VitruviusBrandLockup large testID="desktop-sidebar-brand-lockup" />
      <View style={styles.navigation} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink
            key={item.href}
            pathname={pathname}
            item={item}
            selectedProject={selectedProject}
            badgeCount={item.page === 'documents' ? documentCount : undefined}
          />
        ))}
      </View>
      <DesktopReleaseLabel />
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
      <VitruviusBrandLockup
        large
        showSubtitle={false}
        testID="desktop-top-brand-lockup"
      />
      <DesktopReleaseLabel compact />
      <View style={styles.topNavigationLinks} role="navigation">
        {desktopNavigationItems.map(item => (
          <DesktopNavigationLink key={item.href} pathname={pathname} item={item} selectedProject={selectedProject} compact />
        ))}
      </View>
    </View>
  );
}

function DesktopReleaseLabel({ compact = false }: { compact?: boolean }) {
  return (
    <View
      style={compact ? styles.topReleaseSummary : styles.sidebarReleaseSummary}
      accessibilityRole="text"
      accessibilityLabel={`${PRODUCT_BRAND.name} version ${PRODUCT_RELEASE.version}, build ${PRODUCT_RELEASE.build}`}
      testID={compact ? 'desktop-top-release' : 'desktop-sidebar-release'}
    >
      <Text style={styles.pilotNote}>{PRODUCT_BRAND.name} · {PRODUCT_BRAND.subtitle}</Text>
      <Text style={styles.releaseNote}>
        Version {PRODUCT_RELEASE.version} · Build {PRODUCT_RELEASE.build}
      </Text>
    </View>
  );
}

function DesktopNavigationLink({
  pathname,
  item,
  selectedProject,
  compact = false,
  badgeCount,
}: {
  pathname: string;
  item: DesktopNavigationItem;
  selectedProject: string | null;
  compact?: boolean;
  badgeCount?: number;
}) {
  const active = desktopRouteIsActive(pathname, item.href);
  const href = selectedProject ? { pathname: item.href, params: { project: selectedProject } } : item.href;
  return (
    <Link href={href} asChild>
      <Pressable
        style={({ pressed }) => [compact ? styles.topNavigationLink : styles.navigationLink, active && styles.navigationLinkActive, pressed && styles.buttonPressed]}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        accessibilityLabel={!compact && badgeCount !== undefined
          ? `${item.label}, ${badgeCount} document${badgeCount === 1 ? '' : 's'}`
          : item.label}
      >
        <View style={compact ? styles.topNavigationIconWrap : styles.navigationIconWrap}>
          <Ionicons
            name={item.icon}
            size={compact ? 19 : 30}
            color={active ? desktopSurfaces.accent : desktopSurfaces.sidebarMuted}
          />
          {!compact && badgeCount !== undefined ? (
            <View style={styles.navigationIconCountBadge}>
              <Text style={styles.navigationIconCountText}>
                {badgeCount > 99 ? '99+' : String(badgeCount)}
              </Text>
            </View>
          ) : null}
        </View>
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
  if (document.isCurrent) return 'current';
  return scheduleDocumentIsScheduleLike(document) ? 'prior' : 'other';
}

function documentStatusLabel(document: DAVEWebReferenceDocument): string {
  if (!scheduleDocumentIsScheduleLike(document)) {
    return buildECOSDocumentReadiness(document).label;
  }
  const kind = documentStatusKind(document);
  if (kind === 'current') return 'Current';
  if (kind === 'prior') return 'Prior version';
  return buildECOSDocumentReadiness(document).label;
}

function documentCanBeMadeCurrent(document: DAVEWebReferenceDocument) {
  return scheduleDocumentIsScheduleLike(document)
    ? document.linkedScheduleItems.length > 0
    : buildECOSDocumentReadiness(document).canMakeCurrent;
}

function documentMakeCurrentLabel(document: DAVEWebReferenceDocument) {
  if (scheduleDocumentIsScheduleLike(document)) {
    return document.linkedScheduleItems.length > 0 ? 'Make Current Schedule' : 'Task Review Required';
  }
  const readiness = buildECOSDocumentReadiness(document);
  if (readiness.status === 'needs_metadata') return 'Complete Document Details';
  if (readiness.status === 'failed' || readiness.status === 'pending' || readiness.status === 'stale') {
    return 'Re-index Required';
  }
  if (readiness.status === 'not_supported') return 'Not Searchable';
  return 'Make Current for ECOS';
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

function downloadBlob(fileName: string, blob: Blob) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
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
  gateCard: { width: '100%', maxWidth: 560, borderRadius: 24, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.card, padding: spacing.xxl, gap: spacing.lg, boxShadow: desktopSurfaces.shadowStrong },
  gateTitle: { color: '#171A21', fontSize: 32, lineHeight: 39, fontWeight: '900' },
  sidebar: { width: 280, minHeight: '100%', backgroundColor: desktopSurfaces.sidebar, borderRightWidth: 1, borderRightColor: desktopSurfaces.sidebarDeep, padding: spacing.lg, gap: spacing.xl, boxShadow: desktopSurfaces.sidebarShadow },
  navigation: { gap: spacing.xs },
  navigationLink: { minHeight: 68, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: spacing.md, justifyContent: 'flex-start', paddingHorizontal: spacing.md },
  topNavigationLink: { flexGrow: 1, flexBasis: 132, minWidth: 0, minHeight: 44, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingHorizontal: spacing.sm },
  navigationLinkActive: { backgroundColor: desktopSurfaces.selected, borderLeftWidth: 4, borderLeftColor: desktopSurfaces.accent },
  navigationLabel: { color: desktopSurfaces.sidebarMuted, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  navigationLabelSidebar: { fontSize: 19, lineHeight: 25, fontWeight: '900' },
  navigationIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'visible' },
  topNavigationIconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  navigationIconCountBadge: { position: 'absolute', top: -3, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: desktopSurfaces.accent, borderWidth: 2, borderColor: desktopSurfaces.sidebar, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  navigationIconCountText: { color: desktopSurfaces.onAccent, fontSize: 10, lineHeight: 12, fontWeight: '900' },
  navigationLabelActive: { color: desktopSurfaces.accent },
  sidebarReleaseSummary: { marginTop: 'auto', paddingHorizontal: spacing.xs, gap: 2 },
  topReleaseSummary: { alignSelf: 'flex-start', paddingHorizontal: spacing.xs, gap: 2 },
  pilotNote: { color: desktopSurfaces.sidebarMuted, fontSize: 12, lineHeight: 17 },
  releaseNote: { color: desktopSurfaces.sidebarMuted, fontSize: 11, lineHeight: 16, fontWeight: '700' },
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
  evidenceCard: { flexGrow: 0, flexBasis: 'auto', width: '100%', minWidth: 0, borderLeftWidth: 4, borderLeftColor: desktopSurfaces.accent, padding: spacing.md },
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
  photoImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
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
  documentListPaneIndependent: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingRight: spacing.xs,
  } as any,
  documentInspectorPaneIndependent: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    position: 'relative',
    top: 0,
    paddingRight: spacing.xs,
  } as any,
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
  taskAreaHeadingSelected: { borderWidth: 2, borderLeftWidth: 6, borderColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.accentSoft },
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
  workflowProtectedField: { borderRadius: 12, borderWidth: 1, borderColor: desktopSurfaces.border, backgroundColor: desktopSurfaces.cardMuted, gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  workflowProtectedValue: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  workflowEditorCard: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardBlue, gap: spacing.sm, padding: spacing.md },
  workflowEditorHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  workflowMissing: { color: '#76510A', fontSize: 13, lineHeight: 19, fontWeight: '700' },
  workflowButtonDisabled: { opacity: 0.42 },
  flexCopy: { flex: 1, minWidth: 0 },
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
  taskPhotoPicker: { borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingTop: spacing.md, gap: spacing.sm },
  taskInspectorActions: { borderTopWidth: 1, borderTopColor: desktopSurfaces.border, paddingTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  taskInspectorEditButton: { flexGrow: 1, minWidth: 180 },
  twoColumnFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  flexField: { flexGrow: 1, flexBasis: 280 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choiceFieldOptions: { width: '100%' },
  choiceFieldChoice: { maxWidth: '100%', flexShrink: 1 },
  choiceFieldChoiceText: { flexShrink: 1 },
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
  reportAudienceField: { gap: spacing.sm },
  reportAudienceChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reportAudienceChoice: { flexGrow: 1, flexBasis: 300, minWidth: 240, borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardMuted, padding: spacing.md, gap: spacing.xs },
  reportAudienceChoiceActive: { borderColor: desktopSurfaces.accent, backgroundColor: desktopSurfaces.selected },
  reportAudienceChoiceTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  reportAudienceChoiceTitleActive: { color: desktopSurfaces.accentText },
  reportAudienceChoiceDetail: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
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
  reindexProgressCard: { borderRadius: 14, borderWidth: 1, borderColor: desktopSurfaces.borderStrong, backgroundColor: desktopSurfaces.cardBlue, padding: spacing.lg, gap: spacing.sm },
  reindexProgressHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
