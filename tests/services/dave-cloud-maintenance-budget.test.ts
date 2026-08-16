jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
  },
}));

import {
  createDAVECloudMaintenanceScheduler,
  DAVE_CLOUD_MAINTENANCE_STORAGE_KEY,
  DAVE_DELETION_AUDIT_INTERVAL_MS,
  DAVE_STORAGE_CLEANUP_INTERVAL_MS,
} from '../../services/DAVECloudMaintenanceBudget';

describe('DAVE cloud maintenance request budget', () => {
  it('runs cleanup hourly and deletion-audit retention daily across restarts', async () => {
    const values = new Map<string, string>();
    let now = Date.parse('2026-08-02T05:00:00.000Z');
    const processStorageCleanup = jest.fn(async () => ({
      attempted: 0,
      completed: 0,
      failed: 0,
      remaining: 0,
      errors: [],
    }));
    const purgeDeletionAudit = jest.fn(async () => undefined);
    const storage = {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const dependencies = {
      storage,
      now: () => now,
      processStorageCleanup,
      purgeDeletionAudit,
    };
    const scheduler = createDAVECloudMaintenanceScheduler(dependencies);

    await expect(scheduler.run()).resolves.toMatchObject({
      storageCleanupRan: true,
      deletionAuditRan: true,
    });
    now += DAVE_STORAGE_CLEANUP_INTERVAL_MS - 1;
    await expect(scheduler.run()).resolves.toMatchObject({
      storageCleanupRan: false,
      deletionAuditRan: false,
    });

    now += 1;
    await expect(scheduler.run()).resolves.toMatchObject({
      storageCleanupRan: true,
      deletionAuditRan: false,
    });

    now = Date.parse('2026-08-02T05:00:00.000Z') + DAVE_DELETION_AUDIT_INTERVAL_MS;
    const restartedScheduler = createDAVECloudMaintenanceScheduler(dependencies);
    await expect(restartedScheduler.run()).resolves.toMatchObject({
      storageCleanupRan: true,
      deletionAuditRan: true,
    });

    expect(processStorageCleanup).toHaveBeenCalledTimes(3);
    expect(purgeDeletionAudit).toHaveBeenCalledTimes(2);
    expect(values.has(DAVE_CLOUD_MAINTENANCE_STORAGE_KEY)).toBe(true);
  });

  it('forces storage cleanup after a project deletion without rerunning audit retention', async () => {
    const values = new Map<string, string>();
    const processStorageCleanup = jest.fn(async () => ({
      attempted: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      errors: [],
    }));
    const purgeDeletionAudit = jest.fn(async () => undefined);
    const scheduler = createDAVECloudMaintenanceScheduler({
      storage: {
        getItem: async key => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
      },
      now: () => Date.parse('2026-08-02T05:00:00.000Z'),
      processStorageCleanup,
      purgeDeletionAudit,
    });

    await scheduler.run();
    await expect(scheduler.run({ forceStorageCleanup: true })).resolves.toMatchObject({
      storageCleanupRan: true,
      storageCleanupCompleted: 1,
      deletionAuditRan: false,
    });
    expect(processStorageCleanup).toHaveBeenCalledTimes(2);
    expect(purgeDeletionAudit).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent maintenance requests into one network pass', async () => {
    let finishCleanup!: () => void;
    const cleanup = new Promise<{
      attempted: number;
      completed: number;
      failed: number;
      remaining: number;
      errors: string[];
    }>(resolve => {
      finishCleanup = () => resolve({
        attempted: 0,
        completed: 0,
        failed: 0,
        remaining: 0,
        errors: [],
      });
    });
    const processStorageCleanup = jest.fn(() => cleanup);
    const purgeDeletionAudit = jest.fn(async () => undefined);
    const scheduler = createDAVECloudMaintenanceScheduler({
      storage: {
        getItem: async () => null,
        setItem: async () => undefined,
      },
      now: () => Date.parse('2026-08-02T05:00:00.000Z'),
      processStorageCleanup,
      purgeDeletionAudit,
    });

    const first = scheduler.run();
    const second = scheduler.run();
    finishCleanup();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(processStorageCleanup).toHaveBeenCalledTimes(1);
    expect(purgeDeletionAudit).toHaveBeenCalledTimes(1);
  });
});
