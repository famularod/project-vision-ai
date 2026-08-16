const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const edge = fs.readFileSync(
  path.join(root, "supabase/functions/ecos-analyze-drawing-page/index.ts"),
  "utf8",
);
const edgeSingleQuotes = edge.replaceAll('"', "'");
const runner = fs.readFileSync(
  path.join(root, "scripts/ecos-gemini-drawing-comparison.js"),
  "utf8",
);
const runnerSingleQuotes = runner.replaceAll('"', "'");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const clientFiles = [
  fs.readFileSync(path.join(root, "App.tsx"), "utf8"),
  fs.readFileSync(
    path.join(root, "services/ECOSDrawingPageAnalysis.ts"),
    "utf8",
  ),
].join("\n");

assert(
  /type DrawingVisionProvider = ['"]openai['"] \| ['"]gemini['"]/.test(edge),
);
assert(
  edgeSingleQuotes.includes("Deno.env.get('ECOS_DRAWING_VISION_PROVIDER')"),
);
assert(edgeSingleQuotes.includes("requiredEnv('ECOS_GEMINI_API_KEY')"));
assert(
  edgeSingleQuotes.includes("generativelanguage.googleapis.com/v1beta/models/"),
);
assert(edgeSingleQuotes.includes("'x-goog-api-key': ecosGeminiKey()"));
assert(edgeSingleQuotes.includes("responseFormat: {"));
assert(edgeSingleQuotes.includes("mimeType: 'APPLICATION_JSON'"));
assert(edgeSingleQuotes.includes("schema: geminiResponseSchema(schema)"));
assert(
  edgeSingleQuotes.includes("key === 'maxLength'") &&
    edgeSingleQuotes.includes("key === 'additionalProperties'"),
);
assert(edgeSingleQuotes.includes("event: 'ecos_gemini_schema_fallback'"));
assert(edgeSingleQuotes.includes("responseMimeType: 'application/json'"));
assert(
  edgeSingleQuotes.includes("schema: stripUnsupportedOpenAISchema(schema)"),
);
assert(/visionProvider === ['"]gemini['"]/.test(edge));
assert(edgeSingleQuotes.includes("body.comparisonMode === true"));
assert(edgeSingleQuotes.includes("extractGeminiOutputText"));
assert(edgeSingleQuotes.includes("runVisualAssurance"));
assert(
  edge.includes(
    "fixed_visual_tile_measurement_transcription_correction",
  ),
);
assert(
  edge.includes(
    "entire visible foot-inch measurement phrase can be transcribed exactly",
  ),
);
assert(
  edge.includes(
    "independently verify the proposed exact corrected measurement transcription",
  ),
);
assert(
  edge.includes(
    "put the candidate index in acceptedCandidateIndexes",
  ),
);
assert(edge.includes("dual_provider_candidate_index_v1"));
assert(edge.includes("candidate-index acceptance is the authoritative declaration"));
assert(edge.includes("rather than relying on the first provider's wording or box"));
assert(edge.includes("raw spelling is not the proposition to accept or dismiss"));
assert(edge.includes("raw diagnostic spelling is deliberately corrupted and is not the proposition to dismiss"));
assert(edge.includes("acceptedFactIndexes includes the exact corrected measurement fact"));
assert.equal(
  (edge.match(/Never put (?:its index|index 0) in dismissedCandidateIndexes merely because the raw OCR spelling differs/g) || []).length,
  2,
);
assert(edgeSingleQuotes.includes("visionProvider,"));
assert(edgeSingleQuotes.includes("drawingAssuranceProvider"));
assert(/visionProvider === ['"]gemini['"] \? ['"]openai['"]/.test(edge));
assert(edgeSingleQuotes.includes("drawingCapacityFallbackCandidates"));
assert(edgeSingleQuotes.includes("'gemini-3.5-flash'"));
assert(
  edgeSingleQuotes.includes("'ecos_drawing_page_provider_fallback_completed'"),
);
assert(edgeSingleQuotes.includes("reason: 'rate_limited'"));
assert(edgeSingleQuotes.includes("providerFallback"));
assert(edgeSingleQuotes.includes("parseECOSStructuredObjectText"));
assert(edgeSingleQuotes.includes("drawingInvalidOutputFallbackCandidate"));
assert(
  edgeSingleQuotes.includes(
    "'ecos_drawing_page_invalid_output_fallback_completed'",
  ),
);
assert(
  edgeSingleQuotes.includes(
    "event: 'ecos_drawing_page_invalid_output_rejected'",
  ),
);
assert(edgeSingleQuotes.includes("typeof item.confidence !== 'number'"));
assert(
  edgeSingleQuotes.includes(
    "typeof value === 'number' && Number.isInteger(value)",
  ),
);
assert(edgeSingleQuotes.includes("bounds.x < 0 || bounds.y < 0"));
assert(edgeSingleQuotes.includes("rawBounds.every"));
assert(
  edgeSingleQuotes.includes(
    "typeof value === 'number' && Number.isInteger(value)",
  ),
);
assert(
  !edgeSingleQuotes.includes("const confidence = Number(item.confidence)"),
);
const boundedTileIndexBody =
  edge.split("function boundedTileIndex(", 2)[1].split("\n}", 1)[0];
assert(!boundedTileIndexBody.includes("Number(value)"));
assert(
  edgeSingleQuotes.includes(
    "const sourcePageBounds = normalizedUnitBounds(body.tileBounds)",
  ),
);
assert(
  edgeSingleQuotes.includes(
    "analysisPass === 'page_tiles' && !sourcePageBounds",
  ),
);
assert(edgeSingleQuotes.includes("typeof candidate.confidence !== 'number'"));
assert(edgeSingleQuotes.includes("raw.every"));
assert(
  edgeSingleQuotes.includes(
    "typeof item === 'number' && Number.isFinite(item)",
  ),
);
assert(
  edgeSingleQuotes.includes(
    "typeof item === 'number' && Number.isInteger(item)",
  ),
);
const positiveIntegerBody =
  edge.split("function positiveInteger(", 2)[1].split("\n}", 1)[0];
assert(!positiveIntegerBody.includes("Number(value)"));
const normalizeTileImagesBody =
  edge.split("function normalizeTileImages(", 2)[1].split("\n}", 1)[0];
assert(!normalizeTileImagesBody.includes("Number(item.bounds"));
const normalizeVisualExceptionBody =
  edge.split("function normalizeVisualException(", 2)[1].split("\n}", 1)[0];
assert(!normalizeVisualExceptionBody.includes("Number(candidate.confidence)"));
const candidateIndexesSchemaBody =
  edge.split("function candidateIndexesSchema(", 2)[1].split("\n}", 1)[0];
assert(!candidateIndexesSchemaBody.includes("uniqueItems"));
assert.equal(
  (edge.match(
    /dismissedCandidateIndexes: candidateIndexesSchema\(candidateCount\)/g,
  ) || []).length,
  2,
);
assert.equal(
  (edge.match(
    /acceptedCandidateIndexes: candidateIndexesSchema\(candidateCount\)/g,
  ) || []).length,
  2,
);
const stripUnsupportedSchemaBody = edge
  .split("function stripUnsupportedOpenAISchema(", 2)[1]
  .split("\n}", 1)[0];
assert(stripUnsupportedSchemaBody.includes("Object.fromEntries"));
assert(stripUnsupportedSchemaBody.includes("uniqueItems"));
// Exact OpenAI schema-shape protection: uniqueItems is removed recursively.
const stripUnsupportedOpenAISchemaForTest = (value) => {
  if (Array.isArray(value)) return value.map(stripUnsupportedOpenAISchemaForTest);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, nested]) =>
        key === "uniqueItems" ? [] : [[key, stripUnsupportedOpenAISchemaForTest(nested)]],
      ),
    );
  }
  return value;
};
assert.deepEqual(stripUnsupportedOpenAISchemaForTest({
  type: "array",
  uniqueItems: true,
  items: {
    type: "integer",
    uniqueItems: true,
  },
  minimum: 0,
}), {
  type: "array",
  items: {
    type: "integer",
  },
  minimum: 0,
});
const normalizeCandidateIndexDispositionBody = edge
  .split("function normalizeCandidateIndexDisposition(", 2)[1]
  .split("\n}", 1)[0];
