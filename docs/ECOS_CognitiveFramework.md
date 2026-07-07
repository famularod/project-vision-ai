# ECOS Cognitive Framework

## Purpose

ECOS means Executive Cognitive Operating System.

The Cognitive Framework is the reusable thinking layer inside ECOS. It defines how an intelligence engine observes evidence, interprets meaning, forms beliefs, challenges itself, scores decisions, explains recommendations, reflects, and learns.

PIE is the first domain intelligence engine using this framework. PIE applies the framework to project intelligence, but the framework itself must remain domain-independent.

Future domain engines may include:

- PIE: Project Intelligence Engine
- MIE: Manufacturing Intelligence Engine
- SIE: Safety Intelligence Engine
- CIE: Compliance Intelligence Engine
- FIE: Facilities Intelligence Engine

## Architecture

```text
User
  |
  v
App / Interface
  |
  v
ECOS
  |
  v
Cognitive Framework
  |
  v
Domain Intelligence Engine
  |
  v
Recommendations / Decisions / Reports
```

## Definitions

ECOS = Executive Cognitive Operating System

Cognitive Framework = reusable thinking layer

PIE = project-specific intelligence engine using the framework

ECOS owns reusable thinking.

The Cognitive Framework owns the general cognitive process.

The ECOS Domain Adapter owns translation between domain-specific evidence and ECOS generic cognitive input.

Domain Intelligence Engines own domain translation and domain-specific outputs.

Apps own evidence capture, interaction, approval, and display.

PIE is a domain engine inside ECOS. PIE translates project evidence into generic cognitive inputs and translates generic cognitive output back into project recommendations, project risks, project beliefs, project predictions, and project report insights.

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

## ECOS / PIE Boundary

If a capability is domain-independent, it belongs to the ECOS Cognitive Framework.

If a capability is project-specific, it belongs to PIE.

Examples:

- ECOS forms a generic belief from evidence.
- PIE turns that belief into a project belief.
- ECOS identifies a risk and uncertainty.
- PIE turns that into project risk language and field recommendations.
- ECOS scores a decision.
- PIE translates the score into project approval, inspection, communication, or evidence-collection actions.

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
