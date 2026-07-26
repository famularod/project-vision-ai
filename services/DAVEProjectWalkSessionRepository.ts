import AsyncStorage from '@react-native-async-storage/async-storage';
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
}>;

export function createDAVEProjectWalkSessionRepository(
  storage: DAVEProjectWalkSessionStorage = AsyncStorage,
): DAVEProjectWalkSessionRepository {
  async function readActive() {
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

  async function requireActive(sessionId: string) {
    const active = await readActive();
    if (!active || active.id !== sessionId.trim()) {
      throw new Error('The active Project Walk session was not found.');
    }
    return active;
  }

  return Object.freeze({
    async readActive() {
      return readActive();
    },

    async start(session) {
      const normalized = normalizeDAVEProjectWalkSession(session);
      if (normalized.status !== 'active') throw new Error('A new Project Walk session must be active.');
      const existing = await readActive();
      if (existing) {
        if (existing.id === normalized.id && JSON.stringify(existing) === JSON.stringify(normalized)) {
          return existing;
        }
        throw new Error(`A Project Walk is already active for ${existing.projectName}.`);
      }
      return write(normalized);
    },

    async addMemory(sessionId, memoryId, updatedAt) {
      return write(addMemoryToDAVEProjectWalkSession(
        await requireActive(sessionId), memoryId, updatedAt,
      ));
    },

    async removeMemory(sessionId, memoryId, updatedAt) {
      return write(removeMemoryFromDAVEProjectWalkSession(
        await requireActive(sessionId), memoryId, updatedAt,
      ));
    },

    async complete(sessionId, completedAt) {
      const completed = completeDAVEProjectWalkSession(await requireActive(sessionId), completedAt);
      await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
      return completed;
    },

    async cancel(sessionId, cancelledAt) {
      const cancelled = cancelDAVEProjectWalkSession(await requireActive(sessionId), cancelledAt);
      await storage.removeItem(DAVE_PROJECT_WALK_SESSION_STORAGE_KEY);
      return cancelled;
    },
  });
}

export const localDAVEProjectWalkSessionRepository =
  createDAVEProjectWalkSessionRepository();
