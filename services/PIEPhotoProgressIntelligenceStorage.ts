import AsyncStorage from '@react-native-async-storage/async-storage';
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
  await AsyncStorage.setItem(photoIntelligenceKey(result.organizationId, result.projectId), JSON.stringify(next));
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
  const value = await AsyncStorage.getItem(photoIntelligenceKey(organizationId, projectId));
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed?.version !== PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION ||
      parsed?.organizationId !== organizationId ||
      parsed?.projectId !== projectId
    ) {
      throw new Error('Photo intelligence storage boundary mismatch.');
    }
    return {
      ...empty,
      currentAnalysis: parsed.currentAnalysis || null,
      sequences: Array.isArray(parsed.sequences) ? parsed.sequences : [],
      progressEvents: Array.isArray(parsed.progressEvents) ? parsed.progressEvents : [],
      comparabilityAssessments: Array.isArray(parsed.comparabilityAssessments) ? parsed.comparabilityAssessments : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      cacheEntries: Array.isArray(parsed.cacheEntries) ? parsed.cacheEntries : [],
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : empty.savedAt,
    };
  } catch {
    await AsyncStorage.setItem(`${photoIntelligenceKey(organizationId, projectId)}.corrupt.${Date.now()}`, value);
    await AsyncStorage.removeItem(photoIntelligenceKey(organizationId, projectId));
    return empty;
  }
}

export async function clearPhotoProgressIntelligenceForTesting(
  organizationId: string,
  projectId: string,
): Promise<void> {
  await AsyncStorage.removeItem(photoIntelligenceKey(organizationId, projectId));
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

function photoIntelligenceKey(organizationId: string, projectId: string) {
  return `${PHOTO_INTELLIGENCE_PREFIX}.${PIE_PHOTO_INTELLIGENCE_STORAGE_VERSION}.${safeKey(organizationId)}.${safeKey(projectId)}`;
}

function safeKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'unverified';
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