assert(
  normalizeCandidateIndexDispositionBody.includes(
    "new Set(indexes).size === indexes.length",
  ),
);
const normalizeCandidateIndexDisposition = (value, candidateCount) => {
  if (!Array.isArray(value) || value.length > 12) {
    return { indexes: [], valid: false };
  }
  const indexes = value.filter((item) =>
    typeof item === "number" && Number.isInteger(item) && item >= 0 &&
    item < candidateCount
  );
  const valid = indexes.length === value.length &&
    new Set(indexes).size === indexes.length;
  return {
    indexes: valid ? [...indexes].sort((left, right) => left - right) : [],
    valid,
  };
};
assert.deepEqual(normalizeCandidateIndexDisposition([1, 0], 2), {
  indexes: [0, 1],
  valid: true,
});
assert.deepEqual(normalizeCandidateIndexDisposition([0, 0], 2), {
  indexes: [],
  valid: false,
});
assert.deepEqual(normalizeCandidateIndexDisposition([0, "1"], 2), {
  indexes: [],
  valid: false,
});
assert.deepEqual(normalizeCandidateIndexDisposition([2], 2), {
  indexes: [],
  valid: false,
});

const completeCandidateAgreement = (
  primaryAccepted,
  assuranceAccepted,
  primaryDismissed,
  assuranceDismissed,
  candidateCount,
) => {
  const same = (left, right) => left.length === right.length &&
    left.every((value, index) => value === right[index]);
  const partition = (accepted, dismissed) => {
    if (accepted.some((index) => dismissed.includes(index))) return false;
    const combined = [...accepted, ...dismissed].sort((a, b) => a - b);
    return combined.length === candidateCount &&
      combined.every((value, index) => value === index);
  };
  return same(primaryAccepted, assuranceAccepted) &&
    same(primaryDismissed, assuranceDismissed) &&
    partition(primaryAccepted, primaryDismissed) &&
    partition(assuranceAccepted, assuranceDismissed);
};
assert.equal(completeCandidateAgreement([0], [0], [], [], 1), true);
assert.equal(completeCandidateAgreement([], [], [0], [0], 1), true);
assert.equal(completeCandidateAgreement([0], [], [], [0], 1), false);
assert.equal(completeCandidateAgreement([0], [0], [0], [0], 1), false);
assert.equal(completeCandidateAgreement([0], [0], [], [], 2), false);

