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
  // R2 item 2: the id a tab of this browser sent under before it took the browser's (see settleSenderId).
  readFormerWithoutKeychain: async () => {
    try {
      return browserLocalStorage()?.getItem(FORMER_SENDER_ID_KEY) ?? null;
    } catch {
      return null;
    }
  },
});
/** The id this browser's sends carried before it took another: it names the browser, never an account, as the sender id does. */
const FORMER_SENDER_ID_KEY = '@vitruvius/report-sender-id/former/v1';

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
/** The profile storage that refused each value this tab holds instead (review N5 C): where the browser's own copy is. */
const tabOnlyRefusedBy = new Map<string, BrowserStorage>();
/**
 * Review N4 L2 (6 Oct 2026): keys whose value in the profile is an OLDER period than the one this tab holds, which
 * the profile would neither replace nor remove (a storage that fails altogether). The removal is tried again each
 * time this tab uses the storage, and until it goes the page does not promise that nothing is left.
 */
const olderLeftInProfile = new Map<string, BrowserStorage>();
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
  ownSendFacts.clear();
  sentInThisTab.clear();
  // Nor is anything noted for it by an answer from the shared record that arrives after this (review N2 follow-up).
  sharedForgottenAt.set(prefix, ++sharedSeq);
  for (const key of [...sharedAcceptedAt.keys()]) {
    if (key.startsWith(prefix)) sharedAcceptedAt.delete(key);
  }
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
  // Review N6 (7 Oct 2026, Low, wording, older): nor is the account's list of its own sends, or what it has seen of
  // the shared record. Any of the account's keys held in the tab counted as a period. A report was sent while the
  // browser was full; room came back; he approved the next report, so the browser held the period again; the page
  // still said the storage "is full or switched off" and that the next report "has no 'since the last report'
  // section until one is sent from here again", because the tab still held its list of own sends (rewritten only
  // at the next send). Neither half was so. Said only while the tab holds a period the browser does not.
  for (const [key, value] of tabOnly) {
    if (value !== null && key.startsWith(`${WEB_PREFIX}/`) && storedValueIsPeriod(daveWebStoredReportValue(value))) return true;
  }
  return false;
}

/**
 * Review N5 C (6 Oct 2026, Low, wording; the sentence is 4cc5d40's). Whether all this tab holds beyond the browser is
 * an APPROVAL not yet sent, of a report that counts from a last report sent which the browser does have. The page
 * said "the next report from this computer has no 'since the last report' section until one is sent from here
 * again" whenever the tab held anything; in this state only the approval goes with the tab, and the next tab counts
 * from the last report sent, as it should.
 */
export function daveWebReportOnlyApprovalKeptInTab(): boolean {
  let found = false;
  for (const [key, value] of tabOnly) {
    if (value === null || !key.startsWith(`${WEB_PREFIX}/`)) continue;
    const mine = daveWebStoredReportValue(value);
    // The account's list of its own sends and the like: no period, and nothing the next report counts from.
    if (!storedValueIsPeriod(mine)) continue;
    const runsFrom = storedPeriodSendTime(mine);
    // A report sent, or an approval with no report sent before it: not this state.
    if (runsFrom === null || !storedPeriodIsUnsentApproval(mine)) return false;
    let keptRunsFrom: number | null = null;
    try {
      keptRunsFrom = storedPeriodSendTime(daveWebStoredReportValue(tabOnlyRefusedBy.get(key)?.getItem(key)));
    } catch {
      // A storage that cannot be read holds nothing the next tab could count from.
    }
    if (keptRunsFrom !== runsFrom) return false;
    found = true;
  }
  return found;
}

/** Whether a stored value is a report period at all (and not, say, the account's list of its own sends). */
function storedValueIsPeriod(raw: string | null): boolean {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    return isRecord(parsed) && typeof parsed.scopeKey === 'string';
  } catch {
    return false;
  }
}

/** Whether a stored period is an approval not yet sent. */
function storedPeriodIsUnsentApproval(raw: string | null): boolean {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    return isRecord(parsed) && typeof parsed.scopeKey === 'string' && parsed.deliveredAt === null;
  } catch {
    return false;
  }
}

/** Test seam: a new tab holds nothing in its own memory (neither a period nor the sender id a full profile refused). */
export function forgetDAVEWebReportTabMemory(): void {
  tabOnly.clear();
  tabOnlyRefusedBy.clear();
  olderLeftInProfile.clear();
  sharedAcceptedAt.clear();
}

