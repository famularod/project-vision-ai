import type { DAVESyncTombstone } from '../types';
import { parsePersistedDAVESyncTombstones } from './DAVESyncTombstones';
import type { DurableLocalTransactionOperation } from './DurableLocalTransaction';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';
import {
  createProjectDeletionTransactionRepository,
  parseProjectDeletionCloudIntents,
  parseProjectDeletionFileCleanupIntents,
  parseProjectUpdateDeletionIntents,
  PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
  salvageProjectDeletionCloudIntents,
  salvageProjectDeletionFileCleanupIntents,
  withoutProjectDeletionCloudIntent,
  withoutProjectDeletionFileCleanupIntent,
  type ProjectDeletionFileCleanupIntent,
  type ProjectDeletionStorageKeys,
} from './ProjectDeletionTransaction';
import type { ProjectUpdateDeletionIntent } from './ProjectUpdateDeletionJournal';
import { isOwnedLocalFileManifestMember } from './OwnedLocalFileRepository';
import {
  createProjectDocumentOwnedFileStore,
  requireOwnedProjectDocumentAccess,
} from './ProjectDocumentLifecycle';
import { OwnedLocalFileStoreError } from './OwnedLocalFileStore';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';

type RuntimeStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

type QueuedProjectDelete = Readonly<{
  entity: string;
  operation: string;
  payload: unknown;
}>;

export type ProjectDeletionTransactionSupport = Readonly<{
  updateDeletionIntents: ProjectUpdateDeletionIntent[];
  cloudIntents: ReturnType<typeof parseProjectDeletionCloudIntents>;
  fileCleanupIntents: ProjectDeletionFileCleanupIntent[];
  daveSyncTombstones: DAVESyncTombstone[];
}>;

export type ProjectDeletionRuntime = Readonly<{
  recoverBeforeStartupReads: () => Promise<void>;
  recoverPendingIntentStores: () => Promise<void>;
  commit<TResult>(
    prepare: (
      support: ProjectDeletionTransactionSupport,
    ) => Promise<Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>> | Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>,
  ): Promise<TResult>;
  processPendingCloudIntents: () => Promise<void>;
  processPendingFileCleanupIntents: () => Promise<number>;
}>;

export class ProjectDeletionRecoveryRequiredError extends Error {
  readonly commitCause: unknown;
  readonly recoveryCause: unknown;

  constructor(commitCause: unknown, recoveryCause: unknown) {
    super('Project deletion was partially written and automatic recovery could not finish.');
    this.name = 'ProjectDeletionRecoveryRequiredError';
    this.commitCause = commitCause;
    this.recoveryCause = recoveryCause;
  }
}

export class ProjectDeletionIntentRecoveryRequiredError extends Error {
  readonly failures: readonly unknown[];

  constructor(failures: readonly unknown[]) {
    super('Pending project deletion cleanup data was repaired and requires an explicit retry.');
    this.name = 'ProjectDeletionIntentRecoveryRequiredError';
    this.failures = failures;
  }
}

type CleanupProjectDocument = Readonly<{
  ownedFileId?: string | null;
  ownedFileManifest?: unknown;
  localUri?: string | null;
}>;

type CleanupReferenceDocument = Readonly<{ id: string; uri: string }>;

export function buildProjectDeletionFileCleanupIntents({
  projectName,
  projectDocuments,
  referenceDocuments,
  isOwnedReferenceDocument,
}: Readonly<{
  projectName: string;
  projectDocuments: readonly CleanupProjectDocument[];
  referenceDocuments: readonly CleanupReferenceDocument[];
  isOwnedReferenceDocument: (document: CleanupReferenceDocument) => boolean;
}>): ProjectDeletionFileCleanupIntent[] {
  const intents = new Map<string, ProjectDeletionFileCleanupIntent>();
  projectDocuments.forEach(document => {
    let manifestMember = false;
    try {
      manifestMember = Boolean(
        document.ownedFileId && document.ownedFileManifest &&
        isOwnedLocalFileManifestMember(
          document.ownedFileManifest,
          document.ownedFileId,
          'project_document',
        ),
      );
    } catch {
      manifestMember = false;
    }
    if (!document.localUri || !document.ownedFileId || !document.ownedFileManifest || !manifestMember) return;
    const id = `project_document:${document.ownedFileId}`;
    intents.set(id, {
      id,
      kind: 'project_document',
      projectName,
      localUri: document.localUri,
      ownedFileId: document.ownedFileId,
      ownedFileManifest: document.ownedFileManifest,
    });
  });
  referenceDocuments.forEach(document => {
    if (!isOwnedReferenceDocument(document)) return;
    const id = `reference_document:${document.id}`;
    intents.set(id, {
      id,
      kind: 'reference_document',
      projectName,
      uri: document.uri,
    });
  });
  return [...intents.values()];
}

