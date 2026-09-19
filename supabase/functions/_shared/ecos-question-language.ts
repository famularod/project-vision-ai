/**
 * Question-only normalization for retrieval and intent planning.
 * Stored evidence is never rewritten and this module cannot create facts.
 */
const TOKEN_CORRECTIONS: Readonly<Record<string, string>> = Object.freeze({
  airflw: "airflow",
  asfault: "asphalt",
  ashphalt: "asphalt",
  canapy: "canopy",
  conc: "concrete",
  concreate: "concrete",
  concret: "concrete",
  contianment: "containment",
  controlable: "controllable",
  diamater: "diameter",
  elec: "electrical",
  electical: "electrical",
  exaust: "exhaust",
  flamable: "flammable",
  combustable: "combustible",
  fotting: "footing",
  hight: "height",
  hidrozone: "hydrozone",
  hydrozon: "hydrozone",
  irrigatoin: "irrigation",
  landsc: "landscape",
  landscpe: "landscape",
  laterel: "lateral",
  lenght: "length",
  lites: "lights",
  mech: "mechanical",
  mechancial: "mechanical",
  noth: "north",
  pav: "paving",
  pavemet: "pavement",
  pavment: "pavement",
  pccs: "pcc",
  photmetric: "photometric",
  photmetrics: "photometrics",
  plbg: "plumbing",
  pluming: "plumbing",
  pored: "poured",
  pourred: "poured",
  qty: "quantity",
  reinforcment: "reinforcement",
  schedueld: "scheduled",
  sewar: "sewer",
  struct: "structural",
  structual: "structural",
  teh: "the",
  thik: "thick",
  thikness: "thickness",
  widht: "width",
});

const QUESTION_STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "new",
  "of",
  "on",
  "or",
  "our",
  "please",
  "project",
  "show",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const QUESTION_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object
  .freeze({
    thick: ["thickness", "depth", "dimension", "size"],
    thickness: ["thick", "depth", "dimension", "size"],
    concrete: ["slab", "pcc", "cement", "footing", "foundation"],
    area: ["square feet", "square foot", "sq ft", "sf", "footprint"],
    square: ["area", "footprint"],
    canopy: ["canopy a", "canopy 'a'", "roof plan", "anchor rod plan"],
    lighting: [
      "light",
      "lights",
      "fixture",
      "fixtures",
      "luminaire",
      "luminaires",
      "lighting plan",
    ],
    side: ["lot", "area", "zone"],
    north: ["north lot", "north side"],
    back: ["rear", "north lot"],
    behind: ["back", "rear", "north", "north lot"],
    poured: ["installed", "placed", "constructed", "paving", "pavement"],
    guardrail: [
      "guardrails",
      "handrail",
      "barrier",
      "vehicle barrier",
      "fall protection",
    ],
    parking: ["lot", "garage", "vehicle"],
    required: ["require", "requirement", "shall", "must", "provide", "install"],
    drawing: ["sheet", "detail", "plan", "section", "note"],
    electrical: ["power", "circuit", "panel", "conduit", "wiring"],
    mechanical: ["hvac", "duct", "equipment", "air handling"],
    plumbing: ["pipe", "piping", "drain", "water", "sanitary"],
    infiltration: [
      "underground infiltration",
      "infiltration chamber",
      "uic",
    ],
    chamber: ["chambers", "infiltration chamber", "uic"],
    uic: ["underground infiltration chamber", "infiltration chamber"],
  });

