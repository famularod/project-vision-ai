import {
  canonicalizeECOSQuestionLanguage,
  ecosQuestionRetrievalVariants,
} from "./ecos-question-language.ts";

export type ECOSProjectAnswerRequirement = Readonly<{
  kind: "general" | "measurement" | "quantity" | "presence";
  attribute: string | null;
  attributeTerms: readonly string[];
}>;

export type ECOSQuestionEvidenceContext = Readonly<{
  subjectTokens: readonly string[];
  locationDirectionTokens: readonly string[];
  locationKindTokens: readonly string[];
  matchedSubjectTokens: readonly string[];
  matchedLocationDirectionTokens: readonly string[];
  matchedLocationKindTokens: readonly string[];
  subjectMatched: boolean;
  locationMatched: boolean;
  measurementMatched: boolean;
  attributeMatched: boolean;
}>;

const MEASUREMENT_ATTRIBUTES = Object.freeze(
  [
    Object.freeze({
      attribute: "area",
      questionPattern:
        /\b(?:how\s+many\s+(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf)|(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf)\s+of|square\s+footage|floor\s+area|plan\s+area|plan\s+footprint|calculated\s+(?:area|footprint)|area\s+of|what\s+is\s+the\s+area|how\s+much\s+area|how\s+(?:big|large)\b[\s\S]{0,100}\b(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|overall\s+plan\s+dimensions?))\b/i,
      terms: Object.freeze([
        "area",
        "square feet",
        "square foot",
        "sq ft",
        "sf",
        "footprint",
      ]),
    }),
    Object.freeze({
      attribute: "grade",
      questionPattern:
        /\b(?:maximum|permitted|max(?:imum)?)\s+(?:permitted\s+)?(?:grade|slope)|\b(?:grade|slope)\s+(?:limit|maximum|max|permitted)\b/i,
      terms: Object.freeze(["grade", "slope"]),
    }),
    Object.freeze({
      attribute: "light_level",
      questionPattern:
        /\b(?:photometric(?:s)?|foot[- ]?candles?|light\s+levels?|lighting\s+(?:levels?|high|low|average|maximum|minimum)|average\s+(?:max(?:imum)?|minimum)|(?:avg|average|max(?:imum)?|minimum)\s+[^?.]{0,80}\bfc\b)\b/i,
      terms: Object.freeze([
        "photometric",
        "photometrics",
        "light level",
        "light levels",
        "foot candle",
        "foot candles",
        "fc",
      ]),
    }),
    Object.freeze({
      attribute: "thickness",
      questionPattern:
        /\b(?:how\s+thick|thickness|thick|slab\s+depth)\b|\b(?:about\s+)?how\s+many\s+(?:inches?|inch|in\.?|feet|foot|ft\.?)\b[\s\S]{0,120}\b(?:concrete|pcc|slab|paving|walkway|asphalt|base)\b/i,
      terms: Object.freeze(["thickness", "thick", "depth", "slab thickness"]),
    }),
    Object.freeze({
      attribute: "width",
      questionPattern: /\b(?:how\s+wide|width|wide)\b/i,
      terms: Object.freeze(["width", "wide"]),
    }),
    Object.freeze({
      attribute: "height",
      questionPattern: /\b(?:how\s+high|height|high)\b/i,
      terms: Object.freeze(["height", "high"]),
    }),
    Object.freeze({
      attribute: "depth",
      questionPattern: /\b(?:how\s+deep|depth|deep)\b/i,
      terms: Object.freeze(["depth", "deep", "thickness", "thick"]),
    }),
    Object.freeze({
      attribute: "length",
      questionPattern: /\b(?:how\s+long|length|long)\b/i,
      terms: Object.freeze(["length", "long"]),
    }),
    Object.freeze({
      attribute: "diameter",
      questionPattern: /\b(?:diameter|diam\.?|\bdia\.?)\b/i,
      terms: Object.freeze(["diameter", "diam", "dia"]),
    }),
    Object.freeze({
      attribute: "spacing",
      questionPattern: /\b(?:spacing|spaced|on\s+center|o\.?c\.?)\b/i,
      terms: Object.freeze(["spacing", "spaced", "on center", "oc"]),
    }),
  ] as const,
);

const QUANTITY_PATTERN = /\b(?:how\s+many|quantity|count|number\s+of)\b/i;
const PRESENCE_QUESTION_PATTERN =
  /^(?:do|does|did|is|are|was|were|has|have|can|could|will|would)\b[\s\S]*\b(?:have|has|contain|contains|include|includes|show|shows|provide|provides|provided|installed|present|required|exist|exists)\b/i;
const ATTRIBUTE_PRESENCE_QUESTION_PATTERN =
  /^(?:is|are|was|were)\b[\s\S]*\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires|tree|trees|plant|plants|guardrail|guardrails|rail|railing|barrier)\b/i;
const MEASUREMENT_VALUE_PATTERN =
  /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?|fc)(?=$|\s|[-),.;:])/i;
const FEET_AND_INCHES_PATTERN =
  /\b\d+\s*'\s*(?:-\s*)?\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*"/i;
const NUMERIC_QUANTITY_PATTERN = /\b\d+(?:,\d{3})*(?:\.\d+)?\b/;
const QUESTION_CONTEXT_VARIANTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    concrete: Object.freeze(["pcc", "slab", "cement", "paving", "walkway"]),
    cement: Object.freeze(["concrete", "pcc", "slab", "paving", "walkway"]),
    pcc: Object.freeze(["concrete", "cement", "paving", "pavement"]),
    side: Object.freeze(["lot", "area"]),
    lot: Object.freeze(["side", "area"]),
    paving: Object.freeze(["pavement", "pcc", "concrete"]),
    slab: Object.freeze(["concrete", "pcc", "pad", "foundation", "paving"]),
    poured: Object.freeze([
      "installed",
      "placed",
      "constructed",
      "paving",
      "pavement",
    ]),
    back: Object.freeze(["rear", "behind", "north"]),
    rear: Object.freeze(["back", "behind", "north"]),
    behind: Object.freeze(["back", "rear", "north"]),
    canopy: Object.freeze([
      "canopies",
      "exterior storage",
      "exterior storage area",
      "exterior storage areas",
      "shade structure",
      "slab",
      "concrete pad",
      "foundation",
    ]),
    pad: Object.freeze(["slab", "foundation", "concrete"]),
    lighting: Object.freeze([
      "light",
      "lights",
      "fixture",
      "fixtures",
      "luminaire",
      "luminaires",
      "lighting plan",
    ]),
    tree: Object.freeze(["trees", "plant", "plants", "planted", "planting"]),
    guardrail: Object.freeze(["guardrails", "rail", "railing", "barrier"]),
    maximum: Object.freeze(["max"]),
    permitted: Object.freeze(["shall", "maximum", "max"]),
    "ada-accessible": Object.freeze(["ada accessible", "ada", "accessible"]),
  });
