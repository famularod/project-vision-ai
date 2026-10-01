/**
 * Whole-app audit A6 pass 10 L3 (30 Sep 2026): the report sender id (pass 9
 * L2) was kept in app storage. A reinstall lost it, so the phone's own
 * earlier send then read "Your other device already sent this report at 6:24
 * PM…"; an iOS backup restored onto the iPad copied it, so both devices had
 * one id, the iPad's sends counted as the phone's own, and Copy sent a third
 * time. It now lives in the Keychain, readable only while the device is
 * unlocked and never carried to another device (WHEN_UNLOCKED_THIS_DEVICE_ONLY),
 * so it survives a reinstall and stays behind in a backup. The id pass 9 kept
 * in app storage moves there once. Neither it nor the Keychain item is in the
 * account sandbox: it names the install, not the account.
 */
const mockKeychain = new Map<string, string>();
let mockKeychainWorks = true;
let mockKeychainLocked = false;
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(async () => mockKeychainWorks),
  getItemAsync: jest.fn(async (key: string) => {
    if (!mockKeychainWorks || mockKeychainLocked) throw new Error('Keychain unavailable');
    return mockKeychain.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (!mockKeychainWorks) throw new Error('Keychain unavailable');
    mockKeychain.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeychain.delete(key);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: false, data: null })),
  saveReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: false, data: null })),
}));

import * as SecureStore from 'expo-secure-store';
import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reportSenderId, reportSnapshotSentHere } from '../../services/DAVEReportSnapshotRepository';
import { isOwnerSensitiveCanonicalStorageKey } from '../../services/OwnerStorageSandbox';
import { SCHEDULE_CLOUD_PULL_KEY } from '../../services/ScheduleCloudPull';

const LEGACY_KEY = '@vitruvius/report-sender-id/v1';
const KEYCHAIN_KEY = 'vitruvius.report-sender-id.v1';

function appStorage(initial: Iterable<[string, string]> = []) {
  const values = new Map<string, string>(initial);
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}
const sentBy = (id: string) => ({
  version: 'dave-report-snapshot/1.0', scopeKey: 'tower', reportFormat: 'project_manager',
  capturedAt: '2026-09-30T18:20:00.000Z', deliveredAt: '2026-09-30T18:24:00.000Z',
  sourceFingerprint: 'facts', tasks: [], sentBy: id,
}) as unknown as DAVEReportSnapshot;

beforeEach(() => {
  mockKeychain.clear();
  mockKeychainWorks = true;
  mockKeychainLocked = false;
});

describe('L3: the report sender id is kept in the Keychain, on this device only', () => {
  it('is made once and saved in the Keychain with this-device-only access, not in app storage', async () => {
    const storage = appStorage();
    const id = await reportSenderId(storage);
    expect(id).toMatch(/^[\w-]{16,}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEYCHAIN_KEY, id, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(mockKeychain.get(KEYCHAIN_KEY)).toBe(id);
    expect(storage.values.size).toBe(0);
    expect(await reportSenderId(storage)).toBe(id);
  });

  it('survives a reinstall (app storage wiped): the earlier send is still this device\'s own', async () => {
    const id = await reportSenderId(appStorage());
    const reinstalled = appStorage();
    expect(await reportSenderId(reinstalled)).toBe(id);
    expect(await reportSnapshotSentHere(sentBy(id), reinstalled)).toBe(true);
  });

  it('stays behind in a backup: a device restored from it makes its own, and the phone\'s sends are not its own', async () => {
    const phoneStorage = appStorage();
    const phoneId = await reportSenderId(phoneStorage);
    // The restored iPad: the phone's app storage, but not its this-device-only Keychain item.
    mockKeychain.clear();
    const ipadStorage = appStorage(phoneStorage.values);
    expect(await reportSnapshotSentHere(sentBy(phoneId), ipadStorage)).toBe(false);
    const ipadId = await reportSenderId(ipadStorage);
    expect(ipadId).not.toBe(phoneId);
  });

  it('the id pass 9 kept in app storage moves to the Keychain once, and its sends stay this device\'s own', async () => {
    const storage = appStorage([[LEGACY_KEY, 'legacy-install-id-0123456789']]);
    expect(await reportSnapshotSentHere(sentBy('legacy-install-id-0123456789'), storage)).toBe(true);
    expect(await reportSenderId(storage)).toBe('legacy-install-id-0123456789');
    expect(mockKeychain.get(KEYCHAIN_KEY)).toBe('legacy-install-id-0123456789');
    expect(storage.values.has(LEGACY_KEY)).toBe(false);
    // A backup taken after the move carries nothing: a restored device makes its own.
    mockKeychain.clear();
    expect(await reportSenderId(appStorage(storage.values))).not.toBe('legacy-install-id-0123456789');
  });

  it('two sends at once make one id', async () => {
    const storage = appStorage();
    const [first, second] = await Promise.all([reportSenderId(storage), reportSenderId(storage)]);
    expect(first).toBe(second);
  });

  it('where there is no Keychain (the web), the id is kept in app storage as before', async () => {
    mockKeychainWorks = false;
    const storage = appStorage();
    const id = await reportSenderId(storage);
    expect(storage.values.get(LEGACY_KEY)).toBe(id);
    expect(await reportSenderId(storage)).toBe(id);
    expect(await reportSnapshotSentHere(sentBy(id), storage)).toBe(true);
  });

  it('while the Keychain cannot be read (the device locked), no second id is made in app storage', async () => {
    const storage = appStorage();
    const id = await reportSenderId(storage);
    mockKeychainLocked = true;
    await expect(reportSenderId(storage)).rejects.toThrow();
    expect(storage.values.size).toBe(0);
    mockKeychainLocked = false;
    expect(await reportSenderId(storage)).toBe(id);
  });

  it('neither is in the account sandbox; the download time Reports compares with is kept per account', () => {
    expect(isOwnerSensitiveCanonicalStorageKey(LEGACY_KEY)).toBe(false);
    expect(isOwnerSensitiveCanonicalStorageKey(KEYCHAIN_KEY)).toBe(false);
    expect(isOwnerSensitiveCanonicalStorageKey(SCHEDULE_CLOUD_PULL_KEY)).toBe(true);
  });
});
