import {
  analyzeECOSProjectQuestion,
  analyzeECOSQuestionEvidenceContext,
  containsECOSRequestedMeasurementValue,
  ecosEvidenceQuestionContextScore,
} from './ecos-project-answer-policy.ts';

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
  source: 'embedded_text' | 'ocr' | 'vision' | null;
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
  source: 'embedded_text' | 'ocr' | 'vision' | null;
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
  pageIdentity = '',
  maximumPassages = 3,
}: {
  pageText: string;
  regions: readonly ECOSDrawingRegionInput[];
  question: string;
  pageIdentity?: string;
  maximumPassages?: number;
}): ECOSDrawingEvidencePassage[] {
  const normalizedRegions = regions.map(normalizeRegion).filter((region): region is DrawingRegion => Boolean(region));
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
    : normalizedRegions.map(region => region.text).join('\n');
  const requirement = analyzeECOSProjectQuestion(question);
  const calculatedAreaPassages = requirement.attribute === 'area'
    ? buildCalculatedAreaPassages(normalizedRegions, safePageText, question, pageIdentity)
    : [];
  const locationRegions = normalizedRegions.filter(region => {
    const context = analyzeECOSQuestionEvidenceContext(question, region.text);
    return context.locationMatched &&
      (context.locationDirectionTokens.length > 0 || context.locationKindTokens.length > 0);
  });
  const anchors = normalizedRegions.filter(region =>
    requirement.kind === 'general'
      ? ecosEvidenceQuestionContextScore(question, region.text) > 0
      : containsECOSRequestedMeasurementValue(question, region.text)
  );
  const directPassages = anchors.flatMap(anchor => {
    const nearby = normalizedRegions.filter(region =>
      region.id !== anchor.id &&
      regionsAreNear(anchor, region) &&
      !(containsECOSRequestedMeasurementValue(question, anchor.text) &&
        containsECOSRequestedMeasurementValue(question, region.text))
    );
    const localText = unique([anchor.text, ...nearby.map(region => region.text)]).join('\n');
    const localContext = analyzeECOSQuestionEvidenceContext(question, localText);
    if (requirement.kind === 'measurement' && (!localContext.measurementMatched || !localContext.attributeMatched)) {
      return [];
    }
    if (!localContext.subjectMatched) return [];

    const nearbyLocation = locationRegions
      .filter(region => region.id !== anchor.id && regionsAreNear(anchor, region))
      .sort((left, right) => regionDistance(anchor, left) - regionDistance(anchor, right))[0];
    const sheetLocation = nearbyLocation || locationRegions
      .sort((left, right) => ecosEvidenceQuestionContextScore(question, right.text) -
        ecosEvidenceQuestionContextScore(question, left.text))[0];
    const contextualRegions = uniqueRegions([
      sheetLocation,
      ...nearby
        .filter(region => ecosEvidenceQuestionContextScore(question, region.text) > 0 ||
          containsECOSRequestedMeasurementValue(question, region.text))
        .sort((left, right) => regionDistance(anchor, left) - regionDistance(anchor, right))
        .slice(0, 5),
      anchor,
    ].filter((region): region is DrawingRegion => Boolean(region)));
    const passageText = unique([
      pageIdentity,
      ...contextualRegions.map(region => region.text),
    ]).join('\n');
    const passageContext = analyzeECOSQuestionEvidenceContext(question, passageText);
    if (!passageContext.subjectMatched || !passageContext.locationMatched) return [];
    const locationProximityBonus = sheetLocation && regionsAreNear(anchor, sheetLocation) ? 1.5 : 0.5;
    const anchorSpecificity = ecosEvidenceQuestionContextScore(question, anchor.text);
    const score = ecosEvidenceQuestionContextScore(question, passageText) * 4 +
      anchorSpecificity * 2 + locationProximityBonus + (anchor.confidence ?? 0.75);
    return [{
      text: passageText,
      score,
      regionId: anchor.id || null,
      contextRegionIds: Object.freeze(contextualRegions.map(region => region.id).filter(Boolean)),
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
      areaNames: Object.freeze(unique(contextualRegions.flatMap(region => region.areaNames))),
    }];
  });
  return [...calculatedAreaPassages, ...directPassages]
    .sort((left, right) => right.score - left.score)
    .filter((passage, index, all) => all.findIndex(other => normalizeText(other.text) === normalizeText(passage.text)) === index)
    .slice(0, Math.max(1, Math.min(5, maximumPassages)));
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
  const pageContextText = unique([pageText, ...regions.map(region => region.text)]).join('\n');
  const pageContext = analyzeECOSQuestionEvidenceContext(question, pageContextText);
  if (!pageContext.subjectMatched || !pageContext.locationMatched || !/\bplan\b/i.test(pageContextText)) return [];

  const explicitlyOverall = regions.filter(region =>
    /\boverall\b/i.test(region.text) &&
    !/\b(?:module|segment|bay|dimension\s+key)\b/i.test(region.text) &&
    !/\boverview\b/i.test(region.id)
  );
  const dimensionRegions = explicitlyOverall.length >= 2 ? explicitlyOverall : regions;
  const dimensions = dimensionRegions.flatMap(region =>
    parseFeetDimensions(region.text).map(dimension => ({ ...dimension, region })),
  ).filter(dimension => dimension.feet >= 3 && dimension.feet <= 2_000);
  const uniqueDimensions = dimensions
    .sort((left, right) => right.feet - left.feet)
    .filter((dimension, index, all) => all.findIndex(other =>
      Math.abs(other.feet - dimension.feet) < 0.001
    ) === index);
  if (uniqueDimensions.length < 2) return [];

  const horizontal = uniqueDimensions.find(dimension =>
    dimension.region.width != null && dimension.region.height != null &&
    dimension.region.width >= dimension.region.height * 1.25
  ) || uniqueDimensions[0];
  const vertical = uniqueDimensions.find(dimension =>
    dimension.region.id !== horizontal.region.id &&
    dimension.region.width != null && dimension.region.height != null &&
    dimension.region.height >= dimension.region.width * 1.25
  ) || uniqueDimensions.find(dimension => dimension.region.id !== horizontal.region.id);
  if (!horizontal || !vertical || Math.abs(horizontal.feet - vertical.feet) < 0.001) return [];

  const area = roundedArea(horizontal.feet * vertical.feet);
  if (!Number.isFinite(area) || area <= 0) return [];
  const contextRegions = regions
    .filter(region => ecosEvidenceQuestionContextScore(question, region.text) > 0)
    .sort((left, right) => ecosEvidenceQuestionContextScore(question, right.text) -
      ecosEvidenceQuestionContextScore(question, left.text))
    .slice(0, 3);
  const calculationRegions = uniqueRegions([
    ...contextRegions,
    horizontal.region,
    vertical.region,
  ]);
  const bounds = unionBounds(calculationRegions);
  const contextText = unique(contextRegions.map(region => region.text)).join('\n');
  const areaDisplay = Number.isInteger(area) ? area.toLocaleString('en-US') : area.toFixed(1);
  const calculation = [
    pageIdentity,
    contextText,
    `ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: ${horizontal.display} × ${vertical.display} = ${areaDisplay} square feet.`,
    'The square footage is calculated from the cited drawing dimensions; it is not a separately printed area value.',
  ].filter(Boolean).join('\n');
  const rawSources = unique(calculationRegions.map(region => region.rawSource || '').filter(Boolean));
  const reconstructionMethods = unique(
    calculationRegions.map(region => region.reconstructionMethod || '').filter(Boolean),
  );
  return [{
    text: calculation,
    score: 40 + ecosEvidenceQuestionContextScore(question, calculation),
    regionId: horizontal.region.id || null,
    contextRegionIds: Object.freeze(calculationRegions.map(region => region.id).filter(Boolean)),
    x: bounds?.x ?? horizontal.region.x,
    y: bounds?.y ?? horizontal.region.y,
    width: bounds?.width ?? horizontal.region.width,
    height: bounds?.height ?? horizontal.region.height,
    confidence: minimumConfidence(calculationRegions),
    source: calculationRegions.every(region => region.source === 'embedded_text')
      ? 'embedded_text'
      : calculationRegions.some(region => region.source === 'vision') ? 'vision'
        : calculationRegions.some(region => region.source === 'ocr') ? 'ocr' : null,
    rawSource: rawSources.length === 1 ? rawSources[0] : null,
    reconstructionMethod: reconstructionMethods.length === 1 ? reconstructionMethods[0] : null,
    evidenceSources: Object.freeze(unique(calculationRegions.flatMap(region => region.evidenceSources))),
    constituentEvidence: Object.freeze(uniqueEvidenceRecords(
      calculationRegions.flatMap(region => region.constituentEvidence),
    )),
    corroboratingEvidence: Object.freeze(uniqueEvidenceRecords(
      calculationRegions.flatMap(region => region.corroboratingEvidence),
    )),
    areaNames: Object.freeze(unique(calculationRegions.flatMap(region => region.areaNames))),
  }];
}

