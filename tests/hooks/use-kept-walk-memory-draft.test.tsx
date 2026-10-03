/**
 * Whole-app audit A2 pass 5 L1 (30 Sep 2026): a Project Walk memory with a
 * suggested location never came back after iOS closed the app. Project Walk
 * builds the memory with the location suggested and not yet confirmed, and
 * the kept memory was checked as a confirmed memory would be, which requires
 * the location confirmed, so it was dropped as unreadable and sat on the
 * phone until sign-out. The kept memory is now checked with its suggestions
 * treated as confirmed, and comes back with its suggestions as they were, so
 * Confirm Memory still asks David to confirm the location. Each "launch" is a
 * fresh module registry over the same phone storage. Synthetic data only.
 */
const mockPhone = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockPhone.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockPhone.set(key, value); },
    removeItem: async (key: string) => { mockPhone.delete(key); },
    getAllKeys: async () => [...mockPhone.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach(key => mockPhone.delete(key)); },
  };
  return { __esModule: true, default: api, ...api };
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => mockPhone.clear());

type Suggested = 'gps' | 'transcript' | null;

/**
 * The memory Project Walk builds (App.tsx): the location suggested, not yet
 * confirmed, either matched from the phone's position (GPS) or heard in the
 * transcript; or no location suggested.
 */
function walkMemory(id: string, suggested: Suggested) {
  const { createCaptureMemory } = require('../../services/DAVECaptureMemory');
  const gpsEvidenceId = `location:${id}:area-1`;
  const location = suggested === 'gps' ? 'Level 2 East' : suggested === 'transcript' ? 'Level 2' : null;
  return createCaptureMemory({
    id,
    transcript: 'Drywall crew finishes Friday at level 2.',
    transcriptSourceRecordId: `voice-transcription:${id}`,
    createdAt: '2026-09-30T12:00:00.000Z',
    recommendedProject: { value: 'Canopy B', confidence: 'high', confirmed: true },
    recommendedLocation: {
      value: location,
      confidence: suggested === 'gps' ? 'medium' : suggested === 'transcript' ? 'high' : 'unknown',
      evidenceIds: suggested === 'gps' ? [gpsEvidenceId] : suggested === 'transcript' ? [`transcript:${id}`] : [],
      confirmed: false,
    },
    fields: { generalMemory: 'Drywall crew finishes Friday.' },
    evidence: suggested === 'gps' ? [{
      id: gpsEvidenceId,
      kind: 'location_record',
      sourceRecordId: 'area-1',
      summary: 'Current device location matched this saved project area during capture.',
    }] : [],
  });
}

function walk(owner: string, projectName: string) {
  jest.resetModules();
  const React = require('react');
  const rtl = require('@testing-library/react-native/pure');
  const { NativeWorkspaceOwnerContext } = require('../../components/native-workspace-owner');
  const kept = require('../../hooks/use-kept-walk-memory-draft');
  const memory = require('../../services/DAVECaptureMemory');
  const wrapper = ({ children }: { children: unknown }) =>
    React.createElement(NativeWorkspaceOwnerContext.Provider, { value: owner }, children);
  const hook = rtl.renderHook(() => kept.useKeptWalkMemoryDraft(projectName), { wrapper });
  return { rtl, hook, memory };
}

describe('Project Walk memory with a suggested location (A2 pass 5 L1)', () => {
  it.each([
    ['matched from the phone\'s position', 'gps', 'Level 2 East', 'medium'],
    ['heard in the transcript', 'transcript', 'Level 2', 'high'],
  ] as const)('an area %s comes back after iOS closes the app, still asking David to confirm it', async (
    _label, suggested, location, confidence,
  ) => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => {
      first.hook.result.current[1](walkMemory(`memory-${suggested}`, suggested));
      await settle();
    });
    first.hook.unmount(); // iOS closes the app

    const again = walk('owner-a', 'Canopy B');
    await again.rtl.act(async () => { await settle(); await settle(); });
    const restored = again.hook.result.current[0];
    expect(restored).toMatchObject({
      id: `memory-${suggested}`,
      status: 'draft',
      confirmedAt: null,
      recommendedProject: { value: 'Canopy B', confirmed: true },
      recommendedLocation: { value: location, confidence, confirmed: false },
    });
    // Confirm Memory still needs the location confirmed before it saves.
    expect(() => again.memory.confirmCaptureMemory(restored, '2026-09-30T12:05:00.000Z'))
      .toThrow('Location confirmation is required.');
    const confirmed = again.memory.confirmCaptureMemory(
      again.memory.confirmCaptureLocation(restored),
      '2026-09-30T12:05:00.000Z',
    );
    expect(confirmed.recommendedLocation).toMatchObject({ value: location, confirmed: true });
    again.hook.unmount();
  });

  it('a memory with no suggested location still comes back as before', async () => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => {
      first.hook.result.current[1](walkMemory('memory-plain', null));
      await settle();
    });
    first.hook.unmount();

    const again = walk('owner-a', 'Canopy B');
    await again.rtl.act(async () => { await settle(); await settle(); });
    expect(again.hook.result.current[0]).toMatchObject({
      id: 'memory-plain',
      status: 'draft',
      recommendedLocation: { value: null, confirmed: false },
    });
    again.hook.unmount();
  });

  it('a kept memory that is not a valid memory is still ignored', async () => {
    const first = walk('owner-a', 'Canopy B');
    await first.rtl.act(async () => {
      first.hook.result.current[1](walkMemory('memory-broken', 'gps'));
      await settle();
    });
    first.hook.unmount();
    const [key] = [...mockPhone.keys()];
    const kept = JSON.parse(mockPhone.get(key) as string);
    kept.value.transcriptEvidenceId = 'transcript:someone-else';
    mockPhone.set(key, JSON.stringify(kept));

    const again = walk('owner-a', 'Canopy B');
    await again.rtl.act(async () => { await settle(); await settle(); });
    expect(again.hook.result.current[0]).toBeNull();
    again.hook.unmount();
  });
});
