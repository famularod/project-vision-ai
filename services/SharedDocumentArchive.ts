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
 */

// Owner-sensitive prefix: an account switch moves it with that owner's data.
export const SHARED_DOCUMENT_ARCHIVE_STORAGE_KEY = 'projectPhotoUpdate.sharedDocumentArchive.v1';
const SHARED_DOCUMENTS_TABLE = 'reference_documents';
const WAITING_LIMIT = 500;
/** A mark the cloud has no row for (not uploaded yet, or deleted) is tried this many times, then let go. */
const ATTEMPT_LIMIT = 30;
const REQUEST_TIMEOUT_MS = 6000;

type WaitingMark = Readonly<{ documentId: string; archived: boolean; at: string; attempts: number }>;

type OwnerRecord = Readonly<{
  /** true once the cloud answered with the column; false when it said "no such column"; null when never asked. */
  installed: boolean | null;
  /** The cloud's answer when it was last read. */
  archivedIds: readonly string[];
  waiting: readonly WaitingMark[];
  /** Archived when last read, no longer, and not by this device: its card here is put back. */
  restoredElsewhere: readonly string[];
}>;

export type SharedDocumentArchiveView = Readonly<{
  installed: boolean | null;
  /** Every shared document to leave out of this device's lists. */
  archivedIds: ReadonlySet<string>;
  /** Archived here, not yet told to the cloud. */
  waitingIds: ReadonlySet<string>;
  restoredElsewhere: readonly string[];
}>;

export type SharedDocumentArchiveCloudAnswer = 'installed' | 'not_installed' | 'unknown';

type CloudError = Readonly<{ code?: string | null; message?: string | null }>;
type CloudAnswer = Readonly<{ data?: unknown; error?: CloudError | null }>;
/** The part of the cloud client this file uses. */
export type SharedDocumentArchiveClient = Readonly<{
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  auth?: { getSession?: () => Promise<{ data?: { session?: { user?: { id?: string | null } | null } | null } | null }> } | null;
}>;

