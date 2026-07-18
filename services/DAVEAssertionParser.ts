export type DAVEAssertionPolarity = 'affirmed' | 'negated' | 'uncertain';

export type DAVEAssertionTemporality =
  | 'past'
  | 'current'
  | 'future'
  | 'unspecified';

export type DAVEAssertionModality =
  | 'observed'
  | 'reported'
  | 'planned'
  | 'conditional'
  | 'unknown';

export type DAVEAssertionPredicate =
  | 'complete'
  | 'started'
  | 'in_progress'
  | 'implemented'
  | 'approved'
  | 'outcome_succeeded'
  | 'issue_present'
  | 'safety_issue_present'
  | 'blocker_present'
  | 'blocker_resolved';

export type DAVEAssertionStatus =
  | 'complete'
  | 'incomplete'
  | 'not_started'
  | 'in_progress'
  | 'implemented'
  | 'not_implemented'
  | 'approved'
  | 'not_approved'
  | 'outcome_succeeded'
  | 'outcome_failed'
  | 'outcome_partial'
  | 'issue_present'
  | 'issue_clear'
  | 'safety_issue_present'
  | 'safety_clear'
  | 'blocked'
  | 'delayed'
  | 'unblocked'
  | 'blocker_resolved'
  | 'blocker_unresolved';

export type DAVEAssertionSourceSpan = Readonly<{
  /** Inclusive, zero-based offset in the original source text. */
  start: number;
  /** Exclusive, zero-based offset in the original source text. */
  end: number;
  text: string;
}>;

export type DAVENormalizedAssertion = Readonly<{
  /** A conservative, lowercase subject. Null means the text did not name one. */
  subject: string | null;
  predicate: DAVEAssertionPredicate;
  status: DAVEAssertionStatus;
  polarity: DAVEAssertionPolarity;
  temporality: DAVEAssertionTemporality;
  modality: DAVEAssertionModality;
  /** Deterministic lexical confidence from 0 through 1; not a probability. */
  confidence: number;
  /** The full source clause, preserving uncertainty and time context. */
  sourceSpan: DAVEAssertionSourceSpan;
}>;

export type DAVEAssertionConflictDomain =
  | 'completion'
  | 'implementation'
  | 'outcome'
  | 'issue'
  | 'safety'
  | 'blocker';

export type DAVEAssertionConflict = Readonly<{
  domain: DAVEAssertionConflictDomain;
  assertionIndexes: readonly [number, number];
}>;

export type DAVEAssertionParseResult = Readonly<{
  sourceText: string;
  assertions: readonly DAVENormalizedAssertion[];
  conflicts: readonly DAVEAssertionConflict[];
}>;

export type DAVECompletionClassification =
  | 'complete'
  | 'not_complete'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

export type DAVESafetyClassification =
  | 'issue_present'
  | 'no_issue_observed'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

export type DAVEBlockerClassification =
  | 'blocked'
  | 'resolved'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

export type DAVEImplementationClassification =
  | 'implemented'
  | 'in_progress'
  | 'not_implemented'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

export type DAVEOutcomeClassification =
  | 'successful'
  | 'partially_successful'
  | 'unsuccessful'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

export type DAVEIssueClassification =
  | 'issue_present'
  | 'no_issue_observed'
  | 'uncertain'
  | 'conflicting'
  | 'no_assertion';

type AssertionRule = Readonly<{
  pattern: RegExp;
  predicate: DAVEAssertionPredicate;
  status: DAVEAssertionStatus;
  polarity: Exclude<DAVEAssertionPolarity, 'uncertain'>;
  priority: number;
  fixedSubject?: string;
}>;

type TextSegment = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

type AssertionCandidate = Readonly<{
  rule: AssertionRule;
  matchStart: number;
  matchEnd: number;
  segment: TextSegment;
}>;

