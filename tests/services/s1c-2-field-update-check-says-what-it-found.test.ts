/**
 * S1c item 2 (14 Oct 2026; review pass 5's H5S-2, Low, caused by c275e666, S1b). Settings > "Check field updates
 * against the cloud" said "All 2 field updates on this device that read “Cloud Synced” are in the cloud" when one of
 * them was not: its upload was still waiting in this device's queue (K1), or another device had deleted it and this
 * phone had not refreshed (K2). The check rightly did not LIST those two; its count line still counted them as in the
 * cloud. Now it says exactly what it found, each kind in its own words. The reviewer's K1 and K2
 * (notes/p6-b232/hrv5s-check.test.ts), with the check's readers given. Synthetic data.
 */
import { checkFieldUpdatesAgainstCloud, fieldUpdateCloudCheckText } from '../../services/FieldUpdateCloudCheck';
import type { SyncQueueItem } from '../../services/SyncService';
import type { ProjectUpdate } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []),
}));

type Update = ProjectUpdate & { isArchived?: boolean; stableSendId?: string | null };
const update = (id: string, extra: Partial<Update> = {}): Update => ({
  id, projectName: 'Alpha', date: '2026-09-22T15:30:00.000Z', photos: [], notes: `Poured the footings for ${id}`,
  recipients: { contactIds: [] }, status: 'sent', ...extra,
}) as Update;
const ok = <T,>(data: T) => ({ ok: true, configured: true, data, status: 200 });
const queued = (id: string) => ({ id: `project-update-${id}`, entity: 'project_update', operation: 'update', payload: { id, updateData: { id } }, createdAt: '', changedAt: '', retryCount: 7, lastError: 'The field update is missing its exact cloud project identity.' }) as unknown as SyncQueueItem;
const deleted = (id: string) => ({ entityType: 'project_update' as const, recordId: id, deletedAt: '2026-10-01T00:00:00.000Z' });
async function says(device: Update[], cloud: { id: string; idempotencyKey?: string }[], deletions: string[], waiting: string[]) {
  return fieldUpdateCloudCheckText(await checkFieldUpdatesAgainstCloud(device, {
    listCloudUpdates: async () => ok(cloud), listDeletionRecords: async () => ok(deletions.map(deleted)), readWaitingUploads: async () => waiting.map(queued),
  }));
}

describe('S1c item 2: the check says exactly what it found', () => {
  it('K1: one in the cloud, one still waiting in this device\'s upload queue: not "all are in the cloud"', async () => {
    expect(await says([update('A'), update('E')], [{ id: 'A' }], [], ['E'])).toEqual({
      summary: 'Of the 2 field updates on this device that read “Cloud Synced”: 1 is in the cloud; 1 is not in the cloud yet and is still waiting in this device’s upload queue. Nothing was sent or changed.',
      items: [],
    });
  });

  it('K2: one in the cloud, one deleted on another device that this phone has not heard of yet', async () => {
    expect(await says([update('A'), update('D')], [{ id: 'A' }], ['D'], [])).toEqual({
      summary: 'Of the 2 field updates on this device that read “Cloud Synced”: 1 is in the cloud; 1 was deleted on another device, and this device has not refreshed since. Nothing was sent or changed.',
      items: [],
    });
  });

  it('every kind at once: each counted once, in its own words; only the ones nothing will send are listed', async () => {
    const device = [update('A'), update('B'), update('D'), update('E'), update('G', { stableSendId: 'send-G' }), update('E2'), update('C', { status: 'queued' })];
    const text = await says(device, [{ id: 'A' }, { id: 'row-G', idempotencyKey: 'send-G' }, { id: 'E2' }], ['D'], ['E', 'E2']);
    expect(text.summary).toBe('Of the 6 field updates on this device that read “Cloud Synced”: 3 are in the cloud; 1 is not in the cloud yet and is still waiting in this device’s upload queue; 1 was deleted on another device, and this device has not refreshed since; 1 is not in the cloud and is not waiting to upload (listed below). Nothing was sent or changed. Sync Now would send the one listed; if it is an update you deleted on another device, delete it here first.');
    expect(text.items).toEqual([`${new Date('2026-09-22T15:30:00.000Z').getDate()} Sep 2026 · Alpha · Poured the footings for B`]);
  });

  it('none in the cloud: says so; two listed', async () => {
    const text = await says([update('B'), update('B2')], [], [], []);
    expect(text.summary).toBe('Of the 2 field updates on this device that read “Cloud Synced”: none is in the cloud; 2 are not in the cloud and are not waiting to upload (listed below). Nothing was sent or changed. Sync Now would send the ones listed; if one is an update you deleted on another device, delete it here first.');
    expect(text.items).toHaveLength(2);
  });

  it('as before: all in the cloud says so', async () => {
    expect((await says([update('A'), update('G', { stableSendId: 'send-G' })], [{ id: 'A' }, { id: 'x', idempotencyKey: 'send-G' }], [], ['A'])).summary)
      .toBe('All 2 field updates on this device that read “Cloud Synced” are in the cloud. Nothing was sent or changed.');
  });
});
