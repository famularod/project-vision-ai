import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planDAVEWebScheduleImport,
  prepareDAVEWebDocumentUpload,
} from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  createDAVEWebSupabaseGateway,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import { scheduleItemForCloud, type DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Whole-app audit A5 pass 3 F5 (30 Sep 2026): a revised schedule imported on
// the web, then made current, hid all of the manager's progress on the web,
// iPhone and iPad. Each revision here goes the web's way: prepare the file,
// plan it against the tasks the web shows at upload, write it through the
// real gateway into an in-memory cloud, make it current, then read the tasks
// the way the web does (and the phone, through the same selection).
// Synthetic schedule data only.

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
  const now = () => new Date(Date.UTC(2026, 8, 30, 12, 0, 0, clock++)).toISOString();
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

const HEADER = 'Task,Project,Location,Start,Finish,Owner,Status,Percent Complete';
const row = (task: string, start: string, finish: string) =>
  `${task},Alpha Tower,Level 1,${start},${finish},,Not Started,0`;

describe('a revised schedule imported on the web keeps the manager\'s progress (A5 pass 3 F5)', () => {
  let cloud: ReturnType<typeof memoryCloud>;
  let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;

  beforeEach(() => {
    cloud = memoryCloud();
    gateway = createDAVEWebSupabaseGateway(cloud.client);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async () => ({
      projects: [{ id: 'project-alpha', name: 'Alpha Tower', archived: false }],
      scheduleItems: cloud.tables.schedule_items,
      projectUpdates: [],
      referenceDocuments: cloud.tables.reference_documents,
      syncTombstones: cloud.tables.dave_sync_tombstones,
    }) as never);
  });

  /** Upload on /documents: plan against what the web shows, as the provider does. */
  async function uploadRevision(version: string, rows: readonly string[]) {
    const prepared = prepareDAVEWebDocumentUpload({
      fileName: `alpha-${version}.csv`,
      mimeType: 'text/csv',
      sizeBytes: 300,
      contents: [HEADER, ...rows].join('\n'),
      category: 'Schedules',
      projectName: 'Alpha Tower',
      projects: ['Alpha Tower'],
      fingerprint: version.padEnd(64, '0'),
      now: new Date(Date.UTC(2026, 8, Number(version.slice(1)))).toISOString(),
    });
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const plan = planDAVEWebScheduleImport({ snapshot, importedScheduleItems: prepared.scheduleItems });
    await gateway.uploadAuthorizedReferenceDocument({
      document: prepared.document,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      scheduleItems: plan.additions,
      revisedScheduleItems: plan.revisions,
    });
    return prepared.document.id;
  }

  /** "Make Current Schedule", as the server's activation leaves the documents. */
  function makeCurrent(documentId: string) {
    cloud.tables.reference_documents.forEach(document => {
      document.document_data = { ...document.document_data, isCurrent: document.id === documentId };
      document.updated_at = cloud.now();
    });
  }

  async function managerSets(taskName: string, changes: Partial<ScheduleItem>) {
    const task = (await loadDAVEWebReadOnlySnapshot()).scheduleItems.find(item => item.taskName === taskName)!;
    await gateway.updateAuthorizedScheduleItem(scheduleItemForCloud({
      ...task,
      progressSource: 'project_manager',
      progressConfirmedBy: 'PM',
      ...changes,
    }), task.cloudUpdatedAt);
  }

  async function shown() {
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const tasks = new Map(snapshot.scheduleItems.map(item => [item.taskName, item]));
    // The phone and iPad pick what they show from the same rows the same way.
    const phone = selectAuthoritativeScheduleItems({
      scheduleItems: cloud.tables.schedule_items.map(value => value.item_data as ScheduleItem),
      scheduleDocuments: cloud.tables.reference_documents.map(value => value.document_data as ReferenceDocument),
    });
    expect(phone.map(item => item.id).sort()).toEqual(snapshot.scheduleItems.map(item => item.id).sort());
    return { snapshot, tasks };
  }

  const progress = (item: DAVEWebScheduleItem | undefined) =>
    item && [item.percentComplete, item.status, item.progressSource];

  it('shows the manager\'s progress after the revision is made current, and again after the old one is', async () => {
    const first = await uploadRevision('r1', [
      row('Frame walls', '9/1/2026', '9/5/2026'),
      row('Pour slab', '9/2/2026', '9/4/2026'),
      row('Hang drywall', '9/8/2026', '9/12/2026'),
    ]);
    makeCurrent(first);
    await managerSets('Frame walls', { percentComplete: 60, status: 'In Progress', owner: 'Framing Co', notes: 'Crew of six' });
    await managerSets('Pour slab', { percentComplete: 100, status: 'Complete' });
    await managerSets('Hang drywall', { percentComplete: 60, status: 'In Progress' });
    const framingId = (await shown()).tasks.get('Frame walls')!.id;

    const second = await uploadRevision('r2', [
      row('Frame walls', '9/1/2026', '9/5/2026'),
      row('Pour slab', '9/3/2026', '9/5/2026'),
      row('Hang drywall', '9/10/2026', '9/15/2026'),
      row('Paint', '9/16/2026', '9/20/2026'),
    ]);

    // Uploading changes nothing the manager sees until the revision is made current.
    const beforeCurrent = await shown();
    expect([...beforeCurrent.tasks.keys()].sort()).toEqual(['Frame walls', 'Hang drywall', 'Pour slab']);
    expect(progress(beforeCurrent.tasks.get('Pour slab'))).toEqual([100, 'Complete', 'project_manager']);
    const revision = beforeCurrent.snapshot.referenceDocuments.find(document => document.id === second)!;
    expect(revision.importedScheduleItemCount).toBe(4);
    expect(revision.linkedScheduleItems).toHaveLength(3);

    makeCurrent(second);
    const afterCurrent = await shown();
    expect([...afterCurrent.tasks.keys()].sort()).toEqual(['Frame walls', 'Hang drywall', 'Paint', 'Pour slab']);
    expect(afterCurrent.tasks.get('Frame walls')).toMatchObject({
      id: framingId,
      percentComplete: 60,
      owner: 'Framing Co',
      notes: 'Crew of six',
    });
    expect(progress(afterCurrent.tasks.get('Pour slab'))).toEqual([100, 'Complete', 'project_manager']);
    expect(afterCurrent.tasks.get('Pour slab')!.startDate).toBe('09/03/2026');
    expect(progress(afterCurrent.tasks.get('Hang drywall'))).toEqual([60, 'In Progress', 'project_manager']);
    expect(afterCurrent.tasks.get('Hang drywall')!.finishDate).toBe('09/15/2026');
    expect(progress(afterCurrent.tasks.get('Paint'))).toEqual([0, 'Not Started', null]);

    // Making the old revision current again shows it as it was.
    makeCurrent(first);
    const restored = await shown();
    expect([...restored.tasks.keys()].sort()).toEqual(['Frame walls', 'Hang drywall', 'Pour slab']);
    expect(restored.tasks.get('Frame walls')!.id).toBe(framingId);
    expect(progress(restored.tasks.get('Hang drywall'))).toEqual([60, 'In Progress', 'project_manager']);
    expect(restored.tasks.get('Hang drywall')!.finishDate).toBe('09/12/2026');
  });

  it('carries progress through a third revision because only the tasks the web shows are offered', async () => {
    const first = await uploadRevision('r1', [row('Hang drywall', '9/8/2026', '9/12/2026')]);
    makeCurrent(first);
    await managerSets('Hang drywall', { percentComplete: 40, status: 'In Progress' });
    makeCurrent(await uploadRevision('r2', [row('Hang drywall', '9/10/2026', '9/15/2026')]));
    await managerSets('Hang drywall', { percentComplete: 80, status: 'In Progress' });

    // Every saved row holds two manager copies of this task: 40% (hidden) and 80%.
    const everyRow = cloud.tables.schedule_items.map(value => ({ ...value.item_data, cloudUpdatedAt: value.updated_at }));
    const third = prepareDAVEWebDocumentUpload({
      fileName: 'alpha-r3.csv', mimeType: 'text/csv', sizeBytes: 300,
      contents: [HEADER, row('Hang drywall', '9/12/2026', '9/18/2026')].join('\n'),
      category: 'Schedules', projectName: 'Alpha Tower', projects: ['Alpha Tower'], fingerprint: 'r3'.padEnd(64, '0'),
    });
    expect(planDAVEWebScheduleImport({ snapshot: { scheduleItems: everyRow }, importedScheduleItems: third.scheduleItems })
      .additions[0].percentComplete).toBe(0);

    makeCurrent(await uploadRevision('r3', [row('Hang drywall', '9/12/2026', '9/18/2026')]));
    const { tasks } = await shown();
    expect(progress(tasks.get('Hang drywall'))).toEqual([80, 'In Progress', 'project_manager']);
    expect(tasks.get('Hang drywall')!.finishDate).toBe('09/18/2026');
  });

  it('plans at upload from the provider\'s snapshot and writes new rows and revised tasks separately', () => {
    const provider = readFileSync(resolve(__dirname, '../../components/web-shell/desktop-auth-provider.tsx'), 'utf8');
    expect(provider).toContain('planDAVEWebScheduleImport({ snapshot: snapshot!, importedScheduleItems: prepared.scheduleItems })');
    expect(provider).toContain('scheduleItems: plan?.additions ?? []');
    expect(provider).toContain('revisedScheduleItems: plan?.revisions ?? []');
    expect(provider).not.toContain('scheduleItems: prepared.scheduleItems,');
  });

  it('prepares the file again after a refused import, since the rolled-back document id is retired', () => {
    const shell = readFileSync(resolve(__dirname, '../../components/web-shell/desktop-read-only-shell.tsx'), 'utf8');
    const refused = shell.slice(shell.indexOf('async function uploadPreparedDocument'), shell.indexOf('async function makeCurrent'));
    expect(refused).toMatch(/preparedUpload\.scheduleItems\.length > 0 &&\s*error instanceof DAVEWebDocumentMutationError &&\s*error\.code === 'conflict'\s*\) \{\s*setPreparedUpload\(null\);/);
  });
});
