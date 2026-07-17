import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  Alert,
  Modal,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingModalCard } from '../components/KeyboardAvoidingModalCard';
import { DAVECaptureConfirmationSheet } from '../components/DAVECaptureConfirmationSheet';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { ScreenMetric } from '../components/layout/ScreenMetric';
import { ScreenMetricGrid } from '../components/layout/ScreenMetricGrid';
import { ScreenSection } from '../components/layout/ScreenSection';
import {
  PrimaryButton,
  SecondaryButton,
} from '../components/ProjectDetailsCard';
import { getAIConfigurationStatus } from '../services/AIClientBoundaryService';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVEConfirmedCaptureMemory,
} from '../services/DAVECaptureMemory';
import {
  getCurrentSessionAccessToken,
  getSupabaseConfigurationStatus,
  getSupabaseConnectionStatus,
  signIn,
  signOut,
  signUp,
  subscribeToAuthStateChange,
  testSupabaseConnection,
  type SupabaseConnectionStatus,
  type SupabaseConnectionTestResult,
} from '../services/SupabaseService';
import {
  getSyncConflicts,
  getSyncStatus,
  reconcileSyncConflicts,
  resolveProjectUpdateSyncConflict,
  synchronizeLocalData,
  uploadPendingChanges,
  type MissingSyncPhoto,
  type FullSyncResult,
  type SyncConflict,
  type SyncStatus,
} from '../services/SyncService';
import type {
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import {
  colors,
  spacing,
  typography,
} from '../theme';

const ENABLE_DEV_AUTH_SIGNUP =
  process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP === 'true';
const SETTINGS_SYNC_TIMEOUT_MS = 30_000;

const APP_VERSION = Constants.expoConfig?.version || 'Unknown';
const APP_BUILD_NUMBER = getInstalledBuildNumber();
const APP_VERSION_BUILD_LABEL = `Version ${APP_VERSION} · Build ${APP_BUILD_NUMBER}`;

function getInstalledBuildNumber(): string {
  if (Platform.OS === 'ios') {
    return Constants.platform?.ios?.buildNumber
      || Constants.expoConfig?.ios?.buildNumber
      || 'Unknown';
  }

  if (Platform.OS === 'android') {
    return String(
      Constants.platform?.android?.versionCode
        ?? Constants.expoConfig?.android?.versionCode
        ?? 'Unknown',
    );
  }

  return String(Constants.expoConfig?.extra?.buildLabel || 'Unknown');
}

async function withSyncTimeout<T>(
  work: Promise<T>,
  timeoutMs = SETTINGS_SYNC_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('sync_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function AdminScreen({
  contentStyle,
  localProjects,
  savedUpdates,
  projectAreas,
  scheduleItems,
  referenceDocuments,
  scheduleAiExtractorUrl,
  onScheduleAiExtractorUrlChange,
  syncCleanupNotice,
  displayName,
  onDisplayNameChange,
  onBack,
  onDiagnostics,
  onBackup,
  onRestore,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
  onRemoveMissingPhotos,
  onRetryUpdateSync,
  onApplyCloudConflictUpdate,
  onApplyCloudRecovery,
  onSaveCaptureMemory,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  scheduleAiExtractorUrl: string;
  onScheduleAiExtractorUrlChange: (value: string) => void;
  syncCleanupNotice?: string | null;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onBack: () => void;
  onDiagnostics: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onRemoveMissingPhotos: (missingPhotos: MissingSyncPhoto[]) => Promise<void>;
  onRetryUpdateSync: (update: ProjectUpdate) => Promise<{ status?: string }>;
  onApplyCloudConflictUpdate: (update: ProjectUpdate) => void;
  onApplyCloudRecovery: (recovered: FullSyncResult['recovered']) => void;
  onSaveCaptureMemory: (memory: DAVEConfirmedCaptureMemory) => Promise<void>;
}) {
  const aiStatus = getAIConfigurationStatus();
  const supabaseConfig = getSupabaseConfigurationStatus();
  const [connectionStatus, setConnectionStatus] =
    useState<SupabaseConnectionStatus | null>(null);
  const [testResult, setTestResult] =
    useState<SupabaseConnectionTestResult | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);
  const [adminActionSummary, setAdminActionSummary] =
    useState('Cloud sync tools are available.');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dataRecoveryOpen, setDataRecoveryOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAttemptMessage, setSyncAttemptMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [lastFullSyncIssueCount, setLastFullSyncIssueCount] = useState(0);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [conflictReviewVisible, setConflictReviewVisible] = useState(false);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [signInModalVisible, setSignInModalVisible] = useState(false);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [capturePreviewOpen, setCapturePreviewOpen] = useState(false);
  const [capturePreviewDraft, setCapturePreviewDraft] = useState<DAVECaptureMemory>(() => createCapturePreviewDraft());
  const [capturePreviewSaved, setCapturePreviewSaved] = useState<DAVEConfirmedCaptureMemory | null>(null);
  const statusRefreshRunRef = useRef(0);

  useEffect(() => {
    let active = true;

    void refreshAdminStatus(undefined, () => active).catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!syncCleanupNotice) return;

    setAdminActionSummary('Sync status cleaned up.');
  }, [syncCleanupNotice]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthStateChange((event, session) => {
      if (session?.user) {
        setConnectionStatus({
          ...supabaseConfig,
          clientReady: true,
          authenticated: true,
          userEmail: session.user.email ?? null,
          checkedAt: new Date().toISOString(),
        });
        setIsCheckingConnection(false);
      } else if (event === 'SIGNED_OUT') {
        setConnectionStatus({
          ...supabaseConfig,
          clientReady: true,
          authenticated: false,
          userEmail: null,
          checkedAt: new Date().toISOString(),
        });
      }
      void refreshAdminStatus();
    });

    return unsubscribe;
  }, []);

  const connected = Boolean(
    supabaseConfig.configured &&
    connectionStatus?.clientReady &&
    connectionStatus.authenticated,
  );
  const cloudProjectCount = testResult?.projectCount;
  const connectionLabel = isCheckingConnection
    ? 'Checking…'
    : connected
      ? 'Connected'
      : 'Needs Attention';
  const updateSyncAttentionCount = savedUpdates.filter(
    update => update.status === 'queued' || update.status === 'failed',
  ).length;
  const pendingSyncCount = Math.max(
    updateSyncAttentionCount,
    syncStatus?.queuedChanges || 0,
  );
  const syncDetail = isSyncing
    ? 'Sync in progress'
    : pendingSyncCount > 0
    ? `${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} waiting to sync`
    : syncStatus?.conflicts
      ? `${syncStatus.conflicts} sync conflict${syncStatus.conflicts === 1 ? '' : 's'} need review`
      : lastFullSyncIssueCount > 0
        ? `${lastFullSyncIssueCount} ${lastFullSyncIssueCount === 1 ? 'item needs' : 'items need'} retry`
      : 'All caught up';
  const syncNeedsAttention =
    pendingSyncCount > 0 || Boolean(syncStatus?.conflicts) || lastFullSyncIssueCount > 0;

  async function shareFeedback() {
    try {
      await Share.share({
        title: 'App Feedback',
        message: 'App feedback:\n\n',
      });
    } catch {
      Alert.alert('Feedback unavailable', 'The share sheet could not be opened.');
    }
  }

  function showHelp() {
    Alert.alert(
      'Using the app',
      'Overview shows project health. Tasks contains scheduled work and field updates. Reports creates project communications. Use Talk for project questions, navigation, and confirmed project memory.',
      [{ text: 'Got It' }],
    );
  }

  function showAbout() {
    Alert.alert(
      'About',
      `This construction project assistant runs on ECOS. It helps organize field evidence, schedules, project memory, and reports while keeping final decisions with the project manager.\n\n${APP_VERSION_BUILD_LABEL}`,
      [{ text: 'Done' }],
    );
  }

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Settings"
        subtitle="Manage your account, project data, and technical tools."
        onBack={onBack}
      />

      <ScreenSection title="Account">
        <ScreenCard style={styles.settingsCard}>
          <SettingsStatusRow icon="person-circle-outline" title="Display name" detail="Used in greetings and project communication" />
          <TextInput
            style={styles.modalInput}
            value={displayName}
            onChangeText={onDisplayNameChange}
            placeholder="David"
            placeholderTextColor={colors.mutedText}
            autoCapitalize="words"
          />

          <SettingsStatusRow
            icon={connected ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            title="Connection status"
            detail={connectionLabel}
            tone={connected ? 'success' : 'warning'}
          />
          <SettingsStatusRow
            icon={syncNeedsAttention ? 'cloud-offline-outline' : 'cloud-done-outline'}
            title="Cloud sync"
            detail={syncDetail}
            tone={syncNeedsAttention ? 'warning' : 'success'}
          />

          {pendingSyncCount > 0 ? (
            <SecondaryButton
              label={isSyncing ? 'Syncing…' : 'Retry Sync'}
              icon="sync-outline"
              onPress={handleRetrySync}
              disabled={isSyncing}
            />
          ) : null}
          {pendingSyncCount === 0 && syncStatus?.conflicts ? (
            <SecondaryButton
              label="Review Conflicts"
              icon="git-compare-outline"
              onPress={() => setConflictReviewVisible(true)}
            />
          ) : null}
          {syncAttemptMessage ? (
            <Text style={styles.cardText} selectable>{syncAttemptMessage}</Text>
          ) : null}

          {connectionStatus?.authenticated ? (
            <>
              <Text style={styles.cardText}>
                Signed in as {connectionStatus.userEmail || 'your account'}.
              </Text>

              <SecondaryButton
                label={signingOut ? 'Signing out…' : 'Sign Out'}
                icon="log-out-outline"
                onPress={handleSignOut}
                disabled={signingOut}
              />
            </>
          ) : (
            <>
              <Text style={styles.cardText}>
                Sign in to enable cloud sync and photo intelligence.
              </Text>

              <SecondaryButton
                label="Sign In"
                icon="log-in-outline"
                onPress={openSignInModal}
              />
            </>
          )}
        </ScreenCard>
      </ScreenSection>

      <SignInModal
        visible={signInModalVisible}
        email={signInEmail}
        password={signInPassword}
        message={signInMessage}
        submitting={signInSubmitting}
        developmentSignupEnabled={ENABLE_DEV_AUTH_SIGNUP}
        onEmailChange={setSignInEmail}
        onPasswordChange={setSignInPassword}
        onSubmit={() => {
          void submitSignIn();
        }}
        onDevelopmentSignUp={() => {
          void submitDevelopmentSignUp();
        }}
        onClose={closeSignInModal}
      />

      <SyncConflictReviewModal
        visible={conflictReviewVisible}
        conflicts={syncConflicts}
        resolvingConflictId={resolvingConflictId}
        onKeepPhone={conflict => confirmConflictResolution(conflict, 'keep_local')}
        onKeepCloud={conflict => confirmConflictResolution(conflict, 'keep_cloud')}
        onClose={() => {
          if (!resolvingConflictId) setConflictReviewVisible(false);
        }}
      />

      <ScreenSection title="Data & Sync">
        <ScreenCard style={styles.settingsCard}>
          <SettingsActionRow icon="sync-outline" title={isSyncing ? 'Syncing…' : 'Sync Now'} detail="Sync projects, updates, schedules, areas, and documents" onPress={() => { void handleFullSyncNow(); }} disabled={isSyncing} />
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={() => setDataRecoveryOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: dataRecoveryOpen }}
          >
            <View style={styles.settingsIcon}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.settingsRowMain}>
              <Text style={styles.settingsRowTitle}>Data Recovery</Text>
              <Text style={styles.settingsRowDetail}>Back up or restore this phone's local data</Text>
            </View>
            <Ionicons name={dataRecoveryOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedText} />
          </TouchableOpacity>
          {dataRecoveryOpen ? (
            <>
              <SettingsActionRow icon="download-outline" title="Back Up Data" detail="Export a local backup file" onPress={onBackup} />
              <SettingsActionRow icon="cloud-upload-outline" title="Restore Backup" detail="Import a previously exported backup" onPress={onRestore} last />
            </>
          ) : null}
          <Text style={styles.actionSummary} selectable>{adminActionSummary}</Text>
        </ScreenCard>
      </ScreenSection>

      <ScreenSection title="Support">
        <ScreenCard style={styles.settingsCard}>
          <SettingsActionRow icon="chatbubble-ellipses-outline" title="Send Feedback" detail="Share an idea or report a problem" onPress={() => { void shareFeedback(); }} />
          <SettingsActionRow icon="help-circle-outline" title="Help" detail="Learn where to find core workflows" onPress={showHelp} />
          <SettingsActionRow icon="information-circle-outline" title="About" detail={APP_VERSION_BUILD_LABEL} onPress={showAbout} last />
        </ScreenCard>
      </ScreenSection>

      <ScreenSection title="Advanced / Diagnostics">
        <TouchableOpacity
          style={styles.advancedDisclosure}
          onPress={() => setAdvancedOpen(open => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          accessibilityLabel="Advanced and diagnostics"
        >
          <View style={styles.settingsIcon}>
            <Ionicons name="settings-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.settingsRowMain}>
            <Text style={styles.settingsRowTitle}>Technical details and tools</Text>
            <Text style={styles.settingsRowDetail}>Build, connection, sync, routing, and diagnostics</Text>
          </View>
          <Ionicons name={advancedOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedText} />
        </TouchableOpacity>

        {advancedOpen ? (
          <>
            <ScreenMetricGrid>
              <ScreenMetric label="Cloud" value={supabaseConfig.configured ? 'Ready' : 'Needs Setup'} detail={supabaseConfig.configured ? 'Cloud configuration is ready.' : 'Cloud setup needs review.'} tone={supabaseConfig.configured ? 'success' : 'warning'} icon={<Ionicons name="cloud-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Connection" value={connectionLabel} detail={formatCheckedAt(testResult?.checkedAt)} tone={connected ? 'success' : 'warning'} icon={<Ionicons name="wifi-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Cloud Projects" value={cloudProjectCount ?? 'Unknown'} detail="Projects synced through cloud" tone={cloudProjectCount == null ? 'warning' : 'default'} icon={<Ionicons name="folder-open-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="AI Assist" value="Server Routed" detail={aiStatus.message} tone="success" icon={<Ionicons name="sparkles-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Build" value={APP_BUILD_NUMBER} detail={`Version ${APP_VERSION} · True Photo Intelligence`} tone="success" icon={<Ionicons name="construct-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Auth" value={connectionStatus?.authenticated ? 'Signed In' : 'No Session'} detail={connectionStatus?.userEmail || 'No active account session'} tone={connectionStatus?.authenticated ? 'success' : 'default'} icon={<Ionicons name="person-circle-outline" size={18} color={colors.primary} />} />
            </ScreenMetricGrid>

            <ScreenCard>
              <Text style={styles.cardTitle}>Developer Support</Text>
              <View style={styles.actionGrid}>
                <AdminActionButton label="Diagnostics" icon="pulse-outline" onPress={onDiagnostics} />
                <AdminActionButton label={isTesting ? 'Testing...' : 'Test Connection'} icon="cloud-done-outline" onPress={handleTestConnection} disabled={isTesting} primary />
              </View>
              {__DEV__ ? (
                <SecondaryButton
                  label="Preview Capture Confirmation"
                  icon="chatbox-ellipses-outline"
                  onPress={() => {
                    setCapturePreviewDraft(createCapturePreviewDraft());
                    setCapturePreviewOpen(true);
                  }}
                />
              ) : null}
              {__DEV__ && capturePreviewSaved ? (
                <Text style={styles.resultText}>Preview confirmed and saved locally.</Text>
              ) : null}
              <Text style={styles.modalLabel}>Advanced schedule OCR endpoint</Text>
              <TextInput
                style={styles.modalInput}
                value={scheduleAiExtractorUrl}
                onChangeText={onScheduleAiExtractorUrlChange}
                placeholder="https://your-secure-schedule-extractor.example.com/extract"
                placeholderTextColor={colors.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={styles.progressText}>
                Optional fallback for scanned Gantt PDFs. Message screenshots use local Apple recognition first.
              </Text>
            </ScreenCard>

          </>
        ) : null}
      </ScreenSection>

      {__DEV__ ? (
        <DAVECaptureConfirmationSheet
          visible={capturePreviewOpen}
          transcript={CAPTURE_PREVIEW_TRANSCRIPT}
          draft={capturePreviewDraft}
          projects={localProjects.length ? localProjects : ['Canopy B', 'Canopy C']}
          locations={projectAreas.map(area => area.name)}
          onSave={async memory => {
            await onSaveCaptureMemory(memory);
            setCapturePreviewSaved(memory);
            setCapturePreviewOpen(false);
          }}
          onCancel={() => setCapturePreviewOpen(false)}
        />
      ) : null}
    </Screen>
  );

  async function refreshAdminStatus(
    nextTest?: SupabaseConnectionTestResult,
    isActive: () => boolean = () => true,
  ) {
    const refreshRun = statusRefreshRunRef.current + 1;
    statusRefreshRunRef.current = refreshRun;
    const isCurrentRefresh = () =>
      isActive() && statusRefreshRunRef.current === refreshRun;
    setIsCheckingConnection(true);

    try {
      const [, connection, test] = await Promise.all([
        reconcileSyncConflicts(),
        getSupabaseConnectionStatus(),
        nextTest ? Promise.resolve(nextTest) : testSupabaseConnection(),
      ]);
      const [currentSyncStatus, currentConflicts] = await Promise.all([
        getSyncStatus(),
        getSyncConflicts(),
      ]);

      if (!isCurrentRefresh()) return;

      setConnectionStatus(connection);
      setTestResult(test);
      setSyncStatus(currentSyncStatus);
      setSyncConflicts(currentConflicts);
    } finally {
      if (isCurrentRefresh()) setIsCheckingConnection(false);
    }
  }

  async function handleTestConnection() {
    setIsTesting(true);
    setAdminActionSummary('Cloud sync tools are available.');

    try {
      const result = await testSupabaseConnection();
      await refreshAdminStatus(result);

      setAdminActionSummary(
        result.connected
          ? 'Cloud connection available.'
          : 'Cloud connection could not be verified right now. Developer details are available under Advanced Configuration > Developer Support > Diagnostics.',
      );
    } catch {
      setAdminActionSummary(
        'Cloud connection could not be verified right now.',
      );
    } finally {
      setIsTesting(false);
    }
  }

  async function handleRetrySync() {
    setIsSyncing(true);
    setSyncAttemptMessage(null);
    setAdminActionSummary('Cloud sync tools are available.');

    try {
      const updatesToRetry = savedUpdates.filter(
        update => update.status === 'queued' || update.status === 'failed',
      );
      const retryResults = updatesToRetry.length > 0
        ? await withSyncTimeout(
            Promise.all(updatesToRetry.map(update => onRetryUpdateSync(update))),
          )
        : [];
      const queueResult = updatesToRetry.length === 0
        ? await withSyncTimeout(uploadPendingChanges())
        : null;
      const nextSyncStatus = await getSyncStatus();
      setSyncStatus(nextSyncStatus);

      const syncedUpdates = retryResults.filter(update => update.status === 'sent').length;
      const unsyncedUpdates = retryResults.length - syncedUpdates;
      const remainingQueue = queueResult?.queued ?? nextSyncStatus.queuedChanges;
      const remainingConflicts = nextSyncStatus.conflicts;
      const syncSucceeded =
        unsyncedUpdates === 0 && remainingQueue === 0 && remainingConflicts === 0;
      const message = remainingConflicts > 0
        ? `The sync queue is clear, but ${remainingConflicts} saved ${remainingConflicts === 1 ? 'conflict needs' : 'conflicts need'} review.`
        : syncSucceeded
        ? `${syncedUpdates || queueResult?.uploaded || 0} pending ${syncedUpdates === 1 || queueResult?.uploaded === 1 ? 'item' : 'items'} synced successfully.`
        : `${Math.max(unsyncedUpdates, remainingQueue)} ${Math.max(unsyncedUpdates, remainingQueue) === 1 ? 'item still needs' : 'items still need'} attention. It remains saved on this phone.`;
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
      setSyncConflicts(await getSyncConflicts());
    } catch (error) {
      const timedOut = String(error).includes('sync_timeout');
      const message = timedOut
        ? 'Cloud sync is taking longer than expected. The item remains saved on this phone; its status will update if the background attempt finishes.'
        : 'Cloud sync could not finish. The item remains saved on this phone.';
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleFullSyncNow() {
    setIsSyncing(true);
    setLastFullSyncIssueCount(0);
    setSyncAttemptMessage('Preparing project data…');
    setAdminActionSummary('Preparing project data…');

    try {
      const result = await synchronizeLocalData(
        {
          projects: localProjects,
          savedUpdates,
          projectAreas,
          scheduleItems,
          referenceDocuments,
        },
        progress => {
          const message = `${progress.message} (${progress.completed} of ${progress.total})`;
          setSyncAttemptMessage(message);
          setAdminActionSummary(message);
        },
      );
      const [nextStatus, nextConflicts] = await Promise.all([
        getSyncStatus(),
        getSyncConflicts(),
      ]);
      setSyncStatus(nextStatus);
      onApplyCloudRecovery(result.recovered);
      setSyncConflicts(nextConflicts);
      setLastFullSyncIssueCount(result.errors.length);
      const message = nextConflicts.length > 0
        ? `Cloud sync finished, but ${nextConflicts.length} ${nextConflicts.length === 1 ? 'saved conflict needs' : 'saved conflicts need'} review.`
        : result.errors.length === 0
        ? `Cloud sync completed: ${result.uploaded} uploaded and ${result.downloaded} downloaded.`
        : [
            `Cloud sync finished with ${result.errors.length} ${result.errors.length === 1 ? 'item' : 'items'} still needing attention:`,
            ...result.errors.slice(0, 3).map(error => `• ${error}`),
            ...(result.errors.length > 3
              ? [`• ${result.errors.length - 3} more ${result.errors.length - 3 === 1 ? 'item' : 'items'}`]
              : []),
          ].join('\n');
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
      if (result.missingPhotos.length > 0) showMissingPhotoSyncAlert(result.missingPhotos);
    } catch {
      let actualIssueCount = updateSyncAttentionCount;

      try {
        const [nextStatus, nextConflicts] = await Promise.all([
          getSyncStatus(),
          getSyncConflicts(),
        ]);
        setSyncStatus(nextStatus);
        setSyncConflicts(nextConflicts);
        actualIssueCount = Math.max(
          actualIssueCount,
          nextStatus.queuedChanges + nextConflicts.length,
        );
      } catch {
        // Keep the known local update count when sync status itself cannot load.
      }

      setLastFullSyncIssueCount(actualIssueCount);
      const message = actualIssueCount > 0
        ? `Full cloud sync could not finish. ${actualIssueCount} ${actualIssueCount === 1 ? 'item remains' : 'items remain'} saved on this phone.`
        : 'The cloud sync check could not finish, but no pending retry items were found. Please try Sync Now again.';
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
    } finally {
      setIsSyncing(false);
    }
  }

  function confirmConflictResolution(
    conflict: SyncConflict,
    resolution: 'keep_local' | 'keep_cloud',
  ) {
    const update = conflictUpdate(conflict, resolution);
    const projectName = update?.projectName || 'this field update';
    const title = resolution === 'keep_local' ? 'Keep Phone Copy?' : 'Keep Cloud Copy?';
    const message = resolution === 'keep_local'
      ? `The version saved on this phone for ${projectName} will replace the cloud copy.`
      : `The cloud version for ${projectName} will replace the copy saved on this phone.`;

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: resolution === 'keep_local' ? 'Keep Phone' : 'Keep Cloud',
        style: resolution === 'keep_cloud' ? 'destructive' : 'default',
        onPress: () => {
          void resolveConflict(conflict, resolution);
        },
      },
    ]);
  }

  async function resolveConflict(
    conflict: SyncConflict,
    resolution: 'keep_local' | 'keep_cloud',
  ) {
    setResolvingConflictId(conflict.id);

    try {
      const resolvedUpdate = await resolveProjectUpdateSyncConflict<ProjectUpdate>(
        conflict.id,
        resolution,
      );
      if (resolution === 'keep_cloud') {
        onApplyCloudConflictUpdate(resolvedUpdate);
      }

      const [nextConflicts, nextStatus] = await Promise.all([
        getSyncConflicts(),
        getSyncStatus(),
      ]);
      setSyncConflicts(nextConflicts);
      setSyncStatus(nextStatus);
      setSyncAttemptMessage(
        nextConflicts.length > 0
          ? `${nextConflicts.length} ${nextConflicts.length === 1 ? 'conflict remains' : 'conflicts remain'} to review.`
          : 'Cloud conflicts resolved.',
      );
      if (nextConflicts.length === 0) setConflictReviewVisible(false);
    } catch {
      Alert.alert(
        'Conflict not resolved',
        'Neither copy was changed. Check the cloud connection and try again.',
      );
    } finally {
      setResolvingConflictId(null);
    }
  }

  function openSignInModal() {
    setSignInMessage(null);
    setSignInModalVisible(true);
  }

  function closeSignInModal() {
    if (signInSubmitting) return;

    setSignInModalVisible(false);
    setSignInPassword('');
    setSignInMessage(null);
  }

  async function submitSignIn() {
    const email = signInEmail.trim();

    if (!email || !signInPassword) {
      setSignInMessage('Enter your account email and password.');
      return;
    }

    setSignInSubmitting(true);
    setSignInMessage(null);

    try {
      const result = await signIn({ email, password: signInPassword });

      if (!result.ok) {
        setSignInMessage(result.error || 'Sign in failed.');
        return;
      }

      const tokenResult = await getCurrentSessionAccessToken();

      if (!tokenResult.ok || tokenResult.data?.status !== 'token_present') {
        setSignInMessage(
          tokenResult.data?.missingReason === 'auth_loading'
            ? 'Preparing secure session…'
            : 'Sign in completed, but the session token is not available yet.',
        );
        return;
      }

      setConnectionStatus({
        ...supabaseConfig,
        clientReady: true,
        authenticated: true,
        userEmail: result.data?.user?.email || email,
        checkedAt: new Date().toISOString(),
      });
      setIsCheckingConnection(false);

      setSignInModalVisible(false);
      setSignInEmail('');
      setSignInPassword('');
      setSignInMessage(null);
      await refreshAdminStatus();
    } finally {
      setSignInSubmitting(false);
    }
  }

  async function submitDevelopmentSignUp() {
    const email = signInEmail.trim();

    if (!email || !signInPassword) {
      setSignInMessage('Enter an email and password for the development account.');
      return;
    }

    setSignInSubmitting(true);
    setSignInMessage(null);

    try {
      const created = await signUp({ email, password: signInPassword });
      let authResult = created;

      if (!created.ok && /already|registered|exists/i.test(created.error || '')) {
        authResult = await signIn({ email, password: signInPassword });
      }

      if (!authResult.ok) {
        setSignInMessage(authResult.error || 'Development account sign-up failed.');
        return;
      }

      const tokenResult = await getCurrentSessionAccessToken();

      if (!tokenResult.ok || tokenResult.data?.status !== 'token_present') {
        setSignInMessage(
          tokenResult.data?.missingReason === 'auth_loading'
            ? 'Preparing secure session…'
            : 'Development account was created, but Supabase did not return a signed-in session. If email confirmation is enabled, confirm the email and sign in.',
        );
        return;
      }

      setSignInModalVisible(false);
      setSignInEmail('');
      setSignInPassword('');
      setSignInMessage(null);
      await refreshAdminStatus();
    } finally {
      setSignInSubmitting(false);
    }
  }

  function handleSignOut() {
    const queuedCount = savedUpdates.filter(update => update.status === 'queued').length;
    const message =
      queuedCount > 0
        ? `${queuedCount} update${queuedCount === 1 ? '' : 's'} still queued to sync will keep failing until you sign in again. Sign out anyway?`
        : 'You will need to sign in again to resume cloud sync and photo intelligence.';

    Alert.alert('Sign Out', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void performSignOut();
        },
      },
    ]);
  }

  async function performSignOut() {
    setSigningOut(true);

    try {
      await signOut();
      await refreshAdminStatus();
    } finally {
      setSigningOut(false);
    }
  }

  function showMissingPhotoSyncAlert(missingPhotos: MissingSyncPhoto[]) {
    const count = missingPhotos.length;

    Alert.alert(
      'Photo not available',
      formatMissingPhotoSyncMessage(count) ||
        'A photo could not be synced because it is no longer available.',
      [
        {
          text: count === 1 ? 'Keep Update, Skip Photo' : 'Keep Updates, Skip Photos',
          style: 'destructive',
          onPress: () => {
            void onRemoveMissingPhotos(missingPhotos).then(async () => {
              await refreshAdminStatus();
              setSyncAttemptMessage('Field update history preserved. Unavailable photo retries were cleared.');
              setAdminActionSummary('Field update history preserved. Unavailable photo retries were cleared.');
            });
          },
        },
        {
          text: 'Retry',
          onPress: () => {
            void handleFullSyncNow();
          },
        },
        {
          text: 'Dismiss',
          style: 'cancel',
        },
      ],
    );
  }
}

