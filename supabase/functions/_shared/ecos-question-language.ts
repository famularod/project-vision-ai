/**
 * Question-only language normalization for ECOS retrieval and assurance.
 *
 * This module never normalizes stored evidence.  It may help ECOS understand
 * how a customer phrased a request, but it cannot create a fact, citation, or
 * authority scope.  Exact evidence and Assurance remain the answer authority.
 */

const QUESTION_TOKEN_CORRECTIONS: Readonly<Record<string, string>> = Object.freeze({
  airflw: 'airflow',
  asfault: 'asphalt',
  ashphalt: 'asphalt',
  canapy: 'canopy',
  conc: 'concrete',
  concreate: 'concrete',
  concret: 'concrete',
  contianment: 'containment',
  controlable: 'controllable',
  diamater: 'diameter',
  electical: 'electrical',
  elec: 'electrical',
  exaust: 'exhaust',
  flamable: 'flammable',
  combustable: 'combustible',
  fotting: 'footing',
  hidrozone: 'hydrozone',
  hydrozon: 'hydrozone',
  hight: 'height',
  irrigatoin: 'irrigation',
  landsc: 'landscape',
  landscpe: 'landscape',
  laterel: 'lateral',
  lenght: 'length',
  lites: 'lights',
  mech: 'mechanical',
  mechancial: 'mechanical',
  noth: 'north',
  pav: 'paving',
  pavemet: 'pavement',
  pavment: 'pavement',
  pccs: 'pcc',
  photmetric: 'photometric',
  photmetrics: 'photometrics',
  plbg: 'plumbing',
  pluming: 'plumbing',
  pored: 'poured',
  pourred: 'poured',
  qty: 'quantity',
  reinforcment: 'reinforcement',
  schedueld: 'scheduled',
  sewar: 'sewer',
  struct: 'structural',
  structual: 'structural',
  teh: 'the',
  thik: 'thick',
  thikness: 'thickness',
  widht: 'width',
});

const QUESTION_PHRASE_CORRECTIONS: readonly (readonly [RegExp, string])[] = Object.freeze([
  Object.freeze([/\bwhat['’]s\b/gi, 'what is']),
  Object.freeze([/\bwhere['’]s\b/gi, 'where is']),
  Object.freeze([/\bhow['’]s\b/gi, 'how is']),
  Object.freeze([/\bwho['’]s\b/gi, 'who is']),
  Object.freeze([/\bwhen['’]s\b/gi, 'when is']),
  Object.freeze([/\bhaz[\s./-]*mat(?:erial)?s?\b/gi, 'hazardous material']),
  Object.freeze([/\bp[\s./-]*c[\s./-]*c\b\.?/gi, 'pcc']),
  Object.freeze([/\belec\.(?=\s|$)/gi, 'electrical']),
  Object.freeze([/\bmech\.(?=\s|$)/gi, 'mechanical']),
  Object.freeze([/\bplbg\.(?=\s|$)/gi, 'plumbing']),
  Object.freeze([/\bstruct\.(?=\s|$)/gi, 'structural']),
  Object.freeze([/\blandsc\.(?=\s|$)/gi, 'landscape']),
  Object.freeze([/\bconc\.(?=\s|$)/gi, 'concrete']),
  Object.freeze([/\bpav\.(?=\s|$)/gi, 'paving']),
  Object.freeze([/\bqty\.(?=\s|$)/gi, 'quantity']),
  Object.freeze([/\ba[\s./-]*c\s+(?=pav(?:e|ed|ement|ing)\b)/gi, 'ac ']),
  Object.freeze([/\bair[\s-]+flow\b/gi, 'airflow']),
  Object.freeze([/\bcement\s+(slab|paving|pavement|pad|walkway)\b/gi, 'concrete $1']),
  Object.freeze([/\bhow many foot[\s-]+candles?\b/gi, 'what light levels']),
  Object.freeze([/\bfoot[\s-]+candles?\b/gi, 'foot-candles']),
  Object.freeze([/\bweather[\s-]*proof(?:ed|ing)?\b/gi, 'weather-protected']),
  Object.freeze([/\bwashrooms?\b/gi, 'restrooms']),
  Object.freeze([/\bbathrooms?\b/gi, 'restrooms']),
  Object.freeze([/\bback[\s-]+side\b/gi, 'rear side']),
]) as readonly (readonly [RegExp, string])[];

const LEADING_CONFIRMATION_SCAFFOLD = new RegExp(
  String.raw`^(?:(?:hey|hi)\s+ecos\s*[,.:;-]?\s*)?` +
    String.raw`(?:` +
    String.raw`(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:check|tell\s+me|let\s+me\s+know)|` +
    String.raw`(?:please\s+)?check|do\s+you\s+know|` +
    String.raw`i(?:'d|\s+would)?\s+like\s+to\s+know|i\s+need\s+to\s+know` +
    String.raw`)\s+(?:if|whether)\s+`,
  'i',
);

const SPOKEN_PROJECT_IDENTIFIERS: readonly (readonly [RegExp, string])[] = Object.freeze([
  Object.freeze([/\b(?:twenty[\s-]+three|two\s+three)\s+(?:seventy[\s-]+five|seven\s+five)\b/gi, '2375']),
  Object.freeze([/\b(?:twenty[\s-]+three|two\s+three)\s+(?:twenty[\s-]+one|two\s+one)\b/gi, '2321']),
]) as readonly (readonly [RegExp, string])[];

const LEADING_CONVERSATIONAL_SCAFFOLD = new RegExp(
  String.raw`^(?:(?:hey|hi)\s+ecos\s*[,.:;-]?\s*)?` +
    String.raw`(?:` +
    String.raw`(?:can|could|would|will)\s+you\s+(?:please\s+)?` +
    String.raw`(?:tell\s+me|let\s+me\s+know|look\s+up|find\s+out|check|show\s+me|give\s+me)|` +
    String.raw`(?:please\s+)?(?:tell\s+me|let\s+me\s+know|look\s+up|find\s+out|check|show\s+me)|` +
    String.raw`i(?:'d|\s+would)?\s+like\s+to\s+know|i\s+need\s+to\s+know|do\s+you\s+know` +
    String.raw`)\s+(?:about\s+)?`,
  'i',
);

function preserveTokenCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) {
    return `${replacement[0]?.toUpperCase() || ''}${replacement.slice(1)}`;
  }
  return replacement;
}

export function canonicalizeECOSQuestionLanguage(value: string) {
  let normalized = value
    .replace(/\p{Cf}/gu, '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―−]/g, '-');
  for (const [pattern, replacement] of SPOKEN_PROJECT_IDENTIFIERS) {
    normalized = normalized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of QUESTION_PHRASE_CORRECTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized.replace(/[a-z]+/gi, token => {
    const replacement = QUESTION_TOKEN_CORRECTIONS[token.toLowerCase()];
    return replacement ? preserveTokenCase(token, replacement) : token;
  });
  return normalized
    .replace(LEADING_CONFIRMATION_SCAFFOLD, 'Confirm whether ')
    .replace(LEADING_CONVERSATIONAL_SCAFFOLD, '')
    .replace(/\s+/g, ' ')
    .trim();
}
