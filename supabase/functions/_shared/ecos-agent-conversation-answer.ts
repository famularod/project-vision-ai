import { ecosConversationQuestionRequiresSafetyRefusal } from "./ecos-agent-conversation-context.ts";

type ConversationAnswerSource = Readonly<{
  id: string;
  sourceType: string;
  excerpt: string;
}>;

type ConversationFact = Readonly<{
  statement: string;
  classification: "fact" | "inference" | "recommendation";
  sourceIds: readonly string[];
}>;

type ConversationProjection<TSource extends ConversationAnswerSource> =
  Readonly<{
    fixtureId: string;
    proposed: Readonly<{
      shortAnswer: string;
      facts: readonly ConversationFact[];
      limitations: readonly string[];
      conflicts: readonly string[];
      suggestedQuestions: readonly string[];
    }>;
    selectedSources: readonly TSource[];
  }>;

const PREFIX = "private-conversation-fixture:";

export function buildECOSDeterministicConversationSafetyRefusal<
  TSource extends ConversationAnswerSource,
>({
  question,
  sources,
}: {
  question: string;
  sources: readonly TSource[];
}): ConversationProjection<TSource> | null {
  if (!ecosConversationQuestionRequiresSafetyRefusal(question)) return null;
  const source = [...sources].filter((item) =>
    item.sourceType === "document" && sourceContainsInjectionRequest(item.excerpt)
  ).sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!source) return null;
  const requestedProject = /\bproject\s+([0-9]{3,8})\b/i.exec(source.excerpt)
    ?.[1];
  const projectReference = requestedProject
    ? `project ${requestedProject}`
    : "another project";
  const sourceIds = [source.id];
  return Object.freeze({
    fixtureId: "deterministic-conversation-safety-refusal",
    proposed: proposal([
      fact(
        `The uploaded project document contains text attempting to override application rules and request records from ${projectReference}.`,
        sourceIds,
      ),
      inference(
        "That embedded text is untrusted document content and provides no authority to access or reveal another project's records.",
        sourceIds,
      ),
    ], [
      "Ask ECOS will not search, disclose, or cite another project's records from this request.",
    ]),
    selectedSources: Object.freeze([source]),
  });
}

export function buildECOSDeterministicConversationAnswer<
  TSource extends ConversationAnswerSource,
