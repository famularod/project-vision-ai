import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EMPTY_SHARED_DOCUMENT_ARCHIVE_VIEW as EMPTY_VIEW,
  NO_SHARED_DOCUMENT_ARCHIVE_NOTICES as NO_NOTICES,
  publishSharedDocumentArchiveView,
  sharedDocumentArchiveView,
  type SharedDocumentArchiveNotice,
  type SharedDocumentRestoreWaiting,
} from './SharedDocumentArchiveView';

// What the device knows right now, and the one rule for lists, live in a file of their own that loads no device
// storage (review of D1, L10); everything that used to import them from here still can.
export {
  sharedDocumentArchiveView,
  sharedDocumentsListed,
  subscribeSharedDocumentArchive,
  type SharedDocumentArchiveNotice,
  type SharedDocumentArchiveView,
  type SharedDocumentRestoreWaiting,
} from './SharedDocumentArchiveView';

/**
 * Owner answer Q44 (6 Oct 2026): "Archive" for a compliance document means
 * hidden on every device, kept in the cloud. Nothing is deleted, and it can
 * be brought back.
 *
 * The mark is one column of the cloud's shared-document table,
 * reference_documents.archived_at: the time the document was archived, or
 * nothing. It is a column of its own and not a field inside the record,
 * because every build writes a shared document by naming its columns (id,
 * name, category, document_data, updated_at, owner_id) and a build that does
 * not know the mark rebuilds the record from its own fixed list of fields: a
 * field in the record would be dropped by the first such write. A column no
 * such write names is left as it is.
 *
 * The column is there only once the owner has pasted the database change.
 * Until then the cloud answers "no such column": that is taken, quietly, as
 * "not installed", and archiving stays on the one device, as before. A
 * device that has never had an answer (no signal since it was installed)
 * treats the mark as not installed too. Nothing is put on the waiting list
 * in either state, so pasting the database change hides nothing by itself
 * (review of D1, L9).
 *
 * This file is the device's side of it:
 * - what the cloud last said is archived, kept on the device (per account)
 *   so it holds at the next launch with no signal;
 * - a waiting list of this device's own archive and restore, made while the
 *   device knows the mark is installed and cannot reach the cloud, and sent
 *   when it can, by the account that asked and no other;
 * - the one rule every list uses: archived = the cloud's answer, plus what
 *   this device is waiting to archive, minus what it is waiting to restore.
 *
 * The waiting list is its own, not the main upload queue's: that queue's
 * saved items are checked by a fixed rule in every build, and a document item
 * there carries a whole record, which an older build would send.
 *
 * Whose tap counts (second review, P2-M1; the coordinator's decision). No
 * device's clock has any part in it: two devices' clocks need not agree, and
 * a rule that compares them undoes a later tap without a word.
 * - On one device his taps on a document are applied in the order he made
 *   them: the newest is the one that waits. It remembers what this device
 *   has itself sent and not yet heard back about, so a write still on its
 *   way is never mistaken for another device's doing.
 * - A waiting tap is sent only if the cloud's mark for the document is still
 *   the one this device last knew when he tapped (or one this device sent
 *   itself). The write carries that mark as its condition, so the cloud
 *   checks it again in the same request: a mark that changes between the
 *   question and the write is not written over.
 * - If the cloud already says what he asked for, nothing is sent and there
 *   is nothing to tell. One case is sent all the same: an Archive tapped
 *   while the cloud still holds the very Archive he was shown (he restored
 *   and archived again before the Restore went). It writes its own mark over
 *   the old one, so a Restore made elsewhere against the old mark is let go
 *   with a line instead of undoing it without a word.
 * - Otherwise the mark was changed on another device and this device had
 *   not heard: the cloud's state stands, the waiting tap is let go, and a
 *   line on this device says so, with what the document's state now is, so
 *   that he can tap again if he still wants it. A Restore let go this way
 *   leaves the document archived here too; an Archive let go this way puts
 *   this device's card back.
 * So the cloud always ends as the last tap to REACH it asked, and a tap that
 * did not take effect always leaves a line on the device it was made on.
 * The time an Archive writes into the mark is the time he tapped. It is the
 * mark itself and is only ever compared for "the same mark or not", never
 * for earlier or later. A Restore keeps no time at all.
 */

// Owner-sensitive prefix: an account switch moves it with that owner's data.
export const SHARED_DOCUMENT_ARCHIVE_STORAGE_KEY = 'projectPhotoUpdate.sharedDocumentArchive.v1';
const SHARED_DOCUMENTS_TABLE = 'reference_documents';
const WAITING_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 6000;
/**
 * A tap the cloud answered and did not take (a refusal, or no such row yet)
 * is never given up (review of D1, L3). It is tried again after a wait that
 * doubles from half a minute to a quarter of an hour, and the device says
 * plainly that the cloud has not accepted it.
 *
 * The wait is counted in time the app has been running, not read off the
 * device's clock (second review, P2-L2): a clock set forward or back, by
 * hand or by the network, neither cuts a wait short nor stretches it (a tap
 * refused while the clock was a day fast used to sit unsent for a day after
 * the clock was put right). The waits are kept in memory only, so after the
 * app has been closed and opened every waiting tap is tried at once.
 */
const RETRY_FIRST_WAIT_MS = 30_000;
const RETRY_LONGEST_WAIT_MS = 15 * 60_000;
const retryWaitMs = (refusals: number) => Math.min(RETRY_LONGEST_WAIT_MS, RETRY_FIRST_WAIT_MS * 2 ** Math.min(Math.max(refusals, 1) - 1, 10));

