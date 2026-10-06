import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { ECOS_ASK_DEADLINE_MS, ECOS_ASK_STOPPED_MESSAGE, ecosAskTimedOutMessage } from './ECOSAskProgress';
import { parseECOSConversationReceipt, validECOSConversationRequest, type ECOSConversationReceipt, type ECOSConversationRequest } from './ECOSConversation';
import type { DAVEAskEvidence } from './DAVEAsk';
import { normalizeECOSSheetProvenance } from './ECOSSheetProvenance';
import type { ReferenceDocumentRegionEvidence } from '../types';
import {
  buildECOSProjectQuestionRequest,
  ECOS_PROJECT_QUESTION_FUNCTION,
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  parseECOSQuestionDiagnostics,
  type ECOSQuestionDiagnostics,
} from './ECOSQuestionProtocol';
import { ecosProjectIdentifiers } from '../supabase/functions/_shared/ecos-project-reference';
import {
  ecosProjectReferenceMismatchMessage,
  projectReferenceMismatchText,
  type ECOSProjectRefusalContext,
  type ECOSProjectRefusalWording,
} from './ECOSProjectRefusal';

// The refusal wording lives in ./ECOSProjectRefusal (no network or native
// imports) so Talk can use the same words (audit A9 pass 6 L6).
export { ecosProjectReferenceMismatchMessage, type ECOSProjectRefusalWording } from './ECOSProjectRefusal';

export { ECOS_PROJECT_QUESTION_SCHEMA_VERSION } from './ECOSQuestionProtocol';
// One wrong-project rule for the app and the ecos-ask-project edge function
// (owner answer Q20, 30 Sep 2026; audit A9 pass 1 #2).
export {
  findECOSProjectReferenceMismatch,
  type ECOSProjectReferenceMismatch,
} from '../supabase/functions/_shared/ecos-project-reference';

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
  /** Second tier: statements the AI read from the pages that did not pass verification. Never merged into facts. */
  aiReadStatements: readonly ECOSAIReadStatement[];
  assurance: ECOSProjectQuestionAssurance;
  generatedAt: string;
  model: string;
  diagnostics: ECOSQuestionDiagnostics;
  conversation?: ECOSConversationReceipt;
}>;

export class ECOSProjectQuestionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly traceId: string | null = null,
    /** How long the server asked the app to wait before repeating the request, when it said. */
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ECOSProjectQuestionError';
  }
}

/**
 * The closed projects Ask ECOS checks a question against: archived names that
 * are neither deleted nor open again, without repeats (audit A9 pass 3 L1).
 */
export function ecosClosedProjectNames({
  archived,
  deleted = [],
  open = [],
}: {
  archived: readonly string[];
  deleted?: readonly string[];
  open?: readonly string[];
}): string[] {
  const key = (name: string) => name.trim().toLowerCase();
  const excluded = new Set([...deleted, ...open].map(key));
  const seen = new Set<string>();
  return archived.map(name => name.trim()).filter(name => {
    const nameKey = key(name);
    if (!nameKey || excluded.has(nameKey) || seen.has(nameKey)) return false;
    seen.add(nameKey);
    return true;
  });
}

/**
 * How a caller stops a question, and names it so a repeat can be recognised
 * (independent review R10).
 */
export type ECOSProjectQuestionControl = Readonly<{
  /** Aborting it stops the request at once; the call rejects with question_cancelled. */
  signal?: AbortSignal;
  /** Sent as the request id. A retry of a question that got no answer repeats it. */
  clientRequestId?: string;
}>;

type ECOSProjectQuestionInput = ECOSConversationRequest & ECOSProjectQuestionControl & {
  client: SupabaseClient | null;
  projectId: string | null;
  projectName: string;
  question: string;
  /** Checked here only; the server reads its own project list and never receives this. */
  knownProjectNames?: readonly string[] | null;
  /** Closed (archived, not deleted) projects; checked here only (audit A9 pass 3 L1). */
  closedProjectNames?: readonly string[] | null;
  /** How a wrong-project refusal tells the owner to switch (audit A9 pass 3 L3). */
  refusalWording?: ECOSProjectRefusalWording;
  /** The longest the whole call waits before it rejects with question_timed_out. */
  deadlineMs?: number;
};

/**
 * Asks one project question. The wait is bounded: the sign-in check, the
 * request and reading its answer together end by the deadline, and the
 * request is aborted when the deadline passes or the caller's signal fires
 * (independent review R10: this waited for as long as the connection hung).
 */
