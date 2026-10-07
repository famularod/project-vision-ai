import type { OwnerScopedStorage } from './OwnerScopedLocalStore';

export const OWNER_STORAGE_SANDBOX_METADATA_KEY =
  '@vitruvius/owner-storage-sandbox/metadata/v1';
export const OWNER_STORAGE_SANDBOX_JOURNAL_KEY =
  '@vitruvius/owner-storage-sandbox/journal/v1';
const OWNER_STORAGE_NAMESPACE_PREFIX =
  '@vitruvius/owner-storage-sandbox/owner/';
export const OWNER_STORAGE_QUARANTINE_PREFIX =
  '@vitruvius/owner-storage-sandbox/quarantine/';

type EnumerableOwnerStorage = OwnerScopedStorage & Readonly<{
  getAllKeys: () => Promise<readonly string[]>;
  multiGet: (keys: readonly string[]) => Promise<readonly (readonly [string, string | null])[]>;
  multiSet: (entries: readonly (readonly [string, string])[]) => Promise<void>;
  multiRemove: (keys: readonly string[]) => Promise<void>;
}>;

type OwnerStorageSandboxMetadata = Readonly<{
  version: 1;
  activeOwnerId: string | null;
  legacyAssignedOwnerId: string | null;
  /** The most recent signed-in account (absent before audit A1 H2). */
  lastOwnerId: string | null;
  updatedAt: string;
}>;

/**
 * Account data found while signed out, set aside for the account that most
 * likely wrote it (whole-app audit A1 H2). Never opened for any account.
 */
type OwnerStorageQuarantine = Readonly<{
  id: string;
  suspectedOwnerId: string | null;
  snapshot: Readonly<Record<string, string>>;
}>;

type OwnerStorageSandboxJournal = Readonly<{
  version: 1;
  id: string;
  sourceOwnerId: string | null;
  targetOwnerId: string | null;
  legacyAssignedOwnerId: string | null;
  lastOwnerId: string | null;
  sourceSnapshot: Readonly<Record<string, string>>;
  targetSnapshot: Readonly<Record<string, string>>;
  quarantine: OwnerStorageQuarantine | null;
  createdAt: string;
}>;

export type OwnerStorageSandbox = Readonly<{
  activateOwner: (ownerId: string | null) => Promise<Readonly<{
    ownerId: string | null;
    changed: boolean;
    restoredKeyCount: number;
  }>>;
  recoverInterruptedTransition: () => Promise<boolean>;
  /**
   * The owner whose data is open on this phone, or null when signed out or a
   * transition is unfinished (owner answer Q13: an offline start opens only
   * this owner's workspace).
   */
  activeOwnerId: () => Promise<string | null>;
}>;

const ownerStorageSwitchListeners = new Set<() => void>();

/**
 * Called each time this phone's stored data is switched to another account,
 * or a switch an interrupted launch left half done is finished: whatever a
 * module read once from storage is now another account's, and is read again
 * (whole-app audit A4 pass 15 L2: the saved conflicts behind the field
 * update cards). The unsubscribe function.
 */
export function subscribeToOwnerStorageSwitch(listener: () => void): () => void {
  ownerStorageSwitchListeners.add(listener);
  return () => {
    ownerStorageSwitchListeners.delete(listener);
  };
}

function ownerStorageSwitched(): void {
  ownerStorageSwitchListeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A reader's listener never fails an account switch.
    }
  });
}

export class OwnerStorageSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerStorageSandboxError';
  }
}