const LOCATION_DIRECTION_TOKENS = new Set([
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "upper",
  "lower",
  "front",
  "rear",
  "back",
  "behind",
]);
const LOCATION_KIND_TOKENS = new Set([
  "side",
  "lot",
  "area",
  "zone",
  "room",
  "floor",
  "level",
  "roof",
  "wall",
  "yard",
  "building",
]);

export function analyzeECOSProjectQuestion(
  question: string,
): ECOSProjectAnswerRequirement {
  const normalizedQuestion = normalizePolicyQuestion(question);
  const match = MEASUREMENT_ATTRIBUTES.find((candidate) =>
    candidate.questionPattern.test(normalizedQuestion)
  );
  if (!match) {
    if (QUANTITY_PATTERN.test(normalizedQuestion)) {
      return Object.freeze({
        kind: "quantity",
        attribute: "quantity",
        attributeTerms: Object.freeze(["quantity", "count", "number"]),
      });
    }
    if (
      PRESENCE_QUESTION_PATTERN.test(normalizedQuestion) ||
      ATTRIBUTE_PRESENCE_QUESTION_PATTERN.test(normalizedQuestion)
    ) {
      const attribute = presenceAttribute(normalizedQuestion);
      return Object.freeze({
        kind: "presence",
        attribute,
        attributeTerms: Object.freeze(
          attribute ? presenceAttributeTerms(attribute) : [],
        ),
      });
    }
    return Object.freeze({
      kind: "general",
      attribute: null,
      attributeTerms: Object.freeze([]),
    });
  }
  return Object.freeze({
    kind: "measurement",
    attribute: match.attribute,
    attributeTerms: match.terms,
  });
}

export function ecosEvidenceMatchesQuestionRequirement(
  question: string,
  evidenceText: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === "general") return true;
  const normalizedEvidence = normalizePolicyText(evidenceText);
  if (requirement.kind === "presence") {
    const context = analyzeECOSQuestionEvidenceContext(
      question,
      normalizedEvidence,
    );
    return context.subjectMatched && context.locationMatched &&
      context.attributeMatched &&
      containsECOSExplicitPresenceEvidence(
        normalizedEvidence,
        requirement.attributeTerms,
      );
  }
  if (requirement.kind === "quantity") {
    return containsECOSQuantityValue(normalizedEvidence, question);
  }
  return containsECOSRequestedMeasurementValue(question, normalizedEvidence) ||
    requirement.attributeTerms.some((term) =>
      normalizedEvidence.includes(term)
    );
}

export function ecosFactAnswersQuestion({
  question,
  statement,
  sourceExcerpts,
}: {
  question: string;
  statement: string;
  sourceExcerpts: readonly string[];
}) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === "general") return true;

  const normalizedStatement = normalizePolicyText(statement);
  if (requirement.kind === "presence") {
    const sourceText = normalizePolicyText(sourceExcerpts.join(" "));
    const sourceContext = analyzeECOSQuestionEvidenceContext(
      question,
      sourceText,
    );
    return sourceContext.subjectMatched && sourceContext.locationMatched &&
      sourceContext.attributeMatched &&
      containsECOSExplicitPresenceEvidence(
        sourceText,
        requirement.attributeTerms,
      ) &&
      containsECOSExplicitPresenceEvidence(
        normalizedStatement,
        requirement.attributeTerms,
      );
  }
  if (requirement.kind === "quantity") {
    if (!containsECOSQuantityValue(normalizedStatement, question)) return false;
    const sourceText = normalizePolicyText(sourceExcerpts.join(" "));
    if (!containsECOSQuantityValue(sourceText, question)) return false;
    const sourceContext = analyzeECOSQuestionEvidenceContext(
      question,
      sourceText,
    );
    return sourceContext.subjectMatched && sourceContext.locationMatched;
  }
  if (!containsECOSRequestedMeasurementValue(question, normalizedStatement)) {
    return false;
  }
  if (
    !measurementStatementMatchesRequestedSubject(question, normalizedStatement)
  ) return false;

  const sourceText = normalizePolicyText(sourceExcerpts.join(" "));
  if (!containsECOSRequestedMeasurementValue(question, sourceText)) {
    return false;
  }
  if (!requirement.attributeTerms.some((term) => sourceText.includes(term))) {
    return false;
  }

  const sourceContext = analyzeECOSQuestionEvidenceContext(
    question,
    sourceText,
  );
  return sourceContext.subjectMatched && (
    sourceContext.locationMatched ||
    evidenceMatchesExplicitSheetReference(question, sourceText)
  );
}

/**
 * Separates the requested construction subject from location words so ECOS
 * cannot approve a dimension merely because an unrelated note happens to be
 * on the same project or sheet. Project identity is already enforced before
 * evidence retrieval, so standalone project numbers are intentionally not
 * treated as answer context.
 */
