import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  DAVE_REPORT_SNAPSHOT_VERSION,
  laterReportPeriod,
  reportPeriodIsLater,
  reportPeriodSentAt,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';
import {
  loadReportSnapshotCloud,
  saveReportSnapshotCloud,
} from './SupabaseService';

const STORAGE_PREFIX = '@vitruvius/report-snapshots/v1';
/**
 * This install's report sender id (whole-app audit A6 pass 9 L2): random,
 * made once and kept on this device only. Outside the account sandbox on
 * purpose: it names the install, never the account or the owner.
 *
 * Whole-app audit A6 pass 10 L3 (30 Sep 2026): kept in app storage, a
 * reinstall lost it (the phone's own send then read "Your other device
 * already sent this report") and an iOS backup restored onto the iPad copied
 * it (both devices had one id; the iPad's sends counted as the phone's own).
 * It now lives in the Keychain, readable while the device is unlocked and
 * never carried to another device (WHEN_UNLOCKED_THIS_DEVICE_ONLY): it
 * survives a reinstall and stays behind in a backup. The app-storage key
 * below is where pass 9 kept it, replaced in the Keychain once (pass 11 L4,
 * below), and where there is no Keychain (the web) the id is kept there as
 * before.
 *
 * Whole-app audit A6 pass 11 L4 (30 Sep 2026): the move copied the
 * app-storage id, so a device restored from a backup taken before the move
 * wrote the other device's id into its Keychain for good, and each device's
 * sends counted as the other's own. The move now makes a fresh id; the
 * app-storage one is deleted and kept, in the Keychain on this device only,
 * as this install's former id, under which its own sends are still known by
 * its saved copy of them (`reportSnapshotSentHere`).
 */
const SENDER_ID_KEY = '@vitruvius/report-sender-id/v1';
const KEYCHAIN_SENDER_ID_KEY = 'vitruvius.report-sender-id.v1';
const KEYCHAIN_FORMER_SENDER_ID_KEY = 'vitruvius.report-sender-id.app-storage.v1';
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
/**
 * When this device sent reports, for this account (whole-app audit A6 pass
 * 12 L2, 30 Sep 2026): the phone sent with no sender id (its Keychain
 * locked, none read yet that app session), approved the next report the
 * next day without sending it, and after another relaunch, before any
 * download since its send, said "This device hasn't received your other
 * device's latest changes yet…" with Approve disabled. Its own no-id send
 * was known only while its saved copy was that send, and the approval had
 * replaced it. Each send this device makes or recognizes is kept here, the
 * last `MOST_OWN_SENDS_KEPT`. The key sits under the report snapshot prefix,
 * which the owner storage sandbox keeps for each account.
 */
const OWN_SENDS_KEY = '@vitruvius/report-snapshots/own-sends/v1';
const MOST_OWN_SENDS_KEPT = 50;
/** One write at a time, so two sends recorded together both stay on the list. */
let ownSendWrites: Promise<unknown> = Promise.resolve();
/** How long opening Reports waits for the shared period before using this device's own. */
const CLOUD_READ_TIMEOUT_MS = 4000;

type SnapshotStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'> & Partial<Pick<typeof AsyncStorage, 'removeItem'>>;

/** Where this install's sender id is kept on this device (A6 pass 10 L3). */
export type SenderIdKeychain = Readonly<{
  /** Whether this platform has a Keychain (not the web). */
  available: () => Promise<boolean>;
  read: () => Promise<string | null>;
  write: (id: string) => Promise<void>;
  /** The app-storage id this install had before the move, kept here by the move (A6 pass 11 L4). */
  readFormer?: () => Promise<string | null>;
  writeFormer?: (id: string) => Promise<void>;
}>;

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

/**
 * The owner's copy of each period shared by the phone and the iPad (owner
 * answer Q16, 30 Sep 2026). `read` is null when there is none to read (cloud
 * not configured, or the table not created yet) and throws when it could not
 * be read (offline, signed out or sign-in expired, or a server error);
 * `snapshot` is null when the owner has none for this period yet.
 */
export type DAVEReportSnapshotCloud = Readonly<{
  read: (
    scopeKey: string,
    reportFormat: DAVEReportFormat,
  ) => Promise<Readonly<{ ownerId: string; snapshot: unknown }> | null>;
  write: (snapshot: DAVEReportSnapshot, expectedOwnerId?: string) => Promise<unknown>;
}>;

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