function parseFeetDimensions(value: string) {
  const normalized = value
    .replace(/[’‘]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, ' ');
  const matches = [...normalized.matchAll(/\b(\d{1,4})(?:\.(\d+))?\s*(?:'|feet|foot|ft\.?)\s*(?:-\s*)?(?:(\d{1,2})(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?\s*(?:"|inches?|inch|in\.?)?)?/gi)];
  return matches.flatMap(match => {
    const wholeFeet = Number(match[1]);
    const decimalFeet = match[2] ? Number(`0.${match[2]}`) : 0;
    const wholeInches = Number(match[3] || 0);
    const fractionNumerator = Number(match[4] || match[6] || 0);
    const fractionDenominator = Number(match[5] || (match[6] ? 1 : 0));
    const fractionInches = fractionDenominator > 0 ? fractionNumerator / fractionDenominator : 0;
    const feet = wholeFeet + decimalFeet + (wholeInches + fractionInches) / 12;
    if (!Number.isFinite(feet) || feet <= 0) return [];
    return [{ feet, display: match[0].trim() }];
  });
}

function roundedArea(value: number) {
  return Math.round(value * 10) / 10;
}

function unionBounds(regions: readonly DrawingRegion[]) {
  if (regions.length === 0 || regions.some(region =>
    [region.x, region.y, region.width, region.height].some(value => value == null)
  )) return null;
  const left = Math.min(...regions.map(region => region.x!));
  const top = Math.min(...regions.map(region => region.y!));
  const right = Math.max(...regions.map(region => region.x! + region.width!));
  const bottom = Math.max(...regions.map(region => region.y! + region.height!));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function minimumConfidence(regions: readonly DrawingRegion[]) {
  const values = regions.map(region => region.confidence).filter((value): value is number => value != null);
  return values.length > 0 ? Math.min(...values) : null;
}

function buildLineFallback(pageText: string, question: string, pageIdentity = ''): ECOSDrawingEvidencePassage | null {
  const lines = pageText.replace(/\r/g, '').split('\n').map(value => value.trim()).filter(Boolean);
  const requirement = analyzeECOSProjectQuestion(question);
  const candidates = lines.map((line, index) => {
    const start = Math.max(0, index - 3);
    const end = Math.min(lines.length, index + 4);
    const text = unique([pageIdentity, ...lines.slice(start, end)]).join('\n');
    const context = analyzeECOSQuestionEvidenceContext(question, text);
    const valid = context.subjectMatched && context.locationMatched &&
      (requirement.kind === 'general' || (context.measurementMatched && context.attributeMatched));
    return { text, valid, score: ecosEvidenceQuestionContextScore(question, text) };
  }).filter(candidate => candidate.valid)
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return best ? {
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
  } : null;
}

function normalizeRegion(value: ECOSDrawingRegionInput): DrawingRegion | null {
  if (value.searchable === false) return null;
  const text = textValue(value.text) || textValue(value.label);
  if (!text) return null;
  const rawSource = textValue(value.rawSource) || textValue(value.source) || null;
  return Object.freeze({
    id: textValue(value.id),
    text,
    areaNames: Object.freeze(Array.isArray(value.areaNames) ? value.areaNames.map(textValue).filter(Boolean) : []),
    x: coordinate(value.x),
    y: coordinate(value.y),
    width: coordinate(value.width),
    height: coordinate(value.height),
    confidence: coordinate(value.confidence),
    source: canonicalRegionSource(rawSource),
    rawSource,
    reconstructionMethod: textValue(value.reconstructionMethod) || null,
    evidenceSources: Object.freeze(Array.isArray(value.evidenceSources)
      ? unique(value.evidenceSources.map(textValue).filter(Boolean))
      : []),
    constituentEvidence: Object.freeze(evidenceRecords(value.constituentEvidence)),
    corroboratingEvidence: Object.freeze(evidenceRecords(value.corroboratingEvidence)),
  });
}

function regionsAreNear(left: DrawingRegion, right: DrawingRegion) {
  if ([left.x, left.y, left.width, left.height, right.x, right.y, right.width, right.height]
    .some(value => value == null)) return false;
  const verticalGap = axisGap(left.y!, left.height!, right.y!, right.height!);
  const horizontalGap = axisGap(left.x!, left.width!, right.x!, right.width!);
  const overlapsHorizontally = horizontalGap === 0;
  return verticalGap <= 0.09 && (overlapsHorizontally || horizontalGap <= 0.12) ||
    regionDistance(left, right) <= 0.17;
}

function regionDistance(left: DrawingRegion, right: DrawingRegion) {
  if ([left.x, left.y, left.width, left.height, right.x, right.y, right.width, right.height]
    .some(value => value == null)) return Number.POSITIVE_INFINITY;
  const leftCenterX = left.x! + left.width! / 2;
  const leftCenterY = left.y! + left.height! / 2;
  const rightCenterX = right.x! + right.width! / 2;
  const rightCenterY = right.y! + right.height! / 2;
  return Math.hypot(leftCenterX - rightCenterX, leftCenterY - rightCenterY);
}

function axisGap(firstStart: number, firstLength: number, secondStart: number, secondLength: number) {
  return Math.max(0, Math.max(firstStart, secondStart) - Math.min(firstStart + firstLength, secondStart + secondLength));
}

function uniqueRegions(values: readonly DrawingRegion[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.id || normalizeText(value.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: readonly string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function canonicalRegionSource(value: string | null): 'embedded_text' | 'ocr' | 'vision' | null {
  if (value === 'deterministic_label_block') return 'ocr';
  return value === 'embedded_text' || value === 'ocr' || value === 'vision' ? value : null;
}

function evidenceRecords(value: unknown): ECOSDrawingProvenanceEvidence[] {
  return Array.isArray(value)
    ? value.filter(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map(item => Object.freeze({ ...(item as Record<string, unknown>) }))
    : [];
}

function uniqueEvidenceRecords(values: readonly ECOSDrawingProvenanceEvidence[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const id = textValue(value.id);
    const key = id || JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}
