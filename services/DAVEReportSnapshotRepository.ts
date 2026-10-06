import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  reportPeriodSentAt,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';
import * as store from './DAVEReportSnapshotStore';
import type {
  DAVEReportPeriodLoad,
  DAVEReportSnapshotCloud,
  SenderIdKeychain,
  SnapshotStorage,
} from './DAVEReportSnapshotStore';
import {
  loadReportSnapshotCloud,
  saveReportSnapshotCloud,
} from './SupabaseService';

/**
 * The phone's report period store: the rules live in DAVEReportSnapshotStore
 * (owner answer 2 Oct, web sends count: the web desktop uses the same ones),
 * given here this device's app storage (the owner storage sandbox keeps the
 * report snapshot prefix for each account), its Keychain and the Supabase
 * client. Every function keeps its earlier signature and defaults.
 */
export type {
  DAVEReportPeriodLoad,
  DAVEReportSharedCheck,
  DAVEReportSnapshotCloud,
  SenderIdKeychain,
} from './DAVEReportSnapshotStore';
export { forgetReportSenderIdSession } from './DAVEReportSnapshotStore';

/**
 * This install's report sender id lives in the Keychain, readable while the
 * device is unlocked and never carried to another device (whole-app audit A6
 * pass 10 L3); the former app-storage id is kept beside it (pass 11 L4). See
 * `reportSenderId` in DAVEReportSnapshotStore.
 */
const KEYCHAIN_SENDER_ID_KEY = 'vitruvius.report-sender-id.v1';
const KEYCHAIN_FORMER_SENDER_ID_KEY = 'vitruvius.report-sender-id.app-storage.v1';
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const readSecureId = async (key: string) => {
  const id = await SecureStore.getItemAsync(key, KEYCHAIN_OPTIONS);
  return typeof id === 'string' && id ? id : null;
};

const deviceKeychain: SenderIdKeychain = {
  available: () => SecureStore.isAvailableAsync(),
  read: () => readSecureId(KEYCHAIN_SENDER_ID_KEY),
  write: id => SecureStore.setItemAsync(KEYCHAIN_SENDER_ID_KEY, id, KEYCHAIN_OPTIONS),
  readFormer: () => readSecureId(KEYCHAIN_FORMER_SENDER_ID_KEY),
  writeFormer: id => SecureStore.setItemAsync(KEYCHAIN_FORMER_SENDER_ID_KEY, id, KEYCHAIN_OPTIONS),
};

/** The owner's shared period through the phone's Supabase client (owner answer Q16). */
const supabaseReportSnapshotCloud: DAVEReportSnapshotCloud = {
  async read(scopeKey, reportFormat) {
    const result = await loadReportSnapshotCloud(scopeKey, reportFormat);
    // A missing table comes back as a quiet stub: this device's own period, as before the migration.
    if (!result.configured || result.stubbed) return null;
    // Anything else that failed was not checked, and the owner is told so (whole-app audit A6 pass 7).
    if (!result.ok || !result.data) throw new Error(result.error || 'The shared report period could not be read.');
    return result.data;
  },
  write: (snapshot, expectedOwnerId) => saveReportSnapshotCloud({
    scopeKey: snapshot.scopeKey,
    format: snapshot.reportFormat as DAVEReportFormat,
    snapshot,
    approvedAt: snapshot.capturedAt,
    deliveredAt: reportPeriodSentAt(snapshot),
    expectedOwnerId,
  }),
};

const phoneStorage: SnapshotStorage = AsyncStorage;

export function loadDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = phoneStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<DAVEReportSnapshot | null> {
  return store.loadDAVEReportSnapshot(scopeKey, reportFormat, storage, cloud);
}

export function loadDAVEReportPeriod(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = phoneStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<DAVEReportPeriodLoad> {
  return store.loadDAVEReportPeriod(scopeKey, reportFormat, storage, cloud);
}

export function saveDAVEReportSnapshot(
  snapshot: DAVEReportSnapshot,
  storage: SnapshotStorage = phoneStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<void> {
  return store.saveDAVEReportSnapshot(snapshot, storage, cloud);
}

export function reportSenderId(
  storage: SnapshotStorage = phoneStorage,
  keychain: SenderIdKeychain = deviceKeychain,
): Promise<string> {
  return store.reportSenderId(storage, keychain);
}

export function reportSnapshotSentHere(
  snapshot: DAVEReportSnapshot | null | undefined,
  storage: SnapshotStorage = phoneStorage,
  keychain: SenderIdKeychain = deviceKeychain,
): Promise<boolean> {
  return store.reportSnapshotSentHere(snapshot, storage, keychain);
}

export function reportApprovalSavedHere(
  approval: DAVEReportSnapshot | null | undefined,
  storage: SnapshotStorage = phoneStorage,
): Promise<boolean> {
  return store.reportApprovalSavedHere(approval, storage);
}

export function rememberReportSentHere(sentAt: string, storage: SnapshotStorage = phoneStorage): Promise<void> {
  return store.rememberReportSentHere(sentAt, storage);
}
