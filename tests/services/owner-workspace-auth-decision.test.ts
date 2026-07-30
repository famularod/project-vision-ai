import { ownerWorkspaceAuthDecision } from '../../services/OwnerWorkspaceAuthDecision';

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
});
