# PIE Cognitive Architecture

## Purpose

ECOS is the reusable cognitive operating system.

PIE is becoming the first domain intelligence engine inside ECOS, not a collection of disconnected project features.

The ECOS Cognitive Framework defines reusable reasoning, self-challenge, option comparison, recommendation, explanation, uncertainty reduction, reflection, and learning. PIE applies those abilities to project intelligence.

Rule:

- If a capability is domain-independent, it belongs to ECOS Cognitive Framework.
- If it is project-specific, it belongs to PIE.

## Cognitive Cycle

PIE's cognitive cycle:

```text
Observe
  -> Understand
  -> Recall
  -> Reason
  -> Form Beliefs
  -> Challenge Itself
  -> Decide
  -> Simulate
  -> Recommend
  -> Explain
  -> Reflect
  -> Learn
```

## Cycle Stages

### Observe

PIE receives raw evidence from photos, GPS, schedules, documents, typed notes, talk-to-text notes, issues, safety observations, reports, sync state, and future app inputs.

Supporting services:

- `PIEEvidenceFusion`
- `PIEScheduleIntelligence`
- `PIEPhotoProgress`
- `ProjectEventService`
- `PIERuntime`

### Understand

PIE normalizes observed data into project meaning: what changed, what is missing, what appears risky, and what can be trusted.

Supporting services:

- `PIEEvidenceFusion`
- `PIERuntime`
- `PIECoreIntelligence`

### Reality Modeling

Layer 2 is Reality Modeling.

PIE maintains a living Reality Model as the single current representation of project reality. Evidence updates the Reality Model. Judgment and Wisdom read from the Reality Model.

Layer 2 must answer what the current project reality is, what changed recently, which objects matter, what is ready, what is blocked, what is uncertain, what supports the current goal, what is likely to happen next, and what evidence would improve the model.

Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when the Reality Model is available.

Supporting services:

- `PIERealityModel`
- `PIESituationIntelligence`
- `PIEPredictiveReality`
- `PIECoreIntelligence`
- `PIEEvidenceQuality`
- `PIEMissingEvidence`
- `PIEEvidenceTimeline`

### Recall

PIE pulls relevant history so new evidence is not treated as isolated.

Supporting services:

- `PIEMemoryEngine`
- `PIEMemoryRecall`
- `PIEKnowledgeGraph`
- `PIEReflectionEngine`

### Reason

PIE connects facts, concerns, questions, evidence, and recommendations.

Supporting services:

- `PIEReasoningEngine`
- `PIEKnowledgeGraph`
- `PIECoreIntelligence`

### Form Beliefs

PIE forms confidence-scored beliefs about what is true, what is uncertain, and what contradicts current understanding.

Supporting services:

- `PIERuntime`
- `PIECoreIntelligence`
- `PIEReflectionEngine`

### Challenge Itself

PIE identifies assumptions, contradictions, missing evidence, uncertainty, and what could be wrong.

Supporting services:

- `PIEDeliberationEngine`
- `PIEReflectionEngine`
- `PIEMemoryRecall`

### Decide

PIE reviews decisions needed, action options, approval boundaries, and readiness.

Supporting services:

- `PIEDecisionEngine`
- `PIEExecutive`
- `PIEExecutiveJudgment`
- `PIEDeliberationEngine`
- `PIERuntime`

### Executive Judgment

Layer 3 is Executive Judgment.

Executive Judgment selects the highest-value executive action from Reality Model, Object Intelligence, Situation Intelligence, Predictive Reality, Evidence Quality, Missing Evidence, Beliefs, Patterns, Evidence Timeline, risks, opportunities, tradeoffs, goals, and readiness forecasts.

Executive Judgment must answer what matters most, what decision is needed, what creates the greatest value, what reduces uncertainty, what reduces risk, what can wait, what should be escalated, what should not be escalated, what to do if evidence is incomplete, and when no action is correct.

Tradeoff Intelligence, Escalation Intelligence, No-Action Reasoning, Wait-for-Evidence Reasoning, Opportunity Cost, and Decision Timing are part of Executive Judgment. PIE compares executive options across speed_vs_quality, cost_vs_schedule, risk_vs_progress, evidence_vs_time, safety_vs_productivity, communication_vs_noise, short_term_vs_long_term, and escalation_vs_local_resolution. PIE must account for unnecessary noise, reversibility, likely impact, evidence strength, and timing before recommending action. PIE may recommend no_action, monitor, or wait_for_evidence when acting now or escalating would create more loss than value.

### Adaptive Intelligence

Layer 4 is Adaptive Intelligence.

Adaptive Intelligence converts outcomes and feedback into improved future judgment. It evaluates whether PIE's recommendations were confirmed or contradicted, whether confidence was too high or too low, whether users accepted/rejected/modified recommendations, whether reports required heavy editing, and what should change next time.

Adaptive Intelligence can update adaptive policies, but it cannot alter constitutional principles. It feeds adaptive policies back into Executive Judgment so future decisions, escalation thresholds, communication style, evidence sequence, and confidence calibration can improve.

### Decision Memory and Executive Wisdom

Decision Memory is part of Layer 4 Adaptive Intelligence.

Decision Memory remembers what PIE recommended, why it recommended it, what evidence and assumptions supported it, what alternatives were considered, what uncertainty remained, what the user did, what actually happened, and what PIE should do differently next time.

Decision Memory produces executive wisdom: lessons, repeated decision patterns, trust calibration, wisdom recommendations, and when-not-to-act reasons. Executive Judgment consults Decision Memory before recommending action.

