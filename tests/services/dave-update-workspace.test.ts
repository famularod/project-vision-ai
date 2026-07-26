import {
  buildDAVEUpdatePhotoComparison,
  filterDAVEUpdateWorkspace,
  resolveUpdateWorkspaceUpdate,
  updateWorkspaceProjectOptions,
  type DAVEUpdateWorkspaceRecord,
} from '../../services/DAVEUpdateWorkspace';

type TestUpdate = DAVEUpdateWorkspaceRecord & {
  lifecycle: string;
  pieStatus: string | null;
  needsAction: boolean;
};

const baseUpdate: TestUpdate = {
  id: 'update-current',
  projectName: 'Project A',
  date: '2026-07-19T12:00:00.000Z',
  selectedAreaId: 'area-a',
  selectedAreaName: 'Canopy A',
  recipients: { contactIds: ['contact-a'] },
  photos: [],
  lifecycle: 'sent',
  pieStatus: 'Complete',
  needsAction: false,
};

describe('DAVE update workspace', () => {
  it('filters project truth, activity state, search, and recency without mutating input', () => {
    const updates: TestUpdate[] = [
      baseUpdate,
      {
        ...baseUpdate,
        id: 'update-b',
        projectName: 'Project B',
        date: '2026-07-18T12:00:00.000Z',
        lifecycle: 'draft',
        needsAction: true,
      },
    ];

    const filtered = filterDAVEUpdateWorkspace({
      updates,
      activeTab: 'Needs Action',
      filters: {
        project: ' project b ',
        areaId: null,
        pieStatus: null,
        lifecycleStatus: null,
        withinDays: null,
      },
      searchText: 'superintendent',
      contactNameForId: id => id === 'contact-a' ? 'Site Superintendent' : '',
      lifecycleForUpdate: update => update.lifecycle,
      pieStatusForUpdate: update => update.pieStatus,
      updateNeedsAction: update => update.needsAction,
      withinDaysMatches: () => true,
      updateTime: update => new Date(update.date).getTime(),
    });

    expect(filtered.map(update => update.id)).toEqual(['update-b']);
    expect(updates.map(update => update.id)).toEqual(['update-current', 'update-b']);
  });

  it('builds stable project choices and preserves valid update selection', () => {
    const updateB = { ...baseUpdate, id: 'update-b', projectName: 'Project B' };

    expect(updateWorkspaceProjectOptions(
      ['Project B', 'Project A', ' project a '],
      [{ ...baseUpdate, projectName: 'Project C' }],
    )).toEqual(['Project A', 'Project B', 'Project C']);
    expect(resolveUpdateWorkspaceUpdate([baseUpdate, updateB], 'update-b')?.id)
      .toBe('update-b');
    expect(resolveUpdateWorkspaceUpdate([baseUpdate, updateB], 'missing')?.id)
      .toBe('update-current');
    expect(resolveUpdateWorkspaceUpdate([], 'update-b')).toBeNull();
  });

  it('builds comparison only from the exact prior photo recorded by analysis', () => {
    const prior: TestUpdate = {
      ...baseUpdate,
      id: 'update-prior',
      date: '2026-07-10T12:00:00.000Z',
      photos: [{ id: 'photo-prior', uri: 'file:///prior.jpg' }],
    };
    const current: TestUpdate = {
      ...baseUpdate,
      photos: [{
        id: 'photo-current',
        uri: 'file:///current.jpg',
        photoIntelligence: {
          summary: 'Wall panels now cover the east elevation.',
          comparisonConfidence: 'High',
          comparability: 'Comparable',
          diagnostics: { selectedPriorPhotoId: 'photo-prior' },
        },
      }],
    };

    expect(buildDAVEUpdatePhotoComparison(current, [prior, current])).toMatchObject({
      currentPhotoId: 'photo-current',
      currentPhotoUri: 'file:///current.jpg',
      priorPhotoId: 'photo-prior',
      priorPhotoUri: 'file:///prior.jpg',
      summary: 'Wall panels now cover the east elevation.',
      comparisonConfidence: 'High',
      comparability: 'Comparable',
    });

    const unmatched = {
      ...current,
      photos: [{
        ...current.photos[0],
        photoIntelligence: {
          ...current.photos[0].photoIntelligence,
          diagnostics: { selectedPriorPhotoId: 'missing-photo' },
        },
      }],
    };
    expect(buildDAVEUpdatePhotoComparison(unmatched, [prior, unmatched])).toBeNull();
  });
});
