import {
  analyzeECOSProjectQuestion,
  analyzeECOSQuestionEvidenceContext,
  containsECOSQuantityValue,
  containsECOSRequestedMeasurementValue,
  ecosEvidenceMatchesQuestionRequirement,
  ecosEvidenceQuestionContextScore,
} from "./ecos-project-answer-policy.ts";
import {
  ecosQuestionExplicitSheetReferences,
} from "./ecos-question-language.ts";

export type ECOSDrawingRegionInput = Readonly<{
  id?: unknown;
  label?: unknown;
  text?: unknown;
  areaNames?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  confidence?: unknown;
  source?: unknown;
  rawSource?: unknown;
  reconstructionMethod?: unknown;
  evidenceSources?: unknown;
  constituentEvidence?: unknown;
  corroboratingEvidence?: unknown;
  searchable?: unknown;
}>;

export type ECOSDrawingProvenanceEvidence = Readonly<Record<string, unknown>>;

export type ECOSDrawingEvidencePassage = Readonly<{
  text: string;
  score: number;
  regionId: string | null;
  contextRegionIds: readonly string[];
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence: number | null;
  source: "embedded_text" | "ocr" | "vision" | null;
  rawSource: string | null;
  reconstructionMethod: string | null;
  evidenceSources: readonly string[];
  constituentEvidence: readonly ECOSDrawingProvenanceEvidence[];
  corroboratingEvidence: readonly ECOSDrawingProvenanceEvidence[];
  areaNames: readonly string[];
}>;

type DrawingRegion = Readonly<{
  id: string;
  text: string;
  areaNames: readonly string[];
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence: number | null;
  source: "embedded_text" | "ocr" | "vision" | null;
  rawSource: string | null;
  reconstructionMethod: string | null;
  evidenceSources: readonly string[];
  constituentEvidence: readonly ECOSDrawingProvenanceEvidence[];
  corroboratingEvidence: readonly ECOSDrawingProvenanceEvidence[];
}>;

/**
 * Builds evidence around a measured drawing note. Nearby regions are kept
 * together and distant measurements are never merged into one excerpt. A
 * sheet-wide location label may provide page context, but the measurement
 * cluster itself must still identify the requested construction subject.
 */