export async function askECOSProjectQuestion(input: ECOSProjectQuestionInput): Promise<ECOSProjectQuestionAnswer> {
  const wait = boundedAskWait(input.signal, input.deadlineMs ?? ECOS_ASK_DEADLINE_MS);
  return requestECOSProjectAnswer(input, wait).finally(wait.end);
}

async function requestECOSProjectAnswer({
  client,
  projectId,
  projectName,
  question,
  conversationId,
  priorTurnId,
  knownProjectNames,
  closedProjectNames,
  refusalWording = 'desktop',
  clientRequestId,
}: ECOSProjectQuestionInput, wait: ReturnType<typeof boundedAskWait>): Promise<ECOSProjectQuestionAnswer> {
  const cleanQuestion = question.replace(/\s+/g, ' ').trim();
  const cleanProjectName = projectName.trim();
  const cleanProjectId = projectId?.trim() || '';
  if (!validECOSConversationRequest({ conversationId, priorTurnId })) {
    throw new ECOSProjectQuestionError('conversation_context_invalid', 'Start a new Ask ECOS conversation, then ask again.');
  }
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
  const refusal = { knownProjectNames, closedProjectNames, refusalWording };
  const projectMismatchMessage = ecosProjectReferenceMismatchMessage(cleanProjectName, cleanQuestion, knownProjectNames, refusal);
  if (projectMismatchMessage) {
    throw new ECOSProjectQuestionError('project_reference_mismatch', projectMismatchMessage);
  }

  const { data: sessionResult, error: sessionError } = await wait.until(client.auth.getSession());
  const accessToken = sessionResult.session?.access_token;
  // A sign-in refresh that got no answer (no signal) keeps the session: it is
  // not a sign-out (whole-app audit A9 #6, as owner answer Q13 reads it).
  if (sessionError && isAuthRetryableFetchError(sessionError)) {
    throw new ECOSProjectQuestionError(
      'request_failed',
      projectQuestionErrorMessage(0, 'request_failed', cleanProjectName, cleanQuestion, refusal, null),
    );
  }
  if (sessionError || !accessToken) {
    throw new ECOSProjectQuestionError(
      'signed_out',
      'Your sign-in could not be verified. Sign in again, then retry.',
    );
  }

  const requestBody = buildECOSProjectQuestionRequest({
    projectId: cleanProjectId,
    projectName: cleanProjectName,
    question: cleanQuestion,
    conversationId,
    priorTurnId,
    clientRequestId: clientRequestId || undefined,
  });
  const { data, error, response } = await wait.until(client.functions.invoke(ECOS_PROJECT_QUESTION_FUNCTION, {
    headers: { Authorization: `Bearer ${accessToken}` },
    body: requestBody,
    signal: wait.signal,
  }));

  if (error) {
    const body = response
      ? await wait.until(response.clone().json().catch(() => null)) as Record<string, unknown> | null
      : null;
    const code = typeof body?.error === 'string' ? body.error : 'request_failed';
    const diagnostics = parseECOSQuestionDiagnostics(body?.diagnostics);
    throw new ECOSProjectQuestionError(
      code,
      projectQuestionErrorMessage(response?.status ?? 0, code, cleanProjectName, cleanQuestion, refusal, body),
      diagnostics?.traceId || null,
      positiveIntegerOrNull(body?.retryAfterSeconds),
    );
  }
  const answer = parseECOSProjectQuestionAnswer(data);
  // Older/general routing can answer standalone questions without supporting
  // continuity. Never turn that into an outage; linked follow-ups still require
  // a verified receipt, as does any server claiming conversation support.
  const requiresConversationReceipt = Boolean(priorTurnId) || objectValue(data).conversation != null;
  if (conversationId && requiresConversationReceipt && (answer.conversation?.conversationId !== conversationId ||
    answer.conversation.priorTurnId !== (priorTurnId || null) || answer.conversation.turnId === priorTurnId || !answer.diagnostics.persisted)) {
    throw new ECOSProjectQuestionError('conversation_context_unavailable',
      'ECOS could not verify this conversation. Start a new question with the full details.', answer.diagnostics.traceId);
  }
  if (answer.projectId !== requestBody.projectId || answer.question !== requestBody.question ||
    answer.diagnostics.clientRequestId !== requestBody.clientRequestId ||
    answer.diagnostics.clientSurface !== requestBody.clientSurface) {
    throw new ECOSProjectQuestionError('response_identity_mismatch',
      'ECOS received an answer for a different request. No answer was displayed. Please ask again.');
  }
  return answer;
}

