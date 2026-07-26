import {
  loadCurrentRealityModel,
  saveSynchronizedRealityModel,
} from '../../services/PIERealityModelStorage';
import {
  loadPIERealityModelCloud,
  savePIERealityModelCloud,
} from '../../services/SupabaseService';

jest.mock('../../services/PIERealityModelStorage', () => ({
  appendRealityObjectHistory: jest.fn(),
  getRealityConflicts: jest.fn(),
  getRealityModelSnapshots: jest.fn(),
  getRealityObjectHistory: jest.fn(),
  getRealityUncertainties: jest.fn(),
  loadCurrentRealityModel: jest.fn(),
  queryRealityObjects: jest.fn(),
  saveSynchronizedRealityModel: jest.fn(),
}));

jest.mock('../../services/SupabaseService', () => ({
  loadPIERealityModelCloud: jest.fn(),
  savePIERealityModelCloud: jest.fn(),
}));

import { createPIERealityModelRepository } from '../../services/PIERealityModelRepository';

const loadCloudMock = loadPIERealityModelCloud as jest.MockedFunction<
  typeof loadPIERealityModelCloud
>;
const saveCloudMock = savePIERealityModelCloud as jest.MockedFunction<
  typeof savePIERealityModelCloud
>;
const loadLocalMock = loadCurrentRealityModel as jest.MockedFunction<
  typeof loadCurrentRealityModel
>;
const saveLocalMock = saveSynchronizedRealityModel as jest.MockedFunction<
  typeof saveSynchronizedRealityModel
>;

const localModel = {
  id: 'local-model',
  organizationId: 'organization-1',
  projectId: 'project-1',
} as never;
const cloudModel = {
  id: 'cloud-model',
  organizationId: 'organization-1',
  projectId: 'project-1',
} as never;

describe('PIE Reality Model cloud authority tracking', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    loadLocalMock.mockResolvedValue(localModel);
    saveLocalMock.mockResolvedValue({
      currentModel: localModel,
    } as never);
  });

  it('labels a local fallback as unverified cloud authority', async () => {
    loadCloudMock.mockResolvedValue({
      ok: false,
      configured: true,
      data: null,
      message: 'Cloud read failed.',
    } as never);
    const repository = createPIERealityModelRepository({
      cloudEnabled: true,
      identityTrusted: true,
    });

    await expect(repository.loadCurrent('organization-1', 'project-1'))
      .resolves.toBe(localModel);
    expect(repository.hasFreshCloudAuthority?.()).toBe(false);
  });

  it('marks authority fresh only after a successful cloud read or write', async () => {
    loadCloudMock.mockResolvedValue({
      ok: true,
      configured: true,
      data: cloudModel,
    } as never);
    saveCloudMock.mockResolvedValue({
      ok: true,
      configured: true,
      data: cloudModel,
    } as never);
    const repository = createPIERealityModelRepository({
      cloudEnabled: true,
      identityTrusted: true,
    });

    await expect(repository.loadCurrent('organization-1', 'project-1'))
      .resolves.toBe(cloudModel);
    expect(repository.hasFreshCloudAuthority?.()).toBe(true);

    await expect(repository.saveSynchronized(localModel))
      .resolves.toBe(cloudModel);
    expect(repository.hasFreshCloudAuthority?.()).toBe(true);
  });
});
