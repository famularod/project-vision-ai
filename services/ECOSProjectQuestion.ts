import type { SupabaseClient } from '@supabase/supabase-js';
import type { DAVEAskEvidence } from './DAVEAsk';
import { normalizeECOSSheetProvenance } from './ECOSSheetProvenance';
import type { ReferenceDocumentRegionEvidence } from '../types';

export const ECOS_PROJECT_QUESTION_SCHEMA_VERSION = 'ecos-project-question/1.0' as const;

export type ECOSProjectQuestionConfidence = 'high' | 'medium' | 'low';
export type ECOSProjectQuestionStatus =
  | 'verified'
  | 'verified_with_limits'
  | 'insufficient_evidence';

export type ECOSProjectQuestionFact = Readonly<{
  id: string;
  statement: string;
  classification: 'fact' | 'inference' | 'recommendation';
  sourceIds: readonly string[];
}>;

export type ECOSProjectQuestionAssurance = Readonly<{
  status: ECOSProjectQuestionStatus;
  checkedSourceCount: number;
  verifiedFactCount: number;
  rejectedFactCount: number;
  message: string;
}>;

export type ECOSProjectQuestionAnswer = Readonly<{
  schemaVersion: typeof ECOS_PROJECT_QUESTION_SCHEMA_VERSION;
  projectId: string;
  projectName: string;
  question: string;
  answer: string;
  confidence: ECOSProjectQuestionConfidence;
  facts: readonly ECOSProjectQuestionFact[];
  limitations: readonly string[];
  conflicts: readonly string[];
  suggestedQuestions: readonly string[];
  supportingEvidence: readonly DAVEAskEvidence[];
  assurance: ECOSProjectQuestionAssurance;
  generatedAt: string;
  model: string;
}>;

export class ECOSProjectQuestionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ECOSProjectQuestionError';
  }
}

export type ECOSProjectReferenceMismatch = Readonly<{
  selectedProjectIdentifier: string;
  referencedProjectIdentifier: string;
}>;

export function findECOSProjectReferenceMismatch(
  projectName: string,
  question: string,
): ECOSProjectReferenceMismatch | null {
  const selectedIdentifiers = projectIdentifiers(projectName);
  if (selectedIdentifiers.length === 0) return null;
  const selected = new Set(selectedIdentifiers);
  const referencedProjectIdentifier = projectIdentifiers(question).find(identifier => {
    if (selected.has(identifier)) return false;
    const numericIdentifier = Number(identifier);
    return numericIdentifier < 1900 || numericIdentifier > 2099;
  });
  return referencedProjectIdentifier ? Object.freeze({
    selectedProjectIdentifier: selectedIdentifiers[0],
    referencedProjectIdentifier,
  }) : null;
}

export function ecosProjectReferenceMismatchMessage(
  projectName: string,
  question: string,
): string | null {
  const mismatch = findECOSProjectReferenceMismatch(projectName, question);
  return mismatch
    ? `Project ${mismatch.selectedProjectIdentifier} is selected, but this question names ${mismatch.referencedProjectIdentifier}. Select project ${mismatch.referencedProjectIdentifier} above, then ask again.`
    : null;
}

