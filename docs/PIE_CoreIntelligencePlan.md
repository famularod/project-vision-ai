# PIE Core Intelligence Plan

## Purpose

ECOS is the Executive Cognitive Operating System.

PIE is a reusable domain intelligence engine inside ECOS, not a single-purpose project app feature.

The ECOS Cognitive Framework should be capable of powering many future intelligence engines by reviewing data, interpreting evidence, analyzing relationships, forming beliefs, forming strong opinions, recommending decisions, explaining reasoning, identifying missing data, learning from corrections, and exposing a clear cognitive output that domain engines can consume.

The current domain engine is PIE for project intelligence. The cognitive pattern should stay domain-adaptable so ECOS can later support maintenance, manufacturing, safety, compliance, operations, facilities, and logistics through other domain engines.

## Core Definition

PIE Core Intelligence is the project-domain brain that sits below application UI and consumes the ECOS Cognitive Framework.

PIE can:

- review data
- interpret evidence
- analyze relationships
- form beliefs
- form strong opinions
- make recommendations
- recommend decisions
- explain reasoning
- identify missing data
- learn from corrections
- support multiple applications

Apps do not own intelligence. Apps collect input and display PIE output. ECOS owns domain-independent cognition. PIE owns project-specific translation, project understanding, project recommendations, project risks, project beliefs, project predictions, and project report insight.

Boundary rule:

- If a capability is domain-independent, it belongs to ECOS Cognitive Framework.
- If it is project-specific, it belongs to PIE.

## Capability Layers

### Layer 1. Evidence Quality

Question: How reliable is this evidence?

Evidence Quality scores freshness, completeness, reliability, relevance, conflicts, and usefulness before PIE forms beliefs or recommendations.

PIE should not treat all evidence equally. Recent GPS-tagged photos, reviewed schedules, user-confirmed updates, and evidence matching prior records should be weighted more strongly than old notes, missing-context evidence, unreviewed OCR, contradicted evidence, or evidence previously corrected by the user.

### Layer 1. Missing Evidence

Question: What does PIE not know yet?

Missing Evidence detects gaps that prevent stronger understanding, better recommendations, or better reports. PIE should identify missing photos, current photos, location, schedule, owner, decision, inspection status, safety confirmation, progress note, document, report review, or user confirmation.

The output should recommend the minimum evidence needed to reduce uncertainty. PIE should ask for one useful piece of evidence before it asks for more.

### Layer 1. Evidence Timeline

Question: What changed over time?

Evidence Timeline orders project evidence chronologically by project, area, work package, issue, schedule item, and decision. It detects stale evidence, timeline gaps, recent changes, and momentum signals such as progress increasing, progress slowing, no recent evidence, repeated same issue, area going stale, or new activity after delay.

Timeline output should feed Pattern Intelligence, Belief Formation, and Core Intelligence so PIE understands not only the latest evidence, but the sequence that produced the current project state.

### Layer 2. Reality Modeling

Question: What is currently true about the project?

Layer 2 is Reality Modeling. PIE maintains a living Reality Model instead of letting each downstream engine reason directly from scattered evidence.

Evidence updates the Reality Model. Judgment, prediction, reporting, attention, and experience read from the Reality Model.

Reality objects include projects, buildings, areas, work packages, schedule activities, milestones, inspections, contractors, issues, risks, decisions, documents, photos, safety observations, reports, and owner actions.

Reality object statuses include unknown, not_started, in_progress, ready, needs_verification, blocked, at_risk, contradicted, complete, and retired.

Object Intelligence extends each Reality Object with goalsSupported, relationships, dependencies, confidence, readiness, riskLevel, momentum, nextBestAction, uncertainty, and ownerNeeded. Core Intelligence should expose realityModelSummary, objectIntelligence, objectsReady, objectsUncertain, objectsWithHighRisk, objectNextActions, objectNextBestActions, and objectRelationshipSummary.

Layer 2 must answer what the current project reality is, what changed recently, which objects matter, what is ready, what is blocked, what is uncertain, what supports the current goal, what is likely to happen next, and what evidence would improve the model.

## Situation Intelligence

PIE Core Intelligence includes Situation Intelligence.

Situation Intelligence turns Reality Model and Object Intelligence into a current executive situation:

