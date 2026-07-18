export const PIE_PHOTO_ANALYSIS_CONTRACT_VERSION = 'pie-photo-analysis-contract/v2' as const;

export const PIE_PHOTO_CONTRACT_FINDING_TYPES = Object.freeze([
  'added',
  'removed',
  'moved',
  'occluding',
  'revealed',
  'material_change',
  'visible_concern',
  'uncertain',
] as const);

export const PIE_PHOTO_CONTRACT_COMPARABILITY_IMPACTS = Object.freeze([
  'none',
  'minor',
  'limiting',
] as const);

export const PIE_PHOTO_ANALYSIS_CONTRACT = Object.freeze({
  contractVersion: PIE_PHOTO_ANALYSIS_CONTRACT_VERSION,
  analyzerId: 'pie-production-photo-vision',
  analyzerVersion: '2026.07.18-shared-contract-v2',
  policyVersion: '2026.07.18-shared-contract-v2',
  modes: Object.freeze({
    single_photo: Object.freeze({
      promptVersion: '2026.07.18-single-photo-shared-contract-v2',
      schemaVersion: '2026-07-p0-v2',
    }),
    photo_pair: Object.freeze({
      promptVersion: '2026.07.18-photo-pair-shared-contract-v2',
      schemaVersion: '2026-07-p1-v2',
    }),
  }),
  responseRules: Object.freeze({
    limitationsMinItems: 0,
  }),
} as const);

export type PIEPhotoAnalysisMode = keyof typeof PIE_PHOTO_ANALYSIS_CONTRACT.modes;

export type PIEPhotoAnalysisContractEnvelope = Readonly<{
  contractVersion: typeof PIE_PHOTO_ANALYSIS_CONTRACT_VERSION;
  analyzerVersion: string;
  promptVersion: string;
  schemaVersion: string;
  policyVersion: string;
}>;

export type PIEPhotoAnalysisContractValidation = Readonly<{
  valid: boolean;
  legacyEnvelope: boolean;
  categories: readonly string[];
}>;

export function photoAnalysisContractEnvelope(
  mode: PIEPhotoAnalysisMode,
): PIEPhotoAnalysisContractEnvelope {
  const modeContract = PIE_PHOTO_ANALYSIS_CONTRACT.modes[mode];
  return Object.freeze({
    contractVersion: PIE_PHOTO_ANALYSIS_CONTRACT.contractVersion,
    analyzerVersion: PIE_PHOTO_ANALYSIS_CONTRACT.analyzerVersion,
    promptVersion: modeContract.promptVersion,
    schemaVersion: modeContract.schemaVersion,
    policyVersion: PIE_PHOTO_ANALYSIS_CONTRACT.policyVersion,
  });
}

/**
 * New callers send the complete envelope. Missing envelopes and the historical
 * promptVersion-only request remain temporarily compatible with installed
 * clients. The edge always replaces those legacy labels with the canonical
 * contract before analysis. Any other partial or mismatched envelope fails
 * closed.
 */
export function validatePhotoAnalysisContractEnvelope(
  mode: PIEPhotoAnalysisMode,
  value: unknown,
): PIEPhotoAnalysisContractValidation {
  const expected = photoAnalysisContractEnvelope(mode);
  const record = isRecord(value) ? value : {};
  const fields = [
    'contractVersion',
    'analyzerVersion',
    'promptVersion',
    'schemaVersion',
    'policyVersion',
  ] as const;
  const suppliedCount = fields.filter(field => field in record).length;
  const legacyPromptOnly = suppliedCount === 1 && 'promptVersion' in record;
  if (suppliedCount === 0 || legacyPromptOnly) {
    return Object.freeze({ valid: true, legacyEnvelope: true, categories: Object.freeze([]) });
  }

  const categories: string[] = [];
  for (const field of fields) {
    if (!(field in record)) {
      categories.push(`missing_${field}`);
      continue;
    }
    if (record[field] !== expected[field]) categories.push(`invalid_${field}`);
  }
  return Object.freeze({
    valid: categories.length === 0,
    legacyEnvelope: false,
    categories: Object.freeze(categories),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