/**
 * How long this app has been running, in milliseconds: a count that setting the device's clock does not move. Null
 * where a device has no such count: then no wait is kept here at all, and the half-minute timer of the hook is what
 * spaces the tries.
 */
export type RunningTime = () => number | null;
const appRunningMs: RunningTime = () => {
  const counter = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof counter?.now === 'function' ? counter.now() : null;
};
/** When each refused tap may next be tried, in running time, by account and document. In memory only. */
const retryNotBefore = new Map<string, number>();
const retryKey = (ownerId: string, documentId: string) => `${ownerId}\n${documentId}`;
/** How long a refused tap still has to wait: 0 when it is due, when nothing is kept for it, or when the count is not to be trusted. */
function retryWaitLeftMs(ownerId: string, documentId: string, running: RunningTime): number {
  const notBefore = retryNotBefore.get(retryKey(ownerId, documentId));
  const now = running();
  if (notBefore === undefined || now === null) return 0;
  const left = notBefore - now;
  // Never longer than the longest wait there is, whatever the count says.
  return left > RETRY_LONGEST_WAIT_MS ? 0 : Math.max(0, left);
}

/** The cloud's mark on a document: the time it was archived, or null for "not archived". */
type CloudMark = string | null;

type WaitingMark = Readonly<{
  documentId: string; archived: boolean;
  /**
   * An Archive only: the time he tapped, which is what is written into the cloud's mark. It is the mark itself,
   * compared only for "the same mark or not" and never for earlier or later. A Restore writes no time and keeps none.
   */
  at?: string;
  /** Which of this device's taps this is, counted on this device: his taps are applied in the order he made them. */
  tap: number;
  /** How many times the cloud has answered and not taken it. (When it is next tried is not saved: see retryNotBefore.) */
  attempts: number;
  /** The cloud's mark for the document as this device last knew it when he tapped (second review, P2-M1). */
  seen?: CloudMark;
  /** Marks this device has sent for the document and has not heard back about: one may be in the cloud (review of D1, L8). */
  sent?: readonly CloudMark[];
  /** The document's name, when the screen that took the tap had it: for the line that says a tap was not sent. */
  name?: string;
  /** A pass to the cloud has come and gone and it is still here (no signal, or a refusal): said to be waiting (review of D1, L5). */
  held?: true;
}>;

const NOTICE_LIMIT = 20;
/** At most this many documents are asked about one by one in a pass (review of D1, L4); the rest wait for the next. */
const GONE_QUESTION_LIMIT = 25;

type OwnerRecord = Readonly<{
  /** true once the cloud answered with the column; false when it said "no such column"; null when never asked. */
  installed: boolean | null;
  /** The cloud's answer when it was last read: each archived document's id and its mark. */
  marks: Readonly<Record<string, string>>;
  waiting: readonly WaitingMark[];
  /** Archived when last read, no longer, and not by this device: its card here is put back. */
  restoredElsewhere: readonly string[];
  notices: readonly SharedDocumentArchiveNotice[];
  /** How many taps this device has taken for this account: each waiting tap carries its number. */
  taps: number;
}>;

export type SharedDocumentArchiveCloudAnswer = 'installed' | 'not_installed' | 'unknown';

type CloudError = Readonly<{ code?: string | null; message?: string | null }>;
type CloudAnswer = Readonly<{ data?: unknown; error?: CloudError | null; status?: number }>;
/** The part of the cloud client this file uses. */
export type SharedDocumentArchiveClient = Readonly<{
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  auth?: { getSession?: () => Promise<{ data?: { session?: { user?: { id?: string | null } | null } | null } | null }> } | null;
}>;

const EMPTY_RECORD: OwnerRecord = Object.freeze({
  installed: null, marks: Object.freeze({}), waiting: [], restoredElsewhere: [], notices: NO_NOTICES, taps: 0,
});
/**
 * Two marks are the same mark: both empty, or the same moment. The cloud and the device write one moment differently
 * ("2026-10-06T18:00:00.5+00:00" and "2026-10-06T18:00:00.500Z"), so the text is not compared as it stands. The moment
 * is worked out here from the digits, not left to the device's own reading of a date, which is not the same on every
 * device. Only "the same or not" is ever asked of two marks: never which is earlier.
 */
function sameMark(one: CloudMark | undefined, other: CloudMark | undefined): boolean {
  const first = one ?? null;
  const second = other ?? null;
  if (first === null || second === null) return first === second;
  if (first === second) return true;
  const firstMoment = markMoment(first);
  const secondMoment = markMoment(second);
  if (firstMoment !== null && secondMoment !== null) return firstMoment === secondMoment;
  const parsed = Date.parse(first);
  return !Number.isNaN(parsed) && parsed === Date.parse(second);
}

const MARK_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** A mark's moment as "whole seconds since 1970, and millionths": the same for every way of writing that moment; null when it is not such a time. */
function markMoment(mark: string): string | null {
  const parts = MARK_TIME.exec(mark.trim());
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone = 'Z'] = parts;
  const offset = /^z$/i.test(zone) ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.replace(':', '').slice(3, 5) || 0));
  const seconds = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000 - offset * 60;
  return Number.isFinite(seconds) ? `${seconds}.${fraction.padEnd(6, '0').slice(0, 6)}` : null;
}

let records = new Map<string, OwnerRecord>();
let loaded: Promise<void> | null = null;
let activeOwnerId: string | null = null;
let storageWrite: Promise<unknown> = Promise.resolve();
let cloudWork: Promise<unknown> = Promise.resolve();

/**
 * Reads the saved copy. Every change waits for it, so nothing is changed
 * before it has been read. It is read again each time a workspace opens: an
 * account switch puts that account's own saved copy in place of the last
 * one's, and what is in memory must never be written over it.
 */
