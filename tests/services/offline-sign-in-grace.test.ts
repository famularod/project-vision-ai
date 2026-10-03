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
  offlineSignInRefusalMessage,
  readLatestTimeSeen,
  savedSignInClockSetBack,
  SIGN_IN_SERVER_NOT_ANSWERING_MESSAGE,
  watchOfflineSignInGrace,
  workspaceOwnerAfterFailedLookup,
  workspaceOwnerWithClockSetBack,
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
    // Pin widened deliberately (A1 pass 3 L3): the launch read's last refresh
    // goes with the offline opening, for the re-check while open.
    expect(outcome).toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW - 14 * 3_600_000 });
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

  it('a saved sign-in that cannot be read for a moment keeps the workspace open (audit A2 pass 2 L1)', async () => {
    const { appState, emit } = fakeAppState();
    const onExpired = jest.fn();
    mockReadSavedSignIn.mockRejectedValue(new Error('User interaction is not allowed.'));
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => NOW, appState });
    emit('active');
    await jest.advanceTimersByTimeAsync(3 * OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).not.toHaveBeenCalled();

    // The Keychain answers again: the limit is decided as before.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 3_600_000));
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('a read error is decided from the last good read, and never outlasts 7 days from opening', async () => {
    let now = NOW;
    const { appState } = fakeAppState();
    const onExpired = jest.fn();
    // Last good read: 30 seconds short of 7 days.
    mockReadSavedSignIn.mockResolvedValueOnce(saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS - 30_000));
    mockReadSavedSignIn.mockRejectedValue(new Error('User interaction is not allowed.'));
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => now, appState });
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).not.toHaveBeenCalled();
    now += MINUTE;
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(onExpired).toHaveBeenCalledTimes(1);

    // Never read at all while open: closed once 7 days have passed since opening.
    now = NOW;
    const never = jest.fn();
    mockReadSavedSignIn.mockReset();
    mockReadSavedSignIn.mockRejectedValue(new Error('User interaction is not allowed.'));
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired: never, now: () => now, appState, recheckMs: 24 * 60 * MINUTE });
    now += OFFLINE_SIGN_IN_GRACE_MS - MINUTE;
    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(never).not.toHaveBeenCalled();
    now += 2 * MINUTE;
    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
    expect(never).toHaveBeenCalledTimes(1);
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
      // Pin changed deliberately (A1 pass 3 L2): it said "The phone's clock
      // looks wrong. Check Date & Time", also when the clock was right.
      clock: 'The phone\'s clock is earlier than a time this phone already saw. If the clock is right, connect to the internet, then tap Retry. If not, correct it in Date & Time, then tap Retry.',
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
    // (Pins here widened deliberately for A1 pass 3: the last refresh goes
    // with an opening (L3), and a clock refusal says the time seen (L2).)
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + 6 * DAY))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW });
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW + 6 * DAY));
    // The clock set back five days: the token alone looks a day old.
    expect(offlineSignInGraceAllows({ saved: saved('owner-a', -DAY), workspaceOwnerId: 'owner-a', nowMs: NOW + DAY })).toBe(true);
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + DAY))
      .resolves.toEqual({ refused: 'clock', seenAtMs: NOW + 6 * DAY });
    // Ordinary drift (under 5 minutes) is not refused, and never lowers the mark.
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW + 6 * DAY - 4 * MINUTE))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW });
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
    // Pin widened deliberately (A1 pass 3 L3).
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW - 14 * 3_600_000 });
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
    // Pin widened deliberately (A1 pass 3 L2): with the time seen, for the message.
    expect(onExpired).toHaveBeenCalledWith('clock', NOW + 30 * MINUTE);

    const expired = jest.fn();
    mockReadSavedSignIn.mockImplementation(async () => saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS + MINUTE));
    now = NOW + 60 * MINUTE;
    watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired: expired, now: () => now, appState: { addEventListener: () => undefined } });
    await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
    expect(expired).toHaveBeenCalledWith('expired');
  });
});

