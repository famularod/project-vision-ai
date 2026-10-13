export const DURABLE_LOCAL_TRANSACTION_VERSION = 1 as const;

export type DurableLocalTransactionStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type DurableLocalTransactionOperation =
  | Readonly<{
      kind: 'set';
      key: string;
      value: string;
    }>
  | Readonly<{
      kind: 'remove_if_unchanged';
      key: string;
      expectedValue: string | null;
    }>;

export type DurableLocalTransactionJournal = Readonly<{
  version: typeof DURABLE_LOCAL_TRANSACTION_VERSION;
  transactionId: string;
  phase: 'prepared' | 'applying' | 'committed';
  createdAt: string;
  operations: readonly DurableLocalTransactionOperation[];
  beforeValues: readonly (string | null)[];
  appliedOperationIndexes: readonly number[];
  skippedOperationIndexes: readonly number[];
}>;

export type DurableLocalTransactionResult = Readonly<{
  transactionId: string;
  appliedOperationIndexes: readonly number[];
  skippedOperationIndexes: readonly number[];
  recovered: boolean;
}>;

export type DurableLocalTransactionErrorCode =
  | 'invalid_transaction'
  | 'journal_corrupt'
  | 'journal_write_failed'
  | 'operation_failed'
  | 'verification_failed'
  | 'journal_cleanup_failed';

export class DurableLocalTransactionError extends Error {
  readonly code: DurableLocalTransactionErrorCode;
  readonly transactionId: string | null;
  readonly recoverable: boolean;
  readonly cause: unknown;