- what is happening
- why the user is likely here
- what changed recently
- what is blocked
- what is ready
- what needs verification
- what the user should know now

Core output exposes currentSituation, situationIntent, situationState, situationChanges, situationRisks, situationOpportunities, situationUnknowns, situationBlockers, situationPriorities, and situationSummary.

Intent Recognition is part of Situation Intelligence and supports daily progress walk, inspection preparation, executive update, customer update, contractor follow-up, schedule risk review, safety review, issue resolution, decision preparation, document review, and project status review.

Downstream engines should use Situation Intelligence before falling back to raw evidence. Reporter should write from the current situation. Attention should prioritize current situation risks. Experience should guide from situation state.

## Predictive Reality

PIE Core Intelligence includes Predictive Reality.

Predictive Reality projects future changes in the Reality Model based on object intelligence, situation intelligence, timeline, patterns, beliefs, prediction outputs, dependencies, and missing evidence.

Core output exposes predictiveReality, futureObjectStates, readinessForecasts, cascadingEffects, cascadingRealityEffects, noActionForecast, noActionOutcomes, recoveryForecast, recoveryPaths, and predictiveRealitySummary.

Predictive Reality supports most_likely, best_case, worst_case, no_action, and recovery_action forecasts.

Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when the Reality Model is available.

Downstream engines should use Predictive Reality before treating future impact as reportable. Executive Reasoning should use it for decision scoring. Attention should prioritize high-impact future risks. Experience should request evidence that changes the forecast. Reporter should mention future impact only when confidence is strong enough.

## Layer 3. Executive Judgment

PIE Core Intelligence includes Executive Judgment.

Executive Judgment converts the current Reality Model into the highest-value executive action. It is not just reasoning; it is judgment.

Executive Judgment consumes realityModel, objectIntelligence, situationIntelligence, predictiveReality, evidenceQuality, missingEvidence, beliefs, patterns, evidenceTimeline, risks, opportunities, tradeoffs, goals, and readiness forecasts.

Layer 3.2 extends Executive Judgment with Tradeoff Intelligence, Escalation Intelligence, No-Action Reasoning, Wait-for-Evidence Reasoning, Opportunity Cost, and Decision Timing. Core output must include tradeoffAnalysis, escalationAnalysis, opportunityCost, decisionTiming, noActionReasoning, and waitForEvidenceReasoning.

Tradeoff Intelligence must compare gains, losses, total outcome, uncertainty reduction, project goal protection, and unnecessary noise risk. Escalation Intelligence must require a real trigger and evidence strong enough to justify escalation unless safety risk requires immediate leadership attention. No-Action Reasoning must treat monitoring as a valid executive judgment when evidence is weak, the issue is resolving, escalation would create noise, risk is low, inspection results are pending, one more evidence item is needed, action is not reversible, or likely impact is low.

PIE must evaluate what is gained, what is lost, what happens if the user waits, what happens if the user escalates, what happens if the user does nothing, and which option protects the project goal. Escalation is only valid when a blocked decision, missing owner, safety risk, meaningful schedule impact, repeated unresolved issue, failed lower-level action, or time-sensitive leadership need is present. No_action and wait_for_evidence are valid executive recommendations when evidence is weak, escalation would create noise, risk is low, or one more evidence item should be captured first.

Layer 3.3 completes Executive Judgment. Core output must provide one final plain-language recommendation surface: bestNextStep, whatCanWait, whatNotToDo, decisionNeeded, escalationRecommendation, recommendationWhy, recommendationAlternatives, recommendationSuccessMeasure, and recommendationReadiness. The final action must pass actionSafetyCheck before Reporter, Attention, or Experience treat it as ready.

Action safety verifies evidence support, situation alignment, no Reality Model contradiction, no prediction overstatement, justified escalation, no-action consideration, missing-evidence consideration, and report wording that will not overclaim.

## Layer 4. Adaptive Intelligence

PIE Core Intelligence includes Adaptive Intelligence.

Adaptive Intelligence improves future judgment from outcomes, corrections, approvals, rejected recommendations, edited reports, prediction outcomes, decision outcomes, and reality changes.

