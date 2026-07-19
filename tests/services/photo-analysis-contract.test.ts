import fs from 'fs';
import path from 'path';
import {
  PIE_PHOTO_ANALYSIS_CONTRACT,
  photoAnalysisContractEnvelope,
  validatePhotoAnalysisContractEnvelope,
} from '../../supabase/functions/_shared/pie-photo-analysis-contract';
import {
  PIE_PHOTO_PAIR_RESPONSE_SCHEMA,
  PIE_PHOTO_PAIR_SCHEMA_VERSION,
  validateStrictPhotoPairResponse,
} from '../../supabase/functions/_shared/pie-photo-comparison-schema';
import { CURRENT_PHOTO_ANALYSIS_VERSIONS } from '../../services/PhotoAnalysisIdentity';
import { PIE_PHOTO_FINDING_SCHEMA_VERSION } from '../../services/PIEPhotoFindingNormalization';

function validFinding() {
  return {
    findingType: 'added',
    description: 'White conduit is visible along the right wall.',
    objectName: 'conduit',
    baselineState: 'not visible',
    currentState: 'installed',
    location: 'right wall',
    confidence: 0.9,
    limitations: [],
    evidenceRegions: ['right side of current image'],
  };
}

function validPairResponse() {
  return {
    schemaVersion: PIE_PHOTO_PAIR_SCHEMA_VERSION,
    sameSceneProbability: 0.95,
    sameSubjectProbability: 0.94,
    sharedVisualAnchors: ['north wall', 'door opening'],
    sceneOverlapAssessment: 'The same work area is visible.',
    viewpointAssessment: 'Minor viewpoint change.',
    viewpointChange: 'Camera shifted slightly left.',
    cameraAngleChange: 'Minor horizontal angle change.',
    distanceChange: 'Similar distance.',
    framingChange: 'Current frame is slightly tighter.',
    lightingDifferences: [],
    lightingChange: 'No material lighting change.',
    lightingComparabilityImpact: 'none',
    obstructionDifferences: [],
    obstructionChange: 'No material obstruction change.',
    obstructionComparabilityImpact: 'none',
    alignmentConfidence: 'high',
    changeDetectionConfidence: 'high',
    objectAdditions: [],
    objectRemovals: [],
    materialOrStructuralChanges: [],
    visibleConcerns: [],
    movedObjects: [],
    occludingObjects: [],
    revealedObjects: [],
    uncertainFindings: [],
    unchangedConditions: ['Door opening remains visible.'],
    possibleRegression: [],
    differenceClassifications: ['physical_scene_change'],
    comparabilityClassification: 'strong',
    comparabilityReasons: ['Stable anchors align.'],
    conclusion: 'no_material_visible_change',
    confidence: 'high',
    limitations: [],
    repeatPhotoGuidance: [],
    observations: ['The same wall and door opening are visible.'],
    interpretations: [],
    plainLanguageSummary: 'No material visible change was found in the shared work area.',
  };
}