/**
 * The limit on one question's wait. Stopping rejects whatever is being waited
 * for first, then aborts the request, so control returns even if the network
 * layer never notices the abort.
 */
function boundedAskWait(callerSignal: AbortSignal | undefined, deadlineMs: number) {
  const controller = new AbortController();
  let stopWaiting!: (error: ECOSProjectQuestionError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { stopWaiting = reject; });
  // A stop with nothing waiting on it (a refusal thrown before any request) is not an error of its own.
  stopped.catch(() => undefined);
  const stop = (code: 'question_timed_out' | 'question_cancelled', message: string) => {
    stopWaiting(new ECOSProjectQuestionError(code, message));
    controller.abort();
  };
  const cancelled = () => stop('question_cancelled', ECOS_ASK_STOPPED_MESSAGE);
  const timer = setTimeout(() => stop('question_timed_out', ecosAskTimedOutMessage(deadlineMs)), deadlineMs);
  if (callerSignal?.aborted) cancelled();
  else callerSignal?.addEventListener('abort', cancelled);
  return {
    signal: controller.signal,
    // Listed first: once stopped, nothing that was already answered is taken instead.
    until: <T>(work: PromiseLike<T>): Promise<T> => Promise.race([stopped, work]),
    end: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', cancelled);
    },
  };
}

/**
 * Whether asking the same question again could end differently. Not when the
 * question or the selected project has to change first.
 */
export function ecosAskCanRetry(error: unknown): boolean {
  const code = error instanceof ECOSProjectQuestionError ? error.code : '';
  return !['project_reference_mismatch', 'project_required', 'question_required', 'question_too_long'].includes(code);
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
  const diagnostics = parseECOSQuestionDiagnostics(record.diagnostics);
  const assuranceRecord = objectValue(record.assurance);
  const status = assuranceStatus(assuranceRecord.status);
  if (!projectId || !projectName || !question || !answer || !generatedAt || !model || !confidence || !status || !diagnostics) {
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
  const supportingEvidence = arrayValue(record.supportingEvidence).map(parseEvidence);

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
    aiReadStatements: Object.freeze(parseAIReadStatements(record.aiReadStatements)),
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
    diagnostics,
    ...(record.conversation != null ? { conversation: parseECOSConversationReceipt(record.conversation) || undefined } : {}),
  });
}

export type ECOSAIReadStatement = Readonly<{ statement: string; pageLabels: readonly string[] }>;
export const ECOS_AI_READ_LABEL = 'Read by AI, not yet verified';

function parseAIReadStatements(value: unknown): ECOSAIReadStatement[] {
  return arrayValue(value)
    .map(objectValue)
    .map(item => ({ statement: requiredText(item.statement), pageLabels: textArray(item.pageLabels).slice(0, 4) }))
    .filter(item => item.statement.length > 0)
    .slice(0, 12);
}