export function createProjectDeletionLocalFileCleaner({
  ownedProjectDocumentsRoot,
  deleteOwnedReferenceDocument,
}: Readonly<{
  ownedProjectDocumentsRoot: string | null;
  deleteOwnedReferenceDocument: (uri: string) => Promise<void>;
}>): (intent: ProjectDeletionFileCleanupIntent) => Promise<void> {
  return async intent => {
    if (intent.kind === 'reference_document') {
      await deleteOwnedReferenceDocument(intent.uri);
      return;
    }
    if (!ownedProjectDocumentsRoot) {
      throw new Error('Project document storage is unavailable.');
    }
    const store = createProjectDocumentOwnedFileStore({
      ownedRoot: ownedProjectDocumentsRoot,
    });
    try {
      await store.deleteAuthorizedFile(requireOwnedProjectDocumentAccess({
        localUri: intent.localUri,
        ownedFileId: intent.ownedFileId,
        ownedFileManifest: intent.ownedFileManifest,
      }));
    } catch (error) {
      if (!(error instanceof OwnedLocalFileStoreError) || error.code !== 'file_missing') {
        throw error;
      }
    }
  };
}

/**
 * Coordinates the deletion write-ahead journal, startup recovery, post-commit
 * cloud queueing, and retryable local file cleanup without coupling those
 * mechanics to the live screen component.
 */