/**
 * The last approved report of this format for these projects: its own
 * period since owner answer Q17 (30 Sep 2026).
 *
 * Until a format has saved a period of its own, the one period every format
 * shared before Q17 is its starting baseline, returned as this format's so
 * that approving or sending it writes this format's key and never the shared
 * one: the other format keeps the shared baseline until its own first send.
 *
 * Since owner answer Q16 it is merged with the owner's shared copy: the
 * period from the later sent report wins (`laterReportPeriod`). When this
 * device's period is later, or the owner has none yet (a period saved before
 * Q16), it is carried up. Without the shared copy this device's own is used.
 */
export async function loadDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = AsyncStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<DAVEReportSnapshot | null> {
  return (await loadDAVEReportPeriod(scopeKey, reportFormat, storage, cloud)).snapshot;
}

/**
 * Whether the owner's shared copy was read for a period (whole-app audit A6
 * pass 7): 'checked'; 'unavailable' when there is none to read (cloud not
 * configured, or the table not created yet: the quiet state before the SQL
 * is applied); 'unchecked' when it could not be read (offline, signed out or
 * sign-in expired, a server error, or no answer within four seconds), so the
 * other device may have sent a later report this one does not know about.
 */
export type DAVEReportSharedCheck = 'checked' | 'unavailable' | 'unchecked';

export type DAVEReportPeriodLoad = Readonly<{
  snapshot: DAVEReportSnapshot | null;
  shared: DAVEReportSharedCheck;
}>;

/** `loadDAVEReportSnapshot`, with whether the other device's copy was checked. */
export async function loadDAVEReportPeriod(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage = AsyncStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
): Promise<DAVEReportPeriodLoad> {
  const local = await loadLocalDAVEReportSnapshot(scopeKey, reportFormat, storage);
  const read = await readShared(cloud, scopeKey, reportFormat);
  if (read.status !== 'checked') return Object.freeze({ snapshot: local, shared: read.status });
  const shared = validSnapshot(read.value.snapshot, scopeKey, reportFormat);
  if (local && reportPeriodIsLater(local, shared)) void writeShared(cloud, local, read.value.ownerId);
  return Object.freeze({ snapshot: laterReportPeriod(local, shared), shared: 'checked' });
}

/**
 * Saved on this device first (verified, as before); then shared in the
 * background. A failed upload is retried by the next approval, send or open.
 */
export async function saveDAVEReportSnapshot(
  snapshot: DAVEReportSnapshot,
  storage: SnapshotStorage = AsyncStorage,
  cloud: DAVEReportSnapshotCloud = supabaseReportSnapshotCloud,
) {
  const raw = JSON.stringify(snapshot);
  const key = storageKey(snapshot.scopeKey, snapshot.reportFormat);
  await storage.setItem(key, raw);
  if (await storage.getItem(key) !== raw) {
    throw new Error('The approved report snapshot could not be verified after saving.');
  }
  if (snapshot.reportFormat) void writeShared(cloud, snapshot);
}

let senderIdCreation: Promise<string> | null = null;
/**
 * The id read from (or made in) the Keychain this app session (whole-app
 * audit A6 pass 11 L3, 30 Sep 2026). The Keychain item can be read only while
 * the device is unlocked: an iPad locked as its share sheet closed sent
 * without an id, and the phone, never waiting on such a send, read the
 * iPad's completion backwards again. Opening Reports reads the id; a send
 * made while the Keychain cannot be read uses the one read then.
 */
let senderIdThisSession: string | null = null;

/** Test seam: a new app session has read no sender id yet. */
export function forgetReportSenderIdSession(): void {
  senderIdThisSession = null;
}

/** The Keychain's id, kept for the session; while it cannot be read, the one read earlier this session. */
async function readKeychainSenderId(keychain: SenderIdKeychain): Promise<string | null> {
  try {
    const id = await keychain.read();
    if (id) senderIdThisSession = id;
    return id;
  } catch (error) {
    if (senderIdThisSession) return senderIdThisSession;
    throw error;
  }
}

/**
 * This install's report sender id, made the first time this device sends a
 * report (A6 pass 9 L2), kept in the Keychain on this device only (pass 10
 * L3). While the Keychain cannot be read (the device locked) it is the id
 * read earlier this app session (pass 11 L3); with none read, it rejects:
 * the send then goes without an id rather than with a second one.
 */
