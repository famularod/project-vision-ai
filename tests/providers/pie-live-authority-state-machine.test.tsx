import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  PIELiveAuthorityProvider,
  policyForCore,
  type PIELiveAuthorityContextValue,
  type PIELiveAuthorityInput,
  usePIELiveAuthority,
} from '../../providers/PIELiveAuthorityProvider';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { createDAVEProjectTruthRepository } from '../../services/DAVEProjectTruthRepository';
import {
  LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS,
  liveAuthorityRetryDelayMs,
  resolvePIELiveAuthorityState,
} from '../../services/PIELiveAuthorityStateMachine';

jest.mock('../../services/PIECoreIntelligence', () => ({
  buildLivePIECoreIntelligence: jest.fn(),
}));

jest.mock('../../services/PIERuntime', () => ({
  buildRuntime: jest.fn(() => ({
    generatedAt: '2026-07-18T12:00:00.000Z',
    response: {},
  })),
}));

jest.mock('../../services/DAVEProjectTruth', () => ({
  buildDAVEProjectTruth: jest.fn((input: { projectId: string; projectName: string }) => ({
    projectId: input.projectId,
    projectName: input.projectName,
  })),
}));

jest.mock('../../services/DAVEProjectTruthRepository', () => ({
  createDAVEProjectTruthRepository: jest.fn(),
}));

jest.mock('../../services/StartupDiagnostics', () => ({
  logStartupDiagnostic: jest.fn(),
  startupErrorMessage: (error: unknown) => String(error),
}));

const buildCoreMock = buildLivePIECoreIntelligence as jest.MockedFunction<
  typeof buildLivePIECoreIntelligence
>;
const createProjectTruthRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<
  typeof createDAVEProjectTruthRepository
>;
type CoreResult = Awaited<ReturnType<typeof buildLivePIECoreIntelligence>>;

function authorityInput(
  projectId = 'project-1',
  evidenceRevision?: string,
): PIELiveAuthorityInput {
  const projectName = projectId === 'project-1' ? 'Project One' : 'Project Two';
  return {
    hydrated: true,
    organizationId: 'organization-1',
    projectId,
    projectName,
    projectNames: [projectName],
    updates: evidenceRevision ? [{
      id: 'update-1',
      projectName,
      date: '2026-07-18T11:00:00.000Z',
      photos: [],
      notes: evidenceRevision,
      recipients: { contactIds: [] },
      status: 'sent',
    }] : [],
    scheduleItems: [],
    projectAreas: [],
    referenceDocuments: [],
    projectDocuments: [],
    captureMemories: [],
    identityTrusted: true,
    cloudAvailable: false,
  };
}