export function createProjectDeletionRuntime({
  storage,
  storageKeys,
  createTransactionId,
  now,
  getOfflineQueue,
  queueCloudProjectDelete,
  cleanupLocalFile,
}: Readonly<{
  storage: RuntimeStorage;
  storageKeys: ProjectDeletionStorageKeys;
  createTransactionId: () => string;
  now: () => string;
  getOfflineQueue: () => Promise<QueuedProjectDelete[]>;
  queueCloudProjectDelete: (projectName: string) => Promise<void>;
  cleanupLocalFile: (intent: ProjectDeletionFileCleanupIntent) => Promise<void>;
}>): ProjectDeletionRuntime {
  const transaction = createProjectDeletionTransactionRepository({
    storage,
    createTransactionId,
    now,
  });
  const transactionKeys = [
    PROJECT_DELETION_TRANSACTION_JOURNAL_KEY,
    ...Object.values(storageKeys),
  ];
  let recoveryPromise: Promise<void> | null = null;
  let cloudProcessing: Promise<void> | null = null;
  let fileProcessing: Promise<number> | null = null;

  const recoverBeforeStartupReads = (): Promise<void> => {
    if (recoveryPromise) return recoveryPromise;
    const recovery = runExclusiveLocalStorageMutation(transactionKeys, async () => {
      await transaction.recover();
    });
    recoveryPromise = recovery.finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  };

  const recoverPendingIntentStores = () => runExclusiveLocalStorageMutation(
    [storageKeys.cloudIntents, storageKeys.fileCleanupIntents],
    async () => {
      const failures: unknown[] = [];
      try {
        await readRecoverableIntentArray(
          storageKeys.cloudIntents,
          parseProjectDeletionCloudIntents,
          salvageProjectDeletionCloudIntents,
          'Pending cloud project deletions',
        );
      } catch (error) {
        failures.push(error);
      }
      try {
        await readRecoverableIntentArray(
          storageKeys.fileCleanupIntents,
          parseProjectDeletionFileCleanupIntents,
          salvageProjectDeletionFileCleanupIntents,
          'Pending project file cleanup',
        );
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new ProjectDeletionIntentRecoveryRequiredError(failures);
      }
    },
  );

  const commit = async <TResult>(
    prepare: (
      support: ProjectDeletionTransactionSupport,
    ) => Promise<Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>> | Readonly<{
      operations: readonly DurableLocalTransactionOperation[];
      result: TResult;
    }>,
  ): Promise<TResult> => {
    await recoverBeforeStartupReads();
    return runExclusiveLocalStorageMutation(transactionKeys, async () => {
      const support: ProjectDeletionTransactionSupport = {
        updateDeletionIntents: await readArray(
          storageKeys.updateDeletionJournal,
          parseProjectUpdateDeletionIntents,
        ),
        cloudIntents: await readArray(
          storageKeys.cloudIntents,
          parseProjectDeletionCloudIntents,
        ),
        fileCleanupIntents: await readArray(
          storageKeys.fileCleanupIntents,
          parseProjectDeletionFileCleanupIntents,
        ),
        daveSyncTombstones: await readArray(
          storageKeys.daveSyncTombstones,
          parsePersistedDAVESyncTombstones,
        ),
      };
      const prepared = await prepare(support);
      try {
        await transaction.commit(prepared.operations);
      } catch (commitCause) {
        // A target write may already have landed. Recover while the global
        // key set is still reserved so the UI never returns to editable stale
        // state after a partial cascade.
        recoveryPromise = null;
        let recovered;
        try {
          recovered = await transaction.recover();
        } catch (recoveryCause) {
          throw new ProjectDeletionRecoveryRequiredError(
            commitCause,
            recoveryCause,
          );
        }
        if (!recovered) throw commitCause;
      }
      return prepared.result;
    });
  };

  const processPendingCloudIntents = (): Promise<void> => {
    if (cloudProcessing) return cloudProcessing;
    const processing = (async () => {
      await recoverBeforeStartupReads();
      await recoverPendingIntentStores();
      for (;;) {
        const intents = await readArray(
          storageKeys.cloudIntents,
          parseProjectDeletionCloudIntents,
        );
        if (intents.length === 0) return;
        for (const intent of intents) {
          const queue = await getOfflineQueue();
          const alreadyQueued = queue.some(item => {
            if (item.entity !== 'project' || item.operation !== 'delete') return false;
            if (!isRecord(item.payload)) return false;
            return typeof item.payload.name === 'string' &&
              normalizedName(item.payload.name) === normalizedName(intent.projectName);
          });
          if (!alreadyQueued) await queueCloudProjectDelete(intent.projectName);
          await mutateArray(
            storageKeys.cloudIntents,
            parseProjectDeletionCloudIntents,
            current => withoutProjectDeletionCloudIntent(current, intent.projectName),
          );
        }
      }
    })();
    cloudProcessing = processing.finally(() => {
      cloudProcessing = null;
    });
    return cloudProcessing;
  };

  const processPendingFileCleanupIntents = (): Promise<number> => {
    if (fileProcessing) return fileProcessing;
    const processing = (async () => {
      await recoverBeforeStartupReads();
      await recoverPendingIntentStores();
      const intents = await readArray(
        storageKeys.fileCleanupIntents,
        parseProjectDeletionFileCleanupIntents,
      );
      let failures = 0;
      for (const intent of intents) {
        try {
          await cleanupLocalFile(intent);
          await mutateArray(
            storageKeys.fileCleanupIntents,
            parseProjectDeletionFileCleanupIntents,
            current => withoutProjectDeletionFileCleanupIntent(current, intent.id),
          );
        } catch {
          failures += 1;
        }
      }
      return failures;
    })();
    fileProcessing = processing.finally(() => {
      fileProcessing = null;
    });
    return fileProcessing;
  };

  async function readArray<T>(
    storageKey: string,
    parser: (value: unknown) => T[],
  ): Promise<T[]> {
    const raw = await storage.getItem(storageKey);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${storageKey} contains invalid JSON.`);
    }
    return parser(parsed);
  }

  async function readRecoverableIntentArray<T>(
    storageKey: string,
    parser: (value: unknown) => T[],
    salvage: (value: unknown) => T[],
    label: string,
  ): Promise<T[]> {
    const raw = await storage.getItem(storageKey);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
      return parser(parsed);
    } catch {
      let recoveredRecords: T[] = [];
      try {
        if (parsed === undefined) parsed = JSON.parse(raw);
        recoveredRecords = salvage(parsed);
      } catch {
        recoveredRecords = [];
      }
      const recovery = await quarantineCorruptLocalValue({
        storage,
        storageKey,
        quarantineKeyPrefix: `${storageKey}.quarantine.v1/`,
        raw,
        replacementRaw: JSON.stringify(recoveredRecords),
      });
      throw localCorruptionRecoveryError({
        label,
        recovery,
        salvagedRecords: recoveredRecords.length,
      });
    }
  }

  async function mutateArray<T>(
    storageKey: string,
    parser: (value: unknown) => T[],
    mutate: (current: T[]) => T[],
  ): Promise<void> {
    await runExclusiveLocalStorageMutation([storageKey], async () => {
      const value = JSON.stringify(mutate(await readArray(storageKey, parser)));
      await storage.setItem(storageKey, value);
      if (await storage.getItem(storageKey) !== value) {
        throw new Error(`${storageKey} could not be verified.`);
      }
    });
  }

  return Object.freeze({
    recoverBeforeStartupReads,
    recoverPendingIntentStores,
    commit,
    processPendingCloudIntents,
    processPendingFileCleanupIntents,
  });
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
