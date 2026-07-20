import {
  loadDAVEWebReadOnlySnapshot,
} from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: {
    loadAuthorizedRows: jest.fn(),
  },
}));

const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);

describe('DAVE browser read-only repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('normalizes authorized cloud rows and removes archived evidence', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'p1', name: '2375 Compliance Project', archived: false }],
      scheduleItems: [{
        id: 't1',
        item_data: {
          id: 't1',
          projectName: '2375 Compliance Project',
          taskName: 'Install handrails',
          status: 'In Progress',
          percentComplete: 70,
        },
      }],
      referenceDocuments: [{
        id: 'd1',
        name: 'Schedule.pdf',
        category: 'Schedules',
        document_data: { id: 'd1', name: 'Schedule.pdf', projectName: '2375 Compliance Project' },
      }],
      projectUpdates: [
        {
          id: 'visible-update',
          project_name: '2375 Compliance Project',
          area_name: 'Canopy C',
          update_data: { id: 'visible-update', photos: [], notes: 'Visible' },
        },
        {
          id: 'archived-update',
          project_name: '2375 Compliance Project',
          area_name: 'Canopy C',
          update_data: { id: 'archived-update', photos: [], notes: 'Archived', isArchived: true },
        },
      ],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name)).toEqual(['2375 Compliance Project']);
    expect(snapshot.scheduleItems.map(item => item.taskName)).toEqual(['Install handrails']);
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual(['visible-update']);
    expect(snapshot.referenceDocuments.map(document => document.name)).toEqual(['Schedule.pdf']);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  test('drops malformed records instead of presenting invented project truth', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [{ id: 'missing-name' }],
      scheduleItems: [{ id: 'missing-task', item_data: {} }],
      projectUpdates: [{ id: 'missing-project', update_data: {} }],
      referenceDocuments: [{ id: 'missing-name', document_data: {} }],
      syncTombstones: [],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.scheduleItems).toEqual([]);
    expect(snapshot.projectUpdates).toEqual([]);
    expect(snapshot.referenceDocuments).toEqual([]);
  });

  test('matches mobile cloud accounting by applying deletion, safety, authority, and parent-project rules', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'parent', name: '2375 Compliance Project', archived: false },
        { id: 'child', name: 'Canopy A', archived: false },
      ],
      scheduleItems: [
        {
          id: 'current-task',
          item_data: {
            id: 'current-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Install panels',
            status: 'Complete',
            percentComplete: 100,
            priority: 'High',
            sourceDocumentId: 'current-schedule',
            createdAt: '2026-07-19T10:00:00.000Z',
          },
        },
        {
          id: 'prior-task',
          item_data: {
            id: 'prior-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Old schedule activity',
            status: 'Not Started',
            percentComplete: 0,
            priority: 'Medium',
            sourceDocumentId: 'prior-schedule',
            createdAt: '2026-07-18T10:00:00.000Z',
          },
        },
        {
          id: 'deleted-task',
          item_data: {
            id: 'deleted-task',
            scheduleProjectName: '2375 Compliance Project',
            projectName: 'Canopy A',
            locationName: 'Canopy A',
            taskName: 'Deleted activity',
            status: 'In Progress',
            percentComplete: 50,
            priority: 'Medium',
            sourceDocumentId: 'current-schedule',
            createdAt: '2026-07-19T10:00:00.000Z',
          },
        },
        {
          id: 'unsafe-legacy-task',
          item_data: {
            id: 'unsafe-legacy-task',
            projectName: '2375 Compliance Project',
            taskName: 'Incomplete legacy payload',
          },
        },
      ],
      referenceDocuments: [
        {
          id: 'current-schedule',
          document_data: {
            id: 'current-schedule',
            name: 'Current Schedule.pdf',
            originalFileName: 'Current Schedule.pdf',
            category: 'Schedules',
            isCurrent: true,
            importedAt: '2026-07-19T09:00:00.000Z',
            projectName: '2375 Compliance Project',
          },
        },
        {
          id: 'prior-schedule',
          document_data: {
            id: 'prior-schedule',
            name: 'Prior Schedule.pdf',
            originalFileName: 'Prior Schedule.pdf',
            category: 'Schedules',
            isCurrent: false,
            importedAt: '2026-07-18T09:00:00.000Z',
            projectName: '2375 Compliance Project',
          },
        },
      ],
      projectUpdates: [],
      syncTombstones: [{
        entity_type: 'schedule_item',
        record_id: 'deleted-task',
        deleted_at: '2026-07-19T11:00:00.000Z',
      }],
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name)).toEqual(['2375 Compliance Project']);
    expect(snapshot.scheduleItems.map(item => item.id)).toEqual(['current-task']);
    expect(snapshot.scheduleItems[0]).toMatchObject({ status: 'Complete', percentComplete: 100 });
    expect(snapshot.referenceDocuments.map(document => [document.id, document.isCurrent])).toEqual([
      ['current-schedule', true],
      ['prior-schedule', false],
    ]);
  });
});
