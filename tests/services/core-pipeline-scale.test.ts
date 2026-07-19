/**
 * Device-crash reproduction harness (2026-07-18): runs the real DAVE core
 * pipeline at the scale of David's actual dataset (64 schedule items, 13
 * updates, 12 areas, 2 projects). The device dies with a cpu_resource kill
 * in this window; if the burn is algorithmic it must reproduce here.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

import { buildRuntime } from '../../services/PIERuntime';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';

const PROJECTS = ['2321 Compliance Project', '2375 Compliance Project'];
const AREAS = Array.from({ length: 12 }, (_, i) => `Area ${i + 1}`);

function scheduleItem(i: number) {
  const project = PROJECTS[i % 2];
  return {
    id: `task-${i}`,
    projectName: project,
    scheduleProjectName: project,
    locationName: AREAS[i % AREAS.length],
    taskName: `Task ${i} electrical rough-in and inspection`,
    status: i % 5 === 0 ? 'Complete' : i % 3 === 0 ? 'In Progress' : 'Not Started',
    percentComplete: i % 5 === 0 ? 100 : (i * 7) % 90,
    priority: i % 4 === 0 ? 'High' : 'Normal',
    startDate: '2026-06-01',
    dueDate: i % 6 === 0 ? '2026-07-10' : '2026-08-15',
    finishDate: '',
    owner: i % 3 === 0 ? 'David' : '',
    contractor: '',
    notes: i % 2 === 0 ? 'Waiting on inspection sign-off before closing.' : '',
    milestone: '',
    importedFrom: 'master-schedule.pdf',
    importedAt: '2026-07-05T08:00:00.000Z',
    createdAt: '2026-07-05T08:00:00.000Z',
    needsReview: i % 9 === 0,
  };
}

function photo(u: number, p: number) {
  return {
    id: `photo-${u}-${p}`,
    uri: `file:///photos/update-${u}-${p}.jpg`,
    fileName: `IMG_${u}${p}.jpg`,
    mimeType: 'image/jpeg',
    caption: p === 0 ? 'Panel install progress at east wall' : '',
    category: 'Update',
    actionRequired: p === 1 ? 'Close open junction boxes' : '',
    actionOwner: p === 1 ? 'David' : '',
    actionDueDate: p === 1 ? '2026-07-20' : '',
    actionStatus: p === 1 ? 'Open' : 'Closed',
    timestamp: `2026-07-${String(8 + (u % 9)).padStart(2, '0')}T10:0${p}:00.000Z`,
    selectedAreaId: null,
    selectedAreaName: AREAS[(u + p) % AREAS.length],
    locationCapturedAt: `2026-07-${String(8 + (u % 9)).padStart(2, '0')}T10:0${p}:00.000Z`,
  };
}

function update(u: number) {
  const project = PROJECTS[u % 2];
  return {
    id: `update-${u}`,
    projectName: project,
    scheduleProjectName: project,
    date: `2026-07-${String(6 + (u % 10)).padStart(2, '0')}`,
    notes: u % 2 === 0
      ? 'Electrical rough-in continues. No safety issues observed. Panel schedule conflict with drawings needs review.'
      : 'Concrete pour completed at north footing. Inspection is not complete yet.',
    recipients: { contactIds: [] },
    photos: [photo(u, 0), photo(u, 1), photo(u, 2)],
    status: u % 3 === 0 ? 'queued' : 'sent',
    selectedAreaName: AREAS[u % AREAS.length],
    syncDiagnostics: u % 3 === 0
      ? { lastSyncFailureCategory: 'signed_out', attemptedAt: '2026-07-18T12:00:00.000Z' }
      : undefined,
  };
}

const runtimeContext = {
  projectName: PROJECTS[0],
  projectNames: [PROJECTS[0]],
  updates: Array.from({ length: 13 }, (_, u) => update(u)) as never,
  scheduleItems: Array.from({ length: 64 }, (_, i) => scheduleItem(i)) as never,
  currentUpdate: null,
  projectAreas: AREAS.map((name, i) => ({
    id: `area-${i}`,
    name,
    projectName: PROJECTS[i % 2],
    latitude: null,
    longitude: null,
    radiusFeet: 150,
    locationCapturedAt: null,
  })) as never,
  contacts: { contacts: [] } as never,
  referenceDocuments: [] as never,
  surface: 'home' as const,
};

describe('core pipeline at device data scale', () => {
  it('builds runtime and core intelligence within a sane time budget', async () => {
    const t0 = Date.now();
    const runtime = buildRuntime(runtimeContext as never);
    const tRuntime = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[scale] buildRuntime: ${tRuntime}ms`);

    const t1 = Date.now();
    const core = await buildLivePIECoreIntelligence({
      runtime,
      runtimeContext: runtimeContext as never,
      organizationId: 'local-unverified-anonymous',
      projectId: 'project-2321-compliance-project',
      identityTrusted: false,
      cloudAvailable: false,
    });
    const tCore = Date.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`[scale] buildLivePIECoreIntelligence: ${tCore}ms`);

    expect(core.realityModel).toBeTruthy();
    expect(tRuntime + tCore).toBeLessThan(20000);
  }, 60000);
});
