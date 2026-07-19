import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_REALITY_CACHE_PREFIXES = [
  'projectVisionAI.pieRealityModel.v1.',
  'projectVisionAI.pieRealityModel.snapshots.v1.',
  'projectVisionAI.pieRealityModel.evidenceDeltas.v1.',
] as const;

export type PIERealityModelCacheRecoveryResult = {
  removedKeyCount: number;
  removedCurrentModelCount: number;
  removedSnapshotArchiveCount: number;
  removedEvidenceDeltaCount: number;
};

/**
 * Build 60 recovery boundary.
 *
 * Version 1 Reality Model records are derived entirely from the durable
 * project updates, schedules, photos, documents, and confirmed memories kept
 * under separate storage keys. Some early builds allowed the immutable model
 * snapshots to grow into hundreds of megabytes. Remove only those derived v1
 * records before v2 authority starts; user-authored project data is never in
 * scope for this migration.
 */
export async function recoverLegacyPIERealityModelCache(): Promise<PIERealityModelCacheRecoveryResult> {
  const keys = await AsyncStorage.getAllKeys();
  const legacyKeys = keys.filter(isLegacyRealityCacheKey);
  if (legacyKeys.length === 0) return emptyRecoveryResult();

  await AsyncStorage.multiRemove(legacyKeys);
  const remainingLegacyKeys = (await AsyncStorage.getAllKeys()).filter(isLegacyRealityCacheKey);
  if (remainingLegacyKeys.length > 0) {
    throw new Error('Derived DAVE Reality Model cache cleanup could not be verified.');
  }

  return {
    removedKeyCount: legacyKeys.length,
    removedCurrentModelCount: legacyKeys.filter(key =>
      key.startsWith(LEGACY_REALITY_CACHE_PREFIXES[0])).length,
    removedSnapshotArchiveCount: legacyKeys.filter(key =>
      key.startsWith(LEGACY_REALITY_CACHE_PREFIXES[1])).length,
    removedEvidenceDeltaCount: legacyKeys.filter(key =>
      key.startsWith(LEGACY_REALITY_CACHE_PREFIXES[2])).length,
  };
}

export function isLegacyRealityCacheKey(key: string): boolean {
  return LEGACY_REALITY_CACHE_PREFIXES.some(prefix => key.startsWith(prefix));
}

function emptyRecoveryResult(): PIERealityModelCacheRecoveryResult {
  return {
    removedKeyCount: 0,
    removedCurrentModelCount: 0,
    removedSnapshotArchiveCount: 0,
    removedEvidenceDeltaCount: 0,
  };
}