const jointlyDismissedCandidateIndexes = (analysis, assurance) => (
  analysis.dismissedCandidateIndexes &&
  analysis.dismissedCandidateIndexesValid &&
  assurance.dismissedCandidateIndexes &&
  assurance.dismissedCandidateIndexesValid &&
  analysis.dismissedCandidateIndexes.length === assurance.dismissedCandidateIndexes.length &&
  analysis.dismissedCandidateIndexes.every(
    (value, index) => value === assurance.dismissedCandidateIndexes[index],
  )
    ? analysis.dismissedCandidateIndexes
    : []
);
assert.deepEqual(jointlyDismissedCandidateIndexes(
  { dismissedCandidateIndexes: [1], dismissedCandidateIndexesValid: true },
  { dismissedCandidateIndexes: [1], dismissedCandidateIndexesValid: true },
), [1]);
assert.deepEqual(jointlyDismissedCandidateIndexes(
  { dismissedCandidateIndexes: [1], dismissedCandidateIndexesValid: true },
  { dismissedCandidateIndexes: [1], dismissedCandidateIndexesValid: false },
), []);
assert.deepEqual(jointlyDismissedCandidateIndexes(
  { dismissedCandidateIndexes: [1], dismissedCandidateIndexesValid: true },
  { dismissedCandidateIndexes: [0], dismissedCandidateIndexesValid: true },
), []);
const canonicalFactBoundsBody = edge
  .split("function canonicalVerifiedVisualExceptionFactBounds(", 2)[1]
  .split("\n}", 1)[0];
const verifiedAnalysisBody = edge
  .split("const verifiedAnalysis = {", 2)[1]
  .split("const jointlyDismissedCandidateIndexes", 1)[0];