function coreResult(projectId = 'project-1'): CoreResult {
  return {
    runtime: {
      generatedAt: '2026-07-18T12:00:00.000Z',
      response: {},
    },
    realityAuthority: {
      modelId: projectId,
      persistenceStatus: 'authoritative_local',
    },
    realityModel: {
      organizationId: 'organization-1',
      projectId,
      evidenceConflicts: [],
      activeUncertainties: [],
    },
  } as unknown as CoreResult;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PIELiveAuthorityProvider freshness and retry state machine', () => {
  let currentAuthority: PIELiveAuthorityContextValue | null;
  const saveProjectTruthMock = jest.fn();

  function AuthorityProbe() {
    currentAuthority = usePIELiveAuthority();
    return <Text>Authority probe</Text>;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    currentAuthority = null;
    buildCoreMock.mockReset();
    saveProjectTruthMock.mockReset();
    saveProjectTruthMock.mockResolvedValue({
      snapshot: { revision: 1 },
      created: true,
      cloudStatus: 'local_only',
    });
    createProjectTruthRepositoryMock.mockReset();
    createProjectTruthRepositoryMock.mockReturnValue({
      save: saveProjectTruthMock,
    } as unknown as ReturnType<typeof createDAVEProjectTruthRepository>);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('rejects an older generation when project scope changes in flight', async () => {
    const staleRefresh = deferred<CoreResult>();
    const currentRefresh = deferred<CoreResult>();
    buildCoreMock
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(currentRefresh.promise);

    const screen = await render(
      <PIELiveAuthorityProvider input={authorityInput('project-1')}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();
    expect(currentAuthority?.state).toBe('loading');
    expect(buildCoreMock).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <PIELiveAuthorityProvider input={authorityInput('project-2')}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();

    expect(buildCoreMock).toHaveBeenCalledTimes(2);
    expect(currentAuthority?.state).toBe('loading');
    expect(currentAuthority?.core).toBeNull();
    expect(currentAuthority?.policy.reportGenerationAllowed).toBe(false);
    expect(currentAuthority?.policy.layer4DecisionCreationAllowed).toBe(false);

    await act(async () => {
      staleRefresh.resolve(coreResult('project-1'));
      await Promise.resolve();
    });
    expect(currentAuthority?.core).toBeNull();

    await act(async () => {
      currentRefresh.resolve(coreResult('project-2'));
      await Promise.resolve();
    });
    expect(currentAuthority?.state).toBe('ready');
    expect(currentAuthority?.core?.realityModel.projectId).toBe('project-2');
  });

  it('revokes ready policy immediately while same-scope evidence is debouncing', async () => {
    const refreshedCore = deferred<CoreResult>();
    buildCoreMock
      .mockResolvedValueOnce(coreResult())
      .mockReturnValueOnce(refreshedCore.promise);

    const screen = await render(
      <PIELiveAuthorityProvider input={authorityInput('project-1', 'revision one')}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();
    expect(currentAuthority?.state).toBe('ready');
    expect(currentAuthority?.policy.reportGenerationAllowed).toBe(true);

    await screen.rerender(
      <PIELiveAuthorityProvider input={authorityInput('project-1', 'revision two')}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );

    expect(currentAuthority?.state).toBe('stale_model');
    expect(currentAuthority?.core).toBeNull();
    expect(currentAuthority?.policy.reportGenerationAllowed).toBe(false);
    expect(currentAuthority?.policy.layer4DecisionCreationAllowed).toBe(false);
    expect(buildCoreMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(buildCoreMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshedCore.resolve(coreResult());
      await Promise.resolve();
    });
    expect(currentAuthority?.state).toBe('ready');
  });

  it('never grants ready permissions without a current Core result', () => {
    const resolution = resolvePIELiveAuthorityState({
      hydrated: true,
      refreshState: 'ready',
      corePresent: false,
      currentSignature: 'project-1:v2',
      acceptedSignature: null,
      currentGeneration: 'project-1:v2',
      acceptedGeneration: null,
    });
    const policy = policyForCore('ready', null);

    expect(resolution.state).toBe('stale_model');
    expect(resolution.coreIsCurrent).toBe(false);
    expect(policy.mayShowRecommendations).toBe(false);
    expect(policy.highImpactAutomationAllowed).toBe(false);
    expect(policy.reportGenerationAllowed).toBe(false);
    expect(policy.layer4DecisionCreationAllowed).toBe(false);
  });

  it('recovers automatically after one transient refresh failure', async () => {
    buildCoreMock
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(coreResult());

    await render(
      <PIELiveAuthorityProvider input={authorityInput()}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();

    expect(currentAuthority?.state).toBe('unavailable');
    expect(currentAuthority?.retryPending).toBe(true);
    expect(buildCoreMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(liveAuthorityRetryDelayMs(1));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buildCoreMock).toHaveBeenCalledTimes(2);
    expect(currentAuthority?.state).toBe('ready');
    expect(currentAuthority?.retryPending).toBe(false);
    expect(currentAuthority?.error).toBeNull();
  });

  it('stops after bounded automatic retries and allows a manual retry', async () => {
    buildCoreMock.mockRejectedValue(new Error('still unavailable'));

    await render(
      <PIELiveAuthorityProvider input={authorityInput()}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();

    for (let attempt = 1; attempt <= LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS; attempt += 1) {
      expect(currentAuthority?.retryPending).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(liveAuthorityRetryDelayMs(attempt));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(buildCoreMock).toHaveBeenCalledTimes(
      LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS + 1,
    );
    expect(currentAuthority?.state).toBe('unavailable');
    expect(currentAuthority?.retryPending).toBe(false);

    buildCoreMock.mockResolvedValueOnce(coreResult());
    await act(async () => {
      await currentAuthority?.refreshAuthority('manual_retry');
    });

    expect(buildCoreMock).toHaveBeenCalledTimes(
      LIVE_AUTHORITY_MAX_AUTO_RETRY_ATTEMPTS + 2,
    );
    expect(currentAuthority?.state).toBe('ready');
    expect(currentAuthority?.retryPending).toBe(false);
  });

  it('cancels an owned retry timer when the provider unmounts', async () => {
    buildCoreMock.mockRejectedValueOnce(new Error('temporary failure'));

    const screen = await render(
      <PIELiveAuthorityProvider input={authorityInput()}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await flushAsyncWork();

    expect(currentAuthority?.retryPending).toBe(true);

    await screen.unmount();

    await act(async () => {
      jest.advanceTimersByTime(liveAuthorityRetryDelayMs(1));
      await Promise.resolve();
    });
    expect(buildCoreMock).toHaveBeenCalledTimes(1);
  });
});