export async function askECOSProjectQuestion({
  client,
  projectId,
  projectName,
  question,
}: {
  client: SupabaseClient | null;
  projectId: string | null;
  projectName: string;
  question: string;
}): Promise<ECOSProjectQuestionAnswer> {
  const cleanQuestion = question.replace(/\s+/g, ' ').trim();
  const cleanProjectName = projectName.trim();
  const cleanProjectId = projectId?.trim() || '';
  if (!client) {
    throw new ECOSProjectQuestionError(
      'not_configured',
      'Ask ECOS is unavailable until the secure cloud connection is configured.',
    );
  }
  if (!cleanProjectId || !cleanProjectName) {
    throw new ECOSProjectQuestionError(
      'project_required',
      'Choose a project before asking ECOS a project question.',
    );
  }
  if (cleanQuestion.length < 3) {
    throw new ECOSProjectQuestionError(
      'question_required',
      'Ask one clear project question.',
    );
  }
  if (cleanQuestion.length > 1_000) {
    throw new ECOSProjectQuestionError(
      'question_too_long',
      'Shorten the question to 1,000 characters or fewer.',
    );
  }
  const projectMismatchMessage = ecosProjectReferenceMismatchMessage(cleanProjectName, cleanQuestion);
  if (projectMismatchMessage) {
    throw new ECOSProjectQuestionError('project_reference_mismatch', projectMismatchMessage);
  }

  const { data: sessionResult, error: sessionError } = await client.auth.getSession();
  const accessToken = sessionResult.session?.access_token;
  if (sessionError || !accessToken) {
    throw new ECOSProjectQuestionError(
      'signed_out',
      'Your sign-in could not be verified. Sign in again, then retry.',
    );
  }

  const { data, error, response } = await client.functions.invoke('ecos-ask-project', {
    headers: { Authorization: `Bearer ${accessToken}` },
    body: {
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: cleanProjectId,
      projectName: cleanProjectName,
      question: cleanQuestion,
    },
  });

  if (error) {
    const body = response
      ? await response.clone().json().catch(() => null) as Record<string, unknown> | null
      : null;
    const code = typeof body?.error === 'string' ? body.error : 'request_failed';
    throw new ECOSProjectQuestionError(
      code,
      projectQuestionErrorMessage(response?.status ?? 0, code, cleanProjectName, cleanQuestion),
    );
  }
  const parsed = parseECOSProjectQuestionAnswer(data);
  if (parsed.projectId !== cleanProjectId ||
      normalizeProjectIdentity(parsed.projectName) !== normalizeProjectIdentity(cleanProjectName) ||
      parsed.question !== cleanQuestion) {
    throw new ECOSProjectQuestionError(
      'response_identity_mismatch',
      'ECOS returned an answer for a different project or question. Ask again from the selected project.',
    );
  }
  return Object.freeze({
    ...parsed,
    projectId: cleanProjectId,
    projectName: cleanProjectName,
    question: cleanQuestion,
  });
}

export function parseECOSProjectQuestionAnswer(value: unknown): ECOSProjectQuestionAnswer {
  const record = objectValue(value);
  if (record.schemaVersion !== ECOS_PROJECT_QUESTION_SCHEMA_VERSION) {
    throw new ECOSProjectQuestionError(
      'invalid_response',
      'ECOS returned an incompatible answer. Refresh the app and try again.',
    );
  }
  const projectId = requiredText(record.projectId);
  const projectName = requiredText(record.projectName);
  const question = requiredText(record.question);
  const answer = requiredText(record.answer);
  const generatedAt = requiredText(record.generatedAt);
  const model = requiredText(record.model);
  const confidence = confidenceValue(record.confidence);
  const assuranceRecord = objectValue(record.assurance);
  const status = assuranceStatus(assuranceRecord.status);
  if (!projectId || !projectName || !question || !answer || !generatedAt || !model || !confidence || !status) {
    throw invalidResponse();
  }

  const facts = arrayValue(record.facts).map((item, index) => {
    const fact = objectValue(item);
    const classification = fact.classification === 'fact' || fact.classification === 'inference' || fact.classification === 'recommendation'
      ? fact.classification
      : null;
    const statement = requiredText(fact.statement);
    if (!classification || !statement) throw invalidResponse();
    return Object.freeze({
      id: requiredText(fact.id) || `fact-${index + 1}`,
      statement,
      classification,
      sourceIds: Object.freeze(textArray(fact.sourceIds)),
    });
  });
  const supportingEvidence = arrayValue(record.supportingEvidence)
    .map(item => parseEvidence(item, projectId));

  return Object.freeze({
    schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
    projectId,
    projectName,
    question,
    answer,
    confidence,
    facts: Object.freeze(facts),
    limitations: Object.freeze(textArray(record.limitations)),
    conflicts: Object.freeze(textArray(record.conflicts)),
    suggestedQuestions: Object.freeze(textArray(record.suggestedQuestions).slice(0, 3)),
    supportingEvidence: Object.freeze(supportingEvidence),
    assurance: Object.freeze({
      status,
      checkedSourceCount: nonnegativeInteger(assuranceRecord.checkedSourceCount),
      verifiedFactCount: nonnegativeInteger(assuranceRecord.verifiedFactCount),
      rejectedFactCount: nonnegativeInteger(assuranceRecord.rejectedFactCount),
      message: requiredText(assuranceRecord.message) || 'ECOS Assurance completed its independent evidence check.',
    }),
    generatedAt,
    model,
  });
}

