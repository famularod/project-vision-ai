# PIE Decision Memory Model

## Purpose

Decision Memory is part of Layer 4 Adaptive Intelligence.

Decision Memory teaches PIE to remember decisions, recommendations, outcomes, failures, successes, and when not to act.

Persistence is not required in this phase. The current implementation provides in-memory and model-level support so Core, Adaptive Intelligence, Executive Judgment, Attention, Experience, and Reporter can consume decision history.

## What PIE Remembers

PIE Decision Memory records:

- recommendation made
- why it was made
- evidence used
- assumptions
- alternatives considered
- uncertainty
- user action
- actual outcome
- whether recommendation was correct
- impact
- lesson learned
- future adjustment

## Types

Decision Memory includes:

- PIEDecisionMemory
- PIEDecisionRecord
- PIERecommendationRecord
- PIEDecisionOutcomeRecord
- PIEExecutiveWisdomLesson
- PIEWisdomPattern
- PIEWhenNotToActReason
- PIETrustCalibrationRecord
- PIEDecisionMemoryResult
- PIEWisdomRecommendation

## Functions

Decision Memory provides:

- buildPIEDecisionMemory
- recordDecision
- recordRecommendation
- recordDecisionOutcome
- compareDecisionToOutcome
- extractWisdomLessons
- identifyWhenNotToAct
- identifyRepeatedDecisionPatterns
- buildWisdomRecommendation
- calibrateTrustFromDecisionHistory
- summarizeDecisionMemory

## When Not To Act

PIE should identify when action is not recommended.

Reasons:

- evidence too weak
- issue already resolving
- escalation creates unnecessary noise
- waiting reduces risk
- action is irreversible
- decision impact is low
- user correction history suggests caution
- prediction confidence is low
- constitutional principle requires truth over speed

No action, waiting, verification, and monitoring are valid executive wisdom outcomes.

## Adaptive Intelligence Integration

Decision Memory feeds:

- adaptive lessons
- future caution
- confidence calibration
- strategy adjustments
- memory recall
- reflection

Adaptive Intelligence uses Decision Memory to update adaptive policies without violating constitutional principles.

## Executive Judgment Integration

Executive Judgment should consult Decision Memory before recommending action.

Decision Memory can:

- lower confidence when similar recommendations failed
- raise caution when user correction history is relevant
- discourage escalation when previous escalation created noise
- recommend verification when evidence is weak
- favor no_action or wait when wisdom says action is low value

## Core Outputs

PIE Core Intelligence exposes:

- decisionMemory
- decisionHistory
- wisdomLessons
- whenNotToActReasons
- wisdomRecommendations
- trustCalibrationHistory

## Downstream Use

Reporter should avoid overstating recommendations when wisdom says wait.

Attention should not push low-value action.

Experience should ask for evidence when wisdom recommends verification.
