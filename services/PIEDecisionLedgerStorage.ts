import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PIEDecisionRecord } from './PIEDecisionLedger';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';

export const DECISION_LEDGER_LEGACY_STORAGE_KEY = 'projectVisionAI.pieDecisionLedger.v1';
export const DECISION_LEDGER_STORAGE_VERSION = 'v2';
export const DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX =
  `${DECISION_LEDGER_LEGACY_STORAGE_KEY}.quarantine.`;

export type PIEDecisionLedgerMigrationStatus = {
  checkedAt: string;
  legacyRecordsFound: number;
  quarantinedRecords: number;
  message: string | null;
};

export type PIEDecisionLedgerOrganizationState = {
  organizationId: string;
  decisions: PIEDecisionRecord[];
  migrationStatus: PIEDecisionLedgerMigrationStatus;
};

export async function loadPIEDecisionLedgerForOrganization(
  organizationId: string,
): Promise<PIEDecisionLedgerOrganizationState> {
  const migrationStatus = await quarantineLegacyDecisionLedger();
  const value = await AsyncStorage.getItem(storageKeyForOrganization(organizationId));

  if (value === null) {
    return {
      organizationId,
      decisions: [],
      migrationStatus,
    };
  }

  const decisions = await parseOrganizationLedgerOrQuarantine(
    organizationId,
    value,
  );

  return {
    organizationId,
    decisions,
    migrationStatus,
  };
}

export async function savePIEDecisionLedgerForOrganization(
  organizationId: string,
  decisions: PIEDecisionRecord[],
): Promise<void> {
  if (!decisions.every(item => isDecisionRecordForOrganization(item, organizationId))) {
    throw new Error('Cannot store decision records outside the active organization or with an invalid identity.');
  }

  await AsyncStorage.setItem(
    storageKeyForOrganization(organizationId),
    JSON.stringify({
      version: DECISION_LEDGER_STORAGE_VERSION,
      organizationId,
      decisions,
      savedAt: new Date().toISOString(),
    }),
  );
}

export async function upsertPIEDecisionRecordForOrganization(
  organizationId: string,
  record: PIEDecisionRecord,
): Promise<PIEDecisionRecord[]> {
  if (record.organizationId !== organizationId) {
    throw new Error('Cannot store a decision record outside the active organization.');
  }

  const state = await loadPIEDecisionLedgerForOrganization(organizationId);
  const next = [
    record,
    ...state.decisions.filter(item => item.id !== record.id),
  ];
  await savePIEDecisionLedgerForOrganization(organizationId, next);
  return next;
}

export async function quarantineLegacyDecisionLedger(): Promise<PIEDecisionLedgerMigrationStatus> {
  const checkedAt = new Date().toISOString();
  const legacyValue = await AsyncStorage.getItem(DECISION_LEDGER_LEGACY_STORAGE_KEY);

  if (legacyValue === null) {
    return {
      checkedAt,
      legacyRecordsFound: 0,
      quarantinedRecords: 0,
      message: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyValue) as unknown;
  } catch {
    const recovery = await quarantineCorruptLocalValue({
      storage: AsyncStorage,
      storageKey: DECISION_LEDGER_LEGACY_STORAGE_KEY,
      quarantineKeyPrefix: DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX,
      raw: legacyValue,
      replacementRaw: null,
    });
    throw localCorruptionRecoveryError({
      label: 'Legacy decision ledger',
      recovery,
    });
  }

  if (!Array.isArray(parsed) || !parsed.every(isDecisionRecordWithIdentity)) {
    const recovery = await quarantineCorruptLocalValue({
      storage: AsyncStorage,
      storageKey: DECISION_LEDGER_LEGACY_STORAGE_KEY,
      quarantineKeyPrefix: DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX,
      raw: legacyValue,
      replacementRaw: null,
    });
    throw localCorruptionRecoveryError({
      label: 'Legacy decision ledger',
      recovery,
    });
  }

  const legacyRecords = parsed as PIEDecisionRecord[];
  await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey: DECISION_LEDGER_LEGACY_STORAGE_KEY,
    quarantineKeyPrefix: DECISION_LEDGER_LEGACY_QUARANTINE_KEY_PREFIX,
    raw: legacyValue,
    replacementRaw: null,
  });

  return {
    checkedAt,
    legacyRecordsFound: legacyRecords.length,
    quarantinedRecords: legacyRecords.length,
    message: legacyRecords.length > 0
      ? `${legacyRecords.length} legacy decision record${legacyRecords.length === 1 ? '' : 's'} quarantined pending identity verification.`
      : 'Legacy decision storage was checked and no migratable records were found.',
  };
}

export async function loadPIEDecisionLedger(): Promise<PIEDecisionRecord[]> {
  const state = await loadPIEDecisionLedgerForOrganization('local-unverified-anonymous');
  return state.decisions;
}

export async function savePIEDecisionLedger(
  decisions: PIEDecisionRecord[],
): Promise<void> {
  await savePIEDecisionLedgerForOrganization('local-unverified-anonymous', decisions);
}

export async function clearPIEDecisionLedgerForTesting(
  organizationId = 'local-unverified-anonymous',
): Promise<void> {
  await AsyncStorage.removeItem(storageKeyForOrganization(organizationId));
  await AsyncStorage.removeItem(DECISION_LEDGER_LEGACY_STORAGE_KEY);
}

export function storageKeyForOrganization(organizationId: string): string {
  const safeOrganizationId =
    organizationId.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
  return `projectVisionAI.pieDecisionLedger.${DECISION_LEDGER_STORAGE_VERSION}.${safeOrganizationId}`;
}

async function parseOrganizationLedgerOrQuarantine(
  organizationId: string,
  raw: string,
): Promise<PIEDecisionRecord[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return quarantineInvalidOrganizationLedger(organizationId, raw);
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== DECISION_LEDGER_STORAGE_VERSION ||
    parsed.organizationId !== organizationId ||
    typeof parsed.savedAt !== 'string' ||
    !Array.isArray(parsed.decisions) ||
    !parsed.decisions.every(item => isDecisionRecordForOrganization(item, organizationId))
  ) {
    return quarantineInvalidOrganizationLedger(organizationId, raw);
  }

  return parsed.decisions as PIEDecisionRecord[];
}

async function quarantineInvalidOrganizationLedger(
  organizationId: string,
  raw: string,
): Promise<never> {
  const storageKey = storageKeyForOrganization(organizationId);
  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey,
    quarantineKeyPrefix: `${storageKey}.corrupt.`,
    raw,
    replacementRaw: null,
  });
  throw localCorruptionRecoveryError({
    label: 'Organization decision ledger',
    recovery,
  });
}

function isDecisionRecordForOrganization(
  value: unknown,
  organizationId: string,
): value is PIEDecisionRecord {
  return isDecisionRecordWithIdentity(value) && value.organizationId === organizationId;
}

function isDecisionRecordWithIdentity(value: unknown): value is PIEDecisionRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.organizationId === 'string' &&
    value.organizationId.length > 0 &&
    typeof value.projectId === 'string' &&
    value.projectId.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
