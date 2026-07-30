import type { DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportSnapshot,
  daveReportSnapshotScopeKey,
} from '../../services/DAVEReportSnapshot';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

import {
  loadDAVEReportSnapshot,
  saveDAVEReportSnapshot,
} from '../../services/DAVEReportSnapshotRepository';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function approvedSnapshot() {
  const truth = {
    projectName: '2321 Compliance Project',
    schedule: [{
      taskId: 'paving',
      taskName: 'Place asphalt',
      areaName: 'North Lot',
      owner: 'David',
      status: 'In Progress',
      percentComplete: 40,
      finishDate: '2026-08-10',
      urgency: 'upcoming',
      approvalStatus: null,
      estimatedScheduleImpactDays: null,
    }],
  } as unknown as DAVEProjectTruth;
  return buildDAVEReportSnapshot({
    truths: [truth],
    scopeKey: daveReportSnapshotScopeKey([truth.projectName]),
    sourceFingerprint: 'approved-source',
    capturedAt: '2026-07-29T15:00:00.000Z',
  });
}

describe('DAVE approved-report snapshot repository', () => {
  it('persists and reloads the last approved report facts for the same scope', async () => {
    const storage = memoryStorage();
    const snapshot = approvedSnapshot();

    await expect(saveDAVEReportSnapshot(snapshot, storage)).resolves.toBeUndefined();
    await expect(loadDAVEReportSnapshot(snapshot.scopeKey, storage)).resolves.toEqual(snapshot);
  });

  it('rejects malformed or mismatched stored snapshots', async () => {
    const storage = memoryStorage();
    storage.getItem.mockResolvedValueOnce('{bad json');
    await expect(loadDAVEReportSnapshot('2321', storage)).resolves.toBeNull();

    storage.getItem.mockResolvedValueOnce(JSON.stringify({
      ...approvedSnapshot(),
      scopeKey: 'different-project',
    }));
    await expect(loadDAVEReportSnapshot('2321', storage)).resolves.toBeNull();
  });

  it('fails approval persistence when the stored value cannot be verified', async () => {
    const storage = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
    };

    await expect(saveDAVEReportSnapshot(approvedSnapshot(), storage)).rejects.toThrow(
      'could not be verified',
    );
  });
});
