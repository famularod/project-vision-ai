# PIE Situation Intelligence Model

## Purpose

Situation Intelligence summarizes the current Reality Model into an executive-level current state.

It answers:

- What is happening right now?
- Why is the user likely here?
- What changed recently?
- What is improving?
- What is worsening?
- What is blocked?
- What is ready?
- What needs verification?
- What should the user know now?

Situation Intelligence does not replace Reality Modeling. Reality Model owns project objects and object intelligence. Situation Intelligence reads that model first and produces the current situation that downstream PIE layers can use.

Situation Intelligence should not rebuild raw evidence context when the Reality Model is available.

## Layer Placement

Situation Intelligence is Layer 2 Reality Modeling output.

```text
Evidence
  -> Evidence Quality
  -> Missing Evidence
  -> Evidence Timeline
  -> Evidence Fusion
  -> Reality Model
  -> Object Intelligence
  -> Situation Intelligence
  -> Prediction
  -> Executive Reasoning
  -> Attention
  -> Experience
  -> Reporter
  -> App
```

## Situation States

Situation states:

- stable
- improving
- worsening
- blocked
- uncertain
- ready
- needs_verification
- at_risk

Readiness is always expressed in user language:

- Ready
- Needs Verification
- Uncertain
- Blocked

## Intent Recognition

Intent Recognition is part of Situation Intelligence.

Intent types:

- daily_progress_walk
- inspection_preparation
- executive_update
- customer_update
- contractor_follow_up
- schedule_risk_review
- safety_review
- issue_resolution
- decision_preparation
- document_review
- project_status_review
- unknown

Intent shapes what evidence matters, what unknowns matter, what PIE recommends next, and what the report should say.

## Outputs

Situation Intelligence produces:

- currentSituation
- situationIntent
- situationState
- whatChanged
- situationChanges
- situationRisks
- situationOpportunities
- situationUnknowns
- situationBlockers
- situationPriorities
- situationReadiness
- situationSummary
- explanation

The output must stay executive-level and plain language: current situation, state, intent, what changed, risks, opportunities, unknowns, blockers, priorities, and a concise summary.

## Downstream Use

PIE Core Intelligence exposes Situation Intelligence.

Downstream engines should use it where practical:

- Executive Reasoning uses current situation risks and priorities.
- Predictive Simulation uses current situation risks and unknowns.
- Reporter writes from the current situation instead of raw evidence alone.
- Attention prioritizes current situation risks.
- Experience guides from situation state.

## Operating Rule

Situation Intelligence should never invent facts. If the current situation is unclear, it must mark the situation as uncertain or needs_verification and recommend the smallest evidence request that improves the situation.
