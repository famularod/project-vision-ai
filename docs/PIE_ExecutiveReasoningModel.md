# PIE Executive Reasoning Model

Executive Reasoning teaches PIE to think like an executive, not a data summarizer.

Its job is to determine what matters most, what requires attention, what decision is needed, what risk is growing, and what action creates the highest value.

## Inputs

Executive Reasoning consumes:

- Runtime.
- Belief Engine strongest beliefs, challenged beliefs, beliefs needing verification, belief readiness, and contradicting evidence.
- Pattern Intelligence recurring patterns, early warnings, and pattern-based recommendations.
- Memory Recall historical lessons, similar past events, and memory influences.
- Scientific Method hypotheses, uncertainty, uncertainty reduction actions, and decision quality signals.
- Deliberation alternatives, tradeoffs, readiness, assumptions, and missing evidence.

## Executive Questions

Every result should answer:

- What matters most right now?
- What is the biggest risk?
- What is the highest-value action?
- What decision is needed?
- What issue is likely to grow?
- What has stopped moving?
- What should be communicated?
- What should be verified before acting?
- What can wait?
- What should the user ignore for now?

## Output Types

The model exposes:

- PIEExecutiveJudgment.
- PIEExecutiveRisk.
- PIEExecutivePriority.
- PIEExecutiveDecisionNeed.
- PIEExecutiveOpportunity.
- PIEExecutiveConcern.
- PIEExecutiveTradeoff.
- PIEExecutiveAction.
- PIEExecutiveBriefingPoint.
- PIEExecutiveReasoningResult.
- PIEExecutiveDecisionScore.
- PIEExecutiveReadiness.

## Decision Scoring

Every executive action is scored using:

- action
- expected value
- risk reduction
- uncertainty reduction
- schedule impact
- safety impact
- communication impact
- effort level
- readiness
- why recommended

Readiness values are:

- Ready.
- Needs Verification.
- Uncertain.
- Blocked.

## Operating Rule

Executive Reasoning may form strong opinions, but it must explain why.

It should never treat a contradicted belief, low-confidence pattern, or uncertain hypothesis as final truth. If readiness is not Ready, the highest-value action should usually be verification, correction, or review before communication.

## Architecture Role

Executive Reasoning sits after Belief, Pattern, Memory, Scientific Method, and Deliberation.

It feeds:

- PIE Core Intelligence.
- Attention.
- Experience.
- Reporter.

Attention should prioritize the biggest executive risk. Experience should use the highest-value action. Reporter should use Executive Reasoning to improve executive summaries and review warnings without dumping internal reasoning into the report body.