const CAPTURE_PREVIEW_TRANSCRIPT = 'ABC Electric agreed to finish the conduit by Friday in the electrical room. The owner asked for a photo after the inspection.';

function createCapturePreviewDraft() {
  const createdAt = new Date().toISOString();
  const stableTimestamp = createdAt.replace(/[^0-9]/g, '');
  return createCaptureMemory({
    id: `developer-preview-memory-${stableTimestamp}`,
    transcript: CAPTURE_PREVIEW_TRANSCRIPT,
    transcriptSourceRecordId: `developer-preview-transcript-${stableTimestamp}`,
    createdAt,
    recommendedProject: { value: 'Canopy B', confidence: 'medium' },
    recommendedLocation: { value: 'Electrical room', confidence: 'medium' },
    fields: {
      peopleOrCompany: 'ABC Electric',
      commitment: 'Finish the conduit by Friday.',
      dueDate: null,
      ownerRequest: 'Provide a photo after the inspection.',
    },
  });
}

function formatMissingPhotoSyncMessage(count: number) {
  if (count <= 0) return null;

  return `${count} photo ${count === 1 ? 'file is' : 'files are'} no longer on this phone or in cloud storage. Keep the field update history and stop retrying only the unavailable ${count === 1 ? 'file' : 'files'}.`;
}

