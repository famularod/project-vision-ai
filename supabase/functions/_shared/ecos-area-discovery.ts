import { analyzeECOSProjectQuestion, ecosQuestionRequestsInstalledCondition } from './ecos-project-answer-policy.ts';
import { canonicalizeECOSQuestionLanguage } from './ecos-question-language.ts';

/**
 * Discovery only: everyday area questions must reach dimension-bearing plan
 * rows even when those rows never say "square feet". No project/page/value is
 * supplied here. The existing exact-page and calculation verifier still owns
 * every factual claim. Roof surface and installed condition remain distinct.
 */
export function areaPlanDiscoveryQueries(question: string): readonly string[] {
  const canonical = canonicalizeECOSQuestionLanguage(question);
  const requirement = analyzeECOSProjectQuestion(canonical);
  if (requirement.kind !== 'measurement' || requirement.attribute !== 'area' ||
      ecosQuestionRequestsInstalledCondition(canonical)) return [];
  const identifiers = [...canonical.matchAll(/\bcanopy\s+['"‘’“”]?([a-z]|\d{1,3})['"‘’“”]?(?![a-z0-9])/gi)]
    .map(match => match[1].toUpperCase());
  // Compound/ambiguous subjects retain general discovery; never pick one.
  if (new Set(identifiers).size !== 1 || /\bcanop(?:ies|y)\s+(?:[a-z0-9]+\s+)?(?:and|or|&)\b/i.test(canonical)) return [];
  const subject = `canopy ${identifiers[0]}`;
  if (/\b(?:roof|roofing|slop(?:e|ed|ing)|surface)\b/i.test(canonical)) {
    return Object.freeze([`${subject} roof area`, 'roof plan']);
  }
  return Object.freeze([subject, 'anchor rod plan', 'overall dimensions']);
}