Adaptive Intelligence consumes learning signals, reflections, memory recall, user corrections, report approvals and edits, recommendation outcomes, prediction outcomes, decision outcomes, and Executive Judgment outcomes.

Core output must include adaptiveIntelligence, outcomeIntelligence, calibrationIntelligence, strategyAdjustments, communicationAdjustments, trustAssessment, adaptiveLessons, and adaptivePolicyUpdates.

Adaptive Intelligence may change adaptive policies: preferred report style, preferred evidence sequence, escalation threshold, risk threshold, confidence calibration, user communication style, and inspection readiness threshold.

Adaptive Intelligence must not change constitutional principles: seek truth, separate evidence from assumptions, do not fabricate, challenge conclusions, explain reasoning, identify uncertainty, and prefer decision quality over appearance.

## Layer 4. Decision Memory and Executive Wisdom

PIE Core Intelligence includes Decision Memory.

Decision Memory stores and reasons over decision history, recommendation history, outcomes, failures, successes, wisdom lessons, and when-not-to-act reasoning.

Core output must include decisionMemory, decisionHistory, wisdomLessons, whenNotToActReasons, wisdomRecommendations, and trustCalibrationHistory.

Decision Memory feeds Adaptive Intelligence, Learning, Reflection, and Memory Recall with adaptive lessons, future caution, confidence calibration, strategy adjustments, and trust calibration.

Executive Judgment must consult Decision Memory before recommending action. Reporter should avoid overstating recommendations when wisdom says wait. Attention should not push low-value action. Experience should ask for evidence when wisdom recommends verification.

Core output exposes executiveJudgment, executiveJudgmentResult, executiveJudgmentExplanation, executiveJudgmentHighestValueAction, executiveDecisions, executiveJudgmentPriorities, executiveRisks, executiveOpportunities, executiveConstraints, executiveJudgmentReadiness, and executiveJudgmentSummary.

Decision scoring considers value created, risk reduced, uncertainty reduced, schedule impact, safety impact, quality impact, communication impact, effort required, urgency, reversibility, confidence/readiness, and downstream effect.

Decision governance requires recommendation, why, supporting evidence, assumptions, uncertainty, alternatives considered, why alternatives lost, tradeoffs, expected outcome, success measure, and what would change the recommendation.

No action is a valid action type when current evidence does not justify escalation, communication, approval, or recovery action.

### 1. Evidence Review

Question: What data has PIE received?

Evidence Review lists available sources, missing sources, conflicts, freshness, and confidence. It should make clear whether PIE is reasoning from schedule data, photos, GPS, documents, notes, issues, safety observations, reports, or other domain inputs.

### 2. Interpretation

Question: What does the data mean?

Interpretation turns evidence into understandable meaning. PIE should explain what changed, what appears stable, what looks concerning, and what may be incomplete.

### 3. Relationship Analysis

Question: How are the facts connected?

Relationship Analysis connects evidence, entities, people, locations, areas, schedule items, equipment, decisions, issues, risks, documents, and unknowns. PIE should reason from connected facts instead of isolated records.

### 4. Belief Formation

Question: What does PIE believe is true?

Belief Formation creates confidence-scored statements about current reality. Beliefs must include supporting evidence, contradicting evidence, and remaining uncertainty.

### 5. Opinion Formation

Question: What does PIE strongly think should happen?

Opinion Formation turns beliefs, risk, urgency, and evidence strength into practical positions. Opinions should be strong when evidence is strong and cautious when evidence is weak.

### 6. Decision Support

Question: What decision is needed?

Decision Support identifies where a user needs to approve, reject, communicate, inspect, escalate, wait, or collect more evidence.

### 7. Recommendation

Question: What should the user do next?

Recommendations are prioritized next steps with evidence, confidence, impact, and approval boundaries. PIE should make the next best action obvious.

### 8. Explanation

Question: Why does PIE recommend this?

Explanation provides traceable reasoning in plain language. It should connect each recommendation to evidence, relationships, confidence, uncertainty, and user action.

### 9. Reflection

Question: Was PIE right or wrong?

Reflection evaluates whether new evidence strengthened or weakened PIE's understanding. Reflection does not replace project analysis; it evaluates PIE's own understanding and confidence.

### 10. Learning

Question: What should PIE do better next time?

