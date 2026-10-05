// Whole-app audit A3 pass 6 M1 (30 Sep 2026): Add Task saved a task under a
// project the cloud has no open project for (a typed new name, a closed
// project), and the task never uploaded while the save said other devices
// would get it. The real uploadPendingChanges against a mocked cloud, and
// App.tsx addScheduleItem / syncScheduleItemRevision compiled with it.
import type { ScheduleItem } from '../../types';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  },
}));

const mockLot5Id = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const mockMainStId = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const mockOk = <T,>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockUpsertScheduleItem = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true, configured: true, stubbed: false }));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  // Lot 5 is open; 2375 Main St was closed.
  listProjects: () => mockOk([{ id: mockLot5Id, name: 'Lot 5' }]),
  listArchivedProjects: () => mockOk([{ id: mockMainStId, name: '2375 Main St' }]),
  listDAVESyncTombstones: () => mockOk([]),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => mockOk(tombstones),
  listScheduleItems: () => mockOk([]),
  // Independent review R02: a queued task the list does not hold is read by its id before it is sent as new.
  getScheduleItem: () => mockOk(null),
  upsertScheduleItem: (...args: unknown[]) => mockUpsertScheduleItem(...args),
  listReferenceDocuments: () => mockOk([]),
  listDAVEStorageCleanupIntents: () => mockOk([]),
  removeProtectedStorageObject: () => mockOk(null),
  recordDAVEStorageCleanupAttempt: () => mockOk(null),
}));

import { getOfflineQueue, runScheduleItemCloudSync, uploadPendingChanges } from '../../services/SyncService';
import {
  checkScheduleTaskProject,
  defaultScheduleTaskProject,
  openScheduleTaskProjects,
  scheduleTaskSaveNotice,
} from '../../services/ScheduleTaskProject';

// The phone's lists: a refresh keeps a closed project on the project list
// as well as the closed list (see audit-a3-pass5-names-and-wording).
const projects = ['2375 Main St', 'Lot 5'];
const closedProjects = ['2375 Main St'];
const projectRecords = [{ id: mockMainStId, name: '2375 Main St' }, { id: mockLot5Id, name: 'Lot 5' }];

function task(id: string, projectName: string, extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, itemType: 'Task', projectName, locationName: '', taskName: `Task ${id}`, startDate: '', finishDate: '',
    milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started',
    notes: '', nextAction: '', activity: [], createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z',
    ...extra,
  } as ScheduleItem;
}

beforeEach(() => {
  mockStorage.clear();
  mockUpsertScheduleItem.mockClear();
});

describe('the finding: a task under a project the cloud has no open project for never uploads', () => {
  it.each([
    ['a typed new name', task('typed', 'Lot 9 Typed'), 'The cloud project “Lot 9 Typed” could not be found'],
    ['a closed project by name', task('closed-name', '2375 Main St'), 'The cloud project “2375 Main St” could not be found'],
    ['a closed project by id', task('closed-id', '2375 Main St', { projectId: mockMainStId }), 'no longer matches an active cloud project'],
  ])('%s stays queued after both passes with a project-identity refusal', async (_label, saved, error) => {
    const result = await runScheduleItemCloudSync(saved);
    expect([result.uploaded, result.queued]).toEqual([0, 1]);
    expect(result.errors.join(' ')).toContain(error);
    // The next pass (the app retries on its own) refuses it again.
    expect((await uploadPendingChanges()).uploaded).toBe(0);
    const queue = await getOfflineQueue();
    expect(queue.map(item => [item.id, item.retryCount])).toEqual([[`schedule-item-${saved.id}`, 2]]);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
  });
});

describe('Add Task offers and accepts open projects only', () => {
  it('offers open projects, and defaults to the project in view or else the first open one', () => {
    expect(openScheduleTaskProjects({ projects, closedProjects })).toEqual(['Lot 5']);
    // The newest project was just closed: it is no longer the default.
    expect(defaultScheduleTaskProject({ projects, closedProjects })).toBe('Lot 5');
    expect(defaultScheduleTaskProject({ projects: ['Lot 5', 'Tower B'], closedProjects, projectInView: 'tower b' })).toBe('Tower B');
    expect(defaultScheduleTaskProject({ projects, closedProjects, projectInView: '2375 Main St' })).toBe('Lot 5');
    expect(defaultScheduleTaskProject({ projects: ['2375 Main St'], closedProjects })).toBe('');
  });

  it('refuses a typed new name, a closed project by name and by id; takes an open one as its exact name', () => {
    const check = (projectName: string) =>
      checkScheduleTaskProject({ projectName, projects, closedProjects, projectRecords });
    expect(check('Lot 9 Typed')).toEqual({
      ok: false, reason: 'unknown', title: 'Project not found',
      message: 'No open project is named “Lot 9 Typed”. Choose one from the list, or add it first with Add project on Overview.',
    });
    const closedMessage = '2375 Main St is closed. Reopen it on Overview to add tasks.';
    expect(check('2375 main st')).toMatchObject({ ok: false, reason: 'closed', message: closedMessage });
    expect(check(mockMainStId)).toMatchObject({ ok: false, reason: 'closed', message: closedMessage });
    expect(check('   ')).toMatchObject({ ok: false, reason: 'empty' });
    expect(check('  lot   5 ')).toEqual({ ok: true, projectName: 'Lot 5' });
    expect(check(mockLot5Id)).toEqual({ ok: true, projectName: 'Lot 5' });
  });
});

