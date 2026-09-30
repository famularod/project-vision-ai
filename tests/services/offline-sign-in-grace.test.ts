/**
 * Owner answer Q13 (30 Sep 2026): the offline opening is for the account
 * whose sign-in is saved on this phone, and only when that account's
 * workspace is the one on the phone, for up to 7 days since the token last
 * refreshed. (The end-to-end cases, with the real sign-in library, are in
 * tests/app-offline-sign-in.test.tsx.)
 */
const mockReadSavedSignIn = jest.fn();
const mockAwaitSavedSignInRefresh = jest.fn();
jest.mock('../../services/SupabaseService', () => ({
  readSavedSignIn: (...args: unknown[]) => mockReadSavedSignIn(...args),
  awaitSavedSignInRefresh: (...args: unknown[]) => mockAwaitSavedSignInRefresh(...args),
}));

import {
  OFFLINE_LOOKUP_TIMEOUT_MS,
  OFFLINE_SIGN_IN_GRACE_MS,
  OFFLINE_SIGN_IN_GRACE_RECHECK_MS,
  offlineSignInGraceAllows,
  watchOfflineSignInGrace,
  workspaceOwnerAfterFailedLookup,
} from '../../services/OfflineSignInGrace';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const MINUTE = 60_000;
const saved = (ownerId: string, refreshedMsAgo: number) => ({
  ownerId,
  lastRefreshedAtMs: NOW - refreshedMsAgo,
  expiresAtMs: NOW - refreshedMsAgo + 3_600_000,
});

describe('offline sign-in grace (owner answer Q13)', () => {
  it('allows the saved account\'s own workspace up to exactly 7 days after the last refresh', () => {
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', 2 * 3_600_000), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(true);
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(true);
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS + 1), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(false);
  });

  it('never opens another account, or any account when the phone is signed out', () => {
    expect(offlineSignInGraceAllows({ saved: saved('owner-b', 3_600_000), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(false);
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', 3_600_000), workspaceOwnerId: null, nowMs: NOW })).toBe(false);
    expect(offlineSignInGraceAllows({ saved: null, workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(false);
  });

  it('a clock set back (a token issued in the phone\'s future) is refused beyond 5 minutes of drift (auth security review)', () => {
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', -4 * MINUTE), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(true);
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', -6 * MINUTE), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(false);
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', -30 * 24 * 60 * MINUTE), workspaceOwnerId: 'owner-a', nowMs: NOW })).toBe(false);
  });
});

describe('auth security review (30 Sep 2026)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReadSavedSignIn.mockReset();
    mockAwaitSavedSignInRefresh.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a refresh that never answers (captive portal) is decided from the saved sign-in after 8 seconds', async () => {
    mockAwaitSavedSignInRefresh.mockReturnValue(new Promise(() => undefined));
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 14 * 3_600_000));
    let outcome: unknown = 'still waiting';
    void workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW).then(value => { outcome = value; });

    await jest.advanceTimersByTimeAsync(OFFLINE_LOOKUP_TIMEOUT_MS - 1);
    expect(outcome).toBe('still waiting');
    await jest.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ ownerId: 'owner-a', signInPending: true });
    expect(OFFLINE_LOOKUP_TIMEOUT_MS).toBe(8_000);
  });

  function fakeAppState() {
    const listeners = new Set<(state: string) => void>();
    return {
      listeners,
      appState: {
        addEventListener: (_type: 'change', listener: (state: string) => void) => {
          listeners.add(listener);
          return { remove: () => { listeners.delete(listener); } };
        },
      },
      emit: (state: string) => [...listeners].forEach(listener => listener(state)),
    };
  }

  it('the 7 days are checked again every minute while the workspace is open offline', async () => {
    let now = NOW;
    // 90 seconds short of 7 days at NOW.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS - 90_000));
    const { appState, listeners } = fakeAppState();
    const onExpired = jest.fn();
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => now, appState });

    now += MINUTE;
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).not.toHaveBeenCalled();
    now += MINUTE;
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).toHaveBeenCalledTimes(1);
    // Expired once: it stops watching.
    await jest.advanceTimersByTimeAsync(5 * OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('the 7 days are checked again when the app returns to the foreground, not in the background', async () => {
    let refreshedMsAgo = OFFLINE_SIGN_IN_GRACE_MS - MINUTE;
    mockReadSavedSignIn.mockImplementation(async () => saved('owner-a', refreshedMsAgo));
    const { appState, emit } = fakeAppState();
    const onExpired = jest.fn();
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => NOW, appState, recheckMs: 24 * 60 * MINUTE });

    emit('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(onExpired).not.toHaveBeenCalled();
    // Two days in a drawer: the saved sign-in is now older than 7 days.
    refreshedMsAgo = OFFLINE_SIGN_IN_GRACE_MS + 2 * 24 * 60 * MINUTE;
    const reads = mockReadSavedSignIn.mock.calls.length;
    emit('background');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockReadSavedSignIn.mock.calls.length).toBe(reads);
    emit('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('a sign-in removed or switched meanwhile ends the offline opening; stopping ends the watch', async () => {
    const { appState, emit, listeners } = fakeAppState();
    const onExpired = jest.fn();
    mockReadSavedSignIn.mockResolvedValue(saved('owner-b', MINUTE));
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => NOW, appState });
    emit('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(onExpired).toHaveBeenCalledTimes(1);

    const later = jest.fn();
    mockReadSavedSignIn.mockResolvedValue(null);
    const stop = watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired: later, now: () => NOW, appState });
    stop();
    emit('active');
    await jest.advanceTimersByTimeAsync(10 * OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(later).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