function load(again = false): Promise<void> {
  if (!loaded || again) {
    loaded = Promise.resolve(loaded)
      .then(() => storageWrite)
      .then(() => AsyncStorage.getItem(SHARED_DOCUMENT_ARCHIVE_STORAGE_KEY))
      .then(raw => { records = parseStored(raw); })
      .catch(() => undefined)
      .then(() => { publish(); });
  }
  return loaded;
}

function parseStored(raw: string | null): Map<string, OwnerRecord> {
  const found = new Map<string, OwnerRecord>();
  if (!raw) return found;
  try {
    const value = JSON.parse(raw) as { owners?: unknown } | null;
    const owners = value && typeof value === 'object' && value.owners && typeof value.owners === 'object'
      ? value.owners as Record<string, unknown> : {};
    Object.entries(owners).forEach(([ownerId, entry]) => {
      const record = (entry && typeof entry === 'object' ? entry : {}) as Partial<Record<keyof OwnerRecord, unknown>>;
      const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []);
      const isMark = (value: unknown): value is CloudMark => value === null || typeof value === 'string';
      const times = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value as Record<string, unknown> : {})
        .filter((entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string'));
      const waiting = (Array.isArray(record.waiting) ? record.waiting : []).flatMap((item, index): WaitingMark[] => {
        const mark = (item && typeof item === 'object' ? item : {}) as Partial<WaitingMark>;
        // An Archive carries the time it writes into the mark. A Restore carries none (one saved with a time, by an
        // earlier form of this file, is read without it: no tap's time is kept for a decision; second review, P2-M1).
        if (typeof mark.documentId !== 'string' || !mark.documentId || typeof mark.archived !== 'boolean') return [];
        if (mark.archived && typeof mark.at !== 'string') return [];
        return [{
          documentId: mark.documentId, archived: mark.archived, ...(mark.archived ? { at: mark.at } : {}),
          tap: typeof mark.tap === 'number' ? mark.tap : index + 1,
          attempts: typeof mark.attempts === 'number' ? mark.attempts : 0,
          seen: isMark(mark.seen) ? mark.seen : null,
          ...(Array.isArray(mark.sent) && mark.sent.length > 0 ? { sent: mark.sent.filter(isMark) } : {}),
          ...(typeof mark.name === 'string' && mark.name ? { name: mark.name } : {}),
          ...(mark.held === true ? { held: true as const } : {}),
        }];
      });
      found.set(ownerId, {
        installed: record.installed === true ? true : record.installed === false ? false : null,
        marks: times(record.marks),
        waiting,
        taps: Math.max(typeof record.taps === 'number' ? record.taps : 0, ...waiting.map(mark => mark.tap)),
        restoredElsewhere: ids(record.restoredElsewhere),
        notices: (Array.isArray(record.notices) ? record.notices : []).flatMap(item => {
          const notice = (item && typeof item === 'object' ? item : {}) as Partial<SharedDocumentArchiveNotice>;
          return typeof notice.documentId === 'string' && notice.documentId && (notice.tap === 'archive' || notice.tap === 'restore')
            ? [{
                documentId: notice.documentId, tap: notice.tap,
                why: notice.why === 'deleted_from_all_devices' || notice.why === 'restored_on_another_device' ? notice.why : 'archived_again_on_another_device' as const,
                ...(typeof notice.name === 'string' && notice.name ? { name: notice.name } : {}),
              }]
            : [];
        }),
      });
    });
  } catch {
    // An unreadable copy is the same as none: the cloud is asked again.
  }
  return found;
}

function recordOf(ownerId: string): OwnerRecord {
  return records.get(ownerId) ?? EMPTY_RECORD;
}

function change(ownerId: string, next: (record: OwnerRecord) => OwnerRecord): void {
  const before = recordOf(ownerId);
  const changed = next(before);
  if (changed === before) return;
  const after = withLinesStillTrue(changed);
  records.set(ownerId, after);
  const saved = JSON.stringify({ version: 1, owners: Object.fromEntries(records) });
  storageWrite = storageWrite
    .then(() => AsyncStorage.setItem(SHARED_DOCUMENT_ARCHIVE_STORAGE_KEY, saved))
    .catch(() => undefined);
  if (ownerId === activeOwnerId) publish();
}

/**
 * A line about a tap that was not sent says what the document's state is (second review, P2-M1 and P2-L1). It is kept
 * only while that is still so, and only until he taps on that document again on this device: a line that has stopped
 * being true is taken away, not left for him to act on.
 */
function withLinesStillTrue(record: OwnerRecord): OwnerRecord {
  if (record.notices.length === 0) return record;
  const tappedAgain = new Set(record.waiting.map(mark => mark.documentId));
  const stillTrue = record.notices.filter(notice => !tappedAgain.has(notice.documentId) && (
    notice.why === 'archived_again_on_another_device' ? notice.documentId in record.marks
      : notice.why === 'restored_on_another_device' ? !(notice.documentId in record.marks)
        : true));
  return stillTrue.length === record.notices.length ? record : { ...record, notices: stillTrue };
}

