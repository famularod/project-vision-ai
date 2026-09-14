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

export type PIEPhotoVisionProviderFailureReason =
  | 'malformed_comparison_result'
  | 'provider_response_not_json'
  | 'provider_timeout'
  | 'provider_configuration_missing'
  | 'signed_image_unavailable'
  | `provider_http_${number}`
  | 'provider_failure';

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

/**
 * The Edge Function keeps the provider's raw failure in protected persistence,
 * but the client only receives a bounded code that cannot leak request IDs,
 * credentials, URLs, or provider response bodies.
 */
export function normalizePhotoVisionProviderFailureReason(
  value: unknown,
): PIEPhotoVisionProviderFailureReason | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return null;
  if (normalized.includes('malformed_comparison_result')) return 'malformed_comparison_result';
  const providerHttpStatus = normalized.match(/provider_http_(\d{3})/);
  if (providerHttpStatus) return `provider_http_${Number(providerHttpStatus[1])}`;
  if (normalized.includes('provider_response_not_json')) return 'provider_response_not_json';
  if (/timeout|timed out|aborterror|provider_timeout/.test(normalized)) return 'provider_timeout';
  if (/api[_ ]key|provider is not configured|vision_provider|provider_configuration/.test(normalized)) {
    return 'provider_configuration_missing';
  }
  if (/missing signed image url|signed_image/.test(normalized)) return 'signed_image_unavailable';
  return 'provider_failure';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
