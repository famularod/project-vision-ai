/**
 * Independent review R02 (Build 229, e818b54): Full Sync must not overwrite a
 * record the paged download missed.
 *
 * The cloud's lists are read 500 rows at a time, newest first, by offset. A
 * task on a later page that another device edits while the list is read moves
 * to the front; the next page then repeats one row and leaves the edited task
 * out. The read said ok, the sync took the task as one the cloud does not
 * have, and sent this device's whole copy over the other device's row: 0% and
 * no note over 80% and a note.
 *
 * Two devices, one cloud, in the app's real order (built from the rig in
 * audit-r2-a7p26-carry-upload.test.ts and the Q28 file). Each device has its
 * own app storage. SyncService runs for real: Full Sync is
 * synchronizeLocalData, a task edit is App.tsx's own updateScheduleItem
 * (compiled from its source) and runScheduleItemCloudSync, the queue is
 * uploadPendingChanges, and Full Sync's download is applied by App.tsx's own
 * code. The cloud is one table per collection, read a page at a time through
 * the real pager from the rows as they are AT EACH REQUEST, so a row really
 * does move across the page boundary while the list is read. The other
 * device's edits are made by its own SyncService upload in the middle of this
 * device's sync. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../../types';

const mockStores = new Map<string, Map<string, string>>();
let mockDevice = 'phone';
const mockStore = () => {
  let store = mockStores.get(mockDevice);
  if (!store) { store = new Map(); mockStores.set(mockDevice, store); }
  return store;
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore().get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStore().set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStore().delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStore().keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStore().get(key) ?? null])),
  },
}));

const MOCK_PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
/** The cloud. `stamp` is a row's place in a newest-first list: every write gives the row the next one. */
const mockCloud = {
  tasks: new Map<string, { record: any; stamp: number }>(),
  areas: new Map<string, { record: any; stamp: number }>(),
  updates: new Map<string, { created: number; updatedAt: string; updateData: any }>(),
  tombstones: [] as Array<{ entityType: string; recordId: string; deletedAt: string }>,
  stamp: 0,
  /** Every request the cloud answered, in order, as `device>request`. */
  log: [] as string[],
  /** Every write, as `device:what:id`. */
  writes: [] as string[],
  /** Runs before a request is answered: where the other device acts in the middle of this one's sync. */
  before: null as null | ((request: string, device: string) => Promise<void> | void),
  /** Build 229's reading of a list: the pages put end to end until a short one, nothing compared. */
  listsReadAsBuild229: false,
  /** Rows a list leaves out while saying ok, however it came to miss them. */
  leftOutOfLists: new Set<string>(),
  /** Reads by id fail. */
  readsByIdFail: false,
  /** The cloud's projects: the open ones, and the ones closed there (sync batch Y1). */
  openProjects: [{ id: MOCK_PROJECT_ID, name: 'Alpha' }] as Array<{ id: string; name: string }>,
  closedProjects: [] as Array<{ id: string; name: string }>,
  /** The list of closed projects cannot be read. */
  closedProjectsFail: false,
  /** The deletion history cannot be asked about named records. */
  deletionChecksFail: false,
};
const mockCopy = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const mockOk = <T,>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockDown = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
/** Each cloud call takes a second of the (fake) clock, so a write is later than the edit that sent it. */
const mockTick = () => { try { jest.setSystemTime(Date.now() + 1000); } catch { /* real timers */ } };
const mockRequest = async (name: string) => {
  mockTick();
  mockCloud.log.push(`${mockDevice}>${name}`);
  await mockCloud.before?.(name, mockDevice);
};

jest.mock('../../services/SupabaseService', () => {
  const actual = jest.requireActual('../../services/SupabaseService');
  const { paginateSupabaseCollectionByKey } = jest.requireActual('../../services/SupabaseCollectionPagination');
  const { SCHEDULE_ITEM_ALREADY_IN_CLOUD } = jest.requireActual('../../services/CloudListAbsenceCheck');
  const { CLOUD_ROW_CHANGED_SINCE_READ, withCloudRowVersion } = jest.requireActual('../../services/CloudRowVersion');
  /**
   * A list read a page at a time, each page from the rows as they are when it is asked for: by key, as the app reads
   * its lists since review pass 2 (the rows after the last id read, in the order of their ids, through the real
   * pager), or as Build 229 read them (by offset, newest first, the pages put end to end and nothing compared). A
   * page's request is named by how many rows the read already has. The answer is newest first either way, and each
   * row comes with the version of the cloud row it is (independent review pass 2, item 1).
   */
  const paged = async (name: string, now: () => Array<{ row: { id: string }; stamp: number; version?: string }>) => {
    const listed = () => now().filter(entry => !mockCloud.leftOutOfLists.has(entry.row.id));
    const copy = (entry: { row: { id: string }; version?: string }) => withCloudRowVersion(mockCopy(entry.row), entry.version) as { id: string };
    if (mockCloud.listsReadAsBuild229) {
      const rows: Array<{ id: string }> = [];
      for (let from = 0; ; from += 500) {
        await mockRequest(`${name}:page:${from}`);
        const page = listed().sort((left, right) => right.stamp - left.stamp || left.row.id.localeCompare(right.row.id)).slice(from, from + 500);
        rows.push(...page.map(copy));
        if (page.length < 500) return mockOk(rows);
      }
    }
    let read = 0;
    const stamps = new Map<string, number>();
    const result = await paginateSupabaseCollectionByKey(async ({ after, limit, includeExactCount }: {
      after: ReadonlyArray<{ op: string; value: string | number }>; limit: number; includeExactCount: boolean;
    }) => {
      await mockRequest(`${name}:page:${read}`);
      const all = listed();
      const cursor = after.find(filter => filter.op === 'gt')?.value;
      const page = all.filter(entry => cursor === undefined || entry.row.id > cursor)
        .sort((left, right) => (left.row.id < right.row.id ? -1 : 1)).slice(0, limit);
      read += page.length;
      page.forEach(entry => stamps.set(entry.row.id, entry.stamp));
      return { data: page.map(copy), count: includeExactCount ? all.length : null, error: null, status: 200 };
    }, { key: ['id'], requestExactCount: true }, 500);
    if (!result.ok) return { ok: false, configured: true, stubbed: false, data: null, error: result.error };
    return mockOk([...(result.rows as Array<{ id: string }>)]
      .sort((left, right) => (stamps.get(right.id) ?? 0) - (stamps.get(left.id) ?? 0) || left.id.localeCompare(right.id)));
  };
  const rowsOf = (table: Map<string, { record: any; stamp: number }>) => () => [...table.values()].map(entry => ({ row: entry.record as { id: string }, stamp: entry.stamp, version: String(entry.stamp) }));
  const byIds = (table: Map<string, { record: any; stamp: number }>, ids: readonly string[]) =>
    ids.flatMap(id => (table.has(id) ? [withCloudRowVersion(mockCopy(table.get(id)!.record), String(table.get(id)!.stamp))] : []));
  /** A write made only under its condition, as the cloud makes it: in one step. */
  const write = (table: Map<string, { record: any; stamp: number }>, kind: string, record: { id: string }, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }) => {
    const current = table.get(record.id);
    const refused = (code: string) => ({ ok: false, configured: true, stubbed: false, data: null, status: 409, code,
      error: `This ${kind === 'task' ? 'task' : 'GPS area'} changed in the cloud while the sync was running. This copy was not sent over it.` });
    if (options?.onlyIfAbsent && current) return refused(kind === 'task' ? SCHEDULE_ITEM_ALREADY_IN_CLOUD : CLOUD_ROW_CHANGED_SINCE_READ);
    if (options?.ifUnchangedSince && String(current?.stamp) !== options.ifUnchangedSince) return refused(CLOUD_ROW_CHANGED_SINCE_READ);
    table.set(record.id, { record: mockCopy(record), stamp: (mockCloud.stamp += 1) });
    mockCloud.writes.push(`${mockDevice}:${kind}:${record.id}`);
    return mockOk(withCloudRowVersion(mockCopy(record), String(mockCloud.stamp)));
  };
  const updateRow = (id: string, current: { created: number; updatedAt: string; updateData: any }) => ({
    id, projectId: MOCK_PROJECT_ID, projectName: 'Alpha', areaName: '', idempotencyKey: id,
    createdAt: new Date(Date.parse('2026-09-01T00:00:00.000Z') + current.created * 60_000).toISOString(),
    updatedAt: current.updatedAt, ownerId: 'owner-d', updateData: mockCopy(current.updateData),
  });
  const addTombstones = (list: Array<{ entityType: string; recordId: string; deletedAt: string }>) => {
    list.forEach(tombstone => {
      if (!mockCloud.tombstones.some(known => known.entityType === tombstone.entityType && known.recordId === tombstone.recordId)) {
        mockCloud.tombstones.push(mockCopy(tombstone));
      }
      if (tombstone.entityType === 'schedule_item') mockCloud.tasks.delete(tombstone.recordId);
    });
  };
  return {
    ...actual,
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
    testSupabaseConnection: async () => ({ connected: true, projectCount: 1 }),
    countCloudProjects: async () => mockOk(1),
    verifyDAVEAppOwner: async () => mockOk(true),
    getCurrentSessionAccessToken: async () => ({ ok: true, data: { status: 'token_present' } }),
    listProjects: async () => { await mockRequest('projects:list'); return mockOk(mockCopy(mockCloud.openProjects)); },
    listArchivedProjects: async () => (mockCloud.closedProjectsFail ? mockDown() : mockOk(mockCopy(mockCloud.closedProjects))),
    createProject: async (input: { name: string }) => {
      const created = { id: `project-made-${mockCloud.openProjects.length}`, name: input.name };
      mockCloud.openProjects.push(created);
      mockCloud.writes.push(`${mockDevice}:project:${input.name}`);
      return mockOk(mockCopy(created));
    },
    listReferenceDocuments: async () => mockOk([]),
    upsertReferenceDocument: async (document: unknown) => mockOk(document),
    listDAVESyncTombstones: async () => { await mockRequest('tombstones:list'); return mockOk(mockCopy(mockCloud.tombstones)); },
    // The deletion records the cloud holds now for these records of one kind (sync batch Y1, item 2).
    listDAVESyncTombstonesForRecords: async (entityType: string, ids: string[]) => {
      await mockRequest(`tombstones:ids:${ids.length}`);
      if (mockCloud.deletionChecksFail) return mockDown();
      const wanted = new Set(ids.map(id => id.trim().toLowerCase()));
      return mockOk(mockCopy(mockCloud.tombstones.filter(tombstone => tombstone.entityType === entityType && wanted.has(tombstone.recordId.trim().toLowerCase()))));
    },
    upsertDAVESyncTombstone: async (tombstone: { entityType: string; recordId: string; deletedAt: string }) => { addTombstones([tombstone]); return mockOk(tombstone); },
    upsertDAVESyncTombstones: async (list: Array<{ entityType: string; recordId: string; deletedAt: string }>) => { addTombstones(list); return mockOk(list); },

    listScheduleItems: () => paged('tasks', rowsOf(mockCloud.tasks)),
    getScheduleItem: async (id: string) => {
      await mockRequest(`task:id:${id}`);
      return mockCloud.readsByIdFail ? mockDown() : mockOk(byIds(mockCloud.tasks, [id])[0] ?? null);
    },
    getScheduleItemsByIds: async (ids: string[]) => {
      await mockRequest(`tasks:ids:${ids.length}`);
      return mockCloud.readsByIdFail ? mockDown() : mockOk(byIds(mockCloud.tasks, ids));
    },
    upsertScheduleItem: async (item: { id: string }, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }) => {
      await mockRequest(`task:write:${item.id}`);
      return write(mockCloud.tasks, 'task', item, options);
    },

    listProjectAreas: () => paged('areas', rowsOf(mockCloud.areas)),
    getProjectAreasByIds: async (ids: string[]) => {
      await mockRequest(`areas:ids:${ids.length}`);
      return mockCloud.readsByIdFail ? mockDown() : mockOk(byIds(mockCloud.areas, ids));
    },
    upsertProjectArea: async (area: { id: string }, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }) => {
      await mockRequest(`area:write:${area.id}`);
      return write(mockCloud.areas, 'area', area, options);
    },

    // Field updates are listed newest created first; an edit does not move a row.
    listProjectUpdates: () => paged('updates', () => [...mockCloud.updates.entries()]
      .map(([id, current]) => ({ row: updateRow(id, current), stamp: current.created }))),
    getProjectUpdateSyncMetadata: async (id: string) => {
      await mockRequest(`update:id:${id}`);
      const current = mockCloud.updates.get(id);
      return mockOk(current ? { id, projectId: MOCK_PROJECT_ID, updatedAt: current.updatedAt, projectName: 'Alpha', areaName: '', updateData: mockCopy(current.updateData) } : null);
    },
    saveProjectUpdate: async (params: { id: string; projectId: string; updatedAt: string; updateData: Record<string, unknown> }) => {
      await mockRequest(`update:write:${params.id}`);
      mockCloud.updates.set(params.id, {
        created: mockCloud.updates.get(params.id)?.created ?? (mockCloud.stamp += 1),
        updatedAt: params.updatedAt, updateData: mockCopy({ ...params.updateData, projectId: params.projectId }),
      });
      mockCloud.writes.push(`${mockDevice}:update:${params.id}`);
      return mockOk({ id: params.id, updateData: params.updateData });
    },
    archiveProjectUpdate: async () => mockOk(null),
    deleteProjectUpdate: async () => mockOk(null),
    createPhotoSignedUrl: async () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Object not found', status: 404 }),
    uploadPhoto: async ({ path: pathName }: { path: string }) => mockOk({ path: pathName }),
  };
});
jest.mock('../../services/BackgroundTaskGuard', () => ({ startGuardedBackgroundTask: () => undefined }));
jest.mock('../../services/DAVECloudMaintenanceBudget', () => ({
  runDAVECloudMaintenanceIfDue: async () => ({ storageCleanupRemaining: 0, storageCleanupCompleted: 0, storageCleanupErrors: [] }),
}));