/** When the report a stored period runs from was sent, as a time; null for no period, or one that runs from no send. */
function storedPeriodSendTime(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.scopeKey !== 'string') return null;
    const reportFormat = parsed.reportFormat === 'project_manager' || parsed.reportFormat === 'executive' ? parsed.reportFormat : undefined;
    const time = sendTime(reportPeriodSentAt(validReportPeriodSnapshot(parsed, parsed.scopeKey, reportFormat)));
    return time === -Infinity ? null : time;
  } catch {
    return null; // The account's own-send list, or nothing this build wrote: no period.
  }
}

/**
 * Review N4 L2 (6 Oct 2026, Low, caused by 46e3332 and de5f6f5). The profile's storage refused a period (`raw`) and
 * this tab keeps it instead. What the profile still held for that key stayed: with a newer report just sent, that
 * was the period of an EARLIER report, and once the tab closed the next report counted from it again, repeated what
 * the newer report had covered, and the page called the earlier one "the last report sent from this computer".
 * A period that runs from an earlier send than the refused one is now removed from the profile: the period can go
 * to "none kept", never back. One that runs from the same send (an approval was refused, the last report sent is
 * still the one kept) stays, as does an approval never sent. A removal the storage also refuses is remembered and
 * tried again.
 */
function clearOlderPeriod(local: BrowserStorage, key: string, raw: string): void {
  const refused = storedPeriodSendTime(raw);
  if (refused === null) return;
  let kept: number | null;
  try {
    kept = storedPeriodSendTime(daveWebStoredReportValue(local.getItem(key)));
  } catch {
    return; // What cannot be read is not read back later either.
  }
  if (kept === null || kept >= refused) {
    // Nothing older is there (any more: another tab of this browser may have stored a later one since).
    olderLeftInProfile.delete(key);
    return;
  }
  try {
    local.removeItem(key);
    // A storage that says nothing and removes nothing is no better than one that refuses.
    if (local.getItem(key) !== null) throw new Error('not removed');
    profileStorages.get(local)?.delete(key);
    olderLeftInProfile.delete(key);
  } catch {
    olderLeftInProfile.set(key, local);
  }
}

/**
 * Tries again to remove each older period the profile would not let go of, only while it is still the older one.
 * One this tab no longer holds a newer period for (the profile has since taken it, or he signed out) is settled.
 */
function clearOlderPeriodsLeft(): void {
  for (const [key, local] of [...olderLeftInProfile]) {
    const mine = daveWebStoredReportValue(tabOnly.get(key));
    if (mine === null) olderLeftInProfile.delete(key);
    else clearOlderPeriod(local, key, mine);
  }
}

/**
 * Whether this browser still holds an earlier report's period that it would neither replace with this tab's newer
 * one nor remove (review N4 L2): once this tab closes, the next report may count from that earlier report.
 */
export function daveWebReportOlderPeriodLeftInBrowser(): boolean {
  return olderLeftInProfile.size > 0;
}

/**
 * Review N5 D (6 Oct 2026, Low, older: 46e3332). The browser's sender id, made by this tab while the browser's
 * storage refused writes, lived in the tab only and was never offered to the storage again. A report sent from the
 * tab later, once the storage worked, was stored carrying that id; the next tab found no id in the browser, made a
 * second one, and read this computer's own last report as another device's: "Not counted yet: this device hasn't
 * received your other device's latest changes.", with no shared record at all. The id this tab's sends carry is now
 * stored as soon as the storage takes it. If another tab has given the browser an id meanwhile, that one is the
 * browser's and this tab uses it from then on: never two.
 */
function settleSenderId(local: BrowserStorage | null): void {
  const mine = tabOnly.get(REPORT_SENDER_ID_KEY);
  if (!local || typeof mine !== 'string') return;
  try {
    if (local.getItem(REPORT_SENDER_ID_KEY) === null) local.setItem(REPORT_SENDER_ID_KEY, mine);
    // A storage that takes it in silence and keeps nothing has not taken it.
    const kept = local.getItem(REPORT_SENDER_ID_KEY);
    if (kept === null) return;
    // R2 item 2 (9 Oct 2026; pass 6, seen): another tab gave the browser an id first, so this tab moves to it, and
    // the one report it had sent under its own id stayed under that id: later tabs took that report for another
    // device's. The tab's id is kept as the browser's former id, and its list of own sends is written with what
    // the browser has, so that report is known as this browser's by the same rule the phone uses for a former id.
    if (kept !== mine) {
      if (local.getItem(FORMER_SENDER_ID_KEY) === null) local.setItem(FORMER_SENDER_ID_KEY, mine);
      keepTabOwnSends(local);
    }
    tabOnly.delete(REPORT_SENDER_ID_KEY);
  } catch {
    // Still refused: the tab keeps its own.
  }
}