function parseEvidence(value: unknown): DAVEAskEvidence {
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
  const hasCitation = sourceType === 'document' && requiredText(citation.documentId);
  const hasRegion = hasCitation && requiredText(region.id) &&
    [region.x, region.y, region.width, region.height].every(isFiniteNumber);
  const rawSource = requiredText(region.rawSource) || requiredText(region.source) || null;
  const citationPageNumber = positiveIntegerOrNull(citation.pageNumber);
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
      documentId: requiredText(citation.documentId),
      projectId: requiredText(citation.projectId) || null,
      sourceSha256: canonicalSha256OrNull(citation.sourceSha256),
      evidenceVersion: requiredText(citation.evidenceVersion) || null,
      documentName: requiredText(citation.documentName),
      revision: requiredText(citation.revision) || null,
      pageNumber: citationPageNumber,
      sheetNumber: provenance.verified && provenance.sheetNumber === requiredText(citation.sheetNumber)
        ? provenance.sheetNumber
        : null,
      regionId: requiredText(citation.regionId) || null,
      label: requiredText(citation.label),
    } : null,
    documentProvenance: hasCitation ? provenance.provenance : null,
    proofTier: hasCitation && item.proofTier === 'page_text' && hasRegion && requiredText(region.id) === 'page'
      ? 'page_text'
      : hasRegion ? 'exact_region' : null,
    documentRegion: hasRegion ? {
      id: requiredText(region.id),
      label: requiredText(region.label) || null,
      text: requiredText(region.text) || null,
      areaNames: textArray(region.areaNames),
      x: Number(region.x),
      y: Number(region.y),
      width: Number(region.width),
      height: Number(region.height),
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
  refusal: ECOSProjectRefusalContext,
  body: Record<string, unknown> | null,
) {
  if (code.startsWith('conversation_') || code === 'prior_turn_id_invalid') {
    return 'ECOS could not recover the prior question for this project. Please ask again using the full question.';
  }
  if (code === 'proof_authority_permission_denied') {
    return 'Your sign-in is valid, but this account cannot verify the cited project proof.';
  }
  if (code === 'proof_authority_identity_mismatch') {
    return 'ECOS could not match a cited reference to the current project document and page. The answer was not completed.';
  }
  if (code === 'proof_source_unavailable') {
    return 'ECOS found relevant evidence, but the protected cited page is not ready to open yet. The answer was not completed.';
  }
  if (code === 'proof_authority_unavailable') {
    return 'The protected proof service is temporarily unavailable. The answer was not completed.';
  }
  if (code === 'proof_authority_response_invalid') {
    return 'ECOS rejected an invalid proof response. The answer was not completed.';
  }
  if (status === 401 || code === 'unauthorized') {
    return 'Your sign-in could not be verified. Sign in again, then retry.';
  }
  if (status === 403 || code === 'forbidden' || code === 'project_access_denied') {
    return 'This account is not authorized to ask about that project.';
  }
  if (status === 409 || code === 'question_in_progress') {
    if (code === 'project_reference_mismatch') {
      // The server names the numbers it matched against its own project list.
      const selectedIdentifier = requiredText(body?.selectedProjectIdentifier);
      const referencedIdentifier = requiredText(body?.referencedProjectIdentifier);
      if (/^\d{3,6}$/.test(selectedIdentifier) && /^\d{3,6}$/.test(referencedIdentifier)) {
        return projectReferenceMismatchText(
          selectedIdentifier,
          referencedIdentifier,
          referencedProjectIsClosed(referencedIdentifier, refusal),
          refusal.refusalWording ?? 'desktop',
        );
      }
      return ecosProjectReferenceMismatchMessage(projectName, question, refusal.knownProjectNames, refusal) || (
        refusal.refusalWording === 'phone'
          ? 'This question names a different project. Close this, open that project, then ask again.'
          : 'This question names a different project. Select the correct project above, then ask again.'
      );
    }
    return 'ECOS is already reviewing that question. Wait a moment, then retry.';
  }
  if (status === 429 || code === 'question_rate_limited') {
    return 'Ask ECOS has reached its short-term question limit. Wait a few minutes, then retry.';
  }
  if (code === 'answer_provider_unavailable') {
    return 'The AI answering service is temporarily unavailable. Your project information is unchanged. Please try again shortly.';
  }
  if (code === 'answer_timed_out') {
    return 'ECOS reached the time limit before it could finish checking the answer. Please try again; no answer has been verified.';
  }
  // The server gave up waiting on its own side: the live gateway answers 504
  // "agent_gateway_timed_out" after 125 s (Build 231 E1 item 3).
  if (status === 504 || code.endsWith('_timed_out')) {
    return 'ECOS ran out of time before it finished this question, so it stopped. ' +
      'No answer has been verified. Your question is still here — try again.';
  }
  if (code === 'answer_research_unavailable') {
    return 'ECOS could not complete the project evidence search because a required service failed. This does not mean your documents are missing. Please try again shortly.';
  }
  if (status === 502 || code === 'answer_provider_failed' || code === 'answer_invalid') {
    return 'ECOS could not verify this answer. No verified answer is available from this attempt. Please try again.';
  }
  if (status === 503 || code === 'ai_operation_control_unavailable') {
    return 'Ask ECOS is temporarily unavailable. Try again shortly.';
  }
  if (status === 0) {
    return 'Could not reach Ask ECOS. Check the connection and try again.';
  }
  return 'Ask ECOS could not complete the question. Try again shortly.';
}

/**
 * Whether a number the server refused is a closed project's here and no open
 * one's (audit A9 pass 3 L1), by any of its identifiers (audit A9 pass 13:
 * "480V Switchgear Upgrade 2375" is 2375 too).
 */
function referencedProjectIsClosed(identifier: string, refusal: ECOSProjectRefusalContext) {
  const has = (names: readonly string[] | null | undefined) =>
    (names || []).some(name => ecosProjectIdentifiers(name).some(({ digits }) => digits === identifier));
  return has(refusal.closedProjectNames) && !has(refusal.knownProjectNames);
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

function canonicalSha256OrNull(value: unknown) {
  const normalized = requiredText(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
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