export function buildECOSDrawingEvidencePassages({
  pageText,
  regions,
  question,
  questionVariants = [],
  pageIdentity = "",
  structuredTableAnalysis = null,
  maximumPassages = 3,
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  questionVariants?: readonly string[];
  pageIdentity?: string;
  structuredTableAnalysis?: unknown;
  maximumPassages?: number;
}): ECOSDrawingEvidencePassage[] {
  const questions = unique([question, ...questionVariants]).filter(Boolean);
  if (questions.length > 1) {
    return questions
      .flatMap((candidateQuestion) =>
        buildECOSDrawingEvidencePassages({
          pageText,
          regions,
          question: candidateQuestion,
          pageIdentity,
          structuredTableAnalysis,
          maximumPassages,
        })
      )
      .sort((left, right) => right.score - left.score)
      .filter((passage, index, all) =>
        all.findIndex((other) =>
          normalizeText(other.text) === normalizeText(passage.text)
        ) === index
      )
      .slice(0, Math.max(1, Math.min(12, maximumPassages)));
  }
  const evidenceRegions = [
    ...regions,
    ...materializeVerifiedStructuredTableRegions(structuredTableAnalysis),
  ];
  const normalizedRegions = evidenceRegions.map(normalizeRegion).filter((
    region,
  ): region is DrawingRegion => Boolean(region));
  if (normalizedRegions.length === 0) {
    // When a page supplies structured regions, those regions are the evidence
    // boundary. Falling back to unsanitized page text could reintroduce raw
    // table constituents that the hosted index explicitly quarantined.
    const fallback = regions.length === 0
      ? buildLineFallback(pageText, question, pageIdentity)
      : null;
    return fallback ? [fallback] : [];
  }
  const safePageText = regions.length === 0
    ? pageText
    : normalizedRegions.map((region) => region.text).join("\n");
  const requirement = analyzeECOSProjectQuestion(question);
  const calculatedAreaPassages = requirement.attribute === "area"
    ? buildCalculatedAreaPassages(
      normalizedRegions,
      safePageText,
      question,
      pageIdentity,
    )
    : [];
  const printedAreaPassages = requirement.attribute === "area"
    ? buildPrintedAreaPassages(
      normalizedRegions,
      question,
      pageIdentity,
    )
    : [];
  const exactSheetPurposePassages = requirement.kind === "general"
    ? buildExactSheetPurposePassages(
      normalizedRegions,
      question,
      pageIdentity,
    )
    : [];
  const locationRegions = normalizedRegions.filter((region) => {
    const context = analyzeECOSQuestionEvidenceContext(question, region.text);
    return context.locationMatched &&
      (context.locationDirectionTokens.length > 0 ||
        context.locationKindTokens.length > 0);
  });
  const anchors = normalizedRegions.filter((region) => {
    const identityBoundText = unique([pageIdentity, region.text]).join("\n");
    if (requirement.kind === "measurement") {
      return containsECOSRequestedMeasurementValue(question, region.text);
    }
    if (requirement.kind === "quantity") {
      return containsECOSQuantityValue(region.text, question) &&
        ecosEvidenceQuestionContextScore(question, identityBoundText) > 0;
    }
    if (requirement.kind === "presence") {
      return ecosEvidenceMatchesQuestionRequirement(
        question,
        identityBoundText,
      );
    }
    return ecosEvidenceQuestionContextScore(question, region.text) > 0;
  });
  const directPassages = anchors.flatMap((anchor) => {
    const nearby = normalizedRegions.filter((region) =>
      region.id !== anchor.id &&
      regionsAreNear(anchor, region) &&
      !(containsECOSRequestedMeasurementValue(question, anchor.text) &&
        containsECOSRequestedMeasurementValue(question, region.text))
    );
    const localText = unique([
      anchor.text,
      ...nearby.map((region) => region.text),
    ]).join("\n");
    const localIdentityText = unique([pageIdentity, localText]).join("\n");
    const localContext = analyzeECOSQuestionEvidenceContext(
      question,
      localIdentityText,
    );
    if (
      requirement.kind === "measurement" &&
      (!localContext.measurementMatched || !localContext.attributeMatched)
    ) {
      return [];
    }
    if (
      requirement.kind === "quantity" &&
      !containsECOSQuantityValue(localText, question)
    ) return [];
    if (
      requirement.kind === "presence" &&
      !ecosEvidenceMatchesQuestionRequirement(question, localIdentityText)
    ) return [];
    if (!localContext.subjectMatched) return [];

    const nearbyLocation = locationRegions
      .filter((region) =>
        region.id !== anchor.id && regionsAreNear(anchor, region)
      )
      .sort((left, right) =>
        regionDistance(anchor, left) - regionDistance(anchor, right)
      )[0];
    const sheetLocation = nearbyLocation || locationRegions
      .sort((left, right) =>
        ecosEvidenceQuestionContextScore(question, right.text) -
        ecosEvidenceQuestionContextScore(question, left.text)
      )[0];
    const contextualRegions = uniqueRegions([
      anchor,
      sheetLocation,
      ...nearby
        .filter((region) =>
          ecosEvidenceQuestionContextScore(question, region.text) > 0 ||
          containsECOSRequestedMeasurementValue(question, region.text)
        )
        .sort((left, right) =>
          regionDistance(anchor, left) - regionDistance(anchor, right)
        )
        .slice(0, 5),
    ].filter((region): region is DrawingRegion => Boolean(region)));
    const passageText = unique([
      pageIdentity,
      ...contextualRegions.map((region) => region.text),
    ]).join("\n");
    const passageContext = analyzeECOSQuestionEvidenceContext(
      question,
      passageText,
    );
    if (!passageContext.subjectMatched || !passageContext.locationMatched) {
      return [];
    }
    const locationProximityBonus =
      sheetLocation && regionsAreNear(anchor, sheetLocation) ? 1.5 : 0.5;
    const anchorSpecificity = ecosEvidenceQuestionContextScore(
      question,
      anchor.text,
    );
    const score = ecosEvidenceQuestionContextScore(question, passageText) * 4 +
      anchorSpecificity * 2 + locationProximityBonus +
      (anchor.confidence ?? 0.75);
    return [{
      text: passageText,
      score,
      regionId: anchor.id || null,
      contextRegionIds: Object.freeze(
        contextualRegions.map((region) => region.id).filter(Boolean),
      ),
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      confidence: anchor.confidence,
      source: anchor.source,
      rawSource: anchor.rawSource,
      reconstructionMethod: anchor.reconstructionMethod,
      evidenceSources: anchor.evidenceSources,
      constituentEvidence: anchor.constituentEvidence,
      corroboratingEvidence: anchor.corroboratingEvidence,
      areaNames: Object.freeze(
        unique(contextualRegions.flatMap((region) => region.areaNames)),
      ),
    }];
  });
  return [
    ...calculatedAreaPassages,
    ...printedAreaPassages,
    ...exactSheetPurposePassages,
    ...directPassages,
  ]
    .sort((left, right) => right.score - left.score)
    .filter((passage, index, all) =>
      all.findIndex((other) =>
        normalizeText(other.text) === normalizeText(passage.text)
      ) === index
    )
    .slice(0, Math.max(1, Math.min(12, maximumPassages)));
}