const ASSERTION_RULES: readonly AssertionRule[] = [
  {
    pattern: /\bnot\s+(?:yet\s+)?started\b/gi,
    predicate: 'started',
    status: 'not_started',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\bincomplete\b/gi,
    predicate: 'complete',
    status: 'incomplete',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\b(?:not|never)\s+(?:yet\s+)?(?:complet(?:e|ed)|finished|done)\b|\b(?:unfinished|pending)\b/gi,
    predicate: 'complete',
    status: 'incomplete',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\b(?:partially|partly)\s+(?:complet(?:e|ed)|finished|done)\b/gi,
    predicate: 'complete',
    status: 'in_progress',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\b(?:still\s+)?in[ -]progress\b/gi,
    predicate: 'in_progress',
    status: 'in_progress',
    polarity: 'affirmed',
    priority: 95,
  },
  {
    pattern: /\b(?:not|never)\s+(?:yet\s+)?(?:implemented|installed)\b/gi,
    predicate: 'implemented',
    status: 'not_implemented',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\b(?:implemented|installed)\b/gi,
    predicate: 'implemented',
    status: 'implemented',
    polarity: 'affirmed',
    priority: 55,
  },
  {
    pattern: /\b(?:started|began|underway|currently\s+working|working\s+on|work\s+ongoing)\b/gi,
    predicate: 'started',
    status: 'in_progress',
    polarity: 'affirmed',
    priority: 55,
  },
  {
    pattern: /\bnot\s+(?:yet\s+)?(?:approved|accepted)\b|\brejected\b/gi,
    predicate: 'approved',
    status: 'not_approved',
    polarity: 'negated',
    priority: 100,
  },
  {
    pattern: /\bno\s+(?:active\s+|current\s+)?(?:safety\s+(?:issues?|concerns?)|hazards?)(?:\s+(?:(?:were|was|are|is)\s+)?(?:observed|found|identified|reported|noted))?\b/gi,
    predicate: 'safety_issue_present',
    status: 'safety_clear',
    polarity: 'negated',
    priority: 120,
    fixedSubject: 'safety issue',
  },
  {
    pattern: /\b(?:safe|not\s+unsafe)\b/gi,
    predicate: 'safety_issue_present',
    status: 'safety_clear',
    polarity: 'negated',
    priority: 110,
    fixedSubject: 'safety issue',
  },
  {
    pattern: /\b(?:safety\s+(?:issues?|concerns?)|hazards?)\b.{0,32}\b(?:resolved|cleared|closed|removed)\b|\b(?:resolved|cleared|closed|removed)\b.{0,32}\b(?:safety\s+(?:issues?|concerns?)|hazards?)\b/gi,
    predicate: 'safety_issue_present',
    status: 'safety_clear',
    polarity: 'negated',
    priority: 115,
    fixedSubject: 'safety issue',
  },
  {
    pattern: /\bno\s+(?:active\s+|current\s+)?blockers?(?:\s+(?:(?:is|are)\s+)?(?:present|active|identified|reported|noted))?\b/gi,
    predicate: 'blocker_present',
    status: 'unblocked',
    polarity: 'negated',
    priority: 125,
    fixedSubject: 'blocker',
  },
  {
    pattern: /\b(?:blocker|blocking\s+issue)\b.{0,24}\bnot\s+(?:yet\s+)?(?:resolved|cleared|closed|removed)\b/gi,
    predicate: 'blocker_resolved',
    status: 'blocker_unresolved',
    polarity: 'negated',
    priority: 120,
    fixedSubject: 'blocker',
  },
  {
    pattern: /\b(?:not|no\s+longer)\s+(?:blocked|delayed|waiting)\b|\bno\s+longer\s+on\s+hold\b|\bcan\s+proceed\b/gi,
    predicate: 'blocker_present',
    status: 'unblocked',
    polarity: 'negated',
    priority: 120,
  },
  {
    pattern: /\b(?:blocker|blocking\s+issue)\b.{0,24}\b(?:resolved|cleared|closed|removed)\b|\b(?:resolved|cleared|closed|removed)\b.{0,24}\b(?:blocker|blocking\s+issue)\b/gi,
    predicate: 'blocker_resolved',
    status: 'blocker_resolved',
    polarity: 'affirmed',
    priority: 115,
    fixedSubject: 'blocker',
  },
  {
    pattern: /\bdelayed\b/gi,
    predicate: 'blocker_present',
    status: 'delayed',
    polarity: 'affirmed',
    priority: 92,
  },
  {
    pattern: /\b(?:blocked|waiting|on\s+hold|cannot\s+proceed)\b/gi,
    predicate: 'blocker_present',
    status: 'blocked',
    polarity: 'affirmed',
    priority: 90,
  },
  {
    pattern: /\b(?:blocking\s+issue|blocker(?:\s+(?:remains?|exists?|present|active))?)\b/gi,
    predicate: 'blocker_present',
    status: 'blocked',
    polarity: 'affirmed',
    priority: 90,
    fixedSubject: 'blocker',
  },
  {
    pattern: /\b(?:safety\s+(?:issue|concern)|hazard)s?\b|\bunsafe\b/gi,
    predicate: 'safety_issue_present',
    status: 'safety_issue_present',
    polarity: 'affirmed',
    priority: 80,
    fixedSubject: 'safety issue',
  },
  {
    pattern: /\bno\s+(?:active\s+|current\s+)?(?:issues?|problems?|defects?|conflicts?|disputes?|deviations?)(?:\s+(?:(?:were|was|are|is)\s+)?(?:observed|found|identified|reported|noted))?\b/gi,
    predicate: 'issue_present',
    status: 'issue_clear',
    polarity: 'negated',
    priority: 110,
    fixedSubject: 'issue',
  },
  {
    pattern: /\b(?:issues?|problems?|defects?|conflicts?|disputes?|deviations?)\b.{0,24}\b(?:resolved|cleared|closed|removed)\b|\b(?:resolved|cleared|closed|removed)\b.{0,24}\b(?:issues?|problems?|defects?|conflicts?|disputes?|deviations?)\b/gi,
    predicate: 'issue_present',
    status: 'issue_clear',
    polarity: 'negated',
    priority: 105,
    fixedSubject: 'issue',
  },
  {
    pattern: /\b(?:issues?|problems?|defects?|conflicts?|disputes?|deviations?|missing)\b/gi,
    predicate: 'issue_present',
    status: 'issue_present',
    polarity: 'affirmed',
    priority: 45,
    fixedSubject: 'issue',
  },
  {
    pattern: /\b(?:failed|not\s+achieved|did\s+not\s+pass|was\s+not\s+successful)\b/gi,
    predicate: 'outcome_succeeded',
    status: 'outcome_failed',
    polarity: 'negated',
    priority: 105,
  },
  {
    pattern: /\b(?:partially|partly)\s+(?:successful|achieved)|\bmixed\s+results?\b/gi,
    predicate: 'outcome_succeeded',
    status: 'outcome_partial',
    polarity: 'affirmed',
    priority: 100,
  },
  {
    pattern: /\b(?:pass(?:ed|es)?|achieved|succeeded|successful)\b/gi,
    predicate: 'outcome_succeeded',
    status: 'outcome_succeeded',
    polarity: 'affirmed',
    priority: 50,
  },
  {
    pattern: /\b(?:approved|accepted)\b/gi,
    predicate: 'approved',
    status: 'approved',
    polarity: 'affirmed',
    priority: 50,
  },
  {
    pattern: /\b(?:complet(?:e|ed)|finished|done)\b/gi,
    predicate: 'complete',
    status: 'complete',
    polarity: 'affirmed',
    priority: 50,
  },
] as const;

