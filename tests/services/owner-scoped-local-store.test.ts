import {
  OwnerStorageBoundaryError,
  createOwnerScopedLocalStore,
  createOwnerStorageTransitionGuard,
} from '../../services/OwnerScopedLocalStore';

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
}

describe('owner-scoped local store and auth-transition guard', () => {
  it('uses injective owner namespaces and blocks cross-account visibility', async () => {
    const fixture = storageFixture();
    const guard = createOwnerStorageTransitionGuard('owner/a');
    const store = createOwnerScopedLocalStore({
      storage: fixture.storage,
      baseKey: 'vitruvius.projects.v1',
      guard,
    });

    await store.setItem('owner/a', 'owner-a-value');
    expect(store.keyForOwner('owner/a')).toContain('owner%2Fa');

    const transition = await guard.beginTransition();
    transition.complete('owner-b');

    await expect(store.getItem('owner/a')).rejects.toMatchObject({
      code: 'owner_mismatch',
    });
    await expect(store.getItem('owner-b')).resolves.toBeNull();
    expect(fixture.storage.getItem).toHaveBeenCalledTimes(1);
  });

  it('fails closed while signed out and does not touch storage', async () => {
    const fixture = storageFixture();
    const guard = createOwnerStorageTransitionGuard(null);
    const store = createOwnerScopedLocalStore({
      storage: fixture.storage,
      baseKey: 'vitruvius.updates.v1',
      guard,
    });

    await expect(store.getItem('owner-a')).rejects.toBeInstanceOf(
      OwnerStorageBoundaryError,
    );
    await expect(store.setItem('owner-a', 'value')).rejects.toMatchObject({
      code: 'owner_mismatch',
    });
    expect(fixture.storage.getItem).not.toHaveBeenCalled();
    expect(fixture.storage.setItem).not.toHaveBeenCalled();
  });

  it('locks new operations immediately and waits for an existing operation to finish', async () => {
    const fixture = storageFixture();
    let releaseRead!: () => void;
    fixture.storage.getItem.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => {
        releaseRead = resolve;
      });
      return 'old-owner-value';
    });
    const guard = createOwnerStorageTransitionGuard('owner-a');
    const store = createOwnerScopedLocalStore({
      storage: fixture.storage,
      baseKey: 'vitruvius.schedule.v1',
      guard,
    });

    const pendingRead = store.getItem('owner-a');
    const pendingTransition = guard.beginTransition();
    await Promise.resolve();

    await expect(store.getItem('owner-a')).rejects.toMatchObject({
      code: 'auth_transition_in_progress',
    });
    expect(guard.snapshot().state).toBe('transitioning');

    releaseRead();
    await expect(pendingRead).resolves.toBe('old-owner-value');
    const transition = await pendingTransition;
    transition.complete('owner-b');
    expect(guard.snapshot()).toMatchObject({
      ownerId: 'owner-b',
      state: 'stable',
      activeOperations: 0,
    });
  });

  it('supports explicit retained-data consent without exposing it to a new owner', async () => {
    const fixture = storageFixture();
    const guard = createOwnerStorageTransitionGuard('owner-a');
    const store = createOwnerScopedLocalStore({
      storage: fixture.storage,
      baseKey: 'vitruvius.documents.v1',
      guard,
    });
    await store.setItem('owner-a', 'retained-owner-a-data');

    const transition = await guard.beginTransition();
    transition.complete('owner-b');
    await store.setItem('owner-b', 'owner-b-data');

    expect(fixture.values.get(store.keyForOwner('owner-a')))
      .toBe('retained-owner-a-data');
    expect(fixture.values.get(store.keyForOwner('owner-b')))
      .toBe('owner-b-data');
  });
});
