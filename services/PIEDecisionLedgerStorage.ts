import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PIEDecisionRecord } from './PIEDecisionLedger';

export const DECISION_LEDGER_LEGACY_STORAGE_KEY = 'projectVisionAI.pieDecisionLedger.v1';
export const DECISION_LEDGER_STORAGE_VERSION = 'v2';

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

  if (!value) {
    return {
      organizationId,
      decisions: [],
      migrationStatus,
    };
  }

  const parsed = JSON.parse(value);
  const decisions = Array.isArray(parsed?.decisions)
    ? parsed.decisions as PIEDecisionRecord[]
    : Array.isArray(parsed)
      ? parsed as PIEDecisionRecord[]
      : [];

  return {
    organizationId,
    decisions: decisions.filter(item => item.organizationId === organizationId),
    migrationStatus,
  };
}

export async function savePIEDecisionLedgerForOrganization(
  organizationId: string,
  decisions: PIEDecisionRecord[],
): Promise<void> {
  const scoped = decisions.filter(item => item.organizationId === organizationId);

  await AsyncStorage.setItem(
    storageKeyForOrganization(organizationId),
    JSON.stringify({
      version: DECISION_LEDGER_STORAGE_VERSION,
      organizationId,
      decisions: scoped,
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

  if (!legacyValue) {
    return {
      checkedAt,
      legacyRecordsFound: 0,
      quarantinedRecords: 0,
      message: null,
    };
  }

  let legacyRecords: PIEDecisionRecord[] = [];
  try {
    const parsed = JSON.parse(legacyValue);
    legacyRecords = Array.isArray(parsed) ? parsed as PIEDecisionRecord[] : [];
  } catch {
    legacyRecords = [];
  }

  const quarantineKey = `${DECISION_LEDGER_LEGACY_STORAGE_KEY}.quarantine.${Date.now()}`;
  await AsyncStorage.setItem(
    quarantineKey,
    JSON.stringify({
      quarantinedAt: checkedAt,
      reason: 'Legacy Layer 4 decision records were stored before trusted organization scoping existed.',
      records: legacyRecords,
    }),
  );
  await AsyncStorage.removeItem(DECISION_LEDGER_LEGACY_STORAGE_KEY);

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