Supporting services:

- `PIEExecutiveJudgment`
- `PIERealityModel`
- `PIESituationIntelligence`
- `PIEPredictiveReality`
- `PIECoreIntelligence`

### Simulate

PIE compares likely next actions and evaluates trade-offs before recommending one path.

Supporting services:

- `PIEDeliberationEngine`
- `PIEExecutive`
- `PIECoreIntelligence`

### Recommend

PIE recommends the strongest next action that is supported by evidence and user approval boundaries.

Supporting services:

- `PIEDeliberationEngine`
- `PIEAttentionEngine`
- `PIEExperienceEngine`
- `PIERuntime`

### Explain

PIE explains why a recommendation is stronger than alternatives and what would change its recommendation.

Supporting services:

- `PIEDeliberationEngine`
- `PIEConversationEngine`
- `PIEReporter`
- `PIECoreIntelligence`

### Reflect

PIE audits whether its understanding became stronger or weaker after evidence, corrections, and approvals.

Supporting services:

- `PIEReflectionEngine`
- `PIEMemoryRecall`

### Learn

PIE turns lessons, corrections, and outcomes into future caution, confidence adjustments, and better recommendations.

Supporting services:

- `PIEReflectionEngine`
- `PIEMemoryRecall`
- `PIECoreIntelligence`

## Cognitive Abilities

PIE should develop these cognitive abilities:

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

## Operating Rule

PIE should not recommend important actions without deliberating.

For important recommendations, PIE should identify assumptions, contradictions, missing evidence, alternatives, trade-offs, readiness, and what would change the recommendation before presenting the action to the app.

## PIE Scientific Method

The Scientific Method is PIE's governing thinking loop:

```text
Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn
```

The Cognitive Constitution requires PIE to seek truth, separate evidence from assumptions, revise beliefs, challenge conclusions, identify uncertainty, explain important recommendations, learn from outcomes, optimize decision quality, trace recommendations to evidence, and keep cognitive abilities reusable across domains.

PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.

Scientific Method extends the cognitive architecture with:

- Uncertainty Reduction.
- Hypothesis Testing.
- Self-Challenge.
- Decision Quality.
- Outcome Monitoring.
- Learning from decision results.

## Pattern Intelligence

Pattern Intelligence is PIE's ability to recognize recurring situations.

It supports:

- Recurring Pattern Detection.
- Early Warning Signals.
- Historical Recovery Patterns.
- Similarity scoring against prior evidence.
- Successful and failed response learning.

Pattern Intelligence strengthens the Scientific Method by improving recall, generating stronger hypotheses, challenging assumptions with historical failures, predicting likely outcomes, and recommending uncertainty reduction based on what happened before.

## Belief And Confidence System

Belief Formation is PIE's ability to turn evidence into revisable understanding.

The Belief System supports:

- Belief Formation.
- Belief Revision.
- Evidence vs Belief separation.
- Belief Readiness.
- Belief Explainability.

Beliefs should be strengthened by supporting evidence and weakened by contradictions, warning patterns, user corrections, or Reflection lessons.

PIE should explain every important belief with supporting evidence, contradicting evidence, weakest assumption, uncertainty, recommended evidence, and readiness.

## Executive Reasoning

Executive Reasoning is PIE's executive judgment layer.

It answers:

- What matters most right now?
- What is the biggest risk?
- What is the highest-value action?
- What decision is needed?
- What should be verified before acting?

Executive Reasoning uses Belief, Pattern Intelligence, Memory Recall, Scientific Method, and Deliberation. It should produce strong opinions only when it can explain evidence, contradiction, uncertainty, tradeoffs, readiness, and decision quality.

Executive Reasoning feeds Core Intelligence, Attention, Experience, and Reporter. Attention should prioritize biggest executive risk. Experience should guide the user toward the highest-value action. Reporter should improve executive summary quality without exposing raw internal reasoning.

## Predictive Simulation

Predictive Simulation is PIE's ability to simulate likely futures before recommending action.

It supports:

- Scenario Analysis.
- No-Action Simulation.
- Cascading Impact reasoning.
- Schedule, inspection, contractor, safety, quality, decision, and evidence impact prediction.
- Recovery Planning.

Predictive Simulation uses beliefs, patterns, Scientific Method hypotheses and uncertainty, Deliberation alternatives, Executive Reasoning, schedule dependencies, and graph relationships where available.

Predictive Simulation should strengthen Executive Reasoning by showing what is likely to happen, what happens if nothing is done, what can recover the situation, and what evidence would improve the prediction.

## Continuous Learning

Continuous Learning is PIE's ability to improve future behavior from outcomes.

It supports:

- Learning from user corrections.
- Learning from report approval.
- Learning from report edits.
- Learning from accepted or rejected recommendations.
- Learning from confirmed or failed predictions.
- Learning from Reflection lessons.
- Learning from GPS corrections, schedule changes, photo evidence, and decision outcomes.
- Confidence Calibration.
- Memory Consolidation.
- Decision Quality Learning.
- Report Style Learning.

Continuous Learning consumes Reflection, Memory Recall, Pattern Intelligence, Belief, Prediction, Executive Reasoning, Runtime, and Reporter context. It should improve future recommendations and confidence without replacing evidence, Scientific Method, or user approval.

Learning feeds Core Intelligence, Memory Recall, Pattern Intelligence, Belief System, Prediction, and Reporter.
