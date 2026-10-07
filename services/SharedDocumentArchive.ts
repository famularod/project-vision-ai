import AsyncStorage from '@react-native-async-storage/async-storage';

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
 * Whose tap counts (review of D1, L2 and L8): the latest tap by the owner
 * wins.
 * - On one device his taps on a document are applied in order: the newest is
 *   the one that waits, and it remembers what this device has itself sent
 *   and not yet heard back about, so a write still on its way is never
 *   mistaken for another device's doing.
 * - A waiting tap is sent only while the cloud's mark is still what this
 *   device was showing him when he tapped (or what it sent itself). The
 *   write carries the mark just read as its condition, so one that changes
 *   between the question and the write is not written over.
 * - A waiting Restore that finds a different archive in the cloud: an
 *   archive carries the time of its tap, so a Restore tapped here after it
 *   is still the latest tap and is sent. One tapped before it is the older
 *   tap: the cloud's newer state stands, the Restore is let go, and the
 *   device says so in a line the owner dismisses.
 * - A waiting Archive always starts from "not archived", which is what the
 *   cloud then shows, so it is sent, carrying the time he tapped (and where
 *   the cloud holds an older archive, the mark takes the newer tap's time). The cloud
 *   keeps no time for a Restore, so the device that made a Restore keeps
 *   its time itself: if it later reads an archive older than its own
 *   Restore (a tap made earlier that reached the cloud late), it restores
 *   once more. That is how the later of the two taps wins there too.
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
 */
const RETRY_FIRST_WAIT_MS = 30_000;
const RETRY_LONGEST_WAIT_MS = 15 * 60_000;
const retryWaitMs = (refusals: number) => Math.min(RETRY_LONGEST_WAIT_MS, RETRY_FIRST_WAIT_MS * 2 ** Math.min(Math.max(refusals, 1) - 1, 10));

/** The cloud's mark on a document: the time it was archived, or null for "not archived". */
type CloudMark = string | null;

type WaitingMark = Readonly<{
  documentId: string; archived: boolean; at: string;
  /** How many times the cloud has answered and not taken it. */
  attempts: number;
  /** Refused before: not sent again until this time (milliseconds, the device's clock). */
  notBefore?: number;
  /** The mark this device was showing for the document when he tapped Restore (review of D1, L2). */
  seen?: CloudMark;
  /** Marks this device has sent for the document and has not heard back about: one may be in the cloud (review of D1, L8). */
  sent?: readonly CloudMark[];
  /** The document's name, when the screen that took the tap had it: for the line that says a tap was not sent. */
  name?: string;
  /** This device's own earlier Restore, made once more against an older archive that arrived late: not remembered again. */
  again?: true;
}>;

/** A tap that was let go without being sent, to be told to the owner in a line he dismisses (review of D1, L2). */
export type SharedDocumentArchiveNotice = Readonly<{
  documentId: string;
  tap: 'archive' | 'restore';
  why: 'archived_again_on_another_device';
  name?: string;
}>;
const NOTICE_LIMIT = 20;
const OWN_RESTORE_LIMIT = 500;

type OwnerRecord = Readonly<{
  /** true once the cloud answered with the column; false when it said "no such column"; null when never asked. */
  installed: boolean | null;
  /** The cloud's answer when it was last read: each archived document's id and its mark. */
  marks: Readonly<Record<string, string>>;
  waiting: readonly WaitingMark[];
  /** Archived when last read, no longer, and not by this device: its card here is put back. */
  restoredElsewhere: readonly string[];
  notices: readonly SharedDocumentArchiveNotice[];
  /**
   * When this device itself last restored each document (review of D1, L2):
   * the cloud keeps no time for a Restore, so only this device can tell that
   * an archive it reads later is an older tap. Forgotten once used, and when
   * a newer archive is seen or made.
   */
  ownRestores: Readonly<Record<string, string>>;
}>;

export type SharedDocumentArchiveView = Readonly<{
  installed: boolean | null;
  /** Every shared document to leave out of this device's lists. */
  archivedIds: ReadonlySet<string>;
  /** Archived here, not yet told to the cloud. */
  waitingIds: ReadonlySet<string>;
  /** Waiting, and the cloud has answered and not taken it: said plainly, and tried again (review of D1, L3). */
  refusedIds: ReadonlySet<string>;
  /** When what waits is next due to be sent (milliseconds; 0 = now), or null when nothing waits. */
  nextTryAt: number | null;
  restoredElsewhere: readonly string[];
  /** Taps that were let go without being sent, until the owner dismisses each line (review of D1, L2). */
  notices: readonly SharedDocumentArchiveNotice[];
}>;

export type SharedDocumentArchiveCloudAnswer = 'installed' | 'not_installed' | 'unknown';

type CloudError = Readonly<{ code?: string | null; message?: string | null }>;
type CloudAnswer = Readonly<{ data?: unknown; error?: CloudError | null; status?: number }>;
/** The part of the cloud client this file uses. */
export type SharedDocumentArchiveClient = Readonly<{
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  auth?: { getSession?: () => Promise<{ data?: { session?: { user?: { id?: string | null } | null } | null } | null }> } | null;
}>;

const NO_NOTICES: readonly SharedDocumentArchiveNotice[] = Object.freeze([]);
const EMPTY_RECORD: OwnerRecord = Object.freeze({
  installed: null, marks: Object.freeze({}), waiting: [], restoredElsewhere: [], notices: NO_NOTICES, ownRestores: Object.freeze({}),
});
const EMPTY_VIEW: SharedDocumentArchiveView = Object.freeze({
  installed: null, archivedIds: new Set<string>(), waitingIds: new Set<string>(), refusedIds: new Set<string>(), nextTryAt: null,
  restoredElsewhere: Object.freeze([]) as readonly string[], notices: NO_NOTICES,
});

/** Two marks are the same mark: both empty, or the same moment (the cloud and the device write a time differently). */
function sameMark(one: CloudMark | undefined, other: CloudMark | undefined): boolean {
  const first = one ?? null;
  const second = other ?? null;
  if (first === null || second === null) return first === second;
  return first === second || Date.parse(first) === Date.parse(second);
}

let records = new Map<string, OwnerRecord>();
let loaded: Promise<void> | null = null;
let activeOwnerId: string | null = null;
let view: SharedDocumentArchiveView = EMPTY_VIEW;
const listeners = new Set<() => void>();
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
      found.set(ownerId, {
        installed: record.installed === true ? true : record.installed === false ? false : null,
        marks: times(record.marks),
        ownRestores: times(record.ownRestores),
        waiting: (Array.isArray(record.waiting) ? record.waiting : []).flatMap(item => {
          const mark = (item && typeof item === 'object' ? item : {}) as Partial<WaitingMark>;
          return typeof mark.documentId === 'string' && mark.documentId && typeof mark.archived === 'boolean' && typeof mark.at === 'string'
            ? [{
                documentId: mark.documentId, archived: mark.archived, at: mark.at, attempts: typeof mark.attempts === 'number' ? mark.attempts : 0,
                ...(typeof mark.notBefore === 'number' ? { notBefore: mark.notBefore } : {}),
                seen: isMark(mark.seen) ? mark.seen : null,
                ...(Array.isArray(mark.sent) && mark.sent.length > 0 ? { sent: mark.sent.filter(isMark) } : {}),
                ...(typeof mark.name === 'string' && mark.name ? { name: mark.name } : {}),
                ...(mark.again === true ? { again: true as const } : {}),
              }]
            : [];
        }),
        restoredElsewhere: ids(record.restoredElsewhere),
        notices: (Array.isArray(record.notices) ? record.notices : []).flatMap(item => {
          const notice = (item && typeof item === 'object' ? item : {}) as Partial<SharedDocumentArchiveNotice>;
          return typeof notice.documentId === 'string' && notice.documentId && (notice.tap === 'archive' || notice.tap === 'restore')
            ? [{ documentId: notice.documentId, tap: notice.tap, why: 'archived_again_on_another_device' as const, ...(typeof notice.name === 'string' && notice.name ? { name: notice.name } : {}) }]
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
  const after = next(before);
  if (after === before) return;
  records.set(ownerId, after);
  const saved = JSON.stringify({ version: 1, owners: Object.fromEntries(records) });
  storageWrite = storageWrite
    .then(() => AsyncStorage.setItem(SHARED_DOCUMENT_ARCHIVE_STORAGE_KEY, saved))
    .catch(() => undefined);
  if (ownerId === activeOwnerId) publish();
}

function publish(): void {
  const record = activeOwnerId ? records.get(activeOwnerId) : null;
  if (!record) {
    if (view === EMPTY_VIEW) return;
    view = EMPTY_VIEW;
  } else {
    const waitingArchive = record.waiting.filter(mark => mark.archived).map(mark => mark.documentId);
    const waitingRestore = new Set(record.waiting.filter(mark => !mark.archived).map(mark => mark.documentId));
    view = Object.freeze({
      installed: record.installed,
      archivedIds: new Set([...Object.keys(record.marks), ...waitingArchive].filter(id => !waitingRestore.has(id))),
      waitingIds: new Set(waitingArchive.filter(id => !(id in record.marks))),
      refusedIds: new Set(record.waiting.filter(mark => mark.attempts > 0).map(mark => mark.documentId)),
      nextTryAt: record.waiting.length > 0 ? Math.min(...record.waiting.map(mark => mark.notBefore ?? 0)) : null,
      restoredElsewhere: record.restoredElsewhere,
      notices: record.notices,
    });
  }
  listeners.forEach(listener => listener());
}

/** Opens the signed-in account's copy; the lists then follow it. */
export async function openSharedDocumentArchive(ownerId: string | null): Promise<void> {
  activeOwnerId = ownerId;
  publish();
  await load(true);
}

export function sharedDocumentArchiveView(): SharedDocumentArchiveView {
  return view;
}

export function subscribeSharedDocumentArchive(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
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
 * the cloud settles which. Then it is sent, or found already done, or let go
 * with a line saying so. `name` is the document's name where the screen has
 * it, for that line.
 */
export async function requestSharedDocumentArchive(
  documentId: string, archived: boolean, at: string = new Date().toISOString(), name?: string,
): Promise<void> {
  const ownerId = activeOwnerId;
  const id = documentId.trim();
  if (!ownerId || !id) return;
  await load();
  change(ownerId, record => {
    const earlier = record.waiting.find(mark => mark.documentId === id);
    const others = record.waiting.filter(mark => mark.documentId !== id);
    if (record.installed !== true) return earlier ? { ...record, waiting: others } : record;
    // What this device has sent and not heard back about goes with the newest tap; so does what it showed before that.
    const sent = earlier?.sent ?? [];
    const seen = earlier && sent.length > 0 ? earlier.seen ?? null : record.marks[id] ?? null;
    const label = name?.trim() || earlier?.name;
    const mark: WaitingMark = { documentId: id, archived, at, attempts: 0, seen, ...(sent.length > 0 ? { sent } : {}), ...(label ? { name: label } : {}) };
    // An Archive here is a newer tap than any Restore this device remembers making.
    return { ...record, waiting: [...others, mark].slice(-WAITING_LIMIT), ownRestores: archived ? withoutKey(record.ownRestores, id) : record.ownRestores };
  });
}

function withoutKey<T>(values: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in values)) return values;
  const { [key]: _gone, ...rest } = values;
  return rest;
}

/** This device restored the document at `at`: kept, newest first, for the archive that may still arrive late. */
function withOwnRestore(ownRestores: OwnerRecord['ownRestores'], id: string, at: string): OwnerRecord['ownRestores'] {
  const earlier = ownRestores[id];
  if (earlier && Date.parse(earlier) >= Date.parse(at)) return ownRestores;
  return Object.fromEntries([[id, at], ...Object.entries(withoutKey(ownRestores, id))].slice(0, OWN_RESTORE_LIMIT));
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

/** The line for a tap that was let go without being sent: what happened, and what the document's state is. */
export function sharedDocumentArchiveNoticeText(notice: SharedDocumentArchiveNotice): string {
  const name = notice.name?.trim() || 'A document';
  return `${name}: your Restore on this device was not sent. It was archived again on another device after you tapped Restore here, so it stays archived.`;
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
 */
export function syncSharedDocumentArchiveWithCloud(input: Readonly<{
  client: SharedDocumentArchiveClient;
  ownerId: string;
  timeoutMs?: number;
  /** The device's clock (tests move it). */
  now?: () => number;
}>): Promise<SharedDocumentArchiveCloudAnswer> {
  // One at a time: two passes would each send the same waiting mark.
  const work = cloudWork.catch(() => undefined).then(() => syncOnce(input).catch((): SharedDocumentArchiveCloudAnswer => 'unknown'));
  cloudWork = work;
  return work;
}

async function syncOnce({ client, ownerId, timeoutMs = REQUEST_TIMEOUT_MS, now = Date.now }: Readonly<{
  client: SharedDocumentArchiveClient; ownerId: string; timeoutMs?: number; now?: () => number;
}>): Promise<SharedDocumentArchiveCloudAnswer> {
  await load();
  if (!ownerId || !(await signedInAs(client, ownerId))) return 'unknown';

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
  change(ownerId, record => {
    const waitingIds = new Set(record.waiting.map(mark => mark.documentId));
    const restored = record.installed === true
      ? Object.keys(record.marks).filter(id => !(id in cloudMarks) && !waitingIds.has(id))
      : [];
    const known = Object.keys(record.marks);
    // An archive in the cloud for a document this device restored: older than that Restore, it is a tap made
    // before it that reached the cloud late, and this device restores once more (it waits like any tap); newer,
    // it is the later tap. Either way the Restore's time has done its work (review of D1, L2).
    const remembered = Object.keys(record.ownRestores).filter(id => id in cloudMarks);
    const again = remembered.filter(id => !waitingIds.has(id) && Date.parse(record.ownRestores[id]) > Date.parse(cloudMarks[id]));
    const unchanged = record.installed === true && restored.length === 0 && remembered.length === 0 &&
      known.length === Object.keys(cloudMarks).length && known.every(id => id in cloudMarks && sameMark(record.marks[id], cloudMarks[id]));
    return unchanged ? record : {
      ...record, installed: true, marks: cloudMarks,
      restoredElsewhere: [...new Set([...record.restoredElsewhere, ...restored])],
      ownRestores: Object.fromEntries(Object.entries(record.ownRestores).filter(([id]) => !remembered.includes(id))),
      waiting: [...record.waiting, ...again.map(id => ({ documentId: id, archived: false, at: record.ownRestores[id], attempts: 0, seen: cloudMarks[id], again: true as const }))].slice(-WAITING_LIMIT),
    };
  });

  for (const mark of recordOf(ownerId).waiting) {
    const id = mark.documentId;
    const isThisTap = (item: WaitingMark) => item.documentId === id && item.at === mark.at && item.archived === mark.archived;
    const stillWaiting = () => recordOf(ownerId).waiting.some(isThisTap);
    if (!stillWaiting()) continue;
    if ((mark.notBefore ?? 0) > now()) continue; // refused before: its wait is not over (review of D1, L3)

    // What the cloud says of this document now, as just read, against what he asked (review of D1, L2 and L8).
    const cloudMark: CloudMark = recordOf(ownerId).marks[id] ?? null;
    // The cloud already holds an archive, and it is an older tap than this Archive: the mark takes this tap's time,
    // so that a Restore made between the two and still waiting on another device is known for the older tap it is.
    const olderArchive = mark.archived && cloudMark !== null && Date.parse(mark.at) > Date.parse(cloudMark);
    if ((cloudMark !== null) === mark.archived && !olderArchive) {
      // Already as he asked (this device's own write whose answer was lost, or the same tap made elsewhere).
      change(ownerId, record => ({
        ...record, waiting: record.waiting.filter(item => !isThisTap(item)),
        ownRestores: mark.archived || mark.again ? record.ownRestores : withOwnRestore(record.ownRestores, id, mark.at),
      }));
      continue;
    }
    // An Archive is sent: it starts from "not archived" (or from an older archive). A Restore is sent while the
    // archive in the cloud is the one this device was showing (or sent itself), or an older tap than this Restore.
    // A newer archive from another device stands, and this Restore is let go with a line saying so.
    const sendable = mark.archived || sameMark(cloudMark, mark.seen) ||
      (mark.sent ?? []).some(value => sameMark(value, cloudMark)) || (cloudMark !== null && Date.parse(mark.at) > Date.parse(cloudMark));
    if (!sendable) {
      change(ownerId, record => ({
        ...record,
        waiting: record.waiting.filter(item => !isThisTap(item)),
        notices: [
          ...record.notices.filter(notice => notice.documentId !== id),
          { documentId: id, tap: 'restore' as const, why: 'archived_again_on_another_device' as const, ...(mark.name ? { name: mark.name } : {}) },
        ].slice(-NOTICE_LIMIT),
      }));
      continue;
    }

    // The account is asked again right before each write, and the write names it.
    if (!(await signedInAs(client, ownerId))) return 'unknown';
    const value: CloudMark = mark.archived ? mark.at : null;
    // Remembered before it goes: until the cloud answers, this write may or may not be there (review of D1, L8).
    change(ownerId, record => ({ ...record, waiting: record.waiting.map(item => (isThisTap(item) ? { ...item, sent: [...(item.sent ?? []), value] } : item)) }));
    const written = await answered(() => {
      const write = client.from(SHARED_DOCUMENTS_TABLE).update({ archived_at: value }).eq('id', id).eq('owner_id', ownerId);
      // Only while the mark is still the one just read: a change in between is not written over (review of D1, L2).
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
    if (written.error && markColumnMissing(written.error)) {
      change(ownerId, record => ({ ...record, installed: false, marks: {}, waiting: record.waiting.map(notSent) }));
      return 'not_installed';
    }
    const reached = !written.error && Array.isArray(written.data) && written.data.length > 0;
    change(ownerId, record => {
      if (!reached) {
        // Refused, or no such row with that mark (not uploaded yet, or changed in between): it keeps waiting,
        // however often (review of D1, L3), and is tried again after a wait that grows.
        return { ...record, waiting: record.waiting.map(notSent).map(item => (isThisTap(item)
          ? { ...item, attempts: item.attempts + 1, notBefore: now() + retryWaitMs(item.attempts + 1) } : item)) };
      }
      // It landed. The cloud's mark is now this one, whether or not he has tapped again since: a newer tap on the
      // document keeps waiting and is judged against it at the next pass.
      const withoutIt = withoutKey(record.marks, id);
      return {
        ...record, waiting: record.waiting.filter(item => !isThisTap(item)),
        marks: value === null ? withoutIt : { ...withoutIt, [id]: value },
        ownRestores: value === null && !mark.again ? withOwnRestore(record.ownRestores, id, mark.at) : record.ownRestores,
      };
    });
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

/** The phone's own cards for these documents are no longer archived (Restore, here or on another device). */
export function withArchivedProjectDocumentsRestored<T extends Readonly<{
  id: string; referenceDocumentId?: string | null; isArchived?: boolean;
}>>(cards: readonly T[], documentIds: readonly string[], restoredAt: string = new Date().toISOString()): T[] {
  const restored = new Set(documentIds);
  let changed = false;
  const next = cards.map(card => {
    const shared = card.referenceDocumentId?.trim();
    if (!card.isArchived || !(restored.has(card.id) || (shared && restored.has(shared)))) return card;
    changed = true;
    return { ...card, isArchived: false, archivedAt: null, updatedAt: restoredAt };
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
