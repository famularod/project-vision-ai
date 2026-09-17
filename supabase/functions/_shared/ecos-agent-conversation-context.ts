import { ecosExplicitEntityIdentities } from "./ecos-evidence-identity.ts";

export const ECOS_AGENT_CONVERSATION_CONTEXT_CONTRACT =
  "ecos-agent-conversation-context/1.0";

export type ECOSAgentConversationPriorTurn = Readonly<{
  conversationId: string;
  turnId: string;
  projectId: string;
  projectName: string;
  question: string;
  effectiveQuestion: string;
  evidenceSnapshotId: string | null;
}>;

export type ECOSAgentConversationResolution = Readonly<{
  status: "standalone" | "resolved_follow_up" | "project_switch";
  effectiveQuestion: string;
  scopeInstruction: string | null;
  priorTurnId: string | null;
  priorProjectId: string | null;
  priorProjectName: string | null;
}>;

export function resolveECOSAgentConversationQuestion(
  input: Readonly<{
    question: string;
    projectId: string;
    projectName: string;
    priorTurn: ECOSAgentConversationPriorTurn | null;
  }>,
): ECOSAgentConversationResolution {
  const question = clean(input.question);
  const prior = input.priorTurn;
  if (
    !prior || ecosConversationQuestionRequiresSafetyRefusal(question) ||
    !looksContextDependent(question, prior.effectiveQuestion || prior.question)
  ) {
    return resolution("standalone", question, prior);
  }
  const projectChanged = prior.projectId !== input.projectId;
  if (projectChanged && !explicitlyRequestsProjectSwitch(question)) {
    throw new Error("conversation_project_switch_not_explicit");
  }
  const priorQuestion = clean(prior.effectiveQuestion) || clean(prior.question);
  if (!priorQuestion) throw new Error("conversation_prior_question_invalid");
  const effectiveQuestion = projectChanged
    ? switchProjectIdentifiers(
      priorQuestion,
      prior.projectName,
      input.projectName,
    )
    : sameProjectFollowUp(priorQuestion, question);
  return resolution(
    projectChanged ? "project_switch" : "resolved_follow_up",
    effectiveQuestion,
    prior,
    projectChanged ? projectSwitchScopeInstruction(input.projectName) : null,
  );
}

export function ecosConversationQuestionRequiresSafetyRefusal(value: string) {
  const normalized = normalize(value);
  return /\b(?:ignore|disregard|override|bypass)\b[\s\S]{0,80}\b(?:rules?|instructions?|policy|policies|guardrails?)\b/
    .test(
      normalized,
    ) ||
    /\b(?:reveal|disclose|expose|show)\b[\s\S]{0,80}\banother\s+projects?\b[\s\S]{0,40}\b(?:records?|data|documents?|files?)\b/
      .test(
        normalized,
      );
}

export function buildECOSAgentConversationEnvelope(
  input: Readonly<{
    conversationId: string;
    turnId: string;
    resolution: ECOSAgentConversationResolution;
    evidenceSnapshotId: string | null;
  }>,
) {
  return Object.freeze({
    schemaVersion: ECOS_AGENT_CONVERSATION_CONTEXT_CONTRACT,
    conversationId: input.conversationId,
    turnId: input.turnId,
    priorTurnId: input.resolution.priorTurnId,
    priorProjectId: input.resolution.priorProjectId,
    priorProjectName: input.resolution.priorProjectName,
    status: input.resolution.status,
    effectiveQuestion: input.resolution.effectiveQuestion,
    evidenceSnapshotId: input.evidenceSnapshotId,
  });
}

export function parseECOSAgentConversationEnvelope(
  value: unknown,
): ECOSAgentConversationPriorTurn | null {
  const record = isRecord(value) ? value : {};
  if (
    record.schemaVersion !== ECOS_AGENT_CONVERSATION_CONTEXT_CONTRACT ||
    !uuid(record.conversationId) || !uuid(record.turnId) ||
    !text(record.projectId) || !text(record.projectName) ||
    !text(record.question) || !text(record.effectiveQuestion)
  ) return null;
  const snapshotId = record.evidenceSnapshotId == null
    ? null
    : uuid(record.evidenceSnapshotId);
  if (record.evidenceSnapshotId != null && !snapshotId) return null;
  return Object.freeze({
    conversationId: uuid(record.conversationId),
    turnId: uuid(record.turnId),
    projectId: text(record.projectId),
    projectName: text(record.projectName),
    question: text(record.question),
    effectiveQuestion: text(record.effectiveQuestion),
    evidenceSnapshotId: snapshotId,
  });
}

