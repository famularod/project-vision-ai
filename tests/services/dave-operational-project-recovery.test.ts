import { reconcileDAVEOperationalProjects } from '../../services/DAVEOperationalProjectRecovery';

describe('DAVE operational project recovery', () => {
  test('adds a project created on another device', () => {
    const result = reconcileDAVEOperationalProjects({
      localRecords: [{ id: 'project-1', name: 'Project One' }],
      localArchivedProjectNames: [],
      cloudActiveRecords: [
        { id: 'project-1', name: 'Project One' },
        { id: 'project-2', name: 'Project Two' },
      ],
      cloudArchivedRecords: [],
    });

    expect(result.projectNames).toEqual(['Project One', 'Project Two']);
    expect(result.archivedProjectNames).toEqual([]);
  });

  test('applies archive and unarchive changes from the authoritative cloud inventory', () => {
    const archived = reconcileDAVEOperationalProjects({
      localRecords: [{ id: 'project-1', name: 'Project One' }],
      localArchivedProjectNames: [],
      cloudActiveRecords: [],
      cloudArchivedRecords: [{ id: 'project-1', name: 'Project One' }],
    });
    expect(archived.archivedProjectNames).toEqual(['Project One']);

    const unarchived = reconcileDAVEOperationalProjects({
      localRecords: archived.projectRecords,
      localArchivedProjectNames: archived.archivedProjectNames,
      cloudActiveRecords: [{ id: 'project-1', name: 'Project One' }],
      cloudArchivedRecords: [],
    });
    expect(unarchived.archivedProjectNames).toEqual([]);
  });

  test('replaces an old project name when the immutable cloud id is renamed', () => {
    const result = reconcileDAVEOperationalProjects({
      localRecords: [{ id: 'project-1', name: 'Old Name' }],
      localArchivedProjectNames: [],
      cloudActiveRecords: [{ id: 'project-1', name: 'New Name' }],
      cloudArchivedRecords: [],
    });

    expect(result.projectRecords).toEqual([
      expect.objectContaining({ id: 'project-1', name: 'New Name' }),
    ]);
    expect(result.projectNames).toEqual(['New Name']);
  });

  test('removes a missing cloud-backed project but preserves a local-only project', () => {
    const result = reconcileDAVEOperationalProjects({
      localRecords: [
        { id: 'project-1', name: 'Deleted Elsewhere' },
        { name: 'Device Draft' },
      ],
      localArchivedProjectNames: [],
      cloudActiveRecords: [],
      cloudArchivedRecords: [],
    });

    expect(result.projectNames).toEqual(['Device Draft']);
  });

  test('does not roll back queued create, rename, or archive changes', () => {
    const result = reconcileDAVEOperationalProjects({
      localRecords: [
        { id: 'project-1', name: 'Renamed Locally' },
        { name: 'Queued Project' },
      ],
      localArchivedProjectNames: ['Renamed Locally'],
      cloudActiveRecords: [{ id: 'project-1', name: 'Old Cloud Name' }],
      cloudArchivedRecords: [],
      queuedChanges: [
        {
          operation: 'update',
          payload: {
            previousName: 'Old Cloud Name',
            name: 'Renamed Locally',
            archived: true,
          },
        },
        {
          operation: 'create',
          payload: { name: 'Queued Project' },
        },
      ],
    });

    expect(result.projectNames).toEqual(['Renamed Locally', 'Queued Project']);
    expect(result.archivedProjectNames).toEqual(['Renamed Locally']);
  });
});
