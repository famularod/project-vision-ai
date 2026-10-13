/**
 * Audit round 2, M1d/M1e/R3 (30 Sep 2026).
 *
 * M1e: Project Truth was rebuilt from the raw input on every draft keystroke
 * (20-200 ms each); the 500 ms debounce only protected the refresh and save.
 * M1d: the saved Project Truth was built from the runtime that includes the
 * unsaved draft, so every draft change made a new saved snapshot and put the
 * unsaved text into the permanent history.
 * R3: the always-present empty draft made every refresh build a second,
 * draft-free runtime.
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
import { buildRuntime } from '../../services/PIERuntime';
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
  buildDAVEProjectTruth: jest.fn((input: { projectId: string; projectName: string; runtime: { marker?: string } }) => ({
    projectId: input.projectId,
    projectName: input.projectName,
    builtFrom: input.runtime?.marker,
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
const buildRuntimeMock = buildRuntime as jest.MockedFunction<typeof buildRuntime>;
const buildTruthMock = buildDAVEProjectTruth as jest.MockedFunction<typeof buildDAVEProjectTruth>;
const createRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<typeof createDAVEProjectTruthRepository>;
type CoreResult = Awaited<ReturnType<typeof buildLivePIECoreIntelligence>>;

const SAVED_UPDATES = [{
  id: 'update-1',
  projectName: 'Project One',
  date: '2026-09-29',
  photos: [],
  notes: 'Saved note.',
  recipients: { contactIds: [] },
  status: 'sent' as const,
}];

function input(draftNotes: string): PIELiveAuthorityInput {
  return {
    hydrated: true,
    organizationId: 'organization-1',
    projectId: 'project-1',
    projectName: 'Project One',
    projectNames: ['Project One'],
    updates: SAVED_UPDATES,
    scheduleItems: [],
    projectAreas: [],
    referenceDocuments: [],
    projectDocuments: [],
    captureMemories: [],
    currentUpdate: {
      id: 'draft-update',
      projectName: 'Project One',
      date: '2026-09-30',
      photos: [],
      notes: draftNotes,
      recipients: { contactIds: [] },
      status: 'draft',
    },
    identityTrusted: true,
    cloudAvailable: false,
  };
}

/** A Core as the live build returns it: runtime with the draft, authorityRuntime without. */
function coreFor(runtime: unknown, withDraft: boolean): CoreResult {
  return {
    runtime,
    authorityRuntime: withDraft
      ? { generatedAt: '2026-09-30T12:00:00.000Z', response: {}, marker: 'runtime-without-draft' }
      : runtime,
    realityAuthority: { modelId: 'project-1', persistenceStatus: 'authoritative_local' },
    realityModel: { organizationId: 'organization-1', projectId: 'project-1', evidenceConflicts: [], activeUncertainties: [] },
  } as unknown as CoreResult;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe('Project Truth follows the saved evidence, not the unsaved draft', () => {
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
    buildCoreMock.mockReset();
    buildCoreMock.mockImplementation(async coreInput => coreFor(
      coreInput?.runtime,
      Boolean(coreInput?.runtimeContext?.currentUpdate),
    ));
    buildRuntimeMock.mockClear();
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

  it('typing into the draft does not rebuild Project Truth on each keystroke', async () => {
    const screen = render(<PIELiveAuthorityProvider input={input('R')}><Probe /></PIELiveAuthorityProvider>);
    await flush();
    expect(authority?.core).not.toBeNull();
    const buildsBeforeTyping = buildTruthMock.mock.calls.length;

    const typed = 'Roof leak at bay 2';
    for (let length = 2; length <= typed.length; length += 1) {
      await screen.rerender(<PIELiveAuthorityProvider input={input(typed.slice(0, length))}><Probe /></PIELiveAuthorityProvider>);
    }
    expect(buildTruthMock.mock.calls.length).toBe(buildsBeforeTyping);
    expect(authority?.projectTruth).toMatchObject({ builtFrom: 'runtime-without-draft' });
  });

  it('the saved Project Truth is built from the runtime without the unsaved draft', async () => {
    render(<PIELiveAuthorityProvider input={input('Unsaved roof leak note')}><Probe /></PIELiveAuthorityProvider>);
    await flush();
    expect(buildCoreMock).toHaveBeenCalledTimes(1);
    expect(buildCoreMock.mock.calls[0][0]!.runtimeContext?.currentUpdate).toMatchObject({ notes: 'Unsaved roof leak note' });
    expect(saveMock).toHaveBeenCalled();
    for (const [, truth] of saveMock.mock.calls) {
      expect(truth).toMatchObject({ builtFrom: 'runtime-without-draft' });
    }
    expect(authority?.runtime).toMatchObject({ marker: 'runtime-with-draft' });
  });

  it('an empty draft is no evidence: one runtime per refresh, no draft passed to the Core', async () => {
    render(<PIELiveAuthorityProvider input={input('   ')}><Probe /></PIELiveAuthorityProvider>);
    await flush();
    expect(buildCoreMock).toHaveBeenCalledTimes(1);
    expect(buildCoreMock.mock.calls[0][0]!.runtimeContext?.currentUpdate).toBeNull();
    expect(buildRuntimeMock.mock.calls.every(([context]) => context?.currentUpdate === null)).toBe(true);
    expect(authority?.projectTruth).toMatchObject({ builtFrom: 'runtime-without-draft' });
  });
});

describe('L3: the authority rolls over at project-local midnight with no data change', () => {
  let authority: PIELiveAuthorityContextValue | null = null;

  function Probe() {
    authority = usePIELiveAuthority();
    return <Text>probe</Text>;
  }

  beforeEach(() => {
    // 23:59:30 in the default project time zone (Los Angeles, PDT).
    jest.useFakeTimers({ now: Date.parse('2026-10-01T06:59:30.000Z') });
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(callback => {
      if (typeof callback === 'function') callback();
      return { cancel: jest.fn() } as never;
    });
    authority = null;
    buildCoreMock.mockReset();
    buildCoreMock.mockImplementation(async coreInput => coreFor(coreInput?.runtime, false));
    createRepositoryMock.mockReset();
    createRepositoryMock.mockReturnValue({
      save: jest.fn(async () => ({ snapshot: { revision: 1 }, created: false, cloudStatus: 'local_only' })),
    } as unknown as ReturnType<typeof createDAVEProjectTruthRepository>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('a new day rebuilds the authority; the same day does not', async () => {
    const steady = input('');
    render(<PIELiveAuthorityProvider input={steady}><Probe /></PIELiveAuthorityProvider>);
    await flush();
    expect(buildCoreMock).toHaveBeenCalledTimes(1);
    expect(authority?.core).not.toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(20_000); // still 23:59:50
    });
    await flush();
    expect(buildCoreMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000); // 00:00:50, the next day
    });
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(500); // the input debounce
    });
    await flush();
    expect(buildCoreMock).toHaveBeenCalledTimes(2);
  });
});