const UNCERTAINTY_PATTERN =
  /\b(?:uncertain|unclear|unconfirmed|possibly|perhaps|maybe|may|might|could|should|would|appears?|seems?|apparently|likely|unlikely|cannot\s+(?:confirm|verify|determine)|unable\s+to\s+(?:confirm|verify|determine))\b/i;
const CONDITIONAL_PATTERN =
  /\b(?:if|unless|provided\s+that|assuming|subject\s+to|depending\s+on|conditional(?:ly)?)\b/i;
const OBSERVED_PATTERN =
  /\b(?:observed|inspected|verified|visually\s+confirmed|visible|found|identified)\b/i;
const REPORTED_PATTERN =
  /\b(?:reported|reportedly|according\s+to|said|stated|states|marked|documented|noted)\b/i;
const PLANNED_PATTERN =
  /\b(?:will|shall|should|would|planned|scheduled|expected|intends?|targeted|tomorrow|next\s+(?:day|week|month))\b/i;
const PAST_PATTERN =
  /\b(?:was|were|had\s+been|previously|yesterday|last\s+(?:day|week|month)|earlier|formerly)\b/i;
const CURRENT_PATTERN =
  /\b(?:is|are|currently|now|today|still|remains?|has\s+been|have\s+been)\b/i;
const FUTURE_PATTERN =
  /\b(?:will|shall|should|would|tomorrow|next\s+(?:day|week|month)|scheduled|planned|expected|by\s+\d{1,2}[/-]\d{1,2})\b/i;