import { isDAVESafeCloudScheduleRecord, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { scheduleItemsWithPendingEditsOverCloud } from '../../services/ScheduleItemQueueRevision';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleItemConflictFields } from '../../services/ScheduleItemEditBase';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import { SUPABASE_COLLECTION_ANSWER_CAPPED, SUPABASE_COLLECTION_CHANGED_WHILE_READ, SUPABASE_COLLECTION_KEY_OUT_OF_ORDER } from '../../services/SupabaseCollectionPagination';
import {
  cloudProjectsMissedByLists, getOfflineQueue, getSyncConflicts, noteFieldUpdateEditOpened, queueProjectAreaRecord, queueProjectCreate, queueProjectUpdateRecord,
  queueScheduleItemRecord, refreshFieldUpdateConflictCloudCopies, runScheduleItemCloudSync, sanitizeUserFacingSyncMessage, synchronizeLocalData,
  uploadPendingChanges,
} from '../../services/SyncService';

/* App.tsx's own code, compiled -------------------------------------------- */
const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
function appSlice(from: string, to: string, includeEnd = false): string {
  const start = APP.indexOf(from);
  if (start < 0) throw new Error(`App.tsx no longer has: ${from}`);
  const end = APP.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`App.tsx no longer has: ${to}`);
  return APP.slice(start, includeEnd ? end + to.length : end);
}
function compiled<T>(body: string, deps: Record<string, unknown>): T {
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports as T;
}
const FULL_SYNC_APPLY_SOURCE = appSlice('                if (failed.scheduleItems === null) {', '\n                }\n', true);
const UPDATE_SOURCE = appSlice('\n  function updateScheduleItem(', '\n  async function saveScheduleItemChanges(');
const identity = <T,>(value: T) => value;
const listCopy = (items: ScheduleItem[]) => items.map(item => ({ ...item }));

/* A device ---------------------------------------------------------------- */
type DeviceName = 'phone' | 'ipad';
type Device = {
  name: DeviceName;
  state: ScheduleItem[];
  ref: { current: ScheduleItem[] };
  generation: Map<string, number>;
  pending: Array<Promise<unknown>>;
};
const newDevice = (name: DeviceName): Device => ({ name, state: [], ref: { current: [] }, generation: new Map(), pending: [] });
const on = (device: Device) => { mockDevice = device.name; };
function setter(device: Device) {
  return (next: ScheduleItem[] | ((previous: ScheduleItem[]) => ScheduleItem[])) => {
    device.state = typeof next === 'function' ? next(device.state) : next;
    device.ref.current = device.state;
  };
}

/**
 * A task edit (App.tsx's updateScheduleItem, then its sync), on the device that makes it. Offline, the edit is queued
 * with the copy it started from and waits (the queue write runScheduleItemCloudSync makes before it uploads).
 */
async function edit(device: Device, itemId: string, change: Partial<ScheduleItem>, online = true) {
  const previous = mockDevice;
  on(device);
  const update = compiled<(id: string, change: Partial<ScheduleItem>) => void>(`module.exports = (() => { ${UPDATE_SOURCE}\n return updateScheduleItem; })();`, {
    scheduleItemsCurrentRef: device.ref,
    withProjectControlsEditMerged,
    reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }),
    displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: (id: string) => { const next = (device.generation.get(id) || 0) + 1; device.generation.set(id, next); return next; },
    markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: setter(device),
    scheduleItemChangeUsesDebouncedSync: () => false,
    cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: (item: ScheduleItem, _generation: number, changedFields?: readonly (keyof ScheduleItem)[], before?: ScheduleItem) => {
      device.pending.push(online
        ? runScheduleItemCloudSync(item, changedFields, before)
        : queueScheduleItemRecord(item, false, changedFields, before));
    },
    queueScheduleItemRecord,
    Alert: { alert: () => undefined },
  });
  update(itemId, change);
  await Promise.all(device.pending.splice(0));
  mockDevice = previous;
}

type SyncResult = Awaited<ReturnType<typeof synchronizeLocalData>>;
/** Full Sync from Settings: synchronizeLocalData, then App.tsx's own apply of what it downloaded. */
async function fullSync(device: Device, more: { areas?: ProjectArea[]; updates?: ProjectUpdate[]; projects?: string[] } = {}): Promise<SyncResult> {
  on(device);
  const result = await synchronizeLocalData({
    projects: more.projects ?? ['Alpha'], savedUpdates: more.updates ?? [], projectAreas: more.areas ?? [], scheduleItems: device.state, referenceDocuments: [],
  });
  const apply = compiled<(recovered: unknown) => void>(`module.exports = (recovered) => { const failed = recovered.collectionErrors; ${FULL_SYNC_APPLY_SOURCE} };`, {
    normalizeScheduleItems: listCopy, isDAVESafeCloudScheduleRecord, migrateLegacyScheduleItem: identity,
    setScheduleItems: setter(device), recoverDAVEScheduleRecords, deletedDAVERecordIds,
    markScheduleItemsAuthorityReady: () => undefined, recordScheduleCloudPull: async () => undefined,
    scheduleItemsWithPendingEditsOverCloud,
  });
  apply(result.recovered);
  return result;
}