describe('whole-app audit A1 pass 3 (30 Sep 2026)', () => {
  const DAY = 24 * 60 * MINUTE;
  const HOUR = 60 * MINUTE;
  const TIME_SEEN = '@vitruvius/offline-sign-in/latest-time-seen/v1/owner-a';
  const noAppState = { addEventListener: () => undefined };
  beforeEach(() => {
    mockPhone.clear();
    mockPhoneReadFails = false;
    mockReadSavedSignIn.mockReset();
    mockAwaitSavedSignInRefresh.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('L1 once signal is back the lookup waits for the sign-in to finish, not 8 seconds; it says so meanwhile', async () => {
    jest.useFakeTimers();
    const onSignalBack = jest.fn();
    let finish: (value: unknown) => void = () => undefined;
    mockAwaitSavedSignInRefresh.mockImplementation((options?: { onSignalBack?: () => void; noAnswerMark?: number }) => {
      options?.onSignalBack?.();
      return new Promise(resolve => { finish = resolve; });
    });
    let outcome: unknown = 'still waiting';
    void workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW, OFFLINE_LOOKUP_TIMEOUT_MS, { noAnswerMark: 3, onSignalBack })
      .then(value => { outcome = value; });
    await jest.advanceTimersByTimeAsync(0);
    expect(onSignalBack).toHaveBeenCalledTimes(1);
    expect(mockAwaitSavedSignInRefresh.mock.calls[0][0]).toMatchObject({ noAnswerMark: 3 });

    // Before: after 8 seconds the lookup decided as if there were no signal.
    await jest.advanceTimersByTimeAsync(10 * OFFLINE_LOOKUP_TIMEOUT_MS);
    expect(outcome).toBe('still waiting');
    expect(mockReadSavedSignIn).not.toHaveBeenCalled();
    finish({ status: 'signed_in', ownerId: 'owner-a' });
    await jest.advanceTimersByTimeAsync(0);
    expect(outcome).toEqual({ ownerId: 'owner-a', signInPending: false });
  });

  it('L1 signal back after the 8 seconds ran out is not announced: the lookup has already answered', async () => {
    jest.useFakeTimers();
    const onSignalBack = jest.fn();
    let signalBack: () => void = () => undefined;
    mockAwaitSavedSignInRefresh.mockImplementation((options?: { onSignalBack?: () => void; stillWanted?: () => boolean }) => {
      signalBack = () => { if (options?.stillWanted?.() !== false) options?.onSignalBack?.(); };
      return new Promise(() => undefined);
    });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 14 * HOUR));
    let outcome: unknown = 'still waiting';
    void workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW, OFFLINE_LOOKUP_TIMEOUT_MS, { onSignalBack })
      .then(value => { outcome = value; });
    await jest.advanceTimersByTimeAsync(OFFLINE_LOOKUP_TIMEOUT_MS);
    expect(outcome).toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW - 14 * HOUR });
    signalBack();
    expect(onSignalBack).not.toHaveBeenCalled();
  });

  it('L2 a clock refusal says the time already seen, and what to do either way', () => {
    const seenAtMs = Date.parse('2026-10-03T14:05:00.000Z');
    const seenAt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(seenAtMs));
    expect(seenAt).toMatch(/^Oct \d, 2026, \d{1,2}:\d{2}\s[AP]M$/);
    expect(offlineSignInRefusalMessage('clock', seenAtMs)).toBe(
      `The phone's clock is earlier than a time this phone already saw on ${seenAt}. ` +
      'If the clock is right, connect to the internet, then tap Retry. If not, correct it in Date & Time, then tap Retry.',
    );
    // Without a time, and for the other reasons, the fixed wording.
    expect(offlineSignInRefusalMessage('clock')).toBe(OFFLINE_SIGN_IN_REFUSAL_MESSAGES.clock);
    expect(offlineSignInRefusalMessage('expired', seenAtMs)).toBe(OFFLINE_SIGN_IN_REFUSAL_MESSAGES.expired);
    expect(OFFLINE_SIGN_IN_REFUSAL_MESSAGES.clock).not.toMatch(/looks wrong/);
  });

  it('L2 a kept time more than 7 days and an hour after the last refresh is not trusted; one within it still refuses a clock set back', async () => {
    const refreshed = saved('owner-a', 14 * HOUR); // last refresh: NOW - 14 h
    const refusal = (latestTimeSeenMs: number, nowMs = NOW) =>
      offlineSignInGraceRefusal({ saved: refreshed, workspaceOwnerId: 'owner-a', nowMs, latestTimeSeenMs });
    const lastRefresh = refreshed.lastRefreshedAtMs;
    // Could not have been seen while open offline on this sign-in: ignored.
    expect(refusal(lastRefresh + OFFLINE_SIGN_IN_GRACE_MS + 2 * HOUR)).toBeNull();
    expect(refusal(NOW + 400 * DAY)).toBeNull();
    // Could have been (the 7 days, plus the hour's margin): the set-back check stands.
    expect(refusal(lastRefresh + OFFLINE_SIGN_IN_GRACE_MS)).toBe('clock');
    expect(refusal(lastRefresh + OFFLINE_SIGN_IN_GRACE_MS + 30 * MINUTE)).toBe('clock');
    expect(refusal(NOW + 3 * DAY)).toBe('clock');
    expect(refusal(NOW + 4 * MINUTE)).toBeNull();

    // Through the lookup: an untrustworthy mark does not refuse, and is
    // replaced by the time seen, so a clock set back after it still refuses.
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'network_unavailable' });
    mockReadSavedSignIn.mockResolvedValue(refreshed);
    mockPhone.set(TIME_SEEN, String(NOW + 30 * DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: lastRefresh });
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW - 2 * HOUR))
      .resolves.toEqual({ refused: 'clock', seenAtMs: NOW });
    // A trusted mark is never lowered.
    mockPhone.set(TIME_SEEN, String(NOW + 3 * DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ refused: 'clock', seenAtMs: NOW + 3 * DAY });
    expect(mockPhone.get(TIME_SEEN)).toBe(String(NOW + 3 * DAY));
  });

  it('L3 a saved sign-in never readable while open offline: closed 7 days after its last refresh, not after opening', async () => {
    jest.useFakeTimers();
    let now = NOW;
    mockReadSavedSignIn.mockRejectedValue(new Error('User interaction is not allowed.'));
    const onExpired = jest.fn();
    // The launch read: refreshed six days before this offline opening.
    watchOfflineSignInGrace({
      ownerId: 'owner-a', lastRefreshedAtMs: NOW - 6 * DAY, onExpired, now: () => now,
      appState: noAppState, recheckMs: DAY,
    });
    now += DAY - MINUTE;
    await jest.advanceTimersByTimeAsync(DAY);
    expect(onExpired).not.toHaveBeenCalled();
    now += 2 * MINUTE;
    await jest.advanceTimersByTimeAsync(DAY);
    // Before: open until 7 days after opening (13 days after the last refresh).
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledWith('expired');
  });

  it('L4 the re-check says why: a sign-in gone from the Keychain, another account\'s, or a clock before the last refresh', async () => {
    jest.useFakeTimers();
    const recheck = async (read: unknown) => {
      mockReadSavedSignIn.mockReset();
      mockReadSavedSignIn.mockResolvedValue(read);
      const onExpired = jest.fn();
      const stop = watchOfflineSignInGrace({ ownerId: 'owner-a', onExpired, now: () => NOW, appState: noAppState });
      await jest.advanceTimersByTimeAsync(OFFLINE_SIGN_IN_GRACE_RECHECK_MS);
      stop();
      return onExpired.mock.calls;
    };
    // Before: each of these closed the workspace with "has not refreshed for 7 days".
    expect(await recheck(null)).toEqual([['unconfirmed']]);
    expect(await recheck(saved('owner-b', MINUTE))).toEqual([['other_account']]);
    expect(await recheck(saved('owner-a', -DAY))).toEqual([['clock', NOW + DAY]]);
    expect(await recheck(saved('owner-a', OFFLINE_SIGN_IN_GRACE_MS + MINUTE))).toEqual([['expired']]);
    expect(await recheck(saved('owner-a', HOUR))).toEqual([]);
  });
});

