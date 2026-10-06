/**
 * Audit round 2, A10 pass 2 (30 Sep 2026), at the provider.
 *
 * F3: Project Truth (Home's brief and the saved snapshot) is built from the
 * Core WITHOUT the unsaved draft, which the provider keeps while only the
 * draft changes, so typing does not rebuild it, rebuild the truth or save it.
 * F4: no Project Truth is saved for a project the owner does not have.
 */
import { act, render } from '@testing-library/react-native';
import { InteractionManager, Text } from 'react-native';

import {
  PIELiveAuthorityProvider,
  type PIELiveAuthorityContextValue,
  type PIELiveAuthorityInput,
  usePIELiveAuthority,
} from '../../providers/PIELiveAuthorityProvider';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { createDAVEProjectTruthRepository } from '../../services/DAVEProjectTruthRepository';

jest.mock('../../services/PIECoreIntelligence', () => ({
  buildLivePIECoreIntelligence: jest.fn(),
}));

jest.mock('../../services/PIERuntime', () => ({
  buildRuntime: jest.fn((context: { currentUpdate?: unknown }) => ({
    generatedAt: '2026-09-30T12:00:00.000Z',
    response: {},
    marker: context.currentUpdate ? 'runtime-with-draft' : 'runtime-without-draft',
  })),
}));

jest.mock('../../services/DAVEProjectTruth', () => ({
  // R4: the provider hands Project Truth a project's own updates through this; the stand-in hands them on as they are.
  daveProjectTruthUpdatesFor: jest.fn((input: { updates: unknown[] }) => input.updates),
  buildDAVEProjectTruth: jest.fn((input: { projectId: string; projectName: string; core?: { marker?: string } }) => ({
    projectId: input.projectId,
    projectName: input.projectName,
    coreMarker: input.core?.marker,
  })),
}));

jest.mock('../../services/DAVEProjectTruthRepository', () => ({
  createDAVEProjectTruthRepository: jest.fn(),
}));

jest.mock('../../services/StartupDiagnostics', () => ({
  logStartupDiagnostic: jest.fn(),
  startupErrorMessage: (error: unknown) => String(error),
}));

jest.mock('../../services/PIEPhotoProgressIntelligenceStorage', () => ({
  savePhotoProgressIntelligence: jest.fn(async () => undefined),
}));

const buildCoreMock = buildLivePIECoreIntelligence as jest.MockedFunction<typeof buildLivePIECoreIntelligence>;
const buildTruthMock = buildDAVEProjectTruth as jest.MockedFunction<typeof buildDAVEProjectTruth>;
const createRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<typeof createDAVEProjectTruthRepository>;
type CoreResult = Awaited<ReturnType<typeof buildLivePIECoreIntelligence>>;
type CoreInput = Parameters<typeof buildLivePIECoreIntelligence>[0];

// The saved collections keep their identity while only the draft changes, as
// the App's project scope keeps them (audit round 2 L2).
const NONE: never[] = [];
const PROJECT_NAMES = ['Project One'];

function input(draftNotes: string, overrides: Partial<PIELiveAuthorityInput> = {}): PIELiveAuthorityInput {
  return {
    hydrated: true,
    organizationId: 'organization-1',
    projectId: 'project-1',
    projectName: 'Project One',
    projectNames: PROJECT_NAMES,
    updates: NONE,
    scheduleItems: NONE,
    projectAreas: NONE,
    referenceDocuments: NONE,
    projectDocuments: NONE,
    captureMemories: NONE,
    currentUpdate: {
      id: 'draft-update', projectName: 'Project One', date: '2026-09-30', photos: [], notes: draftNotes,
      recipients: { contactIds: [] }, status: 'draft',
    },
    identityTrusted: true,
    cloudAvailable: false,
    ...overrides,
  };
}

