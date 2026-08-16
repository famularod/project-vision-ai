import type {
  ReferenceDocument,
  ReferenceDocumentCitation,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegion,
  ReferenceDocumentSheetProvenance,
} from '../types';
import {
  buildECOSDocumentReadiness,
  isECOSDocumentEligibleForAnswers,
} from './ECOSDocumentReadiness';
import { normalizeECOSSheetProvenance } from './ECOSSheetProvenance';
import { hasAuthoritativeECOSPageGraph } from './ECOSHostedPageGraphAuthority';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'has', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on',
  'or', 'our', 'show', 'that', 'the', 'this', 'to', 'was', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'with', 'you',
]);

const CONSTRUCTION_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  guardrail: ['guardrails', 'handrail', 'handrails', 'barrier', 'barriers', 'vehicle barrier', 'fall protection'],
  parking: ['park', 'lot', 'garage', 'vehicle'],
  required: ['require', 'requires', 'requirement', 'shall', 'must', 'provide', 'install'],
  dimension: ['dimensions', 'size', 'width', 'height', 'length', 'clearance', 'spacing'],
  door: ['doors', 'opening', 'openings', 'frame', 'frames'],
  fire: ['sprinkler', 'alarm', 'rated', 'rating', 'life safety'],
  concrete: ['slab', 'footing', 'foundation', 'cement'],
  electrical: ['power', 'circuit', 'panel', 'conduit', 'wiring'],
  mechanical: ['hvac', 'duct', 'equipment', 'air handling'],
  plumbing: ['pipe', 'piping', 'drain', 'water', 'sanitary'],
  location: ['area', 'room', 'zone', 'where'],
  detail: ['section', 'callout', 'note', 'notes'],
});

export type ECOSDocumentRetrievalCandidate = Readonly<{
  documentId: string;
  pageNumber: number;
  sheetNumber: string | null;
  regionId: string | null;
  excerpt: string;
  score: number;
  queryCoverage: number;
  extractionConfidence: number;
}>;

export type ECOSAssuredDocumentEvidence = Readonly<{
  document: ReferenceDocument;
  page: ReferenceDocumentExtractedPage;
  region: ReferenceDocumentRegion | null;
  excerpt: string;
  score: number;
  queryCoverage: number;
  extractionConfidence: number;
  citation: ReferenceDocumentCitation;
  provenance: ReferenceDocumentSheetProvenance;
}>;

export type ECOSDocumentQuestionAnswer = Readonly<{
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
  evidence: ECOSAssuredDocumentEvidence[];
}>;

/**
 * ECOS Core retrieval. It may propose matches, but it does not approve them.
 * Only current, indexed documents are considered.
 */
export function retrieveECOSDocumentEvidence({
  question,
  documents,
  projectId,
  projectName,
  maximumResults = 4,
}: {
  question: string;
  documents: readonly ReferenceDocument[];
  projectId?: string;
  projectName?: string;
  maximumResults?: number;
}): ECOSDocumentRetrievalCandidate[] {
  const queryTokens = searchableTokens(question);
  if (queryTokens.length === 0) return [];

  return documents
    .filter(document => isECOSDocumentEligibleForAnswers(document) &&
      documentHasExactSourceBinding(document) &&
      documentMatchesProject(document, projectId, projectName))
    .flatMap(document => documentCandidates(document, queryTokens))
    .filter(candidate => candidate.queryCoverage >= 0.2 && candidate.score >= 0.24)
    .sort((left, right) => right.score - left.score || right.extractionConfidence - left.extractionConfidence)
    .filter((candidate, index, all) => all.findIndex(other =>
      other.documentId === candidate.documentId &&
      other.pageNumber === candidate.pageNumber &&
      other.regionId === candidate.regionId &&
      normalize(other.excerpt) === normalize(candidate.excerpt),
    ) === index)
    .slice(0, Math.max(1, maximumResults));
}

