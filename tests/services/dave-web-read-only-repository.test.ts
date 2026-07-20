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
    });

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects).toEqual([]);
    expect(snapshot.scheduleItems).toEqual([]);
    expect(snapshot.projectUpdates).toEqual([]);
    expect(snapshot.referenceDocuments).toEqual([]);
  });
});
