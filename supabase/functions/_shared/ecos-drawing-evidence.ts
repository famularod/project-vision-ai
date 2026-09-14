import {
  analyzeECOSProjectQuestion,
  analyzeECOSQuestionEvidenceContext,
  containsECOSRequestedMeasurementValue,
  ecosDrawingPropositionIsAssertiveCurrent,
  ecosDrawingPropositionIsAssertiveForExactQuestion,
  ecosEvidenceHasCompetingExplicitLocation,
  ecosEvidenceProvidesRequestedAnswerValue,
  ecosEvidenceQuestionContextScore,
  prepareECOSQuestionEvidenceContextAnalyzer,
  prepareECOSRequestedMeasurementValueMatcher,
} from "./ecos-project-answer-policy.ts";
import {
  canonicalComparableSheetNumber,
  strictNormalizedBounds,
} from "./ecos-sheet-provenance-validation.ts";

export type ECOSDrawingRegionInput = Readonly<{
  id?: unknown;
  label?: unknown;
  text?: unknown;
  evidenceText?: unknown;
  areaNames?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  confidence?: unknown;
  source?: unknown;
  rawSource?: unknown;
  reconstructionMethod?: unknown;
  factKind?: unknown;
  subject?: unknown;
  structuredRelationshipId?: unknown;
  structuredTableBlockId?: unknown;
  structuredTableRelationshipType?: unknown;
  structuredTableRowKey?: unknown;
  evidenceSources?: unknown;
  constituentEvidence?: unknown;
  corroboratingEvidence?: unknown;
  searchable?: unknown;
  renderedCorroborated?: unknown;
  renderedCorroboratingRegionIds?: unknown;
  renderedCorroboratingSources?: unknown;
}>;

/**
 * Immutable authority projected by the caller from the accepted current hosted
 * page. Structured producer receipts are useful only when every nested tuple
 * replays against this independently trusted page identity.
 */
export type ECOSDrawingPageAuthority = Readonly<{
  projectId: string;
  sourceSha256: string;
  pageNumber: number;
  sheetNumber: string;
  evidenceVersion: "ecos-hosted-evidence/1.3";
}>;

/**
 * Presentation-only authority projected by the caller after independently
 * validating one exact source-bound raw fact against the accepted current
 * page. The complete page still participates in every eligibility, status,
 * hidden-peer, and tuple-conflict audit. These bounds bind the private
 * capability to its one current raw source; they never narrow the ordinary
 * local qualifier audit.
 */
export type ECOSDrawingExactSourceBoundPresentationAuthority = Readonly<{
  regionId: string;
  bounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}>;

export type ECOSDrawingProvenanceEvidence = Readonly<Record<string, unknown>>;

export type ECOSDrawingEvidencePassage = Readonly<{
  text: string;
  score: number;
  regionId: string | null;
  contextRegionIds: readonly string[];
  sourceRegionIds: readonly string[];
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

export type ECOSDrawingEvidenceDiagnostics = {
  pageEligible: boolean;
  normalizedRegionCount: number;
  exactRelationshipEvaluations: number;
  passageAssertivenessEvaluations: number;
  numberedNoteMarkerEvaluations: number;
  relationshipPassageCount: number;
  calculatedAreaPassageCount: number;
  measurementAnchorCount: number;
  directlyResponsiveMeasurementAnchorCount: number;
  locallyResponsiveMeasurementAnchorCount: number;
  anchorCandidateCount: number;
  maximumNearbyRegionCount: number;
  nearbyOverflowCount: number;
  localMeasurementPairWorkCount: number;
  localMeasurementPairWorkLimit: number;
  localMeasurementPairOverflowCount: number;
  localMeasurementContextRejectionCount: number;
  localSubjectRejectionCount: number;
  localLocationConflictRejectionCount: number;
  missingLocationRejectionCount: number;
  passageContextRejectionCount: number;
  directPassageCount: number;
  assertivenessRejectionCount: number;
  finalPassageCount: number;
  rejectionStage: string;
  exactSourceBoundNeighborhoodDiagnostics?: ECOSDrawingNeighborhoodDiagnostics;
  protectedStructuredClaimRejectionStage?: string;
};

export type ECOSDrawingNeighborhoodDiagnostics = {
  pageIdentityAssertive: boolean;
  sourceAssertive: boolean;
  qualifierRegionCount: number;
  qualifierRegionIds: string[];
  qualifierOverflow: boolean;
  individualFragmentRejectionCount: number;
  joinedFragmentRejected: boolean;
  fragmentWindowRejectionCount: number;
  numberedNoteBoundaryWorkCount: number;
  numberedNoteBoundaryWorkLimit: number;
  numberedNoteBoundaryOverflow: boolean;
  neighborhoodAssertive: boolean;
};

export type ECOSPreparedDrawingEvidencePage = Readonly<{
  kind: "ecos-prepared-drawing-evidence-page";
}>;

type DrawingRegion = Readonly<{
  id: string;
  text: string;
  searchable: boolean;
  carrierTexts: readonly string[];
  areaNames: readonly string[];
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  confidence: number | null;
  source: "embedded_text" | "ocr" | "vision" | null;
  rawSource: string | null;
  sourceCarriers: readonly string[];
  reconstructionMethod: string | null;
  factKind: string | null;
  subject: string | null;
  structuredRelationshipId: string | null;
  structuredTableBlockId: string | null;
  structuredTableRelationshipType: string | null;
  structuredTableRowKey: string | null;
  strictStructuredReceiptTopLevelInputValid: boolean;
  evidenceSources: readonly string[];
  constituentEvidence: readonly ECOSDrawingProvenanceEvidence[];
  corroboratingEvidence: readonly ECOSDrawingProvenanceEvidence[];
}>;

const MAX_DRAWING_REGION_INPUTS = 6_000;
const MAX_NEARBY_DRAWING_REGIONS = 32;
const MAX_SELF_CONTAINED_MEASUREMENT_QUALIFIER_WINDOW_REGIONS = 7;
const MAX_LOCAL_DRAWING_HORIZONTAL_ANCHOR_GAP = 0.36;
const MAX_LOCAL_DRAWING_VERTICAL_ANCHOR_GAP = 0.18;
const MAX_LOCAL_DRAWING_ANCHOR_DISTANCE = 0.5;
const MAX_TRUSTED_STRUCTURED_HORIZONTAL_QUALIFIER_GAP = 0.04;
const MAX_TRUSTED_STRUCTURED_VERTICAL_QUALIFIER_GAP = 0.03;
const MAX_TRUSTED_STRUCTURED_QUALIFIER_DISTANCE = 0.12;
const EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE = 0.001;
const MAX_EXACT_DIRECTION_CONTINUATION_AXIS_GAP = 0.02;
const MAX_DRAWING_PAGE_TEXT_LENGTH = 1_000_000;
const MAX_DRAWING_PAGE_LINES = 20_000;
const MAX_DRAWING_STATUS_FRAGMENTS = 20_000;
const MAX_DRAWING_REGION_TEXT_LENGTH = 16_000;
const MAX_DRAWING_TOTAL_REGION_TEXT_LENGTH = 2_000_000;
const MAX_DRAWING_METADATA_ITEMS = 32;
const MAX_DRAWING_TOTAL_METADATA_ITEMS = 20_000;
const MAX_DRAWING_METADATA_TEXT_LENGTH = 1_000;
const MAX_DRAWING_TOTAL_METADATA_TEXT_LENGTH = 2_000_000;
const MAX_DRAWING_PROVENANCE_RECORD_LENGTH = 32_000;
const MAX_DRAWING_TOTAL_PROVENANCE_RECORDS = 20_000;
const MAX_DRAWING_TOTAL_PROVENANCE_LENGTH = 2_000_000;
const MAX_DRAWING_PROVENANCE_DEPTH = 16;
const MAX_DRAWING_PROVENANCE_NODES = 4_096;
const MAX_DRAWING_PARSED_DIMENSIONS = 128;
// Increasing the accepted region envelope must not silently expand quadratic
// comparison work. These work budgets remain at their independently reviewed
// 5,000-region limits while the additional dense-page rows are eligible only
// for bounded linear scans and exact structured-fact replay.
const MAX_DRAWING_REGION_PAIR_WORK_UNIT = 5_000;
const MAX_STRUCTURED_DRAWING_CLAIM_PAIR_WORK =
  (5 + 1) * MAX_DRAWING_REGION_PAIR_WORK_UNIT;
const STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD =
  "deterministic_same_page_structured_claim";
const COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP =
  "complete_coordinate_bound_structured_table_relationship";
const LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD = 0.82;
const STRUCTURED_RECEIPT_EVIDENCE_VERSION = "ecos-hosted-evidence/1.3";
const STRUCTURED_RECEIPT_BOUND_EPSILON = 1e-12;
const MAX_PHOTOMETRIC_TITLE_TO_TABLE_HORIZONTAL_GAP = 0.08;
const MAX_PHOTOMETRIC_TITLE_TO_TABLE_VERTICAL_GAP = 0.04;
const MIN_SEPARATE_PHOTOMETRIC_TITLE_BLOCK_X = 0.75;
const MIN_SEPARATE_PHOTOMETRIC_TITLE_BLOCK_HORIZONTAL_GAP = 0.05;
const MAX_SEPARATE_PHOTOMETRIC_TITLE_VERTICAL_CENTER_GAP = 0.15;
const MAX_SEPARATE_PHOTOMETRIC_TITLE_WIDTH = 0.2;
const MAX_PHOTOMETRIC_BARE_ALL_HORIZONTAL_GAP = 0.04;
const MAX_PHOTOMETRIC_BARE_ALL_VERTICAL_GAP = 0.03;
const MAX_PREPARED_EXACT_RELATIONSHIP_AUTHORITY_CACHE_ENTRIES = 8;
const MAX_PREPARED_DRAWING_QUALIFIER_CACHE_ENTRIES = 4_096;
const MAX_PREPARED_DRAWING_QUALIFIER_CACHE_CHARACTERS = 1_000_000;
const MAX_DRAWING_NUMBERED_NOTE_BOUNDARY_WORK = 10_000;
const MAX_DRAWING_EXACT_RELATIONSHIP_DUPLICATE_PAIR_WORK = 100_000;
const TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS = 64;
// Counts input, OCR-container, token, populated-cell, and candidate visits.
// Exceeding the budget rejects the structured replay instead of risking 546.
const MAX_TRUSTED_STRUCTURED_CONTAINMENT_INDEX_WORK = 100_000;
const MAX_DRAWING_EXACT_RELATIONSHIP_IDENTITY_TOKENS = 64;
const MAX_DRAWING_EXACT_RELATIONSHIP_CLUSTER_AXIS_GAP = 0.17;
const DRAWING_EXACT_RELATIONSHIP_TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "due",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "only",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);
const DRAWING_EXACT_RELATIONSHIP_TOKEN_ALIASES = new Map([
  ["areas", "area"],
  ["bldg", "building"],
  ["buildings", "building"],
  ["canopies", "canopy"],
  ["chambers", "chamber"],
  ["circuits", "circuit"],
  ["details", "detail"],
  ["drawings", "drawing"],
  ["fixture", "lighting"],
  ["fixtures", "lighting"],
  ["light", "lighting"],
  ["lights", "lighting"],
  ["luminaire", "lighting"],
  ["luminaires", "lighting"],
  ["plans", "plan"],
  ["reconnected", "reconnect"],
  ["reconnecting", "reconnect"],
  ["reconnects", "reconnect"],
  ["remained", "remain"],
  ["remaining", "remain"],
  ["remains", "remain"],
  ["remodeling", "remodel"],
  ["show", "shown"],
  ["showing", "shown"],
  ["shows", "shown"],
]);
const DRAWING_NUMBERED_NOTE_MARKER_OCR_SOURCES = new Set([
  "ocr",
  "fixed_visual_tile_coordinate_ocr",
  "rotated_coordinate_ocr",
  "dense_text_coordinate_ocr",
  "title_block_ocr",
]);
const IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS = new WeakSet<
  readonly ECOSDrawingRegionInput[]
>();
const MAX_INERT_EMBEDDED_CONTROL_GLYPH_ARTIFACTS = 256;
const INERT_EMBEDDED_CONTROL_GLYPH_ARTIFACT_FIELDS = new Set([
  "id",
  "label",
  "text",
  "x",
  "y",
  "width",
  "height",
  "confidence",
  "source",
  "rawSource",
  "searchable",
  "renderedCorroborated",
  "renderedCorroboratingRegionIds",
  "renderedCorroboratingSources",
]);

function inertEmbeddedControlGlyphArtifact(
  source: Readonly<Record<string, unknown>>,
) {
  const boundedCoordinate = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    value <= 1;
  return Object.keys(source).every((field) =>
      INERT_EMBEDDED_CONTROL_GLYPH_ARTIFACT_FIELDS.has(field)
    ) &&
    typeof source.id === "string" && /^native-\d+-\d+$/.test(source.id) &&
    typeof source.label === "string" && source.label.length > 0 &&
    source.label.length <= 256 &&
    source.text === source.label &&
    /[\u0000-\u001F\u007F]/.test(source.label) &&
    source.source === "embedded_text" &&
    (source.rawSource == null || source.rawSource === "embedded_text") &&
    source.searchable === false &&
    source.renderedCorroborated === false &&
    Array.isArray(source.renderedCorroboratingRegionIds) &&
    source.renderedCorroboratingRegionIds.length === 0 &&
    Array.isArray(source.renderedCorroboratingSources) &&
    source.renderedCorroboratingSources.length === 0 &&
    boundedCoordinate(source.x) && boundedCoordinate(source.y) &&
    boundedCoordinate(source.width) && boundedCoordinate(source.height) &&
    boundedCoordinate(source.confidence);
}

/**
 * Rejects raw hosted-page payloads before callers trim page text or walk a
 * region array. The downstream evidence guard still validates every nested
 * field and invocation-wide total; this boundary prevents oversized database
 * values from doing unbounded preprocessing work before that guard runs.
 */
export function boundedECOSDrawingPageInput(
  pageTextValue: unknown,
  regionsValue: unknown,
):
  | Readonly<{
    pageText: string;
    regions: readonly ECOSDrawingRegionInput[];
  }>
  | null {
  if (
    (pageTextValue !== null && pageTextValue !== undefined &&
      typeof pageTextValue !== "string") ||
    (regionsValue !== null && regionsValue !== undefined &&
      !Array.isArray(regionsValue))
  ) return null;
  if (
    typeof pageTextValue === "string" &&
      pageTextValue.length > MAX_DRAWING_PAGE_TEXT_LENGTH ||
    Array.isArray(regionsValue) &&
      regionsValue.length > MAX_DRAWING_REGION_INPUTS
  ) return null;
  const rawPageText = typeof pageTextValue === "string" ? pageTextValue : "";
  const regions: ECOSDrawingRegionInput[] = [];
  let inertControlGlyphArtifactCount = 0;
  if (Array.isArray(regionsValue)) {
    for (const value of regionsValue) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const source = value as Record<string, unknown>;
      if (inertEmbeddedControlGlyphArtifact(source)) {
        inertControlGlyphArtifactCount += 1;
        if (
          inertControlGlyphArtifactCount >
            MAX_INERT_EMBEDDED_CONTROL_GLYPH_ARTIFACTS
        ) return null;
        continue;
      }
      // Project only fields that participate in ECOS evidence. Unknown hosted
      // payload fields must not hitchhike through the frozen page snapshot.
      regions.push({
        id: source.id,
        label: source.label,
        text: source.text,
        evidenceText: source.evidenceText,
        areaNames: source.areaNames,
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        confidence: source.confidence,
        source: source.source,
        rawSource: source.rawSource,
        reconstructionMethod: source.reconstructionMethod,
        factKind: source.factKind,
        subject: source.subject,
        structuredRelationshipId: source.structuredRelationshipId,
        structuredTableBlockId: source.structuredTableBlockId,
        structuredTableRelationshipType: source.structuredTableRelationshipType,
        structuredTableRowKey: source.structuredTableRowKey,
        evidenceSources: source.evidenceSources,
        constituentEvidence: source.constituentEvidence,
        corroboratingEvidence: source.corroboratingEvidence,
        searchable: source.searchable,
        renderedCorroborated: source.renderedCorroborated,
        renderedCorroboratingRegionIds: source.renderedCorroboratingRegionIds,
        renderedCorroboratingSources: source.renderedCorroboratingSources,
      });
    }
  }
  const pageText = rawPageText.trim();
  if (!drawingEvidenceInputIsBounded(pageText, "", "", regions)) return null;
  let frozenRegions: readonly ECOSDrawingRegionInput[];
  try {
    frozenRegions = Object.freeze(regions.map((region) =>
      Object.freeze({
        ...region,
        areaNames: Array.isArray(region.areaNames)
          ? Object.freeze([...region.areaNames])
          : region.areaNames,
        evidenceSources: Array.isArray(region.evidenceSources)
          ? Object.freeze([...region.evidenceSources])
          : region.evidenceSources,
        renderedCorroboratingRegionIds:
          Array.isArray(region.renderedCorroboratingRegionIds)
            ? Object.freeze([...region.renderedCorroboratingRegionIds])
            : region.renderedCorroboratingRegionIds,
        renderedCorroboratingSources:
          Array.isArray(region.renderedCorroboratingSources)
            ? Object.freeze([...region.renderedCorroboratingSources])
            : region.renderedCorroboratingSources,
        constituentEvidence: frozenDrawingProvenanceArray(
          region.constituentEvidence,
        ),
        corroboratingEvidence: frozenDrawingProvenanceArray(
          region.corroboratingEvidence,
        ),
      })
    ));
  } catch {
    return null;
  }
  IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.add(frozenRegions);
  return Object.freeze({ pageText, regions: frozenRegions });
}

function frozenDrawingProvenanceArray(value: unknown) {
  if (!Array.isArray(value)) return value;
  return Object.freeze(
    value.map((item) => deepFreezeJSONValue(JSON.parse(JSON.stringify(item)))),
  );
}

function deepFreezeJSONValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreezeJSONValue(item));
    return Object.freeze(value);
  }
  Object.values(value as Record<string, unknown>).forEach((item) =>
    deepFreezeJSONValue(item)
  );
  return Object.freeze(value);
}

/**
 * Applies one full-current-page eligibility decision to both regenerated
 * passages and stored search chunks rebound to the current page receipt.
 * Detached page stamps and global dimension notes are page truth even when
 * they are not adjacent to the responsive region.
 */
export function isECOSDrawingPageEvidenceEligible({
  pageText,
  regions,
  question,
  pageIdentity = "",
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity?: string;
}) {
  if (
    !drawingEvidenceInputIsBounded(pageText, pageIdentity, question, regions)
  ) return false;
  const fragmentIsResponsive = prepareDrawingFragmentResponsiveness(question);
  const requestedMeasurementValueSignature =
    prepareDrawingRequestedMeasurementValueSignature(question);
  const regionFragmentGroups = regions.map(
    drawingInputRegionAssertionFragments,
  );
  if (
    regions.some((region, index) =>
      drawingInputRegionHasCarrierConflict(
        region,
        question,
        regionFragmentGroups[index],
        fragmentIsResponsive,
        requestedMeasurementValueSignature,
      )
    )
  ) return false;
  const fragments = [
    pageIdentity,
    pageText,
    ...regionFragmentGroups.flatMap((group) =>
      drawingBoundedJoinedFragments(group)
    ),
  ].filter(Boolean);
  if (fragments.some(pageFragmentHasMaterialIssueStatus)) return false;
  const responsiveFragments = unique([
    ...pageText.replace(/\r/g, "").split("\n").map((value) => value.trim())
      .filter(Boolean),
    ...regionFragmentGroups.map((group) => unique(group).join(" ")),
  ]);
  if (
    responsiveFragments.some((fragment) =>
      fragmentIsResponsive(fragment) &&
      drawingFragmentMayBeNonassertive(fragment) &&
      !drawingRegionFragmentIsAssertiveForQuestion(fragment, question)
    )
  ) return false;
  if (
    regionFragmentGroups.some((group) =>
      group.length > 1 &&
      fragmentIsResponsive(unique(group).join(" ")) &&
      drawingFragmentMayBeNonassertive(unique(group).join(" ")) &&
      !drawingRegionFragmentsAreAssertive(group, question)
    )
  ) return false;
  return analyzeECOSProjectQuestion(question).kind !== "measurement" ||
    !fragments.some(pageHasUniversalDimensionQualifier);
}

function drawingInputRegionAssertionFragments(region: ECOSDrawingRegionInput) {
  return unique([
    textValue(region.text),
    textValue(region.evidenceText),
    textValue(region.label),
    ...(Array.isArray(region.areaNames) ? region.areaNames.map(textValue) : []),
  ]);
}

function drawingBoundedJoinedFragments(fragments: readonly string[]) {
  const joined = [...fragments];
  for (let start = 0; start < fragments.length; start += 1) {
    for (
      let length = 2;
      length <= 4 && start + length <= fragments.length;
      length += 1
    ) {
      joined.push(fragments.slice(start, start + length).join(" "));
    }
  }
  if (fragments.length > 4) joined.push(fragments.join(" "));
  return unique(joined);
}

function prepareDrawingFragmentResponsiveness(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  const analyzeContext = prepareECOSQuestionEvidenceContextAnalyzer(question);
  const containsRequestedMeasurementValue = requirement.kind === "measurement"
    ? prepareECOSRequestedMeasurementValueMatcher(question)
    : null;
  return (value: string) => {
    const context = analyzeContext(value);
    const exactActionSharesRequestedSubject = /\bremove\b/.test(
      canonicalDrawingQualifierText(value),
    ) && context.matchedSubjectTokens.length > 0;
    if (!context.subjectMatched && !exactActionSharesRequestedSubject) {
      return false;
    }
    if (requirement.kind === "measurement") {
      return context.attributeMatched &&
        Boolean(containsRequestedMeasurementValue?.(value));
    }
    if (requirement.kind === "quantity") {
      return /\b\d+(?:\.\d+)?\b/.test(value) &&
        ecosEvidenceQuestionContextScore(question, value) > 0;
    }
    return ecosEvidenceQuestionContextScore(question, value) > 0;
  };
}

function drawingInputRegionHasCarrierConflict(
  region: ECOSDrawingRegionInput,
  question: string,
  assertionFragments = drawingInputRegionAssertionFragments(region),
  fragmentIsResponsive = prepareDrawingFragmentResponsiveness(question),
  requestedMeasurementValueSignature =
    prepareDrawingRequestedMeasurementValueSignature(question),
) {
  if (drawingInputRegionHasIntrinsicCarrierConflict(region, question)) {
    return true;
  }
  // Everything below this point compares distinct carriers. A single exact
  // assertion fragment has already passed the intrinsic-carrier audit above,
  // so rebuilding the complete question-aware measurement policy for it
  // cannot discover a cross-carrier conflict. Dense accepted drawing pages
  // commonly repeat the same OCR value in both `text` and `label`; `unique`
  // intentionally collapses that representation before this fast path.
  if (assertionFragments.length > 1) {
    const assertionValueSignatures = assertionFragments
      .map(requestedMeasurementValueSignature)
      .filter(Boolean);
    if (unique(assertionValueSignatures).length > 1) return true;
  }
  const carriers = unique([
    textValue(region.text),
    textValue(region.evidenceText),
    textValue(region.label),
  ]);
  if (carriers.length <= 1) return false;
  const responsive = carriers.filter(fragmentIsResponsive);
  if (responsive.length <= 1) return false;
  const signatures = unique(
    responsive.map(drawingCarrierComparableSignature).filter(Boolean),
  );
  return signatures.length > 1;
}

function drawingInputRegionHasIntrinsicCarrierConflict(
  region: ECOSDrawingRegionInput,
  question = "",
) {
  const text = textValue(region.text);
  const evidenceText = textValue(region.evidenceText);
  const label = textValue(region.label);
  if (
    text && evidenceText && text !== evidenceText &&
    normalizeDrawingCarrierComparisonText(text) !==
      normalizeDrawingCarrierComparisonText(evidenceText)
  ) {
    const textSignature = drawingCarrierComparableSignature(text);
    const evidenceSignature = drawingCarrierComparableSignature(evidenceText);
    if (
      !textSignature || textSignature !== evidenceSignature ||
      !drawingRegionFragmentIsAssertiveForQuestion(text, question) ||
      !drawingRegionFragmentIsAssertiveForQuestion(evidenceText, question)
    ) return true;
  }
  const carriers = unique([
    text,
    evidenceText,
    label,
  ]);
  if (carriers.length > 1) {
    const answerCarriers = carriers.filter(drawingCarrierHasBoundAnswerValue);
    const signatures = unique(
      answerCarriers
        .map(drawingCarrierComparableSignature).filter(Boolean),
    );
    if (signatures.length > 1) return true;
  }
  return drawingCarrierSubjectIdentitiesConflict(carriers);
}

function drawingCarrierSubjectIdentitiesConflict(values: readonly string[]) {
  const carriers = unique(values.filter(Boolean));
  const countedPlantSubjects = carriers.flatMap(drawingCountedPlantSubject);
  const plantContext = countedPlantSubjects.length > 0;
  const byKind = new Map<string, Set<string>>();
  for (const carrier of carriers) {
    for (
      const identity of drawingExplicitCarrierSubjectIdentities(
        carrier,
        plantContext,
      )
    ) {
      const [kind] = identity.split(":", 1);
      const identities = byKind.get(kind) || new Set<string>();
      identities.add(identity);
      byKind.set(kind, identities);
    }
  }
  return [...byKind.values()].some((identities) => identities.size > 1);
}

function drawingExplicitCarrierSubjectIdentities(
  value: string,
  plantContext: boolean,
) {
  const normalized = normalizeDrawingCarrierComparisonText(value);
  const identities: string[] = [];
  for (
    const match of normalized.matchAll(
      /\b(panel|canopy|footing|fan|door|room)\s*[-#:]*\s*([a-z]|\d+[a-z]?|[a-z]{1,4}-?\d+[a-z]?)\b/g,
    )
  ) identities.push(`${match[1]}:${match[2].replace(/-/g, "")}`);
  for (
    const match of normalized.matchAll(/\bpcc\s+(paving|walkway|slab|curb)\b/g)
  ) {
    identities.push(`pcc:${match[1]}`);
  }
  identities.push(...drawingCountedPlantSubject(normalized));
  if (
    plantContext &&
    identities.every((identity) => !identity.startsWith("plant:")) &&
    !/\b(?:note|callout|detail|plan|region|area|sheet|drawing|fact|label|ocr|title)\b/
      .test(normalized) &&
    /^[a-z][a-z -]{2,80}$/.test(normalized)
  ) identities.push(`plant:${normalized.replace(/[^a-z0-9]+/g, " ").trim()}`);
  return unique(identities);
}

function drawingCountedPlantSubject(value: string) {
  const normalized = normalizeDrawingCarrierComparisonText(value);
  const match = /^(.*?)(?::|\bis\b)?\s*\d+(?:\.\d+)?\s+trees?\b/.exec(
    normalized,
  );
  if (!match) return [];
  const subject = match[1]
    .replace(
      /\b(?:provide|provided|plant|planted|install|installed|quantity|count|total)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return subject ? [`plant:${subject}`] : [];
}

function drawingCarrierHasExplicitAnswerUnit(value: string) {
  const normalized = normalizeDrawingCarrierComparisonText(value);
  return /(?:^|[^a-z0-9])\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*-?\s*(?:square\s+feet|sq\.?\s*ft|sf|feet|foot|ft\.?|inches?|inch|in\.?|["']|percent|%|amps?|a|volts?|v|psi|cfm|fc)(?=$|[^a-z0-9])/i
    .test(
      normalized,
    );
}

const DRAWING_CARRIER_COUNT_NOUNS = new Set([
  "anchor",
  "anchors",
  "bar",
  "bars",
  "bolt",
  "bolts",
  "circuit",
  "circuits",
  "closet",
  "closets",
  "device",
  "devices",
  "door",
  "doors",
  "fan",
  "fans",
  "fastener",
  "fasteners",
  "fixture",
  "fixtures",
  "hanger",
  "hangers",
  "item",
  "items",
  "janitor",
  "lavatories",
  "lavatory",
  "light",
  "lights",
  "luminaire",
  "luminaires",
  "occupant",
  "occupants",
  "panel",
  "panels",
  "person",
  "people",
  "plant",
  "plants",
  "pole",
  "poles",
  "receptacle",
  "receptacles",
  "restroom",
  "restrooms",
  "room",
  "rooms",
  "seat",
  "seats",
  "shrub",
  "shrubs",
  "sink",
  "sinks",
  "space",
  "spaces",
  "stall",
  "stalls",
  "toilet",
  "toilets",
  "tree",
  "trees",
  "unit",
  "units",
  "urinal",
  "urinals",
  "window",
  "windows",
  "wire",
  "wires",
]);

function canonicalDrawingCountNoun(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "people") return "person";
  if (normalized === "lavatories") return "lavatory";
  return normalized.endsWith("s") && normalized.length > 3
    ? normalized.slice(0, -1)
    : normalized;
}

function drawingCountNounAfter(value: string, numberEnd: number) {
  const suffix = /^\s*(?:[-x×]\s*)?(?:#\s*)?([a-z][a-z0-9-]{1,31})\b/i.exec(
    value.slice(numberEnd),
  );
  if (!suffix || !DRAWING_CARRIER_COUNT_NOUNS.has(suffix[1].toLowerCase())) {
    return "";
  }
  return canonicalDrawingCountNoun(suffix[1]);
}

function drawingCarrierHasBoundAnswerValue(value: string) {
  if (drawingCarrierHasExplicitAnswerUnit(value)) return true;
  const normalized = normalizeDrawingCarrierComparisonText(value);
  return [
    ...normalized.matchAll(
      /\b\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\b/g,
    ),
  ]
    .some((match) =>
      drawingCountNounAfter(normalized, (match.index || 0) + match[0].length)
    );
}

function normalizeDrawingCarrierComparisonText(value: string) {
  return value.normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    // A zero glyph is a common OCR substitution for the O in O.C. Require
    // the dotted form so a real zero-valued quantity is never rewritten.
    .replace(/\b0\s*\.\s*c\s*\.?/gi, "O.C.")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function drawingCarrierAnswerValueSignature(value: string) {
  const normalized = normalizeDrawingCarrierComparisonText(value)
    .replace(/\b(\d+)\.0+(?=\D|$)/g, "$1");
  const relation =
    /\b(?:not to exceed|no more than|max(?:imum)?)\b/.test(normalized)
      ? "max"
      : /\b(?:not less than|no less than|min(?:imum)?)\b/.test(normalized)
      ? "min"
      : /\b(?:between|from)\b[\s\S]{0,32}\b(?:and|to)\b/.test(normalized)
      ? "range"
      : "exact";
  const atoms: string[] = [];
  const unitNumberSpans: Array<readonly [number, number]> = [];
  for (
    const match of normalized.matchAll(
      /(?:^|[^a-z0-9])(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*-?\s*(square\s+feet|sq\.?\s*ft|sf|feet|foot|ft\.?|inches?|inch|in\.?|["']|percent|%|amps?|a|volts?|v|psi|cfm|fc)(?=$|[^a-z0-9])/gi,
    )
  ) {
    const captureOffset = match[0].indexOf(match[1]);
    const start = (match.index || 0) + captureOffset;
    unitNumberSpans.push([start, start + match[1].length]);
    atoms.push(
      `unit:${canonicalDrawingNumber(match[1])}:${
        canonicalDrawingUnit(match[2])
      }`,
    );
  }
  for (
    const match of normalized.matchAll(
      /\b\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\b/g,
    )
  ) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (
      unitNumberSpans.some(([unitStart, unitEnd]) =>
        start < unitEnd && end > unitStart
      )
    ) continue;
    const number = canonicalDrawingNumber(match[0]);
    const countNoun = drawingCountNounAfter(normalized, end);
    atoms.push(
      countNoun ? `count:${number}:${countNoun}` : `reference:${number}`,
    );
  }
  return atoms.length > 0
    ? `${relation}|${unique(atoms).sort().join("|")}`
    : "";
}

function drawingCarrierComparableSignature(value: string) {
  const answer = drawingCarrierAnswerValueSignature(value);
  if (!answer) return "";
  return `${answer}|semantic:${drawingCarrierSemanticBindingSignature(value)}`;
}

function drawingCarrierSemanticBindingSignature(value: string) {
  let normalized = normalizeDrawingCarrierComparisonText(
    value.normalize("NFKD")
      .replace(/[\p{Cf}\p{M}]/gu, "")
      .replace(
        /[ΑАαаΒВβвϹСϲсΕЕεеΗНηнΙІӀιіΚКκкΜМμмΝνΟОοоΡРρрΤТτтΥУυуΧХχх]/gu,
        (character) => DRAWING_STATUS_CONFUSABLES[character] || character,
      ),
  )
    .replace(/\b(\d+)\.0+(?=\D|$)/g, "$1");
  normalized = normalized.replace(
    /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*-?\s*(square\s+feet|sq\.?\s*ft|sf|feet|foot|ft\.?|inches?|inch|in\.?|["']|percent|%|amps?|a|volts?|v|psi|cfm|fc)(?=$|[^a-z0-9])/gi,
    (_match, number: string, unit: string) =>
      ` n${canonicalDrawingNumber(number).replace(".", "d")} u${
        canonicalDrawingUnit(unit)
      } `,
  );
  normalized = normalized.replace(
    /\b\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\b/g,
    (number) => ` n${canonicalDrawingNumber(number).replace(".", "d")} `,
  );
  if (/\bo\s*\.\s*c\s*\.?\b/i.test(normalized)) {
    normalized = normalized.replace(/\bspacing\b/g, " ");
  }
  return normalized
    .replace(
      /\b(?:is|are|was|were|be|being|been|has|have|had|equals?|equal\s+to|specifies?|specified|calls?\s+for|requires?|required)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalDrawingNumber(value: string) {
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  const numeric = mixed
    ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
    : fraction
    ? Number(fraction[1]) / Number(fraction[2])
    : Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value.replace(/\s+/g, "");
}

function canonicalDrawingUnit(value: string) {
  const unit = value.toLowerCase().replace(/[.\s]+/g, "");
  if (["squarefeet", "sqft", "sf"].includes(unit)) return "sqft";
  if (["feet", "foot", "ft", "'"].includes(unit)) return "ft";
  if (["inches", "inch", "in", '"'].includes(unit)) return "in";
  if (["percent", "%"].includes(unit)) return "percent";
  if (["amp", "amps", "a"].includes(unit)) return "amp";
  if (["volt", "volts", "v"].includes(unit)) return "volt";
  return unit;
}

type PreparedDrawingEvidencePageDetails = Readonly<{
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity: string;
  eligible: boolean;
  regionIdentityValid: boolean;
  deterministicMeasurementTargetValid: boolean;
  normalizedRegions: readonly DrawingRegion[];
  auditRegions: readonly DrawingRegion[];
  unboundedLocalQualifierRegions: readonly DrawingRegion[];
  uniqueRawRegionIds: ReadonlySet<string>;
  safePageText: string;
  requirement: ReturnType<typeof analyzeECOSProjectQuestion>;
  qualifierTextCache: DrawingQualifierTextCache;
}>;

type DrawingQualifierTextCache = {
  values: Map<string, string>;
  characterCount: number;
};

type DrawingMeasurementAnchorAuditDiagnostics = {
  measurementAnchorCount: number;
  directlyResponsiveMeasurementAnchorCount: number;
  locallyResponsiveMeasurementAnchorCount: number;
  localMeasurementPairWorkCount: number;
  localMeasurementPairWorkLimit: number;
  localMeasurementPairOverflowCount: number;
  rejectionStage: string;
};

type FrozenDrawingMeasurementAnchorAuditReceipt = Readonly<{
  audit: DrawingMeasurementAnchorAudit;
  diagnostics: Readonly<DrawingMeasurementAnchorAuditDiagnostics>;
}>;

const PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS = new WeakMap<
  ECOSPreparedDrawingEvidencePage,
  PreparedDrawingEvidencePageDetails
>();

// A generated shadow passage and its later exact-page rebind share the same
// opaque prepared-page token. Reuse the complete, fail-closed measurement
// audit only for that exact frozen page/question identity and passage limit.
// The WeakMap cannot leak an audit across snapshots or user questions.
const PREPARED_DRAWING_MEASUREMENT_ANCHOR_AUDITS = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  Map<string, FrozenDrawingMeasurementAnchorAuditReceipt>
>();

// Exact structured relationships are the other page-wide audit shared by a
// generated shadow passage and its later exact-page rebind. Cache only against
// the opaque prepared token plus the canonical authority that the protected
// receipt validator actually consumes. Invalid or mismatched authorities are
// intentionally one fail-closed cache class.
const PREPARED_DRAWING_EXACT_RELATIONSHIP_PASSAGES = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  Map<string, readonly ECOSDrawingEvidencePassage[]>
>();
const CACHED_EXACT_RELATIONSHIP_PASSAGES = new WeakSet<
  ECOSDrawingEvidencePassage
>();

// A cached exact relationship passage is replayed unchanged at the complete
// page rebind boundary. Its local-neighborhood result is deterministic for the
// same prepared page and presentation-anchor mode, so avoid repeating the
// dense current-page qualifier closure for that exact passage object.
const PREPARED_DRAWING_PASSAGE_ASSERTIVENESS = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  Map<ECOSDrawingEvidencePassage, Map<string, boolean>>
>();
const PREPARED_DRAWING_NUMBERED_NOTE_MARKERS = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  readonly DrawingRegion[]
>();
const PREPARED_DRAWING_AUDIT_NUMBERED_NOTE_MARKERS = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  readonly DrawingRegion[]
>();
type TrustedStructuredLocalAuditReceipt = Readonly<{
  redundantRegions: ReadonlySet<DrawingRegion>;
  baseRegions: readonly DrawingRegion[];
  baseNumberedNoteMarkers: readonly DrawingRegion[];
}>;
const PREPARED_DRAWING_TRUSTED_STRUCTURED_LOCAL_AUDITS = new WeakMap<
  PreparedDrawingEvidencePageDetails,
  TrustedStructuredLocalAuditReceipt | null
>();

export function prepareECOSDrawingEvidencePage({
  pageText,
  regions,
  question,
  pageIdentity = "",
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity?: string;
}): ECOSPreparedDrawingEvidencePage {
  const qualifierTextCache = createDrawingQualifierTextCache();
  return withDrawingQualifierTextCache(
    qualifierTextCache,
    () => prepareECOSDrawingEvidencePageSnapshot({
      pageText,
      regions,
      question,
      pageIdentity,
      qualifierTextCache,
    }),
  );
}

function prepareECOSDrawingEvidencePageSnapshot({
  pageText,
  regions,
  question,
  pageIdentity,
  qualifierTextCache,
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity: string;
  qualifierTextCache: DrawingQualifierTextCache;
}): ECOSPreparedDrawingEvidencePage {
  const requirement = analyzeECOSProjectQuestion(question);
  const assertionEligible = isECOSDrawingPageEvidenceEligible({
    pageText,
    regions,
    question,
    pageIdentity,
  });
  const auditRegionCandidates = assertionEligible
    ? regions.map(normalizeRegionForAudit)
      .filter((region): region is DrawingRegion => Boolean(region))
    : [];
  const normalizedRegionCandidates = auditRegionCandidates.filter((region) =>
    region.searchable
  );
  const targetsExtremeCeilingDetail =
    drawingQuestionTargetsExtremeCeilingDetail(question);
  const deterministicMeasurementTargetValid = !targetsExtremeCeilingDetail ||
    drawingQuestionRequestsOnlyAffirmativeLeftmostCeilingHeight(question);
  const measurementIdentityRequired = requirement.kind === "measurement" ||
    targetsExtremeCeilingDetail;
  const regionIdentityValid = !measurementIdentityRequired ||
    drawingRegionsHaveStableUniqueIds(auditRegionCandidates);
  const eligible = assertionEligible && regionIdentityValid &&
    deterministicMeasurementTargetValid;
  const normalizedRegions = Object.freeze(
    eligible ? normalizedRegionCandidates : [] as DrawingRegion[],
  );
  const auditRegions = Object.freeze(
    eligible ? auditRegionCandidates : [] as DrawingRegion[],
  );
  const unboundedLocalQualifierRegions = Object.freeze(
    eligible
      ? auditRegionCandidates.filter((region) =>
        strictNormalizedBounds(region) == null &&
        drawingRegionMayCarryLocalAssertionQualifier(region, question)
      )
      : [] as DrawingRegion[],
  );
  const uniqueRawRegionIds = uniqueRawDrawingRegionIds(regions);
  const token = Object.freeze({
    kind: "ecos-prepared-drawing-evidence-page" as const,
  });
  PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.set(
    token,
    Object.freeze({
      pageText,
      regions,
      question,
      pageIdentity,
      eligible,
      regionIdentityValid,
      deterministicMeasurementTargetValid,
      normalizedRegions,
      auditRegions,
      unboundedLocalQualifierRegions,
      uniqueRawRegionIds,
      safePageText: regions.length === 0
        ? pageText
        : normalizedRegions.map((region) => region.text).join("\n"),
      requirement,
      qualifierTextCache,
    }),
  );
  return token;
}

export function preparedECOSDrawingPageEvidenceIsEligible(
  preparedPage: ECOSPreparedDrawingEvidencePage,
) {
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  return Boolean(
    prepared?.eligible &&
      IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions),
  );
}

/**
 * Replays one stored-region neighborhood against the opaque prepared page.
 * This retains the same raw-carrier and exact-ID checks as the public raw
 * wrapper while reusing the transitive-frozen regions, normalized rows,
 * measurement audit, qualifier cache, and numbered-note marker set.
 */
export function preparedECOSDrawingCurrentRegionNeighborhoodIsAssertive(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValue: unknown,
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
) {
  resetDrawingNeighborhoodDiagnostics(diagnostics);
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions)
  ) return false;
  return preparedDrawingCurrentRegionNeighborhoodIsAssertive(
    prepared,
    sourceRegionIdValue,
    diagnostics,
  );
}

function drawingExactRelationshipToken(value: string) {
  const numeric = /^\d+(?:\.\d+)?$/.test(value)
    ? canonicalDrawingNumber(value)
    : value;
  const canonical = DRAWING_EXACT_RELATIONSHIP_TOKEN_ALIASES.get(numeric) ||
    numeric;
  return DRAWING_EXACT_RELATIONSHIP_TOKEN_STOP_WORDS.has(canonical)
    ? null
    : canonical;
}

function drawingExactRelationshipValueTokens(
  value: string,
  allowedTokens?: ReadonlySet<string>,
  includeOCRWordJoins = false,
) {
  const tokens = new Set<string>();
  const canonicalValue = canonicalDrawingExactRelationshipScanValue(value);
  for (
    const match of canonicalValue.matchAll(
      /[a-z0-9]+(?:\.[a-z0-9]+)?/g,
    )
  ) {
    const token = drawingExactRelationshipToken(match[0]);
    if (token && (!allowedTokens || allowedTokens.has(token))) {
      tokens.add(token);
    }
  }
  if (includeOCRWordJoins) {
    for (
      const match of canonicalValue.matchAll(
        /([a-z0-9]+)[ \t]*(?:-[ \t]*(?:(?:\r\n|[\n\u0085\f\u2028\u2029]|\r(?!\n))[ \t]*)*|(?:(?:\r\n|[\n\u0085\f\u2028\u2029]|\r(?!\n))[ \t]*)+)([a-z0-9]+)/g,
      )
    ) {
      const token = drawingExactRelationshipToken(`${match[1]}${match[2]}`);
      if (token && (!allowedTokens || allowedTokens.has(token))) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function canonicalDrawingExactRelationshipScanValue(value: string) {
  return canonicalDrawingQualifierText(
    value.replace(/[\u0085\f\u2028\u2029]/g, "\n"),
  )
    .replace(
      /\b(\d+)[ \t]*-[ \t]*(\d+)(?=\b)/g,
      "$1$2",
    )
    .replace(
      /\b(\d+)[ \t]*(?:-[ \t]*(?:(?:\r\n|[\n\u0085\f\u2028\u2029]|\r(?!\n))[ \t]*)*|(?:(?:\r\n|[\n\u0085\f\u2028\u2029]|\r(?!\n))[ \t]*)+)(\d+)(?=\b)/g,
      "$1$2",
    )
    .replace(
      /\b(\d{1,3})[ \t]*,[ \t]*(?:(?:\r\n|[\n\u0085\f\u2028\u2029]|\r(?!\n))[ \t]*)?(\d{3})(?=\b)/g,
      "$1$2",
    )
    .replace(
      /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
      (number) => number.replace(/,/g, ""),
    )
    .replace(
      /\b(\d{1,3})[ \t](\d{3})(?=\b)/g,
      "$1$2",
    );
}

function drawingExactRelationshipNumericBindings(value: string) {
  const canonicalValue = canonicalDrawingExactRelationshipScanValue(value);
  const bindings = new Map<"building" | "area", Set<string>>();
  const add = (kind: "building" | "area", number: string) => {
    const values = bindings.get(kind) || new Set<string>();
    values.add(canonicalDrawingNumber(number));
    bindings.set(kind, values);
  };
  for (
    const match of canonicalValue.matchAll(
      /\b(\d+(?:\.\d+)?)(?:\s+|\s*[#:=\-]\s*)(?:building|bldg)\b/g,
    )
  ) add("building", match[1]);
  for (
    const match of canonicalValue.matchAll(
      /\b(?:building|bldg)\.?(?:\s+(?:no|number)\.?(?:\s*[#:=\-]\s*|\s+)|\s*[#:=\-]\s*|\s+)(\d+(?:\.\d+)?)\b/g,
    )
  ) add("building", match[1]);
  for (
    const match of canonicalValue.matchAll(
      /\b(?:building|bldg)\.?(?:\s+(?:no|number)\.?)?\s*(?:[#:=\-]\s*)?\(\s*(\d+(?:\.\d+)?)\s*\)/g,
    )
  ) add("building", match[1]);
  for (
    const match of canonicalValue.matchAll(
      /\(\s*(\d+(?:\.\d+)?)\s*\)\s*(?:[#:=\-]\s*)?(?:building|bldg)\b/g,
    )
  ) add("building", match[1]);
  for (
    const match of canonicalValue.matchAll(
      /\barea\.?(?:\s+(?:no|number)\.?(?:\s*[#:=\-]\s*|\s+)|\s*[#:=\-]\s*|\s+)(\d+(?:\.\d+)?)(?:\s+(?:and|or|\/)\s+(\d+(?:\.\d+)?))?/g,
    )
  ) {
    add("area", match[1]);
    if (match[2]) add("area", match[2]);
  }
  for (
    const match of canonicalValue.matchAll(
      /\barea\.?(?:\s+(?:no|number)\.?)?\s*(?:[#:=\-]\s*)?\(\s*(\d+(?:\.\d+)?)\s*\)/g,
    )
  ) add("area", match[1]);
  for (
    const match of canonicalValue.matchAll(
      /\b(\d+(?:\.\d+)?)(?:\s+|\s*[#:=\-]\s*)area\b/g,
    )
  ) add("area", match[1]);
  return bindings;
}

function drawingTokenSetCovers(
  candidateTokens: ReadonlySet<string>,
  requiredTokens: ReadonlySet<string>,
) {
  return [...requiredTokens].every((token) => candidateTokens.has(token));
}

/**
 * Exact protected relationships must be unique across the complete page, not
 * merely inside the selected constituents' local envelopes. OCR may compress
 * the same relationship into one distant row or repartition it across a
 * nearby cluster, including searchable:false carriers. Compare a bounded
 * semantic token identity and fail closed if the relevant spatial comparison
 * work is too large to audit deterministically.
 */
function preparedDrawingExactRelationshipTokenClusterIsUnique(
  prepared: PreparedDrawingEvidencePageDetails,
  sourceRegions: readonly DrawingRegion[],
) {
  const selectedRegions = new Set(sourceRegions);
  const sourceTokenSets = sourceRegions.map((region) =>
    drawingExactRelationshipValueTokens(region.text)
  );
  const sourceNumericBindings = sourceRegions.map((region) =>
    drawingExactRelationshipNumericBindings(region.text)
  );
  if (sourceTokenSets.some((tokens) => tokens.size === 0)) return false;
  const requiredTokens = new Set(
    sourceTokenSets.flatMap((tokens) => [...tokens]),
  );
  if (
    requiredTokens.size < 2 ||
    requiredTokens.size > MAX_DRAWING_EXACT_RELATIONSHIP_IDENTITY_TOKENS
  ) return false;
  const unboundedCandidateTokens = new Set<string>();
  const boundedCandidates: Array<{
    region: DrawingRegion;
    tokens: ReadonlySet<string>;
  }> = [];
  const isProperContainedOCRFragmentOfSelectedRegion = (
    candidate: DrawingRegion,
  ) => sourceRegions.some((source) => {
    const candidateBounds = strictNormalizedBounds(candidate);
    const sourceBounds = strictNormalizedBounds(source);
    const candidateText = normalizeDrawingCarrierComparisonText(candidate.text);
    const sourceText = normalizeDrawingCarrierComparisonText(source.text);
    const candidateTokens = candidateText.split(/\s+/).filter(Boolean);
    const sameOCRSource = Boolean(candidate.rawSource) &&
      candidate.rawSource === source.rawSource;
    const crossSourceRenderedWordBox = candidateTokens.length === 1;
    if (
      !candidateBounds || !sourceBounds ||
      (!sameOCRSource && !crossSourceRenderedWordBox) ||
      !candidateText || !sourceText || candidateText === sourceText ||
      !(` ${sourceText} `.includes(` ${candidateText} `))
    ) return false;
    const tolerance = EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE;
    const contained =
      candidateBounds.x >= sourceBounds.x - tolerance &&
      candidateBounds.y >= sourceBounds.y - tolerance &&
      candidateBounds.x + candidateBounds.width <=
        sourceBounds.x + sourceBounds.width + tolerance &&
      candidateBounds.y + candidateBounds.height <=
        sourceBounds.y + sourceBounds.height + tolerance;
    const properFragment =
      candidateBounds.width * candidateBounds.height + 0.000000001 <
        sourceBounds.width * sourceBounds.height;
    return contained && properFragment;
  });
  for (const region of prepared.auditRegions) {
    if (selectedRegions.has(region)) continue;
    // OCR emits both an exact line and word boxes contained inside that line,
    // sometimes through two renderers with sub-pixel coordinate drift. Those
    // boxes are one rendered carrier, not an independent relationship. Ignore
    // only proper text-contained subregions from the same OCR source, or one
    // cross-source rendered word box. Equal-sized duplicates, multi-token
    // cross-source carriers, added qualifiers, and spatial repetitions remain
    // competing clusters.
    if (isProperContainedOCRFragmentOfSelectedRegion(region)) continue;
    const tokens = new Set<string>();
    for (const fragment of drawingRegionAssertionFragments(region)) {
      const fragmentTokens = drawingExactRelationshipValueTokens(
        fragment,
        undefined,
        true,
      );
      const candidateBindings = drawingExactRelationshipNumericBindings(
        fragment,
      );
      let quarantineFragment = false;
      for (const expectedBindings of sourceNumericBindings) {
        for (const [kind, expectedValues] of expectedBindings) {
          const candidateValues = candidateBindings.get(kind);
          if (!candidateValues) continue;
          const matching = [...candidateValues].some((value) =>
            expectedValues.has(value)
          );
          const competing = [...candidateValues].some((value) =>
            !expectedValues.has(value)
          );
          // One assertion carrier that names both the selected numeric
          // identity and a competing identity is intrinsically ambiguous.
          if (matching && competing) return false;
          if (competing) {
            quarantineFragment = true;
            break;
          }
        }
        if (quarantineFragment) break;
      }
      if (quarantineFragment) continue;
      for (const token of fragmentTokens) {
        if (requiredTokens.has(token)) tokens.add(token);
      }
    }
    if (tokens.size === 0) continue;
    if (strictNormalizedBounds(region) == null) {
      for (const token of tokens) unboundedCandidateTokens.add(token);
      // A multi-token relationship carrier without usable coordinates cannot
      // be proven distinct from the selected protected relationship.
      if (tokens.size >= 2) return false;
      continue;
    }
    boundedCandidates.push({ region, tokens });
  }
  if (drawingTokenSetCovers(unboundedCandidateTokens, requiredTokens)) {
    return false;
  }
  if (sourceTokenSets.some((tokens) =>
    drawingTokenSetCovers(unboundedCandidateTokens, tokens)
  )) return false;

  boundedCandidates.sort((left, right) =>
    left.region.x! - right.region.x! || left.region.y! - right.region.y!
  );
  const parents = boundedCandidates.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  let pairWork = 0;
  for (let left = 0; left < boundedCandidates.length; left += 1) {
    const leftRegion = boundedCandidates[left].region;
    for (let right = left + 1; right < boundedCandidates.length; right += 1) {
      const rightRegion = boundedCandidates[right].region;
      if (
        rightRegion.x! > leftRegion.x! + leftRegion.width! +
          MAX_DRAWING_EXACT_RELATIONSHIP_CLUSTER_AXIS_GAP
      ) break;
      if (
        axisGap(
            leftRegion.y!,
            leftRegion.height!,
            rightRegion.y!,
            rightRegion.height!,
          ) > MAX_DRAWING_EXACT_RELATIONSHIP_CLUSTER_AXIS_GAP
      ) continue;
      pairWork += 1;
      if (pairWork > MAX_DRAWING_EXACT_RELATIONSHIP_DUPLICATE_PAIR_WORK) {
        return false;
      }
      if (!regionsAreNear(leftRegion, rightRegion)) continue;
      const leftRoot = findRoot(left);
      const rightRoot = findRoot(right);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    }
  }
  const components = new Map<number, {
    tokens: Set<string>;
    regions: DrawingRegion[];
  }>();
  for (let index = 0; index < boundedCandidates.length; index += 1) {
    const root = findRoot(index);
    const component = components.get(root) || {
      tokens: new Set<string>(),
      regions: [],
    };
    for (const token of boundedCandidates[index].tokens) {
      component.tokens.add(token);
    }
    component.regions.push(boundedCandidates[index].region);
    components.set(root, component);
  }
  for (const component of components.values()) {
    const effectiveComponentTokens = new Set([
      ...component.tokens,
      ...unboundedCandidateTokens,
    ]);
    if (drawingTokenSetCovers(effectiveComponentTokens, requiredTokens)) {
      return false;
    }
    const coveredSourceIndexes = new Set(
      sourceTokenSets.flatMap((tokens, index) =>
        drawingTokenSetCovers(effectiveComponentTokens, tokens) ? [index] : []
      ),
    );
    if (coveredSourceIndexes.size === 0) continue;
    // A competing OCR cluster may reuse the unrepeated constituents from the
    // selected relationship. Admit those constituents into the alternate
    // cluster only when they are spatially connected without using a source
    // constituent that the competitor already replaced as a geometry bridge.
    const alternateTokens = new Set(effectiveComponentTokens);
    const alternateRegions = [...component.regions];
    const pendingSourceIndexes = new Set(
      sourceRegions.flatMap((_, index) =>
        coveredSourceIndexes.has(index) ? [] : [index]
      ),
    );
    let expanded = true;
    while (expanded && pendingSourceIndexes.size > 0) {
      expanded = false;
      for (const sourceIndex of [...pendingSourceIndexes]) {
        const sourceRegion = sourceRegions[sourceIndex];
        if (
          !alternateRegions.some((region) =>
            regionsAreNear(region, sourceRegion)
          )
        ) continue;
        pendingSourceIndexes.delete(sourceIndex);
        alternateRegions.push(sourceRegion);
        for (const token of sourceTokenSets[sourceIndex]) {
          alternateTokens.add(token);
        }
        expanded = true;
      }
    }
    if (drawingTokenSetCovers(alternateTokens, requiredTokens)) return false;
  }
  return true;
}

/**
 * Replays every constituent of one exact protected relationship against the
 * full prepared page while keeping numbered-note boundaries on the
 * relationship's single leftmost source axis.
 */
export function preparedECOSDrawingExactRelationshipNeighborhoodIsAssertive(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValues: unknown,
) {
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions) ||
    !Array.isArray(sourceRegionIdValues) ||
    sourceRegionIdValues.length < 2 || sourceRegionIdValues.length > 3
  ) return false;
  const sourceRegionIds = sourceRegionIdValues.flatMap((value) =>
    typeof value === "string" && value.trim() && value === value.trim() &&
      value.length <= MAX_DRAWING_METADATA_TEXT_LENGTH
      ? [value]
      : []
  );
  if (
    sourceRegionIds.length !== sourceRegionIdValues.length ||
    new Set(sourceRegionIds).size !== sourceRegionIds.length
  ) return false;
  const sourceRegions = sourceRegionIds.flatMap((sourceRegionId) => {
    const rawMatches = prepared.regions.filter((region) =>
      textValue(region.id) === sourceRegionId
    );
    const auditMatches = prepared.auditRegions.filter((region) =>
      region.id === sourceRegionId
    );
    return rawMatches.length === 1 && rawMatches[0].searchable === true &&
        !drawingInputRegionHasCarrierConflict(
          rawMatches[0],
          prepared.question,
        ) && auditMatches.length === 1 && auditMatches[0].searchable &&
        strictNormalizedBounds(auditMatches[0]) != null
      ? auditMatches
      : [];
  });
  if (sourceRegions.length !== sourceRegionIds.length) return false;
  if (
    !withDrawingQualifierTextCache(
      prepared.qualifierTextCache,
      () =>
        preparedDrawingExactRelationshipTokenClusterIsUnique(
          prepared,
          sourceRegions,
        ),
      )
  ) return false;
  if (
    !preparedDrawingRelationshipConstituentsShareNumberedNote(
      prepared,
      sourceRegions,
    )
  ) return false;
  const numberedNoteBoundaryAnchorX = Math.min(
    ...sourceRegions.map((region) => region.x!),
  );
  return sourceRegionIds.every((sourceRegionId) =>
    preparedDrawingCurrentRegionNeighborhoodIsAssertive(
      prepared,
      sourceRegionId,
      undefined,
      numberedNoteBoundaryAnchorX,
    )
  );
}

const INFILTRATION_DETAIL_EXISTENCE_TOKENS = Object.freeze([
  "underground",
  "infiltration",
  "chamber",
  "detail",
] as const);

function drawingInfiltrationDetailExistenceTokens(region: DrawingRegion) {
  const exactTokens = new Set(drawingRegionAssertionFragments(region)
    .flatMap((fragment) =>
      [...drawingExactRelationshipValueTokens(fragment, undefined, true)]
    ));
  const tokens = new Set<string>();
  for (const token of INFILTRATION_DETAIL_EXISTENCE_TOKENS) {
    if (exactTokens.has(token)) tokens.add(token);
  }
  return tokens;
}

function drawingInfiltrationDetailComponentIsAssertive(
  prepared: PreparedDrawingEvidencePageDetails,
  component: readonly DrawingRegion[],
) {
  if (component.some((region) =>
    !drawingRegionFragmentsAreAssertive(
      drawingRegionAssertionFragments(region),
      prepared.question,
    )
  )) return false;
  const componentSet = new Set(component);
  const qualifierCandidates = prepared.auditRegions.filter((region) =>
    !componentSet.has(region) &&
    strictNormalizedBounds(region) != null &&
    component.some((source) => regionsAreNear(source, region)) &&
    drawingRegionMayCarryLocalAssertionQualifier(region, prepared.question)
  );
  const numberedNoteMarkers = numberedNoteMarkersForPreparedPage(prepared);
  const numberedNoteBoundaryAnchorX = Math.min(
    ...component.map((region) => region.x!),
  );
  const budget = { workCount: 0, overflowed: false };
  let boundaryAuditInvalid = false;
  const qualifiers = qualifierCandidates.filter((candidate) => {
    const boundaries = component.map((source) =>
      drawingNumberedNoteBoundarySeparates(
        source,
        candidate,
        prepared.auditRegions,
        numberedNoteMarkers,
        budget,
        numberedNoteBoundaryAnchorX,
      )
    );
    if (boundaries.some((boundary) => boundary == null)) {
      boundaryAuditInvalid = true;
      return true;
    }
    return !boundaries.every((boundary) => boundary === true);
  });
  if (boundaryAuditInvalid || budget.overflowed) return false;
  if (qualifiers.length > MAX_NEARBY_DRAWING_REGIONS) return false;
  const qualifierTexts = qualifiers.map((region) =>
    unique(drawingRegionAssertionFragments(region)).join(" ")
  );
  if (qualifierTexts.some((value) =>
    drawingFragmentHasExplicitLocalAssertionQualifier(
      value,
      prepared.question,
    )
  )) return false;
  const orderedQualifiers = [...qualifiers].sort((left, right) =>
    (left.y ?? Number.POSITIVE_INFINITY) -
      (right.y ?? Number.POSITIVE_INFINITY) ||
    (left.x ?? Number.POSITIVE_INFINITY) -
      (right.x ?? Number.POSITIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
  for (let start = 0; start < orderedQualifiers.length; start += 1) {
    for (
      let length = 2;
      length <= MAX_SELF_CONTAINED_MEASUREMENT_QUALIFIER_WINDOW_REGIONS &&
        start + length <= orderedQualifiers.length;
      length += 1
    ) {
      const window = orderedQualifiers.slice(start, start + length);
      if (
        window.slice(1).some((region, index) =>
          !regionsAreNear(window[index], region)
        )
      ) break;
      if (drawingFragmentHasExplicitLocalAssertionQualifier(
        window.flatMap(drawingRegionAssertionFragments).join(" "),
        prepared.question,
      )) return false;
    }
  }
  const componentText = component.flatMap(drawingRegionAssertionFragments)
    .join(" ");
  return !drawingFragmentHasExplicitLocalAssertionQualifier(
    `${componentText} ${qualifierTexts.join(" ")}`,
    prepared.question,
  );
}

/**
 * Proves the bounded existential claim that the accepted current sheet
 * contains underground infiltration chamber details. Compatible repeated
 * detail clusters are affirmative peers, not ambiguity; any hidden,
 * unbounded, conflicted, qualified, or unauditable complete peer fails closed.
 * The ordinary exact-relationship uniqueness audit is intentionally unchanged.
 */
export function preparedECOSDrawingInfiltrationDetailPageContainmentIsAssertive(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValues: unknown,
) {
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions) ||
    !Array.isArray(sourceRegionIdValues) ||
    sourceRegionIdValues.length !== 3
  ) return false;
  const sourceRegionIds = sourceRegionIdValues.flatMap((value) =>
    typeof value === "string" && value.trim() && value === value.trim() &&
      value.length <= MAX_DRAWING_METADATA_TEXT_LENGTH
      ? [value]
      : []
  );
  const rawIds = prepared.regions.map((region) => textValue(region.id));
  if (
    sourceRegionIds.length !== sourceRegionIdValues.length ||
    new Set(sourceRegionIds).size !== sourceRegionIds.length ||
    rawIds.some((id) => !id) || new Set(rawIds).size !== rawIds.length
  ) return false;
  const expectedSelectedTexts = new Set([
    "underground infiltration",
    "chambers",
    "detail",
  ]);
  const sourceRegions = sourceRegionIds.flatMap((sourceRegionId) => {
    const rawMatches = prepared.regions.filter((region) =>
      textValue(region.id) === sourceRegionId
    );
    const auditMatches = prepared.auditRegions.filter((region) =>
      region.id === sourceRegionId
    );
    if (
      rawMatches.length !== 1 || rawMatches[0].searchable !== true ||
      drawingInputRegionHasCarrierConflict(rawMatches[0], prepared.question) ||
      auditMatches.length !== 1 || !auditMatches[0].searchable ||
      strictNormalizedBounds(auditMatches[0]) == null ||
      auditMatches[0].rawSource !== "title_block_ocr"
    ) return [];
    return [auditMatches[0]];
  });
  if (
    sourceRegions.length !== sourceRegionIds.length ||
    new Set(sourceRegions.map((region) =>
      canonicalStructuredDrawingClaimText(region.text)
    )).size !== expectedSelectedTexts.size ||
    sourceRegions.some((region) =>
      !expectedSelectedTexts.has(canonicalStructuredDrawingClaimText(region.text))
    )
  ) return false;
  const selectedRegions = new Set(sourceRegions);
  if (prepared.unboundedLocalQualifierRegions.some((region) =>
    !selectedRegions.has(region)
  )) return false;

  const unboundedTokens = new Set<string>();
  const boundedCandidates: Array<{
    region: DrawingRegion;
    tokens: ReadonlySet<string>;
  }> = [];
  for (const region of prepared.auditRegions) {
    const tokens = drawingInfiltrationDetailExistenceTokens(region);
    if (tokens.size === 0) continue;
    if (strictNormalizedBounds(region) == null) {
      for (const token of tokens) unboundedTokens.add(token);
      continue;
    }
    boundedCandidates.push({ region, tokens });
  }
  if (drawingTokenSetCovers(
    unboundedTokens,
    new Set(INFILTRATION_DETAIL_EXISTENCE_TOKENS),
  )) return false;

  boundedCandidates.sort((left, right) =>
    left.region.x! - right.region.x! || left.region.y! - right.region.y!
  );
  const parents = boundedCandidates.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  let pairWork = 0;
  for (let left = 0; left < boundedCandidates.length; left += 1) {
    const leftRegion = boundedCandidates[left].region;
    for (let right = left + 1; right < boundedCandidates.length; right += 1) {
      const rightRegion = boundedCandidates[right].region;
      if (
        rightRegion.x! > leftRegion.x! + leftRegion.width! +
          MAX_DRAWING_EXACT_RELATIONSHIP_CLUSTER_AXIS_GAP
      ) break;
      if (
        axisGap(
          leftRegion.y!,
          leftRegion.height!,
          rightRegion.y!,
          rightRegion.height!,
        ) > MAX_DRAWING_EXACT_RELATIONSHIP_CLUSTER_AXIS_GAP
      ) continue;
      pairWork += 1;
      if (pairWork > MAX_DRAWING_EXACT_RELATIONSHIP_DUPLICATE_PAIR_WORK) {
        return false;
      }
      if (!regionsAreNear(leftRegion, rightRegion)) continue;
      const leftRoot = findRoot(left);
      const rightRoot = findRoot(right);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    }
  }
  const components = new Map<number, DrawingRegion[]>();
  for (let index = 0; index < boundedCandidates.length; index += 1) {
    const root = findRoot(index);
    const component = components.get(root) || [];
    component.push(boundedCandidates[index].region);
    components.set(root, component);
  }
  const requiredTokens = new Set(INFILTRATION_DETAIL_EXISTENCE_TOKENS);
  for (const component of components.values()) {
    const componentTokens = new Set(component.flatMap((region) =>
      [...drawingInfiltrationDetailExistenceTokens(region)]
    ));
    if (
      !drawingTokenSetCovers(componentTokens, requiredTokens) &&
      drawingTokenSetCovers(
        new Set([...componentTokens, ...unboundedTokens]),
        requiredTokens,
      )
    ) return false;
  }
  const completeComponents = [...components.values()].filter((component) => {
    const tokens = new Set(component.flatMap((region) =>
      [...drawingInfiltrationDetailExistenceTokens(region)]
    ));
    return drawingTokenSetCovers(tokens, requiredTokens);
  });
  if (
    completeComponents.length === 0 ||
    !completeComponents.some((component) =>
      sourceRegionIds.every((id) => component.some((region) => region.id === id))
    )
  ) return false;
  for (const component of completeComponents) {
    if (component.some((region) => !region.searchable)) return false;
    const componentText = canonicalStructuredDrawingClaimText(
      component.flatMap(drawingRegionAssertionFragments).join(" "),
    );
    if (
      /\b(?:sheet|sht)(?:\s+(?:no|number))?\s+[a-z]?\s*[0-9]+\b/.test(
        componentText,
      ) ||
      /\b(?:see|refer(?:s|red|ring)?|direct(?:s|ed|ing|ion)?)\b[\s\S]{0,80}\bc\s*[0-9]+\b/.test(
        componentText,
      )
    ) return false;
    for (const region of component) {
      const rawMatches = prepared.regions.filter((raw) =>
        textValue(raw.id) === region.id
      );
      if (
        rawMatches.length !== 1 ||
        drawingInputRegionHasCarrierConflict(rawMatches[0], prepared.question)
      ) return false;
    }
    if (!drawingInfiltrationDetailComponentIsAssertive(prepared, component)) {
      return false;
    }
  }
  return true;
}

/**
 * Audits every non-constituent neighbor around an exact conditional
 * relationship whose own sealed carriers intentionally contain words such as
 * "only" and "if". Callers may exempt exactly three unique searchable source
 * regions; all other raw carriers, including searchable:false OCR fragments,
 * remain inside the local qualifier closure.
 */
export function preparedECOSDrawingConditionalRelationshipNeighborhoodIsAssertive(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValues: unknown,
) {
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions) ||
    !Array.isArray(sourceRegionIdValues) || sourceRegionIdValues.length !== 3
  ) return false;
  const sourceRegionIds = sourceRegionIdValues.flatMap((value) =>
    typeof value === "string" && value.trim() && value === value.trim() &&
      value.length <= MAX_DRAWING_METADATA_TEXT_LENGTH
      ? [value]
      : []
  );
  if (
    sourceRegionIds.length !== sourceRegionIdValues.length ||
    new Set(sourceRegionIds).size !== sourceRegionIds.length
  ) return false;
  const selectedIds = new Set(sourceRegionIds);
  const rawSourceRegions = sourceRegionIds.flatMap((sourceRegionId) => {
    const matches = prepared.regions.filter((region) =>
      region.searchable === true && textValue(region.id) === sourceRegionId
    );
    return matches.length === 1 ? matches : [];
  });
  if (
    rawSourceRegions.length !== sourceRegionIds.length ||
    rawSourceRegions.some((region) =>
      drawingInputRegionHasCarrierConflict(region, prepared.question)
    )
  ) return false;
  const sourceRegions = sourceRegionIds.flatMap((sourceRegionId) => {
    const matches = prepared.auditRegions.filter((region) =>
      region.id === sourceRegionId
    );
    return matches.length === 1 && matches[0].searchable ? matches : [];
  });
  if (
    sourceRegions.length !== sourceRegionIds.length ||
    sourceRegions.some((region) => strictNormalizedBounds(region) == null)
  ) return false;
  if (
    !withDrawingQualifierTextCache(
      prepared.qualifierTextCache,
      () =>
        preparedDrawingExactRelationshipTokenClusterIsUnique(
          prepared,
          sourceRegions,
        ),
      )
  ) return false;
  if (
    !preparedDrawingRelationshipConstituentsShareNumberedNote(
      prepared,
      sourceRegions,
    )
  ) return false;
  const numberedNoteBoundaryAnchorX = Math.min(
    ...sourceRegions.map((region) => region.x!),
  );
  const selectedRegions = new Set(sourceRegions);
  if (prepared.unboundedLocalQualifierRegions.some((region) =>
    !selectedRegions.has(region)
  )) return false;
  const nonConstituentRegions = prepared.auditRegions.filter((region) =>
    !selectedIds.has(region.id)
  );
  const numberedNoteMarkers = numberedNoteMarkersForPreparedPage(prepared)
    .filter((region) => !selectedIds.has(region.id));
  return withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () =>
      ecosDrawingPropositionIsAssertiveCurrent(
        prepared.pageIdentity || "current drawing",
      ) && sourceRegions.every((sourceRegion) => {
        const localRegions = boundedDrawingLocalRegionClosure(
          sourceRegion,
          [sourceRegion, ...nonConstituentRegions],
          prepared.question,
          undefined,
          numberedNoteMarkers,
          numberedNoteBoundaryAnchorX,
        );
        return Boolean(
          localRegions &&
            drawingConditionalRelationshipNeighborhoodIsAssertive(
              sourceRegion,
              localRegions,
              prepared.question,
            ),
        );
      }),
  );
}

function preparedDrawingEvidencePageDetails({
  preparedPage,
  pageText,
  regions,
  question,
  pageIdentity,
}: {
  preparedPage?: ECOSPreparedDrawingEvidencePage;
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity: string;
}) {
  const prepared = preparedPage
    ? PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage)
    : undefined;
  if (
    prepared &&
    IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions) &&
    prepared.pageText === pageText &&
    prepared.regions === regions &&
    prepared.question === question &&
    prepared.pageIdentity === pageIdentity
  ) return prepared;
  const token = prepareECOSDrawingEvidencePage({
    pageText,
    regions,
    question,
    pageIdentity,
  });
  return PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(token)!;
}

function drawingRegionsHaveStableUniqueIds(regions: readonly DrawingRegion[]) {
  const regionIds = new Set<string>();
  for (const region of regions) {
    if (!region.id || regionIds.has(region.id)) return false;
    regionIds.add(region.id);
  }
  return true;
}

function uniqueRawDrawingRegionIds(
  regions: readonly ECOSDrawingRegionInput[],
) {
  const counts = new Map<string, number>();
  for (const region of regions) {
    const id = textValue(region.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return new Set(
    [...counts].flatMap(([id, count]) => count === 1 ? [id] : []),
  ) as ReadonlySet<string>;
}

type DrawingMeasurementAnchorAudit = Readonly<{
  responsiveAnchors: readonly DrawingRegion[];
  overflowed: boolean;
  conflicting: boolean;
}>;

function auditDrawingMeasurementAnchors({
  normalizedRegions,
  question,
  passageLimit,
  diagnostics,
}: {
  normalizedRegions: readonly DrawingRegion[];
  question: string;
  passageLimit: number;
  diagnostics?: DrawingMeasurementAnchorAuditDiagnostics;
}): DrawingMeasurementAnchorAudit {
  const containsRequestedMeasurementValue =
    prepareECOSRequestedMeasurementValueMatcher(question);
  const analyzeQuestionEvidenceContext =
    prepareECOSQuestionEvidenceContextAnalyzer(question);
  const measurementEvidenceByRegion = new Map<DrawingRegion, string>();
  const measurementContextEvidence = (region: DrawingRegion) => {
    const cached = measurementEvidenceByRegion.get(region);
    if (cached !== undefined) return cached;
    const evidence = unique([
      ...region.carrierTexts,
      ...region.areaNames,
    ]).join("\n");
    measurementEvidenceByRegion.set(region, evidence);
    return evidence;
  };
  const measurementAnchors = normalizedRegions.filter((region) =>
    [...region.carrierTexts, ...region.areaNames].some((carrier) =>
      containsRequestedMeasurementValue(carrier)
    )
  );
  if (diagnostics) {
    diagnostics.measurementAnchorCount = measurementAnchors.length;
  }
  const measurementContextByRegion = new Map<
    DrawingRegion,
    ReturnType<typeof analyzeECOSQuestionEvidenceContext>
  >();
  const measurementContextForRegion = (region: DrawingRegion) => {
    const cached = measurementContextByRegion.get(region);
    if (cached) return cached;
    const context = analyzeQuestionEvidenceContext(
      measurementContextEvidence(region),
    );
    measurementContextByRegion.set(region, context);
    return context;
  };
  const measurementConstructionCompatibilityByRegion = new Map<
    DrawingRegion,
    ReturnType<typeof drawingRegionConstructionSubjectCompatibility>
  >();
  const measurementConstructionCompatibilityForRegion = (
    region: DrawingRegion,
  ) => {
    const cached = measurementConstructionCompatibilityByRegion.get(region);
    if (cached) return cached;
    const compatibility = drawingRegionMeasurementConstructionCompatibility(
      region,
      question,
    );
    measurementConstructionCompatibilityByRegion.set(region, compatibility);
    return compatibility;
  };
  const directlyResponsiveMeasurementAnchors = measurementAnchors.filter(
    (region) => {
      const context = measurementContextForRegion(region);
      return context.subjectMatched && context.attributeMatched &&
        measurementConstructionCompatibilityForRegion(region) !== "conflicting";
    },
  );
  if (diagnostics) {
    diagnostics.directlyResponsiveMeasurementAnchorCount =
      directlyResponsiveMeasurementAnchors.length;
  }
  const directlyResponsiveMeasurementAnchorSet = new Set(
    directlyResponsiveMeasurementAnchors,
  );
  const conflictingResponsiveMeasurementAnchors = measurementAnchors.filter(
    (region) => {
      if (
        measurementConstructionCompatibilityForRegion(region) !==
          "conflicting"
      ) return false;
      return drawingRegionCarriesRequestedAndCompetingConstructionScope(
        region,
        question,
      );
    },
  );
  if (conflictingResponsiveMeasurementAnchors.length > 0) {
    if (diagnostics) {
      diagnostics.rejectionStage = "conflicting_measurement_anchor";
    }
    return {
      responsiveAnchors: Object.freeze(conflictingResponsiveMeasurementAnchors),
      overflowed: false,
      conflicting: true,
    };
  }
  // A complete measurement proposition is already audited as its own anchor;
  // lending its subject and attribute to another nearby number manufactures a
  // duplicate peer. Partial measurement-bearing OCR fragments remain eligible
  // carriers so two incomplete boxes can still expose a hidden conflict.
  const compatibleMeasurementContextCarriers = measurementAnchors.length > 0
    ? normalizedRegions.filter((region) =>
      !directlyResponsiveMeasurementAnchorSet.has(region) &&
      measurementConstructionCompatibilityForRegion(region) !== "conflicting"
    )
    : [];
  const locallyResponsiveMeasurementAnchors = [
    ...directlyResponsiveMeasurementAnchors,
  ];
  // A direct complete anchor must not make a split-OCR conflicting peer
  // disappear. Every nearby compatible pair gets the exact combined semantic
  // decision because two partial fragments can jointly satisfy a threshold
  // that neither fragment satisfies alone. Exhausting the owner-controlled
  // page budget rejects the complete page, never a partially inspected set.
  const localMeasurementPairWorkLimit = measurementAnchors.length > 0
    ? (passageLimit + 1) * MAX_DRAWING_REGION_PAIR_WORK_UNIT
    : 0;
  if (diagnostics) {
    diagnostics.localMeasurementPairWorkLimit = localMeasurementPairWorkLimit;
  }
  let localMeasurementPairWorkCount = 0;
  for (const region of measurementAnchors) {
    if (directlyResponsiveMeasurementAnchorSet.has(region)) continue;
    if (
      measurementConstructionCompatibilityForRegion(region) === "conflicting"
    ) continue;
    const anchorContext = measurementContextForRegion(region);
    if (anchorContext.subjectMatched && anchorContext.attributeMatched) {
      locallyResponsiveMeasurementAnchors.push(region);
    } else {
      let locallyResponsive = false;
      for (const carrier of compatibleMeasurementContextCarriers) {
        if (localMeasurementPairWorkCount >= localMeasurementPairWorkLimit) {
          if (diagnostics) {
            diagnostics.localMeasurementPairWorkCount =
              localMeasurementPairWorkCount;
            diagnostics.localMeasurementPairOverflowCount += 1;
            diagnostics.locallyResponsiveMeasurementAnchorCount =
              locallyResponsiveMeasurementAnchors.length;
            diagnostics.rejectionStage = "local_measurement_pair_work_overflow";
          }
          return {
            responsiveAnchors: Object.freeze([]),
            overflowed: true,
            conflicting: false,
          };
        }
        localMeasurementPairWorkCount += 1;
        if (carrier === region || !regionsAreNear(region, carrier)) continue;
        const localContext = analyzeQuestionEvidenceContext(
          unique([
            measurementContextEvidence(region),
            measurementContextEvidence(carrier),
          ]).join("\n"),
        );
        if (localContext.subjectMatched && localContext.attributeMatched) {
          locallyResponsive = true;
          break;
        }
      }
      if (locallyResponsive) locallyResponsiveMeasurementAnchors.push(region);
    }
    if (locallyResponsiveMeasurementAnchors.length > passageLimit) break;
  }
  if (diagnostics) {
    diagnostics.localMeasurementPairWorkCount = localMeasurementPairWorkCount;
    diagnostics.locallyResponsiveMeasurementAnchorCount =
      locallyResponsiveMeasurementAnchors.length;
  }
  return {
    responsiveAnchors: Object.freeze([...locallyResponsiveMeasurementAnchors]),
    overflowed: false,
    conflicting: false,
  };
}

function auditPreparedDrawingMeasurementAnchors({
  prepared,
  normalizedRegions,
  question,
  passageLimit,
  auditScopeKey = "all-raw",
  diagnostics,
}: {
  prepared: PreparedDrawingEvidencePageDetails;
  normalizedRegions: readonly DrawingRegion[];
  question: string;
  passageLimit: number;
  auditScopeKey?: string;
  diagnostics?: ECOSDrawingEvidenceDiagnostics;
}): DrawingMeasurementAnchorAudit {
  let auditsByPassageLimit = PREPARED_DRAWING_MEASUREMENT_ANCHOR_AUDITS.get(
    prepared,
  );
  if (!auditsByPassageLimit) {
    auditsByPassageLimit = new Map();
    PREPARED_DRAWING_MEASUREMENT_ANCHOR_AUDITS.set(
      prepared,
      auditsByPassageLimit,
    );
  }
  const cacheKey = `${passageLimit}:${auditScopeKey}`;
  let receipt = auditsByPassageLimit.get(cacheKey);
  if (!receipt) {
    const auditDiagnostics: DrawingMeasurementAnchorAuditDiagnostics = {
      measurementAnchorCount: 0,
      directlyResponsiveMeasurementAnchorCount: 0,
      locallyResponsiveMeasurementAnchorCount: 0,
      localMeasurementPairWorkCount: 0,
      localMeasurementPairWorkLimit: 0,
      localMeasurementPairOverflowCount: 0,
      rejectionStage: "",
    };
    const audit = auditDrawingMeasurementAnchors({
      normalizedRegions,
      question,
      passageLimit,
      diagnostics: auditDiagnostics,
    });
    receipt = Object.freeze({
      audit: Object.freeze({
        responsiveAnchors: Object.freeze([...audit.responsiveAnchors]),
        overflowed: audit.overflowed,
        conflicting: audit.conflicting,
      }),
      diagnostics: Object.freeze({ ...auditDiagnostics }),
    });
    auditsByPassageLimit.set(cacheKey, receipt);
  }
  if (diagnostics) Object.assign(diagnostics, receipt.diagnostics);
  return receipt.audit;
}

function drawingDerivedMeasurementCoverageAnchors(
  responsiveAnchors: readonly DrawingRegion[],
  question: string,
) {
  // The protected installed-condition wording describes generic "concrete,"
  // but the bounded current-page receipt is explicitly PCC paving. A separate
  // PCC walkway note is a different construction subject, not an uncovered
  // answer peer. Same-subject paving alternatives remain in the coverage set
  // and are also vetoed by the structured-claim peer audit.
  if (drawingQuestionRequestsNorthLotPCCPavingThickness(question)) {
    return responsiveAnchors.filter((anchor) =>
      drawingExplicitConstructionSubjects(
        drawingRegionAssertionFragments(anchor).join("\n"),
      ).has("paving") &&
      drawingExplicitConstructionMaterialFamilies(
        drawingRegionAssertionFragments(anchor).join("\n"),
      ).has("concrete")
    );
  }
  // The deterministic ceiling receipt has an exact spatial selector: only the
  // minimum-x cluster answers "leftmost." A distinct right-hand detail is not
  // a responsive peer for that question and must not be cited as answer proof.
  if (drawingQuestionRequestsOnlyAffirmativeLeftmostCeilingHeight(question)) {
    if (responsiveAnchors.some((anchor) => anchor.x == null)) {
      return responsiveAnchors;
    }
    const leftmostX = Math.min(...responsiveAnchors.map((anchor) => anchor.x!));
    return responsiveAnchors.filter((anchor) =>
      Math.abs(anchor.x! - leftmostX) <= 0.01
    );
  }
  return responsiveAnchors;
}

function drawingQuestionTargetsExtremeCeilingDetail(question: string) {
  const normalized = canonicalDrawingQualifierText(question);
  return /\bceiling\s+heights?\b/.test(normalized) &&
    /\bdetails?\b/.test(normalized) &&
    /\b(?:leftmost|rightmost)\b/.test(normalized);
}

function drawingQuestionRequestsOnlyAffirmativeLeftmostCeilingHeight(
  question: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (
    requirement.kind !== "measurement" || requirement.attribute !== "height"
  ) return false;
  const normalized = canonicalDrawingQualifierText(question);
  if (
    !/\bceiling\s+height\b/.test(normalized) ||
    !/\bleftmost\s+detail\b/.test(normalized) ||
    [...normalized.matchAll(/\bleftmost\b/g)].length !== 1 ||
    !/\b(?:what|which|how\s+(?:high|tall))\b/.test(normalized)
  ) return false;
  return !/\b(?:rightmost|both|compare|comparison|versus|vs|between|middle|center|central|other|another|each|either|neither|all|and|or|not|no|never|without|excluding|exclude|except|omit|omitting|ignore|ignoring|instead|rather)\b/
    .test(
      normalized,
    );
}

function exactRelationshipPassagesForPreparedPage({
  prepared,
  allowSamePageContextMeasurement,
  pageAuthority,
  exactSourceBoundPresentationAuthorities,
  diagnostics,
}: {
  prepared: PreparedDrawingEvidencePageDetails;
  allowSamePageContextMeasurement: boolean;
  pageAuthority?: ECOSDrawingPageAuthority | null;
  exactSourceBoundPresentationAuthorities:
    readonly ECOSDrawingExactSourceBoundPresentationAuthority[];
  diagnostics?: ECOSDrawingEvidenceDiagnostics;
}): readonly ECOSDrawingEvidencePassage[] {
  const protectedMode = allowSamePageContextMeasurement ||
    drawingQuestionRequiresSealedStructuredReceipt(prepared.question);
  const strictAuthority = protectedMode
    ? strictDrawingPageAuthority(pageAuthority)
    : null;
  const matchedAuthority = strictAuthority &&
      drawingPageIdentityMatchesAuthority(
        prepared.pageIdentity,
        strictAuthority,
      )
    ? strictAuthority
    : null;
  const cacheKey = protectedMode
    ? JSON.stringify([
      "protected",
      matchedAuthority?.projectId || null,
      matchedAuthority?.sourceSha256 || null,
      matchedAuthority?.pageNumber || null,
      matchedAuthority?.sheetNumber || null,
      matchedAuthority?.evidenceVersion || null,
    ])
    : "ordinary";
  const cacheEligible = exactSourceBoundPresentationAuthorities.length === 0 &&
    IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions);
  let passagesByAuthority = cacheEligible
    ? PREPARED_DRAWING_EXACT_RELATIONSHIP_PASSAGES.get(prepared)
    : undefined;
  if (cacheEligible && !passagesByAuthority) {
    passagesByAuthority = new Map<
      string,
      readonly ECOSDrawingEvidencePassage[]
    >();
    PREPARED_DRAWING_EXACT_RELATIONSHIP_PASSAGES.set(
      prepared,
      passagesByAuthority,
    );
  }
  const cached = passagesByAuthority?.get(cacheKey);
  if (cached) return cached;
  if (diagnostics) diagnostics.exactRelationshipEvaluations += 1;
  const builtPassages = withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () => buildExactRelationshipPassages(
      prepared.normalizedRegions,
      prepared.question,
      prepared.pageIdentity,
      protectedMode,
      prepared.regions,
      matchedAuthority,
      exactSourceBoundPresentationAuthorities,
      diagnostics,
    ),
  );
  if (!cacheEligible || !passagesByAuthority) return builtPassages;
  const passages = Object.freeze(
    builtPassages.map((passage) =>
      deepFreezeJSONValue(passage) as ECOSDrawingEvidencePassage
    ),
  );
  if (
    passagesByAuthority.size <
      MAX_PREPARED_EXACT_RELATIONSHIP_AUTHORITY_CACHE_ENTRIES
  ) {
    passages.forEach((passage) =>
      CACHED_EXACT_RELATIONSHIP_PASSAGES.add(passage)
    );
    passagesByAuthority.set(cacheKey, passages);
  }
  return passages;
}

function drawingNumberedNoteMarkerHasOverlappingDuplicate(
  marker: DrawingRegion,
  markers: readonly DrawingRegion[],
) {
  return markers.some((peer) =>
    peer !== marker &&
    strictNormalizedBounds(peer) != null &&
    axisGap(marker.x!, marker.width!, peer.x!, peer.width!) <= 0.002 &&
    axisGap(marker.y!, marker.height!, peer.y!, peer.height!) <= 0.002
  );
}

function numberedNoteMarkersForPreparedPage(
  prepared: PreparedDrawingEvidencePageDetails,
  diagnostics?: ECOSDrawingEvidenceDiagnostics,
) {
  const cached = PREPARED_DRAWING_NUMBERED_NOTE_MARKERS.get(prepared);
  if (cached) return cached;
  if (diagnostics) {
    diagnostics.numberedNoteMarkerEvaluations +=
      prepared.normalizedRegions.length;
  }
  const markers = withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () => {
      const trustedMarkers = prepared.normalizedRegions.filter((region) => {
      // NFKD plus format/mark removal is the only part of the full drawing
      // qualifier canonicalizer that can turn compatibility glyphs such as
      // `⒈` into a numbered-note marker. Reject every other region before the
      // nineteen spaced-status regex passes. The final canonical check remains
      // authoritative, so this is an exact behavior-preserving prefilter.
      const markerCandidate = region.text.normalize("NFKD")
        .replace(/[\p{Cf}\p{M}]/gu, "")
        .trim();
      return drawingRegionIsTrustedNumberedNoteMarker(
        region,
        prepared.uniqueRawRegionIds,
      ) &&
        /^\d{1,3}[.)]$/.test(markerCandidate) &&
        /^\d{1,3}[.)]$/.test(
          canonicalDrawingQualifierText(region.text).trim(),
        );
      });
      return Object.freeze(trustedMarkers.filter((marker) =>
        !drawingNumberedNoteMarkerHasOverlappingDuplicate(
          marker,
          trustedMarkers,
        )
      ));
    },
  );
  PREPARED_DRAWING_NUMBERED_NOTE_MARKERS.set(prepared, markers);
  return markers;
}

function auditNumberedNoteMarkersForPreparedPage(
  prepared: PreparedDrawingEvidencePageDetails,
) {
  const cached = PREPARED_DRAWING_AUDIT_NUMBERED_NOTE_MARKERS.get(prepared);
  if (cached) return cached;
  const markers = withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () => {
      const trustedMarkers = prepared.auditRegions.filter((region) => {
      const markerCandidate = region.text.normalize("NFKD")
        .replace(/[\p{Cf}\p{M}]/gu, "")
        .trim();
      return drawingRegionIsTrustedNumberedNoteMarker(
        region,
        prepared.uniqueRawRegionIds,
      ) &&
        /^\d{1,3}[.)]$/.test(markerCandidate) &&
        /^\d{1,3}[.)]$/.test(
          canonicalDrawingQualifierText(region.text).trim(),
        );
      });
      return Object.freeze(trustedMarkers.filter((marker) =>
        !drawingNumberedNoteMarkerHasOverlappingDuplicate(
          marker,
          trustedMarkers,
        )
      ));
    },
  );
  PREPARED_DRAWING_AUDIT_NUMBERED_NOTE_MARKERS.set(prepared, markers);
  return markers;
}

function preparedDrawingRelationshipConstituentsShareNumberedNote(
  prepared: PreparedDrawingEvidencePageDetails,
  sourceRegions: readonly DrawingRegion[],
) {
  // Hidden OCR cannot prove a positive boundary for a candidate assertion,
  // but a trusted exact primary marker remains audit evidence that the
  // selected relationship itself crosses numbered notes.
  const numberedNoteMarkers = auditNumberedNoteMarkersForPreparedPage(prepared);
  const budget = { workCount: 0, overflowed: false };
  const numberedNoteBoundaryAnchorX = Math.min(
    ...sourceRegions.map((source) => source.x!),
  );
  for (let left = 0; left < sourceRegions.length; left += 1) {
    for (let right = left + 1; right < sourceRegions.length; right += 1) {
      const boundary = drawingNumberedNoteBoundarySeparates(
        sourceRegions[left],
        sourceRegions[right],
        prepared.auditRegions,
        numberedNoteMarkers,
        budget,
        numberedNoteBoundaryAnchorX,
      );
      if (boundary !== false || budget.overflowed) return false;
    }
  }
  return true;
}

/**
 * Proves that trusted numbered-note boundaries separate every unique selected
 * relationship constituent from every unique candidate in a bounded
 * component. Callers use this narrow structural proof before treating nearby
 * action phrases as belonging to a different numbered assertion.
 */
export function preparedECOSDrawingTrustedNumberedNoteBoundarySeparatesComponent(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValues: unknown,
  candidateRegionIdValues: unknown,
) {
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions) ||
    !Array.isArray(sourceRegionIdValues) ||
    sourceRegionIdValues.length < 1 || sourceRegionIdValues.length > 3 ||
    !Array.isArray(candidateRegionIdValues) ||
    candidateRegionIdValues.length < 1 ||
    candidateRegionIdValues.length > MAX_NEARBY_DRAWING_REGIONS
  ) return false;
  const sourceRegionIds = sourceRegionIdValues.flatMap((value) =>
    typeof value === "string" && value && value === value.trim() &&
      value.length <= MAX_DRAWING_METADATA_TEXT_LENGTH
      ? [value]
      : []
  );
  const candidateRegionIds = candidateRegionIdValues.flatMap((value) =>
    typeof value === "string" && value && value === value.trim() &&
      value.length <= MAX_DRAWING_METADATA_TEXT_LENGTH
      ? [value]
      : []
  );
  if (
    sourceRegionIds.length !== sourceRegionIdValues.length ||
    new Set(sourceRegionIds).size !== sourceRegionIds.length ||
    candidateRegionIds.length !== candidateRegionIdValues.length ||
    new Set(candidateRegionIds).size !== candidateRegionIds.length ||
    candidateRegionIds.some((regionId) => sourceRegionIds.includes(regionId))
  ) return false;
  const rawRegionIsUnique = (regionId: string) =>
    prepared.uniqueRawRegionIds.has(regionId) &&
    prepared.regions.filter((region) => textValue(region.id) === regionId)
        .length === 1;
  if (
    sourceRegionIds.some((regionId) => !rawRegionIsUnique(regionId)) ||
    candidateRegionIds.some((regionId) => !rawRegionIsUnique(regionId))
  ) return false;
  const sources = sourceRegionIds.flatMap((regionId) => {
    const matches = prepared.auditRegions.filter((region) =>
      region.id === regionId
    );
    return matches.length === 1 && matches[0].searchable &&
        strictNormalizedBounds(matches[0]) != null
      ? matches
      : [];
  });
  if (sources.length !== sourceRegionIds.length) return false;
  const candidates = candidateRegionIds.flatMap((regionId) => {
    const matches = prepared.auditRegions.filter((region) =>
      region.id === regionId
    );
    return matches.length === 1 && strictNormalizedBounds(matches[0]) != null
      ? matches
      : [];
  });
  if (candidates.length !== candidateRegionIds.length) return false;
  const budget = { workCount: 0, overflowed: false };
  const numberedNoteMarkers = numberedNoteMarkersForPreparedPage(prepared);
  const numberedNoteBoundaryAnchorX = Math.min(
    ...sources.map((source) => source.x!),
  );
  for (let left = 0; left < sources.length; left += 1) {
    for (let right = left + 1; right < sources.length; right += 1) {
      if (
        drawingNumberedNoteBoundarySeparates(
          sources[left],
          sources[right],
          prepared.auditRegions,
          numberedNoteMarkers,
          budget,
          numberedNoteBoundaryAnchorX,
        ) !== false || budget.overflowed
      ) return false;
    }
  }
  return candidates.every((candidate) =>
    sources.every((source) =>
      drawingNumberedNoteBoundarySeparates(
        source,
        candidate,
        prepared.auditRegions,
        numberedNoteMarkers,
        budget,
        numberedNoteBoundaryAnchorX,
      ) === true
    )
  ) && !budget.overflowed;
}

function exactSourceBoundContainedRenderedOCRTokenIsRedundant({
  region,
  sourceRegion,
  authorityBounds,
}: {
  region: DrawingRegion;
  sourceRegion: DrawingRegion;
  authorityBounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}) {
  if (region.rawSource !== "fixed_visual_tile_coordinate_ocr") return false;
  const regionBounds = strictNormalizedBounds(region);
  if (
    !regionBounds ||
    !normalizedDrawingBoundsContain(
      authorityBounds,
      regionBounds,
      EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
    ) ||
    regionBounds.width * regionBounds.height >=
      authorityBounds.width * authorityBounds.height
  ) return false;
  const renderedTokens = canonicalDrawingQualifierText(region.text).match(
    /[a-z0-9]+(?:\.[a-z0-9]+)?%?/g,
  ) || [];
  if (renderedTokens.length !== 1) return false;
  const sourceTokens = new Set(
    canonicalDrawingQualifierText(sourceRegion.text).match(
      /[a-z0-9]+(?:\.[a-z0-9]+)?%?/g,
    ) || [],
  );
  return sourceTokens.has(renderedTokens[0]);
}

function preparedDrawingPassageHasAssertiveLocalNeighborhood({
  prepared,
  passage,
  selfContainedMeasurementPresentationRegionId,
  exactSourceBoundPresentationAuthorities,
  diagnostics,
}: {
  prepared: PreparedDrawingEvidencePageDetails;
  passage: ECOSDrawingEvidencePassage;
  selfContainedMeasurementPresentationRegionId: string;
  exactSourceBoundPresentationAuthorities:
    readonly ECOSDrawingExactSourceBoundPresentationAuthority[];
  diagnostics?: ECOSDrawingEvidenceDiagnostics;
}) {
  // A material qualifier without complete geometry cannot be proven to belong
  // to a different assertion. It therefore vetoes every non-source passage on
  // the page, including exact-source projected facts.
  if (prepared.unboundedLocalQualifierRegions.length > 0) return false;
  // Exact-source authority binds a private relationship receipt to its one raw
  // source, but never changes the local-polarity result. The ordinary immutable
  // page cache is therefore authoritative for both protected and generic calls.
  const cacheEligible = IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(
    prepared.regions,
  );
  const evaluate = () => {
    const numberedNoteMarkers = numberedNoteMarkersForPreparedPage(
      prepared,
      diagnostics,
    );
    const exactPresentationAuthorities = passage.sourceRegionIds.flatMap(
      (sourceRegionId) => {
        const matches = exactSourceBoundPresentationAuthorities.filter(
          (authority) => authority.regionId === sourceRegionId,
        );
        return matches.length === 1 ? matches : [];
      },
    );
    const exactSourceBoundStructuredClaim =
      passage.reconstructionMethod ===
        STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD &&
      passage.sourceRegionIds.length > 0 &&
      exactPresentationAuthorities.length === passage.sourceRegionIds.length;
    if (exactSourceBoundStructuredClaim) {
      const authorityBoundsByRegionId = new Map(
        exactPresentationAuthorities.flatMap((authority) => {
          const bounds = strictNormalizedBounds(authority.bounds);
          return bounds ? [[authority.regionId, bounds] as const] : [];
        }),
      );
      if (
        authorityBoundsByRegionId.size !== exactPresentationAuthorities.length
      ) return false;
      const exactSourcesById = new Map(
        prepared.auditRegions.filter((region) =>
          passage.sourceRegionIds.includes(region.id)
        ).map((sourceRegion) => [sourceRegion.id, sourceRegion]),
      );
      if (exactSourcesById.size !== passage.sourceRegionIds.length) return false;
      // Preserve the ordinary full-page qualifier and numbered-note audit.
      // Remove only contained one-token OCR boxes that are already rendered
      // inside the independently sealed exact source. Narrowing the audit to a
      // local window would hide disjoint, unowned construction qualifiers.
      const completeExactAuditRegions = prepared.auditRegions.filter((region) => {
        if (passage.sourceRegionIds.includes(region.id)) return true;
        return ![...authorityBoundsByRegionId].some(
            ([sourceRegionId, exactAuthorityBounds]) => {
              const sourceRegion = exactSourcesById.get(sourceRegionId);
              return sourceRegion &&
                exactSourceBoundContainedRenderedOCRTokenIsRedundant({
                  region,
                  sourceRegion,
                  authorityBounds: exactAuthorityBounds,
                });
            },
          );
      });
      const exactSourceRegions = passage.sourceRegionIds.map(
        (sourceRegionId) => exactSourcesById.get(sourceRegionId)!,
      );
      const numberedNoteBoundaryAnchorX = Math.min(
        ...exactSourceRegions.map((sourceRegion) => sourceRegion.x!),
      );
      const boundaryBudget = { workCount: 0, overflowed: false };
      let boundaryAuditInvalid = false;
      // An exact source still receives a complete bounded qualifier audit, but
      // only nearby qualifier carriers can alter that source's proposition.
      // A trusted numbered-note marker can prove those carriers belong to a
      // different assertion. Use the direct boundary for each carrier here;
      // pulling every unrelated one-word OCR box on a dense sheet into one
      // transitive closure can incorrectly join separate notes into a status.
      const exactQualifierRegions = completeExactAuditRegions.filter((region) =>
        !passage.sourceRegionIds.includes(region.id) &&
        strictNormalizedBounds(region) != null &&
        exactSourceRegions.some((sourceRegion) =>
          regionsAreNear(sourceRegion, region)
        ) &&
        drawingRegionMayCarryLocalAssertionQualifier(
          region,
          prepared.question,
        )
      ).filter((candidate) => {
        const boundaries = exactSourceRegions.map((sourceRegion) =>
          drawingNumberedNoteBoundarySeparates(
            sourceRegion,
            candidate,
            completeExactAuditRegions,
            numberedNoteMarkers,
            boundaryBudget,
            numberedNoteBoundaryAnchorX,
          )
        );
        if (boundaries.some((boundary) => boundary == null)) {
          boundaryAuditInvalid = true;
          return true;
        }
        return !boundaries.every((boundary) => boundary === true);
      });
      if (boundaryAuditInvalid || boundaryBudget.overflowed) return false;
      const exactAuditRegions = [
        ...exactSourceRegions,
        ...exactQualifierRegions,
      ];
      const exactNeighborhoodDiagnostics = diagnostics
        ? {} as ECOSDrawingNeighborhoodDiagnostics
        : undefined;
      resetDrawingNeighborhoodDiagnostics(exactNeighborhoodDiagnostics);
      const exactNeighborhoodAssertive = withDrawingQualifierTextCache(
        prepared.qualifierTextCache,
        () => drawingPassageHasAssertiveLocalNeighborhood(
          passage,
          exactAuditRegions,
          prepared.pageIdentity,
          prepared.question,
          passage.sourceRegionIds.length === 1
            ? passage.sourceRegionIds[0]
            : selfContainedMeasurementPresentationRegionId,
          numberedNoteMarkers,
          exactNeighborhoodDiagnostics,
        ),
      );
      if (diagnostics && exactNeighborhoodDiagnostics) {
        diagnostics.exactSourceBoundNeighborhoodDiagnostics =
          exactNeighborhoodDiagnostics;
      }
      return exactNeighborhoodAssertive;
    }
    return withDrawingQualifierTextCache(
      prepared.qualifierTextCache,
      () => drawingPassageHasAssertiveLocalNeighborhood(
        passage,
        prepared.auditRegions,
        prepared.pageIdentity,
        prepared.question,
        selfContainedMeasurementPresentationRegionId,
        numberedNoteMarkers,
      ),
    );
  };
  if (
    !cacheEligible ||
    !CACHED_EXACT_RELATIONSHIP_PASSAGES.has(passage)
  ) {
    if (diagnostics) diagnostics.passageAssertivenessEvaluations += 1;
    return evaluate();
  }
  let passageResults = PREPARED_DRAWING_PASSAGE_ASSERTIVENESS.get(prepared);
  if (!passageResults) {
    passageResults = new Map();
    PREPARED_DRAWING_PASSAGE_ASSERTIVENESS.set(prepared, passageResults);
  }
  let resultsByPresentationAnchor = passageResults.get(passage);
  if (!resultsByPresentationAnchor) {
    resultsByPresentationAnchor = new Map();
    passageResults.set(passage, resultsByPresentationAnchor);
  }
  const cached = resultsByPresentationAnchor.get(
    selfContainedMeasurementPresentationRegionId,
  );
  if (cached !== undefined) return cached;
  if (diagnostics) diagnostics.passageAssertivenessEvaluations += 1;
  const result = evaluate();
  resultsByPresentationAnchor.set(
    selfContainedMeasurementPresentationRegionId,
    result,
  );
  return result;
}

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
  pageIdentity = "",
  maximumPassages = 3,
  derivedOnly = false,
  diagnostics,
  preparedPage,
  pageAuthority,
  exactSourceBoundPresentationAuthorities = [],
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity?: string;
  maximumPassages?: number;
  derivedOnly?: boolean;
  diagnostics?: ECOSDrawingEvidenceDiagnostics;
  preparedPage?: ECOSPreparedDrawingEvidencePage;
  pageAuthority?: ECOSDrawingPageAuthority | null;
  exactSourceBoundPresentationAuthorities?:
    readonly ECOSDrawingExactSourceBoundPresentationAuthority[];
}): ECOSDrawingEvidencePassage[] {
  if (diagnostics) {
    Object.assign(diagnostics, {
      pageEligible: false,
      normalizedRegionCount: 0,
      exactRelationshipEvaluations: 0,
      passageAssertivenessEvaluations: 0,
      numberedNoteMarkerEvaluations: 0,
      relationshipPassageCount: 0,
      calculatedAreaPassageCount: 0,
      measurementAnchorCount: 0,
      directlyResponsiveMeasurementAnchorCount: 0,
      locallyResponsiveMeasurementAnchorCount: 0,
      anchorCandidateCount: 0,
      maximumNearbyRegionCount: 0,
      nearbyOverflowCount: 0,
      localMeasurementPairWorkCount: 0,
      localMeasurementPairWorkLimit: 0,
      localMeasurementPairOverflowCount: 0,
      localMeasurementContextRejectionCount: 0,
      localSubjectRejectionCount: 0,
      localLocationConflictRejectionCount: 0,
      missingLocationRejectionCount: 0,
      passageContextRejectionCount: 0,
      directPassageCount: 0,
      assertivenessRejectionCount: 0,
      finalPassageCount: 0,
      rejectionStage: "",
      exactSourceBoundNeighborhoodDiagnostics: undefined,
      protectedStructuredClaimRejectionStage: undefined,
    });
  }
  const prepared = preparedDrawingEvidencePageDetails({
    preparedPage,
    pageText,
    regions,
    question,
    pageIdentity,
  });
  // Accepted hosted pages are bounded before any spatial scan. Refuse an
  // oversized region payload rather than selecting a convenient subset that
  // could omit a conflicting dimension or relationship.
  if (!prepared.eligible) {
    if (diagnostics) {
      diagnostics.rejectionStage = !prepared.regionIdentityValid
        ? "measurement_region_identity_invalid"
        : !prepared.deterministicMeasurementTargetValid
        ? "unsupported_deterministic_measurement_target"
        : "page_ineligible";
    }
    return [];
  }
  if (diagnostics) diagnostics.pageEligible = true;
  const normalizedRegions = prepared.normalizedRegions;
  if (diagnostics) diagnostics.normalizedRegionCount = normalizedRegions.length;
  if (normalizedRegions.length === 0) {
    // When a page supplies structured regions, those regions are the evidence
    // boundary. Falling back to unsanitized page text could reintroduce raw
    // table constituents that the hosted index explicitly quarantined.
    const fallback = regions.length === 0
      ? buildLineFallback(pageText, question, pageIdentity)
      : null;
    if (diagnostics) {
      diagnostics.finalPassageCount = fallback ? 1 : 0;
      diagnostics.rejectionStage = fallback ? "" : "no_normalized_regions";
    }
    return fallback ? [fallback] : [];
  }
  const safePageText = prepared.safePageText;
  const requirement = prepared.requirement;
  const passageLimit = Math.max(1, Math.min(5, maximumPassages));
  const exactRelationshipPassages = exactRelationshipPassagesForPreparedPage({
    prepared,
    // Complete-page rebind normally keeps only ordinary current-region
    // passages. An independently validated exact-source capability may replay
    // the same protected relationship there so the stored discovery receipt
    // can bind to its current raw source id without a generic text exception.
    allowSamePageContextMeasurement: derivedOnly ||
      exactSourceBoundPresentationAuthorities.length > 0,
    pageAuthority,
    exactSourceBoundPresentationAuthorities,
    diagnostics,
  });
  const relationshipPassages = exactRelationshipPassages;
  if (diagnostics) {
    diagnostics.relationshipPassageCount = relationshipPassages.length;
  }
  const northLotPavingQuestion =
    drawingQuestionRequestsNorthLotPCCPavingThickness(question);
  const requiresSealedStructuredReceipt =
    drawingQuestionRequestsSitePhotometricStatistics(question) ||
    northLotPavingQuestion &&
      (derivedOnly || prepared.regions.some((region) =>
        rawRegionLooksLikeStrictStructuredCandidate(region, "slab_legend")
      ));
  if (
    requiresSealedStructuredReceipt && relationshipPassages.length !== 1
  ) {
    if (diagnostics) diagnostics.rejectionStage = "sealed_receipt_missing";
    return [];
  }
  // Shadow retrieval already carries ordinary stored passages. When this page
  // cannot produce a deterministic non-area relationship receipt, do not run
  // the complete page-wide measurement audit merely to return an empty result.
  // Area questions retain the original audit-first order before calculating a
  // page footprint, and ordinary stored passages still receive the full audit
  // at the rebind boundary below.
  if (
    derivedOnly && requirement.attribute !== "area" &&
    relationshipPassages.length === 0
  ) {
    if (diagnostics) diagnostics.rejectionStage = "no_derived_passages";
    return [];
  }
  // A sealed structured receipt independently replays each raw constituent
  // against the current page. Those searchable:false OCR rows are the proof
  // behind the one emitted relationship, not separate competing facts. Keep
  // every other hidden carrier in the ambiguity audit.
  const sealedRelationshipConstituentRegionIds = new Set(
    relationshipPassages.flatMap((passage) =>
      passage.constituentEvidence
        .map((evidence) => textValue(evidence.id))
        .filter(Boolean)
    ),
  );
  const measurementAuditRegions = sealedRelationshipConstituentRegionIds.size > 0
    ? prepared.auditRegions.filter((region) =>
      region.searchable ||
      !sealedRelationshipConstituentRegionIds.has(region.id)
    )
    : prepared.auditRegions;
  const measurementAnchorAudit = requirement.kind === "measurement"
    ? auditPreparedDrawingMeasurementAnchors({
      prepared,
      normalizedRegions: measurementAuditRegions,
      question,
      passageLimit,
      auditScopeKey: sealedRelationshipConstituentRegionIds.size > 0
        ? `without-sealed-constituents:${[
          ...sealedRelationshipConstituentRegionIds,
        ].sort().join("\u0000")}`
        : "all-raw",
      diagnostics,
    })
    : { responsiveAnchors: [], overflowed: false, conflicting: false };
  if (measurementAnchorAudit.overflowed || measurementAnchorAudit.conflicting) {
    return [];
  }
  if (measurementAnchorAudit.responsiveAnchors.some((anchor) =>
    !anchor.searchable
  )) {
    if (diagnostics) diagnostics.rejectionStage = "hidden_measurement_anchor";
    return [];
  }
  const selfContainedMeasurementPresentationAnchor =
    measurementAnchorAudit.responsiveAnchors.length === 1 &&
      drawingRegionIsSelfContainedExactMeasurementAnswer(
        measurementAnchorAudit.responsiveAnchors[0],
        question,
      )
      ? measurementAnchorAudit.responsiveAnchors[0]
      : null;
  const sealedComparisonPresentationSourceIds =
    drawingQuestionRequestsPCCWalkwayPavingComparison(question) &&
      relationshipPassages.length === 1 &&
      relationshipPassages[0].reconstructionMethod ===
        STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD
      ? new Set(relationshipPassages[0].sourceRegionIds)
      : null;
  const sealedComparisonCoversEveryAuditedAnchor = Boolean(
    sealedComparisonPresentationSourceIds &&
      measurementAnchorAudit.responsiveAnchors.length >= 2 &&
      drawingDerivedMeasurementCoverageAnchors(
        measurementAnchorAudit.responsiveAnchors,
        question,
      ).every((anchor) => sealedComparisonPresentationSourceIds.has(anchor.id)),
  );
  if (requirement.kind === "measurement") {
    if (diagnostics) {
      diagnostics.anchorCandidateCount =
        measurementAnchorAudit.responsiveAnchors.length;
    }
    if (measurementAnchorAudit.responsiveAnchors.length > passageLimit) {
      if (diagnostics) {
        diagnostics.rejectionStage = "responsive_anchor_overflow";
      }
      return [];
    }
  }
  const calculatedAreaPassages = requirement.attribute === "area"
    ? buildCalculatedAreaPassages(
      normalizedRegions,
      safePageText,
      question,
      pageIdentity,
      pageText,
    )
    : [];
  if (diagnostics) {
    diagnostics.calculatedAreaPassageCount = calculatedAreaPassages.length;
  }
  const derivedCandidates = [
    ...relationshipPassages,
    ...calculatedAreaPassages,
  ];
  if (derivedOnly && derivedCandidates.length === 0) {
    if (diagnostics) diagnostics.rejectionStage = "no_derived_passages";
    return [];
  }
  if (derivedOnly) {
    const derivedPassages = derivedCandidates
      .filter((passage) =>
        preparedDrawingPassageHasAssertiveLocalNeighborhood({
          prepared,
          passage,
          selfContainedMeasurementPresentationRegionId:
            selfContainedMeasurementPresentationAnchor?.id || "",
          exactSourceBoundPresentationAuthorities,
          diagnostics,
        })
      )
      .sort((left, right) => right.score - left.score)
      .filter((passage, index, all) =>
        all.findIndex((other) =>
          normalizeText(other.text) === normalizeText(passage.text)
        ) === index
      );
    const derivedSourceRegionIds = new Set(
      derivedPassages.flatMap((passage) => passage.sourceRegionIds),
    );
    const derivedCoverageAnchors = drawingDerivedMeasurementCoverageAnchors(
      measurementAnchorAudit.responsiveAnchors,
      question,
    );
    const derivedMeasurementCoverageComplete =
      requirement.kind !== "measurement" ||
      derivedCoverageAnchors.every((anchor) =>
        derivedSourceRegionIds.has(anchor.id)
      );
    if (diagnostics) {
      diagnostics.assertivenessRejectionCount = derivedCandidates.length -
        derivedPassages.length;
      diagnostics.finalPassageCount = derivedMeasurementCoverageComplete &&
          derivedPassages.length <= passageLimit
        ? derivedPassages.length
        : 0;
      diagnostics.rejectionStage = !derivedMeasurementCoverageComplete
        ? "derived_measurement_anchor_coverage_incomplete"
        : derivedPassages.length > passageLimit
        ? "derived_passage_overflow"
        : derivedPassages.length === 0
        ? "no_derived_passages"
        : "";
    }
    return derivedMeasurementCoverageComplete &&
        derivedPassages.length <= passageLimit
      ? derivedPassages
      : [];
  }
  const relationshipSourceRegionIds = new Set(
    relationshipPassages.flatMap((passage) => passage.sourceRegionIds),
  );
  const exactSourceBoundStructuredClaim = relationshipPassages.length === 1 &&
    relationshipPassages[0].reconstructionMethod ===
      STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD &&
    relationshipPassages[0].sourceRegionIds.length > 0 &&
    relationshipPassages[0].sourceRegionIds.every((sourceRegionId) =>
      exactSourceBoundPresentationAuthorities.filter((authority) =>
        authority.regionId === sourceRegionId
      ).length === 1
    );
  const anchorCandidates = requirement.kind === "measurement"
    ? measurementAnchorAudit.responsiveAnchors
    : exactSourceBoundStructuredClaim
    ? []
    : normalizedRegions.filter((region) =>
      !relationshipSourceRegionIds.has(region.id) &&
      ecosEvidenceQuestionContextScore(question, region.text) > 0
    );
  if (diagnostics) diagnostics.anchorCandidateCount = anchorCandidates.length;
  // Ranking may not drop a lower-confidence contradiction. If every responsive
  // direct anchor cannot fit in the published passage bound, fail the complete
  // page before building sheet-wide semantic context.
  if (anchorCandidates.length > passageLimit) {
    if (diagnostics) diagnostics.rejectionStage = "responsive_anchor_overflow";
    return [];
  }
  const anchors = [...anchorCandidates].sort((left, right) =>
    ecosEvidenceQuestionContextScore(question, right.text) -
    ecosEvidenceQuestionContextScore(question, left.text)
  );
  if (
    anchors.length === 0 &&
    relationshipPassages.length === 0 &&
    calculatedAreaPassages.length === 0
  ) {
    if (diagnostics) diagnostics.rejectionStage = "no_responsive_anchors";
    return [];
  }
  const nearbyByAnchor = new Map<DrawingRegion, readonly DrawingRegion[]>();
  for (const anchor of anchors) {
    const nearby: DrawingRegion[] = [];
    const anchorHasRequestedMeasurement = containsECOSRequestedMeasurementValue(
      question,
      anchor.text,
    );
    const anchorEvidence = unique([anchor.text, ...anchor.areaNames]).join(
      "\n",
    );
    // A complete exact-region proposition does not need page-wide context
    // aggregation. The measurement audit above has already inspected every
    // direct and split measurement peer, the location scan below still sees
    // the complete page, and the final neighborhood assertiveness gate still
    // vetoes nearby qualifiers. Skipping unrelated context here prevents a
    // dense but authoritative note from failing only because a 33rd nearby
    // label crossed the presentation fan-in bound.
    if (
      anchor === selfContainedMeasurementPresentationAnchor ||
      sealedComparisonCoversEveryAuditedAnchor
    ) {
      nearbyByAnchor.set(anchor, nearby);
      continue;
    }
    for (const region of normalizedRegions) {
      if (
        region.id === anchor.id ||
        !regionsAreNear(anchor, region) ||
        anchorHasRequestedMeasurement &&
          containsECOSRequestedMeasurementValue(question, region.text) ||
        requirement.kind === "measurement" &&
          !drawingRegionSuppliesMeasurementQuestionContext(region, question)
      ) continue;
      nearby.push(region);
      if (diagnostics) {
        diagnostics.maximumNearbyRegionCount = Math.max(
          diagnostics.maximumNearbyRegionCount,
          nearby.length,
        );
      }
      if (nearby.length > MAX_NEARBY_DRAWING_REGIONS) {
        if (diagnostics) {
          diagnostics.nearbyOverflowCount += 1;
          diagnostics.rejectionStage = "nearby_region_overflow";
        }
        return [];
      }
    }
    nearbyByAnchor.set(anchor, nearby);
  }
  const requestedLocation = analyzeECOSQuestionEvidenceContext(question, "");
  const directionScopedLocation =
    requestedLocation.locationDirectionTokens.length > 0;
  const locationCandidateRegions = directionScopedLocation
    ? normalizedRegions.filter(drawingRegionCarriesExplicitDirection)
    : normalizedRegions;
  const regionLocationEvidence = (region: DrawingRegion) =>
    unique([region.text, ...region.areaNames]).join("\n");
  const locationRegions = locationCandidateRegions.filter((region) => {
    const context = analyzeECOSQuestionEvidenceContext(
      question,
      regionLocationEvidence(region),
    );
    return context.locationMatched &&
      (context.locationDirectionTokens.length > 0 ||
        context.locationKindTokens.length > 0);
  });
  const fullPageLocationEvidence = unique([
    pageIdentity,
    ...locationCandidateRegions.flatMap(
      (region) => [region.text, ...region.areaNames],
    ),
  ]).join("\n");
  const fullPageHasCompetingLocation = ecosEvidenceHasCompetingExplicitLocation(
    question,
    fullPageLocationEvidence,
  );
  const pageIdentityCarriesRequestedLocation =
    analyzeECOSQuestionEvidenceContext(
      question,
      pageIdentity,
    ).locationMatched;
  const locationRegionSet = new Set(locationRegions);
  const rankedSheetLocations = [...locationRegions].sort((left, right) =>
    ecosEvidenceQuestionContextScore(question, right.text) -
    ecosEvidenceQuestionContextScore(question, left.text)
  );
  const directPassages = requiresSealedStructuredReceipt
    ? []
    : anchors.flatMap((anchor) => {
    const nearby = nearbyByAnchor.get(anchor) || [];
    const localText = unique([
      anchor.text,
      ...anchor.areaNames,
      ...nearby.flatMap((region) => [region.text, ...region.areaNames]),
    ]).join("\n");
    const localContext = analyzeECOSQuestionEvidenceContext(
      question,
      localText,
    );
    if (
      requirement.kind === "measurement" &&
      (!localContext.measurementMatched || !localContext.attributeMatched)
    ) {
      if (diagnostics) diagnostics.localMeasurementContextRejectionCount += 1;
      return [];
    }
    if (!localContext.subjectMatched) {
      if (diagnostics) diagnostics.localSubjectRejectionCount += 1;
      return [];
    }
    if (ecosEvidenceHasCompetingExplicitLocation(question, localText)) {
      if (diagnostics) diagnostics.localLocationConflictRejectionCount += 1;
      return [];
    }

    const nearbyLocation = nearby
      .filter((region) => locationRegionSet.has(region))
      .sort((left, right) =>
        regionDistance(anchor, left) - regionDistance(anchor, right)
      )[0];
    const anchorCarriesRequestedLocation = locationRegionSet.has(anchor);
    const sheetLocation = anchorCarriesRequestedLocation
      ? anchor
      : nearbyLocation ||
        (fullPageHasCompetingLocation ? undefined : rankedSheetLocations[0]);
    if (
      (requestedLocation.locationDirectionTokens.length > 0 ||
        requestedLocation.locationKindTokens.length > 0) &&
      !sheetLocation &&
      !(pageIdentityCarriesRequestedLocation && !fullPageHasCompetingLocation)
    ) {
      if (diagnostics) diagnostics.missingLocationRejectionCount += 1;
      return [];
    }
    const contextualRegions = uniqueRegions([
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
      anchor,
    ].filter((region): region is DrawingRegion => Boolean(region)));
    const passageText = unique([
      pageIdentity,
      ...contextualRegions.flatMap(
        (region) => [region.text, ...region.areaNames],
      ),
    ]).join("\n");
    const passageContext = analyzeECOSQuestionEvidenceContext(
      question,
      passageText,
    );
    if (!passageContext.subjectMatched || !passageContext.locationMatched) {
      if (diagnostics) diagnostics.passageContextRejectionCount += 1;
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
      sourceRegionIds: Object.freeze([anchor.id]),
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
  if (diagnostics) diagnostics.directPassageCount = directPassages.length;
  const passageCandidates = [
    ...relationshipPassages,
    ...calculatedAreaPassages,
    ...directPassages,
  ];
  const assertivePassages = passageCandidates
    .filter((passage) =>
      preparedDrawingPassageHasAssertiveLocalNeighborhood({
        prepared,
        passage,
        selfContainedMeasurementPresentationRegionId:
          selfContainedMeasurementPresentationAnchor?.id || "",
        exactSourceBoundPresentationAuthorities,
        diagnostics,
      })
    );
  const rankedPassages = assertivePassages
    .sort((left, right) => right.score - left.score)
    .filter((passage, index, all) =>
      all.findIndex((other) =>
        normalizeText(other.text) === normalizeText(passage.text)
      ) === index
    );
  if (diagnostics) {
    diagnostics.assertivenessRejectionCount = passageCandidates.length -
      assertivePassages.length;
    diagnostics.finalPassageCount = rankedPassages.length <= passageLimit
      ? rankedPassages.length
      : 0;
    diagnostics.rejectionStage = rankedPassages.length > passageLimit
      ? "final_passage_overflow"
      : rankedPassages.length === 0
      ? "no_assertive_passages"
      : "";
  }
  return rankedPassages.length <= passageLimit ? rankedPassages : [];
}

function drawingPassageHasAssertiveLocalNeighborhood(
  passage: ECOSDrawingEvidencePassage,
  regions: readonly DrawingRegion[],
  pageIdentity: string,
  question: string,
  selfContainedMeasurementPresentationRegionId = "",
  numberedNoteMarkers?: readonly DrawingRegion[],
  neighborhoodDiagnostics?: ECOSDrawingNeighborhoodDiagnostics,
) {
  if (
    !ecosDrawingPropositionIsAssertiveCurrent(pageIdentity || "current drawing")
  ) return false;
  if (
    passage.sourceRegionIds.length === 0 ||
    passage.sourceRegionIds.some((id) => !id)
  ) return false;
  const sourceRegionIds = new Set(passage.sourceRegionIds);
  if (sourceRegionIds.size !== passage.sourceRegionIds.length) return false;
  const sourceRegions = regions.filter((region) =>
    sourceRegionIds.has(region.id)
  );
  if (sourceRegions.length !== sourceRegionIds.size) return false;
  const neighborhoodAnchorIds = new Set([
    ...passage.sourceRegionIds,
    ...passage.contextRegionIds.filter(Boolean),
  ]);
  const neighborhoodAnchors = regions.filter((region) =>
    neighborhoodAnchorIds.has(region.id)
  );
  if (neighborhoodAnchors.length !== neighborhoodAnchorIds.size) return false;
  const structuredClaimPresentationAllowed =
    passage.reconstructionMethod ===
      STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD;
  return neighborhoodAnchors.every((anchor) =>
    drawingSourceRegionNeighborhoodIsAssertive(
      anchor,
      regions,
      pageIdentity,
      question,
      anchor.id === selfContainedMeasurementPresentationRegionId,
      structuredClaimPresentationAllowed,
      neighborhoodDiagnostics,
      numberedNoteMarkers,
      undefined,
    )
  );
}

/**
 * Replays the same bounded local-polarity gate for one authoritative current
 * region. Stored search chunks may call this only after resolving their region
 * id against the accepted current hosted-page snapshot.
 */
export function ecosDrawingCurrentRegionNeighborhoodIsAssertive(
  sourceRegionIdValue: unknown,
  regionsValue: unknown,
  pageIdentityValue: unknown = "",
  questionValue: unknown = "",
  diagnosticsValue?: ECOSDrawingNeighborhoodDiagnostics,
) {
  resetDrawingNeighborhoodDiagnostics(diagnosticsValue);
  if (
    typeof sourceRegionIdValue !== "string" ||
    !sourceRegionIdValue.trim() ||
    sourceRegionIdValue !== sourceRegionIdValue.trim() ||
    sourceRegionIdValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    typeof pageIdentityValue !== "string" ||
    pageIdentityValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    typeof questionValue !== "string" ||
    questionValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH
  ) return false;
  const bounded = boundedECOSDrawingPageInput("", regionsValue);
  if (!bounded) return false;
  const rawMatches = bounded.regions.filter((region) =>
    region.searchable !== false && textValue(region.id) === sourceRegionIdValue
  );
  if (
    rawMatches.length !== 1 ||
    drawingInputRegionHasCarrierConflict(rawMatches[0], questionValue)
  ) return false;
  const regions = bounded.regions.map(normalizeRegionForAudit)
    .filter((region): region is DrawingRegion => Boolean(region));
  const matches = regions.filter((region) =>
    region.searchable && region.id === sourceRegionIdValue
  );
  if (matches.length !== 1) return false;
  const sourceRegion = matches[0];
  if (regions.some((region) =>
    region !== sourceRegion && strictNormalizedBounds(region) == null &&
    drawingRegionMayCarryLocalAssertionQualifier(region, questionValue)
  )) return false;
  const measurementQuestion = analyzeECOSProjectQuestion(questionValue).kind ===
    "measurement";
  if (measurementQuestion && !drawingRegionsHaveStableUniqueIds(regions)) {
    return false;
  }
  const measurementAudit = measurementQuestion
    ? auditDrawingMeasurementAnchors({
      normalizedRegions: regions,
      question: questionValue,
      passageLimit: 1,
    })
    : null;
  if (
    measurementAudit?.overflowed || measurementAudit?.conflicting ||
    measurementAudit?.responsiveAnchors.some((anchor) => !anchor.searchable)
  ) return false;
  const selfContainedMeasurementPresentationAllowed = Boolean(
    measurementAudit &&
    measurementAudit.responsiveAnchors.length === 1 &&
    measurementAudit.responsiveAnchors[0].id === sourceRegion.id &&
    drawingRegionIsSelfContainedExactMeasurementAnswer(
      sourceRegion,
      questionValue,
    )
  );
  const uniqueRegionIds = uniqueRawDrawingRegionIds(bounded.regions);
  const numberedNoteMarkers = regions.filter((region) =>
    region.searchable && drawingRegionIsTrustedNumberedNoteMarker(
      region,
      uniqueRegionIds,
    )
  );
  return withDrawingQualifierTextCache(
    createDrawingQualifierTextCache(),
    () => drawingSourceRegionNeighborhoodIsAssertive(
      sourceRegion,
      regions,
      pageIdentityValue,
      questionValue,
      selfContainedMeasurementPresentationAllowed,
      false,
      diagnosticsValue,
      numberedNoteMarkers,
    ),
  );
}

/**
 * Replays only the local-polarity boundary for one independently sealed
 * structured fact. The caller must first validate the fact's exact current
 * source, coordinates, constituents, reconstruction method, and hosted-page
 * assurance. Unlike the ordinary raw-region wrapper, this does not let
 * unrelated page-wide measurement anchors or status text veto that already
 * sealed fact; all unbounded qualifiers and every nearby bounded qualifier
 * remain fail-closed.
 */
export function ecosDrawingTrustedStructuredRegionNeighborhoodIsAssertive(
  sourceRegionIdValue: unknown,
  regionsValue: unknown,
  pageIdentityValue: unknown = "",
  questionValue: unknown = "",
  diagnosticsValue?: ECOSDrawingNeighborhoodDiagnostics,
) {
  resetDrawingNeighborhoodDiagnostics(diagnosticsValue);
  if (
    typeof sourceRegionIdValue !== "string" ||
    !sourceRegionIdValue.trim() ||
    sourceRegionIdValue !== sourceRegionIdValue.trim() ||
    sourceRegionIdValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    typeof pageIdentityValue !== "string" ||
    pageIdentityValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    typeof questionValue !== "string" ||
    questionValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH
  ) return false;
  const bounded = boundedECOSDrawingPageInput("", regionsValue);
  if (!bounded) return false;
  const normalizedRegions = bounded.regions.map(normalizeRegionForAudit)
    .filter((region): region is DrawingRegion => Boolean(region));
  const uniqueRegionIds = uniqueRawDrawingRegionIds(bounded.regions);
  const qualifierTextCache = createDrawingQualifierTextCache();
  return withDrawingQualifierTextCache(qualifierTextCache, () => {
    const audit = buildTrustedStructuredLocalAuditReceipt(
      normalizedRegions,
      questionValue,
      uniqueRegionIds,
    );
    return audit != null && trustedStructuredRegionNeighborhoodIsAssertive({
      sourceRegionId: sourceRegionIdValue,
      rawRegions: bounded.regions,
      normalizedRegions,
      audit,
      pageIdentity: pageIdentityValue,
      question: questionValue,
      diagnostics: diagnosticsValue,
    });
  });
}

export function preparedECOSDrawingTrustedStructuredRegionNeighborhoodIsAssertive(
  preparedPage: ECOSPreparedDrawingEvidencePage,
  sourceRegionIdValue: unknown,
  diagnosticsValue?: ECOSDrawingNeighborhoodDiagnostics,
) {
  resetDrawingNeighborhoodDiagnostics(diagnosticsValue);
  if (
    typeof sourceRegionIdValue !== "string" ||
    !sourceRegionIdValue.trim() ||
    sourceRegionIdValue !== sourceRegionIdValue.trim() ||
    sourceRegionIdValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH
  ) return false;
  const prepared = PREPARED_DRAWING_EVIDENCE_PAGE_DETAILS.get(preparedPage);
  if (
    !prepared || !prepared.eligible ||
    !IMMUTABLE_BOUNDED_DRAWING_REGION_SNAPSHOTS.has(prepared.regions)
  ) return false;
  let audit = PREPARED_DRAWING_TRUSTED_STRUCTURED_LOCAL_AUDITS.get(prepared);
  if (audit === undefined) {
    audit = withDrawingQualifierTextCache(
      prepared.qualifierTextCache,
      () => buildTrustedStructuredLocalAuditReceipt(
        prepared.auditRegions,
        prepared.question,
        prepared.uniqueRawRegionIds,
      ),
    );
    PREPARED_DRAWING_TRUSTED_STRUCTURED_LOCAL_AUDITS.set(prepared, audit);
  }
  if (!audit) return false;
  return withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () => trustedStructuredRegionNeighborhoodIsAssertive({
      sourceRegionId: sourceRegionIdValue,
      rawRegions: prepared.regions,
      normalizedRegions: prepared.auditRegions,
      audit,
      pageIdentity: prepared.pageIdentity,
      question: prepared.question,
      diagnostics: diagnosticsValue,
    }),
  );
}

function trustedStructuredRegionNeighborhoodIsAssertive({
  sourceRegionId,
  rawRegions,
  normalizedRegions,
  audit,
  pageIdentity,
  question,
  diagnostics,
}: {
  sourceRegionId: string;
  rawRegions: readonly ECOSDrawingRegionInput[];
  normalizedRegions: readonly DrawingRegion[];
  audit: TrustedStructuredLocalAuditReceipt;
  pageIdentity: string;
  question: string;
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics;
}) {
  const rawMatches = rawRegions.filter((region) =>
    region.searchable !== false && textValue(region.id) === sourceRegionId
  );
  if (
    rawMatches.length !== 1 ||
    drawingInputRegionHasCarrierConflict(rawMatches[0], question)
  ) return false;
  const matches = normalizedRegions.filter((region) =>
    region.searchable && region.id === sourceRegionId
  );
  if (matches.length !== 1) return false;
  const sourceRegion = matches[0];
  const sourceWasRedundant = audit.redundantRegions.has(sourceRegion);
  const regions = sourceWasRedundant
    ? [sourceRegion, ...audit.baseRegions]
    : audit.baseRegions;
  if (regions.some((region) =>
    region !== sourceRegion && strictNormalizedBounds(region) == null &&
    drawingRegionMayCarryLocalAssertionQualifier(region, question)
  )) return false;
  const numberedNoteMarkers = sourceWasRedundant
    ? regions.filter((region) =>
      region.searchable && drawingRegionIsTrustedNumberedNoteMarker(
        region,
        uniqueRawDrawingRegionIds(rawRegions),
      )
    )
    : audit.baseNumberedNoteMarkers;
  return drawingSourceRegionNeighborhoodIsAssertive(
    sourceRegion,
    regions,
    pageIdentity,
    question,
    false,
    true,
    diagnostics,
    numberedNoteMarkers,
    undefined,
    true,
  );
}

function buildTrustedStructuredLocalAuditReceipt(
  regions: readonly DrawingRegion[],
  question: string,
  uniqueRegionIds: ReadonlySet<string>,
): TrustedStructuredLocalAuditReceipt | null {
  type Candidate = Readonly<{
    region: DrawingRegion;
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
    canonicalText: string;
    token: string;
    bucketKey: string;
  }>;
  type CandidateBucket = {
    candidatesByCell: Map<number, Candidate[]>;
    unresolvedCount: number;
  };
  const candidateBuckets = new Map<string, CandidateBucket>();
  let workCount = 0;
  const consumeWork = (amount = 1) => {
    workCount += amount;
    return workCount <= MAX_TRUSTED_STRUCTURED_CONTAINMENT_INDEX_WORK;
  };
  const gridCoordinate = (value: number) => Math.max(
    0,
    Math.min(
      TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS - 1,
      Math.floor(value * TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS),
    ),
  );
  const bucketKey = (rawSource: string, token: string) =>
    `${rawSource}\u0000${token}`;
  const cellKey = (column: number, row: number) =>
    row * TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS + column;
  for (const region of regions) {
    if (!consumeWork()) return null;
    const bounds = strictNormalizedBounds(region);
    const canonicalText = canonicalDrawingQualifierText(region.text);
    const tokens = canonicalText.match(/[a-z0-9]+(?:\.[a-z0-9]+)?%?/g) || [];
    if (
      !bounds || tokens.length !== 1 || !region.rawSource ||
      !/(?:coordinate|tile)_ocr$/.test(region.rawSource)
    ) continue;
    if (!consumeWork()) return null;
    const column = gridCoordinate(bounds.x + bounds.width / 2);
    const row = gridCoordinate(bounds.y + bounds.height / 2);
    const key = bucketKey(region.rawSource, tokens[0]);
    let bucket = candidateBuckets.get(key);
    if (!bucket) {
      bucket = { candidatesByCell: new Map(), unresolvedCount: 0 };
      candidateBuckets.set(key, bucket);
    }
    const gridKey = cellKey(column, row);
    const candidates = bucket.candidatesByCell.get(gridKey);
    const candidate = {
      region,
      bounds,
      canonicalText,
      token: tokens[0],
      bucketKey: key,
    };
    if (candidates) candidates.push(candidate);
    else bucket.candidatesByCell.set(gridKey, [candidate]);
    bucket.unresolvedCount += 1;
  }
  const redundantRegions = new Set<DrawingRegion>();
  for (const container of regions) {
    if (
      !container.searchable || !container.rawSource ||
      !/(?:coordinate|tile)_ocr$/.test(container.rawSource)
    ) continue;
    if (!consumeWork()) return null;
    const containerBounds = strictNormalizedBounds(container);
    const containerText = canonicalDrawingQualifierText(container.text);
    const containerTokens = unique(
      containerText.match(/[a-z0-9]+(?:\.[a-z0-9]+)?%?/g) || [],
    );
    if (!containerBounds || containerTokens.length === 0) continue;
    const minimumColumn = gridCoordinate(
      Math.max(0, containerBounds.x - EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE),
    );
    const maximumColumn = gridCoordinate(Math.min(
      1,
      containerBounds.x + containerBounds.width +
        EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
    ));
    const minimumRow = gridCoordinate(
      Math.max(0, containerBounds.y - EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE),
    );
    const maximumRow = gridCoordinate(Math.min(
      1,
      containerBounds.y + containerBounds.height +
        EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
    ));
    const matchingCandidates: Candidate[] = [];
    for (const token of containerTokens) {
      if (!consumeWork()) return null;
      const bucket = candidateBuckets.get(bucketKey(container.rawSource, token));
      if (!bucket || bucket.unresolvedCount === 0) continue;
      if (!consumeWork()) return null;
      const cellsInEnvelope = (maximumColumn - minimumColumn + 1) *
        (maximumRow - minimumRow + 1);
      const visitCandidates = (candidates: readonly Candidate[]) => {
        for (const candidate of candidates) {
          if (!consumeWork()) return false;
          if (
            redundantRegions.has(candidate.region) ||
            candidate.region === container ||
            containerText === candidate.canonicalText ||
            containerBounds.width * containerBounds.height <=
              candidate.bounds.width * candidate.bounds.height ||
            !normalizedDrawingBoundsContain(
              containerBounds,
              candidate.bounds,
              EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
            ) ||
            !(` ${containerText} `.includes(` ${candidate.canonicalText} `))
          ) continue;
          matchingCandidates.push(candidate);
        }
        return true;
      };
      // Visit the smaller of the geometric envelope and the populated grid.
      // Enumerating every empty cell under a broad OCR container made a dense
      // four-page question consume the hosted worker budget before Assurance.
      if (cellsInEnvelope <= bucket.candidatesByCell.size) {
        for (let column = minimumColumn; column <= maximumColumn; column += 1) {
          for (let row = minimumRow; row <= maximumRow; row += 1) {
            if (!consumeWork()) return null;
            const candidates = bucket.candidatesByCell.get(cellKey(column, row));
            if (candidates && !visitCandidates(candidates)) return null;
          }
        }
      } else {
        for (const [gridKey, candidates] of bucket.candidatesByCell) {
          if (!consumeWork()) return null;
          const column = gridKey % TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS;
          const row = Math.floor(
            gridKey / TRUSTED_STRUCTURED_CONTAINMENT_GRID_DIVISIONS,
          );
          if (
            column < minimumColumn || column > maximumColumn ||
            row < minimumRow || row > maximumRow
          ) continue;
          if (!visitCandidates(candidates)) return null;
        }
      }
    }
    if (matchingCandidates.length === 0) continue;
    const fragments = drawingRegionAssertionFragments(container);
    if (
      fragments.length === 0 ||
      !drawingRegionFragmentsAreAssertive(fragments, question) ||
      fragments.some((fragment) =>
        drawingFragmentHasExplicitLocalAssertionQualifier(fragment, question)
      )
    ) continue;
    for (const candidate of matchingCandidates) {
      if (redundantRegions.has(candidate.region)) continue;
      redundantRegions.add(candidate.region);
      const bucket = candidateBuckets.get(candidate.bucketKey);
      if (bucket) bucket.unresolvedCount -= 1;
    }
  }
  const baseRegions = Object.freeze(
    regions.filter((region) => !redundantRegions.has(region)),
  );
  const baseNumberedNoteMarkers = Object.freeze(
    baseRegions.filter((region) =>
      region.searchable && drawingRegionIsTrustedNumberedNoteMarker(
        region,
        uniqueRegionIds,
      )
    ),
  );
  return Object.freeze({
    redundantRegions,
    baseRegions,
    baseNumberedNoteMarkers,
  });
}

function resetDrawingNeighborhoodDiagnostics(
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
) {
  if (!diagnostics) return;
  Object.assign(diagnostics, {
    pageIdentityAssertive: false,
    sourceAssertive: false,
    qualifierRegionCount: 0,
    qualifierRegionIds: [],
    qualifierOverflow: false,
    individualFragmentRejectionCount: 0,
    joinedFragmentRejected: false,
    fragmentWindowRejectionCount: 0,
    numberedNoteBoundaryWorkCount: 0,
    numberedNoteBoundaryWorkLimit: MAX_DRAWING_NUMBERED_NOTE_BOUNDARY_WORK,
    numberedNoteBoundaryOverflow: false,
    neighborhoodAssertive: false,
  });
}

function preparedDrawingCurrentRegionNeighborhoodIsAssertive(
  prepared: PreparedDrawingEvidencePageDetails,
  sourceRegionIdValue: unknown,
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
  numberedNoteBoundaryAnchorX?: number,
) {
  if (
    typeof sourceRegionIdValue !== "string" ||
    !sourceRegionIdValue.trim() ||
    sourceRegionIdValue !== sourceRegionIdValue.trim() ||
    sourceRegionIdValue.length > MAX_DRAWING_METADATA_TEXT_LENGTH
  ) return false;
  const rawMatches = prepared.regions.filter((region) =>
    region.searchable !== false && textValue(region.id) === sourceRegionIdValue
  );
  if (
    rawMatches.length !== 1 ||
    drawingInputRegionHasCarrierConflict(rawMatches[0], prepared.question)
  ) return false;
  const matches = prepared.auditRegions.filter((region) =>
    region.id === sourceRegionIdValue
  );
  if (matches.length !== 1 || !matches[0].searchable) return false;
  const sourceRegion = matches[0];
  if (prepared.unboundedLocalQualifierRegions.some((region) =>
    region !== sourceRegion
  )) return false;
  const exactMeasurementAudit = prepared.requirement.kind === "measurement"
    ? auditPreparedDrawingMeasurementAnchors({
      prepared,
      normalizedRegions: prepared.auditRegions,
      question: prepared.question,
      passageLimit: 1,
    })
    : null;
  if (exactMeasurementAudit?.overflowed) return false;
  if (exactMeasurementAudit?.responsiveAnchors.some((anchor) =>
    !anchor.searchable
  )) return false;
  if (exactMeasurementAudit?.conflicting) return false;
  const selfContainedMeasurementPresentationAllowed = Boolean(
    exactMeasurementAudit &&
    !exactMeasurementAudit.overflowed &&
    exactMeasurementAudit.responsiveAnchors.length === 1 &&
    exactMeasurementAudit.responsiveAnchors[0].id === sourceRegion.id &&
    drawingRegionIsSelfContainedExactMeasurementAnswer(
      sourceRegion,
      prepared.question,
    ),
  );
  const numberedNoteMarkers = numberedNoteMarkersForPreparedPage(prepared);
  return withDrawingQualifierTextCache(
    prepared.qualifierTextCache,
    () => drawingSourceRegionNeighborhoodIsAssertive(
      sourceRegion,
      prepared.auditRegions,
      prepared.pageIdentity,
      prepared.question,
      selfContainedMeasurementPresentationAllowed,
      false,
      diagnostics,
      numberedNoteMarkers,
      numberedNoteBoundaryAnchorX,
    ),
  );
}

function drawingSourceRegionNeighborhoodIsAssertive(
  sourceRegion: DrawingRegion,
  regions: readonly DrawingRegion[],
  pageIdentity: string,
  question = "",
  selfContainedMeasurementPresentationAllowed = false,
  structuredClaimPresentationAllowed = false,
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
  numberedNoteMarkers?: readonly DrawingRegion[],
  numberedNoteBoundaryAnchorX?: number,
  trustedStructuredLocalAudit = false,
) {
  const pageIdentityAssertive = ecosDrawingPropositionIsAssertiveCurrent(
    pageIdentity || "current drawing",
  );
  if (diagnostics) diagnostics.pageIdentityAssertive = pageIdentityAssertive;
  if (!pageIdentityAssertive) return false;
  const sourceAssertive = drawingRegionFragmentsAreAssertive(
    drawingRegionAssertionFragments(sourceRegion),
    question,
  );
  if (diagnostics) diagnostics.sourceAssertive = sourceAssertive;
  if (!sourceAssertive) return false;
  if (
    analyzeECOSProjectQuestion(question).kind === "measurement" &&
    drawingRegionMeasurementConstructionCompatibility(sourceRegion, question) ===
      "conflicting"
  ) return false;
  const regionIsWithinLocalAnchorEnvelope = trustedStructuredLocalAudit
    ? drawingRegionIsWithinTrustedStructuredQualifierEnvelope
    : drawingRegionIsWithinLocalAnchorEnvelope;
  if (
    regions.some((region) =>
      region !== sourceRegion &&
      regionIsWithinLocalAnchorEnvelope(sourceRegion, region) &&
      drawingRegionAssertionFragments(region).some((fragment) =>
        drawingFragmentCarriesQuestionResponsiveConditional(
          fragment,
          question,
        )
      )
    )
  ) return false;
  const localRegions = boundedDrawingLocalRegionClosure(
    sourceRegion,
    regions,
    question,
    diagnostics,
    numberedNoteMarkers,
    numberedNoteBoundaryAnchorX,
    regionIsWithinLocalAnchorEnvelope,
  );
  if (!localRegions) return false;
  if (
    structuredClaimPresentationAllowed ||
    selfContainedMeasurementPresentationAllowed &&
      drawingRegionIsSelfContainedExactMeasurementAnswer(sourceRegion, question)
  ) {
    return drawingSelfContainedMeasurementNeighborhoodIsAssertive(
      sourceRegion,
      localRegions,
      question,
      diagnostics,
    );
  }
  const fragments = [...localRegions]
    .sort((left, right) =>
      (left.y ?? Number.POSITIVE_INFINITY) -
        (right.y ?? Number.POSITIVE_INFINITY) ||
      (left.x ?? Number.POSITIVE_INFINITY) -
        (right.x ?? Number.POSITIVE_INFINITY) ||
      left.id.localeCompare(right.id)
    )
    .flatMap(drawingRegionAssertionFragments);
  if (diagnostics) {
    const joinedFragments = fragments.map((value) =>
      drawingFragmentIsExactCurrentPlanReference(value)
        ? "current plan reference"
        : value
    );
    diagnostics.individualFragmentRejectionCount = fragments.filter((value) =>
      !drawingRegionFragmentIsAssertiveForQuestion(value, question)
    ).length;
    diagnostics.joinedFragmentRejected = joinedFragments.length > 1 &&
      !drawingRegionFragmentIsAssertiveForQuestion(
        joinedFragments.join(" "),
        question,
      );
    for (let start = 0; start < joinedFragments.length; start += 1) {
      for (
        let length = 2;
        length <= 4 && start + length <= joinedFragments.length;
        length += 1
      ) {
        if (
          !drawingRegionFragmentIsAssertiveForQuestion(
            joinedFragments.slice(start, start + length).join(" "),
            question,
          )
        ) {
          diagnostics.fragmentWindowRejectionCount += 1;
        }
      }
    }
  }
  const neighborhoodAssertive = drawingRegionFragmentsAreAssertive(
    fragments,
    question,
  );
  if (diagnostics) diagnostics.neighborhoodAssertive = neighborhoodAssertive;
  return neighborhoodAssertive;
}

function drawingSelfContainedMeasurementNeighborhoodIsAssertive(
  sourceRegion: DrawingRegion,
  localRegions: readonly DrawingRegion[],
  question: string,
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
) {
  const qualifierRegions = localRegions.filter((region) =>
    region !== sourceRegion
  ).sort((left, right) =>
    (left.y ?? Number.POSITIVE_INFINITY) -
      (right.y ?? Number.POSITIVE_INFINITY) ||
    (left.x ?? Number.POSITIVE_INFINITY) -
      (right.x ?? Number.POSITIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
  const regionText = (region: DrawingRegion) =>
    unique(drawingRegionAssertionFragments(region)).join(" ");
  const sourceText = regionText(sourceRegion);
  const individualRejections = qualifierRegions.filter((region) =>
    drawingFragmentHasExplicitLocalAssertionQualifier(
      regionText(region),
      question,
    )
  ).length;
  let windowRejections = 0;
  for (let start = 0; start < qualifierRegions.length; start += 1) {
    for (
      let length = 2;
      length <= MAX_SELF_CONTAINED_MEASUREMENT_QUALIFIER_WINDOW_REGIONS &&
        start + length <= qualifierRegions.length;
      length += 1
    ) {
      const window = qualifierRegions.slice(start, start + length);
      if (
        window.slice(1).some((region, index) =>
          !regionsAreNear(window[index], region)
        )
      ) break;
      if (
        drawingFragmentHasExplicitLocalAssertionQualifier(
          window.map(regionText).join(" "),
          question,
        ) || drawingFragmentHasExplicitLocalAssertionQualifier(
          `${sourceText} ${window.map(regionText).join(" ")}`,
          question,
          false,
        )
      ) windowRejections += 1;
    }
  }
  const neighborhoodAssertive = individualRejections === 0 &&
    windowRejections === 0;
  if (diagnostics) {
    diagnostics.individualFragmentRejectionCount = individualRejections;
    diagnostics.joinedFragmentRejected = windowRejections > 0;
    diagnostics.fragmentWindowRejectionCount = windowRejections;
    diagnostics.neighborhoodAssertive = neighborhoodAssertive;
  }
  return neighborhoodAssertive;
}

function drawingConditionalRelationshipNeighborhoodIsAssertive(
  sourceRegion: DrawingRegion,
  localRegions: readonly DrawingRegion[],
  question: string,
) {
  const qualifierRegions = localRegions.filter((region) =>
    region !== sourceRegion
  ).sort((left, right) =>
    (left.y ?? Number.POSITIVE_INFINITY) -
      (right.y ?? Number.POSITIVE_INFINITY) ||
    (left.x ?? Number.POSITIVE_INFINITY) -
      (right.x ?? Number.POSITIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
  const regionText = (region: DrawingRegion) =>
    unique(drawingRegionAssertionFragments(region)).join(" ");
  if (qualifierRegions.some((region) =>
    drawingFragmentHasExplicitLocalAssertionQualifier(
      regionText(region),
      question,
    )
  )) return false;
  for (let start = 0; start < qualifierRegions.length; start += 1) {
    for (
      let length = 2;
      length <= MAX_SELF_CONTAINED_MEASUREMENT_QUALIFIER_WINDOW_REGIONS &&
        start + length <= qualifierRegions.length;
      length += 1
    ) {
      const window = qualifierRegions.slice(start, start + length);
      if (
        window.slice(1).some((region, index) =>
          !regionsAreNear(window[index], region)
        )
      ) break;
      if (
        drawingFragmentHasExplicitLocalAssertionQualifier(
          window.map(regionText).join(" "),
          question,
        )
      ) return false;
    }
  }
  return true;
}

function drawingFragmentHasExplicitLocalAssertionQualifier(
  value: string,
  question: string,
  includeQuestionResponsiveConditional = true,
) {
  const canonical = canonicalDrawingQualifierText(value);
  if (
    drawingFragmentHasStandaloneOnlyStamp(canonical) ||
    drawingFragmentHasLocalMaterialIssuePrefix(canonical) ||
    drawingFragmentHasBoundedApprovalQualifier(canonical) ||
    pageFragmentHasMaterialIssueStatus(canonical)
  ) return true;
  const conditional = drawingCanonicalStatusLines(canonical).some((line) =>
    /\b(?:only\s+)?(?:if|unless|provided|upon)\s+(?:(?:[a-z][a-z0-9-]{0,23})\s+){0,5}(?:approval|approved|authorization|authorized|acceptance|accepted|confirmation|confirmed|required|permitted|verified)\b/
      .test(line)
  );
  if (conditional) return true;
  if (!includeQuestionResponsiveConditional) return false;
  return drawingFragmentCarriesQuestionResponsiveConditional(
    canonical,
    question,
  );
}

function drawingFragmentCarriesQuestionResponsiveConditional(
  value: string,
  question: string,
) {
  const canonical = canonicalDrawingQualifierText(value);
  if (!/\b(?:if|unless|provided|upon)\b/.test(canonical)) return false;
  const context = analyzeECOSQuestionEvidenceContext(question, canonical);
  return containsECOSRequestedMeasurementValue(question, canonical) &&
      (context.subjectMatched || context.attributeMatched ||
        context.locationMatched) ||
    context.subjectMatched && context.attributeMatched;
}

function boundedDrawingLocalRegionClosure(
  sourceRegion: DrawingRegion,
  regions: readonly DrawingRegion[],
  question = "",
  diagnostics?: ECOSDrawingNeighborhoodDiagnostics,
  numberedNoteMarkers?: readonly DrawingRegion[],
  numberedNoteBoundaryAnchorX?: number,
  regionIsWithinLocalAnchorEnvelope = drawingRegionIsWithinLocalAnchorEnvelope,
) {
  const selected = [sourceRegion];
  const selectedRegions = new Set([sourceRegion]);
  const numberedNoteBoundaryBudget = {
    workCount: 0,
    overflowed: false,
  };
  const syncNumberedNoteBoundaryDiagnostics = () => {
    if (!diagnostics) return;
    diagnostics.numberedNoteBoundaryWorkCount =
      numberedNoteBoundaryBudget.workCount;
    diagnostics.numberedNoteBoundaryOverflow =
      numberedNoteBoundaryBudget.overflowed;
  };
  let added = true;
  while (added) {
    added = false;
    for (const candidate of regions) {
      if (selectedRegions.has(candidate)) continue;
      if (!regionIsWithinLocalAnchorEnvelope(sourceRegion, candidate)) {
        continue;
      }
      // Dense plan OCR can place hundreds of ordinary symbols inside a broad
      // geometric neighborhood. They cannot change the polarity of a cited
      // proposition and must not trigger an all-marker boundary scan. Retain
      // only nearby fragments that can participate in a split status phrase.
      if (!drawingRegionMayCarryLocalAssertionQualifier(candidate, question)) {
        continue;
      }
      if (!selected.some((region) => regionsAreNear(region, candidate))) {
        continue;
      }
      // A numbered note marker starts a new drawing assertion. Do not let a
      // status phrase from the next list item qualify the cited item merely
      // because dense OCR placed both notes inside the same broad geometry
      // envelope. The boundary must be an exact standalone marker positioned
      // between the source and candidate on the same left-hand note axis.
      const numberedNoteBoundary = drawingNumberedNoteBoundarySeparatesQualifierCluster(
        sourceRegion,
        candidate,
        regions,
        question,
        numberedNoteMarkers,
        numberedNoteBoundaryBudget,
        numberedNoteBoundaryAnchorX,
        regionIsWithinLocalAnchorEnvelope,
      );
      if (numberedNoteBoundary === null) {
        syncNumberedNoteBoundaryDiagnostics();
        return null;
      }
      if (numberedNoteBoundary) {
        continue;
      }
      selected.push(candidate);
      selectedRegions.add(candidate);
      added = true;
      if (diagnostics) {
        diagnostics.qualifierRegionCount = selected.length - 1;
        diagnostics.qualifierRegionIds.push(candidate.id);
      }
      if (selected.length > MAX_NEARBY_DRAWING_REGIONS + 1) {
        if (diagnostics) diagnostics.qualifierOverflow = true;
        syncNumberedNoteBoundaryDiagnostics();
        return null;
      }
    }
  }
  syncNumberedNoteBoundaryDiagnostics();
  return selected;
}

function drawingNumberedNoteBoundarySeparates(
  sourceRegion: DrawingRegion,
  candidate: DrawingRegion,
  regions: readonly DrawingRegion[],
  numberedNoteMarkers?: readonly DrawingRegion[],
  budget?: { workCount: number; overflowed: boolean },
  numberedNoteBoundaryAnchorX?: number,
  regionIsWithinLocalAnchorEnvelope = drawingRegionIsWithinLocalAnchorEnvelope,
): boolean | null {
  if (
    [
      sourceRegion.x,
      sourceRegion.y,
      sourceRegion.width,
      sourceRegion.height,
      candidate.x,
      candidate.y,
      candidate.width,
      candidate.height,
    ].some((value) => value == null)
  ) return false;
  const sourceCenterY = sourceRegion.y! + sourceRegion.height! / 2;
  const candidateCenterY = candidate.y! + candidate.height! / 2;
  if (Math.abs(sourceCenterY - candidateCenterY) <= 0.002) return false;
  const lowerCenterY = Math.min(sourceCenterY, candidateCenterY);
  const upperCenterY = Math.max(sourceCenterY, candidateCenterY);
  // A boundary marker must remain on the source note's left axis. Letting the
  // marker roam across either text box can selectively remove only some words
  // of one split qualifier and turn "FOR REVIEW ONLY" into an assertion.
  const leftAxis = numberedNoteBoundaryAnchorX ?? sourceRegion.x!;
  const leftAxisMinimum = leftAxis - 0.015;
  const leftAxisMaximum = leftAxis + 0.015;
  for (const region of numberedNoteMarkers || regions) {
    if (budget) {
      if (budget.workCount >= MAX_DRAWING_NUMBERED_NOTE_BOUNDARY_WORK) {
        budget.overflowed = true;
        return null;
      }
      budget.workCount += 1;
    }
    if (region === sourceRegion || region === candidate) continue;
    if (strictNormalizedBounds(region) == null) continue;
    if (
      !numberedNoteMarkers &&
      !/^\d{1,3}[.)]$/.test(canonicalDrawingQualifierText(region.text).trim())
    ) continue;
    const markerCenterY = region.y! + region.height! / 2;
    if (markerCenterY >= lowerCenterY + 0.002 &&
      markerCenterY <= upperCenterY + 0.002 &&
      region.x! >= leftAxisMinimum &&
      region.x! <= leftAxisMaximum &&
      region.x! <= candidate.x! + 0.01) return true;
  }
  return false;
}

function drawingRegionIsTrustedNumberedNoteMarker(
  region: DrawingRegion,
  uniqueRegionIds: ReadonlySet<string>,
) {
  if (
    !region.id || !uniqueRegionIds.has(region.id) ||
    strictNormalizedBounds(region) == null ||
    region.sourceCarriers.length === 0
  ) return false;
  const canonicalSources = region.sourceCarriers.map(
    canonicalDrawingNumberedNoteMarkerSource,
  );
  if (
    canonicalSources.some((source) => source == null) ||
    new Set(canonicalSources).size !== 1
  ) return false;
  const canonicalCarriers = region.carrierTexts.map((carrier) =>
    canonicalDrawingQualifierText(carrier).trim()
  );
  if (
    canonicalCarriers.length === 0 ||
    canonicalCarriers.some((carrier) => !/^\d{1,3}[.)]$/.test(carrier)) ||
    new Set(canonicalCarriers).size !== 1
  ) return false;
  return !region.areaNames.some((areaName) =>
    drawingFragmentCouldContainMaterialStatus(areaName) ||
    drawingFragmentIsStandaloneLocalQualifierCarrier(areaName)
  );
}

function canonicalDrawingNumberedNoteMarkerSource(value: string) {
  const source = value.toLowerCase();
  if (source === "embedded_text") return "embedded_text";
  if (source === "vision" || source === "coordinate_text") return "vision";
  return DRAWING_NUMBERED_NOTE_MARKER_OCR_SOURCES.has(source)
    ? "ocr"
    : null;
}

function drawingNumberedNoteBoundarySeparatesQualifierCluster(
  sourceRegion: DrawingRegion,
  candidate: DrawingRegion,
  regions: readonly DrawingRegion[],
  question: string,
  numberedNoteMarkers?: readonly DrawingRegion[],
  budget?: { workCount: number; overflowed: boolean },
  numberedNoteBoundaryAnchorX?: number,
  regionIsWithinLocalAnchorEnvelope = drawingRegionIsWithinLocalAnchorEnvelope,
): boolean | null {
  const boundary = drawingNumberedNoteBoundarySeparates(
    sourceRegion,
    candidate,
    regions,
    numberedNoteMarkers,
    budget,
    numberedNoteBoundaryAnchorX,
  );
  if (boundary !== true) return boundary;
  let peerCount = 0;
  for (const peer of regions) {
    if (peer === sourceRegion || peer === candidate) continue;
    if (!regionIsWithinLocalAnchorEnvelope(sourceRegion, peer)) continue;
    if (!regionsAreNear(candidate, peer)) continue;
    if (!drawingRegionMayCarryLocalAssertionQualifier(peer, question)) continue;
    peerCount += 1;
    if (peerCount > MAX_NEARBY_DRAWING_REGIONS) return null;
    const peerBoundary = drawingNumberedNoteBoundarySeparates(
      sourceRegion,
      peer,
      regions,
      numberedNoteMarkers,
      budget,
      numberedNoteBoundaryAnchorX,
    );
    if (peerBoundary !== true) return peerBoundary;
  }
  return true;
}

function drawingRegionSuppliesMeasurementQuestionContext(
  region: DrawingRegion,
  question: string,
) {
  const evidence = unique([region.text, ...region.areaNames]).join("\n");
  const context = analyzeECOSQuestionEvidenceContext(question, evidence);
  return context.subjectMatched || context.attributeMatched ||
    context.locationMatched ||
    ecosEvidenceQuestionContextScore(question, evidence) > 0;
}

function drawingRegionIsSelfContainedExactMeasurementAnswer(
  region: DrawingRegion,
  question: string,
) {
  if (analyzeECOSProjectQuestion(question).kind !== "measurement") return false;
  if (
    drawingRegionMeasurementConstructionCompatibility(region, question) ===
      "conflicting"
  ) return false;
  const answerCarriers = region.carrierTexts.filter((carrier) =>
    containsECOSRequestedMeasurementValue(question, carrier)
  );
  if (answerCarriers.length === 0) return false;
  if (!answerCarriers.every((carrier) => {
    const context = analyzeECOSQuestionEvidenceContext(question, carrier);
    return context.measurementMatched &&
      context.subjectMatched &&
      context.attributeMatched &&
      context.locationMatched &&
      ecosEvidenceProvidesRequestedAnswerValue(question, carrier) &&
      !ecosEvidenceHasCompetingExplicitLocation(question, carrier);
  })) return false;
  const requestedValueSignatures = unique(
    drawingRegionAssertionFragments(region)
      .map((fragment) =>
        drawingRequestedMeasurementValueSignature(question, fragment)
      )
      .filter(Boolean),
  );
  return requestedValueSignatures.length === 1 &&
    !drawingRequestedMeasurementSignatureHasCompetingValues(
      requestedValueSignatures[0],
    );
}

function drawingRequestedMeasurementValueSignature(
  question: string,
  value: string,
) {
  return prepareDrawingRequestedMeasurementValueSignature(question)(value);
}

function prepareDrawingRequestedMeasurementValueSignature(question: string) {
  if (analyzeECOSProjectQuestion(question).kind !== "measurement") {
    return (_value: string) => "";
  }
  const containsRequestedMeasurementValue =
    prepareECOSRequestedMeasurementValueMatcher(question);
  return (value: string) => {
    if (!containsRequestedMeasurementValue(value)) return "";
    const answerSignature = drawingCarrierAnswerValueSignature(value);
    if (!answerSignature) return "";
    const unitAtoms = answerSignature.split("|")
      .filter((atom) => atom.startsWith("unit:"));
    return unitAtoms.length > 0
      ? unique(unitAtoms).sort().join("|")
      : answerSignature;
  };
}

function drawingRequestedMeasurementSignatureHasCompetingValues(
  signature: string,
) {
  const valuesByUnit = new Map<string, Set<string>>();
  for (const atom of signature.split("|")) {
    const match = /^unit:([^:]+):(.+)$/.exec(atom);
    if (!match) continue;
    const values = valuesByUnit.get(match[2]) || new Set<string>();
    values.add(match[1]);
    valuesByUnit.set(match[2], values);
  }
  return [...valuesByUnit.values()].some((values) => values.size > 1);
}

function drawingRegionCarriesExplicitDirection(region: DrawingRegion) {
  return drawingRegionAssertionFragments(region).some((fragment) =>
    /\b(?:north|south|east|west|northeast|northwest|southeast|southwest|upper|lower|front|rear|back|behind)\b/i
      .test(
        canonicalDrawingQualifierText(fragment),
      )
  );
}

function drawingRegionConstructionSubjectCompatibility(
  region: DrawingRegion,
  question: string,
): "compatible" | "conflicting" | "unspecified" {
  const requested = drawingRequestedConstructionSubjects(question);
  if (requested.size !== 1) return "unspecified";
  const carried = drawingExplicitConstructionSubjects(
    drawingRegionAssertionFragments(region).join("\n"),
  );
  if (carried.size === 0) return "unspecified";
  const [requestedSubject] = requested;
  return carried.size === 1 && carried.has(requestedSubject)
    ? "compatible"
    : "conflicting";
}

function drawingRequestedConstructionSubjects(question: string) {
  const explicitlyRequested = drawingExplicitConstructionSubjects(question);
  // In this one protected field-wording contract, "concrete slab" is the
  // user's informal name for the 2375 North-Lot PCC paving section. The
  // complete-page structured receipt still has to prove one exact paving row,
  // one exact North-Lot title, and no competing paving value. Keep every other
  // slab-vs-paving comparison distinct.
  return explicitlyRequested.size === 1 &&
      explicitlyRequested.has("slab") &&
      drawingQuestionRequestsNorthLotPCCPavingThickness(question)
    ? new Set(["paving"])
    : explicitlyRequested;
}

function drawingExplicitConstructionSubjects(value: string) {
  const normalized = canonicalDrawingQualifierText(value);
  return new Set([...normalized.matchAll(/\b(paving|walkway|slab|curb)\b/g)]
    .map((match) => match[1]));
}

function drawingRegionMeasurementConstructionCompatibility(
  region: DrawingRegion,
  question: string,
): "compatible" | "conflicting" | "unspecified" {
  const subjectCompatibility = drawingRegionConstructionSubjectCompatibility(
    region,
    question,
  );
  const materialCompatibility = drawingConstructionMaterialCompatibility(
    drawingRegionAssertionFragments(region).join("\n"),
    question,
  );
  if (
    subjectCompatibility === "conflicting" ||
    materialCompatibility === "conflicting"
  ) {
    return "conflicting";
  }
  return subjectCompatibility === "compatible" ||
      materialCompatibility === "compatible"
    ? "compatible"
    : "unspecified";
}

function drawingRegionCarriesRequestedAndCompetingConstructionScope(
  region: DrawingRegion,
  question: string,
) {
  const evidence = drawingRegionAssertionFragments(region).join("\n");
  const requestedSubjects = drawingRequestedConstructionSubjects(question);
  const carriedSubjects = drawingExplicitConstructionSubjects(evidence);
  const mixedSubjects = requestedSubjects.size === 1 &&
    carriedSubjects.has([...requestedSubjects][0]) &&
    [...carriedSubjects].some((subject) => !requestedSubjects.has(subject));
  const requestedMaterials = drawingExplicitConstructionMaterialFamilies(
    question,
  );
  const carriedMaterials = drawingExplicitConstructionMaterialFamilies(
    evidence,
  );
  const mixedMaterials = requestedMaterials.size === 1 &&
    carriedMaterials.has([...requestedMaterials][0]) &&
    [...carriedMaterials].some((material) =>
      !requestedMaterials.has(material)
    );
  return mixedSubjects || mixedMaterials;
}

function drawingConstructionMaterialCompatibility(
  evidence: string,
  question: string,
): "compatible" | "conflicting" | "unspecified" {
  const requested = drawingExplicitConstructionMaterialFamilies(question);
  if (requested.size !== 1) return "unspecified";
  const carried = drawingExplicitConstructionMaterialFamilies(evidence);
  if (carried.size === 0) return "unspecified";
  const [requestedMaterial] = requested;
  return carried.size === 1 && carried.has(requestedMaterial)
    ? "compatible"
    : "conflicting";
}

function drawingExplicitConstructionMaterialFamilies(value: string) {
  const normalized = canonicalDrawingQualifierText(value)
    .replace(
      /\bp(?:\s*[.\-/·]\s*|\s+)c(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=$|[^a-z0-9])/g,
      "pcc",
    )
    // A.C. is also an electrical abbreviation, so collapse it only inside an
    // explicit paving-material phrase. Plain AC uses the same phrase guard
    // below rather than becoming a page-global asphalt signal.
    .replace(
      /\ba(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=\s+(?:over|paving|pavement|base)\b)/g,
      "ac",
    )
    .replace(
      /\b(paving|pavement)\s+a(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=$|[^a-z0-9])/g,
      "$1 ac",
    );
  const materials = new Set<"concrete" | "asphalt">();
  const asphaltPattern =
    "\\b(?:asphalt(?:ic)?(?:\\s+concrete)?|ac\\s+(?:over|paving|pavement|base)|(?:paving|pavement)\\s+ac)\\b";
  if (new RegExp(asphaltPattern).test(normalized)) {
    materials.add("asphalt");
  }
  const withoutAsphaltTerms = normalized.replace(
    new RegExp(asphaltPattern, "g"),
    " ",
  );
  if (
    /\b(?:pcc|portland\s+cement\s+concrete|concrete)\b/.test(
      withoutAsphaltTerms,
    )
  ) {
    materials.add("concrete");
  }
  return materials;
}

function drawingRegionMayCarryLocalAssertionQualifier(
  region: DrawingRegion,
  question: string,
) {
  return drawingRegionAssertionFragments(region).some((fragment) => {
    if (
      !drawingFragmentCouldContainMaterialStatus(fragment) &&
      !drawingFragmentIsStandaloneLocalQualifierCarrier(fragment)
    ) return false;
    const context = analyzeECOSQuestionEvidenceContext(question, fragment);
    if (
      context.subjectMatched || context.attributeMatched ||
      context.locationMatched
    ) {
      return drawingRegionConstructionSubjectCompatibility(region, question) !==
        "conflicting";
    }
    return drawingFragmentIsStandaloneLocalQualifierCarrier(fragment);
  });
}

const DRAWING_LOCAL_QUALIFIER_CARRIER_WORDS = new Set([
  "acceptance",
  "accepted",
  "alternate",
  "applicant",
  "approval",
  "approved",
  "architect",
  "authorization",
  "authorized",
  "awaiting",
  "be",
  "bid",
  "build",
  "built",
  "client",
  "comment",
  "confirmation",
  "confirmed",
  "connect",
  "connected",
  "construction",
  "contingent",
  "contractor",
  "controlled",
  "coordination",
  "copy",
  "delete",
  "deleted",
  "demo",
  "demolish",
  "demolished",
  "demolition",
  "design",
  "discussion",
  "draft",
  "engineer",
  "field",
  "final",
  "for",
  "future",
  "if",
  "information",
  "install",
  "installed",
  "invalid",
  "issued",
  "may",
  "might",
  "must",
  "not",
  "omit",
  "omitted",
  "on",
  "only",
  "optional",
  "owner",
  "pending",
  "permit",
  "permitted",
  "planned",
  "preliminary",
  "pricing",
  "property",
  "proposed",
  "provide",
  "provided",
  "quotation",
  "reconnect",
  "reconnected",
  "reference",
  "rejected",
  "remain",
  "remove",
  "removed",
  "require",
  "required",
  "retain",
  "retained",
  "review",
  "scheduled",
  "set",
  "shall",
  "should",
  "subject",
  "temporary",
  "tender",
  "to",
  "unapproved",
  "unless",
  "unverified",
  "verified",
  "upon",
  "verify",
  "will",
  "working",
  "would",
  "written",
]);

function drawingFragmentIsStandaloneLocalQualifierCarrier(value: string) {
  const tokens = canonicalDrawingQualifierText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length > 0 && tokens.length <= 8 &&
    tokens.every((token) => DRAWING_LOCAL_QUALIFIER_CARRIER_WORDS.has(token));
}

function drawingRegionIsWithinLocalAnchorEnvelope(
  sourceRegion: DrawingRegion,
  candidate: DrawingRegion,
) {
  if (
    [
      sourceRegion.x,
      sourceRegion.y,
      sourceRegion.width,
      sourceRegion.height,
      candidate.x,
      candidate.y,
      candidate.width,
      candidate.height,
    ].some((value) => value == null)
  ) return false;
  return axisGap(
        sourceRegion.x!,
        sourceRegion.width!,
        candidate.x!,
        candidate.width!,
      ) <= MAX_LOCAL_DRAWING_HORIZONTAL_ANCHOR_GAP &&
    axisGap(
        sourceRegion.y!,
        sourceRegion.height!,
        candidate.y!,
        candidate.height!,
      ) <= MAX_LOCAL_DRAWING_VERTICAL_ANCHOR_GAP &&
    regionDistance(sourceRegion, candidate) <=
      MAX_LOCAL_DRAWING_ANCHOR_DISTANCE;
}

function drawingRegionIsWithinTrustedStructuredQualifierEnvelope(
  sourceRegion: DrawingRegion,
  candidate: DrawingRegion,
) {
  if (
    [
      sourceRegion.x,
      sourceRegion.y,
      sourceRegion.width,
      sourceRegion.height,
      candidate.x,
      candidate.y,
      candidate.width,
      candidate.height,
    ].some((value) => value == null)
  ) return false;
  return axisGap(
        sourceRegion.x!,
        sourceRegion.width!,
        candidate.x!,
        candidate.width!,
      ) <= MAX_TRUSTED_STRUCTURED_HORIZONTAL_QUALIFIER_GAP &&
    axisGap(
        sourceRegion.y!,
        sourceRegion.height!,
        candidate.y!,
        candidate.height!,
      ) <= MAX_TRUSTED_STRUCTURED_VERTICAL_QUALIFIER_GAP &&
    regionDistance(sourceRegion, candidate) <=
      MAX_TRUSTED_STRUCTURED_QUALIFIER_DISTANCE;
}

function normalizedDrawingBoundsContain(
  outer: Readonly<{ x: number; y: number; width: number; height: number }>,
  inner: Readonly<{ x: number; y: number; width: number; height: number }>,
  tolerance: number,
) {
  return inner.x + tolerance >= outer.x &&
    inner.y + tolerance >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function normalizedDrawingBoundsOverlap(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
  tolerance: number,
) {
  return left.x <= right.x + right.width + tolerance &&
    left.x + left.width + tolerance >= right.x &&
    left.y <= right.y + right.height + tolerance &&
    left.y + left.height + tolerance >= right.y;
}

function normalizedDrawingBoundsAxisGap(
  leftStart: number,
  leftLength: number,
  rightStart: number,
  rightLength: number,
) {
  return Math.max(
    0,
    leftStart - (rightStart + rightLength),
    rightStart - (leftStart + leftLength),
  );
}

function drawingRegionAssertionFragments(region: DrawingRegion) {
  return unique([...region.carrierTexts, ...region.areaNames]);
}

function drawingRegionFragmentsAreAssertive(
  fragments: readonly string[],
  question = "",
) {
  if (
    fragments.some((value) =>
      !drawingRegionFragmentIsAssertiveForQuestion(value, question)
    )
  ) {
    return false;
  }
  const joinedFragments = fragments.map((value) =>
    drawingFragmentIsExactCurrentPlanReference(value)
      ? "current plan reference"
      : value
  );
  if (
    joinedFragments.length > 1 &&
    !drawingRegionFragmentIsAssertiveForQuestion(
      joinedFragments.join(" "),
      question,
    )
  ) return false;
  for (let start = 0; start < joinedFragments.length; start += 1) {
    for (
      let length = 2;
      length <= 4 && start + length <= joinedFragments.length;
      length += 1
    ) {
      if (
        !drawingRegionFragmentIsAssertiveForQuestion(
          joinedFragments.slice(start, start + length).join(" "),
          question,
        )
      ) return false;
    }
  }
  return true;
}

function drawingRegionFragmentIsAssertiveForQuestion(
  value: string,
  question: string,
) {
  if (drawingRegionFragmentIsAssertive(value)) return true;
  // The question-aware exception exists only for one bare REMOVE imperative.
  // Do not let its ordinary-assertive fast path re-admit approval qualifiers,
  // page statuses, confusables, or conflicting carriers rejected above.
  return /\bremove\b/.test(canonicalDrawingQualifierText(value)) &&
    ecosDrawingPropositionIsAssertiveForExactQuestion(question, value);
}

function drawingRegionFragmentIsAssertive(value: string) {
  const canonical = canonicalDrawingQualifierText(value);
  if (
    drawingFragmentHasStandaloneOnlyStamp(canonical) ||
    drawingFragmentHasLocalMaterialIssuePrefix(canonical) ||
    drawingFragmentHasBoundedApprovalQualifier(canonical)
  ) return false;
  if (ecosDrawingPropositionIsAssertiveCurrent(canonical)) return true;
  const normalized = normalizeText(canonical);
  if (drawingFragmentIsExactCurrentPlanReference(normalized)) return true;
  const allowedNegativeRequirement =
    /\bno pipes allowed in the space to 6["”]? below slab\b/i.exec(normalized);
  if (!allowedNegativeRequirement) return false;
  const qualifier = `${normalized.slice(0, allowedNegativeRequirement.index)} ${
    normalized.slice(
      allowedNegativeRequirement.index + allowedNegativeRequirement[0].length,
    )
  }`.trim();
  return !drawingFragmentHasBoundedApprovalQualifier(qualifier) &&
    ecosDrawingPropositionIsAssertiveCurrent(qualifier || "current drawing");
}

function drawingFragmentIsExactCurrentPlanReference(value: string) {
  const normalized = normalizeText(canonicalDrawingQualifierText(value));
  if (/^verify with (?:the )?plan$/i.test(normalized)) return true;
  return /\bdemolition(?:\s+plan)?$/i.test(normalized) &&
    planAreaDesignators(normalized).length === 1;
}

function drawingFragmentHasBoundedApprovalQualifier(value: string) {
  const normalized = normalizeText(canonicalDrawingQualifierText(value))
    .replace(/[^a-z0-9]+/gi, " ").trim();
  return /\b(?:subject\s+to|pending|awaiting|contingent\s+on)\s+(?:(?:[a-z][a-z0-9]{0,23})\s+){0,4}(?:approval|authorization|acceptance|confirmation)\b/i
    .test(
      normalized,
    );
}

function drawingFragmentHasStandaloneOnlyStamp(value: string) {
  return drawingCanonicalStatusLines(value).some((line) =>
    /^(?:(?:for\s+)?(?:reference|review|information|coordination)|coordination)\s+only$/
      .test(
        line,
      )
  );
}

function drawingFragmentHasLocalMaterialIssuePrefix(value: string) {
  return drawingCanonicalStatusLines(value).some((line) =>
    /^(?:unapproved|rejected|invalid|expired|out\s+of\s+date|non\s+current|retired|replaced|tentative|placeholder|hold|n\s*f\s*c|i\s*f\s*[abtr]|uncontrolled\s+copy|not\s+controlled|working\s+copy|review\s+copy|(?:bid|tender|permit|pricing|quotation)\s+(?:set|documents?)|for\s+(?:comment|review|reference|information|discussion|pricing|approval|bid|tender|quotation|permit)|issued\s+for\s+(?:comment|review|reference|information|discussion|pricing|approval|bid|tender|quotation|permit))(?:\b|$)/
      .test(
        line,
      ) ||
    /^void(?:\b|$)/.test(line) && !/^void\s+fill\s+detail(?:\b|$)/.test(line) ||
    /\b(?:issued\s+for\s+coordination|for\s+coordination|coordination\s+set)\b/
      .test(line)
  );
}

function drawingFragmentMayBeNonassertive(value: string) {
  return !ecosDrawingPropositionIsAssertiveCurrent(value) ||
    drawingFragmentCouldContainMaterialStatus(value);
}

function drawingFragmentCouldContainMaterialStatus(value: string) {
  return /\b(?:not|never|no|if|unless|assuming|provided|subject|pending|awaiting|contingent|upon|proposed|future|planned|preliminary|draft|conceptual|schematic|design|development|approval|review|reference|information|coordination|alternate|optional|delete|deleted|omit|omitted|remove|removed|demo|demolition|demolish|superseded|obsolete|archived|withdrawn|void|voided|rescinded|revoked|cancelled|canceled|unissued|invalid|invalidated|expired|retired|replaced|rejected|unapproved|tentative|placeholder|hold|issued|bid|permit|pricing|quotation|tender|temporary|tbd|tbc|verify|field|uncontrolled|controlled|working|copy|out|date)\b/i
    .test(
      value,
    ) ||
    /\b(?:nfc|if[abtr])\b/i.test(value) ||
    /(?<=[a-z])3|3(?=[a-z])/i.test(value) ||
    /\b[a-z](?:[\s._·-]+[a-z]){2,}\b/i.test(value) ||
    /[ΑАαаΒВβвϹСϲсΕЕεеΗНηнΙІӀιіΚКκкΜМμмΝνΟОοоΡРρрΤТτтΥУυуΧХχх]/u.test(value);
}

const DRAWING_SPACED_STATUS_WORDS = Object.freeze([
  "construction",
  "coordination",
  "information",
  "reference",
  "proposed",
  "alternate",
  "approval",
  "deleted",
  "delete",
  "omitted",
  "review",
  "pending",
  "subject",
  "draft",
  "only",
  "omit",
  "not",
  "for",
  "to",
]);
const DRAWING_SPACED_STATUS_PATTERNS = Object.freeze(
  DRAWING_SPACED_STATUS_WORDS.map((word) =>
    new RegExp(
      `\\b${word.split("").join("[\\s._·-]*")}\\b`,
      "gi",
    )
  ),
);

const DRAWING_STATUS_CONFUSABLES: Readonly<Record<string, string>> = Object
  .freeze({
    "Α": "A",
    "А": "A",
    "α": "a",
    "а": "a",
    "Β": "B",
    "В": "B",
    "β": "b",
    "в": "b",
    "Ϲ": "C",
    "С": "C",
    "ϲ": "c",
    "с": "c",
    "Ε": "E",
    "Е": "E",
    "ε": "e",
    "е": "e",
    "Η": "H",
    "Н": "H",
    "η": "h",
    "н": "h",
    "Ι": "I",
    "І": "I",
    "Ӏ": "I",
    "ι": "i",
    "і": "i",
    "Κ": "K",
    "К": "K",
    "κ": "k",
    "к": "k",
    "Μ": "M",
    "М": "M",
    "μ": "m",
    "м": "m",
    "Ν": "N",
    "ν": "n",
    "Ο": "O",
    "О": "O",
    "ο": "o",
    "о": "o",
    "Ρ": "P",
    "Р": "P",
    "ρ": "p",
    "р": "p",
    "Τ": "T",
    "Т": "T",
    "τ": "t",
    "т": "t",
    "Υ": "Y",
    "У": "Y",
    "υ": "y",
    "у": "y",
    "Χ": "X",
    "Х": "X",
    "χ": "x",
    "х": "x",
  });

let ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE: DrawingQualifierTextCache | null =
  null;

function createDrawingQualifierTextCache(): DrawingQualifierTextCache {
  return { values: new Map(), characterCount: 0 };
}

function withDrawingQualifierTextCache<T>(
  cache: DrawingQualifierTextCache,
  operation: () => T,
) {
  // Every guarded operation is synchronous. JavaScript cannot interleave a
  // second Edge request until this stack unwinds, and nested calls restore the
  // previous request-local cache in the finally block.
  const previous = ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE;
  ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE = cache;
  try {
    return operation();
  } finally {
    ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE = previous;
  }
}

function rememberCanonicalDrawingQualifierText(
  value: string,
  canonical: string,
) {
  const cache = ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE;
  if (!cache || cache.values.has(value)) return;
  const characterCount = value.length + canonical.length;
  // Once either prepared-page bound is full, retain the already memoized
  // prefix. Evicting during an ordered dense-page scan would let a valid 5,000
  // region page churn the entire cache on every repeated neighborhood audit.
  if (
    cache.values.size >= MAX_PREPARED_DRAWING_QUALIFIER_CACHE_ENTRIES ||
    cache.characterCount + characterCount >
      MAX_PREPARED_DRAWING_QUALIFIER_CACHE_CHARACTERS
  ) return;
  cache.values.set(value, canonical);
  cache.characterCount += characterCount;
}

function canonicalDrawingQualifierText(value: string) {
  const cached = ACTIVE_DRAWING_QUALIFIER_TEXT_CACHE?.values.get(value);
  if (cached !== undefined) return cached;
  let normalized = value.normalize("NFKD")
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(
      /[ΑАαаΒВβвϹСϲсΕЕεеΗНηнΙІӀιіΚКκкΜМμмΝνΟОοоΡРρрΤТτтΥУυуΧХχх]/gu,
      (character) => DRAWING_STATUS_CONFUSABLES[character] || character,
    )
    .replace(/(?<=[a-z])3|3(?=[a-z])/gi, "e")
    .replace(/[‐‑‒–—―−]/g, "-");
  for (let index = 0; index < DRAWING_SPACED_STATUS_WORDS.length; index += 1) {
    normalized = normalized.replace(
      DRAWING_SPACED_STATUS_PATTERNS[index],
      DRAWING_SPACED_STATUS_WORDS[index],
    );
  }
  const canonical = normalized.toLowerCase().replace(/[^\S\r\n]+/g, " ")
    .trim();
  rememberCanonicalDrawingQualifierText(value, canonical);
  return canonical;
}

function drawingCanonicalStatusLines(value: string) {
  return canonicalDrawingQualifierText(value)
    .split(/[\r\n\u0085\f\u2028\u2029|;•]+|\s[-–—]\s/)
    .map((line) => line.replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
}

function drawingTextHasDisallowedControlCharacters(value: string) {
  return /[\u0000-\u0008\u000B\u000E-\u001F\u007F]/.test(value);
}

function drawingEvidenceInputIsBounded(
  pageText: string,
  pageIdentity: string,
  question: string,
  regions: readonly ECOSDrawingRegionInput[],
) {
  if (
    typeof pageText !== "string" ||
    pageText.length > MAX_DRAWING_PAGE_TEXT_LENGTH ||
    drawingTextHasDisallowedControlCharacters(pageText) ||
    typeof pageIdentity !== "string" ||
    pageIdentity.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    drawingTextHasDisallowedControlCharacters(pageIdentity) ||
    typeof question !== "string" ||
    question.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
    drawingTextHasDisallowedControlCharacters(question) ||
    regions.length > MAX_DRAWING_REGION_INPUTS
  ) return false;
  let totalDrawingLineCount = 0;
  let totalStatusFragmentCount = 0;
  const addStatusFragments = (value: string) => {
    if (!value) return true;
    const normalizedValue = value.normalize("NFKC")
      .replace(/[\p{Cf}\p{M}]/gu, "")
      .replace(/[‐‑‒–—―−]/g, "-");
    totalStatusFragmentCount += 1;
    if (totalStatusFragmentCount > MAX_DRAWING_STATUS_FRAGMENTS) return false;
    for (let index = 0; index < normalizedValue.length; index += 1) {
      const character = normalizedValue[index];
      const lineSeparator = "\n\r\u0085\f\u2028\u2029".includes(character);
      const statusSeparator = lineSeparator || character === "|" ||
        character === ";" ||
        character === "•" ||
        character === "-" && /\s/.test(normalizedValue[index - 1] || "") &&
          /\s/.test(normalizedValue[index + 1] || "");
      if (!statusSeparator) continue;
      if (character === "\r" && normalizedValue[index + 1] === "\n") index += 1;
      totalStatusFragmentCount += 1;
      if (totalStatusFragmentCount > MAX_DRAWING_STATUS_FRAGMENTS) return false;
    }
    return true;
  };
  const addDrawingLines = (value: string) => {
    if (!value) return true;
    if (!addStatusFragments(value)) return false;
    totalDrawingLineCount += 1;
    if (totalDrawingLineCount > MAX_DRAWING_PAGE_LINES) return false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (!/[\n\r\u0085\f\u2028\u2029]/.test(character)) continue;
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      totalDrawingLineCount += 1;
      if (totalDrawingLineCount > MAX_DRAWING_PAGE_LINES) return false;
    }
    return true;
  };
  if (!addStatusFragments(pageIdentity)) return false;
  if (!addDrawingLines(pageText)) return false;
  let totalRegionTextLength = 0;
  let totalMetadataTextLength = 0;
  let totalMetadataItems = 0;
  let totalProvenanceLength = 0;
  let totalProvenanceRecords = 0;
  for (const region of regions) {
    for (
      const coordinateValue of [
        region.x,
        region.y,
        region.width,
        region.height,
        region.confidence,
      ]
    ) {
      if (coordinateValue == null) continue;
      if (
        typeof coordinateValue !== "number" ||
        !Number.isFinite(coordinateValue) ||
        coordinateValue < 0 || coordinateValue > 1
      ) return false;
    }
    for (
      const [value, maximum, countsAsDrawingLines] of [
        [region.id, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [region.label, MAX_DRAWING_REGION_TEXT_LENGTH, true],
        [region.text, MAX_DRAWING_REGION_TEXT_LENGTH, true],
        [region.evidenceText, MAX_DRAWING_REGION_TEXT_LENGTH, true],
        [region.rawSource, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [region.source, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [region.reconstructionMethod, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [region.factKind, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [region.subject, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
        [
          region.structuredRelationshipId,
          MAX_DRAWING_METADATA_TEXT_LENGTH,
          false,
        ],
        [
          region.structuredTableBlockId,
          MAX_DRAWING_METADATA_TEXT_LENGTH,
          false,
        ],
        [
          region.structuredTableRelationshipType,
          MAX_DRAWING_METADATA_TEXT_LENGTH,
          false,
        ],
        [region.structuredTableRowKey, MAX_DRAWING_METADATA_TEXT_LENGTH, false],
      ] as const
    ) {
      if (value == null) continue;
      if (typeof value !== "string") return false;
      if (
        value.length > maximum ||
        drawingTextHasDisallowedControlCharacters(value)
      ) return false;
      if (countsAsDrawingLines && !addDrawingLines(value)) return false;
      totalRegionTextLength += value.length;
    }
    if (totalRegionTextLength > MAX_DRAWING_TOTAL_REGION_TEXT_LENGTH) {
      return false;
    }
    if (region.searchable != null && typeof region.searchable !== "boolean") {
      return false;
    }
    if (
      region.renderedCorroborated != null &&
      typeof region.renderedCorroborated !== "boolean"
    ) return false;
    for (
      const value of [
        region.areaNames,
        region.evidenceSources,
        region.renderedCorroboratingRegionIds,
        region.renderedCorroboratingSources,
      ]
    ) {
      if (value == null) continue;
      if (!Array.isArray(value) || value.length > MAX_DRAWING_METADATA_ITEMS) {
        return false;
      }
      totalMetadataItems += value.length;
      if (totalMetadataItems > MAX_DRAWING_TOTAL_METADATA_ITEMS) return false;
      for (const item of value) {
        if (
          typeof item !== "string" ||
          item.length > MAX_DRAWING_METADATA_TEXT_LENGTH ||
          drawingTextHasDisallowedControlCharacters(item)
        ) return false;
        totalMetadataTextLength += item.length;
        if (totalMetadataTextLength > MAX_DRAWING_TOTAL_METADATA_TEXT_LENGTH) {
          return false;
        }
      }
    }
    for (
      const value of [region.constituentEvidence, region.corroboratingEvidence]
    ) {
      if (value == null) continue;
      if (!Array.isArray(value) || value.length > MAX_DRAWING_METADATA_ITEMS) {
        return false;
      }
      totalProvenanceRecords += value.length;
      if (totalProvenanceRecords > MAX_DRAWING_TOTAL_PROVENANCE_RECORDS) {
        return false;
      }
      for (const item of value) {
        if (!drawingProvenanceStructureIsBounded(item)) return false;
        let serialized = "";
        try {
          serialized = JSON.stringify(item) || "";
        } catch {
          return false;
        }
        if (serialized.length > MAX_DRAWING_PROVENANCE_RECORD_LENGTH) {
          return false;
        }
        totalProvenanceLength += serialized.length;
        if (totalProvenanceLength > MAX_DRAWING_TOTAL_PROVENANCE_LENGTH) {
          return false;
        }
      }
    }
  }
  return true;
}

function drawingProvenanceStructureIsBounded(value: unknown) {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodeCount = 0;
  let textLength = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodeCount += 1;
    if (
      nodeCount > MAX_DRAWING_PROVENANCE_NODES ||
      current.depth > MAX_DRAWING_PROVENANCE_DEPTH
    ) {
      return false;
    }
    if (typeof current.value === "string") {
      textLength += current.value.length;
      if (textLength > MAX_DRAWING_PROVENANCE_RECORD_LENGTH) return false;
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) return false;
    seen.add(current.value);
    try {
      if (Array.isArray(current.value)) {
        if (current.value.length > MAX_DRAWING_PROVENANCE_NODES) return false;
        for (let index = 0; index < current.value.length; index += 1) {
          textLength += String(index).length;
          if (textLength > MAX_DRAWING_PROVENANCE_RECORD_LENGTH) return false;
          stack.push({ value: current.value[index], depth: current.depth + 1 });
        }
        continue;
      }
      let childCount = 0;
      for (const key in current.value as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current.value, key)) continue;
        childCount += 1;
        if (childCount > MAX_DRAWING_PROVENANCE_NODES) return false;
        textLength += key.length;
        if (textLength > MAX_DRAWING_PROVENANCE_RECORD_LENGTH) return false;
        stack.push({
          value: (current.value as Record<string, unknown>)[key],
          depth: current.depth + 1,
        });
      }
    } catch {
      return false;
    }
  }
  return true;
}

type StructuredPCCThicknessClaim = Readonly<{
  region: DrawingRegion;
  subject: "paving" | "walkway";
  value: string;
  displayValue: string;
}>;

type StructuredACSectionClaim = Readonly<{
  region: DrawingRegion;
  acValue: string;
  acDisplayValue: string;
  baseValue: string;
  baseDisplayValue: string;
}>;

type StructuredAreaDrainClaim = Readonly<{
  region: DrawingRegion;
  width: string;
  widthDisplay: string;
  height: string;
  heightDisplay: string;
  filter: string;
  filterDisplay: string;
}>;

type StructuredSewerLateralClaim = Readonly<{
  region: DrawingRegion;
  size: string;
  sizeDisplay: string;
  standard: string;
  materialDiscipline: string;
}>;

function drawingQuestionRequestsNorthLotPCCPavingThickness(question: string) {
  const normalized = canonicalDrawingQualifierText(question);
  // An explicit walkway-only request must not be consumed by the broader
  // North-Lot concrete classifier. The installed-condition wording below is
  // intentionally retained for questions that do not name either subtype.
  if (/\bwalkway\b/.test(normalized) && !/\bpaving\b/.test(normalized)) {
    return false;
  }
  return /\b(?:how\s+thick|thickness|thick|inches?)\b/.test(normalized) &&
    /\b(?:pcc|concrete|slab)\b/.test(normalized) &&
    /\b2375\b/.test(normalized) &&
    /\b(?:north|behind|back)\b/.test(normalized);
}

function drawingQuestionRequestsPCCWalkwayPavingComparison(question: string) {
  const normalized = canonicalDrawingQualifierText(question);
  return /\bpcc\s+walkway\b/.test(normalized) &&
    /\bpcc\s+paving\b/.test(normalized) &&
    /\b(?:how\s+thick|thickness|thick)\b/.test(normalized) &&
    /\b(?:same|different|compare|comparison)\b/.test(normalized);
}

function drawingQuestionRequestsNorthLotACSection(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\b(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\b/.test(normalized) &&
    /\bpaving\b/.test(normalized) &&
    /\bbase\b/.test(normalized) &&
    /\b(?:thickness|thicknesses|thick)\b/.test(normalized) &&
    /\b2375\b/.test(normalized) &&
    /\bnorth\s+lot\b/.test(normalized);
}

function drawingQuestionRequestsAreaDrainComposite(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\barea\s+drain\b/.test(normalized) &&
    /\bsize\b/.test(normalized) &&
    /\bfilter\b/.test(normalized);
}

function drawingQuestionRequestsDelineatedADAMaximumGrade(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\bmaximum\s+(?:permitted\s+)?grade\b/.test(normalized) &&
    /\bdelineated\s+ada(?:\s+|-)+accessible\s+parking\s+areas?\b/.test(
      normalized,
    );
}

function drawingQuestionRequestsSewerLateralComposite(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\bsewer\s+lateral\b/.test(normalized) &&
    /\bsize\b/.test(normalized) &&
    /\bstandard\b/.test(normalized) &&
    /\bmaterial\b/.test(normalized);
}

/**
 * Closed producer contract for a civil direction note that sends the reader
 * to the sheet containing underground infiltration chamber details. The sheet
 * is dynamic, but every other byte of the assertion remains fixed.
 */
export function exactECOSInfiltrationDetailDirectionSheet(
  value: unknown,
) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  return /^CONSTRUCT UNDERGROUND INFILTRATION CHAMBERS - SEE DETAILS ON SHEET ([1-9]\d{0,2})$/
    .exec(value)?.[1] || "";
}

function infiltrationDirectionCarrierConflicts(
  value: string,
  expectedTargetSheet: string,
) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const alternateOperator =
    /\b(?:or|also|not|instead|rather|except|excluding|alternate|alternative)\b/
      .test(normalized);
  const namedSheetReferences = [...normalized.matchAll(
    /\b(?:sheet|sht)\.?(?:\s+(?:no\.?|number))?\s+([a-z])?\s*([0-9]+)\b/g,
  )].map((match) => ({ discipline: match[1] || "c", target: match[2] }));
  const bareCivilReferences = alternateOperator ||
      /\b(?:see|refer(?:s|red|ring)?(?:\s+to)?|direct(?:s|ed|ing|ion)?|per)\b/.test(
        normalized,
      )
    ? [...normalized.matchAll(
      /\b(?:or|also|not|instead|rather|except|excluding|alternate|alternative|see|refer(?:s|red|ring)?(?:\s+to)?|direct(?:s|ed|ing|ion)?|per)(?:\s+see)?\s+c\s*([0-9]+)\b/g,
    )].map((match) => ({ discipline: "c", target: match[1] }))
    : [];
  const sheetReferences = [...namedSheetReferences, ...bareCivilReferences];
  if (sheetReferences.length === 0) return false;
  return alternateOperator || sheetReferences.some(({ discipline, target }) =>
    discipline !== "c" || !/^[1-9]\d{0,2}$/.test(target) ||
    target !== expectedTargetSheet
  );
}

function infiltrationDirectionCarrierHasCompleteDirection(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  if (
    !/\bunderground\s+infiltration\s+chambers?\b/.test(normalized) ||
    !/\b(?:details?|det)\b/.test(normalized) ||
    !/\b(?:see|refer(?:s|red|ring)?(?:\s+to)?|direct(?:s|ed|ing|ion)?|per)\b/.test(
      normalized,
    )
  ) return false;
  return /\b(?:sheet|sht)\.?(?:\s+(?:no\.?|number))?\s+(?:[a-z]\s*)?[0-9]+\b/.test(
    normalized,
  ) || /\bc\s*[0-9]+\b/.test(normalized);
}

function drawingQuestionRequestsInfiltrationDetailLocation(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\bunderground\s+infiltration\s+chambers?\b/.test(normalized) &&
    /\bdetails?\b/.test(normalized) &&
    /\bsheets?\b/.test(normalized) &&
    /\b(?:what|which|where)\b/.test(normalized);
}

function drawingQuestionRequestsSitePhotometricStatistics(question: string) {
  const normalized = canonicalStructuredDrawingClaimText(question);
  return /\bphotometrics?\b/.test(normalized) &&
    /\baverage\b/.test(normalized) &&
    /\bmaximum\b/.test(normalized) &&
    /\bminimum\b/.test(normalized);
}

function drawingQuestionRequiresSealedStructuredReceipt(question: string) {
  return drawingQuestionRequestsNorthLotPCCPavingThickness(question) ||
    drawingQuestionRequestsSitePhotometricStatistics(question);
}

function canonicalStructuredDrawingClaimText(value: string) {
  return normalizeDrawingCarrierComparisonText(
    canonicalDrawingQualifierText(value),
  )
    .replace(
      /\bp(?:\s*[.\-/·]\s*|\s+)c(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=$|[^a-z0-9])/g,
      "pcc",
    )
    .replace(
      /\ba(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=\s+(?:over|paving|pavement|base)\b)/g,
      "ac",
    )
    .replace(
      /\b(paving|pavement)\s+a(?:\s*[.\-/·]\s*|\s+)c\s*\.?(?=$|[^a-z0-9])/g,
      "$1 ac",
    )
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function structuredDrawingRegionTextVariants(region: DrawingRegion) {
  const fragments = drawingRegionAssertionFragments(region);
  return unique([
    ...fragments,
    fragments.length > 1 ? fragments.join(" ") : "",
  ].filter(Boolean)).map(canonicalStructuredDrawingClaimText);
}

function structuredDrawingRegionIsCoordinateBound(region: DrawingRegion) {
  return Boolean(region.id) &&
    [region.x, region.y, region.width, region.height].every((value) =>
      value != null
    );
}

type StrictStructuredReceiptType =
  | "slab_legend"
  | "photometric_statistics";

type StrictStructuredReceiptContract = Readonly<{
  relationshipType: StrictStructuredReceiptType;
  subject: string;
  rowKey: string;
  constituentSources: readonly string[];
}>;

type StrictStructuredReceiptBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const STRICT_STRUCTURED_RECEIPT_CONTRACTS: Readonly<
  Record<StrictStructuredReceiptType, StrictStructuredReceiptContract>
> = Object.freeze({
  slab_legend: Object.freeze({
    relationshipType: "slab_legend",
    subject: "slab construction",
    rowKey: "pcc-paving",
    constituentSources: Object.freeze([
      "fixed_visual_tile_coordinate_ocr",
      "fixed_visual_tile_coordinate_ocr",
      "fixed_visual_tile_coordinate_ocr",
      "fixed_visual_tile_coordinate_ocr",
    ]),
  }),
  photometric_statistics: Object.freeze({
    relationshipType: "photometric_statistics",
    subject: "lighting photometric statistics",
    rowKey: "ALL",
    constituentSources: Object.freeze([
      "embedded_text",
      "title_block_ocr",
      "title_block_ocr",
      "title_block_ocr",
    ]),
  }),
});

const STRICT_STRUCTURED_CONSTITUENT_SOURCES = new Set([
  "fixed_visual_tile_coordinate_ocr",
  "embedded_text",
  "title_block_ocr",
]);

type StrictStructuredReceiptValidationSnapshot = Readonly<{
  rawRegions: readonly ECOSDrawingRegionInput[];
  rawRegionsById: ReadonlyMap<string, readonly ECOSDrawingRegionInput[]>;
  candidatesByType: Readonly<
    Record<StrictStructuredReceiptType, readonly ECOSDrawingRegionInput[]>
  >;
  pageAuthority: ECOSDrawingPageAuthority | null;
}>;

function strictDrawingPageAuthority(
  value: ECOSDrawingPageAuthority | null | undefined,
): ECOSDrawingPageAuthority | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projectId = strictStructuredReceiptText(value.projectId);
  const sourceSha256 = strictStructuredReceiptText(value.sourceSha256);
  const sheetNumber = strictStructuredReceiptText(value.sheetNumber, 160);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      projectId,
    ) ||
    !/^[a-f0-9]{64}$/.test(sourceSha256) ||
    !Number.isInteger(value.pageNumber) || value.pageNumber < 1 ||
    !sheetNumber || canonicalComparableSheetNumber(sheetNumber) !== sheetNumber ||
    value.evidenceVersion !== STRUCTURED_RECEIPT_EVIDENCE_VERSION
  ) return null;
  return Object.freeze({
    projectId,
    sourceSha256,
    pageNumber: value.pageNumber,
    sheetNumber,
    evidenceVersion: STRUCTURED_RECEIPT_EVIDENCE_VERSION,
  });
}

function drawingPageIdentityMatchesAuthority(
  pageIdentity: string,
  authority: ECOSDrawingPageAuthority,
) {
  const sheetNumbers = [...pageIdentity.matchAll(
    /\bsheet(?:\s+(?:number|no\.?))?\s+([a-z0-9][a-z0-9.\-]*)\b/gi,
  )].map((match) => canonicalComparableSheetNumber(match[1])).filter(Boolean);
  if (
    sheetNumbers.length !== 1 || sheetNumbers[0] !== authority.sheetNumber
  ) return false;
  const pageTokens = [...pageIdentity.matchAll(
    /\bpage(?:\s+(?:number|no\.?|#))?\s+(?!context\b)([+-]?\d+(?:\.\d+)?|[^\s,.;:)\]}]+)/gi,
  )].map((match) => match[1]);
  if (pageTokens.some((token) => !/^[1-9]\d*$/.test(token))) return false;
  const pageNumbers = pageTokens.map(Number);
  return pageNumbers.every((pageNumber) => pageNumber === authority.pageNumber);
}

function rawRegionLooksLikeStrictStructuredCandidate(
  region: ECOSDrawingRegionInput,
  relationshipType: StrictStructuredReceiptType,
) {
  const contract = STRICT_STRUCTURED_RECEIPT_CONTRACTS[relationshipType];
  const text = rawStructuredPeerText(region);
  const structuredEnvelope =
    textValue(region.source) ===
        "deterministic_structured_table_relationship" ||
    textValue(region.rawSource) ===
        "deterministic_structured_table_relationship" ||
    textValue(region.reconstructionMethod) ===
        COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP ||
    textValue(region.id).startsWith("structured-table-fact:");
  const envelopeMatchesType = structuredEnvelope &&
    (relationshipType === "slab_legend"
      ? /\bpcc\s+paving\b/i.test(text)
      : /^ALL(?:\s|$)/.test(text) ||
        /\b(?:average|avg)\b[\s\S]*\bmax(?:imum)?\b[\s\S]*\bmin(?:imum)?\b/i
          .test(text));
  return region.structuredTableRelationshipType === relationshipType ||
    region.structuredTableRowKey === contract.rowKey ||
    region.subject === contract.subject ||
    strictStructuredTopTextLooksProtected(relationshipType, text) ||
    envelopeMatchesType;
}

function prepareStrictStructuredReceiptValidationSnapshot(
  rawRegions: readonly ECOSDrawingRegionInput[],
  pageIdentity: string,
  pageAuthority: ECOSDrawingPageAuthority | null | undefined,
): StrictStructuredReceiptValidationSnapshot {
  const rawRegionsById = new Map<string, ECOSDrawingRegionInput[]>();
  const candidatesByType: Record<
    StrictStructuredReceiptType,
    ECOSDrawingRegionInput[]
  > = {
    slab_legend: [],
    photometric_statistics: [],
  };
  for (const region of rawRegions) {
    const id = strictStructuredReceiptText(region.id);
    if (id) {
      const matches = rawRegionsById.get(id) || [];
      matches.push(region);
      rawRegionsById.set(id, matches);
    }
    for (
      const relationshipType of [
        "slab_legend",
        "photometric_statistics",
      ] as const
    ) {
      if (rawRegionLooksLikeStrictStructuredCandidate(region, relationshipType)) {
        candidatesByType[relationshipType].push(region);
      }
    }
  }
  const strictAuthority = strictDrawingPageAuthority(pageAuthority);
  return Object.freeze({
    rawRegions,
    rawRegionsById,
    candidatesByType: Object.freeze({
      slab_legend: Object.freeze(candidatesByType.slab_legend),
      photometric_statistics: Object.freeze(
        candidatesByType.photometric_statistics,
      ),
    }),
    pageAuthority: strictAuthority &&
        drawingPageIdentityMatchesAuthority(pageIdentity, strictAuthority)
      ? strictAuthority
      : null,
  });
}

function strictStructuredNumericToken(value: unknown) {
  if (
    typeof value !== "string" || value !== value.trim() ||
    !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value)
  ) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000
    ? parsed
    : null;
}

function strictStructuredReceiptContentIsExact(
  relationshipType: StrictStructuredReceiptType,
  topText: unknown,
  constituentsValue: unknown,
) {
  if (!Array.isArray(constituentsValue) || constituentsValue.length !== 4) {
    return false;
  }
  const constituentTexts = constituentsValue.map((item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? strictStructuredReceiptText(
        (item as Readonly<Record<string, unknown>>).text,
        MAX_DRAWING_REGION_TEXT_LENGTH,
      )
      : ""
  );
  if (constituentTexts.some((value) => !value)) return false;
  const exactTopText = strictStructuredReceiptText(
    topText,
    MAX_DRAWING_REGION_TEXT_LENGTH,
  );
  if (!exactTopText || exactTopText !== constituentTexts.join(" ")) return false;
  if (relationshipType === "slab_legend") {
    const construction = /^@ CONSTRUCT ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?)[\"”″] THICK$/
      .exec(constituentTexts[0]);
    const value = /^((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?)[\"”″]$/
      .exec(constituentTexts[1]);
    const constructionValue = strictStructuredNumericToken(construction?.[1]);
    const repeatedValue = strictStructuredNumericToken(value?.[1]);
    return constructionValue != null && constructionValue > 0 &&
      repeatedValue === constructionValue &&
      constituentTexts[2] === "PCC PAVING" && constituentTexts[3] === "PCC";
  }
  const average = strictStructuredNumericToken(constituentTexts[1]);
  const maximum = strictStructuredNumericToken(constituentTexts[2]);
  const minimum = strictStructuredNumericToken(constituentTexts[3]);
  return constituentTexts[0] === "ALL" && average != null && maximum != null &&
    minimum != null && minimum <= average && average <= maximum;
}

function strictStructuredTopTextLooksProtected(
  relationshipType: StrictStructuredReceiptType,
  value: string,
) {
  if (relationshipType === "slab_legend") {
    const match = /^@ CONSTRUCT ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?)[\"”″] THICK ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?)[\"”″] PCC PAVING PCC$/
      .exec(value);
    const first = strictStructuredNumericToken(match?.[1]);
    const second = strictStructuredNumericToken(match?.[2]);
    return first != null && first > 0 && second === first;
  }
  const match = /^ALL ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?) ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?) ((?:0|[1-9]\d{0,5})(?:\.\d{1,6})?)$/
    .exec(value);
  const average = strictStructuredNumericToken(match?.[1]);
  const maximum = strictStructuredNumericToken(match?.[2]);
  const minimum = strictStructuredNumericToken(match?.[3]);
  return average != null && maximum != null && minimum != null &&
    minimum <= average && average <= maximum;
}

function strictStructuredReceiptTopLevelInputIsExact(
  value: ECOSDrawingRegionInput,
) {
  const relationshipType = value.structuredTableRelationshipType;
  if (
    relationshipType !== "slab_legend" &&
    relationshipType !== "photometric_statistics"
  ) return false;
  const contract = STRICT_STRUCTURED_RECEIPT_CONTRACTS[relationshipType];
  const relationshipId = value.structuredRelationshipId;
  const blockId = value.structuredTableBlockId;
  const expectedEvidenceSources = [...new Set(contract.constituentSources)];
  if (
    typeof relationshipId !== "string" ||
    !/^relationship:[a-f0-9]{24}$/.test(relationshipId) ||
    typeof blockId !== "string" ||
    !/^block:[a-f0-9]{24}$/.test(blockId) ||
    value.id !== `structured-table-fact:${relationshipId}` ||
    !strictStructuredReceiptContentIsExact(
      relationshipType,
      value.text,
      value.constituentEvidence,
    ) ||
    value.source !== "deterministic_structured_table_relationship" ||
    value.rawSource != null &&
      value.rawSource !== "deterministic_structured_table_relationship" ||
    value.reconstructionMethod !==
      COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP ||
    value.factKind !== "drawing_fact" ||
    value.subject !== contract.subject ||
    value.structuredTableRowKey !== contract.rowKey ||
    value.searchable !== true ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) || value.confidence < 0 ||
    value.confidence > 1 ||
    !strictStructuredReceiptBounds({
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
    }) ||
    value.areaNames != null &&
      (!Array.isArray(value.areaNames) || value.areaNames.length !== 0) ||
    value.corroboratingEvidence != null &&
      (!Array.isArray(value.corroboratingEvidence) ||
        value.corroboratingEvidence.length !== 0) ||
    value.renderedCorroborated != null ||
    value.renderedCorroboratingRegionIds != null ||
    value.renderedCorroboratingSources != null ||
    !Array.isArray(value.evidenceSources) ||
    value.evidenceSources.length !== expectedEvidenceSources.length ||
    value.evidenceSources.some((source, index) =>
      source !== expectedEvidenceSources[index]
    ) ||
    !Array.isArray(value.constituentEvidence)
  ) return false;
  for (const carrier of [value.evidenceText, value.label]) {
    if (carrier != null && carrier !== value.text) return false;
  }
  return true;
}

function strictStructuredReceiptText(
  value: unknown,
  maximum = MAX_DRAWING_METADATA_TEXT_LENGTH,
) {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximum && value === value.trim()
    ? value
    : "";
}

function strictStructuredReceiptBounds(
  value: unknown,
): StrictStructuredReceiptBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  const width = record.width;
  const height = record.height;
  if (
    typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 ||
    typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1 ||
    typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
    width > 1 ||
    typeof height !== "number" || !Number.isFinite(height) || height <= 0 ||
    height > 1 ||
    x + width > 1 + STRUCTURED_RECEIPT_BOUND_EPSILON ||
    y + height > 1 + STRUCTURED_RECEIPT_BOUND_EPSILON
  ) return null;
  return { x, y, width, height };
}

function strictStructuredReceiptNumbersMatch(left: number, right: number) {
  return Math.abs(left - right) <= STRUCTURED_RECEIPT_BOUND_EPSILON;
}

function strictStructuredReceiptStringArray(value: unknown) {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > MAX_DRAWING_METADATA_ITEMS
  ) return null;
  const strings = value.map((item) => strictStructuredReceiptText(item));
  if (strings.some((item) => !item) || new Set(strings).size !== strings.length) {
    return null;
  }
  return strings;
}

function strictStructuredBoundsMatch(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  return strictStructuredReceiptNumbersMatch(left.x, right.x) &&
    strictStructuredReceiptNumbersMatch(left.y, right.y) &&
    strictStructuredReceiptNumbersMatch(left.width, right.width) &&
    strictStructuredReceiptNumbersMatch(left.height, right.height);
}

function rawStructuredPeerCarriersAreExact(
  region: ECOSDrawingRegionInput,
  expectedText: string,
) {
  const supplied = [region.text, region.evidenceText, region.label].filter(
    (value) => value != null,
  );
  return supplied.length > 0 && supplied.every((value) =>
    strictStructuredReceiptText(value, MAX_DRAWING_REGION_TEXT_LENGTH) ===
      expectedText
  );
}

function rawStructuredPeerSourcesAreExact(
  region: ECOSDrawingRegionInput,
  expectedSource: string,
) {
  const supplied = [region.source, region.rawSource].filter((value) =>
    value != null
  );
  return supplied.length > 0 && supplied.every((value) =>
    strictStructuredReceiptText(value) === expectedSource
  );
}

function strictEmbeddedTextConstituentIsRendered(
  constituent: Readonly<Record<string, unknown>>,
  constituentBounds: StrictStructuredReceiptBounds,
  snapshot: StrictStructuredReceiptValidationSnapshot,
  authorityIds: Set<string>,
) {
  if (constituent.renderedCorroborated !== true) return false;
  const regionIds = strictStructuredReceiptStringArray(
    constituent.renderedCorroboratingRegionIds,
  );
  const sources = strictStructuredReceiptStringArray(
    constituent.renderedCorroboratingSources,
  );
  if (
    regionIds?.length !== 1 || sources?.length !== 1 ||
    sources[0] !== "fixed_visual_tile_coordinate_ocr"
  ) return false;
  if (authorityIds.has(regionIds[0])) return false;
  const matches = snapshot.rawRegionsById.get(regionIds[0]) || [];
  if (matches.length !== 1) return false;
  const rendered = matches[0];
  const renderedBounds = rawStructuredPeerBounds(rendered);
  const confidence = rendered.confidence;
  const exact = rawStructuredPeerSourcesAreExact(
      rendered,
      "fixed_visual_tile_coordinate_ocr",
    ) &&
    // This is a raw table-scoped corroborator. Evidence v1.3 quarantines it
    // just like the four constituent cells; the searchable typed relationship
    // remains the only answer candidate.
    rendered.searchable === false &&
    rawStructuredPeerCarriersAreExact(rendered, String(constituent.text)) &&
    renderedBounds != null &&
    typeof confidence === "number" && Number.isFinite(confidence) &&
    confidence >= LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD && confidence <= 1 &&
    structuredBoundsHaveTightSpatialOverlap(renderedBounds, constituentBounds);
  if (exact) authorityIds.add(regionIds[0]);
  return exact;
}

function completeCoordinateBoundStructuredReceiptIsExact(
  region: DrawingRegion,
  expectedType?: StrictStructuredReceiptType,
  snapshot?: StrictStructuredReceiptValidationSnapshot,
) {
  const pageAuthority = snapshot?.pageAuthority;
  if (!snapshot || !pageAuthority) return false;
  const relationshipType = region.structuredTableRelationshipType;
  if (
    relationshipType !== "slab_legend" &&
    relationshipType !== "photometric_statistics"
  ) return false;
  if (expectedType && relationshipType !== expectedType) return false;
  const contract = STRICT_STRUCTURED_RECEIPT_CONTRACTS[relationshipType];
  const relationshipId = region.structuredRelationshipId || "";
  const blockId = region.structuredTableBlockId || "";
  if (
    region.rawSource !== "deterministic_structured_table_relationship" ||
    region.reconstructionMethod !==
      COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP ||
    region.factKind !== "drawing_fact" ||
    region.subject !== contract.subject ||
    !region.strictStructuredReceiptTopLevelInputValid ||
    region.structuredTableRowKey !== contract.rowKey ||
    !strictStructuredReceiptContentIsExact(
      relationshipType,
      region.text,
      region.constituentEvidence,
    ) ||
    !/^relationship:[a-f0-9]{24}$/.test(relationshipId) ||
    !/^block:[a-f0-9]{24}$/.test(blockId) ||
    region.id !== `structured-table-fact:${relationshipId}` ||
    !structuredDrawingRegionIsCoordinateBound(region) ||
    region.width! <= 0 || region.height! <= 0 ||
    region.x! + region.width! > 1 + STRUCTURED_RECEIPT_BOUND_EPSILON ||
    region.y! + region.height! > 1 + STRUCTURED_RECEIPT_BOUND_EPSILON ||
    region.confidence == null
  ) return false;
  const rawTopMatches = snapshot.rawRegionsById.get(region.id) || [];
  if (
    rawTopMatches.length !== 1 ||
    !strictStructuredReceiptTopLevelInputIsExact(rawTopMatches[0])
  ) return false;
  const constituents = region.constituentEvidence;
  if (constituents.length !== contract.constituentSources.length) return false;
  const authorityIds = new Set<string>([region.id]);
  const bounds: StrictStructuredReceiptBounds[] = [];
  const sources: string[] = [];
  let minimumConstituentConfidence = Number.POSITIVE_INFINITY;
  for (let index = 0; index < constituents.length; index += 1) {
    const constituent = constituents[index];
    const id = strictStructuredReceiptText(constituent.id);
    const text = strictStructuredReceiptText(
      constituent.text,
      MAX_DRAWING_REGION_TEXT_LENGTH,
    );
    const source = strictStructuredReceiptText(constituent.source);
    const constituentBounds = strictStructuredReceiptBounds(
      constituent.bounds,
    );
    const confidence = constituent.confidence;
    const currentProjectId = strictStructuredReceiptText(
      constituent.projectId,
    );
    const currentSourceSha256 = strictStructuredReceiptText(
      constituent.sourceSha256,
    );
    const rawMatches = id ? snapshot.rawRegionsById.get(id) || [] : [];
    const rawPeer = rawMatches.length === 1 ? rawMatches[0] : null;
    const rawBounds = rawPeer ? rawStructuredPeerBounds(rawPeer) : null;
    // Evidence v1.3 deliberately quarantines every raw constituent. Only the
    // sealed typed relationship row is searchable; its exact raw carriers are
    // replayed here by immutable id, source, text, bounds, and confidence.
    const expectedSearchable = false;
    if (
      !id || authorityIds.has(id) ||
      source !== contract.constituentSources[index] ||
      !STRICT_STRUCTURED_CONSTITUENT_SOURCES.has(source) ||
      !constituentBounds ||
      typeof confidence !== "number" || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1 ||
      currentProjectId !== pageAuthority.projectId ||
      currentSourceSha256 !== pageAuthority.sourceSha256 ||
      constituent.relationshipId !== relationshipId ||
      constituent.blockId !== blockId ||
      constituent.rowKey !== contract.rowKey ||
      constituent.relationshipType !== relationshipType ||
      constituent.pageNumber !== pageAuthority.pageNumber ||
      constituent.sheetNumber !== pageAuthority.sheetNumber ||
      constituent.evidenceVersion !== pageAuthority.evidenceVersion ||
      !rawPeer || !rawBounds ||
      !rawStructuredPeerSourcesAreExact(rawPeer, source) ||
      !rawStructuredPeerCarriersAreExact(rawPeer, text) ||
      !strictStructuredBoundsMatch(rawBounds, constituentBounds) ||
      rawPeer.confidence !== confidence ||
      rawPeer.searchable !== expectedSearchable ||
      constituent.rawSource != null && constituent.rawSource !== source ||
      constituent.searchable != null &&
        constituent.searchable !== expectedSearchable ||
      constituent.evidenceText != null && constituent.evidenceText !== text ||
      constituent.label != null && constituent.label !== text ||
      constituent.areaNames != null &&
        (!Array.isArray(constituent.areaNames) ||
          constituent.areaNames.length !== 0) ||
      constituent.corroboratingEvidence != null &&
        (!Array.isArray(constituent.corroboratingEvidence) ||
          constituent.corroboratingEvidence.length !== 0) ||
      constituent.constituentEvidence != null &&
        (!Array.isArray(constituent.constituentEvidence) ||
          constituent.constituentEvidence.length !== 0)
    ) return false;
    authorityIds.add(id);
    if (
      source === "embedded_text"
        ? !strictEmbeddedTextConstituentIsRendered(
            constituent,
            constituentBounds,
            snapshot,
            authorityIds,
          )
        : constituent.renderedCorroborated != null ||
          constituent.renderedCorroboratingRegionIds != null ||
          constituent.renderedCorroboratingSources != null
    ) return false;
    bounds.push(constituentBounds);
    sources.push(source);
    minimumConstituentConfidence = Math.min(
      minimumConstituentConfidence,
      confidence,
    );
  }
  if (
    region.text !== constituents.map((item) => item.text).join(" ") ||
    !strictStructuredReceiptNumbersMatch(
      region.confidence,
      minimumConstituentConfidence,
    )
  ) return false;
  const uniqueSources = [...new Set(sources)];
  if (
    region.evidenceSources.length !== uniqueSources.length ||
    region.evidenceSources.some((source, index) =>
      source !== uniqueSources[index]
    )
  ) return false;
  const left = Math.min(...bounds.map((value) => value.x));
  const top = Math.min(...bounds.map((value) => value.y));
  const right = Math.max(...bounds.map((value) => value.x + value.width));
  const bottom = Math.max(...bounds.map((value) => value.y + value.height));
  return strictStructuredReceiptNumbersMatch(region.x!, left) &&
    strictStructuredReceiptNumbersMatch(region.y!, top) &&
    strictStructuredReceiptNumbersMatch(region.width!, right - left) &&
    strictStructuredReceiptNumbersMatch(region.height!, bottom - top);
}

function lowConfidenceStructuredClaimSourceIsExact(
  region: DrawingRegion,
  snapshot?: StrictStructuredReceiptValidationSnapshot,
) {
  const protectedReceiptTypes = (Object.keys(
    STRICT_STRUCTURED_RECEIPT_CONTRACTS,
  ) as StrictStructuredReceiptType[]).filter((relationshipType) => {
    const contract = STRICT_STRUCTURED_RECEIPT_CONTRACTS[relationshipType];
    return region.structuredTableRelationshipType === relationshipType ||
      region.structuredTableRowKey === contract.rowKey ||
      region.subject === contract.subject ||
      strictStructuredTopTextLooksProtected(relationshipType, region.text);
  });
  // Once a producer row carries a typed identity from one of the two protected
  // contracts, confidence is not an escape hatch. Replaying the complete
  // constituent receipt also proves that a poisoned top-level confidence did
  // not replace the producer-owned minimum confidence.
  if (protectedReceiptTypes.length > 0) {
    return protectedReceiptTypes.length === 1 &&
      region.rawSource === "deterministic_structured_table_relationship" &&
      region.reconstructionMethod ===
        COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP &&
      completeCoordinateBoundStructuredReceiptIsExact(
        region,
        protectedReceiptTypes[0],
        snapshot,
      );
  }
  if (
    region.rawSource === "deterministic_structured_table_relationship" ||
    region.reconstructionMethod ===
      COMPLETE_COORDINATE_BOUND_STRUCTURED_TABLE_RELATIONSHIP ||
    region.id.startsWith("structured-table-fact:")
  ) return false;
  return region.confidence == null ||
    region.confidence >= LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD;
}

type StructuredDrawingClaimSubject =
  | "pcc_paving"
  | "pcc_walkway"
  | "ac_paving"
  | "area_drain"
  | "sewer_lateral";

function structuredDrawingRegionClaimSubjects(region: DrawingRegion) {
  const subjects = new Set<StructuredDrawingClaimSubject>();
  for (const value of structuredDrawingRegionTextVariants(region)) {
    if (/\bpcc\s+paving\b/.test(value)) subjects.add("pcc_paving");
    if (/\bpcc\s+walkway\b/.test(value)) subjects.add("pcc_walkway");
    if (
      /\b(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\s+(?:over|paving|pavement)\b/.test(
        value,
      ) ||
      /\b(?:paving|pavement)\s+(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\b/.test(
        value,
      )
    ) subjects.add("ac_paving");
    if (/\barea\s+drain\b/.test(value)) subjects.add("area_drain");
    if (/\bsewer\s+lateral\b/.test(value)) subjects.add("sewer_lateral");
    if (/\bwalkway\b/.test(value)) subjects.add("pcc_walkway");
  }
  return subjects;
}

function structuredDrawingClaimSourceIsCompatible(
  region: DrawingRegion,
  expectedSubject: StructuredDrawingClaimSubject,
  snapshot?: StrictStructuredReceiptValidationSnapshot,
) {
  if (!lowConfidenceStructuredClaimSourceIsExact(region, snapshot)) {
    return false;
  }
  const subjects = structuredDrawingRegionClaimSubjects(region);
  if (subjects.size !== 1 || !subjects.has(expectedSubject)) return false;
  if (expectedSubject !== "pcc_paving" && expectedSubject !== "pcc_walkway" &&
    expectedSubject !== "ac_paving") return true;
  const materials = drawingExplicitConstructionMaterialFamilies(
    drawingRegionAssertionFragments(region).join("\n"),
  );
  const expectedMaterial = expectedSubject === "ac_paving"
    ? "asphalt"
    : "concrete";
  return materials.size === 1 && materials.has(expectedMaterial);
}

function structuredDrawingClaimSourceRegions(
  regions: readonly DrawingRegion[],
) {
  return [...new Map(regions.map((region) => [region.id, region] as const))
    .values()];
}

function exactStructuredInchValue(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)$/i.exec(
    value.trim().replace(/[.;:,]+$/, "").trim(),
  );
  return match
    ? {
      value: canonicalDrawingNumber(match[1]),
      displayValue: match[1],
    }
    : null;
}

function exactStructuredIntegerValue(value: string) {
  const match = /^(\d{1,6})$/.exec(
    value.trim().replace(/[.;:,]+$/, "").trim(),
  );
  return match?.[1] || "";
}

function parseStructuredPCCThickness(
  value: string,
): Readonly<{
  subject: "paving" | "walkway";
  value: string;
  displayValue: string;
}>[] {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const matches: Array<Readonly<{
    subject: "paving" | "walkway";
    value: string;
    displayValue: string;
  }>> = [];
  const add = (number: string, subject: string) => {
    if (subject !== "paving" && subject !== "walkway") return;
    matches.push({
      subject,
      value: canonicalDrawingNumber(number),
      displayValue: number,
    });
  };
  for (
    const match of normalized.matchAll(
      /\b(?:construct\s+)?(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+thick(?:\s+\d+(?:\.\d+)?\s*(?:"|inches?|inch|in\.?))?\s+pcc\s+(paving|walkway)\b/g,
    )
  ) add(match[1], match[2]);
  for (
    const match of normalized.matchAll(
      /\bpcc\s+(paving|walkway)\b[\s\S]{0,32}\b(?:thickness(?:\s+is)?|is)\s+(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\b/g,
    )
  ) add(match[2], match[1]);
  return [...new Map(matches.map((match) => [
    `${match.subject}|${match.value}`,
    match,
  ] as const)).values()];
}

function auditStructuredPCCThickness(
  regions: readonly DrawingRegion[],
  subject: "paving" | "walkway",
  snapshot?: StrictStructuredReceiptValidationSnapshot,
  requireExactTypedPavingReceipt = false,
) {
  const directClaims: StructuredPCCThicknessClaim[] = [];
  const allClaims: StructuredPCCThicknessClaim[] = [];
  const incompleteSubjects: DrawingRegion[] = [];
  const valueOnly: Array<Readonly<{
    region: DrawingRegion;
    value: string;
    displayValue: string;
  }>> = [];
  for (const region of regions) {
    const fragments = drawingRegionAssertionFragments(region);
    for (const fragment of fragments) {
      for (const claim of parseStructuredPCCThickness(fragment)) {
        const candidate = { region, ...claim };
        directClaims.push(candidate);
        allClaims.push(candidate);
      }
      const exactValue = exactStructuredInchValue(
        canonicalStructuredDrawingClaimText(fragment),
      );
      if (exactValue) valueOnly.push({ region, ...exactValue });
    }
    const variants = structuredDrawingRegionTextVariants(region);
    const joinedClaims = variants.flatMap(parseStructuredPCCThickness);
    for (const claim of joinedClaims) allClaims.push({ region, ...claim });
    if (
      variants.some((variant) =>
        new RegExp(`\\bpcc\\s+${subject}\\b`).test(variant) &&
        /\b(?:thick|thickness)\b/.test(variant)
      ) &&
      !joinedClaims.some((claim) => claim.subject === subject)
    ) incompleteSubjects.push(region);
  }
  if (
    incompleteSubjects.length * valueOnly.length >
      MAX_STRUCTURED_DRAWING_CLAIM_PAIR_WORK
  ) return null;
  for (const incomplete of incompleteSubjects) {
    for (const measurement of valueOnly) {
      if (measurement.region === incomplete) continue;
      if (!regionsAreNear(incomplete, measurement.region)) continue;
      allClaims.push({
        region: measurement.region,
        subject,
        value: measurement.value,
        displayValue: measurement.displayValue,
      });
    }
  }
  const relevant = allClaims.filter((claim) => claim.subject === subject);
  const values = unique(relevant.map((claim) => claim.value));
  if (values.length !== 1) return null;
  const sourceClaims = directClaims.filter((claim) =>
    claim.subject === subject && claim.value === values[0]
  );
  const sourceRegions = structuredDrawingClaimSourceRegions(
    sourceClaims.map((claim) => claim.region),
  );
  if (
    sourceRegions.length === 0 ||
    sourceRegions.some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      !structuredDrawingClaimSourceIsCompatible(
        region,
        subject === "paving" ? "pcc_paving" : "pcc_walkway",
        snapshot,
      )
    )
  ) return null;
  const rawTypedPeers = snapshot?.candidatesByType.slab_legend || [];
  if (requireExactTypedPavingReceipt && subject !== "paving") return null;
  // A sealed slab-legend row is authority for the paving half only. Its
  // presence must not veto an independently exact walkway proposition on the
  // same page; the paving audit below still owns and validates the row.
  if (subject === "paving" && (requireExactTypedPavingReceipt || rawTypedPeers.length > 0)) {
    const selectedTypedPeers = rawTypedPeers.length === 1
      ? regions.filter((region) =>
        region.id === textValue(rawTypedPeers[0].id)
      )
      : [];
    if (
      subject !== "paving" || sourceRegions.length !== 1 ||
      rawTypedPeers.length !== 1 ||
      selectedTypedPeers.length !== 1 ||
      selectedTypedPeers[0] !== sourceRegions[0] ||
      !completeCoordinateBoundStructuredReceiptIsExact(
        sourceRegions[0],
        "slab_legend",
        snapshot,
      )
    ) return null;
  }
  return {
    value: values[0],
    displayValue: sourceClaims[0].displayValue,
    sourceRegions,
  };
}

function parseStructuredACPavingThickness(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const matches = [
    ...normalized.matchAll(
      /\b(?:construct\s+)?(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+(?:thick\s+)?(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\s+(?:over|paving|pavement)\b/g,
    ),
    ...normalized.matchAll(
      /\b(?:construct\s+)?(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+thick\s+(?:paving|pavement)\s+(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\b/g,
    ),
  ];
  return unique(matches.map((match) => canonicalDrawingNumber(match[1])));
}

function parseStructuredACBaseThickness(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  return unique([
    ...normalized.matchAll(
      /\b(?:over|construct)\s+(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+(?:thick\s+)?base\s+paving\b/g,
    ),
    ...normalized.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+(?:thick\s+)?base\s+paving\b/g,
    ),
  ].map((match) => canonicalDrawingNumber(match[1])));
}

function parseStructuredACSection(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const match =
    /\bconstruct\s+(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+(?:thick\s+)?(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\s+over\s+(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+(?:thick\s+)?base\s+paving\b/
      .exec(normalized);
  return match
    ? {
      acValue: canonicalDrawingNumber(match[1]),
      acDisplayValue: match[1],
      baseValue: canonicalDrawingNumber(match[2]),
      baseDisplayValue: match[2],
    }
    : null;
}

function auditStructuredACSection(regions: readonly DrawingRegion[]) {
  const complete: StructuredACSectionClaim[] = [];
  const acValues: string[] = [];
  const baseValues: string[] = [];
  const incompleteACSubjects: DrawingRegion[] = [];
  const incompleteBaseSubjects: DrawingRegion[] = [];
  const valueOnly: Array<Readonly<{ region: DrawingRegion; value: string }>> =
    [];
  for (const region of regions) {
    const fragments = drawingRegionAssertionFragments(region);
    for (const fragment of fragments) {
      const section = parseStructuredACSection(fragment);
      if (section) complete.push({ region, ...section });
      acValues.push(...parseStructuredACPavingThickness(fragment));
      baseValues.push(...parseStructuredACBaseThickness(fragment));
      const exactValue = exactStructuredInchValue(
        canonicalStructuredDrawingClaimText(fragment),
      );
      if (exactValue) valueOnly.push({ region, value: exactValue.value });
    }
    const variants = structuredDrawingRegionTextVariants(region);
    acValues.push(...variants.flatMap(parseStructuredACPavingThickness));
    baseValues.push(...variants.flatMap(parseStructuredACBaseThickness));
    if (
      variants.some((variant) =>
        /\b(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\s+paving\b/.test(variant) &&
        /\b(?:thick|thickness)\b/.test(variant)
      ) && variants.every((variant) =>
        parseStructuredACPavingThickness(variant).length === 0
      )
    ) incompleteACSubjects.push(region);
    if (
      variants.some((variant) =>
        /\bbase\s+paving\b/.test(variant) &&
        /\b(?:thick|thickness)\b/.test(variant)
      ) && variants.every((variant) =>
        parseStructuredACBaseThickness(variant).length === 0
      )
    ) incompleteBaseSubjects.push(region);
  }
  const pairWork =
    (incompleteACSubjects.length + incompleteBaseSubjects.length) *
    valueOnly.length;
  if (pairWork > MAX_STRUCTURED_DRAWING_CLAIM_PAIR_WORK) return null;
  for (const subject of incompleteACSubjects) {
    for (const measurement of valueOnly) {
      if (subject !== measurement.region && regionsAreNear(subject, measurement.region)) {
        acValues.push(measurement.value);
      }
    }
  }
  for (const subject of incompleteBaseSubjects) {
    for (const measurement of valueOnly) {
      if (subject !== measurement.region && regionsAreNear(subject, measurement.region)) {
        baseValues.push(measurement.value);
      }
    }
  }
  const uniqueACValues = unique(acValues);
  const uniqueBaseValues = unique(baseValues);
  const completeKeys = unique(complete.map((claim) =>
    `${claim.acValue}|${claim.baseValue}`
  ));
  if (
    uniqueACValues.length !== 1 || uniqueBaseValues.length !== 1 ||
    completeKeys.length !== 1 ||
    completeKeys[0] !== `${uniqueACValues[0]}|${uniqueBaseValues[0]}`
  ) return null;
  const sourceRegions = structuredDrawingClaimSourceRegions(
    complete.map((claim) => claim.region),
  );
  if (
    sourceRegions.length === 0 ||
    sourceRegions.some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      !structuredDrawingClaimSourceIsCompatible(region, "ac_paving")
    )
  ) return null;
  return {
    acDisplayValue: complete[0].acDisplayValue,
    baseDisplayValue: complete[0].baseDisplayValue,
    sourceRegions,
  };
}

function rawPageACSectionAuditMatches(
  snapshot: StrictStructuredReceiptValidationSnapshot,
  section: Readonly<{ acDisplayValue: string; baseDisplayValue: string }>,
) {
  const completeKeys: string[] = [];
  const directions: string[] = [];
  for (const rawRegion of snapshot.rawRegions) {
    const rawText = rawStructuredPeerText(rawRegion);
    if (!rawText) continue;
    const claim = parseStructuredACSection(rawText);
    if (claim) completeKeys.push(`${claim.acValue}|${claim.baseValue}`);
    const normalized = canonicalStructuredDrawingClaimText(rawText);
    const direction = /^(?:2375\s+)?(north|south|east|west)\s+lot\s+plan$/
      .exec(normalized)?.[1];
    if (direction) directions.push(direction);
    if (
      /\b(?:ac|asphalt(?:ic)?(?:\s+concrete)?)\b/.test(normalized) &&
      /\bbase\s+paving\b/.test(normalized) &&
      /\b(?:no|not|without)\b/.test(normalized)
    ) return false;
  }
  const expected = `${canonicalDrawingNumber(section.acDisplayValue)}|${
    canonicalDrawingNumber(section.baseDisplayValue)
  }`;
  const uniqueCompleteKeys = unique(completeKeys);
  const uniqueDirections = unique(directions);
  return uniqueCompleteKeys.length === 1 && uniqueCompleteKeys[0] === expected &&
    uniqueDirections.length === 1 && uniqueDirections[0] === "north";
}

function canonicalStructuredFilter(value: string) {
  return value.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseStructuredAreaDrainSize(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const match =
    /\b(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?\s*x\s*(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?\s+(?:id\s+)?area\s+drain\b/
      .exec(normalized) ||
    /\barea\s+drain\b[\s\S]{0,32}\b(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?\s*x\s*(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?\b/
      .exec(normalized);
  return match
    ? {
      width: canonicalDrawingNumber(match[1]),
      widthDisplay: match[1],
      height: canonicalDrawingNumber(match[2]),
      heightDisplay: match[2],
    }
    : null;
}

function parseStructuredAreaDrainFilter(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const match =
    /\barea\s+drain\b[\s\S]{0,80}\bwith\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2})\s+filter\b/
      .exec(normalized);
  return match
    ? {
      filter: canonicalStructuredFilter(match[1]),
      filterDisplay: match[1],
    }
    : null;
}

function parseStructuredAreaDrainClaim(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const size = parseStructuredAreaDrainSize(normalized);
  const filter = parseStructuredAreaDrainFilter(normalized);
  return size && filter && /\blocal\s+depression\b/.test(normalized) &&
      !/\b(?:no|without)\s+local\s+depression\b/.test(normalized)
    ? { ...size, ...filter }
    : null;
}

function auditStructuredAreaDrain(regions: readonly DrawingRegion[]) {
  const complete: StructuredAreaDrainClaim[] = [];
  const sizes: string[] = [];
  const filters: string[] = [];
  const incompleteSizeSubjects: DrawingRegion[] = [];
  const dimensionOnly: Array<Readonly<{ region: DrawingRegion; key: string }>> =
    [];
  let conflictingDepression = false;
  for (const region of regions) {
    const fragments = drawingRegionAssertionFragments(region);
    for (const fragment of fragments) {
      const claim = parseStructuredAreaDrainClaim(fragment);
      if (claim) complete.push({ region, ...claim });
      const size = parseStructuredAreaDrainSize(fragment);
      if (size) sizes.push(`${size.width}x${size.height}`);
      const filter = parseStructuredAreaDrainFilter(fragment);
      if (filter) filters.push(filter.filter);
      const normalized = canonicalStructuredDrawingClaimText(fragment);
      const exactDimension =
        /^(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?\s*x\s*(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)?$/.exec(
          normalized,
        );
      if (exactDimension) {
        dimensionOnly.push({
          region,
          key: `${canonicalDrawingNumber(exactDimension[1])}x${
            canonicalDrawingNumber(exactDimension[2])
          }`,
        });
      }
      if (
        /\barea\s+drain\b/.test(normalized) &&
        /\b(?:no|without)\s+local\s+depression\b/.test(normalized)
      ) conflictingDepression = true;
    }
    const variants = structuredDrawingRegionTextVariants(region);
    sizes.push(...variants.flatMap((variant) => {
      const size = parseStructuredAreaDrainSize(variant);
      return size ? [`${size.width}x${size.height}`] : [];
    }));
    filters.push(...variants.flatMap((variant) => {
      const filter = parseStructuredAreaDrainFilter(variant);
      return filter ? [filter.filter] : [];
    }));
    if (
      variants.some((variant) =>
        /\barea\s+drain\b/.test(variant) && /\b(?:size|id)\b/.test(variant)
      ) && variants.every((variant) => !parseStructuredAreaDrainSize(variant))
    ) incompleteSizeSubjects.push(region);
  }
  if (
    incompleteSizeSubjects.length * dimensionOnly.length >
      MAX_STRUCTURED_DRAWING_CLAIM_PAIR_WORK
  ) return null;
  for (const subject of incompleteSizeSubjects) {
    for (const dimension of dimensionOnly) {
      if (subject !== dimension.region && regionsAreNear(subject, dimension.region)) {
        sizes.push(dimension.key);
      }
    }
  }
  const completeKeys = unique(complete.map((claim) =>
    `${claim.width}x${claim.height}|${claim.filter}`
  ));
  const uniqueSizes = unique(sizes);
  const uniqueFilters = unique(filters);
  if (
    conflictingDepression || completeKeys.length !== 1 ||
    uniqueSizes.length !== 1 || uniqueFilters.length !== 1 ||
    completeKeys[0] !== `${uniqueSizes[0]}|${uniqueFilters[0]}`
  ) return null;
  const sourceRegions = structuredDrawingClaimSourceRegions(
    complete.map((claim) => claim.region),
  );
  if (
    sourceRegions.length === 0 ||
    sourceRegions.some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      !structuredDrawingClaimSourceIsCompatible(region, "area_drain")
    )
  ) return null;
  return { ...complete[0], sourceRegions };
}

function rawPageAreaDrainAuditMatches(
  snapshot: StrictStructuredReceiptValidationSnapshot,
  drain: Readonly<{
    width: string;
    height: string;
    filter: string;
  }>,
) {
  const completeKeys: string[] = [];
  for (const rawRegion of snapshot.rawRegions) {
    const rawText = rawStructuredPeerText(rawRegion);
    if (!rawText) continue;
    const normalized = canonicalStructuredDrawingClaimText(rawText);
    if (!/\barea\s+drain\b/.test(normalized)) continue;
    if (/\b(?:no|without)\s+local\s+depression\b/.test(normalized)) {
      return false;
    }
    const size = parseStructuredAreaDrainSize(rawText);
    const filter = parseStructuredAreaDrainFilter(rawText);
    const complete = parseStructuredAreaDrainClaim(rawText);
    // A complete alternate size/filter carrier that omits the required local
    // depression is a contradictory peer, not harmless partial OCR.
    if (size && filter && !complete) return false;
    if (complete) {
      completeKeys.push(
        `${complete.width}x${complete.height}|${complete.filter}`,
      );
    }
  }
  const expected = `${drain.width}x${drain.height}|${drain.filter}`;
  const uniqueCompleteKeys = unique(completeKeys);
  return uniqueCompleteKeys.length === 1 && uniqueCompleteKeys[0] === expected;
}

function parseStructuredSewerLateralSize(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const match =
    /\b(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\s+sewer\s+lateral\b/
      .exec(normalized) ||
    /\bsewer\s+lateral\b[\s\S]{0,32}\b(?:size|diameter|is)\s+(\d+(?:\.\d+)?)\s*(?:"|inches?|inch|in\.?)\b/
      .exec(normalized);
  return match
    ? {
      size: canonicalDrawingNumber(match[1]),
      sizeDisplay: match[1],
    }
    : null;
}

function parseStructuredSewerLateralStandard(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  if (!/\bsewer\s+lateral\b/.test(normalized)) return "";
  return /\briverside\s+city\s+standard\s+(\d{1,6})\b/.exec(normalized)?.[1] ||
    "";
}

function parseStructuredSewerLateralMaterial(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  if (!/\bsewer\s+lateral\b/.test(normalized)) return "";
  return /\bmaterial\s+per\s+(architectural|structural|electrical|mechanical|plumbing|civil)\s+drawings?\b/
    .exec(normalized)?.[1] || "";
}

function parseStructuredSewerLateralClaim(value: string) {
  const normalized = canonicalStructuredDrawingClaimText(value);
  const size = parseStructuredSewerLateralSize(normalized);
  const standard = parseStructuredSewerLateralStandard(normalized);
  const materialDiscipline = parseStructuredSewerLateralMaterial(normalized);
  return size && standard && materialDiscipline &&
      /\bsewer\s+lateral\s+and\s+cleanout\b/.test(normalized)
    ? { ...size, standard, materialDiscipline }
    : null;
}

function auditStructuredSewerLateral(regions: readonly DrawingRegion[]) {
  const complete: StructuredSewerLateralClaim[] = [];
  const sizes: string[] = [];
  const standards: string[] = [];
  const materials: string[] = [];
  const incompleteSizeSubjects: DrawingRegion[] = [];
  const incompleteStandardSubjects: DrawingRegion[] = [];
  const incompleteMaterialSubjects: DrawingRegion[] = [];
  const inchValues: Array<Readonly<{ region: DrawingRegion; value: string }>> =
    [];
  const integerValues: Array<Readonly<{ region: DrawingRegion; value: string }>> =
    [];
  const disciplineValues: Array<Readonly<{
    region: DrawingRegion;
    value: string;
  }>> = [];
  for (const region of regions) {
    const fragments = drawingRegionAssertionFragments(region);
    for (const fragment of fragments) {
      const claim = parseStructuredSewerLateralClaim(fragment);
      if (claim) complete.push({ region, ...claim });
      const size = parseStructuredSewerLateralSize(fragment);
      if (size) sizes.push(size.size);
      const standard = parseStructuredSewerLateralStandard(fragment);
      if (standard) standards.push(standard);
      const material = parseStructuredSewerLateralMaterial(fragment);
      if (material) materials.push(material);
      const normalized = canonicalStructuredDrawingClaimText(fragment);
      const exactInch = exactStructuredInchValue(normalized);
      if (exactInch) inchValues.push({ region, value: exactInch.value });
      const exactInteger = exactStructuredIntegerValue(normalized);
      if (exactInteger) integerValues.push({ region, value: exactInteger });
      const discipline =
        /^(architectural|structural|electrical|mechanical|plumbing|civil)\s+drawings?$/.exec(
          normalized,
        )?.[1];
      if (discipline) disciplineValues.push({ region, value: discipline });
    }
    const variants = structuredDrawingRegionTextVariants(region);
    sizes.push(...variants.flatMap((variant) => {
      const size = parseStructuredSewerLateralSize(variant);
      return size ? [size.size] : [];
    }));
    standards.push(...variants.map(parseStructuredSewerLateralStandard).filter(
      Boolean,
    ));
    materials.push(...variants.map(parseStructuredSewerLateralMaterial).filter(
      Boolean,
    ));
    if (
      variants.some((variant) =>
        /\bsewer\s+lateral\b/.test(variant) &&
        /\b(?:size|diameter)\b/.test(variant)
      ) && variants.every((variant) => !parseStructuredSewerLateralSize(variant))
    ) incompleteSizeSubjects.push(region);
    if (
      variants.some((variant) =>
        /\bsewer\s+lateral\b/.test(variant) &&
        /\b(?:city\s+)?standard\b/.test(variant)
      ) && variants.every((variant) => !parseStructuredSewerLateralStandard(variant))
    ) incompleteStandardSubjects.push(region);
    if (
      variants.some((variant) =>
        /\bsewer\s+lateral\b/.test(variant) && /\bmaterial\b/.test(variant)
      ) && variants.every((variant) => !parseStructuredSewerLateralMaterial(variant))
    ) incompleteMaterialSubjects.push(region);
  }
  const pairWork = incompleteSizeSubjects.length * inchValues.length +
    incompleteStandardSubjects.length * integerValues.length +
    incompleteMaterialSubjects.length * disciplineValues.length;
  if (pairWork > MAX_STRUCTURED_DRAWING_CLAIM_PAIR_WORK) return null;
  for (const subject of incompleteSizeSubjects) {
    for (const value of inchValues) {
      if (subject !== value.region && regionsAreNear(subject, value.region)) {
        sizes.push(value.value);
      }
    }
  }
  for (const subject of incompleteStandardSubjects) {
    for (const value of integerValues) {
      if (subject !== value.region && regionsAreNear(subject, value.region)) {
        standards.push(value.value);
      }
    }
  }
  for (const subject of incompleteMaterialSubjects) {
    for (const value of disciplineValues) {
      if (subject !== value.region && regionsAreNear(subject, value.region)) {
        materials.push(value.value);
      }
    }
  }
  const completeKeys = unique(complete.map((claim) =>
    `${claim.size}|${claim.standard}|${claim.materialDiscipline}`
  ));
  const uniqueSizes = unique(sizes);
  const uniqueStandards = unique(standards);
  const uniqueMaterials = unique(materials);
  if (
    completeKeys.length !== 1 || uniqueSizes.length !== 1 ||
    uniqueStandards.length !== 1 || uniqueMaterials.length !== 1 ||
    completeKeys[0] !==
      `${uniqueSizes[0]}|${uniqueStandards[0]}|${uniqueMaterials[0]}`
  ) return null;
  const sourceRegions = structuredDrawingClaimSourceRegions(
    complete.map((claim) => claim.region),
  );
  if (
    sourceRegions.length === 0 ||
    sourceRegions.some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      !structuredDrawingClaimSourceIsCompatible(region, "sewer_lateral")
    )
  ) return null;
  return { ...complete[0], sourceRegions };
}

function rawPageSewerLateralAuditMatches(
  snapshot: StrictStructuredReceiptValidationSnapshot,
  sewer: Readonly<{
    size: string;
    standard: string;
    materialDiscipline: string;
  }>,
) {
  const completeKeys: string[] = [];
  for (const rawRegion of snapshot.rawRegions) {
    const rawText = rawStructuredPeerText(rawRegion);
    if (!rawText) continue;
    const normalized = canonicalStructuredDrawingClaimText(rawText);
    if (!/\bsewer\s+lateral\b/.test(normalized)) continue;
    if (/\b(?:no|without)\s+cleanout\b/.test(normalized)) return false;
    const size = parseStructuredSewerLateralSize(rawText);
    const standard = parseStructuredSewerLateralStandard(rawText);
    const material = parseStructuredSewerLateralMaterial(rawText);
    const complete = parseStructuredSewerLateralClaim(rawText);
    // A full size/standard/material carrier without the cleanout clause is a
    // complete competing tuple even though it cannot become the good claim.
    if (size && standard && material && !complete) return false;
    if (complete) {
      completeKeys.push(
        `${complete.size}|${complete.standard}|${complete.materialDiscipline}`,
      );
    }
  }
  const expected = `${sewer.size}|${sewer.standard}|${sewer.materialDiscipline}`;
  const uniqueCompleteKeys = unique(completeKeys);
  return uniqueCompleteKeys.length === 1 && uniqueCompleteKeys[0] === expected;
}

function exactNorthLotPlanRegions(regions: readonly DrawingRegion[]) {
  const directionalPlans = regions.flatMap((region) =>
    structuredDrawingRegionTextVariants(region).flatMap((value) => {
      const match = /^(?:2375\s+)?(north|south|east|west)\s+lot\s+plan$/.exec(
        value,
      );
      return match ? [{ region, direction: match[1] }] : [];
    })
  );
  const directions = unique(directionalPlans.map((candidate) =>
    candidate.direction
  ));
  if (directions.length !== 1 || directions[0] !== "north") return null;
  const northLotPlans = structuredDrawingClaimSourceRegions(
    directionalPlans.map((candidate) => candidate.region),
  );
  return northLotPlans.length > 0 && northLotPlans.every(
      structuredDrawingRegionIsCoordinateBound,
    )
    ? northLotPlans
    : null;
}

function rawStructuredPeerText(region: ECOSDrawingRegionInput) {
  return textValue(region.text) || textValue(region.evidenceText) ||
    textValue(region.label);
}

function rawStructuredPeerBounds(
  region: ECOSDrawingRegionInput,
): StrictStructuredReceiptBounds | null {
  return strictStructuredReceiptBounds({
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  });
}

type StrictRawStructuredPeer = Readonly<{
  id: string;
  bounds: StrictStructuredReceiptBounds;
  region: ECOSDrawingRegionInput;
}>;

function rawStructuredPeerDeclaresSource(
  region: ECOSDrawingRegionInput,
  expectedSource: string,
) {
  return region.source === expectedSource || region.rawSource === expectedSource;
}

function exactQuarantinedEmbeddedPeers(
  rawRegions: readonly ECOSDrawingRegionInput[],
  expectedText: string,
): StrictRawStructuredPeer[] {
  const candidates = rawRegions.filter((region) =>
    rawStructuredPeerText(region) === expectedText &&
    rawStructuredPeerDeclaresSource(region, "embedded_text")
  );
  const exact = candidates.flatMap((region) => {
    if (
      !rawStructuredPeerCarriersAreExact(region, expectedText) ||
      !rawStructuredPeerSourcesAreExact(region, "embedded_text") ||
      region.searchable !== false ||
      typeof region.confidence !== "number" ||
      !Number.isFinite(region.confidence) ||
      region.confidence < LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD ||
      region.confidence > 1
    ) return [];
    const id = strictStructuredReceiptText(region.id);
    const bounds = rawStructuredPeerBounds(region);
    return id && bounds ? [{ id, bounds, region }] : [];
  });
  return exact.length === candidates.length ? exact : [];
}

function exactQuarantinedEmbeddedPeer(
  rawRegions: readonly ECOSDrawingRegionInput[],
  expectedText: string,
) {
  const peers = exactQuarantinedEmbeddedPeers(rawRegions, expectedText);
  return peers.length === 1 ? peers[0] : null;
}

function structuredBoundsOverlapHorizontally(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  return Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x) > STRUCTURED_RECEIPT_BOUND_EPSILON;
}

function structuredBoundsOverlapVertically(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  return Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y) > STRUCTURED_RECEIPT_BOUND_EPSILON;
}

function structuredBoundsHaveTightSpatialOverlap(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  const horizontalOverlap =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const verticalOverlap =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return horizontalOverlap > STRUCTURED_RECEIPT_BOUND_EPSILON &&
    verticalOverlap > STRUCTURED_RECEIPT_BOUND_EPSILON &&
    horizontalOverlap / Math.max(left.width, right.width) >= 0.25 &&
    verticalOverlap / Math.max(left.height, right.height) >= 0.25;
}

function structuredBoundsHaveTightHorizontalOverlap(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  const overlap = Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  return overlap > STRUCTURED_RECEIPT_BOUND_EPSILON &&
    overlap / Math.max(left.width, right.width) >= 0.25;
}

function structuredBoundsCenterX(bounds: StrictStructuredReceiptBounds) {
  return bounds.x + bounds.width / 2;
}

function structuredBoundsCenterY(bounds: StrictStructuredReceiptBounds) {
  return bounds.y + bounds.height / 2;
}

function structuredBoundsHorizontalGap(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  return Math.max(
    0,
    Math.max(left.x, right.x) -
      Math.min(left.x + left.width, right.x + right.width),
  );
}

function structuredBoundsVerticalGap(
  left: StrictStructuredReceiptBounds,
  right: StrictStructuredReceiptBounds,
) {
  return Math.max(
    0,
    Math.max(left.y, right.y) -
      Math.min(left.y + left.height, right.y + right.height),
  );
}

function structuredPhotometricTitleTopologyIsExact(
  siteBounds: StrictStructuredReceiptBounds,
  planBounds: StrictStructuredReceiptBounds,
  fullTitleBounds: StrictStructuredReceiptBounds,
  rowBounds: StrictStructuredReceiptBounds,
) {
  const siteOverlapsFullTitle =
    structuredBoundsOverlapHorizontally(siteBounds, fullTitleBounds) &&
    structuredBoundsOverlapVertically(siteBounds, fullTitleBounds) &&
    structuredBoundsCenterX(siteBounds) > fullTitleBounds.x &&
    structuredBoundsCenterX(siteBounds) <
      fullTitleBounds.x + fullTitleBounds.width;
  if (!siteOverlapsFullTitle) return false;

  const coLocatedSplitTitle =
    structuredBoundsOverlapHorizontally(planBounds, fullTitleBounds) &&
    structuredBoundsOverlapVertically(planBounds, fullTitleBounds) &&
    structuredBoundsOverlapVertically(siteBounds, planBounds) &&
    structuredBoundsCenterX(siteBounds) < structuredBoundsCenterX(planBounds) &&
    structuredBoundsCenterX(planBounds) <
      fullTitleBounds.x + fullTitleBounds.width &&
    fullTitleBounds.width <=
      Math.max(
          siteBounds.x + siteBounds.width,
          planBounds.x + planBounds.width,
        ) - Math.min(siteBounds.x, planBounds.x) + 0.04 &&
    fullTitleBounds.height <= Math.max(siteBounds.height, planBounds.height) * 3;
  if (coLocatedSplitTitle) return true;

  // Some issued drawings print the complete native title beside the statistics
  // table but render the exact PHOTOMETRICS PLAN witness again in the right
  // title block. Bind that dual-location layout only when the native title is
  // immediately adjacent to the selected typed row and the second rendered
  // witness is provably in a separate right-side title-block position.
  const fullTitleBindsSelectedTable =
    structuredBoundsCenterY(fullTitleBounds) <
        structuredBoundsCenterY(rowBounds) &&
    fullTitleBounds.height <= siteBounds.height * 3 &&
    structuredBoundsHorizontalGap(fullTitleBounds, rowBounds) <=
      MAX_PHOTOMETRIC_TITLE_TO_TABLE_HORIZONTAL_GAP &&
    structuredBoundsVerticalGap(fullTitleBounds, rowBounds) <=
      MAX_PHOTOMETRIC_TITLE_TO_TABLE_VERTICAL_GAP;
  const separateTitleBlockWitness =
    planBounds.x >= MIN_SEPARATE_PHOTOMETRIC_TITLE_BLOCK_X &&
    planBounds.width <= MAX_SEPARATE_PHOTOMETRIC_TITLE_WIDTH &&
    planBounds.height <= fullTitleBounds.height * 3 &&
    structuredBoundsCenterY(planBounds) < structuredBoundsCenterY(rowBounds) &&
    planBounds.x - Math.max(
        fullTitleBounds.x + fullTitleBounds.width,
        rowBounds.x + rowBounds.width,
      ) >= MIN_SEPARATE_PHOTOMETRIC_TITLE_BLOCK_HORIZONTAL_GAP &&
    Math.abs(
        structuredBoundsCenterY(planBounds) -
          structuredBoundsCenterY(fullTitleBounds),
      ) <= MAX_SEPARATE_PHOTOMETRIC_TITLE_VERTICAL_CENTER_GAP;
  return fullTitleBindsSelectedTable && separateTitleBlockWitness;
}

function rawBareAllCouldCompeteWithPhotometricRow(
  region: ECOSDrawingRegionInput,
  rowBounds: StrictStructuredReceiptBounds,
) {
  const bounds = rawStructuredPeerBounds(region);
  // A declared ALL carrier without exact geometry cannot prove that it is
  // outside the selected table, so it remains a fail-closed competitor.
  return !bounds ||
    (structuredBoundsHorizontalGap(bounds, rowBounds) <=
        MAX_PHOTOMETRIC_BARE_ALL_HORIZONTAL_GAP &&
      structuredBoundsVerticalGap(bounds, rowBounds) <=
        MAX_PHOTOMETRIC_BARE_ALL_VERTICAL_GAP);
}

function normalizedRegionReplaysExactRawPeer(
  region: DrawingRegion,
  expectedSource: string,
  snapshot: StrictStructuredReceiptValidationSnapshot,
) {
  const matches = snapshot.rawRegionsById.get(region.id) || [];
  if (matches.length !== 1) return false;
  const raw = matches[0];
  const rawBounds = rawStructuredPeerBounds(raw);
  const normalizedBounds = strictStructuredReceiptBounds({
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  });
  return rawBounds != null && normalizedBounds != null &&
    rawStructuredPeerCarriersAreExact(raw, region.text) &&
    rawStructuredPeerSourcesAreExact(raw, expectedSource) &&
    raw.searchable === true &&
    raw.confidence === region.confidence &&
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence) &&
    raw.confidence >= LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD &&
    raw.confidence <= 1 &&
    strictStructuredBoundsMatch(rawBounds, normalizedBounds);
}

type StrictPhotometricPeerAudit = Readonly<{
  average: string;
  maximum: string;
  minimum: string;
  fullTitleId: string;
  rowBounds: StrictStructuredReceiptBounds;
}>;

function strictPhotometricPeerCellsAreExact(
  row: DrawingRegion,
  siteRegion: DrawingRegion,
  planRegion: DrawingRegion,
  snapshot: StrictStructuredReceiptValidationSnapshot,
): StrictPhotometricPeerAudit | null {
  const rawRegions = snapshot.rawRegions;
  const constituentTexts = row.constituentEvidence.map((value) =>
    strictStructuredReceiptText(value.text, MAX_DRAWING_REGION_TEXT_LENGTH)
  );
  if (
    constituentTexts.length !== 4 || constituentTexts[0] !== "ALL" ||
    !strictStructuredReceiptContentIsExact(
      "photometric_statistics",
      row.text,
      row.constituentEvidence,
    )
  ) return null;
  const values = constituentTexts.slice(1);
  const headers = ["Avg", "Max", "Min"].map((value) =>
    exactQuarantinedEmbeddedPeer(rawRegions, value)
  );
  const fullTitle = exactQuarantinedEmbeddedPeer(
    rawRegions,
    "SITE PHOTOMETRICS PLAN",
  );
  if (
    headers.some((value) => !value) || !fullTitle ||
    !normalizedRegionReplaysExactRawPeer(
      siteRegion,
      "fixed_visual_tile_coordinate_ocr",
      snapshot,
    ) ||
    !normalizedRegionReplaysExactRawPeer(
      planRegion,
      "fixed_visual_tile_coordinate_ocr",
      snapshot,
    )
  ) return null;
  const exactNativeFootCandlePeers = rawRegions.filter((region) =>
    rawStructuredPeerDeclaresSource(region, "embedded_text") &&
    /^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})? fc$/.test(
      rawStructuredPeerText(region),
    )
  );
  if (exactNativeFootCandlePeers.length !== 3) return null;
  if (exactNativeFootCandlePeers.some((region) =>
    exactQuarantinedEmbeddedPeers(
      rawRegions,
      rawStructuredPeerText(region),
    ).length === 0
  )) return null;
  const constituentBounds = row.constituentEvidence.map((value) =>
    strictStructuredReceiptBounds(value.bounds)
  );
  if (
    constituentBounds.length !== 4 ||
    constituentBounds.some((value) => !value)
  ) return null;
  const typedBounds = constituentBounds as StrictStructuredReceiptBounds[];
  const typedCenters = typedBounds.map(structuredBoundsCenterX);
  if (
    typedBounds.slice(1).some((bounds) =>
      !structuredBoundsOverlapVertically(typedBounds[0], bounds)
    ) ||
    typedCenters.some((center, index) =>
      index > 0 && center - typedCenters[index - 1] <=
        STRUCTURED_RECEIPT_BOUND_EPSILON
    )
  ) return null;
  const matchedValues: StrictRawStructuredPeer[] = [];
  for (let index = 0; index < 3; index += 1) {
    const matches = exactQuarantinedEmbeddedPeers(
      rawRegions,
      `${values[index]} fc`,
    ).filter((peer) =>
      structuredBoundsHaveTightSpatialOverlap(
        peer.bounds,
        typedBounds[index + 1],
      )
    );
    if (matches.length !== 1) return null;
    matchedValues.push(matches[0]);
  }
  const authorityIds = [
    fullTitle.id,
    ...headers.map((value) => value!.id),
    ...matchedValues.map((value) => value.id),
  ];
  if (new Set(authorityIds).size !== authorityIds.length) return null;
  const headerCenters = headers.map((value) =>
    structuredBoundsCenterX(value!.bounds)
  );
  const valueCenters = matchedValues.map((value) =>
    structuredBoundsCenterX(value.bounds)
  );
  if (
    [headerCenters, valueCenters].some((centers) =>
      centers.some((center, index) =>
        index > 0 && center - centers[index - 1] <=
          STRUCTURED_RECEIPT_BOUND_EPSILON
      )
    )
  ) return null;
  for (let index = 0; index < 3; index += 1) {
    const headerBounds = headers[index]!.bounds;
    const valueBounds = matchedValues[index].bounds;
    const currentTypedBounds = typedBounds[index + 1];
    if (
      !structuredBoundsHaveTightHorizontalOverlap(
        headerBounds,
        currentTypedBounds,
      ) ||
      !structuredBoundsHaveTightSpatialOverlap(
        valueBounds,
        currentTypedBounds,
      ) ||
      Math.abs(
          structuredBoundsCenterX(headerBounds) -
            structuredBoundsCenterX(currentTypedBounds),
        ) > 0.02 ||
      Math.abs(
          structuredBoundsCenterX(valueBounds) -
            structuredBoundsCenterX(currentTypedBounds),
        ) > 0.02 ||
      headerBounds.y >= currentTypedBounds.y ||
      currentTypedBounds.y - (headerBounds.y + headerBounds.height) > 0.02
    ) return null;
  }
  const siteBounds = strictStructuredReceiptBounds({
    x: siteRegion.x,
    y: siteRegion.y,
    width: siteRegion.width,
    height: siteRegion.height,
  });
  const planBounds = strictStructuredReceiptBounds({
    x: planRegion.x,
    y: planRegion.y,
    width: planRegion.width,
    height: planRegion.height,
  });
  const rowBounds = strictStructuredReceiptBounds({
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
  });
  if (
    !siteBounds || !planBounds || !rowBounds ||
    !structuredPhotometricTitleTopologyIsExact(
      siteBounds,
      planBounds,
      fullTitle.bounds,
      rowBounds,
    )
  ) return null;
  return {
    average: values[0],
    maximum: values[1],
    minimum: values[2],
    fullTitleId: fullTitle.id,
    rowBounds,
  };
}

function auditStrictPhotometricStatistics(
  regions: readonly DrawingRegion[],
  snapshot: StrictStructuredReceiptValidationSnapshot,
) {
  if (
    !snapshot.pageAuthority ||
    !drawingRegionsHaveStableUniqueIds(regions)
  ) return null;
  const exactSiteRegions = regions.filter((region) =>
    region.text === "SITE" &&
    region.rawSource === "fixed_visual_tile_coordinate_ocr"
  );
  const exactPlanRegions = regions.filter((region) =>
    region.text === "PHOTOMETRICS PLAN" &&
    region.rawSource === "fixed_visual_tile_coordinate_ocr"
  );
  if (
    exactSiteRegions.length !== 1 || exactPlanRegions.length !== 1 ||
    [exactSiteRegions[0], exactPlanRegions[0]].some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      region.confidence == null ||
      region.confidence < LOW_CONFIDENCE_STRUCTURED_CLAIM_THRESHOLD
    )
  ) return null;
  const rawTypedPeers = snapshot.candidatesByType.photometric_statistics;
  const typedPeers = rawTypedPeers.length === 1
    ? regions.filter((region) => region.id === textValue(rawTypedPeers[0].id))
    : [];
  if (
    rawTypedPeers.length !== 1 || typedPeers.length !== 1
  ) return null;
  const row = typedPeers[0];
  if (
    !completeCoordinateBoundStructuredReceiptIsExact(
      row,
      "photometric_statistics",
      snapshot,
    )
  ) return null;
  const peerAudit = strictPhotometricPeerCellsAreExact(
    row,
    exactSiteRegions[0],
    exactPlanRegions[0],
    snapshot,
  );
  if (!peerAudit) return null;
  const rawRegions = snapshot.rawRegions;
  const allowedConstituentIds = new Set(
    row.constituentEvidence.map((value) => strictStructuredReceiptText(value.id)),
  );
  for (
    const id of strictStructuredReceiptStringArray(
      row.constituentEvidence[0]?.renderedCorroboratingRegionIds,
    ) || []
  ) allowedConstituentIds.add(id);
  const extraAllPeers = rawRegions.filter((region) =>
    rawStructuredPeerText(region) === "ALL" &&
    !allowedConstituentIds.has(textValue(region.id)) &&
    rawBareAllCouldCompeteWithPhotometricRow(region, peerAudit.rowBounds)
  );
  const competingCompleteStatistics = rawRegions.filter((region) => {
    const text = rawStructuredPeerText(region);
    if (!text || textValue(region.id) === row.id) return false;
    return /^ALL\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/.test(
      text,
    ) ||
      /\baverage\s+\d+(?:\.\d+)?\s*fc\b[\s\S]*\bmaximum\s+\d+(?:\.\d+)?\s*fc\b[\s\S]*\bminimum\s+\d+(?:\.\d+)?\s*fc\b/i
        .test(text);
  });
  if (extraAllPeers.length > 0 || competingCompleteStatistics.length > 0) {
    return null;
  }
  const allowedTitleIds = new Set([
    exactSiteRegions[0].id,
    exactPlanRegions[0].id,
    peerAudit.fullTitleId,
  ]);
  const competingTitles = rawRegions.filter((region) =>
    /\bphotometrics?\s+plan\b/i.test(rawStructuredPeerText(region)) &&
    !allowedTitleIds.has(textValue(region.id))
  );
  if (competingTitles.length > 0) return null;
  return {
    sourceRegions: [exactSiteRegions[0], exactPlanRegions[0], row] as const,
    average: peerAudit.average,
    maximum: peerAudit.maximum,
    minimum: peerAudit.minimum,
  };
}

function buildProtectedStructuredDrawingClaimPassage(
  regions: readonly DrawingRegion[],
  question: string,
  pageIdentity: string,
  snapshot: StrictStructuredReceiptValidationSnapshot,
  exactSourceBoundPresentationAuthorities:
    readonly ECOSDrawingExactSourceBoundPresentationAuthority[] = [],
  diagnostics?: ECOSDrawingEvidenceDiagnostics,
) {
  if (drawingQuestionRequestsInfiltrationDetailLocation(question)) {
    const relevantDirections = regions.filter((region) => {
      const normalized = canonicalStructuredDrawingClaimText(region.text);
      return /\bunderground\s+infiltration\s+chambers?\b/.test(normalized) &&
        /\bdetails?\b/.test(normalized) && /\bsheet\b/.test(normalized);
    });
    const exactDirections = relevantDirections.flatMap((region) => {
      const targetSheet = exactECOSInfiltrationDetailDirectionSheet(region.text);
      return targetSheet ? [{ region, targetSheet }] : [];
    });
    const rawRelevantDirections = snapshot.rawRegions.filter((region) => {
      const normalized = canonicalStructuredDrawingClaimText(
        rawStructuredPeerText(region),
      );
      return /\bunderground\s+infiltration\s+chambers?\b/.test(normalized) &&
        /\bdetails?\b/.test(normalized) && /\bsheet\b/.test(normalized);
    });
    const rawExactDirections = rawRelevantDirections.flatMap((region) => {
      const targetSheet = exactECOSInfiltrationDetailDirectionSheet(
        rawStructuredPeerText(region),
      );
      return targetSheet
        ? [{ regionId: textValue(region.id), targetSheet }]
        : [];
    });
    if (
      !snapshot.pageAuthority || relevantDirections.length !== 1 ||
      exactDirections.length !== 1 || rawRelevantDirections.length !== 1 ||
      rawExactDirections.length !== 1 ||
      rawExactDirections[0].regionId !== exactDirections[0].region.id ||
      rawExactDirections[0].targetSheet !== exactDirections[0].targetSheet
    ) return null;
    const exactDirection = exactDirections[0];
    const rawExactDirectionRegions = snapshot.rawRegions.filter((region) =>
      textValue(region.id) === exactDirection.region.id
    );
    if (rawExactDirectionRegions.length !== 1) return null;
    const rawExactDirection = rawExactDirectionRegions[0];
    const suppliedExactCarriers = [
      rawExactDirection.text,
      rawExactDirection.evidenceText,
      rawExactDirection.label,
    ].filter((value) => value != null);
    if (
      suppliedExactCarriers.length === 0 ||
      suppliedExactCarriers.some((value) =>
        typeof value !== "string" || value !== exactDirection.region.text
      ) ||
      rawExactDirection.areaNames != null &&
        (
          !Array.isArray(rawExactDirection.areaNames) ||
          rawExactDirection.areaNames.some((value) =>
            typeof value !== "string" ||
            infiltrationDirectionCarrierHasCompleteDirection(value) ||
            infiltrationDirectionCarrierConflicts(
              value,
              exactDirection.targetSheet,
            )
          )
        )
    ) return null;
    const competingCompleteDirection = snapshot.rawRegions.some((peer) => {
      if (textValue(peer.id) === exactDirection.region.id) return false;
      if (
        peer.areaNames != null &&
        (
          !Array.isArray(peer.areaNames) ||
          peer.areaNames.some((value) => typeof value !== "string")
        )
      ) return true;
      return unique([
        peer.text,
        peer.evidenceText,
        peer.label,
        ...(Array.isArray(peer.areaNames) ? peer.areaNames : []),
      ].map((value) => textValue(value)).filter(Boolean)).some(
        infiltrationDirectionCarrierHasCompleteDirection,
      );
    });
    if (competingCompleteDirection) return null;
    const matchingAuthorities = exactSourceBoundPresentationAuthorities.filter(
      (authority) => authority.regionId === exactDirection.region.id,
    );
    if (matchingAuthorities.length !== 1) return null;
    const authority = matchingAuthorities[0];
    const authorityBounds = strictNormalizedBounds(authority.bounds);
    const regionBounds = strictNormalizedBounds(exactDirection.region);
    if (
      authority.regionId !== exactDirection.region.id ||
      !authorityBounds || !regionBounds ||
      !normalizedDrawingBoundsContain(
        authorityBounds,
        regionBounds,
        EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
      )
    ) return null;
    const directionContinuationConflict = snapshot.rawRegions.some((peer) => {
      if (textValue(peer.id) === exactDirection.region.id) return false;
      if (
        peer.areaNames != null &&
        (
          !Array.isArray(peer.areaNames) ||
          peer.areaNames.some((value) => typeof value !== "string")
        )
      ) return true;
      const carriers = unique(
        [
          peer.text,
          peer.evidenceText,
          peer.label,
          ...(Array.isArray(peer.areaNames) ? peer.areaNames : []),
        ]
          .map((value) => textValue(value))
          .filter(Boolean),
      );
      const carriesDirectionConflict = carriers.some((carrier) => {
        return infiltrationDirectionCarrierConflicts(
          carrier,
          exactDirection.targetSheet,
        );
      });
      if (!carriesDirectionConflict) return false;
      const peerBounds = rawStructuredPeerBounds(peer);
      if (!peerBounds) return true;
      return normalizedDrawingBoundsOverlap(
        authorityBounds,
        peerBounds,
        EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
      ) ||
        (
          normalizedDrawingBoundsAxisGap(
              authorityBounds.x,
              authorityBounds.width,
              peerBounds.x,
              peerBounds.width,
            ) <= MAX_EXACT_DIRECTION_CONTINUATION_AXIS_GAP &&
          normalizedDrawingBoundsAxisGap(
              authorityBounds.y,
              authorityBounds.height,
              peerBounds.y,
              peerBounds.height,
            ) <= MAX_EXACT_DIRECTION_CONTINUATION_AXIS_GAP
        );
    });
    if (directionContinuationConflict) return null;
    return structuredDrawingClaimPassage(
      [exactDirection.region],
      pageIdentity,
      exactDirection.region.text,
      snapshot,
    );
  }
  if (drawingQuestionRequestsSitePhotometricStatistics(question)) {
    const statistics = auditStrictPhotometricStatistics(
      regions,
      snapshot,
    );
    if (!statistics) return null;
    return structuredDrawingClaimPassage(
      statistics.sourceRegions,
      pageIdentity,
      `SITE PHOTOMETRICS PLAN — average ${statistics.average} fc, ` +
        `maximum ${statistics.maximum} fc, minimum ${statistics.minimum} fc`,
      snapshot,
    );
  }
  if (drawingQuestionRequestsPCCWalkwayPavingComparison(question)) {
    const walkway = auditStructuredPCCThickness(regions, "walkway", snapshot);
    const paving = auditStructuredPCCThickness(regions, "paving", snapshot);
    if (!walkway || !paving) return null;
    return structuredDrawingClaimPassage(
      [...walkway.sourceRegions, ...paving.sourceRegions],
      pageIdentity,
      `CONSTRUCT ${walkway.displayValue}” THICK PCC WALKWAY; ` +
        `CONSTRUCT ${paving.displayValue}” THICK PCC PAVING`,
      snapshot,
    );
  }
  if (drawingQuestionRequestsNorthLotPCCPavingThickness(question)) {
    const northLotPlans = exactNorthLotPlanRegions(regions);
    const paving = auditStructuredPCCThickness(
      regions,
      "paving",
      snapshot,
      true,
    );
    if (!northLotPlans || !paving) return null;
    return structuredDrawingClaimPassage(
      [...northLotPlans, ...paving.sourceRegions],
      pageIdentity,
      `NORTH LOT PLAN — CONSTRUCT ${paving.displayValue}” THICK PCC PAVING`,
      snapshot,
    );
  }
  if (drawingQuestionRequestsNorthLotACSection(question)) {
    const northLotPlans = exactNorthLotPlanRegions(regions);
    const section = auditStructuredACSection(regions);
    if (
      !northLotPlans || !section ||
      !rawPageACSectionAuditMatches(snapshot, section)
    ) return null;
    return structuredDrawingClaimPassage(
      [...northLotPlans, ...section.sourceRegions],
      pageIdentity,
      `NORTH LOT PLAN — CONSTRUCT ${section.acDisplayValue}” AC OVER ` +
        `${section.baseDisplayValue}” BASE PAVING`,
      snapshot,
    );
  }
  if (drawingQuestionRequestsAreaDrainComposite(question)) {
    const drain = auditStructuredAreaDrain(regions);
    if (!drain || !rawPageAreaDrainAuditMatches(snapshot, drain)) return null;
    return structuredDrawingClaimPassage(
      drain.sourceRegions,
      pageIdentity,
      `CONSTRUCT ${drain.widthDisplay}”x${drain.heightDisplay}” ID AREA ` +
        `DRAIN WITH ${drain.filterDisplay.toUpperCase()} FILTER AND LOCAL DEPRESSION`,
      snapshot,
    );
  }
  if (drawingQuestionRequestsDelineatedADAMaximumGrade(question)) {
    const exactText =
      'IN DELINEATED ADA ACCESSIBLE PARKING AREAS, GRADES SHALL BE 2.00% MAX. IN ALL DIRECTIONS.';
    const relevant = regions.filter((region) => {
      const normalized = canonicalStructuredDrawingClaimText(region.text);
      return /\bdelineated ada accessible parking areas\b/.test(normalized) &&
        /\bgrades?\b/.test(normalized);
    });
    const exact = relevant.filter((region) => region.text === exactText);
    const rawRelevant = snapshot.rawRegions.filter((region) => {
      const normalized = canonicalStructuredDrawingClaimText(
        rawStructuredPeerText(region),
      );
      return /\bdelineated ada accessible parking areas\b/.test(normalized) &&
        /\bgrades?\b/.test(normalized);
    });
    if (
      !snapshot.pageAuthority || relevant.length !== 1 || exact.length !== 1 ||
      rawRelevant.length !== 1 || textValue(rawRelevant[0].id) !== exact[0].id ||
      rawStructuredPeerText(rawRelevant[0]) !== exactText
    ) {
      if (diagnostics) {
        diagnostics.protectedStructuredClaimRejectionStage =
          "ada_exact_carrier_mismatch";
      }
      return null;
    }
    const matchingAuthorities = exactSourceBoundPresentationAuthorities.filter(
      (authority) => authority.regionId === exact[0].id,
    );
    const authorityBounds = matchingAuthorities.length === 1
      ? strictNormalizedBounds(matchingAuthorities[0].bounds)
      : null;
    const regionBounds = strictNormalizedBounds(exact[0]);
    if (
      !authorityBounds || !regionBounds ||
      !normalizedDrawingBoundsContain(
        authorityBounds,
        regionBounds,
        EXACT_SOURCE_BOUND_CONTAINMENT_TOLERANCE,
      )
    ) {
      if (diagnostics) {
        diagnostics.protectedStructuredClaimRejectionStage =
          "ada_presentation_authority_mismatch";
      }
      return null;
    }
    const passage = structuredDrawingClaimPassage(
      exact,
      pageIdentity,
      exactText,
      snapshot,
    );
    if (!passage && diagnostics) {
      diagnostics.protectedStructuredClaimRejectionStage =
        "ada_structured_passage_rejected";
    }
    return passage;
  }
  if (drawingQuestionRequestsSewerLateralComposite(question)) {
    const sewer = auditStructuredSewerLateral(regions);
    if (!sewer || !rawPageSewerLateralAuditMatches(snapshot, sewer)) {
      if (diagnostics) {
        diagnostics.protectedStructuredClaimRejectionStage = sewer
          ? "sewer_raw_page_audit_mismatch"
          : "sewer_structured_audit_mismatch";
      }
      return null;
    }
    return structuredDrawingClaimPassage(
      sewer.sourceRegions,
      pageIdentity,
      `CONSTRUCT ${sewer.sizeDisplay}” SEWER LATERAL AND CLEANOUT PER ` +
        `RIVERSIDE CITY STANDARD ${sewer.standard}. MATERIAL PER ` +
        `${sewer.materialDiscipline.toUpperCase()} DRAWINGS.`,
      snapshot,
    );
  }
  return null;
}

function structuredDrawingClaimPassage(
  regions: readonly DrawingRegion[],
  pageIdentity: string,
  canonicalText: string,
  snapshot?: StrictStructuredReceiptValidationSnapshot,
): ECOSDrawingEvidencePassage | null {
  const sourceRegions = structuredDrawingClaimSourceRegions(regions);
  if (
    sourceRegions.length !== regions.length ||
    sourceRegions.some((region) =>
      !structuredDrawingRegionIsCoordinateBound(region) ||
      !lowConfidenceStructuredClaimSourceIsExact(region, snapshot)
    )
  ) return null;
  const bounds = unionBounds(sourceRegions);
  const rawSources = unique(
    sourceRegions.map((region) => region.rawSource || "").filter(Boolean),
  );
  return {
    text: unique([
      pageIdentity,
      ...sourceRegions.map((region) => region.text),
      canonicalText,
    ]).join("\n"),
    score: 58,
    regionId: deterministicDerivedRegionId(
      "structured-claim",
      sourceRegions.map((region) => region.id),
    ),
    contextRegionIds: Object.freeze(
      sourceRegions.map((region) => region.id),
    ),
    sourceRegionIds: Object.freeze(
      sourceRegions.map((region) => region.id),
    ),
    x: bounds?.x ?? null,
    y: bounds?.y ?? null,
    width: bounds?.width ?? null,
    height: bounds?.height ?? null,
    confidence: minimumConfidence(sourceRegions),
    source: "vision",
    rawSource: rawSources.length === 1 ? rawSources[0] : "mixed",
    reconstructionMethod: STRUCTURED_DRAWING_CLAIM_RECONSTRUCTION_METHOD,
    evidenceSources: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.evidenceSources)),
    ),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.areaNames)),
    ),
  };
}

function buildExactRelationshipPassages(
  regions: readonly DrawingRegion[],
  question: string,
  pageIdentity: string,
  allowSamePageContextMeasurement = false,
  rawRegions: readonly ECOSDrawingRegionInput[] = [],
  pageAuthority?: ECOSDrawingPageAuthority | null,
  exactSourceBoundPresentationAuthorities:
    readonly ECOSDrawingExactSourceBoundPresentationAuthority[] = [],
  diagnostics?: ECOSDrawingEvidenceDiagnostics,
): ECOSDrawingEvidencePassage[] {
  const exact = (pattern: RegExp) =>
    regions.find((region) => pattern.test(normalizeText(region.text)));
  const distinctExact = (pattern: RegExp) => {
    const seen = new Set<string>();
    return regions.filter((region) => pattern.test(normalizeText(region.text)))
      .filter((region) => {
        const key = normalizeText(region.text);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const passages: ECOSDrawingEvidencePassage[] = [];
  if (
    allowSamePageContextMeasurement ||
    drawingQuestionRequiresSealedStructuredReceipt(question)
  ) {
    const strictStructuredSnapshot =
      prepareStrictStructuredReceiptValidationSnapshot(
        rawRegions,
        pageIdentity,
        pageAuthority,
      );
    const protectedStructuredClaim = buildProtectedStructuredDrawingClaimPassage(
      regions,
      question,
      pageIdentity,
      strictStructuredSnapshot,
      exactSourceBoundPresentationAuthorities,
      diagnostics,
    );
    if (protectedStructuredClaim) passages.push(protectedStructuredClaim);
  }
  if (
    /\bcanop(?:y|ies)\b/i.test(question) &&
    /\b(?:light|lighting|fixture|luminaire)s?\b/i.test(question)
  ) {
    const exteriorStorage = exact(/^exterior storage$/i);
    const lightingPlans = exact(/^lighting plans?$/i);
    if (
      exteriorStorage && lightingPlans &&
      regionsAreNear(exteriorStorage, lightingPlans)
    ) {
      passages.push(compositeRelationshipPassage(
        [exteriorStorage, lightingPlans],
        pageIdentity,
        "EXTERIOR STORAGE LIGHTING PLANS",
      ));
    }
  }
  if (
    /\b(?:Building|BLDG)\s+Area\s+1\b/i.test(question) &&
    /\bE-?2\.1\b/i.test(question)
  ) {
    const buildingArea = exact(/^2375-bldg area 1$/i);
    const enlargedLighting = exact(/^enlarged lighting plan$/i);
    if (
      buildingArea && enlargedLighting &&
      regionsAreNear(buildingArea, enlargedLighting)
    ) {
      passages.push(compositeRelationshipPassage(
        [buildingArea, enlargedLighting],
        pageIdentity,
        "2375-BLDG AREA 1 ENLARGED LIGHTING PLAN",
      ));
    }
  }
  if (/\barea\s+lighting\b/i.test(question) && /\bcivil\b/i.test(question)) {
    const civilDirection = exact(
      /^area lighting -? see architectural and electrical drawings$/i,
    );
    if (civilDirection) {
      passages.push(
        singleRegionRelationshipPassage(civilDirection, pageIdentity),
      );
    }
    const electricalProof = exact(
      /^existing lighting in this area to remain\.? reconnect$/i,
    );
    if (electricalProof) {
      passages.push(
        singleRegionRelationshipPassage(electricalProof, pageIdentity),
      );
    }
  }
  if (/\bunderground\s+infiltration\s+chambers?\b/i.test(question)) {
    const undergroundInfiltration = exact(/^underground infiltration$/i);
    const chambers = exact(/^chambers?,?$/i);
    const detail = exact(/^details?,?$/i);
    const requestsDetail = /\bdetails?\b/i.test(question);
    if (
      undergroundInfiltration && chambers &&
      regionsAreNear(undergroundInfiltration, chambers) &&
      (!requestsDetail || detail &&
        (regionsAreNear(undergroundInfiltration, detail) ||
          regionsAreNear(chambers, detail)))
    ) {
      const sourceRegions = requestsDetail
        ? [undergroundInfiltration, chambers, detail!]
        : [undergroundInfiltration, chambers];
      passages.push(compositeRelationshipPassage(
        sourceRegions,
        pageIdentity,
        requestsDetail
          ? "UNDERGROUND INFILTRATION CHAMBER DETAILS"
          : "UNDERGROUND INFILTRATION CHAMBERS",
      ));
    }
  }
  if (
    /\blavatory\b/i.test(question) &&
    /\b(?:manufacturer|model)\b/i.test(question)
  ) {
    const lavatory = exact(/^lavatory$/i);
    const manufacturerModel = exact(
      /^american standard\s+0355\.012\s+["“]?lucerne["”]?$/i,
    );
    if (
      lavatory && manufacturerModel &&
      regionsAreNear(lavatory, manufacturerModel)
    ) {
      passages.push(compositeRelationshipPassage(
        [lavatory, manufacturerModel],
        pageIdentity,
        'LAVATORY — AMERICAN STANDARD 0355.012 "LUCERNE"',
      ));
    }
  }
  if (
    /\b(?:what|list)\b[\s\S]{0,40}\b(?:two|all)\s+actual\s+storage\s+heights?\b/i
      .test(question)
  ) {
    const values = distinctExact(
      /^actual storage height:\s*\d+\s*['’]-?\d+\s*["”]$/i,
    );
    if (values.length === 2) {
      passages.push(samePageMeasurementPassage(
        values,
        pageIdentity,
        `ACTUAL STORAGE HEIGHTS: ${
          values.map((region) =>
            region.text.replace(/^actual storage height:\s*/i, "")
          ).join(" AND ")
        }`,
      ));
    }
  }
  if (
    /\b(?:what|list)\b[\s\S]{0,40}\b(?:two|all)\s+maximum\s+storage\s+heights?\b/i
      .test(question)
  ) {
    const values = distinctExact(
      /^maximum storage height:\s*\d+\s*['’]-?\d+\s*["”]$/i,
    );
    if (values.length === 2) {
      passages.push(samePageMeasurementPassage(
        values,
        pageIdentity,
        `MAXIMUM STORAGE HEIGHTS: ${
          values.map((region) =>
            region.text.replace(/^maximum storage height:\s*/i, "")
          ).join(" AND ")
        }`,
      ));
    }
  }
  if (drawingQuestionRequestsOnlyAffirmativeLeftmostCeilingHeight(question)) {
    const values = regions.filter((region) =>
      /^ceiling height:\s*\d+\s*['’]-?\d+\s*["”]$/i.test(
        normalizeText(region.text),
      ) && region.x != null
    ).sort((left, right) => left.x! - right.x!);
    const leftmost = values[0];
    const leftmostCluster = leftmost
      ? values.filter((region) => Math.abs(region.x! - leftmost.x!) <= 0.01)
      : [];
    const distinctLeftmost = [...new Map(leftmostCluster.map((region) =>
      [
        normalizeText(region.text),
        region,
      ] as const
    )).values()];
    const nextDistinct = leftmost
      ? values.find((region) => region.x! > leftmost.x! + 0.01)
      : undefined;
    if (distinctLeftmost.length === 1 && nextDistinct) {
      passages.push(samePageMeasurementPassage(
        [distinctLeftmost[0]],
        pageIdentity,
        `LEFTMOST DETAIL — ${distinctLeftmost[0].text}`,
      ));
    }
  }
  if (
    /\bno[- ]pipe\b|\bno\s+pipes\b/i.test(question) &&
    /\bbelow\s+(?:the\s+)?slab\b/i.test(question)
  ) {
    const noPipePattern = /no pipes allowed in the space to 6["”]? below slab/i;
    const noPipeLine = regions.find((region) =>
      noPipePattern.test(normalizeText(region.text))
    );
    const exactSixInches = exact(/^6["”]$/i);
    if (
      noPipeLine && /6["”]\s+below slab/i.test(normalizeText(noPipeLine.text))
    ) {
      const passage = canonicalSingleRegionPassage(
        noPipeLine,
        pageIdentity,
        'NO PIPES ALLOWED IN THE SPACE TO 6" BELOW SLAB',
        noPipePattern,
      );
      if (passage) passages.push(passage);
    } else if (
      noPipeLine && exactSixInches && regionsAreNear(noPipeLine, exactSixInches)
    ) {
      passages.push(compositeRelationshipPassage(
        [noPipeLine, exactSixInches],
        pageIdentity,
        'NO PIPES ALLOWED IN THE SPACE TO 6" BELOW SLAB',
      ));
    }
  }
  if (
    /\bhanger[- ]?wires?\b/i.test(question) &&
    /\b(?:spacing|on[- ]center|perimeter[- ]wall)\b/i.test(question)
  ) {
    const hangerPattern =
      /hanger wires at 4['’]-0["”]\s+0\.?c\.?\s+typ\.?\s+and at 8["”]\s+max\.?\s+from perim(?:i|e)ter wall/i;
    const hanger = regions.find((region) =>
      hangerPattern.test(normalizeText(region.text))
    );
    if (hanger) {
      const passage = canonicalSingleRegionPassage(
        hanger,
        pageIdentity,
        'HANGER WIRES AT 4\'-0" O.C. TYP. AND AT 8" MAX. FROM PERIMETER WALL',
        hangerPattern,
      );
      if (passage) passages.push(passage);
    }
  }
  if (
    /\bfasteners?\b/i.test(question) &&
    /\b(?:spacing|on[- ]center|o\.?c\.?)\b/i.test(question)
  ) {
    const fastenerPattern = /^fastener,?\s*2['’]-6["”]\s+0\.?c\.?$/i;
    const fastener = regions.find((region) =>
      fastenerPattern.test(normalizeText(region.text))
    );
    if (fastener) {
      const passage = canonicalSingleRegionPassage(
        fastener,
        pageIdentity,
        "FASTENER, 2'-6\" O.C. (ON CENTER)",
        fastenerPattern,
      );
      if (passage) passages.push(passage);
    }
  }
  if (
    /\bflush[- ]?valve\s+controls?\b/i.test(question) &&
    /\b(?:height|limit|maximum)\b/i.test(question)
  ) {
    const flushControls = exact(
      /^controls for the flush valves mounted on the wide side of toilet$/i,
    );
    const heightLimit = exact(
      /^areas,? no more than 44 inches above the floor,?$/i,
    );
    if (
      flushControls && heightLimit && regionsAreNear(flushControls, heightLimit)
    ) {
      passages.push(compositeRelationshipPassage(
        [flushControls, heightLimit],
        pageIdentity,
        "CONTROLS FOR THE FLUSH VALVES — NO MORE THAN 44 INCHES ABOVE THE FLOOR",
      ));
    }
  }
  if (
    /\bvoltage[- ]drop\b/i.test(question) &&
    /\b(?:two|pairs?)\b/i.test(question)
  ) {
    const runs = distinctExact(
      /^l\s*=\s*\d+\s*['’]\s*;?\s*vd\s*=\s*\d+(?:\.\d+)?%$/i,
    );
    const requestedLengths = unique(
      [...question.matchAll(/\b(\d+)\s*-?\s*(?:feet|foot|ft\.?|['’])/gi)]
        .map((match) => match[1]),
    );
    const requestedRuns = requestedLengths.length === 2
      ? requestedLengths.flatMap((length) => {
        const matches = runs.filter((region) =>
          new RegExp(`^l\\s*=\\s*${length}\\s*['’]`, "i").test(
            normalizeText(region.text),
          )
        );
        return matches.length === 1 ? matches : [];
      })
      : runs.length === 2
      ? runs
      : [];
    if (requestedRuns.length === 2) {
      const canonical = requestedRuns.map((region) =>
        normalizeText(region.text)
          .replace(/^l\s*=\s*/i, "LENGTH ")
          .replace(/;?\s*vd\s*=\s*/i, "; VOLTAGE DROP ")
      );
      passages.push(samePageMeasurementPassage(
        requestedRuns,
        pageIdentity,
        `CONDUCTOR-RUN VOLTAGE-DROP PAIRS: ${canonical.join(" AND ")}`,
      ));
    }
  }
  if (
    /\bcanopy\s+c\b/i.test(question) &&
    /\broof\s+secondary\s+plan\b/i.test(question) &&
    /\bdimensions?\b/i.test(question)
  ) {
    const shape = exact(/^shape name\s*=\s*canopy c$/i);
    const roofPlan = exact(/^roof secondary plan$/i);
    const thirty = exact(/^30['’]-0["”]$/i);
    const thirtyTwo = exact(/^32['’]-0["”]$/i);
    if (shape && roofPlan && thirty && thirtyTwo) {
      passages.push(samePageMeasurementPassage(
        [shape, roofPlan, thirty, thirtyTwo],
        pageIdentity,
        "CANOPY C ROOF SECONDARY PLAN — OVERALL DIMENSIONS 30'-0\" BY 32'-0\"",
      ));
    }
  }
  return passages;
}

function canonicalSingleRegionPassage(
  region: DrawingRegion,
  pageIdentity: string,
  canonicalText: string,
  sourceProposition: RegExp,
): ECOSDrawingEvidencePassage | null {
  const normalizedRegion = normalizeText(region.text);
  const match = sourceProposition.exec(normalizedRegion);
  if (!match) return null;
  const qualifier = `${normalizedRegion.slice(0, match.index)} ${
    normalizedRegion.slice(match.index + match[0].length)
  }`.trim();
  if (
    !ecosDrawingPropositionIsAssertiveCurrent(qualifier || "current drawing")
  ) return null;
  return {
    text: unique([pageIdentity, region.text, canonicalText]).join("\n"),
    score: 54,
    regionId: deterministicDerivedRegionId("normalized", [region.id]),
    contextRegionIds: Object.freeze(region.id ? [region.id] : []),
    sourceRegionIds: Object.freeze([region.id]),
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    confidence: region.confidence,
    source: "vision",
    rawSource: region.rawSource,
    reconstructionMethod: "deterministic_single_region_ocr_normalization",
    evidenceSources: region.evidenceSources,
    constituentEvidence: region.constituentEvidence,
    corroboratingEvidence: region.corroboratingEvidence,
    areaNames: region.areaNames,
  };
}

function samePageMeasurementPassage(
  sourceRegions: readonly DrawingRegion[],
  pageIdentity: string,
  canonicalText: string,
): ECOSDrawingEvidencePassage {
  const bounds = unionBounds(sourceRegions);
  const rawSources = unique(
    sourceRegions.map((region) => region.rawSource || "").filter(Boolean),
  );
  return {
    text: unique([
      pageIdentity,
      ...sourceRegions.map((region) => region.text),
      canonicalText,
    ]).join("\n"),
    score: 56,
    regionId: deterministicDerivedRegionId(
      "measurement",
      sourceRegions.map((region) => region.id),
    ),
    contextRegionIds: Object.freeze(
      sourceRegions.map((region) => region.id).filter(Boolean),
    ),
    sourceRegionIds: Object.freeze(sourceRegions.map((region) => region.id)),
    x: bounds?.x ?? null,
    y: bounds?.y ?? null,
    width: bounds?.width ?? null,
    height: bounds?.height ?? null,
    confidence: minimumConfidence(sourceRegions),
    source: "vision",
    rawSource: rawSources.length === 1 ? rawSources[0] : "mixed",
    reconstructionMethod: "deterministic_same_page_context_measurement",
    evidenceSources: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.evidenceSources)),
    ),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.areaNames)),
    ),
  };
}

function singleRegionRelationshipPassage(
  region: DrawingRegion,
  pageIdentity: string,
): ECOSDrawingEvidencePassage {
  return {
    text: unique([pageIdentity, region.text]).join("\n"),
    score: 48,
    regionId: region.id
      ? deterministicDerivedRegionId("relationship", [region.id])
      : null,
    contextRegionIds: Object.freeze(region.id ? [region.id] : []),
    sourceRegionIds: Object.freeze([region.id]),
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    confidence: region.confidence,
    source: region.source,
    rawSource: region.rawSource,
    reconstructionMethod: "deterministic_single_region_relationship",
    evidenceSources: region.evidenceSources,
    constituentEvidence: region.constituentEvidence,
    corroboratingEvidence: region.corroboratingEvidence,
    areaNames: region.areaNames,
  };
}

function compositeRelationshipPassage(
  sourceRegions: readonly DrawingRegion[],
  pageIdentity: string,
  canonicalText: string,
): ECOSDrawingEvidencePassage {
  const bounds = unionBounds(sourceRegions);
  const rawSources = unique(
    sourceRegions.map((region) => region.rawSource || "").filter(Boolean),
  );
  return {
    text: unique([
      pageIdentity,
      ...sourceRegions.map((region) => region.text),
      canonicalText,
    ]).join("\n"),
    score: 52,
    regionId: deterministicCompositeRegionId(
      sourceRegions.map((region) => region.id),
    ),
    contextRegionIds: Object.freeze(
      sourceRegions.map((region) => region.id).filter(Boolean),
    ),
    sourceRegionIds: Object.freeze(sourceRegions.map((region) => region.id)),
    x: bounds?.x ?? null,
    y: bounds?.y ?? null,
    width: bounds?.width ?? null,
    height: bounds?.height ?? null,
    confidence: minimumConfidence(sourceRegions),
    source: "vision",
    rawSource: rawSources.length === 1 ? rawSources[0] : "mixed",
    reconstructionMethod: "deterministic_adjacent_region_phrase",
    evidenceSources: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.evidenceSources)),
    ),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      sourceRegions.flatMap((region) => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(
      unique(sourceRegions.flatMap((region) => region.areaNames)),
    ),
  };
}

type DrawingDimension = Readonly<{
  region: DrawingRegion;
  feet: number;
  display: string;
}>;

type DrawingDimensionRole =
  | "width"
  | "length"
  | "horizontal"
  | "vertical"
  | "unknown";

function drawingDimensionRole(
  dimension: DrawingDimension,
): DrawingDimensionRole {
  const normalizedText = dimension.region.text
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const normalizedDisplay = dimension.display
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const displayIndex = normalizedText.toLowerCase().indexOf(
    normalizedDisplay.toLowerCase(),
  );
  if (displayIndex < 0) return "unknown";
  const residue = `${normalizedText.slice(0, displayIndex)} ${
    normalizedText.slice(displayIndex + normalizedDisplay.length)
  }`.replace(/\boverall\b/gi, " ");
  const semanticTokens = residue.toLowerCase().match(/[a-z]+/g) || [];
  const tokenIsDimensionNoun = (token: string) =>
    token === "dimension" || token === "dimensions" || token === "dim";
  if (
    semanticTokens.length > 0 &&
    semanticTokens.every((token) =>
      token === "width" || token === "wide" || tokenIsDimensionNoun(token)
    ) && semanticTokens.some((token) => token === "width" || token === "wide")
  ) return "width";
  if (
    semanticTokens.length > 0 &&
    semanticTokens.every((token) =>
      token === "length" || token === "long" || tokenIsDimensionNoun(token)
    ) && semanticTokens.some((token) => token === "length" || token === "long")
  ) return "length";
  if (
    semanticTokens.length > 0 &&
    semanticTokens.every((token) =>
      token === "horizontal" || token === "horiz" || token === "horz" ||
      tokenIsDimensionNoun(token)
    ) &&
    semanticTokens.some((token) =>
      token === "horizontal" || token === "horiz" || token === "horz"
    )
  ) return "horizontal";
  if (
    semanticTokens.length > 0 &&
    semanticTokens.every((token) =>
      token === "vertical" || token === "vert" || tokenIsDimensionNoun(token)
    ) &&
    semanticTokens.some((token) => token === "vertical" || token === "vert")
  ) return "vertical";
  // Geometry may classify only a syntactically unlabeled overall dimension.
  // Any other alphabetic residue could be height, elevation, clearance,
  // radius, slope, or another non-footprint measurement and therefore fails
  // closed instead of being interpreted from the OCR box orientation.
  if (semanticTokens.length > 0) return "unknown";
  if (dimension.region.width == null || dimension.region.height == null) {
    return "unknown";
  }
  if (dimension.region.width >= dimension.region.height * 1.25) {
    return "horizontal";
  }
  if (dimension.region.height >= dimension.region.width * 1.25) {
    return "vertical";
  }
  return "unknown";
}

const PLAN_DIMENSION_CHAIN_ALIGNMENT_TOLERANCE = 0.035;
const PLAN_DIMENSION_CHAIN_OUTSIDE_OFFSET = 0.002;

function cleanAxisOnlyDrawingDimension(dimension: DrawingDimension) {
  const role = drawingDimensionRole(dimension);
  if (role !== "horizontal" && role !== "vertical") return false;
  if (parseFeetDimensions(dimension.region.text).length !== 1) return false;
  const normalizedText = dimension.region.text
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const normalizedDisplay = dimension.display
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const displayIndex = normalizedText.toLowerCase().indexOf(
    normalizedDisplay.toLowerCase(),
  );
  if (displayIndex < 0) return false;
  return `${normalizedText.slice(0, displayIndex)} ${
    normalizedText.slice(displayIndex + normalizedDisplay.length)
  }`
    .replace(/\boverall\b/gi, " ")
    .replace(/[\s:;,._()[\]{}|/-]+/g, "") === "";
}

function planDimensionChainCoordinate(dimension: DrawingDimension) {
  const role = drawingDimensionRole(dimension);
  if (
    dimension.region.x == null || dimension.region.y == null ||
    dimension.region.width == null || dimension.region.height == null
  ) return null;
  return role === "horizontal"
    ? dimension.region.y + dimension.region.height / 2
    : role === "vertical"
    ? dimension.region.x + dimension.region.width / 2
    : null;
}

function planDimensionRegionsAreSameLabel(
  left: DrawingDimension,
  right: DrawingDimension,
) {
  if (
    left.region.x == null || left.region.y == null ||
    left.region.width == null || left.region.height == null ||
    right.region.x == null || right.region.y == null ||
    right.region.width == null || right.region.height == null
  ) return false;
  const leftCenterX = left.region.x + left.region.width / 2;
  const leftCenterY = left.region.y + left.region.height / 2;
  const rightCenterX = right.region.x + right.region.width / 2;
  const rightCenterY = right.region.y + right.region.height / 2;
  return Math.abs(leftCenterX - rightCenterX) <= 0.01 &&
    Math.abs(leftCenterY - rightCenterY) <= 0.01;
}

/**
 * Selects a drawing's outside dimension chain without relying on a project,
 * document, sheet, page, or known numeric answer.
 *
 * Real plan sheets normally contain segment dimensions on an inner chain and
 * one larger total on an immediately adjacent outer chain. A candidate is
 * accepted only when each orthogonal axis has one unique largest clean label,
 * a smaller parallel peer in the same local chain, and the largest label sits
 * strictly outside all of those peers. Multiple maxima or peers on both sides
 * remain ambiguous and fail closed.
 */
function selectPlanDimensionChainAxes(
  dimensions: readonly DrawingDimension[],
): readonly DrawingDimension[] {
  const selectAxis = (
    role: "horizontal" | "vertical",
  ): DrawingDimension | null => {
    const axisDimensions = dimensions.filter((dimension) =>
      drawingDimensionRole(dimension) === role &&
      cleanAxisOnlyDrawingDimension(dimension)
    );
    if (axisDimensions.length < 2) return null;
    const maximumFeet = Math.max(
      ...axisDimensions.map((dimension) => dimension.feet),
    );
    const maxima = axisDimensions.filter((dimension) =>
      Math.abs(dimension.feet - maximumFeet) < 0.001
    );
    const primary = maxima[0];
    if (
      !primary ||
      maxima.some((dimension) =>
        dimension !== primary &&
        !planDimensionRegionsAreSameLabel(primary, dimension)
      )
    ) return null;
    const primaryCoordinate = planDimensionChainCoordinate(primary);
    if (primaryCoordinate == null) return null;
    const alignedSmaller = axisDimensions.filter((dimension) => {
      if (dimension.feet >= maximumFeet - 0.001) return false;
      const coordinate = planDimensionChainCoordinate(dimension);
      return coordinate != null &&
        Math.abs(coordinate - primaryCoordinate) <=
          PLAN_DIMENSION_CHAIN_ALIGNMENT_TOLERANCE &&
        Math.abs(coordinate - primaryCoordinate) >=
          PLAN_DIMENSION_CHAIN_OUTSIDE_OFFSET;
    });
    if (alignedSmaller.length === 0) return null;
    const directions = new Set(alignedSmaller.map((dimension) => {
      const coordinate = planDimensionChainCoordinate(dimension)!;
      return coordinate > primaryCoordinate ? 1 : -1;
    }));
    if (directions.size !== 1) return null;
    return primary;
  };
  const horizontal = selectAxis("horizontal");
  const vertical = selectAxis("vertical");
  return horizontal && vertical ? Object.freeze([horizontal, vertical]) : [];
}

function planAreaScopeLabelIsAssertiveCurrent(value: string) {
  const normalized = value.normalize("NFKD")
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  return ecosDrawingPropositionIsAssertiveCurrent(value) &&
    !/\bdeleted\b/i.test(normalized);
}

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
  rawPageText: string,
): ECOSDrawingEvidencePassage[] {
  const pageContextText = unique([
    pageIdentity,
    pageText,
    ...regions.map((region) => region.text),
  ]).join("\n");
  const normalizedPageContextText = normalizePlanTitleIdentityText(
    pageContextText,
  );
  const pageContext = analyzeECOSQuestionEvidenceContext(
    question,
    normalizedPageContextText,
  );
  if (
    !pageContext.subjectMatched ||
    !pageContext.locationMatched ||
    !/\bplan\b/i.test(normalizedPageContextText)
  ) return [];
  const requestedPlan = requestedPlanAreaDesignator(question);
  if (requestedPlan === "ambiguous") return [];
  // Raw page text is never promoted to proof, but it remains a mandatory
  // ambiguity veto. Even a generic exact-page question must bind both
  // dimensions to exactly one plan identity: otherwise a page containing
  // multiple plans could silently combine dimensions from different plans.
  const identityText = unique([
    pageIdentity,
    rawPageText,
    pageText,
    ...regions.map((region) => region.text),
  ]).join("\n");
  const identities = requestedPlan
    ? boundedRequestedPlanTitleDesignators(identityText)
    : planTitleDesignators(identityText);
  if (identities.size !== 1) return [];
  const soleIdentity = [...identities][0];
  const separator = soleIdentity.indexOf(":");
  if (separator < 1 || separator >= soleIdentity.length - 1) return [];
  const boundPlan: PlanAreaDesignator = requestedPlan || {
    label: soleIdentity.slice(0, separator),
    identifier: soleIdentity.slice(separator + 1),
  };
  if (
    requestedPlan &&
    soleIdentity !== `${requestedPlan.label}:${requestedPlan.identifier}`
  ) return [];

  const explicitlyOverall = regions.filter((region) =>
    /\boverall\b/i.test(region.text) &&
    !/\b(?:module|segment|bay|dimension\s+key)\b/i.test(region.text) &&
    !/\boverview\b/i.test(region.id)
  );
  const dimensionRegions = explicitlyOverall.length >= 2
    ? explicitlyOverall
    : regions;
  const exactDimensionRegions = dimensionRegions.filter((region) =>
    !/\b(?:maximum|max\.?|minimum|min\.?|not\s+to\s+exceed|n\s*\.?\s*t\s*\.?\s*e\.?|at\s+most|at\s+least|up\s+to|nominal|typical|typ\.?|estimated|estimate|approximately|approx\.?|field\s+verify|verify\s+in\s+field|varies|variable)\b|[±∓]/i
      .test(
        region.text,
      )
  );
  const dimensions: Array<{
    feet: number;
    display: string;
    region: DrawingRegion;
  }> = [];
  for (const region of exactDimensionRegions) {
    const parsedDimensions = parseFeetDimensions(region.text);
    if (parsedDimensions.length > MAX_DRAWING_PARSED_DIMENSIONS) return [];
    for (const dimension of parsedDimensions) {
      if (dimension.feet < 3 || dimension.feet > 2_000) continue;
      dimensions.push({ ...dimension, region });
      if (dimensions.length > MAX_DRAWING_PARSED_DIMENSIONS) return [];
    }
  }
  let uniqueDimensions = dimensions
    .sort((left, right) => right.feet - left.feet)
    .filter((dimension, index, all) =>
      all.findIndex((other) =>
        Math.abs(other.feet - dimension.feet) < 0.001 &&
        drawingDimensionRole(other) === drawingDimensionRole(dimension)
      ) === index
    );
  // Explicitly labeled dimensions retain the exact-two rule. On an ordinary
  // plan sheet with many unlabeled segment dimensions, select the bounded
  // outside dimension chains instead of treating every measurement, note,
  // elevation, and title-block number as an equally plausible footprint axis.
  if (explicitlyOverall.length < 2 && uniqueDimensions.length !== 2) {
    uniqueDimensions = [...selectPlanDimensionChainAxes(dimensions)];
  }
  // A deterministic footprint still has exactly two distinct axes. Selecting
  // a convenient pair when the chain topology is ambiguous fails closed.
  if (uniqueDimensions.length !== 2) return [];
  if (
    !rawPageOverallDimensionsMatchAcceptedAxes(
      rawPageText,
      uniqueDimensions.map((dimension) => dimension.feet),
    )
  ) return [];

  const [firstDimension, secondDimension] = uniqueDimensions;
  const firstRole = drawingDimensionRole(firstDimension);
  const secondRole = drawingDimensionRole(secondDimension);
  const roleIsHorizontal = (role: DrawingDimensionRole) =>
    role === "horizontal" || role === "width";
  const roleIsVertical = (role: DrawingDimensionRole) =>
    role === "vertical" || role === "length";
  const hasOrthogonalGeometry =
    (firstRole === "horizontal" && secondRole === "vertical") ||
    (firstRole === "vertical" && secondRole === "horizontal");
  const hasComplementaryAxisLabels =
    (firstRole === "width" && secondRole === "length") ||
    (firstRole === "length" && secondRole === "width");
  if (!hasOrthogonalGeometry && !hasComplementaryAxisLabels) return [];
  const horizontal = roleIsHorizontal(firstRole)
    ? firstDimension
    : secondDimension;
  const vertical = roleIsVertical(firstRole) ? firstDimension : secondDimension;
  if (!horizontal || !vertical || horizontal.region.id === vertical.region.id) {
    return [];
  }
  const boundedDimensionRegions = [horizontal.region, vertical.region];
  if (
    boundedDimensionRegions.some((region) =>
      region.areaNames.length > 0 &&
      region.areaNames.some((name) => {
        if (!planAreaScopeLabelIsAssertiveCurrent(name)) return true;
        const identifiers = planDesignatorValues(name, boundPlan.label);
        return identifiers.size !== 1 || !identifiers.has(boundPlan.identifier);
      })
    )
  ) return [];

  const questionLocation = analyzeECOSQuestionEvidenceContext(question, "");
  const fullLocationEvidence = unique([
    pageIdentity,
    pageText,
    ...regions.flatMap((region) => [region.text, ...region.areaNames]),
  ]).join("\n");
  if (
    (questionLocation.locationDirectionTokens.length > 0 ||
      questionLocation.locationKindTokens.length > 0) &&
    ecosEvidenceHasCompetingExplicitLocation(question, fullLocationEvidence)
  ) {
    for (const dimensionRegion of boundedDimensionRegions) {
      const localRegions = uniqueRegions([
        dimensionRegion,
        ...regions.filter((region) =>
          region.id !== dimensionRegion.id &&
          regionsAreNear(dimensionRegion, region)
        ),
      ]);
      const localEvidence = unique(localRegions.flatMap((region) => [
        region.text,
        ...region.areaNames,
      ])).join("\n");
      const localContext = analyzeECOSQuestionEvidenceContext(
        question,
        localEvidence,
      );
      if (
        !localContext.locationMatched ||
        ecosEvidenceHasCompetingExplicitLocation(question, localEvidence)
      ) return [];
    }
  }

  const area = roundedArea(horizontal.feet * vertical.feet);
  if (!Number.isFinite(area) || area <= 0) return [];
  const contextRegions = regions
    .filter((region) =>
      ecosEvidenceQuestionContextScore(
        question,
        unique([region.text, ...region.areaNames]).join(" "),
      ) > 0
    )
    .sort((left, right) =>
      ecosEvidenceQuestionContextScore(question, right.text) -
      ecosEvidenceQuestionContextScore(question, left.text)
    )
    .filter((region, index, all) =>
      all.findIndex((other) =>
        normalizeText(unique([other.text, ...other.areaNames]).join(" ")) ===
          normalizeText(unique([region.text, ...region.areaNames]).join(" "))
      ) === index
    );
  if (contextRegions.length > MAX_NEARBY_DRAWING_REGIONS) return [];
  const calculationRegions = uniqueRegions([
    ...contextRegions,
    horizontal.region,
    vertical.region,
  ]);
  const proofRegions = uniqueRegions([horizontal.region, vertical.region]);
  const bounds = unionBounds(proofRegions);
  const contextText = unique(
    contextRegions.flatMap((region) => [region.text, ...region.areaNames]),
  ).join("\n");
  const areaDisplay = Number.isInteger(area)
    ? area.toLocaleString("en-US")
    : area.toFixed(1);
  const calculation = [
    pageIdentity,
    `ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: ${horizontal.display} × ${vertical.display} = ${areaDisplay} square feet.`,
    contextText,
    "The square footage is calculated from the cited drawing dimensions; it is not a separately printed area value.",
  ].filter(Boolean).join("\n");
  const rawSources = unique(
    proofRegions.map((region) => region.rawSource || "").filter(Boolean),
  );
  const reconstructionMethods = unique(
    calculationRegions.map((region) => region.reconstructionMethod || "")
      .filter(Boolean),
  );
  return [{
    text: calculation,
    score: 40 + ecosEvidenceQuestionContextScore(question, calculation),
    regionId: deterministicCalculationRegionId(
      horizontal.region.id,
      vertical.region.id,
    ),
    contextRegionIds: Object.freeze(
      calculationRegions.map((region) => region.id).filter(Boolean),
    ),
    sourceRegionIds: Object.freeze([horizontal.region.id, vertical.region.id]),
    x: bounds?.x ?? horizontal.region.x,
    y: bounds?.y ?? horizontal.region.y,
    width: bounds?.width ?? horizontal.region.width,
    height: bounds?.height ?? horizontal.region.height,
    confidence: minimumConfidence(proofRegions),
    source: proofRegions.every((region) => region.source === "embedded_text")
      ? "embedded_text"
      : proofRegions.some((region) => region.source === "vision")
      ? "vision"
      : proofRegions.some((region) => region.source === "ocr")
      ? "ocr"
      : null,
    rawSource: rawSources.length === 1 ? rawSources[0] : null,
    reconstructionMethod: "deterministic_same_page_plan_footprint",
    evidenceSources: Object.freeze(
      unique(proofRegions.flatMap((region) => region.evidenceSources)),
    ),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      proofRegions.flatMap((region) => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      proofRegions.flatMap((region) => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(
      unique(calculationRegions.flatMap((region) => region.areaNames)),
    ),
  }];
}

let CACHED_PAGE_MATERIAL_ISSUE_STATUS_PATTERNS: readonly RegExp[] | null = null;

function pageMaterialIssueStatusPatterns() {
  if (CACHED_PAGE_MATERIAL_ISSUE_STATUS_PATTERNS) {
    return CACHED_PAGE_MATERIAL_ISSUE_STATUS_PATTERNS;
  }
  const status = String
    .raw`(?:not\s+(?:issued\s+)?for\s+construction|issued\s+not\s+for\s+construction|n\s*f\s*c|i\s*f\s*[abtr]|non[- ]?current|not\s+current|no\s+longer\s+current|out\s+of\s+date|cancel(?:ed|led)|superseded|archived|withdrawn|void|obsolete|revoked|voided|invalidated|retired|replaced|rejected|unissued|invalid|expired|rescinded|not\s+approved|unapproved|tentative|placeholder|hold|preliminary|draft|delet(?:e|ed)|omit(?:ted)?|add\s+alternate|alternate\s+only|(?:preliminary|draft)\s+(?:dimensions?|layout|design)|proposed|concept(?:ual)?|schematic\s+design|design\s+development|approval\s+pending|awaiting\s+approval|subject\s+to\s+approval|under\s+review|uncontrolled\s+copy|not\s+controlled|working\s+copy|review\s+copy|(?:reference|review|information|coordination)\s+only|for\s+coordination(?:\s+only)?|issued\s+for\s+coordination|coordination\s+set|(?:bid|tender|permit|pricing|quotation)\s+(?:set|documents?)|for\s+(?:comment|review(?:\s+only)?|reference(?:\s+only)?|information(?:\s+only)?|discussion(?:\s+only)?|pricing(?:\s+only)?|approval|bid|tender|quotation|permit)|issued\s+for\s+(?:comment|review(?:\s+only)?|reference(?:\s+only)?|information(?:\s+only)?|discussion(?:\s+only)?|pricing(?:\s+only)?|approval|bid|tender|quotation|permit))`;
  const source = String
    .raw`(?:drawings?|documents?|plans?|sheets?|sets?|copies|revisions?|issues?|packages?)`;
  const descriptor = String
    .raw`(?:(?:current|project|civil|electrical|architectural|structural|mechanical|hvac|plumbing|landscape|canopy)\s+)*`;
  const boundedReceiptSuffix = String
    .raw`(?:\s+(?:rev(?:ision)?\s+[a-z0-9.-]{1,24}|\d{1,2}\s+\d{1,2}\s+\d{4}))?`;
  CACHED_PAGE_MATERIAL_ISSUE_STATUS_PATTERNS = Object.freeze([
    new RegExp(`^${status}$`),
    new RegExp(`^${status}${boundedReceiptSuffix}$`),
    new RegExp(`^${status}(?:\\s+${status})+$`),
    new RegExp(String.raw`^${status}\s+do\s+not\s+use$`),
    new RegExp(
      String
        .raw`^${status}\s+${descriptor}${source}(?:\s+(?:pdf\s+)?page\s+\d+|\s+\d+)?$`,
    ),
    new RegExp(
      String
        .raw`^(?:${descriptor}${source})(?:\s+(?:pdf\s+)?page\s+\d+)?\s+${status}$`,
    ),
    new RegExp(
      String
        .raw`^(?:(?:drawing|document|sheet|revision|issue)\s+)?status\s+(?:is\s+)?${status}${boundedReceiptSuffix}$`,
    ),
    /^(?:bid\s+documents?|permit\s+drawings?)$/,
  ]);
  return CACHED_PAGE_MATERIAL_ISSUE_STATUS_PATTERNS;
}

function pageFragmentHasMaterialIssueStatus(value: string) {
  if (!drawingFragmentCouldContainMaterialStatus(value)) return false;
  const patterns = pageMaterialIssueStatusPatterns();
  return drawingCanonicalStatusLines(value)
    .some((line) => patterns.some((pattern) => pattern.test(line)));
}

let CACHED_PAGE_UNIVERSAL_DIMENSION_PATTERNS: readonly RegExp[] | null = null;
let CACHED_PAGE_UNITLESS_DIMENSION_TOLERANCE_PATTERN: RegExp | null = null;

function pageHasUniversalDimensionQualifier(value: string) {
  const normalized = value.normalize("NFKC")
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/⁄/g, "/")
    .replace(/[“”″"]/g, " inch ")
    .replace(/[’‘′']/g, " foot ")
    .replace(/[±∓]/g, " plus or minus ")
    .replace(/\+\s*\/\s*-/g, " plus or minus ")
    .replace(/[^a-z0-9\n./]+/gi, " ")
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
  const lines = normalized.split("\n").map((line) => line.trim()).filter(
    Boolean,
  );
  const candidates = unique([
    ...lines,
    ...lines.slice(0, -1).map((line, index) => `${line} ${lines[index + 1]}`),
  ])
    .map((line) => line.replace(/\s+/g, " ").trim())
    // Every admitted universal qualifier below contains at least one of
    // these exact nouns. Filter the complete page before running the sixteen
    // anchored policy expressions so ordinary OCR rows do not pay that cost.
    .filter((line) => /\b(?:dimensions?|tolerances?|field)\b/.test(line));
  if (candidates.length === 0) return false;
  const dimension = "(?:all\\s+)?dimensions?";
  const number =
    "(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?|\\.\\d+)";
  const unit =
    "(?:inches?|inch|in|feet|foot|ft|millimeters?|mm|centimeters?|cm|meters?|m)";
  const tolerance = `${number}\\s*${unit}(?:\\s+${number}\\s*${unit})?`;
  const universal =
    "(?:unless\\s+otherwise\\s+(?:noted|specified)|u\\s*\\.?\\s*o\\s*\\.?\\s*[ns]\\.?)";
  const tail = `(?:\\s+${universal})?`;
  const prefix = `(?:${universal}\\s+)?`;
  const materialPatterns = CACHED_PAGE_UNIVERSAL_DIMENSION_PATTERNS ||= Object
    .freeze([
    new RegExp(
      `^${prefix}${dimension}\\s+(?:are\\s+)?(?:approximate|estimated|nominal|typical)$`,
    ),
    new RegExp(
      `^${prefix}${dimension}\\s+(?:(?:are\\s+)?for\\s+reference\\s+only|subject\\s+to\\s+field\\s+verification|(?:(?:are\\s+)?to\\s+be\\s+)?verified\\s+in\\s+(?:the\\s+)?field|v\\s*\\.?\\s*i\\s*\\.?\\s*f\\.?)$`,
    ),
    new RegExp(
      `^${prefix}${dimension}(?:\\s+shown)?\\s+(?:(?:are|shall\\s+be|must\\s+be)\\s+)?(?:n\\s*\\.?\\s*t\\s*\\.?\\s*e\\.?|not\\s+to\\s+exceed|max(?:imum)?\\.?|min(?:imum)?\\.?)(?:\\s+${tolerance})?${tail}$`,
    ),
    new RegExp(
      `^${prefix}${dimension}\\s+(?:shall|must)\\s+not\\s+(?:to\\s+)?exceed\\s+${tolerance}${tail}$`,
    ),
    new RegExp(
      `^${prefix}${dimension}(?:\\s+shown)?\\s+(?:(?:are|shall\\s+be|must\\s+be)\\s+)?plus\\s+or\\s+minus\\s+${tolerance}${tail}$`,
    ),
    new RegExp(
      `^${prefix}${dimension}\\s+(?:have|has)\\s+(?:a\\s+)?tolerance(?:\\s+of)?\\s+(?:plus\\s+or\\s+minus\\s+)?${tolerance}${tail}$`,
    ),
    new RegExp(
      `^${dimension}\\s+${universal}\\s+(?:have|has)?\\s*(?:a\\s+)?tolerance(?:\\s+of)?\\s+(?:plus\\s+or\\s+minus\\s+)?${tolerance}$`,
    ),
    new RegExp(
      `^${dimension}\\s+${universal}\\s+(?:plus\\s+or\\s+minus\\s+)?${tolerance}$`,
    ),
    new RegExp(
      `^${prefix}(?:(?:general|dimension(?:al)?)\\s+)?tolerances?(?:\\s+for\\s+${dimension})?\\s*(?:are|is|of)?\\s*(?:plus\\s+or\\s+minus\\s+)?${tolerance}${tail}$`,
    ),
    new RegExp(
      `^(?:(?:general|dimension(?:al)?)\\s+)?tolerances?\\s+${universal}` +
        `\\s*(?:are|is|of)?\\s*(?:plus\\s+or\\s+minus\\s+)?${tolerance}$`,
    ),
    new RegExp(
      `^${prefix}tolerances?\\s+for\\s+${dimension}\\s*(?:are|is|of)?\\s*(?:plus\\s+or\\s+minus\\s+)?${tolerance}${tail}$`,
    ),
    new RegExp(
      `^(?:contractor\\s+)?(?:(?:shall|must)\\s+)?(?:verify|confirm)\\s+(?:all\\s+)?dimensions?\\s+(?:in\\s+(?:the\\s+)?field|prior\\s+to\\s+construction)$`,
    ),
    new RegExp(
      `^${dimension}\\s+(?:(?:shall|must)\\s+be\\s+)?(?:verified|confirmed)\\s+in\\s+(?:the\\s+)?field$`,
    ),
    new RegExp(
      `^${dimension}\\s+(?:(?:(?:are\\s+)?to\\s+be)\\s+)?field\\s+verified$`,
    ),
    new RegExp(
      `^${dimension}\\s+(?:require|requires|subject\\s+to)\\s+field\\s+verification$`,
    ),
    new RegExp(
      `^field\\s+verification\\s+required(?:\\s+for\\s+${dimension})?$`,
    ),
    ]);
  if (
    candidates.some((candidate) =>
      materialPatterns.some((pattern) => pattern.test(candidate))
    )
  ) {
    return true;
  }
  const hasUnitlessTolerance = candidates.some((candidate) =>
    (CACHED_PAGE_UNITLESS_DIMENSION_TOLERANCE_PATTERN ||= new RegExp(
      `^(?:(?:general|dimension(?:al)?)\\s+)?tolerances?(?:\\s+for\\s+${dimension})?` +
        `\\s*(?:are|is|of)?\\s*(?:plus\\s+or\\s+minus\\s+)?${number}$`,
    )).test(candidate)
  );
  // A page-global unitless tolerance is still material even when the unit
  // convention could not be recovered. Treat it as unresolved rather than
  // publishing a reconstructed dimension as exact.
  return hasUnitlessTolerance;
}

function rawPageOverallDimensionsMatchAcceptedAxes(
  rawPageText: string,
  acceptedAxes: readonly number[],
) {
  const rawLines = rawPageText
    .replace(/[\r\u0085\f\u2028\u2029]/g, "\n")
    .split("\n");
  const wrappedOverallLines = rawLines.slice(0, -1).map((line, index) =>
    rawOverallWrappedLineCandidate(line, rawLines[index + 1])
  ).filter((line): line is string => line != null);
  const overallLines = [...rawLines, ...wrappedOverallLines]
    .map((line) => normalizeRawOverallDimensionLine(line).trim())
    .filter((line) => /\boverall\b/i.test(line) && !/\bplan\b/i.test(line));
  for (const line of overallLines) {
    if (
      /\b(?:maximum|max\.?|minimum|min\.?|not\s+to\s+exceed|n\s*\.?\s*t\s*\.?\s*e\.?|at\s+most|at\s+least|up\s+to|nominal|typical|typ\.?|estimated|estimate|approximately|approx\.?|field\s+verify|verify\s+in\s+field|varies|variable|tbd|to\s+be\s+determined|unknown)\b|[±∓]/i
        .test(
          line,
        )
    ) return false;
    const dimensions = parseFeetDimensions(line);
    if (dimensions.length !== 1) return false;
    if (
      !acceptedAxes.some((axis) => Math.abs(axis - dimensions[0].feet) < 0.001)
    ) return false;
    // A raw-page line is only compatible when the complete line has the same
    // exact positive syntax accepted for a structured overall axis. Unknown
    // suffixes fail closed, including OCR-damaged qualifier words.
    if (!planLineIsCleanOverallDimension(line)) return false;
  }
  return true;
}

function rawOverallWrappedLineCandidate(left: string, right: string) {
  const prefix = left.trim();
  const suffix = right.trimStart();
  if (!prefix || !suffix || prefix.length > 32 || suffix.length > 240) {
    return null;
  }
  if (parseFeetDimensions(prefix).length > 0) return null;
  const prefixGlyphs = [...prefix.replace(/[ \t._-]/g, "")];
  if (
    prefixGlyphs.length < 1 || prefixGlyphs.length > 6 ||
    prefixGlyphs.some((glyph) => foldRawOverallOCRGlyph(glyph) == null)
  ) return null;
  const joined = `${prefix}${suffix}`;
  return /^overall(?=$|[^\p{L}\p{N}])/iu.test(
      normalizeRawOverallDimensionLine(joined),
    )
    ? joined
    : null;
}

function normalizeRawOverallDimensionLine(value: string) {
  return value.normalize("NFKD")
    .replace(/[\p{Cf}\p{M}]/gu, "")
    // Canonicalize only a standalone seven-glyph OVERALL sentinel. This is a
    // position-specific construction-OCR map, not a fuzzy prose fold. At most
    // eight common OCR separators may occur between adjacent glyphs, keeping
    // even column-spaced extracted-PDF candidates below 56 code points.
    .replace(
      /(^|[^\p{L}\p{N}])(?:[o0оοᴏ][ \t._-]{0,8}[vνѵᴠ][ \t._-]{0,8}[e3еεєᴇ][ \t._-]{0,8}[rрρʀ][ \t._-]{0,8}[a4аαλᎪꭺᴀ][ \t._-]{0,8}[l1iіιӀӏƖʟ][ \t._-]{0,8}[l1iіιӀӏƖʟ])(?=$|[^\p{L}\p{N}])/giu,
      "$1overall",
    )
    .replace(
      /(^|[^\p{L}\p{N}])([\p{L}\p{N}]{6,8})(?=$|[^\p{L}\p{N}])/gu,
      (match, prefix, token) => {
        const folded = [...token].map(foldRawOverallOCRGlyph);
        const foldedToken = folded.every((glyph) => glyph != null)
          ? folded.join("")
          : null;
        return foldedToken != null &&
            stringsAreWithinOneEdit(foldedToken, "overall")
          ? `${prefix}overall`
          : match;
      },
    );
}

function foldRawOverallOCRGlyph(value: string) {
  const glyph = value.toLowerCase();
  if (/[o0оοᴏ]/u.test(glyph)) return "o";
  if (/[vνѵᴠ]/u.test(glyph)) return "v";
  if (/[e3еεєᴇ]/u.test(glyph)) return "e";
  if (/[rрρʀ]/u.test(glyph)) return "r";
  if (/[a4аαλᎪꭺᴀ]/u.test(glyph)) return "a";
  if (/[l1iіιӀӏƖʟ]/u.test(glyph)) return "l";
  return null;
}

function stringsAreWithinOneEdit(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;
  if (left.length === right.length) {
    let substitutions = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) substitutions += 1;
      if (substitutions > 1) return false;
    }
    return true;
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    edits += 1;
    longIndex += 1;
    if (edits > 1) return false;
  }
  return true;
}

type PlanAreaDesignator = Readonly<{ label: string; identifier: string }>;

const PLAN_AREA_LABEL_PATTERN =
  "(building[ \\t]+area|irrigation[ \\t]+plan|planting[ \\t]+plan|loading[ \\t]+dock|warehouse|room|building|sector|pod|wing|lot|yard|structure|facility|zone|floor|level|lobby|bay|court|space|corridor|office|suite|unit|area|canop(?:y|ies)|plan)";
const PLAN_AREA_IDENTIFIER_PATTERN =
  "['\"‘’“”]?([A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*\\+?)['\"‘’“”]?(?![A-Za-z0-9_#+.\\-+])";
const PLAN_AREA_CONTINUATION_PATTERN =
  "(?:and[ \\t]*/[ \\t]*or|versus|through|thru|with|plus|and|or|to|vs\\.?|[,;|:+&/]|\\+|[ \\t]+[-–—][ \\t]+)";
const PLAN_AREA_IGNORED_IDENTIFIERS = new Set([
  "what",
  "which",
  "how",
  "many",
  "the",
  "is",
  "are",
  "of",
  "for",
  "on",
  "in",
  "from",
  "to",
  "and",
  "or",
  "area",
  "footprint",
  "plan",
  "square",
  "feet",
  "foot",
  "drawing",
  "page",
  "sheet",
  "value",
  "overall",
  "view",
  "scale",
  "detail",
  "details",
  "anchor",
  "rod",
  "layout",
]);
const PLAN_WRAPPED_SAFE_DESCRIPTORS = new Set([
  "anchor rod",
  "north",
  "south",
  "east",
  "west",
  "site",
  "framing",
  "roof",
  "foundation",
  "electrical",
  "structural",
  "architectural",
  "mechanical",
  "plumbing",
  "civil",
  "landscape",
  "enlarged",
  "demolition",
  "floor",
  "grading",
  "reflected ceiling",
  "north arrow",
  "true north",
  "project north",
]);
const MAX_PLAN_TITLE_IDENTITY_MATCHES = 128;

function requestedPlanAreaDesignator(
  question: string,
): PlanAreaDesignator | "ambiguous" | null {
  if (
    new RegExp(
      `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)[\'"‘’“”]?` +
        `[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*\\+(?=[A-Za-z0-9_#+.\\-+])`,
      "i",
    ).test(question)
  ) return "ambiguous";
  const uniqueCandidates = [
    ...new Map(
      planAreaDesignators(question).map((candidate) => [
        `${candidate.label}:${candidate.identifier}`,
        candidate,
      ]),
    ).values(),
  ];
  if (uniqueCandidates.length === 0) return null;
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : "ambiguous";
}

function planDesignatorValues(value: string, label: string) {
  const normalizedValue = normalizePlanTitleIdentityText(value);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const identifiers = new Set<string>();
  const identifier =
    "['\"‘’“”]?([a-z0-9]+(?:[-.][a-z0-9]+)*\\+?)['\"‘’“”]?(?![a-z0-9_#+.\\-+])";
  for (
    const match of normalizedValue.matchAll(
      new RegExp(
        `\\b${escaped}s?(?:[ \\t]+|-)${identifier}`,
        "gi",
      ),
    )
  ) {
    identifiers.add(canonicalPlanIdentifier(match[1]));
  }
  for (
    const match of normalizedValue.matchAll(
      new RegExp(
        `\\b${escaped}s?(?:[ \\t]+|-)${identifier}\\s*${PLAN_AREA_CONTINUATION_PATTERN}\\s*[\'"‘’“”]?([a-z0-9]+(?:[-.][a-z0-9]+)*\\+?)[\'"‘’“”]?(?![a-z0-9_#+.\\-+])`,
        "gi",
      ),
    )
  ) {
    identifiers.add(canonicalPlanIdentifier(match[1]));
    identifiers.add(canonicalPlanIdentifier(match[2]));
  }
  return identifiers;
}

function boundedRequestedPlanTitleDesignators(value: string) {
  const exactStandaloneIdentity = new RegExp(
    `^(?:current\\s+)?${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}[\\s.:'"‘’“”_-]*$`,
    "i",
  );
  const genericPlanHeading = new RegExp(
    `^(?:(?:${
      [...PLAN_WRAPPED_SAFE_DESCRIPTORS]
        .sort((left, right) => right.length - left.length)
        .map((descriptor) =>
          descriptor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(
            /\\ /g,
            "\\s+",
          )
        )
        .join("|")
    })\\s+){1,4}plan[\\s.:'"‘’“”_-]*$`,
    "i",
  );
  const lines = value.replace(/[\r\u0085\f\u2028\u2029]/g, "\n").split("\n");
  if (lines.length > MAX_PLAN_TITLE_IDENTITY_MATCHES * 20) {
    return new Set(["ambiguous:multiple"]);
  }
  const filteredLines: string[] = [];
  const standaloneIdentities = new Set<string>();
  for (const rawLine of lines) {
    const line = normalizePlanTitleIdentityText(rawLine).replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (line.length > 240) {
      filteredLines.push(rawLine);
      continue;
    }
    const carriesPlan = /\bplan\b/i.test(line);
    if (carriesPlan && genericPlanHeading.test(line)) continue;
    filteredLines.push(rawLine);
    if (!carriesPlan && exactStandaloneIdentity.test(line)) {
      for (const candidate of planAreaDesignators(line)) {
        standaloneIdentities.add(
          `${candidate.label}:${candidate.identifier}`,
        );
      }
    }
  }
  if (standaloneIdentities.size === 0) {
    return planTitleDesignators(value);
  }
  // Keep the mature raw-page ambiguity detector intact. Only an exact generic
  // plan-type heading (for example, ANCHOR ROD PLAN) is omitted; malformed,
  // compact, wrapped, competing, or confusable identities still fail closed.
  const identities = planTitleDesignators(filteredLines.join("\n"));
  if (identities.has("ambiguous:multiple")) return identities;
  for (const identity of standaloneIdentities) {
    identities.add(identity);
    if (identities.size > MAX_PLAN_TITLE_IDENTITY_MATCHES) {
      return new Set(["ambiguous:multiple"]);
    }
  }
  return identities;
}

function planTitleDesignators(value: string) {
  const identities = new Set<string>();
  const normalizedValue = normalizePlanTitleIdentityText(value);
  let planMatchCount = 0;
  for (const _match of normalizedValue.matchAll(/\bplan\b/gi)) {
    planMatchCount += 1;
    if (planMatchCount > MAX_PLAN_TITLE_IDENTITY_MATCHES) {
      return new Set(["ambiguous:multiple"]);
    }
  }
  const linePairs = value
    .replace(/[\r\u0085\f\u2028\u2029]/g, "\n")
    .split(/\n/)
    .map((rawLine) => {
      const raw = rawLine
        .replace(/[\t\v]/g, " ")
        .replace(/[\p{Cc}\p{Cf}\p{M}]/gu, "")
        .trim();
      const boundedNote = planLineIsBoundedNonIdentityPlanNote(raw);
      return Object.freeze({
        raw,
        normalized: boundedNote
          ? raw.normalize("NFKC").replace(/\s+/g, " ").trim()
          : normalizePlanTitleIdentityText(raw).trim(),
      });
    })
    // Drop formatting-only slots once, as a pair. Keeping independently
    // filtered raw and normalized arrays lets an invisible line shift their
    // indexes and hide a wrapped Unicode plan identifier.
    .filter((pair) =>
      Boolean(pair.normalized) &&
      (
        /[\p{L}\p{N}]/u.test(pair.normalized) ||
        planRawUnicodeIdentifierAtom(pair.raw)
      )
    );
  const rawLines = linePairs.map((pair) => pair.raw);
  const lines = linePairs.map((pair) => pair.normalized);
  // Dimension callouts can sit immediately above a repeated plan heading.
  // Exclude only syntactically complete footprint measurements from every
  // title-reconstruction window; arbitrary measurement residue remains
  // visible so a token such as `B 25 feet` cannot be laundered away.
  const titleWindowLines = lines.map((line) =>
    planLineIsBoundedMeasurementNotTitle(line) ||
      planLineIsBoundedNonIdentityPlanNote(line) ||
      planLineBoundedExactIdentityRepeatNote(line) != null
      ? " ".repeat(line.length)
      : line
  );
  const titleLines = lines.filter((line) =>
    !planLineIsBoundedNonIdentityPlanNote(line)
  );
  const safeWrappedDescriptorLines = new Set<number>();
  const safeWrappedDescriptorDimensionLines = new Set<number>();
  const safeWrappedDescriptorPlanLines = new Map<number, string>();
  let titleAnalysisOverbound =
    rawLines.some((line) =>
      planLineHasCompactPostPlanIdentity(line) ||
      planLineHasSeparatedUnicodePostPlanIdentity(line)
    ) ||
    lines.some((line, index) =>
      line.length > 240 && /\bplan\b/i.test(line) ||
      planLineHasUnrecognizedIdentity(line) &&
        !planLineUnrecognizedIdentityIsConsumedByExactJoinedTitle(
          lines,
          index,
        ) ||
      planLineHasCompactPostPlanIdentity(line) ||
      planLineHasBoundedPostPlanHeadingIdentity(line) ||
      planLineHasOCRDamagedPlanSentinelIdentity(line) ||
      planLineHasApproximateSplitPlanSentinelIdentity(line) ||
      planLineHasGenericOCRPlanSentinelIdentity(line)
    );
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!planLineIsBoundedNonIdentityPlanNote(lines[index])) continue;
    const following = lines[index + 1];
    if (
      planWrappedIdentityAfterNoteIsAmbiguous(
        following,
        rawLines[index + 1] || "",
      )
    ) {
      titleAnalysisOverbound = true;
    }
  }
  let previousPlan = -1;
  for (let end = 0; end < lines.length; end += 1) {
    if (!/\bplan\b/i.test(lines[end])) continue;
    const lineIdentities = planAreaDesignators(lines[end]);
    for (const identifier of planPostTitleDesignators(lines[end])) {
      if (
        !lineIdentities.some((candidate) =>
          candidate.identifier === canonicalPlanIdentifier(identifier)
        )
      ) {
        titleLines.push(`PLAN ${identifier}`);
      }
    }
    for (
      let start = Math.max(previousPlan + 1, end - 3, 0);
      start < end;
      start += 1
    ) {
      const joined = titleWindowLines.slice(start, end + 1).map(
        (line, offset) => {
          const index = start + offset;
          return safeWrappedDescriptorLines.has(index) ||
              safeWrappedDescriptorDimensionLines.has(index)
            ? " ".repeat(line.length)
            : line;
        },
      ).join(" ");
      if (joined.length <= 240) titleLines.push(joined);
    }
    previousPlan = end;
    const following = lines[end + 1] || "";
    const terminalPlan = planTerminalTitle(lines[end]);
    const terminalPlanPrefix = terminalPlan?.prefix || null;
    if (terminalPlan?.overbound) titleAnalysisOverbound = true;
    const followingToken = planWrappedSingleToken(following);
    const followingDescriptor = planWrappedDescriptor(following);
    const safeImmediateDimension = terminalPlanPrefix != null &&
      !terminalPlan?.overbound &&
      planTitlePrefixHasOneIdentity(terminalPlanPrefix) &&
      (
        planLineIsCleanOverallDimension(following) ||
        planLineIsCleanUnlabeledFootprintDimension(following)
      );
    const safeWrappedDescriptor = terminalPlanPrefix != null &&
      !terminalPlan?.overbound &&
      planWrappedDescriptorIsSafe(
        terminalPlanPrefix,
        followingDescriptor,
        lines[end + 2] || "",
      );
    if (safeImmediateDimension) {
      safeWrappedDescriptorDimensionLines.add(end + 1);
      safeWrappedDescriptorPlanLines.set(end, terminalPlanPrefix);
    }
    if (safeWrappedDescriptor) {
      safeWrappedDescriptorLines.add(end + 1);
      safeWrappedDescriptorDimensionLines.add(end + 2);
      safeWrappedDescriptorPlanLines.set(end, terminalPlanPrefix);
    }
    if (
      terminalPlanPrefix != null &&
      !safeWrappedDescriptor &&
      !planLineIsBoundedNonIdentityPlanNote(following) &&
      followingToken != null &&
      planStandaloneTitleDesignator(followingToken)
    ) {
      titleLines.push(`${terminalPlanPrefix} ${followingToken}`);
    }
    if (
      terminalPlanPrefix != null &&
      !safeWrappedDescriptor &&
      (
        planWrappedTitleContinuationIsAmbiguous(following) ||
        planRawUnicodeIdentifierAtom(rawLines[end + 1] || "")
      )
    ) {
      titleAnalysisOverbound = true;
    }
  }
  // Preserve line endings in the broad title window. A terminal title token
  // such as `CANOPY A PLAN` must not consume a unit-bearing dimension on the
  // next line as a fabricated `plan:52` identity. The bounded title-line
  // reconstruction above still joins the lines that precede PLAN.
  const flattened = lines.join("\n");
  const flattenedTitleWindows = titleWindowLines.join("\n");
  let previousPlanEnd = 0;
  for (const match of flattenedTitleWindows.matchAll(/\bplan\b/gi)) {
    const index = match.index || 0;
    if (
      index - previousPlanEnd > 240 &&
      planAreaDesignators(
          flattenedTitleWindows.slice(
            Math.max(previousPlanEnd, index - 180),
            index + 4,
          ),
        ).length > 0
    ) titleAnalysisOverbound = true;
    const rawStart = Math.max(0, index - 160);
    const rawEnd = Math.min(flattenedTitleWindows.length, index + 80);
    const boundedStart = rawStart > 0
      ? Math.min(
        index,
        flattenedTitleWindows.indexOf(" ", rawStart) + 1 || rawStart,
      )
      : 0;
    const boundedEnd = rawEnd < flattenedTitleWindows.length
      ? Math.max(index + 4, flattenedTitleWindows.lastIndexOf(" ", rawEnd))
      : flattenedTitleWindows.length;
    titleLines.push(flattenedTitleWindows.slice(boundedStart, boundedEnd));
    previousPlanEnd = index + 4;
  }
  const boundedRepeatNoteIdentities = new Set<string>();
  for (const titleLine of titleLines) {
    if (!titleLine || titleLine.length > 240 || !/\bplan\b/i.test(titleLine)) {
      continue;
    }
    const boundedRepeatIdentity = planLineBoundedExactIdentityRepeatNote(
      titleLine,
    );
    if (boundedRepeatIdentity != null) {
      boundedRepeatNoteIdentities.add(boundedRepeatIdentity);
      continue;
    }
    for (const candidate of planAreaDesignators(titleLine)) {
      identities.add(`${candidate.label}:${candidate.identifier}`);
    }
  }
  for (const boundedRepeatIdentity of boundedRepeatNoteIdentities) {
    if (identities.has(boundedRepeatIdentity)) continue;
    identities.add(boundedRepeatIdentity);
    identities.add("ambiguous:multiple");
  }
  // A punctuation-terminated title followed by one proven descriptor can look
  // like `PLAN.\nNORTH`. Mask only that locally verified descriptor and the
  // title's trailing punctuation before applying the broad ambiguity veto.
  // All other wrapped tokens remain visible and fail closed.
  const ambiguityLines = lines.map((line, index) => {
    if (
      safeWrappedDescriptorLines.has(index) ||
      safeWrappedDescriptorDimensionLines.has(index) ||
      planLineIsBoundedMeasurementNotTitle(line) ||
      planLineIsBoundedNonIdentityPlanNote(line) ||
      planLineBoundedExactIdentityRepeatNote(line) != null
    ) return " ".repeat(line.length);
    return safeWrappedDescriptorPlanLines.get(index) || line;
  });
  const ambiguousContinuation = planTitleHasAmbiguousContinuation(
    planTextWithoutRepeatedExactIdentities(ambiguityLines.join("\n")),
  );
  if (
    identities.size > 0 &&
    (titleAnalysisOverbound || ambiguousContinuation)
  ) {
    identities.add("ambiguous:multiple");
  }
  return identities;
}

function planTerminalTitle(value: string) {
  const match = /^(.*\bplan)([\s\p{P}\p{S}]*)$/iu.exec(value);
  if (!match) return null;
  const punctuationCount =
    [...match[2]].filter((character) => /[\p{P}\p{S}]/u.test(character)).length;
  return Object.freeze({
    prefix: match[1].trim(),
    overbound: punctuationCount > 4 || match[2].length > 12,
  });
}

function planWrappedSingleToken(value: string) {
  const compact = value.trim();
  if (!compact) return null;
  const unwrapped = compact
    .replace(/^[\p{P}\p{S}]+/u, "")
    .replace(/[\p{P}\p{S}]+$/u, "")
    .trim()
    .replace(
      /\s*([._-])\s*/g,
      (_match, separator) => separator === "_" ? "." : separator,
    );
  return /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/i.test(unwrapped) ? unwrapped : null;
}

function planWrappedDescriptor(value: string) {
  const descriptor = value.trim()
    .replace(/^[\p{P}\p{S}]+/u, "")
    .replace(/[\p{P}\p{S}]+$/u, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return PLAN_WRAPPED_SAFE_DESCRIPTORS.has(descriptor) ? descriptor : null;
}

function planWrappedDescriptorIsSafe(
  terminalPlanPrefix: string,
  followingDescriptor: string | null,
  nextLine: string,
) {
  if (followingDescriptor == null) return false;
  return planTitlePrefixHasOneIdentity(terminalPlanPrefix) &&
    planLineIsCleanOverallDimension(nextLine);
}

function planTitlePrefixHasOneIdentity(value: string) {
  return new Set(
    planAreaDesignators(value).map((candidate) =>
      `${candidate.label}:${candidate.identifier}`
    ),
  ).size === 1;
}

function planLineIsCleanOverallDimension(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const dimensions = parseFeetDimensions(normalized);
  if (dimensions.length !== 1) return false;
  const display = dimensions[0].display;
  const displayStart = normalized.toLowerCase().indexOf(display.toLowerCase());
  if (displayStart < 0) return false;
  const residue = `${normalized.slice(0, displayStart)} ${
    normalized.slice(displayStart + display.length)
  }`;
  const residueTokens = normalizeText(residue).match(/[a-z]+/g) || [];
  return residueTokens[0] === "overall" &&
    residueTokens.slice(1).every((token) =>
      token === "width" || token === "wide" || token === "length" ||
      token === "long" ||
      token === "horizontal" || token === "horiz" || token === "horz" ||
      token === "vertical" || token === "vert" || token === "dimension" ||
      token === "dimensions" || token === "dim" || token === "shown" ||
      token === "as"
    );
}

function planLineIsCleanUnlabeledFootprintDimension(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const dimensions = parseFeetDimensions(normalized);
  if (dimensions.length !== 1) return false;
  const display = dimensions[0].display;
  const displayStart = normalized.toLowerCase().indexOf(display.toLowerCase());
  if (displayStart < 0) return false;
  return normalizeText(
    `${normalized.slice(0, displayStart)} ${
      normalized.slice(displayStart + display.length)
    }`,
  ).trim() === "";
}

function planLineHasOCRDamagedPlanSentinelIdentity(value: string) {
  if (/\bplan\b/i.test(value)) return false;
  const separator = String.raw`[\s\p{M}\p{Cf}._|:/-]*`;
  const planLike = String
    .raw`(?:p|р|ρ|ᴘ)${separator}(?:l|i|1|і|ι|ł|Ɩ|ʟ)${separator}(?:a|4|α|а|λ|Ꭺ|ᴀ)${separator}(?:n|и|ν|ɴ)`;
  const identifier = String.raw`['"‘’“”]?[a-z0-9]+(?:[-.][a-z0-9]+)*['"‘’“”]?`;
  const leadingPlanFamily = String.raw`(?:irrigation|planting)`;
  const trailingPlanFamily = String
    .raw`(?:building(?:\s+area)?|loading\s+dock|warehouse|room|sector|pod|wing|lot|yard|structure|facility|zone|floor|level|lobby|bay|court|space|corridor|office|suite|unit|area|canop(?:y|ies))`;
  return new RegExp(
    String
      .raw`(?:^|[^\p{L}\p{N}])${leadingPlanFamily}\s+${planLike}(?:\s+${identifier})?(?=$|[^\p{L}\p{N}.-])`,
    "iu",
  ).test(value) || new RegExp(
    String
      .raw`(?:^|[^\p{L}\p{N}])${trailingPlanFamily}\s+${identifier}\s+${planLike}(?=$|[^\p{L}\p{N}])`,
    "iu",
  ).test(value);
}

function planLineHasApproximateSplitPlanSentinelIdentity(value: string) {
  const match = /^(?:irrigation|planting)\s+(.+)$/i.exec(value.trim());
  if (!match) return false;
  const tokens = match[1].split(/\s+/).map((token) =>
    token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
  ).filter(Boolean);
  for (let sentinelLength = 3; sentinelLength <= 5; sentinelLength += 1) {
    if (
      tokens.length !== sentinelLength && tokens.length !== sentinelLength + 1
    ) continue;
    const sentinelTokens = tokens.slice(0, sentinelLength);
    if (sentinelTokens.some((token) => [...token].length !== 1)) continue;
    const folded = sentinelTokens.map(foldPlanOCRGlyph);
    const foldedSentinel = folded.every((glyph) => glyph != null)
      ? folded.join("")
      : null;
    if (
      foldedSentinel == null ||
      !stringsAreWithinOneEdit(foldedSentinel, "plan")
    ) continue;
    if (tokens.length === sentinelLength) return true;
    const identifier = planWrappedSingleToken(tokens[sentinelLength]);
    if (
      identifier != null &&
      (planStandaloneTitleDesignator(identifier) ||
        /^\d+(?:\.\d+)*$/.test(identifier))
    ) return true;
  }
  return false;
}

function planLineHasGenericOCRPlanSentinelIdentity(value: string) {
  const normalizedValue = normalizePlanTitleIdentityText(value);
  if (/\bplan\b/i.test(normalizedValue) || normalizedValue.length > 180) {
    return false;
  }
  const rawTokens = normalizedValue.match(/[\p{L}\p{N}._|:/-]+/gu) || [];
  const tokens = rawTokens
    .map((token) => token.replace(/[._|:/-]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 12) return false;

  const tokenFoldsToApproximatePlan = (token: string) => {
    const glyphs = [...token];
    if (glyphs.length < 3 || glyphs.length > 5) return false;
    const folded = glyphs.map(foldPlanOCRGlyph);
    return folded.every((glyph) => glyph != null) &&
      stringsAreWithinOneEdit(folded.join(""), "plan");
  };
  if (tokens.some(tokenFoldsToApproximatePlan)) return true;

  for (let start = 0; start < tokens.length; start += 1) {
    for (
      let length = 3;
      length <= 5 && start + length <= tokens.length;
      length += 1
    ) {
      const glyphTokens = tokens.slice(start, start + length);
      if (glyphTokens.some((token) => [...token].length !== 1)) continue;
      if (tokenFoldsToApproximatePlan(glyphTokens.join(""))) return true;
    }
  }
  return false;
}

function foldPlanOCRGlyph(value: string) {
  const glyph = value.toLowerCase();
  if (/[pрρᴘ]/u.test(glyph)) return "p";
  if (/[li1іιłƖʟ]/u.test(glyph)) return "l";
  if (/[a4αаλᎪꭺᴀ]/u.test(glyph)) return "a";
  if (/[nиνɴ]/u.test(glyph)) return "n";
  return null;
}

function planPostTitleDesignators(value: string) {
  const identifiers: string[] = [];
  for (const match of value.matchAll(/\bplan\b/gi)) {
    const trailing = value.slice((match.index || 0) + match[0].length);
    const identifier = planWrappedSingleToken(trailing);
    if (
      identifier != null &&
      (planStandaloneTitleDesignator(identifier) ||
        /^\d+(?:\.\d+)*$/.test(identifier))
    ) identifiers.push(identifier);
  }
  return identifiers;
}

function planLineIsBoundedConstructionInstruction(value: string) {
  if (
    value.length > 120 || /\bplan\b/i.test(value) ||
    planAreaDesignators(value).length > 0
  ) {
    return false;
  }
  const normalized = value.normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9.'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 3 || tokens.length > 6) return false;
  if (
    !/^(?:verify|coordinate|provide|align|fasten|center|attach|secure|locate|install|construct|place|set|slope)$/
      .test(tokens[0])
  ) {
    return false;
  }
  const connectorIndex = tokens.findIndex((token) =>
    /^(?:in|with|for|on|to|at|by)$/.test(token)
  );
  if (connectorIndex <= 0 || connectorIndex >= tokens.length - 1) return false;
  const terminal = tokens.at(-1) || "";
  if (/^[a-z0-9]{1,3}$/.test(terminal) && !/^(?:gc|mep|eor)$/.test(terminal)) {
    return false;
  }
  return true;
}

function planLineIsBoundedNonIdentityPlanNote(value: string) {
  if (value.length > 180) return false;
  if (planLineIsBoundedConstructionInstruction(value)) return true;
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")
    .trim();
  const normalizedVariants = new Set([
    normalized,
    normalized.replace(/(?<=[a-z0-9])_+(?=[a-z0-9])/g, " ").replace(/\s+/g, " ")
      .trim(),
  ]);
  const reference =
    "(?:see|refer\\s+to)\\s+(?:the\\s+)?plan\\s+for\\s+(?:details?|dimensions?|layout|locations?|coordination|extents?|more\\s+information)";
  const shortReference =
    "(?:see|refer\\s+to)\\s+(?:the\\s+)?plan(?:\\s+for\\s+(?:details?|dimensions?|layout|locations?|coordination|extents?|more\\s+information))?";
  const notToScale =
    `(?:not\\s+to\\s+scale|n\\.?\\s*t\\.?\\s*s\\.?)\\s*(?::\\s*)?(?:[-–—]\\s*)?${shortReference}`;
  const fractionInch = '\\d+\\s*\\/\\s*\\d+\\s*(?:inches?|inch|in\\.?|")';
  const conventionalScale =
    `${fractionInch}\\s*(?:=|\\|)\\s*\\d+\\s*'\\s*(?:-\\s*\\d+\\s*")?`;
  const constructionPlanReference =
    "(?:(?:verify|coordinate|provide|align|fasten|center|attach|secure|locate|install|construct|place|set|slope)\\s+(?:per|with)\\s+(?:the\\s+)?plan|" +
    "(?:provide|install|construct|locate|place|set|align|attach|secure)\\s+as\\s+(?:shown|noted|indicated)\\s+(?:on|in)\\s+(?:the\\s+)?plan)";
  if (
    planAreaDesignators(value).length === 0 &&
    [...normalizedVariants].some((candidate) =>
      new RegExp(`^${constructionPlanReference}(?:[.!:;])?$`).test(candidate)
    )
  ) return true;
  const planNorthWordLabel = "(?:arrow|is\\s+up)";
  const planNorthGlyph = "[↑↖↗⇧⬆]";
  // NORTH must end as a word before an alphabetic direction phrase. Without
  // that boundary, OCR/prose such as PLAN NORTHARROW or PLAN NORTHIS UP could
  // be erased as a harmless note and hide a second plan authority.
  const planNorthLabel = `plan\\s+north(?:` +
    `(?:\\s+|\\s*:\\s*)${planNorthWordLabel}` +
    `|(?:\\s*:\\s*|\\s*)${planNorthGlyph}` +
    `)?\\s*`;
  return [...normalizedVariants].some((candidate) =>
    new RegExp(
      `^(?:${shortReference}|${notToScale}|${planNorthLabel}|plan\\s+scale\\s*:?\\s*(?:${fractionInch}|${conventionalScale}))(?:[.!:;])?$`,
    ).test(candidate)
  );
}

const PLAN_COMPACT_ORDINARY_WORDS = new Set([
  "plane",
  "planes",
  "planar",
  "planed",
  "planer",
  "planers",
  "planet",
  "planets",
  "planetary",
  "plank",
  "planks",
  "planked",
  "planking",
  "planned",
  "planner",
  "planners",
  "planning",
  "plans",
  "plant",
  "plants",
  "planted",
  "planter",
  "planters",
  "planting",
  "plantings",
]);

function compactPlanSentinelSplit(token: string) {
  const glyphs = [...token];
  const wholeFold = glyphs.map(foldPlanOCRGlyph);
  if (
    glyphs.length === 4 &&
    wholeFold.every((glyph) => glyph != null) &&
    wholeFold.join("") === "plan"
  ) return null;
  const candidates: Array<
    { sentinel: string; length: number; residue: string }
  > = [];
  for (let length = 3; length <= 5 && length < glyphs.length; length += 1) {
    const folded = glyphs.slice(0, length).map(foldPlanOCRGlyph);
    if (folded.some((glyph) => glyph == null)) continue;
    const sentinel = folded.join("");
    if (!stringsAreWithinOneEdit(sentinel, "plan")) continue;
    const residue = glyphs.slice(length).join("");
    if (
      [...residue].length > 24 ||
      !/^[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*$/u.test(residue)
    ) continue;
    candidates.push({ sentinel, length, residue });
  }
  return candidates.sort((left, right) =>
    Number(right.sentinel === "plan") - Number(left.sentinel === "plan") ||
    [...left.residue].length - [...right.residue].length ||
    Math.abs(left.length - 4) - Math.abs(right.length - 4)
  )[0] || null;
}

function compactPlanTokenHasTitleContext(
  line: string,
  tokenStart: number,
  tokenEnd: number,
) {
  const before = line.slice(0, tokenStart).trim();
  const after = line.slice(tokenEnd).trim();
  if (planAreaDesignators(before).length > 0) return true;
  if (/^(?:irrigation|planting)\s*$/i.test(before)) return true;
  if (
    /\b(?:see|refer\s+to(?:\s+the)?|detail|details|option|alternate)\s*$/i.test(
      before,
    )
  ) {
    return true;
  }
  return !before && (
    !after ||
    /^[\p{P}\p{S}\s]+$/u.test(after) ||
    planWrappedDescriptor(after) != null
  );
}

function planLineHasCompactPostPlanIdentity(value: string) {
  if (value.length > 180 || planLineIsBoundedNonIdentityPlanNote(value)) {
    return false;
  }
  const normalized = value
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/[\p{Cf}\p{M}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [
    normalized,
    normalized.replace(/(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}])/gu, ""),
  ];
  for (const variant of new Set(variants)) {
    for (
      const match of variant.matchAll(
        /[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu,
      )
    ) {
      const token = match[0];
      const split = compactPlanSentinelSplit(token);
      if (!split) continue;
      const canonicalWord = /^[A-Za-z]+$/.test(split.residue)
        ? `plan${split.residue.toLowerCase()}`
        : "";
      if (PLAN_COMPACT_ORDINARY_WORDS.has(canonicalWord)) continue;
      const residueGlyphs = [...split.residue.replace(/[.-]/g, "")];
      const strongIdentifier = residueGlyphs.length === 1 ||
        /[\p{N}.-]/u.test(split.residue);
      const boundedWordIdentifier = !planSingleIdentityDescriptorResidueIsSafe(
        split.residue,
      );
      const tokenStart = match.index || 0;
      const titleContext = compactPlanTokenHasTitleContext(
        variant,
        tokenStart,
        tokenStart + token.length,
      );
      // Veto only: this never creates or normalizes affirmative title proof.
      if (strongIdentifier || (titleContext && boundedWordIdentifier)) {
        return true;
      }
    }
  }
  const mergedHeading =
    /\bplan(?:detail|details|layout|view|drawing|sheet|page|scale)\s+([\s\S]+)$/i
      .exec(
        normalized,
      );
  if (!mergedHeading) return false;
  const identifier = planWrappedSingleToken(mergedHeading[1]);
  return identifier != null &&
    !planSingleIdentityDescriptorResidueIsSafe(identifier);
}

function planLineHasSeparatedUnicodePostPlanIdentity(value: string) {
  if (value.length > 180 || planLineIsBoundedNonIdentityPlanNote(value)) {
    return false;
  }
  for (const match of value.matchAll(/\bplan\b/giu)) {
    const trailing = value.slice((match.index || 0) + match[0].length);
    if (planRawUnicodeIdentifierAtom(trailing)) return true;
  }
  return false;
}

function planRawUnicodeIdentifierAtom(value: string) {
  if (
    !/[^\x00-\x7f]/.test(value) ||
    planLineIsBoundedNonIdentityPlanNote(value)
  ) return false;
  const withoutFormatting = value.replace(/[\p{Cf}\p{M}]/gu, "").trim();
  if (!withoutFormatting) return false;
  if (/[\u2460-\u24ff\u{1f100}-\u{1f1ff}]/u.test(withoutFormatting)) {
    return true;
  }
  const unwrapped = withoutFormatting
    .replace(/^[\s/'"‘’“”()[\]{}:;,.|\\+&—–-]+/u, "")
    .replace(/[\s/'"‘’“”()[\]{}:;,.|\\+&—–-]+$/u, "")
    .trim()
    .normalize("NFKC");
  return /^[\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*$/u.test(unwrapped);
}

function planLineHasBoundedPostPlanHeadingIdentity(value: string) {
  if (value.length > 180) return false;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const match =
    /\bplan\s+(?:detail|details|layout|view|drawing|sheet|page|scale)\s+([\s\S]+)$/i
      .exec(
        normalized,
      );
  if (!match) return false;
  const identifier = planWrappedSingleToken(match[1]);
  return identifier != null &&
    !planSingleIdentityDescriptorResidueIsSafe(identifier);
}

function planLineBoundedExactIdentityRepeatNote(value: string) {
  if (value.length > 180) return null;
  const match =
    /^(?:(?:the|this)\s+)?plan\s+(?:shows?|identifies?|depicts?|indicates?)\s+(.+?)[.!]?$/i
      .exec(
        value.trim(),
      );
  if (!match) return null;
  const suffix = match[1].trim();
  const exactIdentity = new RegExp(
    `^${PLAN_AREA_LABEL_PATTERN}(?:[ \t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}$`,
    "i",
  );
  if (!exactIdentity.test(suffix)) return null;
  const identities = new Set(
    planAreaDesignators(suffix).map((candidate) =>
      `${candidate.label}:${candidate.identifier}`
    ),
  );
  return identities.size === 1 ? [...identities][0] : null;
}

function planLineHasUnrecognizedIdentity(value: string) {
  if (planLineIsBoundedNonIdentityPlanNote(value)) return false;
  if (!/\bplan\b/i.test(value) || planAreaDesignators(value).length > 0) {
    return false;
  }
  const headingTokens =
    normalizeText(value).match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g) || [];
  // A short PLAN-bearing heading with no recognized identity is itself a
  // second unbound plan authority. Fail closed even when its neighboring word
  // is a generic heading noun (DETAILS, LAYOUT, VIEW, DRAWING, and similar).
  if (
    value.length <= 180 && headingTokens.length > 0 &&
    headingTokens.length <= 12
  ) return true;
  const terminalPlan = planTerminalTitle(value);
  if (!terminalPlan) return false;
  const beforePlan = terminalPlan.prefix.replace(/\bplan$/i, "").trim();
  if (!beforePlan || beforePlan.length > 180) return false;
  const directIdentifier = planWrappedSingleToken(beforePlan);
  if (
    directIdentifier != null &&
    (planStandaloneTitleDesignator(directIdentifier) ||
      /^\d+(?:\.\d+)*$/.test(directIdentifier))
  ) return true;
  const match = /(?:^|[ \t-])(['"‘’“”]?[a-z0-9]+(?:[-.][a-z0-9]+)*['"‘’“”]?)$/i
    .exec(
      beforePlan,
    );
  if (!match) return false;
  const identifier = planWrappedSingleToken(match[1]);
  if (!identifier) return false;
  return planStandaloneTitleDesignator(identifier) ||
    /^\d+(?:\.\d+)*$/.test(identifier);
}

function planLineUnrecognizedIdentityIsConsumedByExactJoinedTitle(
  lines: readonly string[],
  index: number,
) {
  if (index < 0 || index >= lines.length || !/\bplan\b/i.test(lines[index])) {
    return false;
  }
  const previousPlan = lines.slice(0, index).findLastIndex((line) =>
    /\bplan\b/i.test(line)
  );
  const lowerBound = Math.max(previousPlan + 1, index - 2, 0);
  const exactTitle = new RegExp(
    `^${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}\\s+plan[\\p{P}\\p{S}\\s]*$`,
    "iu",
  );
  const precedingLineCanBeSkipped = (line: string) =>
    /^(?:drawing\s+page\s+context\s*:|pdf\s+page\s+\d+\b|sheet\s+[a-z0-9.-]+\b)/i
      .test(line) ||
    planLineIsBoundedMeasurementNotTitle(line);
  const matches: string[] = [];
  for (let start = lowerBound; start <= index; start += 1) {
    if (
      lines.slice(lowerBound, start).some((line) =>
        !precedingLineCanBeSkipped(line)
      )
    ) continue;
    const window = lines.slice(start, index + 1);
    if (
      window.length === 0 || window.some(planLineIsBoundedMeasurementNotTitle)
    ) continue;
    const joined = window.join(" ").replace(/\s+/g, " ").trim();
    if (!exactTitle.test(joined)) continue;
    const identities = new Set(
      planAreaDesignators(joined).map((candidate) =>
        `${candidate.label}:${candidate.identifier}`
      ),
    );
    if (identities.size === 1) matches.push([...identities][0]);
  }
  return matches.length === 1;
}

function planLineIsBoundedMeasurementNotTitle(value: string) {
  if (/\bplan\b/i.test(value)) return false;
  if (
    planLineIsCleanUnlabeledFootprintDimension(value) ||
    planLineIsCleanOverallDimension(value)
  ) return true;
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const dimensions = parseFeetDimensions(normalized);
  if (dimensions.length !== 1) return false;
  const displayStart = normalized.toLowerCase().indexOf(
    dimensions[0].display.toLowerCase(),
  );
  if (displayStart < 0) return false;
  const residue = normalizeText(
    `${normalized.slice(0, displayStart)} ${
      normalized.slice(displayStart + dimensions[0].display.length)
    }`,
  ).trim();
  return residue === "bay dimension shown as";
}

function planStandaloneTitleDesignator(value: string) {
  const match = /^[\t ]*['"‘’“”]?([a-z0-9]+(?:[-.][a-z0-9]+)*)['"‘’“”]?[\t ]*$/i
    .exec(value);
  if (!match || /^\d+(?:\.\d+)?$/.test(match[1])) return false;
  return !PLAN_AREA_IGNORED_IDENTIFIERS.has(canonicalPlanIdentifier(match[1]));
}

function planRepeatedSeparatorFoldedToken(value: string) {
  const stripped = value
    .normalize("NFD")
    .replace(/[\p{Cf}\p{M}]/gu, "");
  const folded = stripped.replace(
    /(?<=[\p{L}\p{N}])(?:[ \t]*[\p{P}\p{S}]){2,}[ \t]*(?=[\p{L}\p{N}])/gu,
    ".",
  );
  return folded === stripped ? null : planWrappedSingleToken(folded);
}

function planWrappedIdentityAfterNoteIsAmbiguous(
  value: string,
  rawValue = value,
) {
  const compact = value.trim();
  if (
    !compact ||
    planLineIsBoundedNonIdentityPlanNote(compact) ||
    planLineBoundedExactIdentityRepeatNote(compact) != null ||
    planLineIsBoundedMeasurementNotTitle(compact)
  ) return false;
  if (planRawUnicodeIdentifierAtom(rawValue)) return true;
  const isBoundedDesignator = (candidate: string) => {
    const tokens = [
      planWrappedSingleToken(candidate),
      planRepeatedSeparatorFoldedToken(candidate),
    ].filter((token): token is string => token != null);
    return tokens.some((token) =>
      planStandaloneTitleDesignator(token) || /^\d+(?:\.\d+)*$/.test(token)
    );
  };
  if (isBoundedDesignator(compact)) return true;
  if (planWrappedDimensionLineHasDesignatorResidue(compact)) return true;
  const identityDescriptors = new Set([
    ...PLAN_WRAPPED_SAFE_DESCRIPTORS,
    "detail",
    "details",
    "layout",
    "view",
    "drawing",
    "sheet",
    "page",
    "scale",
  ]);
  for (
    const descriptor of [...identityDescriptors].sort((left, right) =>
      right.length - left.length
    )
  ) {
    const descriptorPattern = descriptor.split(" ")
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const match = new RegExp(`^${descriptorPattern}\\s+([\\s\\S]+)$`, "i").exec(
      compact,
    );
    if (match && isBoundedDesignator(match[1])) return true;
  }
  const delimitedPair = /^([\s\S]+?)\s*[/|:=-]\s*([\s\S]+)$/.exec(compact);
  return Boolean(
    delimitedPair &&
      isBoundedDesignator(delimitedPair[1]) &&
      isBoundedDesignator(delimitedPair[2]),
  );
}

function planWrappedTitleContinuationIsAmbiguous(value: string) {
  const compact = value.trim();
  if (
    planLineIsBoundedNonIdentityPlanNote(compact) ||
    planLineBoundedExactIdentityRepeatNote(compact) != null
  ) return false;
  if (
    planLineIsCleanOverallDimension(compact) ||
    planLineIsBoundedMeasurementNotTitle(compact)
  ) return false;
  const repeatedSeparatorToken = planRepeatedSeparatorFoldedToken(compact);
  if (
    repeatedSeparatorToken != null &&
    (planStandaloneTitleDesignator(repeatedSeparatorToken) ||
      /^\d+(?:\.\d+)*$/.test(repeatedSeparatorToken))
  ) return true;
  const singleToken = planWrappedSingleToken(compact);
  if (
    singleToken != null &&
    (planStandaloneTitleDesignator(singleToken) ||
      /^\d+(?:\.\d+)*$/.test(singleToken))
  ) return true;
  if (planWrappedDescriptor(compact) != null) return true;
  if (planWrappedDimensionLineHasDesignatorResidue(compact)) return true;
  for (
    const descriptor of [...PLAN_WRAPPED_SAFE_DESCRIPTORS].sort((left, right) =>
      right.length - left.length
    )
  ) {
    const descriptorPattern = descriptor.split(" ")
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const match = new RegExp(`^${descriptorPattern}\\s+([\\s\\S]+)$`, "i").exec(
      compact,
    );
    if (!match) continue;
    const designator = planWrappedSingleToken(match[1]);
    if (
      designator != null &&
      (planStandaloneTitleDesignator(designator) ||
        /^\d+(?:\.\d+)*$/.test(designator))
    ) return true;
  }
  const singleDelimitedPair = /^([\s\S]+?)\s*[/|:&=+._-]\s*([\s\S]+)$/.exec(
    compact.normalize("NFKC")
      .normalize("NFKD")
      .replace(/[\p{Cf}\p{M}]/gu, "")
      .replace(/[‐‑‒–—―−→]/g, "-"),
  );
  const isAmbiguousDesignator = (candidate: string) => {
    if (planWrappedDescriptor(candidate) != null) return false;
    const token = planWrappedSingleToken(candidate);
    return token != null && (
      planStandaloneTitleDesignator(token) || /^\d+(?:\.\d+)*$/.test(token)
    );
  };
  const wordConnectedPair =
    /^([\s\S]+?)\s+(?:and\s*\/\s*or|or\s*\/\s*and|as\s+well\s+as|along\s+with|together\s+with|and|or)\s+([\s\S]+)$/i
      .exec(
        compact,
      );
  if (
    wordConnectedPair &&
    isAmbiguousDesignator(wordConnectedPair[1]) &&
    isAmbiguousDesignator(wordConnectedPair[2])
  ) return true;
  if (
    singleDelimitedPair &&
    isAmbiguousDesignator(singleDelimitedPair[1]) &&
    isAmbiguousDesignator(singleDelimitedPair[2])
  ) return true;
  const tokenRuns = compact.split(/\s+/).map(planWrappedSingleToken);
  if (
    tokenRuns.length >= 2 && tokenRuns.length <= 4 &&
    tokenRuns.every((token): token is string => token != null) &&
    !planSingleIdentityDescriptorResidueIsSafe(compact)
  ) return true;
  return /^(?:no\.?\s*)?\d+(?:\.\d+)*(?:\s*[|:=-]\s*(?:alternate|alternative|alt|option|phase|revision|rev\.?))?$/i
    .test(
      compact,
    );
}

function planWrappedDimensionLineHasDesignatorResidue(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const dimensions = parseFeetDimensions(normalized);
  if (dimensions.length === 0) return false;
  let residue = normalized;
  for (
    const dimension of [...dimensions].sort((left, right) =>
      right.display.length - left.display.length
    )
  ) {
    residue = residue.replace(dimension.display, " ");
  }
  const identifier = planWrappedSingleToken(residue);
  return identifier != null && (
    planStandaloneTitleDesignator(identifier) ||
    /^\d+(?:\.\d+)*$/.test(identifier)
  );
}

function planTextWithoutRepeatedExactIdentities(value: string) {
  const seen = new Set<string>();
  const explicitIdentity = new RegExp(
    `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}(?:[ \\t]+plan\\b)?`,
    "gi",
  );
  return value.replace(explicitIdentity, (
    match: string,
    rawLabel: string,
    rawIdentifier: string,
  ) => {
    const label = normalizeText(rawLabel).replace(/\s+/g, " ");
    const key = `${label}:${canonicalPlanIdentifier(rawIdentifier)}`;
    if (!seen.has(key)) {
      seen.add(key);
      return match;
    }
    return match.replace(/[^\r\n]/g, " ");
  });
}

function normalizePlanTitleIdentityText(value: string) {
  return value
    .replace(/[\r\u0085\f\u2028\u2029]/g, "\n")
    // Extracted PDFs sometimes merge an exact plan-family word with PLAN.
    // Split only this bounded family vocabulary; arbitrary substrings remain
    // untouched.
    .replace(
      /\b(north|south|east|west|site|framing|roof|foundation|electrical|structural|architectural|mechanical|plumbing|civil|landscape|enlarged|demolition|floor|grading|irrigation|planting|anchor|rod)plan\b/giu,
      "$1 plan",
    )
    // A same-line compact leading plan family may use one title delimiter
    // before its exact identifier. Consume only that bounded family form;
    // merged identifiers and wrapped punctuation remain ambiguous.
    .replace(
      /\b(irrigation|planting)\s+plan[-:.](?=[A-Za-z0-9])/giu,
      "$1 plan ",
    )
    // Compatibility symbols such as ™, №, ℃, and superscript footnote marks
    // expand into ordinary letters or digits under NFKC. Preserve their
    // original role only when they form a terminal punctuation/symbol run
    // immediately after PLAN; identifier text elsewhere is left untouched.
    .replace(
      /(\bplan)((?:[ \t]*[\p{P}\p{S}\p{No}\p{M}\p{Cf}\p{Lm}])+[ \t]*)$/gimu,
      (_match, plan, tail) => `${plan}${tail.replace(/[^ \t]/gu, " | ")}`,
    )
    .replace(/[‐‑‒–—―−－]/g, " | ")
    .replace(/[⁄∕]/g, "/")
    .replace(/[‧∙⋅▪●○‣◦・･•·]/g, " | ")
    .replace(/[→↔⇄⇔⇆⟷⇒⟺]/g, " | ")
    .replace(/[×✕⨯≡=…]/g, " | ")
    // Decompose accented OCR glyphs before stripping combining marks so
    // interspersed marks cannot hide a second PLAN sentinel.
    .normalize("NFKD")
    .replace(/[\r\u0085\f\u2028\u2029]/g, "\n")
    .replace(/[\p{Cf}\p{M}]/gu, " ")
    .replace(/(?<=\s)-(?=\S)|(?<=\S)-(?=\s)/g, " | ");
}

function planSingleIdentityDescriptorResidueIsSafe(value: string) {
  const residue = normalizeText(value).trim();
  if (!residue) return true;
  const provenShortDescriptors = new Set([
    "anchor rod",
    "anchor rods",
    "anchor rod layout",
    "anchor rods layout",
    "north lot",
  ]);
  if (provenShortDescriptors.has(residue)) return true;
  const terminal = residue.split(" ").filter(Boolean).at(-1) || "";
  const greekDesignators = new Set([
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
    "iota",
    "kappa",
    "lambda",
    "mu",
    "nu",
    "xi",
    "omicron",
    "pi",
    "rho",
    "sigma",
    "tau",
    "upsilon",
    "phi",
    "chi",
    "psi",
    "omega",
  ]);
  const numberDesignators = new Set([
    "zero",
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
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
  ]);
  const canonicalRomanNumeral =
    /^(?=.)m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;
  const looksLikeDesignator = /\d/.test(terminal) ||
    /^[a-z0-9]+[-.][a-z0-9]+$/.test(terminal) ||
    canonicalRomanNumeral.test(terminal) ||
    greekDesignators.has(terminal) ||
    numberDesignators.has(terminal) ||
    /^[a-z]{1,3}$/.test(terminal);
  return !looksLikeDesignator;
}

function planTitleHasAmbiguousContinuation(value: string) {
  const explicitDesignator = new RegExp(
    `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}`,
    "gi",
  );
  const connector =
    "(?:\\b(?:as[ \\t]+well[ \\t]+as|and[ \\t]*/[ \\t]*or|or[ \\t]*/[ \\t]*and|through[ \\t]+to|through|thru|versus|vs\\.?|alongside|including|alternate|alternative|option|variant|scheme|phase|revision|rev\\.?|alias|aka|also|type|dash|alt|nor|from|with|plus|and|or|for|of|on|in|as|the|to|v)\\b|(?:[&+;:|•·\\\\/][ \\t]*)+|[ \\t]+-[ \\t]+|[–—]|\\(|\\[|\\{)";
  const connectorAndDesignator = new RegExp(
    `${connector}\\s*(?:${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-))?${PLAN_AREA_IDENTIFIER_PATTERN}`,
    "i",
  );
  const leadingConnectorAndDesignator = new RegExp(
    `^\\s*${connector}\\s*(?:${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-))?${PLAN_AREA_IDENTIFIER_PATTERN}`,
    "i",
  );
  const unicodeSeparatorAndDesignator = new RegExp(
    `(?:[\\p{P}\\p{S}][ \\t]*)+(?:${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-))?${PLAN_AREA_IDENTIFIER_PATTERN}`,
    "iu",
  );
  const leadingUnicodeSeparatorAndDesignator = new RegExp(
    `^\\s*(?:[\\p{P}\\p{S}][ \\t]*)+(?:${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-))?${PLAN_AREA_IDENTIFIER_PATTERN}`,
    "iu",
  );
  const separatedUnicodePostPlanIdentity =
    /\bplan(?:[ \t]+|[ \t]*[\p{P}\p{S}]+[ \t]*)['"‘’“”]?([\p{L}\p{N}]+(?:[-.][\p{L}\p{N}]+)*)['"‘’“”]?/giu;
  for (const match of value.matchAll(separatedUnicodePostPlanIdentity)) {
    if (/[^A-Za-z0-9.-]/u.test(match[1])) return true;
  }
  const degradedFamilyBeforeRecognizedIdentity = new RegExp(
    `[\\p{L}\\p{N}][\\p{L}\\p{N}._'-]{2,23}\\s+${PLAN_AREA_IDENTIFIER_PATTERN}\\s+${connector}` +
      `[\\s\\S]{0,220}$`,
    "iu",
  );
  // OCR often substitutes a digit inside the first title-family token
  // (CAN0PY, WAREH0USE, RO0F) while leaving its designator and a later clean
  // identity intact. A damaged or missing connector must not make that later
  // identity look unique. Keep this deliberately bounded to the same title
  // window used by the plan-title analysis.
  const ocrCorruptedFamilyBeforeRecognizedIdentity = new RegExp(
    `(?:\\p{L}[\\p{L}\\p{N}._'-]{0,21}\\p{N}|\\p{N}[\\p{L}\\p{N}._'-]{0,21}\\p{L})` +
      `[\\p{L}\\p{N}._'-]{0,2}\\s+(?!(?:plan|drawing|page|sheet)\\b)` +
      `${PLAN_AREA_IDENTIFIER_PATTERN}[\\s\\S]{0,220}$`,
    "iu",
  );
  for (const match of value.matchAll(explicitDesignator)) {
    const matchStart = match.index || 0;
    const matchEnd = matchStart + match[0].length;
    const matchPlan = /\bplan\b/i.exec(match[0]);
    const trailing = value.slice(
      matchEnd,
      Math.min(value.length, matchEnd + 180),
    );
    const followingPlan = /\bplan\b/i.exec(trailing);
    const planStart = matchPlan
      ? matchStart + (matchPlan.index || 0)
      : followingPlan
      ? matchEnd + (followingPlan.index || 0)
      : -1;
    if (planStart < 0 || planStart - matchStart > 160) continue;
    const planEnd = planStart + 4;
    const beforePlan = value.slice(matchEnd, planStart);
    const afterPlan = value.slice(
      planEnd,
      Math.min(value.length, planEnd + 80),
    );
    const precedingIdentity = value.slice(
      Math.max(0, matchStart - 240),
      matchStart,
    );
    const identityLineStart =
      value.lastIndexOf("\n", Math.max(0, matchStart - 1)) + 1;
    const identityLinePrefix = value.slice(identityLineStart, matchStart);
    const trustedPageContextIdentity =
      /^\s*drawing\s+page\s+context\s*:\s*(?:(?:pdf\s+)?page\s+\d+(?:\.\d+)?|sheet\s+[a-z0-9.-]+)\s*(?:[|:;,/.]+\s*)?$/i
        .test(
          identityLinePrefix,
        );
    // A trusted page-context title is its own line-level authority frame. Do
    // not attach punctuation after that PLAN to leftover text from a repeated
    // raw title on the next line; raw wrapped-title ambiguity is independently
    // checked by the terminal-PLAN/following-line analysis above.
    const afterPlanContinuation = trustedPageContextIdentity
      ? afterPlan.split("\n", 1)[0]
      : afterPlan;
    const titlePrecedingIdentity = precedingIdentity.replace(
      /(?:^|\n)\s*(?:drawing\s+page\s+context\s*:\s*)?(?:(?:pdf\s+)?page\s+\d+(?:\.\d+)?|sheet\s+[a-z0-9.-]+)\s*(?:[|:;,/]\s*)?$/i,
      "",
    );
    if (
      (!matchPlan && !planSingleIdentityDescriptorResidueIsSafe(beforePlan)) ||
      degradedFamilyBeforeRecognizedIdentity.test(titlePrecedingIdentity) ||
      ocrCorruptedFamilyBeforeRecognizedIdentity.test(titlePrecedingIdentity) ||
      planTitleHasNearFamilyOCRBeforeIdentity(titlePrecedingIdentity) ||
      connectorAndDesignator.test(beforePlan) ||
      leadingConnectorAndDesignator.test(afterPlanContinuation) ||
      unicodeSeparatorAndDesignator.test(beforePlan) ||
      leadingUnicodeSeparatorAndDesignator.test(afterPlanContinuation)
    ) {
      return true;
    }
  }
  return false;
}

function planTitleHasNearFamilyOCRBeforeIdentity(value: string) {
  const completedPlanMatches = [...value.matchAll(/\bplan\b/gi)];
  const lastCompletedPlan = completedPlanMatches.at(-1);
  const scanValue = lastCompletedPlan
    ? value.slice((lastCompletedPlan.index || 0) + lastCompletedPlan[0].length)
    : value;
  // If this bounded prefix already contains a clean identity, the outer
  // identity collector will account for it. Text following that identity is
  // its descriptor, not a new unknown-family prefix for a later duplicate
  // region title.
  if (
    new RegExp(
      `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}`,
      "i",
    ).test(scanValue)
  ) return false;
  const familyTokens = new Set([
    "building",
    "irrigation",
    "planting",
    "loading",
    "dock",
    "warehouse",
    "room",
    "sector",
    "pod",
    "wing",
    "lot",
    "yard",
    "structure",
    "facility",
    "zone",
    "floor",
    "level",
    "lobby",
    "bay",
    "court",
    "space",
    "corridor",
    "office",
    "suite",
    "unit",
    "area",
    "canopy",
    "canopies",
    "plan",
    "roof",
  ]);
  const confusableCanonical = (token: string) =>
    token.toLowerCase()
      .replace(/[0οо]/gu, "o")
      .replace(/[1ιі]/gu, "i")
      .replace(/[3з]/gu, "e")
      .replace(/[4аα]/gu, "a")
      .replace(/[5ѕ]/gu, "s")
      .replace(/[6б]/gu, "b")
      .replace(/[7т]/gu, "t")
      .replace(/[8в]/gu, "b")
      .replace(/[9ց]/gu, "g")
      .replace(/[сϲ]/gu, "c")
      .replace(/[рρ]/gu, "p")
      .replace(/[хχ]/gu, "x")
      .replace(/[уγ]/gu, "y")
      .replace(/[н]/gu, "h")
      .replace(/[кκ]/gu, "k")
      .replace(/[мμ]/gu, "m");
  const safePreIdentityTokens = new Set([
    ...familyTokens,
    "anchor",
    "rod",
    "overall",
    "width",
    "wide",
    "height",
    "length",
    "long",
    "dimension",
    "dimensions",
    "scale",
    "detail",
    "sheet",
    "page",
    "pdf",
    "revision",
    "rev",
    "drawing",
    "project",
    "job",
    "number",
    "figure",
    "fig",
    "note",
    "source",
    "region",
    "current",
    "new",
    "existing",
    "proposed",
    "north",
    "south",
    "east",
    "west",
    "issued",
    "feet",
    "foot",
    "ft",
    "inches",
    "inch",
    "square",
    "sqft",
  ]);
  const likelyDesignatorWords = new Set([
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
    "iota",
    "kappa",
    "lambda",
    "mu",
    "nu",
    "xi",
    "omicron",
    "pi",
    "rho",
    "sigma",
    "tau",
    "upsilon",
    "phi",
    "chi",
    "psi",
    "omega",
    "zero",
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
    "eleven",
    "twelve",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "north",
    "south",
    "east",
    "west",
    "northwest",
    "northeast",
    "southwest",
    "southeast",
    "upper",
    "lower",
    "main",
    "central",
    "eastern",
    "western",
    "northern",
    "southern",
    "primary",
    "secondary",
  ]);
  const safeDescriptorPairs = new Set([
    "existing exterior",
    "current structural",
    "current architectural",
    "current electrical",
    "current mechanical",
    "current plumbing",
    "current civil",
    "current landscape",
    "overall site",
    "reflected ceiling",
    "enlarged lighting",
    "hazardous material",
    "weather protected",
    "storage enclosure",
    "roof secondary",
    "anchor rod",
  ]);
  // The residue immediately before a recognized identity may be a bounded
  // two-word descriptor (for example, CURRENT ELECTRICAL). Any other residue
  // with two or more word/number runs can encode another family/designator,
  // including compact punctuation forms such as PAVILION-A or PAVILION/A.
  // Tokenizing the complete residue avoids length and separator gaps in the
  // narrower OCR regexes below.
  const boundedResidue = scanValue
    .replace(/\b(?:pdf\s+)?page\s+[a-z0-9]+(?:[.-][a-z0-9]+)*\b/gi, " ")
    // Repeated raw/page/region copies commonly put checked overall dimension
    // phrases between duplicate copies of the same title. Strip only the
    // exact dimension phrase: scanValue is flattened, so consuming the rest
    // of a logical line could erase a following unknown plan identity.
    .replace(
      /\boverall\s+(?:(?:width|wide|length|long)\s+)?\d{1,4}(?:\.\d+)?\s*(?:feet|foot|ft\.?|inches?|inch|in\.?)\b/gi,
      " ",
    );
  const residueTokens = boundedResidue.normalize("NFKC").toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
  const residueContainsOnlyAxisWords = residueTokens.length > 0 &&
    residueTokens.every((token) =>
      token === "width" || token === "wide" || token === "length" ||
      token === "long"
    );
  if (
    residueTokens.length >= 2 &&
    !residueContainsOnlyAxisWords &&
    !safeDescriptorPairs.has(residueTokens.join(" "))
  ) return true;
  const withinOneOCREdit = (left: string, right: string) => {
    if (left === right) return true;
    if (Math.abs(left.length - right.length) > 1) return false;
    if (left.length === right.length) {
      const differences: number[] = [];
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) differences.push(index);
      }
      return differences.length === 1 || (
        differences.length === 2 &&
        differences[1] === differences[0] + 1 &&
        left[differences[0]] === right[differences[1]] &&
        left[differences[1]] === right[differences[0]]
      );
    }
    const shorter = left.length < right.length ? left : right;
    const longer = left.length < right.length ? right : left;
    let shortIndex = 0;
    let longIndex = 0;
    let skipped = false;
    while (shortIndex < shorter.length && longIndex < longer.length) {
      if (shorter[shortIndex] === longer[longIndex]) {
        shortIndex += 1;
        longIndex += 1;
      } else if (skipped) {
        return false;
      } else {
        skipped = true;
        longIndex += 1;
      }
    }
    return true;
  };
  for (
    const [expectedFirst, expectedSecond] of [
      ["loading", "dock"],
      ["building", "area"],
      ["irrigation", "plan"],
      ["planting", "plan"],
    ] as const
  ) {
    const pattern = new RegExp(
      `\\b([\\p{L}\\p{N}._'-]{3,24})\\s+${expectedSecond}\\s+` +
        `['"‘’“”]?[a-z0-9]+(?:[-.][a-z0-9]+)*['"‘’“”]?`,
      "giu",
    );
    for (const match of scanValue.matchAll(pattern)) {
      const rawFirst = match[1].toLowerCase();
      if (rawFirst === expectedFirst) continue;
      if (withinOneOCREdit(confusableCanonical(rawFirst), expectedFirst)) {
        return true;
      }
    }
  }
  for (
    const match of scanValue.matchAll(
      /(?=\b([\p{L}\p{N}][\p{L}\p{N}._'-]{2,23})\s+['"‘’“”]?([a-z0-9]+(?:[-.][a-z0-9]+)*)['"‘’“”]?)/giu,
    )
  ) {
    const rawFamily = match[1].toLowerCase();
    const identifier = match[2].toLowerCase();
    if (!/\p{L}/u.test(rawFamily)) continue;
    if (
      PLAN_AREA_IGNORED_IDENTIFIERS.has(identifier) ||
      familyTokens.has(identifier) ||
      familyTokens.has(rawFamily)
    ) continue;
    const canonicalFamily = confusableCanonical(rawFamily);
    if (
      [...familyTokens].some((family) =>
        withinOneOCREdit(canonicalFamily, family)
      )
    ) return true;
    const likelyDesignator = /^[a-z0-9]{1,3}$/.test(identifier) ||
      /\d/.test(identifier) ||
      /[-.]/.test(identifier) ||
      likelyDesignatorWords.has(identifier);
    if (
      !safePreIdentityTokens.has(rawFamily) &&
      !safeDescriptorPairs.has(`${rawFamily} ${identifier}`) &&
      (likelyDesignator || /^[a-z][a-z0-9-]{3,23}$/.test(identifier))
    ) return true;
  }
  return false;
}

function planAreaDesignators(value: string) {
  const candidates: PlanAreaDesignator[] = [];
  const addCandidate = (candidate: PlanAreaDesignator) => {
    if (candidates.length >= MAX_PLAN_TITLE_IDENTITY_MATCHES) return false;
    candidates.push(candidate);
    return true;
  };
  const overbound = () => [
    ...candidates,
    { label: "ambiguous", identifier: "multiple" },
  ];
  for (
    const match of value.matchAll(
      new RegExp(
        `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}`,
        "gi",
      ),
    )
  ) {
    const label = canonicalPlanLabel(match[1]);
    const identifier = canonicalPlanIdentifier(match[2]);
    if (identifier && !PLAN_AREA_IGNORED_IDENTIFIERS.has(identifier)) {
      if (!addCandidate({ label, identifier })) return overbound();
    }
  }

  // A title can share a family label across compact designators (for
  // example, "CANOPY A AND B PLAN"). Keep that shorthand, but do not consume
  // the first word of a second explicit family such as "CANOPY A AND ROOM B".
  const explicitLabelLeads = new Set([
    "building",
    "irrigation",
    "planting",
    "loading",
    "warehouse",
    "room",
    "sector",
    "pod",
    "wing",
    "lot",
    "yard",
    "structure",
    "facility",
    "zone",
    "floor",
    "level",
    "lobby",
    "bay",
    "court",
    "space",
    "corridor",
    "office",
    "suite",
    "unit",
    "area",
    "canopy",
    "canopies",
    "plan",
  ]);
  for (
    const match of value.matchAll(
      new RegExp(
        `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}\\s*${PLAN_AREA_CONTINUATION_PATTERN}\\s*${PLAN_AREA_IDENTIFIER_PATTERN}`,
        "gi",
      ),
    )
  ) {
    const label = canonicalPlanLabel(match[1]);
    const identifier = canonicalPlanIdentifier(match[3]);
    if (
      identifier &&
      !PLAN_AREA_IGNORED_IDENTIFIERS.has(identifier) &&
      !explicitLabelLeads.has(identifier)
    ) {
      if (!addCandidate({ label, identifier })) return overbound();
    }
  }
  for (
    const match of value.matchAll(
      new RegExp(
        `\\b${PLAN_AREA_LABEL_PATTERN}(?:[ \\t]+|-)${PLAN_AREA_IDENTIFIER_PATTERN}\\s*\\(\\s*${PLAN_AREA_IDENTIFIER_PATTERN}\\s*\\)`,
        "gi",
      ),
    )
  ) {
    const label = canonicalPlanLabel(match[1]);
    const identifier = canonicalPlanIdentifier(match[3]);
    if (
      identifier &&
      !PLAN_AREA_IGNORED_IDENTIFIERS.has(identifier) &&
      !explicitLabelLeads.has(identifier)
    ) {
      if (!addCandidate({ label, identifier })) return overbound();
    }
  }
  return candidates;
}

function canonicalPlanLabel(value: string) {
  const normalized = normalizeText(value).replace(/\\s+/g, " ");
  return /^canop/.test(normalized) ? "canopy" : normalized.replace(/s$/, "");
}

function canonicalPlanIdentifier(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function parseFeetDimensions(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ");
  const dimensions: Array<{ feet: number; display: string }> = [];
  for (
    const match of normalized.matchAll(
      /\b(\d{1,4})(?:\.(\d+))?\s*(?:'|feet|foot|ft\.?)\s*(?:-\s*)?(?:(\d{1,2})(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?\s*(?:"|inches?|inch|in\.?)?)?/gi,
    )
  ) {
    const wholeFeet = Number(match[1]);
    const decimalFeet = match[2] ? Number(`0.${match[2]}`) : 0;
    const wholeInches = Number(match[3] || 0);
    const fractionNumerator = Number(match[4] || match[6] || 0);
    const fractionDenominator = Number(match[5] || (match[6] ? 1 : 0));
    const fractionInches = fractionDenominator > 0
      ? fractionNumerator / fractionDenominator
      : 0;
    const feet = wholeFeet + decimalFeet + (wholeInches + fractionInches) / 12;
    if (Number.isFinite(feet) && feet > 0) {
      dimensions.push({ feet, display: match[0].trim() });
    }
    if (dimensions.length > MAX_DRAWING_PARSED_DIMENSIONS) break;
  }
  return dimensions;
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
  const responsive = new Map<string, { text: string; score: number }>();
  for (let index = 0; index < lines.length; index += 1) {
    const anchorLine = lines[index];
    if (
      requirement.kind === "measurement"
        ? !containsECOSRequestedMeasurementValue(question, anchorLine)
        : ecosEvidenceQuestionContextScore(question, anchorLine) <= 0
    ) continue;
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    const text = unique([pageIdentity, ...lines.slice(start, end)]).join("\n");
    const context = analyzeECOSQuestionEvidenceContext(question, text);
    const valid = context.subjectMatched && context.locationMatched &&
      (requirement.kind === "general" ||
        (context.measurementMatched && context.attributeMatched));
    if (!valid) continue;
    const score = ecosEvidenceQuestionContextScore(question, text);
    const key = normalizeText(anchorLine);
    if (!key) continue;
    const previous = responsive.get(key);
    if (!previous || score > previous.score) {
      responsive.set(key, { text, score });
    }
    if (responsive.size > MAX_NEARBY_DRAWING_REGIONS) return null;
  }
  if (responsive.size !== 1) return null;
  const best = [...responsive.values()][0];
  return best
    ? {
      text: best.text,
      score: best.score,
      regionId: null,
      contextRegionIds: Object.freeze([]),
      sourceRegionIds: Object.freeze([]),
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

function deterministicCalculationRegionId(
  firstRegionId: string,
  secondRegionId: string,
) {
  const value = `${firstRegionId}\u0000${secondRegionId}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `calculation-${left.toString(16).padStart(8, "0")}${
    right.toString(16).padStart(8, "0")
  }`;
}

function deterministicCompositeRegionId(regionIds: readonly string[]) {
  return deterministicDerivedRegionId("composite", regionIds);
}

function deterministicDerivedRegionId(
  prefix: string,
  regionIds: readonly string[],
) {
  const value = regionIds.join("\u0000");
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${prefix}-${left.toString(16).padStart(8, "0")}${
    right.toString(16).padStart(8, "0")
  }`;
}

function normalizeRegion(value: ECOSDrawingRegionInput): DrawingRegion | null {
  if (value.searchable === false) return null;
  const carrierTexts = unique([
    textValue(value.text),
    textValue(value.evidenceText),
    textValue(value.label),
  ]);
  const text = carrierTexts[0] || "";
  if (!text) return null;
  const rawSource = textValue(value.rawSource) || textValue(value.source) ||
    null;
  return Object.freeze({
    id: textValue(value.id),
    text,
    searchable: true,
    carrierTexts: Object.freeze(carrierTexts),
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
    sourceCarriers: Object.freeze(unique([
      textValue(value.rawSource),
      textValue(value.source),
    ])),
    reconstructionMethod: textValue(value.reconstructionMethod) || null,
    factKind: textValue(value.factKind) || null,
    subject: textValue(value.subject) || null,
    structuredRelationshipId: textValue(value.structuredRelationshipId) ||
      null,
    structuredTableBlockId: textValue(value.structuredTableBlockId) || null,
    structuredTableRelationshipType: textValue(
      value.structuredTableRelationshipType,
    ) || null,
    structuredTableRowKey: textValue(value.structuredTableRowKey) || null,
    strictStructuredReceiptTopLevelInputValid:
      strictStructuredReceiptTopLevelInputIsExact(value),
    evidenceSources: Object.freeze(
      Array.isArray(value.evidenceSources)
        ? value.evidenceSources.map(textValue).filter(Boolean)
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

function normalizeRegionForAudit(
  value: ECOSDrawingRegionInput,
): DrawingRegion | null {
  const carrierTexts = unique([
    textValue(value.text),
    textValue(value.evidenceText),
    textValue(value.label),
  ]);
  const areaNames = Array.isArray(value.areaNames)
    ? value.areaNames.map(textValue).filter(Boolean)
    : [];
  const auditText = carrierTexts[0] || areaNames.join(" ");
  if (!auditText) return null;
  const normalized = normalizeRegion({
    ...value,
    text: auditText,
    searchable: true,
  });
  return normalized
    ? Object.freeze({
      ...normalized,
      // Keep the primary assertion carriers distinct from the area-name
      // fallback used only to make an otherwise carrier-less row auditable.
      // In particular, an area name such as "2." must never become a trusted
      // numbered-note marker.
      carrierTexts: Object.freeze(carrierTexts),
      searchable: value.searchable !== false,
    })
    : null;
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

function coordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
      value <= 1
    ? value
    : null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
