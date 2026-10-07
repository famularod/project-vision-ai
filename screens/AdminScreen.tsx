import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { NativeWorkspaceOwnerContext, useNativeWorkspaceSignInPending } from '../components/native-workspace-owner';
import { unsavedFieldNoteExists } from '../hooks/use-field-note-draft';
import { unsavedWalkMemoryExists } from '../hooks/use-kept-walk-memory-draft';
import { keptVoiceRecordingExists } from '../services/KeptVoiceRecording';
import { clearSignOutAskedHere, noteAskedSignOutAnswered, noteSignOutAskedHere } from '../services/SignOutIntent';
import { fieldNotesNeedingReview, fieldNotesWaitingToSync } from '../services/FieldNotesWaitingToSync';
import { queuedDocumentChangesSnapshot, subscribeToQueuedDocumentChanges } from '../services/FieldUpdateDocumentChangeNotice';
import { signOutNotInCloudSentences } from '../services/SignOutNotInCloudWarning';
import { scheduleItemConflictCopyOfFields, scheduleItemConflictFieldLabel, scheduleItemConflictFields } from '../services/ScheduleItemEditBase';
import { fieldUpdateConflictChanges } from '../services/FieldUpdateEditBase';
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
  DEVICE_BACKUP_SCOPE_NOTICE,
  DEVICE_RECORDS_ONLY_SCOPE_NOTICE,
} from '../services/BackupExportPolicy';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVEConfirmedCaptureMemory,
} from '../services/DAVECaptureMemory';
import {
  getCurrentSessionAccessToken,
  getSupabaseConfigurationStatus,
  getSupabaseConnectionStatus,
  readSavedSignIn,
  signIn,
  SIGN_IN_ALREADY_ENDED_ON_SERVER,
  signOut,
  SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL,
  SIGNED_OUT_ON_THIS_DEVICE_ONLY,
  signUp,
  subscribeToAuthStateChange,
  testSupabaseConnection,
  type SignOutScope,
  type SupabaseConnectionStatus,
  type SupabaseConnectionTestResult,
} from '../services/SupabaseService';
import {
  getSyncConflicts,
  getSyncStatus,
  newerPhoneEditForFieldUpdateConflict,
  projectUpdateCopyIsLastInCloud,
  reconcileSyncConflicts,
  refreshFieldUpdateConflictCloudCopies,
  refreshScheduleItemConflictCloudCopies,
  resolveProjectUpdateSyncConflict,
  keepCloudOnNewerPhoneTaskEdits,
  newerPhoneCopyForScheduleItemConflict,
  resolveScheduleItemSyncConflict,
  synchronizeLocalData,
  syncConflictChoiceStopReason,
  uploadPendingChanges,
  type MissingSyncPhoto,
  type FullSyncResult,
  type SyncConflict,
  type SyncQueueItem,
  type SyncStatus,
} from '../services/SyncService';
import {
  projectDocumentsStillUploadingNotice,
  startProjectDocumentUploadRun,
  type ProjectDocumentUploadRetryResult,
} from '../services/ProjectDocumentUploadRetry';
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
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP === 'true';
const SETTINGS_SYNC_TIMEOUT_MS = 30_000;
const SETTINGS_STATUS_TIMEOUT_MS = 8_000;
const SETTINGS_SYNC_TIMEOUT = Symbol('settings_sync_timeout');
/**
 * What Settings › Sync Now downloaded, and when it started (whole-app audit
 * A6 pass 11 L1, 30 Sep 2026). Sync Now recorded no download, so Reports,
 * waiting for the other device's changes, told David to use it and kept
 * waiting: tasks applied with a verified deletion history are now recorded as
 * downloaded at this time.
 */
export type SyncNowRecovery = FullSyncResult['recovered'] & Readonly<{ syncStartedAt: string }>;