describe('shared photo analysis contract', () => {
  it('is the single version source for mobile analysis identities', () => {
    const expected = photoAnalysisContractEnvelope('photo_pair');
    expect(CURRENT_PHOTO_ANALYSIS_VERSIONS).toEqual({
      contractVersion: expected.contractVersion,
      analyzerId: PIE_PHOTO_ANALYSIS_CONTRACT.analyzerId,
      analyzerVersion: expected.analyzerVersion,
      promptVersion: expected.promptVersion,
      schemaVersion: expected.schemaVersion,
      policyVersion: expected.policyVersion,
    });
    expect(PIE_PHOTO_FINDING_SCHEMA_VERSION).toBe(expected.schemaVersion);
  });

  it('accepts a complete canonical handshake and rejects partial or drifted versions', () => {
    const expected = photoAnalysisContractEnvelope('photo_pair');
    expect(validatePhotoAnalysisContractEnvelope('photo_pair', expected)).toEqual({
      valid: true,
      legacyEnvelope: false,
      categories: [],
    });
    expect(validatePhotoAnalysisContractEnvelope('photo_pair', {
      ...expected,
      schemaVersion: 'drifted-schema',
    })).toMatchObject({ valid: false, categories: ['invalid_schemaVersion'] });
    expect(validatePhotoAnalysisContractEnvelope('photo_pair', {
      contractVersion: expected.contractVersion,
    })).toMatchObject({
      valid: false,
      categories: expect.arrayContaining([
        'missing_analyzerVersion',
        'missing_promptVersion',
        'missing_schemaVersion',
        'missing_policyVersion',
      ]),
    });
  });

  it('temporarily recognizes an entirely absent envelope as a legacy caller', () => {
    expect(validatePhotoAnalysisContractEnvelope('photo_pair', {})).toEqual({
      valid: true,
      legacyEnvelope: true,
      categories: [],
    });
    expect(validatePhotoAnalysisContractEnvelope('photo_pair', {
      promptVersion: '2026.07.13-structured-comparability-impact',
    })).toEqual({
      valid: true,
      legacyEnvelope: true,
      categories: [],
    });
  });

  it.each([
    ['empty limitations', validPairResponse(), true],
    ['populated limitations', { ...validPairResponse(), limitations: ['Glare obscures the lower-left corner.'] }, true],
    ['missing limitations', omit(validPairResponse(), 'limitations'), false],
    ['non-string limitation', { ...validPairResponse(), limitations: [42] }, false],
    ['wrong schema version', { ...validPairResponse(), schemaVersion: 'old-schema' }, false],
    ['out-of-range probability', { ...validPairResponse(), sameSceneProbability: 1.1 }, false],
    ['unexpected property', { ...validPairResponse(), inventedField: true }, false],
    ['out-of-range finding confidence', {
      ...validPairResponse(),
      objectAdditions: [{ ...validFinding(), confidence: 1.1 }],
    }, false],
  ])('keeps JSON schema and post-validator aligned for %s', (_label, fixture, expectedValid) => {
    const schemaValid = validatesJsonSchema(PIE_PHOTO_PAIR_RESPONSE_SCHEMA, fixture);
    const validatorResult = validateStrictPhotoPairResponse(fixture);
    expect(schemaValid).toBe(expectedValid);
    expect(validatorResult.valid).toBe(expectedValid);
    expect(validatorResult.valid).toBe(schemaValid);
  });

  it('wires the canonical envelope into mobile requests, edge validation, and provider prompts', () => {
    const root = path.resolve(__dirname, '../..');
    const mobile = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');
    const edge = fs.readFileSync(path.join(root, 'supabase/functions/pie-photo-vision/index.ts'), 'utf8');
    const provider = fs.readFileSync(path.join(root, 'supabase/functions/_shared/pie-vision-provider.ts'), 'utf8');

    for (const field of ['contractVersion', 'analyzerVersion', 'promptVersion', 'schemaVersion', 'policyVersion']) {
      expect(mobile).toContain(`${field}: analysisRunIdentity.versions.${field}`);
    }
    expect(edge).toContain("validatePhotoAnalysisContractEnvelope(mode, request)");
    expect(edge).toContain("photoAnalysisContractEnvelope(mode)");
    expect(provider).toContain('PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion');
    expect(provider).toContain('Use [] when no material limitation applies');
  });
});

function omit<T extends Record<string, unknown>, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

function validatesJsonSchema(schema: unknown, value: unknown): boolean {
  if (!isRecord(schema)) return true;
  if ('const' in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types[0] && !types.some(type => matchesType(type, value))) return false;

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (schema.items && !value.every(item => validatesJsonSchema(schema.items, item))) return false;
  }
  if (isRecord(value) && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every(key => typeof key === 'string' && key in value)) return false;
    if (schema.additionalProperties === false && isRecord(schema.properties)) {
      if (Object.keys(value).some(key => !(key in schema.properties))) return false;
    }
    if (isRecord(schema.properties)) {
      for (const [key, entry] of Object.entries(value)) {
        if (key in schema.properties && !validatesJsonSchema(schema.properties[key], entry)) return false;
      }
    }
  }
  return true;
}

function matchesType(type: unknown, value: unknown) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