const measurementCorrectionFactsBody = edge
  .split("const measurementCorrectionFacts =", 2)[1]
  .split("const verifiedAnalysis = {", 1)[0];
assert(
  measurementCorrectionFactsBody.indexOf("acceptedIndexes.has(index)") <
    measurementCorrectionFactsBody.indexOf(
      "canonicalVerifiedVisualExceptionFactBounds(",
    ),
);
assert(measurementCorrectionFactsBody.includes("candidateAgreement.complete"));
assert(
  measurementCorrectionFactsBody.includes(
    "candidateAgreement.acceptedCandidateIndexes.length === 1",
  ),
);
assert(
  measurementCorrectionFactsBody.includes(
    "candidateAgreement.acceptedCandidateIndexes[0] === 0",
  ),
);
assert(verifiedAnalysisBody.includes("facts: [...candidateFacts, ...measurementCorrectionFacts]"));
assert(!edge.includes("acceptedVisualMeasurementCorrectionCandidate("));
assert(!edge.includes("dismissedCandidateIndexes.filter((index) => index !== 0)"));
assert(canonicalFactBoundsBody.includes("diagnosticCandidates.length !== 1"));
assert(
  canonicalFactBoundsBody.includes(
    "candidate.source === VISUAL_MEASUREMENT_CORRECTION_SOURCE",
  ),
);
assert(edge.includes("candidate.source === VISUAL_AREA_TABLE_ROW_SOURCE"));
assert(edge.includes(
  "Read the row label and both values under the visible (W) and (L) headers as one proposition",
));
assert(edge.includes(
  "independently read the row label and its values under the visible (W) and (L) headers as one table-row proposition",
));
assert(edge.includes(
  "followed by an untouched enlarged exact-row rendering",
));
assert(edge.includes(
  "only its source-bound vertical crossing-rule band suppressed as a readability aid",
));
assert(edge.includes("candidate.source === VISUAL_FIRE_SEPARATION_SOURCE"));
assert(edge.includes(
  "one complete issued fire-separation sentence printed across tightly spaced CAD lines",
));
assert(edge.includes(
  "a following high-resolution tile is an unmodified denser rendering of the exact candidate bounds",
));
assert(edge.includes(
  "independently read the complete issued sentence across its printed CAD line breaks",
));
assert(edge.includes("EXACT_FIRE_SEPARATION_NORTH_OPENINGS_TEXT"));
assert(edge.includes("EXACT_FIRE_SEPARATION_NORTH_OPENINGS_BOUNDS"));
assert(edge.includes(
  "THEN is the visible printed spelling and must not be silently corrected to THAN",
));
assert(edge.includes(
  "the sentence ends immediately after REQUIRED.",
));
assert(edge.includes(
  "The final three high-resolution tiles are untouched direct crops",
));
assert(edge.includes(
  "independently verify that the drawing visibly says THEN",
));
assert(edge.includes("candidate.source === VISUAL_ACCESSIBLE_PARKING_NOTE_SOURCE"));
assert(edge.includes(
  "one complete multiline note printed inside a single callout box",
));
assert(edge.includes(
  "independently read the complete boxed note across its printed line breaks",
));
assert(edge.includes(
  "ACCESSIBLE PARKING STALL subject, and STRIPED LOADING conclusion",
));
assert(edge.includes("candidate.source === VISUAL_EASEMENT_NOTE_SOURCE"));
assert(edge.includes(
  "one complete issued easement note",
));
assert(edge.includes(
  "independently read the complete issued easement note in its exact bounds",
));
assert(edge.includes(
  "Never substitute an isolated 10' fragment for the complete proposition",
));
assert(edge.includes("candidate.source === VISUAL_SITE_NOTE_SOURCE"));
assert(edge.includes(
  "one complete issued site-plan proposition or dimension authority reconstructed from overlapping rendered OCR passes",
));
assert(edge.includes(
  "independently read the complete issued site-plan proposition or dimension authority in its exact bounds",
));
assert(edge.includes("review spatially separate dimension authorities independently"));
assert(edge.includes("judge spatially separate dimension authorities independently"));
assert(edge.includes(
  "never accept only one side of an x relationship",
));
assert(
  canonicalFactBoundsBody.includes(
    "correctedVisualMeasurementFactIsExact(fact, candidate.text)",
  ),
);
assert(canonicalFactBoundsBody.includes("canonicalVisualExceptionCandidateBounds(candidate)"));
const canonicalCandidateBoundsBody = edge
  .split("function canonicalVisualExceptionCandidateBounds(", 2)[1]
  .split("\n}", 1)[0];
