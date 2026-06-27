import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import type {
  StyleProp,
  ViewStyle,
} from 'react-native';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { ScreenMetric } from '../components/layout/ScreenMetric';
import { ScreenMetricGrid } from '../components/layout/ScreenMetricGrid';
import { ScreenSection } from '../components/layout/ScreenSection';
import {
  SecondaryButton,
} from '../components/ProjectDetailsCard';
import { getAIConfigurationStatus } from '../services/OpenAIService';
import {
  getSupabaseConfigurationStatus,
  getSupabaseConnectionStatus,
  testSupabaseConnection,
  type SupabaseConnectionStatus,
  type SupabaseConnectionTestResult,
} from '../services/SupabaseService';
import {
  getSyncStatus,
  synchronizeLocalData,
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

export function AdminScreen({
  contentStyle,
  localProjects,
  savedUpdates,
  projectAreas,
  scheduleItems,
  referenceDocuments,
  startupConnectionResult,
  onBack,
  onDiagnostics,
  onProjectManagement,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  projectAreas: ProjectArea[];
  scheduleItems: ScheduleItem[];
  referenceDocuments: ReferenceDocument[];
  startupConnectionResult: SupabaseConnectionTestResult | null;
  onBack: () => void;
  onDiagnostics: () => void;
  onProjectManagement: () => void;
}) {
  const aiStatus = getAIConfigurationStatus();
  const supabaseConfig = getSupabaseConfigurationStatus();
  const [connectionStatus, setConnectionStatus] =
    useState<SupabaseConnectionStatus | null>(null);
  const [syncStatus, setSyncStatus] =
    useState<SyncStatus | null>(null);
  const [testResult, setTestResult] =
    useState<SupabaseConnectionTestResult | null>(startupConnectionResult);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let active = true;

    refreshStatus().catch(() => undefined);

    return () => {
      active = false;
    };

    async function refreshStatus() {
      const [connection, sync] = await Promise.all([
        getSupabaseConnectionStatus(),
        getSyncStatus(),
      ]);

      if (!active) return;

      setConnectionStatus(connection);
      setSyncStatus(sync);
    }
  }, []);

  useEffect(() => {
    if (!startupConnectionResult) return;

    setTestResult(startupConnectionResult);
  }, [startupConnectionResult]);

  const connected = testResult?.connected ?? false;
  const cloudProjectCount = testResult?.projectCount;

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        title="Admin"
        subtitle="Cloud, diagnostics, sync, and project management tools."
        onBack={onBack}
      />

      <ScreenSection title="Cloud Status">
        <ScreenMetricGrid>
          <ScreenMetric
            label="Supabase"
            value={supabaseConfig.configured ? 'Configured' : 'Missing'}
            detail={supabaseConfig.projectUrl || supabaseConfig.message}
            tone={supabaseConfig.configured ? 'success' : 'warning'}
            icon={<Ionicons name="cloud-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Connected"
            value={connected ? 'Yes' : 'No'}
            detail={testResult?.error || formatCheckedAt(testResult?.checkedAt)}
            tone={connected ? 'success' : 'warning'}
            icon={<Ionicons name="wifi-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Cloud Projects"
            value={cloudProjectCount === null || cloudProjectCount === undefined ? 'Unknown' : cloudProjectCount}
            detail="Projects visible through Supabase REST"
            tone={cloudProjectCount === null || cloudProjectCount === undefined ? 'warning' : 'default'}
            icon={<Ionicons name="folder-open-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="Sync Queue"
            value={syncStatus?.queuedChanges ?? 0}
            detail={syncStatus?.message || 'Loading sync status'}
            tone={(syncStatus?.queuedChanges ?? 0) > 0 ? 'warning' : 'success'}
            icon={<Ionicons name="sync-outline" size={18} color={colors.primary} />}
          />

          <ScreenMetric
            label="OpenAI"
            value={aiStatus.configured ? 'Configured' : 'Missing'}
            detail={`${aiStatus.provider} / ${aiStatus.model}`}
            tone={aiStatus.configured ? 'success' : 'warning'}
            icon={<Ionicons name="sparkles-outline" size={18} color={colors.primary} />}
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
          Admin Actions
        </Text>

        <Text style={styles.cardText}>
          Run diagnostics, test cloud connectivity, or sync pending local data.
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

          <AdminActionButton
            label={isSyncing ? 'Syncing...' : 'Sync Now'}
            icon="sync-outline"
            onPress={handleSyncNow}
            disabled={isSyncing}
            primary
          />

          <AdminActionButton
            label="Projects"
            icon="folder-open-outline"
            onPress={onProjectManagement}
          />
        </View>

        {actionResult ? (
          <Text style={styles.resultText}>
            {actionResult}
          </Text>
        ) : null}

        {syncProgress ? (
          <Text style={styles.progressText}>
            {syncProgress}
          </Text>
        ) : null}
      </ScreenCard>

      <ScreenSection title="Project Management">
        <ScreenCard>
          <Text style={styles.cardText}>
            Rename, archive, restore, delete, favorite, and search projects from the Project Management screen.
          </Text>

          <SecondaryButton
            label="Open Project Management"
            icon="folder-outline"
            onPress={onProjectManagement}
          />
        </ScreenCard>
      </ScreenSection>

      <ScreenSection title="Admin Placeholders">
        <AdminInfoCard
          title="Backup / Restore"
          text="Backup and restore are still available from Project Management > Data Management. This Admin shortcut can become the permanent home in a future cleanup."
          icon="archive-outline"
        />

        <AdminInfoCard
          title="App Version / Build Info"
          text="Build metadata placeholder. Add EAS build profile, version, runtime version, and update channel here when release metadata is finalized."
          icon="information-circle-outline"
        />

        <AdminInfoCard
          title="Developer Tools"
          text="Developer tools placeholder for future logs, feature flags, environment checks, and support exports."
          icon="hammer-outline"
        />
      </ScreenSection>
    </Screen>
  );

  async function refreshAdminStatus(nextTest?: SupabaseConnectionTestResult) {
    const [connection, sync] = await Promise.all([
      getSupabaseConnectionStatus(),
      getSyncStatus(),
    ]);

    setConnectionStatus(connection);
    setSyncStatus(sync);

    if (nextTest) {
      setTestResult(nextTest);
    }
  }

  async function handleTestConnection() {
    setIsTesting(true);
    setActionResult('Testing Supabase connection...');

    try {
      const result = await testSupabaseConnection();
      await refreshAdminStatus(result);

      setActionResult(
        result.connected
          ? `Connected. Cloud project count: ${result.projectCount ?? 'Unknown'}.`
          : `Supabase read failed${result.status ? ` (${result.status})` : ''}: ${result.error || 'Unknown error'}`,
      );
    } catch (error) {
      setActionResult(
        error instanceof Error
          ? `Supabase connection failed: ${error.message}`
          : 'Supabase connection failed with an unknown error.',
      );
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setActionResult('Syncing pending local and cloud data...');
    setSyncProgress('Starting sync...');

    try {
      const result = await synchronizeLocalData(
        {
          projects: localProjects,
          savedUpdates,
          projectAreas,
          scheduleItems,
          referenceDocuments,
        },
        event => {
          setSyncProgress(
            `${event.message} (${event.completed}/${event.total})`,
          );
        },
      );
      const errorText = result.errors.length
        ? ` Errors: ${result.errors.join(' | ')}`
        : '';

      setActionResult(
        `Sync complete. Uploaded ${result.uploaded} record${result.uploaded === 1 ? '' : 's'}. Downloaded ${result.downloaded} record${result.downloaded === 1 ? '' : 's'}.${errorText}`,
      );
      setSyncProgress(
        `Projects ${result.details.projectsUploaded}, updates ${result.details.updatesUploaded}, photos ${result.details.photosUploaded}, areas ${result.details.areasUploaded}, schedules ${result.details.schedulesUploaded}, documents ${result.details.documentsUploaded}.`,
      );
      await refreshAdminStatus({
        configured: result.configured,
        connected: result.connected,
        projectCount: result.cloudProjectCount,
        checkedAt: result.lastSyncAt || new Date().toISOString(),
        error: result.errors[0],
      });
    } catch (error) {
      setActionResult(
        error instanceof Error
          ? `Sync failed: ${error.message}`
          : 'Sync failed with an unknown error.',
      );
    } finally {
      setIsSyncing(false);
    }
  }
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
});