function parseEvidence(value: unknown, expectedProjectId: string): DAVEAskEvidence {
  const item = objectValue(value);
  const sourceType = item.sourceType === 'document' || item.sourceType === 'schedule' ||
    item.sourceType === 'update' || item.sourceType === 'project' || item.sourceType === 'memory'
    ? item.sourceType
    : null;
  const recordId = requiredText(item.recordId);
  const summary = requiredText(item.summary);
  if (!sourceType || !recordId || !summary) throw invalidResponse();
  const citation = objectValue(item.documentCitation);
  const region = objectValue(item.documentRegion);
  const rawProvenance = objectValue(item.documentProvenance);
  const citationDocumentId = requiredText(citation.documentId);
  const citationProjectId = requiredText(citation.projectId);
  const citationSourceSha256 = canonicalSha256(citation.sourceSha256);
  const citationEvidenceVersion = requiredText(citation.evidenceVersion);
  const citationDocumentName = requiredText(citation.documentName);
  const citationRevision = requiredText(citation.revision);
  const citationPageNumber = positiveIntegerOrNull(citation.pageNumber);
  const citationLabel = requiredText(citation.label);
  const hasCitation = sourceType === 'document' &&
    citationDocumentId &&
    recordId === citationDocumentId &&
    citationProjectId === expectedProjectId &&
    citationSourceSha256 &&
    citationEvidenceVersion &&
    citationDocumentName &&
    citationRevision &&
    citationPageNumber &&
    citationLabel;
  if (sourceType === 'document' && !hasCitation) throw invalidResponse();
  const citationRegionId = requiredText(citation.regionId);
  const regionId = requiredText(region.id);
  const regionWasSupplied = Object.keys(region).length > 0;
  const regionBounds = normalizedRegionBounds(region);
  if (hasCitation && (
    Boolean(citationRegionId) !== regionWasSupplied ||
    (citationRegionId && (regionId !== citationRegionId || !regionBounds))
  )) throw invalidResponse();
  const hasRegion = Boolean(hasCitation && citationRegionId && regionBounds);
  const rawSource = requiredText(region.rawSource) || requiredText(region.source) || null;
  const provenance = normalizeECOSSheetProvenance({
    pageNumber: citationPageNumber,
    sheetNumber: rawProvenance.sheetNumber,
    sheetMappingStatus: rawProvenance.sheetMappingStatus,
    sheetMappingSource: rawProvenance.sheetMappingSource,
    sheetMappingEvidence: rawProvenance.sheetMappingEvidence,
    documentStructuralIdentity: rawProvenance.documentStructuralIdentity,
    assurance: rawProvenance.assurance,
  }, {
    expectedPageNumber: citationPageNumber || undefined,
    requireAssurance: true,
    requireNativeRegionBinding: false,
  });
  return {
    sourceType,
    recordId,
    summary,
    timelineEventId: null,
    excerpt: requiredText(item.excerpt) || null,
    documentCitation: hasCitation ? {
      documentId: citationDocumentId,
      projectId: citationProjectId,
      sourceSha256: citationSourceSha256,
      evidenceVersion: citationEvidenceVersion,
      documentName: citationDocumentName,
      revision: citationRevision,
      pageNumber: citationPageNumber,
      sheetNumber: provenance.verified && provenance.sheetNumber === requiredText(citation.sheetNumber)
        ? provenance.sheetNumber
        : null,
      regionId: citationRegionId || null,
      label: citationLabel,
    } : null,
    documentProvenance: hasCitation ? provenance.provenance : null,
    documentRegion: hasRegion ? {
      id: regionId,
      label: requiredText(region.label) || null,
      text: requiredText(region.text) || null,
      areaNames: textArray(region.areaNames),
      x: regionBounds!.x,
      y: regionBounds!.y,
      width: regionBounds!.width,
      height: regionBounds!.height,
      confidence: normalizedConfidence(region.confidence),
      source: canonicalRegionSource(rawSource),
      rawSource,
      reconstructionMethod: requiredText(region.reconstructionMethod) || null,
      evidenceSources: textArray(region.evidenceSources),
      constituentEvidence: regionEvidenceArray(region.constituentEvidence),
      corroboratingEvidence: regionEvidenceArray(region.corroboratingEvidence),
    } : null,
  };
}

