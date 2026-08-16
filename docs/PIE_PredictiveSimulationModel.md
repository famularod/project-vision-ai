# PIE Predictive Simulation Model

Predictive Simulation teaches PIE to simulate what may happen next.

It evaluates likely outcomes, no-action consequences, best case, worst case, cascading effects, schedule impact, risks, dependencies, and recovery actions before PIE recommends what the user should do.

## Purpose

PIE should answer:

- What is likely to happen?
- What happens if we do nothing?
- What is the best case?
- What is the worst case?
- What could slip?
- What dependency is at risk?
- What action could recover the situation?
- What evidence would improve this prediction?

## Scenario Analysis

Supported scenario types:

- schedule_delay
- inspection_delay
- contractor_delay
- missing_evidence
- safety_issue
- quality_issue
- decision_delay
- recovery_plan
- no_action
- best_case
- most_likely
- worst_case

## Dependency Awareness

Predictive Simulation should use existing schedule and graph relationships where available.

Dependencies include:

- schedule predecessor/successor
- inspection dependency
- contractor dependency
- material dependency
- approval dependency
- safety dependency
- evidence dependency

## Inputs

Predictive Simulation consumes:

- Runtime evidence and schedule intelligence.
- Beliefs and belief readiness.
- Recurring patterns and early warnings.
- Scientific Method hypotheses, uncertainties, alternatives, and predictions.
- Deliberation alternatives, tradeoffs, and missing evidence.
- Executive Reasoning when available.

## Outputs

The model exposes:

- PIEPrediction.
- PIEPredictionScenario.
- PIEPredictionInput.
- PIEPredictionOutcome.
- PIEPredictionRisk.
- PIEPredictionImpact.
- PIEPredictionDependency.
- PIEPredictionTimeline.
- PIEPredictionRecoveryAction.
- PIEPredictionConfidence.
- PIEPredictionExplanation.
- PIEPredictionResult.

Core output should expose predictions, mostLikelyOutcome, bestCaseOutcome, worstCaseOutcome, noActionOutcome, cascadingImpacts, recoveryActions, and predictionConfidence.

## No-Action Simulation

PIE should explicitly simulate what happens if the user does nothing.

No-action output should describe likely risk propagation, schedule impact, inspection readiness impact, contractor impact, dependencies at risk, and evidence needed to improve confidence.

## Recovery Planning

Recovery actions should explain:

- action
- what it recovers
- expected recovery
- value
- required evidence
- confidence

Executive Reasoning should account for recovery action value, predicted schedule impact, risk propagation, and no-action consequence when choosing the highest-value action.

## Overstatement Rule

Predictions are not facts.

Reporter should mention predicted impact only when evidence is strong. If prediction confidence is low or the explanation says do not overstate, Reporter should show review warnings instead of embedding predicted impact in the report body.
