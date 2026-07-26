import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import type { ReferenceDocument } from '../../types';

function document(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'schedule-1',
    name: 'Schedule',
    originalFileName: 'schedule.pdf',
    uri: '',
    category: 'Schedules',
    notes: '',
    isCurrent: false,
    importedAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('reference document cloud recovery', () => {
  it('keeps newer cloud schedule authority while preserving the local file', () => {
    const local = document({
      uri: 'file:///device/schedule.pdf',
      isCurrent: false,
      updatedAt: '2026-07-20T12:00:00.000Z',
    });
    const cloud = document({
      storagePath: 'owner/schedules/schedule.pdf',
      isCurrent: true,
      updatedAt: '2026-07-20T13:00:00.000Z',
      cloudUpdatedAt: '2026-07-20T13:01:00.000Z',
    });

    expect(mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })).toEqual([expect.objectContaining({
      id: 'schedule-1',
      isCurrent: true,
      uri: 'file:///device/schedule.pdf',
      storagePath: 'owner/schedules/schedule.pdf',
    })]);
  });

  it('keeps a newer offline change ready for upload', () => {
    const local = document({
      isCurrent: true,
      updatedAt: '2026-07-20T14:00:00.000Z',
    });
    const cloud = document({
      isCurrent: false,
      cloudUpdatedAt: '2026-07-20T13:00:00.000Z',
    });

    expect(mergeDAVEReferenceDocumentRecoveryRecords({
      local: [local],
      cloud: [cloud],
    })[0].isCurrent).toBe(true);
  });

  it('never restores a tombstoned schedule document', () => {
    expect(mergeDAVEReferenceDocumentRecoveryRecords({
      local: [document()],
      cloud: [document({ cloudUpdatedAt: '2026-07-20T13:00:00.000Z' })],
      deletedIds: ['schedule-1'],
    })).toEqual([]);
  });
});
