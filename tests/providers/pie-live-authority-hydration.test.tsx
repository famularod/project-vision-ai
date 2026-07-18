import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  PIELiveAuthorityProvider,
  type PIELiveAuthorityContextValue,
  type PIELiveAuthorityInput,
  usePIELiveAuthority,
} from '../../providers/PIELiveAuthorityProvider';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { createDAVEProjectTruthRepository } from '../../services/DAVEProjectTruthRepository';

jest.mock('../../services/PIECoreIntelligence', () => ({
  buildLivePIECoreIntelligence: jest.fn(),
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

const buildCoreMock = buildLivePIECoreIntelligence as jest.MockedFunction<
  typeof buildLivePIECoreIntelligence
>;
const createProjectTruthRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<
  typeof createDAVEProjectTruthRepository
>;
type CoreResult = Awaited<ReturnType<typeof buildLivePIECoreIntelligence>>;

function coreResult(projectId = 'project-1'): CoreResult {
  return {
    runtime: {
      generatedAt: '2026-07-17T12:00:00.000Z',
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
    buildCoreMock.mockImplementation(() => new Promise(() => undefined));
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

    buildCoreMock.mockResolvedValueOnce(coreResult());
    await screen.rerender(
      <PIELiveAuthorityProvider input={authorityInput(true)}>
        <AuthorityProbe />
      </PIELiveAuthorityProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(buildCoreMock).toHaveBeenCalledTimes(1);
    expect(createProjectTruthRepositoryMock).toHaveBeenCalled();
    expect(saveProjectTruthMock).toHaveBeenCalled();
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
