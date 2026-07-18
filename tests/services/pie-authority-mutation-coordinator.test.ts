import {
  authorityMutationScopeKey,
  runExclusivePIEAuthorityMutation,
} from '../../services/PIEAuthorityMutationCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('PIE authority mutation coordinator', () => {
  it('serializes same-scope builds in invocation order', async () => {
    const firstGate = deferred<void>();
    const firstStarted = deferred<void>();
    const events: string[] = [];
    const first = runExclusivePIEAuthorityMutation('org', 'project', async () => {
      events.push('first-start');
      firstStarted.resolve();
      await firstGate.promise;
      events.push('first-persist');
      return 'first';
    });
    const second = runExclusivePIEAuthorityMutation('org', 'project', async () => {
      events.push('second-start');
      events.push('second-persist');
      return 'second';
    });

    await firstStarted.promise;
    expect(events).toEqual(['first-start']);
    firstGate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(events).toEqual([
      'first-start',
      'first-persist',
      'second-start',
      'second-persist',
    ]);
  });

  it('allows different scopes to progress independently', async () => {
    const gate = deferred<void>();
    const firstStarted = deferred<void>();
    const events: string[] = [];
    const first = runExclusivePIEAuthorityMutation('org', 'project-a', async () => {
      events.push('a-start');
      firstStarted.resolve();
      await gate.promise;
    });
    const second = runExclusivePIEAuthorityMutation('org', 'project-b', async () => {
      events.push('b-start');
    });

    await Promise.all([firstStarted.promise, second]);
    expect(events).toEqual(['a-start', 'b-start']);
    gate.resolve();
    await first;
  });

  it('releases a scope after a failed build', async () => {
    await expect(runExclusivePIEAuthorityMutation('org', 'project', async () => {
      throw new Error('persistence failed');
    })).rejects.toThrow('persistence failed');
    await expect(runExclusivePIEAuthorityMutation('org', 'project', async () => 'next'))
      .resolves.toBe('next');
  });

  it('uses an unambiguous scope key and rejects missing identity', () => {
    expect(authorityMutationScopeKey('a:b', 'c')).not.toBe(
      authorityMutationScopeKey('a', 'b:c'),
    );
    expect(() => authorityMutationScopeKey('', 'project')).toThrow();
  });
});
