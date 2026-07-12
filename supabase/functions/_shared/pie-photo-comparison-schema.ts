export const PIE_PHOTO_PAIR_SCHEMA_VERSION = '2026-07-p0-v1';

export const PIE_PHOTO_FINDING_TYPES = [
  'added',
  'removed',
  'moved',
  'occluding',
  'revealed',
  'material_change',
  'visible_concern',
  'uncertain',
] as const;

export type PIEPhotoFindingType = typeof PIE_PHOTO_FINDING_TYPES[number];

export type PIECanonicalPhotoFinding = {
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

const nullableStringSchema = { type: ['string', 'null'] };

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'findingType',
    'description',
    'objectName',
    'baselineState',
    'currentState',
    'location',
    'confidence',
    'limitations',
    'evidenceRegions',
  ],
  properties: {
    findingType: { type: 'string', enum: [...PIE_PHOTO_FINDING_TYPES] },
    description: { type: 'string' },
    objectName: nullableStringSchema,
    baselineState: nullableStringSchema,
    currentState: nullableStringSchema,
    location: nullableStringSchema,
    confidence: { type: 'number' },
    limitations: { type: 'array', items: { type: 'string' } },
    evidenceRegions: { type: 'array', items: { type: 'string' } },
  },
};

export const PIE_PHOTO_PAIR_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'sameSceneProbability',
    'sameSubjectProbability',
    'sharedVisualAnchors',
    'sceneOverlapAssessment',
    'viewpointAssessment',
    'viewpointChange',
    'cameraAngleChange',
    'distanceChange',
    'framingChange',
    'lightingDifferences',
    'lightingChange',
    'obstructionDifferences',
    'obstructionChange',
    'alignmentConfidence',
    'changeDetectionConfidence',
    'objectAdditions',
    'objectRemovals',
    'materialOrStructuralChanges',
    'visibleConcerns',
    'movedObjects',
    'occludingObjects',
    'revealedObjects',
    'uncertainFindings',
    'unchangedConditions',
    'possibleRegression',
    'differenceClassifications',
    'comparabilityClassification',
    'comparabilityReasons',
    'conclusion',
    'confidence',
    'limitations',
    'repeatPhotoGuidance',
    'observations',
    'interpretations',
    'plainLanguageSummary',
  ],
  properties: {
    schemaVersion: { type: 'string', const: PIE_PHOTO_PAIR_SCHEMA_VERSION },
    sameSceneProbability: { type: 'number' },
    sameSubjectProbability: { type: 'number' },
    sharedVisualAnchors: { type: 'array', items: { type: 'string' } },
    sceneOverlapAssessment: { type: 'string' },
    viewpointAssessment: { type: 'string' },
    viewpointChange: { type: 'string' },
    cameraAngleChange: { type: 'string' },
    distanceChange: { type: 'string' },
    framingChange: { type: 'string' },
    lightingDifferences: { type: 'array', items: { type: 'string' } },
    lightingChange: { type: 'string' },
    obstructionDifferences: { type: 'array', items: { type: 'string' } },
    obstructionChange: { type: 'string' },
    alignmentConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    changeDetectionConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    objectAdditions: { type: 'array', items: findingSchema },
    objectRemovals: { type: 'array', items: findingSchema },
    materialOrStructuralChanges: { type: 'array', items: findingSchema },
    visibleConcerns: { type: 'array', items: findingSchema },
    movedObjects: { type: 'array', items: findingSchema },
    occludingObjects: { type: 'array', items: findingSchema },
    revealedObjects: { type: 'array', items: findingSchema },
    uncertainFindings: { type: 'array', items: findingSchema },
    unchangedConditions: { type: 'array', items: { type: 'string' } },
    possibleRegression: { type: 'array', items: { type: 'string' } },
    differenceClassifications: {
      type: 'array',
      items: { type: 'string', enum: ['camera_or_capture_change', 'physical_scene_change', 'uncertain_change', 'mixed_change'] },
    },
    comparabilityClassification: { type: 'string', enum: ['strong', 'probable', 'weak', 'not_comparable'] },
    comparabilityReasons: { type: 'array', items: { type: 'string' } },
    conclusion: {
      type: 'string',
      enum: ['progress_visible', 'partial_progress_visible', 'no_material_visible_change', 'possible_regression', 'unable_to_determine'],
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    limitations: { type: 'array', items: { type: 'string' } },
    repeatPhotoGuidance: { type: 'array', items: { type: 'string' } },
    observations: { type: 'array', items: { type: 'string' } },
    interpretations: { type: 'array', items: { type: 'string' } },
    plainLanguageSummary: { type: 'string' },
  },
};