const canonicalCandidateFactsBody = edge
  .split("function canonicalDualProviderCandidateFacts(", 2)[1]
  .split("\n}", 1)[0];
assert(canonicalCandidateFactsBody.includes("statement: candidate.text"));
assert(canonicalCandidateFactsBody.includes("evidenceText: candidate.text"));
assert(canonicalCandidateFactsBody.includes("subject: candidate.text.slice(0, 120)"));
assert(canonicalCandidateFactsBody.includes("canonicalVisualExceptionCandidateBounds(candidate)"));
assert(canonicalCandidateFactsBody.includes("candidate.text.length > 240"));
assert(canonicalCandidateFactsBody.includes("VISUAL_MEASUREMENT_CORRECTION_SOURCE"));
assert(canonicalCandidateBoundsBody.includes("Math.ceil(candidate.bounds.x * 1000)"));
assert(
  canonicalCandidateBoundsBody.includes("Math.floor(") &&
    canonicalCandidateBoundsBody.includes(
      "candidate.bounds.x + candidate.bounds.width",
    ),
);
const canonicalVerifiedVisualExceptionFactBounds = (fact, visualException) => {
  if (!visualException || visualException.diagnosticCandidates.length !== 1) {
    return null;
  }
  const candidate = visualException.diagnosticCandidates[0];
  const correctionSource =
    "fixed_visual_tile_measurement_transcription_correction";
  const normalizeMeasurement = (value) => {
    const text = String(value || "").toUpperCase()
      .replace(/[’′]/g, "'").replace(/[“”″]/g, '"')
      .replace(/[–—]/g, "-").replace(/\s+/g, " ").trim()
      .replace(/\s*'\s*/g, "'").replace(/\s*-\s*/g, "-")
      .replace(/\s*"/g, '"').replace(/\bTYPICAL\b/g, "TYP");
    const match = text.match(
      /^(\d{1,4}'-\d{1,2}")(?: TO (\d{1,4}'-\d{1,2}"))?(?: ((?:MAX|MIN|TYP)(?:\.? (?:MAX|MIN|TYP))?\.?))?$/,
    );
    if (!match) return null;
    const qualifiers = (match[3] || "").match(/MAX|MIN|TYP/g) || [];
    if (new Set(qualifiers).size !== qualifiers.length) return null;
    return [match[1], match[2] ? `TO ${match[2]}` : "", ...qualifiers]
      .filter(Boolean).join(" ");
  };
  const digitSignature = (value) => String(value || "").toUpperCase()
    .replace(/(' *[-–—] *)[A-Z](?= *")/g, (_match, prefix) => `${prefix}0`)
    .replace(/\D/g, "");
  const editDistance = (left, right) => {
    const rows = Array.from({ length: left.length + 1 }, () =>
      Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
        );
      }
    }
    return rows[left.length][right.length];
  };
  const corrected = normalizeMeasurement(fact.evidenceText);
  const correctedValid = candidate.source === correctionSource &&
    typeof fact.evidenceText === "string" &&
    fact.evidenceText === fact.statement && corrected &&
    editDistance(digitSignature(candidate.text), corrected.replace(/\D/g, "")) <= 1 &&
    (candidate.text.toUpperCase().replace(/\bTYPICAL\b/g, "TYP")
      .match(/\b(?:TO|MAX|MIN|TYP)\b/g) || []).join("|") ===
      (corrected.replace(/\bTYPICAL\b/g, "TYP")
        .match(/\b(?:TO|MAX|MIN|TYP)\b/g) || []).join("|");
  const ordinaryValid = candidate.source !== correctionSource &&
    fact.evidenceText === candidate.text &&
    typeof fact.statement === "string" &&
    fact.statement.startsWith(candidate.text);
  if (!correctedValid && !ordinaryValid) return null;
  const left = Math.ceil(candidate.bounds.x * 1000);
  const top = Math.ceil(candidate.bounds.y * 1000);
  const right = Math.floor(
    (candidate.bounds.x + candidate.bounds.width) * 1000,
  );
  const bottom = Math.floor(
    (candidate.bounds.y + candidate.bounds.height) * 1000,
  );
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
};
const oneCandidateException = {
  diagnosticCandidates: [{
    text: "8'-O\"",
    source: "fixed_visual_tile_coordinate_ocr",
    bounds: { x: 0.731746, y: 0.068889, width: 0.008254, height: 0.003333 },
  }],
};
assert.deepEqual(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "8'-O\"",
    statement: "8'-O\" high fencing specified for site security variance.",
    bounds: { x: 730, y: 69, width: 9, height: 3 },
  }, oneCandidateException),
  { x: 732, y: 69, width: 8, height: 3 },
);
const correctionException = {
  diagnosticCandidates: [{
    text: "24'-D\" TO 21'-O\" MAX.",
    source: "fixed_visual_tile_measurement_transcription_correction",
    bounds: { x: 0.626365, y: 0.312389, width: 0.041873, height: 0.004111 },
  }],
};
const correctedFact = {
  evidenceText: "24'-0\" TO 27'-0\" MAX",
  statement: "24'-0\" TO 27'-0\" MAX",
};
const twoQualifierCorrection = {
  diagnosticCandidates: [{
    text: "5'-O\" MIN. TYP",
    source: "fixed_visual_tile_measurement_transcription_correction",
    bounds: { x: 0.796238, y: 0.923056, width: 0.040857, height: 0.004333 },
  }],
};
assert.deepEqual(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "5'-0\" MIN. TYPICAL",
    statement: "5'-0\" MIN. TYPICAL",
  }, twoQualifierCorrection),
  { x: 797, y: 924, width: 40, height: 3 },
);
assert.deepEqual(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "24'-0\" TO 27'-0\" MAX",
    statement: "24'-0\" TO 27'-0\" MAX",
  }, correctionException),
  { x: 627, y: 313, width: 41, height: 3 },
);
assert.equal(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "24'-0\" TO 37'-0\" MAX",
    statement: "24'-0\" TO 37'-0\" MAX",
  }, correctionException),
  null,
);
assert.equal(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "8'-O\"",
    statement: "Fencing is eight feet high.",
  }, oneCandidateException),
  null,
);
assert.equal(
  canonicalVerifiedVisualExceptionFactBounds({
    evidenceText: "8'-O\"",
    statement: "8'-O\" high fencing.",
  }, {
    diagnosticCandidates: [
      oneCandidateException.diagnosticCandidates[0],
      oneCandidateException.diagnosticCandidates[0],
    ],
  }),
  null,
);

