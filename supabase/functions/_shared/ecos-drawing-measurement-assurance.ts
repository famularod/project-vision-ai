export type ECOSConstructionMeasurementFact = Readonly<{
  subject: string;
  statement: string;
  evidenceText: string;
}>;

type ConstructionMeasurementSubject =
  | 'pcc_walkway'
  | 'sewer_lateral'
  | 'pcc_paving'
  | 'area_drain'
  | 'ac_paving';

const MEASUREMENT_PATTERN = String.raw`\d+(?:\.\d+)?\s*(?:["”]|inches?|inch|in\.?\b)`;

export function constructionMeasurementConflictsWithExtractedText(
  fact: ECOSConstructionMeasurementFact,
  existingText: string,
) {
  const factText = normalizeComparisonText(`${fact.subject} ${fact.statement} ${fact.evidenceText}`);
  const subject = constructionMeasurementSubject(factText);
  const proposedMeasurements = [...new Set(measurementTokens(factText))];
  if (!subject || proposedMeasurements.length === 0 || !existingText.trim()) return false;

  const extractedMeasurements = subjectMeasurementTokens(subject, existingText);
  return extractedMeasurements.length > 0 &&
    !proposedMeasurements.every(measurement => extractedMeasurements.includes(measurement));
}

export function subjectMeasurementTokens(
  subject: ConstructionMeasurementSubject,
  existingText: string,
) {
  const normalizedText = normalizeComparisonText(existingText);
  const spans = subjectMeasurementPatterns(subject)
    .flatMap(pattern => [...normalizedText.matchAll(pattern)].map(match => match[0]));
  return [...new Set(spans.flatMap(measurementTokens))];
}

function subjectMeasurementPatterns(subject: ConstructionMeasurementSubject) {
  const measure = MEASUREMENT_PATTERN;
  const patterns: Record<ConstructionMeasurementSubject, string[]> = {
    pcc_walkway: [
      String.raw`${measure}.{0,24}\b(?:pcc\s+walk|walkway|side\s*walk|sidewalk)\b`,
    ],
    sewer_lateral: [
      String.raw`${measure}.{0,20}\bsewer\b.{0,24}\blateral\b`,
      String.raw`${measure}.{0,20}\blateral\b.{0,24}\bsewer\b`,
    ],
    pcc_paving: [
      String.raw`${measure}.{0,24}\b(?:pcc|concrete)\b.{0,20}\bpav(?:ing|ement)\b`,
    ],
    area_drain: [
      String.raw`${measure}.{0,48}\barea\s+drain\b`,
    ],
    ac_paving: [
      String.raw`${measure}.{0,24}\bac\b.{0,32}\b(?:base|pav(?:ing|ement))\b`,
    ],
  };
  return patterns[subject].map(pattern => new RegExp(pattern, 'gi'));
}

function constructionMeasurementSubject(value: string): ConstructionMeasurementSubject | null {
  if (/\b(?:pcc\s+walk|walkway|side\s*walk|sidewalk)\b/.test(value)) return 'pcc_walkway';
  if (/\bsewer\b[\s\S]{0,40}\blateral\b|\blateral\b[\s\S]{0,40}\bsewer\b/.test(value)) return 'sewer_lateral';
  if (/\b(?:pcc|concrete)\b[\s\S]{0,40}\bpav(?:ing|ement)\b|\bpav(?:ing|ement)\b[\s\S]{0,40}\b(?:pcc|concrete)\b/.test(value)) return 'pcc_paving';
  if (/\barea\s+drain\b/.test(value)) return 'area_drain';
  if (/\bac\b[\s\S]{0,40}\b(?:base|pav(?:ing|ement))\b/.test(value)) return 'ac_paving';
  return null;
}

function measurementTokens(value: string) {
  return [...value.matchAll(new RegExp(`\\b(${MEASUREMENT_PATTERN})`, 'gi'))]
    .map(match => {
      const numericValue = match[1]?.match(/\d+(?:\.\d+)?/)?.[0];
      return numericValue == null ? null : `${Number(numericValue)}:inches`;
    })
    .filter((value): value is string => value != null);
}

function normalizeComparisonText(value: string) {
  return value.toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9.\"'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