const EMPTY_RECORD: OwnerRecord = Object.freeze({ installed: null, archivedIds: [], waiting: [], restoredElsewhere: [] });
const EMPTY_VIEW: SharedDocumentArchiveView = Object.freeze({
  installed: null, archivedIds: new Set<string>(), waitingIds: new Set<string>(), restoredElsewhere: Object.freeze([]) as readonly string[],
});

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
      found.set(ownerId, {
        installed: record.installed === true ? true : record.installed === false ? false : null,
        archivedIds: ids(record.archivedIds),
        waiting: (Array.isArray(record.waiting) ? record.waiting : []).flatMap(item => {
          const mark = (item && typeof item === 'object' ? item : {}) as Partial<WaitingMark>;
          return typeof mark.documentId === 'string' && mark.documentId && typeof mark.archived === 'boolean' && typeof mark.at === 'string'
            ? [{ documentId: mark.documentId, archived: mark.archived, at: mark.at, attempts: typeof mark.attempts === 'number' ? mark.attempts : 0 }]
            : [];
        }),
        restoredElsewhere: ids(record.restoredElsewhere),
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
      archivedIds: new Set([...record.archivedIds, ...waitingArchive].filter(id => !waitingRestore.has(id))),
      waitingIds: new Set(waitingArchive.filter(id => !record.archivedIds.includes(id))),
      restoredElsewhere: record.restoredElsewhere,
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
 * it can be reached. Asking back what the cloud already says, as far as this
 * device knows, leaves nothing to send.
 *
 * Until this device knows the cloud keeps the mark there is nothing to tell
 * it: the archive is this device's own, on its own card, as in every build
 * before, and nothing waits to be sent later (review of D1, L9).
 */
export async function requestSharedDocumentArchive(documentId: string, archived: boolean, at: string = new Date().toISOString()): Promise<void> {
  const ownerId = activeOwnerId;
  const id = documentId.trim();
  if (!ownerId || !id) return;
  await load();
  change(ownerId, record => {
    const others = record.waiting.filter(mark => mark.documentId !== id);
    const markedInCloud = record.installed === true && record.archivedIds.includes(id);
    const needed = record.installed === true && archived !== markedInCloud;
    if (!needed && others.length === record.waiting.length) return record;
    return { ...record, waiting: needed ? [...others, { documentId: id, archived, at, attempts: 0 }].slice(-WAITING_LIMIT) : others };
  });
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
}>): Promise<SharedDocumentArchiveCloudAnswer> {
  // One at a time: two passes would each send the same waiting mark.
  const work = cloudWork.catch(() => undefined).then(() => syncOnce(input).catch((): SharedDocumentArchiveCloudAnswer => 'unknown'));
  cloudWork = work;
  return work;
}

async function syncOnce({ client, ownerId, timeoutMs = REQUEST_TIMEOUT_MS }: Readonly<{
  client: SharedDocumentArchiveClient; ownerId: string; timeoutMs?: number;
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
    change(ownerId, record => (record.installed === false && record.archivedIds.length === 0 && record.waiting.length === 0
      ? record : { ...record, installed: false, archivedIds: [], waiting: [] }));
    return 'not_installed';
  }
  if (!Array.isArray(read.data) || !(await signedInAs(client, ownerId))) return 'unknown';
  const cloudIds = read.data.flatMap(row => {
    const id = (row as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? [id] : [];
  });
  change(ownerId, record => {
    const waitingIds = new Set(record.waiting.map(mark => mark.documentId));
    const restored = record.installed === true
      ? record.archivedIds.filter(id => !cloudIds.includes(id) && !waitingIds.has(id))
      : [];
    const unchanged = record.installed === true && restored.length === 0 &&
      record.archivedIds.length === cloudIds.length && record.archivedIds.every(id => cloudIds.includes(id));
    return unchanged ? record : {
      ...record, installed: true, archivedIds: cloudIds,
      restoredElsewhere: [...new Set([...record.restoredElsewhere, ...restored])],
    };
  });

  for (const mark of recordOf(ownerId).waiting) {
    const stillWaiting = () => recordOf(ownerId).waiting.some(item => item.documentId === mark.documentId && item.at === mark.at && item.archived === mark.archived);
    if (!stillWaiting()) continue;
    // The account is asked again right before each write, and the write names it.
    if (!(await signedInAs(client, ownerId))) return 'unknown';
    const written = await answered(() => client.from(SHARED_DOCUMENTS_TABLE)
      .update({ archived_at: mark.archived ? mark.at : null }).eq('id', mark.documentId).eq('owner_id', ownerId).select('id'), timeoutMs);
    if (!written) return 'installed'; // no answer: it waits for the next pass
    if (written.error && markColumnMissing(written.error)) {
      change(ownerId, record => ({ ...record, installed: false, archivedIds: [] }));
      return 'not_installed';
    }
    const reached = !written.error && Array.isArray(written.data) && written.data.length > 0;
    change(ownerId, record => {
      if (!stillWaiting()) return record;
      const others = record.waiting.filter(item => item !== mark && !(item.documentId === mark.documentId && item.at === mark.at));
      if (!reached) {
        // Refused, or the cloud has no such document yet: tried again, and let go in the end.
        return mark.attempts + 1 >= ATTEMPT_LIMIT ? { ...record, waiting: others }
          : { ...record, waiting: record.waiting.map(item => (item.documentId === mark.documentId && item.at === mark.at ? { ...item, attempts: item.attempts + 1 } : item)) };
      }
      const withoutIt = record.archivedIds.filter(id => id !== mark.documentId);
      return { ...record, waiting: others, archivedIds: mark.archived ? [...withoutIt, mark.documentId] : withoutIt };
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
  if (input.eventType === 'DELETE') {
    change(ownerId, record => (record.archivedIds.includes(id)
      ? { ...record, archivedIds: record.archivedIds.filter(item => item !== id) } : record));
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(row, 'archived_at')) return;
  const archived = typeof row.archived_at === 'string' && row.archived_at.length > 0;
  change(ownerId, record => {
    const was = record.installed === true && record.archivedIds.includes(id);
    if (record.installed === true && was === archived) return record;
    const waiting = record.waiting.some(mark => mark.documentId === id);
    const withoutIt = record.archivedIds.filter(item => item !== id);
    return {
      ...record, installed: true, archivedIds: archived ? [...withoutIt, id] : withoutIt,
      restoredElsewhere: was && !archived && !waiting ? [...new Set([...record.restoredElsewhere, id])] : record.restoredElsewhere,
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

/** The cloud's answer, or null when there was none in time (no signal, a stall, a client that cannot ask). */
async function answered(request: () => PromiseLike<CloudAnswer>, timeoutMs: number): Promise<CloudAnswer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve(request()),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return answer && typeof answer === 'object' ? answer : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