/* The data ------------------------------------------------------------------ */
const T0 = '2026-09-01T08:00:00.000Z';
const taskId = (index: number) => `task-${String(index).padStart(4, '0')}`;
const task = (index: number, patch: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: taskId(index), itemType: 'Task', projectId: MOCK_PROJECT_ID, projectName: 'Alpha', scheduleProjectName: 'Alpha',
  locationName: `Lot ${index}`, taskName: `Task ${index}`, startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '',
  owner: '', contractor: '', percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '', createdAt: T0, updatedAt: T0,
  // Every task carries a percent David confirmed: two copies of one are then weighed by when each was changed.
  progressSource: 'project_manager', progressConfirmedAt: T0, progressConfirmedBy: 'David',
  ...patch,
} as ScheduleItem);
/** The cloud holds `count` tasks; the higher a task's number, the further down the newest-first list it is. */
function seedTasks(count: number) {
  for (let index = 0; index < count; index += 1) {
    mockCloud.tasks.set(taskId(index), { record: task(index), stamp: count - index });
  }
  mockCloud.stamp = Math.max(mockCloud.stamp, count);
}
/** A device that has synced: it holds what the cloud holds. */
function synced(device: Device) {
  setter(device)([...mockCloud.tasks.values()].map(row => mockCopy(row.record) as ScheduleItem));
}
const cloudTask = (id: string) => mockCloud.tasks.get(id)?.record as ScheduleItem | undefined;
const onDevice = (device: Device, id: string) => device.state.find(item => item.id === id);
const shows = (item: ScheduleItem | undefined) => item && [item.percentComplete, item.notes || '', item.owner || ''];
/** The phone's requests that begin so (the other device's own requests are not counted). */
const requests = (prefix: string) => mockCloud.log.filter(request => request.startsWith(`phone>${prefix}`)).map(request => request.slice('phone>'.length));
const writesBy = (device: Device) => mockCloud.writes.filter(write => write.startsWith(`${device.name}:`));
/** Runs `action` once, before the phone's `nth` request of that name is answered (1 = its first from now). */
function beforeRequest(name: string, nth: number, action: () => Promise<void> | void) {
  let seen = 0;
  const earlier = mockCloud.before;
  mockCloud.before = async (request, device) => {
    await earlier?.(request, device);
    if (request !== name || device !== 'phone') return;
    seen += 1;
    if (seen === nth) await action();
  };
}
/**
 * The other device's edit of a task as its upload writes it: for the moments inside the phone's own upload, where
 * a second upload in the same process would only wait for the first.
 */
function ipadWrites(id: string, change: Partial<ScheduleItem>) {
  const current = mockCloud.tasks.get(id)!.record as ScheduleItem;
  mockCloud.tasks.set(id, { record: { ...current, ...change, updatedAt: new Date().toISOString() }, stamp: (mockCloud.stamp += 1) });
  mockCloud.writes.push(`ipad:task:${id}`);
}
async function conflictsOf(device: Device) { on(device); return getSyncConflicts(); }
async function queueOf(device: Device) { on(device); return getOfflineQueue(); }

const at = (when: string) => jest.setSystemTime(Date.parse(when));
jest.setTimeout(120_000);
beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-09-10T08:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  mockStores.clear();
  mockCloud.tasks.clear(); mockCloud.areas.clear(); mockCloud.updates.clear();
  mockCloud.tombstones.length = 0; mockCloud.log.length = 0; mockCloud.writes.length = 0;
  mockCloud.stamp = 0; mockCloud.before = null; mockCloud.listsReadAsBuild229 = false;
  mockCloud.leftOutOfLists.clear(); mockCloud.readsByIdFail = false;
  mockCloud.openProjects = [{ id: MOCK_PROJECT_ID, name: 'Alpha' }]; mockCloud.closedProjects = []; mockCloud.closedProjectsFail = false;
  mockCloud.deletionChecksFail = false;
  mockDevice = 'phone';
});
afterEach(() => { jest.useRealTimers(); });

/** The last task of 502: alone on the second page of the newest-first list. */
const LATE = taskId(501);
const LIST_READINGS = [['as Build 229 read the list', true], ['as the list is read now', false]] as const;