export function createOwnerStorageSandbox({
  storage,
  now = () => new Date().toISOString(),
  createId = () => `owner-transition-${Date.now()}-${Math.random().toString(16).slice(2)}`,
}: Readonly<{
  storage: EnumerableOwnerStorage;
  now?: () => string;
  createId?: () => string;
}>): OwnerStorageSandbox {
  let transitionQueue = Promise.resolve();

  async function recoverInterruptedTransition(): Promise<boolean> {
    const journal = parseJournal(
      await storage.getItem(OWNER_STORAGE_SANDBOX_JOURNAL_KEY),
    );
    if (!journal) return false;
    await commitPreparedTransition(storage, journal, now);
    ownerStorageSwitched();
    return true;
  }

  async function activateOwnerUnserialized(ownerId: string | null) {
    const targetOwnerId = normalizeOwner(ownerId);
    await recoverInterruptedTransition();
    const metadata = parseMetadata(
      await storage.getItem(OWNER_STORAGE_SANDBOX_METADATA_KEY),
      now(),
    );
    if (metadata.activeOwnerId === targetOwnerId) {
      return Object.freeze({
        ownerId: targetOwnerId,
        changed: false,
        restoredKeyCount: 0,
      });
    }

    const canonicalSnapshot = await readCanonicalSnapshot(storage);
    let legacyAssignedOwnerId = metadata.legacyAssignedOwnerId;
    let sourceOwnerId = metadata.activeOwnerId;
    let quarantine: OwnerStorageQuarantine | null = null;
    const signedOutData = sourceOwnerId === null &&
      Object.keys(canonicalSnapshot).length > 0;

    // The first authenticated launch owns the pre-boundary local data (an
    // upgrade from before this sandbox). Signed-out data is never silently
    // assigned after an account has been established on this phone. A fresh
    // install establishes one at its first sign-in too, with nothing to claim;
    // it used to be told apart only by that claim, so a sync finishing after
    // a sign-out left data the next sign-in took as its own: another account
    // was handed it, or the same account's saved work was replaced by it
    // (whole-app audit A1 H2). That data is now set aside whole, never
    // deleted and never opened for another account; the account that most
    // likely wrote it gets back only keys its saved data lacks (such as
    // report baselines kept outside the sandbox before this change).
    if (signedOutData && targetOwnerId !== null &&
        !await accountEstablished(storage, metadata)) {
      sourceOwnerId = targetOwnerId;
      legacyAssignedOwnerId = targetOwnerId;
    } else if (signedOutData) {
      quarantine = Object.freeze({
        id: createId(),
        suspectedOwnerId: metadata.lastOwnerId ?? await soleSavedOwner(storage),
        snapshot: canonicalSnapshot,
      });
    }

    const sourceSnapshot = sourceOwnerId
      ? canonicalSnapshot
      : Object.freeze({});
    const savedTargetSnapshot = targetOwnerId === sourceOwnerId
      ? sourceSnapshot
      : targetOwnerId
        ? await readOwnerSnapshot(storage, targetOwnerId)
        : Object.freeze({});
    const targetSnapshot = quarantine && targetOwnerId &&
      quarantine.suspectedOwnerId === targetOwnerId
      ? sortedSnapshot({ ...quarantine.snapshot, ...savedTargetSnapshot })
      : savedTargetSnapshot;
    const journal: OwnerStorageSandboxJournal = Object.freeze({
      version: 1,
      id: createId(),
      sourceOwnerId,
      targetOwnerId,
      legacyAssignedOwnerId,
      lastOwnerId: targetOwnerId ?? sourceOwnerId ?? metadata.lastOwnerId,
      sourceSnapshot,
      targetSnapshot,
      quarantine,
      createdAt: now(),
    });
    await storage.setItem(
      OWNER_STORAGE_SANDBOX_JOURNAL_KEY,
      JSON.stringify(journal),
    );
    await commitPreparedTransition(storage, journal, now);
    ownerStorageSwitched();

    return Object.freeze({
      ownerId: targetOwnerId,
      changed: true,
      restoredKeyCount: Object.keys(targetSnapshot).length,
    });
  }

  return Object.freeze({
    activateOwner(ownerId) {
      const next = transitionQueue.then(
        () => activateOwnerUnserialized(ownerId),
        () => activateOwnerUnserialized(ownerId),
      );
      transitionQueue = next.then(() => undefined, () => undefined);
      return next;
    },
    recoverInterruptedTransition() {
      const next = transitionQueue.then(
        () => recoverInterruptedTransition(),
        () => recoverInterruptedTransition(),
      );
      transitionQueue = next.then(() => undefined, () => undefined);
      return next;
    },
    async activeOwnerId() {
      await transitionQueue;
      if (await storage.getItem(OWNER_STORAGE_SANDBOX_JOURNAL_KEY)) return null;
      return parseMetadata(
        await storage.getItem(OWNER_STORAGE_SANDBOX_METADATA_KEY),
        now(),
      ).activeOwnerId;
    },
  });
}

