# PIE Executive Judgment Model

## Purpose

Executive Judgment is Layer 3.

It converts the current Reality Model into a user-reviewable executive decision: what matters most, what decision is needed, what creates the greatest value, what reduces risk, what reduces uncertainty, what can wait, what should be escalated, and when no action is correct.

Executive Judgment is not only reasoning. It selects the highest-value executive action and explains why that action beats the alternatives.

## Inputs

Executive Judgment consumes:

- Reality Model
- Object Intelligence
- Situation Intelligence
- Predictive Reality
- Evidence Quality
- Missing Evidence
- Beliefs
- Patterns
- Evidence Timeline
- Risks
- Readiness forecasts

## Action Types

Executive action types:

- verify
- capture_evidence
- escalate
- wait
- communicate
- assign_owner
- approve
- reject
- monitor
- recover_schedule
- resolve_blocker
- inspect
- defer
- no_action

## Readiness

Readiness must always use plain language:

- Ready
- Needs Verification
- Uncertain
- Blocked

Executive Judgment must not rely only on raw scores. Every action score includes readiness and a readiness reason.

## Judgment Questions

Executive Judgment answers:

- What matters most right now?
- What decision is needed?
- What creates the greatest value?
- What reduces the most uncertainty?
- What reduces the most risk?
- What can wait?
- What should be escalated?
- What should not be escalated?
- What is the best action if evidence is incomplete?
- When is no action the correct action?
- What is gained by acting now?
- What is lost by acting now?
- What happens if PIE waits?
- What happens if PIE escalates?
- What happens if PIE does nothing?
- Which option creates the best total outcome?
- Which option reduces uncertainty most efficiently?
- Which option protects the project goal?

## Tradeoff and Escalation Intelligence

Sprint 3.2 adds explicit tradeoff, escalation, opportunity cost, decision timing, no-action, and wait-for-evidence reasoning.

Tradeoff dimensions:

- speed_vs_quality
- cost_vs_schedule
- risk_vs_progress
- evidence_vs_time
- safety_vs_productivity
- communication_vs_noise
- short_term_vs_long_term
- escalation_vs_local_resolution

PIE compares executive options by documenting:

- gains
- losses
- total outcome score
- uncertainty reduction
- project goal protection
- unnecessary noise risk
- preferred option
- why the alternative lost

Escalation is recommended only when a trigger is present:

- decision is blocked
- owner is missing
- safety risk is present
- schedule impact is meaningful
- repeated issue is not resolving
- lower-level action has failed
- timing requires leadership action
- evidence is strong enough to justify escalation

Escalation must explain:

- who should be escalated to if known
- why escalation is justified
- what should be asked
- what evidence supports escalation
- what should happen before escalation if evidence is weak

PIE must avoid unnecessary escalation. If evidence is weak and no safety trigger is present, the correct recommendation is usually wait_for_evidence, verify, capture_evidence, or monitor.

No-action and waiting are valid executive judgments. PIE may recommend no_action or wait when:

- evidence is too weak
- the issue is already resolving
- escalation would create noise
- risk is low and monitoring is enough
- action should wait for an inspection result
- one more piece of evidence is needed first
- action is not reversible
- likely impact is low

## Decision Scoring

Each executive action is scored using:

- value created
- risk reduced
- uncertainty reduced
- schedule impact
- safety impact
- quality impact
- communication impact
- effort required
- urgency
- reversibility
- confidence/readiness
- downstream effect

The score is used to compare options, but the user-facing result is the selected action, readiness, and explanation.

## Decision Governance

Every major recommendation must include:

- recommendation
- why
- supporting evidence
- assumptions
- uncertainty
- alternatives considered
- why alternatives lost
- tradeoffs
- expected outcome
- how success will be measured
- what would change the recommendation

## Executive Judgment Summary

`summarizeExecutiveJudgment(...)` must produce an executive-quality plain-language summary with:

- highest-value action
- decision needed
- top risk
- top opportunity
- best next step
- what can wait
- what should not be done
- escalation recommendation
- readiness
- plain-language why

## Action Safety Check

Every final recommendation must pass a final action safety check before downstream use.

PIE verifies:

- recommendation is evidence-backed
- recommendation aligns with current situation
- recommendation does not contradict Reality Model
- recommendation does not overstate prediction
- escalation is justified
- no-action was considered
- missing evidence was considered
- report wording will not overclaim

## Outputs

PIE Core Intelligence exposes:

- executiveJudgment
- executiveJudgmentResult
- executiveJudgmentExplanation
- executiveJudgmentHighestValueAction
- executiveDecisions
- executiveJudgmentPriorities
- executiveRisks
- executiveOpportunities
- executiveConstraints
- tradeoffAnalysis
- escalationAnalysis
- opportunityCost
- decisionTiming
- noActionReasoning
- waitForEvidenceReasoning
- actionSafetyCheck
- executiveJudgmentReadiness
- executiveJudgmentSummary
- bestNextStep
- whatCanWait
- whatNotToDo
- decisionNeeded
- escalationRecommendation
- recommendationReadiness
- recommendationWhy
- recommendationAlternatives
- recommendationSuccessMeasure

`executiveJudgmentExplanation` is the top-level answer set for the Layer 3 judgment questions: what matters most, what decision is needed, greatest value, uncertainty reduction, risk reduction, what can wait, what should or should not be escalated, the best action when evidence is incomplete, and when no action is correct.

The final Core output is the user-facing recommendation contract. Normal UI and Reporter should use bestNextStep, recommendationWhy, decisionNeeded, recommendationReadiness, and recommendationSuccessMeasure instead of exposing internal scoring data.

## Downstream Use

Attention should prioritize highest-value executive actions.

Attention should use bestNextStep as the plain next step when available.

Attention should not over-prioritize low-value escalation. If Executive Judgment says escalation is not justified, Attention should guide toward verification or monitoring.

Experience should guide the user to the selected executive action.

Experience should guide the user to bestNextStep when available.

Experience should request evidence when wait-for-evidence is the best executive timing decision.

Reporter should use Executive Judgment for summary, risk, decisions, and next steps, but should not communicate uncertain judgment as final status.

Reporter should use recommendationWhy and decisionNeeded in executive summary language. Reporter should not expose internal scoring data.

Reporter should include escalation or action recommendations only when Executive Judgment justifies them. Reporter should not turn weak evidence into an escalation request.

Reporter should not create fake action items when Executive Judgment recommends monitoring or no_action. In that case Reporter may summarize the monitoring decision, decision timing, and least noisy option, but it should not invent an owner action.

## Operating Rule

No action is a valid executive action when current evidence does not support a higher-value intervention and monitoring preserves focus.

If evidence is incomplete, the correct executive action is usually verify or capture_evidence, not escalation or communication.