function publish(): void {
  const record = activeOwnerId ? records.get(activeOwnerId) : null;
  if (!record) {
    if (sharedDocumentArchiveView() !== EMPTY_VIEW) publishSharedDocumentArchiveView(EMPTY_VIEW);
    return;
  }
  {
    const waitingArchive = record.waiting.filter(mark => mark.archived).map(mark => mark.documentId);
    const waitingRestore = new Set(record.waiting.filter(mark => !mark.archived).map(mark => mark.documentId));
    publishSharedDocumentArchiveView(Object.freeze({
      installed: record.installed,
      archivedIds: new Set([...Object.keys(record.marks), ...waitingArchive].filter(id => !waitingRestore.has(id))),
      waitingIds: new Set(waitingArchive.filter(id => !(id in record.marks))),
      refusedIds: new Set(record.waiting.filter(mark => mark.attempts > 0).map(mark => mark.documentId)),
      restoredElsewhere: record.restoredElsewhere,
      notices: record.notices,
      waitingRestores: record.waiting.filter(mark => !mark.archived && mark.held)
        .map((mark): SharedDocumentRestoreWaiting => ({ documentId: mark.documentId, ...(mark.name ? { name: mark.name } : {}), refused: mark.attempts > 0 })),
    }));
  }
}

/**
 * How long until what waits for the open account is next due to be sent: 0 = now, null = nothing waits. Worked out
 * when asked, from the time the app has been running; the device's clock is not read (second review, P2-L2).
 */
export function sharedDocumentArchiveNextTryInMs(running: RunningTime = appRunningMs): number | null {
  const ownerId = activeOwnerId;
  const waiting = ownerId ? recordOf(ownerId).waiting : [];
  if (!ownerId || waiting.length === 0) return null;
  return Math.min(...waiting.map(mark => retryWaitLeftMs(ownerId, mark.documentId, running)));
}

/** Opens the signed-in account's copy; the lists then follow it. */
export async function openSharedDocumentArchive(ownerId: string | null): Promise<void> {
  activeOwnerId = ownerId;
  publish();
  await load(true);
}

/** Whatever this device still has to save has been saved (used by tests and before the app closes its account). */
export async function sharedDocumentArchiveSettled(): Promise<void> {
  await load();
  await cloudWork.catch(() => undefined);
  await storageWrite;
}

/**
 * The owner archived (true) or restored (false) this shared document on this
 * device. It is hidden, or shown again, here at once; the cloud is told when
 * it can be reached.
 *
 * Until this device knows the cloud keeps the mark there is nothing to tell
 * it: the archive is this device's own, on its own card, as in every build
 * before, and nothing waits to be sent later (review of D1, L9).
 *
 * His newest tap on a document takes the place of an older one still
 * waiting (review of D1, L8). It is kept even when the cloud, as far as this
 * device knows, already says the same: what this device knows may be old, or
 * a write of its own may still be on its way, and only the next question to
 * the cloud settles which. It goes with the cloud's mark as this device knows
 * it at this moment: that is what the cloud must still hold for the tap to be
 * sent (second review, P2-M1). Then it is sent, or found already done, or
 * let go with a line saying so. `at` is the time an Archive writes into the
 * mark (a Restore keeps none). `name` is the document's name where the
 * screen has it, for that line.
 */
export async function requestSharedDocumentArchive(
  documentId: string, archived: boolean, at: string = new Date().toISOString(), name?: string,
): Promise<void> {
  const ownerId = activeOwnerId;
  const id = documentId.trim();
  if (!ownerId || !id) return;
  await load();
  retryNotBefore.delete(retryKey(ownerId, id)); // his newest tap is tried at once, whatever an older one was waiting for
  change(ownerId, record => {
    const earlier = record.waiting.find(mark => mark.documentId === id);
    const others = record.waiting.filter(mark => mark.documentId !== id);
    if (record.installed !== true) return earlier ? { ...record, waiting: others } : record;
    // What this device has sent and not heard back about goes with the newest tap.
    const sent = earlier?.sent ?? [];
    const label = name?.trim() || earlier?.name;
    const tap = record.taps + 1;
    const mark: WaitingMark = {
      documentId: id, archived, ...(archived ? { at } : {}), tap, attempts: 0, seen: record.marks[id] ?? null,
      ...(sent.length > 0 ? { sent } : {}), ...(label ? { name: label } : {}),
    };
    return { ...record, taps: tap, waiting: [...others, mark].slice(-WAITING_LIMIT) };
  });
}

function withoutKey<T>(values: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in values)) return values;
  const { [key]: _gone, ...rest } = values;
  return rest;
}

/** The owner has read these lines (review of D1, L2): they are not shown again. */
export async function dismissSharedDocumentArchiveNotices(documentIds: readonly string[]): Promise<void> {
  const ownerId = activeOwnerId;
  if (!ownerId || documentIds.length === 0) return;
  await load();
  const read = new Set(documentIds);
  change(ownerId, record => (record.notices.some(notice => read.has(notice.documentId))
    ? { ...record, notices: record.notices.filter(notice => !read.has(notice.documentId)) }
    : record));
}

/** The line for a Restore made on this device that the cloud has not been told yet (review of D1, L5). */
export function sharedDocumentRestoreWaitingText(waiting: SharedDocumentRestoreWaiting): string {
  const name = waiting.name?.trim() || 'A document';
  return waiting.refused
    ? `${name}: restored on this device only, for now: the cloud has not accepted this yet. This device keeps trying.`
    : `${name}: restored on this device. Your other devices show it again as soon as this one reaches the cloud.`;
}

/**
 * The line for a tap that was let go without being sent: what happened, what the document's state now is, and what he
 * can do. Each is true whichever of the two taps was made first: the device cannot know that, and does not say
 * (second review, P2-M1 and P2-L1).
 */
