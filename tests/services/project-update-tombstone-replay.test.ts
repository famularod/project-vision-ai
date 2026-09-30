/**
 * Whole-app audit A2 pass 2 M1 (30 Sep 2026): the startup replay of the
 * field-update deletion journal re-queued a cloud archive for every archive
 * ever made, rewriting the offline queue about five times per record on every
 * launch (100 archives: 500 queue writes, 13.6 MB). It is now one queue pass
 * over the real queue, and a second launch writes nothing.
 */
const mockStorage = new Map<string, string>();
const mockWrites: Array<{ key: string; bytes: number }> = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockWrites.push({ key, bytes: value.length });
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
  multiSet: jest.fn(async (entries: [string, string][]) => {
    entries.forEach(([key, value]) => {
      mockWrites.push({ key, bytes: value.length });
      mockStorage.set(key, value);
    });
  }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
}));

jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  isSupabaseConfigured: jest.fn(() => false),
  getSupabaseClient: jest.fn(() => null),
}));

import { getOfflineQueue } from '../../services/SyncService';
import { reconcileProjectUpdateDeletionJournal } from '../../services/updateService';

const QUEUE = 'projectVisionAI.syncQueue.v1';
const queueWrites = () => mockWrites.filter(write => write.key === QUEUE);

type Tombstone = Parameters<typeof reconcileProjectUpdateDeletionJournal>[0][number];
const archive = (index: number): Tombstone => ({
  updateId: `archived-${index}`,
  action: 'archive_sent_update',
  deletedAt: `2026-09-${String(1 + (index % 28)).padStart(2, '0')}T12:00:00.000Z`,
  cloudIdPresent: true,
});

function queueItem(id: string, payload: Record<string, unknown>, operation: 'update' | 'delete' = 'update') {
  return {
    id, entity: 'project_update', operation, payload,
    createdAt: '2026-09-29T10:00:00.000Z', changedAt: '2026-09-29T10:00:00.000Z',
    retryCount: 3, lastError: 'Offline',
  };
}

beforeEach(() => {
  mockStorage.clear();
  mockWrites.length = 0;
});

describe('deletion-journal replay (audit A2 pass 2 M1)', () => {
  it('queues 100 old archives in one queue write, and writes nothing on the next launch', async () => {
    const tombstones = Array.from({ length: 100 }, (_, index) => archive(index));

    await reconcileProjectUpdateDeletionJournal(tombstones);
    const firstLaunch = queueWrites();
    const queue = await getOfflineQueue();
    expect(queue).toHaveLength(100);
    expect(new Set(queue.map(item => item.id)).size).toBe(100);
    expect(queue[0]).toMatchObject({
      id: 'project-update-archived-0', entity: 'project_update', operation: 'update',
      payload: { id: 'archived-0', archiveOnly: true, archivedAt: '2026-09-01T12:00:00.000Z' },
    });

    mockWrites.length = 0;
    await reconcileProjectUpdateDeletionJournal(tombstones);
    const secondLaunch = queueWrites();

    process.stdout.write(`M1-replay ${JSON.stringify({
      archives: 100,
      firstLaunchQueueWrites: firstLaunch.length,
      firstLaunchQueueKB: Math.round(firstLaunch.reduce((sum, write) => sum + write.bytes, 0) / 1000),
      nextLaunchQueueWrites: secondLaunch.length,
    })}\n`);
    expect(firstLaunch.length).toBeLessThanOrEqual(1);
    expect(secondLaunch).toHaveLength(0);
    expect(await getOfflineQueue()).toEqual(queue);
  });

  it('keeps the protections: stale record work goes, queued deletes stay, missing deletes are added', async () => {
    mockStorage.set(QUEUE, JSON.stringify([
      // Full record for an update archived since: replaced by the archive.
      queueItem('project-update-archived-1', { id: 'archived-1', updateData: { id: 'archived-1' } }),
      // Archive already queued, still retrying: kept as it is.
      queueItem('project-update-archived-2', { id: 'archived-2', archiveOnly: true, archivedAt: '2026-09-03T12:00:00.000Z' }),
      // Deleted everywhere, delete queued: kept; no archive added for it.
      queueItem('project-update-gone', { id: 'gone' }, 'delete'),
      // Hidden cloud copy with stale record work: dropped.
      queueItem('project-update-hidden', { id: 'hidden', updateData: { id: 'hidden' } }),
      // Unrelated work: untouched.
      queueItem('project-update-other', { id: 'other', updateData: { id: 'other' } }),
    ]));

    await reconcileProjectUpdateDeletionJournal([
      archive(1),
      archive(2),
      { updateId: 'gone', action: 'delete_update_everywhere', deletedAt: '2026-09-04T12:00:00.000Z', cloudIdPresent: true },
      { updateId: 'hidden', action: 'hide_cloud_update', deletedAt: '2026-09-04T12:00:00.000Z', cloudIdPresent: true },
      { updateId: 'lost-delete', action: 'delete_update_everywhere', deletedAt: '2026-09-05T12:00:00.000Z', cloudIdPresent: true },
      { updateId: 'device-only', action: 'remove_from_device', deletedAt: '2026-09-05T12:00:00.000Z', cloudIdPresent: false },
    ]);

    const queue = await getOfflineQueue();
    const byId = new Map(queue.map(item => [item.id, item]));
    expect([...byId.keys()].sort()).toEqual([
      'project-update-archived-1',
      'project-update-archived-2',
      'project-update-gone',
      'project-update-lost-delete',
      'project-update-other',
    ]);
    expect(byId.get('project-update-archived-1')).toMatchObject({
      operation: 'update',
      payload: { id: 'archived-1', archiveOnly: true, archivedAt: '2026-09-02T12:00:00.000Z' },
      retryCount: 0,
    });
    expect(byId.get('project-update-archived-2')).toMatchObject({ retryCount: 3, lastError: 'Offline' });
    expect(byId.get('project-update-gone')?.operation).toBe('delete');
    expect(byId.get('project-update-lost-delete')?.operation).toBe('delete');
  });
});

