import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PIEDecisionRecord } from './PIEDecisionLedger';
import type { PIELayer4ActorContext } from './PIELayer4Identity';
import {
  assertLayer4CloudTrusted,
  hasLayer4Permission,
} from './PIELayer4Identity';
import {
  listPIEDecisionRecords,
  savePIEDecisionRecordAtomic,
} from './SupabaseService';

export type PIEDecisionSyncState =
  | 'local_only'
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'failed'
  | 'identity_unavailable'
  | 'organization_unavailable';

export type PIEDecisionSyncMetadata = {
  decisionId: string;
  organizationId: string;
  state: PIEDecisionSyncState;
  queuedAt?: string | null;
  lastAttemptAt?: string | null;
  lastSyncedAt?: string | null;
  error?: string | null;
  conflict?: PIEDecisionSyncConflict | null;
};

export type PIEDecisionSyncConflict = {
  decisionId: string;
  organizationId: string;
  field: string;
  reason: string;
  detectedAt: string;
};

export type PIEDecisionLedgerSyncResult = {
  uploaded: number;
  downloaded: PIEDecisionRecord[];
  conflicts: PIEDecisionSyncConflict[];
  errors: string[];
  lastSuccessfulSyncAt: string | null;
};

const DECISION_LEDGER_SYNC_QUEUE_PREFIX = 'projectVisionAI.pieDecisionLedger.syncQueue.v1';
const DECISION_LEDGER_SYNC_META_PREFIX = 'projectVisionAI.pieDecisionLedger.syncMeta.v1';

export async function queuePIEDecisionForSync(
  decision: PIEDecisionRecord,
): Promise<PIEDecisionSyncMetadata> {
  const queue = await getDecisionSyncQueue(decision.organizationId);
  const nextQueue = [
    decision.id,
    ...queue.filter(id => id !== decision.id),
  ];
  await setDecisionSyncQueue(decision.organizationId, nextQueue);

  const metadata = await updateDecisionSyncMetadata(decision.organizationId, decision.id, {
    state: 'queued',
    queuedAt: new Date().toISOString(),
    error: null,
    conflict: null,
  });

  return metadata;
}

export async function getDecisionSyncMetadata(
  organizationId: string,
): Promise<Record<string, PIEDecisionSyncMetadata>> {
  const value = await AsyncStorage.getItem(syncMetaKey(organizationId));
  if (!value) return {};
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, PIEDecisionSyncMetadata>
    : {};
}

export async function updateDecisionSyncMetadata(
  organizationId: string,
  decisionId: string,
  patch: Partial<PIEDecisionSyncMetadata>,
): Promise<PIEDecisionSyncMetadata> {
  const all = await getDecisionSyncMetadata(organizationId);
  const previous = all[decisionId] || {};
  const next: PIEDecisionSyncMetadata = {
    ...previous,
    ...patch,
    decisionId,
    organizationId,
    state: patch.state || previous.state || 'local_only',
    queuedAt: patch.queuedAt ?? previous.queuedAt ?? null,
    lastAttemptAt: patch.lastAttemptAt ?? previous.lastAttemptAt ?? null,
    lastSyncedAt: patch.lastSyncedAt ?? previous.lastSyncedAt ?? null,
    error: patch.error ?? previous.error ?? null,
    conflict: patch.conflict ?? previous.conflict ?? null,
  };
  await AsyncStorage.setItem(syncMetaKey(organizationId), JSON.stringify({
    ...all,
    [decisionId]: next,
  }));
  return next;
}

