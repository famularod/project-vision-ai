import {
  daveConfirmedBlockerReason,
  findCurrentDAVEConfirmedBlocker,
  updateHasOpenDAVEIssue,
  updateHasOpenDAVEBlocker,
  updateHasOpenDAVESafetyConcern,
} from '../../services/DAVEProjectBlockerState';

function update(overrides: Record<string, unknown> = {}) {
  return {
    id: String(overrides.id || 'update-1'),
    date: String(overrides.date || '2026-07-17T12:00:00.000Z'),
    notes: '',
    selectedAreaName: 'Canopy A',
    photos: [],
    ...overrides,
  };
}

describe('current project blocker state', () => {
  it('treats an open photo-level safety concern as confirmed Blocked evidence', () => {
    const safety = update({
      photos: [{
        category: 'Safety Concern',
        actionStatus: 'Open',
        selectedAreaName: 'Canopy A',
      }],
    });

    expect(findCurrentDAVEConfirmedBlocker([safety])).toBe(safety);
    expect(updateHasOpenDAVESafetyConcern(safety)).toBe(true);
    expect(daveConfirmedBlockerReason(safety)).toContain('safety concern');
  });

  it('does not keep a closed photo issue or safety concern open', () => {
    const closed = update({
      photos: [
        { category: 'Open Issue', actionStatus: 'Closed', selectedAreaName: 'Canopy A' },
        { category: 'Safety Concern', actionStatus: 'Closed', selectedAreaName: 'Canopy A' },
      ],
    });

    expect(findCurrentDAVEConfirmedBlocker([closed])).toBeNull();
    expect(updateHasOpenDAVEIssue(closed)).toBe(false);
    expect(updateHasOpenDAVEBlocker({ ...closed, blockerFlag: true })).toBe(false);
    expect(updateHasOpenDAVESafetyConcern(closed)).toBe(false);
    expect(findCurrentDAVEConfirmedBlocker([{
      ...closed,
      blockerFlag: true,
      safetyFlag: true,
    }])).toBeNull();
  });

  it('lets a newer explicit resolution clear an older blocker in the same area', () => {
    const blocker = update({
      id: 'old-blocker',
      date: '2026-07-16T12:00:00.000Z',
      blockerFlag: true,
    });
    const resolution = update({
      id: 'new-resolution',
      date: '2026-07-17T12:00:00.000Z',
      notes: 'The blocker was resolved and work resumed.',
    });

    expect(findCurrentDAVEConfirmedBlocker([blocker, resolution])).toBeNull();
  });

  it('does not let a resolution in another area clear an active blocker', () => {
    const blocker = update({
      id: 'canopy-a-blocker',
      date: '2026-07-16T12:00:00.000Z',
      blockerFlag: true,
      selectedAreaName: 'Canopy A',
    });
    const otherAreaResolution = update({
      id: 'canopy-b-resolution',
      date: '2026-07-17T12:00:00.000Z',
      notes: 'The blocker was resolved.',
      selectedAreaName: 'Canopy B',
    });

    expect(findCurrentDAVEConfirmedBlocker([blocker, otherAreaResolution])).toBe(blocker);
  });
});