// Whole-app audit A2 pass 3 L2 (30 Sep 2026): each launch re-recorded every
// "Delete Update" ever made in the deletion journal (a verified rewrite
// each) before checking that the cloud had confirmed it.
describe('deletion-journal replay of old deletes (audit A2 pass 3 L2)', () => {
  const JOURNAL = 'projectPhotoUpdate.deletionJournal.v1';
  const journalWrites = () => mockWrites.filter(write => write.key === JOURNAL);
  const deleted = (updateId: string): Tombstone => ({
    updateId, action: 'delete_update_everywhere', deletedAt: '2026-09-04T12:00:00.000Z', cloudIdPresent: true,
  });
  const intent = (updateId: string, confirmed: boolean) => ({
    updateId, projectName: 'Tower A', requestedAt: '2026-09-04T12:00:00.000Z',
    cloudDeleteConfirmedAt: confirmed ? '2026-09-04T12:01:00.000Z' : null,
  });

  it('skips 300 confirmed deletes without a write, and still re-queues the ones the cloud has not confirmed', async () => {
    const confirmed = Array.from({ length: 300 }, (_, index) => `confirmed-${index}`);
    const journal = [
      ...confirmed.map(id => intent(id, true)),
      intent('unconfirmed-lost', false),
      intent('unconfirmed-queued', false),
    ];
    mockStorage.set(JOURNAL, JSON.stringify(journal));
    mockStorage.set(QUEUE, JSON.stringify([
      queueItem('project-update-unconfirmed-queued', { id: 'unconfirmed-queued' }, 'delete'),
    ]));
    const tombstones = [...confirmed, 'unconfirmed-lost', 'unconfirmed-queued', 'never-journaled'].map(deleted);

    await reconcileProjectUpdateDeletionJournal(tombstones);

    const queue = await getOfflineQueue();
    expect(queue.map(item => [item.id, item.operation]).sort()).toEqual([
      ['project-update-never-journaled', 'delete'],
      ['project-update-unconfirmed-lost', 'delete'],
      ['project-update-unconfirmed-queued', 'delete'],
    ]);
    // Only the delete that was never in the journal is recorded (one write);
    // the 300 confirmed and the unconfirmed ones already there are unchanged.
    expect(journalWrites()).toHaveLength(1);
    const stored = JSON.parse(mockStorage.get(JOURNAL) || '[]') as Array<{ updateId: string }>;
    expect(stored).toHaveLength(journal.length + 1);
    expect(stored.slice(1)).toEqual(journal);

    mockWrites.length = 0;
    await reconcileProjectUpdateDeletionJournal(tombstones);
    expect(journalWrites()).toHaveLength(0);
    expect(queueWrites()).toHaveLength(0);
  });
});