/** Writes each account's list of own send times that only this tab holds, together with the times the browser already has. */
function keepTabOwnSends(local: BrowserStorage): void {
  for (const [key, value] of [...tabOnly]) {
    if (value === null || !key.startsWith(`${WEB_PREFIX}/`) || !key.endsWith(OWN_SEND_TIMES_KEY)) continue;
    const times = (raw: string | null): string[] => {
      try {
        const parsed: unknown = JSON.parse(raw ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((time): time is string => typeof time === 'string') : [];
      } catch {
        return [];
      }
    };
    local.setItem(key, JSON.stringify([...new Set([...times(local.getItem(key)), ...times(value)])].sort().slice(-50)));
    profileStorages.get(local)?.add(key);
    tabOnly.delete(key);
  }
}
/** The store's key for an account's list of its own send times (DAVEReportSnapshotStore OWN_SENDS_KEY). */
const OWN_SEND_TIMES_KEY = '@vitruvius/report-snapshots/own-sends/v1';

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
    clearOlderPeriodsLeft();
    settleSenderId(local);
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
      if (local) tabOnlyRefusedBy.set(key, local);
      if (local && raw !== null) clearOlderPeriod(local, key, raw);
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
  // The account the shared record last answered for (a write that names none is that account's), and the last
  // write of each period with how it was answered.
  const asked: SharedRecordAsked = { owner: null, writes: new Map() };
  const cloud: DAVEReportSnapshotCloud = Object.freeze({
    async read(scopeKey: string, reportFormat: DAVEReportFormat) {
      const askedAt = ++sharedSeq;
      const result = await load(scopeKey, reportFormat);
      if (result === 'unavailable') return null;
      asked.owner = result.ownerId;
      // What the shared record runs from, as this browser has now seen it (review N2 follow-up).
      const shown = reportPeriodSentAt(validReportPeriodSnapshot(result.snapshot, scopeKey, reportFormat));
      noteSharedRecord(result.ownerId, scopeKey, reportFormat, shown, askedAt, 'read');
      return result;
    },
    async write(snapshot: DAVEReportSnapshot, expectedOwnerId?: string) {
      const askedAt = ++sharedSeq;
      const owner = expectedOwnerId ?? asked.owner;
      const saving = save({
        scopeKey: snapshot.scopeKey,
        format: snapshot.reportFormat as DAVEReportFormat,
        snapshot,
        approvedAt: snapshot.capturedAt,
        deliveredAt: reportPeriodSentAt(snapshot),
        expectedOwnerId,
      });
      if (snapshot.reportFormat) {
        asked.writes.set(`${snapshot.scopeKey}|${snapshot.reportFormat}`, saving.then(answer => answer, () => 'failed' as const));
      }
      const answer = await saving;
      // Accepted: the shared record now runs from this period's send, or from a later one it kept.
      if (answer === 'saved' && owner && snapshot.reportFormat) {
        noteSharedRecord(owner, snapshot.scopeKey, snapshot.reportFormat, reportPeriodSentAt(snapshot), askedAt, 'accepted');
      }
      return answer;
    },
  });
  sharedRecordAsked.set(cloud, asked);
  return cloud;
}

/** What a cloud made here was last asked: for which account, and each period's last write with its answer. */
type SharedRecordAsked = { owner: string | null; writes: Map<string, Promise<'saved' | 'unavailable' | 'failed'>> };
const sharedRecordAsked = new WeakMap<DAVEReportSnapshotCloud, SharedRecordAsked>();

/** How long a send waits for the shared record's answer before the page says where the send stands. */
const SEND_SHARED_ANSWER_WAIT_MS = 2500;

/**
 * Review N2 follow-up (5 Oct 2026): where a send just recorded on this
 * computer stands in the shared record. The page said "The next report on
 * every device runs from this one" from its last READ of the shared record,
 * not from whether this send's own write arrived: a send made as the record
 * went out of reach said "every device" before it had got there. This waits
 * (a moment at most) for the answer to that write, or for a read that shows
 * the send there: 'checked' when the record is known to run from the send;
 * 'unavailable' when reports are not shared between his devices yet;
 * 'unchecked' when it has not arrived (yet).
 */