describe('App.tsx addScheduleItem and syncScheduleItemRevision, compiled with the real queue', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const ts = jest.requireActual('typescript') as typeof import('typescript');
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

  function compile() {
    const start = app.indexOf('\n  function addScheduleItem(') + 1;
    const end = app.indexOf('\n  function cancelScheduleItemTextSync(', start);
    const runs: Promise<unknown>[] = [];
    const alert = jest.fn();
    const scheduleItemsCurrentRef = { current: [] as ScheduleItem[] };
    let id = 0;
    const deps: Record<string, unknown> = {
      uid: () => `new-${++id}`, displayName: 'PM', normalizeScheduleItem: (value: Partial<ScheduleItem>) => task(String(value.id), String(value.projectName), value),
      markScheduleItemsAuthorityReady: jest.fn(), scheduleItemsCurrentRef, setScheduleItems: jest.fn(),
      advanceScheduleItemSyncGeneration: () => 1, scheduleItemSyncGenerationsRef: { current: new Map([['new-1', 1], ['edited', 1]]) },
      runScheduleItemCloudSync: (...args: Parameters<typeof runScheduleItemCloudSync>) => {
        const run = runScheduleItemCloudSync(...args);
        runs.push(run);
        return run;
      },
      settleScheduleItemTextSync: jest.fn(), scheduleItemTextSyncLifecycleRef: { current: {} },
      scheduleItemSyncWarningsRef: { current: new Set<string>() }, requestPendingChangesUpload: jest.fn(),
      Alert: { alert },
      // Added by this fix.
      checkScheduleTaskProject, scheduleTaskSaveNotice,
      projectsCurrentRef: { current: projects }, archivedProjectsCurrentRef: { current: closedProjects },
      projectRecordsCurrentRef: { current: projectRecords },
    };
    const js = ts.transpileModule(
      `module.exports = (() => { ${app.slice(start, end)}\nreturn { addScheduleItem, syncScheduleItemRevision }; })()`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const mod = { exports: {} as unknown };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    const fns = mod.exports as {
      addScheduleItem: (item: Partial<ScheduleItem>) => unknown;
      syncScheduleItemRevision: (item: ScheduleItem, generation?: number) => Promise<boolean>;
    };
    const settled = async () => {
      await Promise.all(runs);
      await new Promise(resolve => setImmediate(resolve));
    };
    return { ...fns, alert, scheduleItemsCurrentRef, settled };
  }

  it.each([
    ['a typed new name', 'Lot 9 Typed', 'No open project is named “Lot 9 Typed”.'],
    ['a closed project', '2375 Main St', '2375 Main St is closed. Reopen it on Overview to add tasks.'],
    ['a closed project by its id', mockMainStId, '2375 Main St is closed. Reopen it on Overview to add tasks.'],
  ])('refuses %s: nothing is saved or queued', async (_label, projectName, message) => {
    const app = compile();
    expect(app.addScheduleItem({ taskName: 'Stripe lot', projectName })).toBe(false);
    await app.settled();
    expect(app.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(message));
    expect(app.scheduleItemsCurrentRef.current).toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('saves a typed open project under its exact name, and it uploads', async () => {
    const app = compile();
    expect(app.addScheduleItem({ taskName: 'Stripe lot', projectName: '  lot 5 ' })).not.toBe(false);
    await app.settled();
    expect(app.scheduleItemsCurrentRef.current.map(item => item.projectName)).toEqual(['Lot 5']);
    // Written only if the cloud still has no row for it (independent review R02).
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ projectName: 'Lot 5', projectId: mockLot5Id }), { onlyIfAbsent: true });
    await expect(getOfflineQueue()).resolves.toEqual([]);
    expect(app.alert).not.toHaveBeenCalled();
  });

  it('does not say "still retrying" when the task\'s project is not open in the cloud', async () => {
    // An edit to a task of a project closed on another device.
    const app = compile();
    const edited = task('edited', '2375 Main St');
    app.scheduleItemsCurrentRef.current = [edited];
    await expect(app.syncScheduleItemRevision(edited, 1)).resolves.toBe(false);
    expect(app.alert).toHaveBeenCalledWith(
      'Task saved on this device only',
      '“2375 Main St” is not an open project in the cloud, so other devices will not get this task. It uploads once the project is open: reopen it on Overview if it was closed.',
    );
    expect(JSON.stringify(app.alert.mock.calls)).not.toContain('still retrying');
  });

  it('still says "still retrying" for a failure a retry can clear', async () => {
    mockUpsertScheduleItem.mockResolvedValue({ ok: false, configured: true, stubbed: false });
    try {
      const app = compile();
      const edited = task('edited', 'Lot 5');
      app.scheduleItemsCurrentRef.current = [edited];
      await expect(app.syncScheduleItemRevision(edited, 1)).resolves.toBe(false);
      expect(app.alert).toHaveBeenCalledWith(
        'Task saved on this device',
        'Vitruvius is still retrying this task’s cloud sync. Other devices will update after the cloud accepts it.',
      );
    } finally {
      mockUpsertScheduleItem.mockImplementation(() => Promise.resolve({ ok: true, configured: true, stubbed: false }));
    }
  });
});