Learning turns user corrections, accepted evidence, rejected reports, location corrections, and daily reflection into better future recommendations.

## Reusable API Goal

`services/ECOSCognitiveFramework.ts` should provide one reusable cognitive process for any domain engine.

`services/ECOSDomainAdapter.ts` should provide the reusable adapter contract for mapping domain evidence into ECOS and mapping ECOS output back to a domain.

`services/PIEDomainAdapter.ts` should be the first domain adapter. It maps project runtime, evidence fusion, goals, risks, constraints, decisions, memory, patterns, outcomes, and feedback into ECOS. It maps ECOS output back into project beliefs, risks, decisions, recommendations, uncertainty, next best actions, and report insights.

`services/PIECoreIntelligence.ts` should consume ECOS output and provide a project intelligence output for Project Vision AI and future project-focused apps.

Core output should include:

- evidenceReview
- interpretations
- relationships
- beliefs
- opinions
- decisionsNeeded
- recommendations
- explanations
- missingData
- confidence
- nextBestActions
- learningSignals

The core service should orchestrate existing PIE engines when available:

- ECOS Cognitive Framework
- ECOS Domain Adapter
- Memory Recall
- Evidence Fusion
- Knowledge Graph
- Reflection
- Mission
- Executive
- Attention
- Experience
- Reporter
- Runtime

The core service should not duplicate deep engine logic. It should normalize existing PIE outputs into a stable intelligence contract.

## Memory Recall

PIE uses past experience to interpret new evidence.

Before forming interpretations, beliefs, opinions, recommendations, or explanations, PIE Core should retrieve relevant memory when available:

- past project events
- past updates
- past photos
- past schedule items
- past recommendations
- past reports
- past user corrections
- past Reflection lessons
- past Core beliefs and opinions

Memory Recall should help PIE detect recurring issues, repeated corrections, unresolved action items, schedule conditions that continue over time, and evidence that contradicts prior understanding.

Core output may expose:

- memoryRecall
- memoryInfluences
- pastLessons
- recurringPatterns
- similarPastEvents

## Deliberation

PIE should not recommend important actions without deliberating.

Deliberation is PIE's internal decision review process. Before final recommendations and strong opinions, PIE Core should evaluate:

- what PIE knows
- assumptions
- supporting evidence
- contradicting evidence
- missing evidence
- alternatives
- trade-offs
- strongest recommendation
- why that recommendation is better than alternatives
- what would change the recommendation

PIE Cognitive Abilities:

- Observation
- Understanding
- Memory
- Reflection
- Causal Reasoning
- Self-Challenge
- Trade-Off Analysis
- Constraint Awareness
- Decision Scoring
- Goal Awareness
- Scenario Simulation
- Strategic Memory
- Meta-Cognition
- Deliberation

Core output may expose:

- deliberation
- assumptions
- alternatives
- tradeoffs
- recommendationReadiness
- whatWouldChangeRecommendation

## Domain Adaptability

Current domain:

- project intelligence

Future possible domains:

- maintenance
- manufacturing
- safety
- compliance
- operations
- facilities
- logistics

Each future domain can provide different source data and application surfaces while using the same PIE Core pattern:

```text
Inputs -> Evidence Review -> Interpretation -> Relationship Analysis -> Beliefs -> Opinions -> Decisions -> Recommendations -> Explanation -> Reflection -> Learning -> App Output
```

## Development Rule

Every future PIE intelligence sprint should strengthen one or more core capability layers.

Application work should not bury intelligence inside screens. UI should remain a capture and display layer over PIE Core output.

## Scientific Method And Cognitive Constitution

PIE Core Intelligence uses the PIE Scientific Method before final opinions and recommendations where practical.

The Scientific Method loop is:

```text
Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn
```

Core output may expose:

- scientificResult
- primaryHypothesis
- challengedAssumptions
- primaryUncertainty
- uncertaintyReductionActions
- decisionQualitySignals

PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.

Scientific Method strengthens these capability layers:

- Interpretation uses evidence separately from assumptions.
- Relationship Analysis identifies supporting and contradicting evidence.
- Belief Formation remains revisable.
- Opinion Formation includes self-challenge.
- Decision Support includes uncertainty reduction.
- Recommendation includes what should be verified first.
- Explanation traces the recommendation back to evidence.
- Reflection and Learning monitor whether the decision worked.

