# PIE Predictive Reality Model

## Purpose

Predictive Reality projects how the Reality Model is likely to evolve.

It answers:

- What is likely to happen next?
- Which object will become blocked?
- Which object will become ready?
- What risk will grow if nothing changes?
- What uncertainty will matter tomorrow?
- What recovery action could change the forecast?
- What should be verified before relying on the forecast?

Predictive Reality does not replace Predictive Simulation. Predictive Simulation forecasts outcomes and impacts. Predictive Reality forecasts future object states, readiness, cascading effects, and likely changes to project reality.

## Layer Placement

Predictive Reality is Layer 2 Reality Modeling output.

```text
Evidence
  -> Evidence Quality
  -> Missing Evidence
  -> Evidence Timeline
  -> Evidence Fusion
  -> Reality Model
  -> Object Intelligence
  -> Situation Intelligence
  -> Predictive Simulation
  -> Predictive Reality
  -> Executive Reasoning
  -> Attention
  -> Experience
  -> Reporter
  -> App
```

## Forecast Types

Predictive Reality supports:

- most_likely
- best_case
- worst_case
- no_action
- recovery_action

## Outputs

Predictive Reality produces:

- predictiveReality
- futureObjectStates
- readinessForecasts
- cascadingEffects
- noActionForecast
- noActionOutcomes
- recoveryForecast
- recoveryPaths
- predictiveRealitySummary
- risks
- opportunities
- explanation

Forecasts must use readiness language:

- Ready
- Needs Verification
- Uncertain
- Blocked

## Inputs

Predictive Reality consumes:

- Reality Model
- Object Intelligence
- Situation Intelligence
- Evidence Timeline
- Beliefs
- Patterns
- Predictive Engine outputs
- Missing Evidence

## Downstream Use

Downstream engines should use Predictive Reality where practical:

- Executive Reasoning uses Predictive Reality for decision scoring and future risk.
- Attention prioritizes high-impact future risks.
- Experience requests evidence that can change the forecast.
- Reporter mentions future impact only when confidence is strong enough.

## Operating Rule

Predictive Reality forecasts are not facts. If confidence is low or verification is required, PIE must ask for evidence before relying on the forecast.

Predictive Reality must not overstate predictions. Reporter, Attention, Experience, Prediction, and Executive Reasoning should use forecasts only when they are strong enough or clearly marked as needing verification.