const PHRASE_CORRECTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bnorth[\s-]+lot\b/gi, "north lot"],
  [/\bnorth[\s-]+side\b/gi, "north side"],
  [/\bwhat['’]s\b/gi, "what is"],
  [/\bwhere['’]s\b/gi, "where is"],
  [/\bhow['’]s\b/gi, "how is"],
  [/\bhazardous[\s-]+materials?\b/gi, "hazardous material"],
  [/\bhaz[\s./-]*mat(?:erial)?s?\b/gi, "hazardous material"],
  [/\bp[\s./-]*c[\s./-]*c\b\.?/gi, "pcc"],
  [/\bcement\s+(slab|paving|pavement|pad|walkway)\b/gi, "concrete $1"],
  [/\bsq\.?\s*ft\.?\b/gi, "square feet"],
  [/\bhow many foot[\s-]+candles?\b/gi, "what light levels"],
  [/\bfoot[\s-]+candles?\b/gi, "foot-candles"],
  [/\bweather[\s-]*proof(?:ed|ing)?\b/gi, "weather-protected"],
  [/\bwashrooms?\b/gi, "restrooms"],
  [/\bbathrooms?\b/gi, "restrooms"],
  [/\bback[\s-]+side\b/gi, "rear side"],
  [/\bup[\s-]+north\b/gi, "north lot"],
];

const LEADING_ECOS_GREETING = /^(?:hey|hi)\s+ecos\s*[,.:;-]?\s*/i;

const LEADING_SCAFFOLD = new RegExp(
  String.raw`^(?:(?:hey|hi)\s+ecos\s*[,.:;-]?\s*)?` +
    String.raw`(?:` +
    String.raw`(?:can|could|would|will)\s+you\s+(?:please\s+)?` +
    String
      .raw`(?:tell\s+me|let\s+me\s+know|look\s+up|find\s+out|check|show\s+me|give\s+me)|` +
    String
      .raw`(?:please\s+)?(?:tell\s+me|let\s+me\s+know|look\s+up|find\s+out|check|show\s+me)|` +
    String
      .raw`i(?:'d|\s+would)?\s+like\s+to\s+know|i\s+need\s+to\s+know|do\s+you\s+know` +
    String.raw`)\s+(?:about\s+)?`,
  "i",
);

export function canonicalizeECOSQuestionLanguage(value: string) {
  let normalized = value
    .replace(/\p{Cf}/gu, "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-");
  for (const [pattern, replacement] of PHRASE_CORRECTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized.replace(/[a-z]+/gi, (token) => {
    const replacement = TOKEN_CORRECTIONS[token.toLowerCase()];
    return replacement ? preserveCase(token, replacement) : token;
  });
  return normalized.replace(LEADING_ECOS_GREETING, "")
    .replace(LEADING_SCAFFOLD, "").replace(/\s+/g, " ").trim();
}

export function ecosQuestionRetrievalVariants(value: string) {
  const canonical = canonicalizeECOSQuestionLanguage(value);
  const variants = [
    value.replace(/\s+/g, " ").trim(),
    canonical,
    ...domainRetrievalVariants(canonical),
  ];
  const concreteVariant = canonical.replace(/\bcement\b/gi, "concrete");
  if (concreteVariant !== canonical) variants.push(concreteVariant);
  if (/\bconcrete\b/i.test(concreteVariant)) {
    variants.push(concreteVariant.replace(/\bconcrete\b/gi, "pcc"));
  }
  if (/\bnorth (?:side|area)\b/i.test(canonical)) {
    variants.push(canonical.replace(/\bnorth (?:side|area)\b/gi, "north lot"));
  }
  if (/\b(?:back|rear) lot\b/i.test(canonical)) {
    variants.push(canonical.replace(/\b(?:back|rear) lot\b/gi, "north lot"));
  }
  return Object.freeze(
    [...new Set(variants.filter((item) => item.length >= 3))].slice(0, 6),
  );
}

/**
 * Identifies drawing-navigation questions that require an exact bounded page
 * region, even when they do not request a measurement, quantity, or yes/no
 * presence answer. Keeping these questions on aggregate page text loses the
 * coordinates needed to prove which detail the answer refers to.
 */
export function ecosQuestionRequestsDrawingLocation(value: string) {
  const canonical = canonicalizeECOSQuestionLanguage(value);
  return /\b(?:which|what|where)\b[\s\S]{0,160}\b(?:sheet|page|drawing|plan|detail|section)\b/i
    .test(canonical) ||
    /\b(?:sheet|page|drawing|plan|detail|section)\b[\s\S]{0,160}\b(?:contain|contains|show|shows|send|sends|refer|refers|direct|directs|locate|located)\b/i
      .test(canonical);
}

export function ecosQuestionLexicalQueries(value: string) {
  const plans = ecosQuestionRetrievalVariants(value).map((variant) => {
    const queryTokens = ecosExpandedQuestionTokens(variant);
    const coreTokens = ecosMeaningfulQuestionTokens(variant).slice(0, 10);
    return uniqueQuestionValues([
      coreTokens.slice(0, 8).join(" "),
      variant.replace(/[^a-zA-Z0-9./"'-]+/g, " ").trim(),
      ...coreTokens.flatMap((token) => [
        token,
        ...(QUESTION_SYNONYMS[token] || []).slice(0, 2),
      ]),
      ...queryTokens.slice(0, 8),
    ]).filter((query) => query.length >= 2);
  });
  const interleaved: string[] = [];
  const seen = new Set<string>();
  const maximumDepth = Math.max(0, ...plans.map((plan) => plan.length));
  for (
    let depth = 0;
    depth < maximumDepth && interleaved.length < 20;
    depth += 1
  ) {
    for (const plan of plans) {
      const query = plan[depth];
      const key = query?.toLowerCase();
      if (!query || seen.has(key)) continue;
      seen.add(key);
      interleaved.push(query);
      if (interleaved.length >= 20) break;
    }
  }
  return Object.freeze(interleaved);
}

export function ecosExpandedQuestionTokens(value: string) {
  const base = ecosMeaningfulQuestionTokens(value).slice(0, 12);
  return Object.freeze(
    uniqueQuestionValues(
      base.flatMap((token) => [token, ...(QUESTION_SYNONYMS[token] || [])])
        .map(normalizeQuestionToken)
        .filter(Boolean),
    ).slice(0, 20),
  );
}

export function ecosMeaningfulQuestionTokens(value: string) {
  return Object.freeze(
    uniqueQuestionValues(
      normalizeQuestionToken(value).split(" ").map(stemQuestionToken).filter(
        (token) => token.length >= 2 && !QUESTION_STOP_WORDS.has(token),
      ),
    ),
  );
}

export function ecosQuestionTokenVariants(token: string) {
  const canonical = stemQuestionToken(token);
  const direct = QUESTION_SYNONYMS[canonical] || [];
  const reverse = Object.entries(QUESTION_SYNONYMS).flatMap(([key, values]) =>
    values.some((value) =>
        normalizeQuestionToken(value).split(" ").includes(canonical)
      )
      ? [key, ...values]
      : []
  );
  return Object.freeze(
    uniqueQuestionValues(
      [canonical, ...direct, ...reverse].map(normalizeQuestionToken),
    ),
  );
}

/**
 * Gives retrieval a bounded construction-discipline preference without
 * excluding documents when the question has no clear discipline signal.
 * This inspects document identity only; it cannot create or verify facts.
 */
export function ecosQuestionDocumentAffinity(
  question: string,
  documentDescriptor: string,
) {
  const query = canonicalizeECOSQuestionLanguage(question).toLowerCase();
  const document = normalizeQuestionToken(documentDescriptor).replace(
    /["']/g,
    "",
  );
  const affinities: number[] = [];
  const asksCanopyAFootprint = /\bcanopy\s+a\b/.test(query) &&
    /\b(?:area|size|square|feet|footprint|dimension|big)\b/.test(query);
  const asksCanopyStructure =
    /\b(?:slab|pad|foundation|footing|reinforced)\b/.test(query) &&
    /\b(?:canopy|hazardous material)\b/.test(query);
  const asksLighting =
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires|photometric|photometrics|foot-candles?|fc)\b/
      .test(query);
  const asksElectrical =
    /\b(?:electrical|amps?|amperage|breaker|panel|poles?|voltage|circuit|conduit|wiring)\b/
      .test(query);
  const asksCivilSiteWork = !asksCanopyStructure &&
    /\b(?:civil|pcc|concrete|paving|pavement|asphalt|sewer|drain|parking|north lot|north side|rear side|back lot)\b/
      .test(query);

  if (asksCanopyAFootprint && /\bcanopy\s+a\b/.test(document)) {
    affinities.push(10);
  }
  if (asksCanopyStructure && /\bstructural\b/.test(document)) {
    affinities.push(9);
  }
  if (
    /\b(?:exhaust|airflow|cfm|fan)\b/.test(query) &&
    /\bmechanical\b/.test(document)
  ) {
    affinities.push(9);
  }
  if (
    /\b(?:tree|trees|landscape|planted|planting|irrigation|hydrozone)\b/.test(
      query,
    ) && /\blandscape\b/.test(document)
  ) {
    affinities.push(9);
  }
  if (asksLighting && /\belectrical\b/.test(document)) {
    affinities.push(9);
  }
  if (asksElectrical && /\belectrical\b/.test(document)) {
    affinities.push(9);
  }
  if (
    asksLighting &&
    /\b(?:civil|north lot|north side|outside|area lighting)\b/.test(query) &&
    /\bcivil\b/.test(document)
  ) {
    affinities.push(9);
  }
  if (asksCivilSiteWork && /\bcivil\b/.test(document)) {
    affinities.push(9);
  }
  if (
    /\b(?:containment|hazardous material|weather-protected canopy)\b/.test(
      query,
    ) && /\barchitectural\b/.test(document)
  ) {
    affinities.push(8);
  }
  if (/\bstructural\b/.test(query) && /\bstructural\b/.test(document)) {
    affinities.push(8);
  }
  if (/\belectrical\b/.test(query) && /\belectrical\b/.test(document)) {
    affinities.push(8);
  }
  if (/\bmechanical\b/.test(query) && /\bmechanical\b/.test(document)) {
    affinities.push(8);
  }
  if (/\bplumbing\b/.test(query) && /\bplumbing\b/.test(document)) {
    affinities.push(8);
  }
  return Math.max(0, ...affinities);
}

export function ecosQuestionExplicitSheetReferences(value: string) {
  const normalized = canonicalizeECOSQuestionLanguage(value).toUpperCase();
  return Object.freeze(
    uniqueQuestionValues(
      [...normalized.matchAll(
        /\b([A-Z]{1,4})\s*[-.]\s*(\d+(?:\.\d+)*[A-Z]?)\b/g,
      )]
        .map((match) => `${match[1]}-${match[2]}`),
    ),
  );
}

export function ecosSheetReferenceMatches(value: string, reference: string) {
  const compact = (candidate: string) =>
    candidate.toUpperCase().replace(
      /[^A-Z0-9]/g,
      "",
    );
  const left = compact(value);
  const right = compact(reference);
  return Boolean(left && right && left === right);
}

export function ecosQuestionRequiredDocumentDisciplines(value: string) {
  const question = canonicalizeECOSQuestionLanguage(value).toLowerCase();
  const disciplines: string[] = [];
  for (
    const discipline of [
      "architectural",
      "civil",
      "electrical",
      "landscape",
      "mechanical",
      "plumbing",
      "structural",
    ]
  ) {
    if (new RegExp(`\\b${discipline}\\b`).test(question)) {
      disciplines.push(discipline);
    }
  }
  const hazardousCanopy = /\b(?:hazardous material|weather-protected)\b/.test(
    question,
  ) && /\bcanop(?:y|ies)\b/.test(question);
  if (
    hazardousCanopy &&
    /\b(?:area|footprint|square feet|plan area|containment|layout)\b/.test(
      question,
    )
  ) disciplines.push("architectural");
  if (
    hazardousCanopy &&
    /\b(?:slab|pad|foundation|footing|reinforced|thickness)\b/.test(question)
  ) disciplines.push("structural");
  return Object.freeze(uniqueQuestionValues(disciplines));
}

function domainRetrievalVariants(value: string) {
  const variants: string[] = [];
  if (
    /\bcanop(?:y|ies)\b/i.test(value) &&
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/i.test(
      value,
    )
  ) {
    variants.push(
      "exterior storage lighting plans",
      "lighting plans",
      "canopy lighting fixtures luminaires electrical plan",
    );
  }
  if (
    /\b(?:civil|electrical|outside|area)\b/i.test(value) &&
    /\b(?:light|lights|lighting|fixture|fixtures|photometric|photometrics)\b/i
      .test(value)
  ) {
    variants.push(
      "area lighting architectural and electrical drawings civil plan",
    );
  }
  if (
    /\bcanopy\s+a\b/i.test(value) &&
    /\b(?:area|size|square|feet|footprint|dimensions|big)\b/i.test(value)
  ) {
    variants.push(
      "canopy A overall plan dimensions length width plan footprint square feet",
    );
  }
  if (
    /\b(?:photometric|photometrics|foot-candles?|light levels?)\b/i.test(value)
  ) {
    variants.push(
      "site photometrics plan average maximum minimum foot-candles",
    );
  }
  if (
    /\b(?:slab|pad|concrete)\b/i.test(value) &&
    /\b(?:canopy|hazardous material)\b/i.test(value)
  ) {
    variants.push(
      "reinforced concrete slab thickness canopy structural detail",
    );
  }
  if (
    /\b(?:hazardous material|weather-protected)\b/i.test(value) &&
    /\bcanop(?:y|ies)\b/i.test(value) &&
    /\b(?:area|footprint|square feet|plan area)\b/i.test(value) &&
    /\b(?:slab|pad|foundation|reinforced|thickness|structural)\b/i.test(value)
  ) {
    variants.push(
      "hazardous material canopy architectural plan area footprint",
      "hazardous material canopy structural reinforced concrete slab thickness",
    );
  }
  if (/\b(?:exhaust|fan|airflow|cfm)\b/i.test(value)) {
    variants.push(
      "exhaust fan schedule airflow cfm room coverage mechanical plan",
    );
  }
  if (/\b(?:tree|trees|landscape|planted)\b/i.test(value)) {
    variants.push("landscape tree schedule planned required installed count");
  }
  if (
    /\b(?:underground\s+)?infiltration\s+chambers?\b/i.test(value) ||
    /\buic\b/i.test(value)
  ) {
    variants.push(
      "underground infiltration chambers",
      "UIC short section long section detail",
    );
  }
  return variants;
}

function preserveCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return `${replacement[0]?.toUpperCase() || ""}${replacement.slice(1)}`;
  }
  return replacement;
}

function normalizeQuestionToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.%/"'-]+/g, " ").replace(
    /\s+/g,
    " ",
  ).trim();
}

function stemQuestionToken(value: string) {
  if (value.length > 6 && value.endsWith("ness")) return value.slice(0, -4);
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

function uniqueQuestionValues(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}
