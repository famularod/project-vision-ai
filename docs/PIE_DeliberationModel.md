# PIE Deliberation Model

## Purpose

Deliberation is PIE's internal decision review process.

Before PIE recommends important action, it should evaluate evidence, assumptions, alternatives, risks, trade-offs, uncertainty, and readiness. Deliberation helps PIE challenge itself instead of presenting the first plausible recommendation.

## Required Questions

Every major recommendation should answer:

1. What does PIE know?
2. What is PIE assuming?
3. What evidence supports this?
4. What evidence contradicts this?
5. What is missing?
6. What alternatives exist?
7. What are the trade-offs?
8. What is the strongest recommendation?
9. Why is this better than the alternatives?
10. What would change PIE's recommendation?

## Output

Deliberation output should include:

- recommended action
- decision score
- why this action is recommended
- alternatives considered
- trade-offs
- assumptions
- missing evidence
- contradictions
- uncertainty
- what would change the recommendation
- confidence/readiness level

## Readiness Language

PIE should use readiness language instead of raw percent-only confidence:

- Ready
- Needs Verification
- Uncertain
- Blocked

Readiness describes whether the recommendation is supported enough for the user to consider it. It does not approve, send, close, or change project status.

## Alternatives And Trade-Offs

PIE should compare realistic alternatives:

- act now
- verify first
- collect more evidence
- defer or monitor
- escalate
- communicate after review

The selected recommendation should explain why it is better than the alternatives.

## Self-Challenge

Deliberation should identify what could be wrong:

- weak evidence
- stale information
- conflicting evidence
- missing photos or schedule support
- prior user correction
- low confidence
- unclear owner
- unresolved action item
- safety or schedule risk

## App Boundary

Deliberation is internal PIE thinking. Apps should display concise recommendation, reason, readiness, and review warnings where useful. Apps should not dump raw deliberation details into normal UI or reports.

## Reporter Boundary

Reporter may use deliberation to improve recommendation wording, decisions needed, risk wording, and review flags. It should not paste the full deliberation transcript into a report.

## Scientific Method Relationship

Deliberation supports the PIE Scientific Method.

Scientific Method wraps deliberation in the full cognitive loop:

```text
Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn
```

Deliberation contributes hypothesis evaluation, alternatives, trade-offs, missing evidence, contradictions, readiness, and what would change the recommendation.

PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.

For every major recommendation, Scientific Method should identify:

- What could make PIE wrong.
- Contradicting evidence.
- The weakest assumption.
- What should be verified first.
- The uncertainty reduction action.
- The decision quality signals.
