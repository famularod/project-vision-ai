import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import {
  getAIEnvironmentStatus,
  getAIConfigurationStatus,
} from '../services/OpenAIService';
import {
  getSupabaseConfigurationStatus,
  getSupabaseConnectionStatus,
  testSupabaseConnection,
  type SupabaseConnectionTestResult,
  type SupabaseConnectionStatus,
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
import { formatFeet, hasSavedAreaLocation } from '../utils/locations';

export function DiagnosticsScreen({
  projectAreas,
  referenceDocuments,
  localProjects,
  savedUpdates,
  scheduleItems,
  startupConnectionResult,
  onBack,
}: {
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  startupConnectionResult: SupabaseConnectionTestResult | null;
  onBack: () => void;
}) {
  const areasWithGps = projectAreas.filter(area => hasSavedAreaLocation(area)).length;
  const aiEnvironment = getAIEnvironmentStatus();
  const aiStatus = getAIConfigurationStatus();
  const [cloudProjectCount, setCloudProjectCount] = useState<number | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [connectionTest, setConnectionTest] =
    useState<SupabaseConnectionTestResult | null>(startupConnectionResult);
  const [supabaseStatus, setSupabaseStatus] =
    useState<SupabaseConnectionStatus>(() => ({
      ...getSupabaseConfigurationStatus(),
      clientReady: false,
      authenticated: false,
      userEmail: null,
      checkedAt: new Date().toISOString(),
    }));
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      getSupabaseConnectionStatus(),
      getSyncStatus(),
      testSupabaseConnection(),
    ]).then(
      ([connection, sync, cloudConnection]) => {
        if (!active) return;

        setSupabaseStatus(connection);
        setSyncStatus(sync);
        setConnectionTest(cloudConnection);
        setSupabaseConnected(cloudConnection.connected);
        setCloudProjectCount(cloudConnection.projectCount);
      },
    );

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!startupConnectionResult) return;

    setConnectionTest(startupConnectionResult);
    setSupabaseConnected(startupConnectionResult.connected);
    setCloudProjectCount(startupConnectionResult.projectCount);
  }, [startupConnectionResult]);

  return (
    <View>
      <ScreenTitle
        title="ADMIN DIAGNOSTICS TEST 9999"
        subtitle="Basic setup status for locations, GPS, documents, and app data."
      />

      <SecondaryButton
        label="Back to Projects"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>System Check</Text>
        <Text style={styles.bodyText}>
          Project areas configured: {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          GPS locations saved: {areasWithGps} of {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          Reference documents saved: {referenceDocuments.length}
        </Text>
        <Text style={styles.bodyText}>
          Core navigation, storage, GPS setup, and document tracking are available.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Cloud Services</Text>

        <Text style={styles.bodyText}>
          Environment values detected by the running app bundle:
        </Text>

        <StatusRow
          label="OpenAI Provider detected"
          value={aiEnvironment.providerDetected}
          ok={Boolean(aiEnvironment.providerDetected)}
        />
        <StatusRow
          label="OpenAI Model detected"
          value={aiEnvironment.modelDetected}
          ok={Boolean(aiEnvironment.modelDetected)}
        />
        <StatusRow
          label="OpenAI API Key Present"
          value={aiEnvironment.apiKeyPresent ? 'Yes' : 'No'}
          ok={aiEnvironment.apiKeyPresent}
        />
        <StatusRow
          label="Supabase URL Present"
          value={supabaseStatus.urlConfigured ? 'Yes' : 'No'}
          ok={supabaseStatus.urlConfigured}
        />
        <StatusRow
          label="Supabase Anon Key Present"
          value={supabaseStatus.anonKeyConfigured ? 'Yes' : 'No'}
          ok={supabaseStatus.anonKeyConfigured}
        />

        <StatusRow
          label="Supabase URL"
          value={
            supabaseStatus.urlConfigured
              ? 'Configured'
              : 'Missing'
          }
          ok={supabaseStatus.urlConfigured}
        />
        <StatusRow
          label="Supabase Connected"
          value={
            isSupabaseConnected(
              supabaseConnected,
              supabaseStatus,
              connectionTest,
            )
              ? 'Yes'
              : 'No'
          }
          ok={isSupabaseConnected(supabaseConnected, supabaseStatus, connectionTest)}
        />
        <StatusRow
          label="Authentication Status"
          value={
            supabaseStatus.authenticated
              ? supabaseStatus.userEmail || 'Signed in'
              : 'No active user session'
          }
          ok={supabaseStatus.configured}
        />
        <StatusRow
          label="OpenAI Configured"
          value={aiStatus.configured ? 'Yes' : 'No'}
          ok={aiStatus.configured}
        />
        <StatusRow
          label="AI Provider"
          value={aiStatus.provider}
          ok={aiStatus.provider === 'openai'}
        />
        <StatusRow
          label="OpenAI Model"
          value={aiStatus.model}
          ok={Boolean(aiStatus.model)}
        />
        <StatusRow
          label="Last Sync Time"
          value={formatSyncTime(syncStatus?.lastSyncAt ?? null)}
          ok={Boolean(syncStatus?.lastSyncAt)}
        />
        <StatusRow
          label="Local Project Count"
          value={`${localProjects.length}`}
          ok={localProjects.length >= 0}
        />
        <StatusRow
          label="Cloud Project Count"
          value={cloudProjectCount === null ? 'Unknown' : `${cloudProjectCount}`}
          ok={cloudProjectCount !== null}
        />
        <StatusRow
          label="Sync Queue Count"
          value={`${syncStatus?.queuedChanges ?? 0}`}
          ok={(syncStatus?.queuedChanges ?? 0) === 0}
        />

        <Text style={styles.bodyText}>
          {syncStatus?.message ?? supabaseStatus.message} {aiStatus.message}
        </Text>

        <View style={styles.dataActionRow}>
          <PrimaryButton
            label={isTestingConnection ? 'Testing...' : 'Test Connection'}
            icon="cloud-done-outline"
            onPress={handleTestConnection}
            disabled={isTestingConnection}
            compact
          />

          <SecondaryButton
            label={isSyncing ? 'Syncing...' : 'Sync Now'}
            icon="sync-outline"
            onPress={handleSyncNow}
            compact
          />
        </View>

        {connectionResult ? (
          <Text style={styles.bodyText}>{connectionResult}</Text>
        ) : null}

        {syncResult ? (
          <Text style={styles.bodyText}>{syncResult}</Text>
        ) : null}

        {syncProgress ? (
          <Text style={styles.rowSub}>{syncProgress}</Text>
        ) : null}

        <Text style={styles.rowSub}>
          Last checked {formatCheckedAt(supabaseStatus.checkedAt)}
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>GPS Setup Status</Text>
        {projectAreas.length === 0 ? (
          <Text style={styles.bodyText}>No project areas have been created yet.</Text>
        ) : (
          projectAreas.map(area => (
            <View key={area.id} style={styles.checklistRow}>
              <Ionicons
                name={hasSavedAreaLocation(area) ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={hasSavedAreaLocation(area) ? colors.success : colors.warning}
              />
              <View style={styles.rowMain}>
                <Text style={styles.projectName}>{area.name}</Text>
                <Text style={styles.rowSub}>
                  {hasSavedAreaLocation(area)
                    ? `GPS saved | Radius ${formatFeet(area.radiusFeet)}`
                    : `GPS missing | Radius ${formatFeet(area.radiusFeet)}`}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );

  async function refreshCloudStatus() {
    const [connection, sync, cloudConnection] = await Promise.all([
      getSupabaseConnectionStatus(),
      getSyncStatus(),
      testSupabaseConnection(),
    ]);

    setSupabaseStatus(connection);
    setSyncStatus(sync);
    setConnectionTest(cloudConnection);
    setSupabaseConnected(cloudConnection.connected);
    setCloudProjectCount(cloudConnection.projectCount);
  }

  async function handleTestConnection() {
    setIsTestingConnection(true);
    setConnectionResult('Testing Supabase connection...');

    try {
      const result = await testSupabaseConnection();

      setConnectionTest(result);
      setSupabaseConnected(result.connected);
      setCloudProjectCount(result.projectCount);

      if (!result.connected) {
        setConnectionResult(
          `Supabase read failed${result.status ? ` (${result.status})` : ''}: ${result.error || 'Unknown error'}`,
        );
        return;
      }

      setConnectionResult(
        `Connected. Cloud project count: ${result.projectCount ?? 'Unknown'}.`,
      );
      await refreshCloudStatus();
    } catch (error) {
      setSupabaseConnected(false);
      setConnectionResult(
        error instanceof Error
          ? `Supabase connection failed: ${error.message}`
          : 'Supabase connection failed with an unknown error.',
      );
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncResult('Syncing pending local and cloud data...');
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

      setCloudProjectCount(result.cloudProjectCount);
      setSupabaseConnected(result.connected);
      setSyncResult(
        `Sync complete. Uploaded ${result.uploaded} record${result.uploaded === 1 ? '' : 's'}. Downloaded ${result.downloaded} record${result.downloaded === 1 ? '' : 's'}. Queue ${result.queued}. Conflicts ${result.conflicts}.${errorText}`,
      );
      setSyncProgress(
        `Projects ${result.details.projectsUploaded}, updates ${result.details.updatesUploaded}, photos ${result.details.photosUploaded}, areas ${result.details.areasUploaded}, schedules ${result.details.schedulesUploaded}, documents ${result.details.documentsUploaded}.`,
      );
      await refreshCloudStatus();
    } catch (error) {
      setSyncResult(
        error instanceof Error
          ? `Sync failed: ${error.message}`
          : 'Sync failed with an unknown error.',
      );
    } finally {
      setIsSyncing(false);
    }
  }
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={styles.checklistRow}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={20}
        color={ok ? colors.success : colors.warning}
      />
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{label}</Text>
        <Text style={styles.rowSub}>{value}</Text>
      </View>
    </View>
  );
}

function formatCheckedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'recently';

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSyncTime(value: string | null) {
  if (!value) return 'Never';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isSupabaseConnected(
  testedConnection: boolean | null,
  status: SupabaseConnectionStatus,
  connectionTest: SupabaseConnectionTestResult | null,
) {
  return connectionTest?.connected ?? testedConnection ?? false;
}
