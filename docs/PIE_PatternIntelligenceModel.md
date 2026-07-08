# PIE Pattern Intelligence Model

## Purpose

Pattern Intelligence teaches PIE to recognize situations it has seen before.

PIE should not treat every new project condition as isolated. It should compare current evidence against prior evidence, lessons, recommendations, corrections, report notes, and outcomes to identify recurring patterns, early warning signals, successful recovery sequences, and failed responses.

## Pattern Questions

Pattern Intelligence should answer:

- Have I seen this before?
- Is this recurring?
- Is this getting better or worse?
- What happened last time?
- What worked last time?
- What failed last time?
- What warning signs are appearing?
- What should PIE recommend based on history?

## Pattern Types

Supported pattern types:

- schedule_slippage
- contractor_slowdown
- inspection_risk
- recurring_safety_issue
- missing_evidence
- repeated_user_correction
- recurring_blocker
- recovery_sequence
- successful_resolution
- failed_recommendation
- communication_gap
- resource_constraint
- quality_concern

## Inputs

Pattern Intelligence consumes:

- Memory Recall
- past reflections
- lessons learned
- prior corrections
- past recommendations
- prior report notes
- recurring issues
- historical project events
- belief changes
- recommendation improvements

## Output

Pattern output includes:

- patterns
- patternMatches
- earlyWarnings
- signals
- recurringIssues
- successfulRecoveryPatterns
- failedPatterns
- patternBasedRecommendations
- patternConfidence

## Behavior

Pattern Intelligence compares current evidence against historical evidence and scores similarity based on:

- shared terms
- recurring source types
- occurrence count
- confidence of prior evidence
- trend direction

PIE should use patterns as context, not as proof. Pattern matches should influence hypotheses, challenges, predictions, recommendations, and report warnings only when they improve decision quality.

## Example

Current evidence:

Electrical incomplete again.

Pattern:

Electrical has been incomplete in this area for three updates.

Recommendation:

Verify manpower and material availability before assuming schedule recovery.

## Boundaries

Pattern Intelligence must not invent facts. If the historical outcome is unclear, PIE should say the outcome is unknown and recommend verification.

Reporter may use pattern context when it improves clarity:

- "This remains open from the previous update."
- "This issue has appeared in multiple walks."
- "Progress appears to have resumed after the prior delay."

Reporter should not overuse pattern language or paste raw pattern analysis into stakeholder reports.