/**
 * Parses explicit construction-status assertions without making domain
 * decisions. Consumers should use the conservative classifiers below rather
 * than treating a recognized keyword as present-tense truth.
 */
export function parseDAVEAssertions(sourceText: string): DAVEAssertionParseResult {
  const candidates = segmentText(sourceText).flatMap(segment =>
    assertionCandidates(segment),
  );
  const acceptedCandidates = removeOverlappingCandidates(candidates);
  const assertions = acceptedCandidates
    .sort((left, right) => left.matchStart - right.matchStart)
    .map(candidate => normalizedAssertion(sourceText, candidate));
  const conflicts = findConflicts(assertions);

  return {
    sourceText,
    assertions,
    conflicts,
  };
}

export function classifyDAVECompletion(
  input: string | DAVEAssertionParseResult,
): DAVECompletionClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict => conflict.domain === 'completion')) {
    return 'conflicting';
  }

  const assertions = parsed.assertions.filter(isCompletionAssertion);
  const currentAssertions = assertions.filter(assertion =>
    assertion.temporality === 'current' || assertion.temporality === 'unspecified',
  );
  const certainAssertions = currentAssertions.filter(isCertainAssertion);

  if (certainAssertions.some(isNegativeCompletionAssertion)) return 'not_complete';
  if (certainAssertions.some(isAffirmedCompletionAssertion)) return 'complete';
  if (currentAssertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function classifyDAVESafety(
  input: string | DAVEAssertionParseResult,
): DAVESafetyClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict => conflict.domain === 'safety')) {
    return 'conflicting';
  }

  const allAssertions = parsed.assertions
    .filter(assertion => assertion.predicate === 'safety_issue_present');
  const assertions = allAssertions.filter(isCurrentOrUnspecified);
  const certainAssertions = assertions.filter(isCertainAssertion);

  if (certainAssertions.some(assertion => assertion.status === 'safety_issue_present')) {
    return 'issue_present';
  }
  if (allAssertions.some(assertion =>
    assertion.status === 'safety_clear' &&
    assertion.temporality !== 'future' &&
    isCertainAssertion(assertion),
  )) {
    return 'no_issue_observed';
  }
  if (assertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function classifyDAVEBlocker(
  input: string | DAVEAssertionParseResult,
): DAVEBlockerClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict => conflict.domain === 'blocker')) {
    return 'conflicting';
  }

  const allAssertions = parsed.assertions
    .filter(assertion =>
      assertion.predicate === 'blocker_present' ||
      assertion.predicate === 'blocker_resolved',
    );
  const assertions = allAssertions.filter(isCurrentOrUnspecified);
  const certainAssertions = assertions.filter(isCertainAssertion);

  if (certainAssertions.some(assertion =>
    assertion.status === 'blocked' ||
    assertion.status === 'delayed' ||
    assertion.status === 'blocker_unresolved',
  )) {
    return 'blocked';
  }
  if (allAssertions.some(assertion =>
    (assertion.status === 'blocker_resolved' || assertion.status === 'unblocked') &&
    assertion.temporality !== 'future' &&
    isCertainAssertion(assertion),
  )) {
    return 'resolved';
  }
  if (assertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function classifyDAVEImplementation(
  input: string | DAVEAssertionParseResult,
): DAVEImplementationClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict =>
    conflict.domain === 'implementation' || conflict.domain === 'completion',
  )) {
    return 'conflicting';
  }

  const assertions = parsed.assertions
    .filter(assertion =>
      assertion.predicate === 'implemented' ||
      assertion.predicate === 'started' ||
      assertion.predicate === 'in_progress' ||
      assertion.predicate === 'complete',
    )
    .filter(isCurrentOrUnspecified);
  const certainAssertions = assertions.filter(isCertainAssertion);

  if (certainAssertions.some(assertion =>
    assertion.status === 'not_implemented' || assertion.status === 'not_started',
  )) {
    return 'not_implemented';
  }
  if (certainAssertions.some(assertion =>
    assertion.status === 'implemented' || assertion.status === 'complete',
  )) {
    return 'implemented';
  }
  if (certainAssertions.some(assertion =>
    assertion.status === 'in_progress' || assertion.status === 'incomplete',
  )) {
    return 'in_progress';
  }
  if (assertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function classifyDAVEOutcome(
  input: string | DAVEAssertionParseResult,
): DAVEOutcomeClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict =>
    conflict.domain === 'outcome' ||
    conflict.domain === 'completion' ||
    conflict.domain === 'blocker',
  )) {
    return 'conflicting';
  }

  const currentAssertions = parsed.assertions.filter(isCurrentOrUnspecified);
  const certainAssertions = currentAssertions.filter(isCertainAssertion);
  if (certainAssertions.some(assertion => assertion.status === 'outcome_partial')) {
    return 'partially_successful';
  }
  if (
    certainAssertions.some(assertion => assertion.status === 'outcome_failed') ||
    classifyDAVECompletion(parsed) === 'not_complete' ||
    classifyDAVEBlocker(parsed) === 'blocked'
  ) {
    return 'unsuccessful';
  }
  if (
    certainAssertions.some(assertion => assertion.status === 'outcome_succeeded') ||
    classifyDAVECompletion(parsed) === 'complete' ||
    classifyDAVEBlocker(parsed) === 'resolved'
  ) {
    return 'successful';
  }
  if (currentAssertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function classifyDAVEIssue(
  input: string | DAVEAssertionParseResult,
): DAVEIssueClassification {
  const parsed = parsedInput(input);
  if (parsed.conflicts.some(conflict => conflict.domain === 'issue')) {
    return 'conflicting';
  }

  const allAssertions = parsed.assertions
    .filter(assertion => assertion.predicate === 'issue_present');
  const assertions = allAssertions.filter(isCurrentOrUnspecified);
  const certainAssertions = assertions.filter(isCertainAssertion);
  if (certainAssertions.some(assertion => assertion.status === 'issue_present')) {
    return 'issue_present';
  }
  if (allAssertions.some(assertion =>
    assertion.status === 'issue_clear' &&
    assertion.temporality !== 'future' &&
    isCertainAssertion(assertion),
  )) {
    return 'no_issue_observed';
  }
  if (assertions.some(assertion => assertion.polarity === 'uncertain')) {
    return 'uncertain';
  }

  return 'no_assertion';
}

export function isDAVECurrentCertainAssertion(
  assertion: DAVENormalizedAssertion,
) {
  return isCurrentOrUnspecified(assertion) && isCertainAssertion(assertion);
}

function parsedInput(input: string | DAVEAssertionParseResult) {
  return typeof input === 'string' ? parseDAVEAssertions(input) : input;
}

function segmentText(sourceText: string): TextSegment[] {
  const boundary = /(?:[.;!?\n]+|\bbut\b|\bhowever\b)/gi;
  const segments: TextSegment[] = [];
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(sourceText)) !== null) {
    pushTrimmedSegment(sourceText, segmentStart, match.index, segments);
    segmentStart = match.index + match[0].length;
  }
  pushTrimmedSegment(sourceText, segmentStart, sourceText.length, segments);
  return segments;
}