export async function syncPIEDecisionLedger({
  decisions,
  identity,
}: {
  decisions: PIEDecisionRecord[];
  identity: PIELayer4ActorContext;
}): Promise<PIEDecisionLedgerSyncResult> {
  const organizationId = identity.organizationId;
  const errors: string[] = [];
  const conflicts: PIEDecisionSyncConflict[] = [];
  let uploaded = 0;
  let downloaded: PIEDecisionRecord[] = [];
  let lastSuccessfulSyncAt: string | null = null;

  try {
    assertLayer4CloudTrusted(identity);
    if (!hasLayer4Permission(identity, 'synchronize_decision_history')) {
      throw new Error('Layer 4 sync requires synchronize_decision_history permission.');
    }
  } catch (error) {
    const state: PIEDecisionSyncState =
      identity.organizationStatus === 'verified'
        ? 'identity_unavailable'
        : 'organization_unavailable';
    await markOrganizationSyncState(organizationId, decisions, state, errorMessage(error));
    return {
      uploaded,
      downloaded,
      conflicts,
      errors: [errorMessage(error)],
      lastSuccessfulSyncAt,
    };
  }

  const queue = await getDecisionSyncQueue(organizationId);
  const queuedSet = new Set(queue);
  const queuedDecisions = decisions.filter(decision => queuedSet.has(decision.id));
  const cloudRecords = await listPIEDecisionRecords(organizationId);

  if (!cloudRecords.ok) {
    const message = cloudRecords.error || cloudRecords.message || 'Decision ledger cloud download failed.';
    await markOrganizationSyncState(organizationId, queuedDecisions, 'failed', message);
    return {
      uploaded,
      downloaded,
      conflicts,
      errors: [message],
      lastSuccessfulSyncAt,
    };
  }

  downloaded = cloudRecords.data || [];
  const cloudById = new Map(downloaded.map(decision => [decision.id, decision]));
  const remainingQueue: string[] = [];

  for (const decision of queuedDecisions) {
    const conflict = detectDecisionSyncConflict(decision, cloudById.get(decision.id));
    if (conflict) {
      conflicts.push(conflict);
      remainingQueue.push(decision.id);
      await updateDecisionSyncMetadata(organizationId, decision.id, {
        state: 'conflict',
        lastAttemptAt: new Date().toISOString(),
        conflict,
        error: conflict.reason,
      });
      continue;
    }

    await updateDecisionSyncMetadata(organizationId, decision.id, {
      state: 'syncing',
      lastAttemptAt: new Date().toISOString(),
      error: null,
    });
    const result = await savePIEDecisionRecordAtomic(decision, identity.actor);

    if (result.ok) {
      uploaded += 1;
      lastSuccessfulSyncAt = new Date().toISOString();
      await updateDecisionSyncMetadata(organizationId, decision.id, {
        state: 'synced',
        lastSyncedAt: lastSuccessfulSyncAt,
        error: null,
        conflict: null,
      });
    } else {
      const message = result.error || result.message || 'Decision ledger sync failed.';
      errors.push(message);
      remainingQueue.push(decision.id);
      await updateDecisionSyncMetadata(organizationId, decision.id, {
        state: 'failed',
        lastAttemptAt: new Date().toISOString(),
        error: message,
      });
    }
  }

  await setDecisionSyncQueue(organizationId, remainingQueue);

  return {
    uploaded,
    downloaded,
    conflicts,
    errors,
    lastSuccessfulSyncAt,
  };
}

export function detectDecisionSyncConflict(
  local: PIEDecisionRecord,
  remote?: PIEDecisionRecord,
): PIEDecisionSyncConflict | null {
  if (!remote) return null;
  if (JSON.stringify(local.immutableSnapshot) !== JSON.stringify(remote.immutableSnapshot)) {
    return conflict(local, 'immutableSnapshot', 'Cloud decision snapshot differs from the local immutable snapshot.');
  }
  if (remote.currentStatus === 'closed' && local.currentStatus !== 'closed') {
    return conflict(local, 'currentStatus', 'Stale offline data cannot reopen a closed cloud decision.');
  }

  const remoteVersions = new Map(remote.versions.map(version => [version.version, version]));
  for (const version of local.versions) {
    const remoteVersion = remoteVersions.get(version.version);
    if (remoteVersion && JSON.stringify(remoteVersion) !== JSON.stringify(version)) {
      return conflict(local, 'versions', `Version ${version.version} conflicts with the cloud append-only version.`);
    }
  }

  const remoteAudit = new Map(remote.auditHistory.map(event => [event.id, event]));
  for (const event of local.auditHistory) {
    const remoteEvent = remoteAudit.get(event.id);
    if (remoteEvent && JSON.stringify(remoteEvent) !== JSON.stringify(event)) {
      return conflict(local, 'auditHistory', `Audit event ${event.id} conflicts with the cloud append-only event.`);
    }
  }

  const remoteOutcomes = new Map(remote.actualOutcomes.map(outcome => [outcome.id, outcome]));
  for (const outcome of local.actualOutcomes) {
    const remoteOutcome = remoteOutcomes.get(outcome.id);
    if (remoteOutcome && JSON.stringify(remoteOutcome) !== JSON.stringify(outcome)) {
      return conflict(local, 'actualOutcomes', `Outcome ${outcome.id} conflicts with cloud outcome history.`);
    }
  }

  return null;
}

async function getDecisionSyncQueue(organizationId: string): Promise<string[]> {
  const value = await AsyncStorage.getItem(syncQueueKey(organizationId));
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

async function setDecisionSyncQueue(
  organizationId: string,
  queue: string[],
): Promise<void> {
  await AsyncStorage.setItem(syncQueueKey(organizationId), JSON.stringify(Array.from(new Set(queue))));
}

async function markOrganizationSyncState(
  organizationId: string,
  decisions: PIEDecisionRecord[],
  state: PIEDecisionSyncState,
  error: string | null,
) {
  await Promise.all(
    decisions.map(decision =>
      updateDecisionSyncMetadata(organizationId, decision.id, {
        state,
        lastAttemptAt: new Date().toISOString(),
        error,
      }),
    ),
  );
}

function conflict(
  decision: PIEDecisionRecord,
  field: string,
  reason: string,
): PIEDecisionSyncConflict {
  return {
    decisionId: decision.id,
    organizationId: decision.organizationId,
    field,
    reason,
    detectedAt: new Date().toISOString(),
  };
}

function syncQueueKey(organizationId: string) {
  return `${DECISION_LEDGER_SYNC_QUEUE_PREFIX}.${safeKey(organizationId)}`;
}

function syncMetaKey(organizationId: string) {
  return `${DECISION_LEDGER_SYNC_META_PREFIX}.${safeKey(organizationId)}`;
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Decision ledger sync failed.';
}