export const PIE_SINGLE_PHOTO_SCHEMA_VERSION = '2026-07-p0-v1';

export const PIE_SINGLE_PHOTO_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'scene',
    'probableProjectArea',
    'visibleSubjects',
    'equipment',
    'materials',
    'visibleWork',
    'installationState',
    'visibleConditions',
    'possibleQualityConcerns',
    'possibleSafetyConcerns',
    'imageQuality',
    'directObservations',
    'inferences',
    'confidence',
    'limitations',
    'requiredCorroboration',
    'recommendedFollowUpEvidence',
  ],
  properties: {
    scene: { type: 'string' },
    probableProjectArea: nullableStringSchema,
    visibleSubjects: { type: 'array', items: { type: 'string' } },
    equipment: { type: 'array', items: { type: 'string' } },
    materials: { type: 'array', items: { type: 'string' } },
    visibleWork: { type: 'array', items: { type: 'string' } },
    installationState: nullableStringSchema,
    visibleConditions: { type: 'array', items: { type: 'string' } },
    possibleQualityConcerns: { type: 'array', items: { type: 'string' } },
    possibleSafetyConcerns: { type: 'array', items: { type: 'string' } },
    imageQuality: {
      type: 'object',
      additionalProperties: false,
      required: ['clarity', 'lighting', 'notes'],
      properties: {
        clarity: { type: 'string' },
        lighting: { type: 'string' },
        notes: { type: 'string' },
      },
    },
    directObservations: { type: 'array', items: { type: 'string' } },
    inferences: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    limitations: { type: 'array', items: { type: 'string' } },
    requiredCorroboration: { type: 'array', items: { type: 'string' } },
    recommendedFollowUpEvidence: { type: 'array', items: { type: 'string' } },
  },
};

export type PIEFindingNormalizationDiagnostics = {
  rawFindingCount: number;
  normalizedFindingCount: number;
  legacyStringCount: number;
  rejectedFindingCount: number;
  rejectionCategories: string[];
};

export function normalizePhotoFindings(
  value: unknown,
  fallbackType: PIEPhotoFindingType,
): { findings: PIECanonicalPhotoFinding[]; diagnostics: PIEFindingNormalizationDiagnostics } {
  const entries = Array.isArray(value) ? value : [];
  const findings: PIECanonicalPhotoFinding[] = [];
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
    const description = stringOrNull(record.description) ?? stringOrNull(record.object) ?? stringOrNull(record.finding);
    if (!description) {
      rejectionCategories.push('structured_finding_missing_description');
      continue;
    }
    const requestedType = typeof record.findingType === 'string' ? record.findingType : fallbackType;
    const findingType = PIE_PHOTO_FINDING_TYPES.includes(requestedType as PIEPhotoFindingType)
      ? requestedType as PIEPhotoFindingType
      : fallbackType;
    if (findingType !== requestedType) rejectionCategories.push('structured_finding_invalid_type_defaulted');
    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.min(1, Math.max(0, record.confidence))
      : null;

    findings.push({
      findingType,
      description,
      objectName: stringOrNull(record.objectName) ?? stringOrNull(record.object) ?? stringOrNull(record.normalizedObjectName),
      baselineState: stringOrNull(record.baselineState),
      currentState: stringOrNull(record.currentState),
      location: stringOrNull(record.location),
      confidence,
      limitations: stringList(record.limitations),
      evidenceRegions: stringList(record.evidenceRegions),
      source: 'structured_provider',
    });
  }

  return {
    findings,
    diagnostics: {
      rawFindingCount: entries.length,
      normalizedFindingCount: findings.length,
      legacyStringCount,
      rejectedFindingCount: entries.length - findings.length,
      rejectionCategories: [...new Set(rejectionCategories)],
    },
  };
}