  constructor({
    code,
    message,
    transactionId = null,
    recoverable,
    cause,
  }: {
    code: DurableLocalTransactionErrorCode;
    message: string;
    transactionId?: string | null;
    recoverable: boolean;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'DurableLocalTransactionError';
    this.code = code;
    this.transactionId = transactionId;
    this.recoverable = recoverable;
    this.cause = cause;
  }
}

export type DurableLocalTransactionRepository = Readonly<{
  commit: (
    operations: readonly DurableLocalTransactionOperation[],
  ) => Promise<DurableLocalTransactionResult>;
  recover: () => Promise<DurableLocalTransactionResult | null>;
  /**
   * Sync batch Y4, item 1. A waiting journal that cannot be read at all has
   * nothing to finish from, and `recover` and `commit` refuse it at every
   * start, for good. This keeps its exact bytes under another name, writes
   * down that it did (so it can be said once), and only then removes the
   * journal. Resolves to null, and changes nothing, when no journal waits or
   * the waiting one can be read: that one is finished by `recover`, or stops
   * as it always has. Nothing does this by itself: each record's owner decides
   * whether going on without it can lose anything.
   */
  setAsideIfUnreadable: () => Promise<Readonly<{ asideKey: string }> | null>;
}>;

/** Where an unreadable journal's bytes are kept: this, then a fingerprint of the bytes. */
export function durableJournalSetAsideKeyPrefix(journalKey: string): string {
  return `${journalKey}.unreadable.`;
}

/** Present from the moment a journal was set aside until that has been said (see services/RecoveryRecordNotices.ts). */
export function durableJournalSetAsideNoticeKey(journalKey: string): string {
  return `${journalKey}.setAsideNotice`;
}

/** How many names are tried for one set of bytes before giving up (each further name only after a fingerprint clash). */
const SET_ASIDE_NAMES_TRIED = 20;

/**
 * A small write-ahead transaction journal for related string stores. Target
 * writes are idempotent and restart-recoverable. Callers must await `commit`
 * before presenting success or clearing in-memory state.
 */
export function createDurableLocalTransactionRepository({
  storage,
  journalKey,
  createTransactionId,
  now,
  recoveryWritesAgain = false,
}: {
  storage: DurableLocalTransactionStorage;
  journalKey: string;
  createTransactionId: () => string;
  now: () => string;
  /**
   * What recovery does when a key this journal had already written holds
   * something else by now (independent review pass 4). By default it stops,
   * as it always has: and since the journal stays, it stops again at every
   * later recovery, for good. With this set, recovery writes the journal's
   * value again and finishes; a conditional removal that was made stays made,
   * and whatever was saved under its key since is left alone, as when the
   * removal is skipped. For a journal whose values must stand over anything
   * saved while it waited (a restore he asked for, with editing locked).
   */
  recoveryWritesAgain?: boolean;
}): DurableLocalTransactionRepository {
  assertStorageKey(journalKey, 'journal');
  let mutationTail: Promise<void> = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const recover = () => serialize(async () => {
    const raw = await storage.getItem(journalKey);
    if (raw === null) return null;
    return applyJournal(parseJournal(raw, journalKey), true);
  });

  const commit = (operations: readonly DurableLocalTransactionOperation[]) =>
    serialize(async () => {
      const pendingRaw = await storage.getItem(journalKey);
      if (pendingRaw !== null) {
        await applyJournal(parseJournal(pendingRaw, journalKey), true);
      }

      const normalizedOperations = normalizeOperations(operations, journalKey);
      const transactionId = normalizedTransactionId(createTransactionId());
      const createdAt = normalizedTimestamp(now());
      const beforeValues: (string | null)[] = [];
      for (const operation of normalizedOperations) {
        beforeValues.push(await storage.getItem(operation.key));
      }
      const journal: DurableLocalTransactionJournal = Object.freeze({
        version: DURABLE_LOCAL_TRANSACTION_VERSION,
        transactionId,
        phase: 'prepared',
        createdAt,
        operations: Object.freeze(normalizedOperations),
        beforeValues: Object.freeze(beforeValues),
        appliedOperationIndexes: Object.freeze([]),
        skippedOperationIndexes: Object.freeze([]),
      });

      await persistJournal(journal, 'journal_write_failed');
      return applyJournal(journal, false);
    });

  async function applyJournal(
    initial: DurableLocalTransactionJournal,
    recovered: boolean,
  ): Promise<DurableLocalTransactionResult> {
    let journal = initial;
    // A journal found waiting: what it had written is written again where it no longer stands.
    const again = recovered && recoveryWritesAgain;
    if (again) await writeAgainWhatChanged(journal);
    if (journal.phase === 'committed') {
      await verifyJournalOutcome(journal, again);
      await cleanupJournal(journal.transactionId);
      return resultFor(journal, recovered);
    }

    if (journal.phase === 'prepared') {
      journal = withJournalProgress(journal, { phase: 'applying' });
      await persistJournal(journal, 'journal_write_failed');
    }

    for (let index = 0; index < journal.operations.length; index += 1) {
      if (
        journal.appliedOperationIndexes.includes(index) ||
        journal.skippedOperationIndexes.includes(index)
      ) continue;

      const operation = journal.operations[index];
      try {
        const skipped = await applyOperation(operation);
        journal = withJournalProgress(journal, skipped
          ? { skippedIndex: index }
          : { appliedIndex: index });
        await persistJournal(journal, 'journal_write_failed');
      } catch (cause) {
        if (cause instanceof DurableLocalTransactionError) throw cause;
        throw transactionError(
          'operation_failed',
          'A durable local transaction operation failed. The journal remains available for retry.',
          journal.transactionId,
          true,
          cause,
        );
      }
    }

    await verifyJournalOutcome(journal, again);
    journal = withJournalProgress(journal, { phase: 'committed' });
    await persistJournal(journal, 'journal_write_failed');
    await cleanupJournal(journal.transactionId);
    return resultFor(journal, recovered);
  }

  async function applyOperation(operation: DurableLocalTransactionOperation) {
    if (operation.kind === 'set') {
      await storage.setItem(operation.key, operation.value);
      const observed = await storage.getItem(operation.key);
      if (observed !== operation.value) {
        throw transactionError(
          'verification_failed',
          `Durable local write verification failed for ${operation.key}.`,
          null,
          true,
        );
      }
      return false;
    }

    const current = await storage.getItem(operation.key);
    if (current !== operation.expectedValue) return true;
    await storage.removeItem(operation.key);
    if (await storage.getItem(operation.key) !== null) {
      throw transactionError(
        'verification_failed',
        `Durable local removal verification failed for ${operation.key}.`,
        null,
        true,
      );
    }
    return false;
  }

  /**
   * Independent review pass 4: a 'set' the waiting journal had applied, whose
   * key holds another value now, is applied again. It failed the outcome check
   * instead, at this recovery and at every one after it.
   */
  async function writeAgainWhatChanged(journal: DurableLocalTransactionJournal) {
    for (const index of journal.appliedOperationIndexes) {
      const operation = journal.operations[index];
      if (operation.kind !== 'set' || await storage.getItem(operation.key) === operation.value) continue;
      try {
        await applyOperation(operation);
      } catch (cause) {
        throw transactionError(
          'operation_failed',
          'A durable local transaction operation failed. The journal remains available for retry.',
          journal.transactionId,
          true,
          cause,
        );
      }
    }
  }

  async function verifyJournalOutcome(journal: DurableLocalTransactionJournal, removalsStayMade = false) {
    for (let index = 0; index < journal.operations.length; index += 1) {
      const operation = journal.operations[index];
      const observed = await storage.getItem(operation.key);
      if (journal.skippedOperationIndexes.includes(index)) {
        // A skipped conditional removal deliberately preserves whatever newer
        // value exists. Recovery must never remove it later.
        continue;
      }
      // A removal that was made is not undone by a value saved under the key since, and never removes it.
      const verified = operation.kind === 'set'
        ? observed === operation.value
        : observed === null || removalsStayMade;
      if (!verified) {
        throw transactionError(
          'verification_failed',
          `Durable transaction outcome verification failed for ${operation.key}.`,
          journal.transactionId,
          true,
        );
      }
    }
  }

  async function persistJournal(
    journal: DurableLocalTransactionJournal,
    errorCode: 'journal_write_failed',
  ) {
    const raw = JSON.stringify(journal);
    try {
      await storage.setItem(journalKey, raw);
      if (await storage.getItem(journalKey) !== raw) throw new Error('Journal verification failed.');
    } catch (cause) {
      throw transactionError(
        errorCode,
        'The durable local transaction journal could not be verified.',
        journal.transactionId,
        true,
        cause,
      );
    }
  }

  async function cleanupJournal(transactionId: string) {
    try {
      await storage.removeItem(journalKey);
      if (await storage.getItem(journalKey) !== null) {
        throw new Error('Committed journal still exists after cleanup.');
      }
    } catch (cause) {
      throw transactionError(
        'journal_cleanup_failed',
        'The transaction committed, but its recovery journal could not be cleaned up.',
        transactionId,
        true,
        cause,
      );
    }
  }

  const setAsideIfUnreadable = () => serialize(async () => {
    const raw = await storage.getItem(journalKey);
    if (raw === null) return null;
    try {
      parseJournal(raw, journalKey);
      return null;
    } catch {
      // It cannot be read: there is nothing to finish from.
    }
    // 1. The bytes, kept as they are. A name already holding these bytes is the copy an earlier start made before
    //    it was stopped; a name holding other bytes is never written over.
    let asideKey = '';
    for (let attempt = 0; attempt < SET_ASIDE_NAMES_TRIED && !asideKey; attempt += 1) {
      const candidate = `${durableJournalSetAsideKeyPrefix(journalKey)}${bytesFingerprint(raw)}${attempt ? `.${attempt}` : ''}`;
      const held = await storage.getItem(candidate);
      if (held === null) await storage.setItem(candidate, raw);
      else if (held !== raw) continue;
      if (await storage.getItem(candidate) !== raw) throw new Error('The unreadable record could not be kept under another name.');
      asideKey = candidate;
    }
    if (!asideKey) throw new Error('The unreadable record could not be kept under another name.');
    // 2. That it was set aside, written before the journal goes: a start stopped after this still says so.
    const noticeKey = durableJournalSetAsideNoticeKey(journalKey);
    const notice = JSON.stringify({ asideKey });
    await storage.setItem(noticeKey, notice);
    if (await storage.getItem(noticeKey) !== notice) throw new Error('Setting the unreadable record aside could not be written down.');
    // 3. Only now the journal itself.
    await storage.removeItem(journalKey);
    if (await storage.getItem(journalKey) !== null) throw new Error('The unreadable record was kept under another name but could not be removed.');
    return Object.freeze({ asideKey });
  });

  return Object.freeze({ commit, recover, setAsideIfUnreadable });
}

/** A short name for a set of bytes: the same bytes always give the same name, so a repeated start makes no second copy. */
function bytesFingerprint(raw: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return [raw.length.toString(36), (first >>> 0).toString(36), (second >>> 0).toString(36)].join('-');
}

function normalizeOperations(
  operations: readonly DurableLocalTransactionOperation[],
  journalKey: string,
): DurableLocalTransactionOperation[] {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw transactionError(
      'invalid_transaction',
      'A durable local transaction requires at least one operation.',
      null,
      false,
    );
  }
  const keys = new Set<string>();
  return operations.map(operation => {
    if (!operation || typeof operation !== 'object') {
      throw transactionError('invalid_transaction', 'Transaction operation is invalid.', null, false);
    }
    assertStorageKey(operation.key, 'operation');
    if (operation.key === journalKey || keys.has(operation.key)) {
      throw transactionError(
        'invalid_transaction',
        'Transaction operation keys must be unique and cannot target the journal.',
        null,
        false,
      );
    }
    keys.add(operation.key);
    if (operation.kind === 'set' && typeof operation.value === 'string') {
      return Object.freeze({ kind: 'set' as const, key: operation.key, value: operation.value });
    }
    if (
      operation.kind === 'remove_if_unchanged' &&
      (typeof operation.expectedValue === 'string' || operation.expectedValue === null)
    ) {
      return Object.freeze({
        kind: 'remove_if_unchanged' as const,
        key: operation.key,
        expectedValue: operation.expectedValue,
      });
    }
    throw transactionError('invalid_transaction', 'Transaction operation payload is invalid.', null, false);
  });
}

