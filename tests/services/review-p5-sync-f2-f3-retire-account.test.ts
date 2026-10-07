/**
 * Review pass 1, sync, findings F2 and F3 (both caused by sync batch Y4, item 3; services/SyncService.ts,
 * retireProjectOpeningThatCanNeverArrive). F2 by owner answer Q45 (6 Oct).
 *
 * The describes named "F2" and "F3" are the reviewer's own (notes/p5-sync/p5s-y4-3-retire-account.test.ts),
 * unchanged; one test of each fails on the base (a542898). The rest are this batch's. His rig is the earlier fixer's
 * (tests/services/audit-a3-pass7-project-on-its-way.test.ts), with two things added: the stand-in cloud knows which
 * account is signed in and answers with that account's lists, and a read can have the account change while it
 * waits. Added by this batch: the same for the closed-projects read, and each read notes which account it was
 * told it must be made as.
 */
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

jest.mock('../../services/BackgroundTaskGuard', () => ({
  ...jest.requireActual('../../services/BackgroundTaskGuard'),
  startGuardedBackgroundTask: jest.fn(),
}));

type CloudProject = { id: string; name: string };
type Account = 'account-a' | 'account-b';
const mockLot9OfB = '9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const mockMainStId = '72e941d8-8114-4082-a976-ae5b2b5daba9';
let mockOnline = true;
/** Who is signed in: every stand-in call answers with THAT account's rows, as the cloud does. */
let mockSignedIn: Account = 'account-a';
const mockCloudOf: Record<Account, { open: CloudProject[]; closed: CloudProject[]; deletions: Array<{ entityType: string; recordId: string; deletedAt: string }> }> = {
  'account-a': { open: [], closed: [], deletions: [] },
  'account-b': { open: [], closed: [], deletions: [] },
};
let mockDeletionHistoryReads = 0;
/** Run when the deletion history is read for the n-th time, while that read waits. */
let mockDuringDeletionHistoryRead: { nth: number; run: () => void } | null = null;
/** Added by this batch: run while the closed-projects list is being read; and which account each such read was told to be made as. */
let mockDuringClosedListRead: (() => void) | null = null;
const mockClosedListReadAs: Array<string | null> = [];
const mockExpected = () => (jest.requireActual('../../services/CloudOwnerBinding') as Partial<typeof import('../../services/CloudOwnerBinding')>).cloudOwnerExpectedForThisCall?.() ?? null;
const mockCreateProject = jest.fn();
const mockAnswer = <T,>(data: T) => Promise.resolve(mockOnline
  ? { ok: true, configured: true, stubbed: false, data }
  : { ok: false, configured: true, stubbed: false, error: 'Network request failed' });
const mockUpsertScheduleItem = jest.fn((..._args: unknown[]) => mockAnswer(null));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  listProjects: () => mockAnswer([...mockCloudOf[mockSignedIn].open]),
  listArchivedProjects: () => {
    mockClosedListReadAs.push(mockExpected());
    // The request left as the account signed in when it started; its answer is that account's.
    const answer = mockAnswer([...mockCloudOf[mockSignedIn].closed]);
    const during = mockDuringClosedListRead;
    mockDuringClosedListRead = null;
    during?.();
    return answer;
  },
  createProject: (project: { name: string }) => { mockCreateProject(project.name); return mockAnswer(project); },
  updateProject: () => mockAnswer(null),
  listDAVESyncTombstones: async () => {
    mockDeletionHistoryReads += 1;
    // The request left as the account signed in when it started; its answer is that account's.
    const answer = mockAnswer([...mockCloudOf[mockSignedIn].deletions]);
    if (mockDuringDeletionHistoryRead?.nth === mockDeletionHistoryReads) mockDuringDeletionHistoryRead.run();
    return answer;
  },
  upsertDAVESyncTombstones: (tombstones: unknown[]) => mockAnswer(tombstones),
  listScheduleItems: () => mockAnswer([]),
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
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { checkScheduleTaskProject, scheduleTaskSaveNotice } from '../../services/ScheduleTaskProject';

