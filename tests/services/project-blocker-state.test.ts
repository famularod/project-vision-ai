import {
  daveConfirmedBlockerReason,
  davePhotoBlockerId,
  daveUpdateBlockerId,
  findCurrentDAVEConfirmedBlocker,
  updateHasOpenDAVEBlocker,
  updateHasOpenDAVEIssue,
  updateHasOpenDAVESafetyConcern,
} from '../../services/DAVEProjectBlockerState';

function update(overrides: Record<string, unknown> = {}) {
  return {
    id: String(overrides.id || 'update-1'),
    projectName: '2375 Compliance Project',
    date: String(overrides.date || '2026-07-17T12:00:00.000Z'),
    notes: '',
    selectedAreaName: 'Canopy A',
    photos: [],
    ...overrides,
  };
}

function blockerEvent({
  blockerId,
  action,
  blockerType = 'blocker',
  projectName = '2375 Compliance Project',
  areaName = 'Canopy A',
  occurredAt,
}: {
  blockerId: string;
  action: 'opened' | 'resolved' | 'reopened';
  blockerType?: 'blocker' | 'safety';
  projectName?: string;
  areaName?: string | null;
  occurredAt?: string;
}) {
  return {
    blockerId,
    blockerType,
    action,
    projectName,
    areaName,
    occurredAt,
  };
}

