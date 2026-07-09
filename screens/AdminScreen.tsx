import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingModalCard } from '../components/KeyboardAvoidingModalCard';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { ScreenMetric } from '../components/layout/ScreenMetric';
import { ScreenMetricGrid } from '../components/layout/ScreenMetricGrid';
import { ScreenSection } from '../components/layout/ScreenSection';
import { ManageAreasPanel } from '../components/ManageAreasPanel';
import {
  PrimaryButton,
  SecondaryButton,
} from '../components/ProjectDetailsCard';
import { getAIConfigurationStatus } from '../services/AIClientBoundaryService';
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
  synchronizeLocalData,
  type MissingSyncPhoto,
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

export function AdminScreen({
  contentStyle,
  localProjects,
  savedUpdates,
  projectAreas,
  scheduleItems,
  referenceDocuments,
  startupConnectionResult,
  syncCleanupNotice,
  onBack,
  onDiagnostics,
  onProjectManagement,
  onReferenceDocuments,
  onSchedule,
  onBackup,
  onRestore,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
  onRemoveMissingPhotos,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  startupConnectionResult: SupabaseConnectionTestResult | null;
  syncCleanupNotice?: string | null;
  onBack: () => void;
  onDiagnostics: () => void;
  onProjectManagement: () => void;
  onReferenceDocuments: () => void;
  onSchedule: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
  onRemoveMissingPhotos: (missingPhotos: MissingSyncPhoto[]) => Promise<void>;
}) {
  const aiStatus = getAIConfigurationStatus();
  const supabaseConfig = getSupabaseConfigurationStatus();
  const [connectionStatus, setConnectionStatus] =
    useState<SupabaseConnectionStatus | null>(null);
  const [testResult, setTestResult] =
    useState<SupabaseConnectionTestResult | null>(startupConnectionResult);
  const [adminActionSummary, setAdminActionSummary] =
    useState('Cloud sync tools are available.');
  const [advancedConfigOpen, setAdvancedConfigOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [signInModalVisible, setSignInModalVisible] = useState(false);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    refreshStatus().catch(() => undefined);

    return () => {
      active = false;
    };

    async function refreshStatus() {
      const connection = await getSupabaseConnectionStatus();

      if (!active) return;

      setConnectionStatus(connection);
    }
  }, []);

  useEffect(() => {
    if (!startupConnectionResult) return;

    setTestResult(startupConnectionResult);
  }, [startupConnectionResult]);

  useEffect(() => {
    if (!syncCleanupNotice) return;

    setAdminActionSummary('Sync status cleaned up.');
  }, [syncCleanupNotice]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthStateChange(() => {
      void refreshAdminStatus();
    });

    return unsubscribe;
  }, []);

  const connected = testResult?.connected ?? false;
  const cloudProjectCount = testResult?.projectCount;

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="More"
        subtitle="Projects, schedule, documents, history, settings, admin, and developer tools."
        onBack={onBack}
      />

      <ScreenSection title="System Status">
        <ScreenMetricGrid>
          <ScreenMetric
            label="Cloud"
            value={supabaseConfig.configured ? 'Ready' : 'Needs Setup'}
            detail={
              supabaseConfig.configured
                ? 'Cloud configuration is ready.'
                : 'Cloud setup needs review.'
            }
            tone={supabaseConfig.configured ? 'success' : 'warning'}
            icon={<Ionicons name="cloud-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Connected"
            value={connected ? 'Yes' : 'No'}
            detail={
              connected
                ? formatCheckedAt(testResult?.checkedAt)
                : 'Cloud connection needs review.'
            }
            tone={connected ? 'success' : 'warning'}
            icon={<Ionicons name="wifi-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Cloud Projects"
            value={cloudProjectCount === null || cloudProjectCount === undefined ? 'Unknown' : cloudProjectCount}
            detail="Projects synced through cloud"
            tone={cloudProjectCount === null || cloudProjectCount === undefined ? 'warning' : 'default'}
            icon={<Ionicons name="folder-open-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="PIE Assist"
            value="Server Routed"
            detail={aiStatus.message}
            tone="success"
            icon={<Ionicons name="sparkles-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Build"
            value="22"
            detail="True Photo Intelligence"
            tone="success"
            icon={<Ionicons name="construct-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Auth"
            value={connectionStatus?.authenticated ? 'Signed In' : 'No Session'}
            detail={connectionStatus?.userEmail || 'Future multi-user support'}
            tone={connectionStatus?.authenticated ? 'success' : 'default'}
            icon={<Ionicons name="person-circle-outline" size={18} color={colors.primary} />}
          />
        </ScreenMetricGrid>
      </ScreenSection>

      <ScreenCard>
        <Text style={styles.cardTitle}>
          Admin
        </Text>

        <Text style={styles.cardText}>
          Cloud sync, backup, and restore tools are available.
        </Text>

        <View style={styles.actionGrid}>
          <AdminActionButton
            label={isSyncing ? 'Syncing...' : 'Sync Now'}
            icon="sync-outline"
            onPress={handleSyncNow}
            disabled={isSyncing}
            primary
          />

          <AdminActionButton
            label="Backup"
            icon="download-outline"
            onPress={onBackup}
          />

          <AdminActionButton
            label="Restore"
            icon="cloud-upload-outline"
            onPress={onRestore}
          />
        </View>

        <Text style={styles.resultText}>
          {adminActionSummary}
        </Text>
      </ScreenCard>

      <ScreenSection title="Projects">
        <ScreenCard>
          <Text style={styles.cardText}>
            Rename, archive, restore, delete, favorite, and search projects from Projects.
          </Text>

          <SecondaryButton
            label="Projects"
            icon="folder-outline"
            onPress={onProjectManagement}
          />
        </ScreenCard>
      </ScreenSection>

      <ScreenSection title="Schedule and Documents">
        <ScreenCard>
          <Text style={styles.cardText}>
            Documents and schedules stay available here so PIE and Capture can stay focused.
          </Text>

          <View style={styles.actionGrid}>
            <AdminActionButton
              label="Documents"
              icon="documents-outline"
              onPress={onReferenceDocuments}
            />

            <AdminActionButton
              label="Schedule"
              icon="calendar-outline"
              onPress={onSchedule}
            />
          </View>
        </ScreenCard>
      </ScreenSection>

      <ScreenSection title="Settings">
        <ScreenCard>
          <View style={styles.infoHeader}>
            <Ionicons
              name="person-circle-outline"
              size={20}
              color={colors.primary}
            />

            <Text style={styles.cardTitle}>
              Account
            </Text>
          </View>

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

      <ScreenSection title="Developer Tools">
        <ScreenCard>
          <Text style={styles.cardTitle}>
            Advanced Configuration
          </Text>

          <Text style={styles.cardText}>
            Area Mapping is an advanced setup tool for PIE location intelligence. Daily project work should happen from PIE, Capture, and Review.
          </Text>

          <SecondaryButton
            label={advancedConfigOpen ? 'Hide Area Mapping' : 'Open Area Mapping'}
            icon={advancedConfigOpen ? 'chevron-up-outline' : 'map-outline'}
            onPress={() => setAdvancedConfigOpen(open => !open)}
          />
        </ScreenCard>

        <ScreenCard>
          <Text style={styles.cardTitle}>
            Developer Support
          </Text>

          <Text style={styles.cardText}>
            Diagnostics, raw cloud diagnostics, connection tests, and debug data are support tools for troubleshooting.
          </Text>

          <View style={styles.actionGrid}>
            <AdminActionButton
              label="Diagnostics"
              icon="pulse-outline"
              onPress={onDiagnostics}
            />

            <AdminActionButton
              label={isTesting ? 'Testing...' : 'Test Connection'}
              icon="cloud-done-outline"
              onPress={handleTestConnection}
              disabled={isTesting}
              primary
            />
          </View>
        </ScreenCard>

        {advancedConfigOpen ? (
          <ManageAreasPanel
            projectAreas={projectAreas}
            onAddArea={onAddArea}
            onUpdateArea={onUpdateArea}
            onDeleteArea={onDeleteArea}
            onUseCurrentLocationForArea={onUseCurrentLocationForArea}
          />
        ) : null}
      </ScreenSection>

      <ScreenSection title="Build Information">
        <AdminInfoCard
          title="App Version / Build Info"
          text="Build metadata placeholder. Add EAS build profile, version, runtime version, and update channel here when release metadata is finalized."
          icon="information-circle-outline"
        />
      </ScreenSection>
    </Screen>
  );

  async function refreshAdminStatus(nextTest?: SupabaseConnectionTestResult) {
    const connection = await getSupabaseConnectionStatus();

    setConnectionStatus(connection);

    if (nextTest) {
      setTestResult(nextTest);
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

  async function handleSyncNow() {
    setIsSyncing(true);
    setAdminActionSummary('Cloud sync tools are available.');

    try {
      const result = await synchronizeLocalData(
        {
          projects: localProjects,
          savedUpdates,
          projectAreas,
          scheduleItems,
          referenceDocuments,
        },
      );

      setAdminActionSummary(
        'Sync completed. Some unavailable photos may be skipped.',
      );
      await refreshAdminStatus({
        configured: result.configured,
        connected: result.connected,
        projectCount: result.cloudProjectCount,
        checkedAt: result.lastSyncAt || new Date().toISOString(),
        error: result.errors.length ? 'Some records could not sync and will be retried.' : undefined,
      });

      if (result.missingPhotos.length > 0) {
        showMissingPhotoSyncAlert(result.missingPhotos);
      }
    } catch {
      setAdminActionSummary(
        'Sync completed. Some unavailable photos may be skipped.',
      );
    } finally {
      setIsSyncing(false);
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
          text: 'Remove Missing Photo',
          style: 'destructive',
          onPress: () => {
            void onRemoveMissingPhotos(missingPhotos).then(() => {
              setAdminActionSummary('Sync completed. Some unavailable photos may be skipped.');
            });
          },
        },
        {
          text: 'Retry',
          onPress: () => {
            void handleSyncNow();
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

function formatMissingPhotoSyncMessage(count: number) {
  if (count <= 0) return null;

  return `${count} photo${count === 1 ? '' : 's'} could not be synced because ${count === 1 ? 'it is' : 'they are'} no longer available.`;
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

function SignInModal({
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
  cardTitle: {
    ...typography.h3,
    marginBottom: spacing.xs,
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
    width: 38,
    height: 38,
    borderRadius: 8,
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
    borderRadius: 8,
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
