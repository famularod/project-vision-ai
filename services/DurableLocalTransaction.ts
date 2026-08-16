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
}>;

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
}: {
  storage: DurableLocalTransactionStorage;
  journalKey: string;
  createTransactionId: () => string;
  now: () => string;
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
    if (journal.phase === 'committed') {
      await verifyJournalOutcome(journal);
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

    await verifyJournalOutcome(journal);
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

  async function verifyJournalOutcome(journal: DurableLocalTransactionJournal) {
    for (let index = 0; index < journal.operations.length; index += 1) {
      const operation = journal.operations[index];
      const observed = await storage.getItem(operation.key);
      if (journal.skippedOperationIndexes.includes(index)) {
        // A skipped conditional removal deliberately preserves whatever newer
        // value exists. Recovery must never remove it later.
        continue;
      }
      const verified = operation.kind === 'set'
        ? observed === operation.value
        : observed === null;
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

  return Object.freeze({ commit, recover });
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
