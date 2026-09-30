/**
 * Owner answer Q15 (30 Sep 2026), on the web: the desktop reads the cloud's
 * retiredForProjectNames, so after Alpha's own schedule is made current the
 * combined Alpha+Beta master stays current for Beta and Alpha shows its own
 * schedule's tasks, before and after the migration as the cloud left them.
 * Synthetic data.
 */
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: {
    loadAuthorizedRows: jest.fn(),
  },
}));

const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);

const documentRow = (id: string, projectNames: string[], data: Record<string, unknown>) => ({
  id,
  name: id,
  category: 'Schedules',
  updated_at: '2026-09-30T12:00:00.000Z',
  document_data: {
    id, name: id, originalFileName: `${id}.csv`, category: 'Schedules', notes: '',
    isCurrent: false, importedAt: '2026-09-01T00:00:00.000Z', projectNames,
    projectName: projectNames.length === 1 ? projectNames[0] : null, importBatchId: `batch-${id}`,
    ...data,
  },
});
const taskRow = (id: string, projectName: string, documentId: string) => ({
  id,
  updated_at: '2026-09-30T12:00:00.000Z',
  item_data: {
    id, projectName, taskName: `Task ${id}`, locationName: 'Lot', status: 'Not Started', percentComplete: 0,
    startDate: '07/01/2026', finishDate: '07/10/2026', sourceDocumentId: documentId, importBatchId: `batch-${documentId}`,
  },
});
const rows = (master: Record<string, unknown>, alpha: Record<string, unknown>) => ({
  projects: [
    { id: 'alpha', name: 'Alpha', archived: false },
    { id: 'beta', name: 'Beta', archived: false },
  ],
  scheduleItems: [taskRow('m-a', 'Alpha', 'Master'), taskRow('m-b', 'Beta', 'Master'), taskRow('r-a', 'Alpha', 'Alpha rev 2')],
  projectUpdates: [],
  referenceDocuments: [
    documentRow('Master', ['Alpha', 'Beta'], { importedAt: '2026-09-10T00:00:00.000Z', ...master }),
    documentRow('Alpha rev 2', ['Alpha'], alpha),
  ],
  syncTombstones: [],
});

describe('the web shows each project its current schedule (owner answer Q15)', () => {
  it('after the migration: Alpha shows its own older schedule, Beta keeps the combined master', async () => {
    mockedLoadRows.mockResolvedValue(rows(
      { isCurrent: true, retiredForProjectNames: ['Alpha'] },
      { isCurrent: true },
    ) as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.map(item => item.id).sort()).toEqual(['m-b', 'r-a']);
    const master = snapshot.referenceDocuments.find(document => document.id === 'Master');
    expect(master).toMatchObject({ isCurrent: true, retiredForProjectNames: ['Alpha'] });
    expect(groupDAVEWebDocuments(snapshot.referenceDocuments).currentSchedule.map(document => document.id).sort())
      .toEqual(['Alpha rev 2', 'Master']);
  });

  it('before the migration: the master was retired, so only Alpha\'s tasks show', async () => {
    mockedLoadRows.mockResolvedValue(rows({ isCurrent: false }, { isCurrent: true }) as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.map(item => item.id)).toEqual(['r-a']);
    expect(snapshot.referenceDocuments.find(document => document.id === 'Master')).not.toHaveProperty('retiredForProjectNames');
  });

  it('after the master is made current again: both projects show the master', async () => {
    mockedLoadRows.mockResolvedValue(rows({ isCurrent: true }, { isCurrent: false }) as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.map(item => item.id).sort()).toEqual(['m-a', 'm-b']);
  });

  it('ignores a malformed list', async () => {
    mockedLoadRows.mockResolvedValue(rows(
      { isCurrent: true, retiredForProjectNames: 'Alpha' },
      { isCurrent: true },
    ) as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.referenceDocuments.find(document => document.id === 'Master')).not.toHaveProperty('retiredForProjectNames');
  });
});