/**
 * Review pass 1, sync G5 (owner answer Q45, 6 Oct 2026). Whether this phone's account boundary has any record of an
 * account other than `ownerId`, or of account data that was set aside while nobody was signed in. Reads only.
 *
 * Asked once per account by the deletion history, about the records an earlier build left on the phone: those
 * carry nothing that says whose they are, and that build could save one account's records into another's list
 * when the account changed in the middle of a sync. With one account only on the phone nothing can have been
 * mixed. A boundary record that cannot be read counts as "yes".
 */
export async function anotherAccountHasUsedThisPhone(
  storage: Pick<OwnerScopedStorage, 'getItem'> & Readonly<{ getAllKeys?: () => Promise<readonly string[]> }>,
  ownerId: string,
): Promise<boolean> {
  try {
    const metadata = parseMetadata(await storage.getItem(OWNER_STORAGE_SANDBOX_METADATA_KEY), '');
    if ([metadata.activeOwnerId, metadata.legacyAssignedOwnerId, metadata.lastOwnerId]
      .some(known => known !== null && known !== ownerId)) return true;
    if (typeof storage.getAllKeys !== 'function') return false;
    const own = `${OWNER_STORAGE_NAMESPACE_PREFIX}${encodeURIComponent(ownerId)}/`;
    return (await storage.getAllKeys()).some(key =>
      key.startsWith(OWNER_STORAGE_QUARANTINE_PREFIX) ||
      (key.startsWith(OWNER_STORAGE_NAMESPACE_PREFIX) && !key.startsWith(own)));
  } catch {
    return true;
  }
}

export function isOwnerSensitiveCanonicalStorageKey(key: string): boolean {
  return (
    key.startsWith('projectPhotoUpdate.') ||
    key.startsWith('projectPhotoUpdates.') ||
    key.startsWith('projectVisionAI.') ||
    key.startsWith('@dave/') ||
    // Approved-report baselines (whole-app audit A1 M4) and Talk history
    // (A9 #5) are keyed by project name only, so another account on this
    // phone read them for its own project of that name.
    key.startsWith('@vitruvius/report-snapshots/') ||
    key.startsWith('dave-ask-history:') ||
    key.startsWith('dave-ask-history-journal:')
  );
}

function sortedSnapshot(
  snapshot: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.keys(snapshot).sort().map(key => [key, snapshot[key]]),
  ));
}

/** The one account with saved data on this phone, if there is exactly one. */
async function soleSavedOwner(storage: EnumerableOwnerStorage): Promise<string | null> {
  const owners = (await storage.getAllKeys())
    .filter(key => key.startsWith(OWNER_STORAGE_NAMESPACE_PREFIX) && key.endsWith('/index'))
    .map(key => decodeURIComponent(key.slice(OWNER_STORAGE_NAMESPACE_PREFIX.length, -'/index'.length)));
  return owners.length === 1 ? owners[0] : null;
}

/** Whether an account has used this phone since the sandbox existed. */
async function accountEstablished(
  storage: EnumerableOwnerStorage,
  metadata: OwnerStorageSandboxMetadata,
): Promise<boolean> {
  if (metadata.legacyAssignedOwnerId !== null || metadata.lastOwnerId !== null) {
    return true;
  }
  // Metadata written before lastOwnerId: an account's saved data shows it.
  return (await storage.getAllKeys())
    .some(key => key.startsWith(OWNER_STORAGE_NAMESPACE_PREFIX));
}