function buildPrintedAreaPassages(
  regions: readonly DrawingRegion[],
  question: string,
  pageIdentity: string,
): ECOSDrawingEvidencePassage[] {
  const areaRegions = regions.filter((region) =>
    /\barea\b\s*:?\s*[\d,]+(?:\.\d+)?\s*(?:square\s+feet|sq\.?\s*ft\.?|sf)\b/i
      .test(region.text)
  );
  const pageContextRegions = regions
    .filter((region) =>
      /\b(?:plan|schedule|detail|diagram|layout|elevation|section|summary)\b/i
        .test(region.text) &&
      ecosEvidenceQuestionContextScore(question, region.text) > 0
    )
    .sort((left, right) =>
      ecosEvidenceQuestionContextScore(question, right.text) -
      ecosEvidenceQuestionContextScore(question, left.text)
    )
    .slice(0, 3);
  return areaRegions.flatMap((areaRegion) => {
    const contextualRegions = uniqueRegions([
      areaRegion,
      ...pageContextRegions,
    ]);
    const passageText = unique([
      pageIdentity,
      ...contextualRegions.map((region) => region.text),
    ]).join("\n");
    const context = analyzeECOSQuestionEvidenceContext(question, passageText);
    if (
      !context.subjectMatched || !context.locationMatched ||
      !context.measurementMatched || !context.attributeMatched
    ) return [];
    const bounds = unionBounds(contextualRegions);
    return [{
      text: passageText,
      score: 45 + ecosEvidenceQuestionContextScore(question, passageText),
      regionId: areaRegion.id || null,
      contextRegionIds: Object.freeze(
        contextualRegions.map((region) => region.id).filter(Boolean),
      ),
      x: bounds?.x ?? areaRegion.x,
      y: bounds?.y ?? areaRegion.y,
      width: bounds?.width ?? areaRegion.width,
      height: bounds?.height ?? areaRegion.height,
      confidence: minimumConfidence(contextualRegions),
      source: areaRegion.source,
      rawSource: areaRegion.rawSource,
      reconstructionMethod: areaRegion.reconstructionMethod,
      evidenceSources: Object.freeze(
        unique(contextualRegions.flatMap((region) => region.evidenceSources)),
      ),
      constituentEvidence: Object.freeze(uniqueEvidenceRecords(
        contextualRegions.flatMap((region) => region.constituentEvidence),
      )),
      corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
        contextualRegions.flatMap((region) => region.corroboratingEvidence),
      )),
      areaNames: Object.freeze(
        unique(contextualRegions.flatMap((region) => region.areaNames)),
      ),
    }];
  });
}

