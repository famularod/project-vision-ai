# ECOS Cognitive Framework

## Purpose

ECOS is the complete intelligence, evidence, reasoning, validation, and learning
system that powers Vitruvius Project Intelligence.

The Cognitive Framework is a reusable reasoning layer inside ECOS Core. It
defines how evidence is observed, interpreted, challenged, scored, explained,
reflected on, and learned from. ECOS Assurance remains independently responsible
for validating the resulting evidence support, confidence, identity, authority,
business rules, approvals, synchronization, and release quality.

Legacy project-specific module names may retain the `PIE` identifier during the
controlled migration. Those identifiers implement ECOS behavior; they are not a
separate current product or intelligence-system brand.

## Architecture

```text
User
  |
  v
Vitruvius / Interface
  |
  v
ECOS Core
  |
  v
Cognitive Framework
  |
  v
Project Domain Adapter
  |
  v
Proposed Recommendations / Decisions / Reports
  |
  v
ECOS Assurance
  |
  v
Required Human Review / Verified Save
```

## Definitions

ECOS = intelligence platform powering Vitruvius

Cognitive Framework = reusable reasoning layer inside ECOS Core

ECOS Core = reasoning component that prepares proposals

ECOS Assurance = independent validation component

ECOS Core owns the general cognitive process and must not approve its own work.

The ECOS Domain Adapter owns translation between domain-specific evidence and ECOS generic cognitive input.

Domain adapters own domain translation and domain-specific outputs.

Vitruvius owns evidence capture, interaction, authorized human approval, and display.

Legacy project adapter modules translate project evidence into generic cognitive
inputs and translate ECOS Core output back into project recommendations, risks,
beliefs, predictions, and report insights.

## Domain-Independent Cognitive Abilities

The Cognitive Framework includes these reusable abilities:

1. Observation
2. Evidence Review
3. Interpretation
4. Memory Recall
5. Pattern Recognition
6. Hypothesis Formation
7. Self-Challenge
8. Belief Formation
9. Deliberation
10. Prediction
11. Decision Scoring
12. Recommendation
13. Explanation
14. Reflection
15. Learning
16. Uncertainty Reduction

These abilities are reusable across project intelligence, manufacturing intelligence, safety intelligence, compliance intelligence, facilities intelligence, maintenance intelligence, operations intelligence, logistics intelligence, and future engines.

## Neutral Vocabulary

The framework uses generic terms:

- subject
- evidence
- context
- goal
- risk
- constraint
- decision
- action
- outcome

The framework must not hardcode construction, schedule, jobsite, project, contractor, inspection, photo, GPS, or report language. Those are domain-engine concerns.

## Cognitive Flow

```text
Observe
  -> Review Evidence
  -> Interpret
  -> Recall Memory
  -> Recognize Patterns
  -> Form Hypotheses
  -> Challenge Hypotheses
  -> Form Beliefs
  -> Deliberate
  -> Predict
  -> Score Decisions
  -> Recommend
  -> Explain
  -> Reflect
  -> Learn
  -> Reduce Uncertainty
```

## ECOS Core / ECOS Assurance Boundary

If a capability interprets evidence or prepares a conclusion, it belongs to
ECOS Core. If it verifies support, confidence, identity, authority, business
rules, approval requirements, persistence, synchronization, tests, or release
quality, it belongs to ECOS Assurance.

Examples:

- ECOS Core forms a proposed belief from evidence.
- A project adapter translates that proposal into project language.
- ECOS Core identifies risk and uncertainty.
- ECOS Assurance verifies the evidence and confidence before the result can be final.
- An authorized person approves material project changes.
- ECOS Assurance verifies the final save and synchronization.

## Output Contract

The framework output should include:

- observations
- evidenceReview
- interpretations
- memoryRecall
- patterns
- hypotheses
- challenges
- beliefs
- deliberation
- predictions
- decisionScores
- recommendations
- explanations
- reflection
- learning
- uncertainty
- readiness
- nextBestActions

Domain engines can consume this output directly or map it into domain-specific language.

## Domain Adapter Layer

Domain adapters keep domain-neutral thinking separate from domain-specific interpretation.

```text
Domain Evidence
  -> Domain Adapter
  -> ECOS Cognitive Framework
  -> Domain Adapter
  -> Domain Intelligence Output
```

PIE is the first domain adapter. `PIEDomainAdapter` maps project evidence, project goals, project constraints, project risks, and project decisions into ECOS generic input. It then maps ECOS output back into project beliefs, project risks, project decisions, project recommendations, project uncertainty, project next best actions, and report insights.

Future domain engines should use the same adapter pattern instead of hardcoding domain details into the Cognitive Framework.