export function sharedDocumentArchiveNoticeText(notice: SharedDocumentArchiveNotice): string {
  const name = notice.name?.trim() || 'A document';
  if (notice.why === 'deleted_from_all_devices') {
    // Said of what the device knows: its deletion history holds the document, or the cloud says it has no such row.
    // Nothing is said of this device's own card: what becomes of it later is not this line's to promise.
    return `${name}: your Archive on this device was not sent, because the document has been deleted.`;
  }
  if (notice.why === 'restored_on_another_device') {
    return `${name}: your Archive on this device was not sent, because it was restored on another device before this device could send it. It is in Documents again; archive it again if you still want it hidden.`;
  }
  return `${name}: your Restore on this device was not sent, because it was archived again on another device before this device could send it. It is still archived; tap Restore again if you still want it back.`;
}

/** The cards put back for these documents are saved: they are not asked for again. */
export async function consumeSharedDocumentsRestoredElsewhere(documentIds: readonly string[]): Promise<void> {
  const ownerId = activeOwnerId;
  if (!ownerId || documentIds.length === 0) return;
  await load();
  const done = new Set(documentIds);
  change(ownerId, record => (record.restoredElsewhere.some(id => done.has(id))
    ? { ...record, restoredElsewhere: record.restoredElsewhere.filter(id => !done.has(id)) }
    : record));
}

/**
 * Sends what this device is waiting to tell the cloud, and reads which of the
 * account's documents the cloud marks archived. Never throws and shows
 * nothing: "no such column" is "not installed"; no answer leaves what the
 * device last knew.
 *
 * A document that was archived and is no longer in the cloud's answer was
 * either restored on another device or deleted (review of D1, L4). Only a
 * Restore puts this device's own card back, so the two are told apart: by
 * the device's deletion history (`deletedDocumentIds`) where it already
 * holds the document, and otherwise by asking the cloud for that one row. A
 * row with its mark emptied is a Restore; no row is a deletion; no answer
 * decides nothing, and the document stays hidden until the next pass.
 */
type SyncInput = Readonly<{
  client: SharedDocumentArchiveClient;
  ownerId: string;
  timeoutMs?: number;
  /** How long the app has been running (tests move it). Never the device's clock. */
  running?: RunningTime;
  /** The shared documents this device's deletion history says were deleted from all devices. */
  deletedDocumentIds?: () => Iterable<string> | Promise<Iterable<string>>;
  /**
   * Whether this document's own record is still waiting on this device to go up to the cloud (a document made and
   * archived with no signal). Only then does "the cloud has no such row" mean "not there yet"; otherwise it means
   * the document has been deleted (second review, P2-L4). Not given: nothing is taken to be waiting.
   */
  recordWaitingToUpload?: (documentId: string) => boolean | Promise<boolean>;
}>;

export function syncSharedDocumentArchiveWithCloud(input: SyncInput): Promise<SharedDocumentArchiveCloudAnswer> {
  // One at a time: two passes would each send the same waiting mark.
  const work = cloudWork.catch(() => undefined).then(async () => {
    await load();
    const before = recordOf(input.ownerId).waiting;
    const answer = await syncOnce(input).catch((): SharedDocumentArchiveCloudAnswer => 'unknown');
    // What was waiting when this pass began and still is has been held up (no signal, or a refusal): it is said
    // to be waiting from now on (review of D1, L5). A tap made with signal never gets this far.
    const waitedThrough = (mark: WaitingMark) => !mark.held && before.some(item => item.documentId === mark.documentId && item.tap === mark.tap);
    change(input.ownerId, record => (record.waiting.some(waitedThrough)
      ? { ...record, waiting: record.waiting.map(mark => (waitedThrough(mark) ? { ...mark, held: true as const } : mark)) }
      : record));
    return answer;
  });
  cloudWork = work;
  return work;
}