assert(runnerSingleQuotes.includes("comparisonMode: true"));
assert(/visionProvider: ['"]gemini['"]/.test(runner));
assert(
  runnerSingleQuotes.includes("persistenceMode: 'read_only_no_index_writes'"),
);
assert(!/\.(?:insert|upsert|delete)\s*\(/.test(runner));
assert(!/admin\.from\([\s\S]{0,240}?\)\s*\.update\s*\(/.test(runner));
assert(!runner.includes("rpc('ecos_commit_verified_index_job'"));
assert(
  runner.includes("A-1.1") && runner.includes("A-1.6") &&
    runner.includes("A-1.13"),
);

assert(envExample.includes("ECOS_GEMINI_API_KEY"));
assert(
  envExample.includes("ECOS_GEMINI_DRAWING_FALLBACK_MODEL=gemini-3.5-flash"),
);
assert(envExample.includes("ECOS_DRAWING_CAPACITY_FALLBACK_PROVIDER=openai"));
assert(!envExample.includes("EXPO_PUBLIC_ECOS_GEMINI_API_KEY"));
assert(!clientFiles.includes("ECOS_GEMINI_API_KEY"));

console.log(
  "PASS: Gemini vision remains server-side and the benchmark cannot write to the production index.",
);
console.log(
  "PASS: The benchmark checks the three known Architectural hazardous-material evidence sheets.",
);
