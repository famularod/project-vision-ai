import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureMemoryProjectId } from './DAVECaptureMemory';
import {
  addMemoryToDAVEProjectWalkSession,
  cancelDAVEProjectWalkSession,
  completeDAVEProjectWalkSession,
  normalizeDAVEProjectWalkSession,
  removeMemoryFromDAVEProjectWalkSession,
  type DAVEProjectWalkSession,
} from './DAVEProjectWalkSession';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import type { DurableLocalTransactionOperation } from './DurableLocalTransaction';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const DAVE_PROJECT_WALK_SESSION_STORAGE_KEY = '@dave/project-walk-session/v1';
export const DAVE_PROJECT_WALK_SESSION_QUARANTINE_KEY_PREFIX =
  `${DAVE_PROJECT_WALK_SESSION_STORAGE_KEY}.corrupt.`;
export type DAVEProjectWalkSessionStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

export type DAVEProjectWalkSessionRepository = Readonly<{
  readActive(): Promise<DAVEProjectWalkSession | null>;
  start(session: DAVEProjectWalkSession): Promise<DAVEProjectWalkSession>;
  addMemory(sessionId: string, memoryId: string, updatedAt: string): Promise<DAVEProjectWalkSession>;
  removeMemory(sessionId: string, memoryId: string, updatedAt: string): Promise<DAVEProjectWalkSession>;
  complete(sessionId: string, completedAt: string): Promise<DAVEProjectWalkSession>;
  cancel(sessionId: string, cancelledAt: string): Promise<DAVEProjectWalkSession>;
  deleteActiveForProject(projectId: string): Promise<boolean>;
}>;

export function projectWalkSessionRemovalOperationForProject(
  raw: string | null,
  projectId: string,
): DurableLocalTransactionOperation | null {
  const exactProjectId = captureMemoryProjectId(projectId);
  if (raw === null) return null;
  const session = normalizeDAVEProjectWalkSession(JSON.parse(raw) as unknown);
  if (session.projectId !== exactProjectId) return null;
  return {
    kind: 'remove_if_unchanged',
    key: DAVE_PROJECT_WALK_SESSION_STORAGE_KEY,
    expectedValue: raw,
  };
}

export function createDAVEProjectWalkSessionRepository(
  storage: DAVEProjectWalkSessionStorage = AsyncStorage,
): DAVEProjectWalkSessionRepository {
  const exclusive = <T>(operation: () => Promise<T>) =>
    runExclusiveLocalStorageMutation(
      [DAVE_PROJECT_WALK_SESSION_STORAGE_KEY],
      operation,
    );

  async function readActiveUnlocked() {
    const raw = await storage.getItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
    if (!raw) return null;

    let session: DAVEProjectWalkSession;
    try {
      session = normalizeDAVEProjectWalkSession(JSON.parse(raw));
    } catch {
      const recovery = await quarantineCorruptLocalValue({
        storage,
        storageKey: DAVE_PROJECT_WALK_SESSION_STORAGE_KEY,
        quarantineKeyPrefix: DAVE_PROJECT_WALK_SESSION_QUARANTINE_KEY_PREFIX,
        raw,
        replacementRaw: null,
      });
      throw localCorruptionRecoveryError({
        label: 'Stored Project Walk session',
        recovery,
      });
    }

    // Completed/cancelled sessions are valid but no longer active. Preserve
    // the established cleanup behavior; quarantine is only for corruption.
    if (session.status !== 'active') {
      await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  }

  async function write(session: DAVEProjectWalkSession) {
    await storage.setItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  async function requireActiveUnlocked(sessionId: string) {
    const active = await readActiveUnlocked();
    if (!active || active.id !== sessionId.trim()) {
      throw new Error('The active Project Walk session was not found.');
    }
    return active;
  }

  return Object.freeze({
    async readActive() {
      return exclusive(readActiveUnlocked);
    },

    async start(session) {
      return exclusive(async () => {
        const normalized = normalizeDAVEProjectWalkSession(session);
        if (normalized.status !== 'active') throw new Error('A new Project Walk session must be active.');
        const existing = await readActiveUnlocked();
        if (existing) {
          if (existing.id === normalized.id && JSON.stringify(existing) === JSON.stringify(normalized)) {
            return existing;
          }
          throw new Error(`A Project Walk is already active for ${existing.projectName}.`);
        }
        return write(normalized);
      });
    },

    async addMemory(sessionId, memoryId, updatedAt) {
      return exclusive(async () => write(addMemoryToDAVEProjectWalkSession(
        await requireActiveUnlocked(sessionId), memoryId, updatedAt,
      )));
    },

    async removeMemory(sessionId, memoryId, updatedAt) {
      return exclusive(async () => write(removeMemoryFromDAVEProjectWalkSession(
        await requireActiveUnlocked(sessionId), memoryId, updatedAt,
      )));
    },

    async complete(sessionId, completedAt) {
      return exclusive(async () => {
        const completed = completeDAVEProjectWalkSession(
          await requireActiveUnlocked(sessionId),
          completedAt,
        );
        await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
        return completed;
      });
    },

    async cancel(sessionId, cancelledAt) {
      return exclusive(async () => {
        const cancelled = cancelDAVEProjectWalkSession(
          await requireActiveUnlocked(sessionId),
          cancelledAt,
        );
        await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
        return cancelled;
      });
    },

    async deleteActiveForProject(projectId) {
      const exactProjectId = captureMemoryProjectId(projectId);
      return exclusive(async () => {
        const active = await readActiveUnlocked();
        if (!active || active.projectId !== exactProjectId) return false;
        await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
        return true;
      });
    },
  });
}

export const localDAVEProjectWalkSessionRepository =
  createDAVEProjectWalkSessionRepository();
