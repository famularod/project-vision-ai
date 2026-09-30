/**
 * Owner answer Q13 (30 Sep 2026): the offline opening is for the account
 * whose sign-in is saved on this phone, and only when that account's
 * workspace is the one on the phone, for up to 7 days since the token last
 * refreshed. (The end-to-end cases, with the real sign-in library, are in
 * tests/app-offline-sign-in.test.tsx.)
 */
jest.mock('../../services/SupabaseService', () => ({}));

import {
  OFFLINE_SIGN_IN_GRACE_MS,
  offlineSignInGraceAllows,
} from '../../services/OfflineSignInGrace';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
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
});