/* The reviewed case ---------------------------------------------------------- */
describe('independent review R02: a task the paged download missed is not overwritten', () => {
  it.each(LIST_READINGS)('the iPad sets a task to 80% with a note while the phone downloads the list: the phone\'s 0% copy does not go over it (%s)', async (_label, build229) => {
    seedTasks(502);
    const phone = newDevice('phone');
    const ipad = newDevice('ipad');
    synced(phone);
    synced(ipad);
    mockCloud.listsReadAsBuild229 = build229;
    mockCloud.log.length = 0;
    // After the phone has read the first 500 tasks, the iPad edits the task on the second page: it moves to the front.
    beforeRequest('tasks:page:500', 1, () => edit(ipad, LATE, { percentComplete: 80, notes: 'Inspector Thursday' }));

    const result = await fullSync(phone);

    expect(shows(cloudTask(LATE))).toEqual([80, 'Inspector Thursday', '']);
    expect(shows(onDevice(phone, LATE))).toEqual([80, 'Inspector Thursday', '']);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(await conflictsOf(phone)).toEqual([]);
    if (build229) {
      // The list said ok with 502 rows, one of them twice and the edited task missing: the task was asked for by its id.
      expect(requests('task:id:')).toEqual([`task:id:${LATE}`]);
    } else {
      // Read by key, the edited task could not move: it is on the second page, with the iPad's edit. Each read of the
      // list is its two pages, once; nothing is read again, and no task had to be asked for one by one.
      expect(requests('tasks:page:').length).toBe(2 * requests('tasks:page:0').length);
      expect(requests('task:id:')).toEqual([]);
      expect(requests('tasks:ids:')).toEqual([]);
    }
  });

  it.each(LIST_READINGS)('edited again between the phone\'s reconciliation and its write: the iPad\'s newer note survives, with the phone\'s percent (%s)', async (_label, build229) => {
    seedTasks(502);
    const phone = newDevice('phone');
    const ipad = newDevice('ipad');
    synced(phone);
    synced(ipad);
    // The phone holds a percent David entered that is in no queue (a device backup restored, or an edit Build 229
    // queued): Full Sync is what sends it, as the whole task.
    at('2026-09-10T09:00:00.000Z');
    setter(phone)(phone.state.map(item => item.id !== LATE ? item : {
      ...item, percentComplete: 30, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T09:00:00.000Z',
      progressConfirmedBy: 'David', updatedAt: '2026-09-10T09:00:00.000Z',
    } as ScheduleItem));
    at('2026-09-10T12:00:00.000Z');
    mockCloud.listsReadAsBuild229 = build229;
    mockCloud.log.length = 0;
    // While the phone downloads, the iPad types a note on the task: it crosses the page boundary.
    beforeRequest('tasks:page:500', 1, () => edit(ipad, LATE, { notes: 'Inspector Thursday' }));
    // After the phone has weighed its copy against the cloud's, and before it writes, the iPad changes the note again.
    beforeRequest('projects:list', 1, () => edit(ipad, LATE, { notes: 'Inspector moved to Friday' }));

    const result = await fullSync(phone);

    // The newer note survives; the phone's percent, which the iPad never changed, goes up with it.
    expect(shows(cloudTask(LATE))).toEqual([30, 'Inspector moved to Friday', '']);
    expect(shows(onDevice(phone, LATE))).toEqual([30, 'Inspector moved to Friday', '']);
    expect(writesBy(phone)).toEqual([`phone:task:${LATE}`]);
    expect(result.errors).toEqual([]);
    expect(await conflictsOf(phone)).toEqual([]);
    // The iPad then syncs: both devices and the cloud hold the same task, and a second round writes nothing.
    synced(ipad);
    const written = mockCloud.writes.length;
    await fullSync(phone);
    await fullSync(ipad);
    expect(mockCloud.writes.length).toBe(written);
    expect(shows(onDevice(ipad, LATE))).toEqual([30, 'Inspector moved to Friday', '']);
  });

  it.each(LIST_READINGS)('a note David typed offline on the same task meets the iPad\'s two notes: Review Conflicts asks, and nothing is written over (%s)', async (_label, build229) => {
    seedTasks(502);
    const phone = newDevice('phone');
    const ipad = newDevice('ipad');
    synced(phone);
    synced(ipad);
    // Offline on the phone: a note and an owner, queued with the copy they started from (owner answer Q28).
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, LATE, { notes: 'Crew short Tuesday', owner: 'Mike' }, false);
    expect(await queueOf(phone)).toHaveLength(1);
    at('2026-09-10T12:00:00.000Z');
    mockCloud.listsReadAsBuild229 = build229;
    mockCloud.log.length = 0;
    beforeRequest('tasks:page:500', 1, () => edit(ipad, LATE, { percentComplete: 80, notes: 'Inspector Thursday' }));
    // Between the phone's reconciliation and its queued edit's write (its upload reads the deletion history first).
    beforeRequest('tombstones:list', 2, () => ipadWrites(LATE, { notes: 'Inspector moved to Friday' }));

    await fullSync(phone);

    // The iPad's newest note and its 80% stay in the cloud; the phone's owner, which only it changed, goes up.
    expect(shows(cloudTask(LATE))).toEqual([80, 'Inspector moved to Friday', 'Mike']);
    const conflicts = await conflictsOf(phone);
    expect(conflicts).toEqual([expect.objectContaining({ entity: 'schedule_item', localId: LATE })]);
    expect(scheduleItemConflictFields(conflicts[0].localPayload)).toEqual(['notes']);
    expect((conflicts[0].localPayload as { itemData: ScheduleItem }).itemData.notes).toBe('Crew short Tuesday');
    expect((conflicts[0].remotePayload as ScheduleItem).notes).toBe('Inspector moved to Friday');
  });

  it('a task the list left out and the cloud really does not have goes up as new, as before', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    setter(phone)([...phone.state, task(900, { notes: 'Added on the phone' })]);
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    expect(cloudTask(taskId(900))?.notes).toBe('Added on the phone');
    expect(result.errors).toEqual([]);
    expect(writesBy(phone)).toEqual([`phone:task:${taskId(900)}`]);
    // Asked for once to confirm it is new, once more just before it is written.
    expect(requests('task:id:')).toEqual([`task:id:${taskId(900)}`, `task:id:${taskId(900)}`]);
  });

  it('a read by id that fails sends nothing and says so; the task stays on the phone', async () => {
    seedTasks(502);
    const phone = newDevice('phone');
    synced(phone);
    mockCloud.tasks.get(LATE)!.record = task(501, { percentComplete: 80, notes: 'Inspector Thursday', updatedAt: '2026-09-10T07:00:00.000Z' });
    mockCloud.leftOutOfLists.add(LATE);
    mockCloud.readsByIdFail = true;

    const result = await fullSync(phone);

    expect(shows(cloudTask(LATE))).toEqual([80, 'Inspector Thursday', '']);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toContain(
      '1 task that the cloud\'s list did not show could not be checked one by one. It was kept on this device and not sent, and will be checked again at the next sync. Network request failed',
    );
    expect(shows(onDevice(phone, LATE))).toEqual([0, '', '']);
    // The next sync, with the read working: the cloud's row is found and kept.
    mockCloud.readsByIdFail = false;
    const next = await fullSync(phone);
    expect(writesBy(phone)).toEqual([]);
    expect(next.errors).toEqual([]);
  });

  it('a row another device adds in the moment before the phone writes its copy as new is left as it is', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const added = taskId(900);
    setter(phone)([...phone.state, task(900, { notes: 'The phone\'s copy' })]);
    beforeRequest(`task:write:${added}`, 1, () => {
      mockCloud.tasks.set(added, { record: task(900, { percentComplete: 60, notes: 'The iPad\'s row', updatedAt: '2026-09-10T08:30:00.000Z' }), stamp: (mockCloud.stamp += 1) });
    });

    const result = await fullSync(phone);

    expect(shows(cloudTask(added))).toEqual([60, 'The iPad\'s row', '']);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([
      '1 task changed in the cloud while this sync was running. This device\'s copy was not sent over it. Sync again to compare the two.',
    ]);
    // Sync again: the two are weighed, and the cloud's newer row stands.
    const next = await fullSync(phone);
    expect(next.errors).toEqual([]);
    expect(shows(cloudTask(added))).toEqual([60, 'The iPad\'s row', '']);
  });

  it('a task deleted on another device after the phone weighed its copy is not sent back as new', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const doomed = taskId(2);
    // The phone's copy is newer, so Full Sync would send it.
    setter(phone)(phone.state.map(item => item.id !== doomed ? item : { ...item, owner: 'Mike', updatedAt: '2026-09-10T07:59:00.000Z' }));
    beforeRequest('projects:list', 1, () => {
      mockCloud.tasks.delete(doomed);
      mockCloud.tombstones.push({ entityType: 'schedule_item', recordId: doomed, deletedAt: new Date().toISOString() });
    });

    const result = await fullSync(phone);

    expect(cloudTask(doomed)).toBeUndefined();
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

/* Request budget -------------------------------------------------------------- */
describe('independent review R02: the reads by id are batched', () => {
  it('2,000 tasks, all in the list: no task is asked for by its id, and nothing is written', async () => {
    seedTasks(2000);
    const phone = newDevice('phone');
    synced(phone);
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    expect(result.errors).toEqual([]);
    expect(requests('task:id:')).toEqual([]);
    expect(requests('tasks:ids:')).toEqual([]);
    // Nothing is about to be created, so the deletion history is not asked a second time (sync batch Y1, item 2).
    expect(requests('tombstones:ids:')).toEqual([]);
    expect(mockCloud.writes).toEqual([]);
    // Each read of the list is its four pages, once, and the empty page that ends a list whose last page was full.
    expect(requests('tasks:page:').length).toBe(5 * requests('tasks:page:0').length);
  });

  it('2,000 tasks the cloud does not have: one batched read confirms that, 20 more go before the writes, none one by one', async () => {
    const phone = newDevice('phone');
    setter(phone)(Array.from({ length: 2000 }, (_, index) => task(index)));
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    expect(result.errors).toEqual([]);
    expect(mockCloud.tasks.size).toBe(2000);
    expect(requests('task:id:')).toEqual([]);
    // The confirmation asks for all 2,000 at once (20 requests of a hundred at the cloud: see the cloud-reads test);
    // each hundred is then read once more just before it is written.
    expect(requests('tasks:ids:')).toEqual(['tasks:ids:2000', ...Array.from({ length: 20 }, () => 'tasks:ids:100')]);
    // And each hundred about to be created is asked about once in the deletion history (sync batch Y1, item 2).
    expect(requests('tombstones:ids:')).toEqual(Array.from({ length: 20 }, () => 'tombstones:ids:100'));
  });

  it('250 queued rows of an approved schedule the cloud does not have: read by id together, not 250 times', async () => {
    const phone = newDevice('phone');
    on(phone);
    const rows = Array.from({ length: 250 }, (_, index) => task(index));
    setter(phone)(rows);
    for (const row of rows) await queueScheduleItemRecord(row, false);
    mockCloud.log.length = 0;

    const result = await uploadPendingChanges();

    expect(result.errors).toEqual([]);
    expect(mockCloud.tasks.size).toBe(250);
    expect(requests('task:id:')).toEqual([]);
    expect(requests('tasks:ids:')).toEqual(['tasks:ids:250']); // three requests of a hundred at the cloud
  });
});

/* The queue -------------------------------------------------------------------- */
describe('independent review R02: a queued whole copy is weighed against the row the list missed', () => {
  it('a whole copy of a task (as an approved schedule queues it) does not go over the other device\'s row', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const id = taskId(1);
    // The iPad's row: a note and 80%, newer than the phone's copy. The list leaves it out.
    mockCloud.tasks.get(id)!.record = task(1, { percentComplete: 80, notes: 'Inspector Thursday', progressSource: 'project_manager',
      progressConfirmedAt: '2026-09-10T07:00:00.000Z', updatedAt: '2026-09-10T07:00:00.000Z' } as Partial<ScheduleItem>);
    mockCloud.leftOutOfLists.add(id);
    on(phone);
    await queueScheduleItemRecord(onDevice(phone, id)!, false);
    mockCloud.log.length = 0;

    const result = await uploadPendingChanges();

    expect(result.errors).toEqual([]);
    expect(requests('task:id:')).toEqual([`task:id:${id}`]);
    expect(shows(cloudTask(id))).toEqual([80, 'Inspector Thursday', '']);
  });

  it('when that read fails the copy stays queued, with the reason', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const id = taskId(1);
    mockCloud.tasks.get(id)!.record = task(1, { percentComplete: 80, notes: 'Inspector Thursday', updatedAt: '2026-09-10T07:00:00.000Z' });
    mockCloud.leftOutOfLists.add(id);
    mockCloud.readsByIdFail = true;
    on(phone);
    await queueScheduleItemRecord(onDevice(phone, id)!, false);

    const result = await uploadPendingChanges();

    expect(result.uploaded).toBe(0);
    expect(await queueOf(phone)).toHaveLength(1);
    expect(shows(cloudTask(id))).toEqual([80, 'Inspector Thursday', '']);
    expect(writesBy(phone)).toEqual([]);
  });

  it('a queued GPS area the list left out is weighed against the cloud\'s row, and stays queued when that read fails', async () => {
    const captured: ProjectArea = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 33.9, longitude: -117.9, radiusFeet: 250,
      locationCapturedAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:00:00.000Z' } as ProjectArea;
    const placeholder: ProjectArea = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 0, longitude: 0, radiusFeet: 250,
      updatedAt: '2026-09-08T12:00:00.000Z' } as ProjectArea;
    mockCloud.areas.set('area-1', { record: captured, stamp: (mockCloud.stamp += 1) });
    mockCloud.leftOutOfLists.add('area-1');
    const phone = newDevice('phone');
    on(phone);
    await queueProjectAreaRecord(placeholder);

    mockCloud.readsByIdFail = true;
    const failed = await uploadPendingChanges();
    expect(failed.uploaded).toBe(0);
    expect(await queueOf(phone)).toHaveLength(1);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(captured);

    mockCloud.readsByIdFail = false;
    const result = await uploadPendingChanges();
    expect(result.errors).toEqual([]);
    // The cloud's captured point stands: the placeholder did not go over it.
    expect(mockCloud.areas.get('area-1')!.record).toMatchObject({ latitude: 33.9, longitude: -117.9, locationCapturedAt: '2026-09-09T12:00:00.000Z' });
    expect(await queueOf(phone)).toEqual([]);
  });
});