function parseJournal(raw: string, journalKey: string): DurableLocalTransactionJournal {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    if (value.version !== DURABLE_LOCAL_TRANSACTION_VERSION) throw new Error('unsupported version');
    const transactionId = normalizedTransactionId(value.transactionId);
    const createdAt = normalizedTimestamp(value.createdAt);
    if (!['prepared', 'applying', 'committed'].includes(String(value.phase))) {
      throw new Error('invalid phase');
    }
    const operations = normalizeOperations(
      value.operations as DurableLocalTransactionOperation[],
      journalKey,
    );
    if (!Array.isArray(value.beforeValues) || value.beforeValues.length !== operations.length) {
      throw new Error('invalid backup inventory');
    }
    const beforeValues = value.beforeValues.map(item => {
      if (typeof item !== 'string' && item !== null) throw new Error('invalid backup value');
      return item;
    });
    const appliedOperationIndexes = normalizedIndexes(value.appliedOperationIndexes, operations.length);
    const skippedOperationIndexes = normalizedIndexes(value.skippedOperationIndexes, operations.length);
    if (appliedOperationIndexes.some(index => skippedOperationIndexes.includes(index))) {
      throw new Error('operation cannot be applied and skipped');
    }
    if (skippedOperationIndexes.some(index => operations[index].kind !== 'remove_if_unchanged')) {
      throw new Error('only conditional removals may be skipped');
    }
    return Object.freeze({
      version: DURABLE_LOCAL_TRANSACTION_VERSION,
      transactionId,
      phase: value.phase as DurableLocalTransactionJournal['phase'],
      createdAt,
      operations: Object.freeze(operations),
      beforeValues: Object.freeze(beforeValues),
      appliedOperationIndexes: Object.freeze(appliedOperationIndexes),
      skippedOperationIndexes: Object.freeze(skippedOperationIndexes),
    });
  } catch (cause) {
    if (cause instanceof DurableLocalTransactionError) throw cause;
    throw transactionError(
      'journal_corrupt',
      'The durable local transaction journal is corrupt. Writes are blocked until recovery.',
      null,
      false,
      cause,
    );
  }
}

