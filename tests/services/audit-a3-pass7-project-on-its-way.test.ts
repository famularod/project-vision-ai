// Whole-app audit A3 pass 7 L1 (30 Sep 2026): on weak signal David added
// project "Lot 9" (or reopened "Main St") and its first upload failed. When
// signal returned he added a task, and the save said "Task saved on this
// device only ... “Lot 9” is not an open project in the cloud" although the
// project is open on his phone and the task uploaded on its own a few passes
// later. A task is sent ahead of project changes, so until the project's own
// create or reopen lands the cloud answers that the project is not open. The
// real uploadPendingChanges against a mocked cloud, and App.tsx
// addScheduleItem / syncScheduleItemRevision compiled with it.
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

// Passes run only when a test runs them, as the app's retry timer would.
jest.mock('../../services/BackgroundTaskGuard', () => ({
  ...jest.requireActual('../../services/BackgroundTaskGuard'),
  startGuardedBackgroundTask: jest.fn(),
}));

type CloudProject = { id: string; name: string };
const mockLot5Id = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const mockMainStId = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const mockLot9Id = '3c9a1f4e-2b7d-4e8a-9f1c-5d6e7f8a9b0c';
// The cloud as the mocked calls change it; offline, every call fails.
let mockOnline = true;
let mockOpen: CloudProject[] = [];
let mockClosed: CloudProject[] = [];
const mockAnswer = <T,>(data: T) => Promise.resolve(mockOnline
  ? { ok: true, configured: true, stubbed: false, data }
  : { ok: false, configured: true, stubbed: false, error: 'Network request failed' });
const mockUpsertScheduleItem = jest.fn((..._args: unknown[]) => mockAnswer(null));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  listProjects: () => mockAnswer([...mockOpen]),
  listArchivedProjects: () => mockAnswer([...mockClosed]),
  createProject: (project: { name: string }) => {
    if (mockOnline) mockOpen.push({ id: mockLot9Id, name: project.name });
    return mockAnswer(project);
  },
  updateProject: (project: { previousName?: string; archived?: boolean }) => {
    const key = String(project.previousName).toLowerCase();
    const reopened = mockClosed.find(candidate => candidate.name.toLowerCase() === key);
    if (mockOnline && project.archived === false && reopened) {
      mockClosed = mockClosed.filter(candidate => candidate !== reopened);
      mockOpen.push(reopened);
    }
    return mockAnswer(reopened || null);
  },
  listDAVESyncTombstones: () => mockAnswer([]),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => mockAnswer(tombstones),
  listScheduleItems: () => mockAnswer([]),
  // Independent review R02: a queued task the list does not hold is read by its id before it is sent as new.
  getScheduleItem: () => mockAnswer(null),
  upsertScheduleItem: (...args: unknown[]) => mockUpsertScheduleItem(...args),
  listReferenceDocuments: () => mockAnswer([]),
  listDAVEStorageCleanupIntents: () => mockAnswer([]),
  removeProtectedStorageObject: () => mockAnswer(null),
  recordDAVEStorageCleanupAttempt: () => mockAnswer(null),
}));

import {
  getOfflineQueue,
  queueProjectCreate,
  queueProjectUpdate,
  runScheduleItemCloudSync,
  uploadPendingChanges,
} from '../../services/SyncService';
import { checkScheduleTaskProject, scheduleTaskSaveNotice } from '../../services/ScheduleTaskProject';

const ON_ITS_WAY = (name: string) => `“${name}” is still on its way to the cloud. The task uploads right after it.`;
const DEVICE_ONLY = (name: string) =>
  `“${name}” is not an open project in the cloud, so other devices will not get this task. It uploads once the project is open: reopen it on Overview if it was closed.`;
const STILL_RETRYING = 'Vitruvius is still retrying this task’s cloud sync. Other devices will update after the cloud accepts it.';

