/**
 * Audit round 2, M1d/R1/R3 (30 Sep 2026), with the real engines: the saved
 * Project Truth is built from the runtime WITHOUT the unsaved draft, so draft
 * text never reaches the permanent history and a draft change does not make a
 * new snapshot. The Core returns that draft-free runtime, and builds it only
 * when there is a draft.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

import * as PIERuntimeModule from '../../services/PIERuntime';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  createDAVEProjectTruthRepository,
  fingerprintDAVEProjectTruth,
} from '../../services/DAVEProjectTruthRepository';
import type { ProjectUpdate } from '../../types';

const PROJECT = 'Alpha Hangar';
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const updates = Array.from({ length: 8 }, (_, u) => ({
  id: `update-${u}`, projectName: PROJECT, date: day(NOW - (8 - u) * DAY),
  notes: `Rough-in continues in Bay ${u % 3}.`, recipients: { contactIds: [] }, status: 'sent',
  selectedAreaName: `Bay ${u % 3}`,
  photos: [{
    id: `photo-${u}`, uri: `file:///p/${u}.jpg`, caption: '', category: u % 4 === 0 ? 'Open Issue' : 'Update',
    actionRequired: u % 4 === 0 ? 'Close junction boxes' : '', actionOwner: '', actionDueDate: '',
    actionStatus: u % 4 === 0 ? 'Open' : 'Closed', selectedAreaName: `Bay ${u % 3}`,
    locationCapturedAt: new Date(NOW - (8 - u) * DAY).toISOString(),
  }],
})) as unknown as ProjectUpdate[];
const scheduleItems = Array.from({ length: 10 }, (_, i) => ({
  id: `task-${i}`, projectName: PROJECT, scheduleProjectName: PROJECT, locationName: `Bay ${i % 3}`,
  taskName: `Task ${i} electrical rough-in`, startDate: day(NOW - 10 * DAY), finishDate: day(NOW + (i - 5) * DAY),
  milestone: '', owner: 'David', contractor: '', percentComplete: i * 10, priority: 'Normal', status: 'In Progress',
  notes: '', importedFrom: 'schedule.pdf', importedAt: '2026-09-01T08:00:00.000Z', createdAt: '2026-09-01T08:00:00.000Z',
}));

function draft(notes: string): ProjectUpdate {
  return {
    id: 'draft', projectName: PROJECT, date: day(NOW), photos: [], notes,
    recipients: { contactIds: [] }, status: 'draft',
  };
}

function context(currentUpdate: ProjectUpdate | null) {
  return {
    projectName: PROJECT, projectNames: [PROJECT], updates, scheduleItems: scheduleItems as never,
    currentUpdate, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'home' as const,
  };
}

/** What the provider hands the Core, then saves (see PIELiveAuthorityProvider). */
async function savedTruthFor(currentUpdate: ProjectUpdate | null) {
  const runtimeContext = context(currentUpdate);
  const runtime = PIERuntimeModule.buildRuntime(runtimeContext);
  const core = await buildLivePIECoreIntelligence({
    runtime,
    runtimeContext,
    organizationId: 'local-unverified-anonymous',
    projectId: 'project-alpha-hangar',
    identityTrusted: false,
    cloudAvailable: false,
  });
  const truthRuntime = core.authorityRuntime || core.runtime;
  const truth = buildDAVEProjectTruth({
    projectId: 'project-alpha-hangar', projectName: PROJECT, updates, scheduleItems: scheduleItems as never,
    runtime: truthRuntime, core, now: truthRuntime.generatedAt,
  });
  return { runtime, core, truth };
}

beforeEach(() => {
  mockStorage.clear();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the saved Project Truth never carries the unsaved draft', () => {
  it('draft text stays out of the saved truth, and a draft change is not a new snapshot', async () => {
    const zebra = await savedTruthFor(draft('ZEBRA unsaved note: roof leak in bay 2'));
    expect(JSON.stringify(zebra.core.runtime)).toContain('ZEBRA');
    expect(zebra.core.authorityRuntime).toBeDefined();
    expect(JSON.stringify(zebra.core.authorityRuntime)).not.toContain('ZEBRA');
    expect(JSON.stringify(zebra.truth)).not.toContain('ZEBRA');

    const quokka = await savedTruthFor(draft('QUOKKA unsaved note: drywall delivered'));
    expect(JSON.stringify(quokka.truth)).not.toContain('QUOKKA');
    expect(fingerprintDAVEProjectTruth(quokka.truth)).toBe(fingerprintDAVEProjectTruth(zebra.truth));

    const noDraft = await savedTruthFor(null);
    expect(fingerprintDAVEProjectTruth(noDraft.truth)).toBe(fingerprintDAVEProjectTruth(zebra.truth));

    const repository = createDAVEProjectTruthRepository();
    expect((await repository.save('owner-a', zebra.truth)).created).toBe(true);
    expect((await repository.save('owner-a', quokka.truth)).created).toBe(false);
    expect((await repository.save('owner-a', noDraft.truth)).created).toBe(false);
  });

  it('with no draft the Core reuses the runtime it was given instead of building another', async () => {
    const buildSpy = jest.spyOn(PIERuntimeModule, 'buildRuntime');
    const { runtime, core } = await savedTruthFor(null);
    expect(buildSpy).toHaveBeenCalledTimes(1); // the caller's own build
    expect(core.authorityRuntime).toBe(runtime);

    buildSpy.mockClear();
    const withDraft = await savedTruthFor(draft('A typed note'));
    expect(buildSpy).toHaveBeenCalledTimes(2); // the caller's, plus the draft-free one
    expect(withDraft.core.authorityRuntime).not.toBe(withDraft.runtime);
  });
});
