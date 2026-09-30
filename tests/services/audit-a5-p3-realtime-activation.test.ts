import {
  createDAVEOperationalRealtimeApplier,
  mergeProjectNames,
} from '../../services/DAVEOperationalRealtimeApplication';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../..', 'App.tsx'), 'utf8');

const ACTIVATED_AT = '2026-09-30T12:00:00.000Z';

const schedule = (extra: Partial<ReferenceDocument>): ReferenceDocument => ({
  id: 'sched', name: 'Master schedule', originalFileName: 'schedule.pdf', uri: '', category: 'Schedules',
  notes: '', isCurrent: false, projectNames: ['Alpha'], importedAt: '2026-09-01T12:00:00.000Z', ...extra,
} as ReferenceDocument);
// Set Active on the older revision: rev 2 (imported later) was current.
const rev1 = schedule({ id: 'sched-rev1', name: 'Master schedule rev 1', isCurrent: false });
const rev2 = schedule({ id: 'sched-rev2', name: 'Master schedule rev 2', isCurrent: true, importedAt: '2026-09-20T12:00:00.000Z' });

/** The cloud row shape (see normalizeDAVEOperationalRealtimeRecord); both Set Active rows share one updated_at. */
const documentRow = (document: ReferenceDocument) => ({
  eventType: 'UPDATE' as const, oldRow: null, raw: null,
  newRow: { id: document.id, updated_at: ACTIVATED_AT, document_data: document },
});
const taskRow = (id: string) => ({
  eventType: 'INSERT' as const, oldRow: null, raw: null,
  newRow: { id, item_data: { id, projectName: 'Alpha', taskName: `Task ${id}`, status: 'To Do', percentComplete: 0 } },
});

/** Commits write through to the state the next snapshot reads, as App.tsx's ref commits do. */
function harness(
  initial: { documents?: ReferenceDocument[]; scheduleItems?: ScheduleItem[] },
  getPendingQueue: () => Promise<never[]> = async () => [],
) {
  const state = {
    projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
    updates: [], deletedUpdates: [], tombstones: [] as unknown[], areas: [],
    scheduleItems: initial.scheduleItems ?? [], documents: initial.documents ?? [],
  };
  const commitDocuments = jest.fn((documents: ReferenceDocument[]) => { state.documents = documents; });
  const commitSchedule = jest.fn((items: ScheduleItem[]) => { state.scheduleItems = items; });
  const apply = createDAVEOperationalRealtimeApplier({
    isActive: () => true,
    snapshot: () => ({ ...state }),
    getPendingQueue,
    normalizeUpdate: (value: unknown) => value,
    normalizeAreas: (value: unknown[]) => value,
    normalizeSchedule: (value: unknown[]) => value,
    normalizeDocuments: (value: unknown[]) => value,
    migrateSchedule: (value: unknown) => value,
    localPhotoUri: () => '',
    mergeProjectNames,
    updateHasPendingLocalWork: () => false,
    mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
    buildUpdateTombstone: jest.fn(),
    buildCloudDeletionBarrier: jest.fn(),
    upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
    commitProjects: jest.fn(), commitDeletedProjects: jest.fn(), commitUpdates: jest.fn(), commitDeletedUpdates: jest.fn(),
    commitTombstones: jest.fn((tombstones: unknown[]) => { state.tombstones = tombstones; }),
    commitAreas: jest.fn(), commitSchedule, commitDocuments,
  } as never);
  return { state, apply, commitDocuments, commitSchedule };
}

const currentIds = (documents: ReferenceDocument[]) =>
  documents.filter(document => document.isCurrent).map(document => document.id);