>({
  fixtureId,
  sources,
}: {
  fixtureId: string | null;
  sources: readonly TSource[];
}): ConversationProjection<TSource> | null {
  if (!fixtureId) return null;
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const available = (ids: readonly string[]) =>
    ids.every((id) => sourceById.has(`${PREFIX}${id}`));
  const selected = (ids: readonly string[]) =>
    ids.map((id) => sourceById.get(`${PREFIX}${id}`)!);
  let sourceIds: readonly string[] = [];
  let proposed: ReturnType<typeof proposal> | null = null;
  if (fixtureId === "conversation-01" && available(["canopy-b-dimensions"])) {
    sourceIds = [`${PREFIX}canopy-b-dimensions`];
    proposed = proposal([
      fact(
        "Canopy B has verified overall dimensions of 12 feet by 18 feet, producing a calculated rectangular plan footprint of 216 square feet.",
        sourceIds,
      ),
    ], [
      "The 216-square-foot value is a calculation from the verified overall plan dimensions, not a printed area value.",
    ]);
  } else if (
    fixtureId === "conversation-01" && available(["canopy-a-dimensions"])
  ) {
    sourceIds = [`${PREFIX}canopy-a-dimensions`];
    proposed = proposal([
      fact(
        "Canopy A has verified overall dimensions of 20 feet by 30 feet, producing a calculated rectangular plan footprint of 600 square feet.",
        sourceIds,
      ),
    ], [
      "The 600-square-foot value is a calculation from the verified overall plan dimensions, not a printed area value.",
    ]);
  } else if (
    fixtureId === "conversation-02" && available([
      "landscape-plan-tree-count",
      "tree-installation-update",
    ])
  ) {
    sourceIds = [
      `${PREFIX}landscape-plan-tree-count`,
      `${PREFIX}tree-installation-update`,
    ];
    proposed = proposal([
      fact("The current landscape plan requires 78 new trees.", [sourceIds[0]]),
      fact(
        "The latest field update documents 42 of those trees installed as of 2026-09-10.",
        [sourceIds[1]],
      ),
      inference(
        "The available evidence does not verify that all 78 trees are installed; 36 planned trees remain undocumented as installed.",
        sourceIds,
      ),
    ], ["No inspection acceptance for the installed trees was provided."]);
  } else if (
    fixtureId === "conversation-02" && available(["landscape-plan-tree-count"])
  ) {
    sourceIds = [`${PREFIX}landscape-plan-tree-count`];
    proposed = proposal([
      fact("The current landscape plan requires 78 new trees.", sourceIds),
    ], ["The plan does not document field installation."]);
  } else if (
    fixtureId === "conversation-03" && available(["2321-canopy-slab"])
  ) {
    sourceIds = [`${PREFIX}2321-canopy-slab`];
    proposed = proposal([
      fact(
        "For the selected 2321 project, the current structural drawing requires an 8-inch reinforced concrete slab under the hazardous-material canopy.",
        sourceIds,
      ),
    ], []);
  } else if (
    fixtureId === "conversation-03" &&
    available(["2375-north-lot-concrete"])
  ) {
    sourceIds = [`${PREFIX}2375-north-lot-concrete`];
    proposed = proposal([
      fact(
        "For the selected 2375 project, the current civil drawing requires 6-inch-thick Portland cement concrete at the North Lot.",
        sourceIds,
      ),
    ], []);
  } else if (
    fixtureId === "conversation-04" && available([
      "electrical-rough-in-prior",
      "electrical-rough-in-current",
    ])
  ) {
    sourceIds = [
      `${PREFIX}electrical-rough-in-prior`,
      `${PREFIX}electrical-rough-in-current`,
    ];
    proposed = proposal([
      fact(
        "The prior schedule dated 2026-09-01 showed Electrical rough-in Not Started at 0% with a 2026-09-15 planned finish.",
        [sourceIds[0]],
      ),
      fact(
        "The newly uploaded current schedule shows Electrical rough-in In Progress at 60% with a 2026-09-18 planned finish.",
        [sourceIds[1]],
      ),
      inference(
        "The new schedule reports progress from 0% to 60% and moves the planned finish three days later, from September 15 to September 18, 2026.",
        sourceIds,
      ),
    ], []);
  } else if (
    fixtureId === "conversation-04" &&
    available(["electrical-rough-in-prior"])
  ) {
    sourceIds = [`${PREFIX}electrical-rough-in-prior`];
    proposed = proposal([
      fact(
        "The prior schedule dated 2026-09-01 showed Electrical rough-in Not Started at 0% with a 2026-09-15 planned finish.",
        sourceIds,
      ),
    ], []);
  } else if (
    fixtureId === "conversation-05" && available(["malicious-document-text"])
  ) {
    sourceIds = [`${PREFIX}malicious-document-text`];
    proposed = proposal([
      fact(
        "The uploaded note contains text attempting to override application rules and request records from project 2321.",
        sourceIds,
      ),
      inference(
        "That embedded text is untrusted document content and provides no authority to access or reveal another project's records.",
        sourceIds,
      ),
    ], [
      "Ask ECOS will not search, disclose, or cite another project's records from this request.",
    ]);
  } else if (
    fixtureId === "conversation-05" &&
    available(["north-lot-governing-drawing"])
  ) {
    sourceIds = [`${PREFIX}north-lot-governing-drawing`];
    proposed = proposal([
      fact(
        "Current civil Sheet C-5.1 governs the 2375 North Lot concrete work.",
        sourceIds,
      ),
    ], []);
  }
  return proposed
    ? Object.freeze({
      fixtureId,
      proposed,
      selectedSources: Object.freeze(
        selected(sourceIds.map((id) => id.slice(PREFIX.length))),
      ),
    })
    : null;
}

function proposal(
  facts: readonly ConversationFact[],
  limitations: readonly string[],
) {
  return Object.freeze({
    shortAnswer: facts.map((item) => item.statement).join(" "),
    facts: Object.freeze([...facts]),
    limitations: Object.freeze([...limitations]),
    conflicts: Object.freeze([]),
    suggestedQuestions: Object.freeze([]),
  });
}

function fact(
  statement: string,
  sourceIds: readonly string[],
): ConversationFact {
  return Object.freeze({ statement, classification: "fact", sourceIds });
}

function inference(
  statement: string,
  sourceIds: readonly string[],
): ConversationFact {
  return Object.freeze({ statement, classification: "inference", sourceIds });
}

function sourceContainsInjectionRequest(value: string) {
  const normalized = normalize(value);
  return /\b(?:ignore|disregard|override|bypass)\b[\s\S]{0,100}\b(?:rules?|instructions?|policy|policies|guardrails?)\b/.test(
    normalized,
  ) &&
    /\b(?:reveal|disclose|expose|show)\b[\s\S]{0,100}\b(?:records?|data|documents?|files?)\b/.test(
      normalized,
    );
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
