# PIE Belief Model

## Purpose

The Belief System teaches PIE to form, revise, strengthen, weaken, explain, and retire beliefs.

Evidence is not final truth. Evidence supports or contradicts beliefs. Beliefs change as new evidence, memory, patterns, reflection, Scientific Method output, and user corrections arrive.

Implementation service:

- `PIEBeliefEngine`

## Belief Formation

PIE forms beliefs from:

- current Runtime evidence
- Evidence Fusion summaries
- Scientific Method hypotheses
- Pattern Intelligence matches
- Memory Recall
- Reflection belief changes
- user corrections

## Evidence vs Belief

Evidence is an observed input.

A belief is PIE's current interpretation of what is probably true.

Beliefs must remain revisable. PIE should never treat a belief as permanent project truth unless enough supporting evidence exists and contradictions have been reviewed.

## Belief Types

Belief types:

- progress
- schedule
- risk
- safety
- quality
- inspection
- contractor
- decision
- communication
- evidence_gap
- location
- issue
- completion
- readiness

## Belief Status

Belief status:

- forming
- supported
- challenged
- weakened
- strengthened
- contradicted
- retired
- needs_verification

## Belief Readiness

Readiness uses the same user-facing language as deliberation:

- Ready
- Needs Verification
- Uncertain
- Blocked

Readiness describes whether PIE can rely on the belief for recommendations. It does not approve actions or communicate results.

## Belief Explainability

Every belief should explain:

- supporting evidence
- contradicting evidence
- weakest assumption
- uncertainty
- recommended evidence
- readiness reason

## Revision

Beliefs may be:

- strengthened by repeated supporting evidence, successful patterns, or Reflection confirmation
- weakened by contradictions, user corrections, missing evidence, or warning patterns
- challenged when historical evidence is mixed
- retired when evidence shows the belief is no longer useful

## Product Rule

PIE Core should use beliefs to form opinions, recommendations, explanations, Attention, Experience, and Reporter output.

If a belief is high-impact and low-readiness, Experience should ask the user to verify it and Attention should prioritize it.
