import type { OwnerScopedStorage } from './OwnerScopedLocalStore';

export const OWNER_STORAGE_SANDBOX_METADATA_KEY =
  '@vitruvius/owner-storage-sandbox/metadata/v1';
export const OWNER_STORAGE_SANDBOX_JOURNAL_KEY =
  '@vitruvius/owner-storage-sandbox/journal/v1';
const OWNER_STORAGE_NAMESPACE_PREFIX =
  '@vitruvius/owner-storage-sandbox/owner/';

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
  updatedAt: string;
}>;

type OwnerStorageSandboxJournal = Readonly<{
  version: 1;
  id: string;
  sourceOwnerId: string | null;
  targetOwnerId: string | null;
  legacyAssignedOwnerId: string | null;
  sourceSnapshot: Readonly<Record<string, string>>;
  targetSnapshot: Readonly<Record<string, string>>;
  createdAt: string;
}>;

export type OwnerStorageSandbox = Readonly<{
  activateOwner: (ownerId: string | null) => Promise<Readonly<{
    ownerId: string | null;
    changed: boolean;
    restoredKeyCount: number;
  }>>;
  recoverInterruptedTransition: () => Promise<boolean>;
}>;

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

    // The first authenticated launch owns the pre-boundary local data. Signed-
    // out data is never silently assigned after an account has been established.
    if (
      sourceOwnerId === null &&
      targetOwnerId !== null &&
      legacyAssignedOwnerId === null &&
      Object.keys(canonicalSnapshot).length > 0
    ) {
      sourceOwnerId = targetOwnerId;
      legacyAssignedOwnerId = targetOwnerId;
    }

    const sourceSnapshot = sourceOwnerId
      ? canonicalSnapshot
      : Object.freeze({});
    const targetSnapshot = targetOwnerId === sourceOwnerId
      ? sourceSnapshot
      : targetOwnerId
        ? await readOwnerSnapshot(storage, targetOwnerId)
        : Object.freeze({});
    const journal: OwnerStorageSandboxJournal = Object.freeze({
      version: 1,
      id: createId(),
      sourceOwnerId,
      targetOwnerId,
      legacyAssignedOwnerId,
      sourceSnapshot,
      targetSnapshot,
      createdAt: now(),
    });
    await storage.setItem(
      OWNER_STORAGE_SANDBOX_JOURNAL_KEY,
      JSON.stringify(journal),
    );
    await commitPreparedTransition(storage, journal, now);

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
  });
}

export function isOwnerSensitiveCanonicalStorageKey(key: string): boolean {
  return (
    key.startsWith('projectPhotoUpdate.') ||
    key.startsWith('projectPhotoUpdates.') ||
    key.startsWith('projectVisionAI.') ||
    key.startsWith('@dave/')
  );
}

async function commitPreparedTransition(
  storage: EnumerableOwnerStorage,
  journal: OwnerStorageSandboxJournal,
  now: () => string,
) {
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
      typeof value.createdAt !== 'string'
    ) {
      throw new Error('shape');
    }
    return Object.freeze({
      version: 1,
      id: value.id,
      sourceOwnerId: normalizeOwner(value.sourceOwnerId ?? null),
      targetOwnerId: normalizeOwner(value.targetOwnerId ?? null),
      legacyAssignedOwnerId: normalizeOwner(value.legacyAssignedOwnerId ?? null),
      sourceSnapshot: Object.freeze({ ...value.sourceSnapshot }),
      targetSnapshot: Object.freeze({ ...value.targetSnapshot }),
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
