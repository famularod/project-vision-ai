import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: {
    loadAuthorizedRows: jest.fn(),
  },
}));

const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);

// Whole-app audit A3 pass 4 (30 Sep 2026), finding 1a: a deleted project's
// row that came back active (a create queued offline landed after its
// delete) was hidden on the phone and iPad by its deletion record, but the
// web desktop listed it. The desktop now reads project deletion records too,
// as it already did for tasks and documents.
describe('the web desktop leaves deleted projects out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides a project whose name has a deletion record, whatever its case or spacing', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'live', name: '2321 Compliance Project', archived: false },
        { id: 'zombie', name: 'Lot 5  Eats', archived: false },
      ],
      scheduleItems: [
        // A task that still names it does not bring it back either.
        { id: 'stray', item_data: { id: 'stray', projectName: 'Pad A', scheduleProjectName: 'Lot 5 Eats', taskName: 'Survey', status: 'Not Started', percentComplete: 0 } },
      ],
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [
        { entity_type: 'project', record_id: 'lot 5 eats', deleted_at: '2026-09-30T12:01:00.000Z' },
      ],
    } as never);

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name)).toEqual(['2321 Compliance Project']);
  });

  it('keeps projects with no deletion record, and other kinds of record name no project', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'live', name: '2321 Compliance Project', archived: false },
        { id: 'tower', name: 'Tower B', archived: false },
      ],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [
        { entity_type: 'schedule_item', record_id: 'Tower B', deleted_at: '2026-09-30T12:01:00.000Z' },
        { entity_type: 'project', record_id: 'lot 5 eats', deleted_at: '2026-09-30T12:01:00.000Z' },
      ],
    } as never);

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.projects.map(project => project.name).sort()).toEqual(['2321 Compliance Project', 'Tower B']);
  });
});
