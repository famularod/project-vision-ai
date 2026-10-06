import {
  markReportSnapshotDelivered,
  reportPeriodSend,
  reportPeriodSentAfter,
  reportPeriodSentAt,
  reportSnapshotToSave,
  validReportPeriodSnapshot,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';
import {
  carryUpDAVEReportPeriod,
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
/**
 * When this tab cannot keep site data, or the profile's storage is full, its
 * periods last as long as the tab: what the profile could not take is kept
 * here (null: a removal it could not make), and read back from here.
 */
const tabOnly = new Map<string, string | null>();
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
  sentInThisTab.clear();
}

/**
 * Review N1 L1 (3 Oct 2026): how a period is written to this browser's
 * storage. A saved period holds the last report and the two before it, each
 * with every task, and went in as its JSON: about 1,150 characters a task.
 * A browser gives a site some 2.6 to 5.2 million characters, so from about
 * 1,500 tasks the period could not be saved. Most tasks say the same in all
 * three reports, and every task repeats the same field names: here each
 * distinct task is written once, as its values in the order of its field
 * names, and each report lists which tasks it has. Nothing the period needs
 * is left out: reading it back gives the same text, character for character
 * (checked as it is written; a period that would not read back the same is
 * written as it is).
 */
const PACKED_PERIOD = '{"vitruviusPeriod":1,';

type PackedPeriod = Readonly<{ vitruviusPeriod: 1; fields: string[][]; tasks: unknown[][]; report: Record<string, unknown> }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function packReportPeriod(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) return raw;
    const fields: string[][] = [];
    const fieldsAt = new Map<string, number>();
    const tasks: unknown[][] = [];
    const taskAt = new Map<string, number>();
    const packTask = (task: Record<string, unknown>): number => {
      const names = Object.keys(task);
      const namesKey = JSON.stringify(names);
      let at = fieldsAt.get(namesKey);
      if (at === undefined) {
        at = fields.push(names) - 1;
        fieldsAt.set(namesKey, at);
      }
      const row = [at, ...names.map(name => task[name])];
      const rowKey = JSON.stringify(row);
      let index = taskAt.get(rowKey);
      if (index === undefined) {
        index = tasks.push(row) - 1;
        taskAt.set(rowKey, index);
      }
      return index;
    };
    const packReport = (report: Record<string, unknown>): Record<string, unknown> => {
      const packed: Record<string, unknown> = {};
      for (const name of Object.keys(report)) {
        const value = report[name];
        if (name === 'tasks' && Array.isArray(value) && value.every(isRecord)) packed[name] = { taskIndexes: value.map(packTask) };
        else if (name === 'supersedes' && isRecord(value) && Array.isArray(value.tasks)) packed[name] = { report: packReport(value) };
        else packed[name] = value;
      }
      return packed;
    };
    const period: PackedPeriod = { vitruviusPeriod: 1, fields, tasks, report: packReport(parsed) };
    const packed = JSON.stringify(period);
    return packed.length < raw.length && unpackReportPeriod(packed) === raw ? packed : raw;
  } catch {
    return raw;
  }
}

function unpackReportPeriod(stored: string): string {
  if (!stored.startsWith(PACKED_PERIOD)) return stored;
  const period = JSON.parse(stored) as PackedPeriod;
  const task = (index: number): Record<string, unknown> => {
    const [at, ...values] = period.tasks[index] as [number, ...unknown[]];
    const unpacked: Record<string, unknown> = {};
    period.fields[at].forEach((name, position) => { unpacked[name] = values[position]; });
    return unpacked;
  };
  const report = (packed: Record<string, unknown>): Record<string, unknown> => {
    const unpacked: Record<string, unknown> = {};
    for (const name of Object.keys(packed)) {
      const value = packed[name];
      if (name === 'tasks' && isRecord(value) && Array.isArray(value.taskIndexes)) unpacked[name] = (value.taskIndexes as number[]).map(task);
      else if (name === 'supersedes' && isRecord(value) && isRecord(value.report)) unpacked[name] = report(value.report);
      else unpacked[name] = value;
    }
    return unpacked;
  };
  return JSON.stringify(report(period.report));
}