describe('current project blocker state', () => {
  it('treats an open photo-level safety concern as confirmed Blocked evidence', () => {
    const safety = update({
      photos: [{
        id: 'safety-photo-1',
        category: 'Safety Concern',
        actionStatus: 'Open',
        selectedAreaName: 'Canopy A',
      }],
    });

    expect(findCurrentDAVEConfirmedBlocker([safety])).toBe(safety);
    expect(updateHasOpenDAVESafetyConcern(safety)).toBe(true);
    expect(daveConfirmedBlockerReason(safety)).toContain('safety concern');
  });

  it.each([
    'The blocker remains unresolved.',
    'The blocker is not resolved.',
  ])('keeps explicit unresolved blocker language open: %s', notes => {
    const blocker = update({ blockerFlag: true, notes });

    expect(findCurrentDAVEConfirmedBlocker([blocker])).toBe(blocker);
    expect(updateHasOpenDAVEBlocker(blocker)).toBe(true);
  });

  it('does not create a blocker from the negated phrase no blocker', () => {
    const clearUpdate = update({ notes: 'No blocker was observed.' });

    expect(findCurrentDAVEConfirmedBlocker([clearUpdate])).toBeNull();
    expect(updateHasOpenDAVEBlocker(clearUpdate)).toBe(false);
  });

  it('does not keep a closed photo issue or safety concern open', () => {
    const closed = update({
      photos: [
        {
          id: 'closed-issue-photo',
          category: 'Open Issue',
          actionStatus: 'Closed',
          selectedAreaName: 'Canopy A',
        },
        {
          id: 'closed-safety-photo',
          category: 'Safety Concern',
          actionStatus: 'Closed',
          selectedAreaName: 'Canopy A',
        },
      ],
    });

    expect(findCurrentDAVEConfirmedBlocker([closed])).toBeNull();
    expect(updateHasOpenDAVEIssue(closed)).toBe(false);
    expect(updateHasOpenDAVEBlocker(closed)).toBe(false);
    expect(updateHasOpenDAVESafetyConcern(closed)).toBe(false);
  });

  it('uses typed current assertions only to resolve the blocker on that same evidence ID', () => {
    const resolvedBlocker = update({
      id: 'self-resolved-blocker',
      blockerFlag: true,
      notes: 'The blocker is resolved.',
    });
    const clearedSafety = update({
      id: 'self-resolved-safety',
      safetyFlag: true,
      notes: 'No safety issues were observed.',
    });

    expect(findCurrentDAVEConfirmedBlocker([resolvedBlocker])).toBeNull();
    expect(updateHasOpenDAVEBlocker(resolvedBlocker)).toBe(false);
    expect(findCurrentDAVEConfirmedBlocker([clearedSafety])).toBeNull();
    expect(updateHasOpenDAVESafetyConcern(clearedSafety)).toBe(false);
  });

  it('closes only an explicitly targeted blocker identity', () => {
    const blocker = update({
      id: 'old-blocker',
      date: '2026-07-16T12:00:00.000Z',
      blockerFlag: true,
    });
    const resolution = update({
      id: 'new-resolution',
      date: '2026-07-17T12:00:00.000Z',
      blockerEvents: [blockerEvent({
        blockerId: daveUpdateBlockerId('old-blocker'),
        action: 'resolved',
        occurredAt: '2026-07-17T12:00:00.000Z',
      })],
    });

    expect(findCurrentDAVEConfirmedBlocker([blocker, resolution])).toBeNull();
  });

  it('treats closing the same stable photo identity as an explicit close', () => {
    const opened = update({
      id: 'photo-open-snapshot',
      date: '2026-07-16T12:00:00.000Z',
      photos: [{
        id: 'stable-issue-photo',
        category: 'Open Issue',
        actionStatus: 'Open',
        selectedAreaName: 'Canopy A',
      }],
    });
    const closed = update({
      id: 'photo-closed-snapshot',
      date: '2026-07-17T12:00:00.000Z',
      photos: [{
        id: 'stable-issue-photo',
        category: 'Open Issue',
        actionStatus: 'Closed',
        selectedAreaName: 'Canopy A',
      }],
    });

    expect(findCurrentDAVEConfirmedBlocker([opened, closed])).toBeNull();
  });

  it.each([
    'The blocker was resolved.',
    'No blocker remains.',
  ])('does not let untargeted resolution language clear an older blocker: %s', notes => {
    const blocker = update({
      id: 'target-required',
      date: '2026-07-16T12:00:00.000Z',
      blockerFlag: true,
    });
    const untargetedNote = update({
      id: 'untargeted-note',
      date: '2026-07-17T12:00:00.000Z',
      notes,
    });

    expect(findCurrentDAVEConfirmedBlocker([blocker, untargetedNote])).toBe(blocker);
  });

  it('does not let unrelated same-area closed issue text clear a blocker', () => {
    const blocker = update({
      id: 'active-blocker',
      date: '2026-07-16T12:00:00.000Z',
      blockerFlag: true,
    });
    const unrelatedResolution = update({
      id: 'unrelated-resolution',
      date: '2026-07-17T12:00:00.000Z',
      notes: 'The concrete delivery issue was resolved.',
      selectedAreaName: 'Canopy A',
    });

    expect(findCurrentDAVEConfirmedBlocker([blocker, unrelatedResolution])).toBe(blocker);
  });

  it('does not let a different closed photo clear an open issue in the same area', () => {
    const openIssue = update({
      id: 'open-issue-update',
      date: '2026-07-16T12:00:00.000Z',
      photos: [{
        id: 'issue-photo-a',
        category: 'Open Issue',
        actionStatus: 'Open',
        selectedAreaName: 'Canopy A',
      }],
    });
    const differentClosedIssue = update({
      id: 'closed-issue-update',
      date: '2026-07-17T12:00:00.000Z',
      photos: [{
        id: 'issue-photo-b',
        category: 'Open Issue',
        actionStatus: 'Closed',
        selectedAreaName: 'Canopy A',
      }],
    });

    expect(findCurrentDAVEConfirmedBlocker([openIssue, differentClosedIssue])).toBe(openIssue);
  });

  it('does not let a closed issue clear a separate safety concern in the same area', () => {
    const safetyConcern = update({
      id: 'open-safety',
      date: '2026-07-16T12:00:00.000Z',
      safetyFlag: true,
    });
    const closedIssue = update({
      id: 'closed-issue',
      date: '2026-07-17T12:00:00.000Z',
      photos: [{
        id: 'closed-issue-photo',
        category: 'Open Issue',
        actionStatus: 'Closed',
        selectedAreaName: 'Canopy A',
      }],
    });

    expect(findCurrentDAVEConfirmedBlocker([safetyConcern, closedIssue])).toBe(safetyConcern);
  });

  it.each([
    ['different project', '2321 Compliance Project', 'Canopy A', 'blocker'],
    ['different area', '2375 Compliance Project', 'Canopy B', 'blocker'],
    ['different type', '2375 Compliance Project', 'Canopy A', 'safety'],
  ] as const)(
    'requires matching ID, type, project, and area for a close: %s',
    (_label, projectName, areaName, blockerType) => {
      const blocker = update({
        id: 'scoped-blocker',
        date: '2026-07-16T12:00:00.000Z',
        blockerFlag: true,
      });
      const wrongScopeClose = update({
        id: 'wrong-scope-close',
        date: '2026-07-17T12:00:00.000Z',
        blockerEvents: [blockerEvent({
          blockerId: daveUpdateBlockerId('scoped-blocker'),
          action: 'resolved',
          blockerType,
          projectName,
          areaName,
        })],
      });

      expect(findCurrentDAVEConfirmedBlocker([blocker, wrongScopeClose])).toBe(blocker);
    },
  );

  it('reopens the same stable blocker after an explicit resolution', () => {
    const blockerId = daveUpdateBlockerId('reopenable-blocker');
    const opened = update({
      id: 'reopenable-blocker',
      date: '2026-07-15T12:00:00.000Z',
      blockerFlag: true,
    });
    const resolved = update({
      id: 'resolve-event',
      date: '2026-07-16T12:00:00.000Z',
      blockerEvents: [blockerEvent({
        blockerId,
        action: 'resolved',
      })],
    });
    const reopened = update({
      id: 'reopen-event',
      date: '2026-07-17T12:00:00.000Z',
      blockerEvents: [blockerEvent({
        blockerId,
        action: 'reopened',
      })],
    });

    expect(findCurrentDAVEConfirmedBlocker([opened, resolved])).toBeNull();
    expect(findCurrentDAVEConfirmedBlocker([opened, resolved, reopened])).toBe(reopened);
    expect(updateHasOpenDAVEBlocker(reopened)).toBe(true);
  });

  it('replays the complete resolution history instead of reviving an old event', () => {
    const blockerId = davePhotoBlockerId('history-photo');
    const opened = update({
      id: 'history-open',
      date: '2026-07-14T12:00:00.000Z',
      photos: [{
        id: 'history-photo',
        category: 'Open Issue',
        actionStatus: 'Open',
        selectedAreaName: 'Canopy A',
      }],
    });
    const resolved = update({
      id: 'history-resolved',
      date: '2026-07-15T12:00:00.000Z',
      blockerEvents: [blockerEvent({ blockerId, action: 'resolved' })],
    });
    const reopened = update({
      id: 'history-reopened',
      date: '2026-07-16T12:00:00.000Z',
      blockerEvents: [blockerEvent({ blockerId, action: 'reopened' })],
    });
    const resolvedAgain = update({
      id: 'history-resolved-again',
      date: '2026-07-17T12:00:00.000Z',
      blockerEvents: [blockerEvent({ blockerId, action: 'resolved' })],
    });

    expect(findCurrentDAVEConfirmedBlocker([
      opened,
      resolved,
      reopened,
      resolvedAgain,
    ])).toBeNull();
  });
});