const ON_ITS_WAY = (name: string) => `“${name}” is still on its way to the cloud. The task uploads right after it.`;
const DEVICE_ONLY = (name: string) =>
  `“${name}” is not an open project in the cloud, so other devices will not get this task. It uploads once the project is open: reopen it on Overview if it was closed.`;

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

/** App.tsx addScheduleItem .. syncScheduleItemRevision, with the phone's project lists (the fixer's rig). */
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
    async addTask(projectName: string) {
      expect(addScheduleItem({ taskName: 'Stripe lot', projectName })).not.toBe(false);
      await Promise.all(runs);
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

const queued = async () => (await getOfflineQueue()).map(item => `${item.entity}:${item.operation}:${item.ownerId ?? 'no account'}`);

beforeEach(() => {
  mockStorage.clear();
  mockUpsertScheduleItem.mockClear();
  mockCreateProject.mockClear();
  mockOnline = true;
  mockSignedIn = 'account-a';
  mockCloudOf['account-a'] = { open: [], closed: [], deletions: [] };
  mockCloudOf['account-b'] = { open: [], closed: [], deletions: [] };
  mockDeletionHistoryReads = 0;
  mockDuringDeletionHistoryRead = null;
  mockDuringClosedListRead = null;
  mockClosedListReadAs.length = 0;
  noteSignedInOwner('account-a');
});

describe('F2: two accounts on one phone, and the read that decides "closed" (caused by f60e191)', () => {
  /** Account A, with no signal, adds "Lot 9"; its first upload fails. Account B's cloud has a CLOSED "Lot 9" of its own. */
  async function accountAsCreateWaits() {
    mockOnline = false;
    await queueProjectCreate('Lot 9');
    await uploadPendingChanges();
    mockOnline = true;
    mockCloudOf['account-b'].closed.push({ id: mockLot9OfB, name: 'Lot 9' });
    expect(await queued()).toEqual(['project:create:account-a']);
    mockDeletionHistoryReads = 0; // counted from the task's save on
  }

  it('control: no change of account. Account A\'s cloud has no "Lot 9" at all, so the create really is on its way and stays queued', async () => {
    await accountAsCreateWaits();
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device', ON_ITS_WAY('Lot 9'));
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
  });

  it('account A signs out and B signs in while the save\'s deletion-history read waits: B\'s closed list does not take A\'s create off the queue, and A is not told "not an open project"', async () => {
    await accountAsCreateWaits();
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    // The pass's own read is the first; the save's own (retireProjectOpeningThatCanNeverArrive) is the second.
    mockDuringDeletionHistoryRead = {
      nth: 2,
      run: () => {
        noteSignedInOwner(null);
        mockSignedIn = 'account-b';
        noteSignedInOwner('account-b');
        // The phone's stored queue is still account A's here: the switch of the device's storage to B is a later,
        // separate step (entry.ts queues it on the sign-in event). See NOTES-pass1.txt for what that step protects.
      },
    };

    await app.addTask('Lot 9');

    // On d0b60c7 the save reads the deletion history a second time (the pass's own read, then the save's), and the
    // account changes during that second read. On 594a71d the save makes no such read, so nothing changes account
    // and this test passes there: the fault does not exist before f60e191.
    if (mockDeletionHistoryReads >= 2) expect(mockSignedIn).toBe('account-b');
    // FAILS on d0b60c7: account A's create has been taken off the queue on the word of account B's closed list,
    // and the save says, of A's project, what is true only of B's.
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
    expect(JSON.stringify(app.alert.mock.calls)).not.toContain('is not an open project in the cloud');
  });
});

describe('review pass 1, sync F2: the save decides only for the account that queued the create, and only while it is signed in', () => {
  const accountChangesToB = () => {
    noteSignedInOwner(null);
    mockSignedIn = 'account-b';
    noteSignedInOwner('account-b');
  };
  /** Account A, with no signal, adds "Lot 9"; its first upload fails; then the signal is back. */
  async function accountAsCreateWaits() {
    mockOnline = false;
    await queueProjectCreate('Lot 9');
    await uploadPendingChanges();
    mockOnline = true;
    mockDeletionHistoryReads = 0;
    mockClosedListReadAs.length = 0;
  }

  it('the account changes while the save\'s own deletion-history read waits: nothing is taken off the queue, and nothing at all is said', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-b'].closed.push({ id: mockLot9OfB, name: 'Lot 9' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    mockDuringDeletionHistoryRead = { nth: 2, run: accountChangesToB };
    await app.addTask('Lot 9');
    expect(mockSignedIn).toBe('account-b');
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
    expect(app.alert).not.toHaveBeenCalled();
    expect(mockClosedListReadAs).toEqual([]); // and B's closed list is not even asked for
  });

  it('account B\'s cloud has a DELETION record of the same name: A\'s create and A\'s task are not taken off the queue on it, and nothing is said', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-b'].deletions.push({ entityType: 'project', recordId: 'Lot 9', deletedAt: '2026-10-01T10:00:00.000Z' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    mockDuringDeletionHistoryRead = { nth: 2, run: accountChangesToB };
    await app.addTask('Lot 9');
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
    expect(app.alert).not.toHaveBeenCalled();
  });

  it('the account changes while the closed-projects list is being read: its answer decides nothing, nothing is removed, nothing is said', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Lot 9' }); // even A's own true answer is not acted on once A is gone
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    mockDuringClosedListRead = accountChangesToB;
    await app.addTask('Lot 9');
    expect(mockSignedIn).toBe('account-b');
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
    expect(app.alert).not.toHaveBeenCalled();
  });

  it('the closed-projects list is asked for as the account that queued the create', async () => {
    await accountAsCreateWaits();
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(mockClosedListReadAs).toEqual(['account-a']);
  });

  it('one account only, as before: closed on another device, the create is taken off the queue and the save says so', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Lot 9' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(await queued()).toEqual(['schedule_item:update:account-a']);
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Lot 9'));
  });

  it('one account only, as before: deleted on another device, the create and the task are taken off the queue and the save says so', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-a'].deletions.push({ entityType: 'project', recordId: 'Lot 9', deletedAt: '2026-10-01T10:00:00.000Z' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    await app.addTask('Lot 9');
    expect(await queued()).toEqual([]);
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', '“Lot 9” has been deleted, so this task was not sent and other devices will not get it.');
  });

  it('one account only: a token refresh during the save\'s read (the same account told again) changes nothing', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Lot 9' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    mockDuringDeletionHistoryRead = { nth: 2, run: () => noteSignedInOwner('account-a') };
    await app.addTask('Lot 9');
    expect(await queued()).toEqual(['schedule_item:update:account-a']);
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Lot 9'));
  });

  it('one account only: it signs out and in again during the save\'s read: nothing is decided on that read, nothing is said, and the next pass settles the create as before', async () => {
    await accountAsCreateWaits();
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Lot 9' });
    const app = compileApp({ projects: ['Lot 9'], closedProjects: [] });
    mockDuringDeletionHistoryRead = { nth: 2, run: () => { noteSignedInOwner(null); noteSignedInOwner('account-a'); } };
    await app.addTask('Lot 9');
    expect(await queued()).toEqual(['project:create:account-a', 'schedule_item:update:account-a']);
    expect(app.alert).not.toHaveBeenCalled();
    await uploadPendingChanges();
    await uploadPendingChanges();
    expect((await queued()).filter(line => line.startsWith('project:create'))).toEqual([]); // dropped by the pass: the cloud has that name, closed
    expect(mockCreateProject).not.toHaveBeenCalled();
  });
});