/**
 * ECOS Assurance independently verifies project/revision scope, exact source
 * text, page identity, region identity, coordinates, and OCR confidence.
 */
export function assureECOSDocumentEvidence({
  candidates,
  documents,
  projectId,
  projectName,
}: {
  candidates: readonly ECOSDocumentRetrievalCandidate[];
  documents: readonly ReferenceDocument[];
  projectId?: string;
  projectName?: string;
}): ECOSAssuredDocumentEvidence[] {
  return candidates.flatMap(candidate => {
    const document = documents.find(item =>
      item.id === candidate.documentId &&
      item.isCurrent &&
      documentHasExactSourceBinding(item) &&
      documentMatchesProject(item, projectId, projectName),
    );
    if (!document) return [];
    const page = (document.extractedPages ?? []).find(item => item.pageNumber === candidate.pageNumber);
    if (!page) return [];
    const region = candidate.regionId
      ? (page.regions ?? []).find(item => item.id === candidate.regionId) ?? null
      : null;
    if (candidate.regionId && !region) return [];
    const authoritativeText = clean(region?.text || region?.label || page.text);
    const excerpt = clean(candidate.excerpt);
    if (!excerpt || !authoritativeText || !normalize(authoritativeText).includes(normalize(excerpt))) return [];
    if (region && (!validRegion(region) || candidate.extractionConfidence < 0.82)) return [];
    if (usesEmbeddedText(document, region) && !hasVisualCorroboration(page, region, excerpt)) return [];

    const normalizedProvenance = normalizeECOSSheetProvenance(page, {
      expectedPageNumber: page.pageNumber,
      requireAssurance: true,
    });

    const citation: ReferenceDocumentCitation = {
      documentId: document.id,
      projectId: clean(document.projectId) || null,
      sourceSha256: canonicalSha256(document.contentSha256),
      evidenceVersion: clean(
        page.assurance?.evidenceVersion ||
        page.visualCoverage?.evidenceVersion ||
        document.ecosHostedIndexEvidenceVersion,
      ) || null,
      documentName: document.name,
      revision: document.drawingRevision || null,
      pageNumber: page.pageNumber,
      sheetNumber: normalizedProvenance.verified ? normalizedProvenance.sheetNumber : null,
      regionId: region?.id || null,
      label: citationLabel(document, page, normalizedProvenance.sheetNumber),
    };
    return [{
      document,
      page,
      region,
      excerpt,
      score: candidate.score,
      queryCoverage: candidate.queryCoverage,
      extractionConfidence: candidate.extractionConfidence,
      citation,
      provenance: normalizedProvenance.provenance,
    }];
  }).sort((left, right) =>
    Number(Boolean(right.region)) - Number(Boolean(left.region)) || right.score - left.score,
  ).filter((item, index, all) => all.findIndex(other =>
    other.document.id === item.document.id &&
    other.page.pageNumber === item.page.pageNumber &&
    normalize(other.excerpt) === normalize(item.excerpt),
  ) === index);
}