function withJournalProgress(
  journal: DurableLocalTransactionJournal,
  change: Readonly<{
    phase?: DurableLocalTransactionJournal['phase'];
    appliedIndex?: number;
    skippedIndex?: number;
  }>,
): DurableLocalTransactionJournal {
  return Object.freeze({
    ...journal,
    phase: change.phase || journal.phase,
    appliedOperationIndexes: Object.freeze(change.appliedIndex === undefined
      ? [...journal.appliedOperationIndexes]
      : [...journal.appliedOperationIndexes, change.appliedIndex]),
    skippedOperationIndexes: Object.freeze(change.skippedIndex === undefined
      ? [...journal.skippedOperationIndexes]
      : [...journal.skippedOperationIndexes, change.skippedIndex]),
  });
}

function resultFor(
  journal: DurableLocalTransactionJournal,
  recovered: boolean,
): DurableLocalTransactionResult {
  return Object.freeze({
    transactionId: journal.transactionId,
    appliedOperationIndexes: Object.freeze([...journal.appliedOperationIndexes]),
    skippedOperationIndexes: Object.freeze([...journal.skippedOperationIndexes]),
    recovered,
  });
}

function normalizedIndexes(value: unknown, operationCount: number) {
  if (!Array.isArray(value)) throw new Error('invalid operation index inventory');
  const indexes = value.map(item => {
    if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) >= operationCount) {
      throw new Error('invalid operation index');
    }
    return item as number;
  });
  if (new Set(indexes).size !== indexes.length) throw new Error('duplicate operation index');
  return indexes;
}

function normalizedTransactionId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) {
    throw transactionError('invalid_transaction', 'Transaction ID is invalid.', null, false);
  }
  return value;
}

function normalizedTimestamp(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) {
    throw transactionError('invalid_transaction', 'Transaction timestamp is invalid.', null, false);
  }
  return new Date(value).toISOString();
}

function assertStorageKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw transactionError(
      'invalid_transaction',
      `Durable local ${label} key is invalid.`,
      null,
      false,
    );
  }
}

function transactionError(
  code: DurableLocalTransactionErrorCode,
  message: string,
  transactionId: string | null,
  recoverable: boolean,
  cause?: unknown,
) {
  return new DurableLocalTransactionError({
    code,
    message,
    transactionId,
    recoverable,
    cause,
  });
}