describe('F3: one account. A create AND a reopen of the same project wait; the cloud has it closed (caused by f60e191)', () => {
  it('his reopen is on its way, so the save does not say "other devices will not get this task ... reopen it on Overview"', async () => {
    // With no signal he added "Main St"; meanwhile the iPad added "Main St" and closed it. The phone heard of the
    // closed project at a refresh and he tapped Reopen; neither change has gone up yet (weak signal).
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Main St' });
    mockOnline = false;
    await queueProjectCreate('Main St');
    await queueProjectUpdate({ previousName: 'Main St', archived: false });
    await uploadPendingChanges();
    mockOnline = true;
    const app = compileApp({ projects: ['Main St'], closedProjects: [] });

    await app.addTask('Main St');

    // The reopen still waits and will land at the next pass, with the task right after it.
    expect((await queued()).filter(line => line.startsWith('project:update'))).toEqual(['project:update:account-a']);
    // FAILS on d0b60c7: it says DEVICE_ONLY ("other devices will not get this task ... reopen it on Overview if it
    // was closed") though he has reopened it and the task goes up two passes later. On 594a71d it said ON_ITS_WAY.
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device', ON_ITS_WAY('Main St'));
    expect(app.alert).not.toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Main St'));
  });

  it('and it does go up: two ordinary passes later nothing is left waiting', async () => {
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Main St' });
    mockOnline = false;
    await queueProjectCreate('Main St');
    await queueProjectUpdate({ previousName: 'Main St', archived: false });
    await uploadPendingChanges();
    mockOnline = true;
    const app = compileApp({ projects: ['Main St'], closedProjects: [] });
    await app.addTask('Main St');
    // The stand-in's updateProject does not move the project between its lists; the cloud does. Do it here.
    mockCloudOf['account-a'].open.push(...mockCloudOf['account-a'].closed.splice(0));
    for (let pass = 1; pass <= 3; pass += 1) await uploadPendingChanges();
    expect((await queued()).filter(line => line.startsWith('schedule_item'))).toEqual([]);
    expect(mockUpsertScheduleItem).toHaveBeenLastCalledWith(expect.objectContaining({ projectName: 'Main St', projectId: mockMainStId }), { onlyIfAbsent: true });
  });
});