async function syncOnce({ client, ownerId, timeoutMs = REQUEST_TIMEOUT_MS, running = appRunningMs, deletedDocumentIds, recordWaitingToUpload }: SyncInput): Promise<SharedDocumentArchiveCloudAnswer> {
  await load();
  if (!ownerId || !(await signedInAs(client, ownerId))) return 'unknown';
  // The deletion history, read once in a pass and only when something turns on it.
  let history: Promise<ReadonlySet<string>> | null = null;
  const deleted = () => (history ??= Promise.resolve()
    .then(() => deletedDocumentIds?.() ?? [])
    .then(ids => new Set(ids), () => new Set<string>()));
  /** One document's row as the cloud holds it now: its mark; 'gone' when there is no such row; null when the cloud gave no answer. */
  const rowNow = async (id: string): Promise<Readonly<{ mark: CloudMark }> | 'gone' | null> => {
    const row = await answered(() => client.from(SHARED_DOCUMENTS_TABLE).select('id, archived_at').eq('owner_id', ownerId).eq('id', id), timeoutMs);
    if (!row || row.error || !Array.isArray(row.data)) return null;
    if (row.data.length === 0) return 'gone';
    const mark = (row.data[0] as { archived_at?: unknown } | null)?.archived_at;
    return { mark: typeof mark === 'string' && mark ? mark : null };
  };

  const read = await answered(() => client.from(SHARED_DOCUMENTS_TABLE)
    .select('id, archived_at').eq('owner_id', ownerId).not('archived_at', 'is', null), timeoutMs);
  if (!read) return 'unknown';
  if (read.error) {
    if (!markColumnMissing(read.error)) return 'unknown';
    // No column: nothing is archived in the cloud, and nothing waits for a column that is not there. A tap that
    // was waiting (the column was there, and has been removed again) stays this device's own, as before the change:
    // adding the column a second time sends nothing (review of D1, L9).
    change(ownerId, record => (record.installed === false && Object.keys(record.marks).length === 0 && record.waiting.length === 0
      ? record : { ...record, installed: false, marks: {}, waiting: [] }));
    return 'not_installed';
  }
  if (!Array.isArray(read.data) || !(await signedInAs(client, ownerId))) return 'unknown';
  const cloudMarks: Record<string, string> = {};
  read.data.forEach(row => {
    const { id, archived_at: archivedAt } = (row ?? {}) as { id?: unknown; archived_at?: unknown };
    if (typeof id === 'string' && id) cloudMarks[id] = typeof archivedAt === 'string' ? archivedAt : '';
  });

  // Archived when last read and not in this answer: restored on another device, or deleted (review of D1, L4)?
  const lastKnown = recordOf(ownerId);
  const notAsked = new Set(lastKnown.waiting.map(mark => mark.documentId));
  const gone = lastKnown.installed === true ? Object.keys(lastKnown.marks).filter(id => !(id in cloudMarks) && !notAsked.has(id)) : [];
  const restoredElsewhere = new Set<string>();
  const undecided = new Set<string>(gone.slice(GONE_QUESTION_LIMIT));
  for (const id of gone.slice(0, GONE_QUESTION_LIMIT)) {
    if ((await deleted()).has(id)) continue; // deleted: its archived card stays put away
    const row = await rowNow(id);
    if (row === null) { undecided.add(id); continue; }
    if (row === 'gone') continue; // no such row any more: deleted
    if (row.mark !== null) cloudMarks[id] = row.mark; // archived again since the first question
    else restoredElsewhere.add(id);
  }
  if (gone.length > 0 && !(await signedInAs(client, ownerId))) return 'unknown';

  change(ownerId, record => {
    const waitingIds = new Set(record.waiting.map(mark => mark.documentId));
    // What could not be decided is kept as it was: hidden, and asked about again at the next pass.
    undecided.forEach(id => { if (id in record.marks && !(id in cloudMarks)) cloudMarks[id] = record.marks[id]; });
    const restored = record.installed === true
      ? Object.keys(record.marks).filter(id => !(id in cloudMarks) && !waitingIds.has(id) && restoredElsewhere.has(id))
      : [];
    const known = Object.keys(record.marks);
    const unchanged = record.installed === true && restored.length === 0 &&
      known.length === Object.keys(cloudMarks).length && known.every(id => id in cloudMarks && sameMark(record.marks[id], cloudMarks[id]));
    return unchanged ? record : {
      ...record, installed: true, marks: cloudMarks,
      restoredElsewhere: [...new Set([...record.restoredElsewhere, ...restored])],
    };
  });

  for (const mark of recordOf(ownerId).waiting) {
    const id = mark.documentId;
    const isThisTap = (item: WaitingMark) => item.documentId === id && item.tap === mark.tap;
    const stillWaiting = () => recordOf(ownerId).waiting.some(isThisTap);
    if (!stillWaiting()) continue;
    /**
     * This tap is let go without being sent, with a line on this device saying why and what the document's state is.
     * `putCardBack`: the cloud says the document is not archived, so this device's own card, put away when he
     * tapped Archive, is put back.
     */
    const letGo = (why: SharedDocumentArchiveNotice['why'], putCardBack = false) => change(ownerId, record => (record.waiting.some(isThisTap) ? {
      ...record,
      waiting: record.waiting.filter(item => !isThisTap(item)),
      restoredElsewhere: putCardBack ? [...new Set([...record.restoredElsewhere, id])] : record.restoredElsewhere,
      notices: [
        ...record.notices.filter(notice => notice.documentId !== id),
        { documentId: id, tap: mark.archived ? 'archive' as const : 'restore' as const, why, ...(mark.name ? { name: mark.name } : {}) },
      ].slice(-NOTICE_LIMIT),
    } : record));

    // What the cloud says of this document now, as just read, against what he asked.
    const cloudMark: CloudMark = recordOf(ownerId).marks[id] ?? null;
    // An Archive for a document this device's deletion history says was deleted from all devices: there is nothing
    // to archive, so it is let go, with a line (review of D1, L4). Its card here stays put away.
    if (mark.archived && cloudMark === null && (await deleted()).has(id)) {
      letGo('deleted_from_all_devices');
      continue;
    }
    // The rule (second review, P2-M1): it is sent only if the cloud's mark is still the one this device last knew
    // when he tapped, or one this device sent itself. No clock is asked which tap came first.
    const stillAsHeSawIt = sameMark(cloudMark, mark.seen) || (mark.sent ?? []).some(value => sameMark(value, cloudMark));
    // Already as he asked: a Restore, and the cloud holds no mark; or an Archive, and the cloud holds this very
    // Archive (its own write, whose answer was lost) or one made on another device that this device had not seen.
    // Nothing is sent and there is nothing to tell.
    // NOT so for an Archive when the cloud still holds the mark he was shown (he restored and archived again before
    // the Restore was sent): that one is sent like any other, and writes its own mark over the old one. A Restore
    // made on another device against the old mark then finds the mark changed, and is let go with a line there,
    // where it would otherwise undo his Archive without a word.
    const alreadySo = (cloudMark !== null) === mark.archived && (!mark.archived || sameMark(cloudMark, mark.at) || !stillAsHeSawIt);
    if (alreadySo) {
      change(ownerId, record => ({ ...record, waiting: record.waiting.filter(item => !isThisTap(item)) }));
      continue;
    }
    if (!stillAsHeSawIt) {
      // Changed on another device, and this device had not heard: the cloud's state stands.
      if (!mark.archived) {
        // A Restore, and the cloud holds another Archive than the one he was shown: it stays archived, here too.
        letGo('archived_again_on_another_device');
        continue;
      }
      // An Archive, and the mark he was shown has been emptied: restored on another device, unless the document
      // itself is gone, which only its own row can say.
      const row = await rowNow(id);
      if (!(await signedInAs(client, ownerId))) return 'unknown';
      if (row === null) continue; // no answer: nothing is decided, and it is asked again at the next pass
      if (row === 'gone') letGo('deleted_from_all_devices');
      else if (row.mark === null) letGo('restored_on_another_device', true);
      else { // archived again in the moment between the two questions: the next pass finds it already as he asked
        const markNow = row.mark;
        change(ownerId, record => ({ ...record, marks: { ...withoutKey(record.marks, id), [id]: markNow } }));
      }
      continue;
    }

    if (retryWaitLeftMs(ownerId, id, running) > 0) continue; // refused before: its wait is not over (review of D1, L3)
    // The account is asked again right before each write, and the write names it.
    if (!(await signedInAs(client, ownerId))) return 'unknown';
    const value: CloudMark = mark.archived ? mark.at ?? null : null;
    if (mark.archived && value === null) { change(ownerId, record => ({ ...record, waiting: record.waiting.filter(item => !isThisTap(item)) })); continue; }
    // Remembered before it goes: until the cloud answers, this write may or may not be there (review of D1, L8).
    change(ownerId, record => ({ ...record, waiting: record.waiting.map(item => (isThisTap(item) && !(item.sent ?? []).some(sentValue => sameMark(sentValue, value))
      ? { ...item, sent: [...(item.sent ?? []), value] } : item)) }));
    const written = await answered(() => {
      const write = client.from(SHARED_DOCUMENTS_TABLE).update({ archived_at: value }).eq('id', id).eq('owner_id', ownerId);
      // Only while the mark is still the one just read: the cloud checks it in the same request, so a change in
      // between is not written over (review of D1, L2; second review, P2-M1).
      return (cloudMark === null ? write.is('archived_at', null) : write.eq('archived_at', cloudMark)).select('id');
    }, timeoutMs);
    if (!written) return 'installed'; // no answer: it waits for the next pass, which finds out whether it landed
    /** This write did not land: whichever tap now waits for the document stops counting it as possibly there. */
    const notSent = (item: WaitingMark): WaitingMark => {
      if (item.documentId !== id || !item.sent) return item;
      const at = item.sent.findIndex(sentValue => sameMark(sentValue, value));
      if (at < 0) return item;
      const { sent: _sent, ...rest } = item;
      const left = item.sent.filter((_value, index) => index !== at);
      return left.length > 0 ? { ...rest, sent: left } : rest;
    };
    const reached = !written.error && Array.isArray(written.data) && written.data.length > 0;
    // Known not to have landed: the cloud changed no row, or the database or its data API refused it by name (a
    // code). A refusal with no code came from something in between, and the write may have landed all the same: it
    // stays counted as possibly there, so that this device still knows its own mark when it next reads it.
    const didNotLand = !reached && (!written.error || Boolean(written.error.code));
    // "Column not in the schema cache" on a write, when the question just before was answered with the column: the
    // column is there and the data API has not caught up yet (its state for a moment after the owner's database
    // change). It is a refusal like any other: nothing the cloud just said is forgotten, the mark stays installed,
    // and the tap is tried again (review of D1, L6). Only the question's own "no such column" says not installed.
    const apiNotCaughtUp = Boolean(written.error && markColumnMissing(written.error));
    // An Archive the cloud answered and changed no row for: is the document still there (second review, P2-L4)? Its
    // own row is asked for. No such row, and nothing of it waiting on this device to go up: it has been deleted.
    // The Archive is let go, with a line saying so, where it used to be tried for ever while the phone said "keeps
    // trying". (A document made and archived with no signal has no row YET: that one keeps waiting, as before.)
    if (mark.archived && !reached && !written.error) {
      const row = await rowNow(id);
      if (!(await signedInAs(client, ownerId))) return 'unknown';
      const stillToUpload = row === 'gone' && await Promise.resolve().then(() => recordWaitingToUpload?.(id) ?? false).catch(() => true);
      if (row === 'gone' && !stillToUpload) {
        letGo('deleted_from_all_devices');
        retryNotBefore.delete(retryKey(ownerId, id));
        continue;
      }
    }
    if (!reached && stillWaiting()) {
      // Its wait, counted from now in running time; where there is no such count, none is kept.
      const now = running();
      if (now === null) retryNotBefore.delete(retryKey(ownerId, id));
      else retryNotBefore.set(retryKey(ownerId, id), now + retryWaitMs(mark.attempts + 1));
    }
    if (reached) retryNotBefore.delete(retryKey(ownerId, id));
    change(ownerId, record => {
      if (!reached) {
        // Refused, or no such row with that mark (not uploaded yet, or changed in between): it keeps waiting,
        // however often (review of D1, L3), and is tried again after a wait that grows.
        return { ...record, waiting: (didNotLand ? record.waiting.map(notSent) : record.waiting).map(item => (isThisTap(item)
          ? { ...item, attempts: item.attempts + 1 } : item)) };
      }
      // It landed. The cloud's mark is now this one, whether or not he has tapped again since: a newer tap on the
      // document keeps waiting and is judged against it at the next pass.
      const withoutIt = withoutKey(record.marks, id);
      return {
        ...record, waiting: record.waiting.filter(item => !isThisTap(item)),
        marks: value === null ? withoutIt : { ...withoutIt, [id]: value },
      };
    });
    if (apiNotCaughtUp) return 'installed'; // the others would be answered the same: they wait for the next pass
  }
  return 'installed';
}