function buildExactSheetPurposePassages(
  regions: readonly DrawingRegion[],
  question: string,
  pageIdentity: string,
): ECOSDrawingEvidencePassage[] {
  const sheetReferences = ecosQuestionExplicitSheetReferences(question);
  const pageSheetReferences = ecosQuestionExplicitSheetReferences(pageIdentity);
  if (
    sheetReferences.length === 0 ||
    !sheetReferences.some((reference) =>
      pageSheetReferences.includes(reference)
    )
  ) return [];
  const purposeRegions = regions.filter((region) =>
    /\b(?:enlarged\s+|overall\s+|partial\s+|floor\s+|roof\s+|site\s+)?(?:lighting|power|electrical|mechanical|plumbing|architectural|structural|demolition|reflected\s+ceiling|life\s+safety|floor|roof|site|grading|drainage|utility|details?)\s+(?:plans?|schedules?|details?|diagrams?|layouts?|elevations?|sections?)\b/i
      .test(region.text)
  );
  return purposeRegions.map((purpose) => {
    const nearby = regions
      .filter((region) =>
        region.id !== purpose.id && regionsAreNear(purpose, region)
      )
      .sort((left, right) =>
        regionDistance(purpose, left) - regionDistance(purpose, right)
      )
      .slice(0, 4);
    const contextualRegions = uniqueRegions([purpose, ...nearby]);
    const passageText = unique([
      pageIdentity,
      ...contextualRegions.map((region) => region.text),
    ]).join("\n");
    const bounds = unionBounds(contextualRegions);
    return {
      text: passageText,
      score: 50 + ecosEvidenceQuestionContextScore(question, passageText),
      regionId: purpose.id || null,
      contextRegionIds: Object.freeze(
        contextualRegions.map((region) => region.id).filter(Boolean),
      ),
      x: bounds?.x ?? purpose.x,
      y: bounds?.y ?? purpose.y,
      width: bounds?.width ?? purpose.width,
      height: bounds?.height ?? purpose.height,
      confidence: minimumConfidence(contextualRegions),
      source: purpose.source,
      rawSource: purpose.rawSource,
      reconstructionMethod: purpose.reconstructionMethod,
      evidenceSources: Object.freeze(
        unique(contextualRegions.flatMap((region) => region.evidenceSources)),
      ),
      constituentEvidence: Object.freeze(uniqueEvidenceRecords(
        contextualRegions.flatMap((region) => region.constituentEvidence),
      )),
      corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
        contextualRegions.flatMap((region) => region.corroboratingEvidence),
      )),
      areaNames: Object.freeze(
        unique(contextualRegions.flatMap((region) => region.areaNames)),
      ),
    };
  });
}

function materializeVerifiedStructuredTableRegions(
  value: unknown,
): ECOSDrawingRegionInput[] {
  const analysis = objectValue(value);
  const relationships = Array.isArray(analysis.relationships)
    ? analysis.relationships.map(objectValue)
    : [];
  return relationships.flatMap((relationship) => {
    const relationshipId = textValue(relationship.id);
    if (
      !relationshipId ||
      textValue(relationship.type) !== "photometric_statistics" ||
      relationship.status !== "complete" ||
      textValue(relationship.rowKey).toUpperCase() !== "ALL" ||
      !emptyStringArray(relationship.missingRoles) ||
      !emptyStringArray(relationship.conflictCodes)
    ) return [];
    const roles = objectValue(relationship.roles);
    const description = completeStructuredRole(roles.description, null);
    const average = completeStructuredRole(roles.avg, "fc");
    const maximum = completeStructuredRole(roles.max, "fc");
    const minimum = completeStructuredRole(roles.min, "fc");
    if (
      !description || normalizeText(description.text) !== "all" ||
      !average || !maximum || !minimum
    ) return [];
    const relationshipConstituents = Array.isArray(relationship.constituents)
      ? relationship.constituents.map(objectValue)
      : [];
    const constituents = uniqueEvidenceRecords([
      ...description.constituents,
      ...average.constituents,
      ...maximum.constituents,
      ...minimum.constituents,
    ]);
    if (
      constituents.length < 4 ||
      !constituents.every((candidate) =>
        relationshipConstituents.some((item) =>
          exactStructuredConstituent(item, candidate)
        )
      )
    ) return [];
    const bounds = constituentUnionBounds(constituents);
    if (!bounds) return [];
    const confidenceValues = constituents.map((item) =>
      coordinate(item.confidence)
    ).filter((candidate): candidate is number => candidate != null);
    const text = `${description.text} site photometric light levels: ` +
      `average ${average.text} fc; maximum ${maximum.text} fc; ` +
      `minimum ${minimum.text} fc`;
    return [{
      id: `structured-dossier:${relationshipId}`,
      text,
      ...bounds,
      confidence: confidenceValues.length > 0
        ? Math.min(...confidenceValues)
        : null,
      source: "deterministic_structured_table_relationship",
      reconstructionMethod:
        "complete_coordinate_bound_structured_table_relationship",
      evidenceSources: unique(
        constituents.map((item) => textValue(item.source)).filter(Boolean),
      ),
      constituentEvidence: constituents,
      corroboratingEvidence: [],
      searchable: true,
    }];
  });
}

