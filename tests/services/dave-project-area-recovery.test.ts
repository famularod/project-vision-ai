import {
  mergeDAVEProjectAreaRecord,
  mergeDAVEProjectAreaRecoveryRecords,
} from '../../services/DAVEProjectAreaRecovery';
import type { ProjectArea } from '../../types';

function area(overrides: Partial<ProjectArea> = {}): ProjectArea {
  return {
    id: 'area-1',
    name: 'Canopy A',
    latitude: 37.33,
    longitude: -122,
    radiusFeet: 250,
    locationCapturedAt: null,
    ...overrides,
  };
}

describe('DAVE project area recovery', () => {
  it('never lets a placeholder replace captured GPS', () => {
    const captured = area({
      latitude: 33.98,
      longitude: -117.36,
      locationCapturedAt: '2026-07-18T10:00:00.000Z',
    });
    const placeholder = area({
      name: 'Canopy A renamed',
      updatedAt: '2026-07-19T10:00:00.000Z',
    });

    expect(mergeDAVEProjectAreaRecord(captured, placeholder)).toMatchObject({
      name: 'Canopy A renamed',
      latitude: 33.98,
      longitude: -117.36,
      locationCapturedAt: '2026-07-18T10:00:00.000Z',
    });
  });

  it('uses the newer captured GPS when both devices captured the area', () => {
    const older = area({
      latitude: 33.1,
      longitude: -117.1,
      locationCapturedAt: '2026-07-18T10:00:00.000Z',
    });
    const newer = area({
      latitude: 33.9,
      longitude: -117.9,
      locationCapturedAt: '2026-07-19T10:00:00.000Z',
    });

    expect(mergeDAVEProjectAreaRecord(older, newer)).toMatchObject({
      latitude: 33.9,
      longitude: -117.9,
      locationCapturedAt: '2026-07-19T10:00:00.000Z',
    });
  });

  it('adds cloud-only records and enforces deletion markers', () => {
    const merged = mergeDAVEProjectAreaRecoveryRecords({
      local: [area()],
      cloud: [area({ id: 'cloud-only', name: 'North Lot' })],
      deletedIds: ['area-1'],
    });

    expect(merged.map(item => item.id)).toEqual(['cloud-only']);
  });

  it('preserves explicit project ownership across legacy area recovery', () => {
    const newerLegacyCopy = area({
      updatedAt: '2026-07-20T10:00:00.000Z',
      projectName: null,
    });
    const ownedCloudCopy = area({
      updatedAt: '2026-07-19T10:00:00.000Z',
      projectName: 'Project A',
    });

    expect(mergeDAVEProjectAreaRecord(newerLegacyCopy, ownedCloudCopy).projectName)
      .toBe('Project A');
  });
});