export function answerECOSDocumentQuestion({
  question,
  documents,
  projectId,
  projectName,
}: {
  question: string;
  documents: readonly ReferenceDocument[];
  projectId?: string;
  projectName?: string;
}): ECOSDocumentQuestionAnswer | null {
  const candidates = retrieveECOSDocumentEvidence({ question, documents, projectId, projectName });
  const assured = assureECOSDocumentEvidence({ candidates, documents, projectId, projectName });
  const criticalValueQuestion = /\b(?:dimension|size|width|height|length|clearance|spacing|quantity|how many|diameter|rating)\b/i.test(question);
  const evidence = criticalValueQuestion
    ? assured.filter(item => item.region && item.extractionConfidence >= 0.9)
    : assured;
  if (evidence.length === 0) return null;

  const top = evidence[0];
  const strongEvidence = evidence.filter(item => item.score >= Math.max(0.24, top.score * 0.62)).slice(0, 3);
  const facts = strongEvidence.map(item => `• ${item.excerpt} (${item.citation.label})`);
  const rawConfidence = top.queryCoverage >= 0.75 && top.extractionConfidence >= 0.82
    ? 'high'
    : top.queryCoverage >= 0.4 && top.extractionConfidence >= 0.65 ? 'medium' : 'low';
  const limitations = unique([
    ...strongEvidence.flatMap(item => buildECOSDocumentReadiness(item.document).limitations),
    ...(strongEvidence.some(item => item.document.extractionMethod?.includes('ocr'))
      ? ['Text from scanned pages was recognized with OCR. Confirm critical dimensions, quantities, and requirements against the cited page.']
      : []),
    ...(rawConfidence === 'low'
      ? ['ECOS found related source text, but the match is not strong enough to treat as a complete answer.']
      : []),
  ]);
  const confidence = rawConfidence === 'high' && limitations.length > 0
    ? 'medium'
    : rawConfidence;
  return {
    answer: `Document evidence\n${facts.join('\n')}`,
    confidence,
    limitations,
    evidence: strongEvidence,
  };
}

function documentCandidates(
  document: ReferenceDocument,
  queryTokens: readonly string[],
): ECOSDocumentRetrievalCandidate[] {
  const direct = (document.extractedPages ?? []).flatMap(page => {
    const regionCandidates = (page.regions ?? []).flatMap(region => {
      const excerpt = clean(region.text || region.label);
      if (!excerpt) return [];
      return [scoredCandidate(document, page, region, excerpt, queryTokens)];
    });
    const pageText = clean(page.text);
    const pageCandidate = pageText
      ? [scoredCandidate(document, page, null, bestPassage(pageText, queryTokens), queryTokens)]
      : [];
    return [...regionCandidates, ...pageCandidate];
  });
  const crossReferenced = direct.filter(source =>
    candidateCanSteerCrossSheetExpansion(document, source)
  ).flatMap(source => {
    const references = referencedSheets(source.excerpt);
    if (references.length === 0 || source.queryCoverage < 0.2) return [];
    return (document.extractedPages ?? [])
      .filter(page => page.pageNumber !== source.pageNumber && references.includes(normalizeSheet(page.sheetNumber)))
      .flatMap(page => {
        const excerpts: Array<{ region: ReferenceDocumentRegion | null; excerpt: string }> =
          (page.regions ?? []).map(region => ({ region, excerpt: clean(region.text || region.label) }))
          .filter(item => Boolean(item.excerpt));
        if (excerpts.length === 0 && clean(page.text)) excerpts.push({ region: null, excerpt: bestPassage(clean(page.text), queryTokens) });
        return excerpts.map(item => {
          const candidate = scoredCandidate(document, page, item.region, item.excerpt, queryTokens);
          return {
            ...candidate,
            queryCoverage: Math.max(candidate.queryCoverage, source.queryCoverage * 0.72),
            score: Math.max(candidate.score, source.score * 0.74),
          };
        });
      });
  });
  return [...direct, ...crossReferenced];
}

function candidateCanSteerCrossSheetExpansion(
  document: ReferenceDocument,
  candidate: ECOSDocumentRetrievalCandidate,
) {
  const page = (document.extractedPages ?? []).find(item => item.pageNumber === candidate.pageNumber);
  if (!page) return false;
  const region = candidate.regionId
    ? (page.regions ?? []).find(item => item.id === candidate.regionId) ?? null
    : null;
  if (candidate.regionId && !region) return false;
  return !usesEmbeddedText(document, region) || hasVisualCorroboration(page, region, candidate.excerpt);
}