/* A write only over the row that was weighed --------------------------------------- */
/**
 * Independent review pass 2, item 1 (Low, already in Build 229; the reviewer's directed check D3 and seeds 54, 107,
 * 168, 181, 203). The automatic upload read the task list once and weighed every queued edit of the pass against it.
 * While the phone wrote one queued task, the iPad set the next one's owner; the phone then wrote that task as "the
 * row as listed, with my note": the owner was erased on every device, with no card. A queued edit is now written only
 * if the cloud's row is still the one it was weighed against; refused, the row is read again and the edit weighed
 * again. (Where these tests say the iPad writes, the row is written as the iPad's upload writes it: a second
 * SyncService upload inside the phone's own pass would only wait for it.)
 */
describe('independent review pass 2 (item 1): a queued edit is written only over the row it was weighed against', () => {
  const REFUSED = 'This task changed in the cloud while the sync was running. This copy was not sent over it.';
  /** The phone, with no signal, types a note on two tasks; both wait in its queue. */
  async function twoNotesWaiting() {
    seedTasks(6);
    const phone = newDevice('phone');
    synced(phone);
    at('2026-09-10T09:00:00.000Z');
    await edit(phone, taskId(1), { notes: 'phone note on task 1' }, false);
    await edit(phone, taskId(2), { notes: 'phone note on task 2' }, false);
    expect(await queueOf(phone)).toHaveLength(2);
    at('2026-09-10T12:00:00.000Z');
    mockCloud.log.length = 0;
    on(phone);
    return phone;
  }
  /** Runs `act` on the other queued task while the phone's first task write is on its way; answers which task that was. */
  function duringTheFirstWrite(act: (other: string) => void): { other: string | null } {
    const seen: { other: string | null } = { other: null };
    mockCloud.before = (request, device) => {
      if (seen.other || device !== 'phone' || !request.startsWith('task:write:')) return;
      seen.other = request.endsWith(taskId(1)) ? taskId(2) : taskId(1);
      act(seen.other);
    };
    return seen;
  }

  it('the reviewed case: the iPad sets the second task\'s owner while the phone writes the first: the owner stays, with the phone\'s note, and no card', async () => {
    const phone = await twoNotesWaiting();
    const seen = duringTheFirstWrite(other => ipadWrites(other, { owner: 'Mike (set on the iPad)' }));

    const result = await uploadPendingChanges();

    const other = seen.other!;
    expect(result.errors).toEqual([]);
    expect(shows(cloudTask(other))).toEqual([0, `phone note on task ${other === taskId(1) ? 1 : 2}`, 'Mike (set on the iPad)']);
    expect(await conflictsOf(phone)).toEqual([]);
    expect(await queueOf(phone)).toEqual([]);
    // The write over the listed row was refused; the row was read once more by its id; the second write landed.
    expect(requests(`task:write:${other}`)).toHaveLength(2);
    expect(requests('task:id:')).toEqual([`task:id:${other}`]);
    expect(writesBy(phone)).toHaveLength(2);
  });

  it('the iPad types its own note on that task meanwhile: Review Conflicts asks about the note, and the iPad\'s note is not written over', async () => {
    const phone = await twoNotesWaiting();
    const seen = duringTheFirstWrite(other => ipadWrites(other, { notes: 'iPad note', owner: 'Mike' }));

    await uploadPendingChanges();

    const other = seen.other!;
    expect(shows(cloudTask(other))).toEqual([0, 'iPad note', 'Mike']);
    const conflicts = await conflictsOf(phone);
    expect(conflicts).toEqual([expect.objectContaining({ entity: 'schedule_item', localId: other })]);
    expect(scheduleItemConflictFields(conflicts[0].localPayload)).toEqual(['notes']);
    expect((conflicts[0].remotePayload as ScheduleItem).notes).toBe('iPad note');
  });

  it('a task another device keeps writing is weighed again twice, then waits with a true sentence; the next pass sends it', async () => {
    const phone = await twoNotesWaiting();
    let writes = 0;
    // Before every attempt of the phone to write task 2, the iPad writes it again.
    mockCloud.before = (request, device) => {
      if (device === 'phone' && request === `task:write:${taskId(2)}`) ipadWrites(taskId(2), { owner: `Mike ${writes += 1}` });
    };

    const result = await uploadPendingChanges();

    expect(requests(`task:write:${taskId(2)}`)).toHaveLength(3);
    expect(requests(`task:id:${taskId(2)}`)).toHaveLength(2);
    expect(shows(cloudTask(taskId(2)))).toEqual([0, '', 'Mike 3']);
    const waiting = await queueOf(phone);
    expect(waiting.map(item => [(item.payload as { id: string }).id, item.lastError])).toEqual([[taskId(2), REFUSED]]);
    expect(result.errors.join(' ')).toContain(REFUSED);
    expect(sanitizeUserFacingSyncMessage(REFUSED)).toBe(REFUSED);
    // The iPad stops; the phone's next pass weighs the edit against the row as it is, and it lands with the owner.
    mockCloud.before = null;
    await uploadPendingChanges();
    expect(shows(cloudTask(taskId(2)))).toEqual([0, 'phone note on task 2', 'Mike 3']);
    expect(await queueOf(phone)).toEqual([]);
    expect(await conflictsOf(phone)).toEqual([]);
  });

  it('a task deleted on another device while the pass ran is not sent back as new', async () => {
    const phone = await twoNotesWaiting();
    const seen = duringTheFirstWrite(other => {
      mockCloud.tasks.delete(other);
      mockCloud.tombstones.push({ entityType: 'schedule_item', recordId: other, deletedAt: new Date().toISOString() });
    });

    await uploadPendingChanges();

    const other = seen.other!;
    expect(cloudTask(other)).toBeUndefined();
    expect((await queueOf(phone)).map(item => (item.payload as { id: string }).id)).toEqual([other]);
    // At the next pass its deletion record retires the waiting edit.
    mockCloud.before = null;
    await uploadPendingChanges();
    expect(cloudTask(other)).toBeUndefined();
    expect(await queueOf(phone)).toEqual([]);
  });

  it('it costs nothing when nothing changed: 250 queued edits are 250 writes and no read by id', async () => {
    seedTasks(260);
    const phone = newDevice('phone');
    synced(phone);
    at('2026-09-10T09:00:00.000Z');
    for (let index = 0; index < 250; index += 1) await edit(phone, taskId(index), { notes: `note ${index}` }, false);
    at('2026-09-10T12:00:00.000Z');
    mockCloud.log.length = 0;
    on(phone);

    const result = await uploadPendingChanges();

    expect(result.errors).toEqual([]);
    expect(requests('task:write:')).toHaveLength(250);
    expect(requests('task:id:')).toEqual([]);
    expect(requests('tasks:ids:')).toEqual([]);
    expect(requests('tasks:page:')).toEqual(['tasks:page:0']);
    expect(cloudTask(taskId(249))?.notes).toBe('note 249');
  });

  it('a queued GPS area: a point another device captures while the pass runs is not written over', async () => {
    const listed = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 33.5, longitude: -117.9, radiusFeet: 250,
      locationCapturedAt: '2026-09-08T12:00:00.000Z', updatedAt: '2026-09-08T12:00:00.000Z' } as ProjectArea;
    const mine = { ...listed, latitude: 33.9, locationCapturedAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:00:00.000Z' } as ProjectArea;
    const theirs = { ...listed, latitude: 35.1, locationCapturedAt: '2026-09-10T11:59:00.000Z', updatedAt: '2026-09-10T11:59:00.000Z' } as ProjectArea;
    mockCloud.areas.set('area-1', { record: listed, stamp: (mockCloud.stamp += 1) });
    const phone = newDevice('phone');
    on(phone);
    await queueProjectAreaRecord(mine);
    mockCloud.log.length = 0;
    // The phone's point is newer than the listed row's; before it is written the iPad captures a newer one.
    beforeRequest('area:write:area-1', 1, () => { mockCloud.areas.set('area-1', { record: theirs, stamp: (mockCloud.stamp += 1) }); });

    const result = await uploadPendingChanges();

    expect(result.errors).toEqual([]);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(theirs);
    expect(writesBy(phone)).toEqual([]);
    expect(requests('areas:ids:')).toEqual(['areas:ids:1']);
    expect(await queueOf(phone)).toEqual([]);
    // What a GPS area that keeps changing would wait with reaches the owner as it is.
    const waits = 'This GPS area changed in the cloud while the sync was running. This copy was not sent over it.';
    expect(sanitizeUserFacingSyncMessage(waits)).toBe(waits);
  });

  it('a queued GPS area the cloud has no row for: one another device adds while the pass runs is weighed against, not replaced', async () => {
    const mine = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 33.9, longitude: -117.9, radiusFeet: 250,
      locationCapturedAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:00:00.000Z' } as ProjectArea;
    const theirs = { ...mine, latitude: 35.1, locationCapturedAt: '2026-09-10T11:59:00.000Z', updatedAt: '2026-09-10T11:59:00.000Z' } as ProjectArea;
    const phone = newDevice('phone');
    on(phone);
    await queueProjectAreaRecord(mine);
    mockCloud.log.length = 0;
    beforeRequest('area:write:area-1', 1, () => { mockCloud.areas.set('area-1', { record: theirs, stamp: (mockCloud.stamp += 1) }); });

    const result = await uploadPendingChanges();

    expect(result.errors).toEqual([]);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(theirs);
    expect(writesBy(phone)).toEqual([]);
    expect(await queueOf(phone)).toEqual([]);
  });

  it('Sync Now\'s own write is made the same way: a row written in the moment before it is not replaced, and the sync says so', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const id = taskId(2);
    // The phone's copy is newer and in no queue, so Full Sync sends it.
    setter(phone)(phone.state.map(item => item.id !== id ? item : { ...item, owner: 'Mike', updatedAt: '2026-09-10T07:59:00.000Z' }));
    // After Full Sync read the row again and just as it writes, the iPad writes it.
    beforeRequest(`task:write:${id}`, 1, () => ipadWrites(id, { notes: 'iPad note' }));

    const result = await fullSync(phone);

    expect(shows(cloudTask(id))).toEqual([0, 'iPad note', '']);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([
      '1 task changed in the cloud while this sync was running. This device\'s copy was not sent over it. Sync again to compare the two.',
    ]);
  });
});