function task(id: string, projectName: string, extra: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id, itemType: 'Task', projectName, locationName: '', taskName: `Task ${id}`, startDate: '', finishDate: '',
    milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started',
    notes: '', nextAction: '', activity: [], createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z',
    ...extra,
  } as ScheduleItem;
}

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const appSource = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** App.tsx addScheduleItem .. syncScheduleItemRevision, with the phone's project lists. */
function compileApp(phone: { projects: string[]; closedProjects: string[] }) {
  const start = appSource.indexOf('\n  function addScheduleItem(') + 1;
  const end = appSource.indexOf('\n  function cancelScheduleItemTextSync(', start);
  const runs: Promise<unknown>[] = [];
  const alert = jest.fn();
  const scheduleItemsCurrentRef = { current: [] as ScheduleItem[] };
  let id = 0;
  const deps: Record<string, unknown> = {
    uid: () => `new-${++id}`, displayName: 'PM',
    normalizeScheduleItem: (value: Partial<ScheduleItem>) => task(String(value.id), String(value.projectName), value),
    markScheduleItemsAuthorityReady: jest.fn(), scheduleItemsCurrentRef, setScheduleItems: jest.fn(),
    advanceScheduleItemSyncGeneration: () => 1, scheduleItemSyncGenerationsRef: { current: new Map([['new-1', 1]]) },
    runScheduleItemCloudSync: (...args: Parameters<typeof runScheduleItemCloudSync>) => {
      const run = runScheduleItemCloudSync(...args);
      runs.push(run);
      return run;
    },
    settleScheduleItemTextSync: jest.fn(), scheduleItemTextSyncLifecycleRef: { current: {} },
    scheduleItemSyncWarningsRef: { current: new Set<string>() }, requestPendingChangesUpload: jest.fn(),
    Alert: { alert },
    checkScheduleTaskProject, scheduleTaskSaveNotice,
    projectsCurrentRef: { current: phone.projects }, archivedProjectsCurrentRef: { current: phone.closedProjects },
    projectRecordsCurrentRef: { current: [] },
  };
  const js = ts.transpileModule(
    `module.exports = (() => { ${appSource.slice(start, end)}\nreturn { addScheduleItem }; })()`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  const { addScheduleItem } = mod.exports as { addScheduleItem: (item: Partial<ScheduleItem>) => unknown };
  return {
    alert,
    /** Add Task's Save, through the task's own cloud sync. */
    async addTask(projectName: string) {
      expect(addScheduleItem({ taskName: 'Stripe lot', projectName })).not.toBe(false);
      await Promise.all(runs);
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

const projectQueue = async () => (await getOfflineQueue())
  .filter(item => item.entity === 'project')
  .map(item => [item.operation, item.retryCount]);

beforeEach(() => {
  mockStorage.clear();
  mockUpsertScheduleItem.mockClear();
  mockOnline = true;
  mockOpen = [{ id: mockLot5Id, name: 'Lot 5' }];
  mockClosed = [{ id: mockMainStId, name: 'Main St' }];
});

describe('a task whose project is still on its way to the cloud says so', () => {
  it.each([
    ['a project added on the phone', 'Lot 9', mockLot9Id, () => queueProjectCreate('Lot 9'), 'create'],
    ['a project reopened on the phone', 'Main St', mockMainStId,
      () => queueProjectUpdate({ previousName: 'Main St', archived: false }), 'update'],
  ])('%s: the save says the task uploads right after it, and two ordinary passes upload both', async (
    _label, projectName, projectId, queueProjectChange, operation,
  ) => {
    // Weak signal: the project's first upload fails.
    mockOnline = false;
    await queueProjectChange();
    await uploadPendingChanges();
    await expect(projectQueue()).resolves.toEqual([[operation, 1]]);

    // Signal returns; David adds a task under the project, open on his phone.
    mockOnline = true;
    const app = compileApp({ projects: [projectName, 'Lot 5'], closedProjects: [] });
    await app.addTask(projectName);
    expect(app.alert).toHaveBeenCalledTimes(1);
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device', ON_ITS_WAY(projectName));
    expect(JSON.stringify(app.alert.mock.calls)).not.toMatch(/device only|not an open project/);

    // The app's own retries: the project lands, then the task.
    await uploadPendingChanges();
    await uploadPendingChanges();
    await expect(getOfflineQueue()).resolves.toEqual([]);
    // Written only if the cloud still has no row for it (independent review R02).
    expect(mockUpsertScheduleItem).toHaveBeenCalledWith(expect.objectContaining({ projectName, projectId }), { onlyIfAbsent: true });
  });
});

describe('a task whose project truly is not open in the cloud still says device only', () => {
  it('a project closed on another device, with no reopen waiting', async () => {
    const app = compileApp({ projects: ['Main St', 'Lot 5'], closedProjects: [] });
    await app.addTask('Main St');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Main St'));
  });

  it('a project the cloud does not have, while another project\'s create waits', async () => {
    await queueProjectCreate('Lot 10');
    const app = compileApp({ projects: ['Lot 9', 'Lot 10', 'Lot 5'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Lot 9'));
  });

  it('a project whose waiting change is a close, not a reopen', async () => {
    await queueProjectUpdate({ previousName: 'Lot 5', archived: true });
    mockOpen = [];
    mockClosed.push({ id: mockLot5Id, name: 'Lot 5' });
    const app = compileApp({ projects: ['Lot 5'], closedProjects: [] });
    await app.addTask('Lot 5');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Lot 5'));
  });
});

describe('offline, the save still says "still retrying"', () => {
  it('even while the project\'s create waits', async () => {
    mockOnline = false;
    await queueProjectCreate('Lot 9');
    const app = compileApp({ projects: ['Lot 9', 'Lot 5'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device', STILL_RETRYING);
  });
});
