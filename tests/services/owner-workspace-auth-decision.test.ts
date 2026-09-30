import {
  ownerWorkspaceAuthDecision,
  workspaceAccountChange,
} from '../../services/OwnerWorkspaceAuthDecision';

describe('owner workspace auth decision', () => {
  it('activates the signed-in owner namespace', () => {
    expect(ownerWorkspaceAuthDecision('SIGNED_IN', 'owner-1')).toEqual({
      action: 'activate',
      ownerId: 'owner-1',
    });
  });

  it('activates the signed-out namespace only for an explicit sign out', () => {
    expect(ownerWorkspaceAuthDecision('SIGNED_OUT', null)).toEqual({
      action: 'activate',
      ownerId: null,
    });
  });

  it.each(['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'])(
    'ignores transient null %s events',
    event => {
      expect(ownerWorkspaceAuthDecision(event, null)).toEqual({
        action: 'ignore',
      });
    },
  );

  // Owner answer Q13 (30 Sep 2026): what the open workspace keeps per account.
  it('a token refresh after an offline start\'s null INITIAL_SESSION is the same account', () => {
    expect(workspaceAccountChange(undefined, 'INITIAL_SESSION', null)).toBeNull();
    expect(workspaceAccountChange(undefined, 'TOKEN_REFRESHED', 'owner-1')).toEqual({
      userId: 'owner-1', firstEvent: true, accountChanged: false,
    });
    expect(workspaceAccountChange('owner-1', 'TOKEN_REFRESHED', 'owner-1')).toEqual({
      userId: 'owner-1', firstEvent: false, accountChanged: false,
    });
  });

  it('a sign-out, or another account after the first event, is an account change', () => {
    expect(workspaceAccountChange('owner-1', 'SIGNED_OUT', null)?.accountChanged).toBe(true);
    expect(workspaceAccountChange(undefined, 'SIGNED_OUT', null)?.accountChanged).toBe(true);
    expect(workspaceAccountChange('owner-1', 'SIGNED_IN', 'owner-2')?.accountChanged).toBe(true);
    expect(workspaceAccountChange(null, 'SIGNED_IN', 'owner-1')?.accountChanged).toBe(true);
  });
});
