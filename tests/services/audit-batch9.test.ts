jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

import { createDAVEOperationalRealtimeApplier } from '../../services/DAVEOperationalRealtimeApplication';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

// Whole-app audit A3 pass 2 L5 (30 Sep 2026).
describe('a project deleted on another device', () => {
  it('leaves this phone’s archived list with its deletion record', async () => {
    const commitProjects = jest.fn();
    const apply = createDAVEOperationalRealtimeApplier({
      isActive: () => true,
      snapshot: () => ({
        projects: ['Alpha'], projectRecords: [{ name: 'Alpha' }], archivedProjects: ['Tower B', 'Old Yard'],
        deletedProjectNames: [], updates: [], deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [],
      }),
      getPendingQueue: async () => [],
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown) => value,
      normalizeSchedule: (value: unknown) => value,
      normalizeDocuments: (value: unknown) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames: (base: string[], ...sources: string[][]) => [...new Set([...sources.flat(), ...base])],
      updateHasPendingLocalWork: () => false,
      mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: jest.fn(),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects, commitDeletedProjects: jest.fn(), commitUpdates: jest.fn(), commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(), commitAreas: jest.fn(), commitSchedule: jest.fn(), commitDocuments: jest.fn(),
    } as never);
    await apply('sync_tombstone', {
      eventType: 'INSERT',
      newRow: { entity_type: 'project', record_id: 'tower b', deleted_at: '2026-09-30T12:00:00.000Z' },
    } as never);
    expect(commitProjects).toHaveBeenCalledWith([{ name: 'Alpha' }], ['Alpha'], ['Old Yard']);
  });

  it('cannot be reopened from a stale archived list', () => {
    expect(app).toMatch(/function reopenProject\(projectName: string\) \{\n\s+const availability = projectNameAvailability\(\{[\s\S]*?if \(availability\.kind === 'deleted'\) \{[\s\S]*?Alert\.alert\('Project was deleted'[\s\S]*?return;\n\s+\}\n\s+setProjects\(prev => mergeProjectNames\(prev, \[projectName\]\)\);/);
  });
});
