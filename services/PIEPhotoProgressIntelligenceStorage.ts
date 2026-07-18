import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  localCorruptionRecoveryError,
  quarantineCorruptLocalValue,
} from './LocalStorageCorruptionQuarantine';
import type {
  PIEPhotoComparabilityAssessment,
  PIEPhotoIntelligenceCacheEntry,
  PIEPhotoProgressConflict,
  PIEPhotoProgressEvent,
  PIEPhotoProgressIntelligenceResult,
  PIEPhotoSequence,
} from './PIEPhotoProgressIntelligence';

export const PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION = 'v1';

const PHOTO_INTELLIGENCE_PREFIX = 'projectVisionAI.piePhotoProgressIntelligence';

export type PIEPhotoProgressIntelligenceStoredState = {
  version: typeof PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION;
  organizationId: string;
  projectId: string;
  currentAnalysis: PIEPhotoProgressIntelligenceResult | null;
  sequences: PIEPhotoSequence[];
  progressEvents: PIEPhotoProgressEvent[];
  comparabilityAssessments: PIEPhotoComparabilityAssessment[];
  conflicts: PIEPhotoProgressConflict[];
  cacheEntries: PIEPhotoIntelligenceCacheEntry[];
  savedAt: string;
};

export async function savePhotoProgressIntelligence(
  result: PIEPhotoProgressIntelligenceResult,
): Promise<PIEPhotoProgressIntelligenceStoredState> {
  if (!isPhotoIntelligenceResultForScope(result, result.organizationId, result.projectId)) {
    throw new Error('Cannot store invalid or cross-scope photo progress intelligence.');
  }
  const previous = await loadPhotoProgressIntelligenceState(result.organizationId, result.projectId);
  const next: PIEPhotoProgressIntelligenceStoredState = {
    version: PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION,
    organizationId: result.organizationId,
    projectId: result.projectId,
    currentAnalysis: clone(result),
    sequences: mergeById(previous.sequences, result.sequences),
    progressEvents: mergeById(previous.progressEvents, result.progressEvents),
    comparabilityAssessments: mergeComparability(previous.comparabilityAssessments, result.comparabilityAssessments),
    conflicts: mergeById(previous.conflicts, result.conflicts),
    cacheEntries: mergeCacheEntries(previous.cacheEntries, result.cacheEntries),
    savedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(photoProgressIntelligenceStorageKey(result.organizationId, result.projectId), JSON.stringify(next));
  return next;
}

export async function loadLatestPhotoProgressIntelligence(
  organizationId: string,
  projectId: string,
): Promise<PIEPhotoProgressIntelligenceResult | null> {
  const state = await loadPhotoProgressIntelligenceState(organizationId, projectId);
  return state.currentAnalysis;
}

export async function loadPhotoProgressIntelligenceState(
  organizationId: string,
  projectId: string,
): Promise<PIEPhotoProgressIntelligenceStoredState> {
  const empty = emptyState(organizationId, projectId);
  const storageKey = photoProgressIntelligenceStorageKey(organizationId, projectId);
  const value = await AsyncStorage.getItem(storageKey);
  if (value === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return quarantineInvalidPhotoIntelligence(storageKey, value);
  }

  if (!isPhotoIntelligenceEnvelopeForScope(parsed, organizationId, projectId)) {
    return quarantineInvalidPhotoIntelligence(storageKey, value);
  }

  return parsed;
}

export async function clearPhotoProgressIntelligenceForTesting(
  organizationId: string,
  projectId: string,
): Promise<void> {
  await AsyncStorage.removeItem(photoProgressIntelligenceStorageKey(organizationId, projectId));
}

function emptyState(
  organizationId: string,
  projectId: string,
): PIEPhotoProgressIntelligenceStoredState {
  return {
    version: PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION,
    organizationId,
    projectId,
    currentAnalysis: null,
    sequences: [],
    progressEvents: [],
    comparabilityAssessments: [],
    conflicts: [],
    cacheEntries: [],
    savedAt: new Date().toISOString(),
  };
}

function mergeById<T extends { id: string }>(previous: T[], next: T[]): T[] {
  const byId = new Map<string, T>();
  [...previous, ...next].forEach(item => byId.set(item.id, clone(item)));
  return Array.from(byId.values());
}

function mergeComparability(
  previous: PIEPhotoComparabilityAssessment[],
  next: PIEPhotoComparabilityAssessment[],
): PIEPhotoComparabilityAssessment[] {
  const byId = new Map<string, PIEPhotoComparabilityAssessment>();
  [...previous, ...next].forEach(item => {
    byId.set(`${item.earlierPhotoId}:${item.laterPhotoId}`, clone(item));
  });
  return Array.from(byId.values());
}

function mergeCacheEntries(
  previous: PIEPhotoIntelligenceCacheEntry[],
  next: PIEPhotoIntelligenceCacheEntry[],
): PIEPhotoIntelligenceCacheEntry[] {
  const byId = new Map<string, PIEPhotoIntelligenceCacheEntry>();
  [...previous, ...next].forEach(item => {
    byId.set(item.comparisonInputSignature, clone(item));
  });
  return Array.from(byId.values());
}

export function photoProgressIntelligenceStorageKey(
  organizationId: string,
  projectId: string,
): string {
  return `${PHOTO_INTELLIGENCE_PREFIX}.${PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

async function quarantineInvalidPhotoIntelligence(
  storageKey: string,
  raw: string,
): Promise<never> {
  const recovery = await quarantineCorruptLocalValue({
    storage: AsyncStorage,
    storageKey,
    quarantineKeyPrefix: `${storageKey}.corrupt.`,
    raw,
    replacementRaw: null,
  });
  throw localCorruptionRecoveryError({
    label: 'Stored photo progress intelligence',
    recovery,
  });
}

function isPhotoIntelligenceEnvelopeForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIEPhotoProgressIntelligenceStoredState {
  if (
    !isRecord(value) ||
    value.version !== PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION ||
    value.organizationId !== organizationId ||
    value.projectId !== projectId ||
    typeof value.savedAt !== 'string' ||
    !isScopedPhotoCollections(value, organizationId, projectId)
  ) {
    return false;
  }
  return value.currentAnalysis === null ||
    isPhotoIntelligenceResultForScope(value.currentAnalysis, organizationId, projectId);
}

function isPhotoIntelligenceResultForScope(
  value: unknown,
  organizationId: string,
  projectId: string,
): value is PIEPhotoProgressIntelligenceResult {
  return (
    isRecord(value) &&
    value.organizationId === organizationId &&
    value.projectId === projectId &&
    typeof value.analysisVersion === 'string' &&
    typeof value.generatedAt === 'string' &&
    isScopedPhotoCollections(value, organizationId, projectId) &&
    Array.isArray(value.stalledProgressEvents) &&
    value.stalledProgressEvents.every(item =>
      isScopedPhotoRecord(item, organizationId, projectId)) &&
    Array.isArray(value.regressionCandidates) &&
    value.regressionCandidates.every(item =>
      isScopedPhotoRecord(item, organizationId, projectId)) &&
    Array.isArray(value.repeatPhotoGuidance) &&
    value.repeatPhotoGuidance.every(item =>
      isRecord(item) && item.projectId === projectId) &&
    Array.isArray(value.qualifiedRealityEvidence) &&
    value.qualifiedRealityEvidence.every(item =>
      isRecord(item) &&
      item.organizationId === organizationId &&
      item.projectId === projectId)
  );
}

function isScopedPhotoCollections(
  value: Record<string, unknown>,
  organizationId: string,
  projectId: string,
): boolean {
  return (
    Array.isArray(value.sequences) &&
    value.sequences.every(item => isScopedPhotoRecord(item, organizationId, projectId)) &&
    Array.isArray(value.progressEvents) &&
    value.progressEvents.every(item => isScopedPhotoRecord(item, organizationId, projectId)) &&
    Array.isArray(value.comparabilityAssessments) &&
    value.comparabilityAssessments.every(isComparabilityAssessment) &&
    Array.isArray(value.conflicts) &&
    value.conflicts.every(item => isScopedPhotoRecord(item, organizationId, projectId)) &&
    Array.isArray(value.cacheEntries) &&
    value.cacheEntries.every(isPhotoCacheEntry)
  );
}

function isScopedPhotoRecord(
  value: unknown,
  organizationId: string,
  projectId: string,
): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.organizationId === organizationId &&
    value.projectId === projectId
  );
}

function isComparabilityAssessment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.earlierPhotoId === 'string' &&
    typeof value.laterPhotoId === 'string'
  );
}

function isPhotoCacheEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.comparisonInputSignature === 'string' &&
    typeof value.sequenceId === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