// Whole-app audit A5 pass 3 F1 (30 Sep 2026): Set Active on one device left
// the other showing the old schedule or none until its next full refresh.
describe('Set Active and task bursts reach the other device', () => {
  const activatedRev1 = { ...rev1, isCurrent: true };
  const retiredRev2 = { ...rev2, isCurrent: false };

  it.each([
    ['newly current row first', [activatedRev1, retiredRev2]],
    ['retired row first', [retiredRev2, activatedRev1]],
  ])('both Set Active rows fired together (%s) ask for a re-read and leave the documents alone', async (_order, rows) => {
    const { state, apply, commitDocuments } = harness({ documents: [rev1, rev2] });
    const results = await Promise.all(rows.map(row => apply('reference_document', documentRow(row) as never)));
    expect(results).toEqual([false, false]);
    expect(commitDocuments).not.toHaveBeenCalled();
    expect(state.documents).toEqual([rev1, rev2]);
  });

  it.each([
    ['newly current row first', [activatedRev1, retiredRev2]],
    ['retired row first', [retiredRev2, activatedRev1]],
  ])('both Set Active rows arriving in sequence (%s) ask for a re-read each time', async (_order, rows) => {
    const { state, apply, commitDocuments } = harness({ documents: [rev1, rev2] });
    for (const row of rows) {
      await expect(apply('reference_document', documentRow(row) as never)).resolves.toBe(false);
    }
    expect(commitDocuments).not.toHaveBeenCalled();
    expect(currentIds(state.documents)).toEqual(['sched-rev2']);
  });

  it('a false result is the fallback that re-reads tombstones and the event collection', () => {
    expect(app).toMatch(/if \(!applied\) \{[\s\S]{0,200}'sync_tombstones', \.\.\.collections[\s\S]{0,200}refreshController\.request\('realtime', fallbackCollections\)/);
  });

  it('a schedule row whose current flag matches still merges, so the device that pressed Set Active takes its own echoes', async () => {
    const { state, apply, commitDocuments } = harness({ documents: [activatedRev1, retiredRev2] });
    await expect(apply('reference_document', documentRow({ ...retiredRev2, notes: 'Superseded' }) as never)).resolves.toBe(true);
    await expect(apply('reference_document', documentRow(activatedRev1) as never)).resolves.toBe(true);
    expect(commitDocuments).toHaveBeenCalledTimes(2);
    expect(state.documents.find(document => document.id === 'sched-rev2')?.notes).toBe('Superseded');
    expect(currentIds(state.documents)).toEqual(['sched-rev1']);
  });

  it('a document that is not a schedule merges its flag change as before', async () => {
    const drawing = schedule({ id: 'dwg-e601', name: 'E-601 Panel Schedule', category: 'Drawings', isCurrent: true });
    const { state, apply } = harness({ documents: [drawing] });
    await expect(apply('reference_document', documentRow({ ...drawing, isCurrent: false }) as never)).resolves.toBe(true);
    expect(state.documents[0].isCurrent).toBe(false);
  });

  it('three task rows fired together keep all three', async () => {
    const { state, apply } = harness({});
    const results = await Promise.all(['task-1', 'task-2', 'task-3'].map(id => apply('schedule_item', taskRow(id) as never)));
    expect(results).toEqual([true, true, true]);
    expect(state.scheduleItems.map(item => item.id).sort()).toEqual(['task-1', 'task-2', 'task-3']);
  });

  it('a task saved while the queue is read is kept', async () => {
    const saved = { id: 'task-local', projectName: 'Alpha', taskName: 'Saved here' } as ScheduleItem;
    const { state, apply } = harness({}, async () => {
      state.scheduleItems = [saved];
      return [];
    });
    await expect(apply('schedule_item', taskRow('task-cloud') as never)).resolves.toBe(true);
    expect(state.scheduleItems.map(item => item.id)).toEqual(['task-cloud', 'task-local']);
  });

  it('a document tombstone removes the document and asks for a re-read', async () => {
    const { state, apply, commitDocuments } = harness({ documents: [rev1, rev2] });
    await expect(apply('sync_tombstone', {
      eventType: 'INSERT', oldRow: null, raw: null,
      newRow: { entity_type: 'reference_document', record_id: 'sched-rev2', deleted_at: ACTIVATED_AT },
    } as never)).resolves.toBe(false);
    expect(commitDocuments).toHaveBeenCalledTimes(1);
    expect(state.documents.map(document => document.id)).toEqual(['sched-rev1']);
  });
});