function projectQuestionErrorMessage(
  status: number,
  code: string,
  projectName: string,
  question: string,
) {
  if (status === 401 || code === 'unauthorized') {
    return 'Your sign-in could not be verified. Sign in again, then retry.';
  }
  if (status === 403 || code === 'forbidden' || code === 'project_access_denied') {
    return 'This account is not authorized to ask about that project.';
  }
  if (status === 409 || code === 'question_in_progress') {
    if (code === 'project_reference_mismatch') {
      return ecosProjectReferenceMismatchMessage(projectName, question) ||
        'This question names a different project. Select the correct project above, then ask again.';
    }
    return 'ECOS is already reviewing that question. Wait a moment, then retry.';
  }
  if (status === 429 || code === 'question_rate_limited') {
    return 'Ask ECOS has reached its short-term question limit. Wait a few minutes, then retry.';
  }
  if (code === 'answer_invalid') {
    return 'ECOS could not safely verify the generated response. Your project evidence was not changed. Try again shortly.';
  }
  if (status === 502 || code === 'answer_provider_failed') {
    return 'The ECOS answer service was temporarily unavailable. This does not mean the project evidence lacks an answer. Try again shortly.';
  }
  if (status === 503 || code === 'ai_operation_control_unavailable') {
    return 'Ask ECOS is temporarily unavailable. Try again shortly.';
  }
  if (status === 0) {
    return 'Could not reach Ask ECOS. Check the connection and try again.';
  }
  return 'Ask ECOS could not complete the question. Try again shortly.';
}

function projectIdentifiers(value: string): string[] {
  return [...new Set(value.match(/\b\d{4,6}\b/g) || [])];
}

function invalidResponse() {
  return new ECOSProjectQuestionError(
    'invalid_response',
    'ECOS returned an unreadable answer. Try again.',
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeProjectIdentity(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function canonicalSha256(value: unknown) {
  const normalized = requiredText(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(requiredText).filter(Boolean))]
    : [];
}

function confidenceValue(value: unknown): ECOSProjectQuestionConfidence | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

function assuranceStatus(value: unknown): ECOSProjectQuestionStatus | null {
  return value === 'verified' || value === 'verified_with_limits' || value === 'insufficient_evidence'
    ? value
    : null;
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveIntegerOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizedRegionBounds(value: Record<string, unknown>) {
  if (![value.x, value.y, value.width, value.height].every(isFiniteNumber)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x > 1 || y > 1 || width > 1 || height > 1 ||
    x + width > 1.001 || y + height > 1.001
  ) return null;
  return { x, y, width, height };
}

function canonicalRegionSource(value: string | null): 'embedded_text' | 'ocr' | 'vision' | null {
  if (value === 'deterministic_label_block') return 'ocr';
  return value === 'embedded_text' || value === 'ocr' || value === 'vision' ? value : null;
}

function regionEvidenceArray(value: unknown): ReferenceDocumentRegionEvidence[] {
  return arrayValue(value)
    .map(objectValue)
    .filter(item => Object.keys(item).length > 0)
    .map(item => ({ ...item }) as ReferenceDocumentRegionEvidence);
}
