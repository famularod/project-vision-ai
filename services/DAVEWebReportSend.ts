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

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;

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
/** The profile storages this tab keeps periods in, and the keys it wrote to each (for one that cannot list its keys). */
const profileStorages = new Map<BrowserStorage, Set<string>>();

function accountPrefix(ownerId: string): string {
  return `${WEB_PREFIX}/${encodeURIComponent(ownerId)}/`;
}

function storedKeys(local: BrowserStorage, written: ReadonlySet<string>): string[] {
  try {
    if (typeof local.key === 'function' && typeof local.length === 'number') {
      const keys: string[] = [];
      for (let index = 0; index < local.length; index += 1) {
        const key = local.key(index);
        if (typeof key === 'string') keys.push(key);
      }
      return keys;
    }
  } catch {
    // Its keys cannot be listed: the ones this tab wrote, below.
  }
  return [...written];
}

/**
 * Review N1 (2 Oct 2026): "Sign Out of This Computer" left the account's
 * report periods in this browser profile's storage: the last sent report
 * and any approval, with project, task and owner names, readable through
 * the browser's developer tools by whoever uses the computer next. Signing
 * out now removes that account's periods and own-send list from this
 * browser (profile storage, and this tab's own copies). Another account's
 * are not touched, and the profile's sender id stays: it names this browser,
 * never an account, so this browser's earlier sends are still known as its
 * own when the period is read from the shared table again (owner answer
 * Q16). Without that table the account's period on this computer is gone:
 * its next report has no "since the last report" section until one is sent
 * from here again, and an approval not yet sent has to be approved again.
 */
export function forgetDAVEWebReportPeriods(ownerId: string): void {
  const prefix = accountPrefix(ownerId);
  const profile = browserLocalStorage();
  if (profile && !profileStorages.has(profile)) profileStorages.set(profile, new Set());
  for (const [local, written] of profileStorages) {
    for (const key of storedKeys(local, written)) {
      if (!key.startsWith(prefix)) continue;
      try {
        local.removeItem(key);
      } catch {
        // A storage that cannot be reached holds nothing this browser can read back either.
      }
      written.delete(key);
    }
  }
  for (const key of [...tabOnly.keys()]) {
    if (key.startsWith(prefix)) tabOnly.delete(key);
  }
  // The signed-out account's send times are no other account's own sends.
  ownSends.clear();
}

/**
 * This browser profile's storage for report periods: each account's own
 * copy under its owner id; the sender id once for the profile, whoever signs
 * in (it names this browser, never the account).
 */
export function daveWebReportStorage(
  ownerId: () => Promise<string>,
  local: BrowserStorage | null = browserLocalStorage(),
): SnapshotStorage {
  const keyFor = async (key: string) => (key === REPORT_SENDER_ID_KEY ? key : `${accountPrefix(await ownerId())}${key}`);
  if (local && !profileStorages.has(local)) profileStorages.set(local, new Set());
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
      if (value === null) profileStorages.get(local)?.delete(key);
      else profileStorages.get(local)?.add(key);
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

/**
 * The sent reports a period remembers, newest first: the one it runs from
 * and the two before it (each saved report keeps the one it replaced, and
 * that one's own: A6 pass 16 L1).
 */
function periodSends(snapshot: DAVEReportSnapshot | null | undefined): DAVEReportSnapshot[] {
  const sends: DAVEReportSnapshot[] = [];
  for (let send = reportPeriodSend(snapshot); send && sends.length < 3; send = reportPeriodSend(send.supersedes)) {
    sends.push(send);
  }
  return sends;
}

/**
 * When this computer sent the report with these facts, if it is one of the
 * sent reports `period` remembers; else null (review N1, 2 Oct 2026). A
 * report it already sent is shared again without being recorded again, and
 * its own send is never read as another device's.
 */
export function daveWebReportSentHereAt(
  period: DAVEReportSnapshot | null | undefined,
  fingerprint: string | null | undefined,
): string | null {
  if (!fingerprint) return null;
  const sent = periodSends(period).find(send =>
    send.sourceFingerprint === fingerprint && typeof send.deliveredAt === 'string' && ownSends.has(send.deliveredAt));
  return sent?.deliveredAt ?? null;
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
  // The sends before the one the period runs from too: one of them may be the report now on screen (review N1).
  for (const sent of new Set([loaded.snapshot, ...periodSends(loaded.snapshot)])) {
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
  else if (loaded.snapshot?.deliveredAt === null && !await reportApprovalSavedHere(loaded.snapshot, store.storage).catch(() => true)) {
    // The same report is already the approval waiting in the shared period, and this computer holds no
    // copy of it (it was approved here before Sign Out of This Computer removed this account's copy, or
    // on another device): approved here now, this computer keeps it, so its send from here is recorded
    // (review N1).
    await saveDAVEReportSnapshot(loaded.snapshot, store.storage, store.cloud);
  }
  return { status: 'saved', snapshot: toSave ?? loaded.snapshot };
}

export type DAVEWebSendOutcome =
  | DAVEWebPeriodOutcome
  /** This computer already recorded this report as sent, at `sentAt`: sharing it again records nothing more. */
  | Readonly<{ status: 'already_sent'; sentAt: string }>;

/**
 * The approved report went out from here, or the owner recorded that it did
 * (Mark as Sent, with `markedSentAt`): recorded exactly as the phone records
 * a send. The period is read again first: when the other device sent a
 * report after this approval's period began, this one is not recorded and the
 * next report counts from that one. Resolves with what was recorded, or null
 * when there is no approval of these facts waiting here.
 *
 * Review N1 (2 Oct 2026): a second Share of a report this computer had
 * already recorded as sent found no approval waiting, and the page said so
 * in red though nothing was wrong. It now answers 'already_sent' with when:
 * the share is not a second send.
 */
export async function recordDAVEWebReportSend(
  store: DAVEWebReportStore,
  period: Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>,
  approvedFingerprint: string | null,
  deliveredAt: string,
  markedSentAt: string | null = null,
): Promise<DAVEWebSendOutcome | null> {
  // This computer's own copy holds its approval; the shared copy may already hold a later send.
  const approval = (await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, store.storage, LOCAL_ONLY)).snapshot;
  if (!approval || approval.deliveredAt !== null || (approvedFingerprint !== null && approval.sourceFingerprint !== approvedFingerprint)) {
    // No approval of these facts is waiting. Already sent from here? Its own copy, then the shared period, says.
    const merged = await loadDAVEWebReportPeriod(store, period.scopeKey, period.reportFormat).catch(() => null);
    const sentAt = daveWebReportSentHereAt(approval, approvedFingerprint) ?? daveWebReportSentHereAt(merged?.snapshot, approvedFingerprint);
    return sentAt ? { status: 'already_sent', sentAt } : null;
  }
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