function pushTrimmedSegment(
  sourceText: string,
  rawStart: number,
  rawEnd: number,
  segments: TextSegment[],
) {
  const raw = sourceText.slice(rawStart, rawEnd);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const start = rawStart + leadingWhitespace;
  const end = rawEnd - trailingWhitespace;
  if (end > start) segments.push({ start, end, text: sourceText.slice(start, end) });
}

function assertionCandidates(segment: TextSegment): AssertionCandidate[] {
  return ASSERTION_RULES.flatMap(rule => {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const matches: AssertionCandidate[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(segment.text)) !== null) {
      matches.push({
        rule,
        matchStart: segment.start + match.index,
        matchEnd: segment.start + match.index + match[0].length,
        segment,
      });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return matches;
  });
}

function removeOverlappingCandidates(
  candidates: readonly AssertionCandidate[],
): AssertionCandidate[] {
  const accepted: AssertionCandidate[] = [];
  const preferred = [...candidates].sort((left, right) =>
    right.rule.priority - left.rule.priority ||
    (right.matchEnd - right.matchStart) - (left.matchEnd - left.matchStart) ||
    left.matchStart - right.matchStart,
  );

  for (const candidate of preferred) {
    const overlaps = accepted.some(existing =>
      candidate.matchStart < existing.matchEnd && candidate.matchEnd > existing.matchStart,
    );
    if (!overlaps) accepted.push(candidate);
  }
  return accepted;
}