describe('whole-app audit A1 pass 4 (30 Sep 2026)', () => {
  const DAY = 24 * 60 * MINUTE;
  const HOUR = 60 * MINUTE;
  const TIME_SEEN = '@vitruvius/offline-sign-in/latest-time-seen/v1/owner-a';
  beforeEach(() => {
    mockPhone.clear();
    mockPhoneReadFails = false;
    mockReadSavedSignIn.mockReset();
    mockAwaitSavedSignInRefresh.mockReset();
  });

  it('L2 the sign-in server answering 5xx: the 7 days still apply, and the lockout says the server, not "No signal"', async () => {
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'server_unavailable' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 14 * HOUR));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: true, lastRefreshedAtMs: NOW - 14 * HOUR });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 8 * DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ refused: 'server_not_answering' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-b', MINUTE));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ refused: 'server_not_answering' });
    // The clock's refusal keeps its own words.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', -DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW))
      .resolves.toEqual({ refused: 'clock', seenAtMs: NOW + DAY });
    expect(offlineSignInRefusalMessage('server_not_answering')).toBe(
      'The sign-in server isn\'t answering right now. Your work on this phone is kept. Try again in a few minutes.',
    );
    expect(SIGN_IN_SERVER_NOT_ANSWERING_MESSAGE).not.toMatch(/signal/i);
    // A real network failure still says "No signal".
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'network_unavailable' });
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 8 * DAY));
    await expect(workspaceOwnerAfterFailedLookup(async () => 'owner-a', () => NOW)).resolves.toEqual({ refused: 'expired' });
  });

  it('L3 a clock earlier than a trusted time already seen, or than the token\'s last refresh, is set back; a right clock never is', async () => {
    // A token refreshed 30 minutes ago, valid by the phone's clock.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 30 * MINUTE));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBeNull();
    // A time seen earlier than now (the clock is right): not set back.
    mockPhone.set(TIME_SEEN, String(NOW - HOUR));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBeNull();
    // Seen two days later than the clock says now: set back.
    mockPhone.set(TIME_SEEN, String(NOW + 2 * DAY));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBe(NOW + 2 * DAY);
    // Ordinary drift is allowed.
    mockPhone.set(TIME_SEEN, String(NOW + 4 * MINUTE));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBeNull();
    // A kept time beyond the trust cap after the last refresh is not trusted (A1 pass 3 L2).
    mockPhone.set(TIME_SEEN, String(NOW + 8 * DAY));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBeNull();
    // The sign-in cannot be read: the kept time, as it is.
    mockReadSavedSignIn.mockRejectedValue(new Error('User interaction is not allowed.'));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBe(NOW + 8 * DAY);
    // No kept time, and the clock before the token's own last refresh.
    mockPhone.clear();
    mockReadSavedSignIn.mockReset();
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', -DAY));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBe(NOW + DAY);
    // Another account's kept time says nothing about this one.
    mockReadSavedSignIn.mockResolvedValue(saved('owner-a', 30 * MINUTE));
    mockPhone.set('@vitruvius/offline-sign-in/latest-time-seen/v1/owner-b', String(NOW + 2 * DAY));
    await expect(savedSignInClockSetBack('owner-a', () => NOW)).resolves.toBeNull();
  });

  it('L3 with the clock set back the server decides: answered opens, refused signs out, no answer is the clock lockout', async () => {
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'signed_in', ownerId: 'owner-a' });
    await expect(workspaceOwnerWithClockSetBack(NOW + 2 * DAY, OFFLINE_LOOKUP_TIMEOUT_MS, { noAnswerMark: 2 }))
      .resolves.toEqual({ ownerId: 'owner-a', signInPending: false });
    // A real refresh, even of a token valid by the phone's clock.
    expect(mockAwaitSavedSignInRefresh.mock.calls[0][0]).toMatchObject({ askServer: true, noAnswerMark: 2 });
    mockAwaitSavedSignInRefresh.mockResolvedValue({ status: 'rejected' });
    await expect(workspaceOwnerWithClockSetBack(NOW + 2 * DAY)).resolves.toEqual({ ownerId: null, signInPending: false });
    for (const status of ['network_unavailable', 'server_unavailable', 'unreadable']) {
      mockAwaitSavedSignInRefresh.mockResolvedValue({ status });
      await expect(workspaceOwnerWithClockSetBack(NOW + 2 * DAY)).resolves.toEqual({ refused: 'clock', seenAtMs: NOW + 2 * DAY });
    }
  });
});
