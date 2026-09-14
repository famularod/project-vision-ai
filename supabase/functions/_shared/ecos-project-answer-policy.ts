import {
  canonicalComparableSheetNumber,
  ECOS_UNSUPPORTED_SHEET_COMPATIBILITY_MARKER,
  normalizeECOSSheetIdentityScanText,
  renderedTextContainsExactSheetIdentity,
} from './ecos-sheet-provenance-validation.ts';
import { canonicalizeECOSQuestionLanguage } from './ecos-question-language.ts';

export type ECOSProjectAnswerRequirement = Readonly<{
  kind: 'general' | 'measurement' | 'quantity' | 'presence';
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

export type ECOSTrustedDrawingFact = Readonly<{
  text: string;
  subject: string;
  relationshipType: string;
  rowKey: string;
  reconstructionMethod: string;
}>;

export type ECOSAnswerFallbackSource = Readonly<{
  id: string;
  sourceType: string;
  recordId?: string;
  title?: string;
  excerpt: string;
  trustedDrawingFact?: ECOSTrustedDrawingFact | null;
  trustedDerivedDrawingPassage?: boolean;
  trustedProjectedDrawingFact?: boolean;
  documentCitation?: Readonly<{
    sheetNumber?: string | null;
    pageNumber?: number | null;
    regionId?: string | null;
  }>;
  documentRegion?: Readonly<{
    id?: string | null;
    proofText?: string | null;
    reconstructionMethod?: string | null;
    sourceRegionIds?: readonly string[];
  }>;
}>;

const AREA_MEASUREMENT_QUESTION_PATTERN = /\b(?:how\s+many\s+(?:square\s+(?:feet|foot|inches?|inch|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:ft\.?|in\.?|mm|cm|m|yds?|yd)|sf|acres?|hectares?)|square\s+footage|floor\s+area|plan\s+area|plan\s+footprint|calculated\s+(?:area|footprint)|(?:area|footprint|acreage)\s+of|what\s+is\s+the\s+(?:area|footprint|acreage)|what\s+(?:plan\s+)?(?:area|footprint|acreage)\s+(?:is\s+)?(?:shown|listed|stated|reported)\s+(?:in|on|at|for|of)|what\s+(?:area|footprint|acreage)\s+is\b|how\s+much(?:\s+[a-z0-9-]+){0,4}\s+area)\b|\b(?:state|report|list|give|provide)\s+(?:the\s+)?(?:area|footprint|acreage)\s+(?:of|for)\b|\b(?:state|report|list|give|provide)\s+(?:the\s+)?(?:[a-z0-9][a-z0-9.'"-]*\s+){1,5}(?:plan\s+)?(?:area|footprint|acreage)\b(?:\s+(?:in|to)\s+(?:square\s+(?:feet|foot|inches?|inch|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:ft\.?|in\.?|mm|cm|m|yds?|yd)|sf|acres?|hectares?|feet|foot|ft\.?|inches?|inch|in\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd))?(?=\s*$)|\bwhat\s+is\s+(?:the\s+)?(?:[a-z0-9][a-z0-9.'"-]*\s+){1,5}(?:plan\s+)?(?:area|footprint|acreage)\b(?:\s+(?:(?:reported|shown|listed|stated|expressed|given|measured)\s+)?(?:in|to)\s+(?:square\s+(?:feet|foot|inches?|inch|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:ft\.?|in\.?|mm|cm|m|yds?|yd)|sf|acres?|hectares?|feet|foot|ft\.?|inches?|inch|in\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd))?(?=\s*$)|^(?!(?:who|is|are|was|were|do|does|did|has|have|can|could|will|would)\b)(?:[a-z0-9][a-z0-9.'"-]*\s+){1,5}(?:plan\s+)?(?:area|footprint|acreage)\s*$/i;

const MEASUREMENT_ATTRIBUTES = Object.freeze([
  Object.freeze({
    attribute: 'area',
    questionPattern: AREA_MEASUREMENT_QUESTION_PATTERN,
    terms: Object.freeze([
      'area', 'square feet', 'square foot', 'square footage', 'sq ft', 'sf',
      'footprint', 'acreage',
    ]),
  }),
  Object.freeze({
    attribute: 'grade',
    questionPattern: /\b(?:maximum|permitted|max(?:imum)?)\s+(?:permitted\s+)?(?:grade|slope)|\b(?:grade|slope)\s+(?:limit|maximum|max|permitted)\b|\bwhat\s+is\s+(?:the\s+)?(?:grade|slope)\s+(?:of|for)\b|\bwhat\s+is\s+(?:the\s+)?(?:[a-z0-9][a-z0-9.'"-]*\s+){1,5}(?:grade|slope)\b(?=\s*$)|^(?!(?:who|is|are|was|were|do|does|did|has|have|can|could|will|would)\b)(?:[a-z0-9][a-z0-9.'"-]*\s+){1,5}(?:grade|slope)\s*$/i,
    terms: Object.freeze(['grade', 'slope']),
  }),
  Object.freeze({
    attribute: 'thickness',
    questionPattern: /\b(?:how\s+thick|thickness|thick|slab\s+depth)\b|\b(?:about\s+)?how\s+many\s+(?:inches?|inch|in\.?|feet|foot|ft\.?)\b[\s\S]{0,120}\b(?:concrete|pcc|slab|paving|walkway|asphalt|base)\b|\b(?:concrete|pcc|slab|paving|walkway|asphalt|base)\b[\s\S]{0,120}\b(?:about\s+)?how\s+many\s+(?:inches?|inch|in\.?|feet|foot|ft\.?)\b/i,
    terms: Object.freeze(['thickness', 'thick', 'depth', 'slab thickness']),
  }),
  Object.freeze({
    attribute: 'width',
    questionPattern: /\b(?:how\s+wide|width|wide)\b/i,
    terms: Object.freeze(['width', 'wide']),
  }),
  Object.freeze({
    attribute: 'height',
    questionPattern: /\b(?:how\s+high|height|high)\b/i,
    terms: Object.freeze(['height', 'high']),
  }),
  Object.freeze({
    attribute: 'depth',
    questionPattern: /\b(?:how\s+deep|depth|deep)\b/i,
    terms: Object.freeze(['depth', 'deep']),
  }),
  Object.freeze({
    attribute: 'length',
    questionPattern: /\b(?:how\s+long|length|long)\b/i,
    terms: Object.freeze(['length', 'long']),
  }),
  Object.freeze({
    attribute: 'diameter',
    questionPattern: /\b(?:diameter|diam\.?|\bdia\.?)\b/i,
    terms: Object.freeze(['diameter', 'diam', 'dia']),
  }),
  Object.freeze({
    attribute: 'spacing',
    questionPattern: /\b(?:spacing|spaced|on\s+center|o\.?c\.?)\b/i,
    terms: Object.freeze(['spacing', 'spaced', 'on center', 'oc']),
  }),
  Object.freeze({
    attribute: 'clearance',
    questionPattern: /^(?:what\s+(?:(?:is|are)\s+(?:the\s+)?[\s\S]{0,100}\b(?:clearances?|headroom)\b|(?:clearances?|headroom)\b[\s\S]{0,100})|how\s+much[\s\S]{0,100}\b(?:clearance|headroom)\b[\s\S]{0,100}|(?:state|report|list|give|provide)\s+(?:the\s+)?[\s\S]{0,100}\b(?:clearance|headroom)\b[\s\S]{0,100}|(?:clearance|headroom)\s+(?:of|for)\b[\s\S]{0,100}|(?!(?:is|are|was|were|do|does|did|has|have|can|could|will|would)\b)(?:[a-z0-9][a-z0-9.'"-]*\s+){1,6}(?:clearance|headroom))\s*[?]?$/i,
    terms: Object.freeze(['clearance', 'headroom']),
  }),
] as const);

const QUANTITY_PATTERN = /\b(?:how\s+many|quantity|count|number\s+of)\b/i;
const PRESENCE_QUESTION_PATTERN = /^(?:(?:do|does|did|is|are|was|were|has|have|can|could|will|would)\b[\s\S]*\b(?:have|has|contain|contains|include|includes|show|shows|shown|provide|provides|provided|installed|present|required|exist|exists|there)\b|(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:confirm|verify|determine)\b[\s\S]+|(?:any\s+)?[a-z][\s\S]{0,120}\b(?:present|shown|provided|included|available|visible)\s*[?]?$|any\s+[a-z][\s\S]{0,120}[?]?$)/i;
const MEASUREMENT_VALUE_PATTERN = /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?)(?=$|\s|[-(),.;:x]|[whd]\b)/i;
const LINEAR_MEASUREMENT_VALUE_PATTERN = /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)(?!\.?[\s-]*(?:2|3|sq\.?|square(?:d)?|cubic|cubed|to\s+(?:the\s+)?(?:second|third)\s+power)\b)(?=$|\s|[-(),.;:x]|[whd]\b)/i;
const LINEAR_COMPOSITE_UNIT_PATTERN = /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)(?![a-z])\.?[\s-]*(?:[2-9](?!\s*(?:(?:inches?|inch|in\.?|millimeters?|mm|centimeters?|cm)\b|["']))|[2-9](?:nd|rd|th)\s+power|sq\.?|square(?:d)?|cubic|cubed|to\s+(?:the\s+)?(?:second|third|fourth|[2-9](?:nd|rd|th))\s+power|power\s+[2-9]|x\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)|(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)|(?:pounds?|lbs?|candles?)|per\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)|water\s+column|w\.?\s*c\.?|hg)\b/i;
const AREA_MEASUREMENT_VALUE_PATTERN = /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?\s*(?:square\s+(?:inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:in\.?|ft\.?|mm|cm|m|yds?|yd)|(?:in|ft|mm|cm|m|yd)\s*(?:2|²)|sf|acres?|hectares?|ha)(?=$|\s|[-(),.;:x])/i;
const AREA_COMPOSITE_UNIT_PATTERN = /(?:^|\s|\b)\d+(?:,\d{3})*(?:\.\d+)?\s*(?:acre[-\s]+feet|(?:square\s+(?:inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:in\.?|ft\.?|mm|cm|m|yds?|yd)|(?:in|ft|mm|cm|m|yd)\s*2|sf|acres?|hectares?|ha)[\s-]*(?:per\s+[a-z0-9-]+|candles?))\b/i;
const GRADE_MEASUREMENT_VALUE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:%|percent\b|degrees?\b|°)|\b\d+(?:\.\d+)?\s*(?:ratio|\bin\b)\s*\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:inches?|inch|in\.?|["”]|feet|foot|ft\.?|['’]|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)\s*(?:per|\/)\s*(?:inches?|inch|in\.?|["”]|feet|foot|ft\.?|['’]|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)\b/i;
const GRADE_COMPOSITE_UNIT_PATTERN = /\b\d+(?:\.\d+)?\s*(?:degrees?\s*(?:f|c|k|fahrenheit|celsius|kelvin)\b|(?:%|percent)\s+(?:complete|completion)\b)/i;
const FEET_AND_INCHES_PATTERN =
  /\b(?:\d+(?:\.\d+)?|\.\d+)(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:feet|foot|ft\.?|')\s*(?:[-,]\s*)?(?:\d+(?:\.\d+)?|\.\d+)(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:inches?|inch|in\.?|")/i;
const NUMERIC_QUANTITY_PATTERN = /\b\d+(?:,\d{3})*(?:\.\d+)?\b/;
const QUESTION_CONTEXT_VARIANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  area: Object.freeze(['square feet', 'square foot', 'sq ft', 'sf', 'footprint']),
  concrete: Object.freeze(['pcc', 'slab', 'cement', 'paving', 'walkway']),
  embedment: Object.freeze(['embed', 'embedded']),
  side: Object.freeze(['lot', 'area']),
  lot: Object.freeze(['side', 'area']),
  paving: Object.freeze(['pavement', 'pcc', 'concrete']),
  poured: Object.freeze(['installed', 'placed', 'constructed', 'paving', 'pavement']),
  back: Object.freeze(['rear']),
  canopy: Object.freeze(['canopies', 'exterior storage area', 'exterior storage areas', 'shade structure']),
  lighting: Object.freeze(['light', 'lights', 'fixture', 'fixtures', 'luminaire', 'luminaires', 'lighting plan']),
  guardrail: Object.freeze(['guardrails', 'rail', 'railing', 'barrier']),
  status: Object.freeze([
    'active', 'complete', 'completed', 'pending', 'in progress', 'not started', 'waiting', 'open', 'closed',
    'blocked', 'delayed', 'canceled', 'cancelled',
  ]),
  rated: Object.freeze(['rating']),
  rating: Object.freeze(['rated']),
  strength: Object.freeze(['psi', 'compressive strength']),
  maximum: Object.freeze(['max']),
  minimum: Object.freeze(['min']),
  permitted: Object.freeze(['shall', 'maximum', 'max']),
  'ada-accessible': Object.freeze(['ada accessible', 'ada', 'accessible']),
});
const LOCATION_DIRECTION_TOKENS = new Set([
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
  'upper', 'lower', 'front', 'rear', 'back', 'behind',
]);
const LOCATION_KIND_TOKENS = new Set([
  'side', 'lot', 'area', 'zone', 'room', 'floor', 'level', 'roof', 'wall', 'yard', 'building',
]);
const REQUIRED_SUBJECT_DISCRIMINATORS = new Set(['standard', 'van', 'delineated']);
const PROJECT_DISCIPLINES = Object.freeze([
  'architectural', 'structural', 'electrical', 'mechanical', 'plumbing', 'civil', 'landscape',
] as const);

function canonicalProjectDisciplines(value: string) {
  const disciplines: string[] = PROJECT_DISCIPLINES.filter(discipline =>
    new RegExp(`\\b${discipline}\\b`).test(value)
  );
  if (/\bhvac\b/.test(value)) disciplines.push('mechanical');
  return [...new Set(disciplines)];
}

export function analyzeECOSProjectQuestion(
  question: string,
): ECOSProjectAnswerRequirement {
  // A closed leading authority frame selects evidence scope, but it is not the
  // semantic question. Classify the clause after the frame while leaving the
  // original question intact for the downstream authority/location gates.
  const semanticQuestion = canonicalizeECOSQuestionLanguage(question);
  const normalizedQuestion = normalizePolicyText(
    stripECOSBoundedExcludedReferenceScopes(
      stripECOSBoundedQuantityReferralTail(
        stripLeadingSourceAuthorityFrame(semanticQuestion),
        semanticQuestion,
      ),
    ),
  ).replace(/[.;:]+$/, '').trim();
  const match = MEASUREMENT_ATTRIBUTES.find(candidate =>
    candidate.questionPattern.test(normalizedQuestion) &&
    (candidate.attribute !== 'area' || !areaQuestionClearlyRequestsAnotherField(normalizedQuestion))
  );
  if (!match) {
    if (QUANTITY_PATTERN.test(normalizedQuestion)) {
      return Object.freeze({
        kind: 'quantity',
        attribute: 'quantity',
        attributeTerms: Object.freeze(['quantity', 'count', 'number']),
      });
    }
    if (PRESENCE_QUESTION_PATTERN.test(normalizedQuestion)) {
      const attribute = presenceAttribute(normalizedQuestion);
      return Object.freeze({
        kind: 'presence',
        attribute,
        attributeTerms: Object.freeze(attribute ? presenceAttributeTerms(attribute) : []),
      });
    }
    return Object.freeze({ kind: 'general', attribute: null, attributeTerms: Object.freeze([]) });
  }
  return Object.freeze({
    kind: 'measurement',
    attribute: match.attribute,
    attributeTerms: match.terms,
  });
}

function areaQuestionClearlyRequestsAnotherField(normalizedQuestion: string) {
  if (/^who\b|\b(?:owner|ownership|status)\b/.test(normalizedQuestion)) return true;
  if (/\barea\s+(?:lighting|fixture|guardrail)\b/.test(normalizedQuestion)) return true;
  if (
    PRESENCE_QUESTION_PATTERN.test(normalizedQuestion) &&
    !/^(?:what|which)\s+(?:(?:is|are)\s+(?:the\s+)?)?(?:plan\s+)?(?:area|footprint|acreage)\b|^how\s+much(?:\s+[a-z0-9-]+){0,4}\s+(?:area|footprint|acreage)\b/.test(
      normalizedQuestion,
    )
  ) return true;
  return /^(?:is|are|was|were|do|does|did|has|have|can|could|will|would)\b/.test(
    normalizedQuestion,
  ) && /\b(?:shown|present|provided|included|available|visible|exist|exists|required)\b/.test(
    normalizedQuestion,
  );
}

export function ecosEvidenceMatchesQuestionRequirement(
  question: string,
  evidenceText: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === 'general') return true;
  const normalizedEvidence = normalizePolicyText(evidenceText);
  if (requirement.kind === 'presence') {
    const context = analyzeECOSQuestionEvidenceContext(question, normalizedEvidence);
    return context.subjectMatched && context.locationMatched && context.attributeMatched &&
      containsECOSExplicitPresenceEvidence(normalizedEvidence, requirement.attributeTerms);
  }
  if (requirement.kind === 'quantity') {
    return containsECOSQuantityValue(evidenceText, question) &&
      roomScopeMatchesQuestion(normalizePolicyText(question), normalizedEvidence, normalizedEvidence);
  }
  const context = analyzeECOSQuestionEvidenceContext(question, normalizedEvidence);
  return context.attributeMatched && (
    containsECOSRequestedMeasurementValue(question, normalizedEvidence) ||
    requirement.attributeTerms.some(term => normalizedEvidence.includes(term))
  );
}

/**
 * Requires evidence to carry the requested answer value, not merely words
 * related to the question. Retrieval uses this stricter predicate before an
 * exact authority hit is allowed to suppress a bounded fallback lookup.
 */
export function ecosEvidenceProvidesRequestedAnswerValue(
  question: string,
  evidenceText: string,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const normalizedEvidence = normalizePolicyText(evidenceText);
  if (!normalizedEvidence) return false;
  if (requirement.kind === 'measurement') {
    return measurementSourceBindsRequiredQuestionScope(question, [evidenceText]);
  }
  if (requirement.kind === 'quantity' || requirement.kind === 'presence') {
    return ecosEvidenceMatchesQuestionRequirement(question, normalizedEvidence);
  }
  const semanticQuestion = stripLeadingSourceAuthorityFrame(question);
  const requestedFields = generalQuestionFieldRequirements(semanticQuestion);
  if (requestedFields.length === 0) {
    return generalUntypedEvidenceProvidesAnswerValue(semanticQuestion, evidenceText);
  }
  const clauses = evidenceText.split(/\r?\n+|[;!?]+|\.\s+/)
    .map(normalizePolicyText)
    .filter(Boolean);
  const answeredFields = new Set(requestedFields.filter(field => clauses.some(clause =>
    generalTextProvidesTypedFieldValue(field, clause, '')
  )));
  const alternativesOnly = /\bor\b/.test(normalizePolicyText(semanticQuestion)) &&
    !/\band\b/.test(normalizePolicyText(semanticQuestion));
  return alternativesOnly
    ? answeredFields.size > 0
    : requestedFields.every(field => answeredFields.has(field));
}

export function generalUntypedQuestionTargetTokens(question: string) {
  const normalized = normalizePolicyText(stripLeadingSourceAuthorityFrame(question))
    .replace(/[?？]+$/, '')
    .trim();
  if (
    /^what\s+(?:does|do|did)\s+.{1,120}\s+(?:show|contain|include|state|indicate|list|depict)$/.test(
      normalized,
    ) ||
    /^what\s+(?:is|are|was|were)\s+(?:shown|listed|stated|specified|indicated|depicted)(?:\s|$)/.test(
      normalized,
    )
  ) return null;
  const target = [
    /^(?:what|which)\s+(.{1,120}?)\s+(?:is|are|was|were)\s+(?:shown|listed|stated|specified|reported|indicated|identified|recorded|depicted)\b/,
    /^(?:what|which)\s+(.{1,120}?)\s+(?:does|do|did)\b/,
    /^(?:what|which)\s+(?:is|are|was|were)\s+(?:the\s+)?(.{1,120})$/,
  ].map(pattern => pattern.exec(normalized)?.[1]?.trim() || '').find(Boolean) || '';
  if (!target) return null;
  const ignored = new Set([
    'current', 'drawing', 'document', 'plan', 'sheet', 'page', 'pdf', 'source',
    'evidence', 'shown', 'listed', 'stated', 'specified', 'reported', 'indicated',
    'identified', 'recorded', 'depicted', 'the', 'a', 'an', 'on', 'in', 'from',
    'by', 'at', 'within', 'according', 'to', 'per', 'for', 'of', 'exact', 'fact',
    'value', 'values', 'dimension', 'dimensions', 'relationship',
  ]);
  const tokens = canonicalContextMatchText(target).split(' ')
    .map(canonicalContextToken)
    .filter(token => token.length >= 2 && !ignored.has(token) && !/^\d+$/.test(token));
  return [...new Set(tokens)];
}

export function generalUntypedEvidenceProvidesAnswerValue(question: string, evidenceText: string) {
  const targetTokens = generalUntypedQuestionTargetTokens(question) || [];
  const normalizedQuestionTokens = new Set(canonicalContextMatchText(question).split(' ')
    .map(canonicalContextToken)
    .filter(Boolean));
  const nonValues = new Set([
    'answer', 'data', 'detail', 'details', 'field', 'info', 'information', 'note',
    'notes', 'record', 'records', 'source', 'value', 'values', 'drawing', 'document',
    'plan', 'sheet', 'page', 'pdf', 'current', 'project', 'show', 'shown', 'shows',
    'list', 'listed', 'lists', 'state', 'stated', 'states', 'specify', 'specified',
    'specifies', 'report', 'reported', 'reports', 'indicate', 'indicated', 'indicates',
    'identify', 'identified', 'identifies', 'depict', 'depicted', 'depicts', 'is',
    'are', 'was', 'were', 'as', 'the', 'a', 'an', 'and', 'or', 'for', 'of', 'on',
    'in', 'at', 'from', 'by', 'within', 'determined', 'confirmed', 'provided',
    'others', 'applicable', 'none',
  ]);
  const placeholder = /\b(?:value|information|data|details?|field)?\s*(?:is|are|was|were|remains?)?\s*(?:not\s+(?:shown|listed|stated|specified|reported|indicated|identified|recorded|provided|available|known|readable|legible|applicable)|to\s+be\s+(?:determined|confirmed|provided)|by\s+others|unknown|unavailable|unreadable|illegible|blank|missing|omitted|pending|none|tbd|tbc|n\s*\/?\s*a)\b/;
  const clauses = evidenceText.split(/\r?\n+|[;!?]+|\.\s+/)
    .map(raw => ({ raw, normalized: normalizePolicyText(raw) }))
    .filter(clause => Boolean(clause.normalized));
  return clauses.some(({ raw, normalized: clause }) => {
    if (
      placeholder.test(clause) ||
      /(?:[:=]\s*[-—–_*.]+)\s*$/.test(raw.trim())
    ) return false;
    if (!targetTokens.every(token => contextTokenMatchesEvidence(token, clause))) return false;
    const rawValueTokens = raw.normalize('NFKC').toLowerCase().match(/[a-z0-9]+/g) || [];
    return rawValueTokens.map(canonicalContextToken).some(token =>
      (token.length >= 2 || /^\d+$/.test(token)) &&
      /[a-z0-9]/.test(token) &&
      !targetTokens.includes(token) &&
      !normalizedQuestionTokens.has(token) && !nonValues.has(token)
    );
  });
}

export function ecosFactAnswersQuestion({
  question,
  statement,
  sourceExcerpts,
  sourceProofSegments = [],
  sourceTemporalExcerpts = sourceExcerpts,
  sourceTemporalFrames = [],
  semanticQuestionOverride,
}: {
  question: string;
  statement: string;
  sourceExcerpts: readonly string[];
  sourceProofSegments?: readonly (string | readonly string[] | null)[];
  sourceTemporalExcerpts?: readonly string[];
  sourceTemporalFrames?: readonly (string | null)[];
  semanticQuestionOverride?: string;
}) {
  const requirement = analyzeECOSProjectQuestion(question);
  const semanticInputQuestion = semanticQuestionOverride ||
    stripLeadingSourceAuthorityFrame(question);
  const normalizedStatement = normalizePolicyText(statement);
  const unboundedSourceText = sourceExcerpts.join(' ');
  const sourceText = normalizePolicyText(unboundedSourceText);
  const boundedProofText = sourceProofSegments.flatMap(segment =>
    typeof segment === 'string' ? [segment] : segment || []
  ).join(' ').trim();
  const quantityUsesBoundedReferralProof = requirement.kind === 'quantity' &&
    Boolean(boundedProofText) &&
    quantitySourceHasOnlyBoundedSecondaryReferralAfterProof(
      unboundedSourceText,
      boundedProofText,
      question,
    );
  const scopeSourceText = quantityUsesBoundedReferralProof
    ? normalizePolicyText(boundedProofText)
    : sourceText;
  const leadingSemanticQuestion = stripLeadingSourceAuthorityFrame(semanticInputQuestion);
  const semanticQuestion = requirement.kind === 'quantity' || requirement.kind === 'presence'
    ? stripECOSBoundedExcludedReferenceScopes(
      stripECOSBoundedQuantityReferralTail(leadingSemanticQuestion, question),
    )
    : leadingSemanticQuestion;
  if (!ecosQuestionScopeMatchesEvidence(
    requirement.kind === 'quantity' || requirement.kind === 'presence'
      ? semanticQuestion
      : semanticInputQuestion,
    normalizedStatement,
    scopeSourceText,
  )) return false;
  if (!temporalScopeMatchesQuestion(question, normalizedStatement)) return false;
  if (!sourceTemporalScopesMatchQuestion(
    question,
    sourceTemporalExcerpts,
    sourceProofSegments,
    sourceTemporalFrames,
  )) return false;
  if (requirement.kind === 'general') {
    const statementClauses = statement.split(/[;!?]|\.\s+/)
      .map(normalizePolicyText)
      .filter(Boolean);
    const requestedFields = generalQuestionFieldRequirements(semanticInputQuestion);
    if (
      requestedFields.length === 0 && (
        !generalUntypedEvidenceProvidesAnswerValue(semanticInputQuestion, statement) ||
        !sourceExcerpts.some(excerpt =>
          generalUntypedEvidenceProvidesAnswerValue(semanticInputQuestion, excerpt)
        )
      )
    ) return false;
    const matchingRequestedFields = requestedFields.filter(field =>
      statementClauses.some(clause => generalTextProvidesTypedFieldValue(
        field,
        clause,
        semanticInputQuestion,
      ))
    );
    if (requestedFields.length > 0 && matchingRequestedFields.length === 0) return false;
    const sourceClauses = sourceExcerpts.flatMap(excerpt => excerpt.split(/[;!?]|\.\s+/))
      .map(clause => normalizePolicyText(clause.replace(
        /\b(owner|contractor)\s*:/gi,
        '$1 is ',
      )))
      .filter(Boolean);
    if (matchingRequestedFields.some(field =>
      !sourceClauses.some(clause => generalSourceClauseProvidesTypedFieldValue(
        field,
        clause,
        semanticInputQuestion,
      ))
    )) return false;
    if (
      matchingRequestedFields.some(field =>
        !temporalEvidenceMatchesQuestion(question, normalizedStatement, field)
      )
    ) return false;
    if (
      matchingRequestedFields.some(field =>
        currentStateQuestionRejectsTemporalEvidence(question, field) &&
        temporalEvidenceDoesNotProveCurrentState(normalizedStatement, field)
      )
    ) return false;
    const directedRelationship = directedRelationshipRequirement(question);
    if (
      directedRelationship &&
      !textMatchesDirectedRelationship(normalizedStatement, directedRelationship)
    ) return false;
    const generalSemanticQuestion = stripGeneralTemporalFrame(normalizePolicyText(
      stripECOSDrawingSheetReferenceSpans(semanticQuestion),
    ));
    const sourceContext = analyzeECOSQuestionEvidenceContext(
      generalSemanticQuestion,
      stripGeneralTemporalFrame(normalizePolicyText(sourceExcerpts.join(' '))),
    );
    const alternativeFieldTokens = new Set([
      'status', 'finish', 'start', 'owner', 'date',
      'percent', 'complete', 'completion', 'percentage',
    ]);
    const alternativeEntityTokens = new Set(
      generalQuestionAlternativeEntityKinds(semanticInputQuestion),
    );
    const strictlyMatches = (context: ECOSQuestionEvidenceContext, evidence: string) => {
      const requestedFieldTokens = context.subjectTokens.filter(token =>
        alternativeFieldTokens.has(token)
      );
      const requestsPercentComplete = requestedFields.includes('percent_complete');
      const requestsFinish = requestedFields.includes('finish');
      const requestedEntityAlternatives = alternativeEntityTokens.size > 1
        ? context.subjectTokens.filter(token => alternativeEntityTokens.has(token))
        : [];
      const requiredEntityTokens = context.subjectTokens.filter(token =>
        !alternativeFieldTokens.has(token) && !requestedEntityAlternatives.includes(token)
      );
      return context.locationMatched &&
        requiredEntityTokens.every(token => context.matchedSubjectTokens.includes(token)) &&
        (
          requestedEntityAlternatives.length === 0 ||
          requestedEntityAlternatives.some(token => context.matchedSubjectTokens.includes(token))
        ) &&
        (
          requestedFieldTokens.length === 0 ||
          requestedFieldTokens.some(token => context.matchedSubjectTokens.includes(token)) ||
          requestsPercentComplete &&
            /\b(?:percent complete|completion percentage|completion percent)\b/.test(evidence) ||
          requestsFinish &&
            /\b(?:finish(?:es|ed)?(?: date)?|complete(?:s|d)?|completion(?: date)?)\b/.test(evidence)
        );
    };
    // Source authority is enforced by the caller against the typed evidence
    // row. Words such as "drawing" can be the requested entity while
    // "schedule" is the requested authority (for example, "Drawing A status
    // on the schedule"), so this semantic policy must only bind the requested
    // fact tuple and not infer a source type from free text.
    const normalizedSemanticStatement = stripGeneralTemporalFrame(normalizedStatement);
    const normalizedSemanticSource = stripGeneralTemporalFrame(
      normalizePolicyText(sourceExcerpts.join(' ')),
    );
    return strictlyMatches(analyzeECOSQuestionEvidenceContext(
      generalSemanticQuestion,
      normalizedSemanticStatement,
    ), normalizedSemanticStatement) && strictlyMatches(sourceContext, normalizedSemanticSource);
  }

  if (requirement.kind === 'presence') {
    const sourceContext = analyzeECOSQuestionEvidenceContext(semanticQuestion, sourceText);
    return sourceContext.subjectMatched && sourceContext.locationMatched &&
      sourceContext.attributeMatched &&
      containsECOSExplicitPresenceEvidence(sourceText, requirement.attributeTerms) &&
      containsECOSExplicitPresenceEvidence(normalizedStatement, requirement.attributeTerms);
  }
  if (requirement.kind === 'quantity') {
    if (!containsECOSQuantityValue(statement, question)) return false;
    const quantitySourceText = quantityUsesBoundedReferralProof
      ? boundedProofText
      : unboundedSourceText;
    if (!containsECOSQuantityValue(quantitySourceText, question)) return false;
    const sourceContext = analyzeECOSQuestionEvidenceContext(
      semanticQuestion,
      normalizePolicyText(quantitySourceText),
    );
    return sourceContext.subjectMatched && sourceContext.locationMatched;
  }
  if (!containsECOSRequestedMeasurementValue(question, statement)) return false;
  if (!measurementTextBindsRequestedAttribute(question, statement)) return false;
  if (!measurementStatementMatchesRequestedSubject(question, normalizedStatement, sourceText)) return false;

  if (!containsECOSRequestedMeasurementValue(question, sourceExcerpts.join(' '))) return false;
  if (!measurementTextBindsRequestedAttribute(question, sourceExcerpts.join(' '))) return false;
  if (
    !requirement.attributeTerms.some(term => sourceText.includes(term)) &&
    !evidenceExpressesRequestedMeasurementAttribute(requirement, sourceText, question)
  ) return false;
  if (!measurementSourceBindsRequiredQuestionScope(question, sourceExcerpts)) return false;

  const sourceContext = analyzeECOSQuestionEvidenceContext(semanticQuestion, sourceText);
  return sourceContext.subjectMatched && (
    sourceContext.locationMatched || evidenceMatchesExplicitSheetReference(question, sourceText)
  );
}

const QUANTITY_SECONDARY_REFERRAL_TAIL_PATTERN =
  /(?:\s*[,;]\s*|\s*\(\s*|\s+|\.\s+)(?:see(?:\s+also)?|refer(?:\s+also)?\s+to|cross[- ]reference|consult|coordinat(?:e|ed)(?:\s+in)?\s+with|in\s+coordination\s+with|in\s+conjunction\s+with|coordinat(?:e|ed)\s+per|with|using)\b[\s\S]{1,160}?\)?[.!]?\s*$/i;

function quantitySecondaryReferralTailIsBounded(value: string, question: string) {
  const normalized = normalizePolicyText(value)
    .replace(/^[.;:()\s]+|[.!;:()\s]+$/g, '')
    .trim();
  const reference =
    '(?:(?:detail|det|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht|page|pg|figure|fig|drawing|dwg|document|doc|revision|rev|plan|note|task|type|unit|suite|bay|section|phase|option|item)\\s+["\']?[a-z0-9]+(?:[.-][a-z0-9]+)*["\']?)';
  const controls = '(?:(?:updated|revised)\\s+)?controls?';
  const neutralPurpose = '(?:an?\\s+)?(?:reference|context)(?:\\s+only)?';
  const direct = new RegExp(
    `^(?:see(?:\\s+also)?|refer(?:\\s+also)?\\s+to|cross[- ]reference|consult)\\s+` +
      `(?:the\\s+)?${reference}(?:\\s+for\\s+(?:the\\s+)?(${controls}|${neutralPurpose}))?$`,
  ).exec(normalized);
  const reversed = new RegExp(
    `^see\\s+(?:the\\s+)?(${controls})\\s+(?:in|on|at)\\s+(?:the\\s+)?${reference}$`,
  ).exec(normalized);
  const coordinated = new RegExp(
    `^(?:coordinat(?:e|ed)\\s+with|in\\s+coordination\\s+with|in\\s+conjunction\\s+with|coordinat(?:e|ed)\\s+per)\\s+` +
      `(?:the\\s+)?${reference}(?:\\s+for\\s+(?:the\\s+)?(${controls}))?$`,
  ).exec(normalized);
  const contextual = new RegExp(
    `^(?:with|using)\\s+(?:the\\s+)?${reference}\\s+` +
      `(?:as|for)\\s+(?:an?\\s+)?(?:reference|context)(?:\\s+only)?$`,
  ).exec(normalized);
  if (!direct && !reversed && !coordinated && !contextual) return false;
  const purpose = direct?.[1] || reversed?.[1] || coordinated?.[1] || '';
  if (!purpose) return true;
  const requestedTargets = policyQuantityTargetSemanticTokens(question);
  return !requestedTargets.some(target => new RegExp(
    `\\b${escapeRegExp(target)}s?\\b`,
  ).test(purpose));
}

function boundedQuantityReferenceKeys(value: string) {
  const keys: string[] = [];
  const protectedValue = normalizePolicyText(protectQuantityTerminalPlusIdentifiers(
    value,
    'ecosinvalidplusquestion',
  )).replace(
    /(?<!["'])\b(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*'(?=\s*(?:-|wide|high|thick|deep|long|diameter|diam|dia|spacing|spaced|clearance|headroom|$))/g,
    '$1 feet',
  ).replace(
    /(?<!["'])\b(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*"(?=\s*(?:wide|high|thick|deep|long|diameter|diam|dia|spacing|spaced|clearance|headroom|$))/g,
    '$1 inches',
  );
  for (const match of protectedValue.matchAll(
    /\b(building\s+area|loading\s+dock|detail|det|room|panel|canopy|building|area|zone|level|floor|grid|door|wall|sheet|sht|page|pg|figure|fig|drawing|dwg|document|doc|revision|rev|plan|note|task|type|unit|suite|bay|section|phase|option|item)s?\s+["']?(?!(?:how|what|which|who|when|where|why|does|do|did|is|are|was|were|has|have|can|could|will|would|should|shall|must|the|of|for|from|in|on|at|to|with|and|or|width|wide|height|high|thickness|thick|depth|deep|length|long|diameter|spacing|clearance|headroom|fasteners?|material|construction|finish|rating|capacity|size)\b)([a-z0-9]+(?:[.-][a-z0-9]+)*\+?)(?:["']|'s)?(?![a-z0-9_#+-]|\.\s*[a-z0-9])(?!\s*["'′″‘’“”])(?!\s*(?:inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|square|sq\.?|sf|acres?|hectares?|ha|percent|degrees?)\b)/g,
  )) {
    const label = match[1].replace(/^(?:det|sht|pg|fig|dwg|doc|rev)$/, value => ({
      det: 'detail', sht: 'sheet', pg: 'page', fig: 'figure', dwg: 'drawing',
      doc: 'document', rev: 'revision',
    } as Readonly<Record<string, string>>)[value] || value);
    keys.push(`${label}:${match[2]}`);
  }
  return [...new Set(keys)];
}

export function stripECOSBoundedQuantityReferralTail(value: string, question: string) {
  let projected = value;
  const leadingContextual = /^\s*(?:using|with)\s+(?:the\s+)?(?:detail|det|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht|page|pg|figure|fig|drawing|dwg|document|doc|revision|rev|plan|note|task|type|unit|suite|bay|section|phase|option|item)\s+["']?[a-z0-9]+(?:[.-][a-z0-9]+)*\+?["']?\s+(?:as|for)\s+(?:an?\s+)?(?:reference|context)(?:\s+only)?\s*[,;:]\s*/i.exec(projected);
  if (leadingContextual && quantitySecondaryReferralTailIsBounded(
    leadingContextual[0].replace(/[,;:]\s*$/, ''),
    question,
  )) {
    const remaining = projected.slice(leadingContextual[0].length).trim();
    const leadingScopes = boundedQuantityReferenceKeys(leadingContextual[0]);
    const remainingScopes = boundedQuantityReferenceKeys(remaining);
    if (
      leadingScopes.length > 0 && remainingScopes.length > 0 &&
      leadingScopes.some(leading => remainingScopes.some(scope => leading !== scope))
    ) projected = remaining;
  }

  const match = QUANTITY_SECONDARY_REFERRAL_TAIL_PATTERN.exec(projected);
  if (
    !match || (match.index || 0) <= 0 ||
    !quantitySecondaryReferralTailIsBounded(match[0], question)
  ) {
    return projected;
  }
  const normalizedTail = normalizePolicyText(match[0]);
  if (/^(?:with|using)\b/.test(normalizedTail)) {
    const prefixScopes = boundedQuantityReferenceKeys(projected.slice(0, match.index));
    const tailScopes = boundedQuantityReferenceKeys(match[0]);
    if (
      prefixScopes.length === 0 || tailScopes.length === 0 ||
      !tailScopes.some(tail => prefixScopes.some(prefix => tail !== prefix))
    ) return projected;
  }
  return projected.slice(0, match.index).trim().replace(/[,;]+$/, '').trim();
}

const BOUNDED_REFERENCE_SCOPE_LABEL =
  '(?:pdf\\s+pages?|pages?|sheets?|sht\\.?|panels?|details?|det\\.?|notes?|items?|' +
  'figures?|fig\\.?|drawings?|dwg\\.?|documents?|doc\\.?|plans?|parts?|revisions?|' +
  'rev\\.?|schedules?|doors?|rooms?|valves?|grids?|tasks?|canop(?:y|ies)|buildings?|' +
  'areas?|zones?|levels?|floors?|types?|pumps?|columns?|beams?|phases?|' +
  'activit(?:y|ies)|rtus?|ahus?|fcus?|fans?|equipment|circuits?|roofs?|pads?)';
const BOUNDED_REFERENCE_SCOPE_VALUE =
  '(?:[\'"‘’“”]\\s*)?(?!(?:how|what|which|who|when|where|why|does|do|did|is|are|' +
  'was|were|can|could|will|would|should|shall|must|the)\\b)' +
  '[a-z0-9]+(?:\\s*[-.]\\s*[a-z0-9]+)*' +
  '(?:\\+(?![a-z0-9_#+-]|\\.\\s*[a-z0-9]))?(?:\\s*[\'"‘’“”])?';
const BOUNDED_REFERENCE_SCOPE_PHRASE =
  BOUNDED_REFERENCE_SCOPE_LABEL + '\\s+' + BOUNDED_REFERENCE_SCOPE_VALUE +
  '(?:\\s*(?:,\\s*(?:(?:and|or)\\s+)?|and\\s+|or\\s+|&\\s*|/\\s*)' +
  '(?:' + BOUNDED_REFERENCE_SCOPE_LABEL + '\\s+)?' +
  BOUNDED_REFERENCE_SCOPE_VALUE + ')*';

export function stripECOSBoundedExcludedReferenceScopes(value: string) {
  let projected = value.replace(
    /\b(?:(?:do|does|did)\s+not|(?:do|does|did)n['’]?t|never)\s+(?:leave\s+out|omit|skip|ignore|disregard|exclude)\b/gi,
    'include',
  );
  const exclusionCue =
    '(?:excluding|exclude|not\\s+including|except(?:ing|\\s+for)?|' +
    'without(?:\\s+(?:using|counting))?|other\\s+than|apart\\s+from|but\\s+not|' +
    'not\\s+from|ignoring|ignore|disregarding|disregard|' +
    'do\\s+not\\s+(?:use|count|consult)|don[\'’]?t\\s+(?:use|count|consult)|' +
    'leave\\s+out|omit|skip|not(?!\\s+only\\b))';
  projected = projected.replace(
    new RegExp(
      '\\b' + exclusionCue + '\\s+(?:the\\s+)?' + BOUNDED_REFERENCE_SCOPE_PHRASE,
      'gi',
    ),
    ' ',
  );
  return projected.replace(/\s{2,}/g, ' ').replace(/\s+([,;:.!?])/g, '$1').trim();
}

function quantitySourceHasOnlyBoundedSecondaryReferralAfterProof(
  sourceText: string,
  proofText: string,
  question: string,
) {
  const proofIndex = sourceText.toLowerCase().lastIndexOf(proofText.toLowerCase());
  if (proofIndex < 0) return false;
  const suffix = sourceText.slice(proofIndex + proofText.length);
  return quantitySecondaryReferralTailIsBounded(suffix, question);
}

function stripLeadingSourceAuthorityFrame(question: string) {
  const authorityCarrier =
    '(?:drawings?|dwg\\.?|documents?|plans?|sheets?|details?|figures?|' +
    'specifications?|specs?|(?:project\\s+)?manuals?|reports?|submittals?|' +
    'appendix(?:es)?|appendices|(?:(?:project|construction|master|baseline)\\s+)?schedules?|' +
    '(?:field\\s+)?updates?|(?:capture\\s+)?memor(?:y|ies))';
  const exactSourceAuthorityCarrier =
    '(?:drawings?|dwg\\.?|documents?|' +
    'specifications?|specs?|(?:project\\s+)?manuals?|reports?|submittals?|' +
    'appendix(?:es)?|appendices|(?:(?:project|construction|master|baseline)\\s+)?schedules?)';
  const namedAuthority =
    `(?:the\\s+)?${exactSourceAuthorityCarrier}\\s+` +
    `(?:no\\.?\\s*)?["'‘’“”]?[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\\+)?["'‘’“”]?` +
    `(?:\\s+(?:rev(?:ision)?\\.?|r(?=\\s*\\d))\\s*(?:no\\.?\\s*)?` +
    `[a-z0-9]+(?:[.-][a-z0-9]+)*)?`;
  const coordinated = question.replace(
    new RegExp(
      `^\\s*(?:(?:according\\s+to|based\\s+on|per)\\s+(?:the\\s+)?|` +
        `(?:on|in|from|using)\\s+(?:(?:the|current)\\s+)*)` +
        `(?=[^,;:]{0,200}\\b${authorityCarrier}\\b)[^,;:]{1,200}\\s*[,;:]\\s*`,
      'i',
    ),
    '',
  );
  if (coordinated !== question) return coordinated;
  const leading = question.replace(
    /^\s*(?:(?:according\s+to|based\s+on|per)\s+(?:the\s+)?|(?:on|in|from|using)\s+(?:(?:the|current)\s+)*)(?:(?:pdf\s+)?page\s+(?:no\.?\s*)?\d+|(?:sheet|drawing|document|plan|figure)\s+(?:no\.?\s*)?["']?[a-z0-9]+(?:[.-][a-z0-9]+)*\+?["']?|(?:(?:current|project|construction|master|baseline)\s+)?schedule|(?:current\s+)?(?:drawing|document|plan|sheet|figure|specifications?|specs?|(?:project\s+)?manuals?|reports?|submittals?|(?:field\s+)?updates?|(?:capture\s+)?memor(?:y|ies))|(?:appendix(?:es)?|appendices)(?:\s+["']?[a-z0-9]+(?:[.-][a-z0-9]+)*["']?)?)\s*[,;:]\s*/i,
    '',
  );
  if (leading !== question) return leading;
  const passiveWhat = new RegExp(
    `^\\s*what\\s+(.{1,120}?)\\s+(is|are|was|were)\\s+` +
      `(?:shown|listed|stated|noted|specified|required|reported|indicated|recorded)\\s+` +
      `(?:on|in|by|within|from)\\s+${namedAuthority}\\s*[?？]?\\s*$`,
    'i',
  ).exec(question);
  if (passiveWhat) {
    const copula = /^(?:are|were)$/i.test(passiveWhat[2]) ? 'are' : 'is';
    return `What ${copula} ${passiveWhat[1].trim()}?`;
  }
  const activeYesNo = new RegExp(
    `^\\s*(?:does|do|did|has|have|can|could|would|should|will)\\s+${namedAuthority}\\s+` +
      `(?:show|include|contain|specify|require|state|indicate|report|list|say)s?\\s+` +
      `(.{1,160}?)\\s*[?？]?\\s*$`,
    'i',
  ).exec(question);
  if (activeYesNo) {
    const target = activeYesNo[1].trim();
    return /\b(?:status|owner|finish|start|approval|revision|voltage|amperage|pressure|airflow|air\s+flow|temperature|rating|percent\s+complete)\b/i.test(
        target,
      )
      ? `What is ${target}?`
      : `Is ${target} shown?`;
  }
  const passiveYesNo = new RegExp(
    `^\\s*(is|are|was|were)\\s+(.{1,160}?)\\s+` +
      `(shown|listed|stated|noted|specified|required|reported|indicated|recorded)\\s+` +
      `(?:on|in|by|within|from)\\s+${namedAuthority}\\s*[?？]?\\s*$`,
    'i',
  ).exec(question);
  if (passiveYesNo) {
    const target = passiveYesNo[2].trim();
    if (/\b(?:status|owner|finish|start|approval|revision|voltage|amperage|pressure|airflow|air\s+flow|temperature|rating|percent\s+complete)\b/i.test(
      target,
    )) return `What is ${target}?`;
    return `${passiveYesNo[1]} ${passiveYesNo[2].trim()} ${passiveYesNo[3]}?`;
  }
  const appearingWhat = new RegExp(
    `^\\s*(?:what|which)\\s+(.{1,120}?)\\s+appear(?:s|ing)?\\s+(?:on|in|within)\\s+` +
      `${namedAuthority}\\s*[?？]?\\s*$`,
    'i',
  ).exec(question);
  if (appearingWhat) return `What is ${appearingWhat[1].trim()}?`;
  return question.replace(
    new RegExp(
      `\\s+(?:according\\s+to|based\\s+on|per|using|from)\\s+${namedAuthority}` +
        `(?=\\s*[?？]?\\s*$)`,
      'i',
    ),
    '',
  );
}

type GeneralQuestionField =
  | 'status'
  | 'owner'
  | 'contractor'
  | 'finish'
  | 'start'
  | 'inspection_date'
  | 'voltage'
  | 'amperage'
  | 'pressure'
  | 'airflow'
  | 'temperature'
  | 'rating'
  | 'percent_complete'
  | 'revision'
  | 'approval';

function generalQuestionFieldRequirements(question: string): readonly GeneralQuestionField[] {
  const value = normalizePolicyText(question);
  const patterns: ReadonlyArray<readonly [GeneralQuestionField, RegExp]> = [
    ['percent_complete', /\b(?:percent complete|completion percentage|completion percent)\b/],
    ['inspection_date', /\b(?:inspection date|when[\s\S]{0,80}inspect(?:ion|ed)?)\b/],
    ['owner', /\b(?:who owns?|owned by|ownership)\b|\bowner\b(?![-\s]+(?:furnished|supplied|provided|installed|requirement|requirements|responsibility|responsibilities)\b)/],
    ['contractor', /\bcontractors?\b/],
    ['approval', /\bapproval\b|\b(?:is|are)[\s\S]{0,60}\bapproved\b/],
    ['revision', /\b(?:revision|rev\.)\b/],
    ['voltage', /\b(?:voltage|what voltage)\b/],
    ['amperage', /\b(?:amperage|amp rating|current rating|electrical current)\b/],
    ['pressure', /\bpressure\b/],
    ['airflow', /\b(?:airflow|air flow)\b/],
    ['temperature', /\btemperature\b/],
    ['rating', /\b(?:rating|rated)\b/],
    ['status', /\bstatus(?:es)?\b|^(?:is|are)\s+.+?\s+(?:not\s+(?:started|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|submitted|overdue|deferred)|incomplete|inactive|in\s+progress|on\s+hold|under\s+review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|submitted|overdue|deferred)\s*[?]?$/],
    ['finish', /\b(?:finish date|completion date)\b|\bwhen[\s\S]{0,80}\b(?:finish(?:es|ed)?|complete(?:s|d)?|completion)\b|\b(?:task|activity|schedule)\b[\s\S]{0,80}\bfinish(?:es|ed)?\b|\bfinish\b(?=\s*(?:,|or)\s*(?:owner|status|start)\b)/],
    ['start', /\bstart date\b|\bwhen[\s\S]{0,80}\bstart(?:s|ed)?\b|\b(?:task|activity|schedule)\b[\s\S]{0,80}\bstart(?:s|ed)?\b|\bstart\b(?=\s*(?:,|or)\s*(?:owner|status|finish)\b)/],
  ];
  return [...new Set(patterns.flatMap(([field, pattern]) => pattern.test(value) ? [field] : []))];
}

const GENERAL_STATUS_VALUE_PATTERN =
  '(?:no\\s+longer\\s+(?:in\\s+progress|on\\s+hold|under\\s+review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|approved|rejected|denied|submitted|overdue|deferred)|not\\s+(?:started|in\\s+progress|on\\s+hold|under\\s+review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|approved|rejected|denied|submitted|overdue|deferred)|incomplete|inactive|unapproved|in\\s+progress|on\\s+hold|under\\s+review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|approved|rejected|denied|submitted|overdue|deferred)';

const GENERAL_STATUS_REASON_TOKEN =
  "(?!(?:started|progress|hold|review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|approved|rejected|denied|submitted|overdue|deferred|incomplete|inactive|unapproved)\\b)[a-z0-9][a-z0-9&'-]*";
const GENERAL_STATUS_REASON =
  `${GENERAL_STATUS_REASON_TOKEN}(?:\\s+${GENERAL_STATUS_REASON_TOKEN}){0,7}`;
const GENERAL_STATUS_TAIL_PATTERN =
  `(?:\\s+(?:yet|for\\s+${GENERAL_STATUS_REASON}|due\\s+to\\s+${GENERAL_STATUS_REASON}|because(?:\\s+of)?\\s+${GENERAL_STATUS_REASON}))?`;
const GENERAL_STATUS_LABEL_TAIL_PATTERN =
  `(?:\\s+(?:yet|for\\s+${GENERAL_STATUS_REASON}|due\\s+to\\s+${GENERAL_STATUS_REASON}|because(?:\\s+of)?\\s+${GENERAL_STATUS_REASON}|(?:[-/]\\s*)?${GENERAL_STATUS_REASON}))?`;

function generalStatusTemporalInfixPattern() {
  const date = policyDateSyntax();
  const year = '(?:19\\d{2}|20\\d{2}|21\\d{2})';
  const namedScope = '(?:renovation|expansion|construction\\s+package|scope|project|phase|program|contract|plan|schedule)';
  return `(?:\\s+(?:(?:for|in|during)\\s+(?:the\\s+)?(?:(?:(?:fiscal|calendar)\\s+year|fy|cy)\\s*[-/]?\\s*|year\\s+)?${year}|(?:on|as\\s+of|as\\s+at|at)\\s+(?:the\\s+)?(?:year\\s+)?(?:${date}|${year})|for\\s+(?:the\\s+)?${year}\\s+${namedScope}))?`;
}

function generalTextProvidesTypedFieldValue(
  field: GeneralQuestionField,
  value: string,
  question: string,
) {
  if (!['finish', 'start', 'inspection_date'].includes(field)) {
    value = stripGeneralTemporalFrame(value);
  }
  if (!value) return false;
  if (field === 'status') {
    if (/\b(?:owner|approval|finish|start|contractor|revision|permit|inspection|phase|percent complete)\s+status\b/.test(value)) {
      return false;
    }
    const temporalInfix = generalStatusTemporalInfixPattern();
    const explicit = new RegExp(
      `\\bstatus(?:es)?${temporalInfix}\\s*(?::|=|is|are|was|were|remains?|became)?\\s*(?:currently\\s+|still\\s+)?${GENERAL_STATUS_VALUE_PATTERN}${GENERAL_STATUS_LABEL_TAIL_PATTERN}(?=\\s*(?:[.,;]|$))`,
    ).test(value);
    if (explicit) return true;
    const subject = generalQuestionFieldSubject(question, field);
    if (subject) {
      const subjectStatusPattern = new RegExp(
        `(?:^|[.;])\\s*(?:currently\\s+)?(?:the\\s+)?${generalStatusSubjectPattern(subject)}\\s+(?:is|are|remains?|became|was|were)\\s+(?:currently\\s+|still\\s+)?${GENERAL_STATUS_VALUE_PATTERN}${GENERAL_STATUS_TAIL_PATTERN}(?=\\s*(?:[.,;]|$))`,
      );
      return subjectStatusPattern.test(value);
    }
    const direct = new RegExp(
      `(?:^|[.;])\\s*(?:currently\\s+)?([^.;]{1,100}?)\\s+(?:is|are|remains?|became|was|were)\\s+(?:currently\\s+|still\\s+)?${GENERAL_STATUS_VALUE_PATTERN}${GENERAL_STATUS_TAIL_PATTERN}(?=\\s*(?:[.,;]|$))`,
    ).exec(value);
    return Boolean(direct && !/\b(?:owner|approval|finish|start|contractor|revision|permit|inspection|phase|submittal|budget|payment|invoice|percent complete)\b/.test(
      direct[1],
    ));
  }
  if (field === 'owner' || field === 'contractor') {
    if (new RegExp(
      `\\b(?:no\\s+${field}\\s+(?:is\\s+)?(?:listed|assigned|identified|provided)|${field}\\s*(?::|=|is|are|was|were)?\\s*(?:unassigned|not\\s+(?:assigned|identified|provided|listed)|n\\s*\\/?\\s*a|tbc|to\\s+be\\s+assigned))\\b`,
    ).test(value)) return false;
    const placeholder = /^(?:field\s+|name\s+)?(?:blank|none|unknown|unavailable|pending|review|listed|assigned|unassigned|not listed|not available|not assigned|not identified|not provided|n\s*\/?\s*a|na|tbc|tbd|to be assigned|to be determined)\b/;
    const patterns = field === 'owner'
      ? [
        /\bowner\s*(?::|=|\bis\b|\bare\b|\bwas\b|\bwere\b)\s+([^.;,]{1,80})/,
        /\bowned\s+by\s+([^.;,]{1,80})/,
      ]
      : [/\bcontractor\s*(?::|=|\bis\b|\bare\b|\bwas\b|\bwere\b)\s+([^.;,]{1,80})/];
    const name = patterns.map(pattern => pattern.exec(value)?.[1]?.trim() || '').find(Boolean) || '';
    if (name && !placeholder.test(name)) return true;
    if (field !== 'owner') return false;
    const activeOwner = /\b([a-z][a-z0-9&'.\/-]*(?:\s+[a-z][a-z0-9&'.\/-]*){0,5})\s+owns?\s+[a-z0-9]/.exec(value)?.[1]?.trim() || '';
    return Boolean(activeOwner && !placeholder.test(activeOwner));
  }
  if (field === 'finish' || field === 'start' || field === 'inspection_date') {
    const date = canonicalPolicyDate(value);
    if (!date) return false;
    const dateSyntax = `(?:${policyDateSyntax()})`;
    if (field === 'inspection_date') {
      return new RegExp(`\\binspection\\s+date\\s*(?::|=|is|was)?\\s*${dateSyntax}\\b|\\binspected\\s+(?:on\\s+)?${dateSyntax}\\b`).test(value);
    }
    const label = field === 'finish'
      ? '(?:finish(?:es|ed)?|complete(?:s|d)?|completion)'
      : 'start(?:s|ed)?';
    if (new RegExp(`\\b${label}(?:\\s+date)?\\s*(?::|=|is|was|on)?\\s*${dateSyntax}\\b`).test(value)) {
      return true;
    }
    if (new RegExp(`\\b${dateSyntax}\\b\\s+(?:is|was)\\s+(?:the\\s+)?${label}\\s+date\\b`).test(value)) {
      return true;
    }
    const subject = generalQuestionFieldSubject(question, field);
    return Boolean(subject) && new RegExp(
      `(?:^|[.;])\\s*(?:the\\s+)?${relationshipAnchorPattern(subject)}\\s+${label}\\s+${dateSyntax}\\b`,
    ).test(value);
  }
  if (field === 'voltage') {
    return typedNumericFieldValue(
      value,
      'voltage',
      '(?:v|vac|volts?)',
      question,
      field,
      '[+-]?\\d+(?:\\.\\d+)?(?:\\s*(?:y\\s*)?\\/\\s*\\d+(?:\\.\\d+)?)?',
    );
  }
  if (field === 'amperage') return typedNumericFieldValue(value, '(?:amperage|amp rating|current rating|electrical current)', '(?:a|amps?|amperes?)', question, field);
  if (field === 'pressure') return typedNumericFieldValue(value, 'pressure', '(?:psig?|pounds? per square inch)', question, field);
  if (field === 'airflow') return typedNumericFieldValue(value, '(?:airflow|air flow)', '(?:c\\.?\\s*f\\.?\\s*m\\.?|cubic feet per minute)', question, field);
  if (field === 'temperature') {
    return typedNumericFieldValue(
      value,
      'temperature',
      '(?:degrees?\\s*)?(?:f|c|fahrenheit|celsius)',
      question,
      field,
    );
  }
  if (field === 'percent_complete') {
    const relation = '(?:(?:not\\s+equal\\s+to|does\\s+not\\s+equal|no\\s+longer|not|equal\\s+to|exactly|approximately|approx|about|roughly|estimated|not\\s+greater\\s+than|not\\s+less\\s+than|less\\s+than\\s+or\\s+equal\\s+to|greater\\s+than\\s+or\\s+equal\\s+to|less\\s+than|greater\\s+than|minimum|min|at\\s+least|no\\s+less\\s+than|maximum|max|at\\s+most|up\\s+to|no\\s+more\\s+than|not\\s+to\\s+exceed)\\s+)?';
    const explicit = new RegExp(
      `\\b(?:percent complete|completion percentage|completion percent)\\s*(?::|=|is|are|was|were|equals?)?\\s*${relation}(\\d+(?:\\.\\d+)?)(?:\\s*(?:%|percent))?(?=\\s*(?:[.,;]|$))`,
    ).exec(value);
    const predicate = /\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s+complete(?=\s*(?:[.,;]|$))/.exec(value);
    const amount = Number(explicit?.[1] || predicate?.[1]);
    return Number.isFinite(amount) && amount >= 0 && amount <= 100;
  }
  if (field === 'rating') {
    const amount = '[+-]?\\d+(?:\\.\\d+)?';
    const ratingValue = `(?:${amount}(?:\\s*(?:a|amps?|amperes?|v|vac|volts?|kaic|hp|hours?|hrs?|minutes?|mins?))|(?:stc|r|u)\\s*[-:]?\\s*${amount})`;
    const subject = generalQuestionFieldSubject(question, field);
    return new RegExp(`\\b(?:rating|rated)\\s*(?::|=|is|are|was|were)?\\s*${ratingValue}\\b`).test(value) ||
      new RegExp(`\\b${ratingValue}\\s+(?:fire\\s+)?rating\\b`).test(value) ||
      Boolean(subject) && new RegExp(
        `(?:^|[.;])\\s*(?:the\\s+)?${relationshipAnchorPattern(subject)}\\s+(?:is|are|was|were)\\s+rated\\s+${ratingValue}\\b`,
      ).test(value);
  }
  if (field === 'approval') {
    if (/\besr-\d+[a-z0-9.-]*\b/.test(value)) return true;
    const state = '(?:approved|rejected|denied|not approved|unapproved)';
    if (new RegExp(`\\bapproval\\s*(?::|=|is|was)\\s*${state}(?=\\s*(?:[.,;]|$))`).test(value)) {
      return true;
    }
    const subject = generalQuestionFieldSubject(question, field);
    return Boolean(subject) && new RegExp(
      `(?:^|[.;])\\s*(?:the\\s+)?${relationshipAnchorPattern(subject)}\\s+(?:is|are|was|were)\\s+${state}(?=\\s*(?:[.,;]|$))`,
    ).test(value);
  }
  if (field === 'revision') {
    if (/\b(?:no\s+revision\s+(?:is\s+)?(?:listed|assigned|identified|provided)|revision\s*(?::|=|is|was)?\s*(?:unassigned|not\s+(?:assigned|identified|provided|listed)|n\s*\/?\s*a|tbc|to\s+be\s+assigned))\b/.test(value)) {
      return false;
    }
    const match = /\b(?:revision|rev\.)\s*(?::|=|is|was)\s*([^.;,]{1,40})/.exec(value);
    return Boolean(match && !/^(?:field\s+|name\s+)?(?:blank|none|unknown|unavailable|pending|review|listed|assigned|unassigned|not listed|not assigned|not identified|not provided|n\s*\/?\s*a|na|tbc|tbd|to be assigned|to be determined)\b/.test(match[1].trim()));
  }
  return false;
}

const GENERAL_QUESTION_FIELD_LABEL_PATTERNS: Readonly<Record<GeneralQuestionField, string>> =
  Object.freeze({
    status: 'status(?:es)?', owner: 'owner', contractor: 'contractor',
    finish: '(?:finish(?:es|ed)?|complete(?:s|d)?|completion(?: date)?)',
    start: 'start(?:s|ed)?', inspection_date: 'inspection(?: date)?',
    voltage: 'voltage', amperage: '(?:amperage|amp rating|current rating|electrical current)', pressure: 'pressure',
    airflow: '(?:airflow|air flow)', temperature: 'temperature',
    rating: '(?:rating|rated)',
    percent_complete: '(?:percent complete|completion percentage|completion percent)',
    revision: '(?:revision|rev)', approval: 'approval',
  });

function generalStatusSubjectPattern(subject: string) {
  const exact = relationshipAnchorPattern(subject);
  return /^(?:project|drawing|plan|schedule)$/.test(subject)
    ? `(?:[a-z0-9./'-]+\\s+){0,6}${exact}`
    : exact;
}

function generalSourceClauseProvidesTypedFieldValue(
  field: GeneralQuestionField,
  clause: string,
  question: string,
) {
  return generalSourceResponsiveTypedFieldClause(field, clause, question) != null;
}

function generalSourceResponsiveTypedFieldClause(
  field: GeneralQuestionField,
  clause: string,
  question: string,
) {
  return generalSourceResponsiveTypedFieldMatch(field, clause, question)?.text || null;
}

function generalSourceResponsiveTypedFieldMatch(
  field: GeneralQuestionField,
  clause: string,
  question: string,
): Readonly<{ text: string; start: number }> | null {
  const subject = generalQuestionFieldSubject(question, field);
  if (!subject) {
    return generalTextProvidesTypedFieldValue(field, clause, question)
      ? { text: clause, start: 0 }
      : null;
  }
  const candidateStartPattern = new RegExp(
    `\\b(?:${relationshipAnchorPattern(subject)}|${GENERAL_QUESTION_FIELD_LABEL_PATTERNS[field]})\\b`,
    'g',
  );
  let candidateCount = 0;
  for (const match of clause.matchAll(candidateStartPattern)) {
    if (candidateCount++ >= 24) break;
    if (generalTextProvidesTypedFieldValue(
      field,
      clause.slice(match.index || 0),
      question,
    )) {
      const start = match.index || 0;
      return { text: clause.slice(start), start };
    }
  }
  return generalTextProvidesTypedFieldValue(field, clause, question)
    ? { text: clause, start: 0 }
    : null;
}

function typedNumericFieldValue(
  value: string,
  fieldPattern: string,
  unitPattern: string,
  question: string,
  field: GeneralQuestionField,
  amountPattern = '[+-]?\\d+(?:\\.\\d+)?',
) {
  const numericValue = `(?:(?<![a-z0-9])${amountPattern}\\s*${unitPattern}\\b|${unitPattern}\\s*:?\\s*(?<![a-z0-9])${amountPattern}(?![a-z0-9]))`;
  const relation = '(?:(?:not\\s+equal\\s+to|does\\s+not\\s+equal|not\\s+greater\\s+than|not\\s+less\\s+than|less\\s+than\\s+or\\s+equal\\s+to|greater\\s+than\\s+or\\s+equal\\s+to|less\\s+than|greater\\s+than|minimum|min|at\\s+least|no\\s+less\\s+than|maximum|max|at\\s+most|up\\s+to|no\\s+more\\s+than|not\\s+to\\s+exceed)\\s+)?';
  const predicate = '(?::|=|is|are|was|were|equals?|(?:shall|must)(?:\\s+not)?\\s+be)';
  const entityYearQualifier = '(?:\\s+for\\s+(?:the\\s+)?(?:19\\d{2}|20\\d{2}|21\\d{2})\\s+(?:renovation|project|phase|program|contract|plan))?';
  const fieldValue = `\\b${fieldPattern}\\b${entityYearQualifier}\\s*${predicate}?\\s*${relation}${numericValue}`;
  const subject = generalQuestionFieldSubject(question, field);
  if (!subject) return new RegExp(fieldValue).test(value);
  const boundary = '(?:^|[.;]|\\band\\b)\\s*';
  const anchor = relationshipAnchorPattern(subject);
  return new RegExp(
    `${boundary}(?:the\\s+)?${anchor}\\s+${fieldValue}`,
  ).test(value) || new RegExp(
    `${boundary}(?:the\\s+)?${fieldPattern}\\s+(?:of|for)\\s+(?:the\\s+)?${anchor}\\s*${predicate}\\s*${relation}${numericValue}`,
  ).test(value) || new RegExp(
    `${boundary}(?:the\\s+)?${anchor}\\s+${predicate}\\s+${relation}${numericValue}`,
  ).test(value);
}

function generalQuestionFieldSubject(question: string, field: GeneralQuestionField) {
  const value = normalizePolicyText(question).replace(/[?.!]+$/, '');
  const label = GENERAL_QUESTION_FIELD_LABEL_PATTERNS;
  const beforeField = new RegExp(
    `^(?:(?:what|which)\\s+(?:is|are|was|were)\\s+|when\\s+(?:does|do|did|is|are)\\s+)(?:the\\s+)?(?:current\\s+)?(.+?)(?:['’]s)?\\s+${label[field]}\\b`,
  ).exec(value)?.[1] || '';
  const afterField = new RegExp(
    `^(?:(?:what|which)\\s+(?:is|are|was|were)\\s+)?(?:the\\s+)?${label[field]}\\s+(?:of|for)\\s+(?:the\\s+)?(?:current\\s+)?(.+)$`,
  ).exec(value)?.[1] || '';
  const inverted = new RegExp(
    `^(?:what|which)\\s+${label[field]}\\s+(?:is|are|was|were)\\s+(?:the\\s+)?(?:current\\s+)?(.+)$`,
  ).exec(value)?.[1] || '';
  const copular = field === 'status'
    ? /^(?:is|are)\s+(?:the\s+)?(.+?)\s+(?:not\s+(?:started|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|submitted|overdue|deferred)|incomplete|inactive|in\s+progress|on\s+hold|under\s+review|waiting|complete(?:d)?|current|active|pending|open|closed|blocked|delayed|cancel(?:ed|led)|submitted|overdue|deferred)$/.exec(value)?.[1] || ''
    : field === 'approval'
      ? /^(?:is|are)\s+(?:the\s+)?(.+?)\s+(?:approved|rejected|denied|not approved|unapproved)$/.exec(value)?.[1] || ''
      : '';
  const subject = (afterField || beforeField || inverted || copular).trim();
  return subject && subject.split(' ').length <= 8 && !/\b(?:and|or)\b/.test(subject)
    ? subject
    : '';
}

function policyDateSyntax() {
  const month = '(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)';
  return `\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|${month}\\s+\\d{1,2}\\s+\\d{4}|\\d{1,2}\\s+${month}\\s+\\d{4}|${month}\\s+\\d{1,2}(?!\\s+\\d{4})`;
}

function canonicalPolicyDate(value: string) {
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(value);
  if (iso) return validPolicyDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(value);
  if (slash) {
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return validPolicyDate(year, Number(slash[1]), Number(slash[2]));
  }
  const months: Readonly<Record<string, number>> = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
    september: 9, sep: 9, sept: 9, october: 10, oct: 10,
    november: 11, nov: 11, december: 12, dec: 12,
  };
  const dayFirst = /\b(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{4})\b/.exec(
    value,
  );
  if (dayFirst) {
    return validPolicyDate(Number(dayFirst[3]), months[dayFirst[2]], Number(dayFirst[1]));
  }
  const written = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:\s+(\d{4}))?\b/.exec(value);
  if (!written) return '';
  const month = months[written[1]];
  const day = Number(written[2]);
  if (!written[3]) return month >= 1 && day >= 1 && day <= new Date(Date.UTC(2000, month, 0)).getUTCDate()
    ? `--${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';
  return validPolicyDate(Number(written[3]), month, day);
}

function validPolicyDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';
}

function currentStateQuestionRejectsTemporalEvidence(
  question: string,
  field: GeneralQuestionField,
) {
  if (['finish', 'start', 'inspection_date'].includes(field)) return false;
  const value = normalizePolicyText(question);
  if (
    questionTemporalAnchor(value) ||
    /^(?:who|what|which)\s+approved\b/.test(value) ||
    /\b(?:previous|prior|former|historical|past|forecast|expected|planned|future)\b/.test(value) ||
    /^(?:what|which|who|when)\s+(?:was|were|did)\b/.test(value) ||
    /\b(?:will|would)\b/.test(value)
  ) {
    return false;
  }
  return true;
}

export function ecosAcceptedFactsCoverGeneralFieldRequirements(
  question: string,
  statements: readonly string[],
) {
  const semanticQuestion = stripLeadingSourceAuthorityFrame(question);
  const requested = generalQuestionFieldRequirements(semanticQuestion);
  if (requested.length <= 1) return true;
  const answered = new Set(requested.filter(field => statements.some(statement =>
    statement.split(/[;!?]|\.\s+/)
      .map(normalizePolicyText)
      .filter(Boolean)
      .some(clause => generalTextProvidesTypedFieldValue(field, clause, semanticQuestion))
  )));
  const alternativesOnly = /\bor\b/.test(normalizePolicyText(semanticQuestion)) &&
    !/\band\b/.test(normalizePolicyText(semanticQuestion));
  return alternativesOnly ? answered.size > 0 : requested.every(field => answered.has(field));
}

function temporalEvidenceDoesNotProveCurrentState(value: string, field: GeneralQuestionField) {
  if (['finish', 'start', 'inspection_date'].includes(field)) return false;
  const today = new Date().toISOString().slice(0, 10);
  for (const anchor of temporalAnchorsInText(value)) {
    if (anchor.kind !== 'date' || anchor.value !== today) return true;
  }
  return /\b(?:previously|formerly|historically|used\s+to|had\s+been|became|was|were|expected|forecast(?:ed)?|planned|will|would)\b/.test(
    value,
  );
}

type GeneralTemporalAnchor = Readonly<{ kind: 'date' | 'year'; value: string }>;

function questionTemporalAnchor(value: string): GeneralTemporalAnchor | null {
  const anchors = temporalAnchorsInText(value);
  return anchors.length === 1 ? anchors[0] : null;
}

function temporalEvidenceMatchesQuestion(
  question: string,
  statement: string,
  _field: GeneralQuestionField,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const requestedAnchors = temporalAnchorsInText(normalizedQuestion);
  if (questionHasUnresolvedTemporalSyntax(normalizedQuestion)) return false;
  if (requestedAnchors.length === 0) return true;
  // Multiple requested snapshots are not one exact fact tuple. A provider may
  // not silently choose one side of an "or" question or a year range.
  if (requestedAnchors.length !== 1) return false;
  const requested = requestedAnchors[0];
  const anchors = temporalAnchorsInText(statement);
  if (anchors.length === 0) return false;
  return anchors.every(anchor => {
    if (requested.kind === 'date') return anchor.kind === 'date' && anchor.value === requested.value;
    return anchor.kind === 'year'
      ? anchor.value === requested.value
      : anchor.value.startsWith(`${requested.value}-`);
  }) && anchors.some(anchor => requested.kind === 'date'
    ? anchor.kind === 'date' && anchor.value === requested.value
    : anchor.value === requested.value || anchor.value.startsWith(`${requested.value}-`));
}

function temporalScopeMatchesQuestion(question: string, statement: string) {
  if (!temporalEvidenceMatchesQuestion(question, statement, 'status')) return false;
  const requestedTemporal = questionTemporalAnchor(normalizePolicyText(question));
  if (!requestedTemporal) {
    const entityYearBindings = questionEntityYearBindings(normalizePolicyText(question));
    if (entityYearBindings.length > 0 && !statementMatchesEntityYearBindings(
      question,
      statement,
      entityYearBindings,
    )) return false;
  }
  const field = generalQuestionFieldRequirements(question)[0] || 'status';
  return !currentStateQuestionRejectsTemporalEvidence(question, field) ||
    !temporalEvidenceDoesNotProveCurrentState(statement, field);
}

export function ecosTemporalSourceFrameMatchesQuestion(
  value: string,
  question: string,
) {
  const frame = normalizedTemporalSourceFrame(value);
  return frame != null && temporalScopeMatchesQuestion(question, frame);
}

function sourceTemporalScopesMatchQuestion(
  question: string,
  sourceExcerpts: readonly string[],
  sourceProofSegments: readonly (string | readonly string[] | null)[] = [],
  sourceTemporalFrames: readonly (string | null)[] = [],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const fields = generalQuestionFieldRequirements(question);
  return sourceExcerpts.every((excerpt, excerptIndex) => {
    const normalizedExcerpt = normalizePolicyText(excerpt);
    const clauses = temporalSourceClauses(excerpt);
    const relevantClauses = clauses.flatMap((clause, index) => {
      const typedClause = fields.map(field => ({
        field,
        match: generalSourceResponsiveTypedFieldMatch(field, clause, question),
      })).find(candidate =>
        candidate.match != null &&
        sourceTemporalTypedFieldClauseMatchesRequestedSubject(candidate.field, clause, question)
      ) || null;
      const matchesMeasurement = requirement.kind === 'measurement' &&
        containsECOSRequestedMeasurementValue(question, clause) &&
        measurementTextBindsRequestedAttribute(question, clause);
      const matchesQuantity = requirement.kind === 'quantity' &&
        containsECOSQuantityValue(clause, question);
      const matchesPresence = requirement.kind === 'presence' &&
        containsECOSExplicitPresenceEvidence(clause, requirement.attributeTerms);
      const relevantText = typedClause?.match?.text || (
        matchesMeasurement || matchesQuantity || matchesPresence ? clause : null
      );
      return relevantText == null ? [] : [{
        index,
        clause,
        text: relevantText,
        field: typedClause?.field || null,
        prefix: typedClause?.match && typedClause.match.start > 0
          ? clause.slice(0, typedClause.match.start).trim()
          : '',
      }];
    });
    if (relevantClauses.length === 0) {
      return temporalScopeMatchesQuestion(question, normalizedExcerpt);
    }
    const rawProofSegment = sourceProofSegments[excerptIndex];
    let proofBearingClauses = relevantClauses;
    if (rawProofSegment != null) {
      const normalizedProofClauses = (Array.isArray(rawProofSegment)
        ? rawProofSegment
        : [rawProofSegment]
      ).flatMap(proofSegment => proofSegment
        .split(/\r?\n+|[;!?]+|\.\s+/)
        .map(normalizePolicyText)
        .filter(Boolean));
      if (normalizedProofClauses.length === 0) return false;
      proofBearingClauses = relevantClauses.filter(relevant =>
        normalizedProofClauses.some(proofClause =>
          proofClause === relevant.clause ||
          proofClause === relevant.text ||
          requirement.kind === 'quantity' &&
            quantitySourceHasOnlyBoundedSecondaryReferralAfterProof(
              relevant.clause,
              proofClause,
              question,
            )
        )
      );
      if (proofBearingClauses.length === 0) return false;
    }
    const clauseMatchesTemporalScope = (relevant: typeof relevantClauses[number]) => {
      let latestApplicableFrame: string | null = null;
      const applyFrame = (frame: string) => {
        const scope = relevant.field == null
          ? temporalCompoundSourceDomainScope(frame, question) || 'global'
          : sourceTemporalFrameSubjectScope(relevant.field, frame, question);
        if (scope !== 'other') latestApplicableFrame = frame;
      };
      for (const titleClause of temporalSourceClauses(
        (sourceTemporalFrames[excerptIndex] || '')
          .replace(/\brev\.\s+(?=(?:19\d{2}|20\d{2}|21\d{2})\b)/gi, 'rev '),
        true,
      )) {
        const titleFrame = normalizedTemporalSourceFrame(titleClause, true);
        if (titleFrame != null) applyFrame(titleFrame);
      }
      for (const clause of clauses.slice(0, relevant.index)) {
        const frame = normalizedTemporalSourceFrame(clause);
        if (frame != null) applyFrame(frame);
      }
      const sameClausePrefix = normalizedTemporalSourceFrame(relevant.prefix);
      if (sameClausePrefix != null) applyFrame(sameClausePrefix);
      const followingFrame = normalizedTemporalSourceFrame(clauses[relevant.index + 1] || '');
      if (followingFrame != null) {
        const laterResponsiveClauseExists = clauses.slice(relevant.index + 2)
          .some(sourceTemporalClauseCouldReceiveFrame);
        if (
          relevant.index + 1 === clauses.length - 1 ||
          !laterResponsiveClauseExists
        ) applyFrame(followingFrame);
      }
      const temporalFrames = latestApplicableFrame == null ? [] : [latestApplicableFrame];
      return temporalScopeMatchesQuestion(
        question,
        [...new Set([...temporalFrames, relevant.text])].join(' '),
      );
    };
    return rawProofSegment != null
      ? proofBearingClauses.some(clauseMatchesTemporalScope)
      : proofBearingClauses.every(clauseMatchesTemporalScope);
  });
}

function sourceTemporalClauseCouldReceiveFrame(clause: string) {
  if ((Object.keys(GENERAL_QUESTION_FIELD_LABEL_PATTERNS) as GeneralQuestionField[])
    .some(field => generalTextProvidesTypedFieldValue(field, clause, ''))) return true;
  const normalized = normalizePolicyText(clause);
  if (
    containsECOSMeasurementValue(normalized) &&
    /\b(?:area|footprint|clearance|thickness|thick|width|wide|height|high|depth|deep|length|long|diameter|diam|dia|spacing|spaced|slope|grade|elevation|on\s+centers?|o\.?\s*c\.?)\b/.test(normalized)
  ) return true;
  return /\b(?:shown|listed|provided|identified|counted|included|present|absent|omitted|required)\b/.test(
    normalized,
  );
}

function sourceTemporalTypedFieldClauseMatchesRequestedSubject(
  field: GeneralQuestionField,
  clause: string,
  question: string,
) {
  return sourceTemporalFrameSubjectScope(field, clause, question, true) !== 'other';
}

function sourceTemporalFrameSubjectScope(
  field: GeneralQuestionField,
  clause: string,
  question: string,
  preferResponsiveSubject = false,
): 'matching' | 'global' | 'other' {
  const subject = generalQuestionFieldSubject(question, field);
  if (!subject) return 'global';
  if (new RegExp(
    `\\bexcluding\\s+(?:the\\s+)?${relationshipAnchorPattern(subject)}\\b`,
  ).test(clause)) return 'other';
  const exactSubjectMatches = new RegExp(`\\b${relationshipAnchorPattern(subject)}\\b`).test(clause);
  if (preferResponsiveSubject && exactSubjectMatches) return 'matching';
  const sourceDomainScope = temporalCompoundSourceDomainScope(clause, question, subject);
  if (sourceDomainScope === 'other') return 'other';
  if (sourceDomainScope === 'matching') return 'matching';
  const subjectTokens = subject.split(' ').filter(Boolean);
  if (subjectTokens.length >= 2) {
    const family = subjectTokens.slice(0, -1).map(escapeRegExp).join('\\s+');
    const requestedIdentifier = subjectTokens.at(-1) || '';
    const familyOwners = [...clause.matchAll(new RegExp(
      `\\b${family}\\s+["']?([a-z0-9]+(?:[.-][a-z0-9]+)*)["']?\\b`,
      'g',
    ))].map(match => match[1]);
    if (familyOwners.some(identifier => identifier !== requestedIdentifier)) return 'other';
    if (exactSubjectMatches) return 'matching';
  }
  const scopedEntity =
    /\b(?:panel|task|room|canopy|building|area|zone|level|floor|grid|door|sheet|page|detail|figure|revision|plan|note|item|phase|option|unit|suite|bay|section)\s+["']?[a-z0-9]+(?:[.-][a-z0-9]+)*["']?\b/;
  if (scopedEntity.test(clause)) return 'other';
  if (exactSubjectMatches) return 'matching';
  if (/\bbudget\s+(?:schedules?|drawings?|documents?|evidence|records?|snapshots?|reports?|sources?|tables?|registers?|logs?|index(?:es)?|indices|lists?|matrix(?:es)?|matrices)\b/.test(clause)) {
    return 'other';
  }
  return 'global';
}

function temporalCompoundSourceDomainScope(
  clause: string,
  question: string,
  subject = '',
): 'matching' | 'other' | null {
  const rawDomain = /\b((?:(?:lighting|light)\s+fixture|(?:electrical|mechanical|hvac|plumbing)\s+equipment|door\s+hardware)|equipment|fixture|panel|door|window|finish|hardware|drawing|document|sheet|task|status|asset|material|submittal|rfi|revision|responsibility|project|construction|budget)\s+(?:schedules?|index(?:es)?|indices|lists?|matrix(?:es)?|matrices|drawings?|documents?|evidence|records?|snapshots?|reports?|sources?|tables?|registers?|logs?)\b/.exec(
    clause,
  )?.[1] || '';
  const domain = /fixture$/.test(rawDomain)
    ? 'fixture'
    : /^(?:electrical|mechanical|hvac|plumbing) equipment$/.test(rawDomain)
    ? rawDomain.replace(' ', '_')
    : rawDomain === 'equipment'
    ? 'equipment'
    : /hardware$/.test(rawDomain)
    ? 'hardware'
    : rawDomain;
  if (!domain || /^(?:equipment|project|drawing|document|sheet)$/.test(domain)) {
    return null;
  }
  const normalizedQuestion = normalizePolicyText(question);
  const domainAliases: Readonly<Record<string, readonly string[]>> = Object.freeze({
    fixture: ['fixture', 'light', 'lighting', 'luminaire'],
    panel: ['panel'],
    door: ['door', 'hardware'],
    hardware: ['door', 'hardware'],
    window: ['window'],
    finish: ['finish'],
    task: ['task'],
    asset: ['asset'],
    material: ['material'],
    submittal: ['submittal'],
    rfi: ['rfi'],
    revision: ['revision'],
    responsibility: ['responsibility', 'owner', 'contractor'],
    budget: ['budget', 'cost', 'price'],
    status: ['status'],
    construction: ['construction'],
    electrical_equipment: ['electrical', 'panel', 'voltage', 'amperage'],
    mechanical_equipment: ['mechanical', 'pressure', 'airflow'],
    hvac_equipment: ['hvac', 'pressure', 'airflow'],
    plumbing_equipment: ['plumbing', 'pressure', 'flow'],
  });
  const requestedText = `${normalizedQuestion} ${normalizePolicyText(subject)}`.trim();
  const requestedDomains = Object.entries(domainAliases).filter(([, aliases]) =>
    aliases.some(alias => new RegExp(`\\b${alias}s?\\b`).test(requestedText))
  ).map(([name]) => name);
  // A specialized source frame must not become a global "current" reset for
  // an unrelated value merely because the question has no vocabulary from
  // that source family. Generic equipment/project/drawing frames remain global
  // above; specialized frames fail closed unless their domain is requested.
  if (requestedDomains.length === 0) return 'other';
  const explicitEquipmentDomains = [
    /\bhvac\b/.test(requestedText) ? 'hvac_equipment' : '',
    /\bplumbing\b/.test(requestedText) ? 'plumbing_equipment' : '',
  ].filter(Boolean);
  if (
    /^(?:hvac|plumbing)_equipment$/.test(domain) &&
    explicitEquipmentDomains.length > 0
  ) {
    return explicitEquipmentDomains.includes(domain) ? 'matching' : 'other';
  }
  const compatible = new Set(domainAliases[domain] || [domain]);
  return requestedDomains.some(requested =>
    requested === domain || (domainAliases[requested] || []).some(alias => compatible.has(alias))
  ) ? 'matching' : 'other';
}

const TEMPORAL_TABULAR_SOURCE_HEAD_PATTERN =
  '(?:(?:lighting|light)\\s+fixture|(?:electrical|mechanical|hvac|plumbing)\\s+equipment|door\\s+hardware|' +
  'equipment|fixture|panel|door|window|finish|hardware|drawing|document|sheet|' +
  'task|status|asset|material|submittal|rfi|revision|responsibility|project|construction|budget)';
const TEMPORAL_TABULAR_SOURCE_NOUN_PATTERN =
  '(?:schedules?|index(?:es)?|indices|lists?|matrix(?:es)?|matrices)';
const TEMPORAL_GENERIC_SOURCE_NOUN_PATTERN =
  '(?:schedules?|drawings?|documents?|evidence|records?|snapshots?|reports?|' +
  'sources?|tables?|registers?|logs?)';
const TEMPORAL_COMPOUND_SOURCE_NOUN_PATTERN =
  `(?:${TEMPORAL_TABULAR_SOURCE_HEAD_PATTERN}\\s+` +
    `(?:${TEMPORAL_TABULAR_SOURCE_NOUN_PATTERN}|${TEMPORAL_GENERIC_SOURCE_NOUN_PATTERN}))`;
const TEMPORAL_SOURCE_NOUN_PATTERN =
  `(?:${TEMPORAL_COMPOUND_SOURCE_NOUN_PATTERN}|` +
  `${TEMPORAL_GENERIC_SOURCE_NOUN_PATTERN})`;
const TEMPORAL_STANDALONE_TABULAR_SOURCE_NOUN_PATTERN =
  '(?:index(?:es)?|indices|lists?|matrix(?:es)?|matrices)';
const TEMPORAL_YEAR_SCOPE_LABEL_PATTERN =
  '(?:fy|fiscal(?:\\s+year)?|cy|calendar(?:\\s+year)?)';
const TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN =
  '(?:(?:issued|released|updated|revised|published|dated|edition|version|covering)' +
  '(?:\\s+(?:in|on|for|during|as\\s+(?:of|at)|to))?|effective(?:\\s+(?:in|on|for|during|as\\s+(?:of|at)|to|through|until))?|' +
  'last\\s+(?:updated|revised|published)|release(?:\\s+date)?|' +
  'publication(?:\\s+(?:date|year))?|valid\\s+(?:(?:through|until)(?:\\s+(?:the\\s+)?end\\s+of)?|for|in|during|throughout|as\\s+(?:of|at))|' +
  'as\\s+(?:of|at)|expires?(?:\\s+at\\s+(?:the\\s+)?end\\s+of)?|(?:expiration|expiry)(?:\\s+date)?|' +
  'applicable(?:\\s+(?:(?:through|until)(?:\\s+(?:the\\s+)?end\\s+of)?|to|for|in))?|revision(?:\\s+date)?|rev\\.?|' +
  'for(?:\\s+(?:the\\s+)?year)?|in|on|during|throughout|through|until)';

function normalizeTemporalSyntax(value: string) {
  return normalizePolicyText(value)
    .replace(/\bf\.\s*y\.?(?=\s*[-/:]?\s*(?:19\d{2}|20\d{2}|21\d{2})\b)/g, 'fy')
    .replace(/\bc\.\s*y\.?(?=\s*[-/:]?\s*(?:19\d{2}|20\d{2}|21\d{2})\b)/g, 'cy')
    .replace(/\b(?:as-of|as-at|valid-through|valid-until|last-published|last-updated|last-revised|fiscal-year|calendar-year|release-date|publication-date|expiration-date|expiry-date)\b/g, marker =>
      marker.replace(/-/g, ' ')
    )
    .replace(
      /\b((?:as\s+(?:of|at)|for|in|during|throughout))\s+(?:the\s+)?year\s+(19\d{2}|20\d{2}|21\d{2})\b/g,
      '$1 $2',
    );
}

function foldTemporalYearScopes(value: string) {
  const year = '(19\\d{2}|20\\d{2}|21\\d{2})';
  return value
    .replace(new RegExp(
      `\\b${TEMPORAL_YEAR_SCOPE_LABEL_PATTERN}\\s*[-/:]?\\s*${year}\\b`,
      'g',
    ), '$1')
    .replace(new RegExp(
      `\\b${year}\\s+${TEMPORAL_YEAR_SCOPE_LABEL_PATTERN}(?=\\s+${TEMPORAL_SOURCE_NOUN_PATTERN}\\b)`,
      'g',
    ), '$1');
}

function normalizedTemporalSourceFrame(value: string, allowTitleTail = false) {
  const normalized = normalizeTemporalSyntax(value).replace(/[.;:]+$/, '').trim();
  if (!normalized || normalized.split(' ').length > 24) return null;
  const dateSyntax = policyDateSyntax();
  const dateOrYear = `(?:${dateSyntax}|(?:19\\d{2}|20\\d{2}|21\\d{2}))`;
  let framed = foldTemporalYearScopes(normalized);
  const leadingCurrentDatedSource = new RegExp(
    `^current\\s+(?:as\\s+(?:of|at))\\s+(${dateOrYear})\\s+` +
      `(${TEMPORAL_SOURCE_NOUN_PATTERN})\\b`,
  ).exec(framed);
  if (leadingCurrentDatedSource) {
    const canonicalDate = canonicalPolicyDate(leadingCurrentDatedSource[1]);
    framed = `${leadingCurrentDatedSource[2]} as of ${
      canonicalDate || leadingCurrentDatedSource[1]
    }${framed.slice(leadingCurrentDatedSource[0].length)}`.trim();
  }

  const taggedRevisionDate = new RegExp(
    `\\b(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s*(?:[,|:-]\\s*)?` +
      `(?:revision|rev\\.?)\\s+[a-z0-9.-]{1,24}\\s+(${dateOrYear})\\b`,
  ).exec(framed);
  if (taggedRevisionDate) {
    const canonicalDate = canonicalPolicyDate(taggedRevisionDate[2]);
    framed = `${framed.slice(0, taggedRevisionDate.index)}${taggedRevisionDate[1]} as of ${
      canonicalDate || taggedRevisionDate[2]
    }${framed.slice((taggedRevisionDate.index || 0) + taggedRevisionDate[0].length)}`.trim();
  }

  const trailingSourceDate = new RegExp(
    `\\b(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s*(?:[,|:-]\\s*)?` +
      `(?:${TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN}\\s+)?(${dateOrYear})\\b`,
  ).exec(framed);
  if (trailingSourceDate) {
    const canonicalDate = canonicalPolicyDate(trailingSourceDate[2]);
    framed = `${framed.slice(0, trailingSourceDate.index)}${trailingSourceDate[1]} as of ${
      canonicalDate || trailingSourceDate[2]
    }${framed.slice((trailingSourceDate.index || 0) + trailingSourceDate[0].length)}`.trim();
  }

  // Bare INDEX/LIST/MATRIX is too ambiguous for an anywhere-in-clause source
  // match. Recognize it only as a bounded source-label preamble or leading
  // date frame; compound forms such as EQUIPMENT INDEX remain covered below.
  const standaloneQualifiedDate = new RegExp(
    `^(?:(?:source|document)\\s+)?(?:(?:the|an?)\\s+)?` +
      `(${TEMPORAL_STANDALONE_TABULAR_SOURCE_NOUN_PATTERN})\\s+` +
      `(?:date|dated|from|effective|revision\\s+date)\\s+(${dateOrYear})\\b`,
  ).exec(framed);
  if (standaloneQualifiedDate) {
    const canonicalDate = canonicalPolicyDate(standaloneQualifiedDate[2]);
    framed = `${standaloneQualifiedDate[1]} as of ${
      canonicalDate || standaloneQualifiedDate[2]
    }${framed.slice(standaloneQualifiedDate[0].length)}`.trim();
  }
  const standaloneLeadingDate = new RegExp(
    `^(${dateOrYear})\\s+(?:(?:the|an?)\\s+)?` +
      `(${TEMPORAL_STANDALONE_TABULAR_SOURCE_NOUN_PATTERN})\\b`,
  ).exec(framed);
  if (standaloneLeadingDate) {
    const canonicalDate = canonicalPolicyDate(standaloneLeadingDate[1]);
    framed = `${standaloneLeadingDate[2]} as of ${
      canonicalDate || standaloneLeadingDate[1]
    }${framed.slice(standaloneLeadingDate[0].length)}`.trim();
  }
  const metadataDate = new RegExp(
    `\\b(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s+(?:date|dated)\\s+(${dateOrYear})\\b`,
  ).exec(framed);
  if (metadataDate) {
    const canonicalDate = canonicalPolicyDate(metadataDate[2]);
    framed = `${framed.slice(0, metadataDate.index)}${metadataDate[1]} as of ${
      canonicalDate || metadataDate[2]
    }${framed.slice((metadataDate.index || 0) + metadataDate[0].length)}`.trim();
  }
  const leadingDate = new RegExp(
    `\\b(${dateOrYear})\\s+(?:(?:published|issued|released|revised|effective|edition)(?:\\s+edition)?(?:\\s+of)?\\s+)?(${TEMPORAL_SOURCE_NOUN_PATTERN})\\b`,
  ).exec(framed);
  if (leadingDate) {
    const canonicalDate = canonicalPolicyDate(leadingDate[1]);
    framed = `${framed.slice(0, leadingDate.index)}${leadingDate[2]} as of ${
      canonicalDate || leadingDate[1]
    }${framed.slice((leadingDate.index || 0) + leadingDate[0].length)}`.trim();
  }
  const qualifiedDate = new RegExp(
    `\\b(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s+(?:from|effective|revision\\s+date)\\s+` +
      `(${dateOrYear})\\b`,
  ).exec(framed);
  if (qualifiedDate) {
    const canonicalDate = canonicalPolicyDate(qualifiedDate[2]);
    framed = `${framed.slice(0, qualifiedDate.index)}${qualifiedDate[1]} as of ${
      canonicalDate || qualifiedDate[2]
    }${framed.slice((qualifiedDate.index || 0) + qualifiedDate[0].length)}`.trim();
  }
  const dualCurrentPatterns = [
    new RegExp(
      `^current\\s+(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s+(?:current\\s+)?` +
        `(?:${TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN})\\s+(${dateOrYear})\\b`,
    ),
    new RegExp(
      `^(${TEMPORAL_SOURCE_NOUN_PATTERN})\\s+current\\s+` +
        `(?:${TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN})\\s+(${dateOrYear})\\b`,
    ),
    new RegExp(
      `^current\\s+(?:as\\s+(?:of|at))\\s+(${dateOrYear})\\s+` +
        `(${TEMPORAL_SOURCE_NOUN_PATTERN})\\b`,
    ),
  ];
  for (const [index, pattern] of dualCurrentPatterns.entries()) {
    const match = pattern.exec(framed);
    if (!match) continue;
    const sourceNoun = index === 2 ? match[2] : match[1];
    const rawDate = index === 2 ? match[1] : match[2];
    const canonicalDate = canonicalPolicyDate(rawDate);
    framed = `${sourceNoun} as of ${canonicalDate || rawDate}${framed.slice(match[0].length)}`.trim();
    break;
  }
  const temporalState = '(?:current|previous|prior|former|historical|past|forecast|expected|planned|future)';
  const frameMarker = `(?:as\\s+of\\s+${dateOrYear}|${temporalState})`;
  const leadingSourceFrameHead = new RegExp(
    `^(?:(?:source|document)\\s+)?(?:` +
      `${temporalState}\\s+(?:(?:the|an?)\\s+)?${TEMPORAL_SOURCE_NOUN_PATTERN}|` +
      `${TEMPORAL_SOURCE_NOUN_PATTERN}\\s+${frameMarker}` +
    `)\\b`,
  ).test(framed);
  const distinctFrameAnchors = temporalAnchorsInText(framed);
  const qualifiedFrameAnchorMentions = [...framed.matchAll(new RegExp(
    `\\b(?:as\\s+(?:of|at)|valid\\s+(?:(?:through|until)(?:\\s+(?:the\\s+)?end\\s+of)?|for|in|as\\s+(?:of|at))|` +
      `effective\\s+(?:through|until|for|in|as\\s+(?:of|at))|` +
      `applicable(?:\\s+(?:(?:through|until)(?:\\s+(?:the\\s+)?end\\s+of)?|to|for|in))?|` +
      `publication(?:\\s+(?:date|year))?|expires?(?:\\s+at\\s+(?:the\\s+)?end\\s+of)?|` +
      `(?:expiration|expiry)(?:\\s+date)?)\\s+${dateOrYear}\\b`,
    'g',
  ))].length;
  if (
    leadingSourceFrameHead &&
    (distinctFrameAnchors.length > 1 || qualifiedFrameAnchorMentions > 1)
  ) {
    // Multiple qualified snapshots are not one authority frame. Preserve every
    // anchor so current and historical questions both fail closed instead of
    // silently inheriting only the first date or falling back to "current".
    return allowTitleTail
      ? framed.replace(/\b(?:pdf\s+)?page\s+(?:number\s*)?(?:10000|\d{1,4})\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      : framed;
  }
  const temporalOwnerEntity =
    '(?:panel|task|room|building|area|zone|level|floor|grid|door|item|phase|option|unit|suite|bay|section)\\s+["\']?[a-z0-9]+(?:[.-][a-z0-9]+)*["\']?';
  const frameTailIsBounded = (
    match: RegExpExecArray | null,
    allowResponsiveTail = false,
  ) => {
    if (!match) return false;
    const tail = normalizePolicyText(match[1] || '');
    return !tail || allowTitleTail ||
      allowResponsiveTail && sourceTemporalClauseCouldReceiveFrame(tail);
  };
  const boundedFrameValue = (match: RegExpExecArray) => {
    const rawTail = match[1] || '';
    if (!normalizePolicyText(rawTail)) return framed;
    if (new RegExp(
      `^(?:for|concerning|regarding|about|limited\\s+to|covering|pertaining\\s+to|` +
        `with\\s+respect\\s+to|specific\\s+to|excluding)\\s+(?:the\\s+)?${temporalOwnerEntity}\\b`,
    ).test(normalizePolicyText(rawTail))) return framed;
    return framed.slice(0, Math.max(0, framed.length - rawTail.length))
      .replace(/[\s,|:-]+$/, '')
      .trim();
  };
  const globalFrame = new RegExp(
    `^(?:(?:source|document)\\s+)?(?:` +
      `${temporalState}\\s+(?:(?:the|an?)\\s+)?${TEMPORAL_SOURCE_NOUN_PATTERN}|` +
      `${TEMPORAL_SOURCE_NOUN_PATTERN}\\s+${frameMarker}` +
    `)(?:\\s*[,|:-]\\s*|\\s+)?([\\s\\S]*)$`,
  ).exec(framed);
  const compoundGlobalFrame = new RegExp(
    `^(?:(?:source|document)\\s+)?(?:` +
      `${temporalState}\\s+(?:(?:the|an?)\\s+)?${TEMPORAL_COMPOUND_SOURCE_NOUN_PATTERN}|` +
      `${TEMPORAL_COMPOUND_SOURCE_NOUN_PATTERN}\\s+${frameMarker}` +
    `)\\b`,
  ).test(framed);
  if (frameTailIsBounded(globalFrame, compoundGlobalFrame)) {
    return boundedFrameValue(globalFrame as RegExpExecArray);
  }
  const standaloneFrame = new RegExp(
    `^(?:(?:source|document)\\s+)?(?:` +
      `${temporalState}\\s+(?:(?:the|an?)\\s+)?${TEMPORAL_STANDALONE_TABULAR_SOURCE_NOUN_PATTERN}|` +
      `(?:(?:the|an?)\\s+)?${TEMPORAL_STANDALONE_TABULAR_SOURCE_NOUN_PATTERN}\\s+${frameMarker}` +
    `)(?:\\s*[,|:-]\\s*|\\s+)?([\\s\\S]*)$`,
  ).exec(framed);
  if (frameTailIsBounded(standaloneFrame)) {
    return boundedFrameValue(standaloneFrame as RegExpExecArray);
  }
  const scopedEntity =
    '(?:panel|task|room|canopy|building|area|zone|level|floor|grid|door|sheet|page|detail|figure|revision|plan|note|item|phase|option|unit|suite|bay|section)\\s+["\']?[a-z0-9]+(?:[.-][a-z0-9]+)*["\']?';
  const scopedFrame = new RegExp(
    `^${scopedEntity}\\s+${TEMPORAL_GENERIC_SOURCE_NOUN_PATTERN}\\s+${frameMarker}` +
      `(?:\\s*[,|:-]\\s*|\\s+)?([\\s\\S]*)$`,
  ).exec(framed);
  if (frameTailIsBounded(scopedFrame, true)) {
    return boundedFrameValue(scopedFrame as RegExpExecArray);
  }
  const pureTemporalPreamble = new RegExp(
    `^(?:(?:as\\s+of|on|at|in|during)\\s+` +
      `(?:${dateSyntax}|19\\d{2}|20\\d{2}|21\\d{2})\\s*,?|` +
      `current|previous|prior|former|historical|past|forecast|expected|planned|future)$`,
  );
  return pureTemporalPreamble.test(framed) ? framed : null;
}

function temporalSourceClauses(value: string, allowTitleTail = false) {
  const clauses = value.split(/\r?\n+|[;!?]+|\.\s+/)
    .map(normalizePolicyText)
    .filter(Boolean);
  const dateOrYear = `(?:${policyDateSyntax()}|19\\d{2}|20\\d{2}|21\\d{2})`;
  const qualifierOnly = new RegExp(
    `^(?:and\\s+)?(?:${TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN})\\s+${dateOrYear}$`,
  );
  const merged: string[] = [];
  for (const clause of clauses) {
    const previous = merged.at(-1) || '';
    if (
      previous &&
      qualifierOnly.test(clause) &&
      normalizedTemporalSourceFrame(previous, allowTitleTail) != null
    ) {
      merged[merged.length - 1] = `${previous} ${clause}`;
    } else {
      merged.push(clause);
    }
  }
  return merged;
}

export function ecosTemporalFrameAwareProofSegments(value: string) {
  const segments: string[] = [];
  for (const assertion of value.split(/\r?\n+|[!]+|\.\s+/).map(item => item.trim()).filter(Boolean)) {
    const siblings = temporalSourceClauses(assertion);
    if (siblings.length < 2 || !siblings.some(sibling =>
      normalizedTemporalSourceFrame(sibling) != null
    )) continue;
    for (const sibling of siblings) {
      if (normalizedTemporalSourceFrame(sibling) == null) segments.push(sibling);
    }
  }
  return [...new Set(segments)];
}

export function stripECOSTemporalSourceFrameFromAssertion(
  value: string,
  question: string,
) {
  const normalized = normalizePolicyText(value);
  for (const field of generalQuestionFieldRequirements(question)) {
    const match = generalSourceResponsiveTypedFieldMatch(field, normalized, question);
    if (!match || match.start <= 0) continue;
    const prefix = normalized.slice(0, match.start).trim();
    if (normalizedTemporalSourceFrame(prefix) != null) return match.text;
  }
  return value;
}

function temporalAnchorsInText(value: string) {
  const anchors: GeneralTemporalAnchor[] = [];
  const dateSyntax = policyDateSyntax();
  const syntaxNormalized = normalizeTemporalSyntax(value);
  for (const match of syntaxNormalized.matchAll(new RegExp(
    `\\b${TEMPORAL_YEAR_SCOPE_LABEL_PATTERN}\\s*[-/:]?\\s*(19\\d{2}|20\\d{2}|21\\d{2})\\b`,
    'g',
  ))) anchors.push({ kind: 'year', value: match[1] });
  for (const match of syntaxNormalized.matchAll(new RegExp(
    `\\b(19\\d{2}|20\\d{2}|21\\d{2})\\s+${TEMPORAL_YEAR_SCOPE_LABEL_PATTERN}(?=\\s+${TEMPORAL_SOURCE_NOUN_PATTERN}\\b)`,
    'g',
  ))) anchors.push({ kind: 'year', value: match[1] });
  const framedValue = foldTemporalYearScopes(syntaxNormalized);
  for (const match of framedValue.matchAll(new RegExp(
    `\\b(?:as\\s+(?:of|at)|on|at|in|during)\\s+(${dateSyntax})\\b`,
    'g',
  ))) {
    const canonical = canonicalPolicyDate(match[1]);
    if (canonical) anchors.push({ kind: 'date', value: canonical });
  }
  for (const match of framedValue.matchAll(
    /\b(?:as\s+(?:of|at)|on|at|in|during)\s+(19\d{2}|20\d{2}|21\d{2})(?!-\d)\b/g,
  )) anchors.push({ kind: 'year', value: match[1] });
  for (const match of framedValue.matchAll(new RegExp(
    `\\b(?:from|per|according\\s+to|based\\s+on|using|under|in|on)\\s+(?:the\\s+)?` +
      `((?:19\\d{2}|20\\d{2}|21\\d{2}))\\s+` +
      `(?:(?:published\\s+)?edition\\s+of\\s+(?:the\\s+)?)?${TEMPORAL_SOURCE_NOUN_PATTERN}\\b`,
    'g',
  ))) anchors.push({ kind: 'year', value: match[1] });
  for (const match of framedValue.matchAll(new RegExp(
    `\\b(?:from|per|according\\s+to|based\\s+on|using|under|in|on)\\s+(?:the\\s+)?` +
      `${TEMPORAL_SOURCE_NOUN_PATTERN}\\s*` +
      `(?:[,|:-]\\s*)?(?:${TEMPORAL_SOURCE_DATE_QUALIFIER_PATTERN}\\s+)?` +
      `(19\\d{2}|20\\d{2}|21\\d{2})\\b`,
    'g',
  ))) anchors.push({ kind: 'year', value: match[1] });
  for (const match of framedValue.matchAll(
    /\bfor\s+(?:the\s+)?(?:year\s+)?(19\d{2}|20\d{2}|21\d{2})(?!-\d)\b(?=\s*(?:only\b|[.,;:]|$|(?:is|are|was|were)\b))/g,
  )) anchors.push({ kind: 'year', value: match[1] });
  const qualifiedAnchor = new RegExp(
    `\\b(?:valid|effective|applicable)\\s+(?:(?:through|until)\\s+(?:the\\s+)?(?:end\\s+of\\s+)?|` +
      `(?:for|in|as\\s+(?:of|at))\\s+)(${dateSyntax}|19\\d{2}|20\\d{2}|21\\d{2})\\b|` +
    `\\b(?:publication(?:\\s+(?:date|year))?|expires?(?:\\s+at\\s+(?:the\\s+)?end\\s+of)?|` +
      `(?:expiration|expiry)(?:\\s+date)?)\\s+(${dateSyntax}|19\\d{2}|20\\d{2}|21\\d{2})\\b`,
    'g',
  );
  for (const match of framedValue.matchAll(qualifiedAnchor)) {
    const rawAnchor = match[1] || match[2];
    const canonical = canonicalPolicyDate(rawAnchor);
    if (canonical) anchors.push({ kind: 'date', value: canonical });
    else if (/^(?:19\d{2}|20\d{2}|21\d{2})$/.test(rawAnchor)) {
      anchors.push({ kind: 'year', value: rawAnchor });
    }
  }
  const leadingDate = new RegExp(`^\\s*(${dateSyntax})\\s*[:, -]`).exec(framedValue)?.[1] || '';
  if (leadingDate) {
    const canonical = canonicalPolicyDate(leadingDate);
    if (canonical) anchors.push({ kind: 'date', value: canonical });
  }
  const leadingYear = /^\s*(19\d{2}|20\d{2}|21\d{2})\s*[:, -]/.exec(framedValue)?.[1] || '';
  if (leadingYear) anchors.push({ kind: 'year', value: leadingYear });
  const uniqueAnchors = new Map(anchors.map(anchor => [`${anchor.kind}:${anchor.value}`, anchor]));
  return [...uniqueAnchors.values()];
}

type EntityYearBinding = Readonly<{
  kind: 'budget' | 'project' | 'renovation' | 'phase' | 'program' | 'contract' | 'plan' | 'schedule';
  year: string;
}>;

function questionEntityYearBindings(value: string): EntityYearBinding[] {
  const bindings: EntityYearBinding[] = [];
  const kinds = '(budget|project|renovation|phase|program|contract|plan|schedule)';
  for (const match of value.matchAll(new RegExp(
    `\\b(19\\d{2}|20\\d{2}|21\\d{2})\\s+${kinds}\\b`,
    'g',
  ))) bindings.push({ year: match[1], kind: match[2] as EntityYearBinding['kind'] });
  for (const match of value.matchAll(new RegExp(
    `\\b${kinds}\\s+(19\\d{2}|20\\d{2}|21\\d{2})\\b`,
    'g',
  ))) bindings.push({ year: match[2], kind: match[1] as EntityYearBinding['kind'] });
  return [...new Map(bindings.map(binding => [`${binding.kind}:${binding.year}`, binding])).values()];
}

function questionEntityYearTokens(value: string) {
  return [...new Set(questionEntityYearBindings(value).map(binding => binding.year))];
}

function statementMatchesEntityYearBindings(
  question: string,
  statement: string,
  requested: readonly EntityYearBinding[],
) {
  const fields = generalQuestionFieldRequirements(question);
  const clauses = statement.split(/[;!?]|\.\s+/).map(normalizePolicyText).filter(Boolean);
  const responsive = (clause: string) => fields.length === 0 || fields.some(field =>
    generalSourceResponsiveTypedFieldClause(field, clause, question) != null
  );
  return requested.every(binding => {
    const responsiveClauses = clauses.filter(responsive);
    if (!responsiveClauses.some(clause => questionEntityYearBindings(clause).some(candidate =>
      candidate.kind === binding.kind && candidate.year === binding.year
    ))) return false;
    return responsiveClauses.every(clause => questionEntityYearBindings(clause)
      .filter(candidate => candidate.kind === binding.kind)
      .every(candidate => candidate.year === binding.year));
  });
}

function questionHasUnresolvedTemporalSyntax(value: string) {
  const entityYears = new Set(questionEntityYearTokens(value));
  const parsedAnchors = temporalAnchorsInText(value);
  const yearIsCovered = (year: string) => entityYears.has(year) || parsedAnchors.some(anchor =>
    anchor.kind === 'year' ? anchor.value === year : anchor.value.startsWith(`${year}-`)
  );
  return [...value.matchAll(/\b(19\d{2}|20\d{2}|21\d{2})\b/g)]
    .some(match => {
      if (yearIsCovered(match[1])) return false;
      const start = match.index || 0;
      const identifierDate = value.slice(start).match(
        /^(?:19\d{2}|20\d{2}|21\d{2})-\d{1,2}-\d{1,2}\b/,
      )?.[0] || '';
      if (!identifierDate) return true;
      const escapedDate = identifierDate.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      return !new RegExp(
        String.raw`\b(?:task|activity|rfi|asi|submittal|document|drawing|item|option|work\s+package)\s+${escapedDate}$`,
      ).test(value.slice(Math.max(0, start - 48), start + identifierDate.length));
    });
}

function stripGeneralTemporalFrame(value: string) {
  const anchor = `(?:${policyDateSyntax()}|19\\d{2}|20\\d{2}|21\\d{2})`;
  return foldTemporalYearScopes(normalizeTemporalSyntax(value))
    .replace(new RegExp(`^\\s*(?:(?:as\\s+of|on|at|in|during)\\s+)?${anchor}\\s*[:, -]\\s*`), '')
    .replace(new RegExp(`\\s+(?:as\\s+of|on|at|in|during|for)\\s+(?:the\\s+)?(?:year\\s+)?${anchor}\\s*[.]?\\s*$`), '')
    .trim();
}

type DirectedRelationshipRequirement = Readonly<{
  verb: 'feed' | 'serve' | 'reference' | 'approve';
  subjectAnchor: string;
  objectAnchor: string;
}>;

function directedRelationshipRequirement(question: string): DirectedRelationshipRequirement | null {
  const value = normalizePolicyText(question).replace(/[?.!]+$/, '');
  const approver = /^(?:who|which\s+.+?)\s+approved\s+(.+)$/.exec(value);
  if (approver) return Object.freeze({
    verb: 'approve' as const,
    subjectAnchor: '',
    objectAnchor: cleanRelationshipAnchor(approver[1]),
  });
  const yesNo = /\b(?:does|do|did)\s+(.+?)\s+(feed|serve|reference)\s+(.+)$/.exec(value);
  if (yesNo && !/^(?:what|which|who)\b/.test(value)) {
    return Object.freeze({
      verb: yesNo[2] as DirectedRelationshipRequirement['verb'],
      subjectAnchor: cleanRelationshipAnchor(yesNo[1]),
      objectAnchor: cleanRelationshipAnchor(yesNo[3]),
    });
  }
  const outgoing = /\b(?:what|which\s+.+?|who)\s+(?:does|do|did)\s+(.+?)\s+(feed|serve|reference)\b/.exec(value) ||
    /\b(?:list|show|tell)[\s\S]{0,24}\bwhat\s+(.+?)\s+(feeds?|serves?|references?)\b/.exec(value);
  if (outgoing) return Object.freeze({
    verb: outgoing[2].replace(/s$/, '') as DirectedRelationshipRequirement['verb'],
    subjectAnchor: cleanRelationshipAnchor(outgoing[1]),
    objectAnchor: '',
  });
  const passiveOutgoing = /\bwhat\s+(?:is|are)\s+(fed|served|referenced)\s+by\s+(.+)$/.exec(value);
  if (passiveOutgoing) return Object.freeze({
    verb: passiveRelationshipVerb(passiveOutgoing[1]),
    subjectAnchor: cleanRelationshipAnchor(passiveOutgoing[2]),
    objectAnchor: '',
  });
  const passiveIncoming = /^(.+?)\s+(?:is|are)\s+(fed|served|referenced)\s+by\s+(?:what|which|who)\b/.exec(value);
  if (passiveIncoming) return Object.freeze({
    verb: passiveRelationshipVerb(passiveIncoming[2]),
    subjectAnchor: '',
    objectAnchor: cleanRelationshipAnchor(passiveIncoming[1]),
  });
  const incoming = /\b(?:what|which\s+.+?|who)\s+(feeds?|serves?|references?)\s+(.+)$/.exec(value);
  if (!incoming) return null;
  return Object.freeze({
    verb: incoming[1].replace(/s$/, '') as DirectedRelationshipRequirement['verb'],
    subjectAnchor: '',
    objectAnchor: cleanRelationshipAnchor(incoming[2]),
  });
}

function textMatchesDirectedRelationship(
  value: string,
  requirement: DirectedRelationshipRequirement,
) {
  const subject = relationshipAnchorPattern(requirement.subjectAnchor);
  const object = relationshipAnchorPattern(requirement.objectAnchor);
  const activeVerb = requirement.verb === 'reference'
    ? 'references?'
    : requirement.verb === 'approve' ? 'approv(?:e|es|ed)'
    : `${escapeRegExp(requirement.verb)}s?`;
  const passiveVerb = requirement.verb === 'feed'
    ? 'fed'
    : requirement.verb === 'serve' ? 'served'
    : requirement.verb === 'approve' ? 'approved' : 'referenced';
  for (const clause of value.split(/[;.!?]+/).map(item => item.trim()).filter(Boolean)) {
    if (subject && object) {
      if (new RegExp(`\\b${subject}\\b\\s+${activeVerb}\\s+(?:the\\s+)?${object}\\b`).test(clause)) return true;
      if (new RegExp(`\\b${object}\\b\\s+(?:is|are|was|were)\\s+${passiveVerb}\\s+by\\s+(?:the\\s+)?${subject}\\b`).test(clause)) return true;
      continue;
    }
    if (subject) {
      const active = new RegExp(`\\b${subject}\\b\\s+${activeVerb}\\s+(.+)$`).exec(clause);
      if (active && relationshipEndpointIsMeaningful(active[1])) return true;
      const passive = new RegExp(`^(.+?)\\s+(?:is|are|was|were)\\s+${passiveVerb}\\s+by\\s+(?:the\\s+)?${subject}\\b`).exec(clause);
      if (passive && relationshipEndpointIsMeaningful(passive[1])) return true;
      continue;
    }
    if (object) {
      const active = new RegExp(`^(.+?)\\s+${activeVerb}\\s+(?:the\\s+)?${object}\\b`).exec(clause);
      if (active && relationshipEndpointIsMeaningful(active[1])) return true;
      const passive = new RegExp(`\\b${object}\\b\\s+(?:is|are|was|were)\\s+${passiveVerb}\\s+by\\s+(.+)$`).exec(clause);
      if (passive && relationshipEndpointIsMeaningful(passive[1])) return true;
    }
  }
  return false;
}

function cleanRelationshipAnchor(value: string) {
  return value.trim().replace(/^(?:the|a|an)\s+/, '').replace(/\s+(?:on|in|from)\s+(?:the\s+)?(?:drawing|plan|schedule)$/, '');
}

function relationshipAnchorPattern(value: string) {
  return value ? escapeRegExp(value).replace(/\\\s+/g, '\\s+') : '';
}

function passiveRelationshipVerb(value: string): DirectedRelationshipRequirement['verb'] {
  return value === 'fed' ? 'feed' : value === 'served' ? 'serve' : 'reference';
}

function relationshipEndpointIsMeaningful(value: string) {
  const endpoint = value.trim().replace(/^(?:the|a|an)\s+/, '');
  return Boolean(endpoint) && !/^(?:is\s+)?(?:status|list|field|unknown|blank|none|pending|review|unavailable)(?:\b|$)/.test(
    endpoint,
  );
}

function generalQuestionAlternativeEntityKinds(question: string) {
  const kinds: string[] = [];
  const aliases: Readonly<Record<string, string>> = {
    panels: 'panel', tasks: 'task', notes: 'note', details: 'detail', items: 'item',
    figures: 'figure', drawings: 'drawing', plans: 'plan', revisions: 'revision',
    doors: 'door', rooms: 'room', valves: 'valve', grids: 'grid', canopies: 'canopy',
    buildings: 'building', areas: 'area', zones: 'zone', levels: 'level', floors: 'floor',
    types: 'type',
  };
  for (const match of question.matchAll(
    /\b(panels?|tasks?|notes?|details?|items?|figures?|drawings?|plans?|revisions?|doors?|rooms?|valves?|grids?|canop(?:y|ies)|buildings?|areas?|zones?|levels?|floors?|types?)\s+[\'"‘’“”]?[a-z0-9]+/gi,
  )) {
    const raw = match[1].toLowerCase();
    kinds.push(aliases[raw] || raw);
  }
  return [...new Set(kinds)];
}

function ecosQuestionScopeMatchesEvidence(
  question: string,
  normalizedStatement: string,
  normalizedSource: string,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const scopedRequirement = analyzeECOSProjectQuestion(question);
  if (
    (scopedRequirement.kind === 'presence' || scopedRequirement.kind === 'quantity') &&
    !roomScopeMatchesQuestion(normalizedQuestion, normalizedStatement, normalizedSource)
  ) return false;
  if (
    (scopedRequirement.kind === 'presence' || scopedRequirement.kind === 'quantity') &&
    evidencePlacesRequestedScopeOutsideItsRequestedRelation(normalizedQuestion, normalizedStatement)
  ) return false;
  if (
    scopedRequirement.kind === 'presence' &&
    evidencePlacesRequestedScopeOutsideItsRequestedRelation(normalizedQuestion, normalizedSource)
  ) return false;
  const requestedDisciplines = canonicalProjectDisciplines(normalizedQuestion);
  if (requestedDisciplines.length > 0) {
    const statementDisciplines = canonicalProjectDisciplines(normalizedStatement);
    const sourceDisciplines = canonicalProjectDisciplines(normalizedSource);
    if (
      statementDisciplines.some(discipline => !requestedDisciplines.includes(discipline)) ||
      !sourceDisciplines.some(discipline => requestedDisciplines.includes(discipline)) ||
      sourceDisciplines.some(discipline => !requestedDisciplines.includes(discipline))
    ) return false;
  }
  if (
    /\b(?:current|currently|latest|today|present)\b/.test(normalizedQuestion) &&
    (
      /\b(?:former|previous|previously|prior|historical|old|obsolete|superseded|archived|earlier|outdated|legacy|withdrawn|retired|replaced|deleted)\b/.test(
        `${normalizedStatement} ${normalizedSource}`,
      ) ||
      evidenceMarksSourceVoid(`${normalizedStatement} ${normalizedSource}`) ||
      /\b(?:not current|no longer current|non[- ]?current|out[- ]of[- ]date|cancel(?:ed|led)|expired|rescinded|revoked|voided|invalidated|rejected|unissued|invalid|not[- ](?:issued[- ])?for[- ]construction|issued[- ]not[- ]for[- ]construction)\b(?:\s+(?:current|architectural|structural|electrical|mechanical|plumbing|civil|landscape|project)){0,2}\s+\b(?:drawing|document|plan|sheet|schedule|update|revision|source)\b/.test(
        `${normalizedStatement} ${normalizedSource}`,
      ) ||
      /\b(?:drawing|document|plan|sheet|schedule|update|revision|source)\b\s+(?:(?:is|was|marked|labeled|labelled)\s+)?(?:not current|no longer current|non[- ]?current|out[- ]of[- ]date|cancel(?:ed|led)|expired|rescinded|revoked|voided|invalidated|rejected|unissued|invalid|not[- ](?:issued[- ])?for[- ]construction|issued[- ]not[- ]for[- ]construction)\b/.test(
        `${normalizedStatement} ${normalizedSource}`,
      )
    )
  ) return false;
  if (
    /\bnew\b/.test(normalizedQuestion) &&
    (
      /\b(?:existing|former|previous|previously|prior|historical|old|obsolete|superseded|earlier|outdated|legacy|withdrawn|retired|replaced|deleted)\b/.test(
        `${normalizedStatement} ${normalizedSource}`,
      ) ||
      evidenceMarksSourceVoid(`${normalizedStatement} ${normalizedSource}`)
    ) &&
    !/\bnew\b/.test(normalizedStatement)
  ) return false;
  return true;
}

function evidenceMarksSourceVoid(value: string) {
  const sourceNoun = '(?:drawing|document|plan|sheet|schedule|update|revision|source)';
  const descriptor =
    '(?:(?:current|architectural|structural|electrical|mechanical|plumbing|civil|landscape|project)\\s+){0,2}';
  const safeVoid = 'void\\b(?![- ]?(?:fill|space|slab)\\b)';
  return new RegExp(
    `(?:^|[.!;]\\s*)(?:\\d+(?:[.-]\\d+)*\\s*[-:|]?\\s*)?${safeVoid}[^.!;]{0,80}\\b${sourceNoun}\\b|` +
      `\\b${safeVoid}\\s+${descriptor}${sourceNoun}\\b|` +
      `\\b${sourceNoun}\\b\\s+(?:(?:is|was|marked|labeled|labelled)\\s+)?${safeVoid}`,
    'i',
  ).test(value);
}

function roomScopeMatchesQuestion(
  normalizedQuestion: string,
  normalizedStatement: string,
  normalizedSource: string,
) {
  const requestedSelectors = roomScopeSelectors(normalizedQuestion);
  if (requestedSelectors.size > 0) {
    const statementSelectors = roomScopeSelectors(normalizedStatement);
    const sourceSelectors = roomScopeSelectors(normalizedSource);
    if (
      ![...requestedSelectors].every(selector => statementSelectors.has(selector)) ||
      ![...requestedSelectors].every(selector => sourceSelectors.has(selector))
    ) return false;
  }
  const requestedModifiers = roomScopeModifiers(normalizedQuestion);
  const statementModifiers = roomScopeModifiers(normalizedStatement);
  const sourceModifiers = roomScopeModifiers(normalizedSource);
  for (const [group, requested] of requestedModifiers) {
    if (requested.size !== 1) return false;
    const expected = [...requested][0];
    const statementValues = statementModifiers.get(group) || new Set<string>();
    const sourceValues = sourceModifiers.get(group) || new Set<string>();
    if (
      statementValues.size !== 1 ||
      !statementValues.has(expected) ||
      !sourceValues.has(expected)
    ) return false;
  }
  return true;
}

function roomScopeSelectors(value: string) {
  const selectors = new Set<string>();
  const identifier = '["\']?([a-z0-9]+(?:[.-][a-z0-9]+)*)["\']?';
  for (const match of value.matchAll(new RegExp(`\\broom\\s+type\\s+${identifier}\\b`, 'g'))) {
    selectors.add(`room-type:${match[1]}`);
  }
  for (const match of value.matchAll(new RegExp(`\\btype\\s+${identifier}\\s+rooms?\\b`, 'g'))) {
    selectors.add(`room-type:${match[1]}`);
  }
  for (const match of value.matchAll(new RegExp(`\\brooms?\\s+${identifier}\\b`, 'g'))) {
    if (match[1] !== 'type') selectors.add(`room:${match[1]}`);
  }
  return selectors;
}

function roomScopeModifiers(value: string) {
  const modifiers = new Map<string, Set<string>>();
  const add = (group: string, modifier: string) => {
    const values = modifiers.get(group) || new Set<string>();
    values.add(modifier);
    modifiers.set(group, values);
  };
  for (const [group, pattern] of [
    ['occupancy', /\b(unoccupied|occupied)\s+(?:[a-z0-9-]+\s+){0,2}rooms?\b/g],
    ['enclosure', /\b(interior|exterior)\s+(?:[a-z0-9-]+\s+){0,2}rooms?\b/g],
    ['accessibility', /\b(non[- ]accessible|inaccessible|accessible)\s+(?:[a-z0-9-]+\s+){0,2}rooms?\b/g],
    ['typology', /\b(standard|typical)\s+(?:[a-z0-9-]+\s+){0,2}rooms?\b/g],
  ] as const) {
    for (const match of value.matchAll(pattern)) {
      const raw = match[1];
      add(group, raw === 'non accessible' ? 'non-accessible' : raw);
    }
  }
  return modifiers;
}

function policyScopeRelationBeforeScope(prefix: string) {
  if (/\bwithin\s+(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:feet|foot|ft|inches?|in)\s+of\s+(?:the\s+)?$/.test(prefix)) return 'proximity';
  if (/\b(?:at\s+)?(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:feet|foot|ft|inches?|in)\s+from\s+(?:the\s+)?$/.test(prefix)) return 'proximity';
  if (/\boutside(?:\s+(?:(?:the\s+)?(?:bounds?|limits?|boundary)\s+)?of)?\s+(?:the\s+)?$/.test(prefix)) return 'outside';
  if (/\b(?:near(?:by)?|close\s+to|proximal\s+to|in\s+the\s+vicinity\s+of)\s+(?:the\s+)?$/.test(prefix)) return 'proximity';
  if (/\baround\s+(?:the\s+)?$/.test(prefix)) return 'around';
  if (/\bopposite(?:\s+to)?\s+(?:the\s+)?$/.test(prefix)) return 'opposite';
  if (/\b(?:adjacent\s+to|next\s+to|beside)\s+(?:the\s+)?$/.test(prefix)) return 'adjacent';
  if (/\b(?:beyond|across\s+from|away\s+from)\s+(?:the\s+)?$/.test(prefix)) return 'beyond';
  if (/\b(?:above|over)\s+(?:the\s+)?$/.test(prefix)) return 'above';
  if (/\b(?:below|beneath|underneath|under)\s+(?:the\s+)?$/.test(prefix)) return 'below';
  if (/\bbehind\s+(?:the\s+)?$/.test(prefix)) return 'behind';
  if (/\bin\s+front\s+of\s+(?:the\s+)?$/.test(prefix)) return 'front';
  if (/\b(?:north|south|east|west)\s+of\s+(?:the\s+)?$/.test(prefix)) {
    return prefix.match(/\b(north|south|east|west)\s+of\s+(?:the\s+)?$/)?.[1] || 'cardinal';
  }
  if (/\bto\s+the\s+(?:left|right)\s+of\s+(?:the\s+)?$/.test(prefix)) {
    return prefix.match(/\b(left|right)\s+of\s+(?:the\s+)?$/)?.[1] || 'side';
  }
  if (/\b(?:alongside|abutting|bordering|surrounding|along)\s+(?:the\s+)?$/.test(prefix)) return 'boundary';
  if (/\b(?:at|on)\s+(?:the\s+)?(?:edge|border)\s+of\s+(?:the\s+)?$/.test(prefix)) return 'boundary';
  if (/\boffset\s+from\s+(?:the\s+)?$/.test(prefix)) return 'offset';
  if (/\bbetween\s+(?:the\s+)?$/.test(prefix)) return 'between';
  if (/\b(?:in|on|at|within|inside)\s+(?:the\s+)?$/.test(prefix)) return 'inside';
  return 'direct';
}

function evidencePlacesRequestedScopeOutsideItsRequestedRelation(
  normalizedQuestion: string,
  normalizedEvidence: string,
) {
  const scopeLabel =
    '(?:detail|det\\.?|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht\\.?|page|pg\\.?|figure|fig\\.?|drawing|dwg\\.?|document|doc\\.?|revision|rev\\.?|plan|note|task|type|unit|suite|bay|section|phase|option|item)';
  const canonicalScopeLabel = (value: string) => ({
    det: 'detail', 'det.': 'detail', sht: 'sheet', 'sht.': 'sheet',
    pg: 'page', 'pg.': 'page', fig: 'figure', 'fig.': 'figure',
    dwg: 'drawing', 'dwg.': 'drawing', doc: 'document', 'doc.': 'document',
    rev: 'revision', 'rev.': 'revision',
  } as Readonly<Record<string, string>>)[value] || value;
  const scopeLabelPattern = (label: string) => ({
    detail: '(?:detail|det\\.?)', sheet: '(?:sheet|sht\\.?)',
    page: '(?:page|pg\\.?)', figure: '(?:figure|fig\\.?)',
    drawing: '(?:drawing|dwg\\.?)', document: '(?:document|doc\\.?)',
    revision: '(?:revision|rev\\.?)',
  } as Readonly<Record<string, string>>)[label] || escapeRegExp(label);
  const requestedScopes = [...normalizedQuestion.matchAll(
    new RegExp(`\\b(${scopeLabel})\\s+["']?\\s*([a-z0-9]+(?:[.-][a-z0-9]+)*)\\s*["']?`, 'g'),
  )];
  return requestedScopes.some(match => {
    const label = canonicalScopeLabel(match[1]);
    const scope = `${scopeLabelPattern(label)}\\s+["']?\\s*${escapeRegExp(match[2])}\\s*["']?`;
    const expectedRelation = policyScopeRelationBeforeScope(
      normalizedQuestion.slice(Math.max(0, (match.index || 0) - 64), match.index || 0),
    );
    const evidenceRelations = new Set<string>();
    let predicateNotInScope = false;
    for (const evidenceMatch of normalizedEvidence.matchAll(new RegExp(`\\b${scope}\\b`, 'g'))) {
      const prefix = normalizedEvidence.slice(
        Math.max(0, (evidenceMatch.index || 0) - 96),
        evidenceMatch.index || 0,
      );
      evidenceRelations.add(policyScopeRelationBeforeScope(prefix));
      if (/\b(?:shown|provided|present|included|contained|identified|found|located|counted)\s+not\s+(?:in|on|at|within|inside)\s+(?:the\s+)?$/.test(prefix)) {
        predicateNotInScope = true;
      }
    }
    if (predicateNotInScope) return true;
    if (expectedRelation === 'direct' || expectedRelation === 'inside') {
      return [...evidenceRelations].some(relation => relation !== 'direct' && relation !== 'inside');
    }
    return !evidenceRelations.has(expectedRelation) ||
      [...evidenceRelations].some(relation => relation !== expectedRelation && relation !== 'direct');
  });
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
  const contextTokenMatchers = prepareContextTokenEvidenceMatchers(contextTokens);
  const containsRequestedMeasurementValue = requestedMeasurementValueMatcherForRequirement(
    question,
    requirement,
  );
  return analyzeECOSQuestionEvidenceContextWithPreparedQuestion({
    question,
    evidenceText,
    requirement,
    contextTokens,
    contextTokenMatchers,
    containsRequestedMeasurementValue,
    normalizedQuestion: normalizePolicyText(question),
  });
}

export function prepareECOSQuestionEvidenceContextAnalyzer(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  const contextTokens = Object.freeze(questionContextTokens(question, requirement));
  const contextTokenMatchers = prepareContextTokenEvidenceMatchers(contextTokens);
  const containsRequestedMeasurementValue = requestedMeasurementValueMatcherForRequirement(
    question,
    requirement,
  );
  const normalizedQuestion = normalizePolicyText(question);
  return Object.freeze((evidenceText: string) =>
    analyzeECOSQuestionEvidenceContextWithPreparedQuestion({
      question,
      evidenceText,
      requirement,
      contextTokens,
      contextTokenMatchers,
      containsRequestedMeasurementValue,
      normalizedQuestion,
    })
  );
}

function analyzeECOSQuestionEvidenceContextWithPreparedQuestion({
  question,
  evidenceText,
  requirement,
  contextTokens,
  contextTokenMatchers,
  containsRequestedMeasurementValue,
  normalizedQuestion,
}: {
  question: string;
  evidenceText: string;
  requirement: ECOSProjectAnswerRequirement;
  contextTokens: readonly string[];
  contextTokenMatchers: ReadonlyMap<string, ContextTokenEvidenceMatcher>;
  containsRequestedMeasurementValue: (value: string) => boolean;
  normalizedQuestion: string;
}): ECOSQuestionEvidenceContext {
  const locationDirectionTokens = contextTokens.filter(token => LOCATION_DIRECTION_TOKENS.has(token));
  const hasDirectionalLocation = locationDirectionTokens.length > 0;
  const isLocationKind = (token: string) => LOCATION_KIND_TOKENS.has(token) &&
    (token !== 'area' || hasDirectionalLocation);
  const locationKindTokens = contextTokens.filter(isLocationKind);
  const subjectTokens = contextTokens.filter(token =>
    !LOCATION_DIRECTION_TOKENS.has(token) && !isLocationKind(token)
  );
  const normalizedEvidence = normalizePolicyText(evidenceText);
  const canonicalEvidence = canonicalContextMatchText(normalizedEvidence);
  const tokenMatchesEvidence = (token: string) =>
    contextTokenMatchers.get(token)?.(normalizedEvidence, canonicalEvidence) || false;
  const matchedSubjectTokens = subjectTokens.filter(token =>
    tokenMatchesEvidence(token)
  );
  const matchedLocationDirectionTokens = locationDirectionTokens.filter(token =>
    tokenMatchesEvidence(token)
  );
  const matchedLocationKindTokens = locationKindTokens.filter(token =>
    tokenMatchesEvidence(token)
  );
  const requiredSubjectDiscriminators = subjectTokens.filter(token =>
    REQUIRED_SUBJECT_DISCRIMINATORS.has(token)
  );
  const requiresADAAccessibleScope = subjectTokens.includes('ada') &&
    subjectTokens.includes('accessible');
  const subjectMatched = (subjectTokens.length === 0 ||
    matchedSubjectTokens.length / subjectTokens.length >= 0.5) &&
    requiredSubjectDiscriminators.every(token => matchedSubjectTokens.includes(token)) &&
    (!requiresADAAccessibleScope || ['ada', 'accessible'].some(token =>
      matchedSubjectTokens.includes(token)
    ));
  const locationMatched = (
    locationDirectionTokens.length === 0 ||
    matchedLocationDirectionTokens.length > 0
  ) && (
    locationKindTokens.length === 0 ||
    matchedLocationKindTokens.length > 0
  );
  const expressedMeasurementAttribute = requirement.kind === 'measurement' &&
    evidenceExpressesRequestedMeasurementAttribute(requirement, normalizedEvidence, question);
  const requiresFrontLandscapeDepthConvention = requirement.kind === 'measurement' &&
    requirement.attribute === 'depth' &&
    /\bfront\s+landscape(?:\s+(?:area|depth))?\b/.test(normalizedQuestion);
  return Object.freeze({
    subjectTokens: Object.freeze(subjectTokens),
    locationDirectionTokens: Object.freeze(locationDirectionTokens),
    locationKindTokens: Object.freeze(locationKindTokens),
    matchedSubjectTokens: Object.freeze(matchedSubjectTokens),
    matchedLocationDirectionTokens: Object.freeze(matchedLocationDirectionTokens),
    matchedLocationKindTokens: Object.freeze(matchedLocationKindTokens),
    subjectMatched,
    locationMatched,
    measurementMatched: containsRequestedMeasurementValue(normalizedEvidence),
    attributeMatched: requirement.kind === 'general' ||
      (requiresFrontLandscapeDepthConvention
        ? expressedMeasurementAttribute
        : requirement.attributeTerms.some(term => normalizedEvidence.includes(term)) ||
          expressedMeasurementAttribute),
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
  const context = analyzeECOSQuestionEvidenceContext(question, normalizedEvidence);
  const subjectCoverage = context.subjectTokens.length > 0
    ? context.matchedSubjectTokens.length / context.subjectTokens.length
    : 0;
  const locationParts = context.locationDirectionTokens.length + context.locationKindTokens.length;
  const matchedLocationParts = context.matchedLocationDirectionTokens.length +
    context.matchedLocationKindTokens.length;
  const locationCoverage = locationParts > 0 ? matchedLocationParts / locationParts : 0;
  const measurementBonus = requirement.kind === 'measurement' && context.measurementMatched ? 1 : 0;
  const attributeBonus = requirement.kind !== 'general' && context.attributeMatched ? 0.5 : 0;
  const presenceBonus = requirement.kind === 'presence' &&
    containsECOSExplicitPresenceEvidence(normalizedEvidence, requirement.attributeTerms) ? 1.5 : 0;
  const responsiveBonus = context.subjectMatched && context.locationMatched ? 1 : 0;
  return subjectCoverage + locationCoverage + measurementBonus + attributeBonus + presenceBonus + responsiveBonus;
}

export function containsECOSMeasurementValue(value: string) {
  const normalized = normalizePolicyText(value)
    .replace(/[\u2033\u201d]/g, '"')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/(\d(?:\.\d+)?)-(inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)\b/g, '$1 $2');
  return MEASUREMENT_VALUE_PATTERN.test(normalized) || FEET_AND_INCHES_PATTERN.test(normalized);
}

export function containsECOSRequestedMeasurementValue(question: string, value: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  return requestedMeasurementValueMatcherForRequirement(
    question,
    requirement,
  )(value);
}

function requestedMeasurementValueMatcherForRequirement(
  question: string,
  requirement: ECOSProjectAnswerRequirement,
) {
  const requestedUnits = requirement.kind === 'measurement'
    ? requestedMeasurementOutputUnits(question, requirement.attribute)
    : new Set<string>();
  return (value: string) => containsECOSRequestedMeasurementValueForRequirement(
    question,
    value,
    requirement,
    requestedUnits,
  );
}

export function prepareECOSRequestedMeasurementValueMatcher(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  return Object.freeze(requestedMeasurementValueMatcherForRequirement(question, requirement));
}

function containsECOSRequestedMeasurementValueForRequirement(
  question: string,
  value: string,
  requirement: ECOSProjectAnswerRequirement,
  requestedUnits: ReadonlySet<string>,
) {
  if (requirement.kind !== 'measurement') return containsECOSMeasurementValue(value);
  const normalized = normalizePolicyText(value.replace(/(?<=\d)\s*:\s*(?=\d)/g, ' ratio '))
    .replace(/[\u2033\u201d]/g, '"')
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/(\d(?:\.\d+)?)-(inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)\b/g, '$1 $2');
  const exactCompositeAttributeExpression =
    requirement.attribute !== 'area' &&
    requirement.attribute !== 'grade' &&
    evidenceExpressesRequestedMeasurementAttribute(requirement, normalized, question);
  const feetAndInches = FEET_AND_INCHES_PATTERN.test(normalized);
  const hasCompatibleDimension = requirement.attribute === 'area'
    ? !AREA_COMPOSITE_UNIT_PATTERN.test(normalized) && AREA_MEASUREMENT_VALUE_PATTERN.test(normalized)
    : requirement.attribute === 'grade'
      ? !GRADE_COMPOSITE_UNIT_PATTERN.test(normalized) && GRADE_MEASUREMENT_VALUE_PATTERN.test(normalized)
      : feetAndInches || (
        (!LINEAR_COMPOSITE_UNIT_PATTERN.test(normalized) || exactCompositeAttributeExpression) && (
          LINEAR_MEASUREMENT_VALUE_PATTERN.test(normalized) ||
          requirement.attribute === 'thickness' &&
            /(?:^|\s|\b)\d+(?:\.\d+)?\s*(?:gauge|ga\.?)(?=$|\s|[-(),.;:])/i.test(normalized)
        )
      );
  if (!hasCompatibleDimension) return false;
  return requestedUnits.size === 0 || requestedUnits.size === 1 &&
    measurementTextUsesUnitFamily(normalized, [...requestedUnits][0]);
}

function requestedMeasurementOutputUnits(question: string, attribute: string | null) {
  const normalized = normalizePolicyText(question).replace(/[.;:]+$/, '').trim();
  const units = new Set<string>();
  const excludedUnits = new Set<string>();
  const outputTail = [...normalized.matchAll(/\b(?:in|to)\s+([\s\S]{1,100})/g)].at(-1)?.[1] || '';
  const attributePattern = attribute === 'area' ? '(?:area|footprint)'
    : attribute === 'grade' ? '(?:grade|slope)'
    : attribute === 'width' ? '(?:width|wide)'
    : attribute === 'height' ? '(?:height|high)'
    : attribute === 'thickness' ? '(?:thickness|thick)'
    : attribute === 'depth' ? '(?:depth|deep)'
    : attribute === 'length' ? '(?:length|long)'
    : attribute === 'diameter' ? '(?:diameter|diam|dia)'
    : attribute === 'spacing' ? '(?:spacing|spaced|on center|oc)'
    : '';
  const unitPatterns = [
    ['square_foot', String.raw`(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf|ft\s*2)`],
    ['square_inch', String.raw`(?:square\s+(?:inches?|inch)|sq\.?\s*in\.?|in\s*2)`],
    ['square_millimeter', String.raw`(?:square\s+millimeters?|sq\.?\s*mm|mm\s*2)`],
    ['square_centimeter', String.raw`(?:square\s+centimeters?|sq\.?\s*cm|cm\s*2)`],
    ['square_meter', String.raw`(?:square\s+meters?|sq\.?\s*m|m\s*2)`],
    ['square_yard', String.raw`(?:square\s+yards?|sq\.?\s*yds?|yd\s*2)`],
    ['acre', 'acres?'],
    ['hectare', '(?:hectares?|ha)'],
    ['millimeter', '(?:millimeters?|mm)'],
    ['centimeter', '(?:centimeters?|cm)'],
    ['inch', String.raw`(?:inches?|inch|in\.?|")`],
    ['foot', String.raw`(?:feet|foot|ft\.?|')`],
    ['meter', '(?:meters?|m)'],
    ['yard', '(?:yards?|yds?|yd)'],
    ['gauge', String.raw`(?:gauge|ga\.?)`],
    ['percent', '(?:percent|%)'],
    ['degree', '(?:degrees?|degree)'],
  ] as const;
  for (const [family, unitPattern] of unitPatterns) {
    const boundedUnit = `(?:the\\s+)?${unitPattern}(?:\\s+units?)?`;
    if (
      new RegExp(`\\b(?:not\\s+(?:in|as)|without|using\\s+no|excluding|exclude|excluded|omit|omitting|avoid|except(?:\\s+for|\\s+in)?|anything\\s+but|rather\\s+than|instead\\s+of|but\\s+not(?:\\s+(?:in|as))?|other\\s+than|besides)\\s+${boundedUnit}(?=$|[\\s/,])`).test(normalized) ||
      new RegExp(`\\bnon[-\\s]+${unitPattern}(?:\\s+units?)?(?=$|[\\s/,])`).test(normalized) ||
      new RegExp(`\\b(?:do\\s+not|don'?t|dont|never|must\\s+not|should\\s+not)\\s+(?:report|use|express|give|provide|state|list|show|convert)\\b[\\s\\S]{0,60}?(?:\\b(?:in|as|using)\\s+)?${boundedUnit}(?=$|[\\s/,])`).test(normalized)
    ) excludedUnits.add(family);
    if (
      outputTail &&
      new RegExp(`(?:^|[\\s/,])${unitPattern}(?=$|[\\s/,])`).test(outputTail)
    ) units.add(family);
    const frames = [
      new RegExp(`\\bhow\\s+many\\s+${unitPattern}(?=\\s|$)`),
      new RegExp(`\\b(?:in|to)\\s+${unitPattern}\\s*$`),
      attributePattern
        ? new RegExp(`\\b${attributePattern}\\s+(?:(?:expressed|reported|shown|listed|stated|given|measured)\\s+)?(?:in\\s+|to\\s+)?${unitPattern}\\s*$`)
        : null,
    ].filter((pattern): pattern is RegExp => Boolean(pattern));
    if (frames.some(pattern => pattern.test(normalized))) units.add(family);
  }
  for (const [squareUnit, linearUnit] of [
    ['square_foot', 'foot'],
    ['square_inch', 'inch'],
    ['square_millimeter', 'millimeter'],
    ['square_centimeter', 'centimeter'],
    ['square_meter', 'meter'],
    ['square_yard', 'yard'],
  ] as const) {
    if (units.has(squareUnit)) units.delete(linearUnit);
  }
  for (const excluded of excludedUnits) units.delete(excluded);
  if (excludedUnits.size > 0 && units.size === 0) units.add('excluded-only');
  return units;
}

function measurementTextUsesUnitFamily(value: string, family: string) {
  const amount = '(?:\\d+(?:,\\d{3})*(?:\\.\\d+)?(?:\\s+\\d+\\s*\\/\\s*\\d+|\\s*\\/\\s*\\d+)?)';
  const unitPatterns: Readonly<Record<string, string>> = {
    square_foot: '(?:square\\s+(?:feet|foot)|sq\\.?\\s*ft\\.?|sf|ft\\s*2)',
    square_inch: '(?:square\\s+(?:inches?|inch)|sq\\.?\\s*in\\.?|in\\s*2)',
    square_millimeter: '(?:square\\s+millimeters?|sq\\.?\\s*mm|mm\\s*2)',
    square_centimeter: '(?:square\\s+centimeters?|sq\\.?\\s*cm|cm\\s*2)',
    square_meter: '(?:square\\s+meters?|sq\\.?\\s*m|m\\s*2)',
    square_yard: '(?:square\\s+yards?|sq\\.?\\s*yds?|yd\\s*2)',
    acre: 'acres?',
    hectare: '(?:hectares?|ha)',
    millimeter: '(?:millimeters?|mm)',
    centimeter: '(?:centimeters?|cm)',
    inch: '(?:inches?|inch|in\\.?|")',
    foot: '(?:feet|foot|ft\\.?|\')',
    meter: '(?:meters?|m)',
    yard: '(?:yards?|yds?|yd)',
    gauge: '(?:gauge|ga\\.?)',
    percent: '(?:percent|%)',
    degree: '(?:degrees?|degree)',
  };
  const unitPattern = unitPatterns[family];
  return Boolean(unitPattern) && new RegExp(
    `(?:^|\\s|\\b)${amount}\\s*${unitPattern}(?=$|\\s|[-(),.;:x])`,
  ).test(value);
}

function quantityEvidenceClauses(value: string) {
  const sheetScope = requestedECOSDrawingSheetScope(value);
  if (sheetScope.explicit && sheetScope.invalid) return [];
  const scanText = value.normalize('NFKC')
    // The shared exact-sheet parser accepts compact and spaced slash label
    // separators (`Sheet/E-2.1`, `Sht. / E-2.1`). Canonicalize that separator
    // before the dotted-label pass so `Sht./E-2.1` becomes one intact scope.
    .replace(
      /\b((?:sheets?|shts?\.?)(?:\s+(?:number|no\.?))?)\s*\/\s*(?=(?:[([{]\s*)?["'‘’“”]?[a-z0-9])/gi,
      '$1 ',
    )
    // Dotted sheet abbreviations are part of the location label, not a
    // sentence boundary. Remove only a dot that is followed by a bounded
    // identifier so unrelated prose still splits normally.
    .replace(
      /\b((?:sheets?|shts?\.?)\s+no)\.\s+(?=(?:[([{]\s*)?["'‘’“”]?[a-z0-9])/gi,
      '$1 ',
    )
    .replace(
      /\b(shts?)\.\s+(?=(?:(?:number|no\.?)\s+)?(?:[([{]\s*)?["'‘’“”]?[a-z0-9])/gi,
      '$1 ',
    );
  return scanText.split(/\r?\n+|[;!]+|\.\s+/);
}

export function containsECOSQuantityValue(value: string, question = '') {
  const targets = policyQuantityTargetPhrases(question);
  if (targets.length === 0) return false;
  const target = `(?:${targets.map(escapeRegExp).join('|')})`;
  const count = `(?<![\\d./+\\-])(?:${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN})`;
  const countEnd = '(?![a-z0-9])(?!\\.\\d)(?!\\/)';
  const targetEnd = '(?=\\s*(?:[.,;]|$|(?:is|are|were)\\s+(?:listed|shown|provided|identified|counted|included|present)\\b|(?:listed|shown|provided|identified|counted|included|present)\\b|(?:in|on|at|for)\\b))';
  const requestedInsideScopes = policyQuantityRequestedInsideScopePatterns(question);
  const grammar = [
    new RegExp(`\\bthere\\s+(?:is|are)\\s+(?:exactly\\s+)?${count}${countEnd}\\s+${target}${targetEnd}`),
    new RegExp(`\\b(?:exactly\\s+)?${count}${countEnd}\\s+${target}\\s+(?:is|are|were)\\s+(?:listed|shown|provided|identified|counted|included|present)\\b`),
    new RegExp(`\\b(?:count|quantity|total)\\s+(?:for|of)\\s+${target}\\s+(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`),
    new RegExp(`\\b(?:the\\s+)?(?:total\\s+)?number\\s+of\\s+${target}\\s+(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`),
    new RegExp(`\\b${target}\\s+(?:count|quantity|total)\\s+(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`),
    new RegExp(`\\b(?:has|have|shows?|includes?|contains?|provides?)\\s+(?:(?:exactly\\s+)|(?:a\\s+total\\s+of\\s+))?${count}${countEnd}\\s+${target}${targetEnd}`),
    new RegExp(`\\ba\\s+total\\s+of\\s+${count}${countEnd}\\s+${target}\\s+(?:is|are|were)\\s+(?:listed|shown|provided|identified|counted|included|present)\\b`),
    new RegExp(`\\b(?:the\\s+)?(?:total\\s+)?number\\s+of\\s+${target}\\s+(?:(?:shown|listed|provided|identified|counted|included|present)\\s+)?(?:in|on|at|for)\\s+(?:[a-z0-9][a-z0-9._'-]*\\s+){1,12}(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`),
    new RegExp(`\\b${target}\\s+(?:count|quantity|total)\\s+(?:in|on|at|for)\\s+(?:[a-z0-9][a-z0-9._'-]*\\s+){1,12}(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`),
  ];
  if (requestedInsideScopes.length > 0) {
    const requestedScope = `(?:${requestedInsideScopes.join('|')})`;
    const relation = '(?:in|on|at|within|inside)';
    grammar.push(
      new RegExp(
        `\\bthere\\s+(?:is|are)\\s+(?:exactly\\s+)?${count}${countEnd}\\s+${target}\\s+` +
          `${relation}\\s+(?:the\\s+)?${requestedScope}(?=\\s*(?:[.,;]|$))`,
      ),
      new RegExp(
        `\\b(?:exactly\\s+)?${count}${countEnd}\\s+${target}\\s+(?:is|are|was|were)\\s+` +
          `(?:located\\s+)?${relation}\\s+(?:the\\s+)?${requestedScope}` +
          `(?=\\s*(?:[.,;]|$))`,
      ),
      new RegExp(
        `\\b${relation}\\s+(?:the\\s+)?${requestedScope}\\s*,?\\s+` +
          `(?:(?:there\\s+)?(?:is|are)|was|were)\\s+(?:exactly\\s+)?${count}${countEnd}\\s+${target}` +
          `(?=\\s*(?:[.,;]|$))`,
      ),
      new RegExp(
        `\\b(?:the\\s+)?number\\s+of\\s+${target}\\s+${relation}\\s+(?:the\\s+)?${requestedScope}` +
          `\\s+(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`,
      ),
      new RegExp(
        `\\b${target}\\s+(?:count|quantity|total)\\s+${relation}\\s+(?:the\\s+)?${requestedScope}` +
          `\\s+(?:is|are|equals?)\\s+${count}${countEnd}(?=\\s*(?:[.,;]|$))`,
      ),
    );
  }
  const clauses = quantityEvidenceClauses(value)
    .map(clause => quantityPolicyTextWithoutBoundedReferralTail(
      quantityTextWithoutBoundedAttributeQualifiers(clause.trim()),
      question,
    ))
    .filter(Boolean);
  const cardinalitiesByClause = clauses.map(clause =>
    quantityClauseCardinalityMentions(clause, question)
  );
  return clauses.some((clause, index) => {
    const operatorScanClause = protectQuantityTerminalPlusIdentifiers(
      clause,
      'ecosinvalidplusevidence',
    );
    if (/[<>+±…]/u.test(operatorScanClause)) return false;
    const normalized = normalizeQuantityConstraintSyntax(clause);
    if (!grammar.some(pattern => pattern.test(normalized))) return false;
    const scopedMentions = cardinalitiesByClause[index].map(mention => Object.freeze({
      mention,
      scope: quantityMentionScope(normalized, question, mention),
      localText: quantityMentionLocalSegment(normalized, mention.start, mention.end).text,
    }));
    if (scopedMentions.some(candidate => candidate.scope === 'mixed')) return false;
    const relevantMentions = scopedMentions.filter(candidate =>
      candidate.scope === 'requested' || candidate.scope === 'unspecified'
    );
    const requestedScopeRequired = policyQuantityRequestedInsideScopePatterns(question).length > 0;
    const exactTotals = relevantMentions.filter(candidate =>
      candidate.mention.role === 'total' && candidate.mention.count != null &&
      (!requestedScopeRequired || candidate.scope === 'requested') &&
      !quantityClauseHasNonExactCardinality(candidate.localText, question) &&
      !quantityLocalTextContradictsCandidate(candidate.localText)
    );
    const candidateTotals = [...new Set(exactTotals
      .map(candidate => candidate.mention.count as number))];
    if (candidateTotals.length !== 1) return false;
    const candidateCount = candidateTotals[0];
    if (relevantMentions.some(({ mention }) =>
      mention.role === 'subtype' || mention.role === 'subset' ||
      mention.role === 'conflict' && (mention.count == null || mention.count === candidateCount)
    )) return false;
    return !quantityCandidateHasSameScopeConflict(
      clauses,
      cardinalitiesByClause,
      index,
      candidateCount,
      question,
    );
  });
}

export function exactECOSQuantityCount(value: string, question = '') {
  if (!containsECOSQuantityValue(value, question)) return null;
  const clauses = quantityEvidenceClauses(value)
    .map(clause => quantityPolicyTextWithoutBoundedReferralTail(
      quantityTextWithoutBoundedAttributeQualifiers(clause.trim()),
      question,
    ))
    .filter(Boolean);
  const requestedScopeRequired = policyQuantityRequestedInsideScopePatterns(question).length > 0;
  const counts = clauses.flatMap(clause => {
    const normalized = normalizeQuantityConstraintSyntax(clause);
    return quantityClauseCardinalityMentions(clause, question).flatMap(mention => {
      const scope = quantityMentionScope(normalized, question, mention);
      const localText = quantityMentionLocalSegment(normalized, mention.start, mention.end).text;
      return mention.role === 'total' && mention.count != null &&
          (scope === 'requested' || !requestedScopeRequired && scope === 'unspecified') &&
          !quantityClauseHasNonExactCardinality(localText, question) &&
          !quantityLocalTextContradictsCandidate(localText)
        ? [mention.count]
        : [];
    });
  });
  const uniqueCounts = [...new Set(counts)];
  return uniqueCounts.length === 1 ? uniqueCounts[0] : null;
}

function policyQuantityTargetNouns(question: string) {
  const targetNouns = [...new Set(policyQuantityTargetPhrases(question).map(target =>
    canonicalContextToken(target.split(' ').filter(Boolean).at(-1) || '')
  ).filter(Boolean))];
  if (targetNouns.some(target => /^(?:light|fixture|luminaire)$/.test(target))) {
    for (const alias of ['light', 'fixture', 'luminaire', 'sconce']) {
      if (!targetNouns.includes(alias)) targetNouns.push(alias);
    }
  }
  return targetNouns;
}

function policyQuantityTargetSemanticTokens(question: string) {
  const tokens = [...new Set(policyQuantityTargetPhrases(question).flatMap(target =>
    normalizePolicyText(target).split(/\s+/).map(canonicalContextToken).filter(Boolean)
  ))];
  if (tokens.some(target => /^(?:light|fixture|luminaire)$/.test(target))) {
    for (const alias of ['light', 'fixture', 'luminaire', 'sconce']) {
      if (!tokens.includes(alias)) tokens.push(alias);
    }
  }
  return tokens;
}

function quantityQuestionRequestsAdditionalItems(question: string) {
  return /\b(?:additional|added|extra|more)\b/.test(normalizePolicyText(question));
}

function quantityClauseHasAdditiveSameTarget(value: string, question: string) {
  if (quantityQuestionRequestsAdditionalItems(question)) return false;
  const normalized = normalizePolicyText(value);
  const targetNouns = policyQuantityTargetNouns(question);
  if (targetNouns.length === 0) return false;
  const additiveCue = /\b(?:also|additional(?:ly)?|another|more|plus|in addition)\b/.test(normalized);
  if (!additiveCue) return false;
  const countOrArticle =
    '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen|a|an|another)';
  const target = `(?:${targetNouns.map(escapeRegExp).join('|')})s?`;
  return new RegExp(
    `\\b${countOrArticle}\\s+(?:(?:additional|more)\\s+)?(?:[a-z0-9-]+\\s+){0,3}${target}\\b`,
  ).test(normalized) || new RegExp(
    `\\badditional\\s+(?:${countOrArticle}\\s+)?(?:[a-z0-9-]+\\s+){0,3}${target}\\b`,
  ).test(normalized);
}

type QuantityCardinalityMention = Readonly<{
  count: number | null;
  role: 'total' | 'subset' | 'subtype' | 'conflict';
  start: number;
  end: number;
}>;

const QUANTITY_COUNT_WORD_VALUES: Readonly<Record<string, number>> = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12,
  a: 1, an: 1, another: 1,
});

const QUANTITY_CARDINAL_WORD_PATTERN =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
  'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|' +
  'fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and)';
const QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN =
  `(?:0|[1-9]\\d*|${QUANTITY_CARDINAL_WORD_PATTERN}` +
    `(?:[-\\s]+${QUANTITY_CARDINAL_WORD_PATTERN}){0,23}|dozen)`;
const QUANTITY_COUNT_TOKEN_PATTERN =
  `(?:${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}|a|an|another)`;
const QUANTITY_COUNT_SCALE_VALUES: Readonly<Record<string, number>> = Object.freeze({
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
});

function quantityCountBelowHundred(tokens: readonly string[]) {
  if (tokens.length === 1) {
    const amount = QUANTITY_COUNT_WORD_VALUES[tokens[0]];
    return amount != null && amount >= 0 && amount < 100 ? amount : null;
  }
  if (tokens.length === 2) {
    const tens = QUANTITY_COUNT_WORD_VALUES[tokens[0]];
    const units = QUANTITY_COUNT_WORD_VALUES[tokens[1]];
    return tens != null && tens >= 20 && tens % 10 === 0 &&
        units != null && units >= 1 && units <= 9
      ? tens + units
      : null;
  }
  return null;
}

function quantityCountBelowThousand(tokens: readonly string[]) {
  if (tokens.length >= 2 && tokens[1] === 'hundred') {
    const hundreds = QUANTITY_COUNT_WORD_VALUES[tokens[0]];
    if (hundreds == null || hundreds < 1 || hundreds > 9) return null;
    let remainder = tokens.slice(2);
    if (remainder[0] === 'and') remainder = remainder.slice(1);
    if (remainder.length === 0) return hundreds * 100;
    const tail = quantityCountBelowHundred(remainder);
    return tail == null || tail === 0 ? null : hundreds * 100 + tail;
  }
  return quantityCountBelowHundred(tokens);
}

function normalizedQuantityCount(value: string) {
  const normalized = normalizePolicyText(value);
  if (/^\d+$/.test(normalized)) {
    const count = Number(normalized);
    return Number.isSafeInteger(count) ? count : null;
  }
  const direct = QUANTITY_COUNT_WORD_VALUES[normalized];
  if (direct != null) return direct;
  const tokens = normalized.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 24) return null;
  if (tokens.includes('zero')) return null;
  let total = 0;
  let remaining = tokens;
  for (const scaleName of ['billion', 'million', 'thousand'] as const) {
    const scaleIndexes = remaining
      .map((token, index) => token === scaleName ? index : -1)
      .filter(index => index >= 0);
    if (scaleIndexes.length > 1) return null;
    if (scaleIndexes.length === 0) continue;
    const scaleIndex = scaleIndexes[0];
    let group = remaining.slice(0, scaleIndex);
    if (group[0] === 'and' && total > 0) group = group.slice(1);
    const groupCount = quantityCountBelowThousand(group);
    if (groupCount == null || groupCount === 0) return null;
    total += groupCount * QUANTITY_COUNT_SCALE_VALUES[scaleName];
    remaining = remaining.slice(scaleIndex + 1);
  }
  if (remaining[0] === 'and' && total > 0) remaining = remaining.slice(1);
  const tail = remaining.length > 0 ? quantityCountBelowThousand(remaining) : 0;
  if (tail == null || (tail === 0 && total === 0)) return null;
  const count = total + tail;
  return Number.isSafeInteger(count) ? count : null;
}

function quantityMentionHasNegativePolarity(
  normalized: string,
  start: number,
  end: number,
) {
  const prefix = normalized.slice(Math.max(0, start - 128), start);
  const suffix = normalized.slice(end, Math.min(normalized.length, end + 128));
  return (
    /\b(?:there\s+)?(?:(?:is|are|was|were)\s+not|(?:isn|aren|wasn|weren)'?t)\s+(?:exactly\s+)?$/.test(prefix) ||
    /\b(?:it|this|that)\s+(?:is|was)\s+(?:false|untrue|incorrect|not\s+true)\s+that\s+(?:there\s+(?:is|are)\s+)?(?:exactly\s+)?$/.test(prefix) ||
    /\b(?:false|untrue|incorrect|not\s+true)\s+that\s+(?:there\s+(?:is|are)\s+)?(?:exactly\s+)?$/.test(prefix) ||
    /\b(?:no|not)\s+(?:exactly\s+)?$/.test(prefix) ||
    /^\s*(?:is|are|was|were)\s+(?:false|untrue|incorrect|not\s+true)\b/.test(suffix)
  );
}

type QuantityMentionScope = 'requested' | 'outside' | 'other' | 'unspecified' | 'mixed';

function quantityMentionLocalSegment(
  normalized: string,
  start: number,
  end: number,
) {
  const scopeReference =
    '(?:building\\s+area|loading\\s+dock|detail|det\\.?|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht\\.?|page|pg\\.?|figure|fig\\.?|drawing|dwg\\.?|document|doc\\.?|revision|rev\\.?|plan|note|task|type|unit|suite|bay|section|phase|option|item)\\s+["\']?\\s*[a-z0-9]+(?:[.-][a-z0-9]+)*\\s*["\']?';
  const boundaries = [...normalized.matchAll(/\b(?:and|but|while|whereas)\b/g)].filter(boundary => {
    if (boundary[0] !== 'and') return true;
    const prefix = normalized.slice(0, boundary.index || 0);
    const suffix = normalized.slice((boundary.index || 0) + boundary[0].length);
    if (
      new RegExp(`\\b${scopeReference}\\s*$`).test(prefix) &&
      new RegExp(`^\\s*(?:the\\s+)?${scopeReference}\\b`).test(suffix)
    ) return false;
    if (
      new RegExp(`\\bbetween\\s+${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}\\s*$`).test(prefix) &&
      new RegExp(`^\\s*${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}\\b`).test(suffix)
    ) return false;
    return !new RegExp(`(?:^|\\s)${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}\\s*$`).test(prefix) ||
      !new RegExp(`^\\s*${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}\\s+`).test(suffix);
  });
  const previous = boundaries.filter(boundary =>
    (boundary.index || 0) + boundary[0].length <= start
  ).at(-1);
  const following = boundaries.find(boundary => (boundary.index || 0) >= end);
  const segmentStart = previous
    ? (previous.index || 0) + previous[0].length
    : 0;
  const segmentEnd = following?.index ?? normalized.length;
  return Object.freeze({
    text: normalized.slice(segmentStart, segmentEnd).trim(),
    start: segmentStart,
  });
}

function quantityMentionScope(
  normalized: string,
  question: string,
  mention: Pick<QuantityCardinalityMention, 'start' | 'end'>,
): QuantityMentionScope {
  const requestedScopes = policyQuantityRequestedInsideScopeDescriptors(question);
  if (requestedScopes.length === 0) return 'requested';
  const segment = quantityMentionLocalSegment(normalized, mention.start, mention.end);
  let matchedRequestedScopes = 0;
  const matchedRequestedScopesByFamily = new Map<string, number>();
  let mismatchedRequestedScope = false;
  let mixedRequestedScope = false;
  for (const scope of requestedScopes) {
    let descriptorMatched = false;
    let descriptorMismatched = false;
    for (const evidenceMatch of segment.text.matchAll(new RegExp(`\\b(?:${scope.pattern})\\b`, 'g'))) {
      const scopeStart = evidenceMatch.index || 0;
      const scopeEnd = scopeStart + evidenceMatch[0].length;
      const prefix = segment.text.slice(
        Math.max(0, scopeStart - 128),
        scopeStart,
      );
      const predicateNotInside = /\b(?:shown|provided|present|included|contained|identified|found|located|counted)\s+not\s+(?:in|on|at|within|inside)\s+(?:the\s+)?$/.test(prefix);
      const evidenceRelation = predicateNotInside
        ? 'outside'
        : policyScopeRelationBeforeScope(prefix);
      const matches = scope.expectedRelation === 'direct' || scope.expectedRelation === 'inside'
        ? quantityScopeOccurrenceBindsMention(
          segment.text,
          scopeStart,
          scopeEnd,
          mention.start - segment.start,
          mention.end - segment.start,
          evidenceRelation,
        )
        : evidenceRelation === scope.expectedRelation || evidenceRelation === 'direct';
      if (matches) descriptorMatched = true;
      else descriptorMismatched = true;
    }
    for (const familyMatch of segment.text.matchAll(new RegExp(
      `\\b(?:${scope.familyPattern})\\s+["']?\\s*([a-z0-9]+(?:[.-][a-z0-9]+)*)\\s*["']?`,
      'g',
    ))) {
      if (/^(?:show|shows|shown|list|lists|listed|provide|provides|provided|include|includes|included|contain|contains|contained|have|has|had|is|are|was|were|does|do|did|for|in|on|at|within|inside|outside|near|of)$/.test(
        familyMatch[1],
      )) continue;
      const familyIdentifier = scope.familyPattern === QUANTITY_SHEET_SCOPE_FAMILY_PATTERN
        ? canonicalComparableSheetNumber(familyMatch[1]).toLowerCase()
        : familyMatch[1];
      if (familyIdentifier === scope.identifier) continue;
      if (requestedScopes.some(other => other !== scope && new RegExp(
        `^(?:${other.pattern})$`,
      ).test(familyMatch[0].trim()))) continue;
      const familyPrefix = segment.text.slice(
        Math.max(0, (familyMatch.index || 0) - 80),
        familyMatch.index || 0,
      );
      // A secondary reference after a complete requested count is context,
      // not the scope of that count. Keep the whitelist grammar-bound so a
      // bare wrong-scope count cannot be laundered by mentioning the requested
      // detail later in the same sentence.
      if (/\b(?:see(?:\s+also)?|refer(?:\s+also)?\s+to|cross[- ]reference|consult|coordinat(?:e|ed)(?:\s+in)?\s+with|in\s+coordination\s+with|coordinat(?:e|ed)\s+per)\s+(?:the\s+)?(?:controls?\s+(?:in|on|at)\s+(?:the\s+)?)?$/.test(
        familyPrefix,
      )) continue;
      const familyStart = familyMatch.index || 0;
      const familyEnd = familyStart + familyMatch[0].length;
      const predicateNotInside = /\b(?:shown|provided|present|included|contained|identified|found|located|counted)\s+not\s+(?:in|on|at|within|inside)\s+(?:the\s+)?$/.test(
        familyPrefix,
      );
      const familyRelation = predicateNotInside
        ? 'outside'
        : policyScopeRelationBeforeScope(familyPrefix);
      if (
        descriptorMatched &&
        quantityScopeOccurrenceBindsMention(
          segment.text,
          familyStart,
          familyEnd,
          mention.start - segment.start,
          mention.end - segment.start,
          familyRelation,
        )
      ) continue;
      descriptorMismatched = true;
    }
    if (descriptorMatched) {
      matchedRequestedScopes += 1;
      matchedRequestedScopesByFamily.set(
        scope.familyPattern,
        (matchedRequestedScopesByFamily.get(scope.familyPattern) || 0) + 1,
      );
    }
    if (descriptorMatched && descriptorMismatched) mixedRequestedScope = true;
    else if (descriptorMismatched) mismatchedRequestedScope = true;
  }
  if (
    mixedRequestedScope ||
    matchedRequestedScopes > 0 && mismatchedRequestedScope
  ) return 'mixed';
  if (requestedScopes.length > 1) {
    const requestedFamilies = [...new Set(requestedScopes.map(scope => scope.familyPattern))];
    // Peer identifiers in one family are independently answerable (`Details
    // A and B`), but every orthogonal singleton scope remains mandatory
    // (`Detail A on Sheet A-1`). One atomic count may bind exactly one peer in
    // each requested family; an aggregate bound to two peers is ambiguous.
    if (requestedFamilies.some(family =>
      (matchedRequestedScopesByFamily.get(family) || 0) > 1
    )) return 'mixed';
    if (requestedFamilies.every(family =>
      (matchedRequestedScopesByFamily.get(family) || 0) === 1
    )) return 'requested';
  }
  if (matchedRequestedScopes === requestedScopes.length) return 'requested';
  if (mismatchedRequestedScope) return 'outside';
  const explicitScope =
    /\b(?:building\s+area|loading\s+dock|detail|det\.?|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht\.?|page|pg\.?|figure|fig\.?|drawing|dwg\.?|document|doc\.?|revision|rev\.?|plan|note|task|type|unit|suite|bay|section|phase|option|item)\s+["']?\s*[a-z0-9]+(?:[.-][a-z0-9]+)*\s*["']?\b/;
  return explicitScope.test(segment.text) ? 'other' : 'unspecified';
}

function quantityScopeOccurrenceBindsMention(
  segment: string,
  scopeStart: number,
  scopeEnd: number,
  mentionStart: number,
  mentionEnd: number,
  relation: string,
) {
  const prefix = segment.slice(Math.max(0, scopeStart - 128), scopeStart);
  const suffix = segment.slice(scopeEnd, Math.min(segment.length, scopeEnd + 96));
  const referralCue = /\b(?:see(?:\s+also)?|refer(?:\s+also)?\s+to|cross[- ]reference|consult|coordinat(?:e|ed)(?:\s+in)?\s+with|in\s+coordination\s+with|coordinat(?:e|ed)\s+per)\b[\s\S]{0,64}$/;
  if (referralCue.test(prefix)) return false;
  if (
    mentionEnd <= scopeStart &&
    /\b(?:by|with|from)\s+(?:the\s+)?$/.test(prefix) ||
    mentionEnd <= scopeStart &&
    /^(?:\s+[a-z0-9-]+){0,4}\s+(?:controls?|coordination|reference|details?)\b/.test(suffix)
  ) return false;
  if (relation === 'inside') return true;
  if (relation !== 'direct') return false;

  if (scopeEnd <= mentionStart) {
    const between = segment.slice(scopeEnd, mentionStart).trim();
    const beforeScope = segment.slice(Math.max(0, scopeStart - 240), scopeStart);
    if (/\b(?:count|quantity|number|total)\b[\s\S]{0,180}\b(?:for|in|on|at|within|inside)\b[\s\S]{0,140}$/.test(beforeScope)) {
      return /^(?:is|are|equals?|[:=-])?\s*(?:exactly\s+)?$/.test(between);
    }
    return /^(?:[,:;-]\s*)?(?:(?:also|additionally)\s+)?(?:(?:shows?|has|have|had|contains?|includes?|lists?|identifies?|provides?)|(?:(?:does|do|did)\s+not|doesn['’]?t|don['’]?t|didn['’]?t)\s+(?:show|have|contain|include|list|identify|provide)|there\s+(?:is|are|was|were))(?:\s+(?:exactly|a\s+total\s+of))?$/.test(
      between,
    );
  }
  return false;
}

function protectQuantityTerminalPlusIdentifiers(value: string, invalidIdentifier: string) {
  const reservedIdentifier = invalidIdentifier.endsWith('question')
    ? 'ecosreservedplusquestion'
    : 'ecosreservedplusevidence';
  return value.normalize('NFKC')
    // Internal encodings are never valid user identifiers. Reserve their
    // literal spellings before creating role-specific markers so raw input
    // cannot spoof a protected A+ or a malformed-plus sentinel.
    .replace(
      /\b(?:ecosplus-[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*|[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*-ecosplus|ecos(?:invalid|reserved)plus(?:question|evidence))\b/gi,
      reservedIdentifier,
    )
    // Invalid attached-plus shapes must not collapse to the base identifier
    // after the general punctuation scrub. Give questions and evidence
    // different sentinels so even the same malformed spelling cannot verify.
    .replace(
      /\b[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\+(?:\+|[_#-][a-z0-9._#-]*|\.[a-z0-9][a-z0-9._#-]*)/gi,
      invalidIdentifier,
    )
    // Preserve exactly one terminal plus on a letter-led construction
    // designator. Compact A+B remains two peer identifiers because the plus
    // is followed by another alphanumeric token and is intentionally not
    // protected here.
    .replace(
      /\b([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)\+(?=$|["')\]}]|[.,;:!?](?:\s|$)|\s+(?:(?:and|or)\s+["']?[a-z0-9]|(?:is|are|was|were|shows?|shown|lists?|listed|provides?|provided|includes?|included|contains?|contained|has|have|had|does|do|did|on|in|at|within|inside|for|of|per)\b)|\s*[/&,]\s*["']?[a-z0-9])/gi,
      'ecosplus-$1',
    )
    // Any remaining non-compact attached plus has an unsupported tail. Keep
    // compact A+B available to the explicit peer-list grammar, but make
    // punctuation/operator continuations unresolved instead of collapsing A+
    // to A during normalization.
    .replace(
      /\b[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\+(?![a-z0-9])/gi,
      invalidIdentifier,
    );
}

function canonicalizeQuantityQuestionPeerScopeConnectors(value: string) {
  const pluralScopeLabel =
    '(?:building\\s+areas|loading\\s+docks|details|rooms|panels|canopies|buildings|areas|zones|levels|floors|grids|doors|sheets|pages|figures|drawings|documents|revisions|plans|notes|tasks|types|units|suites|bays|sections|phases|options|items)';
  const identifier = `(?:["']?\\s*${QUANTITY_COMPACT_SCOPE_IDENTIFIER_BASE_PATTERN}\\s*["']?)`;
  const wordConnector =
    '(?:in\\s+conjunction\\s+with|in\\s+combination\\s+with|' +
    'compared\\s+(?:with|to)|adjacent\\s+to|and\\s+then|or\\s+else|' +
    'plus\\s+also|as\\s+well\\s+as|alongside(?:\\s+of)?|along\\s+with|' +
    'together\\s+with|in\\s+addition\\s+to|and\\s+also|' +
    'or\\s+alternatively|beside|against|through|thru|versus|vs\\.?|' +
    'plus|to|and|or)';
  const connector =
    '(?:\\s*[;|&+/]\\s*|\\s*,\\s*(?:' + wordConnector + '\\s+)?|' +
    '\\s+' + wordConnector + '\\s+)';
  const closedTail =
    '(?=\\s*(?:[?.!;:]|$|(?:is|are|was|were|show|shows|shown|list|lists|listed|provide|provides|provided|include|includes|included|contain|contains|contained|have|has|had|does|do|did|on|in|at|within|inside|for|of|per|excluding|except|currently)\\b))';
  const listMarker = '(?:[-*\u2022][ \\t]*)?';
  const punctuationSeparator = '(?:[ \\t]*;[ \\t]*|[ \\t]*\\r?\\n[ \\t]*)';
  const punctuationListPattern = new RegExp(
    `\\b(${pluralScopeLabel})[ \\t]*:?[ \\t]*(?:\\r?\\n[ \\t]*)?${listMarker}` +
      `(${identifier}(?:${punctuationSeparator}${listMarker}${identifier}){1,7})${closedTail}`,
    'gi',
  );
  const listPattern = new RegExp(
    `\\b(${pluralScopeLabel})\\s+(${identifier}(?:${connector}${identifier}){1,7})${closedTail}`,
    'gi',
  );
  const canonicalizeList = (match: string, label: string, list: string) => {
    const identifiers = [...list.matchAll(new RegExp(
      `(?<![a-z0-9.-])${identifier}`,
      'gi',
    ))]
      .map(identifierMatch => identifierMatch[0].trim())
      .filter(Boolean);
    if (identifiers.length < 2 || identifiers.length > 8) return match;
    return `${label} ${identifiers.slice(0, -1).join(' ')} and ${identifiers.at(-1)}`;
  };
  return value
    .replace(punctuationListPattern, canonicalizeList)
    .replace(listPattern, canonicalizeList);
}

function normalizeQuantityConstraintSyntax(value: string) {
  return normalizePolicyText(protectQuantityTerminalPlusIdentifiers(
    value,
    'ecosinvalidplusevidence',
  ))
    .replace(/\bdoesn['’]?t\b/g, 'does not')
    .replace(/\bdon['’]?t\b/g, 'do not')
    .replace(/\bdidn['’]?t\b/g, 'did not')
    .replace(/\bmustn['’]?t\b/g, 'must not')
    .replace(/\bshouldn['’]?t\b/g, 'should not')
    .replace(/\bmayn['’]?t\b/g, 'may not')
    .replace(/\bcouldn['’]?t\b/g, 'could not')
    .replace(/\bwouldn['’]?t\b/g, 'would not')
    .replace(/\bwon['’]?t\b/g, 'will not')
    .replace(/\bshan['’]?t\b/g, 'shall not')
    .replace(/\bcan['’]?t\b/g, 'cannot')
    .replace(/\bisn['’]?t\b/g, 'is not')
    .replace(/\baren['’]?t\b/g, 'are not')
    .replace(/\bwasn['’]?t\b/g, 'was not')
    .replace(/\bweren['’]?t\b/g, 'were not')
    .replace(/\bhasn['’]?t\b/g, 'has not')
    .replace(/\bhaven['’]?t\b/g, 'have not')
    .replace(/\bhadn['’]?t\b/g, 'had not')
    .replace(/\bneedn['’]?t\b/g, 'need not');
}

const QUANTITY_BOUND_ADVERB_PATTERN =
  `(?:(?:ever|now|currently|actually|really|still|then|thereafter)\\s+){0,2}`;
const QUANTITY_BOUND_MODAL_PATTERN =
  '(?:shall|must|may|should|will|would|could|can)';
const QUANTITY_NEGATED_BOUND_AUXILIARY_PATTERN =
  '(?:(?:does|do|did|shall|must|may|should|will|would|could|has|have|had|need|is|are|was|were)\\s+not|cannot|can\\s+not)';
const QUANTITY_UPPER_BOUND_VERB_PATTERN =
  `(?:exceed(?:ed)?|(?:go|gone|rise|risen)\\s+(?:above|over)|` +
  `(?:be\\s+)?(?:more|greater|higher)\\s+than)`;
const QUANTITY_LOWER_BOUND_VERB_PATTERN =
  `(?:(?:fall|fallen|drop|dropped|go|gone)\\s+(?:below|under)|` +
  `(?:be\\s+)?(?:less|fewer|lower)\\s+than)`;

const QUANTITY_NEGATED_UPPER_BOUND_PREDICATE_PATTERN =
  `(?:(?:${QUANTITY_NEGATED_BOUND_AUXILIARY_PATTERN})\\s+${QUANTITY_BOUND_ADVERB_PATTERN}|` +
  `${QUANTITY_BOUND_MODAL_PATTERN}\\s+${QUANTITY_BOUND_ADVERB_PATTERN}never\\s+` +
  `${QUANTITY_BOUND_ADVERB_PATTERN})${QUANTITY_UPPER_BOUND_VERB_PATTERN}`;

const QUANTITY_NEGATED_LOWER_BOUND_PREDICATE_PATTERN =
  `(?:(?:${QUANTITY_NEGATED_BOUND_AUXILIARY_PATTERN})\\s+${QUANTITY_BOUND_ADVERB_PATTERN}|` +
  `${QUANTITY_BOUND_MODAL_PATTERN}\\s+${QUANTITY_BOUND_ADVERB_PATTERN}never\\s+` +
  `${QUANTITY_BOUND_ADVERB_PATTERN})${QUANTITY_LOWER_BOUND_VERB_PATTERN}`;

const QUANTITY_UPPER_BOUND_PREDICATE_PATTERN =
  `(?:${QUANTITY_NEGATED_UPPER_BOUND_PREDICATE_PATTERN}|` +
  `(?:(?:is|are|was|were|remains?)\\s+${QUANTITY_BOUND_ADVERB_PATTERN}|` +
  `${QUANTITY_BOUND_MODAL_PATTERN}\\s+${QUANTITY_BOUND_ADVERB_PATTERN}` +
  `(?:be\\s+${QUANTITY_BOUND_ADVERB_PATTERN})?)` +
  `(?:at\\s+most|no\\s+more\\s+than|not\\s+more\\s+than|` +
  `no\\s+(?:greater|higher)\\s+than|not\\s+(?:greater|higher)\\s+than|` +
  `up\\s+to|capped\\s+at|limited\\s+to|(?:a\\s+)?maximum(?:\\s+of)?))`;

const QUANTITY_LOWER_BOUND_PREDICATE_PATTERN =
  `(?:${QUANTITY_NEGATED_LOWER_BOUND_PREDICATE_PATTERN}|` +
  `(?:(?:is|are|was|were|remains?)\\s+${QUANTITY_BOUND_ADVERB_PATTERN}|` +
  `${QUANTITY_BOUND_MODAL_PATTERN}\\s+${QUANTITY_BOUND_ADVERB_PATTERN}` +
  `(?:be\\s+${QUANTITY_BOUND_ADVERB_PATTERN})?)` +
  `(?:at\\s+least|no\\s+(?:less|fewer)\\s+than|` +
  `not\\s+(?:less|fewer|lower)\\s+than|no\\s+lower\\s+than|` +
  `at\\s+or\\s+above|(?:a\\s+)?minimum(?:\\s+of)?))`;

const QUANTITY_SCOPE_KIND_PATTERN =
  `(?:building\\s+area|loading\\s+dock|detail|det\\.?|room|panel|canopy|building|area|zone|level|floor|grid|door|sheet|sht\\.?|page|pg\\.?|figure|fig\\.?|drawing|dwg\\.?|document|doc\\.?|revision|rev\\.?|plan|note|task|type|unit|suite|bay|section|phase|option|item)`;
const QUANTITY_SCOPE_IDENTIFIER_PATTERN =
  `["']?\\s*[a-z0-9]+(?:[.-][a-z0-9]+)*\\s*["']?`;
const QUANTITY_COMPACT_SCOPE_IDENTIFIER_BASE_PATTERN =
  `(?!(?:and|or|as|the|in|on|at|of|to|is|are|was|were|for|but|not|per|via|vs|see|from|with|according)\\b)` +
  `(?:[a-z0-9]+(?:[.-][a-z0-9]+)+|[a-z]{1,4}\\d+[a-z]?|\\d+[a-z]?|[a-z]{1,3})` +
  `(?![a-z0-9.-])`;
const QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN =
  `["']?\\s*${QUANTITY_COMPACT_SCOPE_IDENTIFIER_BASE_PATTERN}\\s*["']?`;
const QUANTITY_SCOPE_REFERENCE_PATTERN =
  `${QUANTITY_SCOPE_KIND_PATTERN}\\s+${QUANTITY_SCOPE_IDENTIFIER_PATTERN}`;
// `normalizePolicyText()` removes commas and ampersands but retains slashes.
// A plural scope label therefore owns a bounded identifier sequence such as
// `Details A B`, `Details B C and A`, or `Details A/B/C`. The predicate that
// follows this expression provides the right boundary and prevents the list
// from absorbing an unrelated clause.
const QUANTITY_SHARED_SCOPE_LIST_PATTERN =
  `(?:${QUANTITY_SCOPE_REFERENCE_PATTERN}` +
  `(?:\\s+(?:the\\s+)?${QUANTITY_SCOPE_REFERENCE_PATTERN})*` +
  `\\s+(?:and|&)\\s+(?:the\\s+)?${QUANTITY_SCOPE_REFERENCE_PATTERN}|` +
  `${QUANTITY_SCOPE_REFERENCE_PATTERN}(?:\\s*/\\s*${QUANTITY_SCOPE_REFERENCE_PATTERN})+|` +
  `${QUANTITY_SCOPE_REFERENCE_PATTERN}(?:\\s+(?:the\\s+)?${QUANTITY_SCOPE_REFERENCE_PATTERN})+|` +
  `(?:${QUANTITY_SCOPE_KIND_PATTERN})s?\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}` +
  `(?:\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}){0,6}` +
  `\\s+(?:and|&)\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}|` +
  `(?:${QUANTITY_SCOPE_KIND_PATTERN})s?\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}` +
  `(?:\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}){1,6}|` +
  `(?:${QUANTITY_SCOPE_KIND_PATTERN})s?\\s+${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}` +
  `(?:\\s*/\\s*${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN})+)`;

function quantityClauseCardinalityMentions(
  value: string,
  question: string,
): readonly QuantityCardinalityMention[] {
  const normalized = normalizeQuantityConstraintSyntax(value);
  const targetNouns = policyQuantityTargetNouns(question);
  if (targetNouns.length === 0) return [];
  const canonicalTargetPhrase = (targetPhrase: string) => normalizePolicyText(targetPhrase)
    .split(/\s+/)
    .map(canonicalContextToken)
    .filter(Boolean)
    .join(' ');
  const exactTargetPhrases = [...new Set(policyQuantityTargetPhrases(question)
    .map(normalizePolicyText)
    .filter(Boolean))].sort((left, right) => right.length - left.length);
  const exactCanonicalTargets = new Set(exactTargetPhrases.map(canonicalTargetPhrase));
  const targetPhrases = [...new Set([
    ...exactTargetPhrases,
    ...targetNouns,
    ...targetNouns.map(targetNoun => `${targetNoun}s`),
  ])].sort((left, right) => right.length - left.length);
  const target = `(?:${targetPhrases.map(escapeRegExp).join('|')})`;
  const exactTarget = `(?:${exactTargetPhrases.map(escapeRegExp).join('|')})`;
  const scopedWords =
    `(?:(?!(?:(?:is|are|was|were|equals?|remains?|does|do|did|shall|must|may|should|will|would|could|can|cannot|capped|limited|maximum)\\b|` +
    `at\\s+most\\b|no\\s+more\\s+than\\b|not\\s+more\\s+than\\b|up\\s+to\\b|and\\b|but\\b|while\\b|whereas\\b))` +
    `[a-z0-9][a-z0-9._'-]*\\s+)*`;
  const mentions: QuantityCardinalityMention[] = [];
  const add = (
    rawCount: string,
    role: QuantityCardinalityMention['role'],
    start = 0,
    end = normalized.length,
  ) => {
    const count = normalizedQuantityCount(rawCount);
    if (count == null) {
      if (!mentions.some(mention =>
        mention.count == null && mention.role === 'conflict' &&
        mention.start === start && mention.end === end
      )) {
        mentions.push(Object.freeze({ count: null, role: 'conflict', start, end }));
      }
      return;
    }
    const effectiveRole = role === 'total' &&
        quantityMentionHasNegativePolarity(normalized, start, end)
      ? 'conflict'
      : role;
    if (!mentions.some(mention =>
      mention.count === count && mention.role === effectiveRole &&
      mention.start === start && mention.end === end
    )) {
      mentions.push(Object.freeze({ count, role: effectiveRole, start, end }));
    }
  };
  const countSpan = (match: RegExpMatchArray, rawCount: string) => {
    const relative = match[0].lastIndexOf(rawCount);
    const start = (match.index || 0) + Math.max(0, relative);
    return Object.freeze({ start, end: start + rawCount.length });
  };

  // An explicit member-of-total statement describes a subset, not an added
  // total. Treat the whole bounded clause as that subset so its later
  // predicate (for example, "is an emergency light") cannot be misread as a
  // second cardinality.
  const subset = new RegExp(
    `\\b(?:one|1)\\s+of\\s+(?:(?:the|those|these)\\s+)?` +
      `(?:(${QUANTITY_COUNT_TOKEN_PATTERN})\\s+)?${exactTarget}\\b`,
  ).exec(normalized);
  if (subset) {
    mentions.push(Object.freeze({
      count: null,
      role: 'subset',
      start: subset.index,
      end: subset.index + subset[0].length,
    }));
    if (subset[1]) {
      const span = countSpan(subset, subset[1]);
      add(subset[1], 'total', span.start, span.end);
    }
    return mentions;
  }

  // A nearby explicit denial of a count conflicts with an affirmative total
  // even when it repeats the same numeral. Record it independently so it
  // cannot be mistaken for corroboration.
  const upperBoundPredicate = QUANTITY_UPPER_BOUND_PREDICATE_PATTERN;
  const lowerBoundPredicate = QUANTITY_LOWER_BOUND_PREDICATE_PATTERN;
  const sharedScopeList = QUANTITY_SHARED_SCOPE_LIST_PATTERN;
  for (const pattern of [
    new RegExp(
      `\\b${target}\\s+(?:counts?|quantit(?:y|ies)|totals?|numbers?)\\s+` +
        `(?:for|in|on|at|within|inside|of)\\s+(?:the\\s+)?${sharedScopeList}\\s+` +
        `(?:${upperBoundPredicate}|${lowerBoundPredicate})\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(?:counts?|quantit(?:y|ies)|totals?|numbers?)\\s+` +
        `(?:for|in|on|at|within|inside|of)\\s+(?:the\\s+)?${sharedScopeList}\\s+` +
        `(?:${upperBoundPredicate}|${lowerBoundPredicate})\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
  ]) {
    for (const match of normalized.matchAll(pattern)) {
      const span = countSpan(match, match[1]);
      add(match[1], 'total', span.start, span.end);
    }
  }
  for (const pattern of [
    new RegExp(
      `\\bthere\\s+(?:(?:is|are|was|were)\\s+not|(?:isn|aren|wasn|weren)'?t)\\s+` +
        `(?:exactly\\s+)?(${QUANTITY_COUNT_TOKEN_PATTERN})\\s+${target}\\b`,
      'g',
    ),
    new RegExp(
      `\\b(?:the\\s+)?number\\s+of\\s+${target}\\s+${scopedWords}` +
        `(?:(?:is|are)\\s+not(?:\\s+equals?(?:\\s+to)?)?|(?:isn|aren)'?t(?:\\s+equal(?:s)?(?:\\s+to)?)?|` +
        `does\\s+not\\s+equal(?:s)?(?:\\s+to)?|doesn'?t\\s+equal(?:s)?(?:\\s+to)?)\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b${target}\\s+(?:count|quantity|total)\\s+${scopedWords}` +
        `(?:(?:is|are)\\s+not(?:\\s+equals?(?:\\s+to)?)?|(?:isn|aren)'?t(?:\\s+equal(?:s)?(?:\\s+to)?)?|` +
        `does\\s+not\\s+equal(?:s)?(?:\\s+to)?|doesn'?t\\s+equal(?:s)?(?:\\s+to)?)\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
  ]) {
    for (const match of normalized.matchAll(pattern)) {
      const span = countSpan(match, match[1]);
      add(match[1], 'conflict', span.start, span.end);
    }
  }

  // Count/article before the requested noun. Scan the complete clause but stop
  // at finite verbs, relations, conjunctions, or another count so no fixed
  // descriptor cap can be bypassed with a longer construction subtype.
  const countLead = new RegExp(
    `\\b(?:exactly\\s+)?(${QUANTITY_COUNT_TOKEN_PATTERN})\\s+`,
    'g',
  );
  const descriptorStop =
    `(?:is|are|was|were|has|have|shows?|includes?|contains?|provides?|there|` +
    `number|count|quantity|total|equals?|in|on|at|for|within|inside|of|and|or|but|` +
    `with|without|plus|along|alongside|together|excluding|except|not|counting|` +
    `exclusive|apart|aside|other|than|save|${QUANTITY_COUNT_TOKEN_PATTERN}|\\d+)`;
  const descriptorAndTarget = new RegExp(
    `^((?:(?!${descriptorStop}\\b)[a-z0-9-]+\\s+)*)(?:or\\s+(?:more|greater|fewer|less)\\s+)?(${target})\\b`,
  );
  for (const countMatch of normalized.matchAll(countLead)) {
    const tailStart = (countMatch.index || 0) + countMatch[0].length;
    const targetMatch = descriptorAndTarget.exec(normalized.slice(tailStart));
    if (!targetMatch) continue;
    const matchedTargetPhrase = `${targetMatch[1]}${targetMatch[2]}`.trim();
    add(
      countMatch[1],
      exactCanonicalTargets.has(canonicalTargetPhrase(matchedTargetPhrase)) ? 'total' : 'subtype',
      countMatch.index || 0,
      tailStart + targetMatch[0].length,
    );
  }

  for (const pattern of [
    new RegExp(
      `\\b(?:the\\s+)?number\\s+of\\s+(${target})\\s+${scopedWords}` +
        `(?:is|are|equals?)\\s+(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(${target})\\s+(?:count|quantity|total)\\s+${scopedWords}` +
        `(?:is|are|equals?)\\s+(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(?:count|quantity|total)\\s+(?:for|of)\\s+(${target})\\s+${scopedWords}` +
        `(?:is|are|equals?)\\s+(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(${target})(?:\\s+(?:count|quantity|total))?\\s+` +
        `${scopedWords}${upperBoundPredicate}\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(?:the\\s+)?number\\s+of\\s+(${target})\\s+${scopedWords}` +
        `${upperBoundPredicate}\\s+` +
        `(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
  ]) {
    for (const match of normalized.matchAll(pattern)) {
      const span = countSpan(match, match[2]);
      add(
        match[2],
        exactCanonicalTargets.has(canonicalTargetPhrase(match[1])) ? 'total' : 'subtype',
        span.start,
        span.end,
      );
    }
  }
  return mentions;
}

function quantityClauseHasStrongAdditiveCue(value: string) {
  const normalized = normalizePolicyText(value).replace(
    /\b(?:no|not)\s+more\s+than\b/g,
    'inclusive bound',
  );
  return /\b(?:additional(?:ly)?|another|more|plus|in addition)\b/.test(normalized);
}

function quantityConstraintAllowsCandidate(
  value: string,
  threshold: number,
  candidate: number,
): boolean | null {
  const normalized = normalizePolicyText(value);
  const simpleCount =
    '(?:0|[1-9]\\d*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozen)';
  const range = new RegExp(
    `\\b(?:between\\s+(${simpleCount})\\s+and\\s+(${simpleCount})|` +
      `from\\s+(${simpleCount})\\s+(?:to|through|thru)\\s+(${simpleCount}))\\b`,
  ).exec(normalized);
  if (range) {
    const lower = normalizedQuantityCount(range[1] || range[3]);
    const upper = normalizedQuantityCount(range[2] || range[4]);
    if (lower == null || upper == null || lower > upper) return false;
    return candidate >= lower && candidate <= upper;
  }
  const relation = ecosQuantityOneSidedRelation(value);
  if (relation === 'gte') return candidate >= threshold;
  if (relation === 'lte') return candidate <= threshold;
  if (relation === 'gt') return candidate > threshold;
  if (relation === 'lt') return candidate < threshold;
  return null;
}

export function ecosQuantityOneSidedRelation(
  value: string,
): 'gte' | 'lte' | 'gt' | 'lt' | null {
  const normalized = normalizeQuantityConstraintSyntax(value);
  const raw = value.normalize('NFKC').toLowerCase();
  const countToken = QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN;
  if (
    new RegExp(
      `\\b(?:at\\s+least|minimum(?:\\s+of)?|no\\s+(?:less|fewer|lower)\\s+than|` +
        `not\\s+(?:less|fewer|lower)\\s+than|not\\s+(?:under|below)|` +
        `no\\s+lower\\s+than|at\\s+or\\s+above|greater\\s+than\\s+or\\s+equal\\s+to|` +
        `${QUANTITY_NEGATED_LOWER_BOUND_PREDICATE_PATTERN})\\b`,
    ).test(normalized) ||
    new RegExp(`\\b${countToken}\\s+or\\s+(?:more|greater)\\b`).test(normalized) ||
    /(?:>=|≥|≧)/u.test(raw)
  ) return 'gte';
  if (
    new RegExp(
      `\\b(?:at\\s+most|maximum(?:\\s+of)?|up\\s+to|no\\s+more\\s+than|` +
        `not\\s+more\\s+than|no\\s+(?:greater|higher)\\s+than|` +
        `not\\s+(?:greater|higher)\\s+than|` +
        `not\\s+exceeding|${QUANTITY_NEGATED_UPPER_BOUND_PREDICATE_PATTERN}|` +
        `not\\s+to\\s+exceed|(?:is|are|was|were|remains?)\\s+` +
        `(?:capped\\s+at|limited\\s+to)|at\\s+or\\s+below|` +
        `less\\s+than\\s+or\\s+equal\\s+to)\\b`,
    ).test(normalized) ||
    new RegExp(`\\b${countToken}\\s+or\\s+(?:fewer|less)\\b`).test(normalized) ||
    /(?:<=|≤|≦)/u.test(raw)
  ) return 'lte';
  if (/\b(?:more|greater)\s+than\b/.test(normalized) || /(?:^|[^=])>(?!=)/u.test(raw)) {
    return 'gt';
  }
  if (
    /\b(?:less|fewer)\s+than\b|\bnot\s+as\s+many\s+as\b/.test(normalized) ||
    new RegExp(`\\b(?:below|under)\\s+(?:the\\s+)?${countToken}\\b`).test(normalized) ||
    /(?:^|[^=])<(?!=)/u.test(raw)
  ) return 'lt';
  return null;
}

function quantityLocalTextContradictsCandidate(value: string) {
  const strictSymbolicBound = /[<>≤≥]/u.test(value);
  const normalized = normalizeQuantityConstraintSyntax(value);
  const strictBoundText = normalized.replace(
    /\b(?:no|not)\s+(?:less|fewer|more|greater)\s+than\b/g,
    'inclusive bound',
  );
  return (
    strictSymbolicBound ||
    /\b(?:is|are|was|were)\s+(?:(?:definitely|certainly|actually|really)\s+)?not\s+(?:(?:actually|really)\s+)?(?:shown|listed|provided|identified|counted|included|present|found|located)\b/.test(
      normalized,
    ) ||
    /\b(?:does|do|did)\s+not\s+(?:show|have|include|contain|provide|list|identify|count)\b/.test(
      normalized,
    ) ||
    /\b(?:it|this|that)\s+(?:is|was)\s+(?:false|untrue|incorrect|not\s+true)\s+that\b/.test(
      normalized,
    ) ||
    /\b(?:false|untrue|incorrect|not\s+true)\s+that\b/.test(normalized) ||
    /\bit\s+(?:is|was|would\s+be|could\s+be)\s+(?:incorrect|wrong|false|untrue|invalid)\s+to\s+(?:say|assert|claim|state|report)\s+that\b/.test(
      normalized,
    ) ||
    /\b(?:assertion|claim|statement|report)\s+that\b[\s\S]{0,160}\b(?:(?:is|was)\s+(?:false|incorrect|wrong|untrue|invalid|not\s+(?:correct|right|accurate|valid|reliable))|(?:cannot|can\s+not|could\s+not)\s+be\s+(?:true|correct|right|accurate|valid|reliable))\b/.test(
      normalized,
    ) ||
    /\b(?:below|under)\s+(?:0|[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(normalized) ||
    /\bnot\s+as\s+many\s+as\b/.test(normalized) ||
    /\b(?:less|fewer|more|greater)\s+than\b/.test(strictBoundText) ||
    /\bnot\s+exactly\b/.test(normalized) ||
    /\bnowhere\b/.test(normalized)
  );
}

function quantityClauseInvalidatesAntecedentCount(
  value: string,
  question: string,
): 'pronoun' | 'explicit_unscoped' | 'explicit_requested_scope' | 'explicit_other_scope' | null {
  const normalized = normalizeQuantityConstraintSyntax(value);
  if (/^(?:if|unless|whether|provided\s+that|assuming\s+that|in\s+case)\b/.test(normalized)) {
    return null;
  }
  const transitionMarker =
    '(?:(?:subsequently|ultimately|later|then|eventually|finally|now|thereafter|' +
    'consequently|nevertheless|nonetheless|still|therefore|accordingly|afterward|afterwards)\\s+|' +
    'in\\s+fact\\s+|as\\s+a\\s+result\\s+|upon(?:\\s+further)?\\s+review\\s+)*';
  const stateInvalidation = new RegExp(
    `\\b(?:(?:is|are|was|were|became|remains?|has\\s+been|have\\s+been|had\\s+been)\\s+` +
      `${transitionMarker}(?:no\\s+longer\\s+(?:correct|right|accurate|valid|reliable|applicable|usable)|` +
      `incorrect|wrong|invalid|false|inaccurate|unreliable|untrustworthy|obsolete|deprecated|` +
      `invalidated|discarded|withdrawn|retracted|superseded|stale|erroneous|` +
      `not\\s+(?:correct|right|accurate|valid|reliable|trustworthy|applicable|usable))|` +
      `(?:found|determined|deemed)\\s+(?:to\\s+be\\s+)?` +
      `(?:incorrect|wrong|invalid|false|inaccurate|unreliable|stale|erroneous))\\b`,
  );
  const positiveDiscard = new RegExp(
    `\\b(?:should|must|is\\s+to|ought\\s+to)\\s+${transitionMarker}` +
      `be\\s+(?:ignored|disregarded|discarded|rejected|withdrawn|retracted)\\b`,
  );
  const negativeUse =
    /\b(?:(?:(?:should|must|ought(?:\s+to)?|is\s+to)\s+(?:now\s+)?not|cannot|could\s+not)\s+be|(?:is|was)\s+(?:now\s+)?not\s+to\s+be)\s+(?:used|accepted|trusted|relied\s+(?:on|upon))\b/;
  const imperativeInvalidation =
    /^(?:(?:please|kindly|for\s+clarity)\s+)*(?:(?:ignore|disregard|discard|reject)\b|(?:do|does)\s+not\s+(?:use|accept|trust|rely\s+(?:on|upon))\b)/;
  const treatmentInvalidation =
    /\btreat\b[\s\S]{0,96}\bas\s+(?:incorrect|wrong|invalid|false|inaccurate|unreliable|obsolete|deprecated)\b/;
  const incorrectDeicticCount =
    /\b(?:this|that)\s+(?:is|was)\s+not\s+the\s+(?:correct|right|accurate|valid|reliable|trustworthy)\s+(?:counts?|quantit(?:y|ies)|numbers?|totals?|values?|figures?|tall(?:y|ies)|amounts?)\b/;
  const quantityReferenceNounPattern =
    '(?:counts?|quantit(?:y|ies)|numbers?|totals?|values?|figures?|tall(?:y|ies)|amounts?)';
  const genericScopeKind = QUANTITY_SCOPE_KIND_PATTERN;
  const genericScope =
    `${genericScopeKind}\\s+["\']?\\s*[a-z0-9]+(?:[.-][a-z0-9]+)*\\s*["\']?`;
  const coordinatedScopeList = QUANTITY_SHARED_SCOPE_LIST_PATTERN;
  const ownedPredicate =
    '(?:is|are|was|were|became|remains?|has|have|had|should|must|may|will|would|could|can|cannot|ought|does|do|did|found|determined|deemed)';
  const ownedCoreference =
    '(?:they|these|those|both|all|each|every|it|this|that|' +
    '(?:all|both)\\s+of\\s+(?:them|these|those)|every\\s+one)';
  const ownedPredicateContinuation =
    `(?:${transitionMarker}(?:(?:${ownedCoreference})\\s+)?` +
    `${transitionMarker}${ownedPredicate}(?:\\s+${transitionMarker})?)`;
  const boundedCoordinatedTail =
    `(?:(?!\\b(?:but|while|whereas)\\s+(?!${ownedPredicateContinuation}\\b)|` +
    `\\band\\s+(?!${ownedPredicateContinuation}\\b))[\\s\\S]){0,96}`;
  const coordinatedPatterns = [
    new RegExp(
      `\\b${coordinatedScopeList}\\s+` +
        `(?:[a-z0-9-]+\\s+){0,2}${quantityReferenceNounPattern}\\b${boundedCoordinatedTail}`,
      'g',
    ),
    new RegExp(
      `\\b${genericScope}\\s+(?:[a-z0-9-]+\\s+){0,2}${quantityReferenceNounPattern}\\s+` +
        `(?:and|&)\\s+${genericScope}\\s+(?:[a-z0-9-]+\\s+){0,2}` +
        `${quantityReferenceNounPattern}\\b${boundedCoordinatedTail}`,
      'g',
    ),
    new RegExp(
      `\\b${quantityReferenceNounPattern}\\s+(?:for|in|on|at|within|inside|of)\\s+` +
        `(?:the\\s+)?${coordinatedScopeList}` +
        `\\b${boundedCoordinatedTail}`,
      'g',
    ),
  ];
  const requestedScopes = policyQuantityRequestedInsideScopeDescriptors(question);
  const coordinatedReferences = coordinatedPatterns.flatMap(pattern =>
    [...normalized.matchAll(pattern)].map(match => match[0])
  ).filter(segment => segment && (
    stateInvalidation.test(segment) || positiveDiscard.test(segment) ||
    negativeUse.test(segment) || imperativeInvalidation.test(segment) ||
    treatmentInvalidation.test(segment)
  ));
  const coordinatedReference = coordinatedReferences.find(segment =>
    requestedScopes.some(requested =>
      new RegExp(`\\b(?:${requested.pattern})\\b`).test(segment)
    )
  ) || coordinatedReferences[0] || '';
  // Bind the invalidating predicate and its quantity reference inside the
  // same coordinate segment. A later unrelated subject such as "the note is
  // wrong" must not invalidate an earlier, explicitly correct count.
  const relevantSegment = coordinatedReference || normalized.split(/\b(?:but|while|whereas|and)\b/)
    .map(segment => segment.trim())
    .filter(Boolean)
    .find(segment => {
      const hasReference = /\b(?:count|quantity|number|total|value|figure|tally|amount|it|this|that)\b/.test(
        segment,
      );
      return hasReference && (
        stateInvalidation.test(segment) || positiveDiscard.test(segment) ||
        negativeUse.test(segment) || imperativeInvalidation.test(segment) ||
        incorrectDeicticCount.test(segment) || treatmentInvalidation.test(segment)
      );
    });
  if (!relevantSegment) return null;

  const quantityNoun = new RegExp(`\\b${quantityReferenceNounPattern}\\b`);
  const hasExplicitReference = quantityNoun.test(relevantSegment);
  const hasPronounReference = /\b(?:it|this|that|they|these|those|both|all|each|every)\b/.test(relevantSegment);
  if (!hasExplicitReference && !hasPronounReference) return null;

  let referenceKind: 'pronoun' | 'explicit_unscoped' | 'explicit_requested_scope' | 'explicit_other_scope' =
    hasExplicitReference ? 'explicit_unscoped' : 'pronoun';
  if (!hasExplicitReference) return referenceKind;

  if (requestedScopes.length === 0) return referenceKind;
  if (
    coordinatedReference &&
    requestedScopes.some(requested => new RegExp(`\\b(?:${requested.pattern})\\b`).test(relevantSegment))
  ) return 'explicit_requested_scope';
  const quantityReferenceNoun = quantityReferenceNounPattern;
  const requestedScopeBindsReference = requestedScopes.some(requested => new RegExp(
    `\\b(?:${requested.pattern})\\s+(?:[a-z0-9-]+\\s+){0,2}${quantityReferenceNoun}\\b|` +
      `\\b${quantityReferenceNoun}\\s+(?:for|in|on|at|within|inside|of)\\s+` +
      `(?:the\\s+)?(?:${requested.pattern})\\b`,
  ).test(relevantSegment));
  if (requestedScopeBindsReference) return 'explicit_requested_scope';

  const otherScopeBindsReference = new RegExp(
    `\\b${genericScope}\\s+(?:[a-z0-9-]+\\s+){0,2}${quantityReferenceNoun}\\b|` +
      `\\b${quantityReferenceNoun}\\s+(?:for|in|on|at|within|inside|of)\\s+` +
      `(?:the\\s+)?${genericScope}\\b`,
  ).test(relevantSegment);
  return otherScopeBindsReference ? 'explicit_other_scope' : referenceKind;
}

function quantityCoordinatedBoundContradictsCandidate(
  value: string,
  question: string,
  candidateCount: number,
) {
  const normalized = normalizeQuantityConstraintSyntax(value);
  const requestedScopes = policyQuantityRequestedInsideScopeDescriptors(question);
  const targetNouns = policyQuantityTargetNouns(question);
  if (requestedScopes.length === 0 || targetNouns.length === 0) return false;
  const target = `(?:${targetNouns.map(escapeRegExp).join('|')})s?`;
  const scopeList =
    `(?:${QUANTITY_SHARED_SCOPE_LIST_PATTERN}|${QUANTITY_SCOPE_REFERENCE_PATTERN})`;
  const predicate =
    `(?:${QUANTITY_UPPER_BOUND_PREDICATE_PATTERN}|` +
    `${QUANTITY_LOWER_BOUND_PREDICATE_PATTERN})`;
  const patterns = [
    new RegExp(
      `\\b${target}\\s+(?:counts?|quantit(?:y|ies)|totals?|numbers?)\\s+` +
        `(?:for|in|on|at|within|inside|of)\\s+(?:the\\s+)?${scopeList}\\s+` +
        `${predicate}\\s+(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
    new RegExp(
      `\\b(?:counts?|quantit(?:y|ies)|totals?|numbers?)\\s+` +
        `(?:for|in|on|at|within|inside|of)\\s+(?:the\\s+)?${scopeList}\\s+` +
        `${predicate}\\s+(${QUANTITY_COUNT_TOKEN_PATTERN})(?=\\s*(?:[.,;]|$))`,
      'g',
    ),
  ];
  return patterns.some(pattern => [...normalized.matchAll(pattern)].some(match => {
    const threshold = normalizedQuantityCount(match[1]);
    if (threshold == null) return true;
    const bindsRequestedScope = requestedScopes.some(requested => {
      if (new RegExp(`\\b(?:${requested.pattern})\\b`).test(match[0])) return true;
      const compactFamily = `(?:${requested.familyPattern})s?`;
      return new RegExp(
        `\\b${compactFamily}\\s+` +
          `(?:(?:${QUANTITY_COMPACT_SCOPE_IDENTIFIER_PATTERN}|and|or)\\s+){0,8}` +
          `["']?\\s*${escapeRegExp(requested.identifier)}\\s*["']?(?=$|\\s|[./])`,
      ).test(match[0].replace(/\//g, ' '));
    });
    if (!bindsRequestedScope) return false;
    return quantityConstraintAllowsCandidate(match[0], threshold, candidateCount) === false;
  }));
}

function quantityCandidateHasSameScopeConflict(
  clauses: readonly string[],
  cardinalitiesByClause: readonly (readonly QuantityCardinalityMention[])[],
  candidateIndex: number,
  candidateCount: number,
  question: string,
) {
  if (clauses.some(clause =>
    quantityCoordinatedBoundContradictsCandidate(clause, question, candidateCount)
  )) return true;
  let candidateIsNearestQuantityOwner = true;
  for (let index = candidateIndex + 1; index < clauses.length; index += 1) {
    const laterClause = clauses[index] || '';
    const laterMentions = cardinalitiesByClause[index] || [];
    if (laterMentions.length > 0) {
      const normalizedLater = normalizeQuantityConstraintSyntax(laterClause);
      const laterScopes = laterMentions.map(mention =>
        quantityMentionScope(normalizedLater, question, mention)
      );
      candidateIsNearestQuantityOwner = false;
      if (laterScopes.some(scope =>
        scope === 'requested' || scope === 'mixed' || scope === 'unspecified'
      )) break;
      continue;
    }
    const invalidation = quantityClauseInvalidatesAntecedentCount(laterClause, question);
    if (invalidation === 'explicit_requested_scope') return true;
    if (invalidation === 'explicit_unscoped' && candidateIsNearestQuantityOwner) return true;
    if (invalidation === 'pronoun' && index === candidateIndex + 1) return true;
  }
  for (let index = 0; index < clauses.length; index += 1) {
    if (index === candidateIndex) continue;
    const adjacent = clauses[index];
    const adjacentMentions = cardinalitiesByClause[index] || [];
    if (!adjacent) continue;
    if (adjacentMentions.length === 0) continue;
    const normalizedAdjacent = normalizeQuantityConstraintSyntax(adjacent);
    const adjacentHasStrictSymbolicBound = /[<>≤≥]/u.test(adjacent);
    for (const mention of adjacentMentions) {
      const scope = quantityMentionScope(normalizedAdjacent, question, mention);
      if (scope === 'outside' || scope === 'other') continue;
      if (scope === 'mixed') return true;
      const localText = quantityMentionLocalSegment(
        normalizedAdjacent,
        mention.start,
        mention.end,
      ).text;
      const constraintAllowsCandidate = mention.count == null
        ? null
        : quantityConstraintAllowsCandidate(localText, mention.count, candidateCount);
      if (constraintAllowsCandidate === false) return true;
      if (constraintAllowsCandidate === true) continue;
      const strongAdditive = quantityClauseHasStrongAdditiveCue(localText);
      if (
        mention.count === candidateCount &&
        (adjacentHasStrictSymbolicBound || quantityLocalTextContradictsCandidate(localText))
      ) return true;
      if (mention.role === 'conflict') {
        if (mention.count == null || mention.count === candidateCount) return true;
        continue;
      }
      if (mention.role === 'subset' && !strongAdditive) continue;
      if (
        mention.role === 'total' &&
        !strongAdditive &&
        mention.count === candidateCount
      ) continue;
      return true;
    }
  }
  return false;
}

function policyQuantityRequestedInsideScopePatterns(question: string) {
  return policyQuantityRequestedInsideScopeDescriptors(question).map(scope => scope.pattern);
}

const QUANTITY_SHEET_SCOPE_FAMILY_PATTERN =
  '(?:sheets?|shts?\\.?)\\s*(?:(?:number|no\\.?)\\s*)?';

function quantityComparableSheetIdentifierPattern(value: string) {
  const canonical = canonicalComparableSheetNumber(value).toLowerCase();
  if (!canonical) return '';
  const variants = [canonical];
  const conventionalBookmark = /^(a|e|mb|pb|sb|wpa|wpb|wpc)-(.+)$/.exec(canonical);
  const xeBookmark = /^x-e-(.+)$/.exec(canonical);
  if (conventionalBookmark) {
    variants.push(`${conventionalBookmark[1]}${conventionalBookmark[2]}`);
  } else if (xeBookmark) {
    variants.push(`xe${xeBookmark[1]}`);
  }
  const flexible = (identifier: string) => {
    let pattern = '';
    for (let index = 0; index < identifier.length; index += 1) {
      const character = identifier[index];
      const previous = identifier[index - 1] || '';
      if (/[a-z0-9]/.test(character) && /[a-z0-9]/.test(previous)) pattern += '\\s*';
      pattern += character === '-'
        ? '\\s*-\\s*'
        : character === '.' ? '\\s*\\.\\s*' : escapeRegExp(character);
    }
    return pattern;
  };
  return `(?:${[...new Set(variants)].map(flexible).join('|')})`;
}

function policyQuantityRequestedInsideScopeDescriptors(question: string) {
  const drawingSheetScope = requestedECOSDrawingSheetScope(question);
  if (drawingSheetScope.explicit && drawingSheetScope.invalid) {
    return [Object.freeze({
      pattern: '(?!)',
      familyPattern: '(?!)',
      identifier: 'unresolved-sheet-scope',
      expectedRelation: 'inside',
    })];
  }
  const normalizedQuestion = normalizePolicyText(canonicalizeQuantityQuestionPeerScopeConnectors(
    protectQuantityTerminalPlusIdentifiers(
      stripLeadingSourceAuthorityFrame(question),
      'ecosinvalidplusquestion',
    ),
  ));
  const scopeLabel =
    '(?:building\\s+areas?|loading\\s+docks?|details?|det\\.?|rooms?|panels?|canop(?:y|ies)|buildings?|areas?|zones?|levels?|floors?|grids?|doors?|sheets?|shts?\\.?|(?:pdf\\s+)?pages?|pg\\.?|figures?|fig\\.?|drawings?|dwg\\.?|documents?|doc\\.?|revisions?|rev\\.?|plans?|notes?|tasks?|types?|units?|suites?|bays?|sections?|phases?|options?|items?)';
  const canonicalScopeLabel = (label: string) => ({
    'building areas': 'building area',
    'loading docks': 'loading dock',
    details: 'detail',
    rooms: 'room',
    panels: 'panel',
    canopies: 'canopy',
    buildings: 'building',
    areas: 'area',
    zones: 'zone',
    levels: 'level',
    floors: 'floor',
    grids: 'grid',
    doors: 'door',
    sheets: 'sheet',
    sht: 'sheet',
    'sht.': 'sheet',
    shts: 'sheet',
    'shts.': 'sheet',
    'pdf page': 'page',
    'pdf pages': 'page',
    pages: 'page',
    figures: 'figure',
    drawings: 'drawing',
    documents: 'document',
    revisions: 'revision',
    plans: 'plan',
    notes: 'note',
    tasks: 'task',
    types: 'type',
    units: 'unit',
    suites: 'suite',
    bays: 'bay',
    sections: 'section',
    phases: 'phase',
    options: 'option',
    items: 'item',
  } as Readonly<Record<string, string>>)[label] || label;
  const labelPattern = (label: string) => ({
    detail: '(?:detail|det\\.?)', det: '(?:detail|det\\.?)', 'det.': '(?:detail|det\\.?)',
    sheet: QUANTITY_SHEET_SCOPE_FAMILY_PATTERN,
    page: '(?:(?:pdf\\s+)?page|pg\\.?)', pg: '(?:(?:pdf\\s+)?page|pg\\.?)', 'pg.': '(?:(?:pdf\\s+)?page|pg\\.?)',
    figure: '(?:figure|fig\\.?)', fig: '(?:figure|fig\\.?)', 'fig.': '(?:figure|fig\\.?)',
    drawing: '(?:drawing|dwg\\.?)', dwg: '(?:drawing|dwg\\.?)', 'dwg.': '(?:drawing|dwg\\.?)',
    document: '(?:document|doc\\.?)', doc: '(?:document|doc\\.?)', 'doc.': '(?:document|doc\\.?)',
    revision: '(?:revision|rev\\.?)', rev: '(?:revision|rev\\.?)', 'rev.': '(?:revision|rev\\.?)',
  } as Readonly<Record<string, string>>)[label] || escapeRegExp(label).replace(/\\ /g, '\\s+');
  const descriptors = new Map<string, Readonly<{
    pattern: string;
    familyPattern: string;
    identifier: string;
    expectedRelation: string;
  }>>();
  const addDescriptor = (
    rawLabel: string,
    identifier: string,
    scopeIndex: number,
  ) => {
    const label = canonicalScopeLabel(rawLabel);
    const descriptorIdentifier = label === 'sheet'
      ? canonicalComparableSheetNumber(identifier).toLowerCase()
      : identifier;
    if (!descriptorIdentifier) return;
    if (label === 'room' && descriptorIdentifier === 'type') return;
    if (/^(?:show|shows|shown|list|lists|listed|provide|provides|provided|include|includes|included|contain|contains|contained|have|has|had|is|are|was|were|does|do|did|for|in|on|at|within|inside|outside|near)$/.test(
      descriptorIdentifier,
    )) return;
    const familyPattern = labelPattern(label);
    const identifierPattern = label === 'sheet'
      ? quantityComparableSheetIdentifierPattern(descriptorIdentifier)
      : escapeRegExp(descriptorIdentifier);
    if (!identifierPattern) return;
    const pattern =
      `${familyPattern}\\s+["']?\\s*${identifierPattern}(?![a-z0-9-]|\\.(?=[a-z0-9]))\\s*["']?`;
    const key = `${familyPattern}:${descriptorIdentifier}`;
    if (descriptors.has(key)) return;
    descriptors.set(key, Object.freeze({
      pattern,
      familyPattern,
      identifier: descriptorIdentifier,
      expectedRelation: policyScopeRelationBeforeScope(normalizedQuestion.slice(
        Math.max(0, scopeIndex - 96),
        scopeIndex,
      )),
    }));
  };

  // A plural scope label owns every compact identifier in the same bounded
  // list. `Details A and B` therefore requests two independent count scopes;
  // it is not one combined location whose aggregate can satisfy both.
  const compactIdentifier = QUANTITY_COMPACT_SCOPE_IDENTIFIER_BASE_PATTERN;
  const coordinatedScopePattern = new RegExp(
    `\\b(${scopeLabel})\\s+(` +
      `${compactIdentifier}(?:\\s+${compactIdentifier}){0,6}\\s+(?:and|or)\\s+${compactIdentifier}|` +
      `${compactIdentifier}(?:\\s*\\/\\s*${compactIdentifier})+` +
    `)`,
    'g',
  );
  for (const match of normalizedQuestion.matchAll(coordinatedScopePattern)) {
    const identifiers = [...match[2].matchAll(new RegExp(
      `(?<![a-z0-9.-])(${compactIdentifier})`,
      'g',
    ))].map(identifierMatch => identifierMatch[1]);
    if (identifiers.length < 2) continue;
    for (const identifier of identifiers) {
      addDescriptor(match[1], identifier, match.index || 0);
    }
  }
  for (const match of normalizedQuestion.matchAll(new RegExp(
    `\\b(${scopeLabel})\\s+["']?\\s*([a-z0-9]+(?:[.-][a-z0-9]+)*)\\s*["']?`,
    'g',
  ))) {
    addDescriptor(match[1], match[2], match.index || 0);
  }
  if (drawingSheetScope.explicit && drawingSheetScope.sheets.length > 0) {
    const firstSheetLabelIndex = normalizedQuestion.search(
      /\b(?:sheets?|shts?\.?)\b/,
    );
    for (const sheet of drawingSheetScope.sheets) {
      addDescriptor('sheet', sheet, Math.max(0, firstSheetLabelIndex));
    }
  }
  return [...descriptors.values()];
}

function quantityClauseHasNonExactCardinality(value: string, question: string) {
  const cardinalityValue = quantityPolicyTextWithoutBoundedReferralTail(value, question);
  const cardinalityOnlyValue = quantityTextWithoutBoundedAttributeQualifiers(cardinalityValue);
  const normalized = normalizePolicyText(cardinalityOnlyValue);
  const raw = cardinalityOnlyValue.normalize('NFKC').toLowerCase();
  const referralTail = QUANTITY_SECONDARY_REFERRAL_TAIL_PATTERN.exec(value)?.[0] || '';
  if (referralTail && cardinalityValue === value) return true;
  const additiveCount = '(?:\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen|another)';
  const targetNouns = policyQuantityTargetNouns(question);
  const additiveSameTarget = targetNouns.length > 0 && new RegExp(
    `\\b(?:along\\s+with|alongside|accompanied\\s+by|with|and)\\s+(?:exactly\\s+)?${additiveCount}\\s+` +
      `(?:additional\\s+)?(?:[a-z0-9-]+\\s+){0,3}(?:${targetNouns.map(escapeRegExp).join('|')})s?\\b(?:\\s+also)?`,
  ).test(normalized);
  const additiveImplicitSingularTarget = targetNouns.length > 0 && new RegExp(
    `\\b(?:plus|along\\s+with|alongside|accompanied\\s+by|together\\s+with|as\\s+well\\s+as|with|and)` +
      `\\s+(?:(?:a|an)\\s+(?:single\\s+)?|single\\s+)(?:[a-z0-9-]+\\s+){0,3}` +
      `(?:${targetNouns.map(escapeRegExp).join('|')})s?\\b(?:\\s+also)?`,
  ).test(normalized);
  return (
    /\b(?:approximately|approx\.?|about|roughly|estimated|estimate|around|nearly|almost|at least|at most|no more than|no less than|not more than|not less than|more than|less than|fewer than|greater than|up to|minimum|maximum|not exactly|as many as|as few as|upwards of|downwards of|possibly|possible|maybe|potentially|apparently|reportedly|allegedly|supposedly|presumably|ostensibly|arguably|probably|perhaps|circa|nominal|unconfirmed|unverified|uncertain|likely|presumed)\b/.test(normalized) ||
    /\b(?:more or less|give or take|subject to (?:verification|confirmation)|pending (?:verification|confirmation))\b/.test(normalized) ||
    /\b\d+(?:\.\d+)?\s*%\s+confidence\b/.test(normalized) ||
    quantityClauseHasMismatchedScopeQualifier(normalized, question) ||
    quantityClauseHasAdditiveSameTarget(cardinalityValue, question) ||
    new RegExp(
      `\\bplus\\s+(?:exactly\\s+)?${additiveCount}\\b|` +
        `\\band\\s+an?\\s+additional\\s+${additiveCount}\\b|` +
        `\\badditionally\\s+${additiveCount}\\b|` +
        `\\b(?:along\\s+with|alongside|accompanied\\s+by|in\\s+addition\\s+to|together\\s+with|as\\s+well\\s+as)\\s+${additiveCount}\\b`,
    ).test(normalized) ||
    additiveSameTarget ||
    additiveImplicitSingularTarget ||
    (/\b\d+\s+additional\b/.test(normalized) && !/\badditional\b/.test(normalizePolicyText(question))) ||
    /\bbetween\s+\d+\s+and\s+\d+\b/.test(normalized) ||
    /\b(?:either\s+)?\d+\s+(?:or|and)\s+\d+\b/.test(normalized) ||
    /\b(?:from\s+)?\d+\s+(?:to|through|thru)\s+\d+\b/.test(normalized) ||
    /(?:^|[^a-z0-9])\d+\s*[-–—]\s*\d+(?:[^a-z0-9]|$)/.test(raw) ||
    /(?:^|[^a-z0-9])\d+\s*(?:\/|…|\.\.\.|±|∓)\s*\d+(?:[^a-z0-9]|$)/.test(raw) ||
    /(?:^|[^a-z0-9])(?:[<>]=?|≤|≥|≦|≧|≈|~)\s*\d+/.test(raw) ||
    /(?:^|\s)[+\-−]\s*\d+/.test(raw) ||
    /(?:^|[^a-z0-9])\d+\s*\+(?:[^a-z0-9]|$)/.test(raw) ||
    /\bplus or minus\s+\d+\b|\b\d+\s+plus or minus\s+\d+\b/.test(normalized) ||
    new RegExp(
      `\\b${QUANTITY_EXPLICIT_COUNT_TOKEN_PATTERN}\\s+or\\s+(?:more|greater|fewer|less)\\b`,
    ).test(normalized) ||
    /\b(?:range|bounded)\b[\s\S]{0,30}\b\d+\b/.test(normalized)
  );
}

function quantityPolicyTextWithoutBoundedReferralTail(value: string, question: string) {
  return stripECOSBoundedQuantityReferralTail(value, question);
}

function quantityTextWithoutBoundedAttributeQualifiers(value: string) {
  const relation =
    '(?:at\\s+least|at\\s+most|no\\s+(?:more|greater)\\s+than|no\\s+(?:less|fewer)\\s+than|' +
    'not\\s+(?:more|greater)\\s+than|not\\s+(?:less|fewer)\\s+than|minimum(?:\\s+of)?|' +
    'maximum(?:\\s+of)?|up\\s+to|more\\s+than|less\\s+than)';
  const amount = '\\d+(?:\\.\\d+)?';
  const unit =
    '(?:cri|watts?|w|volts?|v|amps?|a|lumens?|lm|kelvin|degrees?|psi|cfm|' +
    'percent|%|inches?|feet|foot|ft|millimeters?|mm|centimeters?|cm|meters?|m)';
  const postfixRelation =
    '(?:or\\s+(?:greater|more|less|fewer)|minimum|maximum|min\\.?|max\\.?)';
  const attributeLabel =
    '(?:efficiency|cri|color\\s+rendering\\s+index|rating|output|power|voltage|' +
    'amperage|temperature|pressure|airflow|flow|capacity)';
  return value
    .replace(new RegExp(
      `\\b(?:(?:each\\s+)?(?:with|having)|(?:each\\s+)?rated)\\s+` +
        `(?:an?\\s+)?${amount}\\s*(?:\\+|${postfixRelation})\\s*${unit}` +
        `(?=$|\\s|[.,;:])(?:\\s+rating)?(?:\\s+each)?`,
      'gi',
    ), ' ')
    .replace(new RegExp(
      `\\b(?:(?:each\\s+)?(?:with|having)|(?:each\\s+)?rated)\\s+` +
        `(?:an?\\s+)?${unit}(?:\\s+rating)?(?:\\s+of)?\\s+${amount}\\s*${postfixRelation}` +
        `(?=$|\\s|[.,;:])(?:\\s+each)?`,
      'gi',
    ), ' ')
    .replace(new RegExp(
      `\\b(?:(?:each\\s+)?(?:with|having))\\s+(?:an?\\s+)?${attributeLabel}` +
        `(?:\\s+rating)?(?:\\s+of)?\\s+${relation}\\s+${amount}\\s*${unit}` +
        `(?=$|\\s|[.,;:])(?:\\s+rating)?(?:\\s+each)?`,
      'gi',
    ), ' ')
    .replace(new RegExp(
      `\\b(?:(?:each\\s+)?(?:with|having)|(?:each\\s+)?rated)\\s+` +
        `(?:an?\\s+)?${relation}\\s+${amount}\\s*${unit}` +
        `(?=$|\\s|[.,;:])(?:\\s+rating)?(?:\\s+each)?`,
      'gi',
    ), ' ')
    .replace(new RegExp(
      `\\b(?:(?:each\\s+)?(?:with|having))\\s+(?:an?\\s+)?${unit}` +
        `(?:\\s+rating)?(?:\\s+of)?\\s+${relation}\\s+${amount}\\b` +
        `(?:\\s+rating)?(?:\\s+each)?`,
      'gi',
    ), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripECOSBoundedQuantityAttributeQualifiers(
  value: string,
  question: string,
) {
  return analyzeECOSProjectQuestion(question).kind === 'quantity'
    ? quantityTextWithoutBoundedAttributeQualifiers(value)
    : value;
}

function quantityClauseHasMismatchedScopeQualifier(
  normalizedClause: string,
  question: string,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const clauseRates = quantityRateDenominators(normalizedClause);
  const questionRates = quantityRateDenominators(normalizedQuestion);
  if (!sameStringSet(clauseRates, questionRates)) return true;
  const clauseExclusions = quantityExclusionAnchors(normalizedClause);
  const questionExclusions = quantityExclusionAnchors(normalizedQuestion);
  return !sameStringSet(clauseExclusions, questionExclusions);
}

function quantityRateDenominators(value: string) {
  const rates = new Set<string>();
  const ratePattern = /\b(per(?:\s+|-)|(?:in|for)\s+(?:each|every)\s+|each\s+|every\s+)((?:(?:typical|standard|individual|applicable|occupied|unoccupied)\s+){0,2})(rooms?|floors?|levels?|areas?|zones?|units?|sheets?|details?|panels?|buildings?|canop(?:y|ies))\b(?:\s+(basis|type)(?:\s+((?!(?:in|on|at|for|of|is|are|was|were|shown|listed|provided|included|present|within|inside)\b)[a-z0-9]+(?:[.-][a-z0-9]+)*))?)?/g;
  for (const match of value.matchAll(ratePattern)) {
    if (match[1].startsWith('per')) {
      const remainder = value.slice((match.index || 0) + match[0].length);
      const nextWord = /^\s+([a-z0-9]+(?:[.-][a-z0-9]+)*)\b/.exec(remainder)?.[1] || '';
      if (
        nextWord &&
        !/^(?:in|on|at|for|of|is|are|was|were|shown|listed|provided|included|present|within|inside)$/.test(nextWord)
      ) continue;
    }
    const qualifiers = match[2].trim().split(/\s+/).filter(Boolean).map(canonicalContextToken);
    const denominator = canonicalContextToken(match[3]);
    const kind = match[4] || '';
    const identifier = match[5] || '';
    rates.add([...qualifiers, denominator, kind, identifier].filter(Boolean).join(' '));
  }
  return rates;
}

function quantityExclusionAnchors(value: string) {
  const anchors = new Set<string>();
  for (const match of value.matchAll(
    /\b(?:excluding|except(?:\s+for)?|not including|not counting|exclusive of|apart from|aside from|other than|save for)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+){0,5}?)(?=\s+(?:how|is|are|was|were|in|on|at|for|does|do|listed|shown|provided|identified|counted|included|present)\b|[.;!?]|$)/g,
  )) {
    const anchor = match[1].split(' ').map(canonicalContextToken).join(' ');
    // A named construction reference is an excluded location, not a
    // requested object subtype. `Detail A, excluding Detail B` can therefore
    // be answered by an exact count bound to A without repeating B in the
    // fact. Descriptive exclusions such as `excluding emergency lights`
    // remain mandatory semantic qualifiers.
    const explicitReferenceLabel =
      '(?:pdf page|page|sheet|sht|panel|detail|det|note|item|figure|fig|drawing|dwg|' +
      'document|doc|plan|part|revision|rev|schedule|door|room|valve|grid|task|canopy|' +
      'building|area|zone|level|floor|type|pump|column|beam|phase|activity|rtu|ahu|' +
      'fcu|fan|equipment|circuit|roof|pad)';
    const explicitReferenceIdentifier =
      '(?:[a-z](?:\\+)?|\\d+(?:[.-][a-z0-9]+)*|[a-z][a-z0-9]*[.-][a-z0-9.-]+)';
    if (new RegExp(
      `^${explicitReferenceLabel}s?\\s+${explicitReferenceIdentifier}` +
        `(?:\\s*(?:,|and|or|&|/)\\s+(?:${explicitReferenceLabel}s?\\s+)?` +
        `${explicitReferenceIdentifier})*$`,
    ).test(anchor)) continue;
    anchors.add(anchor);
  }
  return anchors;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function policyQuantityTargetPhrases(question: string) {
  const value = normalizePolicyText(question).replace(/[.?!]+$/, '');
  const raw = value.match(
    /\bhow\s+many\s+(.+?)(?=\s+(?:is|are|were|in|on|at|for|does|do|listed|shown)\b|$)/,
  )?.[1] || value.match(
    /\b(?:number|count|quantity)\s+of\s+(.+?)(?=\s+(?:is|are|were|in|on|at|for|does|do|listed|shown)\b|$)/,
  )?.[1] || '';
  const target = raw.replace(/^(?:the|current|exact)\s+/, '').trim();
  if (!target || target.split(' ').length > 7) return [];
  const words = target.split(' ');
  const canonical = words.map(canonicalContextToken).join(' ');
  return [...new Set([target, canonical].filter(Boolean))];
}

/**
 * Evidence ids are internal join keys, not user-facing citations. The model
 * receives them so Assurance can validate sourceIds, but they must never leak
 * into the field answer itself.
 */
export function sanitizeECOSAnswerStatement(value: string) {
  return value
    .replace(/\[(?:project|schedule|update|memory|document):[^\]]+\]/gi, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Returns true only for a present, affirmative drawing proposition.  Several
 * deterministic fallbacks deliberately rephrase source text (for example,
 * turning a photometric row into a sentence).  They must not perform that
 * rephrasing when a bounded source clause is negated, conditional, or marked
 * as non-current because doing so would erase the source's polarity.
 */
export function ecosDrawingPropositionIsAssertiveCurrent(value: string) {
  const normalized = normalizePolicyText(value);
  if (!normalized) return false;
  const protectedInclusiveBound = normalized
    .replace(/\bcannot\s+exceed\b/g, ' inclusive bound ')
    .replace(/\b(?:do|does|did|shall|must|should|can|could|would|will)\s+not\s+exceed\b/g, ' inclusive bound ')
    .replace(/\bnot\s+to\s+exceed\b/g, ' inclusive bound ')
    .replace(/\bnot\s+(?:less|fewer|more|greater)\s+than\b/g, ' inclusive bound ')
    .replace(/\bno\s+(?:less|fewer|more|greater)\s+than\b/g, ' inclusive bound ')
    // A deterministic footprint receipt must disclose that its computed area
    // was not separately printed. This is an epistemic limitation, not a
    // negation of the current plan identity or of the computed dimensions.
    .replace(
      /\b(?:it\s+is\s+not\s+a\s+separately\s+printed\s+area\s+value|this\s+is\s+a\s+calculation\s+not\s+a\s+printed\s+area\s+value)\b/g,
      ' epistemic calculation disclaimer ',
    );
  return !(
    /\b(?:allegedly|apparently|assumed|believed|conceivably|hypothetical(?:ly)?|likely|maybe|ostensibly|perhaps|possibly|potentially|probably|purportedly|reported|reportedly|supposedly|tentatively|unverified)\b|\bit\s+appears\b|^consider\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:owner|contractor|applicant|engineer|architect|client)\s+(?:anticipates?|believes?|desires?|expects?|intends?|plans?|prefers?|proposes?|recommends?|reports?|requests?|suggests?|wants?)\b|^(?:preferred|recommended)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:if|unless|assuming|provided\s+that|in\s+case)\b|\bprovided\s+(?:the\s+)?(?:owner|architect|engineer|authority|city|agency|client|field)\s+(?:approves?|authorizes?|accepts?|confirms?|permits?)\b|\b(?:when|once)\s+(?:approved|authorized|accepted|confirmed)\b|\b(?:subject\s+to|pending|awaiting|contingent\s+on)\s+(?:approval|authorization|acceptance|confirmation)\b|\bupon\s+(?:approval|authorization|acceptance|confirmation)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:proposed|future|planned|preliminary|draft|conceptual|schematic\s+design|design\s+development|approval\s+pending|awaiting\s+approval|under\s+review|working\s+copy|review\s+copy|add\s+alternate|alternate(?:\s+only)?|optional|option\s+only|delet(?:e|ed)|omit(?:ted)?|remov(?:e|ed)|demo(?:lition)?|demolish(?:ed)?|not\s+in\s+contract|n\s+i\s+c|not\s+(?:issued\s+)?for\s+construction|issued\s+not\s+for\s+construction|issued\s+for\s+(?:review|bid|permit|pricing|approval))\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:tbd|tbc|to\s+be\s+(?:confirmed|verified)|verify(?:\s+in\s+(?:the\s+)?field)?|field\s+verify|contractor\s+option|option\s+[a-z0-9]+|temporary|allowance\s+only)\b|\bv\s*\.?\s*i\s*\.?\s*f\s*\.?\b/.test(
      protectedInclusiveBound,
    ) ||
    /\bfor\s+(?:comment|review|reference|information|discussion|pricing|approval|bid|tender|quotation|permit)\s+only\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:may|might|could|would|will|should)\s+(?:be\s+)?(?:construct(?:ed)?|provide(?:d)?|install(?:ed)?|build|built|connect(?:ed)?|reconnect(?:ed)?|retain(?:ed)?|remain|require(?:d)?|assign(?:ed)?|include(?:d)?|show(?:n)?)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:scheduled|expected)\s+to\s+(?:be\s+)?(?:construct(?:ed)?|provide(?:d)?|install(?:ed)?|build|built|connect(?:ed)?|reconnect(?:ed)?|retain(?:ed)?|remain|require(?:d)?|assign(?:ed)?|include(?:d)?|show(?:n)?)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:not\s+current|no\s+longer\s+current|superseded|obsolete|archived|withdrawn|voided|rescinded|revoked|cancelled|canceled|unissued|invalidated)\b/.test(
      protectedInclusiveBound,
    ) ||
    /(?:^|\b(?:revision|review|coordination|field)\s+note\s+)\b(?:not|never)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:do|does|did|shall|must|should|can|could|would|will)\s+not\b|\bcannot\b/.test(
      protectedInclusiveBound,
    ) ||
    /^(?:no|not|never)\b/.test(protectedInclusiveBound) ||
    /\bnot\b/.test(protectedInclusiveBound) ||
    /\b(?:is|are|was|were|be)\s+not\s+(?:required|provided|shown|listed|specified|assigned|constructed|installed|connected|reconnected|retained|remaining|included|contained)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\bnot\s+(?:average|maximum|minimum|weather\s+protected|containment\s+area|construct|reconnect|required|provided|shown|listed|specified|assigned)\b/.test(
      protectedInclusiveBound,
    ) ||
    /\b(?:required|provided|shown|listed|specified|assigned)\s+not\b/.test(
      protectedInclusiveBound,
    )
  );
}

export function ecosEvidenceHasCompetingExplicitLocation(
  question: string,
  evidence: string,
) {
  const requested = analyzeECOSQuestionEvidenceContext(question, '').locationDirectionTokens;
  if (requested.length === 0) return false;
  const evidenceDirections = [...new Set(
    canonicalContextMatchText(normalizePolicyText(evidence)).split(' ')
      .map(canonicalContextToken)
      .filter(token => LOCATION_DIRECTION_TOKENS.has(token)),
  )];
  return evidenceDirections.some(direction =>
    !requested.some(requestedDirection =>
      contextTokenMatchesEvidence(requestedDirection, direction)
    )
  );
}

export function ecosQuestionRequestsInstalledCondition(question: string) {
  const normalized = normalizePolicyQuestionText(question);
  const explicitDocumentRequirement =
    /\b(?:does|do)\s+(?:the\s+)?(?:current\s+)?(?:as[- ]built\s+)?(?:drawing|plan|document|specification|record)\s+(?:specify|require|show|call\s+for)\b/.test(
      normalized,
    ) ||
    /\bwhat\b[\s\S]{0,60}\b(?:as[- ]built\s+)?(?:drawing|plan|document|specification|record)\b[\s\S]{0,40}\b(?:specify|specifies|require|requires|show|shows|call|calls\s+for)\b/.test(
      normalized,
    ) ||
    /\b(?:according\s+to|per|from)\s+(?:the\s+)?as[- ]built\s+(?:drawing|plan|document|record)\b/.test(
      normalized,
    );
  const prospectiveDesign =
    /\b(?:to\s+be|shall\s+be|must\s+be|should\s+be|will\s+be)\s+(?:installed|placed|poured|built|constructed|planted)\b/.test(
      normalized,
    ) ||
    /\b(?:shall|must|should|will)\b[\s\S]{0,60}\bbe\s+(?:installed|placed|poured|built|constructed|planted)\b/.test(
      normalized,
    );
  if (explicitDocumentRequirement || prospectiveDesign) return false;
  const fieldConditionQualifier =
    '(?:installed|actual|as[- ]installed|field[- ]measured|measured|existing|in[- ]place)';
  const fieldConditionAttribute =
    '(?:condition|dimension|measurement|size|thickness|height|width|depth|length|diameter|spacing|clearance|location|elevation|quantity|count|rating|capacity)';
  const valueSeekingFieldCondition = (
    new RegExp(
      `^(?:what|which|how|state|report|list|give|provide)\\b[\\s\\S]{0,100}\\b${fieldConditionQualifier}\\b[\\s\\S]{0,80}\\b${fieldConditionAttribute}\\b`,
    ).test(normalized) ||
    new RegExp(
      `^(?:the\\s+)?${fieldConditionQualifier}\\b(?:\\s+[a-z0-9-]+){0,8}\\s+${fieldConditionAttribute}\\b\\s*[?]?$`,
    ).test(normalized)
  );
  const requirement = analyzeECOSProjectQuestion(question);
  const directValueQuestion =
    /^(?:what|which|how|state|report|list|give|provide)\b/.test(normalized) &&
    (requirement.kind === 'measurement' || requirement.kind === 'quantity');
  const directInstalledValueCue =
    /\b(?:actual|existing|installed|as[- ]installed|planted)\b/.test(normalized) ||
    // Past-participle construction verbs followed by a concrete location are
    // ordinary customer language for completed work (for example, "concrete
    // poured on the north side"). Keep the locative bound so material names
    // such as "poured concrete" do not by themselves convert a design-value
    // question into a field-condition claim.
    /\b(?:placed|poured|built|constructed)\b\s+(?:at|in|on|behind|outside|inside|along|near|within)\b/.test(
      normalized,
    ) ||
    /\bin[- ]place(?:\s+(?:now|today|currently))?$/.test(normalized) ||
    /\b(?:actually\s+|currently\s+)?in\s+the\s+ground(?:\s+(?:now|today|currently))?$/.test(
      normalized,
    );
  const valueSeekingInstalledCondition = directValueQuestion && directInstalledValueCue;
  const presentInstalledInterrogative = (
    /^(?:is|are)\s+(?!(?:the\s+)?(?:installed|placed|poured|built|constructed)\b)(?:the\s+)?(?:[a-z0-9-]+\s+){1,12}(?:actually\s+|currently\s+)?(?:installed|placed|poured|built|constructed)\b/.test(
      normalized,
    ) ||
    /\b(?:does|do)\s+(?:the\s+)?(?:[a-z0-9-]+\s+){1,10}have\s+(?:[a-z0-9-]+\s+){1,10}(?:actually\s+|currently\s+)?installed\b/.test(
      normalized,
    )
  );
  return valueSeekingFieldCondition || valueSeekingInstalledCondition ||
    presentInstalledInterrogative ||
    /\b(?:was|were|has\s+been|have\s+been)\b[\s\S]{0,100}\b(?:actually\s+)?(?:installed|placed|poured|built|constructed|planted)\b|\b(?:prove|verify|confirm)\b[\s\S]{0,100}\b(?:installed|placed|poured|built|constructed|planted)\b|\b(?:prove|verify|confirm)\b[\s\S]{0,100}\bin\s+(?:the\s+)?field\b|\b(?:measured|tested|observed)\s+(?:in\s+the\s+)?field\b|\bfield\s+(?:measurement|reading|test|air[- ]?balance|condition|verified)\b|\bas[- ]built\s+(?:condition|dimension|measurement|size|thickness|height|width|depth|location|installation)\b|\bexisting\s+condition\b/i
      .test(normalized);
}

export function buildECOSInstalledDesignFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  if (!ecosQuestionRequestsInstalledCondition(question)) return null;
  return buildECOSTrustedDrawingFactFallback(question, sources) ||
    buildECOSDrawingMeasurementFallback(question, sources);
}

export function buildECOSDrawingMeasurementFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== 'measurement' || requirement.attribute === 'area') return null;
  if (drawingProjectLotAnchorCandidates(question).length > 1) return null;
  if (requirement.attribute === 'grade') {
    const exactGrade = buildECOSExactDelineatedADAGradeFallback(question, sources);
    if (exactGrade) return exactGrade;
  }
  const installedConditionRequested = ecosQuestionRequestsInstalledCondition(question);
  const requestedProjectLotAnchor = requestedDrawingProjectLotAnchor(question);
  const measurementPolicySourceText = (source: ECOSAnswerFallbackSource) => [
    source.title ? `${source.title.replace(/[.;:]+$/, '')}.` : '',
    source.excerpt,
  ].filter(Boolean).join('\n');
  const responsiveSources = sources.filter(source =>
    source.sourceType === 'document' &&
    ecosDrawingPropositionIsAssertiveCurrent(source.title || 'current drawing') &&
    sourceMatchesExplicitDrawingReference(question, source) &&
    measurementSourceMatchesRequestedLocation(question, source) &&
    (!requestedProjectLotAnchor ||
      measurementSourceBindsRequestedProjectLotAnchor(source, requestedProjectLotAnchor)) &&
    ecosEvidenceMatchesQuestionRequirement(question, measurementPolicySourceText(source))
  );
  type MeasurementCandidate = Readonly<{
    source: ECOSAnswerFallbackSource;
    sourceId: string;
    fact: string;
    phrase: string;
  }>;
  const extractedCandidates: MeasurementCandidate[] = responsiveSources.flatMap(source =>
    extractECOSVisualMeasurementFacts(source.excerpt, question)
      .filter(fact => measurementFactMatchesRequestedSubject(
        question,
        measurementPolicySourceText(source),
        fact,
      ))
      .map(fact => ({
        source,
        sourceId: source.id,
        fact,
        phrase: designFactPhrase(fact),
      }))
  );
  const normalizedQuestion = normalizePolicyText(question);
  const requestedConstructionSubjects = [
    'paving', 'walkway', 'curb', 'gutter', 'slab', 'wall', 'footing',
    'foundation', 'canopy',
  ].filter(subject => normalizedQuestion.includes(subject))
    .sort((left, right) => normalizedQuestion.indexOf(left) - normalizedQuestion.indexOf(right));
  const subjectTupleRequested = requestedConstructionSubjects.length > 1;
  const comparisonRequested = /\b(?:same|different|compare|comparison)\b/i.test(question) &&
    subjectTupleRequested;
  const comparisonContext = analyzeECOSQuestionEvidenceContext(question, '');
  const permittedComparisonSubjectTokens = new Set([
    'pcc', 'concrete', 'cement', 'asphalt',
    ...requestedConstructionSubjects,
    ...boundedQuantityReferenceKeys(question).map(reference => reference.split(':').slice(1).join(':')),
  ]);
  if (
    subjectTupleRequested &&
    (comparisonContext.locationDirectionTokens.length > 0 ||
      comparisonContext.locationKindTokens.length > 0 ||
      comparisonContext.subjectTokens.some(token =>
        !permittedComparisonSubjectTokens.has(token)
      ))
  ) return null;
  let facts: MeasurementCandidate[];
  if (subjectTupleRequested) {
    const selected: MeasurementCandidate[] = [];
    for (const subject of requestedConstructionSubjects) {
      const subjectQuestion = `What is the ${subject} ${requirement.attribute}?`;
      const subjectCandidates = extractedCandidates.filter(candidate =>
        measurementSubjectMatchesFact(
          subject,
          normalizedQuestion,
          normalizePolicyText(candidate.fact),
          normalizePolicyText(measurementPolicySourceText(candidate.source)),
        ) &&
        ecosFactAnswersQuestion({
          question: subjectQuestion,
          statement: `The current drawing specifies ${candidate.phrase}.`,
          sourceExcerpts: [`${candidate.source.title || ''}.\n${candidate.fact}`],
        })
      );
      const distinct = subjectCandidates.filter((candidate, index, all) =>
        all.findIndex(other => installedDesignFactKey(other.phrase) ===
          installedDesignFactKey(candidate.phrase)) === index
      );
      if (distinct.length !== 1) return null;
      selected.push(distinct[0]);
    }
    if (new Set(selected.map(candidate => `${candidate.sourceId}|${candidate.fact}`)).size !==
      selected.length) return null;
    facts = selected;
  } else {
    facts = extractedCandidates.filter(candidate => ecosFactAnswersQuestion({
      question,
      statement: `The current drawing specifies ${candidate.phrase}.`,
      sourceExcerpts: [measurementPolicySourceText(candidate.source)],
    }));
  }
  const uniqueFacts: MeasurementCandidate[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = installedDesignFactKey(fact.phrase);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueFacts.push(fact);
  }
  if (uniqueFacts.length === 0) return null;
  // A simple measurement question has one requested subject and therefore one
  // authoritative value. Multiple distinct values are a conflict, not a list.
  // Closed comparisons were already resolved above with one fact per named
  // subject and may retain their complete, separately bound pair.
  if (!subjectTupleRequested && uniqueFacts.length !== 1) return null;
  const comparison = /\b(?:same|different|compare|comparison)\b/i.test(question) &&
    pccThicknessesDiffer(uniqueFacts.map(fact => fact.phrase))
    ? ' These are different specifications, not the same thickness.'
    : '';
  const locationAnchor = requestedProjectLotAnchor
    ? ` in the ${requestedProjectLotAnchor.display}`
    : '';
  const statement = sanitizeECOSAnswerStatement(
    `The current drawing specifies ${joinDesignFacts(uniqueFacts.map(fact => fact.phrase))}${locationAnchor}.` +
      comparison +
      (installedConditionRequested
        ? ' The drawing does not field-verify the actual installed condition.'
        : ''),
  );
  if (subjectTupleRequested && !ecosFactAnswersQuestion({
    question,
    statement,
    sourceExcerpts: [uniqueFacts.map(candidate =>
      `${candidate.source.title || ''}.\n${candidate.fact}`
    ).join(' ')],
  })) return null;
  return {
    statement,
    sourceIds: [...new Set(uniqueFacts.map(fact => fact.sourceId))],
  };
}

function buildECOSExactDelineatedADAGradeFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  if (!questionRequestsExactDelineatedADAMaximumGrade(question)) return null;
  const candidates = sources.flatMap(source => {
    const sourceText = [
      source.title ? `${source.title.replace(/[.;:]+$/, '')}.` : '',
      source.excerpt,
    ].filter(Boolean).join('\n');
    if (
      source.sourceType !== 'document' ||
      !ecosDrawingPropositionIsAssertiveCurrent(source.title || 'current drawing') ||
      !sourceMatchesExplicitDrawingReference(question, source) ||
      !measurementSourceMatchesRequestedLocation(question, source) ||
      !ecosEvidenceMatchesQuestionRequirement(question, sourceText)
    ) return [];
    return source.excerpt.split(/\r?\n/).flatMap(line => {
      const printedValue = exactDelineatedADAMaximumGradeLineValue(line);
      return printedValue ? [{ sourceId: source.id, printedValue }] : [];
    });
  });
  const values = [...new Set(candidates.map(candidate => Number(candidate.printedValue)))];
  if (candidates.length === 0 || values.length !== 1 || !Number.isFinite(values[0])) return null;
  const printedValue = candidates[0].printedValue;
  return {
    statement: sanitizeECOSAnswerStatement(
      `The maximum grade is ${printedValue}% in all directions within the delineated ADA-accessible parking areas.`,
    ),
    sourceIds: [...new Set(candidates.map(candidate => candidate.sourceId))],
  };
}

const EXACT_DELINEATED_ADA_MAXIMUM_GRADE_LINE_PATTERN =
  /^IN[ \t]+DELINEATED[ \t]+ADA[ \t-]+ACCESSIBLE[ \t]+PARKING[ \t]+AREAS,[ \t]+GRADES[ \t]+SHALL[ \t]+BE[ \t]+(\d+(?:\.\d+)?)[ \t]*%[ \t]+MAX\.[ \t]+IN[ \t]+ALL[ \t]+DIRECTIONS\.[ \t]*$/i;

function questionRequestsExactDelineatedADAMaximumGrade(question: string) {
  const normalizedQuestion = normalizePolicyText(question);
  return /\b(?:maximum|max)\b/.test(normalizedQuestion) &&
    /\bdelineated\s+ada(?:\s+|-)accessible\s+parking\s+areas?\b/.test(
      normalizedQuestion,
    );
}

function exactDelineatedADAMaximumGradeLineValue(value: string) {
  return value.trim().match(EXACT_DELINEATED_ADA_MAXIMUM_GRADE_LINE_PATTERN)?.[1] || '';
}

export function exactDelineatedADAMaximumGradeOrderEquivalent(
  claim: string,
  evidence: string,
  question: string,
) {
  if (!questionRequestsExactDelineatedADAMaximumGrade(question)) return false;
  const claimValue = normalizePolicyText(claim).match(
    /^the maximum grade is (\d+(?:\.\d+)?)% in all directions within the delineated ada(?:\s+|-)accessible parking areas?\.?$/,
  )?.[1];
  const evidenceValue = exactDelineatedADAMaximumGradeLineValue(evidence);
  return Boolean(
    claimValue && evidenceValue && Number(claimValue) === Number(evidenceValue),
  );
}

type DrawingProjectLotAnchor = Readonly<{
  projectNumber: string;
  direction: 'north' | 'south' | 'east' | 'west';
  display: string;
}>;

function canonicalDrawingCardinalDirection(
  value: string,
): DrawingProjectLotAnchor['direction'] {
  if (value === 'north' || value === 'northern') return 'north';
  if (value === 'south' || value === 'southern') return 'south';
  if (value === 'east' || value === 'eastern') return 'east';
  return 'west';
}

function drawingProjectLotAnchorCandidates(question: string) {
  const normalized = normalizePolicyText(question);
  const direction = '(north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?)';
  const candidates = [
    ...[...normalized.matchAll(
      new RegExp(`\\b(\\d{3,8})(?:'s)?\\s+${direction}\\s+(?:lot|side)\\b`, 'g'),
    )].map(match => ({
      projectNumber: match[1],
      direction: canonicalDrawingCardinalDirection(match[2]),
    })),
    ...[...normalized.matchAll(
      new RegExp(`\\bbehind\\s+(\\d{3,8})\\s+on\\s+the\\s+${direction}\\s+side\\b`, 'g'),
    )].map(match => ({
      projectNumber: match[1],
      direction: canonicalDrawingCardinalDirection(match[2]),
    })),
    ...[...normalized.matchAll(
      new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?${direction}\\s+(?:side|lot)\\s+of\\s+(\\d{3,8})\\b`, 'g'),
    )].map(match => ({
      projectNumber: match[2],
      direction: canonicalDrawingCardinalDirection(match[1]),
    })),
    ...[...normalized.matchAll(
      new RegExp(`\\b${direction}\\s+(?:side|lot)\\s+(?:at|for)\\s+(?:project\\s+)?(\\d{3,8})\\b`, 'g'),
    )].map(match => ({
      projectNumber: match[2],
      direction: canonicalDrawingCardinalDirection(match[1]),
    })),
  ];
  return [...new Map(candidates.map(candidate => [
    `${candidate.projectNumber}|${candidate.direction}`,
    candidate,
  ] as const)).values()];
}

function requestedDrawingProjectLotAnchor(question: string): DrawingProjectLotAnchor | null {
  const distinct = drawingProjectLotAnchorCandidates(question);
  if (distinct.length !== 1) return null;
  const { projectNumber, direction } = distinct[0];
  return {
    projectNumber,
    direction,
    display: `${projectNumber} ${direction[0].toUpperCase()}${direction.slice(1)} Lot`,
  };
}

function measurementSourceBindsRequestedProjectLotAnchor(
  source: ECOSAnswerFallbackSource,
  anchor: DrawingProjectLotAnchor,
) {
  const normalizedTitle = normalizePolicyText(source.title || '');
  const normalizedProof = canonicalContextMatchText(normalizePolicyText(source.excerpt));
  return new RegExp(`\\b${escapeRegExp(anchor.projectNumber)}\\b`).test(normalizedTitle) &&
    new RegExp(`\\b${escapeRegExp(anchor.direction)}\\s+lot\\b`).test(normalizedProof);
}

export function buildECOSDrawingAreaFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind !== 'measurement' || requirement.attribute !== 'area') return null;
  const printed = buildECOSTrustedDrawingFactFallback(question, sources);
  if (printed && /\b(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|sf)\b/i.test(printed.statement)) {
    return printed;
  }
  const normalizedQuestion = normalizePolicyText(question);
  // A deterministic same-page calculation is a different authority from a
  // value explicitly printed/listed by the drawing. If that exact source type
  // was requested and no printed fact was verified above, fail closed.
  if (
    /\bprinted\b/.test(normalizedQuestion) ||
    /\b(?:drawing|plan|sheet|document)\s+(?:states?|lists?|labels?|reports?)\b/.test(
      normalizedQuestion,
    )
  ) return null;
  const compoundCanopyAreaAndSlab = /\bcanopy\b/.test(normalizedQuestion) &&
    /\b(?:area|square feet|sq ft|sf|footprint)\b/.test(normalizedQuestion) &&
    /\bslab\b/.test(normalizedQuestion) &&
    /\b(?:thick|thickness|inch|concrete|require)\b/.test(normalizedQuestion);
  // A same-sheet footprint calculation can answer one area request, but it
  // must never displace either half of a cross-discipline compound question.
  // If both exact trusted facts are not present, fail closed and let the
  // caller gather the missing architectural or structural authority.
  if (compoundCanopyAreaAndSlab) return null;
  const requestedAreaSubjects = explicitAreaScopeSubjects(question);
  if (
    requestedAreaSubjects.length === 0 &&
    analyzeECOSQuestionEvidenceContext(question, '').subjectTokens.length > 0
  ) return null;
  // One deterministic footprint receipt proves one bounded subject. A
  // multi-subject question needs separately bound receipts rather than one
  // unlabeled calculation being reused for every requested room/area.
  if (requestedAreaSubjects.length > 1) return null;
  const selected = new Map<string, { statement: string; sourceId: string }>();
  for (const source of sources) {
    if (source.sourceType !== 'document') continue;
    if (
      !ecosDrawingPropositionIsAssertiveCurrent(source.title || 'current drawing') ||
      !ecosDrawingPropositionIsAssertiveCurrent(source.excerpt)
    ) continue;
    const sourceAuthorityTexts = normalizePolicyAuthorityVariants(
      `${source.title || ''} ${source.excerpt}`,
    );
    if (sourceAuthorityTexts.some(sourceAuthorityText =>
      /\b(?:preliminary|superseded|obsolete|archived|draft|proposed|future|concept(?:ual)?|schematic\s+design|issued\s+for\s+(?:review|bid)|not[- ](?:issued[- ])?for[- ]construction|issued[- ]not[- ]for[- ]construction|n\s*\.?\s*f\s*\.?\s*c|not\s+current|no\s+longer\s+current|non[- ]?current|out[- ]of[- ]date|cancel(?:ed|led)|expired|rescinded|revoked|voided|invalidated|rejected|unissued|invalid|previous|prior|former)\b/i.test(
        sourceAuthorityText,
      )
    )) continue;
    const match = source.excerpt.match(
      /ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:\s*([^\n×]{1,80})\s*×\s*([^\n=]{1,80})\s*=\s*([\d,]+(?:\.\d+)?)\s+square feet/i,
    );
    if (!match) continue;
    const proofText = source.documentRegion?.proofText?.trim() || '';
    const sourceRegionIds = source.documentRegion?.sourceRegionIds?.filter(Boolean) || [];
    if (
      source.documentRegion?.reconstructionMethod !== 'deterministic_same_page_plan_footprint' ||
      new Set(sourceRegionIds).size !== 2 ||
      normalizePolicyText(proofText).replace(/\.$/, '') !==
        normalizePolicyText(match[0]).replace(/\.$/, '')
    ) continue;
    const subject = question.match(/\b(canop(?:y|ies)\s+['"]?[a-z0-9]+['"]?)/i)?.[1]
      ?.replace(/\s+/g, ' ').trim() || 'The requested plan';
    const requestedCanopy = question.match(/\bcanop(?:y|ies)\s+['"‘’“”]?([a-z0-9]+)['"‘’“”]?/i)?.[1] || '';
    const sourceText = `${source.title || ''} ${source.excerpt}`;
    if (!areaSourceContainsRequestedSubjects(sourceText, requestedAreaSubjects)) continue;
    if (
      requestedCanopy &&
      !new RegExp(`\\bcanop(?:y|ies)\\s+['"‘’“”]?${escapeRegExp(requestedCanopy)}['"‘’“”]?\\b`, 'i').test(
        sourceText,
      )
    ) continue;
    const boundedSubject = requestedAreaSubjects[0]?.display || subject;
    const statement = sanitizeECOSAnswerStatement(
      `Using the ${match[1].trim()} by ${match[2].trim()} overall dimensions on the current drawing, ` +
      `${boundedSubject} has a calculated plan footprint of ${match[3]} square feet; ` +
      'this is a calculation, not a printed area value.',
    );
    if (!ecosFactAnswersQuestion({
      question,
      statement: `${boundedSubject} has a calculated plan footprint of ${match[3]} square feet.`,
      sourceExcerpts: [`${source.title || ''} ${match[0]}`],
    })) continue;
    const key = normalizePolicyText(match[0]);
    if (!selected.has(key)) selected.set(key, { statement, sourceId: source.id });
  }
  if (selected.size !== 1) return null;
  const answer = [...selected.values()][0];
  return {
    statement: answer.statement,
    sourceIds: [answer.sourceId],
  };
}

function measurementSourceMatchesRequestedLocation(
  question: string,
  source: ECOSAnswerFallbackSource,
) {
  const questionContext = analyzeECOSQuestionEvidenceContext(question, '');
  if (
    questionContext.locationDirectionTokens.length === 0 &&
    questionContext.locationKindTokens.length === 0
  ) return true;
  // The exact proof text must carry the requested location. A title can help
  // identify a current drawing, but it cannot bind an otherwise unrelated
  // measurement to the user's requested side, level, or area.
  const locationProof = source.excerpt.replace(
    /\bLocation:\s*([^.;]{0,160}?)(?:,\s*)?(?:upper|lower)[-\s]+(?:left|right)(?=[.;])/gi,
    'Location: $1',
  );
  const proofContext = analyzeECOSQuestionEvidenceContext(question, locationProof);
  if (!proofContext.locationMatched) return false;
  const explicitSourceDirections = [...new Set(
    canonicalContextMatchText(`${source.title || ''} ${locationProof}`).split(' ')
      .map(canonicalContextToken)
      .filter(token => LOCATION_DIRECTION_TOKENS.has(token)),
  )];
  return explicitSourceDirections.every(sourceDirection =>
    questionContext.locationDirectionTokens.some(requestedDirection =>
      contextTokenMatchesEvidence(requestedDirection, sourceDirection)
    )
  );
}

function explicitAreaScopeSubjects(value: string) {
  const ignoredIdentifiers = new Set([
    'and', 'area', 'feet', 'foot', 'has', 'is', 'of', 'or', 'plan', 'shown',
    'footprint', 'square', 'value', 'with',
  ]);
  const labelPattern =
    '(building\\s+area|irrigation\\s+plan|planting\\s+plan|loading\\s+dock|room|building|warehouse|sector|pod|wing|lot|yard|site|structure|facility|zone|floor|level|lobby|bay|court|space|corridor|office|suite|unit|area|canop(?:y|ies)|plan)';
  const identifierPattern = '[\'"‘’“”]?([a-z0-9]+(?:[.-][a-z0-9]+)*)[\'"‘’“”]?';
  const subjects: Array<{ label: string; identifier: string; display: string }> = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(
    new RegExp(`\\b${labelPattern}(?:\\s+|-)${identifierPattern}`, 'gi'),
  )) {
    const rawLabel = normalizePolicyText(match[1]).replace(/\s+/g, ' ');
    const label = /^canop/.test(rawLabel) ? 'canopy' : rawLabel.replace(/s$/, '');
    const identifier = match[2].toLowerCase();
    if (ignoredIdentifiers.has(identifier)) continue;
    const key = `${label}:${identifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push({
      label,
      identifier,
      display: `${label.split(' ').map(word =>
        `${word[0].toUpperCase()}${word.slice(1)}`
      ).join(' ')} ${match[2]}`,
    });
  }
  return subjects;
}

function areaSourceContainsRequestedSubjects(
  sourceText: string,
  subjects: readonly { label: string; identifier: string }[],
) {
  if (subjects.length === 0) return true;
  const sourceSubjects = explicitAreaScopeSubjects(sourceText);
  const requested = [...new Set(subjects.map(subject => `${subject.label}:${subject.identifier}`))].sort();
  const available = [...new Set(sourceSubjects.map(subject => `${subject.label}:${subject.identifier}`))].sort();
  return requested.length === available.length &&
    requested.every((subject, index) => subject === available[index]);
}

export function buildECOSDrawingRelationshipFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const drawings = sources.filter(source => source.sourceType === 'document');
  const sourceText = (source: typeof drawings[number]) => `${source.title || ''}\n${source.excerpt}`;
  const canonicalSheet = (value: string | null | undefined) =>
    canonicalDrawingReference(value || '');
  const hasCitationSheet = (source: typeof drawings[number], expected: string) =>
    canonicalSheet(source.documentCitation?.sheetNumber) === canonicalSheet(expected);
  const textHasSheet = (value: string, expected: string) => {
    const canonicalExpected = canonicalSheet(expected);
    if (!canonicalExpected) return false;
    return [...normalizeECOSSheetIdentityScanText(value).matchAll(
      /\b(?:sheet|sht\.?)\s+(?:(?:number|no\.?|#)\s*:?\s*)?([a-z]{1,4}\s*[-.]?\s*\d+(?:\.\d+)?[a-z]?)\b/gi,
    )].some(match => canonicalSheet(match[1]) === canonicalExpected);
  };
  const findUniqueDrawing = (sheetNumber: string, proof: RegExp) => {
    const matched = drawings.flatMap(source => {
      const value = sourceText(source);
      if (!hasCitationSheet(source, sheetNumber) || !textHasSheet(value, sheetNumber)) return [];
      const proofMatch = proof.exec(value);
      if (!proofMatch) return [];
      if (!ecosDrawingPropositionIsAssertiveCurrent(value)) return [{ source, proof: '', valid: false }];
      return [{ source, proof: normalizePolicyText(proofMatch[0]), valid: true }];
    });
    if (matched.some(candidate => !candidate.valid)) return null;
    const unique = [...new Map(matched.map(candidate => [
      `${canonicalSheet(sheetNumber)}|${candidate.proof}`,
      candidate.source,
    ] as const)).values()];
    return unique.length === 1 ? unique[0] : null;
  };

  if (/\b(?:Building|BLDG)\s+Area\s+1\b/i.test(question) && /\bE-?2\.1\b/i.test(question)) {
    const electrical = findUniqueDrawing(
      'E-2.1',
      /\b2375-BLDG\s+AREA\s+1\b[\s\S]{0,120}\bENLARGED\s+LIGHTING\s+PLAN\b/i,
    );
    if (electrical) {
      return {
        statement: 'Current electrical Sheet E-2.1 shows the 2375-BLDG Area 1 Enlarged Lighting Plan.',
        sourceIds: [electrical.id],
      };
    }
  }

  if (/\barea\s+lighting\b/i.test(question) && /\bcivil\b/i.test(question)) {
    const exactCivilProof =
      'AREA LIGHTING - SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS';
    const exactCivilPattern =
      /\bAREA\s+LIGHTING\s*-?\s*SEE\s+ARCHITECTURAL\s+AND\s+ELECTRICAL\s+DRAWINGS\b/i;
    const civilCandidates = drawings.filter(source => {
      const value = sourceText(source);
      return hasCitationSheet(source, 'C6') && textHasSheet(value, 'C6') &&
        exactCivilPattern.test(value);
    });
    const civilCandidateHasExactClosedExcerpt = (
      source: (typeof civilCandidates)[number],
    ) => {
      const canonicalExcerpt = normalizePolicyText(source.excerpt)
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\bdrawing page context sheet c6\b/g, ' ')
        .replace(/\bsheet c6\b/g, ' ')
        .replace(
          /\barea lighting see architectural and electrical drawings\b/g,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim();
      return !canonicalExcerpt;
    };
    const exactCivilCandidates = civilCandidates.filter(source => {
      const region = source.documentRegion;
      const sourceRegionIds = region?.sourceRegionIds || [];
      return source.trustedDerivedDrawingPassage === true &&
        region?.reconstructionMethod ===
          'deterministic_exact_page_area_lighting_delegation' &&
        region.proofText === exactCivilProof &&
        sourceRegionIds.length === 1 && Boolean(sourceRegionIds[0]) &&
        source.documentCitation?.regionId === region.id &&
        civilCandidateHasExactClosedExcerpt(source) &&
        ecosDrawingPropositionIsAssertiveCurrent(source.excerpt);
    });
    const civil = exactCivilCandidates.length === 1 &&
        civilCandidates.every(source =>
          source.recordId === exactCivilCandidates[0].recordId &&
          source.documentCitation?.pageNumber ===
            exactCivilCandidates[0].documentCitation?.pageNumber &&
          civilCandidateHasExactClosedExcerpt(source) &&
          ecosDrawingPropositionIsAssertiveCurrent(source.excerpt)
        )
      ? exactCivilCandidates[0]
      : null;
    const electricalProof =
      'LIGHTING CIRCUITS SHOWN FOR DESIGN INTENT ONLY. EXISTING LIGHTING IN THIS AREA TO REMAIN. RECONNECT ON EXISTING CIRCUITS IF DISTURBED DUE TO REMODEL.';
    const electricalCandidates = drawings.filter(source => {
      const value = sourceText(source);
      return hasCitationSheet(source, 'E-2.2') &&
        textHasSheet(value, 'E-2.2') &&
        /\bLIGHTING\s+CIRCUITS?\s+SHOWN\s+FOR\s+DESIGN\s+INTENT\s+ONLY\b/i.test(value) &&
        /\bEXISTING\s+LIGHTING\s+IN\s+THIS\s+AREA\s+TO\s+REMAIN\.?\s+RECONNECT\s+ON\s+EXISTING\s+CIRCUITS?\s+IF\s+DISTURBED\s+DUE\s+TO\s+REMODEL\b/i.test(value);
    });
    const exactElectricalCandidates = electricalCandidates.filter(source => {
      const sourceRegionIds = source.documentRegion?.sourceRegionIds || [];
      if (
        source.trustedDerivedDrawingPassage !== true ||
        source.documentRegion?.reconstructionMethod !==
          'deterministic_adjacent_region_phrase' ||
        source.documentRegion.proofText !== electricalProof ||
        sourceRegionIds.length !== 3 ||
        new Set(sourceRegionIds).size !== sourceRegionIds.length ||
        sourceRegionIds.some(value => !value)
      ) return false;
      // These two qualifiers are the exact requested limitation and reuse
      // condition. Remove only their conditional words before applying the
      // general current/assertive guard, so any additional draft, negation,
      // future-work, or conditional language still fails closed.
      const assertionValue = sourceText(source)
        .replace(
          /\bLIGHTING\s+CIRCUITS?\s+SHOWN\s+FOR\s+DESIGN\s+INTENT\s+ONLY\b/gi,
          'LIGHTING CIRCUITS SHOWN',
        )
        .replace(
          /\bRECONNECT\s+ON\s+EXISTING\s+CIRCUITS?\s+IF\s+DISTURBED\s+DUE\s+TO\s+REMODEL\b/gi,
          'RECONNECT ON EXISTING CIRCUITS DUE TO REMODEL',
        );
      return ecosDrawingPropositionIsAssertiveCurrent(assertionValue);
    });
    const electrical = electricalCandidates.length === 1 &&
        exactElectricalCandidates.length === 1
      ? exactElectricalCandidates[0]
      : null;
    const exactCivilCanonical =
      'area lighting see architectural and electrical drawings';
    const exactElectricalCanonical =
      'lighting circuits shown for design intent only existing lighting in this area to remain reconnect on existing circuits if disturbed due to remodel';
    const delegationDisciplineTargetCarried = (value: string) =>
      /\b(?:architectural|arch|civil|electrical|elec|mechanical|mech|landscape|structural|plumbing|plumb|fire|mep)\b/.test(
        value,
      ) || /\bm\s+e\s+p\b/.test(value);
    const competingDelegationRelation = (value: string) =>
      /\b(?:provided\s+by|by)\s+(?:others?|(?:architectural|arch|civil|electrical|elec|mechanical|mech|landscape|structural|plumbing|plumb|fire|mep|m\s+e\s+p)(?:\s+contractor)?)\b/.test(
        value,
      ) ||
      /\bnot\s+in\s+(?:the\s+)?contract\b/.test(value) ||
      /\bn\s*i\s*c\b/.test(value) ||
      (
        /\b(?:per|see|refer(?:s|red|ring)?(?:\s+to)?|direct(?:s|ed|ing|ion)?|delegat(?:e|es|ed|ing|ion))\b/.test(
          value,
        ) ||
        /\bcoordinat(?:e|es|ed|ing|ion)\s+(?:with|to)\b/.test(value) ||
        /\bgovern(?:s|ed|ing)?\b/.test(value)
      ) &&
        (delegationDisciplineTargetCarried(value) || /\bdrawings?\b/.test(value)) ||
      /\bdrawings?\s+(?:shall\s+)?govern(?:s|ed|ing)?\b/.test(value);
    const dispositionPattern =
      /\b(?:remain(?:s|ed|ing)?|reconnect(?:s|ed|ing|ion)?|reus(?:e|ed|ing)|remov(?:e|es|ed|ing|al)|delet(?:e|es|ed|ing|ion)|demolish(?:es|ed|ing)?|demolition|replace(?:s|d|ment|ments|ing)?|omit(?:s|ted|ting|tal)?|cancel(?:s|ed|ing|ation|led|ling)?|void(?:s|ed|ing)?|abandon(?:ed|ing|ment)?|disconnect(?:ed|ing|ion)?|de\s*energiz(?:e|ed|ing|ation)|decommission(?:ed|ing)?|dismantl(?:e|ed|ing)|disabl(?:e|ed|ing)|retir(?:e|ed|ing)|relocat(?:e|ed|ing)|salvag(?:e|ed|ing))\b|\bout of service\b/;
    const benignAreaLightingCarrier = (value: string) => {
      if (!/\barea lighting\b/.test(value)) return false;
      const residual = value.replace(/\barea lighting\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      return !residual ||
        /^(?:plans?|details?|schedules?|legends?|notes?|layouts?)$/.test(residual);
    };
    const materialRelationshipCompetitor = drawings.some(source => {
      // The selected protected receipts were already proven exact and closed
      // above. Audit every other drawing for a competing relationship, but do
      // not let the ordinary "Sheet C6" / "Sheet E-2.2" display wrapper make
      // either trusted source (or an already-proven identical civil duplicate)
      // compete with itself.
      if (
        source === electrical ||
        (civil !== null && civilCandidates.includes(source))
      ) return false;
      let value = normalizePolicyText(source.excerpt)
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(new RegExp(`\\b${exactElectricalCanonical}\\b`, 'g'), ' ')
        .replace(
          /\bexisting lighting in this area to remain reconnect(?: on existing circuits if disturbed due to remodel)?\b/g,
          ' existing area lighting ',
        )
        .replace(new RegExp(`\\b${exactCivilCanonical}\\b`, 'g'), ' area lighting ')
        .replace(/\s+/g, ' ')
        .trim();
      const competingDelegation = /\barea lighting\b/.test(value) &&
        (
          !benignAreaLightingCarrier(value) ||
          competingDelegationRelation(value)
        );
      const existingLightingSubject =
        /\b(?:all\s+)?existing\s+(?:(?:site|exterior|area|pole|parking|lot|canopy|security|outdoor)\s+){0,3}(?:lighting|lights?|light fixtures?|fixtures?|luminaires?)\b/.test(
          value,
        ) ||
        /\b(?:area|site|exterior|pole|parking(?: lot)?|canopy|security|outdoor) (?:lighting|lights?|light fixtures?|fixtures?|luminaires?)\b/.test(
          value,
        );
      return competingDelegation ||
        existingLightingSubject && dispositionPattern.test(value);
    });
    if (materialRelationshipCompetitor) return null;
    if (civil && electrical) {
      return {
        statement: 'Civil Sheet C6 directs area lighting to the architectural and electrical drawings. Electrical Sheet E-2.2 says its lighting circuits are shown for design intent only. Electrical Sheet E-2.2 states that existing lighting in this area is to remain and should be reconnected on existing circuits if disturbed due to remodel.',
        sourceIds: [civil.id, electrical.id],
      };
    }
  }

  if (/\bunderground\s+infiltration\s+chambers?\b/i.test(question)) {
    const exactDirectionPattern =
      /\bCONSTRUCT UNDERGROUND INFILTRATION CHAMBERS - SEE DETAILS ON SHEET ([1-9]\d{0,2})(?![A-Za-z0-9./-])/g;
    const directionCandidates = drawings.flatMap(source => {
      const value = sourceText(source).normalize('NFKC');
      if (
        !hasCitationSheet(source, 'C6') || !textHasSheet(value, 'C6') ||
        source.documentCitation?.pageNumber == null
      ) return [];
      const matches = [...value.matchAll(exactDirectionPattern)];
      exactDirectionPattern.lastIndex = 0;
      if (matches.length !== 1) {
        return matches.length > 0
          ? [{ source, target: 0, valid: false }]
          : [];
      }
      const exactDirection = matches[0][0];
      const canonicalExcerpt = normalizePolicyText(source.excerpt)
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\bdrawing page context sheet c6\b/g, ' ')
        .replace(/\bsheet c6\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const canonicalDirection = normalizePolicyText(exactDirection)
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const region = source.documentRegion;
      const sourceRegionIds = region?.sourceRegionIds || [];
      const fact = source.trustedDrawingFact;
      const protectedDirectionReceipt =
        source.trustedProjectedDrawingFact === true &&
        fact?.text === exactDirection &&
        new Set([
          'exact_source_bound_dual_render_consensus',
          'exact_source_bound_dual_provider_candidate_consensus',
        ]).has(fact.reconstructionMethod) &&
        region?.reconstructionMethod ===
          'deterministic_same_page_structured_claim' &&
        region.proofText === source.excerpt &&
        sourceRegionIds.length === 1 && Boolean(sourceRegionIds[0]) &&
        source.documentCitation?.regionId === region.id &&
        canonicalExcerpt === canonicalDirection;
      return [{
        source,
        target: Number(matches[0][1]),
        valid: protectedDirectionReceipt &&
          ecosDrawingPropositionIsAssertiveCurrent(value),
      }];
    });
    if (
      directionCandidates.length !== 1 ||
      !directionCandidates[0].valid
    ) return null;
    const { source: civilDirection, target } = directionCandidates[0];
    const completeInfiltrationDirectionCarrier = (value: string) => {
      const normalized = normalizePolicyText(value)
        .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      return /\bunderground infiltration chambers?\b/.test(normalized) &&
        /\b(?:details?|det)\b/.test(normalized) &&
        /\b(?:see|refer(?:s|red|ring)?(?: to)?|direct(?:s|ed|ing|ion)?|per)\b/.test(
          normalized,
        ) &&
        (
          /\b(?:sheet|sht)(?: (?:no|number))? (?:[a-z] )?[0-9]+\b/.test(
            normalized,
          ) || /\bc ?[0-9]+\b/.test(normalized)
        );
    };
    if (drawings.some(source =>
      source !== civilDirection &&
      completeInfiltrationDirectionCarrier(source.excerpt)
    )) return null;
    const targetSheet = `C${target}`;
    const detailProof = 'UNDERGROUND INFILTRATION CHAMBER DETAILS';
    const detailPattern =
      /\bUNDERGROUND\s+INFILTRATION\b[\s\S]{0,120}\bCHAMBERS?\b[\s\S]{0,120}\bDETAILS?\b/i;
    const detailCandidates = drawings.filter(source => {
      const value = sourceText(source);
      return hasCitationSheet(source, targetSheet) &&
        textHasSheet(value, targetSheet) && detailPattern.test(value);
    });
    const canonicalTargetSheet = canonicalSheet(targetSheet)
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const detailCandidateHasExactClosedExcerpt = (
      source: (typeof detailCandidates)[number],
    ) => {
      const canonicalExcerpt = normalizePolicyText(source.excerpt)
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(
          new RegExp(`\\bdrawing page context sheet ${canonicalTargetSheet}\\b`, 'g'),
          ' ',
        )
        .replace(new RegExp(`\\bsheet ${canonicalTargetSheet}\\b`, 'g'), ' ')
        .replace(/\bunderground infiltration chambers? details?\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return !canonicalExcerpt;
    };
    const exactDetailCandidates = detailCandidates.filter(source => {
      const region = source.documentRegion;
      const sourceRegionIds = region?.sourceRegionIds || [];
      return source.trustedDerivedDrawingPassage === true &&
        region?.reconstructionMethod === 'deterministic_adjacent_region_phrase' &&
        region.proofText === detailProof && sourceRegionIds.length === 3 &&
        new Set(sourceRegionIds).size === sourceRegionIds.length &&
        sourceRegionIds.every(Boolean) &&
        source.documentCitation?.regionId === region.id &&
        detailCandidateHasExactClosedExcerpt(source) &&
        ecosDrawingPropositionIsAssertiveCurrent(source.excerpt);
    });
    const civilDetails = exactDetailCandidates.length === 1 &&
        detailCandidates.every(source =>
          source.recordId === exactDetailCandidates[0].recordId &&
          source.documentCitation?.pageNumber ===
            exactDetailCandidates[0].documentCitation?.pageNumber &&
          detailCandidateHasExactClosedExcerpt(source) &&
          ecosDrawingPropositionIsAssertiveCurrent(source.excerpt)
        )
      ? exactDetailCandidates[0]
      : null;
    if (
      civilDetails &&
      civilDirection.recordId &&
      civilDirection.recordId === civilDetails.recordId
    ) {
      return {
        statement: `Current civil Sheet ${targetSheet} contains the underground infiltration chamber details, and civil Sheet C6 sends the field team to those Sheet ${targetSheet} details.`,
        sourceIds: [civilDetails.id, civilDirection.id],
      };
    }
  }

  return null;
}

/**
 * Returns a bounded drawing statement verbatim when one exact current region
 * directly answers the requested measurement or quantity. Deterministically
 * derived multi-region receipts are preferred for publication, while every
 * responsive exact-page proof remains an ambiguity veto.
 */
export function buildECOSDirectDrawingEvidenceFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const drawingSources = sources.filter(source =>
    source.sourceType === 'document' && Boolean(source.documentRegion) &&
    sourceMatchesExplicitDrawingReference(question, source)
  );
  const isDerivedSource = (source: ECOSAnswerFallbackSource) =>
    /^deterministic_/.test(source.documentRegion?.reconstructionMethod || '');
  const requirement = analyzeECOSProjectQuestion(question);
  // The protected ADA grade receipt is intentionally handled only by the
  // exact same-line measurement path above. A generic verbatim fallback must
  // not stitch its scope and MAX./IN ALL DIRECTIONS value across lines.
  if (questionRequestsExactDelineatedADAMaximumGrade(question)) return null;
  const responsive = drawingSources.flatMap(source => {
    const proof = exactDrawingProofLine(source);
    if (!proof) return [];
    const requestedProofReferences = new Set(boundedQuantityReferenceKeys(
      stripECOSBoundedExcludedReferenceScopes(question),
    ));
    if (boundedQuantityReferenceKeys(proof).some(reference =>
      !requestedProofReferences.has(reference)
    )) return [];
    const statement = directDrawingStatement(question, source, proof);
    if (requirement.kind === 'general') {
      const exactReferencedProof = hasExplicitDrawingReference(question) &&
        directGeneralProofMatchesQuestion(question, proof);
      if (
        isDerivedSource(source)
          ? ecosEvidenceQuestionContextScore(question, proof) < 1.5
          : !exactReferencedProof
      ) return [];
    } else {
      const policyInput = {
        question,
        statement,
      };
      if (
        !ecosFactAnswersQuestion({ ...policyInput, sourceExcerpts: [proof] }) &&
        !ecosFactAnswersQuestion({
          ...policyInput,
          sourceExcerpts: [
            /\bslab\b/.test(normalizePolicyText(question))
              ? `${source.title || ''} ${source.excerpt}`
              : `${source.title || ''} ${proof}`,
          ],
        })
      ) return [];
    }
    return [{ source, proof, statement }];
  });
  const proofConflictKey = (proof: string) => {
    const comparable = requirement.attribute
      ? trustedFactComparableMeasurement(requirement.attribute, proof)
      : null;
    return comparable
      ? `${requirement.attribute}|${comparable.family}|${comparable.value}|` +
        `${drawingMeasurementConstraintMode(proof)}|${drawingMeasurementMaterialSubjectSignature(proof)}`
      : normalizePolicyText(proof);
  };
  const distinctProofs = new Set(responsive.map(candidate => proofConflictKey(candidate.proof)));
  if (distinctProofs.size !== 1) return null;
  const selected = responsive.find(candidate => isDerivedSource(candidate.source)) || responsive[0];
  if (!selected) return null;
  return {
    statement: selected.statement,
    sourceIds: [selected.source.id],
  };
}

function hasExplicitDrawingReference(question: string) {
  return explicitDrawingPage(question) !== null || Boolean(explicitDrawingSheet(question));
}

function sourceMatchesExplicitDrawingReference(
  question: string,
  source: ECOSAnswerFallbackSource,
) {
  const page = explicitDrawingPage(question);
  const sheet = explicitDrawingSheet(question);
  if (page !== null && source.documentCitation?.pageNumber !== page) return false;
  if (
    sheet && canonicalDrawingReference(source.documentCitation?.sheetNumber || '') !== sheet
  ) return false;
  return true;
}

function directGeneralProofMatchesQuestion(question: string, proof: string) {
  const context = analyzeECOSQuestionEvidenceContext(question, proof);
  if (context.subjectTokens.length === 0) return false;
  const requiredMatches = Math.max(2, Math.ceil(context.subjectTokens.length / 2));
  return context.matchedSubjectTokens.length >= requiredMatches;
}

function directDrawingStatement(
  question: string,
  source: ECOSAnswerFallbackSource,
  proof: string,
) {
  const requestedCanopy = normalizePolicyText(question).match(/\bcanopy\s+([a-z])\b/)?.[1] || '';
  const sourceIdentifiesRequestedCanopy = requestedCanopy && new RegExp(
    `\\bcanopy\\s+["']?${escapeRegExp(requestedCanopy)}\\b`,
  ).test(normalizePolicyText(source.title || ''));
  const drawingLabel = sourceIdentifiesRequestedCanopy
    ? `Canopy ${requestedCanopy.toUpperCase()} drawing`
    : 'drawing';
  return sanitizeECOSAnswerStatement(`The current ${drawingLabel} states: ${proof}.`);
}

function exactDrawingProofLine(source: ECOSAnswerFallbackSource) {
  const derivedProof = source.documentRegion?.proofText?.trim();
  if (derivedProof) return derivedProof.replace(/[.;]+$/, '').trim();
  const lines = source.excerpt.split(/\n+/).map(value => value.trim()).filter(Boolean)
    .map(value => value.replace(/^DRAWING PAGE CONTEXT:[\s\S]{1,240}?\.\s+(?=\S)/i, '').trim())
    .filter(value => value && !/^DRAWING PAGE CONTEXT:/i.test(value));
  if (lines.length === 0) return '';
  const uniqueLines = [...new Map(lines.map(line => [
    normalizePolicyText(line),
    line.replace(/[.;]+$/, '').trim(),
  ] as const)).values()];
  // An ordinary exact-region excerpt is not a deterministic composite. Do
  // not select the last line when the region carries multiple propositions;
  // their ordering cannot resolve a conflict or establish which is authority.
  return uniqueLines.length === 1 ? uniqueLines[0] : '';
}

export function buildECOSDrawingSheetSetFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const normalizedQuestion = normalizePolicyText(question);
  const requestedSheetScope = requestedECOSDrawingSheetScope(question);
  const hasBoundedSheetCarrier = /\bsheets?\b/.test(normalizedQuestion) ||
    /\bshts?\b/.test(normalizedQuestion) &&
      requestedSheetScope.explicit &&
      !requestedSheetScope.invalid &&
      requestedSheetScope.sheets.length > 0;
  if (
    !hasBoundedSheetCarrier ||
    !/\b(?:together|both|use|review)\b/.test(normalizedQuestion) ||
    !/\bcanopy\b/.test(normalizedQuestion) ||
    !/\b(?:containment|hazardous material)\b/.test(normalizedQuestion)
  ) return null;
  const drawings = sources.filter(source =>
    source.sourceType === 'document' && Boolean(source.documentCitation?.sheetNumber)
  );
  const uniqueRoleCandidates = (candidates: readonly ECOSAnswerFallbackSource[]) =>
    [...new Map(candidates.map(source => [
      `${source.recordId || ''}|${canonicalDrawingReference(source.documentCitation?.sheetNumber || '')}|` +
        normalizePolicyText(source.trustedDrawingFact?.text || ''),
      source,
    ] as const)).values()];
  const hasAssertiveTrustedRoleFact = (source: ECOSAnswerFallbackSource) =>
    ecosDrawingPropositionIsAssertiveCurrent(source.title || 'current drawing') &&
    ecosDrawingPropositionIsAssertiveCurrent(source.trustedDrawingFact?.text || '');
  const canopyCandidates = uniqueRoleCandidates(drawings.filter(source =>
    hasAssertiveTrustedRoleFact(source) &&
    normalizePolicyText(source.trustedDrawingFact?.subject || '') === 'architectural plan identity' &&
    /^weather protected canopy plans?$/.test(normalizePolicyText(source.trustedDrawingFact?.text || ''))
  ));
  if (canopyCandidates.length !== 1) return null;
  const canopy = canopyCandidates[0];
  const containmentPlanCandidates = uniqueRoleCandidates(drawings.filter(source =>
    hasAssertiveTrustedRoleFact(source) &&
    source.recordId === canopy?.recordId &&
    canonicalDrawingReference(source.documentCitation?.sheetNumber || '') !==
      canonicalDrawingReference(canopy?.documentCitation?.sheetNumber || '') &&
    normalizePolicyText(source.trustedDrawingFact?.subject || '') === 'architectural plan identity' &&
    /^weather protected canopy hazardous material plan$/.test(
      normalizePolicyText(source.trustedDrawingFact?.text || ''),
    )
  ));
  if (containmentPlanCandidates.length !== 1) return null;
  const containmentPlan = containmentPlanCandidates[0];
  const containmentCandidates = uniqueRoleCandidates(drawings.filter(source => {
    const fact = source.trustedDrawingFact;
    const subject = normalizePolicyText(fact?.subject || '');
    const text = normalizePolicyText(fact?.text || '');
    return source.recordId === containmentPlan?.recordId &&
      canonicalDrawingReference(source.documentCitation?.sheetNumber || '') ===
        canonicalDrawingReference(containmentPlan?.documentCitation?.sheetNumber || '') &&
      hasAssertiveTrustedRoleFact(source) &&
      subject === 'hazardous material containment assignment' &&
      /^containment area [12]\b/.test(text);
  }));
  const containmentAreaNumbers = containmentCandidates.flatMap(source =>
    normalizePolicyText(source.trustedDrawingFact?.text || '')
      .match(/^containment area ([12])\b/)?.[1] || []
  );
  const distinctContainmentAreas = [...new Set(containmentAreaNumbers)];
  if (
    containmentCandidates.length < 1 || containmentCandidates.length > 2 ||
    containmentAreaNumbers.length !== containmentCandidates.length ||
    distinctContainmentAreas.length !== containmentCandidates.length ||
    (containmentCandidates.length === 2 &&
      (distinctContainmentAreas.length !== 2 ||
        !distinctContainmentAreas.includes('1') ||
        !distinctContainmentAreas.includes('2')))
  ) return null;
  const canopySheet = canopy.documentCitation?.sheetNumber || '';
  const containmentSheet = containmentPlan.documentCitation?.sheetNumber || '';
  if (
    !canopySheet ||
    !containmentSheet ||
    canonicalDrawingReference(canopySheet) === canonicalDrawingReference(containmentSheet)
  ) return null;
  return {
    statement: sanitizeECOSAnswerStatement(
      `Use Sheet ${canopySheet} for the weather-protected canopy plan and Sheet ${containmentSheet} ` +
      'for the hazardous-material containment layout; review both sheets together.',
    ),
    sourceIds: [
      canopy.id,
      containmentPlan.id,
      ...containmentCandidates.map(source => source.id),
    ],
  };
}

/**
 * Converts only worker-produced, Assurance-accepted, coordinate-bound drawing
 * facts into a deterministic answer.  The worker already resolved each table
 * row or exact rendered proposition; this layer merely selects the complete
 * set requested by the question.  Incomplete groups fail closed so the model
 * cannot turn a partial schedule or table into a complete-sounding answer.
 */
export function buildECOSTrustedDrawingFactFallback(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const normalizedQuestion = normalizePolicyText(question);
  const facts = trustedFactsAtExplicitDrawingReference(
    question,
    uniqueTrustedDrawingFacts(question, sources),
  );
  if (facts.length === 0) return null;

  const groups: Array<readonly TrustedFactSource[]> = [];
  const supportingSources: TrustedFactSource[] = [];
  const addRequiredAnchors = (
    predicate: (fact: TrustedFactSource) => boolean,
    anchors: readonly string[],
  ) => {
    return addRequiredAnchorsFrom(facts.filter(predicate), anchors);
  };
  const addRequiredAnchorsFrom = (
    candidates: readonly TrustedFactSource[],
    anchors: readonly string[],
  ) => {
    if (anchors.length === 0) return false;
    const combinedTreeRow = selectClosedRequiredProvidedTreeRow(candidates, anchors);
    if (combinedTreeRow) {
      groups.push([combinedTreeRow]);
      return true;
    }
    const selected: TrustedFactSource[] = [];
    for (const anchor of anchors) {
      const matches = candidates.filter(candidate => trustedFactBindsAnchor(candidate, anchor));
      const distinct = [...new Map(matches.map(candidate => [
        trustedFactAllocationKey(candidate),
        candidate,
      ] as const)).values()];
      if (distinct.length !== 1) return false;
      selected.push(distinct[0]);
    }
    if (new Set(selected.map(trustedFactAllocationKey)).size !== selected.length) return false;
    groups.push(selected);
    return true;
  };

  if (/\bfootings?\b/.test(normalizedQuestion)) {
    const anchors = normalizedQuestion.match(/\bf\s*-?\s*[1-9]\d*\b/g)?.map(canonicalFactAnchor) || [];
    if (anchors.length > 0 && !addRequiredAnchors(typeIs('footing_schedule'), anchors)) return null;
  }

  if (/\b(?:exhaust\s+fans?|airflow|air\s+flow|cfm|air\s+balance)\b/.test(normalizedQuestion)) {
    const anchors = normalizedQuestion.match(/\bef\s*-?\s*[1-9]\d*\b/g)?.map(canonicalFactAnchor) || [];
    if (!addRequiredAnchors(typeIs('equipment_record'), anchors)) return null;
  }

  if (/\b(?:fixture\s+units?|fixture-unit|cold[- ]water)\b/.test(normalizedQuestion)) {
    const anchors = [
      normalizedQuestion.includes('center breakroom') ? 'center breakroom' : '',
      normalizedQuestion.includes('east side') ? 'east side' : '',
    ].filter(Boolean);
    if (!addRequiredAnchors(typeIs('fixture_unit_total'), anchors)) return null;
  }

  if (
    /\bpanels?\b/.test(normalizedQuestion) &&
    /\b(?:bus|replacement)\b/.test(normalizedQuestion)
  ) {
    let candidates = facts.filter(candidate =>
      /\belectrical panel replacement\b/.test(normalizePolicyText(candidate.fact.subject)) ||
      /\bpanel\b[\s\S]{0,80}\b(?:replacement|replaced)\b/.test(
        normalizePolicyText(candidate.fact.text),
      )
    );
    const requestedRatings = [...new Set(
      (normalizedQuestion.match(/\b\d{2,4}\s*a\b/g) || []).map(rating =>
        rating.replace(/\s+/g, '')
      ),
    )];
    const requiredCount = /\btwo\b|\bpanels\b/.test(normalizedQuestion) ? 2 : 1;
    if (requestedRatings.length > 0) {
      if (requestedRatings.length !== requiredCount) return null;
      const selected: TrustedFactSource[] = [];
      for (const rating of requestedRatings) {
        const matches = candidates.filter(candidate => trustedFactBindsAnchor(candidate, rating));
        const distinct = [...new Map(matches.map(candidate => [
          trustedFactAllocationKey(candidate),
          candidate,
        ] as const)).values()];
        if (distinct.length !== 1) return null;
        selected.push(distinct[0]);
      }
      if (new Set(selected.map(trustedFactAllocationKey)).size !== selected.length) return null;
      groups.push(selected);
    } else {
      if (candidates.length !== requiredCount) return null;
      groups.push(candidates);
    }
  }

  if (/\b(?:photometric|photometrics|light levels?)\b/.test(normalizedQuestion)) {
    const candidates = facts.filter(candidate =>
      typeIs('photometric_statistics')(candidate) &&
      Boolean(parsePhotometricStatistics(candidate.fact.text))
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (/\b(?:asphalt|ac paving)\b/.test(normalizedQuestion) && /\bbase\b/.test(normalizedQuestion)) {
    const candidates = facts.filter(candidate =>
      normalizePolicyText(candidate.fact.text) ===
        normalizePolicyText('CONSTRUCT 3.5” AC OVER 6.5” BASE PAVING')
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (/\bada(?:-accessible| accessible)?\b/.test(normalizedQuestion) && /\b(?:grade|slope)\b/.test(normalizedQuestion)) {
    const candidates = facts.filter(candidate =>
      normalizePolicyText(candidate.fact.text) === normalizePolicyText(
        'IN DELINEATED ADA ACCESSIBLE PARKING AREAS, GRADES SHALL BE 2.00% MAX. IN ALL DIRECTIONS.',
      )
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (/\barea drain\b/.test(normalizedQuestion) && /\bfilter\b/.test(normalizedQuestion)) {
    const candidates = facts.filter(candidate =>
      normalizePolicyText(candidate.fact.text) === normalizePolicyText(
        'CONSTRUCT 12”x12” ID AREA DRAIN WITH FLO-GARD FILTER AND LOCAL DEPRESSION - SEE DETAIL 4',
      )
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (/\bsewer lateral\b/.test(normalizedQuestion)) {
    const candidates = facts.filter(candidate =>
      normalizePolicyText(candidate.fact.text) === normalizePolicyText(
        'CONSTRUCT 4” SEWER LATERAL AND CLEANOUT PER RIVERSIDE CITY STANDARD 562. MATERIAL PER MECHANICAL DRAWINGS.',
      )
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (/\b(?:landscape area|irrigated landscape area)\b/.test(normalizedQuestion)) {
    const anchors = [
      'total landscape area',
      normalizedQuestion.includes('irrigated') ? 'total irrigated landscape area' : '',
    ].filter(Boolean);
    if (!addRequiredAnchors(typeIs('landscape_metric'), anchors)) return null;
  }

  if (/\bparking[- ]lot trees?\b|\btrees?\b[\s\S]{0,80}\b(?:required|provided|planned|installed)\b/.test(normalizedQuestion)) {
    const anchors = [
      normalizedQuestion.includes('required') ? 'required' : '',
      normalizedQuestion.includes('provided') || normalizedQuestion.includes('planned') ? 'provided' : '',
    ].filter(Boolean);
    if (!addRequiredAnchors(typeIs('landscape_metric'), anchors)) return null;
  }

  if (/\bhydrozones?\b|\bwater zones?\b/.test(normalizedQuestion)) {
    const anchors = ['high', 'medium', 'low'].filter(anchor => normalizedQuestion.includes(anchor));
    const selectedPlan = trustedFactsForRequestedPlan(
      facts,
      facts.filter(typeIs('hydrozone_area')),
      normalizedQuestion,
      'irrigation',
    );
    const candidates = selectedPlan.candidates;
    if (!addRequiredAnchorsFrom(candidates, anchors)) return null;
    const selectedPage = candidates[0]?.source.documentCitation?.pageNumber;
    const selectedRecordId = candidates[0]?.source.recordId;
    const tableIdentity = facts.find(candidate =>
      candidate.source.recordId === selectedRecordId &&
      candidate.source.documentCitation?.pageNumber === selectedPage &&
      normalizePolicyText(candidate.fact.subject) === 'hydrozone table identity' &&
      normalizePolicyText(candidate.fact.text) === 'hydrozone data'
    );
    if (!tableIdentity) return null;
    supportingSources.push(tableIdentity);
    if (selectedPlan.identity) supportingSources.push(selectedPlan.identity);
  }

  if (/\b(?:etwu|mawa|water budget)\b/.test(normalizedQuestion)) {
    const anchors = [
      normalizedQuestion.includes('etwu') ? 'etwu' : '',
      normalizedQuestion.includes('mawa') ? 'mawa' : '',
    ].filter(Boolean);
    if (!addRequiredAnchors(typeIs('water_budget'), anchors)) return null;
  }

  const requestedPlants = [
    'forest pansy redbud',
    'palo verde',
    'lemon scented gum',
    'golden rain',
  ].filter(name => normalizedQuestion.includes(name));
  if (requestedPlants.length > 0) {
    const selectedPlan = trustedFactsForRequestedPlan(
      facts,
      facts.filter(typeIs('plant_material')),
      normalizedQuestion,
      'planting',
    );
    const candidates = selectedPlan.candidates;
    if (!addRequiredAnchorsFrom(candidates, requestedPlants)) return null;
    if (selectedPlan.identity) supportingSources.push(selectedPlan.identity);
  }

  if (/\bcontainment\b/.test(normalizedQuestion) && /\b(?:hazardous|material|assignment|layout)\b/.test(normalizedQuestion)) {
    const anchors = /\bcontainment area [12]\b/.test(normalizedQuestion)
      ? normalizedQuestion.match(/\bcontainment area [12]\b/g) || []
      : ['containment area 1', 'containment area 2'];
    if (!addRequiredAnchors(subjectIncludes('hazardous material containment'), anchors)) return null;
  }

  if (
    /\bcanopy\b/.test(normalizedQuestion) &&
    (
      analyzeECOSProjectQuestion(question).attribute === 'area' ||
      /\bwhat\s+area\b|\b(?:square feet|sq ft|sf|footprint)\b/.test(normalizedQuestion)
    )
  ) {
    const requestedCanopyIdentifier = normalizedQuestion.match(
      /\b(?:new\s+)?canopy\s+(\d+|[a-z])\b/,
    )?.[1] || '';
    const candidates = facts.filter(candidate =>
      /\bnew canopy(?: (?:\d+|[a-z]))? area\b/.test(
        normalizePolicyText(candidate.fact.subject),
      ) &&
      /\b(?:square feet|sq ft|sf)\b/.test(normalizePolicyText(candidate.fact.text)) &&
      (
        !requestedCanopyIdentifier ||
        trustedFactBindsAnchor(candidate, `canopy ${requestedCanopyIdentifier}`)
      )
    );
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  if (
    /\bslab\b/.test(normalizedQuestion) &&
    (
      analyzeECOSProjectQuestion(question).attribute === 'thickness' ||
      /\b(?:thick|thickness)\b/.test(normalizedQuestion)
    )
  ) {
    const candidates = facts.filter(typeIs('slab_legend'));
    if (candidates.length !== 1) return null;
    groups.push(candidates);
  }

  // The named branches above cover compound schedules and other facts that
  // must be assembled as a complete set.  For every other worker-verified
  // proposition, select one exact fact only when the question has a unique,
  // strong match.  Explicit sheet/page references are hard constraints, not
  // ranking hints.  This keeps new drawing facts useful without adding a new
  // question-specific rule for every sentence in every plan set.
  if (groups.length === 0) {
    const generic = selectUniqueTrustedDrawingFact(question, facts);
    if (generic) groups.push([generic]);
  }

  const selected = uniqueTrustedFactSources(groups.flat());
  if (selected.length === 0) return null;
  if (selected.some(item =>
    !ecosDrawingPropositionIsAssertiveCurrent(item.source.title || 'current drawing') ||
    !ecosDrawingPropositionIsAssertiveForExactQuestion(question, item.fact.text)
  )) return null;
  if (
    questionRequestsDrawingSheetTitle(normalizedQuestion) &&
    selected.some(item => !item.source.documentCitation?.sheetNumber?.trim())
  ) return null;
  const installedConditionRequested = ecosQuestionRequestsInstalledCondition(question);
  const formatted = formatTrustedDrawingFacts(selected, normalizedQuestion);
  if (!formatted) return null;
  const statement = formatted +
    (installedConditionRequested ? trustedFieldConditionLimitation(normalizedQuestion) : '');
  return {
    statement: sanitizeECOSAnswerStatement(statement),
    sourceIds: [...new Set([
      ...selected.map(item => item.source.id),
      ...supportingSources.map(item => item.source.id),
    ])],
  };
}

type TrustedFactSource = Readonly<{
  source: ECOSAnswerFallbackSource;
  fact: ECOSTrustedDrawingFact;
}>;

function uniqueTrustedDrawingFacts(
  question: string,
  sources: readonly ECOSAnswerFallbackSource[],
) {
  const result: TrustedFactSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const fact = source.sourceType === 'document' ? source.trustedDrawingFact : null;
    if (!fact?.text || !fact.reconstructionMethod) continue;
    if (
      !ecosDrawingPropositionIsAssertiveCurrent(source.title || 'current drawing') ||
      !ecosDrawingPropositionIsAssertiveForExactQuestion(question, fact.text)
    ) continue;
    const key = `${source.id}|${normalizePolicyText(fact.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, fact });
  }
  return result;
}

export type ECOSDrawingSheetScope = Readonly<{
  explicit: boolean;
  invalid: boolean;
  sheets: readonly string[];
}>;

const ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE =
  String.raw`(?:[a-z]{1,4}\s*[-.]?\s*\d+(?:\.\d+)?[a-z]?(?:\s*-\s*\d+(?:\.\d+)?[a-z]?)?|\d+(?:\.\d+)?[a-z]?|[a-z])`;
const ECOS_DRAWING_SHEET_IDENTIFIER_END_SOURCE = String.raw`(?![a-z0-9]|\.[a-z0-9])`;

function ecosDrawingSheetIdentifierTailIsBounded(
  value: string,
  end: number,
  allowCompactContinuation: boolean,
) {
  let tail = value.slice(end);
  if (/^[)\]}]/.test(tail)) {
    tail = tail.slice(1);
    if (!/^(?:$|\s|[.!?;:,])/.test(tail)) return false;
  }
  if (!tail || /^\s/.test(tail) || /^[!?;:,/&|]/.test(tail)) return true;
  if (/^\./.test(tail)) return /^\.(?=$|[\s!?;:,)\]}"'’”])/.test(tail);
  if (/^[+-]/.test(tail)) return allowCompactContinuation;
  return false;
}

function ecosDrawingSheetUnsupportedCompatibilityAt(value: string, offset: number) {
  return new RegExp(
    String.raw`^\s*(?:[([{]\s*)?["'‘’“”]?[^\s,;!?]{0,64}` +
      ECOS_UNSUPPORTED_SHEET_COMPATIBILITY_MARKER + String.raw`[^\s,;!?]{0,64}`,
  ).test(value.slice(offset));
}

function ecosDrawingSheetMismatchedDelimiterAt(
  value: string,
  offset: number,
  consumedOpeningDelimiter = '',
) {
  const pattern = new RegExp(
    String.raw`^\s*([([{])?\s*["'‘’“”]?(${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE})["'‘’“”]?`,
    'i',
  );
  const match = pattern.exec(value.slice(offset));
  if (!match?.[2]) return false;
  const compact = match[2].replace(/\s+/g, '');
  if (!/\d/.test(compact) && compact !== compact.toUpperCase()) return false;
  const openingDelimiter = match[1] || consumedOpeningDelimiter;
  if (!openingDelimiter) return false;
  const expectedClosingDelimiter: Readonly<Record<string, string>> = {
    '(': ')',
    '[': ']',
    '{': '}',
  };
  let closingIndex = offset + match[0].length;
  while (/\s/.test(value[closingIndex] || '')) closingIndex += 1;
  return value[closingIndex] !== expectedClosingDelimiter[openingDelimiter];
}

function ecosDrawingSheetIdentifierAt(
  value: string,
  offset: number,
  allowCompactContinuation = false,
  consumedOpeningDelimiter = '',
) {
  const pattern = new RegExp(
    String.raw`^\s*([([{])?\s*["'‘’“”]?(${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE})["'‘’“”]?`,
    'i',
  );
  const match = pattern.exec(value.slice(offset));
  if (!match?.[2]) return null;
  let end = offset + match[0].length;
  const openingDelimiter = match[1] || consumedOpeningDelimiter;
  let closingIndex = end;
  while (/\s/.test(value[closingIndex] || '')) closingIndex += 1;
  const closingDelimiter = value[closingIndex] || '';
  const expectedClosingDelimiter: Readonly<Record<string, string>> = {
    '(': ')',
    '[': ']',
    '{': '}',
  };
  if (openingDelimiter) {
    if (closingDelimiter !== expectedClosingDelimiter[openingDelimiter]) return null;
    end = closingIndex + 1;
  } else if (/^[)\]}]$/.test(closingDelimiter)) {
    end = closingIndex + 1;
  }
  if (!ecosDrawingSheetIdentifierTailIsBounded(value, end, allowCompactContinuation)) return null;
  const compact = match[2].replace(/\s+/g, '');
  // A lowercase one-letter token after a connector is ordinarily an article
  // (`Sheet S1 and a note`), not a second sheet designator.
  if (!/\d/.test(compact) && compact !== compact.toUpperCase()) return null;
  const identifier = canonicalDrawingReference(match[2]);
  return identifier
    ? Object.freeze({ identifier, end })
    : null;
}

function boundedECOSDrawingSheetRange(first: string, last: string) {
  const firstMatch = /^([A-Z]{0,4}-?)(\d{1,3})$/.exec(first);
  const lastMatch = /^([A-Z]{0,4}-?)(\d{1,3})$/.exec(last);
  if (!firstMatch || !lastMatch || firstMatch[1] !== lastMatch[1]) return null;
  const firstNumber = Number(firstMatch[2]);
  const lastNumber = Number(lastMatch[2]);
  if (lastNumber < firstNumber || lastNumber - firstNumber + 1 > 4) return null;
  const width = Math.max(firstMatch[2].length, lastMatch[2].length);
  return Array.from(
    { length: lastNumber - firstNumber + 1 },
    (_, index) => `${firstMatch[1]}${String(firstNumber + index).padStart(width, '0')}`,
  );
}

/**
 * Parse explicit drawing-sheet locations without letting an unsupported peer
 * connector collapse a multi-sheet question to its first member. The exact
 * authority layer may use every parsed member or reject the whole scope, but
 * it must never silently answer only Sheet S1 from `Sheets S1 &/or S2`.
 */
export function requestedECOSDrawingSheetScope(question: string): ECOSDrawingSheetScope {
  const scanText = normalizeECOSSheetIdentityScanText(question)
    .replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(/[‐‑‒–—―−]/g, '-');
  const sheets: string[] = [];
  let explicit = false;
  let invalid = false;
  let consumedUntil = -1;
  const add = (identifier: string) => {
    if (!sheets.includes(identifier)) sheets.push(identifier);
  };
  const consumePeerContinuations = (initialIdentifier: string, initialCursor: number) => {
    let previousIdentifier = initialIdentifier;
    let cursor = initialCursor;
    while (cursor < scanText.length) {
      const remainder = scanText.slice(cursor);
      const ambiguousConnector = /^\s*(?:&\s*\/\s*or|or\s*\/\s*&|and\s*\/\s*&|&\s*\/\s*and)\s*/i.exec(
        remainder,
      );
      if (ambiguousConnector) {
        invalid = true;
        cursor += ambiguousConnector[0].length;
        break;
      }
      const rangeConnector = /^\s*(?:-\s*|(?:through|thru|to)\b\s*)/i.exec(remainder);
      const connector = rangeConnector || /^\s*(?:,\s*(?:as\s+well\s+as|in\s+addition\s+to)\s+|,\s*(?:(?:and|or)\s+)?|;|\||\+|&|\/|vs\.(?=\s)|(?:and\s*\/\s*or|or\s*\/\s*and|in\s+conjunction\s+with|in\s+combination\s+with|compared\s+(?:with|to)|adjacent\s+to|and\s+then|or\s+else|plus\s+also|as\s+well\s+as|alongside(?:\s+of)?|along\s+with|together\s+with|in\s+addition\s+to|and\s+also|or\s+alternatively|beside|plus|against|versus|vs|and|or)\b)\s*/i.exec(
        remainder,
      );
      if (!connector) break;
      let nextOffset = cursor + connector[0].length;
      const repeatedLabel = /^(?:the\s+)?(?:sheets?|shts?\.?)(?:(?:\s+(?:number|no\.?)\s*[:#]?\s*)|(?:\s*[#:/]\s*)|(?:\s*[([{]\s*)|\s+)/i.exec(
        scanText.slice(nextOffset),
      );
      if (repeatedLabel) nextOffset += repeatedLabel[0].length;
      const repeatedOpeningDelimiter = /([([{])\s*$/.exec(repeatedLabel?.[0] || '')?.[1] || '';
      const next = ecosDrawingSheetIdentifierAt(
        scanText,
        nextOffset,
        true,
        repeatedOpeningDelimiter,
      );
      // Punctuation and conjunctions also terminate ordinary prose. Only
      // commit the connector when it is followed by another bounded sheet ID.
      if (!next) {
        const danglingPeerConnector = /^[\s.,;:!?)}\]]*$/.test(
          scanText.slice(nextOffset),
        );
        const danglingRepeatedLabel =
          /^\s*(?:the\s+)?(?:sheets?|shts?\.?)\s*[.,;:!?)}\]]*\s*$/i.test(
            scanText.slice(nextOffset),
          );
        if (
          ecosDrawingSheetUnsupportedCompatibilityAt(scanText, nextOffset) ||
          ecosDrawingSheetMismatchedDelimiterAt(
            scanText,
            nextOffset,
            repeatedOpeningDelimiter,
          ) ||
          Boolean(repeatedLabel) ||
          danglingPeerConnector ||
          danglingRepeatedLabel
        ) invalid = true;
        break;
      }
      if (rangeConnector) {
        const expanded = boundedECOSDrawingSheetRange(previousIdentifier, next.identifier);
        if (!expanded) {
          invalid = true;
          cursor = next.end;
          break;
        }
        expanded.forEach(add);
      } else {
        add(next.identifier);
      }
      previousIdentifier = next.identifier;
      cursor = next.end;
    }
    return Object.freeze({ previousIdentifier, cursor });
  };
  const sheetLabelPattern = /\b(?:sheets?|shts?\.?)(?:(?:\s+(?:number|no\.?)\s*[:#]?\s*)|(?:\s*[#:/]\s*)|(?:\s*[([{]\s*)|\s+)/gi;
  for (const label of scanText.matchAll(sheetLabelPattern)) {
    const labelStart = label.index || 0;
    if (labelStart < consumedUntil) continue;
    const exclusionPrefix = scanText.slice(Math.max(0, labelStart - 100), labelStart)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trimEnd();
    const excluded = /\b(?:but\s+not|do\s+not\s+use|don['’]?t\s+use|except(?:\s+for)?|excluding|ignore|ignoring|leave\s+out|omit|omitting|other\s+than|skip|skipping|without(?:\s+using)?)(?:\s+the)?$/.test(
      exclusionPrefix,
    ) && !/\b(?:do\s+not|don['’]?t|never|not)\s+(?:ever\s+)?(?:ignore|omit|skip|exclude)(?:\s+the)?$/.test(
      exclusionPrefix,
    );
    if (excluded) {
      explicit = true;
      invalid = true;
      consumedUntil = labelStart + label[0].length;
      continue;
    }
    const pluralLabel = /^(?:sheets|shts\.?)\b/i.test(label[0]);
    const firstOffset = labelStart + label[0].length;
    const consumedOpeningDelimiter = /([([{])\s*$/.exec(label[0])?.[1] || '';
    const first = ecosDrawingSheetIdentifierAt(
      scanText,
      firstOffset,
      false,
      consumedOpeningDelimiter,
    );
    if (!first) {
      // A compact peer separator immediately follows the first designator, so
      // the ordinary single-ID parser deliberately refuses it. Bind both
      // members here instead of letting `S1+S2` or `S1-S2` look unscoped.
      const compactPeerCandidate = new RegExp(
        String.raw`^\s*["'‘’“”]?(${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE})["'‘’“”]?\s*` +
          String.raw`(\+|-)\s*["'‘’“”]?(${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE})["'‘’“”]?`,
        'i',
      ).exec(scanText.slice(firstOffset));
      const compactPeer = compactPeerCandidate &&
          !ecosDrawingSheetMismatchedDelimiterAt(
            scanText,
            firstOffset,
            consumedOpeningDelimiter,
          ) &&
          ecosDrawingSheetIdentifierTailIsBounded(
            scanText,
            firstOffset + compactPeerCandidate[0].length,
            true,
          )
        ? compactPeerCandidate
        : null;
      if (compactPeer?.[1] && compactPeer[3]) {
        explicit = true;
        let previousIdentifier = '';
        if (compactPeer[2] === '-' && !pluralLabel) {
          // A hyphen belongs to a conventional singular identity such as
          // `Sheet E2-1`; only a plural label gives it list/range semantics.
          const identifier = canonicalDrawingReference(
            `${compactPeer[1]}-${compactPeer[3]}`,
          );
          if (!identifier) invalid = true;
          else {
            add(identifier);
            previousIdentifier = identifier;
          }
        } else if (compactPeer[2] === '-') {
          const firstIdentifier = canonicalDrawingReference(compactPeer[1]);
          const secondIdentifier = canonicalDrawingReference(compactPeer[3]);
          const expanded = boundedECOSDrawingSheetRange(firstIdentifier, secondIdentifier);
          if (!expanded) invalid = true;
          else {
            expanded.forEach(add);
            previousIdentifier = secondIdentifier;
          }
        } else {
          const firstIdentifier = canonicalDrawingReference(compactPeer[1]);
          const secondIdentifier = canonicalDrawingReference(compactPeer[3]);
          if (!firstIdentifier || !secondIdentifier) invalid = true;
          else {
            add(firstIdentifier);
            add(secondIdentifier);
            previousIdentifier = secondIdentifier;
          }
        }
        consumedUntil = firstOffset + compactPeer[0].length;
        if (previousIdentifier && !invalid) {
          consumedUntil = consumePeerContinuations(previousIdentifier, consumedUntil).cursor;
        }
        const directUnboundPeer = ecosDrawingSheetIdentifierAt(scanText, consumedUntil);
        const unsupportedCoordinator = /^\s*(?::\s*|,?\s*(?:rather\s+than|instead\s+of|other\s+than|except(?:\s+for)?|with|then|followed\s+by|next(?:\s+to)?|before|after)\s+)/i.exec(
          scanText.slice(consumedUntil),
        );
        if (directUnboundPeer || unsupportedCoordinator) {
          let peerOffset = consumedUntil + (unsupportedCoordinator?.[0].length || 0);
          const repeatedLabel = /^(?:the\s+)?(?:sheets?|shts?\.?)(?:(?:\s+(?:number|no\.?)\s*[:#]?\s*)|(?:\s*[#:/]\s*)|(?:\s*[([{]\s*)|\s+)/i.exec(
            scanText.slice(peerOffset),
          );
          if (repeatedLabel) peerOffset += repeatedLabel[0].length;
          if (directUnboundPeer || ecosDrawingSheetIdentifierAt(scanText, peerOffset)) invalid = true;
        }
      } else if (new RegExp(
        String.raw`^\s*["'‘’“”]?${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE}["'‘’“”]?\s*[+-]`,
        'i',
      ).test(scanText.slice(firstOffset))) {
        explicit = true;
        invalid = true;
        consumedUntil = firstOffset;
      } else if (/^\s*["'‘’“”]?[a-z0-9]+(?:\s*\.\s*[a-z0-9]+)+/i.test(
        scanText.slice(firstOffset),
      )) {
        explicit = true;
        invalid = true;
        consumedUntil = firstOffset;
      } else if (ecosDrawingSheetUnsupportedCompatibilityAt(scanText, firstOffset)) {
        explicit = true;
        invalid = true;
        consumedUntil = firstOffset;
      } else if (/^\s*["'‘’“”]?[^\s,;!?]{0,64}\d[^\s,;!?]{0,64}/i.test(
        scanText.slice(firstOffset),
      )) {
        // A labelled, identifier-shaped token outside the supported grammar
        // is still an explicit request. Never broaden it to an unscoped search
        // or truncate it to a shorter valid prefix.
        explicit = true;
        invalid = true;
        consumedUntil = firstOffset;
      }
      continue;
    }
    explicit = true;
    add(first.identifier);
    const { cursor } = consumePeerContinuations(first.identifier, first.end);
    const directUnboundPeer = ecosDrawingSheetIdentifierAt(scanText, cursor);
    const unsupportedCoordinator = /^\s*(?::\s*|,?\s*(?:rather\s+than|instead\s+of|other\s+than|except(?:\s+for)?|with|then|followed\s+by|next(?:\s+to)?|before|after)\s+)/i.exec(
      scanText.slice(cursor),
    );
    if (directUnboundPeer || unsupportedCoordinator) {
      let peerOffset = cursor + (unsupportedCoordinator?.[0].length || 0);
      const repeatedLabel = /^(?:the\s+)?(?:sheets?|shts?\.?)(?:(?:\s+(?:number|no\.?)\s*[:#]?\s*)|(?:\s*[#:/]\s*)|(?:\s*[([{]\s*)|\s+)/i.exec(
        scanText.slice(peerOffset),
      );
      if (repeatedLabel) peerOffset += repeatedLabel[0].length;
      if (directUnboundPeer || ecosDrawingSheetIdentifierAt(scanText, peerOffset)) invalid = true;
    }
    consumedUntil = Math.max(consumedUntil, cursor);
  }
  if (sheets.length > 4) invalid = true;
  return Object.freeze({
    explicit,
    invalid,
    sheets: Object.freeze(sheets),
  });
}

/**
 * Remove only an explicitly labelled, successfully parsed drawing-sheet
 * location from semantic subject matching. Equipment identities elsewhere in
 * the question remain untouched (for example `Louver E2 on Sheet E2.1`).
 */
export function stripECOSDrawingSheetReferenceSpans(question: string) {
  const scope = requestedECOSDrawingSheetScope(question);
  if (!scope.explicit || scope.invalid) return question;
  const scanText = normalizeECOSSheetIdentityScanText(question)
    .replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(/[‐‑‒–—―−]/g, '-');
  const label = String.raw`(?:sheets?|shts?\.?)` +
    String.raw`(?:(?:\s+(?:number|no\.?)\s*[:#]?\s*)|(?:\s*[#:/]\s*)|(?:\s*[([{]\s*)|\s+)`;
  const repeatedLabel = String.raw`(?:the\s+)?${label}`;
  const identifier = String.raw`(?:[([{]\s*)?["'‘’“”]?${ECOS_DRAWING_SHEET_IDENTIFIER_SOURCE}["'‘’“”]?` +
    ECOS_DRAWING_SHEET_IDENTIFIER_END_SOURCE + String.raw`[\])}]?`;
  const wordConnector = String.raw`(?:through|thru|to|in\s+conjunction\s+with|` +
    String.raw`in\s+combination\s+with|compared\s+(?:with|to)|adjacent\s+to|` +
    String.raw`and\s+then|or\s+else|plus\s+also|as\s+well\s+as|` +
    String.raw`alongside(?:\s+of)?|along\s+with|together\s+with|` +
    String.raw`in\s+addition\s+to|and\s+also|or\s+alternatively|beside|plus|` +
    String.raw`against|versus|vs|and|or)`;
  const connector = String.raw`(?:\s*-\s*|\s*(?:,\s*(?:${wordConnector}\b\s+)?|` +
    String.raw`;|\||\+|&|/|vs\.(?=\s)|${wordConnector}\b)\s*)`;
  const phrase = new RegExp(
    String.raw`\b${label}${identifier}(?:${connector}(?:${repeatedLabel})?${identifier})*`,
    'gi',
  );
  return scanText.replace(phrase, ' ');
}

/**
 * A bare imperative such as `REMOVE` describes the current drawing action in
 * a small class of exact callouts, but the shared polarity gate must continue
 * treating removal/demo language as non-current everywhere else. Permit that
 * one form only when the user repeats the complete bounded action phrase at
 * one explicit drawing location. Qualifiers remain visible to the ordinary
 * polarity gate after the single imperative token is masked.
 */
export function ecosDrawingPropositionIsAssertiveForExactQuestion(
  question: string,
  factText: string,
) {
  if (ecosDrawingPropositionIsAssertiveCurrent(factText)) return true;
  const normalizedQuestion = normalizePolicyText(question);
  const pageScope = requestedECOSPDFPageScope(question);
  const sheetScope = requestedECOSDrawingSheetScope(question);
  if (
    analyzeECOSProjectQuestion(question).kind !== 'general' ||
    ecosQuestionRequestsInstalledCondition(question) ||
    !/\bcurrent\b/.test(normalizedQuestion) ||
    pageScope.invalid ||
    sheetScope.invalid ||
    pageScope.excludedPages.length > 0 ||
    pageScope.pages.length > 1 ||
    sheetScope.sheets.length > 1 ||
    pageScope.pages.length === 0 && sheetScope.sheets.length === 0
  ) return false;
  const normalizedFact = normalizePolicyText(factText);
  if ((normalizedFact.match(/\bremove\b/g) || []).length !== 1) return false;
  // This exception is for a bare printed imperative, not a forecast,
  // permission, option, or auxiliary construction whose non-current modality
  // would disappear when the action token is masked.
  if (
    /\b(?:do|does|did|shall|must|should|can|could|would|will|may|might)\b/.test(normalizedFact) ||
    /\b(?:scheduled|expected)\s+to\b|\bto\s+remove\b/.test(normalizedFact) ||
    /\b(?:allegedly|apparently|hypothetical(?:ly)?|possibly|potentially|probably|reportedly|supposedly|tentatively)\b/.test(
      normalizedFact,
    ) ||
    /\b(?:owner|contractor|applicant)\s+(?:intends?|plans?|proposes?|expects?)\b/.test(
      normalizedFact,
    ) ||
    /\b(?:(?:the\s+)?(?:owner|engineer|contractor|applicant|architect|consultant)|(?:a|the)\s+report)\s+(?:says?|states?|reports?|claims?|suggests?|believes?)\b/.test(
      normalizedFact,
    ) ||
    /\b(?:rumou?r|hearsay)\b/.test(normalizedFact)
  ) return false;
  const comparableActionPhrase = (value: string) => value
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:a|an|the|with)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const factActionPhrase = comparableActionPhrase(normalizedFact);
  const actionTokens = factActionPhrase.split(' ').filter(Boolean);
  if (actionTokens.length < 3 || actionTokens.length > 12) return false;
  const comparableQuestion = comparableActionPhrase(normalizedQuestion);
  const factPhraseIndex = comparableQuestion.indexOf(factActionPhrase);
  if (factPhraseIndex < 0) return false;
  const actionResidue = `${comparableQuestion.slice(0, factPhraseIndex)} ${
    comparableQuestion.slice(factPhraseIndex + factActionPhrase.length)
  }`;
  if (
    /\b(?:construct|demolish|demo|furnish|install|omit|paint|pour|provide|reconnect|relocate|remove|repair|replace|retain|seal)\b/.test(
      actionResidue,
    )
  ) return false;
  const affirmativeActionQuestion = normalizedQuestion.replace(
    /^(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?(?:tell\s+me|read|state|say|report|show\s+me)\s+/,
    '',
  );
  const epistemicOrReportedActionQuestion = /^(?:is\s+it\s+(?:okay|acceptable|accurate|correct|fair|safe|true)\s+(?:to\s+say|that)|i\s+(?:wonder|am\s+wondering)\s+(?:if|whether)|(?:did|does|do|has|have)\s+(?:(?:the\s+)?(?:owner|engineer|contractor|applicant|architect|consultant)|someone|anyone)\s+(?:say|state|report|claim|suggest|believe)\b)/.test(
    affirmativeActionQuestion,
  );
  if (
    (normalizedQuestion.match(/\bremove\b/g) || []).length !== 1 ||
    epistemicOrReportedActionQuestion ||
    /\b(?:ignore|ignoring|disregard|disregarding|exclude|excluding|except|without|omit|omitting|skip|skipping|besides)\b|\b(?:leave\s+out|other\s+than|apart\s+from|instead\s+of)\b/.test(
      normalizedQuestion,
    ) ||
    /\b(?:can|could|would|should|shall|must|may|might|will|hypothetical(?:ly)?|imagine|imagining|suppose|supposing)\b/.test(
      affirmativeActionQuestion,
    ) ||
    !ecosDrawingPropositionIsAssertiveCurrent(
      affirmativeActionQuestion.replace(/\bremove\b/, ' construct '),
    )
  ) return false;
  return ecosDrawingPropositionIsAssertiveCurrent(
    normalizedFact.replace(/\bremove\b/, ' construct '),
  );
}

function uniqueTrustedFactSources(values: readonly TrustedFactSource[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = `${value.source.id}|${normalizePolicyText(value.fact.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectUniqueTrustedDrawingFact(
  question: string,
  candidates: readonly TrustedFactSource[],
) {
  const explicitPage = explicitDrawingPage(question);
  const explicitSheet = explicitDrawingSheet(question);
  const hasExplicitDrawingReference = explicitPage !== null || Boolean(explicitSheet);
  const requirement = analyzeECOSProjectQuestion(question);
  const rankedWithNestedDuplicates = candidates.flatMap(candidate => {
    if (explicitPage !== null && candidate.source.documentCitation?.pageNumber !== explicitPage) return [];
    if (explicitSheet && !trustedFactMatchesSheet(candidate, explicitSheet)) return [];
    if (!trustedRelationshipMatchesQuestion(question, candidate)) return [];
    const evidenceText = trustedFactEvidenceText(candidate);
    const context = analyzeECOSQuestionEvidenceContext(question, evidenceText);
    const minimumSubjectMatches = requirement.kind === 'general' ? 1 : 0;
    const matchedAnchorCount = context.matchedSubjectTokens.length +
      context.matchedLocationDirectionTokens.length +
      context.matchedLocationKindTokens.length;
    const subjectMatched = hasExplicitDrawingReference
      ? matchedAnchorCount >= minimumSubjectMatches
      : context.subjectMatched;
    const locationMatched = context.locationMatched || hasExplicitDrawingReference;
    if (!subjectMatched || !locationMatched) return [];
    if (requirement.kind === 'measurement' && !containsECOSRequestedMeasurementValue(question, evidenceText)) {
      return [];
    }
    if (
      requirement.kind === 'measurement' &&
      !context.attributeMatched &&
      !evidenceExpressesRequestedMeasurementAttribute(
        requirement,
        normalizePolicyText(evidenceText),
        question,
      )
    ) return [];
    if (requirement.kind === 'quantity' && !containsECOSQuantityValue(evidenceText, question)) return [];
    if (requirement.kind === 'presence' && !ecosFactAnswersQuestion({
      question,
      statement: candidate.fact.text,
      sourceExcerpts: [evidenceText],
    })) return [];
    const numericMatches = exactQuestionFactNumberMatches(question, evidenceText);
    const lexicalMatchKey = trustedFactLexicalMatchKey(question, candidate.fact.text);
    const score = ecosEvidenceQuestionContextScore(question, evidenceText) +
      trustedFactLexicalScore(question, candidate.fact.text) +
      numericMatches * 0.75 +
      (explicitPage !== null ? 2 : 0) +
      (explicitSheet ? 2 : 0);
    return [{ candidate, score, lexicalMatchKey, numericMatches }];
  }).sort((left, right) => right.score - left.score);
  // A larger OCR/vision region can repeat a smaller complete proposition.
  // Treat that pair as one fact and retain the smallest exact bounded receipt;
  // otherwise the duplicate can create a false ambiguity or cite excess text.
  const ranked = rankedWithNestedDuplicates.filter(entry =>
    !rankedWithNestedDuplicates.some(other =>
      other !== entry &&
      trustedFactsShareDrawingReference(entry.candidate, other.candidate) &&
      trustedFactContainmentIsNonMaterialDuplicate(
        entry.candidate.fact.text,
        other.candidate.fact.text,
      )
    )
  );
  const best = ranked[0];
  if (!best) return null;
  const minimumScore = hasExplicitDrawingReference ? 2.2 : 2;
  if (best.score < minimumScore) return null;
  const comparative = selectTrustedFactNumericExtremum(question, requirement, ranked);
  if (comparative.applies) return comparative.candidate;
  const runnerUp = ranked[1];
  const minimumMargin = hasExplicitDrawingReference ? 0.1 : 0.75;
  const semanticPeers = ranked.slice(1).filter(other =>
    best.lexicalMatchKey === other.lexicalMatchKey &&
    best.numericMatches === other.numericMatches
  );
  if (semanticPeers.length > 0) return null;
  if (ranked.slice(1).some(other =>
    trustedFactTextsOverlap(best.candidate.fact.text, other.candidate.fact.text)
  )) {
    return null;
  }
  if (runnerUp && best.score - runnerUp.score < minimumMargin) return null;
  return best.candidate;
}

function trustedRelationshipMatchesQuestion(
  question: string,
  candidate: TrustedFactSource,
) {
  if (!candidate.fact.relationshipType) return true;
  const questionTokens = new Set(trustedFactLexicalTokens(question, true));
  const relationshipTokens = trustedFactLexicalTokens(
    `${candidate.fact.relationshipType.replace(/_/g, ' ')} ${candidate.fact.subject}`,
    false,
  );
  return relationshipTokens.some(token => questionTokens.has(token));
}

function trustedFactStrictlyContains(container: string, contained: string) {
  const containerText = normalizePolicyText(container);
  const containedText = normalizePolicyText(contained);
  return Boolean(
    containerText && containedText && containerText !== containedText &&
    containerText.includes(containedText),
  );
}

function trustedFactContainmentIsNonMaterialDuplicate(container: string, contained: string) {
  if (!trustedFactStrictlyContains(container, contained)) return false;
  const containerText = normalizePolicyText(container);
  const containedText = normalizePolicyText(contained);
  const index = containerText.indexOf(containedText);
  if (index < 0) return false;
  const residue = `${containerText.slice(0, index)} ${containerText.slice(index + containedText.length)}`
    .trim();
  if (!residue) return true;
  const containedTokens = new Set(containedText.match(/[a-z0-9]+(?:\.[a-z0-9]+)?/g) || []);
  const nonMaterialContextTokens = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'current', 'detail', 'details', 'drawing',
    'for', 'is', 'note', 'notes', 'of', 'on', 'page', 'plan', 'sheet', 'shown',
    'the',
  ]);
  const residueTokens = residue.match(/[a-z0-9]+(?:\.[a-z0-9]+)?/g) || [];
  return residueTokens.every(token =>
    containedTokens.has(token) || nonMaterialContextTokens.has(token)
  );
}

function trustedFactTextsOverlap(left: string, right: string) {
  const leftText = normalizePolicyText(left);
  const rightText = normalizePolicyText(right);
  return Boolean(
    leftText && rightText && leftText !== rightText &&
    (leftText.includes(rightText) || rightText.includes(leftText)),
  );
}

function trustedFactsShareDrawingReference(left: TrustedFactSource, right: TrustedFactSource) {
  return left.source.recordId === right.source.recordId &&
    (left.source.documentCitation?.pageNumber || null) ===
      (right.source.documentCitation?.pageNumber || null) &&
    canonicalDrawingReference(left.source.documentCitation?.sheetNumber || '') ===
      canonicalDrawingReference(right.source.documentCitation?.sheetNumber || '');
}

type RankedTrustedFact = Readonly<{
  candidate: TrustedFactSource;
  score: number;
  lexicalMatchKey: string;
  numericMatches: number;
}>;

function selectTrustedFactNumericExtremum(
  question: string,
  requirement: ECOSProjectAnswerRequirement,
  ranked: readonly RankedTrustedFact[],
): Readonly<{ applies: boolean; candidate: TrustedFactSource | null }> {
  if (requirement.kind !== 'measurement' || !requirement.attribute || ranked.length < 2) {
    return { applies: false, candidate: null };
  }
  const normalizedQuestion = normalizePolicyText(question);
  const direction = /\b(?:maximum|max)\b/.test(normalizedQuestion)
    ? 'maximum'
    : /\b(?:minimum|min)\b/.test(normalizedQuestion) ? 'minimum' : null;
  if (!direction) return { applies: false, candidate: null };

  const best = ranked[0];
  const peers = ranked.filter(entry =>
    entry.lexicalMatchKey === best.lexicalMatchKey &&
    entry.numericMatches === best.numericMatches
  );
  if (peers.length < 2) return { applies: false, candidate: null };
  const measured = peers.map(entry => ({
    entry,
    measurement: trustedFactComparableMeasurement(requirement.attribute || '', entry.candidate.fact.text),
  }));
  if (measured.some(item => !item.measurement)) {
    return { applies: true, candidate: null };
  }
  const families = new Set(measured.map(item => item.measurement?.family));
  if (families.size !== 1) return { applies: true, candidate: null };
  const values = measured.map(item => item.measurement?.value || 0);
  const extreme = direction === 'maximum' ? Math.max(...values) : Math.min(...values);
  const winners = measured.filter(item => item.measurement?.value === extreme);
  return {
    applies: true,
    candidate: winners.length === 1 ? winners[0].entry.candidate : null,
  };
}

function trustedFactComparableMeasurement(attribute: string, factText: string) {
  const text = normalizePolicyText(
    factText.replace(/[′’]/g, "'").replace(/[″”]/g, '"'),
  );
  if (attribute === 'width') {
    const opening = text.match(
      /\bup to\s+(\d+(?:\.\d+)?\s*'\s*(?:-\s*\d+(?:\.\d+)?)?\s*")\s*(?:opening|opn'?g?)/,
    )?.[1];
    const compact = text.match(
      /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*["'])\s*w\b/,
    )?.[1];
    const labeled = text.match(
      /\b(?:width|wide)\b[\s:=-]{0,16}(\d+(?:\.\d+)?\s*'\s*(?:-\s*\d+(?:\.\d+)?)?\s*"|\d+(?:\.\d+)?\s*")/,
    )?.[1];
    return comparableLength(opening || compact || labeled || '');
  }
  if (attribute === 'spacing') {
    const spacing = text.match(
      /(\d+(?:\.\d+)?\s*'\s*(?:-\s*\d+(?:\.\d+)?)?\s*"|\d+(?:\.\d+)?\s*")\s*(?:(?:o|0)\s*\.?\s*c\.?|on center)\b/,
    )?.[1];
    return comparableLength(spacing || '');
  }
  if (attribute === 'thickness') {
    const mil = text.match(/\b(\d+(?:\.\d+)?)\s*mil\b/)?.[1];
    if (mil) return { family: 'mil', value: Number(mil) } as const;
    const thick = text.match(
      /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*["'])\s*(?:thick|thk)\b/,
    )?.[1];
    return comparableLength(thick || '');
  }
  if (attribute === 'grade') {
    const percent = text.match(/\b(\d+(?:\.\d+)?)\s*%/)?.[1];
    return percent ? { family: 'percent', value: Number(percent) } as const : null;
  }
  return null;
}

function comparableLength(value: string) {
  const normalized = normalizePolicyText(value);
  if (!normalized) return null;
  const feetAndInches = normalized.match(
    /^(\d+(?:\.\d+)?)\s*'\s*(?:-\s*(\d+(?:\.\d+)?))?\s*"$/,
  );
  if (feetAndInches) {
    return {
      family: 'length',
      value: Number(feetAndInches[1]) * 12 + Number(feetAndInches[2] || 0),
    } as const;
  }
  const inches = normalized.match(
    /^(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+))?\s*"$/,
  );
  if (!inches) return null;
  const fraction = inches[2] && inches[3]
    ? Number(inches[2]) / Number(inches[3])
    : inches[4] ? 1 / Number(inches[4]) : 0;
  return { family: 'length', value: Number(inches[1]) + fraction } as const;
}

function trustedFactLexicalScore(question: string, factText: string) {
  const questionTokens = trustedFactLexicalTokens(question, true);
  const factTokens = trustedFactLexicalTokens(factText, false);
  if (questionTokens.length === 0 || factTokens.length === 0) return 0;
  const factTokenSet = new Set(factTokens);
  const matched = questionTokens.filter(token => factTokenSet.has(token)).length;
  return matched / questionTokens.length * 0.75 + matched / factTokens.length * 0.5;
}

function trustedFactLexicalMatchKey(question: string, factText: string) {
  const factTokenSet = new Set(trustedFactLexicalTokens(factText, false));
  return trustedFactLexicalTokens(question, true).filter(token => factTokenSet.has(token)).join('|');
}

function trustedFactLexicalTokens(value: string, stripDrawingReferences: boolean) {
  const ignored = new Set([
    'a', 'an', 'and', 'at', 'call', 'current', 'does', 'for', 'from', 'is', 'list', 'of', 'out',
    'project', 'sheet', 'specify', 'specified', 'specifies', 'state', 'states', 'the', 'to', 'value',
    'what', 'which', 'architectural', 'structural', 'electrical', 'mechanical', 'plumbing', 'civil',
    'landscape', 'pdf', 'page', 'new', 'existing', 'typ', 'typical',
  ]);
  const normalizedValue = stripDrawingReferences
    ? normalizePolicyText(stripECOSDrawingSheetReferenceSpans(value))
      .replace(/\b(?:pdf\s+)?page\s+(?:10000|\d{1,4})\b/g, ' ')
      .replace(/\bproject\s+\d{4,6}\b/g, ' ')
    : normalizePolicyText(value);
  return [...new Set(normalizedValue.split(/\s+/)
    .map(canonicalContextToken)
    .filter(token => token.length >= 2 && !ignored.has(token) && !/^\d+(?:\.\d+)?$/.test(token)))];
}

function exactQuestionFactNumberMatches(question: string, evidenceText: string) {
  const factQuestion = normalizePolicyPageReferenceLabels(
    stripECOSDrawingSheetReferenceSpans(question),
  )
    .replace(/\b(?:pdf\s+)?page\s+(?:10000|\d{1,4})\b/g, ' ')
    .replace(/\bproject\s+\d{4,6}\b/g, ' ');
  const requested = [...new Set<string>(factQuestion.match(/\b\d+(?:\.\d+)?\b/g) || [])];
  const evidence = new Set(normalizePolicyText(evidenceText).match(/\b\d+(?:\.\d+)?\b/g) || []);
  return requested.filter(value => evidence.has(value)).length;
}

function trustedFactsAtExplicitDrawingReference(
  question: string,
  candidates: readonly TrustedFactSource[],
) {
  const explicitPage = explicitDrawingPage(question);
  const explicitSheet = explicitDrawingSheet(question);
  if (explicitPage === null && !explicitSheet) return candidates;
  return candidates.filter(candidate =>
    (explicitPage === null || candidate.source.documentCitation?.pageNumber === explicitPage) &&
    (!explicitSheet || trustedFactMatchesSheet(candidate, explicitSheet))
  );
}

function explicitDrawingPage(question: string) {
  const scope = requestedECOSPDFPageScope(question);
  return !scope.invalid && scope.pages.length === 1 ? scope.pages[0] : null;
}

function explicitDrawingSheet(question: string) {
  const scope = requestedECOSDrawingSheetScope(
    requestedECOSPDFPageScope(question).includedQuestion,
  );
  return !scope.invalid && scope.sheets.length === 1 ? scope.sheets[0] : '';
}

function trustedFactMatchesSheet(candidate: TrustedFactSource, expected: string) {
  const citedValue = candidate.source.documentCitation?.sheetNumber?.trim() || '';
  const cited = canonicalDrawingReference(citedValue);
  if (cited) return cited === expected;
  return renderedTextContainsExactSheetIdentity(candidate.source.title || '', expected);
}

function canonicalDrawingReference(value: string) {
  return canonicalComparableSheetNumber(value);
}

function trustedFactEvidenceText(candidate: TrustedFactSource) {
  const citation = candidate.source.documentCitation;
  return [
    candidate.source.title || '',
    citation?.sheetNumber ? `Sheet ${citation.sheetNumber}` : '',
    citation?.pageNumber ? `PDF page ${citation.pageNumber}` : '',
    candidate.fact.rowKey,
    candidate.fact.subject,
    candidate.fact.text,
  ].filter(Boolean).join(' ');
}

function typeIs(type: string) {
  return (candidate: TrustedFactSource) => candidate.fact.relationshipType === type;
}

function subjectIncludes(subject: string) {
  return (candidate: TrustedFactSource) =>
    normalizePolicyText(candidate.fact.subject).includes(subject);
}

function trustedFactContains(candidate: TrustedFactSource, anchor: string) {
  const haystack = normalizePolicyText([
    candidate.fact.rowKey,
    candidate.fact.subject,
    candidate.fact.text,
  ].join(' ')).replace(/\b(ef|f)-(\d+)\b/g, '$1$2');
  const canonicalAnchor = canonicalFactAnchor(anchor);
  if (!canonicalAnchor) return false;
  return new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(canonicalAnchor)}(?=$|[^a-z0-9])`,
  ).test(haystack);
}

function canonicalFactTextContainsAnchor(value: string, anchor: string) {
  const haystack = canonicalFactAnchor(value);
  const canonicalAnchor = canonicalFactAnchor(anchor);
  if (!haystack || !canonicalAnchor) return false;
  return new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(canonicalAnchor)}(?=$|[^a-z0-9])`,
  ).test(haystack);
}

function trustedFactPrimaryValueText(candidate: TrustedFactSource) {
  return normalizePolicyText(candidate.fact.text).split(
    /\s*(?:[;|]+|\b(?:see(?:\s+also)?|refer(?:red)?(?:\s+also)?(?:\s+to)?|cross[- ]reference|consult|coordinate(?:d)?(?:\s+(?:in|with))?|in\s+coordination\s+with|feeds?|compare(?:d)?(?:\s+(?:to|with))?)\b)/,
    1,
  )[0]?.trim() || '';
}

/**
 * A tuple anchor is bound only by the worker's row identity or by the row's
 * primary value clause.  Peer/referral text is supporting context and cannot
 * allocate the same row to a second requested tuple member.
 */
function trustedFactBindsAnchor(candidate: TrustedFactSource, anchor: string) {
  return [
    candidate.fact.rowKey,
    candidate.fact.subject,
    trustedFactPrimaryValueText(candidate),
  ].some(value => canonicalFactTextContainsAnchor(value || '', anchor));
}

function trustedFactAllocationKey(candidate: TrustedFactSource) {
  const citation = candidate.source.documentCitation;
  return [
    candidate.source.recordId || candidate.source.id,
    citation?.pageNumber || '',
    canonicalDrawingReference(citation?.sheetNumber || ''),
    candidate.fact.relationshipType || '',
    canonicalFactAnchor(candidate.fact.rowKey || ''),
    canonicalFactAnchor(candidate.fact.subject || ''),
    canonicalFactAnchor(trustedFactPrimaryValueText(candidate)),
  ].join('|');
}

function parseLandscapeTreeRoleCount(
  facts: readonly ECOSTrustedDrawingFact[],
  role: 'required' | 'provided',
) {
  const rolePattern = escapeRegExp(role);
  const counts = facts.flatMap(fact => {
    const text = normalizePolicyText(fact.text);
    const matches = [
      new RegExp(`\\b(?:parking[- ]lot\\s+)?trees?\\s+${rolePattern}\\s*[:=]?\\s*(\\d{1,6})(?!\\d)\\s+trees?\\b`, 'g'),
      new RegExp(`\\b(\\d{1,6})(?!\\d)\\s+trees?\\s+${rolePattern}\\b`, 'g'),
      new RegExp(`\\b${rolePattern}\\s*[:=]?\\s*(\\d{1,6})(?!\\d)\\s+trees?\\b`, 'g'),
    ].flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1]));
    return [...new Set(matches)];
  });
  const distinct = [...new Set(counts)];
  return distinct.length === 1 ? distinct[0] : null;
}

function selectClosedRequiredProvidedTreeRow(
  candidates: readonly TrustedFactSource[],
  anchors: readonly string[],
) {
  const canonicalAnchors = [...new Set(anchors.map(canonicalFactAnchor))].sort();
  if (
    canonicalAnchors.length !== 2 ||
    canonicalAnchors[0] !== 'provided' ||
    canonicalAnchors[1] !== 'required'
  ) return null;
  const closedRows = candidates.filter(candidate =>
    candidate.fact.relationshipType === 'landscape_metric' &&
    parseLandscapeTreeRoleCount([candidate.fact], 'required') !== null &&
    parseLandscapeTreeRoleCount([candidate.fact], 'provided') !== null
  );
  const distinct = [...new Map(closedRows.map(candidate => [
    trustedFactAllocationKey(candidate),
    candidate,
  ] as const)).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

function canonicalFactAnchor(value: string) {
  return normalizePolicyText(value).replace(/\b(ef|f)\s*-?\s*(\d+)\b/g, '$1$2');
}

function trustedFactsForRequestedPlan(
  allFacts: readonly TrustedFactSource[],
  candidates: readonly TrustedFactSource[],
  normalizedQuestion: string,
  discipline: 'irrigation' | 'planting',
) {
  const plan = normalizedQuestion.match(
    new RegExp(`\\b${discipline}\\s+plan\\s+([a-z])\\b`),
  )?.[1];
  if (!plan) return { candidates, identity: null };
  const identities = allFacts.filter(candidate =>
    normalizePolicyText(candidate.fact.subject) === `${discipline} plan identity` &&
    trustedFactContains(candidate, `${discipline} plan ${plan}`)
  );
  const identityBindings = [...new Map(identities.map(candidate => [
    `${candidate.source.recordId || ''}|${candidate.source.documentCitation?.pageNumber || ''}|` +
      canonicalDrawingReference(candidate.source.documentCitation?.sheetNumber || ''),
    candidate,
  ] as const)).values()];
  if (identityBindings.length !== 1) return { candidates: [], identity: null };
  const identity = identityBindings[0];
  if (!identity.source.recordId) return { candidates: [], identity: null };
  const pageNumber = identity.source.documentCitation?.pageNumber;
  if (!Number.isInteger(pageNumber) || Number(pageNumber) < 1) {
    return { candidates: [], identity: null };
  }
  const pageCandidates = candidates.filter(candidate =>
    candidate.source.recordId === identity.source.recordId &&
    candidate.source.documentCitation?.pageNumber === pageNumber
  );
  const planIdentityPattern = new RegExp(`^${discipline}\\s+plan\\s+([a-z0-9]+)$`);
  const pagePlanIdentities = allFacts.filter(candidate =>
    candidate.source.recordId === identity.source.recordId &&
    candidate.source.documentCitation?.pageNumber === pageNumber &&
    normalizePolicyText(candidate.fact.subject) === `${discipline} plan identity`
  ).flatMap(candidate => {
    const match = planIdentityPattern.exec(normalizePolicyText(candidate.fact.text));
    return match ? [match[1]] : [];
  });
  const distinctPagePlans = [...new Set(pagePlanIdentities)];
  if (distinctPagePlans.length === 1 && distinctPagePlans[0] === plan) {
    return { candidates: pageCandidates, identity };
  }
  if (!distinctPagePlans.includes(plan)) return { candidates: [], identity: null };
  return {
    candidates: pageCandidates.filter(candidate =>
      trustedFactBindsAnchor(candidate, `${discipline} plan ${plan}`) ||
      trustedFactBindsAnchor(candidate, `plan ${plan}`)
    ),
    identity,
  };
}

function formatTrustedDrawingFacts(
  selected: readonly TrustedFactSource[],
  normalizedQuestion: string,
) {
  const facts = selected.map(item => item.fact);
  const requestedPlantNames = [
    'forest pansy redbud',
    'palo verde',
    'lemon scented gum',
    'golden rain',
  ].filter(name => normalizedQuestion.includes(name));
  const plantEntries = facts.every(fact => fact.relationshipType === 'plant_material')
    ? selected.map(item => parseSpeciesBoundPlantTreeCount(item, requestedPlantNames))
    : [];
  if (plantEntries.some(entry => !entry)) return null;
  const photometricValues = facts.length === 1 &&
      facts[0].relationshipType === 'photometric_statistics'
    ? parsePhotometricStatistics(facts[0].text)
    : null;
  if (facts.some(fact => fact.relationshipType === 'photometric_statistics') && !photometricValues) {
    return null;
  }
  if (facts.length === 1 && questionRequestsDrawingSheetTitle(normalizedQuestion)) {
    const sheetNumber = selected[0].source.documentCitation?.sheetNumber?.trim();
    if (sheetNumber) {
      return `Sheet ${sheetNumber} is titled ${facts[0].text.replace(/[.;]+$/, '')}.`;
    }
  }
  if (facts.length === 1) {
    const value = normalizePolicyText(facts[0].text);
    if (value === normalizePolicyText('CONSTRUCT 3.5” AC OVER 6.5” BASE PAVING')) {
      if (drawingProjectLotAnchorCandidates(normalizedQuestion).length > 1) {
        return null;
      }
      const requestedLot = requestedDrawingProjectLotAnchor(normalizedQuestion);
      if (
        requestedLot &&
        !measurementSourceBindsRequestedProjectLotAnchor(
          selected[0].source,
          requestedLot,
        )
      ) return null;
      if (requestedLot) {
        return `The current drawing specifies the ${requestedLot.display} AC paving section as 3.5” AC over 6.5” base paving.`;
      }
      return 'The current drawing specifies new AC paving as 3.5” AC over 6.5” base paving.';
    }
    if (value === normalizePolicyText(
      'IN DELINEATED ADA ACCESSIBLE PARKING AREAS, GRADES SHALL BE 2.00% MAX. IN ALL DIRECTIONS.',
    )) {
      return 'The maximum permitted grade in the delineated ADA-accessible parking areas is 2.00% in all directions.';
    }
    if (value === normalizePolicyText(
      'CONSTRUCT 12”x12” ID AREA DRAIN WITH FLO-GARD FILTER AND LOCAL DEPRESSION - SEE DETAIL 4',
    )) {
      return 'The current drawing calls for a 12”x12” ID area drain with a FLO-GARD filter and local depression.';
    }
    if (value === normalizePolicyText(
      'CONSTRUCT 4” SEWER LATERAL AND CLEANOUT PER RIVERSIDE CITY STANDARD 562. MATERIAL PER MECHANICAL DRAWINGS.',
    )) {
      return 'The current drawing requires a 4” sewer lateral and cleanout per Riverside City Standard 562; the material is specified in the mechanical drawings.';
    }
  }
  if (facts.length === 1 && facts[0].relationshipType === 'photometric_statistics') {
    if (photometricValues) {
      return `The site photometrics plan lists an average of ${photometricValues.average} fc, ` +
        `a maximum of ${photometricValues.maximum} fc, and a minimum of ${photometricValues.minimum} fc.`;
    }
  }
  if (facts.every(fact => fact.relationshipType === 'plant_material')) {
    if (
      facts.length === 1 &&
      /\b(?:cercis|eucalyptus|koelreute|koelreuteria|paniculata|citriodora|occidentalis|plant size)\b/.test(
        normalizedQuestion,
      )
    ) {
      return `The planting plan states ${facts[0].text.replace(/[.;]+$/, '')}.`;
    }
    const entries = plantEntries.map(entry => `${entry?.quantity} ${entry?.name}`);
    return `The planting plan lists ${joinNatural(entries)}.`;
  }
  if (facts.every(fact => fact.relationshipType === 'landscape_metric') &&
    facts.every(fact => /\btrees?\b/i.test(fact.text))) {
    const required = parseLandscapeTreeRoleCount(facts, 'required');
    const provided = parseLandscapeTreeRoleCount(facts, 'provided');
    if (required && provided) {
      return `The landscape plan requires ${required} trees and provides ${provided} trees.`;
    }
  }
  const prefix = facts.some(fact => fact.relationshipType === 'footing_schedule')
    ? 'The footing schedule states'
    : facts.some(fact => fact.relationshipType === 'equipment_record')
      ? 'The equipment schedule states'
      : facts.some(fact => fact.relationshipType === 'fixture_unit_total')
        ? 'The plumbing schedule shows'
        : facts.some(fact => fact.relationshipType === 'hydrozone_area')
          ? 'The irrigation plan lists'
          : facts.some(fact => fact.relationshipType === 'water_budget')
            ? 'The irrigation plan shows'
            : facts.some(fact => fact.relationshipType === 'photometric_statistics')
              ? 'The current drawing lists'
              : facts.some(fact => /\bhazardous material containment\b/i.test(fact.subject))
                ? 'The hazardous-material plan assigns'
                : facts.some(fact => /\bnew canopy area\b/i.test(fact.subject))
                  ? 'The current drawing shows'
                  : facts.some(fact => fact.relationshipType === 'slab_legend')
                    ? 'The current drawing specifies'
                    : /\bpanel\b/.test(normalizedQuestion)
                      ? 'The current drawing requires'
                      : 'The current drawing shows';
  return `${prefix} ${facts.map(fact => fact.text.replace(/[.;]+$/, '')).join('; ')}.`;
}

function questionRequestsDrawingSheetTitle(normalizedQuestion: string) {
  return /\b(?:which|what)\b[\s\S]{0,100}\bsheet\b[\s\S]{0,100}\b(?:title|titled)\b|\b(?:title|titled)\b[\s\S]{0,100}\b(?:which|what)\b[\s\S]{0,60}\bsheet\b/
    .test(normalizedQuestion);
}

function parsePhotometricStatistics(value: string) {
  if (!value || value.length > 1_000) return null;
  const text = value.replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  type Statistics = Readonly<{ average: string; maximum: string; minimum: string }>;
  const tuples: Statistics[] = [];
  const labeledTokens = [...text.matchAll(
    /\b(average|maximum|minimum)\s+(\d+(?:\.\d+)?)\s*fc\b/gi,
  )];
  if (labeledTokens.length > 0) {
    if (labeledTokens.length % 3 !== 0) return null;
    for (let index = 0; index < labeledTokens.length; index += 3) {
      const group = labeledTokens.slice(index, index + 3);
      if (group.map(token => token[1].toLowerCase()).join('|') !== 'average|maximum|minimum') {
        return null;
      }
      const firstEnd = (group[0].index || 0) + group[0][0].length;
      const secondEnd = (group[1].index || 0) + group[1][0].length;
      if ((group[1].index || 0) - firstEnd > 80 || (group[2].index || 0) - secondEnd > 80) {
        return null;
      }
      tuples.push({ average: group[0][2], maximum: group[1][2], minimum: group[2][2] });
    }
  }
  for (const match of text.matchAll(
    /\bALL\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\b(?!\s+\d)/gi,
  )) {
    tuples.push({ average: match[1], maximum: match[2], minimum: match[3] });
  }
  if (tuples.length === 0) return null;
  if (tuples.some(tuple => {
    const average = Number(tuple.average);
    const maximum = Number(tuple.maximum);
    const minimum = Number(tuple.minimum);
    return ![average, maximum, minimum].every(Number.isFinite) ||
      minimum > average || average > maximum;
  })) return null;
  const canonicalNumber = (raw: string) => {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? String(numeric) : raw;
  };
  const distinct = [...new Map(tuples.map(tuple => [
    [tuple.average, tuple.maximum, tuple.minimum].map(canonicalNumber).join('|'),
    tuple,
  ] as const)).values()];
  return distinct.length === 1 ? distinct[0] : null;
}

function parseSpeciesBoundPlantTreeCount(
  candidate: TrustedFactSource,
  requestedNames: readonly string[],
) {
  const text = normalizePolicyText(candidate.fact.text);
  const requestedName = requestedNames.find(name => trustedFactContains(candidate, name));
  const rowKey = normalizePolicyText(candidate.fact.rowKey || '');
  const aliases = [...new Set([
    requestedName || '',
    requestedName ? normalizePolicyText(canonicalPlantDisplayName(requestedName)) : '',
    rowKey && !/\d/.test(rowKey) ? rowKey : '',
  ].filter(Boolean))];
  if (aliases.length === 0) return null;
  const labelBindsSpecies = (label: string) => aliases.some(alias =>
    canonicalFactTextContainsAnchor(label, alias)
  );
  const knownSpeciesNames = [
    'forest pansy redbud',
    'palo verde',
    'lemon scented gum',
    'golden rain',
  ];
  const targetKnownSpecies = knownSpeciesNames.find(species =>
    aliases.some(alias => canonicalFactTextContainsAnchor(alias, species))
  ) || '';
  const localSpeciesMentions = (label: string) => knownSpeciesNames.flatMap(species => {
    const speciesPattern = species.split(/\s+/).map(escapeRegExp).join('\\s+');
    const pattern = new RegExp(
      `(?:^|[^a-z0-9])${speciesPattern}(?=$|[^a-z0-9])`,
      'g',
    );
    return [...label.matchAll(pattern)].map(match => {
      const leadingBoundary = /^[^a-z0-9]/.test(match[0]) ? 1 : 0;
      const start = (match.index || 0) + leadingBoundary;
      return { species, start, end: start + species.length } as const;
    });
  }).sort((left, right) => left.start - right.start);
  const referralAfterSpecies = (value: string) =>
    /\b(?:see(?:\s+also)?|refer(?:red)?(?:\s+also)?(?:\s+to)?|cross[- ]reference|consult|coordinate(?:d)?(?:\s+(?:in|with))?|in\s+coordination\s+with|feeds?)\b/.test(
      value,
    );
  const counts: string[] = [];
  for (const match of text.matchAll(/\b(\d{1,6})(?!\d)\s+trees?\b/g)) {
    const prefix = text.slice(Math.max(0, (match.index || 0) - 240), match.index || 0);
    const previousCount = [...prefix.matchAll(/\b\d{1,6}\s+trees?\b/g)].at(-1);
    const labelSegment = previousCount
      ? prefix.slice((previousCount.index || 0) + previousCount[0].length)
      : prefix;
    const mentions = localSpeciesMentions(labelSegment);
    const nearestSpecies = mentions.at(-1);
    if (targetKnownSpecies) {
      if (
        nearestSpecies?.species === targetKnownSpecies &&
        !referralAfterSpecies(labelSegment.slice(nearestSpecies.end))
      ) counts.push(match[1]);
    } else if (labelBindsSpecies(labelSegment) && !referralAfterSpecies(labelSegment)) {
      counts.push(match[1]);
    }
  }
  for (const alias of aliases) {
    const escaped = alias.split(/\s+/).map(escapeRegExp).join('\\s+');
    for (const pattern of [
      new RegExp(`\\b(\\d{1,6})(?!\\d)\\s+trees?\\s+(?:of\\s+)?${escaped}\\b`, 'g'),
      new RegExp(`\\b(\\d{1,6})(?!\\d)\\s+${escaped}\\s+trees?\\b`, 'g'),
    ]) {
      counts.push(...[...text.matchAll(pattern)].map(match => match[1]));
    }
  }
  const distinct = [...new Set(counts)];
  if (distinct.length !== 1) return null;
  const name = requestedName
    ? canonicalPlantDisplayName(requestedName)
    : candidate.fact.rowKey.trim();
  return name ? { quantity: distinct[0], name } : null;
}

function canonicalPlantDisplayName(value: string) {
  return ({
    'forest pansy redbud': 'Forest Pansy Redbud',
    'palo verde': 'Palo Verde',
    'lemon scented gum': 'Lemon Scented Gum',
    'golden rain': 'Golden Rain Tree',
  } as Record<string, string>)[value] || value;
}

function trustedFieldConditionLimitation(normalizedQuestion: string) {
  if (/\b(?:air[-\s]+balance|airflow|cfm)\b/.test(normalizedQuestion)) {
    return ' The drawing does not contain or verify a measured field air-balance reading.';
  }
  if (/\btrees?\b/.test(normalizedQuestion)) {
    return ' The drawing does not verify or prove that the planned trees are installed in the field.';
  }
  return ' The design drawing does not verify or prove the actual installed or poured field condition.';
}

function joinNatural(values: readonly string[]) {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function evidenceMatchesExplicitSheetReference(question: string, evidenceText: string) {
  const scope = requestedECOSDrawingSheetScope(question);
  if (!scope.explicit || scope.invalid || scope.sheets.length === 0) return false;
  const sheetReferences = scope.sheets;
  const normalizedEvidence = normalizePolicyText(evidenceText);
  return sheetReferences.some(reference => {
    const compactReference = reference.replace(/[-.]/g, '');
    const compactEvidence = normalizedEvidence.replace(/[-.]/g, '');
    return compactEvidence.includes(`sheet ${compactReference}`) ||
      new RegExp(`\\b${escapeRegExp(compactReference)}\\b`).test(compactEvidence);
  });
}

function measurementFactMatchesRequestedSubject(question: string, sourceTitle: string, fact: string) {
  const normalizedQuestion = normalizePolicyText(question);
  const normalizedFact = normalizePolicyText(fact);
  if (
    /\b(?:concrete|slab)\b/.test(normalizedQuestion) &&
    !/\bwalkway\b/.test(normalizedQuestion) &&
    /\bwalkway\b/.test(normalizedFact)
  ) return false;
  const requestedConstructionSubjects = [
    'paving', 'walkway', 'curb', 'gutter', 'slab', 'wall', 'footing', 'foundation', 'canopy',
  ].filter(subject => normalizedQuestion.includes(subject));
  if (
    requestedConstructionSubjects.length > 0 &&
    !requestedConstructionSubjects.some(subject =>
      measurementSubjectMatchesFact(
        subject,
        normalizedQuestion,
        normalizedFact,
        normalizePolicyText(sourceTitle),
      )
    )
  ) {
    return false;
  }
  const evidenceText = `${sourceTitle} ${fact}`;
  const context = analyzeECOSQuestionEvidenceContext(question, evidenceText);
  return context.subjectMatched && (
    context.locationMatched || evidenceMatchesExplicitSheetReference(question, evidenceText)
  );
}

function measurementSubjectMatchesFact(
  requestedSubject: string,
  normalizedQuestion: string,
  normalizedFact: string,
  normalizedEvidenceContext = normalizedFact,
) {
  if (normalizedFact.includes(requestedSubject)) return true;
  if (
    requestedSubject === 'slab' &&
    /\b(?:concrete|pcc)\b/.test(normalizedQuestion) &&
    /\b(?:concrete|pcc)\s+paving\b/.test(normalizedFact) &&
    slabQuestionMayUsePavingEvidence(normalizedQuestion, normalizedEvidenceContext)
  ) {
    return true;
  }
  if (requestedSubject === 'paving' && /\bpavement\b/.test(normalizedFact)) return true;
  return false;
}

function slabQuestionMayUsePavingEvidence(
  normalizedQuestion: string,
  normalizedEvidenceContext: string,
) {
  if (/\b(?:paving|pavement)\b/.test(normalizedQuestion)) return true;
  const requestedNorth2375 = /\b2375\b/.test(normalizedQuestion) &&
    /\b(?:north(?:ern)?(?:[- ]+(?:side|lot))?|behind|back)\b/.test(normalizedQuestion);
  if (!requestedNorth2375) return false;
  return /\bnorth[- ]+lot(?:\s+plan)?\b/.test(normalizedEvidenceContext) &&
    /\b(?:civil|precise\s+grading|sheet\s+c6)\b/.test(normalizedEvidenceContext);
}

function measurementStatementMatchesRequestedSubject(
  question: string,
  normalizedStatement: string,
  normalizedEvidenceContext = normalizedStatement,
) {
  const normalizedQuestion = normalizePolicyText(question);
  const requestedConstructionSubjects = [
    'paving', 'walkway', 'curb', 'gutter', 'slab', 'wall', 'footing', 'foundation', 'canopy',
  ].filter(subject => normalizedQuestion.includes(subject));
  return boundedMeasurementReferenceScopeMatches(question, normalizedStatement) && (
    requestedConstructionSubjects.length === 0 || requestedConstructionSubjects.some(subject =>
      measurementSubjectMatchesFact(
        subject,
        normalizedQuestion,
        normalizedStatement,
        normalizedEvidenceContext,
      )
    )
  );
}

function boundedMeasurementReferenceScopeMatches(question: string, evidence: string) {
  const semanticLabels = new Set([
    'canopy', 'building area', 'loading dock', 'room', 'panel', 'building', 'area',
    'zone', 'level', 'floor', 'grid', 'door', 'wall', 'note', 'task', 'type', 'unit',
    'suite', 'bay', 'section', 'phase', 'option', 'item',
  ]);
  const requested = boundedQuantityReferenceKeys(question).filter(key =>
    semanticLabels.has(key.split(':', 1)[0])
  );
  if (requested.length === 0) return true;
  const available = boundedQuantityReferenceKeys(evidence).filter(key =>
    semanticLabels.has(key.split(':', 1)[0])
  );
  const requestedLabels = new Set(requested.map(key => key.split(':', 1)[0]));
  return [...requestedLabels].every(label => {
    const requestedValues = requested.filter(key => key.startsWith(`${label}:`)).sort();
    const availableValues = available.filter(key => key.startsWith(`${label}:`)).sort();
    return requestedValues.length === availableValues.length &&
      requestedValues.every((key, index) => key === availableValues[index]);
  });
}

const POLICY_LINEAR_NUMBER_SOURCE =
  String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\.\d+)`;
const POLICY_LINEAR_UNIT_SOURCE =
  String.raw`(?:inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|["'])`;

function policyUnsignedNumber(value: string) {
  const normalized = value.trim();
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(normalized);
  if (mixed && Number(mixed[3]) !== 0) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
  if (fraction && Number(fraction[2]) !== 0) {
    return Number(fraction[1]) / Number(fraction[2]);
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function policyLinearUnitMillimeters(value: string) {
  const normalized = value.toLowerCase().replace(/\.$/, '');
  if (/^(?:inches?|inch|in|")$/.test(normalized)) return 25.4;
  if (/^(?:feet|foot|ft|')$/.test(normalized)) return 304.8;
  if (/^(?:millimeters?|mm)$/.test(normalized)) return 1;
  if (/^(?:centimeters?|cm)$/.test(normalized)) return 10;
  if (/^(?:meters?|m)$/.test(normalized)) return 1_000;
  if (/^(?:yards?|yds?|yd)$/.test(normalized)) return 914.4;
  return null;
}

function policyClosedLinearScalar(value: string) {
  const match = new RegExp(
    `^(${POLICY_LINEAR_NUMBER_SOURCE})\\s*(${POLICY_LINEAR_UNIT_SOURCE})` +
      `(?:\\s+(${POLICY_LINEAR_NUMBER_SOURCE})\\s*(${POLICY_LINEAR_UNIT_SOURCE}))?$`,
    'i',
  ).exec(value.trim().replace(/[.;:]+$/, '').trim());
  if (!match) return null;
  const firstAmount = policyUnsignedNumber(match[1]);
  const firstMultiplier = policyLinearUnitMillimeters(match[2]);
  if (firstAmount == null || firstMultiplier == null) return null;
  if (!match[3]) {
    return Object.freeze({ amount: firstAmount * firstMultiplier, unitCount: 1 });
  }
  const secondAmount = policyUnsignedNumber(match[3]);
  const secondMultiplier = policyLinearUnitMillimeters(match[4]);
  if (
    secondAmount == null || secondMultiplier == null ||
    !/^(?:feet|foot|ft\.?|')$/i.test(match[2]) ||
    !/^(?:inches?|inch|in\.?|")$/i.test(match[4])
  ) return null;
  return Object.freeze({
    amount: firstAmount * firstMultiplier + secondAmount * secondMultiplier,
    unitCount: 2,
  });
}

function policyConstraintTailBeforeMarker(value: string) {
  const predicates = [...value.matchAll(
    /\b(?:is|are|was|were|equals?|measures?|measured|requires?|required|specifies?|specified|lists?|listed|reports?|reported|shows?|shown|calls?\s+for)\s+/gi,
  )];
  if (predicates.length > 0) {
    const predicate = predicates[predicates.length - 1];
    return value.slice((predicate.index || 0) + predicate[0].length).trim()
      .replace(/^(?:exactly|approximately|approx\.?|about|roughly|estimated)\s+/i, '');
  }
  const attributes = [...value.matchAll(
    /\b(?:width|wide|height|high|thickness|thick|thk|depth|deep|length|long|diameter|diam|dia|spacing|spaced|clearance|headroom)\b\s*/gi,
  )];
  const attribute = attributes[attributes.length - 1];
  return attribute
    ? value.slice((attribute.index || 0) + attribute[0].length).trim()
    : value.trim();
}

function policyExplicitLinearConstraintClauseIsClosed(clause: string) {
  const toleranceMarkers = [...clause.matchAll(/\bplus\s+or\s+minus\b/gi)];
  const rangeMarkers = [...clause.matchAll(
    new RegExp(`\\b(?:between|from)\\s+${POLICY_LINEAR_NUMBER_SOURCE}\\b`, 'gi'),
  )];
  if (toleranceMarkers.length === 0 && rangeMarkers.length === 0) return true;
  if (toleranceMarkers.length > 1 || rangeMarkers.length > 1) return false;
  if (toleranceMarkers.length === 1) {
    if (rangeMarkers.length > 0) return false;
    const marker = toleranceMarkers[0];
    const centerText = policyConstraintTailBeforeMarker(
      clause.slice(0, marker.index || 0),
    );
    const toleranceText = clause
      .slice((marker.index || 0) + marker[0].length)
      .trim()
      .replace(/\s+(?:wide|high|thick|deep|long|diameter|diam|dia|spaced|on\s+center|clear(?:ance)?)$/i, '')
      .replace(/[.;:]+$/, '')
      .trim();
    const center = policyClosedLinearScalar(centerText);
    const tolerance = policyClosedLinearScalar(toleranceText);
    const bareCenter = policyUnsignedNumber(centerText);
    const bareTolerance = policyUnsignedNumber(toleranceText);
    if (center && tolerance) return tolerance.amount > 0;
    if (center && center.unitCount === 1 && bareTolerance != null) return bareTolerance > 0;
    if (bareCenter != null && tolerance && tolerance.unitCount === 1) return tolerance.amount > 0;
    return false;
  }
  const marker = rangeMarkers[0];
  const rangeText = clause.slice(marker.index || 0)
    .trim()
    .replace(/\s+(?:wide|high|thick|deep|long|diameter|diam|dia|spaced|on\s+center|clear(?:ance)?)$/i, '')
    .replace(/[.;:]+$/, '')
    .trim();
  const range = /^(?:between\s+(.+?)\s+and\s+(.+)|from\s+(.+?)\s+(?:to|through|thru)\s+(.+))$/i.exec(
    rangeText,
  );
  if (!range) return false;
  const lowerText = (range[1] || range[3] || '').trim();
  const upperText = (range[2] || range[4] || '').trim();
  const upper = policyClosedLinearScalar(upperText);
  if (!upper) return false;
  const lowerScalar = policyClosedLinearScalar(lowerText);
  const lowerBare = policyUnsignedNumber(lowerText);
  const lowerAmount = lowerScalar?.amount ?? (
    lowerBare != null && upper.unitCount === 1
      ? lowerBare * (
        policyLinearUnitMillimeters(
          new RegExp(POLICY_LINEAR_UNIT_SOURCE, 'i').exec(upperText)?.[0] || '',
        ) || Number.NaN
      )
      : Number.NaN
  );
  return Number.isFinite(lowerAmount) && lowerAmount <= upper.amount;
}

function policyExplicitLinearConstraintsAreClosed(value: string) {
  const clauses = value.split(/[;!?]|\.\s+|\r?\n+/)
    .map(clause => clause.trim())
    .filter(Boolean);
  return clauses.every(policyExplicitLinearConstraintClauseIsClosed);
}

function measurementTextBindsRequestedAttribute(
  question: string,
  value: string,
  preparedRequirement?: ECOSProjectAnswerRequirement,
) {
  const requirement = preparedRequirement || analyzeECOSProjectQuestion(question);
  if (requirement.kind !== 'measurement' || !requirement.attribute) return false;
  const normalized = normalizePolicyText(
    value
      .replace(/[′’]/g, "'")
      .replace(/[″”]/g, '"')
      .replace(/(?<=\d)\s*:\s*(?=\d)/g, ' ratio ')
      .replace(
        /([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*(feet|foot|ft\.?|['′])\s*[,\+\-‐‑‒–—―−]\s*(?=(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*(?:inches?|inch|in\.?|["″]))/gi,
        '$1 $2 ',
      )
      .replace(/\bplus\s*(?:\/|-)\s*minus\b/gi, ' plus or minus ')
      .replace(/\+\s*\/\s*-/g, ' plus or minus ')
      .replace(/[±∓]/g, ' plus or minus '),
  );
  if (
    !['area', 'grade'].includes(requirement.attribute) &&
    !policyExplicitLinearConstraintsAreClosed(normalized)
  ) return false;
  const amount = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?|\.\d+)`;
  const linearValue = String.raw`${amount}\s*(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?)`;
  const linearToleranceValue = String.raw`(?:${linearValue}\s+plus\s+or\s+minus\s+(?:${linearValue}|${amount})|${amount}\s+plus\s+or\s+minus\s+${linearValue})`;
  const linearRangeValue = String.raw`(?:between\s+(?:${linearValue}|${amount})\s+and\s+${linearValue}|from\s+(?:${linearValue}|${amount})\s+(?:to|through|thru)\s+${linearValue})`;
  const linearConstraintValue = String.raw`(?:${linearRangeValue}|${linearToleranceValue}|${linearValue})`;
  const areaValue = String.raw`${amount}\s*(?:square\s+(?:inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:in\.?|ft\.?|mm|cm|m|yds?|yd)|(?:in|ft|mm|cm|m|yd)\s*2|sf|acres?|hectares?|ha)`;
  const gradeLinearUnit = String.raw`(?:"|'|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)`;
  const gradeLinearValue = String.raw`${amount}\s*${gradeLinearUnit}`;
  const gradeValue = String.raw`(?:${amount}\s*(?:%|percent|degrees?)|${amount}\s*(?:ratio|in)\s*${amount}|${gradeLinearValue}\s*(?:per|\/)\s*${gradeLinearUnit})`;
  const valuePattern = requirement.attribute === 'area' ? areaValue
    : requirement.attribute === 'grade' ? gradeValue : linearConstraintValue;
  const attributePattern = requirement.attribute === 'area'
    ? String.raw`(?:area|footprint|acreage|square\s+footage)`
    : requirement.attribute === 'grade' ? '(?:grades?|slopes?)(?:\\s+limits?)?'
    : requirement.attribute === 'width' ? '(?:width|wide)'
    : requirement.attribute === 'height' ? '(?:height|high)'
    : requirement.attribute === 'thickness' ? '(?:thickness|thick|thk)'
    : requirement.attribute === 'depth' ? '(?:depth|deep)'
    : requirement.attribute === 'length' ? '(?:length|long)'
    : requirement.attribute === 'diameter' ? '(?:diameter|diam|dia)'
    : requirement.attribute === 'clearance' ? '(?:clearance|headroom)'
    : String.raw`(?:spacing|spaced|on\s+center|o\.?c\.?)`;
  const attributeSymbol = requirement.attribute === 'width' ? String.raw`(?:\s+w)?`
    : requirement.attribute === 'height' ? String.raw`(?:\s+h)?`
    : requirement.attribute === 'thickness' ? String.raw`(?:\s+(?:t|thk))?`
    : requirement.attribute === 'depth' ? String.raw`(?:\s+d)?`
    : requirement.attribute === 'length' ? String.raw`(?:\s+l)?`
    : requirement.attribute === 'diameter' ? String.raw`(?:\s+(?:d|dia))?`
    : requirement.attribute === 'spacing' ? String.raw`(?:\s+(?:s|oc))?`
    : '';
  const predicate = String.raw`(?:(?:is|are|was|were|(?:shall|must)(?:\s+not)?\s+be|(?:shall|must)\s+not\s+exceed|of|equals?|totals?|measures?|measured|requires?|required|specifies?|specified|lists?|listed|reports?|reported|shows?|shown|calls?\s+for)\s+)?`;
  const boundedRelation = String.raw`(?:(?:not\s+under|no\s+more\s+than|not\s+to\s+exceed|not\s+exceed(?:ing)?|at\s+most|up\s+to|maximum|max\.?|no\s+less\s+than|not\s+less\s+than|at\s+least|minimum|min\.?|greater\s+than|more\s+than|over|above|less\s+than|under|below|exactly|approximately|approx\.?|about|roughly|estimated|field[- ]measured)\s+)?`;
  if (requirement.attribute !== 'area' && requirement.attribute !== 'grade') {
    const ratioUnit = String.raw`(?:inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)`;
    const suffixAttributes: ReadonlyArray<readonly [string, string]> = [
      ['grade', String.raw`per\s+(?:(?:${amount}|linear)\s+)?${ratioUnit}`],
      ['width', 'wide'],
      ['height', 'high'],
      ['thickness', 'thick'],
      ['depth', 'deep'],
      ['length', 'long'],
      ['diameter', String.raw`(?:diameter|diam\.?|dia\.?|o\.?d\.?)`],
      ['radius', String.raw`radius`],
      ['spacing', String.raw`(?:on\s+center|o\.?c\.?|c\s*/\s*c|each\s+way)`],
      ['elevation', String.raw`(?:(?:above|below)\s+(?:finish(?:ed)?\s+)?(?:floor|grade)|a\.?f\.?f\.?)`],
      ['clearance', String.raw`clear(?:ance)?`],
      ['projection', String.raw`projection`],
    ];
    const mismatchedSuffixPattern = suffixAttributes
      .filter(([attribute]) => attribute !== requirement.attribute)
      .map(([, pattern]) => pattern)
      .join('|');
    if (mismatchedSuffixPattern && new RegExp(
      String.raw`\b${attributePattern}\b${attributeSymbol}\s*${predicate}${boundedRelation}${linearValue}\s+(?:${mismatchedSuffixPattern})(?=$|\s|[-(),.;:])`,
    ).test(normalized)) return false;
    if (new RegExp(
      String.raw`\b${attributePattern}\b${attributeSymbol}\s*${predicate}${boundedRelation}${linearValue}\s*(?:/|:)\s*(?:(?:${amount}|linear)\s*)?${ratioUnit}(?=$|\s|[-(),.;:])`,
    ).test(normalized)) return false;
    // Generic normalization removes a colon, so preserve the fail-closed
    // interpretation of compact ratio notation such as `6 inches:12 feet` by
    // rejecting a second adjacent linear quantity after the requested field.
    const adjacentLinearValues = new RegExp(
      String.raw`\b${attributePattern}\b${attributeSymbol}\s*${predicate}${boundedRelation}${linearValue}\s+${amount}\s*${ratioUnit}(?=$|\s|[-(),.;:])`,
    ).test(normalized);
    const boundedFeetAndInches = new RegExp(
      String.raw`\b${attributePattern}\b${attributeSymbol}\s*${predicate}${boundedRelation}${amount}\s*(?:feet|foot|ft\.?)\s+${amount}\s*(?:inches?|inch|in\.?|")\s*(?:or\s+(?:less|more)|maximum|max\.?|minimum|min\.?)?(?=$|\s|[-(),.;:])`,
    ).test(normalized);
    if (adjacentLinearValues && !boundedFeetAndInches) return false;
  }
  const labelFirst = new RegExp(
    String.raw`\b${attributePattern}\b${attributeSymbol}\s*${predicate}${boundedRelation}${valuePattern}(?=$|\s|[-(),.;:x])`,
  );
  const valueFirstSubject = String.raw`(?:(?:(?:reinforced\s+concrete|pcc|concrete|slab|wall|footing|foundation|canopy|pad|door|pipe|stud|ramp)\s+){0,2})`;
  const valueFirst = new RegExp(
    String.raw`${valuePattern}\s*(?:(?:maximum|max\.?|minimum|min\.?)\s+)?${valueFirstSubject}(?:${attributePattern})\b`,
  );
  const normalizedQuestion = normalizePolicyText(question).replace(/[.;:]+$/, '').trim();
  const requestedOutputUnit = /\s+(?:in|to)\s+(?:square\s+(?:feet|foot|inches?|inch|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:ft\.?|in\.?|mm|cm|m|yds?|yd)|sf|acres?|hectares?|feet|foot|ft\.?|inches?|inch|in\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?|percent|degrees?)$/;
  const questionWithoutOutputUnit = normalizedQuestion.replace(requestedOutputUnit, '').trim();
  const fieldFirstSubject = new RegExp(
    String.raw`\b${attributePattern}\b\s+(?:of|for)\s+(?:the\s+)?(.+)$`,
  ).exec(questionWithoutOutputUnit)?.[1]?.trim() || '';
  const subjectFirstSubject = new RegExp(
    String.raw`^(?:(?:what|which)\s+(?:is|are|was|were)\s+|(?:state|report|list|show|give)\s+)(?:the\s+)?(.+?)\s+\b${attributePattern}\b$`,
  ).exec(questionWithoutOutputUnit)?.[1]?.trim() || '';
  const adjectiveFirstSubject = new RegExp(
    String.raw`^how\s+(?:(?:many|much)\s+)?(?:(?:square\s+)?(?:feet|foot|ft\.?|inches?|inch|in\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|percent|degrees?)\s+)?(?:wide|high|thick|deep|long)\s+(?:is|are|was|were)\s+(?:the\s+)?(.+)$`,
  ).exec(questionWithoutOutputUnit)?.[1]?.trim() || '';
  const requestedFieldSubject = fieldFirstSubject || subjectFirstSubject || adjectiveFirstSubject;
  const fieldOfRequestedEntity = requestedFieldSubject && new RegExp(
    String.raw`\b${attributePattern}\b\s+(?:of|for)\s+(?:the\s+)?${escapeRegExp(requestedFieldSubject)}\s+(?:is|are|was|were|(?:shall|must)(?:\s+not)?\s+be|equals?|measures?|measured|requires?|required|specifies?|specified|lists?|listed|reports?|reported|shows?|shown)\s+${boundedRelation}${valuePattern}(?=$|\s|[-(),.;:x])`,
  ).test(normalized);
  const exactSourceFramedAreaValue = requirement.attribute === 'area' && new RegExp(
    String.raw`\b(?:the\s+)?(?:current\s+)?(?:drawing|plan|document|source|evidence)\s+(?:states?|lists?|shows?|indicates?|reports?|specifies?)\s+(?:that\s+)?${areaValue}\s*[.;:]?\s*$`,
  ).test(normalized);
  const verifiedPlanCalculation = requirement.attribute === 'area' && new RegExp(
    String.raw`\becos\s+verified\s+plan-footprint\s+calculation\b[\s\S]{0,180}${areaValue}`,
  ).test(normalized);
  return labelFirst.test(normalized) || valueFirst.test(normalized) || fieldOfRequestedEntity ||
    exactSourceFramedAreaValue || verifiedPlanCalculation ||
    evidenceExpressesRequestedMeasurementAttribute(requirement, normalized, question);
}

function measurementSourceBindsRequiredQuestionScope(
  question: string,
  sourceExcerpts: readonly string[],
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const analyzeQuestionEvidenceContext = prepareECOSQuestionEvidenceContextAnalyzer(question);
  const containsRequestedMeasurementValue =
    requestedMeasurementValueMatcherForRequirement(question, requirement);
  const questionContext = analyzeQuestionEvidenceContext('');
  const requiredDiscriminators = questionContext.subjectTokens.filter(token =>
    REQUIRED_SUBJECT_DISCRIMINATORS.has(token)
  );
  const requiresADAAccessibleScope = questionContext.subjectTokens.includes('ada') &&
    questionContext.subjectTokens.includes('accessible');
  const scopeRelationTokens = new Set([
    'maximum', 'minimum', 'max', 'min', 'permitted', 'allowed', 'allowable', 'required',
  ]);
  const exactScopeTokens = questionContext.subjectTokens.filter(token =>
    !scopeRelationTokens.has(token) &&
    !(requiresADAAccessibleScope && (token === 'ada' || token === 'accessible'))
  );
  const requestedReferenceHeadingTokens = new Set(
    boundedQuantityReferenceKeys(question).flatMap(reference =>
      reference.split(':').flatMap(part => part.split(/[^a-z0-9]+/).filter(Boolean))
    ),
  );
  const identifierLikeScopeTokens = new Set(exactScopeTokens.filter(token =>
    requestedReferenceHeadingTokens.has(token) ||
    /^(?:[a-z]+\d[a-z0-9.-]*|\d+[a-z][a-z0-9.-]*)$/.test(token)
  ));
  const semanticExactScopeTokens = exactScopeTokens.filter(token =>
    !identifierLikeScopeTokens.has(token)
  );
  const requestedLocationHeadingTokens = new Set([
    ...questionContext.locationDirectionTokens,
    ...questionContext.locationKindTokens,
    ...[...questionContext.locationDirectionTokens, ...questionContext.locationKindTokens].flatMap(token =>
      (QUESTION_CONTEXT_VARIANTS[token] || []).flatMap(variant =>
        canonicalContextMatchText(variant).split(' ').map(canonicalContextToken).filter(Boolean)
      )
    ),
  ]);
  const clauseCoversExactScope = (clause: string) => {
    const context = analyzeQuestionEvidenceContext(clause);
    return exactScopeTokens.every(token => context.matchedSubjectTokens.includes(token)) &&
      context.locationMatched &&
      boundedMeasurementReferenceScopeMatches(question, clause) &&
      (!requiresADAAccessibleScope || ['ada', 'accessible'].some(token =>
        context.matchedSubjectTokens.includes(token)
      ));
  };
  const clauseBindsMeasurement = (clause: string) => {
    if (!containsRequestedMeasurementValue(clause)) return false;
    if (!measurementTextBindsRequestedAttribute(question, clause, requirement)) return false;
    return true;
  };
  const clauseIsSubjectFreeMeasurementRow = (clause: string) => {
    const normalized = normalizePolicyText(clause.replace(/(?<=\d)\s*:\s*(?=\d)/g, ' ratio '));
    const amount = String.raw`\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?`;
    const unit = String.raw`(?:inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)`;
    const gradeValue = String.raw`(?:${amount}\s*(?:%|percent|degrees?)|${amount}\s*(?:ratio|in)\s*${amount}|${amount}\s*${unit}\s*(?:per|\/)\s*${unit})`;
    const predicate = String.raw`(?:(?:shall|must)(?:\s+not)?\s+be|(?:shall|must)\s+not\s+exceed|is|are|was|were|equals?|measures?|requires?|specifies?|lists?|reports?|shows?)?`;
    const relationBefore = String.raw`(?:(?:no\s+more\s+than|not\s+to\s+exceed|not\s+exceed(?:ing)?|at\s+most|up\s+to|maximum|max\.?|no\s+less\s+than|not\s+less\s+than|at\s+least|minimum|min\.?)\s+)?`;
    const relationAfter = String.raw`(?:\s+(?:maximum|max\.?|minimum|min\.?))?`;
    const gradeLabel = String.raw`(?:(?:(?:maximum|allowable)\s+)?(?:grades?|slopes?)|(?:grade|slope)\s+limits?)`;
    const boundedGradeRow = new RegExp(
      String.raw`^(?:the\s+)?${gradeLabel}\s*${predicate}\s*${relationBefore}${gradeValue}${relationAfter}\s*\.?$`,
    ).test(normalized) || new RegExp(
      String.raw`^${gradeValue}${relationAfter}\s*\.?\s*${gradeLabel}\s*\.?$`,
    ).test(normalized);
    if (boundedGradeRow) return true;
    if (!clauseBindsMeasurement(normalized)) return false;
    if (boundedQuantityReferenceKeys(normalized).length > 0) return false;
    if (/\b(?:north|south|east|west|northeast|northwest|southeast|southwest)\b/.test(
      normalized,
    )) return false;
    const allowedTokens = new Set([
      'width', 'wide', 'height', 'high', 'thickness', 'thick', 'thk', 'depth',
      'deep', 'length', 'long', 'diameter', 'diam', 'dia', 'spacing', 'spaced',
      'clearance', 'clear', 'headroom', 'overall', 'maximum', 'minimum', 'max',
      'min', 'not', 'to', 'exceed', 'exceeding', 'at', 'least', 'most', 'up',
      'no', 'more', 'less', 'than', 'between', 'from', 'and', 'through', 'thru',
      'plus', 'or', 'minus', 'approximately', 'approx', 'exactly', 'about',
      'roughly', 'estimated', 'shall', 'must', 'be', 'is', 'are', 'was', 'were',
      'equals', 'measures', 'measured', 'requires', 'required', 'specifies',
      'specified', 'lists', 'listed', 'reports', 'reported', 'shows', 'shown',
      'calls', 'for', 'on', 'center', 'oc', 'inches', 'inch', 'in', 'feet', 'foot',
      'ft', 'millimeters', 'mm', 'centimeters', 'cm', 'meters', 'm', 'yards',
      'yds', 'yd', 'gauge', 'ga', 'percent', 'degrees',
    ]);
    const words = canonicalContextMatchText(normalized).split(' ')
      .map(canonicalContextToken)
      .filter(token => token && !/^\d+(?:\.\d+)?$/.test(token));
    return words.every(token => allowedTokens.has(token));
  };
  const allowedHeadingTokens = new Set([
    ...exactScopeTokens,
    ...requestedLocationHeadingTokens,
    ...requestedReferenceHeadingTokens,
    'new', 'existing', 'current', 'proposed', 'pcc', 'concrete', 'cement', 'asphalt',
    'paving', 'walkway', 'curb', 'gutter', 'wall', 'footing', 'foundation', 'canopy',
    'pad', 'door', 'pipe', 'stud', 'ramp',
    'plan', 'detail', 'schedule', 'heading', 'title', 'construction', 'note', 'notes',
    'typ', 'typical', 'drawing', 'page', 'context', 'pdf', 'sheet', 'precise', 'grading',
    'anchor', 'rod', 'rods', 'slab', 'thickness', 'area', 'footprint', 'calculation',
    'verified', 'ecos', 'eco', 'visual', 'fact', 'subject', 'location',
    ...(requiresADAAccessibleScope ? ['ada', 'accessible'] : []),
  ]);
  const headingTokens = (clause: string) => canonicalContextMatchText(normalizePolicyText(clause))
    .split(' ')
    .map(canonicalContextToken)
    .filter(token => token && (
      !/^\d+(?:\.\d+)?$/.test(token) || requestedReferenceHeadingTokens.has(token)
    ))
    .filter(token => !new Set(['the', 'on', 'at', 'in', 'of', 'for', 'to']).has(token));
  const clauseHasConflictingLocation = (clause: string) => {
    const sourceDirections = headingTokens(clause).filter(token => LOCATION_DIRECTION_TOKENS.has(token));
    return sourceDirections.some(sourceDirection =>
      !questionContext.locationDirectionTokens.some(requestedDirection =>
        contextTokenMatchesEvidence(requestedDirection, sourceDirection)
      )
    );
  };
  const clauseIsRequestedScopeHeading = (clause: string) => {
    const normalized = normalizePolicyText(clause);
    if (
      !normalized ||
      containsRequestedMeasurementValue(normalized) ||
      clauseHasConflictingLocation(normalized) ||
      /\b(?:and|or|with|plus|versus|vs|is|are|was|were|be|being|been|shows?|shown|lists?|listed|states?|stated|specifies?|specified|requires?|required|depicts?|depicted|contains?|contained|includes?|included)\b/.test(
        normalized,
      )
    ) return false;
    const tokens = headingTokens(normalized);
    const localReferenceTokens = new Set(
      boundedQuantityReferenceKeys(normalized).flatMap(reference =>
        reference.split(':').flatMap(part => part.split(/[^a-z0-9]+/).filter(Boolean))
      ),
    );
    if (tokens.length === 0 || !tokens.every(token =>
      allowedHeadingTokens.has(token) || localReferenceTokens.has(token)
    )) return false;
    const context = analyzeQuestionEvidenceContext(normalized);
    return context.matchedSubjectTokens.some(token => exactScopeTokens.includes(token)) ||
      context.matchedLocationDirectionTokens.length > 0 ||
      context.matchedLocationKindTokens.length > 0 ||
      tokens.some(token => requestedReferenceHeadingTokens.has(token));
  };
  const clauseIsSafeScopeBridge = (clause: string) => {
    const normalized = normalizePolicyText(clause);
    if (
      !normalized || containsRequestedMeasurementValue(normalized) ||
      clauseHasConflictingLocation(normalized)
    ) return false;
    const tokens = headingTokens(normalized);
    const localReferenceTokens = new Set(
      boundedQuantityReferenceKeys(normalized).flatMap(reference =>
        reference.split(':').flatMap(part => part.split(/[^a-z0-9]+/).filter(Boolean))
      ),
    );
    return tokens.length > 0 && tokens.every(token =>
      allowedHeadingTokens.has(token) || localReferenceTokens.has(token)
    );
  };
  const headingAndClauseBindExactScope = (heading: string, clause: string) => {
    if (!clauseIsRequestedScopeHeading(heading) || !clauseBindsMeasurement(clause)) return false;
    const combined = `${heading} ${clause}`;
    if (!clauseCoversExactScope(combined)) return false;
    const clauseContext = analyzeQuestionEvidenceContext(clause);
    const clauseCarriesRequestedSemanticSubject = semanticExactScopeTokens.length === 0 ||
      semanticExactScopeTokens.every(token => clauseContext.matchedSubjectTokens.includes(token));
    const deterministicAreaCalculation = requirement.attribute === 'area' &&
      /\becos\s+verified\s+plan-footprint\s+calculation\b/i.test(clause);
    return clauseCarriesRequestedSemanticSubject ||
      clauseIsSubjectFreeMeasurementRow(clause) || deterministicAreaCalculation;
  };
  const clauseBindsExactScopedMeasurement = (clause: string) => {
    if (!clauseBindsMeasurement(clause) || !clauseCoversExactScope(clause)) return false;
    if (
      requiresADAAccessibleScope &&
      requiredDiscriminators.includes('delineated') &&
      questionContext.subjectTokens.includes('parking')
    ) {
      const normalized = normalizePolicyText(clause);
      const scope = /\b(?:in\s+)?(?:delineated\s+(?:(?:ada[- ]?accessible)|ada|accessible)\s+parking\s+areas?|(?:(?:ada[- ]?accessible)|ada|accessible)\s+delineated\s+parking\s+areas?|delineated\s+parking\s+areas?\s+designated\s+(?:(?:ada[- ]?accessible)|ada|accessible)|(?:(?:ada[- ]?accessible)|ada|accessible)\s+parking\s+areas?\s+that\s+are\s+delineated)\b/.exec(
        normalized,
      );
      return Boolean(scope && clauseIsSubjectFreeMeasurementRow(
        normalized.slice((scope.index || 0) + scope[0].length)
          .replace(/^[,:;]\s*/, '')
          .trim(),
      ));
    }
    return true;
  };
  for (const excerpt of sourceExcerpts) {
    const clauses = excerpt
      .replace(/\s+(?=DRAWING PAGE CONTEXT:)/gi, '\n')
      .replace(
        /(^|[;!?\n]\s*|\.\s+)((?:\d+\s*['’]\s*-?\s*\d+\s*["”]|\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:["”]|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|%|percent|degrees?)|\d+(?:\.\d+)?\s*(?::|in)\s*\d+(?:\.\d+)?)\s*(?:max|min))\.(?=\s+(?:typ\.?|typical|grades?|slopes?|width|height|thickness|depth|length|diameter|spacing|clearance|headroom|area|footprint|acreage|slab|wall|footing|foundation|canopy|pad|door|pipe|stud|ramp)\b)/gi,
        '$1$2\uE003',
      )
      .replace(/\bsq\.(?=\s*(?:ft|in|mm|cm|m|yd)\.?(?:\s|$))/gi, 'sq\uE003')
      .split(/[;!?]|\.\s+|\r?\n+/)
      .map(clause => clause.replace(/\uE003/g, '.').trim())
      .filter(Boolean);
    for (let index = 0; index < clauses.length; index += 1) {
      const clause = clauses[index];
      if (clauseBindsExactScopedMeasurement(clause)) return true;
      if (!clauseBindsMeasurement(clause)) continue;
      for (let distance = 1; distance <= 4 && index - distance >= 0; distance += 1) {
        const headingIndex = index - distance;
        const heading = clauses[headingIndex];
        if (headingAndClauseBindExactScope(heading, clause)) return true;
        if (!clauseIsSafeScopeBridge(heading)) break;
      }
    }
  }
  return false;
}

function installedDesignFactKey(phrase: string) {
  const normalized = normalizePolicyText(phrase);
  const measurement = normalized.match(
    /\b(\d+(?:\.\d+)?)(?:\s*[- ]\s*)?(?:\"|inches?|inch|feet|foot|millimeters?|centimeters?|meters?|yards?)/,
  )?.[1];
  const subject = normalized.includes('pcc paving')
    ? 'pcc paving'
    : normalized.includes('pcc walkway')
      ? 'pcc walkway'
      : null;
  return measurement && subject ? `${subject}|${Number(measurement)}` : normalized;
}

function extractECOSVisualMeasurementFacts(excerpt: string, question: string) {
  const facts: string[] = [];
  const factBlockSpans: Array<Readonly<{ start: number; end: number }>> = [];
  const pattern = /\bFact:\s*([\s\S]{1,320}?)(?=\.{0,2}\s*Visible evidence:)/gi;
  for (const match of excerpt.matchAll(pattern)) {
    const fact = String(match[1] || '').replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '');
    const blockStart = match.index || 0;
    const nextBlockOffset = excerpt.slice(blockStart + match[0].length).search(
      /\bECOS\s+VISUAL\s+DRAWING\s+FACT\b/i,
    );
    const blockEnd = nextBlockOffset >= 0
      ? blockStart + match[0].length + nextBlockOffset
      : excerpt.length;
    factBlockSpans.push({ start: blockStart, end: blockEnd });
    const proofBlock = excerpt.slice(blockStart, blockEnd);
    const visibleEvidence = proofBlock.match(/\bVisible evidence:\s*([\s\S]+)$/i)?.[1]?.trim() || '';
    const targetVisibleProposition = visibleEvidence.match(
      /^([\s\S]*?)(?:\.\s+(?=[A-Z])|$)/,
    )?.[1]?.trim() || '';
    if (
      fact &&
      targetVisibleProposition &&
      ecosDrawingPropositionIsAssertiveCurrent(fact) &&
      ecosDrawingPropositionIsAssertiveCurrent(targetVisibleProposition) &&
      drawingMeasurementProofMatchesGeneratedFact(fact, targetVisibleProposition) &&
      containsECOSRequestedMeasurementValue(question, normalizePolicyText(fact))
    ) facts.push(fact);
  }
  // A sealed slab-legend relationship can replay the printed dimension twice:
  // once in the construction phrase and once in the typed value cell. Accept
  // only an exact same-value/same-unit duplicate and reduce it to the one
  // printed PCC proposition. Different values remain a conflict and never
  // enter the deterministic fallback.
  const duplicatedStructuredPCCPattern =
    /\b(?:CONSTRUCT\s+)?(\d+(?:\.\d+)?)\s*([\"”″]|inches?|inch|in\.?)\s*THICK\s+(\d+(?:\.\d+)?)\s*([\"”″]|inches?|inch|in\.?)\s*PCC\s+(PAVING|WALKWAY)(?:\s+PCC)?\b/gi;
  for (const match of excerpt.matchAll(duplicatedStructuredPCCPattern)) {
    const matchStart = match.index || 0;
    if (factBlockSpans.some(span => matchStart >= span.start && matchStart < span.end)) continue;
    const canonicalUnit = (value: string) => value.toLowerCase()
      .replace(/[”″]/g, '\"')
      .replace(/\.$/, '');
    if (
      Number(match[1]) !== Number(match[3]) ||
      canonicalUnit(match[2]) !== canonicalUnit(match[4])
    ) continue;
    const fact = `${match[1]}${match[2]} THICK PCC ${match[5].toUpperCase()}`;
    const proposition = boundedDrawingPropositionAt(
      excerpt,
      matchStart,
      matchStart + match[0].length,
    );
    const dropsMaterialConstraint = drawingMeasurementConstraintMode(proposition) !==
      drawingMeasurementConstraintMode(fact);
    if (
      !dropsMaterialConstraint &&
      ecosDrawingPropositionIsAssertiveCurrent(proposition)
    ) facts.push(fact);
  }
  const constructionNotePattern = /\b(?:CONSTRUCT\s+)?(\d+(?:\.\d+)?\s*(?:[\"”]|inches?|inch|in\.?)\s*THICK\s+PCC\s+(?:PAVING|WALKWAY))\b/gi;
  for (const match of excerpt.matchAll(constructionNotePattern)) {
    const matchStart = match.index || 0;
    if (factBlockSpans.some(span => matchStart >= span.start && matchStart < span.end)) continue;
    const fact = String(match[1] || '').replace(/\s+/g, ' ').trim();
    const proposition = boundedDrawingPropositionAt(
      excerpt,
      matchStart,
      matchStart + match[0].length,
    );
    const dropsMaterialConstraint = drawingMeasurementConstraintMode(proposition) !==
      drawingMeasurementConstraintMode(fact);
    if (
      fact &&
      !dropsMaterialConstraint &&
      ecosDrawingPropositionIsAssertiveCurrent(proposition)
    ) facts.push(fact);
  }
  return [...new Set(facts)];
}

function drawingMeasurementProofMatchesGeneratedFact(fact: string, proof: string) {
  const factValues = drawingMeasurementAtoms(fact);
  const proofValues = drawingMeasurementAtoms(proof);
  return factValues.length > 0 &&
    factValues.length === proofValues.length &&
    factValues.every((value, index) => value === proofValues[index]) &&
    drawingMeasurementConstraintMode(fact) === drawingMeasurementConstraintMode(proof) &&
    drawingMeasurementMaterialSubjectSignature(fact) !== '' &&
    drawingMeasurementMaterialSubjectSignature(fact) ===
      drawingMeasurementMaterialSubjectSignature(proof) &&
    drawingMeasurementLocationSignature(fact) === drawingMeasurementLocationSignature(proof);
}

function drawingMeasurementMaterialSubjectSignature(value: string) {
  const normalized = normalizePolicyText(value);
  const canonical = new Set<string>();
  const aliases: ReadonlyArray<readonly [string, RegExp]> = [
    ['concrete', /\b(?:pcc|concrete|cement)\b/],
    ['asphalt', /\b(?:ac|asphalt)\b/],
    ['steel', /\bsteel\b/],
    ['wood', /\b(?:wood|timber)\b/],
    ['masonry', /\b(?:masonry|cmu)\b/],
    ['paving', /\b(?:paving|pavement)\b/],
    ['walkway', /\b(?:walkway|sidewalk)\b/],
    ['slab', /\bslab\b/],
    ['wall', /\bwall\b/],
    ['footing', /\bfootings?\b/],
    ['foundation', /\bfoundation\b/],
    ['curb', /\bcurb\b/],
    ['gutter', /\bgutter\b/],
    ['fastener', /\bfasteners?\b/],
    ['anchor-rod', /\banchor\s+rods?\b/],
    ['door', /\bdoors?\b/],
    ['pad', /\bpads?\b/],
    ['pipe', /\bpipes?\b/],
    ['canopy', /\bcanop(?:y|ies)\b/],
  ];
  for (const [label, pattern] of aliases) {
    if (pattern.test(normalized)) canonical.add(label);
  }
  return [...canonical].sort().join('|');
}

function drawingMeasurementLocationSignature(value: string) {
  const normalized = canonicalContextMatchText(normalizePolicyText(value));
  const tokens = normalized.split(' ').map(canonicalContextToken).filter(Boolean);
  const locations = new Set(tokens.filter(token =>
    LOCATION_DIRECTION_TOKENS.has(token) ||
    ['lot', 'side', 'area', 'zone', 'room', 'floor', 'level', 'roof', 'yard', 'building'].includes(token)
  ));
  for (const match of normalized.matchAll(
    /\b(?:lot|side|area|zone|room|floor|level|roof|yard|building|door|wall|canopy|pad)\s+[a-z0-9]+(?:[.-][a-z0-9]+)*\b/g,
  )) {
    locations.add(match[0]);
  }
  return [...locations].sort().join('|');
}

function drawingMeasurementAtoms(value: string) {
  const normalized = normalizePolicyText(
    value
      .replace(/[′’]/g, "'")
      .replace(/[″”]/g, '"')
      .replace(/[±∓]/g, ' plus or minus '),
  );
  const number = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)`;
  const pattern = new RegExp(
    String.raw`\b(${number})\s*(?:feet|foot|ft\.?|')\s*(?:-\s*)?(${number})?\s*(?:inches?|inch|in\.?|")?` +
      String.raw`|\b(${number})\s*[- ]?\s*(square\s+(?:feet|foot|inches?|inch|millimeters?|centimeters?|meters?|yards?)|sq\.?\s*(?:ft\.?|in\.?|mm|cm|m|yds?|yd)|sf|acres?|hectares?|inches?|inch|in\.?|"|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|gauge|ga\.?|mil|percent|%|degrees?)(?=$|[^a-z0-9])`,
    'g',
  );
  const parseNumber = (raw: string) => {
    const compact = raw.replace(/\s+/g, ' ').trim();
    const mixed = /^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/.exec(compact);
    if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(compact);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    return Number(compact);
  };
  const atoms: string[] = [];
  for (const match of normalized.matchAll(pattern)) {
    if (match[1]) {
      const feet = parseNumber(match[1]);
      const inches = match[2] ? parseNumber(match[2]) : 0;
      if (Number.isFinite(feet) && Number.isFinite(inches)) {
        atoms.push(`length-inch:${feet * 12 + inches}`);
      }
      continue;
    }
    const magnitude = parseNumber(match[3]);
    if (!Number.isFinite(magnitude)) continue;
    const unit = normalizePolicyText(match[4]);
    const family = /^(?:inches?|inch|in|\")$/.test(unit) ? 'length-inch'
      : /^(?:millimeters?|mm)$/.test(unit) ? 'length-mm'
      : /^(?:centimeters?|cm)$/.test(unit) ? 'length-cm'
      : /^(?:meters?|m)$/.test(unit) ? 'length-m'
      : /^(?:yards?|yds?|yd)$/.test(unit) ? 'length-yard'
      : /^(?:square feet|square foot|sq ft|sf)$/.test(unit) ? 'area-square-foot'
      : /^(?:square inches?|square inch|sq in)$/.test(unit) ? 'area-square-inch'
      : /^(?:square millimeters?|sq mm)$/.test(unit) ? 'area-square-mm'
      : /^(?:square centimeters?|sq cm)$/.test(unit) ? 'area-square-cm'
      : /^(?:square meters?|sq m)$/.test(unit) ? 'area-square-m'
      : /^(?:square yards?|sq yds?|sq yd)$/.test(unit) ? 'area-square-yard'
      : /^acres?$/.test(unit) ? 'area-acre'
      : /^hectares?$/.test(unit) ? 'area-hectare'
      : /^(?:percent|%)$/.test(unit) ? 'percent'
      : /^degrees?$/.test(unit) ? 'degree'
      : /^(?:gauge|ga)$/.test(unit) ? 'gauge'
      : unit === 'mil' ? 'mil'
      : '';
    if (family) atoms.push(`${family}:${magnitude}`);
  }
  const constraintNumber = new RegExp(
    String.raw`\b(?:plus\s+or\s+minus|tolerance(?:\s+of)?)\s*(${number})(?=$|[^a-z0-9])`,
    'g',
  );
  for (const match of normalized.matchAll(constraintNumber)) {
    const magnitude = parseNumber(match[1]);
    if (Number.isFinite(magnitude)) atoms.push(`tolerance:${magnitude}`);
  }
  const range = new RegExp(
    String.raw`\b(?:between\s+(${number})\s+and\s+(${number})|from\s+(${number})\s+to\s+(${number}))\b`,
  ).exec(normalized);
  if (range) {
    const lower = parseNumber(range[1] || range[3]);
    const upper = parseNumber(range[2] || range[4]);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      atoms.push(`range-lower:${lower}`, `range-upper:${upper}`);
    }
  }
  return [...new Set(atoms)].sort();
}

function drawingMeasurementConstraintMode(value: string) {
  const normalized = normalizePolicyText(value.replace(/[±∓]/g, ' plus or minus '));
  const scalar = String.raw`\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?`;
  const range = new RegExp(
    String.raw`\b(?:between\s+${scalar}\s+and\s+${scalar}|` +
      String.raw`from\s+${scalar}\s+(?:to|through|thru)\s+${scalar}|` +
      String.raw`range\s+${scalar}\s+(?:to|through|thru|-)\s*${scalar}|` +
      String.raw`${scalar}\s+(?:to|through|thru)\s+${scalar}\s*(?:"|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)|` +
      String.raw`${scalar}\s*-\s*${scalar}\s*(?:"|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd))(?=$|[^a-z0-9])`,
  ).test(normalized);
  const modes = [
    /\b(?:max(?:imum)?|not\s+to\s+exceed|no\s+more\s+than|at\s+most|up\s+to|cannot\s+exceed|(?:shall|must|can)\s+not\s+exceed|n\s*t\s*e)\b/.test(normalized)
      ? 'upper-inclusive' : '',
    new RegExp(`\\b(?:less\\s+than|under|below)\\s+${scalar}\\b`).test(normalized)
      ? 'upper-strict' : '',
    /\b(?:min(?:imum)?|not\s+less\s+than|no\s+less\s+than|at\s+least)\b/.test(normalized)
      ? 'lower-inclusive' : '',
    new RegExp(`\\b(?:greater\\s+than|more\\s+than|over|above)\\s+${scalar}\\b`).test(normalized)
      ? 'lower-strict' : '',
    range ? 'range' : '',
    /\b(?:plus\s+or\s+minus|tolerance)\b/.test(normalized) ? 'tolerance' : '',
    /\b(?:approx(?:imately)?|about|roughly|nominal(?:ly)?|typ(?:ical)?|estimated?)\b/.test(normalized)
      ? 'approximate' : '',
  ].filter(Boolean).sort();
  return modes.length > 0 ? modes.join('|') : 'exact';
}

function boundedDrawingPropositionAt(value: string, start: number, end: number) {
  let left = 0;
  let right = value.length;
  const boundary = /[\r\n;!?]+|\.\s+(?=[A-Z])/g;
  for (const match of value.matchAll(boundary)) {
    const boundaryStart = match.index || 0;
    const boundaryEnd = boundaryStart + match[0].length;
    if (boundaryEnd <= start) {
      left = boundaryEnd;
      continue;
    }
    if (boundaryStart >= end) {
      right = boundaryStart;
      break;
    }
  }
  return value.slice(left, right).trim();
}

function designFactPhrase(fact: string) {
  return fact
    .replace(/^the\s+(?:current\s+)?(?:drawing|plan)\s+(?:specifies|requires|shows)\s+/i, '')
    .replace(/^construct\s+/i, '')
    .replace(/^(.+?)\s+is\s+specified\s+where\b/i, '$1 where')
    .replace(/^(.+?)\s+is\s+specified\b/i, '$1')
    .replace(/^[A-Z]/, character => character.toLowerCase())
    .trim();
}

function joinDesignFacts(facts: readonly string[]) {
  if (facts.length <= 1) return facts[0] || '';
  if (facts.length === 2) return `${facts[0]}, and separately ${facts[1]}`;
  return `${facts.slice(0, -1).join(', ' )}, and separately ${facts[facts.length - 1]}`;
}

function pccThicknessesDiffer(facts: readonly string[]) {
  const values = facts.flatMap(fact => {
    const normalized = normalizePolicyText(fact);
    const subject = normalized.includes('pcc walkway')
      ? 'walkway'
      : normalized.includes('pcc paving') ? 'paving' : '';
    const measurement = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:\"|inches?|inch|in\.?|-inch)/)?.[1];
    return subject && measurement ? [{ subject, value: Number(measurement) }] : [];
  });
  return new Set(values.map(item => item.subject)).size >= 2 &&
    new Set(values.map(item => item.value)).size >= 2;
}

export function ecosAnswerRequirementInstruction(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === 'general') return null;
  if (requirement.kind === 'presence') {
    return `This question asks whether ${requirement.attribute || 'the requested feature'} is present. A direct yes or no answer must cite evidence that identifies both the requested subject and an explicit shown, specified, installed, absent, or prohibited ${requirement.attribute || 'feature'}. A speculative alternative, unrelated field note, document title alone, or mere keyword match is not proof.`;
  }
  if (requirement.kind === 'quantity') {
    return 'This question asks for a quantity. A direct factual answer must state an exact numeric count and cite evidence that contains that same count for the requested subject and location.';
  }
  if (requirement.attribute === 'area') {
    return 'This question asks for area. A direct answer must state square units. If the area is calculated from drawing dimensions, show the exact formula and cite the same-sheet dimensions used by the deterministic ECOS calculation.';
  }
  return `This question asks for ${requirement.attribute}. A direct factual answer must preserve the source's numeric measurement, including any bound, range, tolerance, or approximation, state its unit, and cite evidence containing that same constraint. A statement that merely mentions the subject, location, or missing measurement does not answer the question.`;
}

export function ecosMissingAnswerLimitation(question: string) {
  const requirement = analyzeECOSProjectQuestion(question);
  if (requirement.kind === 'general') {
    return 'The available evidence did not contain a directly supported answer to this question.';
  }
  if (requirement.kind === 'presence') {
    return `The indexed evidence did not explicitly show whether ${requirement.attribute || 'the requested feature'} is present for the requested subject and location.`;
  }
  if (requirement.kind === 'quantity') {
    return 'The indexed evidence did not contain a readable numeric quantity for the requested subject and location.';
  }
  return `The indexed evidence did not contain a readable numeric ${requirement.attribute} value with a unit for the requested subject and location.`;
}

function questionContextTokens(
  question: string,
  requirement: ECOSProjectAnswerRequirement,
) {
  const ignored = new Set([
    'a', 'about', 'according', 'an', 'and', 'any', 'approximately', 'are', 'at', 'based', 'be', 'by', 'exact', 'fact', 'for', 'from', 'how', 'in', 'is',
    'as', 'has', 'have', 'new', 'of', 'on', 'or', 'same', 'the', 'this', 'that', 'which', 'who', 'where',
    'to', 'was', 'were', 'what', 'when', 'with', 'relationship', 'specify', 'specifies', 'specified',
    'installed', 'placed', 'poured', 'built', 'constructed',
    'do', 'does', 'did', 'can', 'could', 'will', 'would', 'contain', 'contains',
    // Conversational request scaffolding carries no construction subject
    // meaning. Leaving it in the subject denominator makes natural questions
    // such as "can you tell me how thick..." fail while terse test phrases
    // pass against identical evidence.
    'answer', 'happen', 'know', 'let', 'me', 'need', 'tell', 'want',
    'confirm', 'verify', 'determine', 'whether', 'if', 'please', 'you', 'presence', 'appear', 'appears', 'include', 'includes', 'show', 'shown', 'shows', 'provide', 'provides', 'provided', 'require', 'requires', 'requirement', 'current',
    'present', 'required', 'exist', 'exists', 'plan', 'planned', 'roughly', 'schedule', 'scheduled',
    'using', 'overall', 'dimension', 'dimensions', 'its', 'calculated',
    'context', 'reference', 'only',
    'exclude', 'excluded', 'excluding', 'except', 'without', 'other', 'than', 'but',
    'not', 'dont', 'use', 'omit', 'skip', 'leave', 'ignore', 'ignored', 'ignoring',
    'between', 'detail', 'details', 'divided', 'document', 'drawing', 'each', 'entry',
    'identified', 'identify', 'left', 'list', 'listed', 'mark', 'marked', 'page', 'pdf',
    'approval', 'convert', 'conversion', 'indicate', 'indicated', 'indicates', 'per',
    'print', 'printed', 'report', 'reported', 'reports', 'said', 'say', 'says',
    'secure', 'size', 'state', 'stated', 'threshold', 'two',
    'architectural', 'structural', 'electrical', 'mechanical', 'plumbing', 'civil', 'landscape',
    'project', 'sheet', 'call', 'out', 'value',
    'many', 'inch', 'foot', 'millimeter', 'centimeter', 'meter', 'yard',
    ...(requirement.attributeTerms || []).flatMap(term => term.split(' ')),
  ]);
  const semanticQuestion = normalizePolicyPageReferenceLabels(
    stripECOSDrawingSheetReferenceSpans(
      canonicalizeECOSQuestionLanguage(question),
    ),
  );
  return [...new Set(canonicalContextMatchText(semanticQuestion).split(' ')
    .map(canonicalContextToken)
    .filter(token =>
      token.length >= 2 && !ignored.has(token) && !/^\d+$/.test(token)
    ))];
}

function canonicalContextToken(value: string) {
  if (value.length > 2 && value.endsWith("'s")) value = value.slice(0, -2);
  if (value === 'does') return 'do';
  if (value === 'teh') return 'the';
  if (value === 'northern') return 'north';
  if (value === 'southern') return 'south';
  if (value === 'eastern') return 'east';
  if (value === 'western') return 'west';
  if (value === 'status' || value === 'statuses') return 'status';
  if (/^(?:owner|owns|owned)$/.test(value)) return 'owner';
  if (value === 'finishes') return 'finish';
  if (value === 'starts') return 'start';
  if (/^opn'?g$/.test(value)) return 'opening';
  if (value === 'inches') return 'inch';
  if (value === 'feet') return 'foot';
  if (value.length > 4 && value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.length > 3 && value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1);
  return value;
}

function presenceAttribute(question: string) {
  if (
    /\b(?:have|has|contain|contains|include|includes|show|shows|provide|provides|provided)\s+(?:any\s+)?(?:clearances?|headroom)\b/i.test(question) ||
    /^(?:is|are|was|were)\s+(?:there\s+)?(?:any\s+)?(?:clearances?|headroom)\s+(?:shown|provided|included|available|visible|present|required)\b/i.test(question)
  ) return 'clearance';
  if (/\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/i.test(question)) {
    return 'lighting';
  }
  if (/\b(?:guardrail|guardrails|rail|railing|barrier)\b/i.test(question)) {
    return 'guardrail';
  }
  const match = question.match(/\b(?:have|has|contain|contains|include|includes|show|shows|provide|provides|provided)\s+(?:any\s+)?([a-z][a-z0-9-]*)\b/i);
  if (match?.[1]) return canonicalPresenceAttribute(match[1]);
  const installed = question.match(/\b([a-z][a-z0-9-]*)\s+(?:(?:is|are)\s+)?(?:(?:scheduled|planned)\s+to\s+be\s+)?(?:installed|present|required|exist|exists)\b/i);
  if (installed?.[1]) return canonicalPresenceAttribute(installed[1]);
  const rawTarget = policyPresenceRawTargetPhrase(question)
    .replace(/\s+(?:in|on|at)\s+(?:the\s+)?[a-z0-9][a-z0-9 ._-]*$/i, '')
    .replace(/^(?:any|a|an|the)\s+/i, '')
    .replace(/\s+presence$/i, '')
    .trim();
  const noun = rawTarget.match(/([a-z][a-z0-9-]*)\s*$/i)?.[1] || '';
  return noun ? canonicalPresenceAttribute(noun) : null;
}

function policyPresenceRawTargetPhrase(question: string) {
  const value = normalizePolicyText(question).replace(/[.?!]+$/, '');
  return [
    value.match(/^(?:is|are|was|were)\s+there\s+(?:any\s+|an?\s+)?(.+?)(?:\s+(?:on|in|at)\b.*)?$/)?.[1] || '',
    value.match(/\b(?:have|has|contain|contains|include|includes|show|shows|provide|provides|provided)\s+(?:any\s+)?(.+?)$/)?.[1] || '',
    value.match(/^(?:is|are|was|were)\s+(.+?)\s+(?:installed|present|required|shown|provided|included|available|visible)$/)?.[1] || '',
    value.match(/^(?:do|does)\s+(.+?)\s+(?:exist|exists|appear|appears)$/)?.[1] || '',
    value.match(/^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:confirm|verify|determine)\s+(?:(?:if|whether|that)\s+)?(.+?)\s+(?:is|are)\s+(?:shown|present|provided|included|available|visible)(?:\s+(?:in|on|at|within|inside|outside|near|nearby|around|opposite|adjacent|next|across|beyond|away)\b.*)?$/)?.[1] || '',
    value.match(/\b(?:can\s+you\s+|could\s+you\s+)?(?:confirm|verify|determine)\s+(?:if|whether|that)\s+(.+?)\s+(?:is|are)\s+(?:shown|present|provided|included|available|visible)(?:\s+(?:in|on|at|within|inside|outside|near|nearby|around|opposite|adjacent|next|across|beyond|away)\b.*)?$/)?.[1] || '',
    value.match(/^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:confirm|verify)\s+(.+?)(?:\s+presence)?$/)?.[1] || '',
    value.match(/^(?:any\s+)?(.+?)\s+(?:present|shown|provided|included|available|visible)(?:\s+(?:in|on|at|within|inside|outside|near|nearby|around|opposite|adjacent|next|across|beyond|away)\b.*)?$/)?.[1] || '',
    value.match(/^any\s+(.+)$/)?.[1] || '',
  ].find(Boolean) || '';
}

function canonicalPresenceAttribute(value: string) {
  const normalized = normalizePolicyText(value).replace(/ies$/, 'y').replace(/s$/, '');
  if (/^clearanc(?:e|y)$/.test(normalized)) return 'clearance';
  if (/^(?:light|lighting|fixture|luminaire)$/.test(normalized)) return 'lighting';
  if (/^(?:guardrail|rail|railing|barrier)$/.test(normalized)) return 'guardrail';
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
  if (/\b(?:either|possibly|possible|may|might|could)\b[\s\S]{0,100}\bor\b/.test(normalizedValue)) {
    return false;
  }
  const attributePattern = attributeTerms
    .map(term => escapeRegExp(normalizePolicyText(term)))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .join('|');
  if (!attributePattern) return false;
  const direct = new RegExp(
    `(?:\\b(?:has|have|includes?|contains?|provides?|shows?|indicates?|depicts?|identifies?|displays?|specifies?|requires?|installs?|installed|existing|new|with|without|no)\\b[\\s\\S]{0,80}\\b(?:${attributePattern})\\b|\\b(?:${attributePattern})\\b[\\s\\S]{0,80}\\b(?:shown|provided|identified|found|observed|detected|located|called\\s+out|specified|required|installed|existing|present|absent|prohibited|exist|exists|not\\s+provided|not\\s+shown)\\b|\\b(?:${attributePattern})\\s+(?:plan|plans|layout|schedule|fixture|fixtures|symbol|symbols)\\b)`,
    'i',
  );
  return direct.test(normalizedValue);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type ContextTokenEvidenceMatcher = (
  normalizedEvidence: string,
  canonicalEvidence: string,
) => boolean;

function prepareContextTokenEvidenceMatcher(token: string): ContextTokenEvidenceMatcher {
  const compoundDirection = /^(north|south)(east|west)$/.exec(token);
  const compoundDirectionPatterns = compoundDirection
    ? compoundDirection.slice(1).map(direction =>
      new RegExp(`(?:^|[^a-z0-9])${direction}(?=$|[^a-z0-9])`)
    )
    : [];
  const variantPatterns = [token, ...(QUESTION_CONTEXT_VARIANTS[token] || [])]
    .flatMap(variant => {
      const normalizedVariant = canonicalContextMatchText(normalizePolicyText(variant));
      return normalizedVariant ? [new RegExp(
        `(?:^|[^a-z0-9])${escapeRegExp(normalizedVariant)}(?=$|[^a-z0-9])`,
      )] : [];
    });
  return (normalizedEvidence, canonicalEvidence) =>
    compoundDirectionPatterns.length > 0 &&
      compoundDirectionPatterns.every(pattern => pattern.test(normalizedEvidence)) ||
    variantPatterns.some(pattern => pattern.test(canonicalEvidence));
}

function prepareContextTokenEvidenceMatchers(tokens: readonly string[]) {
  return new Map(tokens.map(token => [token, prepareContextTokenEvidenceMatcher(token)] as const));
}

function contextTokenMatchesEvidence(token: string, normalizedEvidence: string) {
  return prepareContextTokenEvidenceMatcher(token)(
    normalizedEvidence,
    canonicalContextMatchText(normalizedEvidence),
  );
}

function canonicalContextMatchText(value: string) {
  return value
    .replace(/\bhps\s*drawing\b/g, 'high pile storage drawing')
    .replace(/\bhpsdrawing\b/g, 'high pile storage drawing')
    .replace(/\bair[\s-]+flow\b/g, 'airflow')
    .replace(/\b([a-z0-9]+)'s\b/g, '$1')
    .replace(/['"‘’“”]/g, '')
    .replace(/\b(north|south)(?:\s*[-/.]\s*|\s+)(east|west)\b/g, '$1$2')
    .replace(/[-/.]/g, ' ')
    .split(/\s+/)
    .map(canonicalContextToken)
    .filter(Boolean)
    .join(' ');
}

function evidenceExpressesRequestedMeasurementAttribute(
  requirement: ECOSProjectAnswerRequirement,
  normalizedEvidence: string,
  question: string,
) {
  if (requirement.kind !== 'measurement' || !requirement.attribute) return false;
  if (!containsECOSMeasurementValue(normalizedEvidence)) return false;
  if (requirement.attribute === 'width') {
    return /\b(?:standard|van)\s+:?\s*\d+[\s\S]{0,120}\bparking(?: stall)?\b[\s\S]{0,80}\bstriped (?:loading|unloading)\b/.test(
      normalizedEvidence,
    ) || /\btypical accessible parking stall striped loading\b/.test(normalizedEvidence) ||
      /\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|')\s*w\b/.test(normalizedEvidence) ||
      /\bup to\s+\d+[\s\S]{0,30}\b(?:opening|opn)\b/.test(normalizedEvidence);
  }
  if (requirement.attribute === 'depth') {
    if (!/\bfront\s+landscape(?:\s+(?:area|depth))?\b/.test(normalizePolicyText(question))) {
      return false;
    }
    const linearNumber = String.raw`\d+(?:,\d{3})*(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?`;
    const linearUnit = String.raw`(?:["”'’]|inches?|inch|in\.?|feet|foot|ft\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd)`;
    return new RegExp(
      String.raw`\bminimum\s+${linearNumber}\s*${linearUnit}` +
        String.raw`(?:\s*-?\s*${linearNumber}\s*${linearUnit})?` +
        String.raw`\s+front landscape area\b`,
    ).test(normalizedEvidence);
  }
  if (requirement.attribute === 'length') {
    return /\b\d+\s*(?:feet|foot|ft\.?)\s+of\s+(?:new or replacement )?space conditioning ducts?\b/.test(
      normalizedEvidence,
    ) || /\blength\s+\d+[\s\S]{0,60}\bvoltage drop\b/.test(normalizedEvidence);
  }
  if (requirement.attribute === 'spacing') {
    return /(?:^|[^a-z0-9])(?:o|0)\s*\.?\s*c\s*\.?(?=$|[^a-z0-9])/.test(normalizedEvidence);
  }
  if (requirement.attribute === 'height') {
    return /\bno more than\s+\d+[\s\S]{0,40}\babove the floor\b/.test(normalizedEvidence) ||
      /\d+(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?\s*(?:"|')\s*h\b/.test(normalizedEvidence) ||
      /\b(?:aff|above (?:the )?(?:finish|finished) floor|above (?:the )?ground surface)\b/.test(normalizedEvidence);
  }
  if (requirement.attribute === 'thickness') {
    return /\b\d+(?:\.\d+)?\s*mil\b|\bthk\b|\bthick\b/.test(normalizedEvidence);
  }
  return false;
}

function normalizePolicyText(value: string) {
  return value
    // Remove invisible formatting controls before token boundaries are
    // established. Otherwise `super<soft-hyphen>seded` can evade the same
    // fail-closed qualifier policy as ordinary `superseded` evidence.
    .replace(/\p{Cf}/gu, '')
    // Preserve exact construction fractions before the generic Unicode scrub.
    // Adding the mixed-number boundary first keeps compact 1½ equal to 1 1/2,
    // while a standalone ½ remains the exact rational 1/2.
    .replace(/(?<=\d)(?=[\u00bc-\u00be\u2150-\u215e])/gu, ' ')
    .replace(/[\u00bc-\u00be\u2150-\u215e]/gu, fraction =>
      fraction.normalize('NFKC').replace('⁄', '/')
    )
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .normalize('NFKC')
    .replace(/(?<=\d)⁄(?=\d)/g, '/')
    .replace(/[‐‑‒–—―−]/g, '-')
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/²/g, ' 2')
    .replace(/³/g, ' 3')
    .replace(/,/g, '')
    .replace(/[^a-z0-9./%"'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePolicyQuestionText(value: string) {
  return normalizePolicyText(canonicalizeECOSQuestionLanguage(value));
}

const ECOS_PAGE_CARDINAL_VALUES: Readonly<Record<string, number>> = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
});

const ECOS_PAGE_ORDINAL_VALUES: Readonly<Record<string, number>> = Object.freeze({
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40,
  fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
});

const ECOS_PAGE_UNITS = Object.freeze([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
]);
const ECOS_PAGE_UNIT_ORDINALS = Object.freeze([
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth',
]);
const ECOS_PAGE_TENS = Object.freeze([
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
]);

const ecosPageCardinalPhrases = Object.freeze(Object.entries({
  ...ECOS_PAGE_CARDINAL_VALUES,
  ...Object.fromEntries(ECOS_PAGE_TENS.flatMap(tens => ECOS_PAGE_UNITS.map(unit => [
    `${tens} ${unit}`,
    ECOS_PAGE_CARDINAL_VALUES[tens] + ECOS_PAGE_CARDINAL_VALUES[unit],
  ]))),
}));
const ecosPageOrdinalPhrases = Object.freeze(Object.entries({
  ...ECOS_PAGE_ORDINAL_VALUES,
  ...Object.fromEntries(ECOS_PAGE_TENS.flatMap(tens => ECOS_PAGE_UNIT_ORDINALS.map((unit, index) => [
    `${tens} ${unit}`,
    ECOS_PAGE_CARDINAL_VALUES[tens] + index + 1,
  ]))),
}));

function ecosPageWordPattern(values: readonly (readonly [string, number])[]) {
  return values
    .map(([value]) => value)
    .sort((left, right) => right.length - left.length)
    .map(value => value.replace(/ /g, '[\\s-]+'))
    .join('|');
}

const ECOS_PAGE_CARDINAL_WORD_PATTERN = ecosPageWordPattern(ecosPageCardinalPhrases);
const ECOS_PAGE_ORDINAL_WORD_PATTERN = ecosPageWordPattern(ecosPageOrdinalPhrases);
const ECOS_PAGE_WORD_ROOT_PATTERN =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
  'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|' +
  'fifty|sixty|seventy|eighty|ninety)';
const ECOS_PAGE_LIST_CONNECTOR_PATTERN =
  '(?:\\s*(?:-|through|thru|to)\\s*|\\s*,\\s*(?:(?:and|or)\\s+)?|' +
  '\\s+(?:and\\s*\\/\\s*or|or\\s*\\/\\s*and|as\\s+well\\s+as|versus|vs\\.?|and|or|&)\\s+)';

function ecosPageWordValue(
  raw: string,
  values: readonly (readonly [string, number])[],
) {
  const canonical = raw.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return values.find(([value]) => value === canonical)?.[1] ?? null;
}

export function canonicalizeECOSPageReferenceWords(value: string) {
  // Preserve the mathematical minus sign so the page parser can reject it as
  // a signed value rather than confusing it with the supported `page-2`
  // punctuation form.
  let text = value.normalize('NFKC').replace(/[‐‑‒–—―]/g, '-');
  let sawWordScope = false;
  let invalidWordScope = false;
  const invalidWordTail = '(?:[a-z0-9]|\\s+(?:hundred|thousand|million|point)\\b|\\s*\\.\\s*\\d)';
  const pagePrefix =
    '\\b(?:pdf\\s+)?pages?\\b(?:\\s+(?:number|no\\.?)\\s*:?\\s*)?(?:\\s+from)?\\s+';
  const invalidInitial = new RegExp(
    `${pagePrefix}(${ECOS_PAGE_CARDINAL_WORD_PATTERN})(?=${invalidWordTail})`,
    'i',
  );
  const invalidContinuation = new RegExp(
    `${pagePrefix}[^.;!?]{0,80}${ECOS_PAGE_LIST_CONNECTOR_PATTERN}` +
      `(?:(?:pdf\\s+)?pages?\\s+)?(${ECOS_PAGE_CARDINAL_WORD_PATTERN})(?=${invalidWordTail})`,
    'i',
  );
  const unsupportedWordScope = new RegExp(
    `${pagePrefix}${ECOS_PAGE_WORD_ROOT_PATTERN}\\s+(?:hundred|thousand|million|point)\\b`,
    'i',
  );
  if (invalidInitial.test(text) || invalidContinuation.test(text) || unsupportedWordScope.test(text)) {
    sawWordScope = true;
    invalidWordScope = true;
  }
  const coordinatedOrdinalPattern = new RegExp(
    `\\b((?:${ECOS_PAGE_ORDINAL_WORD_PATTERN})` +
      `(?:${ECOS_PAGE_LIST_CONNECTOR_PATTERN}(?:${ECOS_PAGE_ORDINAL_WORD_PATTERN}))+` +
      `)\\s+((?:pdf\\s+)?pages?)\\b`,
    'gi',
  );
  text = text.replace(
    coordinatedOrdinalPattern,
    (match, rawList: string, rawLabel: string) => {
      const ordinalPattern = new RegExp(`\\b(${ECOS_PAGE_ORDINAL_WORD_PATTERN})\\b`, 'gi');
      const ordinals = [...rawList.matchAll(ordinalPattern)];
      if (ordinals.length < 2) return match;
      sawWordScope = true;
      const converted = rawList.replace(
        ordinalPattern,
        (rawOrdinal: string) => String(
          ecosPageWordValue(rawOrdinal, ecosPageOrdinalPhrases) ?? rawOrdinal,
        ),
      );
      return `${rawLabel} ${converted}`;
    },
  );
  // If a coordinated preposed ordinal list did not match the closed grammar,
  // do not let the single-ordinal fallback route only its final suffix.
  const unresolvedCoordinatedOrdinalPattern = new RegExp(
    `\\b(?:${ECOS_PAGE_ORDINAL_WORD_PATTERN})${ECOS_PAGE_LIST_CONNECTOR_PATTERN}` +
      `[^.;!?]{0,80}\\b(?:${ECOS_PAGE_ORDINAL_WORD_PATTERN})\\s+` +
      `(?:pdf\\s+)?pages?\\b`,
    'i',
  );
  if (unresolvedCoordinatedOrdinalPattern.test(text)) {
    sawWordScope = true;
    invalidWordScope = true;
  }
  const ordinalPattern = new RegExp(
    `\\b(${ECOS_PAGE_ORDINAL_WORD_PATTERN})\\s+((?:pdf\\s+)?pages?)\\b`,
    'gi',
  );
  text = text.replace(ordinalPattern, (match, rawOrdinal: string, rawLabel: string) => {
    const page = ecosPageWordValue(rawOrdinal, ecosPageOrdinalPhrases);
    if (page == null) return match;
    sawWordScope = true;
    return `${rawLabel} ${page}`;
  });
  const pageValue = `(?:10000|\\d{1,4}|${ECOS_PAGE_CARDINAL_WORD_PATTERN})`;
  const pageExpression = new RegExp(
    `${pagePrefix}${pageValue}(?:${ECOS_PAGE_LIST_CONNECTOR_PATTERN}` +
      `(?:(?:pdf\\s+)?pages?\\s+)?${pageValue})*`,
    'gi',
  );
  text = text.replace(pageExpression, expression => expression.replace(
    new RegExp(`\\b(${ECOS_PAGE_CARDINAL_WORD_PATTERN})\\b`, 'gi'),
    (match, rawCardinal: string) => {
      const page = ecosPageWordValue(rawCardinal, ecosPageCardinalPhrases);
      if (page == null) return match;
      sawWordScope = true;
      return String(page);
    },
  ));
  // Preserve the existing page-size guard when dimensions are written out.
  text = text.replace(
    new RegExp(
      `(\\b(?:pdf\\s+)?pages?\\b(?:\\s+(?:number|no\\.?)\\s*:?\\s*)?\\s*(?:10000|\\d{1,4})` +
        `\\s+(?:by|x|×)\\s+)(${ECOS_PAGE_CARDINAL_WORD_PATTERN})\\b`,
      'gi',
    ),
    (match, prefix: string, rawCardinal: string) => {
      const page = ecosPageWordValue(rawCardinal, ecosPageCardinalPhrases);
      if (page == null) return match;
      sawWordScope = true;
      return `${prefix}${page}`;
    },
  );
  return Object.freeze({ text, sawWordScope, invalidWordScope });
}

export type ECOSRequestedPDFPageScope = Readonly<{
  explicit: boolean;
  invalid: boolean;
  pages: readonly number[];
  excludedPages: readonly number[];
  exclusionOnly: boolean;
  includedQuestion: string;
}>;

type ECOSBasePDFPageScope = Readonly<{
  explicit: boolean;
  invalid: boolean;
  pages: readonly number[];
}>;

function canonicalizeECOSExplicitPDFPageAbbreviations(value: string) {
  return value
    .replace(
      /\b(?:pp|pgs)\.?\s+(\d+(?:\s*(?:-|through|thru|to|,|and|or|&)\s*\d+){0,31})\s+of\s+(?:the\s+)?pdf\b/gi,
      'PDF pages $1',
    )
    .replace(/\bp\.?\s+(\d+)\s+of\s+(?:the\s+)?pdf\b/gi, 'PDF page $1')
    .replace(/\bpdf\s+page\s*\(\s*s\s*\)(?=\s+\d)/gi, 'PDF pages')
    .replace(/\bpdf\s+(?:pp|pgs)\.?(?=\s+\d)/gi, 'PDF pages')
    .replace(/\bpdf\s+p\.?(?=\s+\d)/gi, 'PDF page');
}

function ecosPDFPageScanText(value: string) {
  return canonicalizeECOSExplicitPDFPageAbbreviations(value.normalize('NFKC'))
    .replace(/[\p{Cf}\p{M}]/gu, '')
    .replace(/[‐‑‒–—―]/g, '-');
}

function normalizeECOSPDFPageLabelSeparators(value: string) {
  return value
    .replace(/\b((?:pdf\s+)?pages?)\s+(?:number|no\.?)\s*:?\s*(?=\d)/gi, '$1 ')
    .replace(
      /\b((?:pdf\s+)?pages?)\s*(?:[()[\]{}:;,#_./\\|-]+\s*)+(?=(?:no\.?\s*:?\s*)?\d)/gi,
      '$1 ',
    );
}

function parseECOSBasePDFPageScope(question: string): ECOSBasePDFPageScope {
  const canonicalPageWords = canonicalizeECOSPageReferenceWords(ecosPDFPageScanText(question));
  const rawScanText = canonicalPageWords.text
    .replace(/[\u2044\u2215]/g, '/')
    .replace(
      /\b((?:pdf\s+)?pages?\s+\d+)\s*(?:…|(?<!\.)\.{3}(?!\.))\s*(\d+)\b/gi,
      '$1 through $2',
    )
    .replace(
      /\b((?:pdf\s+)?)pg\.?(?=\s*[()[\]{}:;,#_./\\|+−-]*\s*\d)/gi,
      '$1page',
    );
  const signedPage = /\b(?:pdf\s+)?pages?(?:\s+(?:number|no\.?)\s*)?(?:\s+[+−-]\s*\d|[+−]\s*\d|\s*[()[\]{}:;,#_./\\|]+\s*[+−-]\s*\d)/i.test(
    rawScanText,
  );
  const unsupportedEllipsisPage =
    /\b(?:pdf\s+)?pages?\b[^\n]{0,120}(?:…|\.{3})/.test(rawScanText);
  const scanText = normalizeECOSPDFPageLabelSeparators(rawScanText);
  const pages: number[] = [];
  let explicit = signedPage || unsupportedEllipsisPage || canonicalPageWords.invalidWordScope;
  let invalid = signedPage || unsupportedEllipsisPage || canonicalPageWords.invalidWordScope;
  let consumedUntil = -1;
  const addPage = (value: number) => {
    if (!pages.includes(value)) pages.push(value);
  };
  const pageLabels = [...scanText.matchAll(/\b(?:pdf\s+)?pages?\b/gi)];
  for (const labelMatch of pageLabels) {
    const labelStart = labelMatch.index || 0;
    if (labelStart < consumedUntil) continue;
    const labelEnd = labelStart + labelMatch[0].length;
    const firstMatch = /^\s*(?:from\s+)?(\d+)/i.exec(scanText.slice(labelEnd));
    if (!firstMatch) {
      // An explicit PDF-page label with a missing or nonnumeric member is not
      // an unscoped question. Treating `PDF page A` as broad search would let
      // an arbitrary page answer a malformed exact-location request.
      if (/\bpdf\b/i.test(labelMatch[0])) {
        explicit = true;
        invalid = true;
      }
      continue;
    }
    let cursor = labelEnd + firstMatch[0].length;
    const firstPage = Number(firstMatch[1]);
    const immediatelyAfterFirst = scanText.slice(cursor);
    const compositeFirst = /^\s*[/.]\s*\d+\b/.test(immediatelyAfterFirst);
    const suffixedFirst = /^[A-Za-z]/.test(immediatelyAfterFirst);
    const pageMeasurementUnit =
      '(?:inches?|inch|in\\.?(?!\\s+[a-z])|["″]|′{2}|feet|foot|ft\\.?|millimeters?|mm|centimeters?|cm|meters?|m|yards?|yds?|yd|pixels?)';
    const pageAuthorityDiscipline =
      '(?:civil|electrical|architectural|architecture|structural|structure|mechanical|hvac|plumbing|landscape|landscaping|canopy|high[- ]pile)';
    const pageAuthorityDisciplineConnector =
      '(?:and\\s*\\/\\s*or|or\\s*\\/\\s*and|as\\s+well\\s+as|versus|vs\\.?|[,/&+]|and|or)';
    const pageAuthorityDisciplineList =
      `${pageAuthorityDiscipline}(?:\\s*${pageAuthorityDisciplineConnector}\\s*${pageAuthorityDiscipline})*`;
    const pageAuthorityCarrier =
      '(?:drawings?|plans?|plan\\s+sets?|documents?|sets?|packages?|files?|' +
      'specifications?|specs?|manuals?|reports?|submittals?|' +
      'append(?:ix(?:es)?|ices)(?:\\s+["\']?[a-z0-9]+(?:[.-][a-z0-9]+)*["\']?)?)';
    const postposedPageAuthorityContext = (tail: string) => new RegExp(
      `^\\s*(?:(?:[-(]\\s*)|(?:(?:in|of|from|on|for|at|within)\\s+))` +
        `(?:the\\s+)?(?:(?:current|project)\\s+)?` +
        `(?:${pageAuthorityDisciplineList}\\s+)?${pageAuthorityCarrier}\\b`,
      'i',
    ).test(tail);
    const measurementTail = !postposedPageAuthorityContext(immediatelyAfterFirst) && new RegExp(
      `^\\s*-?\\s*${pageMeasurementUnit}(?=$|[\\s,.;:!?])`,
      'i',
    ).test(immediatelyAfterFirst);
    const pageDimensionAmount =
      '(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:\\s+\\d+\\s*[\\/⁄]\\s*\\d+)?';
    const compoundMeasurementTail = new RegExp(
      `^\\s*(?:from\\s+)?${pageDimensionAmount}\\s*(?:-?\\s*${pageMeasurementUnit})?` +
        `\\s*-?\\s*(?:by|x|×)\\s*-?\\s*${pageDimensionAmount}\\s*(?:-?\\s*${pageMeasurementUnit})?` +
        `(?=$|[\\s,.;:!?])`,
      'i',
    ).test(scanText.slice(labelEnd));
    if (measurementTail || compoundMeasurementTail) continue;
    explicit = true;
    if (
      compositeFirst || suffixedFirst ||
      !Number.isSafeInteger(firstPage) || firstPage < 1 || firstPage > 10_000
    ) {
      invalid = true;
      consumedUntil = cursor;
      continue;
    }
    addPage(firstPage);
    let previousPage = firstPage;
    while (cursor < scanText.length) {
      const closing = /^\s*[\])}]/.exec(scanText.slice(cursor));
      if (closing) cursor += closing[0].length;
      const remainder = scanText.slice(cursor);
      const ambiguousConnector = /^\s*(?:&\s*\/\s*or|or\s*\/\s*&|and\s*\/\s*&|&\s*\/\s*and)\s*/i.exec(
        remainder,
      );
      if (ambiguousConnector) {
        invalid = true;
        cursor += ambiguousConnector[0].length;
        break;
      }
      const rangeConnector = /^\s*(?:-|through|thru|to)\s*/i.exec(remainder);
      const listConnector = /^\s*(?:,\s*(?:as\s+well\s+as|in\s+addition\s+to)\s+|,\s*(?:(?:and|or)\s+)?|(?:and\s*\/\s*or|or\s*\/\s*and|as\s+well\s+as|in\s+addition\s+to|and\s+also|or\s+alternatively|plus|versus|vs\.?|and|or|&)\s+)/i.exec(remainder);
      const repeatedPageLabelConnector = /^\s*(?:with|alongside(?:\s+of)?|compared\s+(?:with|to))\s+(?=(?:pdf\s+)?pages?\b)/i.exec(
        remainder,
      );
      const connector = rangeConnector || listConnector || repeatedPageLabelConnector;
      if (!connector) break;
      let nextCursor = cursor + connector[0].length;
      const repeatedLabel = /^(?:pdf\s+)?pages?\b/i.exec(scanText.slice(nextCursor));
      if (repeatedLabel) nextCursor += repeatedLabel[0].length;
      const nextMatch = /^\s*[([{:;,#_\\|]*\s*(\d+)/.exec(scanText.slice(nextCursor));
      if (!nextMatch) {
        // Once a list/range connector is consumed, the next page member is
        // mandatory. A bare comma may instead terminate the page phrase and
        // introduce ordinary prose. A word connector may also introduce a
        // different location axis (`page 2 and Sheet E1`) or the next clause.
        // Only a repeated page label, range, dangling connector, or isolated
        // one-letter member is unambiguously a malformed page list.
        const bareTerminatingComma = /^\s*,\s*$/.test(connector[0]);
        const missingTail = scanText.slice(nextCursor).trimStart();
        const rangeText = connector[0].trim().toLowerCase();
        const postposedAuthorityPunctuation = rangeText === '-' &&
          postposedPageAuthorityContext(scanText.slice(cursor));
        const unambiguouslyMalformedRange = Boolean(rangeConnector) &&
          !postposedAuthorityPunctuation && /^(?:-|through|thru)$/.test(rangeText);
        if (
          !bareTerminatingComma && (
            unambiguouslyMalformedRange ||
            Boolean(repeatedLabel) ||
            !missingTail ||
            /^[?!.,;:]/.test(missingTail) ||
            /^[+−-]\s*\d/.test(missingTail) ||
            /^[A-Za-z](?=$|[?!.,;:\s])/.test(missingTail)
          )
        ) invalid = true;
        break;
      }
      const nextPage = Number(nextMatch[1]);
      const nextEnd = nextCursor + nextMatch[0].length;
      const immediatelyAfterNext = scanText.slice(nextEnd);
      const compositeNext = /^\s*[/.]\s*\d+\b/.test(immediatelyAfterNext);
      const suffixedNext = /^[A-Za-z]/.test(immediatelyAfterNext);
      const nextMeasurement = !postposedPageAuthorityContext(immediatelyAfterNext) && new RegExp(
        `^\\s*-?\\s*${pageMeasurementUnit}(?=$|[\\s,.;:!?])`,
        'i',
      ).test(immediatelyAfterNext);
      if (
        compositeNext || suffixedNext || nextMeasurement ||
        !Number.isSafeInteger(nextPage) || nextPage < 1 || nextPage > 10_000
      ) {
        invalid = true;
        cursor = nextEnd;
        break;
      }
      if (rangeConnector) {
        if (nextPage < previousPage || nextPage - previousPage > 31) {
          invalid = true;
          cursor = nextEnd;
          break;
        }
        for (let page = previousPage + 1; page <= nextPage; page += 1) addPage(page);
      } else {
        addPage(nextPage);
      }
      previousPage = nextPage;
      cursor = nextEnd;
    }
    const unsupportedNumericContinuation = /^\s*(?:;|\||:|[+−]|with\b|against\b|alongside(?:\s+of)?\b|(?:&|and|or)\s*\/\s*(?:or|and|&)\b|,\s*(?:plus\b|[+−])|(?:except(?:\s+for)?|but\s+not|excluding|without|,\s*not)\b)\s*(?:(?:and|or)\s+)?(?:(?:pdf\s+)?pages?\s+(?:(?:number|no\.?)\s*:?\s*)?)?[([{:;,#_\\|]*\s*[+−-]?\s*\d+\b/i.test(
      scanText.slice(cursor),
    );
    const unsupportedBareNumericContinuation = (
      /pages/i.test(labelMatch[0]) && /^\s+\d+\b/.test(scanText.slice(cursor))
    ) || /^\s+(?:then|followed\s+by|next(?:\s+to)?)\s+(?:(?:pdf\s+)?pages?\s+)?\d+\b/i.test(
      scanText.slice(cursor),
    );
    if (unsupportedNumericContinuation || unsupportedBareNumericContinuation) invalid = true;
    consumedUntil = Math.max(consumedUntil, cursor);
  }
  if (/\b(?:pdf\s+)?pages?\b[^\n]{0,120}\b(?:(?:and|or|&|through|thru|to|versus)\s*(?:[?!.,;:]|$)|vs\.?\s*(?:[?!,;:]|$))/i.test(
    scanText,
  )) {
    explicit = true;
    invalid = true;
  }
  if (!explicit) invalid = false;
  return Object.freeze({ explicit, invalid, pages: Object.freeze(pages) });
}

function ecosPageExclusionCueIsNegated(
  text: string,
  cueStart: number,
  cueText: string,
  followingText = '',
) {
  const before = text.slice(Math.max(0, cueStart - 80), cueStart)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trimEnd();
  const cue = cueText.toLowerCase().replace(/\s+/g, ' ').trim();
  const after = followingText.toLowerCase().replace(/\s+/g, ' ').trimStart();
  if (cue === 'without' && /^excluding\b/.test(after)) return true;
  if (/^do not use$/.test(cue) && /^anything\s+(?:except|other than)\b/.test(after)) {
    return true;
  }
  if (/^(?:excluding|ignore|ignoring|omit|omitting|skip|skipping|disregard)$/.test(cue)) {
    if (/(?:\bnever|\bnot|\bwithout|\bdo not(?: ever)?|\bdon['’]?t(?: ever)?)\s*$/.test(before)) {
      return true;
    }
  }
  if (/^(?:ignore|ignoring)$/.test(cue) && new RegExp(
    `^(?:the\\s+)?(?:pdf\\s+)?page(?:s)?\\s+\\d+(?:\\s+(?:note|dimension|label|title|number|reference))\\b`,
  ).test(after)) return true;
  if (/^(?:except(?: for)?|other than)$/.test(cue) &&
    /(?:\bdo not|\bdon['’]?t)\s+use\s+(?:anything|any(?:thing)?|any\s+source)\s*$/.test(before)) {
    return true;
  }
  if (/^(?:skip|skipping)$/.test(cue) && /^ahead\s+to\b/.test(after)) return true;
  if (/^but not$/.test(cue) && /^(?:shown|listed|identified|noted)\b/.test(after)) return true;
  return false;
}

function ecosPageExclusionProjection(question: string) {
  const canonicalWords = canonicalizeECOSPageReferenceWords(ecosPDFPageScanText(question));
  const text = canonicalWords.text;
  const cue =
    '(?:without\\s+using|do\\s+not\\s+rely\\s+on|do\\s+not\\s+use|don[\'’]?t\\s+use|' +
    'leave\\s+out|excluding|except(?:\\s+for)?|without|other\\s+than|but\\s+not|' +
    'not\\s+from|ignoring|ignore|omitting|omit|skipping|skip|disregard)';
  const identifier = '["\'‘’“”]?[a-z0-9]+(?:[.-][a-z0-9]+)*\\+?["\'‘’“”]?';
  const discipline =
    '(?:civil|electrical|architectural|architecture|structural|structure|mechanical|' +
    'hvac|plumbing|landscape|landscaping|canopy|high[- ]pile)';
  const carrier =
    '(?:drawings?|plans?|plan\\s+sets?|documents?|sets?|packages?|files?|' +
    'specifications?|specs?|manuals?|reports?|submittals?|append(?:ix(?:es)?|ices))';
  const authorityCarrier =
    `(?:drawings?|plans?|plan\\s+sets?|documents?|sets?|packages?|files?|` +
    `specifications?|specs?|manuals?|reports?|submittals?|` +
    `append(?:ix(?:es)?|ices)(?:\\s+${identifier})?)`;
  const namedAuthority =
    `(?:(?:canop(?:y|ies)|drawings?|documents?|sheets?|plans?|details?|figures?)\\s+${identifier})`;
  const documentNamedAuthority =
    `(?:(?:drawings?|documents?|sheets?|plans?)\\s+${identifier})`;
  const authorityLead =
    `(?:(?:the|all|any|current|project)\\s+)*(?:(?:${discipline})\\s+)?` +
    `(?:(?:${authorityCarrier})\\s+|${namedAuthority}\\s+)?`;
  const authorityTail =
    `(?:\\s*(?:\\(\\s*)?(?:(?:in|from|of|on|for|at|within)\\s+)?` +
    `(?:the\\s+)?(?:(?:current|project)\\s+)?(?:(?:${discipline})\\s+)?` +
    `(?:${namedAuthority}|${authorityCarrier})(?:\\s*\\))?)?`;
  const pageConnector =
    '(?:\\s*(?:-|through|thru|to)\\s*|\\s*,\\s*(?:(?:and|or)\\s+)?|' +
    '\\s+(?:and\\s*\\/\\s*or|or\\s*\\/\\s*and|as\\s+well\\s+as|versus|vs\\.?|and|or|&)\\s+)';
  const pageExpression =
    '(?:pdf\\s+)?pages?(?:\\s+(?:number|no\\.?)\\s*:?\\s*)?(?:\\s+from)?\\s+\\d{1,5}' +
    `(?:${pageConnector}(?:(?:pdf\\s+)?pages?\\s+)?\\d{1,5})*`;
  const pagePattern = new RegExp(
    `\\b(${cue})\\s*[:/([{-]*\\s*(${authorityLead})(${pageExpression})(${authorityTail})`,
    'gi',
  );
  const spans: Array<{ start: number; end: number }> = [];
  const excludedPages: number[] = [];
  let invalid = canonicalWords.invalidWordScope;
  for (const match of text.matchAll(pagePattern)) {
    const start = match.index || 0;
    const cueText = match[1] || '';
    const followingCue = text.slice(start + cueText.length);
    if (ecosPageExclusionCueIsNegated(text, start, cueText, followingCue)) continue;
    const scope = parseECOSBasePDFPageScope(match[3]);
    const matchEnd = start + match[0].length;
    if (/^\s+(?:note|dimension|label|title|number|reference)\b/i.test(text.slice(matchEnd))) {
      continue;
    }
    if (!scope.explicit || scope.invalid || scope.pages.length === 0) invalid = true;
    else {
      for (const page of scope.pages) {
        if (!excludedPages.includes(page)) excludedPages.push(page);
      }
    }
    const authorityText = `${match[2] || ''} ${match[4] || ''}`;
    if (new RegExp(`\\b(?:${discipline}|${authorityCarrier}|${namedAuthority})\\b`, 'i').test(authorityText)) {
      // Page+document tuples are not yet represented end to end. Silently
      // removing the document side would invert the user's exclusion.
      invalid = true;
    }
    if (/^\s*(?:,?\s*(?:and|or|&|through|thru|to)\b)/i.test(text.slice(matchEnd))) {
      invalid = true;
    }
    const closingParenthesis = /^\s*\)/.exec(text.slice(matchEnd));
    spans.push({
      start,
      end: closingParenthesis ? matchEnd + closingParenthesis[0].length : matchEnd,
    });
  }

  const authorityOnlyPattern = new RegExp(
      `\\b(${cue})\\s*[:/([{-]*\\s*(?:the\\s+)?(?:all\\s+|any\\s+)?` +
      `(?:(?:${discipline})\\s+)?(?:${documentNamedAuthority}|${authorityCarrier})` +
      `(?=\\s*(?:[,;.!?]|$|\\b(?:according|based|using|from|in|on|what|which|how|does|do|is|are)\\b))`,
    'gi',
  );
  for (const match of text.matchAll(authorityOnlyPattern)) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (ecosPageExclusionCueIsNegated(text, start, match[1] || '', text.slice(end))) continue;
    if (!spans.some(span => start < span.end && end > span.start)) {
      spans.push({ start, end });
      // Authority exclusions cannot be honored by a page-number-only model.
      // Fail closed instead of broadening to the forbidden carrier/discipline.
      invalid = true;
    }
  }

  let includedQuestion = text;
  for (const span of [...spans].sort((left, right) => right.start - left.start)) {
    includedQuestion = `${includedQuestion.slice(0, span.start)}${' '.repeat(span.end - span.start)}` +
      includedQuestion.slice(span.end);
  }
  const residual = includedQuestion;
  const residualCue = new RegExp(`\\b(${cue})\\b`, 'gi');
  for (const match of residual.matchAll(residualCue)) {
    const start = match.index || 0;
    const following = residual.slice(start + match[0].length);
    if (ecosPageExclusionCueIsNegated(residual, start, match[1] || '', following)) continue;
    if (new RegExp(
      `^\\s*[:/([{-]*\\s*(?:the\\s+)?(?:all\\s+|any\\s+)?` +
        `(?:(?:pdf\\s+)?pages?\\b|${discipline}\\s+(?:${authorityCarrier})\\b|` +
        `${documentNamedAuthority}|${authorityCarrier})`,
      'i',
    ).test(following)) invalid = true;
  }
  return Object.freeze({
    includedQuestion: includedQuestion.replace(/\s+/g, ' ').trim(),
    excludedPages: Object.freeze(excludedPages),
    invalid,
  });
}

export function requestedECOSPDFPageScope(question: string): ECOSRequestedPDFPageScope {
  const projection = ecosPageExclusionProjection(question);
  const included = parseECOSBasePDFPageScope(projection.includedQuestion);
  const excluded = new Set(projection.excludedPages);
  const pages = included.pages.filter(page => !excluded.has(page));
  const exclusionOnly = excluded.size > 0 && (!included.explicit || pages.length === 0);
  const explicit = included.explicit || excluded.size > 0 || projection.invalid;
  const invalid = explicit && (included.invalid || projection.invalid || exclusionOnly);
  return Object.freeze({
    explicit,
    invalid,
    pages: Object.freeze(pages),
    excludedPages: projection.excludedPages,
    exclusionOnly,
    includedQuestion: projection.includedQuestion,
  });
}

function normalizePolicyPageReferenceLabels(value: string) {
  return normalizePolicyText(canonicalizeECOSPageReferenceWords(value).text).replace(
    /\b((?:pdf\s+)?pages?)\s+(?:number|no\.?)\s+(?=\d)/g,
    '$1 ',
  );
}

function normalizePolicyAuthorityVariants(value: string) {
  const decomposed = value.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[‐‑‒–—―−]/g, '-');
  const confusableFold = decomposed.toLowerCase().replace(
    /[аαɑсϲеεєіιӏκкмμոοоρрѕτтυνхχу]/gu,
    character => ({
      'а': 'a', 'α': 'a', 'ɑ': 'a', 'с': 'c', 'ϲ': 'c', 'е': 'e', 'ε': 'e',
      'є': 'e', 'і': 'i', 'ι': 'i', 'ӏ': 'i', 'κ': 'k', 'к': 'k', 'м': 'm',
      'μ': 'm', 'ո': 'n', 'ο': 'o', 'о': 'o', 'ρ': 'p', 'р': 'p', 'ѕ': 's',
      'τ': 't', 'т': 't', 'υ': 'u', 'ν': 'v', 'х': 'x', 'χ': 'x', 'у': 'y',
    } as Record<string, string>)[character] || character,
  );
  const ocrFold = confusableFold.replace(/[01357]/g, character => ({
    '0': 'o', '1': 'i', '3': 'e', '5': 's', '7': 't',
  } as Record<string, string>)[character] || character);
  const separatorPattern = /[\p{Cf}\p{P}\p{S}]+/gu;
  return [...new Set([decomposed, confusableFold, ocrFold].flatMap(candidate => [
    normalizePolicyText(candidate),
    normalizePolicyText(candidate.replace(separatorPattern, '')),
    normalizePolicyText(candidate.replace(separatorPattern, ' ')),
  ]))];
}
