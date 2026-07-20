import {
  normalizePhotoVisionProviderFailureReason,
  type PIEPhotoVisionProviderFailureReason,
} from '../supabase/functions/_shared/pie-photo-analysis-contract';

export type PIEPhotoVisionFailureCategory =
  | 'network'
  | 'auth'
  | 'malformed_response'
  | 'provider_side'
  | 'unknown';

export type PIEPhotoVisionProviderResponse = Readonly<{
  status: string;
  failureReason: PIEPhotoVisionProviderFailureReason | null;
  failureCategory: PIEPhotoVisionFailureCategory;
}>;

export function readPIEPhotoVisionProviderResponse(value: unknown): PIEPhotoVisionProviderResponse {
  const record = isRecord(value) ? value : {};
  const status = typeof record.status === 'string' ? record.status : 'unknown';
  const failureReason = normalizePhotoVisionProviderFailureReason(record.failureReason);
  const failureCategory = failureReason === 'malformed_comparison_result' ||
    failureReason === 'provider_response_not_json'
    ? 'malformed_response'
    : failureReason
      ? 'provider_side'
      : status === 'degraded'
        ? 'malformed_response'
        : status === 'succeeded'
          ? 'unknown'
          : 'provider_side';
  return Object.freeze({ status, failureReason, failureCategory });
}

export function providerFailureSummary(reason: PIEPhotoVisionProviderFailureReason | null): string {
  if (reason === 'malformed_comparison_result' || reason === 'provider_response_not_json') {
    return 'The photo comparison response could not be processed. Retry analysis.';
  }
  if (reason === 'provider_timeout') {
    return 'Photo analysis took longer than expected. Retry analysis.';
  }
  if (reason === 'provider_configuration_missing') {
    return 'The photo analysis service is temporarily unavailable. Retry after service is restored.';
  }
  if (reason === 'signed_image_unavailable') {
    return 'One of the comparison photos could not be opened by the analysis service. Retry analysis.';
  }
  return 'Photo intelligence returned an unavailable comparison. Retry analysis.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