export async function reportSenderId(
  storage: SnapshotStorage = AsyncStorage,
  keychain: SenderIdKeychain = deviceKeychain,
): Promise<string> {
  // Two sends at once make one id.
  senderIdCreation ??= (async () => {
    if (await keychain.available().catch(() => false)) {
      const kept = await readKeychainSenderId(keychain);
      if (kept) return kept;
      // A fresh id, never the one pass 9 kept in app storage (a device restored
      // from a backup carries the other device's there): that one is kept here
      // as this install's former id, then leaves app storage (A6 pass 11 L4).
      const earlier = await storage.getItem(SENDER_ID_KEY);
      const id = randomSenderId();
      if (earlier) await keychain.writeFormer?.(earlier).catch(() => undefined);
      await keychain.write(id);
      if (await readKeychainSenderId(keychain) === id) {
        if (earlier) await storage.removeItem?.(SENDER_ID_KEY);
        return id;
      }
    }
    // No Keychain here (the web), or it did not keep the id: app storage, as before.
    const saved = await storage.getItem(SENDER_ID_KEY);
    if (saved) return saved;
    await storage.setItem(SENDER_ID_KEY, randomSenderId());
    return (await storage.getItem(SENDER_ID_KEY)) as string;
  })().finally(() => {
    senderIdCreation = null;
  });
  return senderIdCreation;
}

/**
 * This install's sender id if it has one, without making one: the
 * Keychain's; where there is no Keychain (the web), the one in app storage.
 * Where there is a Keychain, an id still in app storage is the former one
 * (A6 pass 11 L4: it may be the other device's, restored from its backup).
 */
async function savedReportSenderId(storage: SnapshotStorage, keychain: SenderIdKeychain): Promise<string | null> {
  if (await keychain.available().catch(() => false)) return readKeychainSenderId(keychain);
  return storage.getItem(SENDER_ID_KEY);
}

/** The id pass 9 kept in app storage, if this install had one: there until the move, then in the Keychain (A6 pass 11 L4). */
async function formerReportSenderId(storage: SnapshotStorage, keychain: SenderIdKeychain): Promise<string | null> {
  if (!await keychain.available().catch(() => false)) return null;
  return (await keychain.readFormer?.().catch(() => null)) || storage.getItem(SENDER_ID_KEY);
}

/**
 * Whether this device sent `snapshot` (whole-app audit A6 pass 9 L2), so its
 * own send read back after a relaunch is never taken for the other device's:
 * by the sender id the send carries, or, for a report sent before sends
 * carried one, by this device's own saved copy of that send (only the device
 * that sent a report saves it marked sent). An approval not yet sent, or a
 * report saved before sends were recorded, is not a send. Whatever the send,
 * this install's id is read, so it is kept for the app session (A6 pass 11
 * L3): opening Reports reads it before any send. A send under this install's
 * former id (the app-storage one, pass 11 L4) is known by the saved copy
 * too: a device restored from a backup may have carried that id as well.
 *
 * Whole-app audit A6 pass 12 L2 (30 Sep 2026): a send with no id, or under
 * the former id, is also this device's when its send time is on this
 * account's list of this device's own sends (`rememberReportSentHere`), so
 * it stays known once an approval is saved over it. An approval's
 * superseded send is never taken for this device's on its own say: it may
 * be the other device's.
 */
export async function reportSnapshotSentHere(
  snapshot: DAVEReportSnapshot | null | undefined,
  storage: SnapshotStorage = AsyncStorage,
  keychain: SenderIdKeychain = deviceKeychain,
): Promise<boolean> {
  if (!snapshot || typeof snapshot.deliveredAt !== 'string') return false;
  const here = await savedReportSenderId(storage, keychain).catch(() => null);
  if (snapshot.sentBy && snapshot.sentBy === here) return true;
  if (snapshot.sentBy && snapshot.sentBy !== await formerReportSenderId(storage, keychain).catch(() => null)) return false;
  await ownSendWrites;
  if ((await ownReportSendTimesSaved(storage)).includes(snapshot.deliveredAt)) return true;
  if (!snapshot.reportFormat) return false;
  const own = await loadLocalDAVEReportSnapshot(snapshot.scopeKey, snapshot.reportFormat, storage);
  return own?.deliveredAt === snapshot.deliveredAt && own.sourceFingerprint === snapshot.sourceFingerprint;
}

/**
 * Whether `approval`, not yet sent, is the approval this device saved for its
 * period (everyday item 1, 2 Oct 2026): only the device that approved a
 * report offers to record it as sent another way. An approval read from the
 * other device's shared copy may hold changes this device has not received.
 */
