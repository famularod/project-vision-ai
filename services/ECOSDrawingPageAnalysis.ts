import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocumentRegion } from '../types';

export const ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION = 'ecos-drawing-page-analysis/2.0' as const;
export const ECOS_DRAWING_PAGE_ANALYSIS_TIMEOUT_MS = 210_000;

export type ECOSDrawingBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ECOSDrawingDeepReadRegion = Readonly<{
  label: string;
  reason: string;
  bounds: ECOSDrawingBounds;
}>;

export type ECOSDrawingPageAnalysisResult = Readonly<{
  regions: readonly ReferenceDocumentRegion[];
  deepReadRegions: readonly ECOSDrawingDeepReadRegion[];
}>;

export type ECOSDrawingPageAnalysisInput = Readonly<{
  pageNumber: number;
  documentName: string;
  discipline: string | null;
  imageDataUrl: string;
  existingText: string;
  analysisPass?: 'overview' | 'deep_read' | 'page_tiles';
  tileBounds?: ECOSDrawingBounds | null;
  tileImages?: readonly Readonly<{
    bounds: ECOSDrawingBounds;
    imageDataUrl: string;
  }>[];
}>;

export class ECOSDrawingPageAnalysisError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterMilliseconds: number | null = null,
  ) {
    super(message);
    this.name = 'ECOSDrawingPageAnalysisError';
  }
}

export async function analyzeECOSDrawingPage({
  client,
  input,
}: {
  client: SupabaseClient | null;
  input: ECOSDrawingPageAnalysisInput;
}): Promise<ECOSDrawingPageAnalysisResult> {
  if (!client) throw new ECOSDrawingPageAnalysisError('not_configured', 'Drawing vision is not configured.');
  const { data: sessionResult, error: sessionError } = await client.auth.getSession();
  const accessToken = sessionResult.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ECOSDrawingPageAnalysisError('signed_out', 'Sign in again before updating the drawing index.');
  }
  const { data, error, response } = await client.functions.invoke('ecos-analyze-drawing-page', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: ECOS_DRAWING_PAGE_ANALYSIS_TIMEOUT_MS,
    body: {
      schemaVersion: ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION,
      pageNumber: input.pageNumber,
      documentName: input.documentName.slice(0, 500),
      discipline: input.discipline?.slice(0, 120) || null,
      existingText: input.existingText.slice(0, 16_000),
      imageDataUrl: input.imageDataUrl,
      analysisPass: input.analysisPass || 'overview',
      tileBounds: input.tileBounds || null,
      tileImages: (input.tileImages ?? []).map(tile => ({
        bounds: tile.bounds,
        imageDataUrl: tile.imageDataUrl,
      })),
    },
  });
  if (error) {
    const errorResponse = response || responseFromFunctionsError(error);
    const body = errorResponse
      ? await errorResponse.clone().json().catch(() => null) as Record<string, unknown> | null
      : null;
    const code = invocationTimedOut(error)
      ? 'analysis_timeout'
      : typeof body?.error === 'string' ? body.error : 'analysis_failed';
    throw new ECOSDrawingPageAnalysisError(
      code,
      drawingAnalysisFailureMessage(code, errorResponse?.status),
      retryAfterMilliseconds(body, errorResponse),
    );
  }
  return parseECOSDrawingPageAnalysis(data, input.pageNumber, input.tileBounds || null);
}

function invocationTimedOut(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const cause = record.cause && typeof record.cause === 'object'
    ? record.cause as Record<string, unknown>
    : {};
  const context = record.context && typeof record.context === 'object'
    ? record.context as Record<string, unknown>
    : {};
  return /timeout|timed out|abort/i.test([
    record.name,
    record.message,
    cause.name,
    cause.message,
    context.name,
    context.message,
  ].filter(value => typeof value === 'string').join(' '));
}

function responseFromFunctionsError(error: unknown): Response | null {
  if (!error || typeof error !== 'object' || !('context' in error)) return null;
  const context = (error as { context?: unknown }).context;
  return typeof Response !== 'undefined' && context instanceof Response ? context : null;
}

function retryAfterMilliseconds(body: Record<string, unknown> | null, response: Response | null) {
  const bodySeconds = Number(body?.retryAfterSeconds);
  const headerSeconds = Number(response?.headers.get('retry-after') || '');
  const seconds = Number.isFinite(bodySeconds) && bodySeconds > 0
    ? bodySeconds
    : Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds : 0;
  return seconds > 0 ? Math.min(15 * 60_000, Math.ceil(seconds * 1_000)) : null;
}