let coreBuilds = 0;
/** The live build: with a draft it returns the Core without it too, reusing one handed in. */
function liveCore(coreInput: CoreInput): CoreResult {
  coreBuilds += 1;
  const withDraft = Boolean(coreInput?.runtimeContext?.currentUpdate);
  const shared = {
    realityAuthority: { modelId: 'project-1', persistenceStatus: 'authoritative_local' },
    realityModel: { organizationId: 'organization-1', projectId: 'project-1', evidenceConflicts: [], activeUncertainties: [] },
  };
  const draftFree = { ...shared, marker: `core-without-draft-${coreBuilds}`, runtime: { marker: 'runtime-without-draft' } };
  return {
    ...shared,
    marker: withDraft ? `core-with-draft-${coreBuilds}` : draftFree.marker,
    runtime: coreInput?.runtime,
    authorityRuntime: withDraft ? draftFree.runtime : coreInput?.runtime,
    authorityCore: withDraft ? coreInput?.authorityCore || draftFree : undefined,
  } as unknown as CoreResult;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe('A10 pass 2: Project Truth from the Core without the draft', () => {
  let authority: PIELiveAuthorityContextValue | null = null;
  const saveMock = jest.fn();

  function Probe() {
    authority = usePIELiveAuthority();
    return <Text>probe</Text>;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(callback => {
      if (typeof callback === 'function') callback();
      return { cancel: jest.fn() } as never;
    });
    authority = null;
    coreBuilds = 0;
    buildCoreMock.mockReset();
    buildCoreMock.mockImplementation(async coreInput => liveCore(coreInput));
    buildTruthMock.mockClear();
    saveMock.mockReset();
    saveMock.mockResolvedValue({ snapshot: { revision: 1 }, created: false, cloudStatus: 'local_only' });
    createRepositoryMock.mockReset();
    createRepositoryMock.mockReturnValue({ save: saveMock } as unknown as ReturnType<typeof createDAVEProjectTruthRepository>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function typeInto(screen: ReturnType<typeof render>, text: string) {
    await screen.rerender(<PIELiveAuthorityProvider input={input(text)}><Probe /></PIELiveAuthorityProvider>);
    await act(async () => {
      jest.advanceTimersByTime(600); // past the input debounce: the Core refreshes
    });
    await flush();
  }

  it('F3: the truth and its save come from the Core without the draft, which typing does not rebuild', async () => {
    const screen = render(<PIELiveAuthorityProvider input={input('Open edge')}><Probe /></PIELiveAuthorityProvider>);
    await flush();
    expect(authority?.core).toMatchObject({ marker: 'core-with-draft-1' });
    expect(authority?.projectTruth).toMatchObject({ coreMarker: 'core-without-draft-1' });
    expect(saveMock).toHaveBeenCalled();
    for (const [, truth] of saveMock.mock.calls) expect(truth).toMatchObject({ coreMarker: 'core-without-draft-1' });
    const truthBuilds = buildTruthMock.mock.calls.length;
    const saves = saveMock.mock.calls.length;
    const firstTruth = authority?.projectTruth;

    await typeInto(screen, 'Open edge at');
    await typeInto(screen, 'Open edge at the mezzanine');
    expect(buildCoreMock).toHaveBeenCalledTimes(3);
    expect(buildCoreMock.mock.calls[1][0]!.authorityCore).toMatchObject({ marker: 'core-without-draft-1' });
    expect(buildCoreMock.mock.calls[2][0]!.authorityCore).toMatchObject({ marker: 'core-without-draft-1' });
    expect(authority?.core).toMatchObject({ marker: 'core-with-draft-3' });
    expect(authority?.projectTruth).toBe(firstTruth);
    expect(buildTruthMock.mock.calls.length).toBe(truthBuilds);
    for (const [, truth] of saveMock.mock.calls.slice(saves)) expect(truth).toBe(firstTruth);
  });

  it('F4: no Project Truth is saved for a project the owner does not have', async () => {
    render(
      <PIELiveAuthorityProvider input={input('', { projectName: 'Building 2321', projectNames: ['Building 2321'], projectTruthPersistencePolicy: 'no_project_truth' })}>
        <Probe />
      </PIELiveAuthorityProvider>,
    );
    await flush();
    expect(authority?.core).not.toBeNull();
    expect(saveMock).not.toHaveBeenCalled();
  });
});
