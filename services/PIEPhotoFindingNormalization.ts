import {
  PIE_PHOTO_ANALYSIS_CONTRACT,
  PIE_PHOTO_CONTRACT_FINDING_TYPES,
} from '../supabase/functions/_shared/pie-photo-analysis-contract';

export const PIE_PHOTO_FINDING_SCHEMA_VERSION =
  PIE_PHOTO_ANALYSIS_CONTRACT.modes.photo_pair.schemaVersion;

export type PIEPhotoFindingType =
  | 'added'
  | 'removed'
  | 'moved'
  | 'occluding'
  | 'revealed'
  | 'material_change'
  | 'visible_concern'
  | 'uncertain';

export type PIEPhotoFinding = {
  findingType: PIEPhotoFindingType;
  description: string;
  objectName: string | null;
  baselineState: string | null;
  currentState: string | null;
  location: string | null;
  confidence: number | null;
  limitations: string[];
  evidenceRegions: string[];
  source: 'structured_provider' | 'legacy_provider_text';
};

export type PIEPhotoFindingNormalizationResult = {
  findings: PIEPhotoFinding[];
  rawFindingCount: number;
  normalizedFindingCount: number;
  legacyStringCount: number;
  rejectedFindingCount: number;
  rejectionCategories: string[];
};

const FINDING_TYPES: readonly PIEPhotoFindingType[] = PIE_PHOTO_CONTRACT_FINDING_TYPES;

export function normalizePIEPhotoFindings(
  value: unknown,
  fallbackType: PIEPhotoFindingType,
): PIEPhotoFindingNormalizationResult {
  const entries = Array.isArray(value) ? value : [];
  const findings: PIEPhotoFinding[] = [];
  const rejectionCategories: string[] = [];
  let legacyStringCount = 0;

  for (const entry of entries) {
    if (typeof entry === 'string') {
      const description = entry.trim();
      if (!description) {
        rejectionCategories.push('empty_legacy_string');
        continue;
      }
      legacyStringCount += 1;
      findings.push({
        findingType: fallbackType,
        description,
        objectName: null,
        baselineState: null,
        currentState: null,
        location: null,
        confidence: null,
        limitations: [],
        evidenceRegions: [],
        source: 'legacy_provider_text',
      });
      continue;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      rejectionCategories.push('finding_not_string_or_object');
      continue;
    }

    const record = entry as Record<string, unknown>;
    const description = text(record.description) ?? text(record.object) ?? text(record.finding);
    if (!description) {
      rejectionCategories.push('structured_finding_missing_description');
      continue;
    }
    const requestedType = typeof record.findingType === 'string' ? record.findingType : fallbackType;
    const findingType = FINDING_TYPES.includes(requestedType as PIEPhotoFindingType)
      ? requestedType as PIEPhotoFindingType
      : fallbackType;
    if (findingType !== requestedType) rejectionCategories.push('structured_finding_invalid_type_defaulted');

    findings.push({
      findingType,
      description,
      objectName: text(record.objectName) ?? text(record.object) ?? text(record.normalizedObjectName),
      baselineState: text(record.baselineState),
      currentState: text(record.currentState),
      location: text(record.location),
      confidence: finiteConfidence(record.confidence),
      limitations: strings(record.limitations),
      evidenceRegions: strings(record.evidenceRegions),
      source: 'structured_provider',
    });
  }

  return {
    findings,
    rawFindingCount: entries.length,
    normalizedFindingCount: findings.length,
    legacyStringCount,
    rejectedFindingCount: entries.length - findings.length,
    rejectionCategories: [...new Set(rejectionCategories)],
  };
}

export function findingDisplayText(finding: PIEPhotoFinding): string {
  return finding.description;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function finiteConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}