export function parseECOSDrawingPageAnalysis(
  value: unknown,
  pageNumber: number,
  tileBounds: ECOSDrawingBounds | null = null,
): ECOSDrawingPageAnalysisResult {
  const record = objectValue(value);
  if (record.schemaVersion !== ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION) {
    throw new ECOSDrawingPageAnalysisError('invalid_response', 'ECOS returned an incompatible drawing analysis.');
  }
  const idScope = tileBounds
    ? `tile-${Math.round(tileBounds.x * 1_000)}-${Math.round(tileBounds.y * 1_000)}`
    : 'overview';
  const regions = arrayValue(record.facts).flatMap((item, index): ReferenceDocumentRegion[] => {
    const fact = objectValue(item);
    const statement = text(fact.statement);
    const evidenceText = text(fact.evidenceText);
    const subject = text(fact.subject);
    const location = text(fact.location);
    const confidence = normalized(fact.confidence);
    const bounds = pageBounds(normalizedBounds(fact.bounds), tileBounds);
    if (!statement || !evidenceText || confidence == null || !bounds) return [];
    const regionText = [
      'ECOS VISUAL DRAWING FACT',
      subject ? `Subject: ${subject}` : '',
      location ? `Location: ${location}` : '',
      `Fact: ${statement}`,
      `Visible evidence: ${evidenceText}`,
    ].filter(Boolean).join('. ');
    return [{
      id: tileBounds
        ? `page-${pageNumber}-vision-${idScope}-${index + 1}`
        : `page-${pageNumber}-vision-${index + 1}`,
      label: statement,
      text: regionText,
      factKind: 'drawing_fact',
      subject: subject || null,
      location: location || null,
      evidenceText,
      areaNames: location ? [location] : [],
      ...bounds,
      confidence,
      source: 'vision',
    }];
  });
  const sheetIdentity = objectValue(record.sheetIdentity);
  const sheetNumber = text(sheetIdentity.sheetNumber);
  const sheetTitle = text(sheetIdentity.sheetTitle);
  const sheetEvidence = text(sheetIdentity.evidenceText);
  const sheetConfidence = normalized(sheetIdentity.confidence);
  const sheetBounds = pageBounds(normalizedBounds(sheetIdentity.bounds), tileBounds);
  if (sheetNumber && sheetEvidence && sheetConfidence != null && sheetBounds) {
    regions.push({
      id: `page-${pageNumber}-vision-${idScope}-sheet-identity`,
      label: `Sheet ${sheetNumber}${sheetTitle ? ` — ${sheetTitle}` : ''}`,
      text: [
        'ECOS VISUAL DRAWING FACT',
        'Subject: Sheet identity',
        'Location: Title block',
        `Fact: Sheet ${sheetNumber}${sheetTitle ? ` is titled “${sheetTitle}”` : ''}`,
        `Visible evidence: ${sheetEvidence}`,
      ].join('. '),
      factKind: 'sheet_identity',
      subject: 'Sheet identity',
      location: 'Title block',
      evidenceText: sheetEvidence,
      areaNames: ['Title block'],
      ...sheetBounds,
      confidence: sheetConfidence,
      source: 'vision',
    });
  }
  const deepReadRegions = arrayValue(record.deepReadRegions).flatMap(item => {
    const deepRead = objectValue(item);
    const label = text(deepRead.label);
    const reason = text(deepRead.reason);
    const bounds = pageBounds(normalizedBounds(deepRead.bounds), tileBounds);
    return label && reason && bounds ? [{ label, reason, bounds }] : [];
  });
  return Object.freeze({
    regions: Object.freeze(regions),
    deepReadRegions: Object.freeze(deepReadRegions),
  });
}

function pageBounds(
  value: ECOSDrawingBounds | null,
  tileBounds: ECOSDrawingBounds | null,
) {
  if (!value) return null;
  if (!tileBounds) return value;
  return {
    x: tileBounds.x + value.x * tileBounds.width,
    y: tileBounds.y + value.y * tileBounds.height,
    width: value.width * tileBounds.width,
    height: value.height * tileBounds.height,
  };
}

function normalizedBounds(value: unknown) {
  const record = objectValue(value);
  const x = coordinate(record.x);
  const y = coordinate(record.y);
  const width = coordinate(record.width);
  const height = coordinate(record.height);
  if ([x, y, width, height].some(item => item == null) || width! <= 0 || height! <= 0) return null;
  return {
    x: x!,
    y: y!,
    width: Math.min(width!, 1 - x!),
    height: Math.min(height!, 1 - y!),
  };
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000) return null;
  return parsed / 1_000;
}

function normalized(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 2_000) : '';
}

function drawingAnalysisFailureMessage(code: string, status?: number) {
  if (code === 'signed_out' || code === 'unauthorized') {
    return 'Sign in again before ECOS continues the drawing index.';
  }
  if (code === 'forbidden') return 'This account is not authorized to update the drawing index.';
  if (code === 'request_too_large') return 'The drawing tile was too large for secure visual analysis.';
  if (code === 'analysis_rate_limited') return 'Vitruvius drawing analysis is temporarily busy. Completed work is saved. Try again later; no separate service account is required.';
  if (code === 'analysis_prepaid_credits_depleted') return 'Vitruvius drawing analysis is temporarily unavailable. Completed work is saved. Try again later; no separate account or credits are required.';
  if (code === 'analysis_quota_exhausted') return 'Vitruvius drawing analysis is temporarily unavailable. Completed work is saved. Try again later; no separate account or credits are required.';
  if (code === 'analysis_request_exceeds_rate_limit') return 'Vitruvius could not finish this drawing area. Completed work is saved, and ECOS will retry only unfinished work.';
  if (code === 'analysis_timeout') return 'Vitruvius drawing analysis took too long to finish. Completed work is saved, and this page can resume.';
  if (code === 'analysis_provider_failed') return 'Vitruvius could not finish this drawing area. Completed work is saved, and ECOS will retry only unfinished work.';
  if (code === 'analysis_invalid') return 'ECOS could not validate the drawing evidence. The page was not marked ready.';
  if (code === 'assurance_provider_failed') return 'ECOS Assurance could not complete independent verification. The page was not marked ready.';
  if (code === 'assurance_invalid') return 'ECOS Assurance rejected an invalid verification result. The page was not marked complete.';
  if (code === 'origin_not_allowed') return 'This Vitruvius website address is not authorized for drawing analysis.';
  if (code === 'invalid_request') return 'ECOS could not validate the drawing-analysis request.';
  return `ECOS visual drawing analysis did not finish${status ? ` (HTTP ${status})` : ''}.`;
}
