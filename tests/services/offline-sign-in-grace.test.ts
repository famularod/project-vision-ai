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
// Phone storage, where the latest time seen is kept (A1 pass 2 #5).
const mockPhone = new Map<string, string>();
let mockPhoneReadFails = false;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockPhoneReadFails) throw new Error('storage unavailable');
      return mockPhone.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => { mockPhone.set(key, value); },
    removeItem: async (key: string) => { mockPhone.delete(key); },
  },
}));

import {
  clearLatestTimeSeen,
  noteLatestTimeSeen,
  OFFLINE_LOOKUP_TIMEOUT_MS,
  OFFLINE_SIGN_IN_GRACE_MS,
  OFFLINE_SIGN_IN_GRACE_RECHECK_MS,
  OFFLINE_SIGN_IN_REFUSAL_MESSAGES,
  offlineSignInGraceAllows,
  offlineSignInGraceRefusal,
  readLatestTimeSeen,
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

describe('whole-app audit A1 pass 2 (30 Sep 2026)', () => {
  const DAY = 24 * 60 * MINUTE;
  const TIME_SEEN = '@vitruvius/offline-sign-in/latest-time-seen/v1/owner-a';
  beforeEach(() => {
    mockPhone.clear();
    mockPhoneReadFails = false;
    mockReadSavedSignIn.mockReset();
    mockAwaitSavedSignInRefresh.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('#3 each refused offline opening has its reason, and each reason its plain message', () => {
    const refusal = (input: Partial<Parameters<typeof offlineSignInGraceRefusal>[0]>) =>
      offlineSignInGraceRefusal({ saved: saved('owner-a', 3_600_000), workspaceOwnerId: 'owner-a', nowMs: NOW, ...input });
    expect(refusal({})).toBeNull();
    expect(refusal({ saved: saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS + 1) })).toBe('expired');
    expect(refusal({ saved: saved('owner-b', MINUTE) })).toBe('other_account');
    expect(refusal({ saved: saved('owner-a', -6 * MINUTE) })).toBe('clock');
    expect(refusal({ saved: null })).toBe('unconfirmed');
    expect(refusal({ workspaceOwnerId: null })).toBe('unconfirmed');
    expect(OFFLINE_SIGN_IN_REFUSAL_MESSAGES).toEqual({
      expired: 'No signal, and your sign-in has not refreshed for 7 days. Your work is saved on this phone. Connect to the internet, then tap Retry.',
      other_account: 'No signal, and this phone was last used with a different account. Connect to the internet, then tap Retry.',
      clock: 'The phone\'s clock looks wrong. Check Date & Time, then tap Retry.',
      unconfirmed: 'No signal, and Vitruvius could not confirm your sign-in on this phone. Connect to the internet, then tap Retry.',
    });
  });

  it('#3 the startup lookup says why it refused with no signal, and nothing when the refresh was not a network failure', async () => {
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'network_unavailable' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 8 * DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW)).resolves.toEqual({ refused: 'expired' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-b', MINUTE));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW)).resolves.toEqual({ refused: 'other_account' });
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'rejected' });
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW)).resolves.toBeNull();
    expect(mockPhone.size).toBe(0);
  });

  it('#5 the 7 days are no longer stretched by setting the clock back: the latest time seen is kept and checked', async () => {
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'network_unavailable' });
    // Token issued at NOW; opened offline six days later.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 0));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + 6 * DAY))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true });
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW + 6 * DAY));
    // The clock set back five days: the token alone looks a day old.
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', -DAY), workspaceOwnerId: 'owner-a', nowMs: NOW + DAY })).toBe(true);
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + DAY))
      .resolves.toEqual({ refused: 'clock' });
    // Ordinary drift (under 5 minutes) is not refused, and never lowers the mark.
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + 6 * DAY - 4 * MINUTE))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true });
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW + 6 * DAY));
  });

  it('#5 the mark is per account, cleared by a refresh, and a mark that cannot be read refuses nothing', async () => {
    await noteLatestTimeSeen('owner-a', NOW + 3 * DAY);
    expect(await readLatestTimeSeen('owner-a')).toBe(NOW + 3 * DAY);
    expect(await readLatestTimeSeen('owner-b')).toBeNull();
    await clearLatestTimeSeen('owner-a');
    expect(await readLatestTimeSeen('owner-a')).toBeNull();

    await noteLatestTimeSeen('owner-a', NOW + 3 * DAY);
    mockPhoneReadFails = true;
    expect(await readLatestTimeSeen('owner-a')).toBeNull();
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'network_unavailable' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 14 * 3_600_000));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true });
  });

  it('#5 while open offline, each passing check keeps the time, and a clock set back locks with its reason', async () => {
    jest.useFakeTimers();
    let now = NOW;
    mockReadSavedSignIn.mockImplementation(async () => saved('owner-a', 14 * 3_600_000));
    const onExpired = jest.fn();
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => now, appState: { addEventListener: () => undefined } });
    now = NOW + 30 * MINUTE;
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW + 30 * MINUTE));
    expect(onExpired).not.toHaveBeenCalled();
    // Back two hours: still within 7 days of the token, but before a time seen.
    now = NOW - 2 * 60 * MINUTE + 30 * MINUTE;
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).toHaveBeenCalledWith('clock');

    const expired = jest.fn();
    mockReadSavedSignIn.mockImplementation(async () => saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS + MINUTE));
    now = NOW + 60 * MINUTE;
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired: expired, now: () => now, appState: { addEventListener: () => undefined } });
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(expired).toHaveBeenCalledWith('expired');
  });
});