/** What each Sign Out choice does, in the owner's words (owner answer Q21). */
const SIGN_OUT_CHOICES =
  'This Device: your other devices stay signed in.\n' +
  'All Devices: your other devices are signed out too, within an hour or when they next have signal. Use this if a device is lost.';

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
        timeout = setTimeout(() => reject(SETTINGS_SYNC_TIMEOUT), timeoutMs);
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
  onRetryDocumentUploads,
  failedDocumentCount,
  onApplyCloudConflictUpdate,
  onApplyCloudConflictScheduleItem,
  onApplyCloudRecovery,
  onSaveCaptureMemory,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  syncCleanupNotice?: string | null;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onBack: () => void;
  onDiagnostics: () => void;
  onBackup: (passphrase: string, includeFiles?: boolean, onProgress?: (message: string) => void) => void;
  onRestore: (passphrase: string, onProgress?: (message: string) => void) => void;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onRemoveMissingPhotos: (missingPhotos: MissingSyncPhoto[]) => Promise<void>;
  /** `automatic`: Retry Sync's, not a choice made for this update; one in conflict is left for review (whole-app audit A7 pass 12 M-1). */
  onRetryUpdateSync: (
    update: ProjectUpdate,
    sync?: { automatic?: boolean },
  ) => Promise<{ status?: string; heldForConflictReview?: boolean }>;
  /** Uploads the documents saved on this phone whose file has not uploaded. */
  onRetryDocumentUploads: () => Promise<ProjectDocumentUploadRetryResult>;
  /** Those documents: they are not in the sync queue (whole-app audit A8 pass 1 F5, 30 Sep 2026). */
  failedDocumentCount: number;
  onApplyCloudConflictUpdate: (update: ProjectUpdate) => void;
  onApplyCloudConflictScheduleItem: (item: ScheduleItem) => void;
  onApplyCloudRecovery: (recovered: SyncNowRecovery) => void;
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
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncAttemptMessage, setSyncAttemptMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [lastFullSyncIssueCount, setLastFullSyncIssueCount] = useState(0);
  // Read when a sync ends, while the document uploads it started may still run.
  const failedDocumentCountRef = useRef(failedDocumentCount);
  failedDocumentCountRef.current = failedDocumentCount;
  // Read after a conflict choice's cloud calls (whole-app audit A4 pass 18
  // L1) to tell a newer phone edit, and an archive Keep Phone kept. The App's
  // Retry then sends its own card as it is (A4 pass 19 L1): this copy can
  // still miss a photo analysis that landed before Settings re-rendered.
  const savedUpdatesRef = useRef(savedUpdates);
  savedUpdatesRef.current = savedUpdates;
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
  // Whole-app audit A1 pass 2 #1: open offline on a saved sign-in that could
  // not refresh (owner answer Q13), the session lookup finds no session, and
  // Settings said "Sign in to enable cloud sync" with a Sign In button and no
  // Sign Out. The account is signed in here, pending its refresh.
  const workspaceSignInPending = useNativeWorkspaceSignInPending();
  // Field notes are kept per account (none outside the workspace boundary).
  const workspaceOwner = useContext(NativeWorkspaceOwnerContext);
  const fieldNoteOwnerKey = workspaceOwner === undefined ? null : workspaceOwner ?? 'local-device';
  const signInPending = workspaceSignInPending && !connectionStatus?.authenticated;
  const [pendingAccountEmail, setPendingAccountEmail] = useState<string | null>(null);
  const signedInHere = Boolean(connectionStatus?.authenticated) || signInPending;

  useEffect(() => {
    if (!workspaceSignInPending) return;
    let active = true;
    void readSavedSignIn().then(saved => {
      if (active) setPendingAccountEmail(saved?.email ?? null);
    }, () => undefined);
    return () => {
      active = false;
    };
  }, [workspaceSignInPending]);

  useEffect(() => {
    let active = true;

    void refreshAdminStatus(undefined, () => active).catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!syncCleanupNotice) return;

    setAdminActionSummary(syncCleanupNotice);
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
  const connectionLabel = signInPending
    ? 'Offline, sign-in pending'
    : isCheckingConnection
    ? 'Checking…'
    : connected
      ? 'Connected'
      : 'Needs Attention';
  const updateSyncAttentionCount = savedUpdates.filter(
    update => update.status === 'queued' || update.status === 'failed',
  ).length;
  const pendingSyncCount = (syncStatus
    ? syncStatus.queuedChanges
    : updateSyncAttentionCount) + failedDocumentCount;
  const recoveryCopyCount = syncStatus?.recoveryCopies || 0;
  const recoveryCopyLabel = `${recoveryCopyCount} protected sync ${recoveryCopyCount === 1 ? 'copy' : 'copies'}`;
  const recoveryCopyVerb = recoveryCopyCount === 1 ? 'needs' : 'need';
  const syncDetail = isSyncing
    ? 'Sync in progress'
    : syncStatus?.recoveryAvailable
      ? pendingSyncCount > 0
        ? `${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} pending on this device; ${recoveryCopyLabel} also ${recoveryCopyVerb} review`
        : `${recoveryCopyLabel} ${recoveryCopyVerb} review`
    : pendingSyncCount > 0
    ? `${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} pending on this device`
    : syncStatus?.conflicts
      ? `${syncStatus.conflicts} conflict${syncStatus.conflicts === 1 ? '' : 's'} on this device ${syncStatus.conflicts === 1 ? 'needs' : 'need'} review`
      : lastFullSyncIssueCount > 0
        ? `${lastFullSyncIssueCount} ${lastFullSyncIssueCount === 1 ? 'item needs' : 'items need'} retry`
      : 'All caught up';
  const syncNeedsAttention =
    pendingSyncCount > 0 ||
    Boolean(syncStatus?.conflicts) ||
    Boolean(syncStatus?.recoveryAvailable) ||
    lastFullSyncIssueCount > 0;

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
          {/* Whenever a conflict is saved here, pending work or not: it is the only way into conflict review (whole-app audit A7 pass 12 M-1). */}
          {syncStatus?.conflicts || syncConflicts.length > 0 ? (
            <SecondaryButton
              label="Review Conflicts"
              icon="git-compare-outline"
              onPress={openConflictReview}
            />
          ) : null}
          {syncAttemptMessage ? (
            <Text style={styles.cardText} selectable>{syncAttemptMessage}</Text>
          ) : null}

          {signedInHere ? (
            <>
              <Text style={styles.cardText}>
                {signInPending
                  ? `Signed in as ${pendingAccountEmail || 'your account'} (offline, sign-in pending).`
                  : `Signed in as ${connectionStatus?.userEmail || 'your account'}.`}
              </Text>

              <SecondaryButton
                label={signingOut ? 'Signing out…' : 'Sign Out'}
                icon="log-out-outline"
                onPress={() => { void handleSignOut(); }}
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
        onKeepCloud={(conflict, newerPhoneEdit) => confirmConflictResolution(conflict, 'keep_cloud', newerPhoneEdit)}
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
              <Text style={styles.settingsRowDetail}>
                {syncStatus?.recoveryAvailable
                  ? `${recoveryCopyLabel} ${recoveryCopyVerb} review; current sync data remains protected`
                  : "Export or import this phone's local project data"}
              </Text>
            </View>
            <Ionicons name={dataRecoveryOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedText} />
          </TouchableOpacity>
          {dataRecoveryOpen ? (
            <>
              {syncStatus?.recoveryAvailable ? (
                <Text style={styles.actionSummary} selectable>
                  Current saved changes remain protected. Older recovery copies are kept separately until their contents can be verified; do not clear the app's local data.
                </Text>
              ) : null}
              <Text style={styles.actionSummary}>
                {DEVICE_BACKUP_SCOPE_NOTICE} A large backup is saved as several files of up to 128 MB each; save every part, because a restore needs all of them. Use a passphrase of at least 12 characters. Vitruvius cannot recover a forgotten passphrase.
              </Text>
              <TextInput
                style={styles.modalInput}
                value={backupPassphrase}
                onChangeText={setBackupPassphrase}
                placeholder="Backup passphrase"
                placeholderTextColor={colors.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="newPassword"
                accessibilityLabel="Backup passphrase"
              />
              <SettingsActionRow
                icon="download-outline"
                title="Export Limited Device Backup"
                detail="Encrypt the included local data and files; excludes Field Notes and a full cloud-account restore"
                onPress={() => onBackup(backupPassphrase, true, setAdminActionSummary)}
              />
              <SettingsActionRow
                icon="document-text-outline"
                title="Export Records Only (No Files)"
                detail={DEVICE_RECORDS_ONLY_SCOPE_NOTICE}
                onPress={() => onBackup(backupPassphrase, false)}
              />
              <SettingsActionRow
                icon="cloud-upload-outline"
                title="Restore Device Backup"
                detail="Verify and restore included data only; existing Field Notes are not replaced"
                onPress={() => onRestore(backupPassphrase, setAdminActionSummary)}
                last
              />
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
              <ScreenMetric label="Active Projects" value={localProjects.length} detail="Projects currently shown in Vitruvius" icon={<Ionicons name="folder-open-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="AI Assist" value="Server Routed" detail={aiStatus.message} tone="success" icon={<Ionicons name="sparkles-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Build" value={APP_BUILD_NUMBER} detail={`Version ${APP_VERSION} · True Photo Intelligence`} tone="success" icon={<Ionicons name="construct-outline" size={18} color={colors.primary} />} />
              <ScreenMetric label="Auth" value={signInPending ? 'Sign-in Pending' : connectionStatus?.authenticated ? 'Signed In' : 'No Session'} detail={signInPending ? `${pendingAccountEmail || 'Saved sign-in'}: offline, refreshes when there is signal` : connectionStatus?.userEmail || 'No active account session'} tone={signInPending ? 'warning' : connectionStatus?.authenticated ? 'success' : 'default'} icon={<Ionicons name="person-circle-outline" size={18} color={colors.primary} />} />
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
    // This phone's own sync status and conflicts do not wait for the cloud
    // check (whole-app audit A7 pass 12 M-1): read after it, they stayed
    // unread while it ran, and when it timed out, and a conflict saved here
    // had no Review Conflicts. Read again once its conflicts are reconciled.
    const readLocalStatus = () => withSyncTimeout(
      Promise.all([getSyncStatus(), getSyncConflicts()]),
      SETTINGS_STATUS_TIMEOUT_MS,
    ).then(([currentSyncStatus, currentConflicts]) => {
      if (!isCurrentRefresh()) return;
      setSyncStatus(currentSyncStatus);
      setSyncConflicts(currentConflicts);
    });
    void readLocalStatus().catch(() => undefined);

    try {
      const [, connection, test] = await withSyncTimeout(
        Promise.all([
          reconcileSyncConflicts(),
          getSupabaseConnectionStatus(),
          nextTest ? Promise.resolve(nextTest) : testSupabaseConnection(),
        ]),
        SETTINGS_STATUS_TIMEOUT_MS,
      );
      await readLocalStatus();

      if (!isCurrentRefresh()) return;

      setConnectionStatus(connection);
      setTestResult(test);
    } catch (error) {
      if (!isCurrentRefresh()) return;
      setAdminActionSummary(
        error === SETTINGS_SYNC_TIMEOUT
          ? 'The cloud status check is taking longer than expected. Saved device changes remain protected while Vitruvius retries.'
          : 'Cloud status could not be refreshed right now.',
      );
    } finally {
      if (isCurrentRefresh()) setIsCheckingConnection(false);
    }
  }

  async function handleTestConnection() {
    setIsTesting(true);
    setAdminActionSummary('Cloud sync tools are available.');

    try {
      const result = await withSyncTimeout(
        testSupabaseConnection(),
        SETTINGS_STATUS_TIMEOUT_MS,
      );
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
      // Started first (whole-app audit A8 pass 1 F5), not waited for: a slow
      // upload kept the field updates from being retried (A8 pass 2 #6).
      const documentRun = startProjectDocumentUploadRun(onRetryDocumentUploads);
      const updatesToRetry = savedUpdates.filter(
        update => update.status === 'queued' || update.status === 'failed',
      );
      // Retry Sync is not a choice between two copies (whole-app audit A7
      // pass 12 M-1): it retried an update in conflict as its card's Retry
      // does, sent it whole over the iPad's newer edit and said it synced, a
      // silent Keep Phone. Left for Review Conflicts, as Sync Now leaves it.
      const retryResults = updatesToRetry.length > 0
        ? await withSyncTimeout(
            Promise.all(updatesToRetry.map(update => onRetryUpdateSync(update, { automatic: true }))),
          )
        : [];
      const queueResult = updatesToRetry.length === 0
        ? await withSyncTimeout(uploadPendingChanges())
        : null;
      const nextSyncStatus = await withSyncTimeout(
        getSyncStatus(),
        SETTINGS_STATUS_TIMEOUT_MS,
      );
      setSyncStatus(nextSyncStatus);

      const syncedUpdates = retryResults.filter(update => update.status === 'sent').length;
      const heldForReview = retryResults.filter(update => update.heldForConflictReview).length;
      const unsyncedUpdates = retryResults.length - syncedUpdates - heldForReview;
      // An update held for conflict review is counted once, as a conflict
      // (whole-app audit A4 pass 15b F2): a newer edit of it, waiting in the
      // queue for review, was also counted as an item needing attention.
      const heldInQueue = nextSyncStatus.heldForConflictReview;
      const remainingQueue = Math.max(0, (queueResult?.queued ?? nextSyncStatus.queuedChanges) - heldInQueue);
      const remainingConflicts = Math.max(nextSyncStatus.conflicts, heldForReview);
      const recoveryAvailable = nextSyncStatus.recoveryAvailable;
      const unsyncedCount = Math.max(unsyncedUpdates, remainingQueue) + documentRun.remaining(failedDocumentCountRef.current);
      const syncSucceeded =
        unsyncedCount === 0 &&
        remainingConflicts === 0 &&
        !recoveryAvailable;
      const message = recoveryAvailable
        ? `Cloud sync finished. Current changes are protected, but ${nextSyncStatus.recoveryCopies} older recovery ${nextSyncStatus.recoveryCopies === 1 ? 'copy still needs' : 'copies still need'} review.${remainingConflicts > 0 ? ` ${remainingConflicts} saved ${remainingConflicts === 1 ? 'conflict also needs' : 'conflicts also need'} review.` : ''}`
        : remainingConflicts > 0 && unsyncedCount > 0
        ? `${unsyncedCount} ${unsyncedCount === 1 ? 'item still needs' : 'items still need'} attention. It remains saved on this phone. ${remainingConflicts} saved ${remainingConflicts === 1 ? 'conflict also needs' : 'conflicts also need'} review.`
        : remainingConflicts > 0
        // Not "clear" while the queue still holds an edit waiting for review.
        ? `${heldInQueue > 0 ? 'Nothing else is waiting to sync' : 'The sync queue is clear'}, but ${remainingConflicts} saved ${remainingConflicts === 1 ? 'conflict needs' : 'conflicts need'} review.`
        : syncSucceeded
        ? `${syncedUpdates || queueResult?.uploaded || 0} pending ${syncedUpdates === 1 || queueResult?.uploaded === 1 ? 'item' : 'items'} synced successfully.`
        : `${unsyncedCount} ${unsyncedCount === 1 ? 'item still needs' : 'items still need'} attention. It remains saved on this phone.`;
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
      setSyncConflicts(
        await withSyncTimeout(
          getSyncConflicts(),
          SETTINGS_STATUS_TIMEOUT_MS,
        ),
      );
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
    // Every task this download brings was in the cloud by now (A6 pass 11 L1).
    const syncStartedAt = new Date().toISOString();
    setIsSyncing(true);
    setLastFullSyncIssueCount(0);
    setSyncAttemptMessage('Preparing project data…');
    setAdminActionSummary('Preparing project data…');

    try {
      // Started first (whole-app audit A8 pass 1 F5), not waited for: the data sync waited for every upload (A8 pass 2 #6).
      const documentRun = startProjectDocumentUploadRun(onRetryDocumentUploads);
      const result = await synchronizeLocalData(
        {
          projects: localProjects,
          savedUpdates,
          projectAreas,
          scheduleItems,
          referenceDocuments,
        },
        progress => {
          // The progress total is this device's pre-reconciliation workload,
          // not a shared-cloud record count. Showing it made healthy devices
          // look out of sync when one had extra local recovery work.
          const message = progress.message;
          setSyncAttemptMessage(message);
          setAdminActionSummary(message);
        },
      );
      const [nextStatus, nextConflicts] = await Promise.all([
        getSyncStatus(),
        getSyncConflicts(),
      ]);
      setSyncStatus(nextStatus);
      onApplyCloudRecovery({ ...result.recovered, syncStartedAt });
      setSyncConflicts(nextConflicts);
      const documentsRemaining = documentRun.remaining(failedDocumentCountRef.current);
      setLastFullSyncIssueCount(Math.max(
        result.errors.length,
        nextStatus.recoveryAvailable ? 1 : 0,
      ) + documentsRemaining);
      const failedItems = [
        ...result.errors.slice(0, 3).map(error => `• ${error}`),
        ...(result.errors.length > 3
          ? [`• ${result.errors.length - 3} more ${result.errors.length - 3 === 1 ? 'item' : 'items'}`]
          : []),
      ];
      // Named after a review sentence too (whole-app audit A4 pass 14 #5): a
      // conflict stays open through Sync Now (A4 pass 13 G2), and its sentence
      // alone hid every other item that failed, each time.
      const otherFailedItems = result.errors.length > 0
        ? [`${result.errors.length} other ${result.errors.length === 1 ? 'item still needs' : 'items still need'} attention:`, ...failedItems]
        : [];
      const syncMessage = nextStatus.recoveryAvailable
        ? [
            `Cloud sync finished. Current changes are protected, but ${nextStatus.recoveryCopies} older recovery ${nextStatus.recoveryCopies === 1 ? 'copy still needs' : 'copies still need'} review.${nextConflicts.length > 0 ? ` ${nextConflicts.length} saved ${nextConflicts.length === 1 ? 'conflict also needs' : 'conflicts also need'} review.` : ''}`,
            ...otherFailedItems,
          ].join('\n')
        : nextConflicts.length > 0
        ? [
            `Cloud sync finished, but ${nextConflicts.length} ${nextConflicts.length === 1 ? 'saved conflict needs' : 'saved conflicts need'} review.`,
            ...otherFailedItems,
          ].join('\n')
        : result.errors.length === 0
        ? `Cloud sync completed. Shared record refreshed: ${result.details.cloudProjectsDownloaded} projects, ${result.details.cloudSchedulesDownloaded} tasks, ${result.details.cloudUpdatesDownloaded} field updates, ${result.details.cloudAreasDownloaded} areas, and ${result.details.cloudDocumentsDownloaded} documents.${result.uploaded > 0 ? ` ${result.uploaded} device change${result.uploaded === 1 ? '' : 's'} uploaded.` : ''}`
        : [
            `Cloud sync finished with ${result.errors.length} ${result.errors.length === 1 ? 'item' : 'items'} still needing attention:`,
            ...failedItems,
          ].join('\n');
      const message = [syncMessage, projectDocumentsStillUploadingNotice(documentsRemaining)].filter(Boolean).join('\n');
      setSyncAttemptMessage(message);
      setAdminActionSummary(message);
      if (result.missingPhotos.length > 0) showMissingPhotoSyncAlert(result.missingPhotos);
    } catch {
      let actualIssueCount = updateSyncAttentionCount + failedDocumentCount;

      try {
        const [nextStatus, nextConflicts] = await Promise.all([
          getSyncStatus(),
          getSyncConflicts(),
        ]);
        setSyncStatus(nextStatus);
        setSyncConflicts(nextConflicts);
        // An update held for conflict review is counted once, as its
        // conflict (whole-app audit A4 pass 16; as Retry Sync, A4 pass 15b
        // F2): its newer edit waiting in the queue was counted again.
        actualIssueCount = Math.max(
          actualIssueCount,
          Math.max(0, nextStatus.queuedChanges - (nextStatus.heldForConflictReview || 0)) +
            nextConflicts.length +
            (nextStatus.recoveryAvailable ? 1 : 0) +
            failedDocumentCount,
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

  /**
   * Review Conflicts opens on the cloud's copies as they are now (whole-app
   * audit A4 pass 16 L3, A7 pass 14 M-1): the "Cloud:" line showed the copy
   * saved when the conflict was found, however often the iPad edited since.
   * Tasks' copies too (A7 pass 15 L-3): it said "Cloud: 0%" after the web
   * set a task to 50%.
   */
  function openConflictReview() {
    setConflictReviewVisible(true);
    void refreshFieldUpdateConflictCloudCopies().then(setSyncConflicts, () => undefined);
    void refreshScheduleItemConflictCloudCopies().then(setSyncConflicts, () => undefined);
  }

  function confirmConflictResolution(
    conflict: SyncConflict,
    resolution: 'keep_local' | 'keep_cloud',
    /**
     * Keep Cloud: a newer edit saved on this phone during the conflict, which it withdraws too (A4 pass 15b F1).
     * For a task, what Keep Cloud will really do with it (review pass 1, sync F4): see keepCloudOnNewerPhoneTaskEdits.
     */
    newerPhoneEdit: boolean | 'discarded' | 'sent' | 'both' = false,
  ) {
    const update = conflictUpdate(conflict, resolution);
    const task = conflictScheduleItem(conflict, resolution);
    const recordName = task?.taskName || update?.projectName || 'this record';
    const title = resolution === 'keep_local' ? 'Keep Phone Copy?' : 'Keep Cloud Copy?';
    const message = resolution === 'keep_local'
      ? `The version saved on this phone for ${recordName} will replace the cloud copy.`
      : `The cloud version for ${recordName} will replace the copy saved on this phone.${newerPhoneEdit ? ` ${newerPhoneEdit === 'sent' ? CONFLICT_NEWER_PHONE_EDIT_SENT : newerPhoneEdit === 'both' ? CONFLICT_NEWER_PHONE_EDIT_SOME_OF_EACH : CONFLICT_NEWER_PHONE_EDIT_DISCARDED}` : ''}`;

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
    /**
     * The conflicts and sync status read again after the choice; `closed`: the conflict was closed without it.
     * `afterOwnRetry`: read again once Settings' own send of a newer edit has ended; the line is then written only
     * when a conflict is open after all, so that it does not go over a line something else has put there since.
     */
    const showConflictsAfterChoice = async (closed: string | null, afterOwnRetry = false) => {
      const [nextConflicts, nextStatus] = await Promise.all([
        getSyncConflicts(),
        getSyncStatus(),
      ]);
      setSyncConflicts(nextConflicts);
      setSyncStatus(nextStatus);
      if (afterOwnRetry && nextConflicts.length === 0) return;
      const remaining = nextConflicts.length > 0
        ? `${nextConflicts.length} ${nextConflicts.length === 1 ? 'conflict remains' : 'conflicts remain'} to review.`
        : null;
      setSyncAttemptMessage(closed
        ? [closed, remaining].filter(Boolean).join(' ')
        : remaining || 'Cloud conflicts resolved.');
      if (nextConflicts.length === 0) setConflictReviewVisible(false);
    };
    setResolvingConflictId(conflict.id);

    try {
      if (conflict.entity === 'schedule_item') {
        // A task's choice too is checked against the cloud copy its row
        // showed (whole-app audit A7 pass 15): Keep Cloud puts that copy back
        // over an edit of this phone's it discards that landed meanwhile.
        const resolvedItem = await resolveScheduleItemSyncConflict(
          conflict.id,
          resolution,
          { cloudCopyShown: conflict.remotePayload },
        );
        onApplyCloudConflictScheduleItem(resolvedItem);
      } else {
        // Checked against the cloud copy this row showed when David chose
        // (whole-app audit A4 pass 17 L1), not one the open-time read saved
        // into the conflict while "Keep Phone Copy?" was up.
        const resolvedUpdate = await resolveProjectUpdateSyncConflict<ProjectUpdate>(
          conflict.id,
          resolution,
          {
            cloudCopyShown: conflict.remotePayload,
            // Keep Cloud's copy goes on the card before the conflict is
            // cleared (A4 pass 19): a document upload finishing in between
            // sent the discarded edit.
            ...(resolution === 'keep_cloud' ? { beforeClose: onApplyCloudConflictUpdate } : {}),
          },
        );
        // Either choice is now the cloud's copy, with nothing more queued for
        // it: the phone shows it as sent. Keep Phone left the card failed,
        // and a document change then sent the phone's whole copy over a newer
        // iPad edit (whole-app audit A7 pass 9 L1). A newer edit made on the
        // phone since the conflict stays as it is: it still owes its own sync.
        // A card reading Sent is not one: a refresh or echo during the
        // conflict showed the iPad's copy there (A4 pass 12 L3).
        // An archive Keep Phone kept is no newer edit (whole-app audit A4
        // pass 17 L2; the check leaves it aside). The card as it is now, not
        // as it was when David tapped (A4 pass 18 L1): sent as it was, it
        // wrote over a photo analysis that landed meanwhile.
        const phoneCopy = savedUpdatesRef.current.find(update => update.id === conflict.localId);
        const newerPhoneEdit = Boolean(phoneCopy) && (phoneCopy!.status === 'queued' || phoneCopy!.status === 'failed') &&
          !projectUpdateCopyIsLastInCloud(phoneCopy!);
        if (resolution === 'keep_cloud') {
          // On the card already: put there before the conflict was cleared.
        } else if (!newerPhoneEdit) {
          onApplyCloudConflictUpdate(resolvedUpdate);
        } else {
          // The newer edit goes up now, after the kept copy, through Settings'
          // Retry callback (A4 pass 17): its card already read Waiting to
          // Sync, so nothing started the waiting-update sync that checks its
          // photos, and it waited for the app to come back to the front.
          // No conflict is open now, and it never sends over one. The card
          // takes the kept copy's archive, which hides it, and goes up
          // archived (L2): left as it was, the waiting-update sync sent it
          // un-archived over the kept copy. This callback is the one way
          // Settings writes a card that still owes its sync. The App sends
          // its own card as it is then, with only this archive (A4 pass 19 L1).
          const kept = resolvedUpdate as ArchivableUpdate;
          const card: ArchivableUpdate = kept.isArchived && !(phoneCopy as ArchivableUpdate).isArchived
            ? { ...phoneCopy!, isArchived: true, archivedAt: kept.archivedAt ?? null }
            : phoneCopy!;
          // And when that send has ended, the conflicts and the line under Sync are read again (sync batch Y1, item
          // 5): the line below was written while it was still going, so "Cloud conflicts resolved." stayed on screen
          // when the newer edit then met a conflict of its own, or could not be sent.
          void onRetryUpdateSync(card, { automatic: true }).catch(() => undefined)
            .then(() => showConflictsAfterChoice(null, true)).catch(() => undefined);
        }
      }

      await showConflictsAfterChoice(null);
    } catch (error) {
      // Deleted on another device (whole-app audit A4 pass 16 L2): its
      // conflict is closed, whichever copy was chosen, and nothing was sent.
      // It said "Conflict not resolved", and the list still showed it.
      const stopReason = syncConflictChoiceStopReason(error);
      if (stopReason === 'record_deleted') {
        await showConflictsAfterChoice(conflict.entity === 'schedule_item'
          ? 'This task was deleted on another device, so the conflict is closed.'
          : 'This update was deleted on another device, so the conflict is closed.').catch(() => undefined);
        return;
      }
      // Independent review pass 4, follow-up 2: on a task's card of fields, another change of his to the task that
      // was waiting goes up before the choice is made. When the choice then stops, that change was sent though nothing
      // of the choice was: "Nothing was sent" and "Neither copy was changed" are not true then, and these three say so.
      if (stopReason === 'conflict_closed_other_change_sent') {
        await showConflictsAfterChoice(
          'This task\'s conflict closed by itself when your other change to this task was sent. This choice was not applied.',
        ).catch(() => undefined);
        return;
      }
      if (stopReason === 'cloud_copy_changed_other_change_sent') {
        await getSyncConflicts().then(setSyncConflicts, () => undefined);
        Alert.alert(
          'Cloud copy changed',
          'The cloud copy changed — review again. Your other change to this task was sent. This choice was not applied.',
        );
        return;
      }
      if (stopReason === 'not_applied_other_change_sent') {
        await getSyncConflicts().then(setSyncConflicts, () => undefined);
        Alert.alert(
          'Conflict not resolved',
          'Your other change to this task was sent. This choice was not applied. Check the cloud connection and try again.',
        );
        return;
      }
      // A task's conflict closed while Keep Phone read the cloud (whole-app
      // audit A7 pass 16 L-6): this phone's own edit, already on its way up,
      // landed. It said "The cloud copy changed — review again" over an
      // empty list.
      if (stopReason === 'conflict_closed') {
        await showConflictsAfterChoice(
          'This task\'s conflict closed by itself (an edit from this phone reached the cloud), so nothing was sent.',
        ).catch(() => undefined);
        return;
      }
      // The cloud's copy changed since the screen showed it (whole-app audit
      // A4 pass 16 L3, A7 pass 14 M-1): nothing was sent, and the conflict
      // now holds the copy in the cloud, which the list shows. Keep Phone had
      // put the phone's copy over an iPad edit the screen never showed.
      if (stopReason === 'cloud_copy_changed') {
        await getSyncConflicts().then(setSyncConflicts, () => undefined);
        Alert.alert('Cloud copy changed', 'The cloud copy changed — review again. Nothing was sent.');
        return;
      }
      // A task's Keep Cloud wrote the cloud copy back and the cloud did not
      // answer (whole-app audit A7 pass 16 L-2): the write may have landed,
      // so it does not say "Neither copy was changed". The conflict stays.
      if (stopReason === 'save_unconfirmed') {
        Alert.alert(
          'Conflict not resolved',
          'The cloud did not confirm the change, so it may or may not have been saved. The conflict is still open — check the cloud connection and choose again.',
        );
        return;
      }
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
      void refreshAdminStatus().catch(() => undefined);
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

  async function handleSignOut() {
    // Every unsynced item, not only updates still marked queued: failed
    // updates and queued task, area and document changes were left out of the
    // warning (whole-app audit A1 pass 1); so were documents whose file has
    // not uploaded, which now upload by themselves (whole-app audit A8 pass 1 F5),
    // and field notes waiting to sync, and an unsaved field note, which a
    // sign-out discards (whole-app audit A11 pass 4 L5); and an unsaved
    // Project Walk memory, which it discards too (A11 pass 5 L3); and a
    // recording kept on this device waiting for signal (everyday item 4).
    const [waitingFieldNotes, unsavedFieldNote, unsavedWalkMemory, fieldNotesForReview, keptRecording] = fieldNoteOwnerKey
      ? await Promise.all([
          fieldNotesWaitingToSync(fieldNoteOwnerKey),
          unsavedFieldNoteExists(fieldNoteOwnerKey),
          unsavedWalkMemoryExists(fieldNoteOwnerKey),
          fieldNotesNeedingReview(fieldNoteOwnerKey),
          keptVoiceRecordingExists(fieldNoteOwnerKey).catch(() => false),
        ])
      : [0, false, false, 0, false];
    const unsyncedCount = Math.max(pendingSyncCount, updateSyncAttentionCount + failedDocumentCount);
    const notInCloudCount = unsyncedCount + waitingFieldNotes;
    const discarded = (unsavedFieldNote ? 'The field note you have not saved will be discarded. ' : '') +
      (unsavedWalkMemory ? 'The Project Walk memory you have not saved will be discarded. ' : '') +
      (keptRecording ? 'The recording waiting for signal will be discarded. ' : '');
    const message =
      notInCloudCount > 0
        // A11 pass 7 L1: "syncs after you sign in" covers only items not marked Review needed.
        ? `${discarded}${signOutNotInCloudSentences(notInCloudCount, fieldNotesForReview)} Sign out anyway?`
        : `${discarded}You will need to sign in again to resume cloud sync and photo intelligence.`;

    // Owner answer Q21 (30 Sep 2026): he chooses this device or all devices.
    // Every Sign Out used to sign out his other devices too. The warning above
    // still comes first; both choices clear this phone the same way.
    Alert.alert('Sign Out', `${message}\n\n${SIGN_OUT_CHOICES}`, [
      { text: 'Sign Out of This Device', style: 'destructive', onPress: () => { void performSignOut('local'); } },
      { text: 'Sign Out of All Devices', style: 'destructive', onPress: () => { void performSignOut('global'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function performSignOut(scope: SignOutScope) {
    setSigningOut(true);

    try {
      // Asked for here, after the warning: what it discards goes (everyday item 7). A sign-out
      // this device did not ask for sets the unsaved work aside for the account instead.
      // Open item W1-6: for the account the warning above was about, and for as long as the
      // sign-out takes (it counted as asked for two minutes from the tap only).
      noteSignOutAskedHere(fieldNoteOwnerKey);
      let result: Awaited<ReturnType<typeof signOut>>;
      try {
        result = await signOut(scope);
      } catch {
        // Review pass 1, L7: a sign-out whose call threw is not one he asked for that then happened. It
        // stood as "asked for here" with no limit, and a sign-in ending by itself hours later discarded
        // his unsaved work unasked. Unless the sign-out was already heard (then it did happen, and his
        // work went as he was told), he is told it did not finish, as when it answers that it failed.
        if (clearSignOutAskedHere()) Alert.alert('Sign Out did not finish', 'Try Sign Out again.');
        return;
      }
      if (result.ok) noteAskedSignOutAnswered();
      else clearSignOutAskedHere();
      if (result.code === SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL) {
        // No silent sign-out of this device alone (owner answer Q21): he is
        // told why, and this device is his to choose.
        Alert.alert(
          'Other devices not signed out',
          `${result.error}\n\nYou can sign out of this device now. Your other devices stay signed in.`,
          [
            { text: 'Sign Out of This Device', style: 'destructive', onPress: () => { void performSignOut('local'); } },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
      } else if (!result.ok) {
        // A sign-out that did not happen used to say nothing (owner answer Q13).
        Alert.alert('Sign Out did not finish', result.error || result.message || 'Try Sign Out again.');
      } else if (result.code === SIGNED_OUT_ON_THIS_DEVICE_ONLY) {
        // With no signal only this device signs out; the owner is told so
        // (auth security review, 30 Sep 2026).
        Alert.alert(
          'Signed out on this device',
          result.message || 'Signed out on this device only. Your other devices stay signed in.',
        );
      } else if (result.code === SIGN_IN_ALREADY_ENDED_ON_SERVER) {
        // All Devices with signal back, and the server had already ended this
        // sign-in: this device is signed out, the others were not signed out
        // from here, and he is told how (whole-app audit A1 pass 3 L1).
        Alert.alert('Signed out on this device', result.message || 'This device is signed out.');
      } else if (scope === 'global') {
        Alert.alert('Signed out of all devices', 'Your other devices will be signed out within an hour or when they next have signal.');
      }
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
  /** `newerPhoneEdit`: the phone side shown is an edit saved during the conflict, which Keep Cloud discards too. */
  onKeepCloud: (conflict: SyncConflict, newerPhoneEdit: boolean | 'discarded' | 'sent' | 'both') => void;
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
                These field updates or tasks have different phone and cloud copies. Nothing changes until you choose which copy to keep.
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
          ) : (
            <SyncConflictReviewList
              conflicts={conflicts}
              resolvingConflictId={resolvingConflictId}
              onKeepPhone={onKeepPhone}
              onKeepCloud={onKeepCloud}
            />
          )}
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

/**
 * The conflicts under review, each with the phone's copy and the cloud's.
 * The phone's side is what Keep Phone ends with (whole-app audit A4 pass 15b
 * F1): an edit David saved on this phone during the conflict waits, and Keep
 * Phone sends it after the conflict's own copy, so it is that edit, read from
 * this phone's queue, and not the older copy saved with the conflict. Shown
 * only while Review Conflicts is open.
 */
function SyncConflictReviewList({
  conflicts,
  resolvingConflictId,
  onKeepPhone,
  onKeepCloud,
}: {
  conflicts: SyncConflict[];
  resolvingConflictId: string | null;
  onKeepPhone: (conflict: SyncConflict) => void;
  onKeepCloud: (conflict: SyncConflict, newerPhoneEdit: boolean | 'discarded' | 'sent' | 'both') => void;
}) {
  const queue = useSyncExternalStore(subscribeToQueuedDocumentChanges, queuedDocumentChangesSnapshot);
  return (
    <>
      {conflicts.map(conflict => {
        const newerPhoneUpdate = conflictNewerPhoneUpdate(conflict, queue);
        const phoneUpdate = newerPhoneUpdate ?? conflictUpdate(conflict, 'keep_local');
        const cloudUpdate = conflictUpdate(conflict, 'keep_cloud');
        // A task's side as Keep Phone will send it (sync batch Y1, item 5): with a newer edit of his that still waits.
        // The line showed the copy saved with the conflict; Keep Phone sent the newer value, Keep Cloud gave it up.
        const newerPhoneTask = conflict.entity === 'schedule_item' ? newerPhoneCopyForScheduleItemConflict(conflict, queue) : null;
        const phoneTask = newerPhoneTask ?? conflictScheduleItem(conflict, 'keep_local');
        const cloudTask = conflictScheduleItem(conflict, 'keep_cloud');
        // A task's fields changed on both devices (owner answer Q28): those fields, as each copy has them.
        const askedFields = scheduleItemConflictFields(conflict.localPayload);
        // A field update's parts changed on each side since the phone's edit began (owner answer Q28).
        const updateChanges = conflict.entity === 'project_update' ? fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload) : null;
        const resolving = resolvingConflictId === conflict.id;

        return (
          <View key={conflict.id} style={styles.conflictCard}>
            <Text style={styles.conflictTitle}>
              {phoneTask?.taskName ||
                cloudTask?.taskName ||
                phoneUpdate?.projectName ||
                cloudUpdate?.projectName ||
                'Project record'}
            </Text>
            {updateChanges ? (
              <Text style={styles.settingsRowDetail}>{updateChanges}</Text>
            ) : null}
            {askedFields.length > 0 ? (
              <Text style={styles.settingsRowDetail}>
                Changed on this phone and on another device: {askedFields.map(scheduleItemConflictFieldLabel).join(', ')}.
              </Text>
            ) : null}
            <Text style={styles.settingsRowDetail}>
              Phone: {phoneTask
                ? askedFields.length > 0 ? scheduleItemConflictCopyOfFields(phoneTask, askedFields) : formatTaskConflictCopy(phoneTask)
                : formatConflictCopy(phoneUpdate)}
            </Text>
            {newerPhoneUpdate || newerPhoneTask ? (
              <Text style={styles.settingsRowDetail}>{CONFLICT_NEWER_PHONE_EDIT_NOTE}</Text>
            ) : null}
            <Text style={styles.settingsRowDetail}>
              Cloud: {cloudTask
                ? askedFields.length > 0 ? scheduleItemConflictCopyOfFields(cloudTask, askedFields) : formatTaskConflictCopy(cloudTask)
                : formatConflictCopy(cloudUpdate)}
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
                onPress={() => onKeepCloud(conflict, newerPhoneTask ? keepCloudOnNewerPhoneTaskEdits(conflict, queue) ?? true : Boolean(newerPhoneUpdate))}
                disabled={Boolean(resolvingConflictId)}
                compact
              />
            </View>
          </View>
        );
      })}
    </>
  );
}

/** A field update as the App stores it, with its archive (the shared type leaves it out). */
type ArchivableUpdate = ProjectUpdate & { isArchived?: boolean; archivedAt?: string | null };

const CONFLICT_NEWER_PHONE_EDIT_NOTE = 'Includes a change you made after the conflict was found.';
/** Keep Cloud withdraws every copy of the update waiting on this phone, that edit too, and the card takes the cloud's copy. */
const CONFLICT_NEWER_PHONE_EDIT_DISCARDED = 'The change you made after the conflict was found will also be discarded.';
/** A task only (review pass 1, sync F4): that change is to another part of the task than the card is about, and Keep Cloud does not give it up. */
const CONFLICT_NEWER_PHONE_EDIT_SENT = 'The change you made after the conflict was found is to another part of this task: it will be sent first, not discarded.';
const CONFLICT_NEWER_PHONE_EDIT_SOME_OF_EACH = 'Of the changes you made after the conflict was found, what changes the part this card shows will also be discarded; what changes another part of this task will be sent first, not discarded.';

/** The field update edit saved on this phone during the conflict that Keep Phone sends last, if any (A4 pass 15b F1). */
function conflictNewerPhoneUpdate(
  conflict: SyncConflict,
  queue: readonly SyncQueueItem[],
): ProjectUpdate | null {
  if (conflict.entity !== 'project_update') return null;
  const newer = newerPhoneEditForFieldUpdateConflict(conflict, queue);
  const update = (newer?.payload as { updateData?: unknown } | undefined)?.updateData;
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  return update as ProjectUpdate;
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

function conflictScheduleItem(
  conflict: SyncConflict,
  source: 'keep_local' | 'keep_cloud',
): ScheduleItem | null {
  if (conflict.entity !== 'schedule_item') return null;
  const payload = source === 'keep_local'
    ? conflict.localPayload
    : conflict.remotePayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const item = source === 'keep_local' && record.itemData
    ? record.itemData
    : payload;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  return item as ScheduleItem;
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

function formatTaskConflictCopy(item: ScheduleItem): string {
  const status = item.status || 'Status unavailable';
  const percent = Number.isFinite(item.percentComplete)
    ? `${item.percentComplete}%`
    : 'progress unavailable';
  const area = item.locationName?.trim() || 'No area';
  const note = item.notes?.trim();
  return `${status} · ${percent} · ${area}${note ? ` · ${note.slice(0, 80)}` : ''}`;
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
