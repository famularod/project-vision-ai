/**
 * Audit round 2, A10 pass 2, finding 3 (30 Sep 2026), with the real engines.
 * 557bb5c built the saved Project Truth from the runtime without the unsaved
 * draft, but still from the Core WITH it, and the truth reads the Core's
 * confidence, next step, risks and summary. A draft with a Safety Concern
 * photo made Home's top action "Add a safety observation or confirm no
 * safety concern is present." (contradicting the draft) and saved and
 * uploaded a new snapshot, and another when the draft was cleared.
 *
 * Now the live Core also returns the Core without the draft (authorityCore)
 * when there is a draft, and Project Truth is built from it. With no draft
 * nothing extra is built, and a Core without the draft handed back in (the
 * provider keeps it while only the draft changes) is reused, not rebuilt.
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

import { buildRuntime } from '../../services/PIERuntime';
import { buildLivePIECoreIntelligence, type PIECoreOutput } from '../../services/PIECoreIntelligence';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { fingerprintDAVEProjectTruth } from '../../services/DAVEProjectTruthRepository';
import type { ProjectUpdate } from '../../types';

const PROJECT = 'Alpha Hangar';
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// A small project: the Core's next step reaches the top of Home's actions.
const updates = Array.from({ length: 2 }, (_, u) => ({
  id: `update-${u}`, projectName: PROJECT, date: day(NOW - (2 - u) * DAY),
  notes: `Rough-in continues in Bay ${u}.`, recipients: { contactIds: [] }, status: 'sent',
  selectedAreaName: `Bay ${u}`,
  photos: [{
    id: `photo-${u}`, uri: `file:///p/${u}.jpg`, caption: '', category: u === 0 ? 'Open Issue' : 'Update',
    actionRequired: u === 0 ? 'Close junction boxes' : '', actionOwner: '', actionDueDate: '',
    actionStatus: u === 0 ? 'Open' : 'Closed', selectedAreaName: `Bay ${u}`,
    locationCapturedAt: new Date(NOW - (2 - u) * DAY).toISOString(),
  }],
})) as unknown as ProjectUpdate[];

function safetyDraft(notes = 'Open edge at the mezzanine.'): ProjectUpdate {
  return {
    id: 'draft', projectName: PROJECT, date: day(NOW), notes, recipients: { contactIds: [] }, status: 'draft',
    selectedAreaName: 'Bay 1',
    photos: [{
      id: 'draft-photo', uri: 'file:///draft.jpg', caption: 'Open edge', category: 'Safety Concern',
      actionRequired: 'Install guardrail', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
      selectedAreaName: 'Bay 1', locationCapturedAt: new Date(NOW).toISOString(),
    }],
  } as unknown as ProjectUpdate;
}

function context(currentUpdate: ProjectUpdate | null) {
  return {
    projectName: PROJECT, projectNames: [PROJECT], updates, scheduleItems: [],
    currentUpdate, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'home' as const,
  };
}

/** What the provider hands the Core, then builds and saves (see PIELiveAuthorityProvider). */
async function savedTruthFor(currentUpdate: ProjectUpdate | null, authorityCore: PIECoreOutput | null = null) {
  const runtimeContext = context(currentUpdate);
  const runtime = buildRuntime(runtimeContext);
  const core = await buildLivePIECoreIntelligence({
    runtime,
    runtimeContext,
    authorityCore,
    organizationId: 'local-unverified-anonymous',
    projectId: 'project-alpha-hangar',
    identityTrusted: false,
    cloudAvailable: false,
  });
  const truthCore = core.authorityCore || core;
  const truthRuntime = truthCore.authorityRuntime || truthCore.runtime;
  const truth = buildDAVEProjectTruth({
    projectId: 'project-alpha-hangar', projectName: PROJECT, updates, scheduleItems: [],
    runtime: truthRuntime, core: truthCore, now: truthRuntime.generatedAt,
  });
  return { core, truth };
}

beforeEach(() => {
  mockStorage.clear();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('A10 pass 2 finding 3: the saved Project Truth takes nothing from the unsaved draft', () => {
  it('a Safety Concern draft does not change the saved truth or Home\'s top action', async () => {
    const noDraft = await savedTruthFor(null);
    const withDraft = await savedTruthFor(safetyDraft());
    // The draft-aware Core still sees the draft (capture uses it).
    expect(withDraft.core.bestNextStep).not.toBe(noDraft.core.bestNextStep);
    expect(withDraft.core.authorityCore?.bestNextStep).toBe(noDraft.core.bestNextStep);
    expect(withDraft.truth.briefing.nextActions[0]).toBe(noDraft.truth.briefing.nextActions[0]);
    expect(withDraft.truth.briefing.nextActions).not.toContain('Add a safety observation or confirm no safety concern is present.');
    expect(fingerprintDAVEProjectTruth(withDraft.truth)).toBe(fingerprintDAVEProjectTruth(noDraft.truth));
    const otherDraft = await savedTruthFor(safetyDraft('Harness anchor missing.'));
    expect(fingerprintDAVEProjectTruth(otherDraft.truth)).toBe(fingerprintDAVEProjectTruth(noDraft.truth));
  });

  it('no draft builds no second Core; a Core without the draft handed back is reused', async () => {
    const noDraft = await savedTruthFor(null);
    expect(noDraft.core.authorityCore).toBeUndefined();
    const first = await savedTruthFor(safetyDraft('A'));
    expect(first.core.authorityCore).toBeDefined();
    const typed = await savedTruthFor(safetyDraft('AB'), first.core.authorityCore!);
    expect(typed.core.authorityCore).toBe(first.core.authorityCore);
  });
});