/* GPS areas -------------------------------------------------------------------- */
describe('independent review R02: a GPS area the list missed', () => {
  const captured: ProjectArea = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 33.9, longitude: -117.9, radiusFeet: 250,
    locationCapturedAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:00:00.000Z' } as ProjectArea;
  const placeholder: ProjectArea = { id: 'area-1', name: 'North Lot', projectName: 'Alpha', latitude: 0, longitude: 0, radiusFeet: 250,
    updatedAt: '2026-09-08T12:00:00.000Z' } as ProjectArea;

  it('Full Sync does not send the phone\'s placeholder over the point another device captured', async () => {
    mockCloud.areas.set('area-1', { record: captured, stamp: (mockCloud.stamp += 1) });
    mockCloud.leftOutOfLists.add('area-1');
    const phone = newDevice('phone');

    const result = await fullSync(phone, { areas: [placeholder] });

    expect(result.errors).toEqual([]);
    expect(requests('areas:ids:')).toEqual(['areas:ids:1']);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(captured);
    expect(writesBy(phone)).toEqual([]);
  });

  it('a read by id that fails sends nothing and says so', async () => {
    mockCloud.areas.set('area-1', { record: captured, stamp: (mockCloud.stamp += 1) });
    mockCloud.leftOutOfLists.add('area-1');
    mockCloud.readsByIdFail = true;
    const phone = newDevice('phone');

    const result = await fullSync(phone, { areas: [{ ...placeholder, latitude: 34, longitude: -118, locationCapturedAt: '2026-09-10T07:00:00.000Z' } as ProjectArea] });

    expect(mockCloud.areas.get('area-1')!.record).toEqual(captured);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toContain(
      '1 GPS area that the cloud\'s list did not show could not be checked one by one. It was kept on this device and not sent, and will be checked again at the next sync. Network request failed',
    );
  });

  it('a point another device captures after the phone weighed its own is not written over', async () => {
    const earlier = { ...captured, latitude: 33.5, locationCapturedAt: '2026-09-08T12:00:00.000Z', updatedAt: '2026-09-08T12:00:00.000Z' } as ProjectArea;
    const latest = { ...captured, latitude: 35.1, locationCapturedAt: '2026-09-10T07:30:00.000Z', updatedAt: '2026-09-10T07:30:00.000Z' } as ProjectArea;
    mockCloud.areas.set('area-1', { record: earlier, stamp: (mockCloud.stamp += 1) });
    const phone = newDevice('phone');
    // The phone's point is newer than the cloud's when they are weighed; before it is written the iPad captures one.
    beforeRequest('projects:list', 1, () => { mockCloud.areas.set('area-1', { record: latest, stamp: (mockCloud.stamp += 1) }); });

    const result = await fullSync(phone, { areas: [captured] });

    expect(result.errors).toEqual([]);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(latest);
    expect(writesBy(phone)).toEqual([]);
    // Without the iPad's capture the phone's newer point does go up.
    mockCloud.areas.set('area-1', { record: earlier, stamp: (mockCloud.stamp += 1) });
    mockCloud.before = null;
    await fullSync(phone, { areas: [captured] });
    expect(mockCloud.areas.get('area-1')!.record).toMatchObject({ latitude: 33.9, locationCapturedAt: '2026-09-09T12:00:00.000Z' });
  });

  it('an area the cloud really does not have goes up as new', async () => {
    const phone = newDevice('phone');
    const result = await fullSync(phone, { areas: [captured] });
    expect(result.errors).toEqual([]);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(captured);
  });

  // Independent review pass 2 (item 1): Sync Now's own GPS area write is made only over the row it just read, or only
  // if there is still none.
  const AREA_CHANGED = 'GPS area “North Lot” changed in the cloud while this sync was running. This device\'s copy was not sent over it. Sync again to compare the two.';

  it('a point another device captures in the moment Sync Now writes its own is not replaced, and the sync says so', async () => {
    const earlier = { ...captured, latitude: 33.5, locationCapturedAt: '2026-09-08T12:00:00.000Z', updatedAt: '2026-09-08T12:00:00.000Z' } as ProjectArea;
    const latest = { ...captured, latitude: 35.1, locationCapturedAt: '2026-09-10T07:30:00.000Z', updatedAt: '2026-09-10T07:30:00.000Z' } as ProjectArea;
    mockCloud.areas.set('area-1', { record: earlier, stamp: (mockCloud.stamp += 1) });
    const phone = newDevice('phone');
    // The phone's point is newer than the row it read again; just as it writes, the iPad captures a newer one.
    beforeRequest('area:write:area-1', 1, () => { mockCloud.areas.set('area-1', { record: latest, stamp: (mockCloud.stamp += 1) }); });

    const result = await fullSync(phone, { areas: [captured] });

    expect(mockCloud.areas.get('area-1')!.record).toEqual(latest);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([AREA_CHANGED]);
    expect(sanitizeUserFacingSyncMessage(AREA_CHANGED)).toBe(AREA_CHANGED);
    // The next sync weighs the two: the iPad's point is the newer, so nothing is sent and nothing is reported.
    mockCloud.before = null;
    const again = await fullSync(phone, { areas: [captured] });
    expect(again.errors).toEqual([]);
    expect(mockCloud.areas.get('area-1')!.record).toEqual(latest);
  });

  it('an area another device adds in the moment before the phone sends its own as new is left as it is', async () => {
    const theirs = { ...captured, latitude: 35.1, locationCapturedAt: '2026-09-10T07:30:00.000Z', updatedAt: '2026-09-10T07:30:00.000Z' } as ProjectArea;
    const phone = newDevice('phone');
    beforeRequest('area:write:area-1', 1, () => { mockCloud.areas.set('area-1', { record: theirs, stamp: (mockCloud.stamp += 1) }); });

    const result = await fullSync(phone, { areas: [captured] });

    expect(mockCloud.areas.get('area-1')!.record).toEqual(theirs);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([AREA_CHANGED]);
  });
});