/** A value as this module wrote it to the browser's storage, read back as the period's own JSON (for tools and tests). */
export function daveWebStoredReportValue(stored: string | null | undefined): string | null {
  if (typeof stored !== 'string') return null;
  try {
    return unpackReportPeriod(stored);
  } catch {
    return null;
  }
}

/**
 * Whether this tab is keeping a report period in its own memory because the
 * browser's storage would not take it (full, or no site data): it lasts as
 * long as the tab, and the page says so (review N1 L1).
 */
export function daveWebReportPeriodKeptInTabOnly(): boolean {
  // An account's own keys: the profile's sender id is no period.
  for (const [key, value] of tabOnly) {
    if (value !== null && key.startsWith(`${WEB_PREFIX}/`)) return true;
  }
  return false;
}

/** Test seam: a new tab holds nothing in its own memory (neither a period nor the sender id a full profile refused). */
export function forgetDAVEWebReportTabMemory(): void {
  tabOnly.clear();
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
  // Review N1 (2 Oct 2026): with the profile's storage full, a write went to
  // this tab's own copy but every read still asked the profile, which had the
  // older value or none: Approve said the period could not be saved here, and
  // a send from here was not recorded. This tab's own copy is the later write,
  // so it is read first; it goes once the profile takes a write for that key.
  const stored = (key: string) => {
    if (tabOnly.has(key)) return tabOnly.get(key) ?? null;
    try {
      return local ? local.getItem(key) : null;
    } catch {
      return null;
    }
  };
  const read = (key: string) => {
    const value = stored(key);
    if (value === null) return null;
    try {
      return unpackReportPeriod(value);
    } catch {
      return null; // Written by nothing this build knows: as if nothing were kept.
    }
  };
  const write = (key: string, raw: string | null) => {
    // A period goes in compactly (review N1 L1); what is read back is its own text again.
    const value = raw === null ? null : packReportPeriod(raw);
    try {
      if (!local) throw new Error('no profile storage');
      if (value === null) local.removeItem(key);
      else local.setItem(key, value);
      if (value === null) profileStorages.get(local)?.delete(key);
      else profileStorages.get(local)?.add(key);
      tabOnly.delete(key);
    } catch {
      if (value === null && !local) tabOnly.delete(key);
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

/**
 * The sends this tab itself recorded (review N2, 5 Oct 2026). Another tab's
 * are this browser's own too (the same sender id) and are read back into
 * `ownSends`, so they are never called another device's; but a report
 * another tab sent after this tab approved its own is still a later report
 * this tab's does not count from, and only this set tells the two apart.
 */
const sentInThisTab = new Set<string>();

/** Whether this tab recorded the send at `sentAt` itself (not another tab or an earlier visit of this browser). */
export function daveWebReportSentInThisTab(sentAt: string | null | undefined): boolean {
  return typeof sentAt === 'string' && sentInThisTab.has(sentAt);
}

/** Test seam: a new tab knows no sends of its own until it reads them back. */
export function forgetDAVEWebOwnReportSends(): void {
  ownSends.clear();
  sentInThisTab.clear();
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
  | Readonly<{
    status: 'later_send';
    later: DAVEReportSnapshot;
    /**
     * The later report was sent from this browser, by another tab or window
     * (review N1, 3 Oct 2026): this tab had not read the period since, so the
     * report here still counts from the older one and is stopped all the
     * same, but the page does not call it "your other device".
     */
    fromThisBrowser?: true;
  }>;

/** The later send that stops an approval or a record, and whether it was this browser's own (another tab's). */
async function laterSendOutcome(store: DAVEWebReportStore, later: DAVEReportSnapshot): Promise<DAVEWebPeriodOutcome> {
  const sentHere = await reportSnapshotSentHere(reportPeriodSend(later), store.storage, DAVE_WEB_NO_KEYCHAIN).catch(() => false);
  return sentHere ? { status: 'later_send', later, fromThisBrowser: true } : { status: 'later_send', later };
}

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
  if (later) return laterSendOutcome(store, later);
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
  const own = (await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, store.storage, LOCAL_ONLY)).snapshot;
  let approval = own;
  if (!own || own.deliveredAt !== null || (approvedFingerprint !== null && own.sourceFingerprint !== approvedFingerprint)) {
    // No approval of these facts is waiting here. Already sent from here? Its own copy, then the shared period, says.
    const merged = await loadDAVEWebReportPeriod(store, period.scopeKey, period.reportFormat).catch(() => null);
    const sentAt = daveWebReportSentHereAt(own, approvedFingerprint) ?? daveWebReportSentHereAt(merged?.snapshot, approvedFingerprint);
    if (sentAt) return { status: 'already_sent', sentAt };
    // Review N1 L2 (3 Oct 2026): approved in another browser, or here before this browser's site data was cleared.
    // The approval waiting in the shared period is of exactly these facts: the report going out now is that
    // approved report, and its send is recorded, where it was dropped with "no approval… on this computer".
    const waiting = merged?.snapshot;
    if (approvedFingerprint === null || !waiting || waiting.deliveredAt !== null || waiting.sourceFingerprint !== approvedFingerprint) return null;
    approval = waiting;
  }
  if (!approval) return null;
  const loaded = await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, store.storage, store.cloud);
  const later = reportPeriodSentAfter(loaded.snapshot, reportPeriodSentAt(approval), ownSends);
  if (later) return laterSendOutcome(store, later);
  ownSends.add(deliveredAt);
  sentInThisTab.add(deliveredAt);
  await rememberReportSentHere(deliveredAt, store.storage);
  const sentBy = await reportSenderId(store.storage, DAVE_WEB_NO_KEYCHAIN).catch(() => null);
  const delivered = markReportSnapshotDelivered(approval, deliveredAt, sentBy, markedSentAt);
  await saveDAVEReportSnapshot(delivered, store.storage, store.cloud);
  return { status: 'saved', snapshot: delivered };
}

/** Every period this browser keeps for `ownerId` (profile storage, and this tab's own copies), by its projects and format. */
function keptReportPeriods(ownerId: string): Array<Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>> {
  const prefix = accountPrefix(ownerId);
  const stored = new Map<string, string | null>();
  for (const [key, value] of tabOnly) {
    if (key.startsWith(prefix)) stored.set(key, value);
  }
  const profile = browserLocalStorage();
  if (profile && !profileStorages.has(profile)) profileStorages.set(profile, new Set());
  for (const [local, written] of profileStorages) {
    for (const key of storedKeys(local, written)) {
      if (!key.startsWith(prefix) || stored.has(key)) continue;
      try {
        stored.set(key, local.getItem(key));
      } catch {
        // A storage that cannot be read holds no period this browser could carry up.
      }
    }
  }
  const periods = new Map<string, Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>>();
  for (const value of stored.values()) {
    try {
      // The account's own-send list and anything else kept under its id is no period.
      const parsed: unknown = JSON.parse(daveWebStoredReportValue(value) ?? 'null');
      if (!isRecord(parsed) || typeof parsed.scopeKey !== 'string') continue;
      const reportFormat = parsed.reportFormat === 'project_manager' || parsed.reportFormat === 'executive' ? parsed.reportFormat : null;
      if (!reportFormat || !validReportPeriodSnapshot(parsed, parsed.scopeKey, reportFormat)) continue;
      periods.set(JSON.stringify([parsed.scopeKey, reportFormat]), { scopeKey: parsed.scopeKey, reportFormat });
    } catch {
      // Not a period this build wrote.
    }
  }
  return [...periods.values()];
}

/**
 * Whether this browser keeps anything under an account's id at all (a
 * period, an own-send list): Sign Out has nothing to carry up without one,
 * and does not wait to find that out (review N2).
 */
export function daveWebReportPeriodsKeptHere(): boolean {
  const kept = (key: string) => key.startsWith(`${WEB_PREFIX}/`);
  if ([...tabOnly].some(([key, value]) => value !== null && kept(key))) return true;
  const profile = browserLocalStorage();
  if (profile && !profileStorages.has(profile)) profileStorages.set(profile, new Set());
  for (const [local, written] of profileStorages) {
    if (storedKeys(local, written).some(kept)) return true;
  }
  return false;
}

/** How long a sign-out waits to learn who is signed in before it goes ahead without carrying anything up (as long as a read of the shared record is given). */
const SIGN_OUT_OWNER_WAIT_MS = 4000;

/** A report this computer recorded as sent that the shared record may not have: its period, and when it was sent. */
export type DAVEWebReportSendNotShared = Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat; sentAt: string }>;