export function analyzeECOSQuestionEvidenceContext(
  question: string,
  evidenceText: string,
): ECOSQuestionEvidenceContext {
  const requirement = analyzeECOSProjectQuestion(question);
  const contextTokens = questionContextTokens(question, requirement);
  const locationDirectionTokens = contextTokens.filter((token) =>
    LOCATION_DIRECTION_TOKENS.has(token)
  );
  const locationKindTokens = contextTokens.filter((token) =>
    LOCATION_KIND_TOKENS.has(token)
  );
  const subjectTokens = contextTokens.filter((token) =>
    !LOCATION_DIRECTION_TOKENS.has(token) && !LOCATION_KIND_TOKENS.has(token)
  );
  const normalizedEvidence = normalizePolicyText(evidenceText);
  const matchedSubjectTokens = subjectTokens.filter((token) =>
    contextTokenMatchesEvidence(token, normalizedEvidence)
  );
  const matchedLocationDirectionTokens = locationDirectionTokens.filter(
    (token) => contextTokenMatchesEvidence(token, normalizedEvidence),
  );
  const matchedLocationKindTokens = locationKindTokens.filter((token) =>
    contextTokenMatchesEvidence(token, normalizedEvidence)
  );
  const subjectMatched = subjectTokens.length === 0 ||
    matchedSubjectTokens.length / subjectTokens.length >= 0.5;
  const locationMatched = (
    locationDirectionTokens.length === 0 ||
    matchedLocationDirectionTokens.length > 0
  ) && (
    locationKindTokens.length === 0 ||
    matchedLocationKindTokens.length > 0
  );
  return Object.freeze({
    subjectTokens: Object.freeze(subjectTokens),
    locationDirectionTokens: Object.freeze(locationDirectionTokens),
    locationKindTokens: Object.freeze(locationKindTokens),
    matchedSubjectTokens: Object.freeze(matchedSubjectTokens),
    matchedLocationDirectionTokens: Object.freeze(
      matchedLocationDirectionTokens,
    ),
    matchedLocationKindTokens: Object.freeze(matchedLocationKindTokens),
    subjectMatched,
    locationMatched,
    measurementMatched: containsECOSRequestedMeasurementValue(
      question,
      normalizedEvidence,
    ),
    attributeMatched: requirement.kind === "general" ||
      requirement.attributeTerms.some((term) =>
        normalizedEvidence.includes(term)
      ),
  });
}

/**
 * Ranks whole-page evidence above isolated construction notes when the page
 * also contains the user's requested location and subject. ECOS Core still
 * proposes the answer and ECOS Assurance still requires the exact numeric
 * value and citation; this only chooses the most responsive page context.
 */
export function ecosEvidenceQuestionContextScore(
  question: string,
  evidenceText: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const normalizedEvidence = normalizePolicyText(evidenceText);
  if (!normalizedEvidence) return 0;
  const context = analyzeECOSQuestionEvidenceContext(
    question,
    normalizedEvidence,
  );
  const subjectCoverage = context.subjectTokens.length > 0
    ? context.matchedSubjectTokens.length / context.subjectTokens.length
    : 0;
  const locationParts = context.locationDirectionTokens.length +
    context.locationKindTokens.length;
  const matchedLocationParts = context.matchedLocationDirectionTokens.length +
    context.matchedLocationKindTokens.length;
  const locationCoverage = locationParts > 0
    ? matchedLocationParts / locationParts
    : 0;
  const measurementBonus =
    requirement.kind === "measurement" && context.measurementMatched ? 1 : 0;
  const attributeBonus =
    requirement.kind !== "general" && context.attributeMatched ? 0.5 : 0;
  const presenceBonus = requirement.kind === "presence" &&
      containsECOSExplicitPresenceEvidence(
        normalizedEvidence,
        requirement.attributeTerms,
      )
    ? 1.5
    : 0;
  const responsiveBonus = context.subjectMatched && context.locationMatched
    ? 1
    : 0;
  return subjectCoverage + locationCoverage + measurementBonus +
    attributeBonus + presenceBonus + responsiveBonus;
}

export function containsECOSMeasurementValue(value: string) {
  const normalized = normalizePolicyText(value)
    .replace(/\u2033/g, '"')
    .replace(/\u2032/g, "'")
    .replace(
      /(\d(?:\.\d+)?)-(inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)\b/g,
      "$1 $2",
    );
  return MEASUREMENT_VALUE_PATTERN.test(normalized) ||
    FEET_AND_INCHES_PATTERN.test(normalized);
}

export function containsECOSRequestedMeasurementValue(
  question: string,
  value: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== "measurement") {
    return containsECOSMeasurementValue(value);
  }
  if (requirement.attribute === "grade") {
    return /\b\d+(?:\.\d+)?\s*%/.test(normalizePolicyText(value));
  }
  return containsECOSMeasurementValue(value);
}

export function containsECOSQuantityValue(value: string, question = "") {
  const questionNumbers = new Set(
    normalizePolicyText(question).match(/\b\d+(?:\.\d+)?\b/g) || [],
  );
  return (normalizePolicyText(value).match(/\b\d+(?:\.\d+)?\b/g) || [])
    .some((token) =>
      !questionNumbers.has(token) && NUMERIC_QUANTITY_PATTERN.test(token)
    );
}

/**
 * Evidence ids are internal join keys, not user-facing citations. The model
 * receives them so Assurance can validate sourceIds, but they must never leak
 * into the field answer itself.
 */
export function sanitizeECOSAnswerStatement(value: string) {
  return value
    .replace(/\[(?:project|schedule|update|memory|document):[^\]]+\]/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function ecosQuestionRequestsInstalledCondition(question: string) {
  return /\b(?:installed|placed|poured|built|constructed|plant|plants|planted|in\s+the\s+ground|as-built|existing\s+condition|field\s+verified|measured|measurement|field\s+(?:reading|test|result)|air[- ]?balance)\b/i
    .test(normalizePolicyQuestion(question));
}

export function ecosNeedsDrawingOnlyInstalledConditionLimitation(
  question: string,
  facts: readonly Readonly<{
    statement: string;
    sourceTypes: readonly string[];
  }>[],
) {
  if (!ecosQuestionRequestsInstalledCondition(question)) return false;
  const hasDrawingFact = facts.some((fact) =>
    fact.sourceTypes.includes("document")
  );
  if (!hasDrawingFact) return false;
  const hasFieldConditionFact = facts.some((fact) =>
    fact.sourceTypes.some((sourceType) =>
      sourceType === "update" || sourceType === "memory"
    ) &&
    /\b(?:actual|installed|placed|poured|built|constructed|field|as-built|measured)\b/i
      .test(fact.statement) &&
    !/\b(?:not|cannot|does not|unverified|unknown)\b/i.test(fact.statement)
  );
  return !hasFieldConditionFact;
}

export function buildECOSInstalledDesignFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  if (!ecosQuestionRequestsInstalledCondition(question)) return null;
  return buildECOSDrawingMeasurementFallback(question, sources, {
    includeRelatedSpecifications: true,
  });
}

export function buildECOSDrawingMeasurementFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
  options: Readonly<{ includeRelatedSpecifications?: boolean }> = {},
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== "measurement" || requirement.attribute === "area") {
    return null;
  }
  const installedConditionRequested = ecosQuestionRequestsInstalledCondition(
    question,
  );
  const questionVariants = uniquePolicyValues([
    question,
    ...ecosQuestionRetrievalVariants(question),
  ]);
  const responsiveSources = sources.filter((source) =>
    source.sourceType === "document" &&
    questionVariants.some((variant) =>
      ecosEvidenceMatchesQuestionRequirement(
        variant,
        `${source.title || ""} ${source.excerpt}`,
      )
    )
  );
  const facts = responsiveSources.flatMap((source) =>
    extractECOSVisualMeasurementFacts(source.excerpt, question)
      .filter((fact) =>
        questionVariants.some((variant) =>
          measurementFactMatchesRequestedSubject(
            variant,
            `${source.title || ""} ${source.excerpt}`,
            fact,
          )
        )
      )
      .filter((fact) =>
        questionVariants.some((variant) =>
          ecosFactAnswersQuestion({
            question: variant,
            statement: `The current drawing specifies ${
              designFactPhrase(fact)
            }.`,
            sourceExcerpts: [
              `${source.title || ""} ${source.excerpt} ${fact}`,
            ],
          })
        )
      )
      .map((fact) => {
        const phrase = designFactPhrase(fact);
        return {
          sourceId: source.id,
          phrase,
          score: measurementFactPreferenceScore(
            question,
            phrase,
            `${source.title || ""} ${source.excerpt}`,
          ),
        };
      })
  );
  const uniqueFacts: Array<{
    sourceId: string;
    phrase: string;
    score: number;
  }> = [];
  const seen = new Set<string>();
  for (
    const fact of [...facts].sort((left, right) => right.score - left.score)
  ) {
    const key = installedDesignFactKey(fact.phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueFacts.push(fact);
    if (uniqueFacts.length >= 3) break;
  }
  if (uniqueFacts.length === 0) return null;
  const comparisonRequested = /\b(?:same|different|compare|comparison)\b/i.test(
    question,
  );
  const answerFacts =
    comparisonRequested || options.includeRelatedSpecifications
      ? uniqueFacts
      : uniqueFacts.slice(0, 1);
  const comparison = comparisonRequested &&
      pccThicknessesDiffer(answerFacts.map((fact) => fact.phrase))
    ? " These are different specifications, not the same thickness."
    : "";
  return {
    statement: sanitizeECOSAnswerStatement(
      `The current drawing specifies ${
        joinDesignFacts(answerFacts.map((fact) => fact.phrase))
      }.` +
        comparison +
        (installedConditionRequested
          ? " The drawing does not field-verify the actual installed condition."
          : ""),
    ),
    sourceIds: [...new Set(answerFacts.map((fact) => fact.sourceId))],
  };
}

export function buildECOSDrawingAreaFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== "measurement" || requirement.attribute !== "area") {
    return null;
  }
  for (const source of sources) {
    if (source.sourceType !== "document") continue;
    const match = source.excerpt.match(
      /ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:\s*([^\n×]{1,80})\s*×\s*([^\n=]{1,80})\s*=\s*([\d,]+(?:\.\d+)?)\s+square feet/i,
    );
    if (!match) continue;
    const subject =
      question.match(/\b(canop(?:y|ies)\s+['"]?[a-z0-9]+['"]?)/i)?.[1]
        ?.replace(/\s+/g, " ").trim() || "The requested plan";
    return {
      statement: sanitizeECOSAnswerStatement(
        `Using the ${match[1].trim()} by ${
          match[2].trim()
        } overall dimensions on the current drawing, ` +
          `${subject} has a calculated plan footprint of ${
            match[3]
          } square feet; ` +
          "this is a calculation, not a printed area value.",
      ),
      sourceIds: [source.id],
    };
  }
  return null;
}

export function buildECOSDrawingPresenceFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== "presence" || !requirement.attribute) return null;
  const source = sources
    .filter((candidate) =>
      candidate.sourceType === "document" &&
      ecosEvidenceMatchesQuestionRequirement(
        question,
        `${candidate.title || ""} ${candidate.excerpt}`,
      )
    )
    .map((candidate) => ({
      candidate,
      score: ecosEvidenceQuestionContextScore(
            question,
            `${candidate.title || ""} ${candidate.excerpt}`,
          ) * 10 +
        (requirement.attribute === "lighting" &&
            /\belectrical\b/i.test(candidate.title || "")
          ? 20
          : 0) +
        (requirement.attribute === "lighting" &&
            /\bexterior\s+storage\b/i.test(candidate.excerpt) &&
            /\b(?:light|lighting|fixture|luminaire)s?\b/i.test(
              candidate.excerpt,
            )
          ? 20
          : 0),
    }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;
  if (!source) return null;
  const installedConditionRequested = ecosQuestionRequestsInstalledCondition(
    question,
  );
  return {
    statement: sanitizeECOSAnswerStatement(
      `The current drawing shows ${requirement.attribute} for the requested area.` +
        (installedConditionRequested
          ? " The drawing does not verify or confirm the actual installed field condition."
          : ""),
    ),
    sourceIds: [source.id],
  };
}

export function buildECOSCrossDisciplineLightingFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const normalizedQuestion = normalizePolicyQuestion(question);
  const asksForLightingSources =
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires|photometric|photometrics)\b/
      .test(
        normalizedQuestion,
      ) &&
    /\b(?:civil|electrical|plans?|drawings?|where|which|control|confirm|elsewhere)\b/
      .test(
        normalizedQuestion,
      );
  if (!asksForLightingSources) return null;
  const civil = sources.find((source) =>
    source.sourceType === "document" &&
    /\bcivil\b/i.test(source.title || "") &&
    /\barea\s+lighting\b[\s\S]{0,180}\barchitectural\s+and\s+electrical\s+drawings\b/i
      .test(source.excerpt)
  );
  const electrical = sources
    .filter((source) =>
      source.sourceType === "document" &&
      /\belectrical\b/i.test(source.title || "") &&
      /\b(?:light|lighting|fixture|luminaire|photometric)s?\b/i.test(
        source.excerpt,
      )
    )
    .map((source) => ({
      source,
      score: ecosEvidenceQuestionContextScore(
            question,
            `${source.title || ""} ${source.excerpt}`,
          ) * 10 +
        (/\bexterior\s+storage\b/i.test(source.excerpt) ? 20 : 0) +
        (/\boutdoor\s+lighting\s+controls?\b/i.test(source.excerpt) ? 40 : 0) +
        (/\barea\s+lighting\s+plan\b/i.test(source.excerpt) ? 30 : 0) +
        (/\b(?:lighting\s+plan|light(?:ing)?\s+fixtures?|site\s+photometric)\b/i
            .test(source.excerpt)
          ? 10
          : 0),
    }))
    .sort((left, right) => right.score - left.score)[0]?.source;
  if (!civil || !electrical) return null;
  return {
    statement: sanitizeECOSAnswerStatement(
      "The current civil drawing directs area lighting to the architectural and electrical drawings, and the cited current electrical drawing shows lighting. The field team should use the civil and electrical sources together.",
    ),
    sourceIds: [civil.id, electrical.id],
  };
}

export function buildECOSCanopyLightingFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const normalizedQuestion = normalizePolicyQuestion(question);
  if (
    !/\bcanop(?:y|ies)\b/.test(normalizedQuestion) ||
    !/\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/.test(
      normalizedQuestion,
    )
  ) return null;
  const architectural = sources.find((source) =>
    source.sourceType === "document" &&
    /\barchitectural\b/i.test(source.title || "") &&
    /\bcanop(?:y|ies)\b/i.test(source.excerpt) &&
    /\bnew\s+light\s+fixture\b/i.test(source.excerpt) &&
    /\bsee\s+electrical\b/i.test(source.excerpt)
  );
  const electrical = sources.find((source) =>
    source.sourceType === "document" &&
    /\belectrical\b/i.test(source.title || "") &&
    /\bexterior\s+storage\b/i.test(source.excerpt) &&
    /\blighting\s+plans?\b/i.test(source.excerpt)
  );
  if (!architectural || !electrical) return null;
  return {
    statement: sanitizeECOSAnswerStatement(
      "The current architectural canopy drawing shows a new light fixture and directs the field to the electrical drawings; the cited electrical sheet is the exterior-storage lighting plan. The field team should use both sources together.",
    ),
    sourceIds: [architectural.id, electrical.id],
  };
}

export function projectECOSDeterministicEvidenceText(value: string) {
  const normalizedFacts: string[] = [];
  const boundedPhotometricTuplePattern =
    /\bALL\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+lighting\s+photometric\s+statistics\b[\s\S]{0,160}\bcoordinate-bound\s+table\b/gi;
  for (const match of value.matchAll(boundedPhotometricTuplePattern)) {
    normalizedFacts.push(
      `ALL site photometric light levels: average ${match[1]} fc; maximum ${
        match[2]
      } fc; minimum ${match[3]} fc`,
    );
  }
  return uniquePolicyValues([value, ...normalizedFacts]).join("\n");
}

export function buildECOSDrawingQuantityFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const installedConditionRequested = ecosQuestionRequestsInstalledCondition(
    question,
  );
  if (requirement.kind !== "quantity" && !installedConditionRequested) {
    return null;
  }
  const candidates: Array<{
    sourceId: string;
    subject: string;
    count: string;
    qualifier: string;
    score: number;
  }> = [];
  const questionCounts = new Set(
    normalizePolicyText(question).match(/\b\d+(?:\.\d+)?\b/g) || [],
  );
  for (const source of sources) {
    if (source.sourceType !== "document") continue;
    const evidenceText = `${source.title || ""} ${source.excerpt}`;
    const context = analyzeECOSQuestionEvidenceContext(question, evidenceText);
    if (!context.subjectMatched || !context.locationMatched) continue;
    const subject =
      requirement.attribute && requirement.attribute !== "quantity"
        ? requirement.attribute
        : context.subjectTokens.find((token) => token.length >= 3);
    if (!subject) continue;
    const subjectTerms = [
      subject,
      ...(QUESTION_CONTEXT_VARIANTS[subject] || []),
    ]
      .map((term) => escapeRegExp(normalizePolicyText(term)))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .join("|");
    if (!subjectTerms) continue;
    const normalizedEvidence = normalizePolicyText(evidenceText);
    const patterns = [
      new RegExp(
        `\\b(?:${subjectTerms})\\b[\\s\\S]{0,32}\\b(provided|required|planned|scheduled|shown|total|quantity|count)\\b[\\s:=-]{0,8}(\\d+(?:\\.\\d+)?)\\b`,
        "i",
      ),
      new RegExp(
        `\\b(provided|required|planned|scheduled|shown|total|quantity|count)\\b[\\s:=-]{0,8}(\\d+(?:\\.\\d+)?)\\b[\\s\\S]{0,24}\\b(?:${subjectTerms})\\b`,
        "i",
      ),
      new RegExp(
        `\\b(\\d+(?:\\.\\d+)?)\\s+(provided|required|planned|scheduled|shown|total)\\s+(?:${subjectTerms})\\b`,
        "i",
      ),
    ];
    for (const [index, pattern] of patterns.entries()) {
      const match = normalizedEvidence.match(pattern);
      if (!match) continue;
      const qualifier = index === 2 ? match[2] : match[1];
      const count = index === 2 ? match[1] : match[2];
      const qualifierScore = qualifier === "provided"
        ? 5
        : qualifier === "total"
        ? 4
        : qualifier === "planned" || qualifier === "shown"
        ? 3
        : 2;
      candidates.push({
        sourceId: source.id,
        subject,
        count,
        qualifier,
        score: qualifierScore + (questionCounts.has(count) ? 10 : 0),
      });
      break;
    }
  }
  const selected =
    candidates.sort((left, right) => right.score - left.score)[0];
  if (!selected) return null;
  const label = selected.subject === "tree"
    ? `trees ${selected.qualifier} by the plan`
    : `${selected.qualifier} ${selected.subject}`;
  return {
    statement: sanitizeECOSAnswerStatement(
      `The current drawing shows ${selected.count} ${label}.` +
        (installedConditionRequested
          ? ` The drawing does not verify or confirm that ${selected.count} ${
            selected.subject === "tree" ? "trees" : selected.subject
          } are installed in the field.`
          : ""),
    ),
    sourceIds: [selected.sourceId],
  };
}