/* Field updates --------------------------------------------------------------- */
describe('independent review R02: a field update the list missed', () => {
  const update = (index: number, patch: Partial<ProjectUpdate> = {}): ProjectUpdate => ({
    id: `update-${String(index).padStart(4, '0')}`, projectId: MOCK_PROJECT_ID, projectName: 'Alpha', date: '2026-09-07', photos: [],
    notes: `Pour ${index}`, recipients: { contactIds: [] }, selectedAreaId: 'area-0', selectedAreaName: 'Area 0', status: 'sent',
    ...patch,
  });
  /** 502 sent updates in the cloud, the phone holding the same; an update is listed by when it was created. */
  function seedUpdates(count: number): ProjectUpdate[] {
    const all = Array.from({ length: count }, (_, index) => update(index));
    all.forEach((item, index) => mockCloud.updates.set(item.id, { created: count - index, updatedAt: T0, updateData: mockCopy(item) }));
    return all;
  }
  const cloudNote = (id: string) => (mockCloud.updates.get(id)?.updateData as ProjectUpdate | undefined)?.notes;
  /** The iPad's edit of an update, as its upload writes it. */
  const ipadEdits = (id: string, notes: string) => {
    const current = mockCloud.updates.get(id)!;
    mockCloud.updates.set(id, { ...current, updatedAt: new Date().toISOString(), updateData: { ...current.updateData, notes } });
    mockCloud.writes.push(`ipad:update:${id}`);
  };
  const LATE_UPDATE = 'update-0501';

  it('an update the list left out, the same on both sides: nothing is rewritten and nothing is asked', async () => {
    const all = seedUpdates(502);
    const phone = newDevice('phone');
    // An earlier update deleted on another device while the list is read slides the last one out of the pages; with
    // Build 229's reading the list still says ok.
    mockCloud.listsReadAsBuild229 = true;
    beforeRequest('updates:page:500', 1, () => { mockCloud.updates.delete('update-0010'); });

    const result = await fullSync(phone, { updates: all.filter(item => item.id !== 'update-0010') });

    expect(result.errors).toEqual([]);
    expect(writesBy(phone)).toEqual([]);
    expect(await conflictsOf(phone)).toEqual([]);
    expect(await queueOf(phone)).toEqual([]);
    expect(cloudNote(LATE_UPDATE)).toBe('Pour 501');
  });

  /**
   * During the phone's download an earlier update is deleted on the iPad, so the last one slides out of the pages, and
   * the iPad edits that last one; after the phone's reconciliation and before its write, the iPad edits it again.
   */
  function ipadEditsTwice() {
    beforeRequest('updates:page:500', 1, () => {
      mockCloud.updates.delete('update-0010');
      ipadEdits(LATE_UPDATE, 'Pour 501, inspector on site');
    });
    beforeRequest('projects:list', 1, () => ipadEdits(LATE_UPDATE, 'Pour 501, inspector signed off'));
  }

  it.each(LIST_READINGS)('the iPad edits it during the download and again before the phone writes: the phone\'s older sent copy does not go over it (%s)', async (_label, build229) => {
    const all = seedUpdates(502);
    const phone = newDevice('phone');
    at('2026-09-10T12:00:00.000Z');
    mockCloud.listsReadAsBuild229 = build229;
    ipadEditsTwice();

    const result = await fullSync(phone, { updates: all.filter(item => item.id !== 'update-0010') });

    // The newer note survives; nothing of the phone's was sent, and there is nothing to ask: only the iPad changed it.
    expect(cloudNote(LATE_UPDATE)).toBe('Pour 501, inspector signed off');
    expect(writesBy(phone)).toEqual([]);
    expect(await conflictsOf(phone)).toEqual([]);
    expect(await queueOf(phone)).toEqual([]);
    expect(result.errors).toEqual([]);
    // The update was read by its id before anything was decided.
    expect(requests(`update:id:${LATE_UPDATE}`).length).toBeGreaterThanOrEqual(1);
  });

  it.each(LIST_READINGS)('with David\'s own edit of it waiting on the phone: Review Conflicts asks, and the iPad\'s newest note stays (%s)', async (_label, build229) => {
    const all = seedUpdates(502);
    const phone = newDevice('phone');
    // Offline on the phone: David opens the update and changes its note. The edit waits, with the copy it started from.
    at('2026-09-10T09:00:00.000Z');
    on(phone);
    const opened = all.find(item => item.id === LATE_UPDATE)!;
    await noteFieldUpdateEditOpened(opened);
    const edited: ProjectUpdate = { ...opened, notes: 'Pour 501, crew short', status: 'queued' };
    await queueProjectUpdateRecord(edited, false);
    at('2026-09-10T12:00:00.000Z');
    mockCloud.listsReadAsBuild229 = build229;
    ipadEditsTwice();

    await fullSync(phone, { updates: all.filter(item => item.id !== 'update-0010').map(item => item.id === LATE_UPDATE ? edited : item) });

    expect(cloudNote(LATE_UPDATE)).toBe('Pour 501, inspector signed off');
    expect(writesBy(phone)).toEqual([]);
    const conflicts = await conflictsOf(phone);
    expect(conflicts).toEqual([expect.objectContaining({ entity: 'project_update', localId: LATE_UPDATE })]);
    expect(((conflicts[0].localPayload as { updateData: ProjectUpdate }).updateData).notes).toBe('Pour 501, crew short');
    // The card was made when the phone's waiting edit met the iPad's first note; Review Conflicts reads the cloud's
    // copy again when it opens, and shows the note the iPad left last.
    expect((conflicts[0].remotePayload as ProjectUpdate).notes).toBe('Pour 501, inspector on site');
    on(phone);
    const shown = await refreshFieldUpdateConflictCloudCopies();
    expect((shown[0].remotePayload as ProjectUpdate).notes).toBe('Pour 501, inspector signed off');
  });
});

/* Projects --------------------------------------------------------------------- */
describe('independent review R02: a project neither cloud list returned', () => {
  const service = () => jest.requireMock('../../services/SupabaseService') as Record<string, unknown>;
  const local = [{ id: 'p-1', name: 'Alpha' }, { id: 'p-2', name: 'Bravo' }, { id: null, name: 'Not uploaded yet' }];
  const cloud = (id: string, name: string, archived = false) => ({ id, name, archived, status: null, isFavorite: null, createdAt: null, updatedAt: null, ownerId: null, data: null });

  it('is read by its id, and goes back in the list it belongs to', async () => {
    const asked: string[][] = [];
    service().getProjectsByIds = async (ids: string[]) => { asked.push(ids); return mockOk([cloud('p-2', 'Bravo', true)]); };
    // Bravo was closed on another device between the read of open projects and the read of closed ones.
    const missed = await cloudProjectsMissedByLists(local, [cloud('p-1', 'Alpha')], []);
    expect(asked).toEqual([['p-2']]);
    expect(missed).toEqual({ active: [], archived: [cloud('p-2', 'Bravo', true)] });
  });

  it('nothing is read when both lists account for every cloud project this device holds', async () => {
    let asked = 0;
    service().getProjectsByIds = async () => { asked += 1; return mockOk([]); };
    // A project renamed on another device is found by its id in the list.
    expect(await cloudProjectsMissedByLists(local, [cloud('p-1', 'Alpha'), cloud('p-2', 'Bravo Tower')], [])).toEqual({ active: [], archived: [] });
    expect(asked).toBe(0);
  });

  it('a project the cloud no longer has is not returned: it was deleted on another device', async () => {
    service().getProjectsByIds = async () => mockOk([]);
    expect(await cloudProjectsMissedByLists(local, [cloud('p-1', 'Alpha')], [])).toEqual({ active: [], archived: [] });
  });

  it('when the read fails nothing may be removed: the refresh is incomplete', async () => {
    service().getProjectsByIds = async () => mockDown();
    expect(await cloudProjectsMissedByLists(local, [cloud('p-1', 'Alpha')], [])).toBeNull();
    service().getProjectsByIds = async () => { throw new Error('Network request failed'); };
    expect(await cloudProjectsMissedByLists(local, [cloud('p-1', 'Alpha')], [])).toBeNull();
  });

  it('App.tsx asks before it takes a project as deleted, and stops the refresh when it cannot', () => {
    const refresh = appSlice("if (projectsLoaded && shouldRefresh('projects'))", 'const reconciled = reconcileDAVEOperationalProjects({');
    expect(refresh).toContain('const missed = await cloudProjectsMissedByLists(projectRecordsCurrentRef.current, activeProjectsResult.data, archivedProjectsResult.data);');
    expect(refresh).toContain("if (!missed) throw new Error('project_refresh_incomplete');");
    expect(refresh).toContain('[...activeProjectsResult.data, ...missed.active]');
    expect(refresh).toContain('[...archivedProjectsResult.data, ...missed.archived]');
  });
});

/* Sync batch Y1 --------------------------------------------------------------------- */

/**
 * Left open by R02 (its notes, item 3): Full Sync creates a project whose name is not in the cloud's OPEN list. One
 * that is CLOSED in the cloud under that name (closed on another device, which this one has not heard yet) was made
 * again as a second, open project; everything of the project then stopped uploading with "project identity
 * ambiguous". The queue's own create has asked both lists since audit A3 pass 2. Full Sync asks the same function.
 */