export async function reportApprovalSavedHere(
  approval: DAVEReportSnapshot | null | undefined,
  storage: SnapshotStorage = AsyncStorage,
): Promise<boolean> {
  if (!approval || approval.deliveredAt !== null || !approval.reportFormat) return false;
  const own = await loadLocalDAVEReportSnapshot(approval.scopeKey, approval.reportFormat, storage);
  return own?.deliveredAt === null &&
    own.sourceFingerprint === approval.sourceFingerprint &&
    own.capturedAt === approval.capturedAt;
}

/** This device sent a report at `sentAt` (A6 pass 12 L2): kept on this account's list of its own sends. */
export function rememberReportSentHere(sentAt: string, storage: SnapshotStorage = AsyncStorage): Promise<void> {
  const write = ownSendWrites.then(async () => {
    if (Number.isNaN(Date.parse(sentAt))) return;
    const kept = await ownReportSendTimesSaved(storage);
    if (kept.includes(sentAt)) return;
    await storage.setItem(OWN_SENDS_KEY, JSON.stringify([...kept, sentAt].slice(-MOST_OWN_SENDS_KEPT)));
  }).catch(() => undefined);
  ownSendWrites = write;
  return write;
}

async function ownReportSendTimesSaved(storage: SnapshotStorage): Promise<string[]> {
  try {
    const saved: unknown = JSON.parse(await storage.getItem(OWN_SENDS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((time): time is string => typeof time === 'string') : [];
  } catch {
    return [];
  }
}

function randomSenderId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  if (uuid) return uuid;
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('');
}

async function loadLocalDAVEReportSnapshot(
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  storage: SnapshotStorage,
): Promise<DAVEReportSnapshot | null> {
  const own = await storage.getItem(storageKey(scopeKey, reportFormat));
  if (own) return parseSnapshot(own, scopeKey, reportFormat);
  const shared = parseSnapshot(await storage.getItem(storageKey(scopeKey, undefined)), scopeKey, undefined);
  return shared ? Object.freeze({ ...shared, reportFormat }) : null;
}

type SharedRead =
  | Readonly<{ status: 'checked'; value: Readonly<{ ownerId: string; snapshot: unknown }> }>
  | Readonly<{ status: 'unavailable' | 'unchecked' }>;

async function readShared(
  cloud: DAVEReportSnapshotCloud,
  scopeKey: string,
  reportFormat: DAVEReportFormat,
): Promise<SharedRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      cloud.read(scopeKey, reportFormat),
      new Promise<'timed_out'>(resolve => {
        timer = setTimeout(() => resolve('timed_out'), CLOUD_READ_TIMEOUT_MS);
      }),
    ]);
    if (value === 'timed_out') return { status: 'unchecked' };
    return value ? { status: 'checked', value } : { status: 'unavailable' };
  } catch {
    return { status: 'unchecked' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeShared(cloud: DAVEReportSnapshotCloud, snapshot: DAVEReportSnapshot, expectedOwnerId?: string) {
  try {
    await cloud.write(snapshot, expectedOwnerId);
  } catch {
    // Offline or not shared yet: this device keeps its own copy.
  }
}

function parseSnapshot(
  raw: string | null,
  scopeKey: string,
  reportFormat: DAVEReportFormat | undefined,
): DAVEReportSnapshot | null {
  if (!raw) return null;
  try {
    return validSnapshot(JSON.parse(raw), scopeKey, reportFormat);
  } catch {
    return null;
  }
}

function validSnapshot(
  value: unknown,
  scopeKey: string,
  reportFormat: DAVEReportFormat | undefined,
): DAVEReportSnapshot | null {
  const parsed = value as DAVEReportSnapshot | null;
  if (
    parsed?.version !== DAVE_REPORT_SNAPSHOT_VERSION ||
    parsed.scopeKey !== scopeKey ||
    parsed.reportFormat !== reportFormat ||
    !Array.isArray(parsed.tasks)
  ) return null;
  return parsed;
}

/**
 * The shared pre-Q17 key is the prefix and the encoded projects; a format's
 * own key extends that suffix. The encoded projects never contain ':', so a
 * format key cannot be another scope's shared key, and the prefix still
 * covers every report-snapshot key.
 */
function storageKey(scopeKey: string, reportFormat: DAVEReportFormat | undefined) {
  const shared = `${STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`;
  return reportFormat ? `${shared}:${reportFormat}` : shared;
}
