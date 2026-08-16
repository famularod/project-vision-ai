export type LocalCorruptionStorage = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>;

export type LocalCorruptionRecovery = Readonly<{
  quarantineKey: string;
  replacementApplied: boolean;
}>;

/**
 * Quarantines the exact stored string before any destructive recovery.
 *
 * The quarantine key is stable for the raw payload, which makes retries
 * idempotent. An occupied key is never overwritten: its bytes must match
 * exactly or recovery fails closed and the active value is left untouched.
 */
export async function quarantineCorruptLocalValue({
  storage,
  storageKey,
  quarantineKeyPrefix,
  raw,
  replacementRaw,
}: Readonly<{
  storage: LocalCorruptionStorage;
  storageKey: string;
  quarantineKeyPrefix: string;
  raw: string;
  /** null removes the active value; a string installs verified salvage. */
  replacementRaw: string | null;
}>): Promise<LocalCorruptionRecovery> {
  const quarantineKey = `${quarantineKeyPrefix}${rawFingerprint(raw)}`;

  let existing: string | null;
  try {
    existing = await storage.getItem(quarantineKey);
    if (existing === null) {
      await storage.setItem(quarantineKey, raw);
    } else if (existing !== raw) {
      throw new Error('The quarantine key already contains different bytes.');
    }

    const verified = await storage.getItem(quarantineKey);
    if (verified !== raw) {
      throw new Error('The quarantined bytes could not be verified.');
    }
  } catch (error) {
    throw new Error(
      `Corrupt local data could not be quarantined; active data was left in place. ${errorMessage(error)}`,
    );
  }

  if (replacementRaw === null) {
    await storage.removeItem(storageKey);
    const remaining = await storage.getItem(storageKey);
    if (remaining !== null) {
      throw new Error(
        `Corrupt local data was quarantined at ${quarantineKey}, but the active value could not be removed.`,
      );
    }
  } else {
    await storage.setItem(storageKey, replacementRaw);
    const installed = await storage.getItem(storageKey);
    if (installed !== replacementRaw) {
      throw new Error(
        `Corrupt local data was quarantined at ${quarantineKey}, but recovered records could not be verified.`,
      );
    }
  }

  return Object.freeze({
    quarantineKey,
    replacementApplied: replacementRaw !== null,
  });
}

export function localCorruptionRecoveryError({
  label,
  recovery,
  salvagedRecords,
}: Readonly<{
  label: string;
  recovery: LocalCorruptionRecovery;
  salvagedRecords?: number;
}>): Error {
  const salvageMessage = recovery.replacementApplied
    ? ` ${salvagedRecords ?? 0} valid record${salvagedRecords === 1 ? '' : 's'} ${salvagedRecords === 1 ? 'was' : 'were'} preserved for a safe retry.`
    : ' Retry to continue with a clean active store.';
  return new Error(
    `${label} was corrupt and was quarantined at ${recovery.quarantineKey}.${salvageMessage}`,
  );
}

function rawFingerprint(raw: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return [
    raw.length.toString(36),
    (first >>> 0).toString(36),
    (second >>> 0).toString(36),
  ].join('-');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
