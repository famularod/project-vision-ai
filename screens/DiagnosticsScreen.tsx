import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
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
} from '../services/AIClientBoundaryService';
import {
  getSupabaseConfigurationStatus,
  getSupabaseConnectionStatus,
  runSupabaseConnectionDiagnostics,
  testSupabaseConnection,
  type SupabaseConnectionDiagnostics,
  type SupabaseConnectionTestResult,
  type SupabaseDiagnosticStep,
  type SupabaseConnectionStatus,
} from '../services/SupabaseService';
import {
  getSyncStatus,
  sanitizeUserFacingSyncMessage,
  synchronizeLocalData,
  type MissingSyncPhoto,
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
  syncCleanupNotice,
  onBack,
  onRemoveMissingPhotos,
}: {
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  localProjects: string[];
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  startupConnectionResult: SupabaseConnectionTestResult | null;
  syncCleanupNotice?: string | null;
  onBack: () => void;
  onRemoveMissingPhotos: (missingPhotos: MissingSyncPhoto[]) => Promise<void>;
}) {
  const areasWithGps = projectAreas.filter(area => hasSavedAreaLocation(area)).length;
  const aiEnvironment = getAIEnvironmentStatus();
  const aiStatus = getAIConfigurationStatus();
  const [cloudProjectCount, setCloudProjectCount] = useState<number | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState<boolean | null>(null);
  const [connectionResult, setConnectionResult] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [networkDiagnostics, setNetworkDiagnostics] =
    useState<SupabaseConnectionDiagnostics | null>(null);
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

  useEffect(() => {
    if (!syncCleanupNotice) return;

    setSyncResult(sanitizeUserFacingSyncMessage(syncCleanupNotice));
  }, [syncCleanupNotice]);

  return (
    <View>
      <ScreenTitle
        title="Raw Diagnostics"
        subtitle="Developer Support details for connection tests, raw cloud diagnostics, and debug data."
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
          label="AI Route detected"
          value={aiEnvironment.providerDetected}
          ok={Boolean(aiEnvironment.providerDetected)}
        />
        <StatusRow
          label="Vision Model detected"
          value={aiEnvironment.modelDetected}
          ok={Boolean(aiEnvironment.modelDetected)}
        />
        <StatusRow
          label="Client API Key Present"
          value={aiEnvironment.apiKeyPresent ? 'Yes' : 'No'}
          ok={!aiEnvironment.apiKeyPresent}
        />
        <StatusRow
          label="Supabase URL Present"
          value={supabaseStatus.urlConfigured ? 'Yes' : 'No'}
          ok={supabaseStatus.urlConfigured}
        />
        <StatusRow
          label="EXPO_PUBLIC_SUPABASE_URL"
          value={supabaseStatus.rawProjectUrl || 'Missing'}
          ok={supabaseStatus.urlConfigured}
        />
        <StatusRow
          label="createClient URL"
          value={supabaseStatus.createClientUrl || 'Not passed to createClient'}
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
            supabaseStatus.projectUrl || 'Missing'
          }
          ok={supabaseStatus.urlConfigured}
        />
        <StatusRow
          label="Supabase Client Initialized"
          value={supabaseStatus.clientReady ? 'Yes' : 'No'}
          ok={supabaseStatus.clientReady}
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
          label="Client AI Disabled"
          value="Yes"
          ok
        />
        <StatusRow
          label="Photo Intelligence Route"
          value={aiStatus.provider}
          ok={aiStatus.provider === 'edge-function-only'}
        />
        <StatusRow
          label="Vision Model"
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
          {sanitizeUserFacingSyncMessage(syncStatus?.message ?? supabaseStatus.message)} {aiStatus.message}
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

        {networkDiagnostics ? (
          <View>
            <DiagnosticValueRow
              label="rawSupabaseUrl"
              value={networkDiagnostics.rawSupabaseUrl || 'Missing'}
            />
            <DiagnosticValueRow
              label="supabaseUrl"
              value={networkDiagnostics.supabaseUrl || 'Missing'}
            />
            <DiagnosticValueRow
              label="createClientUrl"
              value={
                networkDiagnostics.createClientUrl ||
                'Not passed to createClient'
              }
            />
            <DiagnosticValueRow
              label="rootFetch.url"
              value={networkDiagnostics.rootFetch.url}
            />
            <DiagnosticValueRow
              label="rootFetch.reachedNetwork"
              value={networkDiagnostics.rootFetch.reachedNetwork ? 'Yes' : 'No'}
            />
            <DiagnosticValueRow
              label="rootFetch.status"
              value={formatDiagnosticStatus(networkDiagnostics.rootFetch)}
            />
            <DiagnosticValueRow
              label="rootFetch.errorName"
              value={networkDiagnostics.rootFetch.errorName || 'None'}
            />
            <DiagnosticValueRow
              label="rootFetch.errorMessage"
              value={networkDiagnostics.rootFetch.errorMessage || 'None'}
            />
            <DiagnosticValueRow
              label="restFetch.url"
              value={networkDiagnostics.restFetch.url}
            />
            <DiagnosticValueRow
              label="restFetch.reachedNetwork"
              value={networkDiagnostics.restFetch.reachedNetwork ? 'Yes' : 'No'}
            />
            <DiagnosticValueRow
              label="restFetch.status"
              value={formatDiagnosticStatus(networkDiagnostics.restFetch)}
            />
            <DiagnosticValueRow
              label="restFetch.errorName"
              value={networkDiagnostics.restFetch.errorName || 'None'}
            />
            <DiagnosticValueRow
              label="restFetch.errorMessage"
              value={networkDiagnostics.restFetch.errorMessage || 'None'}
            />
            <DiagnosticValueRow
              label="restFetch.responsePreview"
              value={networkDiagnostics.restFetch.responsePreview || 'None'}
            />
          </View>
        ) : null}

        {syncResult ? (
          <Text style={styles.bodyText}>{sanitizeUserFacingSyncMessage(syncResult)}</Text>
        ) : null}

        {syncProgress ? (
          <Text style={styles.rowSub}>{sanitizeUserFacingSyncMessage(syncProgress)}</Text>
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
    setNetworkDiagnostics(null);

    try {
      const diagnostics = await runSupabaseConnectionDiagnostics();
      setNetworkDiagnostics(diagnostics);

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
        'Supabase connection could not be verified right now.',
      );
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    setSyncResult(sanitizeUserFacingSyncMessage('Syncing pending local and cloud data...'));
    setSyncProgress(sanitizeUserFacingSyncMessage('Starting sync...'));

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
            sanitizeUserFacingSyncMessage(
              `${event.message} (${event.completed}/${event.total})`,
            ),
          );
        },
      );
      const reviewedCount =
        result.uploaded + result.downloaded + result.queued;
      const missingPhotoText = formatMissingPhotoSyncMessage(
        result.missingPhotos.length,
      );
      const resultTitle =
        result.errors.length || result.missingPhotos.length
          ? 'Cloud Sync\nPartial sync complete.'
          : 'Cloud Sync\nSync complete.';

      setCloudProjectCount(result.cloudProjectCount);
      setSupabaseConnected(result.connected);
      setSyncResult(
        sanitizeUserFacingSyncMessage([
          resultTitle,
          `${reviewedCount} item${reviewedCount === 1 ? '' : 's'} reviewed.`,
          missingPhotoText,
          result.errors.length
            ? 'Some records could not sync and will be retried.'
            : null,
        ]
          .filter(Boolean)
          .join('\n')),
      );
      setSyncProgress(
        sanitizeUserFacingSyncMessage(
          `Projects ${result.details.projectsUploaded}, updates ${result.details.updatesUploaded}, photos ${result.details.photosUploaded}, areas ${result.details.areasUploaded}, schedules ${result.details.schedulesUploaded}, documents ${result.details.documentsUploaded}.`,
        ),
      );
      await refreshCloudStatus();

      if (result.missingPhotos.length > 0) {
        showMissingPhotoSyncAlert(result.missingPhotos);
      }
    } catch (error) {
      setSyncResult(sanitizeUserFacingSyncMessage('Sync could not finish. Retry when you have a stable connection.'));
    } finally {
      setIsSyncing(false);
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
              setSyncResult(
                `${count} missing photo${count === 1 ? '' : 's'} removed from local updates and sync queue.`,
              );
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

function DiagnosticValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.checklistRow}>
      <Ionicons
        name="information-circle-outline"
        size={20}
        color={colors.primary}
      />
      <View style={styles.rowMain}>
        <Text style={styles.projectName}>{label}</Text>
        <Text style={styles.rowSub}>{value}</Text>
      </View>
    </View>
  );
}

function formatDiagnosticStatus(step: SupabaseDiagnosticStep) {
  if (typeof step.status !== 'number') return 'Unavailable';

  return `${step.status}${step.statusText ? ` ${step.statusText}` : ''}`;
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