export function validateStrictPhotoPairResponse(value: unknown): { valid: true } | { valid: false; categories: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, categories: ['response_not_object'] };
  }
  const record = value as Record<string, unknown>;
  const categories: string[] = [];
  const required = PIE_PHOTO_PAIR_RESPONSE_SCHEMA.required;
  for (const key of required) {
    if (!(key in record)) categories.push(`missing_${key}`);
  }
  if (record.schemaVersion !== PIE_PHOTO_PAIR_SCHEMA_VERSION) categories.push('invalid_schema_version');
  for (const key of ['sameSceneProbability', 'sameSubjectProbability']) {
    if (
      typeof record[key] !== 'number' ||
      !Number.isFinite(record[key]) ||
      (record[key] as number) < 0 ||
      (record[key] as number) > 1
    ) categories.push(`invalid_${key}`);
  }
  for (const key of [
    'sceneOverlapAssessment', 'viewpointAssessment', 'viewpointChange', 'cameraAngleChange', 'distanceChange',
    'framingChange', 'lightingChange', 'obstructionChange', 'plainLanguageSummary',
  ]) {
    if (typeof record[key] !== 'string') categories.push(`invalid_${key}`);
  }
  for (const key of [
    'sharedVisualAnchors', 'lightingDifferences', 'obstructionDifferences', 'objectAdditions', 'objectRemovals',
    'materialOrStructuralChanges', 'visibleConcerns', 'movedObjects', 'occludingObjects', 'revealedObjects',
    'uncertainFindings', 'unchangedConditions', 'possibleRegression', 'differenceClassifications',
    'comparabilityReasons', 'limitations', 'repeatPhotoGuidance', 'observations', 'interpretations',
  ]) {
    if (!Array.isArray(record[key])) categories.push(`invalid_${key}`);
  }
  for (const key of [
    'sharedVisualAnchors', 'lightingDifferences', 'obstructionDifferences', 'unchangedConditions',
    'possibleRegression', 'comparabilityReasons', 'limitations', 'repeatPhotoGuidance', 'observations', 'interpretations',
  ]) {
    if (Array.isArray(record[key]) && !isStringArray(record[key])) categories.push(`invalid_${key}_items`);
  }
  for (const key of ['objectAdditions', 'objectRemovals', 'materialOrStructuralChanges', 'visibleConcerns', 'movedObjects', 'occludingObjects', 'revealedObjects', 'uncertainFindings']) {
    if (!Array.isArray(record[key])) continue;
    for (const entry of record[key] as unknown[]) {
      if (!isStrictFinding(entry)) categories.push(`invalid_finding_${key}`);
    }
  }
  if (!['strong', 'probable', 'weak', 'not_comparable'].includes(String(record.comparabilityClassification))) {
    categories.push('invalid_comparabilityClassification');
  }
  if (!['progress_visible', 'partial_progress_visible', 'no_material_visible_change', 'possible_regression', 'unable_to_determine'].includes(String(record.conclusion))) {
    categories.push('invalid_conclusion');
  }
  if (!['low', 'medium', 'high'].includes(String(record.confidence))) categories.push('invalid_confidence');
  if (!['low', 'medium', 'high'].includes(String(record.alignmentConfidence))) categories.push('invalid_alignmentConfidence');
  if (!['low', 'medium', 'high'].includes(String(record.changeDetectionConfidence))) categories.push('invalid_changeDetectionConfidence');
  if (Array.isArray(record.differenceClassifications) && !(record.differenceClassifications as unknown[]).every(item =>
    ['camera_or_capture_change', 'physical_scene_change', 'uncertain_change', 'mixed_change'].includes(String(item)))) {
    categories.push('invalid_differenceClassifications_items');
  }
  if (!Array.isArray(record.limitations) || record.limitations.length === 0) categories.push('limitations_required');
  return categories.length === 0 ? { valid: true } : { valid: false, categories: [...new Set(categories)] };
}

function isStrictFinding(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return PIE_PHOTO_FINDING_TYPES.includes(record.findingType as PIEPhotoFindingType) &&
    typeof record.description === 'string' && record.description.trim().length > 0 &&
    isNullableString(record.objectName) && isNullableString(record.baselineState) &&
    isNullableString(record.currentState) && isNullableString(record.location) &&
    typeof record.confidence === 'number' && Number.isFinite(record.confidence) && record.confidence >= 0 && record.confidence <= 1 &&
    isStringArray(record.limitations) && isStringArray(record.evidenceRegions);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}
