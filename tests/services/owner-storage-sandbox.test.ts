import {
  createOwnerStorageSandbox,
  isOwnerSensitiveCanonicalStorageKey,
  OWNER_STORAGE_SANDBOX_JOURNAL_KEY,
  OWNER_STORAGE_SANDBOX_METADATA_KEY,
} from '../../services/OwnerStorageSandbox';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
    getAllKeys: async () => Array.from(values.keys()),
    multiGet: async (keys: readonly string[]) =>
      keys.map(key => [key, values.get(key) ?? null] as const),
    multiSet: async (entries: readonly (readonly [string, string])[]) => {
      entries.forEach(([key, value]) => values.set(key, value));
    },
    multiRemove: async (keys: readonly string[]) => {
      keys.forEach(key => values.delete(key));
    },
  };
}

describe('OwnerStorageSandbox', () => {
  test('recognizes project, sync, and intelligence data but not auth tokens', () => {
    expect(isOwnerSensitiveCanonicalStorageKey('projectPhotoUpdate.projects.v2')).toBe(true);
    expect(isOwnerSensitiveCanonicalStorageKey('projectVisionAI.syncQueue.v1')).toBe(true);
    expect(isOwnerSensitiveCanonicalStorageKey('@dave/project-truth-snapshots/v1')).toBe(true);
    expect(isOwnerSensitiveCanonicalStorageKey('sb-example-auth-token')).toBe(false);
    expect(isOwnerSensitiveCanonicalStorageKey(OWNER_STORAGE_SANDBOX_METADATA_KEY)).toBe(false);
  });

  test('assigns legacy data to the first verified owner and hides it when signed out', async () => {
    const storage = memoryStorage({
      'projectPhotoUpdate.projects.v2': '["Project A"]',
      'sb-example-auth-token': 'session',
    });
    const sandbox = createOwnerStorageSandbox({
      storage,
      now: () => '2026-07-26T00:00:00.000Z',
      createId: () => 'transition-1',
    });

    await sandbox.activateOwner('owner-a');
    expect(storage.values.get('projectPhotoUpdate.projects.v2')).toBe('["Project A"]');
    expect(storage.values.get('sb-example-auth-token')).toBe('session');

    await sandbox.activateOwner(null);
    expect(storage.values.has('projectPhotoUpdate.projects.v2')).toBe(false);
    expect(storage.values.get('sb-example-auth-token')).toBe('session');
  });

  test('restores only the selected owner during an account switch', async () => {
    const storage = memoryStorage({
      'projectPhotoUpdate.projects.v2': '["Project A"]',
    });
    const sandbox = createOwnerStorageSandbox({ storage });
    await sandbox.activateOwner('owner-a');
    await sandbox.activateOwner(null);
    await sandbox.activateOwner('owner-b');
    expect(storage.values.has('projectPhotoUpdate.projects.v2')).toBe(false);
    await storage.setItem('projectPhotoUpdate.projects.v2', '["Project B"]');

    await sandbox.activateOwner('owner-a');
    expect(storage.values.get('projectPhotoUpdate.projects.v2')).toBe('["Project A"]');
    await sandbox.activateOwner('owner-b');
    expect(storage.values.get('projectPhotoUpdate.projects.v2')).toBe('["Project B"]');
  });

  test('recovers a prepared transition before opening project data', async () => {
    const storage = memoryStorage({
      'projectPhotoUpdate.projects.v2': '["Wrong"]',
      [OWNER_STORAGE_SANDBOX_JOURNAL_KEY]: JSON.stringify({
        version: 1,
        id: 'transition-recovery',
        sourceOwnerId: 'owner-a',
        targetOwnerId: 'owner-b',
        legacyAssignedOwnerId: 'owner-a',
        sourceSnapshot: {
          'projectPhotoUpdate.projects.v2': '["Project A"]',
        },
        targetSnapshot: {
          'projectPhotoUpdate.projects.v2': '["Project B"]',
        },
        createdAt: '2026-07-26T00:00:00.000Z',
      }),
    });
    const sandbox = createOwnerStorageSandbox({ storage });
    expect(await sandbox.recoverInterruptedTransition()).toBe(true);
    expect(storage.values.get('projectPhotoUpdate.projects.v2')).toBe('["Project B"]');
    expect(storage.values.has(OWNER_STORAGE_SANDBOX_JOURNAL_KEY)).toBe(false);
  });

  test('fails closed when an interrupted account transition journal is corrupted', async () => {
    const storage = memoryStorage({
      'projectPhotoUpdate.projects.v2': '["Verified Project"]',
      [OWNER_STORAGE_SANDBOX_JOURNAL_KEY]: '{"version":1,"targetOwnerId":',
    });
    const sandbox = createOwnerStorageSandbox({ storage });

    await expect(sandbox.activateOwner('owner-a')).rejects.toThrow(
      'An interrupted account-data transition could not be verified.',
    );
    expect(storage.values.get('projectPhotoUpdate.projects.v2')).toBe(
      '["Verified Project"]',
    );
  });
});
