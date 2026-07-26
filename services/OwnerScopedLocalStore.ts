export type OwnerScopedStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}>;

export type OwnerStorageTransitionCompletion = Readonly<{
  complete: (nextOwnerId: string | null) => void;
}>;

export type OwnerStorageTransitionGuard = Readonly<{
  runForOwner<TResult>(
    expectedOwnerId: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult>;
  beginTransition(): Promise<OwnerStorageTransitionCompletion>;
  snapshot(): Readonly<{
    ownerId: string | null;
    state: 'stable' | 'transitioning';
    activeOperations: number;
    generation: number;
  }>;
}>;

export type OwnerScopedLocalStore = Readonly<{
  getItem: (ownerId: string) => Promise<string | null>;
  setItem: (ownerId: string, value: string) => Promise<void>;
  removeItem: (ownerId: string) => Promise<void>;
  keyForOwner: (ownerId: string) => string;
}>;

export class OwnerStorageBoundaryError extends Error {
  readonly code:
    | 'owner_required'
    | 'owner_mismatch'
    | 'auth_transition_in_progress'
    | 'transition_already_in_progress'
    | 'transition_already_completed';

  constructor(code: OwnerStorageBoundaryError['code'], message: string) {
    super(message);
    this.name = 'OwnerStorageBoundaryError';
    this.code = code;
  }
}

/**
 * Coordinates local-store access with an auth transition without changing the
 * authentication/session implementation. Auth wiring calls beginTransition()
 * before a sign-out/account switch and completes the returned token only after
 * the next stable owner (or signed-out null) is known.
 */
export function createOwnerStorageTransitionGuard(
  initialOwnerId: string | null,
): OwnerStorageTransitionGuard {
  let ownerId = normalizeOptionalOwner(initialOwnerId);
  let state: 'stable' | 'transitioning' = 'stable';
  let activeOperations = 0;
  let generation = 0;
  const idleWaiters = new Set<() => void>();

  async function runForOwner<TResult>(
    expectedOwnerId: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const expected = requireOwner(expectedOwnerId);
    if (state === 'transitioning') {
      throw new OwnerStorageBoundaryError(
        'auth_transition_in_progress',
        'Owner-scoped local storage is locked during the account transition.',
      );
    }
    if (!ownerId || ownerId !== expected) {
      throw new OwnerStorageBoundaryError(
        'owner_mismatch',
        'Owner-scoped local storage rejected an account mismatch.',
      );
    }

    activeOperations += 1;
    try {
      return await operation();
    } finally {
      activeOperations -= 1;
      if (activeOperations === 0) {
        for (const resolve of idleWaiters) resolve();
        idleWaiters.clear();
      }
    }
  }

  async function beginTransition(): Promise<OwnerStorageTransitionCompletion> {
    if (state === 'transitioning') {
      throw new OwnerStorageBoundaryError(
        'transition_already_in_progress',
        'An owner-storage transition is already in progress.',
      );
    }
    state = 'transitioning';
    ownerId = null;
    generation += 1;
    if (activeOperations > 0) {
      await new Promise<void>(resolve => idleWaiters.add(resolve));
    }

    let completed = false;
    return Object.freeze({
      complete(nextOwnerId: string | null) {
        if (completed) {
          throw new OwnerStorageBoundaryError(
            'transition_already_completed',
            'This owner-storage transition was already completed.',
          );
        }
        completed = true;
        ownerId = normalizeOptionalOwner(nextOwnerId);
        state = 'stable';
        generation += 1;
      },
    });
  }

  return Object.freeze({
    runForOwner,
    beginTransition,
    snapshot: () => Object.freeze({
      ownerId,
      state,
      activeOperations,
      generation,
    }),
  });
}

export function createOwnerScopedLocalStore({
  storage,
  baseKey,
  guard,
}: Readonly<{
  storage: OwnerScopedStorage;
  baseKey: string;
  guard: OwnerStorageTransitionGuard;
}>): OwnerScopedLocalStore {
  const normalizedBaseKey = requireBaseKey(baseKey);
  const keyForOwner = (ownerId: string) =>
    `${normalizedBaseKey}.owner.${encodeURIComponent(requireOwner(ownerId))}`;

  return Object.freeze({
    keyForOwner,
    getItem: ownerId => guard.runForOwner(ownerId, () =>
      storage.getItem(keyForOwner(ownerId))),
    setItem: (ownerId, value) => guard.runForOwner(ownerId, () =>
      storage.setItem(keyForOwner(ownerId), value)),
    removeItem: ownerId => guard.runForOwner(ownerId, () =>
      storage.removeItem(keyForOwner(ownerId))),
  });
}

function requireOwner(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.includes('\0')) {
    throw new OwnerStorageBoundaryError(
      'owner_required',
      'A verified owner identity is required for local storage.',
    );
  }
  return normalized;
}

function normalizeOptionalOwner(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireOwner(value);
}

function requireBaseKey(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)) {
    throw new Error('A canonical local-storage base key is required.');
  }
  return normalized;
}