function scoredCandidate(
  document: ReferenceDocument,
  page: ReferenceDocumentExtractedPage,
  region: ReferenceDocumentRegion | null,
  excerpt: string,
  queryTokens: readonly string[],
): ECOSDocumentRetrievalCandidate {
  const searchable = `${document.name} ${document.category} ${document.drawingNumber || ''} ${page.sheetNumber || ''} ${page.title || ''} ${excerpt}`;
  const textTokens = new Set(searchableTokens(searchable));
  const matched = queryTokens.filter(token => tokenMatchesSearchText(token, textTokens));
  const queryCoverage = matched.length / queryTokens.length;
  const density = matched.length / Math.max(4, Math.min(24, textTokens.size));
  const phraseBoost = normalize(searchable).includes(normalize(queryTokens.join(' '))) ? 0.18 : 0;
  const pageRegionConfidence = (page.regions ?? [])
    .map(item => item.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const extractionConfidence = region?.confidence != null
    ? clamp(region.confidence)
    : pageRegionConfidence.length > 0
      ? clamp(pageRegionConfidence.reduce((sum, value) => sum + value, 0) / pageRegionConfidence.length)
      : document.extractionMethod?.includes('ocr') ? 0.65 : 0.9;
  return {
    documentId: document.id,
    pageNumber: page.pageNumber,
    sheetNumber: page.sheetNumber || null,
    regionId: region?.id || null,
    excerpt: excerpt.slice(0, 600),
    score: clamp(queryCoverage * 0.72 + density * 0.18 + phraseBoost + extractionConfidence * 0.1),
    queryCoverage,
    extractionConfidence,
  };
}

function bestPassage(text: string, queryTokens: readonly string[]) {
  const passages = text.split(/\n+|(?<=[.!?])\s+/).map(clean).filter(Boolean);
  const ranked = passages.map(value => ({
    value,
    matches: queryTokens.filter(token => tokenMatchesNormalizedText(token, normalize(value))).length,
  })).sort((left, right) => right.matches - left.matches || left.value.length - right.value.length);
  return (ranked[0]?.value || text).slice(0, 600);
}

function citationLabel(
  document: ReferenceDocument,
  page: ReferenceDocumentExtractedPage,
  verifiedSheetNumber: string | null,
) {
  const location = verifiedSheetNumber
    ? `Sheet ${verifiedSheetNumber}`
    : `Page ${page.pageNumber}`;
  const revision = document.drawingRevision ? `, Rev ${document.drawingRevision}` : '';
  return `${document.name}, ${location}${revision}`;
}

function validRegion(region: ReferenceDocumentRegion) {
  return [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 &&
    region.x + region.width <= 1.001 && region.y + region.height <= 1.001;
}

function documentHasExactSourceBinding(document: ReferenceDocument) {
  const source = canonicalSha256(document.contentSha256);
  const indexed = canonicalSha256(document.indexedContentSha256);
  return source != null && source === indexed &&
    hasAuthoritativeECOSPageGraph(document);
}

function usesEmbeddedText(
  document: ReferenceDocument,
  region: ReferenceDocumentRegion | null,
) {
  return region?.source === 'embedded_text' ||
    (!region && clean(document.extractionMethod).toLowerCase().includes('embedded'));
}

function hasVisualCorroboration(
  page: ReferenceDocumentExtractedPage,
  region: ReferenceDocumentRegion | null,
  excerpt: string,
) {
  const candidateRegions = region
    ? [region]
    : (page.regions ?? []).filter(item => {
      const text = clean(item.text || item.label);
      return text && textsOverlap(text, excerpt);
    });
  return candidateRegions.some(item => (item.corroboratingEvidence ?? []).some(evidence => {
    const source = clean(evidence.source).toLowerCase();
    const text = clean(evidence.text);
    const confidence = evidence.confidence;
    return (source === 'ocr' || source === 'vision') &&
      text.length > 0 &&
      textsSubstantiallyMatch(text, excerpt) &&
      validBounds(evidence.bounds) &&
      boundsSubstantiallyOverlap(item, evidence.bounds) &&
      typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0.82;
  }));
}

function textsOverlap(left: string, right: string) {
  return textsSubstantiallyMatch(left, right);
}

function textsSubstantiallyMatch(left: string, right: string) {
  const normalizedLeft = normalizeCorroborationText(left);
  const normalizedRight = normalizeCorroborationText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  const longerLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (shorterLength < 8 || shorterLength / longerLength < 0.8) return false;
  const leftTokens = normalizedLeft.split(' ').filter(Boolean);
  const rightTokens = normalizedRight.split(' ').filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const remaining = new Map<string, number>();
  rightTokens.forEach(token => remaining.set(token, (remaining.get(token) ?? 0) + 1));
  let matched = 0;
  for (const token of leftTokens) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      matched += 1;
      remaining.set(token, count - 1);
    }
  }
  return matched / leftTokens.length >= 0.9 && matched / rightTokens.length >= 0.9;
}