async function commitPreparedTransition(
  storage: EnumerableOwnerStorage,
  journal: OwnerStorageSandboxJournal,
  now: () => string,
) {
  if (journal.quarantine) {
    await storage.setItem(
      `${OWNER_STORAGE_QUARANTINE_PREFIX}${encodeURIComponent(journal.quarantine.id)}`,
      JSON.stringify({ version: 1, ...journal.quarantine, createdAt: journal.createdAt }),
    );
  }
  if (journal.sourceOwnerId) {
    await writeOwnerSnapshot(storage, journal.sourceOwnerId, journal.sourceSnapshot);
  }
  const canonicalKeys = (await storage.getAllKeys())
    .filter(isOwnerSensitiveCanonicalStorageKey);
  if (canonicalKeys.length > 0) {
    await storage.multiRemove(canonicalKeys);
  }
  const targetEntries = Object.entries(journal.targetSnapshot);
  if (targetEntries.length > 0) {
    await storage.multiSet(targetEntries);
  }
  await verifyCanonicalSnapshot(storage, journal.targetSnapshot);
  const metadata: OwnerStorageSandboxMetadata = Object.freeze({
    version: 1,
    activeOwnerId: journal.targetOwnerId,
    legacyAssignedOwnerId: journal.legacyAssignedOwnerId,
    lastOwnerId: journal.lastOwnerId,
    updatedAt: now(),
  });
  await storage.setItem(
    OWNER_STORAGE_SANDBOX_METADATA_KEY,
    JSON.stringify(metadata),
  );
  await storage.removeItem(OWNER_STORAGE_SANDBOX_JOURNAL_KEY);
}

async function readCanonicalSnapshot(
  storage: EnumerableOwnerStorage,
): Promise<Readonly<Record<string, string>>> {
  const keys = (await storage.getAllKeys())
    .filter(isOwnerSensitiveCanonicalStorageKey)
    .sort();
  return readSnapshot(storage, keys);
}

async function readOwnerSnapshot(
  storage: EnumerableOwnerStorage,
  ownerId: string,
): Promise<Readonly<Record<string, string>>> {
  const indexKey = ownerIndexKey(ownerId);
  const stored = await storage.getItem(indexKey);
  const canonicalKeys = parseOwnerIndex(stored);
  const namespaceEntries = await storage.multiGet(
    canonicalKeys.map(key => ownerValueKey(ownerId, key)),
  );
  const snapshot: Record<string, string> = {};
  namespaceEntries.forEach(([namespaceKey, value], index) => {
    if (namespaceKey && value !== null) {
      snapshot[canonicalKeys[index]] = value;
    }
  });
  return Object.freeze(snapshot);
}

async function writeOwnerSnapshot(
  storage: EnumerableOwnerStorage,
  ownerId: string,
  snapshot: Readonly<Record<string, string>>,
) {
  const indexKey = ownerIndexKey(ownerId);
  const previousKeys = parseOwnerIndex(await storage.getItem(indexKey));
  const nextKeys = Object.keys(snapshot).sort();
  const nextKeySet = new Set(nextKeys);
  const obsolete = previousKeys
    .filter(key => !nextKeySet.has(key))
    .map(key => ownerValueKey(ownerId, key));
  if (obsolete.length > 0) await storage.multiRemove(obsolete);
  const entries: readonly (readonly [string, string])[] = [
    ...nextKeys.map(key => [ownerValueKey(ownerId, key), snapshot[key]] as const),
    [indexKey, JSON.stringify(nextKeys)] as const,
  ];
  await storage.multiSet(entries);
}

async function verifyCanonicalSnapshot(
  storage: EnumerableOwnerStorage,
  expected: Readonly<Record<string, string>>,
) {
  const actual = await readCanonicalSnapshot(storage);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new OwnerStorageSandboxError(
      'Account-isolated local storage could not verify the restored data.',
    );
  }
}