function completeStructuredRole(value: unknown, requiredUnit: string | null) {
  const role = objectValue(value);
  if (role.state !== "complete") return null;
  const constituents = Array.isArray(role.constituents)
    ? role.constituents.map(objectValue)
    : [];
  if (constituents.length === 0) return null;
  const constituentText = constituents.map((item) => textValue(item.text))
    .filter(Boolean).join(" ");
  if (!constituentText) return null;
  if (requiredUnit == null) {
    const roleValue = textValue(role.value);
    if (
      !roleValue || normalizeText(roleValue) !== normalizeText(constituentText)
    ) {
      return null;
    }
    return { text: constituentText, constituents };
  }
  if (textValue(role.unit).toLowerCase() !== requiredUnit) return null;
  const numericValue = Number(role.value);
  const constituentValue = Number(constituentText.replace(/,/g, ""));
  if (
    !Number.isFinite(numericValue) || !Number.isFinite(constituentValue) ||
    Math.abs(numericValue - constituentValue) > 0.000001
  ) return null;
  return { text: constituentText, constituents };
}

function exactStructuredConstituent(
  expected: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
) {
  const expectedBounds = objectValue(expected.bounds);
  const actualBounds = objectValue(actual.bounds);
  return Boolean(textValue(expected.id)) &&
    textValue(expected.id) === textValue(actual.id) &&
    textValue(expected.text) === textValue(actual.text) &&
    textValue(expected.source) === textValue(actual.source) &&
    coordinate(expected.confidence) === coordinate(actual.confidence) &&
    ["x", "y", "width", "height"].every((key) =>
      coordinate(expectedBounds[key]) === coordinate(actualBounds[key])
    );
}

function emptyStringArray(value: unknown) {
  return Array.isArray(value) && value.length === 0;
}