/**
 * A live change to a shared document, as the cloud sent it. Once the column
 * exists every such row carries it, so another device's archive or restore
 * is followed without asking the cloud again. A row without it (before the
 * database change) says nothing.
 */
export async function noteSharedDocumentArchiveLiveRow(input: Readonly<{
  ownerId: string | null;
  eventType: string;
  newRow: Readonly<Record<string, unknown>> | null;
  oldRow: Readonly<Record<string, unknown>> | null;
}>): Promise<void> {
  const ownerId = input.ownerId;
  const row = input.eventType === 'DELETE' ? input.oldRow : input.newRow;
  const id = typeof row?.id === 'string' ? row.id : '';
  if (!ownerId || !row || !id) return;
  if (typeof row.owner_id === 'string' && row.owner_id !== ownerId) return;
  await load();
  const without = (marks: OwnerRecord['marks']) => withoutKey(marks, id);
  if (input.eventType === 'DELETE') {
    change(ownerId, record => (id in record.marks ? { ...record, marks: without(record.marks) } : record));
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(row, 'archived_at')) return;
  const mark: CloudMark = typeof row.archived_at === 'string' && row.archived_at.length > 0 ? row.archived_at : null;
  change(ownerId, record => {
    const was = record.installed === true && id in record.marks;
    if (record.installed === true && sameMark(record.marks[id] ?? null, mark)) return record;
    const waiting = record.waiting.some(item => item.documentId === id);
    return {
      ...record, installed: true, marks: mark === null ? without(record.marks) : { ...without(record.marks), [id]: mark },
      restoredElsewhere: was && mark === null && !waiting ? [...new Set([...record.restoredElsewhere, id])] : record.restoredElsewhere,
    };
  });
}