describe('sync batch Y1 (item 1): Full Sync does not make a second copy of a project that is closed in the cloud', () => {
  const projectWrites = () => mockCloud.writes.filter(write => write.includes(':project:'));

  it('a project closed in the cloud and still open on this device is not created again', async () => {
    const phone = newDevice('phone');
    mockCloud.closedProjects = [{ id: 'p-bravo', name: 'Bravo Tower' }];

    const result = await fullSync(phone, { projects: ['Alpha', 'Bravo Tower'] });

    // It was created: the cloud then held "Bravo Tower" twice, one closed and one open.
    expect(projectWrites()).toEqual([]);
    expect(mockCloud.openProjects.map(project => project.name)).toEqual(['Alpha']);
    expect(result.errors).toEqual([]);
  });

  it('the name is matched as the queue matches it: letter case and outer spaces aside', async () => {
    const phone = newDevice('phone');
    mockCloud.closedProjects = [{ id: 'p-bravo', name: 'bravo tower ' }];

    await fullSync(phone, { projects: ['Alpha', ' Bravo Tower'] });

    expect(projectWrites()).toEqual([]);
  });

  it('a project the cloud has in neither list is created, once, as before', async () => {
    const phone = newDevice('phone');

    const result = await fullSync(phone, { projects: ['Alpha', 'Bravo Tower'] });

    expect(projectWrites()).toEqual(['phone:project:Bravo Tower']);
    expect(result.errors).toEqual([]);
    expect(result.details.projectsUploaded).toBe(1);
  });

  it('when the list of closed projects cannot be read the project is not created, and the sync says so', async () => {
    const phone = newDevice('phone');
    mockCloud.closedProjects = [{ id: 'p-bravo', name: 'Bravo Tower' }];
    mockCloud.closedProjectsFail = true;

    const result = await fullSync(phone, { projects: ['Alpha', 'Bravo Tower'] });

    expect(projectWrites()).toEqual([]);
    expect(result.errors).toEqual(['Project “Bravo Tower” could not sync. Network request failed']);

    // The list answers again: still not created, and nothing more to say.
    mockCloud.closedProjectsFail = false;
    const next = await fullSync(phone, { projects: ['Alpha', 'Bravo Tower'] });
    expect(projectWrites()).toEqual([]);
    expect(next.errors).toEqual([]);
  });

  it('the queue\'s own create gives the same answer (a guard: one question, asked the same way by both)', async () => {
    newDevice('phone');
    mockCloud.closedProjects = [{ id: 'p-bravo', name: 'Bravo Tower' }];
    await queueProjectCreate('Bravo Tower');

    const result = await uploadPendingChanges();

    expect(projectWrites()).toEqual([]);
    expect(result.errors).toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('Full Sync asks that question through the queue\'s function, not a second copy of it', () => {
    const SYNC = fs.readFileSync(path.resolve(__dirname, '../../services/SyncService.ts'), 'utf8');
    const fullSyncSource = SYNC.slice(SYNC.indexOf('export async function synchronizeLocalData('), SYNC.indexOf('\nexport ', SYNC.indexOf('export async function synchronizeLocalData(') + 10));
    expect(fullSyncSource).toContain('await cloudProjectNameExists(normalizedName)');
    expect(fullSyncSource).not.toContain('listArchivedProjects(');
    // Three known places ask the cloud for closed projects: the name check, a field update's closed project, and
    // (sync batch Y4, item 3) what to tell him when the project his new task belongs to was closed elsewhere while
    // this phone's create waited. A fourth would be a copy: use one of these.
    expect(SYNC.split('listArchivedProjects()').length - 1).toBe(3);
  });
});

/**
 * Left open by R02 (its notes, item 5): the deletion history is read once, when a sync starts. A task deleted on
 * another device in the seconds after that read has no row any more and no deletion record this device has heard
 * of, so it read as new to the cloud and was sent back; the next sync took it away again. The history is now asked
 * once more for just the ids about to be created.
 */
describe('sync batch Y1 (item 2): a record deleted on another device after this sync read the deletion history is not sent back', () => {
  const captured = { id: 'area-1', projectName: 'Alpha', name: 'North Lot', latitude: 33.9, longitude: -118.2, radiusFeet: 100,
    locationCapturedAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:00:00.000Z' } as unknown as ProjectArea;
  /** The iPad deletes the task just after the phone has read the deletion history: before the phone lists the cloud's tasks. */
  function ipadDeletesAfterTheHistoryWasRead(id: string) {
    beforeRequest('tasks:page:0', 1, () => {
      mockCloud.tasks.delete(id);
      mockCloud.tombstones.push({ entityType: 'schedule_item', recordId: id, deletedAt: new Date().toISOString() });
      mockCloud.writes.push(`ipad:delete:${id}`);
    });
  }

  it('the task is not written back, nothing is reported, and the next sync takes it off this device', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const doomed = taskId(2);
    ipadDeletesAfterTheHistoryWasRead(doomed);
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    // It was sent back as a new task: the cloud had it again, on every device, until the next sync.
    expect(cloudTask(doomed)).toBeUndefined();
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([]);
    // One question, about the one task that was about to be created.
    expect(requests('tombstones:ids:')).toEqual(['tombstones:ids:1']);

    mockCloud.before = null;
    await fullSync(phone);
    expect(onDevice(phone, doomed)).toBeUndefined();
    expect(cloudTask(doomed)).toBeUndefined();
    expect(writesBy(phone)).toEqual([]);
  });

  it('a deletion record that keeps the id in another letter case is still found', async () => {
    seedTasks(1);
    const phone = newDevice('phone');
    synced(phone);
    const made = task(900, { id: 'MASTER F-9' });
    setter(phone)([...phone.state, made]);
    mockCloud.tombstones.push({ entityType: 'project_area', recordId: 'MASTER F-9', deletedAt: T0 }); // another kind of record: not this task
    beforeRequest('tasks:page:0', 1, () => { mockCloud.tombstones.push({ entityType: 'schedule_item', recordId: 'master f-9', deletedAt: new Date().toISOString() }); });

    await fullSync(phone);

    expect(cloudTask('MASTER F-9')).toBeUndefined();
    expect(writesBy(phone)).toEqual([]);
  });

  it('a task that really is new still goes up, after one question for it', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    setter(phone)([...phone.state, task(900, { notes: 'Made on the phone' })]);
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    expect(result.errors).toEqual([]);
    expect(shows(cloudTask(taskId(900)))).toEqual([0, 'Made on the phone', '']);
    expect(writesBy(phone)).toEqual([`phone:task:${taskId(900)}`]);
    expect(requests('tombstones:ids:')).toEqual(['tombstones:ids:1']);
  });

  it('when the deletion history cannot be asked the task is not sent, the sync says so, and the next sync sends it', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    setter(phone)([...phone.state, task(900, { notes: 'Made on the phone' })]);
    mockCloud.deletionChecksFail = true;

    const result = await fullSync(phone);

    const NOT_SENT = 'Schedule task “Task 900” was not sent. Whether it was deleted on another device could not be checked just before sending, so this device\'s copy was kept here and will be checked again at the next sync. Network request failed';
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([NOT_SENT]);
    expect(onDevice(phone, taskId(900))).toMatchObject({ notes: 'Made on the phone' });

    mockCloud.deletionChecksFail = false;
    const next = await fullSync(phone);
    expect(next.errors).toEqual([]);
    expect(writesBy(phone)).toEqual([`phone:task:${taskId(900)}`]);
  });

  it('a GPS area deleted on another device in that moment is not sent back either', async () => {
    const phone = newDevice('phone');
    beforeRequest('areas:page:0', 1, () => { mockCloud.tombstones.push({ entityType: 'project_area', recordId: 'area-1', deletedAt: new Date().toISOString() }); });
    mockCloud.log.length = 0;

    const result = await fullSync(phone, { areas: [captured] });

    expect(mockCloud.areas.has('area-1')).toBe(false);
    expect(writesBy(phone)).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(requests('tombstones:ids:')).toEqual(['tombstones:ids:1']);
  });

  it('a task whose row another device changed is weighed as before: the deletion history is not asked about it', async () => {
    seedTasks(3);
    const phone = newDevice('phone');
    synced(phone);
    const id = taskId(1);
    setter(phone)(phone.state.map(item => item.id !== id ? item : { ...item, owner: 'Mike', updatedAt: '2026-09-10T07:59:00.000Z' }));
    mockCloud.log.length = 0;

    const result = await fullSync(phone);

    expect(result.errors).toEqual([]);
    expect(writesBy(phone)).toEqual([`phone:task:${id}`]);
    expect(requests('tombstones:ids:')).toEqual([]);
  });
});

/* The everyday trigger ------------------------------------------------------------ */
describe('independent review pass 2 (item 4): another device sending task after task does not stop this device\'s reads', () => {
  it('Full Sync reads its lists whole while every page is preceded by another device\'s write, and sends the phone\'s change', async () => {
    seedTasks(1200);
    const phone = newDevice('phone');
    synced(phone);
    setter(phone)(phone.state.map(item => item.id !== LATE ? item : { ...item, owner: 'Mike', updatedAt: '2026-09-10T07:59:00.000Z' }));
    // An approved schedule going up from the iPad: before each page the phone asks for, one more of its tasks is
    // written, the oldest row first (read by offset, newest first, that row and its neighbours slid every time, and
    // the read failed three times and gave up).
    let written = 0;
    mockCloud.before = (request, device) => {
      if (device !== 'phone' || !request.startsWith('tasks:page:')) return;
      const oldest = [...mockCloud.tasks.values()].filter(row => row.record.id !== LATE).sort((left, right) => left.stamp - right.stamp)[0];
      mockCloud.tasks.set(oldest.record.id, { record: { ...oldest.record, notes: `row ${written += 1} of the new master`, updatedAt: new Date().toISOString() }, stamp: (mockCloud.stamp += 1) });
    };

    const result = await fullSync(phone);

    expect(written).toBeGreaterThanOrEqual(6);
    expect(result.errors).toEqual([]);
    expect(result.downloadStatus).toBe('complete');
    expect(result.recovered.scheduleItems).toHaveLength(1200);
    expect(cloudTask(LATE)?.owner).toBe('Mike');
    expect(phone.state).toHaveLength(1200);
    // Every row the iPad wrote is on the phone, as it wrote it.
    expect(phone.state.filter(item => /of the new master$/.test(item.notes || ''))).toHaveLength(written);
  });

  it('what a list that could not be read says reaches the owner as it is', () => {
    expect(sanitizeUserFacingSyncMessage(SUPABASE_COLLECTION_CHANGED_WHILE_READ)).toBe(SUPABASE_COLLECTION_CHANGED_WHILE_READ);
    expect(sanitizeUserFacingSyncMessage(`${SUPABASE_COLLECTION_CHANGED_WHILE_READ} (2000 rows where 2001 were counted)`))
      .toBe(`${SUPABASE_COLLECTION_CHANGED_WHILE_READ} (2000 rows where 2001 were counted)`);
    expect(sanitizeUserFacingSyncMessage(SUPABASE_COLLECTION_KEY_OUT_OF_ORDER)).toBe(SUPABASE_COLLECTION_KEY_OUT_OF_ORDER);
    // And what a cloud that caps its answers below the page size is refused with (independent review pass 3, P3-3).
    expect(sanitizeUserFacingSyncMessage(SUPABASE_COLLECTION_ANSWER_CAPPED)).toBe(SUPABASE_COLLECTION_ANSWER_CAPPED);
  });

  it('the literal the photo-path script pins is still in SyncService', () => {
    const sync = fs.readFileSync(path.resolve(__dirname, '../../services/SyncService.ts'), 'utf8');
    expect(sync).toContain('projectUpdateWithCloudPhotoPaths(update)');
  });
});