function constituentUnionBounds(
  constituents: readonly Readonly<Record<string, unknown>>[],
) {
  const bounds = constituents.map((item) => objectValue(item.bounds));
  if (
    bounds.some((item) =>
      [item.x, item.y, item.width, item.height]
        .some((coordinateValue) => coordinate(coordinateValue) == null)
    )
  ) return null;
  const left = Math.min(...bounds.map((item) => Number(item.x)));
  const top = Math.min(...bounds.map((item) => Number(item.y)));
  const right = Math.max(
    ...bounds.map((item) => Number(item.x) + Number(item.width)),
  );
  const bottom = Math.max(
    ...bounds.map((item) => Number(item.y) + Number(item.height)),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

type DrawingDimension = Readonly<{
  region: DrawingRegion;
  feet: number;
  display: string;
}>;

/**
 * Creates a deterministic, reviewable plan-footprint calculation when one
 * drawing page contains two clear overall feet-and-inches dimensions. The
 * generated passage carries the formula so ECOS Assurance can verify the
 * arithmetic without asking the language model to invent or infer a value.
 */
function buildCalculatedAreaPassages(
  regions: readonly DrawingRegion[],
  pageText: string,
  question: string,
  pageIdentity: string,
): ECOSDrawingEvidencePassage[] {
  const pageContextText = unique([
    pageText,
    ...regions.map((region) => region.text),
  ]).join("\n");
  const pageContext = analyzeECOSQuestionEvidenceContext(
    question,
    pageContextText,
  );
  if (
    !pageContext.subjectMatched || !pageContext.locationMatched ||
    !/\bplan\b/i.test(pageContextText)
  ) return [];
  // A component-specific roof-covering plan can contain orthogonal panel or
  // accessory dimensions that are locally valid but do not establish the
  // footprint of the whole canopy/building. Keep that sheet available when
  // the user asks about the covering itself, but never promote its dimensions
  // into a whole-subject footprint calculation.
  if (
    /\broof\s+covering\s+plan\b/i.test(pageContextText) &&
    !/\b(?:roof\s+covering|roofing|roof\s+panels?|covering\s+panels?)\b/i
      .test(question)
  ) return [];

  const explicitlyOverall = regions.filter((region) =>
    /\boverall\b/i.test(region.text) &&
    !/\b(?:module|segment|bay|dimension\s+key)\b/i.test(region.text) &&
    !/\boverview\b/i.test(region.id)
  );
  const dimensionRegions = explicitlyOverall.length >= 2
    ? explicitlyOverall
    : regions;
  const dimensions = dimensionRegions.flatMap((region) =>
    parseFeetDimensions(region.text).map((dimension) => ({
      ...dimension,
      region,
    }))
  ).filter((dimension) => dimension.feet >= 3 && dimension.feet <= 2_000);
  const uniqueDimensions = dimensions
    .sort((left, right) => right.feet - left.feet)
    .filter((dimension, index, all) =>
      all.findIndex((other) =>
        Math.abs(other.feet - dimension.feet) < 0.001
      ) === index
    );
  if (uniqueDimensions.length < 2) return [];

  const horizontal =
    uniqueDimensions.find((dimension) =>
      dimension.region.width != null && dimension.region.height != null &&
      dimension.region.width >= dimension.region.height * 1.25
    ) || uniqueDimensions[0];
  const vertical =
    uniqueDimensions.find((dimension) =>
      dimension.region.id !== horizontal.region.id &&
      dimension.region.width != null && dimension.region.height != null &&
      dimension.region.height >= dimension.region.width * 1.25
    ) || uniqueDimensions.find((dimension) =>
      dimension.region.id !== horizontal.region.id
    );
  if (
    !horizontal || !vertical ||
    Math.abs(horizontal.feet - vertical.feet) < 0.001
  ) return [];

  const area = roundedArea(horizontal.feet * vertical.feet);
  if (!Number.isFinite(area) || area <= 0) return [];
  const contextRegions = regions
    .filter((region) =>
      ecosEvidenceQuestionContextScore(question, region.text) > 0
    )
    .sort((left, right) =>
      ecosEvidenceQuestionContextScore(question, right.text) -
      ecosEvidenceQuestionContextScore(question, left.text)
    )
    .slice(0, 3);
  const calculationRegions = uniqueRegions([
    ...contextRegions,
    horizontal.region,
    vertical.region,
  ]);
  const bounds = unionBounds(calculationRegions);
  const contextText = unique(contextRegions.map((region) => region.text)).join(
    "\n",
  );
  const areaDisplay = Number.isInteger(area)
    ? area.toLocaleString("en-US")
    : area.toFixed(1);
  const calculation = [
    pageIdentity,
    `ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: ${horizontal.display} × ${vertical.display} = ${areaDisplay} square feet.`,
    "The square footage is calculated from the cited drawing dimensions; it is not a separately printed area value.",
    contextText,
  ].filter(Boolean).join("\n");
  const rawSources = unique(
    calculationRegions.map((region) => region.rawSource || "").filter(Boolean),
  );
  const reconstructionMethods = unique(
    calculationRegions.map((region) => region.reconstructionMethod || "")
      .filter(Boolean),
  );
  return [{
    text: calculation,
    score: 40 + ecosEvidenceQuestionContextScore(question, calculation),
    regionId: horizontal.region.id || null,
    contextRegionIds: Object.freeze(
      calculationRegions.map((region) => region.id).filter(Boolean),
    ),
    x: bounds?.x ?? horizontal.region.x,
    y: bounds?.y ?? horizontal.region.y,
    width: bounds?.width ?? horizontal.region.width,
    height: bounds?.height ?? horizontal.region.height,
    confidence: minimumConfidence(calculationRegions),
    source: calculationRegions.every((region) =>
        region.source === "embedded_text"
      )
      ? "embedded_text"
      : calculationRegions.some((region) => region.source === "vision")
      ? "vision"
      : calculationRegions.some((region) => region.source === "ocr")
      ? "ocr"
      : null,
    rawSource: rawSources.length === 1 ? rawSources[0] : null,
    reconstructionMethod: reconstructionMethods.length === 1
      ? reconstructionMethods[0]
      : null,
    evidenceSources: Object.freeze(
      unique(calculationRegions.flatMap((region) => region.evidenceSources)),
    ),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      calculationRegions.flatMap((region) => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      calculationRegions.flatMap((region) => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(
      unique(calculationRegions.flatMap((region) => region.areaNames)),
    ),
  }];
}

function parseFeetDimensions(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const matches = [
    ...normalized.matchAll(
      /\b(\d{1,4})(?:\.(\d+))?\s*(?:'|feet|foot|ft\.?)\s*(?:-\s*)?(?:(\d{1,2})(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?\s*(?:"|inches?|inch|in\.?)?)?/gi,
    ),
  ];
  return matches.flatMap((match) => {
    const wholeFeet = Number(match[1]);
    const decimalFeet = match[2] ? Number(`0.${match[2]}`) : 0;
    const wholeInches = Number(match[3] || 0);
    const fractionNumerator = Number(match[4] || match[6] || 0);
    const fractionDenominator = Number(match[5] || (match[6] ? 1 : 0));
    const fractionInches = fractionDenominator > 0
      ? fractionNumerator / fractionDenominator
      : 0;
    const feet = wholeFeet + decimalFeet + (wholeInches + fractionInches) / 12;
    if (!Number.isFinite(feet) || feet <= 0) return [];
    return [{ feet, display: match[0].trim() }];
  });
}

function roundedArea(value: number) {
  return Math.round(value * 10) / 10;
}

function unionBounds(regions: readonly DrawingRegion[]) {
  if (
    regions.length === 0 ||
    regions.some((region) =>
      [region.x, region.y, region.width, region.height].some((value) =>
        value == null
      )
    )
  ) return null;
  const left = Math.min(...regions.map((region) => region.x!));
  const top = Math.min(...regions.map((region) => region.y!));
  const right = Math.max(...regions.map((region) => region.x! + region.width!));
  const bottom = Math.max(
    ...regions.map((region) => region.y! + region.height!),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function minimumConfidence(regions: readonly DrawingRegion[]) {
  const values = regions.map((region) => region.confidence).filter((
    value,
  ): value is number => value != null);
  return values.length > 0 ? Math.min(...values) : null;
}

function buildLineFallback(
  pageText: string,
  question: string,
  pageIdentity = "",
): ECOSDrawingEvidencePassage | null {
  const lines = pageText.replace(/\r/g, "").split("\n").map((value) =>
    value.trim()
  ).filter(Boolean);
  const requirement = analyzeECOSProjectQuestion(question);
  const candidates = lines.map((line, index) => {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    const text = unique([pageIdentity, ...lines.slice(start, end)]).join("\n");
    const context = analyzeECOSQuestionEvidenceContext(question, text);
    const valid = context.subjectMatched && context.locationMatched &&
      (requirement.kind === "general" ||
        (context.measurementMatched && context.attributeMatched));
    return {
      text,
      valid,
      score: ecosEvidenceQuestionContextScore(question, text),
    };
  }).filter((candidate) => candidate.valid)
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return best
    ? {
      text: best.text,
      score: best.score,
      regionId: null,
      contextRegionIds: Object.freeze([]),
      x: null,
      y: null,
      width: null,
      height: null,
      confidence: null,
      source: null,
      rawSource: null,
      reconstructionMethod: null,
      evidenceSources: Object.freeze([]),
      constituentEvidence: Object.freeze([]),
      corroboratingEvidence: Object.freeze([]),
      areaNames: Object.freeze([]),
    }
    : null;
}

function normalizeRegion(value: ECOSDrawingRegionInput): DrawingRegion | null {
  if (value.searchable === false) return null;
  const text = textValue(value.text) || textValue(value.label);
  if (!text) return null;
  const rawSource = textValue(value.rawSource) || textValue(value.source) ||
    null;
  return Object.freeze({
    id: textValue(value.id),
    text,
    areaNames: Object.freeze(
      Array.isArray(value.areaNames)
        ? value.areaNames.map(textValue).filter(Boolean)
        : [],
    ),
    x: coordinate(value.x),
    y: coordinate(value.y),
    width: coordinate(value.width),
    height: coordinate(value.height),
    confidence: coordinate(value.confidence),
    source: canonicalRegionSource(rawSource),
    rawSource,
    reconstructionMethod: textValue(value.reconstructionMethod) || null,
    evidenceSources: Object.freeze(
      Array.isArray(value.evidenceSources)
        ? unique(value.evidenceSources.map(textValue).filter(Boolean))
        : [],
    ),
    constituentEvidence: Object.freeze(
      evidenceRecords(value.constituentEvidence),
    ),
    corroboratingEvidence: Object.freeze(
      evidenceRecords(value.corroboratingEvidence),
    ),
  });
}

function regionsAreNear(left: DrawingRegion, right: DrawingRegion) {
  if (
    [
      left.x,
      left.y,
      left.width,
      left.height,
      right.x,
      right.y,
      right.width,
      right.height,
    ]
      .some((value) => value == null)
  ) return false;
  const verticalGap = axisGap(left.y!, left.height!, right.y!, right.height!);
  const horizontalGap = axisGap(left.x!, left.width!, right.x!, right.width!);
  const overlapsHorizontally = horizontalGap === 0;
  return verticalGap <= 0.09 &&
      (overlapsHorizontally || horizontalGap <= 0.12) ||
    regionDistance(left, right) <= 0.17;
}

function regionDistance(left: DrawingRegion, right: DrawingRegion) {
  if (
    [
      left.x,
      left.y,
      left.width,
      left.height,
      right.x,
      right.y,
      right.width,
      right.height,
    ]
      .some((value) => value == null)
  ) return Number.POSITIVE_INFINITY;
  const leftCenterX = left.x! + left.width! / 2;
  const leftCenterY = left.y! + left.height! / 2;
  const rightCenterX = right.x! + right.width! / 2;
  const rightCenterY = right.y! + right.height! / 2;
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
}

function axisGap(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
) {
  return Math.max(
    0,
    Math.max(firstStart, secondStart) -
      Math.min(firstStart + firstLength, secondStart + secondLength),
  );
}

function uniqueRegions(values: readonly DrawingRegion[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.id || normalizeText(value.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function canonicalRegionSource(
  value: string | null,
): "embedded_text" | "ocr" | "vision" | null {
  if (value === "deterministic_label_block") return "ocr";
  return value === "embedded_text" || value === "ocr" || value === "vision"
    ? value
    : null;
}

function evidenceRecords(value: unknown): ECOSDrawingProvenanceEvidence[] {
  return Array.isArray(value)
    ? value.filter((item) =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
      .map((item) => Object.freeze({ ...(item as Record<string, unknown>) }))
    : [];
}

function uniqueEvidenceRecords(
  values: readonly ECOSDrawingProvenanceEvidence[],
) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = textValue(value.id);
    const key = id || JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