function normalizeCorroborationText(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function validBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  return values.every(item => typeof item === 'number' && Number.isFinite(item)) &&
    (bounds.x as number) >= 0 && (bounds.y as number) >= 0 &&
    (bounds.width as number) > 0 && (bounds.height as number) > 0 &&
    (bounds.x as number) + (bounds.width as number) <= 1.001 &&
    (bounds.y as number) + (bounds.height as number) <= 1.001;
}

function boundsSubstantiallyOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const embeddedArea = left.width * left.height;
  const renderedArea = right.width * right.height;
  const areaRatio = renderedArea / embeddedArea;
  return embeddedArea > 0 && renderedArea > 0 &&
    overlapArea / embeddedArea >= 0.6 &&
    areaRatio >= 0.4 && areaRatio <= 2.5;
}

function canonicalSha256(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function documentMatchesProject(
  document: ReferenceDocument,
  projectId?: string,
  projectName?: string,
) {
  if (!projectId && !projectName) return true;
  if (projectId) return clean(document.projectId) === clean(projectId);
  const expected = normalize(projectName || '');
  if (!expected) return false;
  return normalize(document.projectName || '') === expected ||
    (document.projectNames ?? []).some(name => normalize(name) === expected);
}

function searchableTokens(value: string) {
  return [...new Set(normalize(value).split(' ').filter(token => token.length >= 2 && !STOP_WORDS.has(token)))]
    .map(stem);
}

function tokenMatchesSearchText(token: string, textTokens: ReadonlySet<string>) {
  return tokenVariants(token).some(variant => {
    const variantTokens = searchableTokens(variant);
    return variantTokens.length > 0 && variantTokens.every(expected =>
      textTokens.has(expected) || [...textTokens].some(value =>
        value.startsWith(expected) || expected.startsWith(value),
      ),
    );
  });
}

function tokenMatchesNormalizedText(token: string, text: string) {
  return tokenVariants(token).some(variant => text.includes(normalize(variant)));
}

function tokenVariants(token: string) {
  const related = Object.entries(CONSTRUCTION_SYNONYMS).flatMap(([canonical, variants]) =>
    searchableTokensWithoutSynonyms(canonical).includes(token) ||
    variants.some(variant => searchableTokensWithoutSynonyms(variant).includes(token))
      ? [canonical, ...variants]
      : [],
  );
  return [...new Set([token, ...related])];
}

function referencedSheets(value: string) {
  const matches = value.matchAll(/\b(?:see|refer(?:\s+to)?|per)\s+(?:detail\s+[a-z0-9.-]+\s*\/\s*)?(?:sheet\s+)?([a-z]{1,3}[-.]?\d{2,4}(?:\.\d{1,2})?)\b/gi);
  return [...new Set([...matches].map(match => normalizeSheet(match[1])).filter(Boolean))];
}

function normalizeSheet(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

function searchableTokensWithoutSynonyms(value: string) {
  return normalize(value).split(' ').filter(token => token.length >= 2 && !STOP_WORDS.has(token)).map(stem);
}

function stem(value: string) {
  if (value.length > 5 && value.endsWith('ing')) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith('ed')) return value.slice(0, -2);
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9.%/-]+/g, ' ').trim();
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function unique(values: readonly string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}
