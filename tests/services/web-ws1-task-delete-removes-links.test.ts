import {
  daveWebTaskDeleteRowIds,
  planDAVEWebLinksRemovedWithTasks,
} from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  createDAVEWebSupabaseGateway,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import { scheduleItemForCloud } from '../../services/DAVEWebTaskEditing';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';
import type { ScheduleItem } from '../../types';

// Open item, web batch WS1 item 8 (6 Oct 2026): deleting a task on the web's
// Tasks page left every task that listed it as a predecessor naming a row
// that no longer exists. The phone drops those links when it deletes a task.
//
// The web's delete here is what the Tasks page now does, through the real
// gateway into an in-memory cloud: the rows the delete takes, the deletion
// records, then the saved tasks that still link to those rows, each without
// the link. Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

type Row = Record<string, any>;

/** Just enough of Supabase for the gateway: owner-filtered rows, a trigger-like updated_at. */
function memoryCloud() {
  const tables: Record<string, Row[]> = { schedule_items: [], reference_documents: [], dave_sync_tombstones: [] };
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 9, 30, 12, 0, 0, clock++)).toISOString();
  const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  function from(table: string) {
    const rows = (tables[table] ??= []);
    let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    const filters: [string, unknown][] = [];
    const matching = () => rows.filter(row => filters.every(([key, value]) => row[key] === value));
    const execute = (): { data: any; error: any } => {
      if (action === 'insert' || action === 'upsert') {
        const incoming = ([] as Row[]).concat(payload).map(copy);
        if (action === 'insert' && incoming.some(row => row.id && rows.some(existing => existing.id === row.id))) {
          return { data: null, error: { message: 'duplicate key' } };
        }
        incoming.forEach(row => rows.push({ ...row, updated_at: now() }));
        return { data: null, error: null };
      }
      if (action === 'update') {
        const hits = matching();
        hits.forEach(row => Object.assign(row, copy(payload), { updated_at: now() }));
        return { data: hits.map(copy), error: null };
      }
      if (action === 'delete') {
        const hits = matching();
        hits.forEach(row => rows.splice(rows.indexOf(row), 1));
        return { data: hits, error: null };
      }
      return { data: matching().map(copy), error: null };
    };
    const builder: any = {
      select: () => builder,
      order: () => builder,
      insert: (value: Row | Row[]) => { action = 'insert'; payload = value; return builder; },
      update: (value: Row) => { action = 'update'; payload = value; return builder; },
      upsert: (value: Row | Row[]) => { action = 'upsert'; payload = value; return builder; },
      delete: () => { action = 'delete'; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      range: async () => ({ ...execute(), status: 200 }),
      maybeSingle: async () => {
        const { data, error } = execute();
        return { data: Array.isArray(data) ? data[0] ?? null : data, error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve, reject),
    };
    return builder;
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    rpc: async (name: string) => ({ data: name === 'dave_is_app_owner' ? true : null, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from,
  };
  return { tables, client: client as any, now };
}

const NOW = '2026-10-06T18:00:00.000Z';

function task(id: string, taskName: string, extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, projectId: 'alpha', itemType: 'Task', scheduleProjectName: 'Alpha', projectName: 'Alpha', locationName: 'Lot', taskName,
    startDate: '10/05/2026', finishDate: '10/09/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium',
    status: 'Not Started', notes: '', nextAction: '', activity: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  } as ScheduleItem;
}
const after = (...ids: string[]) => ({ dependencies: ids.map(predecessorItemId => ({ predecessorItemId, type: 'FS' as const, lagDays: 2 })) });

describe('deleting a task on the web removes the links other tasks had to it (WS1 item 8)', () => {
  let cloud: ReturnType<typeof memoryCloud>;
  let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;

  beforeEach(() => {
    cloud = memoryCloud();
    gateway = createDAVEWebSupabaseGateway(cloud.client);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async () => ({
      projects: [{ id: 'alpha', name: 'Alpha', archived: false }],
      scheduleItems: cloud.tables.schedule_items,
      projectUpdates: [],
      referenceDocuments: cloud.tables.reference_documents,
      syncTombstones: cloud.tables.dave_sync_tombstones,
    }) as never);
  });

  const put = (...items: ScheduleItem[]) => items.forEach(item => cloud.tables.schedule_items.push({
    id: item.id, owner_id: 'owner-1', project_id: item.projectId, project_name: item.projectName, task_name: item.taskName, item_data: item, updated_at: cloud.now(),
  }));
  const linksInCloud = () => Object.fromEntries(cloud.tables.schedule_items
    .map(row => [row.id, (row.item_data.dependencies ?? []).map((link: { predecessorItemId: string }) => link.predecessorItemId)]));

  /** "Delete Task" on the Tasks page. */
  async function deleteOnTheWeb(taskName: string) {
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const candidate = snapshot.scheduleItems.find(item => item.taskName === taskName)!;
    const deletedIds = daveWebTaskDeleteRowIds(snapshot, candidate);
    await gateway.deleteAuthorizedScheduleItem(candidate.id, candidate.cloudUpdatedAt, deletedIds.filter(id => id !== candidate.id));
    const removals = planDAVEWebLinksRemovedWithTasks({ snapshot, deletedIds, updatedAt: NOW });
    for (const item of removals) await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud(item), item.cloudUpdatedAt);
    return { snapshot, deletedIds, removals };
  }

  it('each task that started after it loses that link and keeps its others, with their lag', async () => {
    put(task('framing', 'Framing'), task('roofing', 'Roofing', after('framing')), task('siding', 'Siding', after('framing', 'roofing')), task('survey', 'Survey'));
    const { snapshot, deletedIds, removals } = await deleteOnTheWeb('Framing');

    expect(deletedIds).toEqual(['framing']);
    expect(linksInCloud()).toEqual({ framing: [], roofing: [], siding: ['roofing'], survey: [] });
    const siding = cloud.tables.schedule_items.find(row => row.id === 'siding')!.item_data as ScheduleItem;
    expect(siding.dependencies).toEqual([{ predecessorItemId: 'roofing', type: 'FS', lagDays: 2 }]);
    // Stamped as a link change, so the link stays removed when the task moves between rows; Survey is not written.
    expect([siding.dependenciesUpdatedAt, siding.updatedAt]).toEqual([NOW, NOW]);
    expect(removals.map(item => item.id).sort()).toEqual(['roofing', 'siding']);
    // The phone's own helper gives the same lists.
    expect(removals.map(item => ({ id: item.id, dependencies: item.dependencies })))
      .toEqual(dependencyChangesForDeletedTask(snapshot.knownScheduleItems!, deletedIds));
    // And the task is gone from what the web shows.
    expect((await loadDAVEWebReadOnlySnapshot()).scheduleItems.map(item => item.taskName).sort()).toEqual(['Roofing', 'Siding', 'Survey']);
  });

  it('a link that names the task\'s earlier, hidden row goes too, and a hidden row that links to it is cleaned as well', async () => {
    const F = { id: 'doc-f', owner_id: 'owner-1', name: 'F', category: 'Schedules', document_data: { id: 'doc-f', name: 'F', originalFileName: 'F.csv', category: 'Schedules', isCurrent: false, importedAt: '2026-09-01T12:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-F' }, updated_at: cloud.now() };
    const G = { id: 'doc-g', owner_id: 'owner-1', name: 'G', category: 'Schedules', document_data: { id: 'doc-g', name: 'G', originalFileName: 'G.csv', category: 'Schedules', isCurrent: true, importedAt: '2026-09-08T12:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-G' }, updated_at: cloud.now() };
    cloud.tables.reference_documents.push(F, G);
    put(
      task('f-framing', 'Framing', { importBatchId: 'batch-F' }),
      task('g-framing', 'Framing', { importBatchId: 'batch-G', revisedFromTaskIds: ['f-framing'], startDate: '10/06/2026' }),
      task('f-roofing', 'Roofing', { importBatchId: 'batch-F', ...after('f-framing') }),
      task('g-roofing', 'Roofing', { importBatchId: 'batch-G', revisedFromTaskIds: ['f-roofing'], startDate: '10/13/2026', ...after('f-framing') }),
    );
    const { deletedIds } = await deleteOnTheWeb('Framing');

    expect(deletedIds.sort()).toEqual(['f-framing', 'g-framing']);
    expect(linksInCloud()).toMatchObject({ 'f-roofing': [], 'g-roofing': [] });
  });

  it('guard: with nobody linked to it, the delete writes no other task', async () => {
    put(task('framing', 'Framing'), task('roofing', 'Roofing', after('survey')), task('survey', 'Survey'));
    const { removals } = await deleteOnTheWeb('Framing');
    expect(removals).toEqual([]);
    expect(linksInCloud()).toMatchObject({ roofing: ['survey'] });
  });
});
