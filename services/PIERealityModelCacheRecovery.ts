import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_REALITY_CURRENT_PREFIXES = [
  'projectVisionAI.pieRealityModel.v1.',
  'projectVisionAI.pieRealityModel.v2.',
] as const;
const LEGACY_REALITY_SNAPSHOT_PREFIXES = [
  'projectVisionAI.pieRealityModel.snapshots.v1.',
  'projectVisionAI.pieRealityModel.snapshots.v2.',
] as const;
const LEGACY_REALITY_DELTA_PREFIXES = [
  'projectVisionAI.pieRealityModel.evidenceDeltas.v1.',
  'projectVisionAI.pieRealityModel.evidenceDeltas.v2.',
] as const;
const LEGACY_REALITY_CACHE_PREFIXES = [
  ...LEGACY_REALITY_CURRENT_PREFIXES,
  ...LEGACY_REALITY_SNAPSHOT_PREFIXES,
  ...LEGACY_REALITY_DELTA_PREFIXES,
] as const;

export type PIERealityModelCacheRecoveryResult = {
  removedKeyCount: number;
  removedCurrentModelCount: number;
  removedSnapshotArchiveCount: number;
  removedEvidenceDeltaCount: number;
};

/**
 * Build 61 recovery boundary.
 *
 * Version 1 and 2 Reality Model records are derived entirely from the durable
 * project updates, schedules, photos, documents, and confirmed memories kept
 * under separate storage keys. Some early builds allowed the immutable model
 * snapshots to grow into hundreds of megabytes. Remove only those derived
 * records before compact v3 authority starts. Build 60's v2 format bounded
 * individual files but still duplicated full object graphs in the current
 * envelope and snapshot archive. Both versions are derived entirely from
 * durable project data, so removing them does not delete user-authored work.
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
      LEGACY_REALITY_CURRENT_PREFIXES.some(prefix => key.startsWith(prefix))).length,
    removedSnapshotArchiveCount: legacyKeys.filter(key =>
      LEGACY_REALITY_SNAPSHOT_PREFIXES.some(prefix => key.startsWith(prefix))).length,
    removedEvidenceDeltaCount: legacyKeys.filter(key =>
      LEGACY_REALITY_DELTA_PREFIXES.some(prefix => key.startsWith(prefix))).length,
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