function SettingsStatusRow({
  icon,
  title,
  detail,
  tone = 'default',
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  tone?: 'default' | 'success' | 'warning';
  last?: boolean;
}) {
  const iconColor = tone === 'success'
    ? colors.success
    : tone === 'warning'
      ? colors.warning
      : colors.primary;

  return (
    <View style={[styles.settingsRow, last && styles.settingsRowLast]}>
      <View style={styles.settingsIcon}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.settingsRowMain}>
        <Text style={styles.settingsRowTitle}>{title}</Text>
        <Text style={styles.settingsRowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function SettingsActionRow({
  icon,
  title,
  detail,
  onPress,
  disabled = false,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.settingsRow,
        styles.settingsActionRow,
        last && styles.settingsRowLast,
        disabled && styles.settingsActionRowDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
    >
      <View style={styles.settingsIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.settingsRowMain}>
        <Text style={styles.settingsRowTitle}>{title}</Text>
        <Text style={styles.settingsRowDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={19} color={colors.mutedText} />
    </TouchableOpacity>
  );
}

function AdminInfoCard({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <ScreenCard>
      <View style={styles.infoHeader}>
        <Ionicons
          name={icon}
          size={20}
          color={colors.primary}
        />

        <Text style={styles.cardTitle}>
          {title}
        </Text>
      </View>

      <Text style={styles.cardText}>
        {text}
      </Text>
    </ScreenCard>
  );
}

function AdminActionButton({
  label,
  icon,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.adminActionButton,
        primary && styles.adminActionButtonPrimary,
        disabled && styles.adminActionButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons
        name={icon}
        size={22}
        color={primary ? '#FFFFFF' : colors.primary}
      />

      <Text
        style={[
          styles.adminActionButtonText,
          primary && styles.adminActionButtonTextPrimary,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SyncConflictReviewModal({
  visible,
  conflicts,
  resolvingConflictId,
  onKeepPhone,
  onKeepCloud,
  onClose,
}: {
  visible: boolean;
  conflicts: SyncConflict[];
  resolvingConflictId: string | null;
  onKeepPhone: (conflict: SyncConflict) => void;
  onKeepCloud: (conflict: SyncConflict) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingModalCard
          frameStyle={styles.modalCardFrame}
          contentContainerStyle={styles.modalCardContent}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.cardTitle}>Review Cloud Conflicts</Text>
              <Text style={styles.cardText}>
                These field updates have different phone and cloud copies. Nothing changes until you choose which copy to keep.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={onClose}
              disabled={Boolean(resolvingConflictId)}
              accessibilityLabel="Close cloud conflict review"
            >
              <Ionicons name="close-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {conflicts.length === 0 ? (
            <Text style={styles.cardText}>No cloud conflicts remain.</Text>
          ) : conflicts.map(conflict => {
            const phoneUpdate = conflictUpdate(conflict, 'keep_local');
            const cloudUpdate = conflictUpdate(conflict, 'keep_cloud');
            const resolving = resolvingConflictId === conflict.id;

            return (
              <View key={conflict.id} style={styles.conflictCard}>
                <Text style={styles.conflictTitle}>
                  {phoneUpdate?.projectName || cloudUpdate?.projectName || 'Field update'}
                </Text>
                <Text style={styles.settingsRowDetail}>
                  Phone: {formatConflictCopy(phoneUpdate)}
                </Text>
                <Text style={styles.settingsRowDetail}>
                  Cloud: {formatConflictCopy(cloudUpdate)}
                </Text>
                <View style={styles.conflictActions}>
                  <SecondaryButton
                    label={resolving ? 'Saving…' : 'Keep Phone'}
                    icon="phone-portrait-outline"
                    onPress={() => onKeepPhone(conflict)}
                    disabled={Boolean(resolvingConflictId)}
                    compact
                  />
                  <SecondaryButton
                    label={resolving ? 'Saving…' : 'Keep Cloud'}
                    icon="cloud-outline"
                    onPress={() => onKeepCloud(conflict)}
                    disabled={Boolean(resolvingConflictId)}
                    compact
                  />
                </View>
              </View>
            );
          })}
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

function conflictUpdate(
  conflict: SyncConflict,
  source: 'keep_local' | 'keep_cloud',
): ProjectUpdate | null {
  const payload = source === 'keep_local'
    ? conflict.localPayload
    : conflict.remotePayload;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const update = source === 'keep_local' && record.updateData
    ? record.updateData
    : payload;

  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  return update as ProjectUpdate;
}

function formatConflictCopy(update: ProjectUpdate | null): string {
  if (!update) return 'Copy unavailable';
  const date = update.date ? new Date(update.date) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'date unavailable';
  const photoCount = Array.isArray(update.photos) ? update.photos.length : 0;
  return `${dateLabel} · ${photoCount} photo${photoCount === 1 ? '' : 's'}${update.notes?.trim() ? ` · ${update.notes.trim().slice(0, 80)}` : ''}`;
}

export function SignInModal({
  visible,
  email,
  password,
  message,
  submitting,
  developmentSignupEnabled,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onDevelopmentSignUp,
  onClose,
}: {
  visible: boolean;
  email: string;
  password: string;
  message: string | null;
  submitting: boolean;
  developmentSignupEnabled: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onDevelopmentSignUp: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingModalCard
          frameStyle={styles.modalCardFrame}
          contentContainerStyle={styles.modalCardContent}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderText}>
              <Text style={styles.cardTitle}>
                Sign In
              </Text>

              <Text style={styles.cardText}>
                Use a Supabase Auth email and password to enable cloud sync and photo intelligence.
              </Text>
            </View>

            <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalLabel}>
            Email
          </Text>
          <TextInput
            style={styles.modalInput}
            value={email}
            onChangeText={onEmailChange}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedText}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="username"
          />

          <Text style={styles.modalLabel}>
            Password
          </Text>
          <TextInput
            style={styles.modalInput}
            value={password}
            onChangeText={onPasswordChange}
            placeholder="Password"
            placeholderTextColor={colors.mutedText}
            secureTextEntry
            textContentType="password"
          />

          {message ? (
            <Text style={styles.modalErrorText}>
              {message}
            </Text>
          ) : null}

          <PrimaryButton
            label={submitting ? 'Signing in…' : 'Sign In'}
            icon="log-in-outline"
            onPress={onSubmit}
            disabled={submitting || !email.trim() || !password}
          />

          {developmentSignupEnabled ? (
            <SecondaryButton
              label="Create or sign in development account"
              icon="flask-outline"
              onPress={onDevelopmentSignUp}
              disabled={submitting}
            />
          ) : null}

          <SecondaryButton
            label="Cancel"
            icon="close-outline"
            onPress={onClose}
            disabled={submitting}
          />
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

function formatCheckedAt(value: string | undefined) {
  if (!value) return 'No connection test has run yet';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Checked recently';

  return `Last checked ${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

const styles = StyleSheet.create({
  settingsCard: {
    paddingVertical: spacing.xs,
  },

  settingsRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },

  settingsRowLast: {
    borderBottomWidth: 0,
  },

  settingsActionRow: {
    minHeight: 66,
  },

  settingsActionRowDisabled: {
    opacity: 0.5,
  },

  actionSummary: {
    ...typography.caption,
    color: colors.mutedText,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },

  conflictCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },

  conflictTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },

  conflictActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  settingsIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  settingsRowMain: {
    flex: 1,
  },

  settingsRowTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
  },

  settingsRowDetail: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },

  advancedDisclosure: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  cardTitle: {
    ...typography.h3,
    marginBottom: spacing.sm,
  },

  cardText: {
    ...typography.body,
    marginBottom: spacing.sm,
  },

  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  adminActionButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 56,
    minWidth: 142,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },

  adminActionButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  adminActionButtonDisabled: {
    opacity: 0.55,
  },

  adminActionButtonText: {
    color: colors.primary,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
  },

  adminActionButtonTextPrimary: {
    color: '#FFFFFF',
  },

  resultText: {
    ...typography.body,
    marginTop: spacing.md,
  },

  progressText: {
    ...typography.caption,
    marginTop: spacing.xs,
  },

  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },

  modalCardFrame: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },

  modalCardContent: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 34 : spacing.lg,
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },

  modalHeaderText: {
    flex: 1,
  },

  modalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },

  modalInput: {
    minHeight: 46,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },

  modalErrorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
});