function normalizedAssertion(
  sourceText: string,
  candidate: AssertionCandidate,
): DAVENormalizedAssertion {
  const { rule, segment } = candidate;
  const modality = assertionModality(segment.text);
  const temporality = assertionTemporality(segment.text);
  const polarity = assertionPolarity(segment.text, rule.polarity, modality);

  return {
    subject: rule.fixedSubject || assertionSubject(sourceText, candidate),
    predicate: rule.predicate,
    status: rule.status,
    polarity,
    temporality,
    modality,
    confidence: assertionConfidence(polarity, modality),
    sourceSpan: {
      start: segment.start,
      end: segment.end,
      text: sourceText.slice(segment.start, segment.end),
    },
  };
}

function assertionPolarity(
  clause: string,
  rulePolarity: Exclude<DAVEAssertionPolarity, 'uncertain'>,
  modality: DAVEAssertionModality,
): DAVEAssertionPolarity {
  if (
    modality === 'conditional' ||
    UNCERTAINTY_PATTERN.test(clause) ||
    /^\s*(?:is|are|was|were|has|have|could|would|will)\b/i.test(clause) && /\?\s*$/.test(clause)
  ) {
    return 'uncertain';
  }
  return rulePolarity;
}

function assertionModality(clause: string): DAVEAssertionModality {
  if (CONDITIONAL_PATTERN.test(clause)) return 'conditional';
  if (OBSERVED_PATTERN.test(clause)) return 'observed';
  if (REPORTED_PATTERN.test(clause)) return 'reported';
  if (PLANNED_PATTERN.test(clause)) return 'planned';
  return 'unknown';
}

function assertionTemporality(clause: string): DAVEAssertionTemporality {
  if (FUTURE_PATTERN.test(clause)) return 'future';
  if (PAST_PATTERN.test(clause)) return 'past';
  if (CURRENT_PATTERN.test(clause)) return 'current';
  return 'unspecified';
}

function assertionConfidence(
  polarity: DAVEAssertionPolarity,
  modality: DAVEAssertionModality,
) {
  if (polarity === 'uncertain' || modality === 'conditional') return 0.35;
  if (modality === 'observed') return 0.95;
  if (modality === 'reported') return 0.78;
  if (modality === 'planned') return 0.65;
  return 0.85;
}

