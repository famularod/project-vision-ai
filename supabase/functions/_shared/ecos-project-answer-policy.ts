import {
  canonicalizeECOSQuestionLanguage,
  ecosNamedCanopyIdentities,
  ecosQuestionExplicitSheetReferences,
  ecosQuestionNamedCanopyIdentity,
  ecosQuestionRequestsDrawingLocation,
  ecosQuestionRetrievalVariants,
  ecosSheetReferenceMatches,
} from "./ecos-question-language.ts";
import {
  ecosEvidenceIdentityCompatible,
  ecosExplicitEntityIdentities,
  ecosStatementIdentitySupported,
} from "./ecos-evidence-identity.ts";

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
        /\b(?:how\s+many\s+(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf)|(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf)\s+of|square\s+footage|floor\s+area|plan\s+area|plan\s+footprint|calculated\s+(?:area|footprint)|area\s+of|footprint\s+of|(?:work|figure|calculate)\s+out\b[\s\S]{0,80}\b(?:area|footprint)|what\s+is\s+the\s+area|how\s+much\s+area|how\s+(?:big|large)\b[\s\S]{0,100}\b(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|overall\s+plan\s+dimensions?))\b/i,
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
      attribute: "airflow",
      questionPattern:
        /\b(?:airflow|air[- ]?balance|cfm|cubic\s+feet\s+per\s+minute)\b|\bhow\s+much\s+air\b[\s\S]{0,100}\b(?:move|moves|moving|exhaust|exhausts|pull|pulls|flow|flows)\b/i,
      terms: Object.freeze([
        "airflow",
        "air balance",
        "cfm",
        "cubic feet per minute",
      ]),
    }),
    Object.freeze({
      attribute: "thickness",
      questionPattern:
        /\b(?:how\s+thick|thickness|thick|slab\s+depth)\b|\b(?:about\s+)?how\s+many\s+(?:inches?|inch|in\.?|feet|foot|ft\.?)\b[\s\S]{0,120}\b(?:concrete|pcc|slab|paving|walkway|asphalt|base|pour)\b|\b(?:concrete|cement|pcc|slab|paving|walkway|asphalt|base|pour)\b[\s\S]{0,120}\bhow\s+many\s+(?:inches?|inch|in\.?|feet|foot|ft\.?)\b|\b(?:concrete|cement|pcc|slab|paving|walkway|asphalt|base|pour)\b[\s\S]{0,120}\b\d+(?:\.\d+)?\s*(?:inches?|inch|in\.?|feet|foot|ft\.?)\b/i,
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
  /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?|fc|cfm|cubic\s+feet\s+per\s+minute)(?=$|\s|[-),.;:])/i;
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
      "pour",
      "installed",
      "placed",
      "constructed",
      "paving",
      "pavement",
    ]),
    pour: Object.freeze([
      "poured",
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
  // Identity-bearing claims must be supported by the same passage that
  // supplies their values, not a label on one source plus a value on another.
  if (!ecosEvidenceIdentityCompatible(question, "", statement)) return false;
  const identityBoundExcerpts = sourceExcerpts.filter((excerpt) =>
    ecosEvidenceIdentityCompatible(question, "", excerpt, true) &&
    ecosStatementIdentitySupported(statement, excerpt)
  );
  if (
    (ecosExplicitEntityIdentities(question).length > 0 ||
      ecosExplicitEntityIdentities(statement).length > 0) &&
    identityBoundExcerpts.length === 0
  ) return false;
  sourceExcerpts = identityBoundExcerpts;
  const requestedCanopyIdentity = ecosQuestionNamedCanopyIdentity(question);
  if (requestedCanopyIdentity) {
    const sourceCanopyIdentities = ecosNamedCanopyIdentities(
      sourceExcerpts.join(" "),
    );
    if (!sourceCanopyIdentities.includes(requestedCanopyIdentity)) return false;
    const statementCanopyIdentities = ecosNamedCanopyIdentities(statement);
    if (
      statementCanopyIdentities.length > 0 &&
      !statementCanopyIdentities.includes(requestedCanopyIdentity)
    ) return false;
  }
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
  if (
    !requirement.attributeTerms.some((term) => sourceText.includes(term)) &&
    !sourceDirectlyStatesRequestedMeasurementAttribute(
      requirement,
      sourceText,
    )
  ) {
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
 * Construction drawings commonly label a slab as "8-inch reinforced
 * concrete slab" without printing the word "thick". For a thickness
 * question that bounded phrase is itself an explicit thickness statement.
 * Keep this exception narrow so a pipe diameter or another nearby dimension
 * cannot be reinterpreted as slab thickness.
 */
function sourceDirectlyStatesRequestedMeasurementAttribute(
  requirement: ECOSProjectAnswerRequirement,
  normalizedSourceText: string,
) {
  if (
    requirement.kind !== "measurement" || requirement.attribute !== "thickness"
  ) {
    return false;
  }
  return /\b\d+(?:\.\d+)?(?:\s*[- ]\s*)?(?:"|inches?|inch|in\.?)\s+(?:(?:reinforced|structural)\s+)*(?:concrete|pcc)\s+(?:slab|pad|paving|pavement|walkway)\b/
    .test(normalizedSourceText);
}

/**
 * A compound user question may contain two independently provable clauses.
 * Treat a fact as responsive when it answers the original question or one of
 * the bounded retrieval variants derived only from that question. Evidence
 * support is still checked separately and remains unchanged.
 */
export function ecosFactAnswersQuestionOrRetrievalVariant(args: {
  question: string;
  statement: string;
  sourceExcerpts: readonly string[];
}) {
  return uniquePolicyValues([
    args.question,
    ...ecosQuestionRetrievalVariants(args.question),
  ]).some((question) =>
    ecosFactAnswersQuestion({
      question,
      statement: args.statement,
      sourceExcerpts: args.sourceExcerpts,
    })
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
  const subjectMatched =
    ecosEvidenceIdentityCompatible(question, "", evidenceText, true) &&
    (subjectTokens.length === 0 ||
      matchedSubjectTokens.length / subjectTokens.length >= 0.5);
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
  return /\b(?:installed|placed|pour(?:ed|ing)?|built|constructed|plant|plants|planted|in\s+the\s+ground|as-built|existing\s+condition|field\s+verified|measured|measurement|field\s+(?:reading|test|result)|air[- ]?balance)\b/i
    .test(normalizePolicyQuestion(question));
}

export function ecosProposedLimitationIsRelevant(
  question: string,
  limitation: string,
) {
  return ecosQuestionRequestsInstalledCondition(question) ||
    !/\b(?:actual|as-built|field[- ]verified|installed|placed|poured|constructed)\b/i
      .test(limitation);
}

export function ecosVerifiedAnswerStatus(
  hasConflict: boolean,
  limitations: readonly string[],
) {
  return hasConflict || limitations.length > 0
    ? "verified_with_limits" as const
    : "verified" as const;
}

export function ecosCalculatedPlanFootprintLimitation(
  sources: readonly Readonly<{ sourceType: string; excerpt: string }>[],
) {
  return sources.some((source) =>
      source.sourceType === "document" &&
      source.excerpt.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:")
    )
    ? "The square footage is calculated from the cited drawing dimensions; it is not a separately printed area value."
    : null;
}

export function ecosIsNegativePresenceStatement(statement: string) {
  return /\b(?:no|not\s+shown|without|absent|prohibited|not\s+provided)\b/i
    .test(statement) ||
    /\b(?:does\s+not|cannot|can't|could\s+not)\s+(?:safely\s+)?(?:verify|confirm|prove|establish)\b[\s\S]{0,160}\b(?:installed|field|present|completed|accepted)\b/i
      .test(statement) ||
    /\b(?:installed|field|present|completed|accepted)\b[\s\S]{0,160}\b(?:not|unverified|unknown)\b/i
      .test(statement);
}

export function ecosDeterministicPresenceIsPositive(
  question: string,
  hasDeterministicPresence: boolean,
) {
  return hasDeterministicPresence &&
    !ecosQuestionRequestsInstalledCondition(question);
}

function drawingMeasurementSignatures(value: string) {
  return uniquePolicyValues(
    [...value.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(?:[-–—]\s*)?(inch(?:es)?|in\.?|[\"”]|feet|ft\.?|['’]|cfm|gpm|psi|square\s+feet|sq\.?\s*ft\.?|sf|fc|foot[- ]candles?)(?![a-z0-9_])/gi,
    )].map((match) => {
      const number = String(Number(match[1]));
      const rawUnit = normalizePolicyText(match[2]);
      const unit = /^(?:inch(?:es)?|in|\")$/.test(rawUnit)
        ? "inches"
        : /^(?:feet|ft|'|’)$/.test(rawUnit)
        ? "feet"
        : rawUnit.replace(/\s+/g, " ");
      return `${number}|${unit}`;
    }),
  );
}

export function ecosStatementHasDrawingMeasurement(value: string) {
  return drawingMeasurementSignatures(value).length > 0;
}

function policyNumericTokens(value: string) {
  return value.match(/\b\d+(?:\.\d+)?\b/g)?.map((token) =>
    String(Number(token))
  ) || [];
}

export function ecosFactUsesCompetingDrawingMeasurement(
  fact: Readonly<{ statement: string; sourceIds: readonly string[] }>,
  selectedSourceIds: readonly string[],
  selectedStatement = "",
) {
  if (fact.sourceIds.length === 0 || selectedSourceIds.length === 0) {
    return false;
  }
  const factMeasurements = drawingMeasurementSignatures(fact.statement);
  const selectedMeasurements = new Set(
    drawingMeasurementSignatures(selectedStatement),
  );
  if (
    selectedMeasurements.size > 0 &&
    factMeasurements.some((measurement) =>
      !selectedMeasurements.has(measurement)
    )
  ) {
    return true;
  }
  return !fact.sourceIds.some((sourceId) =>
    selectedSourceIds.includes(sourceId)
  ) &&
    factMeasurements.length > 0;
}

export function ecosFactUsesCompetingDrawingQuantity(
  question: string,
  fact: Readonly<{ statement: string }>,
  selectedStatement: string,
) {
  const normalizedStatement = normalizePolicyText(fact.statement)
    .replace(/\b(?:sheet|page)\s+[a-z]{0,3}\s*-?\s*\d+(?:\.\d+)?\b/g, " ");
  if (
    !/\b(?:tree|trees|plant|plants|planted|installed)\b/.test(
      normalizedStatement,
    )
  ) return false;
  const allowedNumbers = new Set([
    ...policyNumericTokens(question),
    ...policyNumericTokens(selectedStatement),
  ]);
  return policyNumericTokens(normalizedStatement).some((value) =>
    !allowedNumbers.has(value)
  );
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
  return buildECOSDrawingMeasurementFallback(question, sources);
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
    const fact of [...facts].sort((left, right) =>
      right.score - left.score ||
      left.phrase.localeCompare(right.phrase) ||
      left.sourceId.localeCompare(right.sourceId)
    )
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
  const requestedCanopyIdentity = ecosQuestionNamedCanopyIdentity(question);
  // This fallback produces one footprint, never a multi-entity comparison.
  const requestedEntities = ecosExplicitEntityIdentities(question);
  if (
    new Set(requestedEntities.map((entity) => entity.kind)).size <
      requestedEntities.length
  ) return null;
  for (const source of sources) {
    if (source.sourceType !== "document") continue;
    if (
      !ecosEvidenceIdentityCompatible(
        question,
        source.title || "",
        source.excerpt,
        true,
      )
    ) continue;
    if (requestedCanopyIdentity) {
      const titleCanopyIdentities = ecosNamedCanopyIdentities(
        source.title || "",
      );
      const evidenceCanopyIdentities = ecosNamedCanopyIdentities(
        source.excerpt,
      );
      const authoritativeCanopyIdentities = titleCanopyIdentities.length > 0
        ? titleCanopyIdentities
        : evidenceCanopyIdentities;
      if (!authoritativeCanopyIdentities.includes(requestedCanopyIdentity)) {
        continue;
      }
    }
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

export function buildECOSExactSheetPurposeFallback(
  question: string,
  sources: readonly Readonly<{
    id: string;
    sourceType: string;
    title?: string;
    excerpt: string;
    score?: number;
    documentCitation?: Readonly<{ sheetNumber?: string | null }>;
    documentRegion?: Readonly<{ id: string }>;
  }>[],
) {
  const sheetReferences = ecosQuestionExplicitSheetReferences(question);
  if (
    sheetReferences.length === 0 ||
    !/\b(?:what|which)\b[\s\S]{0,120}\b(?:show|shows|contain|contains|purpose|plan|drawing|sheet)\b/i
      .test(canonicalizeECOSQuestionLanguage(question))
  ) return null;
  for (const sheetReference of sheetReferences) {
    const exactSheetSources = sources.filter((source) =>
      source.sourceType === "document" &&
      ecosSheetReferenceMatches(
        source.documentCitation?.sheetNumber || "",
        sheetReference,
      )
    );
    const purposeCandidates = exactSheetSources.flatMap((source) => {
      const purpose = source.excerpt.match(
        /\b((?:ENLARGED\s+)?(?:LIGHTING|POWER|MECHANICAL|PLUMBING|FLOOR|ROOF|SITE|AREA)\s+(?:PLAN|LAYOUT))\b/i,
      )?.[1];
      return purpose ? [{ source, purpose }] : [];
    });
    const purposes = uniquePolicyValues(
      purposeCandidates.map((candidate) =>
        normalizePolicyText(candidate.purpose)
      ),
    );
    if (purposes.length !== 1) continue;
    const purposeCandidate = purposeCandidates.sort((left, right) =>
      compareDeterministicLightingSources(left.source, right.source)
    )[0];
    if (!purposeCandidate) {
      continue;
    }
    const areaCandidates = exactSheetSources.flatMap((source) => {
      const area = source.excerpt.match(
        /\b(?:BUILDING|BLDG)\s+AREA\s+[A-Z0-9]+\b/i,
      )?.[0].replace(/^BLDG\b/i, "Building");
      return area ? [{ source, area }] : [];
    });
    const areas = uniquePolicyValues(
      areaCandidates.map((candidate) =>
        normalizePolicyText(candidate.area)
      ),
    );
    if (areas.length > 1) continue;
    const areaCandidate = areaCandidates.sort((left, right) =>
      compareDeterministicLightingSources(left.source, right.source)
    )[0];
    return {
      statement: sanitizeECOSAnswerStatement(
        `Current Sheet ${sheetReference} shows ${
          areaCandidate
            ? `the ${titleCaseEvidencePhrase(areaCandidate.area)} `
            : "the "
        }${titleCaseEvidencePhrase(purposeCandidate.purpose)}.`,
      ),
      sourceIds: [
        ...new Set([
          purposeCandidate.source.id,
          ...(areaCandidate ? [areaCandidate.source.id] : []),
        ]),
      ],
    };
  }
  return null;
}

/**
 * Builds a deterministic drawing-navigation answer only when one bounded
 * current-sheet note points to another exact sheet and that target sheet also
 * has responsive bounded proof. This keeps the field direction and the detail
 * itself together without trusting a model to preserve both sides.
 */
export function buildECOSDrawingLocationFallback(
  question: string,
  sources: readonly Readonly<{
    id: string;
    sourceType: string;
    title?: string;
    excerpt: string;
    score?: number;
    documentCitation?: Readonly<{ sheetNumber?: string | null }>;
    documentRegion?: Readonly<{ id: string }>;
  }>[],
) {
  if (!ecosQuestionRequestsDrawingLocation(question)) return null;
  const referrals = sources.flatMap((source) => {
    if (
      source.sourceType !== "document" || !source.documentRegion ||
      ecosEvidenceQuestionContextScore(
          question,
          `${source.title || ""} ${source.excerpt}`,
        ) <= 0
    ) return [];
    const referringSheet = source.documentCitation?.sheetNumber || "";
    if (!referringSheet) return [];
    const matches = [...source.excerpt.matchAll(
      /\b(?:CONSTRUCT|INSTALL|PROVIDE|BUILD|PLACE|FORM)?\s*([A-Z][A-Z0-9 &/#().'-]{2,100}?)\s*[-—:]?\s*(?:SEE|REFER(?:S|RED)?(?:\s+TO)?|DIRECT(?:S|ED)?(?:\s+TO)?)\s+(?:THE\s+)?(?:DETAILS?|SECTIONS?|DRAWINGS?|PLANS?)?\s*(?:ON|AT|IN|TO)?\s*SHEET\s+([A-Z]{0,3}[-.]?\d+(?:\.\d+)?)\b/gi,
    )];
    return matches.flatMap((match) => {
      const subject = cleanDrawingLocationSubject(match[1] || "");
      const targetSheet = inferredDrawingSheetReference(
        referringSheet,
        match[2] || "",
      );
      return subject && targetSheet &&
          !ecosSheetReferenceMatches(referringSheet, targetSheet)
        ? [{ source, referringSheet, targetSheet, subject }]
        : [];
    });
  });
  const candidates = referrals.flatMap((referral) => {
    const target = sources
      .filter((source) =>
        source.sourceType === "document" && source.documentRegion &&
        ecosSheetReferenceMatches(
          source.documentCitation?.sheetNumber || "",
          referral.targetSheet,
        ) &&
        ecosEvidenceQuestionContextScore(
            question,
            `${source.title || ""} ${source.excerpt}`,
          ) > 0
      )
      .sort((left, right) =>
        (right.score || 0) - (left.score || 0) ||
        left.id.localeCompare(right.id)
      )[0];
    return target ? [{ ...referral, target }] : [];
  });
  const targetSheets = uniquePolicyValues(
    candidates.map((candidate) => candidate.targetSheet),
  );
  if (targetSheets.length !== 1) return null;
  const selected =
    candidates.sort((left, right) =>
      (right.source.score || 0) - (left.source.score || 0) ||
      left.source.id.localeCompare(right.source.id)
    )[0];
  if (!selected) return null;
  return {
    statement: sanitizeECOSAnswerStatement(
      `Current Sheet ${selected.referringSheet} directs the field team to Sheet ${selected.targetSheet} for the ${selected.subject} details, and current Sheet ${selected.targetSheet} contains the requested details.`,
    ),
    sourceIds: [selected.source.id, selected.target.id],
  };
}

/**
 * Resolves a cross-sheet hazardous-material canopy plan set only when the
 * current evidence contains one unambiguous bounded canopy-plan title plus an
 * unambiguous hazardous-material plan title and containment-area proof on a
 * different sheet. A referral note alone is not enough proof of either
 * sheet's purpose.
 */
export function buildECOSCrossSheetCanopyPlanSetFallback(
  question: string,
  sources: readonly Readonly<{
    id: string;
    sourceType: string;
    title?: string;
    excerpt: string;
    score?: number;
    documentCitation?: Readonly<{ sheetNumber?: string | null }>;
    documentRegion?: Readonly<{
      id: string;
      reconstructionMethod?: string | null;
      evidenceSources?: readonly string[];
    }>;
  }>[],
) {
  const normalizedQuestion = normalizePolicyQuestion(question);
  if (
    !/\b(?:which|what)\b[\s\S]{0,120}\b(?:sheets?|drawings?|plans?|plan\s+set)\b/
      .test(normalizedQuestion) ||
    !/\bhazardous\s+material\b/.test(normalizedQuestion) ||
    !/\bcanop(?:y|ies)\b/.test(normalizedQuestion)
  ) return null;

  const bounded = sources.filter((source) =>
    source.sourceType === "document" && source.documentRegion &&
    Boolean(source.documentCitation?.sheetNumber)
  );
  const canopyPlanCandidates = bounded.filter((source) =>
    /\bWEATHER\s+PROTECTED\s+CANOPY\s+PLANS?\b/i.test(source.excerpt)
  );
  const hazardousPlanCandidates = bounded.filter((source) =>
    /\bWEATHER\s+PROTECTED\s+CANOPY\b/i.test(source.excerpt) &&
    /\bHAZARDOUS\s+MATERIAL\b/i.test(source.excerpt)
  );
  const containmentAreaCandidates = bounded.filter((source) =>
    /\bHAZARDOUS\s+MATERIAL\b/i.test(source.excerpt) &&
    /\bCONTAINMENT\s+AREA\b/i.test(source.excerpt)
  );
  const canopySheets = uniquePolicyValues(
    canopyPlanCandidates.map((source) =>
      source.documentCitation?.sheetNumber || ""
    ),
  );
  const hazardousSheets = uniquePolicyValues(
    hazardousPlanCandidates.map((source) =>
      source.documentCitation?.sheetNumber || ""
    ),
  );
  const containmentSheets = uniquePolicyValues(
    containmentAreaCandidates.map((source) =>
      source.documentCitation?.sheetNumber || ""
    ),
  );
  if (
    canopySheets.length !== 1 || hazardousSheets.length !== 1 ||
    containmentSheets.length !== 1 ||
    !ecosSheetReferenceMatches(hazardousSheets[0], containmentSheets[0]) ||
    ecosSheetReferenceMatches(canopySheets[0], hazardousSheets[0])
  ) return null;

  const canopyPlan = canopyPlanCandidates
    .sort(compareDeterministicLightingSources)[0];
  const hazardousPlan = hazardousPlanCandidates
    .sort(compareDeterministicLightingSources)[0];
  const containmentArea = containmentAreaCandidates
    .sort(compareDeterministicLightingSources)[0];
  if (!canopyPlan || !hazardousPlan || !containmentArea) return null;
  const canopySheet = canopyPlan.documentCitation?.sheetNumber || "";
  const containmentSheet = hazardousPlan.documentCitation?.sheetNumber || "";
  return {
    statement: sanitizeECOSAnswerStatement(
      `Use current Architectural Sheet ${canopySheet} for the weather-protected canopy plan and Sheet ${containmentSheet} for the hazardous-material containment area plan; review the two sheets together.`,
    ),
    sourceIds: [canopyPlan.id, hazardousPlan.id, containmentArea.id],
  };
}

function cleanDrawingLocationSubject(value: string) {
  return titleCaseEvidencePhrase(
    value.replace(
      /^DRAWING\s+PAGE\s+CONTEXT[\s\S]*?\b(?:CONSTRUCT|INSTALL|PROVIDE|BUILD|PLACE|FORM)\b/i,
      "",
    )
      .replace(/^(?:CONSTRUCT|INSTALL|PROVIDE|BUILD|PLACE|FORM)\s+/i, "")
      .replace(/\s+/g, " ").trim(),
  ).slice(0, 120);
}

function inferredDrawingSheetReference(
  referringSheet: string,
  target: string,
) {
  const cleanTarget = target.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]/.test(cleanTarget)) return cleanTarget;
  const discipline = referringSheet.toUpperCase().match(/^[A-Z]{1,3}/)?.[0] ||
    "";
  return `${discipline}${cleanTarget}`;
}

export function buildECOSCrossDisciplineCanopyFallback(
  question: string,
  sources: readonly Readonly<
    { id: string; sourceType: string; title?: string; excerpt: string }
  >[],
) {
  const normalizedQuestion = normalizePolicyQuestion(question);
  if (
    !/\bcanop(?:y|ies)\b/.test(normalizedQuestion) ||
    !/\b(?:area|footprint|square feet|plan area)\b/.test(normalizedQuestion) ||
    !/\b(?:slab|pad|foundation|reinforced|thickness|structural)\b/.test(
      normalizedQuestion,
    )
  ) return null;
  const areaCandidates = sources.flatMap((source) => {
    if (
      source.sourceType !== "document" ||
      !/\barchitectural\b/i.test(source.title || "")
    ) return [];
    return [...source.excerpt.matchAll(
      /\b((?:NEW\s+)?CANOPY\s+[A-Z0-9]+)\b[\s\S]{0,160}?\b([\d,]+(?:\.\d+)?)\s*(?:S\.?F\.?|SF|SQUARE\s+FEET)\b/gi,
    )].map((match) => ({
      sourceId: source.id,
      subject: String(match[1] || "").replace(/\s+/g, " ").trim(),
      area: String(match[2] || "").replace(/,/g, ""),
    }));
  });
  const slabCandidates = sources.flatMap((source) => {
    if (
      source.sourceType !== "document" ||
      !/\bstructural\b/i.test(source.title || "")
    ) return [];
    return [...source.excerpt.matchAll(
      /\b(\d+(?:\.\d+)?)\s*[- ]?\s*(?:INCH(?:ES)?|IN\.?|["”])(?:\s*[- ]?\s*THICK)?\s+REINFORCED[_\s]+CONCRETE[_\s]+SLAB\b/gi,
    )].map((match) => ({
      sourceId: source.id,
      inches: String(match[1] || ""),
    }));
  });
  const requestedCanopyIdentities = uniquePolicyValues(
    [...normalizedQuestion.matchAll(/\bcanopy\s+([a-z]|\d+[a-z]?)\b/g)]
      .map((match) => `canopy ${match[1]}`),
  );
  const requestedAreaCandidates = requestedCanopyIdentities.length > 0
    ? areaCandidates.filter((candidate) =>
      requestedCanopyIdentities.includes(
        normalizePolicyText(candidate.subject).replace(/^new\s+/, ""),
      )
    )
    : areaCandidates;
  const uniqueAreas = uniqueByKey(
    requestedAreaCandidates,
    (candidate) =>
      `${normalizePolicyText(candidate.subject)}|${candidate.area}`,
  );
  const uniqueSlabs = uniqueByKey(
    slabCandidates,
    (candidate) => candidate.inches,
  );
  if (
    uniqueAreas.length !== 1 || uniqueSlabs.length !== 1 ||
    uniqueAreas[0].sourceId === uniqueSlabs[0].sourceId
  ) {
    return null;
  }
  const area = uniqueAreas[0];
  const slab = uniqueSlabs[0];
  const formattedArea = Number(area.area).toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
  return {
    statement: sanitizeECOSAnswerStatement(
      `The current architectural drawing shows ${
        titleCaseEvidencePhrase(area.subject)
      } at ${formattedArea} square feet, and the current structural drawing requires a ${slab.inches}-inch-thick reinforced concrete slab.`,
    ),
    sourceIds: [area.sourceId, slab.sourceId],
  };
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
    {
      id: string;
      sourceType: string;
      title?: string;
      excerpt: string;
      score?: number;
      documentCitation?: Readonly<{ sheetNumber?: string | null }>;
      documentRegion?: Readonly<{ id: string }>;
    }
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
  const civil = sources
    .filter((source) =>
      source.sourceType === "document" &&
      Boolean(source.documentRegion?.id) &&
      Boolean(source.documentCitation?.sheetNumber) &&
      /\bcivil\b/i.test(source.title || "") &&
      /\barea\s+lighting\b[\s\S]{0,180}\barchitectural\s+and\s+electrical\s+drawings\b/i
        .test(source.excerpt)
    )
    .sort(compareDeterministicLightingSources)[0];
  const electrical = sources
    .filter((source) =>
      source.sourceType === "document" &&
      Boolean(source.documentRegion?.id) &&
      Boolean(source.documentCitation?.sheetNumber) &&
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
    .sort((left, right) =>
      right.score - left.score ||
      compareDeterministicLightingSources(left.source, right.source)
    )[0]?.source;
  if (!civil || !electrical) return null;
  const civilSheet = civil.documentCitation?.sheetNumber || "";
  const electricalSheet = electrical.documentCitation?.sheetNumber || "";
  return {
    statement: sanitizeECOSAnswerStatement(
      `Yes. The current civil${
        civilSheet ? ` Sheet ${civilSheet}` : " drawing"
      } directs area lighting to the architectural and electrical drawings, and the current electrical${
        electricalSheet ? ` Sheet ${electricalSheet}` : " drawing"
      } shows lighting. The field team should use these civil and electrical sources together.`,
    ),
    sourceIds: [civil.id, electrical.id],
  };
}

function compareDeterministicLightingSources(
  left: Readonly<{
    id: string;
    score?: number;
    documentRegion?: Readonly<{
      id: string;
      reconstructionMethod?: string | null;
      evidenceSources?: readonly string[];
    }>;
  }>,
  right: Readonly<{
    id: string;
    score?: number;
    documentRegion?: Readonly<{
      id: string;
      reconstructionMethod?: string | null;
      evidenceSources?: readonly string[];
    }>;
  }>,
) {
  return Number(isHighResolutionDeterministicRegion(right.documentRegion)) -
      Number(isHighResolutionDeterministicRegion(left.documentRegion)) ||
    Number(Boolean(right.documentRegion)) -
      Number(Boolean(left.documentRegion)) ||
    (right.score || 0) - (left.score || 0) ||
    left.id.localeCompare(right.id);
}

function isHighResolutionDeterministicRegion(
  region:
    | Readonly<{
      id: string;
      reconstructionMethod?: string | null;
      evidenceSources?: readonly string[];
    }>
    | undefined,
) {
  return region?.reconstructionMethod ===
      "exact_source_bound_dual_render_consensus" &&
    (region.evidenceSources?.length || 0) >= 2;
}

export function buildECOSCanopyLightingFallback(
  question: string,
  sources: readonly Readonly<
    {
      id: string;
      sourceType: string;
      title?: string;
      excerpt: string;
      score?: number;
      documentRegion?: Readonly<{
        id: string;
        reconstructionMethod?: string | null;
        evidenceSources?: readonly string[];
      }>;
    }
  >[],
) {
  const normalizedQuestion = normalizePolicyQuestion(question);
  if (
    !/\bcanop(?:y|ies)\b/.test(normalizedQuestion) ||
    !/\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/.test(
      normalizedQuestion,
    )
  ) return null;
  const architectural =
    sources.filter((source) =>
      source.sourceType === "document" &&
      /\barchitectural\b/i.test(source.title || "") &&
      /\bcanop(?:y|ies)\b/i.test(source.excerpt) &&
      /\bnew\s+light\s+fixture\b/i.test(source.excerpt) &&
      /\bsee\s+electrical\b/i.test(source.excerpt)
    ).sort(compareDeterministicLightingSources)[0];
  const electrical =
    sources.filter((source) =>
      source.sourceType === "document" &&
      /\belectrical\b/i.test(source.title || "") &&
      /\bexterior\s+storage\b/i.test(source.excerpt) &&
      /\blighting\s+plans?\b/i.test(source.excerpt)
    ).sort(compareDeterministicLightingSources)[0];
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
  const boundedPanelTuplePattern =
    /\bExisting\s+panel\s+replacement:\s*(\d+)\s*-?\s*amp\s+bus\s+and\s+(\d+)\s+poles\b/gi;
  for (const match of value.matchAll(boundedPanelTuplePattern)) {
    normalizedFacts.push(
      `Existing panel replacement: ${match[1]} AMPS bus and ${match[2]} POLES`,
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
    if (
      !(context.subjectMatched || context.attributeMatched) ||
      !context.locationMatched
    ) continue;
    const subject =
      requirement.attribute && requirement.attribute !== "quantity"
        ? requirement.attribute
        : context.matchedSubjectTokens.find((token) => token.length >= 3) ||
          context.subjectTokens.find((token) => token.length >= 3);
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
    candidates.sort((left, right) =>
      right.score - left.score || left.sourceId.localeCompare(right.sourceId)
    )[0];
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
  const equipmentSchedulePattern =
    /\b(Exhaust\s+fan\s+EF\s*-?\s*\d+[A-Z]?\s*:\s*\d+(?:\.\d+)?\s*CFM\s*;\s*serves\s+[^.\n]{1,180})(?=\.|\n|$)/gi;
  for (const match of excerpt.matchAll(equipmentSchedulePattern)) {
    const fact = String(match[1] || "").replace(/\s+/g, " ").trim();
    if (fact) facts.push(fact);
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

function titleCaseEvidencePhrase(value: string) {
  return value.toLowerCase().replace(
    /\b[a-z]/g,
    (character) => character.toUpperCase(),
  );
}

function uniqueByKey<T>(values: readonly T[], keyFor: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const attributeTermTokens = (requirement.attributeTerms || []).flatMap(
    (term) => normalizePolicyText(term).split(/\s+/).filter(Boolean),
  );
  // "Square footage" requests an area, not a separate construction subject.
  // Its synonym must not require the source to literally say "footage".
  if (requirement.attribute === "area") attributeTermTokens.push("footage");
  const ignored = new Set([
    "a",
    "about",
    "an",
    "and",
    "approximately",
    "actually",
    "actual",
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
    "we",
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
    "proof",
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
    "measured",
    "measurement",
    "test",
    "result",
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
    ...attributeTermTokens,
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
