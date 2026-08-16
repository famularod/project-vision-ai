const storedKeys = new Set<string>();
const mockGetAllKeys = jest.fn(async () => [...storedKeys]);
const mockMultiRemove = jest.fn(async (keys: readonly string[]) => {
  keys.forEach(key => storedKeys.delete(key));
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: () => mockGetAllKeys(),
    multiRemove: (keys: readonly string[]) => mockMultiRemove(keys),
  },
}));

import {
  isLegacyRealityCacheKey,
  recoverLegacyPIERealityModelCache,
} from '../../services/PIERealityModelCacheRecovery';

describe('Build 61 Reality Model cache recovery', () => {
  beforeEach(() => {
    storedKeys.clear();
    mockGetAllKeys.mockClear();
    mockMultiRemove.mockClear();
    mockMultiRemove.mockImplementation(async keys => {
      keys.forEach(key => storedKeys.delete(key));
    });
  });

  it('removes only derived v1/v2 Reality Model records and preserves project data', async () => {
    const removable = [
      'projectVisionAI.pieRealityModel.v1.org.project',
      'projectVisionAI.pieRealityModel.v1.org.project.corrupt.1',
      'projectVisionAI.pieRealityModel.snapshots.v1.org.project',
      'projectVisionAI.pieRealityModel.evidenceDeltas.v1.org.project',
      'projectVisionAI.pieRealityModel.v2.org.project',
      'projectVisionAI.pieRealityModel.snapshots.v2.org.project',
      'projectVisionAI.pieRealityModel.evidenceDeltas.v2.org.project',
    ];
    const preserved = [
      'projectPhotoUpdates.v2',
      'projectPhotoUpdate.scheduleItems.v1',
      'projectPhotoUpdate.projectDocuments.v1',
      'projectVisionAI.pieExecutiveJudgments.v1.org.project',
      'projectVisionAI.piePhotoProgressIntelligence.v1.org.project',
      'projectVisionAI.pieRealityModel.v3.org.project',
    ];
    [...removable, ...preserved].forEach(key => storedKeys.add(key));

    const result = await recoverLegacyPIERealityModelCache();

    expect(result).toEqual({
      removedKeyCount: 7,
      removedCurrentModelCount: 3,
      removedSnapshotArchiveCount: 2,
      removedEvidenceDeltaCount: 2,
    });
    expect(mockMultiRemove).toHaveBeenCalledWith(removable);
    removable.forEach(key => expect(storedKeys.has(key)).toBe(false));
    preserved.forEach(key => expect(storedKeys.has(key)).toBe(true));
  });

  it('fails verification when the native removal leaves a legacy key behind', async () => {
    storedKeys.add('projectVisionAI.pieRealityModel.snapshots.v1.org.project');
    mockMultiRemove.mockImplementation(async () => undefined);

    await expect(recoverLegacyPIERealityModelCache()).rejects.toThrow(
      /cleanup could not be verified/i,
    );
  });

  it('matches only the approved derived cache prefixes', () => {
    expect(isLegacyRealityCacheKey('projectVisionAI.pieRealityModel.v1.org.project')).toBe(true);
    expect(isLegacyRealityCacheKey('projectVisionAI.pieRealityModel.v2.org.project')).toBe(true);
    expect(isLegacyRealityCacheKey('projectVisionAI.pieRealityModel.v3.org.project')).toBe(false);
    expect(isLegacyRealityCacheKey('projectPhotoUpdates.v2')).toBe(false);
    expect(isLegacyRealityCacheKey('projectVisionAI.pieExecutiveJudgments.v1.org.project')).toBe(false);
  });
});
