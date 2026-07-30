import {
  explicitProjectAreaOwner,
  inferLegacyAreaProjectNames,
  projectIdentifierFromAreaName,
  projectAreasForProject,
} from '../../services/DAVEProjectAreaScope';
import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../../types';

const baseArea = (
  id: string,
  name: string,
  projectName?: string | null,
): ProjectArea => ({
  id,
  name,
  projectName,
  latitude: 34.1,
  longitude: -118.2,
  radiusFeet: 250,
});

const schedule = (
  id: string,
  projectName: string,
  locationName: string,
  scheduleProjectName?: string | null,
): ScheduleItem => ({
  id,
  projectName,
  scheduleProjectName,
  locationName,
  taskName: `Task ${id}`,
  startDate: '',
  finishDate: '',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  createdAt: '2026-07-22T12:00:00.000Z',
});

const update = (
  id: string,
  projectName: string,
  selectedAreaId: string | null,
  selectedAreaName: string | null,
): ProjectUpdate => ({
  id,
  projectName,
  selectedAreaId,
  selectedAreaName,
  date: '2026-07-22T12:00:00.000Z',
  photos: [],
  notes: '',
  recipients: { contactIds: [] },
});

describe('projectAreasForProject', () => {
  it('honors explicit project ownership even when area names overlap', () => {
    const areas = [
      baseArea('area-a', 'Canopy', 'Project A'),
      baseArea('area-b', 'Canopy', 'Project B'),
    ];

    expect(projectAreasForProject({
      projectAreas: areas,
      projectName: 'Project A',
    }).map(area => area.id)).toEqual(['area-a']);
    expect(projectAreasForProject({
      projectAreas: areas,
      projectName: 'Project B',
    }).map(area => area.id)).toEqual(['area-b']);
  });

  it('includes an unowned legacy area only when links resolve to one project', () => {
    const legacy = baseArea('legacy-area', 'North Lot');
    const areas = [legacy];
    const scheduleItems = [
      schedule('task-a', 'Project A', 'North Lot'),
    ];
    const updates = [
      update('update-a', 'Project A', 'legacy-area', 'North Lot'),
    ];

    expect(inferLegacyAreaProjectNames(
      legacy,
      scheduleItems,
      updates,
    )).toEqual(['project a']);
    expect(projectAreasForProject({
      projectAreas: areas,
      projectName: 'Project A',
      scheduleItems,
      updates,
    })).toEqual([legacy]);
  });

  it('excludes ambiguous and unlinked legacy areas from project workflows', () => {
    const ambiguous = baseArea('ambiguous', 'Canopy');
    const unlinked = baseArea('unlinked', 'Unassigned');
    const projectAreas = [ambiguous, unlinked];
    const scheduleItems = [
      schedule('task-a', 'Project A', 'Canopy'),
      schedule('task-b', 'Project B', 'Canopy'),
    ];

    expect(projectAreasForProject({
      projectAreas,
      projectName: 'Project A',
      scheduleItems,
    })).toEqual([]);
    expect(projectAreasForProject({
      projectAreas,
      projectName: null,
      scheduleItems,
    })).toEqual(projectAreas);
  });

  it('uses update parent metadata before a task area display name', () => {
    const legacy = baseArea('legacy-area', 'Canopy A');
    const taskUpdate = {
      ...update('update-a', 'Canopy A', 'legacy-area', 'Canopy A'),
      scheduleProjectName: 'Project A',
    };

    expect(inferLegacyAreaProjectNames(
      legacy,
      [],
      [taskUpdate],
    )).toEqual(['project a']);
    expect(projectAreasForProject({
      projectAreas: [legacy],
      projectName: 'Project A',
      updates: [taskUpdate],
    })).toEqual([legacy]);
  });

  it('recovers legacy areas with an exact leading project identifier', () => {
    const area = baseArea('legacy-2375-north', '2375 North Lot');
    expect(projectIdentifierFromAreaName(
      area.name,
      ['2321 Compliance Project', '2375 Compliance Project'],
    )).toBe('2375 Compliance Project');
    expect(projectAreasForProject({
      projectAreas: [area],
      projectName: '2375 Compliance Project',
    })).toEqual([area]);
    expect(projectAreasForProject({
      projectAreas: [area],
      projectName: '2321 Compliance Project',
    })).toEqual([]);
  });
});

describe('explicitProjectAreaOwner', () => {
  it('honors explicit ownership and returns the canonical active project name', () => {
    expect(explicitProjectAreaOwner(
      baseArea('area-a', 'Canopy', ' project a '),
      ['Project A', 'Project B'],
    )).toBe('Project A');
    expect(explicitProjectAreaOwner(
      baseArea('area-a', 'Canopy', 'Archived Project'),
      ['Project A', 'Project B'],
    )).toBeNull();
  });
});