describe('review pass 1, sync F3: what else is true in that state', () => {
  it('the create is still taken off the queue (the cloud has that name, closed: no second copy), and only his reopen and the task wait', async () => {
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Main St' });
    mockOnline = false;
    await queueProjectCreate('Main St');
    await queueProjectUpdate({ previousName: 'Main St', archived: false });
    await uploadPendingChanges();
    mockOnline = true;
    const app = compileApp({ projects: ['Main St'], closedProjects: [] });
    await app.addTask('Main St');
    expect(await queued()).toEqual(['project:update:account-a', 'schedule_item:update:account-a']);
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('with no reopen waiting the save says what sync batch Y4 made it say: not an open project, reopen it on Overview', async () => {
    mockCloudOf['account-a'].closed.push({ id: mockMainStId, name: 'Main St' });
    mockOnline = false;
    await queueProjectCreate('Main St');
    await uploadPendingChanges();
    mockOnline = true;
    const app = compileApp({ projects: ['Main St'], closedProjects: [] });
    await app.addTask('Main St');
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', DEVICE_ONLY('Main St'));
    expect(await queued()).toEqual(['schedule_item:update:account-a']);
  });

  it('a deletion record of the name outranks his reopen: both waiting changes and the task are taken off the queue, and the save says it was deleted', async () => {
    mockCloudOf['account-a'].deletions.push({ entityType: 'project', recordId: 'Main St', deletedAt: '2026-10-01T10:00:00.000Z' });
    mockOnline = false;
    await queueProjectCreate('Main St');
    await queueProjectUpdate({ previousName: 'Main St', archived: false });
    await uploadPendingChanges();
    mockOnline = true;
    const app = compileApp({ projects: ['Main St'], closedProjects: [] });
    await app.addTask('Main St');
    expect(await queued()).toEqual([]);
    expect(app.alert).toHaveBeenCalledWith('Task saved on this device only', '“Main St” has been deleted, so this task was not sent and other devices will not get it.');
  });
});