/**
 * What the hook hands the shell's card updater: the documents whose cards
 * are no longer archived, and with them the shared documents this device
 * knows are archived (review of D1, L13).
 */
export type SharedDocumentCardChange = readonly string[] & Readonly<{ archivedSharedDocumentIds?: ReadonlySet<string> }>;

export function sharedDocumentCardChange(restoredIds: readonly string[], archivedSharedDocumentIds: ReadonlySet<string>): SharedDocumentCardChange {
  return Object.assign([...restoredIds], { archivedSharedDocumentIds });
}

/**
 * The phone's own cards kept in step with the mark.
 * - Cards for `documentIds` are no longer archived (Restore, here or on
 *   another device).
 * - A card whose shared copy this device knows is archived is put away too
 *   (review of D1, L13): a card a backup brought back, or one on a second
 *   device, for a document archived since. So every place that lists cards
 *   by their own "archived" (the project page, an update's count) follows
 *   the same rule as the Documents list. A card being restored in the same
 *   call is never put away by it.
 */
export function withArchivedProjectDocumentsRestored<T extends Readonly<{
  id: string; referenceDocumentId?: string | null; isArchived?: boolean;
}>>(cards: readonly T[], documentIds: SharedDocumentCardChange, at: string = new Date().toISOString()): T[] {
  const restored = new Set<string>(documentIds);
  const archived = documentIds.archivedSharedDocumentIds;
  let changed = false;
  const next = cards.map(card => {
    const ids = [card.id, card.referenceDocumentId?.trim()].filter((id): id is string => Boolean(id));
    const isRestored = ids.some(id => restored.has(id));
    if (card.isArchived && isRestored) {
      changed = true;
      return { ...card, isArchived: false, archivedAt: null, updatedAt: at };
    }
    if (!card.isArchived && !isRestored && archived && ids.some(id => archived.has(id))) {
      changed = true;
      return { ...card, isArchived: true, archivedAt: at, updatedAt: at };
    }
    return card;
  });
  return changed ? next : cards as T[];
}

/**
 * What the owner is asked before archiving. Until the database change is in
 * place the document is hidden on this device only, and the question is the
 * one it has always been.
 */
export function sharedDocumentArchiveQuestion(name: string, category: string, installed: boolean | null): string {
  return installed === true
    ? `${name} is categorized as ${category}. It will be hidden on all your devices and kept in the cloud. You can bring it back under Archived in this project's Documents.`
    : `${name} is categorized as ${category}. It will be hidden from active project documents.`;
}

function markColumnMissing(error: CloudError): boolean {
  const message = String(error.message || '').toLowerCase();
  // Asking for it: Postgres 42703, "column ... does not exist". Writing it: the
  // data API's PGRST204, "Could not find the 'archived_at' column ...".
  return message.includes('archived_at') && (
    error.code === '42703' || error.code === 'PGRST204' ||
    message.includes('does not exist') || message.includes('could not find')
  );
}

/** The device's sign-in, read on the device (no network), is this account's. */
async function signedInAs(client: SharedDocumentArchiveClient, ownerId: string): Promise<boolean> {
  try {
    const session = await client.auth?.getSession?.();
    return session?.data?.session?.user?.id === ownerId;
  } catch {
    return false;
  }
}

/** The data API's own shape for "the request failed on the way": an error with no code from the cloud, and no HTTP status. */
function requestNeverArrived(answer: CloudAnswer): boolean {
  if (!answer.error || answer.error.code) return false;
  return answer.status === 0 || /network request failed|failed to fetch|load failed|network error|fetch failed/i.test(String(answer.error.message || ''));
}

/** The cloud's answer, or null when there was none in time (no signal, a stall, a client that cannot ask). */
async function answered(request: () => PromiseLike<CloudAnswer>, timeoutMs: number): Promise<CloudAnswer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve(request()),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    // A request that never reached the cloud is no answer, and so no refusal (review of D1, L3).
    return answer && typeof answer === 'object' && !requestNeverArrived(answer) ? answer : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