async function readSnapshot(
  storage: EnumerableOwnerStorage,
  keys: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  if (keys.length === 0) return Object.freeze({});
  const snapshot: Record<string, string> = {};
  for (const [key, value] of await storage.multiGet(keys)) {
    if (value !== null) snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

function ownerIndexKey(ownerId: string) {
  return `${OWNER_STORAGE_NAMESPACE_PREFIX}${encodeURIComponent(ownerId)}/index`;
}

function ownerValueKey(ownerId: string, canonicalKey: string) {
  return `${OWNER_STORAGE_NAMESPACE_PREFIX}${encodeURIComponent(ownerId)}/value/${encodeURIComponent(canonicalKey)}`;
}

function normalizeOwner(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0')) {
    throw new OwnerStorageSandboxError(
      'A verified account identity is required for owner-isolated local data.',
    );
  }
  return normalized;
}

function parseOwnerIndex(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter(
      (item): item is string =>
        typeof item === 'string' && isOwnerSensitiveCanonicalStorageKey(item),
    ))).sort();
  } catch {
    return [];
  }
}

function parseMetadata(
  raw: string | null,
  fallbackTimestamp: string,
): OwnerStorageSandboxMetadata {
  if (!raw) {
    return Object.freeze({
      version: 1,
      activeOwnerId: null,
      legacyAssignedOwnerId: null,
      lastOwnerId: null,
      updatedAt: fallbackTimestamp,
    });
  }
  try {
    const value = JSON.parse(raw) as Partial<OwnerStorageSandboxMetadata>;
    if (value.version !== 1) throw new Error('version');
    return Object.freeze({
      version: 1,
      activeOwnerId: normalizeOwner(value.activeOwnerId ?? null),
      legacyAssignedOwnerId: normalizeOwner(value.legacyAssignedOwnerId ?? null),
      lastOwnerId: normalizeOwner(value.lastOwnerId ?? null),
      updatedAt: typeof value.updatedAt === 'string'
        ? value.updatedAt
        : fallbackTimestamp,
    });
  } catch {
    throw new OwnerStorageSandboxError(
      'The local account-isolation metadata is invalid. No project data was opened.',
    );
  }
}

function parseJournal(raw: string | null): OwnerStorageSandboxJournal | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OwnerStorageSandboxJournal>;
    if (
      value.version !== 1 ||
      typeof value.id !== 'string' ||
      !isSnapshot(value.sourceSnapshot) ||
      !isSnapshot(value.targetSnapshot) ||
      typeof value.createdAt !== 'string' ||
      (value.quarantine != null && (
        typeof value.quarantine.id !== 'string' ||
        !isSnapshot(value.quarantine.snapshot)
      ))
    ) {
      throw new Error('shape');
    }
    return Object.freeze({
      version: 1,
      id: value.id,
      sourceOwnerId: normalizeOwner(value.sourceOwnerId ?? null),
      targetOwnerId: normalizeOwner(value.targetOwnerId ?? null),
      legacyAssignedOwnerId: normalizeOwner(value.legacyAssignedOwnerId ?? null),
      lastOwnerId: normalizeOwner(value.lastOwnerId ?? null),
      sourceSnapshot: Object.freeze({ ...value.sourceSnapshot }),
      targetSnapshot: Object.freeze({ ...value.targetSnapshot }),
      quarantine: value.quarantine
        ? Object.freeze({
            id: value.quarantine.id,
            suspectedOwnerId: normalizeOwner(value.quarantine.suspectedOwnerId ?? null),
            snapshot: Object.freeze({ ...value.quarantine.snapshot }),
          })
        : null,
      createdAt: value.createdAt,
    });
  } catch {
    throw new OwnerStorageSandboxError(
      'An interrupted account-data transition could not be verified. No project data was opened.',
    );
  }
}

function isSnapshot(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, item]) =>
      isOwnerSensitiveCanonicalStorageKey(key) && typeof item === 'string'),
  );
}
