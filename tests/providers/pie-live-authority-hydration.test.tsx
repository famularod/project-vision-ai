import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  PIELiveAuthorityProvider,
  type PIELiveAuthorityContextValue,
  type PIELiveAuthorityInput,
  usePIELiveAuthority,
} from '../../providers/PIELiveAuthorityProvider';
import {
  buildLivePIECoreIntelligence,
  buildPIECoreIntelligence,
} from '../../services/PIECoreIntelligence';
import { createDAVEProjectTruthRepository } from '../../services/DAVEProjectTruthRepository';
import { runPIERealityModelOrchestration } from '../../services/PIERealityModelOrchestrator';
import { persistStructuredExecutiveJudgment } from '../../services/PIEExecutiveJudgmentRepository';

jest.mock('../../services/PIECoreIntelligence', () => ({
  buildPIECoreIntelligence: jest.fn(),
  buildLivePIECoreIntelligence: jest.fn(),
}));

jest.mock('../../services/PIERealityModelOrchestrator', () => ({
  runPIERealityModelOrchestration: jest.fn(),
}));

jest.mock('../../services/PIEExecutiveJudgmentRepository', () => ({
  persistStructuredExecutiveJudgment: jest.fn(),
}));

jest.mock('../../services/PIERuntime', () => ({
  buildRuntime: jest.fn(() => ({
    generatedAt: '2026-07-17T12:00:00.000Z',
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

const mockSavePhotoProgress = jest.fn();
jest.mock('../../services/PIEPhotoProgressIntelligenceStorage', () => ({
  savePhotoProgressIntelligence: (...args: unknown[]) => mockSavePhotoProgress(...args),
}));

const buildCoreMock = buildLivePIECoreIntelligence as jest.MockedFunction<
  typeof buildLivePIECoreIntelligence
>;
const buildInMemoryCoreMock = buildPIECoreIntelligence as jest.MockedFunction<
  typeof buildPIECoreIntelligence
>;
const runRealityOrchestrationMock = runPIERealityModelOrchestration as jest.MockedFunction<
  typeof runPIERealityModelOrchestration
>;
const persistExecutiveJudgmentMock = persistStructuredExecutiveJudgment as jest.MockedFunction<
  typeof persistStructuredExecutiveJudgment
>;
const createProjectTruthRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<
  typeof createDAVEProjectTruthRepository
>;
type CoreResult = Awaited<ReturnType<typeof buildLivePIECoreIntelligence>>;

function coreResult(
  projectId = 'project-1',
  persistenceStatus: CoreResult['realityAuthority']['persistenceStatus'] = 'authoritative_local',
): CoreResult {
  return {
    runtime: {
      generatedAt: '2026-07-17T12:00:00.000Z',
      response: {},
    },
    realityAuthority: {
      modelId: projectId,
      persistenceStatus,
    },
    realityModel: {
      organizationId: 'organization-1',
      projectId,
      evidenceConflicts: [],
      activeUncertainties: [],
    },
  } as unknown as CoreResult;
}

function authorityInput(hydrated: boolean): PIELiveAuthorityInput {
  return {
    hydrated,
    organizationId: 'organization-1',
    projectId: 'project-1',
    projectName: 'Project One',
    projectNames: ['Project One'],
    updates: [],
    scheduleItems: [],
    projectAreas: [],
    referenceDocuments: [],
    projectDocuments: [],
    captureMemories: [],
    identityTrusted: true,
    cloudAvailable: false,
  };
}

describe('PIELiveAuthorityProvider hydration boundary', () => {
  let currentAuthority: PIELiveAuthorityContextValue | null;
  const saveProjectTruthMock = jest.fn();

  function AuthorityProbe() {
    currentAuthority = usePIELiveAuthority();
    return <Text>Authority probe</Text>;
  }

  beforeEach(() => {
    currentAuthority = null;
    buildInMemoryCoreMock.mockReset();
    buildCoreMock.mockImplementation(() => new Promise(() => undefined));
    runRealityOrchestrationMock.mockReset();
    persistExecutiveJudgmentMock.mockReset();
    mockSavePhotoProgress.mockReset();
    mockSavePhotoProgress.mockResolvedValue(undefined);
    saveProjectTruthMock.mockResolvedValue({
      snapshot: { revision: 1 },
      created: true,
      cloudStatus: 'local_only',
    });
    createProjectTruthRepositoryMock.mockReturnValue({
      save: saveProjectTruthMock,
    } as unknown as ReturnType<typeof createDAVEProjectTruthRepository>);
  });

  it('does not refresh or persist before hydration, then refreshes once ready', async () => {
    const screen = await render(
      <PIELiveAuthorityProvider input={authorityInput(false)}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );

    expect(currentAuthority?.state).toBe('loading');
    expect(buildCoreMock).not.toHaveBeenCalled();
    expect(createProjectTruthRepositoryMock).not.toHaveBeenCalled();
    expect(saveProjectTruthMock).not.toHaveBeenCalled();

    await act(async () => {
      await currentAuthority?.refreshAuthority('manual_retry');
    });
    expect(buildCoreMock).not.toHaveBeenCalled();
    expect(saveProjectTruthMock).not.toHaveBeenCalled();

    let resolveReadyCore!: (result: CoreResult) => void;
    buildCoreMock.mockReturnValueOnce(new Promise(resolve => {
      resolveReadyCore = resolve;
    }));
    await screen.rerender(
      <PIELiveAuthorityProvider input={authorityInput(true)}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await act(async () => {
      resolveReadyCore(coreResult());
    });

    expect(buildCoreMock).toHaveBeenCalledTimes(1);
    expect(buildInMemoryCoreMock).not.toHaveBeenCalled();
    expect(createProjectTruthRepositoryMock).toHaveBeenCalled();
    expect(saveProjectTruthMock).toHaveBeenCalled();
  });

  it('computes combined portfolio authority fully in memory without persistence', async () => {
    buildInMemoryCoreMock.mockReturnValueOnce(
      coreResult('portfolio:project-record-a', 'degraded_local_only'),
    );
    const combinedInput = {
      ...authorityInput(true),
      projectId: 'portfolio:project-record-a',
      projectName: 'Combined Project Portfolio',
      projectNames: ['Project One', 'Project Two'],
      reportType: 'combined_project_update' as const,
      projectTruthPersistencePolicy: 'ephemeral_portfolio' as const,
    };

    await render(
      <PIELiveAuthorityProvider input={combinedInput}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(buildInMemoryCoreMock).toHaveBeenCalledTimes(1);
    expect(buildInMemoryCoreMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'organization-1',
      projectId: 'portfolio:project-record-a',
      reportType: 'combined_project_update',
      reportProjectNames: ['Project One', 'Project Two'],
    }));
    expect(buildCoreMock).not.toHaveBeenCalled();
    expect(runRealityOrchestrationMock).not.toHaveBeenCalled();
    expect(persistExecutiveJudgmentMock).not.toHaveBeenCalled();
    expect(mockSavePhotoProgress).not.toHaveBeenCalled();
    expect(createProjectTruthRepositoryMock).not.toHaveBeenCalled();
    expect(saveProjectTruthMock).not.toHaveBeenCalled();
    expect(currentAuthority?.state).toBe('degraded_local_only');
    expect(currentAuthority?.policy.highImpactAutomationAllowed).toBe(false);
    expect(currentAuthority?.policy.layer4DecisionCreationAllowed).toBe(false);
    expect(currentAuthority?.policy.reportGenerationAllowed).toBe(true);
  });

  it('discards a Core result that finishes after readiness returns to pending', async () => {
    let resolveCore!: (result: CoreResult) => void;
    buildCoreMock.mockReturnValue(new Promise(resolve => {
      resolveCore = resolve;
    }));

    const screen = await render(
      <PIELiveAuthorityProvider input={authorityInput(true)}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    expect(buildCoreMock).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <PIELiveAuthorityProvider input={authorityInput(false)}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );

    await act(async () => {
      resolveCore(coreResult());
    });

    expect(currentAuthority?.state).toBe('loading');
    expect(currentAuthority?.core).toBeNull();
  });
});
