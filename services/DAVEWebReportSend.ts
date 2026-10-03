import {
  markReportSnapshotDelivered,
  reportPeriodSend,
  reportPeriodSentAfter,
  reportPeriodSentAt,
  reportSnapshotToSave,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';
import {
  loadDAVEReportPeriod,
  rememberReportSentHere,
  REPORT_SENDER_ID_KEY,
  reportApprovalSavedHere,
  reportSenderId,
  reportSnapshotSentHere,
  saveDAVEReportSnapshot,
  type DAVEReportSharedCheck,
  type DAVEReportSnapshotCloud,
  type SenderIdKeychain,
  type SnapshotStorage,
} from './DAVEReportSnapshotStore';

/**
 * Owner answer 2 Oct (web sends count): a report sent from the web desktop
 * moves the "since the last report" period on the iPhone and the iPad,
 * exactly like a send from the phone. This computer is one more device for
 * the phone's own store (DAVEReportSnapshotStore):
 *
 * - its own copy of each period in this browser profile's storage, per
 *   signed-in account, as the phone keeps one per account;
 * - its own stable sender id, made once per browser profile (no Keychain on
 *   the web: the store keeps it in profile storage, as it always did there);
 * - its own-send list, so its own sends never make it wait;
 * - the owner's shared period (the report_snapshots row, owner answer Q16),
 *   read and written through this computer's own signed-in client.
 *
 * Without the report_snapshots table, a send from here stays in this
 * browser profile's own period: the iPhone and the iPad cannot learn of it
 * (as the phone's and the iPad's sends then stay on each device).
 */

/** No Keychain in a browser: the sender id is kept in the profile's storage. */
export const DAVE_WEB_NO_KEYCHAIN: SenderIdKeychain = Object.freeze({
  available: async () => false,
  read: async () => null,
  write: async () => undefined,
});

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserLocalStorage(): BrowserStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

const WEB_PREFIX = '@vitruvius/web';
/** When this tab cannot keep site data, its periods last as long as the tab. */
const tabOnly = new Map<string, string>();

/**
 * This browser profile's storage for report periods: each account's own
 * copy under its owner id; the sender id once for the profile, whoever signs
 * in (it names this browser, never the account).
 */
export function daveWebReportStorage(
  ownerId: () => Promise<string>,
  local: BrowserStorage | null = browserLocalStorage(),
): SnapshotStorage {
  const keyFor = async (key: string) => (key === REPORT_SENDER_ID_KEY ? key : `${WEB_PREFIX}/${encodeURIComponent(await ownerId())}/${key}`);
  const read = (key: string) => {
    try {
      return local ? local.getItem(key) : tabOnly.get(key) ?? null;
    } catch {
      return tabOnly.get(key) ?? null;
    }
  };
  const write = (key: string, value: string | null) => {
    try {
      if (!local) throw new Error('no profile storage');
      if (value === null) local.removeItem(key);
      else local.setItem(key, value);
    } catch {
      if (value === null) tabOnly.delete(key);
      else tabOnly.set(key, value);
    }
  };
  return Object.freeze({
    getItem: async (key: string) => read(await keyFor(key)),
    setItem: async (key: string, value: string) => write(await keyFor(key), value),
    removeItem: async (key: string) => write(await keyFor(key), null),
  });
}

/** The shared period through this computer's signed-in client (the phone's rules for a missing table). */
export function daveWebReportSnapshotCloud(
  load: (scopeKey: string, format: string) => Promise<Readonly<{ ownerId: string; snapshot: unknown }> | 'unavailable'>,
  save: (row: Readonly<{
    scopeKey: string;
    format: string;
    snapshot: unknown;
    approvedAt: string;
    deliveredAt: string | null;
    expectedOwnerId?: string;
  }>) => Promise<'saved' | 'unavailable'>,
): DAVEReportSnapshotCloud {
  return Object.freeze({
    async read(scopeKey: string, reportFormat: DAVEReportFormat) {
      const result = await load(scopeKey, reportFormat);
      return result === 'unavailable' ? null : result;
    },
    write: (snapshot: DAVEReportSnapshot, expectedOwnerId?: string) => save({
      scopeKey: snapshot.scopeKey,
      format: snapshot.reportFormat as DAVEReportFormat,
      snapshot,
      approvedAt: snapshot.capturedAt,
      deliveredAt: reportPeriodSentAt(snapshot),
      expectedOwnerId,
    }),
  });
}

export type DAVEWebReportStore = Readonly<{ storage: SnapshotStorage; cloud: DAVEReportSnapshotCloud }>;

/** Reads this computer's own copy only. */
const LOCAL_ONLY: DAVEReportSnapshotCloud = Object.freeze({ read: async () => null, write: async () => undefined });

/** This tab's own sends (by send time), read back from the profile's list and recorded here. */
const ownSends = new Set<string>();

export function daveWebOwnReportSends(): ReadonlySet<string> {
  return ownSends;
}

/** Test seam: a new tab knows no sends of its own until it reads them back. */
export function forgetDAVEWebOwnReportSends(): void {
  ownSends.clear();
}

export type DAVEWebReportPeriodLoad = Readonly<{
  snapshot: DAVEReportSnapshot | null;
  shared: DAVEReportSharedCheck;
  /** The approval this computer saved for the period and has not recorded as sent (Mark as Sent). */
  approvalSavedHere: boolean;
}>;

/**
 * The period on this computer, as on the phone (loadDAVEReportPeriod): its
 * own copy merged with the shared one, the later send winning. Its own sends
 * are known as its own, read back by sender id or by its saved copy.
 */
export async function loadDAVEWebReportPeriod(
  store: DAVEWebReportStore,
  scopeKey: string,
  format: DAVEReportFormat,
): Promise<DAVEWebReportPeriodLoad> {
  const loaded = await loadDAVEReportPeriod(scopeKey, format, store.storage, store.cloud);
  for (const sent of new Set([loaded.snapshot, reportPeriodSend(loaded.snapshot)])) {
    if (sent && await reportSnapshotSentHere(sent, store.storage, DAVE_WEB_NO_KEYCHAIN).catch(() => false)) {
      ownSends.add(sent.deliveredAt as string);
      await rememberReportSentHere(sent.deliveredAt as string, store.storage);
    }
  }
  return Object.freeze({
    snapshot: loaded.snapshot,
    shared: loaded.shared,
    approvalSavedHere: await reportApprovalSavedHere(loaded.snapshot, store.storage).catch(() => false),
  });
}

export type DAVEWebPeriodOutcome =
  | Readonly<{ status: 'saved'; snapshot: DAVEReportSnapshot | null }>
  /** The other device sent a later report than the one this counted from (A6 pass 7 on the phone). */
  | Readonly<{ status: 'later_send'; later: DAVEReportSnapshot }>;

/**
 * Approving here, as on the phone: the period is read again first, and a
 * report the other device sent after `sinceSentAt` stops the approval;
 * otherwise the approval is saved (not sent: it never moves the period's
 * start), here and in the shared copy.
 */
export async function approveDAVEWebReportPeriod(
  store: DAVEWebReportStore,
  current: DAVEReportSnapshot,
  sinceSentAt: string | null,
): Promise<DAVEWebPeriodOutcome> {
  const loaded = await loadDAVEReportPeriod(current.scopeKey, current.reportFormat as DAVEReportFormat, store.storage, store.cloud);
  const later = reportPeriodSentAfter(loaded.snapshot, sinceSentAt, ownSends);
  if (later) return { status: 'later_send', later };
  const toSave = reportSnapshotToSave(current, loaded.snapshot);
  if (toSave) await saveDAVEReportSnapshot(toSave, store.storage, store.cloud);
  return { status: 'saved', snapshot: toSave ?? loaded.snapshot };
}

/**
 * The approved report went out from here, or the owner recorded that it did
 * (Mark as Sent, with `markedSentAt`): recorded exactly as the phone records
 * a send. The period is read again first: when the other device sent a
 * report after this approval's period began, this one is not recorded and the
 * next report counts from that one. Resolves with what was recorded, or null
 * when there is no approval of these facts waiting here.
 */
export async function recordDAVEWebReportSend(
  store: DAVEWebReportStore,
  period: Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>,
  approvedFingerprint: string | null,
  deliveredAt: string,
  markedSentAt: string | null = null,
): Promise<DAVEWebPeriodOutcome | null> {
  // This computer's own copy holds its approval; the shared copy may already hold a later send.
  const approval = (await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, store.storage, LOCAL_ONLY)).snapshot;
  if (!approval || approval.deliveredAt !== null) return null;
  if (approvedFingerprint !== null && approval.sourceFingerprint !== approvedFingerprint) return null;
  const loaded = await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, store.storage, store.cloud);
  const later = reportPeriodSentAfter(loaded.snapshot, reportPeriodSentAt(approval), ownSends);
  if (later) return { status: 'later_send', later };
  ownSends.add(deliveredAt);
  await rememberReportSentHere(deliveredAt, store.storage);
  const sentBy = await reportSenderId(store.storage, DAVE_WEB_NO_KEYCHAIN).catch(() => null);
  const delivered = markReportSnapshotDelivered(approval, deliveredAt, sentBy, markedSentAt);
  await saveDAVEReportSnapshot(delivered, store.storage, store.cloud);
  return { status: 'saved', snapshot: delivered };
}