export async function daveWebReportSendReachedShared(
  cloud: DAVEReportSnapshotCloud,
  period: Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>,
  sentAt: string,
  waitMs: number = SEND_SHARED_ANSWER_WAIT_MS,
): Promise<DAVEReportSharedCheck> {
  const asked = sharedRecordAsked.get(cloud);
  const write = asked?.writes.get(`${period.scopeKey}|${period.reportFormat}`);
  if (!asked || !write) return 'unchecked';
  const arrived = () => Boolean(asked.owner && daveWebReportSendSeenInSharedRecord(asked.owner, period, sentAt));
  if (arrived()) return 'checked';
  let waiting: ReturnType<typeof setTimeout> | undefined;
  let stopListening: () => void = () => undefined;
  const answer = await Promise.race([
    write,
    // A read of the record that shows the send there says so too, whatever became of the write's own answer.
    new Promise<'seen'>(resolve => {
      stopListening = onDAVEWebReportSharedRecordSeen(() => {
        if (arrived()) resolve('seen');
      });
    }),
    new Promise<'no_answer_yet'>(resolve => {
      waiting = setTimeout(() => resolve('no_answer_yet'), waitMs);
    }),
  ]);
  stopListening();
  if (waiting) clearTimeout(waiting);
  if (answer === 'unavailable') return 'unavailable';
  return arrived() ? 'checked' : 'unchecked';
}

/** What `onDAVEWebReportSharedRecordSeen` tells: the send the shared record was just seen to run from, for which period. */
export type DAVEWebSharedRecordSeen = Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat; sentAt: string | null }>;
const sharedRecordSeenListeners = new Set<(seen: DAVEWebSharedRecordSeen) => void>();

/**
 * Tells `listener` whenever this browser sees the shared record run from another send than it last saw (review N2
 * follow-up): the page corrects "Your other devices count from it once this computer reaches the shared record
 * again" when the send does arrive. Returns how to stop.
 */
export function onDAVEWebReportSharedRecordSeen(listener: (seen: DAVEWebSharedRecordSeen) => void): () => void {
  sharedRecordSeenListeners.add(listener);
  return () => {
    sharedRecordSeenListeners.delete(listener);
  };
}

/**
 * Review N2 follow-up (5 Oct 2026): what this browser has seen of the shared
 * record, for each account and period: the send it was last seen to run
 * from. Sign Out's warning ("A report sent from this computer may not have
 * reached your other devices") appeared whenever the shared record could not
 * be reached at sign-out, also for a send that had reached it long before (8
 * of the 11 times in the reviewer's sequences). A send is known to be there
 * once the record accepted it, or a read showed the record running from it
 * (or from a later one; the record never runs backwards). A read that shows
 * an older send takes that back, unless it was asked before the write was
 * accepted. Kept beside the account's periods in this browser, and removed
 * with them at sign-out.
 */
const SHARED_SEEN_KEY = '@vitruvius/report-snapshots/shared-seen/v1';
/** Counts what is asked of the shared record and when an account was forgotten, in order. */
let sharedSeq = 0;
/** When each account's periods were last removed from this browser: an answer asked for before that notes nothing. */
const sharedForgottenAt = new Map<string, number>();
/** When the shared record last accepted a write of each period. */
const sharedAcceptedAt = new Map<string, number>();

function sharedSeenKey(ownerId: string, scopeKey: string, reportFormat: DAVEReportFormat): string {
  return `${accountPrefix(ownerId)}${SHARED_SEEN_KEY}:${encodeURIComponent(scopeKey)}:${reportFormat}`;
}