/**
 * Review N2 (5 Oct 2026, caused by b1281f0): a report sent from here while
 * the shared record could not be reached is kept in this browser, and the
 * page says "Your other devices count from it once this computer reaches the
 * shared record again". It is carried up the next time Reports is opened.
 * But Sign Out of This Computer removes this account's periods from the
 * browser (review N1, and it still does): signed out before Reports was
 * opened again, the send was gone for good, and every device's next report
 * repeated what it had covered.
 *
 * So before a sign-out the signed-in account's periods kept here are carried
 * up once more, and waited for. Resolves with this computer's own sends that
 * still could not be confirmed in the shared record, newest first, for the
 * page to say before it signs out; empty when there is nothing to say: all
 * are there, or reports are not shared between his devices yet (the period
 * was this computer's alone, as the Reports page said). Only the account
 * `ownerId` names is read or written, and only into its own shared record.
 * Never throws.
 */
export async function shareDAVEWebReportSendsBeforeSignOut(
  ownerId: () => Promise<string>,
  cloud: DAVEReportSnapshotCloud,
): Promise<readonly DAVEWebReportSendNotShared[]> {
  let waiting: ReturnType<typeof setTimeout> | undefined;
  try {
    // Who is signed in is asked of the cloud when it is not already known; the sign-out does not wait on it for long.
    const owner = await Promise.race([
      ownerId(),
      new Promise<never>((_resolve, reject) => {
        waiting = setTimeout(() => reject(new Error('The signed-in account was not confirmed in time.')), SIGN_OUT_OWNER_WAIT_MS);
      }),
    ]);
    const storage = daveWebReportStorage(async () => owner);
    const ownCloud: DAVEReportSnapshotCloud = Object.freeze({
      async read(scopeKey: string, reportFormat: DAVEReportFormat) {
        const row = await cloud.read(scopeKey, reportFormat);
        // Another account signed in meanwhile: its record is not this account's to read or write.
        if (row && row.ownerId !== owner) throw new Error('The signed-in account changed.');
        return row;
      },
      write: cloud.write,
    });
    const notShared: DAVEWebReportSendNotShared[] = [];
    await Promise.all(keptReportPeriods(owner).map(async period => {
      const carried = await carryUpDAVEReportPeriod(period.scopeKey, period.reportFormat, storage, ownCloud);
      if (carried !== 'not_reached') return;
      // Only a send of this computer's own is at stake: another device's is in the shared record already.
      const kept = (await loadDAVEReportPeriod(period.scopeKey, period.reportFormat, storage, LOCAL_ONLY)).snapshot;
      const send = reportPeriodSend(kept);
      if (send && await reportSnapshotSentHere(send, storage, DAVE_WEB_NO_KEYCHAIN).catch(() => false)) {
        notShared.push({ ...period, sentAt: send.deliveredAt as string });
      }
    }));
    return notShared.sort((left, right) => right.sentAt.localeCompare(left.sentAt));
  } catch {
    // Who is signed in could not be confirmed, or the browser's storage could not be read: nothing can be carried up.
    return [];
  } finally {
    if (waiting) clearTimeout(waiting);
  }
}
