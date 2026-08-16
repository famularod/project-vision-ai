import type { ReferenceDocumentRegion } from '../types';

export type ECOSSheetMappingStatus = 'verified' | 'conflicted' | 'unverified';

export type ECOSSheetMappingCandidate = Readonly<{
  sheetNumber: string;
  normalizedSheetNumber: string;
  score: number;
  confidence: number;
  evidenceRegionIds: readonly string[];
  evidenceText: readonly string[];
  sources: readonly ('embedded_text' | 'ocr' | 'vision')[];
}>;

export type ECOSSheetMapping = Readonly<{
  status: ECOSSheetMappingStatus;
  sheetNumber: string | null;
  sheetTitle: string | null;
  confidence: number;
  candidates: readonly ECOSSheetMappingCandidate[];
  limitations: readonly string[];
}>;

type RawCandidate = Readonly<{
  sheetNumber: string;
  normalizedSheetNumber: string;
  score: number;
  confidence: number;
  regionId: string;
  evidenceText: string;
  source: 'embedded_text' | 'ocr' | 'vision';
}>;

const SHEET_IDENTIFIER_PATTERN = /\b([A-Z]{1,3}\s*[-.]?\s*\d{1,3}(?:\.\d{1,2})?)\b(?!\s*[-.]?\s*\d)/gi;
const EXPLICIT_SHEET_PATTERN = /\b(?:sheet|drawing)(?:\s*(?:no\.?|number))?\s*[:#-]?\s*((?:[A-Z]{1,3}\s*[-.]?\s*)?\d{1,3}(?:\.\d{1,2})?)\b(?!\s*[-.]?\s*\d)/gi;
const REJECTED_PREFIXES = new Set(['REV', 'RFI', 'ASI', 'SK', 'OF', 'NO', 'PAGE', 'PG']);

/**
 * Maps one PDF page to a construction sheet identity using consensus rather
 * than the first regex hit. Conflicting candidates fail closed so an uncertain
 * sheet number can never become a factual citation.
 */
export function buildECOSSheetMapping(
  regions: readonly ReferenceDocumentRegion[],
): ECOSSheetMapping {
  const raw = regions.flatMap(region => sheetCandidatesForRegion(region));
  const grouped = groupCandidates(raw);
  const ordered = [...grouped].sort((left, right) =>
    right.score - left.score || right.confidence - left.confidence ||
    right.evidenceRegionIds.length - left.evidenceRegionIds.length,
  );
  const top = ordered[0];
  const second = ordered[1];
  const conflict = Boolean(top && second && (
    (top.score >= 10 && second.score >= 10) ||
    second.score >= top.score * 0.78 ||
    (top.confidence < 0.88 && second.score >= top.score * 0.64)
  ));
  const verified = Boolean(top && !conflict && (
    top.score >= 7.5 ||
    top.evidenceRegionIds.length >= 2 && top.score >= 7
  ));
  const sheetTitle = top ? sheetTitleFromEvidence(top.evidenceText) : null;
  if (conflict) {
    return Object.freeze({
      status: 'conflicted',
      sheetNumber: null,
      sheetTitle: null,
      confidence: 0,
      candidates: Object.freeze(ordered),
      limitations: Object.freeze([
        `Sheet identity is conflicted between ${top!.sheetNumber} and ${second!.sheetNumber}; the PDF page number must be used until the title block is verified.`,
      ]),
    });
  }
  if (!verified) {
    return Object.freeze({
      status: 'unverified',
      sheetNumber: null,
      sheetTitle,
      confidence: top?.confidence ?? 0,
      candidates: Object.freeze(ordered),
      limitations: Object.freeze([
        'Sheet identity could not be verified from independent title-block or visual evidence.',
      ]),
    });
  }
  return Object.freeze({
    status: 'verified',
    sheetNumber: top!.sheetNumber,
    sheetTitle,
    confidence: top!.confidence,
    candidates: Object.freeze(ordered),
    limitations: Object.freeze([]),
  });
}

export function detectECOSVerifiedSheetNumber(
  regions: readonly ReferenceDocumentRegion[],
) {
  return buildECOSSheetMapping(regions).sheetNumber;
}

function sheetCandidatesForRegion(region: ReferenceDocumentRegion): RawCandidate[] {
  const evidenceText = clean(region.text || region.label);
  if (!evidenceText) return [];
  const source = region.source === 'vision' || region.source === 'ocr'
    ? region.source
    : 'embedded_text';
  const confidence = normalizedConfidence(region.confidence, source);
  const titleBlockPosition = region.y >= 0.82 && (
    region.x >= 0.55 ||
    /\b(?:sheet|drawing)\s*(?:no\.?|number)|\b(?:plan|details?|schedule)\b/i.test(evidenceText)
  );
  const visionIdentity = source === 'vision' && /\b(?:subject:\s*sheet identity|sheet\s+identity|sheet\s+title)\b/i.test(evidenceText);
  const crossReference = /\b(?:match\s+line|see|refer(?:ence)?|details?\s+on)\b[^.\n]{0,80}\bsheet\b|\bsheet\b[^.\n]{0,40}\bof\s+\d+\b/i.test(evidenceText);
  if (crossReference && !visionIdentity) return [];
  const revisionText = /\b(?:revision|rev\.?|project|job|permit|date)\b/i.test(evidenceText) &&
    !/\bsheet\b/i.test(evidenceText);
  const explicit = [...evidenceText.matchAll(EXPLICIT_SHEET_PATTERN)].flatMap(match => {
    if (!titleBlockPosition && !visionIdentity) return [];
    const candidate = normalizedCandidate(match[1], { allowNumericOnly: visionIdentity });
    if (!candidate) return [];
    return [rawCandidate({
      candidate,
      region,
      evidenceText,
      source,
      confidence,
      score: 10 + Number(titleBlockPosition) * 5 + Number(visionIdentity) * 8,
    })];
  });
  const general = [...evidenceText.matchAll(SHEET_IDENTIFIER_PATTERN)].flatMap(match => {
    if (!titleBlockPosition && !visionIdentity) return [];
    const candidate = normalizedCandidate(match[1]);
    if (!candidate) return [];
    const exactValue = normalize(candidate.sheetNumber) === normalize(evidenceText);
    const concise = evidenceText.length <= 48;
    const score = Number(titleBlockPosition) * 6 + Number(concise) * 2 +
      Number(exactValue) * 3 + Number(visionIdentity) * 10 - Number(revisionText) * 5;
    if (score <= 0) return [];
    return [rawCandidate({ candidate, region, evidenceText, source, confidence, score })];
  });
  return deduplicateRawCandidates([...explicit, ...general]);
}

function rawCandidate({
  candidate,
  region,
  evidenceText,
  source,
  confidence,
  score,
}: {
  candidate: { sheetNumber: string; normalizedSheetNumber: string };
  region: ReferenceDocumentRegion;
  evidenceText: string;
  source: RawCandidate['source'];
  confidence: number;
  score: number;
}): RawCandidate {
  return {
    ...candidate,
    score: score + confidence * 2 + (source === 'vision' ? 2 : source === 'embedded_text' ? 1 : 0),
    confidence,
    regionId: region.id,
    evidenceText,
    source,
  };
}

function groupCandidates(raw: readonly RawCandidate[]): ECOSSheetMappingCandidate[] {
  const byIdentity = new Map<string, RawCandidate[]>();
  raw.forEach(candidate => byIdentity.set(candidate.normalizedSheetNumber, [
    ...(byIdentity.get(candidate.normalizedSheetNumber) || []),
    candidate,
  ]));
  return [...byIdentity.values()].map(candidates => {
    const strongest = [...candidates].sort((left, right) => right.score - left.score)[0];
    const evidenceRegionIds = unique(candidates.map(candidate => candidate.regionId));
    const supportBonus = Math.min(8, Math.max(0, evidenceRegionIds.length - 1) * 4);
    const independentSources = unique(candidates.map(candidate => candidate.source));
    const sourceBonus = Math.max(0, independentSources.length - 1) * 3;
    return Object.freeze({
      sheetNumber: strongest.sheetNumber,
      normalizedSheetNumber: strongest.normalizedSheetNumber,
      score: round(Math.max(...candidates.map(candidate => candidate.score)) + supportBonus + sourceBonus),
      confidence: round(Math.min(1, Math.max(...candidates.map(candidate => candidate.confidence)) +
        Math.max(0, evidenceRegionIds.length - 1) * 0.04 + Math.max(0, independentSources.length - 1) * 0.05)),
      evidenceRegionIds: Object.freeze(evidenceRegionIds),
      evidenceText: Object.freeze(unique(candidates.map(candidate => candidate.evidenceText))),
      sources: Object.freeze(independentSources),
    });
  });
}

function normalizedCandidate(
  value: string,
  { allowNumericOnly = false }: { allowNumericOnly?: boolean } = {},
) {
  const cleaned = value.toUpperCase().replace(/\s+/g, '').replace(/\.{2,}/g, '.');
  const match = cleaned.match(/^([A-Z]{1,3})?([-.]?)(\d{1,3})(?:\.(\d{1,2}))?$/);
  if (!match?.[1] && allowNumericOnly && /^\d{1,3}$/.test(cleaned)) {
    return { sheetNumber: cleaned, normalizedSheetNumber: `PAGE${cleaned}` };
  }
  if (!match?.[1]) return null;
  if (!match || REJECTED_PREFIXES.has(match[1])) return null;
  const [, prefix, separator, number, decimal] = match;
  const sheetNumber = `${prefix}${separator}${number}${decimal ? `.${decimal}` : ''}`;
  const normalizedSheetNumber = `${prefix}${number}${decimal || ''}`;
  if (normalizedSheetNumber.length > 7) return null;
  return { sheetNumber, normalizedSheetNumber };
}

function sheetTitleFromEvidence(evidence: readonly string[]) {
  for (const value of evidence) {
    const match = value.match(/\bis\s+titled\s+[“\"]([^”\"]{2,240})[”\"]/i) ||
      value.match(/\bsheet\s+title\s*[:.-]\s*([^.;]{2,240})/i);
    if (match?.[1]) return clean(match[1]).slice(0, 240);
  }
  return null;
}

function deduplicateRawCandidates(values: readonly RawCandidate[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = `${value.regionId}:${value.normalizedSheetNumber}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedConfidence(value: unknown, source: RawCandidate['source']) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return source === 'embedded_text' ? 1 : source === 'vision' ? 0.84 : 0.65;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function clean(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim()
    : '';
}

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