export function parseECOSAgentConversationOperationRecord(
  input: Readonly<{
    record: unknown;
    ownerId: string;
    conversationId: string;
    priorTurnId: string;
    nowMs?: number;
  }>,
): ECOSAgentConversationPriorTurn | null {
  const record = isRecord(input.record) ? input.record : {};
  if (
    text(record.id) !== input.priorTurnId ||
    text(record.owner_id) !== input.ownerId ||
    record.status !== "completed"
  ) return null;
  const expiresAt = Date.parse(text(record.response_expires_at));
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= (input.nowMs ?? Date.now()) ||
    !Array.isArray(record.project_ids)
  ) return null;
  const response = isRecord(record.response_payload)
    ? record.response_payload
    : {};
  const envelope = parseECOSAgentConversationEnvelope({
    ...(isRecord(response.conversation) ? response.conversation : {}),
    projectId: response.projectId,
    projectName: response.projectName,
    question: response.question,
  });
  if (
    !envelope || envelope.conversationId !== input.conversationId ||
    envelope.turnId !== input.priorTurnId ||
    !record.project_ids.some((value) => text(value) === envelope.projectId)
  ) return null;
  return envelope;
}

function resolution(
  status: ECOSAgentConversationResolution["status"],
  effectiveQuestion: string,
  prior: ECOSAgentConversationPriorTurn | null,
  scopeInstruction: string | null = null,
): ECOSAgentConversationResolution {
  return Object.freeze({
    status,
    effectiveQuestion,
    scopeInstruction,
    priorTurnId: prior?.turnId || null,
    priorProjectId: prior?.projectId || null,
    priorProjectName: prior?.projectName || null,
  });
}

function sameProjectFollowUp(priorQuestion: string, question: string) {
  const eachKind = referencedEachKind(question, priorQuestion);
  if (eachKind) {
    const subjects = ecosExplicitEntityIdentities(priorQuestion)
      .filter(({kind}) => kind === eachKind).map(({kind,id}) => `${kind} ${id}`);
    const replacement = subjects.length < 2 ? subjects[0]
      : `${subjects.slice(0,-1).join(", ")}${subjects.length > 2 ? "," : ""} and ${subjects.at(-1)}`;
    // Replace only the reference. Previous attributes (area, status, etc.)
    // must not become requirements of a new dimensions/height/owner question.
    return question.replace(/\beach\s+(?:of\s+the\s+)?[a-z]+\b/i, replacement);
  }
  const directSubject = /^(?:and|also|what\s+about|how\s+about)\s+(.+?)[?.!]*$/i
    .exec(question)?.[1]?.trim();
  const currentEntities = ecosExplicitEntityIdentities(question);
  const priorEntities = ecosExplicitEntityIdentities(priorQuestion);
  const changesExplicitSubject = currentEntities.some((current) =>
    !priorEntities.some((prior) =>
      prior.kind === current.kind && prior.id === current.id
    )
  );
  if (changesExplicitSubject) {
    // Resolve an explicit subject-only follow-up before retrieval. Flattening
    // old and new questions together would authorize BOTH labels in the
    // downstream identity filter. Unsupported/ambiguous changes must clarify.
    const target = currentEntities.length === 1 ? currentEntities[0] : null;
    const priorOfKind = target
      ? priorEntities.filter((item) => item.kind === target.kind)
      : [];
    const newSpan = directSubject && target
      ? soleEntitySpan(directSubject, target)
      : null;
    const oldSpan = priorOfKind.length === 1
      ? soleEntitySpan(priorQuestion, priorOfKind[0])
      : null;
    if (
      !target || !directSubject || !newSpan || !oldSpan ||
      directSubject.slice(0, newSpan.start).replace(/[^\p{L}\p{N}]/gu, "") ||
      directSubject.slice(newSpan.end).replace(/[^\p{L}\p{N}]/gu, "")
    ) {
      throw new Error("conversation_subject_change_requires_clarification");
    }
    const resolved = priorQuestion.slice(0, oldSpan.start) +
      directSubject.slice(newSpan.start, newSpan.end) +
      priorQuestion.slice(oldSpan.end);
    const remaining = ecosExplicitEntityIdentities(resolved).filter((item) =>
      item.kind === target.kind
    );
    if (remaining.length !== 1 || remaining[0].id !== target.id) {
      throw new Error("conversation_subject_change_requires_clarification");
    }
    return resolved;
  }
  const replacement = /^what\s+about\s+(.+?)[?.!]*$/i.exec(question)?.[1]
    ?.trim();
  if (replacement) {
    const priorSubject = subjectAfterAbout(priorQuestion);
    if (priorSubject) {
      return replaceLast(priorQuestion, priorSubject, replacement);
    }
    const canopy = /\bcanopy\s+[a-z0-9-]+\b/i.exec(priorQuestion)?.[0];
    if (canopy && /\bcanopy\b/i.test(replacement)) {
      return replaceLast(priorQuestion, canopy, replacement);
    }
  }
  return [
    `Previous user question: ${JSON.stringify(priorQuestion)}.`,
    `Current follow-up: ${JSON.stringify(question)}.`,
    "Resolve the reference from the previous question, but answer only from the currently selected project's authorized evidence.",
  ].join(" ");
}