The Cognitive Constitution makes this reusable across domains. Apps do not own these cognitive rules.

## Pattern Intelligence

PIE Core Intelligence uses Pattern Intelligence to compare current evidence against prior evidence, lessons, recommendations, corrections, reports, and outcomes.

Pattern Intelligence adds:

- Recurring Pattern Detection.
- Early Warning Signals.
- Historical Recovery Patterns.
- Similar past situations.
- Successful and failed response history.

Core output may expose:

- patternIntelligence
- patternMatches
- earlyWarnings
- recurringPatterns
- patternBasedRecommendations
- patternConfidence

Core should use pattern context when forming opinions and recommendations. Patterns are not proof by themselves; they should strengthen hypotheses, add self-challenge, and recommend verification when history may be repeating.

## Belief And Confidence System

PIE Core uses the Belief System to transform evidence, memory, patterns, reflection, and Scientific Method output into explainable beliefs.

Core output may expose:

- beliefs
- beliefChanges
- strongestBeliefs
- challengedBeliefs
- beliefsNeedingVerification
- beliefReadiness
- beliefExplanations

Beliefs are not raw evidence. Beliefs are revisable interpretations supported or contradicted by evidence.

PIE Core opinions and recommendations should reference beliefs where practical, especially when a belief is strong enough to support action or weak enough to require verification.

## Executive Reasoning

PIE Core Intelligence includes an Executive Reasoning layer.

Executive Reasoning adds:

- Executive Judgment.
- Biggest executive risk.
- Highest-value action.
- Decision needs.
- Executive priority ranking.
- Executive action scoring.
- Executive readiness.

Core output may expose:

- executiveReasoning
- executivePriorities
- biggestRisk
- highestValueAction
- decisionsNeeded
- executiveBriefingPoints
- executiveReadiness

Executive Reasoning consumes beliefs, patterns, memory, Scientific Method output, and Deliberation output. Core recommendations should align to the highest-value action when Executive Reasoning identifies one.

Apps still do not own intelligence. Apps collect input and display PIE output. PIE owns review, interpretation, analysis, belief, opinion, decision, recommendation, explanation, reflection, learning, and executive judgment.

## Predictive Simulation

PIE Core Intelligence includes a Predictive Simulation layer.

Predictive Simulation adds:

- Scenario Analysis.
- No-Action Simulation.
- Best Case, Most Likely, and Worst Case outcomes.
- Cascading Impact detection.
- Recovery Planning.
- Dependency-aware prediction.

Core output may expose:

- predictions
- mostLikelyOutcome
- bestCaseOutcome
- worstCaseOutcome
- noActionOutcome
- cascadingImpacts
- recoveryActions
- predictionConfidence

Core recommendations should consider predicted outcomes. Executive Reasoning should account for predicted schedule impact, risk propagation, recovery action value, and no-action consequence before selecting the highest-value action.

Predictions are not facts. PIE should explain uncertainty and ask for evidence when prediction confidence is not strong.

## Continuous Learning

PIE Core Intelligence includes a Continuous Learning layer.

Continuous Learning adds:

- Learning Signals.
- Outcome-Based Learning.
- Confidence Calibration.
- Recommendation Improvements.
- Pattern Updates.
- Belief Updates.
- Memory Consolidation.
- Future Adjustments.
- Decision Quality Learning.
- Report Style Learning.

Core output may expose:

- learningResult
- learningSignals
- lessonsLearned
- confidenceCalibration
- futureAdjustments
- memoryConsolidation
- decisionQualityLearning

Continuous Learning consumes user corrections, report approval, report edits, accepted or rejected recommendations, confirmed or failed predictions, Reflection lessons, pattern matches, schedule changes, photo evidence, GPS corrections, and decision outcomes.

Learning should calibrate future behavior. It should tell PIE what to trust more, what to trust less, how to adjust confidence, what to remember, and what to do differently next time.

Apps still do not own intelligence. Apps collect input and display PIE output. PIE owns review, interpretation, analysis, belief, opinion, decision, recommendation, explanation, reflection, learning, confidence calibration, and future adjustment.