function assertionSubject(
  sourceText: string,
  candidate: AssertionCandidate,
): string | null {
  const beforeMatch = sourceText
    .slice(candidate.segment.start, candidate.matchStart)
    .replace(/^\s*(?:according\s+to\b[^,]*,|reportedly|apparently)\s*/i, '')
    .replace(/\b(?:is|are|was|were|has|have|had|has\s+been|have\s+been|had\s+been|will\s+be|shall\s+be|may\s+be|might\s+be|could\s+be|should\s+be|appears?\s+to\s+be|seems?\s+to\s+be)\s*$/i, '')
    .replace(/^\s*(?:the|a|an)\s+/i, '')
    .replace(/[^\p{L}\p{N}_&/()' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return beforeMatch || null;
}

function findConflicts(
  assertions: readonly DAVENormalizedAssertion[],
): DAVEAssertionConflict[] {
  const conflicts: DAVEAssertionConflict[] = [];

  for (let leftIndex = 0; leftIndex < assertions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assertions.length; rightIndex += 1) {
      const left = assertions[leftIndex];
      const right = assertions[rightIndex];
      const domain = conflictingDomain(left, right);
      if (
        domain &&
        compatibleSubjects(left.subject, right.subject) &&
        compatibleTemporality(left.temporality, right.temporality)
      ) {
        conflicts.push({ domain, assertionIndexes: [leftIndex, rightIndex] });
      }
    }
  }
  return conflicts;
}

function conflictingDomain(
  left: DAVENormalizedAssertion,
  right: DAVENormalizedAssertion,
): DAVEAssertionConflictDomain | null {
  if (!isCertainAssertion(left) || !isCertainAssertion(right)) return null;

  if (isCompletionAssertion(left) && isCompletionAssertion(right)) {
    if (
      isAffirmedCompletionAssertion(left) !== isAffirmedCompletionAssertion(right) &&
      (isAffirmedCompletionAssertion(left) || isAffirmedCompletionAssertion(right))
    ) {
      return 'completion';
    }
  }

  if (
    left.predicate === 'implemented' &&
    right.predicate === 'implemented' &&
    left.status !== right.status
  ) {
    return 'implementation';
  }

  if (
    left.predicate === 'outcome_succeeded' &&
    right.predicate === 'outcome_succeeded' &&
    left.status !== right.status
  ) {
    return 'outcome';
  }

  if (
    left.predicate === 'issue_present' &&
    right.predicate === 'issue_present' &&
    left.status !== right.status
  ) {
    return 'issue';
  }

  if (
    left.predicate === 'safety_issue_present' &&
    right.predicate === 'safety_issue_present' &&
    left.status !== right.status
  ) {
    return 'safety';
  }

  if (isBlockerAssertion(left) && isBlockerAssertion(right)) {
    const leftResolved = left.status === 'blocker_resolved' || left.status === 'unblocked';
    const rightResolved = right.status === 'blocker_resolved' || right.status === 'unblocked';
    if (leftResolved !== rightResolved) return 'blocker';
  }

  return null;
}

function compatibleTemporality(
  left: DAVEAssertionTemporality,
  right: DAVEAssertionTemporality,
) {
  return left === 'unspecified' || right === 'unspecified' || left === right;
}

function compatibleSubjects(left: string | null, right: string | null) {
  return left === right;
}

function isCertainAssertion(assertion: DAVENormalizedAssertion) {
  return assertion.polarity !== 'uncertain' && assertion.modality !== 'conditional';
}

function isCurrentOrUnspecified(assertion: DAVENormalizedAssertion) {
  return assertion.temporality === 'current' || assertion.temporality === 'unspecified';
}

function isCompletionAssertion(assertion: DAVENormalizedAssertion) {
  return assertion.predicate === 'complete' ||
    assertion.predicate === 'started' ||
    assertion.predicate === 'in_progress';
}

function isAffirmedCompletionAssertion(assertion: DAVENormalizedAssertion) {
  return assertion.status === 'complete' && assertion.polarity === 'affirmed';
}

function isNegativeCompletionAssertion(assertion: DAVENormalizedAssertion) {
  return assertion.status === 'incomplete' ||
    assertion.status === 'not_started' ||
    assertion.status === 'in_progress' ||
    assertion.predicate === 'complete' && assertion.polarity === 'negated';
}

function isBlockerAssertion(assertion: DAVENormalizedAssertion) {
  return assertion.predicate === 'blocker_present' ||
    assertion.predicate === 'blocker_resolved';
}