/** Locate one labeled subject using the shared identity parser, not a canopy-specific rewrite. */
function soleEntitySpan(
  value: string,
  entity: Readonly<{ kind: string; id: string }>,
) {
  const tokens = [...value.matchAll(/\S+/g)];
  const candidates: { start: number; end: number }[] = [];
  for (let start = 0; start < tokens.length; start += 1) {
    for (
      let width = 1;
      width <= 4 && start + width <= tokens.length;
      width += 1
    ) {
      const from = tokens[start].index!;
      const last = tokens[start + width - 1];
      const to = last.index! + last[0].replace(/[?.!,;:]+$/, "").length;
      const identities = ecosExplicitEntityIdentities(value.slice(from, to));
      if (
        identities.length === 1 && identities[0].kind === entity.kind &&
        identities[0].id === entity.id
      ) {
        candidates.push({ start: from, end: to });
      }
    }
  }
  return candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ||
    null;
}

function switchProjectIdentifiers(
  priorQuestion: string,
  priorProjectName: string,
  currentProjectName: string,
) {
  const priorIdentifiers = projectIdentifiers(priorProjectName);
  let switched = priorQuestion;
  for (const identifier of priorIdentifiers) {
    switched = switched.replace(
      new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "gi"),
      currentProjectName,
    );
  }
  return switched;
}

function projectSwitchScopeInstruction(currentProjectName: string) {
  return [
    `Answer for the currently selected project ${
      JSON.stringify(currentProjectName)
    } only.`,
    "Do not carry facts, evidence, citations, or conclusions from the previously selected project.",
  ].join(" ");
}

function looksContextDependent(value: string, priorQuestion: string) {
  const normalized = normalize(value);
  if (normalized.split(" ").filter(Boolean).length > 18) return false;
  // A distributive reference such as "each room" refers to the labeled
  // rooms from the previous question. Do not carry subjects into a new
  // topic or an explicitly labeled new question. This is context only:
  // all facts and proof must still be researched under current authority.
  if (referencedEachKind(value, priorQuestion)) return true;
  return /^(?:and\b|also\b|what about\b|how about\b|now\b|same\b|use the new\b)/
    .test(
      normalized,
    ) ||
    /\b(?:that|this|it|those|them|they|same question|previous)\b/.test(
      normalized,
    );
}

function referencedEachKind(value: string, priorQuestion: string): string | null {
  const eachKind = /\beach\s+(?:of\s+the\s+)?([a-z]+)\b/.exec(normalize(value))?.[1];
  return eachKind && ecosExplicitEntityIdentities(value).length === 0 &&
      ecosExplicitEntityIdentities(priorQuestion).some(({kind}) => kind === eachKind)
    ? eachKind : null;
}

function explicitlyRequestsProjectSwitch(value: string) {
  const normalized = normalize(value);
  return /\b(?:now|switch|same question|for project|for the)\b/.test(
    normalized,
  );
}

function subjectAfterAbout(value: string) {
  return /^what\s+about\s+(.+?)[?.!]*$/i.exec(value)?.[1]?.trim() || "";
}

function replaceLast(value: string, search: string, replacement: string) {
  const index = value.toLowerCase().lastIndexOf(search.toLowerCase());
  return index < 0
    ? value
    : `${value.slice(0, index)}${replacement}${
      value.slice(index + search.length)
    }`;
}

function projectIdentifiers(value: string) {
  return [
    ...new Set((value.match(/\b\d{3,8}\b/g) || []).map((item) => item.trim())),
  ];
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uuid(value: unknown) {
  const normalized = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(
        normalized,
      )
    ? normalized
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