function evidenceMatchesExplicitSheetReference(
  question: string,
  evidenceText: string,
) {
  const sheetReferences =
    normalizePolicyText(question).match(/\b[a-z]{1,3}[-.]?\d+(?:\.\d+)?\b/g) ||
    [];
  const normalizedEvidence = normalizePolicyText(evidenceText);
  return sheetReferences.some((reference) => {
    const compactReference = reference.replace(/[-.]/g, "");
    const compactEvidence = normalizedEvidence.replace(/[-.]/g, "");
    return compactEvidence.includes(`sheet ${compactReference}`) ||
      new RegExp(`\\b${escapeRegExp(compactReference)}\\b`).test(
        compactEvidence,
      );
  });
}

function measurementFactMatchesRequestedSubject(
  question: string,
  sourceTitle: string,
  fact: string,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const normalizedFact = normalizePolicyText(fact);
  const requestedConstructionSubjects = [
    "paving",
    "walkway",
    "curb",
    "gutter",
    "slab",
    "wall",
    "footing",
    "foundation",
    "canopy",
  ].filter((subject) => normalizedQuestion.includes(subject));
  if (
    requestedConstructionSubjects.length > 0 &&
    !requestedConstructionSubjects.some((subject) =>
      measurementSubjectMatchesFact(subject, normalizedQuestion, normalizedFact)
    )
  ) {
    return false;
  }
  const evidenceText = `${sourceTitle} ${fact}`;
  const context = analyzeECOSQuestionEvidenceContext(question, evidenceText);
  return context.subjectMatched && (
    context.locationMatched ||
    evidenceMatchesExplicitSheetReference(question, evidenceText)
  );
}

function measurementSubjectMatchesFact(
  requestedSubject: string,
  normalizedQuestion: string,
  normalizedFact: string,
) {
  if (normalizedFact.includes(requestedSubject)) return true;
  if (
    requestedSubject === "slab" &&
    /\b(?:concrete|pcc)\s+paving\b/.test(normalizedFact) &&
    !/\b(?:reinforced|structural|foundation|footing|canop(?:y|ies)|hazmat|hazardous|storage\s+addition)\b/
      .test(normalizedQuestion)
  ) {
    return true;
  }
  if (requestedSubject === "paving" && /\bpavement\b/.test(normalizedFact)) {
    return true;
  }
  if (
    requestedSubject === "canopy" &&
    /\b(?:pad|slab|foundation)\b/.test(normalizedQuestion) &&
    /\b(?:slab|foundation)\b/.test(normalizedFact)
  ) {
    return true;
  }
  return false;
}

function measurementFactPreferenceScore(
  question: string,
  phrase: string,
  evidenceText: string,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const normalizedPhrase = normalizePolicyText(phrase);
  const contextScore = ecosEvidenceQuestionContextScore(question, evidenceText);
  const asksForWalkway = /\b(?:walkway|sidewalk|path)\b/.test(
    normalizedQuestion,
  );
  const asksForPaving = /\b(?:paving|pavement)\b/.test(normalizedQuestion);
  const asksForConcrete = /\b(?:cement|concrete|pcc|slab)\b/.test(
    normalizedQuestion,
  );
  const requestedSubjectBonus = asksForWalkway && /\bwalkway\b/.test(
      normalizedPhrase,
    )
    ? 40
    : asksForPaving && /\b(?:paving|pavement)\b/.test(normalizedPhrase)
    ? 40
    : asksForConcrete && !asksForWalkway &&
        /\bpcc\s+(?:paving|pavement)\b/.test(normalizedPhrase)
    ? 30
    : 0;
  const conflictingSubjectPenalty = !asksForWalkway &&
      /\bwalkway\b/.test(normalizedPhrase)
    ? 20
    : 0;
  return contextScore * 10 + requestedSubjectBonus - conflictingSubjectPenalty;
}

function measurementStatementMatchesRequestedSubject(
  question: string,
  normalizedStatement: string,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const requestedConstructionSubjects = [
    "paving",
    "walkway",
    "curb",
    "gutter",
    "slab",
    "wall",
    "footing",
    "foundation",
    "canopy",
  ].filter((subject) => normalizedQuestion.includes(subject));
  return requestedConstructionSubjects.length === 0 ||
    requestedConstructionSubjects.some((subject) =>
      measurementSubjectMatchesFact(
        subject,
        normalizedQuestion,
        normalizedStatement,
      )
    );
}