/** A small value this browser keeps for an account beside its periods, read at once (this tab's own copy first). */
function accountValue(key: string): string | null {
  if (tabOnly.has(key)) return tabOnly.get(key) ?? null;
  try {
    return browserLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Keeps it, or removes it (null): in the profile's storage, or in this tab's memory when that will not take it. */
function keepAccountValue(key: string, value: string | null): void {
  const local = browserLocalStorage();
  if (local && !profileStorages.has(local)) profileStorages.set(local, new Set());
  try {
    if (!local) throw new Error('no profile storage');
    if (value === null) local.removeItem(key);
    else local.setItem(key, value);
    if (value === null) profileStorages.get(local)?.delete(key);
    else profileStorages.get(local)?.add(key);
    tabOnly.delete(key);
  } catch {
    if (value === null) tabOnly.delete(key);
    else tabOnly.set(key, value);
  }
}

const sendTime = (sentAt: string | null | undefined) => {
  const time = Date.parse(sentAt ?? '');
  return Number.isNaN(time) ? -Infinity : time;
};

function noteSharedRecord(
  ownerId: string,
  scopeKey: string,
  reportFormat: DAVEReportFormat,
  /** The send the shared record runs from; null for none. */
  sentAt: string | null,
  /** When the read or write was asked for. */
  asked: number,
  how: 'read' | 'accepted',
): void {
  // The account's periods were removed from this browser meanwhile (a sign-out): nothing of it is written back.
  if ((sharedForgottenAt.get(accountPrefix(ownerId)) ?? 0) > asked) return;
  const key = sharedSeenKey(ownerId, scopeKey, reportFormat);
  const known = accountValue(key);
  const earlier = sendTime(sentAt) < sendTime(known);
  if (how === 'accepted') {
    sharedAcceptedAt.set(key, ++sharedSeq);
    // The record kept a later send it already had.
    if (earlier) return;
  } else if (earlier && asked < (sharedAcceptedAt.get(key) ?? 0)) {
    // Asked before the write was accepted: it says nothing against it.
    return;
  }
  if ((sentAt ?? null) === known) return;
  keepAccountValue(key, sentAt ?? null);
  for (const listener of [...sharedRecordSeenListeners]) {
    try {
      listener({ scopeKey, reportFormat, sentAt: sentAt ?? null });
    } catch {
      // A page that fails to hear it changes nothing here.
    }
  }
}

/** Whether this browser has seen the shared record run from the send at `sentAt`, or from a later one (review N2 follow-up). */
export function daveWebReportSendSeenInSharedRecord(
  ownerId: string,
  period: Readonly<{ scopeKey: string; reportFormat: DAVEReportFormat }>,
  sentAt: string,
): boolean {
  const seen = accountValue(sharedSeenKey(ownerId, period.scopeKey, period.reportFormat));
  return seen !== null && sendTime(seen) >= sendTime(sentAt) && sendTime(sentAt) > -Infinity;
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
  ownSendFacts.clear();
}

/**
 * How many sent reports a saved period remembers: the one it runs from and the two before it (each saved report
 * keeps the one it replaced, and that one's own: A6 pass 16 L1). R1 item 3 (8 Oct 2026): the limit is what the
 * period itself carries. Each remembered report is a full list of the tasks as they stood, kept in this browser
 * and in the one shared row per period, so that the next report can be compared with the last and the one before
 * can still be told apart; three keeps that row bounded. It is not a limit on purpose for Mark as Sent or for
 * sharing again: those simply cannot recognise a report from before the three, and the page now says so.
 */
const MOST_SENDS_A_PERIOD_REMEMBERS = 3;

/** The sent reports a period remembers, newest first. */
function periodSends(snapshot: DAVEReportSnapshot | null | undefined): DAVEReportSnapshot[] {
  const sends: DAVEReportSnapshot[] = [];
  for (let send = reportPeriodSend(snapshot); send && sends.length < MOST_SENDS_A_PERIOD_REMEMBERS; send = reportPeriodSend(send.supersedes)) {
    sends.push(send);
  }
  return sends;
}

/**
 * R1 item 3 (8 Oct 2026, the owner's open items): whether a report that counted from `preparedKey` is from before
 * the sent reports `period` remembers. Sharing such a report again (opened from Report history) could not be told
 * from a report never sent, and the page said "This computer could not record that this report was sent ... The
 * next report ... may repeat what this one covered", which is not what happened.
 */
export function daveWebReportFromBeforeRememberedSends(
  period: DAVEReportSnapshot | null | undefined,
  preparedKey: string | null | undefined,
): boolean {
  const sends = periodSends(period);
  // Fewer than it can hold: it remembers every report sent, and this is none of them.
  if (sends.length < MOST_SENDS_A_PERIOD_REMEMBERS) return false;
  // A report saved before reports kept their period: not known.
  const countedFrom = preparedKey === 'none' ? null : preparedKey?.startsWith('sent:') ? preparedKey.slice('sent:'.length) : undefined;
  if (countedFrom === undefined) return false;
  const oldest = sendTime(sends[sends.length - 1].deliveredAt);
  return countedFrom === null || sendTime(countedFrom) < oldest;
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
  if (sent?.deliveredAt) return sent.deliveredAt;
  // R2 item 1: a report from before the three the period remembers, by this browser's own list of what it sent.
  return period?.reportFormat ? ownSendFacts.get(ownSendFactsKey(period.scopeKey, period.reportFormat, fingerprint)) ?? null : null;
}

/**
 * R2 item 1 (9 Oct 2026, the owner's answer to R1 item 3: lift the limit on the web). A saved period remembers
 * three sent reports, so sharing again (and "already recorded") recognised only this computer's last three. This
 * browser now also keeps, for each account, a short list of the reports it sent: when, for which projects and
 * format, and the fingerprint of their facts. No report text, no tasks. The last 50; kept under the account's
 * own prefix, so Sign Out of This Computer and a sign-in the server ended remove it with the report periods
 * (owner answer Q26). When the browser's storage will not take it, it lasts as long as the tab, and after that
 * the three the period remembers are what is known, with the sentence R1 wrote for a report older than them.
 */
const OWN_SEND_FACTS_KEY = '@vitruvius/report-snapshots/own-send-facts/v1';
const MOST_OWN_SEND_FACTS_KEPT = 50;
type OwnSendFacts = Readonly<{ sentAt: string; scopeKey: string; reportFormat: DAVEReportFormat; fingerprint: string }>;
/** The signed-in account's list as this tab last read it: projects, format and facts to when it was sent. */
const ownSendFacts = new Map<string, string>();
const ownSendFactsKey = (scopeKey: string, reportFormat: string, fingerprint: string) => JSON.stringify([scopeKey, reportFormat, fingerprint]);

async function ownSendFactsKept(storage: SnapshotStorage): Promise<OwnSendFacts[]> {
  try {
    const parsed: unknown = JSON.parse(await storage.getItem(OWN_SEND_FACTS_KEY) ?? '[]');
    return (Array.isArray(parsed) ? parsed : []).filter((entry): entry is OwnSendFacts => isRecord(entry) &&
      typeof entry.sentAt === 'string' && typeof entry.scopeKey === 'string' && typeof entry.fingerprint === 'string' &&
      (entry.reportFormat === 'project_manager' || entry.reportFormat === 'executive'));
  } catch {
    return [];
  }
}

/** Reads the account's list into this tab (only that account's: the tab's copy is replaced, not added to). */
async function recallOwnSendFacts(storage: SnapshotStorage): Promise<void> {
  const kept = await ownSendFactsKept(storage);
  ownSendFacts.clear();
  kept.forEach(entry => ownSendFacts.set(ownSendFactsKey(entry.scopeKey, entry.reportFormat, entry.fingerprint), entry.sentAt));
}

async function rememberOwnSendFacts(storage: SnapshotStorage, sent: OwnSendFacts): Promise<void> {
  const key = ownSendFactsKey(sent.scopeKey, sent.reportFormat, sent.fingerprint);
  const others = (await ownSendFactsKept(storage)).filter(entry => ownSendFactsKey(entry.scopeKey, entry.reportFormat, entry.fingerprint) !== key);
  await storage.setItem(OWN_SEND_FACTS_KEY, JSON.stringify([...others, sent].slice(-MOST_OWN_SEND_FACTS_KEPT))).catch(() => undefined);
  ownSendFacts.set(key, sent.sentAt);
}

/** Whether this browser has its list of sent reports for the signed-in account (it says "the last 50", not "three"). */
export function daveWebOwnSendFactsKept(): boolean {
  return ownSendFacts.size > 0;
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
  await recallOwnSendFacts(store.storage);
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
  await rememberOwnSendFacts(store.storage, { sentAt: deliveredAt, scopeKey: period.scopeKey, reportFormat: period.reportFormat, fingerprint: delivered.sourceFingerprint });
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
  // What this browser has seen of the shared record is no period, and nothing to carry up.
  const kept = (key: string) => key.startsWith(`${WEB_PREFIX}/`) && !key.includes(SHARED_SEEN_KEY);
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
        // Seen in the shared record before now (accepted by it, or read back from it): it is there, though the
        // record cannot be reached at this moment, and nothing is said (review N2 follow-up).
        if (daveWebReportSendSeenInSharedRecord(owner, period, send.deliveredAt as string)) return;
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