function installedDesignFactKey(phrase: string) {
  const normalized = normalizePolicyText(phrase);
  const measurement = normalized.match(
    /\b(\d+(?:\.\d+)?)(?:\s*[- ]\s*)?(?:\"|inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)/,
  )?.[1];
  const subject = normalized.includes("pcc paving")
    ? "pcc paving"
    : normalized.includes("pcc walkway")
    ? "pcc walkway"
    : null;
  return measurement && subject
    ? `${subject}|${Number(measurement)}`
    : normalized;
}

function extractECOSVisualMeasurementFacts(excerpt: string, question: string) {
  const facts: string[] = [];
  const photometricPattern =
    /\b(?:ALL\s+)?site\s+photometric\s+light\s+levels:\s*average\s+\d+(?:\.\d+)?\s*fc;\s*maximum\s+\d+(?:\.\d+)?\s*fc;\s*minimum\s+\d+(?:\.\d+)?\s*fc\b/gi;
  for (const match of excerpt.matchAll(photometricPattern)) {
    const fact = String(match[0] || "").replace(/\s+/g, " ").trim();
    if (fact) facts.push(fact);
  }
  const boundedPhotometricTuplePattern =
    /\bALL\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+lighting\s+photometric\s+statistics\b[\s\S]{0,160}\bcoordinate-bound\s+table\b/gi;
  for (const match of excerpt.matchAll(boundedPhotometricTuplePattern)) {
    facts.push(
      `all site photometric light levels: average ${match[1]} fc; maximum ${
        match[2]
      } fc; minimum ${match[3]} fc`,
    );
  }
  const pattern = /\bFact:\s*([\s\S]{1,320}?)(?=\.{0,2}\s*Visible evidence:)/gi;
  for (const match of excerpt.matchAll(pattern)) {
    const fact = String(match[1] || "").replace(/\s+/g, " ").trim().replace(
      /[.;:,]+$/,
      "",
    );
    if (
      fact &&
      containsECOSRequestedMeasurementValue(question, normalizePolicyText(fact))
    ) facts.push(fact);
  }
  const constructionNotePattern =
    /\b(?:CONSTRUCT\s+)?(\d+(?:\.\d+)?\s*(?:[\"”]|inches?|inch|in\.?)\s*THICK(?:\s+\d+(?:\.\d+)?\s*(?:[\"”]|inches?|inch|in\.?))?\s+PCC\s+(?:PAVING|WALKWAY))\b/gi;
  for (const match of excerpt.matchAll(constructionNotePattern)) {
    const fact = String(match[1] || "").replace(/\s+/g, " ").trim();
    if (fact) facts.push(fact);
  }
  const slabLegendPattern =
    /\b(\d+(?:\.\d+)?(?:\s*-?\s*(?:[\"”]|inches?|inch|in\.?))?-?\s*thick\s+reinforced\s+concrete[_\s]+slab)\b/gi;
  for (const match of excerpt.matchAll(slabLegendPattern)) {
    const fact = String(match[1] || "").replace(/_/g, " ").replace(/\s+/g, " ")
      .trim();
    if (fact) facts.push(fact);
  }
  return [...new Set(facts)];
}

function designFactPhrase(fact: string) {
  return fact
    .replace(
      /^the\s+(?:current\s+)?(?:drawing|plan)\s+(?:specifies|requires|shows)\s+/i,
      "",
    )
    .replace(/^construct\s+/i, "")
    .replace(/^ALL\b/, "all")
    .replace(/^(.+?)\s+is\s+specified\s+where\b/i, "$1 where")
    .replace(/^(.+?)\s+is\s+specified\b/i, "$1")
    .replace(/^[A-Z]/, (character) => character.toLowerCase())
    .trim();
}

function joinDesignFacts(facts: readonly string[]) {
  if (facts.length <= 1) return facts[0] || "";
  if (facts.length === 2) return `${facts[0]}, and separately ${facts[1]}`;
  return `${facts.slice(0, -1).join(", ")}, and separately ${
    facts[facts.length - 1]
  }`;
}

function pccThicknessesDiffer(facts: readonly string[]) {
  const values = facts.flatMap((fact) => {
    const normalized = normalizePolicyText(fact);
    const subject = normalized.includes("pcc walkway")
      ? "walkway"
      : normalized.includes("pcc paving")
      ? "paving"
      : "";
    const measurement = normalized.match(
      /\b(\d+(?:\.\d+)?)\s*(?:\"|inches?|inch|in\.?|-inch)/,
    )?.[1];
    return subject && measurement
      ? [{ subject, value: Number(measurement) }]
      : [];
  });
  return new Set(values.map((item) => item.subject)).size >= 2 &&
    new Set(values.map((item) => item.value)).size >= 2;
}

export function ecosAnswerRequirementInstruction(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === "general") return null;
  if (requirement.kind === "presence") {
    return `This question asks whether ${
      requirement.attribute || "the requested feature"
    } is present. A direct yes or no answer must cite evidence that identifies both the requested subject and an explicit shown, specified, installed, absent, or prohibited ${
      requirement.attribute || "feature"
    }. A speculative alternative, unrelated field note, document title alone, or mere keyword match is not proof.`;
  }
  if (requirement.kind === "quantity") {
    return "This question asks for a quantity. A direct factual answer must state an exact numeric count and cite evidence that contains that same count for the requested subject and location.";
  }
  if (requirement.attribute === "area") {
    return "This question asks for area. A direct answer must state square units. If the area is calculated from drawing dimensions, show the exact formula and cite the same-sheet dimensions used by the deterministic ECOS calculation.";
  }
  return `This question asks for ${requirement.attribute}. A direct factual answer must state an exact numeric measurement with its unit and cite evidence that contains that same value. A statement that merely mentions the subject, location, or missing measurement does not answer the question.`;
}

export function ecosMissingAnswerLimitation(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === "general") {
    return "The available evidence did not contain a directly supported answer to this question.";
  }
  if (requirement.kind === "presence") {
    return `The indexed evidence did not explicitly show whether ${
      requirement.attribute || "the requested feature"
    } is present for the requested subject and location.`;
  }
  if (requirement.kind === "quantity") {
    return "The indexed evidence did not contain a readable numeric quantity for the requested subject and location.";
  }
  return `The indexed evidence did not contain a readable numeric ${requirement.attribute} value with a unit for the requested subject and location.`;
}

function questionContextTokens(
  question: string,
  requirement: ECOSProjectAnswerRequirement,
) {
  const ignored = new Set([
    "a",
    "about",
    "an",
    "and",
    "approximately",
    "actually",
    "average",
    "avg",
    "are",
    "at",
    "be",
    "by",
    "for",
    "from",
    "give",
    "high",
    "how",
    "in",
    "is",
    "low",
    "max",
    "maximum",
    "min",
    "minimum",
    "as",
    "has",
    "have",
    "new",
    "of",
    "on",
    "or",
    "same",
    "the",
    "this",
    "that",
    "which",
    "who",
    "where",
    "to",
    "was",
    "were",
    "what",
    "with",
    "specify",
    "specifies",
    "specified",
    "installed",
    "placed",
    "poured",
    "built",
    "constructed",
    "do",
    "does",
    "did",
    "can",
    "could",
    "call",
    "called",
    "will",
    "would",
    "contain",
    "contains",
    "include",
    "includes",
    "show",
    "shows",
    "should",
    "provide",
    "provides",
    "provided",
    "current",
    "present",
    "required",
    "reading",
    "readings",
    "calc",
    "calculation",
    "calculations",
    "exist",
    "exists",
    "plan",
    "planned",
    "part",
    "roughly",
    "say",
    "schedule",
    "scheduled",
    "sheet",
    "drawing",
    "storage",
    "supporting",
    "supposed",
    "all",
    "really",
    "crew",
    "every",
    "there",
    "under",
    "send",
    "field",
    "team",
    "prove",
    "confirm",
    "ecos",
    "ground",
    "architectural",
    "civil",
    "electrical",
    "landscape",
    "mechanical",
    "plumbing",
    "structural",
    "many",
    "me",
    "out",
    "up",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "inch",
    "foot",
    "millimeter",
    "centimeter",
    "meter",
    "yard",
    ...(requirement.attributeTerms || []).filter((term) => !term.includes(" ")),
  ]);
  return [
    ...new Set(
      normalizePolicyQuestion(question).replace(/-/g, " ").split(" ")
        .map(canonicalContextToken)
        .filter((token) =>
          token.length >= 2 && !ignored.has(token) && !/^\d+$/.test(token)
        ),
    ),
  ];
}

function canonicalContextToken(value: string) {
  value = value.replace(/^[.'"/%]+|[.'"/%]+$/g, "");
  if (value === "does") return "do";
  if (value === "inches") return "inch";
  if (value === "feet") return "foot";
  if (value.length > 4 && value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function presenceAttribute(question: string) {
  if (
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/i.test(
      question,
    )
  ) {
    return "lighting";
  }
  if (/\b(?:guardrail|guardrails|rail|railing|barrier)\b/i.test(question)) {
    return "guardrail";
  }
  if (/\b(?:tree|trees|plant|plants|planted|planting)\b/i.test(question)) {
    return "tree";
  }
  const match = question.match(
    /\b(?:have|has|contain|contains|include|includes|show|shows|provide|provides|provided)\s+(?:any\s+)?([a-z][a-z0-9-]*)\b/i,
  );
  if (match?.[1]) return canonicalPresenceAttribute(match[1]);
  const installed = question.match(
    /\b([a-z][a-z0-9-]*)\s+(?:(?:is|are)\s+)?(?:(?:scheduled|planned)\s+to\s+be\s+)?(?:installed|present|required|exist|exists)\b/i,
  );
  return installed?.[1] ? canonicalPresenceAttribute(installed[1]) : null;
}

function canonicalPresenceAttribute(value: string) {
  const normalized = normalizePolicyText(value).replace(/ies$/, "y").replace(
    /s$/,
    "",
  );
  if (/^(?:light|lighting|fixture|luminaire)$/.test(normalized)) {
    return "lighting";
  }
  if (/^(?:guardrail|rail|railing|barrier)$/.test(normalized)) {
    return "guardrail";
  }
  return normalized || null;
}

function presenceAttributeTerms(attribute: string) {
  return [attribute, ...(QUESTION_CONTEXT_VARIANTS[attribute] || [])];
}

function containsECOSExplicitPresenceEvidence(
  normalizedValue: string,
  attributeTerms: readonly string[],
) {
  if (!normalizedValue || attributeTerms.length === 0) return false;
  if (
    /\b(?:either|possibly|possible|may|might|could)\b[\s\S]{0,100}\bor\b/.test(
      normalizedValue,
    )
  ) {
    return false;
  }
  const attributePattern = attributeTerms
    .map((term) => escapeRegExp(normalizePolicyText(term)))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .join("|");
  if (!attributePattern) return false;
  const direct = new RegExp(
    `(?:\\b(?:has|have|includes?|contains?|provides?|shows?|specifies?|requires?|installs?|installed|existing|new|with|without|no)\\b[\\s\\S]{0,80}\\b(?:${attributePattern})\\b|\\b(?:${attributePattern})\\b[\\s\\S]{0,80}\\b(?:shown|provided|specified|required|installed|existing|present|absent|prohibited|not\\s+provided|not\\s+shown)\\b|\\b(?:${attributePattern})\\s+(?:plan|plans|layout|schedule|fixture|fixtures|symbol|symbols)\\b)`,
    "i",
  );
  return direct.test(normalizedValue);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextTokenMatchesEvidence(
  token: string,
  normalizedEvidence: string,
) {
  return [token, ...(QUESTION_CONTEXT_VARIANTS[token] || [])]
    .some((variant) => normalizedEvidence.includes(variant));
}

function normalizePolicyText(value: string) {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,/g, "")
    .replace(/[^a-z0-9./%"'\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePolicyQuestion(value: string) {
  return normalizePolicyText(canonicalizeECOSQuestionLanguage(value));
}

function uniquePolicyValues(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
