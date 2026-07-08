# PIE Master Architecture

## 1. Vision

ECOS stands for Executive Cognitive Operating System.

PIE stands for Project Intelligence Engine.

PIE is the intelligence layer that understands projects, reasons about them, remembers them, and helps project managers make better decisions.

PIE is the first domain intelligence engine inside ECOS. ECOS owns the domain-independent Cognitive Framework; PIE applies that framework to project evidence, project decisions, project recommendations, and project reports.

The mobile app exists primarily to collect information for PIE and present PIE's intelligence back to the user.

Project Vision AI is not only a project update app, a photo log, a reporting tool, or a chatbot. It is an AI-powered Project Operating System whose central product asset is PIE.

PIE should become the place where project reality is captured, normalized, remembered, explained, and turned into practical next actions.

## Product Operating Plan Alignment

The controlling product operating plan is `docs/PIE_ProductOperatingPlan.md`.

Project Vision AI must align PIE, the App, and the User into one simple ecosystem:

```text
User -> App Evidence Capture -> PIE Processing -> App Output -> User Approval
```

PIE owns project understanding: it greets the user, knows where the user most likely is, processes photos, GPS, documents, schedules, typed notes, and talk-to-text notes, connects evidence, identifies critical items, and prepares David-style reports with supporting photos.

Experience Engine owns attention and user flow: it turns PIE Runtime, Mission, Executive, Schedule Intelligence, Evidence Fusion, Photo Progress, GPS Walk recommendation, Reporter readiness, and Attention output into one user-facing experience state with a clear message, reason, action, transition, and confidence.

The App owns fast capture and clear presentation: photo capture, GPS capture, document upload, typed/talk-to-text input, clean Apple-like UI, minimal choices, clear PIE output, and hidden technical/admin complexity.

The User owns verification and communication: provide evidence quickly, confirm or correct PIE, approve reports, and communicate final outputs.

Every sprint must improve PIE, evidence capture, or output clarity. Every feature must reduce user effort or improve project understanding. Normal workflows should expose one primary action, no raw diagnostics, no unnecessary options, and clear reviewable outputs. Future UI should render experience state, not raw engine outputs.

## 2. Product Mission

Project Vision AI exists to build the world's best Project Intelligence Engine.

Mission:

- Reduce uncertainty.
- Increase confidence.
- Improve project decisions.

The product should reduce the time it takes a project manager to understand project status, communicate clearly, and decide what should happen next.

The mission is not to digitize every possible project-management task. The mission is to turn project information into understanding faster than a project manager could assemble that understanding manually.

## 3. Core Philosophy

PIE does not replace the project manager.

PIE:

- Observes.
- Understands.
- Reasons.
- Advises.
- Learns.

The user:

- Verifies.
- Corrects.
- Approves.

AI recommends; people decide. PIE may prepare project intelligence, draft updates, surface risks, identify missing information, and recommend next actions, but the user remains accountable for project decisions, stakeholder communication, safety status, schedule commitments, and saved project history.

PIE should make the app feel prepared. It should reduce repeated user choices by remembering context, inferring likely project and area, and recommending the next useful action when confidence is high enough.

When confidence is low, PIE should ask a clear question instead of pretending to know.

## Project Vision AI Three-System Architecture

Project Vision AI is composed of three systems that must stay distinct even as they work together.

## ECOS Cognitive Framework

The domain-independent architecture is:

```text
User
  -> App / Interface
  -> ECOS
  -> Cognitive Framework
  -> Domain Intelligence Engine
  -> Recommendations / Decisions / Reports
```

ECOS is the reusable thinking platform. The Cognitive Framework provides Observation, Evidence Review, Interpretation, Memory Recall, Pattern Recognition, Hypothesis Formation, Self-Challenge, Belief Formation, Deliberation, Prediction, Decision Scoring, Recommendation, Explanation, Reflection, Learning, and Uncertainty Reduction.

The ECOS Domain Adapter sits between the Cognitive Framework and each Domain Intelligence Engine:

```text
Domain Evidence -> Domain Adapter -> ECOS Cognitive Framework -> Domain Adapter -> Domain Intelligence Output
```

PIE uses `PIEDomainAdapter` as the first adapter implementation. PIE data flows through the adapter before entering ECOS, and ECOS output flows through the adapter before becoming project beliefs, project risks, project decisions, project recommendations, project uncertainty, project next best actions, or report insights.

Rule:

- If a capability is domain-independent, it belongs to ECOS Cognitive Framework.
- If a capability translates between domain evidence and ECOS cognition, it belongs to an ECOS Domain Adapter.
- If it is project-specific, it belongs to PIE.

PIE as first domain engine means PIE remains the first domain intelligence engine. Future engines may include MIE for manufacturing, SIE for safety, CIE for compliance, and FIE for facilities.

### PIE

PIE is the intelligence system.

PIE acts as the project manager, reasoning layer, and project understanding engine inside the product. It observes project evidence, converts that evidence into structured understanding, reasons about concerns and decisions, remembers project history, builds the Project Story, recommends next actions, and prepares communication.

PIE owns project intelligence. It should answer what is known, what changed, what is concerning, what is recommended, what evidence supports that recommendation, what is unknown, and what needs user approval.

### PIE Core Intelligence Layer

PIE Core Intelligence is the reusable intelligence brain that can power this project app and future applications.

Apps do not own intelligence. Apps collect input and display PIE output. PIE owns review, interpretation, analysis, belief, opinion, decision, recommendation, explanation, reflection, and learning.

PIE uses past experience to interpret new evidence. Memory Recall retrieves relevant past project events, updates, photos, schedule items, recommendations, report history, user corrections, Reflection lessons, and prior Core beliefs or opinions before PIE forms new interpretations, beliefs, opinions, recommendations, explanations, attention items, or experience states.

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

PIE should not recommend important actions without deliberating. Deliberation should identify assumptions, contradictions, missing evidence, alternatives, trade-offs, readiness, and what would change the recommendation.

The Core Intelligence Layer exposes a stable output contract for:

- Evidence Review: what data PIE received.
- Interpretation: what the data means.
- Relationship Analysis: how facts are connected.
- Belief Formation: what PIE believes is true.
- Opinion Formation: what PIE strongly thinks should happen.
- Decision Support: what decision is needed.
- Recommendation: what the user should do next.
- Explanation: why PIE recommends it.
- Reflection: whether PIE was right or wrong.
- Learning: what PIE should do better next time.
- Memory Recall: what PIE remembers from similar past evidence and how that should influence interpretation.

The current domain is project intelligence, but PIE Core should remain domain-adaptable for maintenance, manufacturing, safety, compliance, operations, facilities, and logistics.

### JARVIS

JARVIS is the internal QA and testing system.

JARVIS tests layout, workflows, navigation, PIE logic, release readiness, regression risk, and whether the app still feels fast, clear, and useful to a project manager. JARVIS does not create project intelligence for the user. It verifies that PIE and the App are behaving correctly.

JARVIS should evaluate PIE logic and App usability separately: PIE can be logically correct but poorly exposed, and the App can be visually polished while failing to show useful intelligence.

### App

The App is the pathway between the user and PIE.

The App captures field evidence, project updates, photos, schedule context, documents, recipients, location context, and user corrections. It presents PIE intelligence back to the user in clear project-manager language. It lets the user verify, correct, approve, save, and communicate what PIE prepares.

The App is not the intelligence source. Pages should not independently decide project health, risk, priority, confidence, or recommendations when Runtime output can answer those questions. The App should collect information for PIE and render PIE's current understanding.

Design rule:

Every future feature must improve at least one of:

- PIE intelligence.
- JARVIS quality and testing.
- The App's ability to collect information for PIE or present PIE intelligence to the user.

## 4. Cognitive Architecture

### Layer 1: Perception And Evidence Quality

Layer 1 Perception starts by judging evidence quality before higher reasoning treats evidence as support.

`PIEEvidenceQuality` scores evidence freshness, reliability, completeness, relevance, conflicts, and usefulness. PIE should prefer recent, project-tied, area-tied, GPS-confirmed, photo-supported, schedule-supported, user-confirmed evidence that matches prior evidence.

Weak evidence includes old evidence, missing project or area context, missing timestamps, missing supporting photos, contradictions with newer evidence, unreviewed OCR, and evidence corrected by the user previously.

Evidence Quality feeds Belief Formation, Scientific Method, Deliberation, and PIE Core Intelligence. PIE Core exposes evidenceQuality, strongEvidence, weakEvidence, conflictingEvidence, staleEvidence, and evidenceReadiness.

`PIEMissingEvidence` identifies what PIE does not know. It detects missing photos, current photos, locations, schedules, owners, decisions, inspection status, safety confirmation, progress notes, documents, report review, and user confirmation. Missing Evidence turns uncertainty into the minimum evidence request that would improve understanding.

Missing Evidence feeds Attention, Experience, and PIE Core Intelligence. PIE Core exposes missingEvidence, highestImpactEvidenceGap, recommendedEvidenceRequests, and uncertaintyReductionActions so higher layers can ask for the smallest useful evidence item instead of presenting weak recommendations as certain.

`PIEEvidenceTimeline` teaches PIE to understand evidence over time. It builds chronological events for photos, notes, schedule imports, schedule changes, GPS confirmation, user corrections, issues, decisions, reports, and inspection updates. It groups events by project, area, work package, issue, schedule item, and decision.

Evidence Timeline feeds Pattern Intelligence, Belief Formation, and PIE Core Intelligence. PIE Core exposes evidenceTimeline, timelineGaps, staleAreas, momentumSignals, and recentChanges so higher layers can reason about what changed, when it changed, whether progress is increasing or slowing, whether the same issue is repeating, and whether an area is going stale.

### Layer 2: Reality Modeling

Layer 2 is Reality Modeling.

`PIERealityModel` is PIE's single current representation of project reality. Evidence updates the Reality Model. Judgment, prediction, reporting, attention, and experience read from the Reality Model.

Durable Reality Modeling extends this into an organization-scoped and project-scoped authoritative model. The persisted model records model version, model status, creation time, synchronization time, source evidence cutoff, Reality Objects, relationships, dependencies, goals, active risks, active uncertainties, evidence conflicts, expected future state, confidence, readiness, and change history.

Reality Model persistence is centralized in `PIERealityModelStorage`, `PIERealityModelRepository`, and `PIERealityModelSynchronization`. Normal workflows should synchronize qualified Layer 1 evidence into the authoritative model and then run Situation Intelligence, Predictive Reality, and Executive Judgment from that updated model. Reporter, UI components, and Layer 4 should not update Reality Objects directly.

Live Reality authority is centralized in `PIERealityModelOrchestrator`. Normal execution must resolve organization/project identity, load the latest persisted Reality Model, classify evidence deltas, synchronize only new/changed/removed/invalidated evidence, persist a new version only for meaningful changes, and return model version, snapshot ID, evidence cutoff, conflicts, uncertainties, and persistence status before downstream cognition runs.

`buildLivePIECoreIntelligence(...)` is the production-authoritative Core path. The synchronous Core builder remains only for compatibility, recovery, migration, testing, or explicit administrative repair. Executive Judgment must receive authoritative Reality Model metadata and should fail rather than silently rebuild project truth from raw Runtime evidence.

Executive Judgment records are immutable structured Layer 3 outputs. Reporter is communication-only in the live path: it consumes persisted Executive Judgment and Reality Model references, while raw evidence is used only for citation and supporting examples. Layer 4 decision candidates must come from persisted Executive Judgment records, not report text or UI draft state.

The Reality Model maintains an object registry for projects, buildings, areas, work packages, schedule activities, milestones, inspections, contractors, issues, risks, decisions, documents, photos, safety observations, reports, and owner actions.

Each reality object has a stable id, type, name, project, area or location when available, current state, current status, evidence links, knowledge links, history, last updated, confidence/readiness placeholder, and next action placeholder.

Reality object statuses include unknown, not_started, in_progress, ready, needs_verification, blocked, at_risk, contradicted, complete, and retired.

PIE Core exposes realityModel, realityModelSummary, realityObjects, realitySummary, objectsNeedingVerification, objectsAtRisk, objectsBlocked, objectsRecentlyUpdated, objectsReady, objectsUncertain, objectsWithHighRisk, objectNextActions, objectNextBestActions, and objectRelationshipSummary.

Reality Objects are intelligent. Each object should know goalsSupported, relationships, dependencies, confidence, readiness, riskLevel, momentum, nextBestAction, uncertainty, and ownerNeeded. Object Intelligence lets Judgment, Prediction, Reporter, Attention, Experience, and Beliefs prefer the current Reality Model over scattered evidence.

Reality assertions must be classified as fact, assumption, inference, or prediction. Facts require evidence, assumptions remain labeled, inferences explain how they were derived, and predictions preserve assumptions and expected timeframe. Conflicting evidence and uncertainty are first-class records and must not be flattened into one status value.

Layer 2 must answer what the current project reality is, what changed recently, which objects matter, what is ready, what is blocked, what is uncertain, what supports the current goal, what is likely to happen next, and what evidence would improve the model.

### Situation Intelligence

Situation Intelligence summarizes the Reality Model and Object Intelligence into the current executive situation: what is happening, why the user is likely here, what changed, what matters, what is blocked, what is ready, and what needs verification.

Situation Intelligence includes Intent Recognition. PIE should infer whether the user is walking daily progress, preparing for inspection, preparing an executive update, reviewing schedule risk, resolving an issue, or reviewing documents. That intent shapes what evidence matters, what unknowns matter, what PIE recommends next, and what Reporter should say.

PIE Core Intelligence exposes currentSituation, situationIntent, situationState, situationChanges, situationRisks, situationOpportunities, situationUnknowns, situationBlockers, situationPriorities, and situationSummary. Executive Reasoning, Predictive Simulation, Reporter, Attention, and Experience should consume Situation Intelligence where practical.

### Predictive Reality

Predictive Reality projects how the Reality Model is likely to evolve. It forecasts future object states, readiness forecasts, cascading effects, no-action forecasts, recovery forecasts, risks, opportunities, and a predictiveRealitySummary.

Predictive Reality consumes Reality Model, Object Intelligence, Situation Intelligence, Evidence Timeline, Beliefs, Patterns, Predictive Simulation outputs, and Missing Evidence. It answers which object may become blocked, which object may become ready, what risk grows if nothing changes, what uncertainty matters tomorrow, what recovery action changes the forecast, and what should be verified before relying on the forecast.

PIE Core Intelligence exposes predictiveReality, futureObjectStates, readinessForecasts, cascadingEffects, cascadingRealityEffects, noActionForecast, noActionOutcomes, recoveryForecast, recoveryPaths, and predictiveRealitySummary. Executive Reasoning should use Predictive Reality for decision scoring, Attention should prioritize high-impact future risks, Experience should request evidence that changes the forecast, and Reporter should mention future impact only when confidence is strong enough.

Reporter, Attention, Experience, Prediction, and Executive Reasoning should not rebuild raw context when the Reality Model is available.

### Layer 3: Executive Judgment

Layer 3 is Executive Judgment.

`PIEExecutiveJudgment` converts the Reality Model into a highest-value executive action. It consumes Reality Model, Object Intelligence, Situation Intelligence, Predictive Reality, Evidence Quality, Missing Evidence, Beliefs, Patterns, Evidence Timeline, risks, opportunities, tradeoffs, goals, and readiness forecasts.

Executive Judgment answers what matters most, what decision is needed, what creates the greatest value, what reduces the most uncertainty, what reduces the most risk, what can wait, what should be escalated, what should not be escalated, what to do when evidence is incomplete, and when no action is correct.

Layer 3.2 adds Tradeoff Intelligence, Escalation Intelligence, No-Action Reasoning, Wait-for-Evidence Reasoning, Opportunity Cost, and Decision Timing. PIE evaluates speed_vs_quality, cost_vs_schedule, risk_vs_progress, evidence_vs_time, safety_vs_productivity, communication_vs_noise, short_term_vs_long_term, and escalation_vs_local_resolution before recommending action. PIE must explain what is gained, what is lost, what happens if the user waits, what happens if the user escalates, what happens if the user does nothing, which option creates the best total outcome, which option reduces uncertainty most efficiently, which option protects the project goal, and which option creates unnecessary noise.

Escalation is only valid when a trigger is present: blocked decision, missing owner, safety risk, meaningful schedule impact, repeated unresolved issue, failed lower-level action, timing that requires leadership action, and evidence strong enough to justify escalation. If evidence is weak, PIE should usually recommend wait_for_evidence, verify, capture_evidence, monitor, or no_action instead of escalation.

Every major recommendation includes decision governance: recommendation, why, supporting evidence, assumptions, uncertainty, alternatives considered, why alternatives lost, tradeoffs, expected outcome, success measure, and what would change the recommendation.

Layer 3.3 completes Executive Judgment with a final action safety check and a single plain-language recommendation surface. PIE verifies that the recommendation is evidence-backed, aligned with the current situation, not contradicted by the Reality Model, not overstating predictions, escalation-justified, no-action-aware, missing-evidence-aware, and safe for report wording.

PIE Core Intelligence exposes executiveJudgment, executiveJudgmentResult, executiveJudgmentExplanation, executiveJudgmentHighestValueAction, executiveDecisions, executiveJudgmentPriorities, executiveRisks, executiveOpportunities, executiveConstraints, tradeoffAnalysis, escalationAnalysis, opportunityCost, decisionTiming, noActionReasoning, waitForEvidenceReasoning, actionSafetyCheck, executiveJudgmentReadiness, executiveJudgmentSummary, bestNextStep, whatCanWait, whatNotToDo, decisionNeeded, escalationRecommendation, recommendationWhy, recommendationAlternatives, and recommendationSuccessMeasure. Attention should use bestNextStep without over-prioritizing low-value escalation, Experience should guide to bestNextStep and request evidence when wait-for-evidence is best, and Reporter should use recommendationWhy and decisionNeeded in executive summary language without exposing internal scoring data.

### Layer 4: Adaptive Intelligence

Layer 4 is Adaptive Intelligence.

Adaptive Intelligence is not just learning. It improves how PIE thinks, decides, recommends, communicates, and calibrates confidence based on outcomes, corrections, approvals, rejected recommendations, edited reports, prediction outcomes, decision outcomes, and reality changes.

Adaptive Intelligence consumes Learning, Reflection, Memory Recall, user corrections, report approvals and edits, recommendation outcomes, prediction outcomes, decision outcomes, Executive Judgment outcomes, and Reality changes.

Adaptive Intelligence separates constitutional principles from adaptive policies. Constitutional principles do not change: seek truth, separate evidence from assumptions, do not fabricate, challenge conclusions, explain reasoning, identify uncertainty, and prefer decision quality over appearance. Adaptive policies may change: preferred report style, preferred evidence sequence, escalation threshold, risk threshold, confidence calibration, user communication style, and inspection readiness threshold.

PIE Core Intelligence exposes adaptiveIntelligence, outcomeIntelligence, calibrationIntelligence, strategyAdjustments, communicationAdjustments, trustAssessment, adaptiveLessons, and adaptivePolicyUpdates. Executive Judgment consumes adaptive policies where practical.

### Layer 4: Decision Memory and Executive Wisdom

Decision Memory is part of Layer 4 Adaptive Intelligence.

Decision Memory remembers decisions, recommendations, outcomes, failures, successes, wisdom lessons, and when not to act. It tracks what PIE recommended, why it recommended it, evidence used, assumptions, alternatives considered, uncertainty, user action, actual outcome, whether the recommendation was correct, impact, lesson learned, and future adjustment.

Decision Memory identifies when not to act: evidence too weak, issue already resolving, escalation creates unnecessary noise, waiting reduces risk, action is irreversible, decision impact is low, user correction history suggests caution, prediction confidence is low, or a constitutional principle requires truth over speed.

PIE Core Intelligence exposes decisionMemory, decisionHistory, wisdomLessons, whenNotToActReasons, wisdomRecommendations, and trustCalibrationHistory. Executive Judgment consults Decision Memory before recommending action. Reporter avoids overstating recommendations when wisdom says wait, Attention does not push low-value action, and Experience asks for evidence when wisdom recommends verification.

PIE should process project reality through a transparent cognitive flow:

```text
Evidence
  |
  v
Evidence Fusion
  |
  v
Reality Model
  |
  v
Knowledge Graph
  |
  v
Reflection
  |
  v
Beliefs
  |
  v
Project Objects
  |
  v
Prediction
  |
  v
Core Brain
  |
  v
Experience
  |
  v
Reporter
  |
  v
App
```

This flow keeps PIE explainable. Raw inputs should become evidence before they become facts. Evidence Fusion should combine schedule, photos, GPS, typed updates, issues, safety, documents, reports, and sync freshness into one honest view of what evidence agrees, what is missing, and what conflicts. The Knowledge Graph should connect evidence, events, areas, people, schedule items, documents, issues, decisions, recommendations, and unknowns so PIE can reason about relationships instead of isolated records. Reflection is the first self-improving layer: it does not analyze the project directly, but evaluates whether new evidence made PIE's beliefs stronger or weaker, whether PIE was correct or wrong, what still needs verification, and what evidence should be collected next. Beliefs become the stable working understanding that Project Objects, Prediction, Core Brain, Experience, Reporter, and App surfaces can use without overstating certainty. Experience turns Runtime and Attention into user-facing state, mode, action, transition, and flow. Reporter turns approved understanding into David-style communication. The App presents that intelligence in project-manager language.

The user completes the loop by verifying, correcting, approving, and adding new information.

## 5. PIE Engines

### Evidence Engine

Purpose:

Convert raw project inputs into small, attributable evidence records that can support facts, risks, recommendations, reports, and assistant answers.

Inputs:

- Photos, captions, categories, action fields, and GPS metadata.
- Typed update notes.
- Schedule items and imported schedule metadata.
- Project areas and location confidence.
- Documents and document metadata.
- Reports/history.
- Contacts and recipients.
- Sync/cloud freshness.
- Future voice transcripts, weather, calendar, email, inspections, meetings, equipment, and external systems.

Outputs:

- Evidence records with source, title, detail, timestamp, project, area, confidence, and metadata.
- Evidence groups by source, area, project, schedule item, person, document, or risk type.

Dependencies:

- Existing local app data.
- Stable project matching.
- Source attribution rules.
- Date normalization.

Future roadmap:

- Add first-class `PIEEvidence` persistence.
- Link evidence to project IDs instead of only project names.
- Add confidence decay when evidence becomes stale.
- Support AI-assisted extraction from voice, documents, email, and meeting notes after user review.

### Evidence Fusion

Purpose:

Combine separate evidence sources into one coherent project evidence view before PIE reasons from them.

Evidence Fusion answers what the schedule says, what photos show through metadata and captions, what GPS suggests, what typed updates say, what issues or safety concerns appear, what evidence is missing, and where evidence conflicts.

Inputs:

- Schedule items from CSV, PDF text extraction, AI/OCR endpoint output, and demo OCR schedule imports.
- Photo captions, categories, action required, action owner, action due date, action status, area, timestamp, and GPS metadata.
- Typed update notes, project, area, date/time, recipients, blockers, decisions, safety mentions, and next steps.
- GPS metadata from updates and photos.
- Project area mapping.
- Documents metadata.
- Report history metadata.
- Sync/cloud freshness metadata.

Outputs:

- `PIEFusedEvidence`.
- `PIEEvidenceFusionSummary`.
- `PIEIntelligentSummary`.
- Schedule evidence.
- Photo evidence.
- GPS evidence.
- User update evidence.
- Issue evidence.
- Safety evidence.
- Evidence gaps.
- Evidence conflicts.

Dependencies:

- Existing local app data.
- Schedule summary utilities.
- Project and area matching.
- Source attribution.
- Confidence and trust scoring.

Schedule priority:

Schedule is the primary source for milestones, overdue/upcoming work, schedule risk, next work, priority, and executive summary context. Imported PDF/OCR/demo schedule items should feed PIE as normal schedule items so Runtime, Mission, Knowledge Graph, Decision, Today priorities, project cards, Project Workspace, and Review can all reason from the same data.

Runtime integration:

Runtime consumes Evidence Fusion and exposes `fusedEvidence`, `evidenceFusionSummary`, `intelligentSummary`, `evidenceGaps`, and `evidenceConflicts`. Runtime uses these outputs to strengthen what PIE knows, what changed, what concerns PIE, what PIE recommends, what PIE needs from the user, Trust Score, Understanding Score, Preparedness Score, recommendations, and unknowns.

Future roadmap:

- Persist user-reviewed evidence records.
- Connect fused evidence more deeply to Knowledge Graph nodes and relationships.
- Add inspection, safety observation, voice, weather, calendar, email, equipment, and external system evidence.
- Track user corrections so future fusion confidence improves.
- Add optional AI-assisted extraction only after rule-based evidence handling remains reliable.

### Event Engine

Purpose:

Turn evidence and raw records into meaningful project events that form the project timeline.

Inputs:

- Evidence records.
- Saved updates.
- Photos.
- Schedule imports and overdue schedule signals.
- Reports.
- Assistant interactions.
- Project lifecycle changes.
- Sync activity.
- Issues, safety observations, inspections, and decisions.

Outputs:

- `ProjectEvent` records such as `update_created`, `photo_added`, `schedule_imported`, `schedule_item_overdue`, `report_generated`, `assistant_interaction`, `project_created`, `project_archived`, `project_restored`, `sync_completed`, `issue_created`, `issue_closed`, `safety_observation`, `inspection_event`, and `decision_recorded`.
- Recent activity.
- Project event timeline.
- Open decision events.

Dependencies:

- Evidence Engine.
- Project identity.
- Event type taxonomy.
- Timestamp normalization.

Future roadmap:

- Persist ProjectEvents as durable project memory.
- Add audit trail metadata.
- Link events to related people, documents, areas, schedule items, and source records.
- Support event search and long-term timeline replay.

### Intelligence Engine

Purpose:

Evaluate the current state of a project and produce structured project intelligence.

Inputs:

- Project events.
- Saved updates.
- Current draft update.
- Photos and action fields.
- Schedule items.
- Project areas and location intelligence.
- Documents.
- Contacts and recipients.
- Report history.
- Sync/cloud freshness.

Outputs:

- Project Intelligence Summary.
- Health signal.
- Schedule status.
- Progress status.
- Risk signals.
- Confidence signal.
- Communication readiness.
- Recommended next action.
- Location intelligence.

Dependencies:

- Evidence Engine.
- Event Engine.
- Rule-based evaluation logic.
- Source attribution and confidence scoring.

Future roadmap:

- Expand local rule-based signals before adding integrations.
- Add stronger area-based risk grouping.
- Add audience-aware communication readiness.
- Add stable source/confidence metadata to every major signal.
- Support optional AI interpretation on top of deterministic intelligence.

### Reasoning Engine

Purpose:

Turn intelligence and events into explainable thoughts: facts, concerns, questions, recommendations, and communication insight.

Inputs:

- Project Intelligence Summary.
- ProjectEvents.
- Evidence.
- Updates.
- Photos.
- Schedule items.
- Documents metadata.
- Memory snapshots.

Outputs:

- `PIEThought` records.
- `PIEFact` records.
- `PIEConcern` records.
- `PIEQuestion` records.
- Recommendations with why, evidence, confidence, impact, and next action.
- Communication insight for Project Assistant and Reports.

Dependencies:

- Evidence Engine.
- Event Engine.
- Intelligence Engine.
- Explainability rules.

Future roadmap:

- Persist high-value thoughts.
- Track when questions are answered.
- Connect thoughts to reports and assistant conversations.
- Add AI-assisted reasoning only after deterministic reasoning is reliable and evidence-backed.

### Memory Engine

Purpose:

Help PIE understand project history over time instead of only analyzing the current status snapshot.

Inputs:

- ProjectEvents.
- PIEReasoningResult.
- Project Intelligence Summary.
- Updates.
- Photos.
- Schedule items.
- Documents metadata.
- Report history.

Outputs:

- `PIEMemorySnapshot`.
- `PIEProjectStory`.
- `PIEProjectTimelineSegment`.
- `PIEMemoryPattern`.
- `PIEMemoryGap`.
- `PIEMemoryInsight`.

Dependencies:

- Event Engine.
- Reasoning Engine.
- Timeline grouping.
- Pattern detection.

Future roadmap:

- Persist memory snapshots.
- Add organization-level memory.
- Track repeated issue types, schedule movement, update cadence, safety recurrence, inspection outcomes, and communication history.
- Feed future prediction and learning engines.

### Decision Engine

Purpose:

Prioritize what the project manager should do next from the current PIE state.

Inputs:

- Project Intelligence Summary.
- PIEReasoningResult.
- PIEMemorySnapshot.
- ProjectEvents.
- Risks.
- Concerns.
- Questions.
- Recommendations.
- Schedule status.
- Confidence.
- Communication readiness.

Outputs:

- `PIEDecision`.
- `PIEDecisionQueue`.
- `PIENextBestAction`.
- Critical decisions.
- Communication decisions.
- Project Walk decision.
- User-approval-required decisions.

Dependencies:

- Intelligence Engine.
- Reasoning Engine.
- Memory Engine.
- ProjectEvent layer.
- User approval rules.

Future roadmap:

- Feed Home with one clear recommended next action.
- Feed Project Overview with the top decision and evidence.
- Feed Project Assistant with concise decision explanations.
- Feed Reports with communication-ready decision context.
- Feed Project Walk with area-specific review prompts.
- Persist decision outcomes after users approve, reject, defer, or correct PIE recommendations.

### PIE Behavior Layer

Purpose:

Define when PIE should monitor, brief, ask, recommend, escalate, prepare, wait, or learn.

The Behavior Layer governs how PIE acts like a senior project manager. It should prevent PIE from behaving like a noisy chatbot or passive dashboard. It decides when a recommendation deserves attention, when a missing answer is worth asking for, when an issue should escalate, and when PIE should stay quiet.

Inputs:

- Runtime beliefs, Trust Score, Understanding Score, Preparedness Score, recommendations, unknowns, and graph-backed evidence.
- Decision Queue and approval-required decisions.
- Memory patterns, repeated concerns, reviewed items, and stale recommendations.
- Knowledge Graph blocked items, area-linked risks, missing relationships, and connected evidence.
- Project Walk, Reports, Home, and Project Overview context.

Outputs:

- Behavior state: Monitor, Brief, Ask, Recommend, Escalate, Prepare, Wait, or Learn.
- Attention Score: Low, Medium, High, or Critical.
- PIE Recommendation with why, evidence, confidence, urgency, approval requirement, and expected impact.
- Quiet reason when PIE intentionally does not interrupt.
- Questions and escalations when user attention is justified.

Core rule:

PIE prepares; the user approves. PIE should reduce uncertainty, explain itself, avoid unnecessary interruption, and never invent project facts.

Future roadmap:

- Phase 1: documentation only in `docs/PIE_BehaviorModel.md`.
- Phase 2: local rule-based Behavior Engine service.
- Phase 3: Runtime integration.
- Phase 4: PIE notifications and prompts.
- Phase 5: JARVIS behavior validation.

### PIE Executive Layer

Purpose:

Create the senior project-management layer that decides what deserves attention across projects.

PIE Executive sits above Runtime and the future Behavior Layer. Runtime describes current project reality. Behavior governs when PIE should speak, ask, recommend, escalate, prepare, wait, or learn. PIE Executive reviews those outputs, plus Decisions, Memory, Knowledge Graph, Reasoning, Events, and Intelligence, to decide what matters most from a management point of view.

Inputs:

- PIERuntimeState and PIERuntimeResponse.
- PIEDecisionQueue and approval-required decisions.
- PIEMemorySnapshot and Project Story.
- PIEReasoningResult, concerns, questions, and recommendations.
- PIE Knowledge Graph, graph gaps, blocked items, connected evidence, and area-linked risks.
- ProjectEvents and Project Intelligence Summary.
- Future Behavior state and Attention Score.

Outputs:

- PIEExecutiveBrief.
- Ranked priorities.
- Projects needing attention.
- Escalations.
- Preparations.
- Questions for the user.
- Recommended operating mode.
- What PIE recommends now.
- What should wait.
- Confidence and trust explanation.
- User approval required items.

Operating modes:

- morning_brief
- active_project_review
- project_walk_prep
- executive_meeting_prep
- customer_update_prep
- end_of_day_review
- monitor

How Executive feeds Conversation and user-facing briefings:

PIE Executive decides what deserves attention. Conversation should explain that decision in concise project-manager language. User-facing briefings such as Home, Project Overview, Reports, Project Assistant compatibility, and future Project Walk should eventually use Executive output through Runtime rather than independently deciding priorities.

Executive -> Runtime integration:

Runtime consumes PIE Executive and exposes the Executive-backed management view as part of the standard Runtime state. Runtime should call `buildPIEExecutiveBrief(...)`, `buildExecutivePriorities(...)`, `getProjectsNeedingAttention(...)`, `getExecutiveEscalations(...)`, `getExecutivePreparations(...)`, `getExecutiveQuestions(...)`, `getExecutiveDailyRoutine(...)`, and `getRecommendedOperatingMode(...)` so the UI receives one coherent management-ready answer.

Runtime outputs should include:

- Executive brief.
- Executive priorities.
- Projects needing attention.
- Executive escalations.
- Executive preparations.
- Executive questions.
- Executive daily routine.
- Recommended operating mode.

Runtime remains the UI-facing state. PIE Executive strengthens Runtime briefing, priority queue, recommendations, next best action, what PIE needs from the user, preparedness, and trust explanation. Product surfaces should consume these Executive-backed Runtime fields instead of separately calling Executive or rebuilding priority logic.

Executive output supports:

- Home: morning brief, top priority, projects needing attention, and daily routine.
- Project Overview: current Executive concern, recommendation, preparation, and question.
- Reports: executive/customer preparation and approval-required communication boundaries.
- Project Walk: project walk operating mode, field verification priorities, and location/area uncertainty.
- Future cross-industry use: the same Executive pattern can later prioritize operational work in facilities, maintenance, manufacturing, compliance, safety, or capital programs after the project-management model is dependable.

Core rule:

PIE Executive prepares and prioritizes. The user approves.

Future roadmap:

- Keep Phase 1 as a local rule-based service.
- Feed Executive output into Runtime.
- Let Conversation use Executive output for senior project-management briefings.
- Let JARVIS validate Executive priorities, escalations, operating mode, and approval boundaries.
- Generalize the pattern later only after project-management behavior is dependable.

### PIE Mission Engine

Purpose:

Give PIE purpose.

The Mission Engine answers: "What am I trying to accomplish right now?" Every recommendation, project walk, report, briefing, and question should support the current mission.

Mission sits above Executive. Executive manages priorities. Mission manages purpose.

Inputs:

- PIERuntimeState and Runtime scores, recommendations, unknowns, beliefs, and graph outputs.
- PIEExecutiveBrief, priorities, escalations, preparations, questions, and operating mode.
- PIEReflectionResult, weak evidence, verification questions, gaps, and confidence audits.
- Future PIE Behavior state, Attention Score, questions, recommendations, and escalations.
- PIEDecisionQueue, next best action, critical decisions, communication decisions, project walk decision, and approval-required decisions.
- PIEMemorySnapshot, Project Story, patterns, gaps, and insights.
- PIE Knowledge Graph relationships, gaps, blocked items, and connected evidence.
- ProjectEvents and Project Intelligence Summary.

Outputs:

- `PIEMission`.
- `PIEMissionSummary`.
- `PIEMissionObjective`.
- `PIEMissionProgress`.
- `PIEMissionBlocker`.
- `PIEMissionEvidence`.
- `PIEMissionSuccessCriteria`.
- `PIEMissionTransition`.
- `PIEMissionRecommendation`.
- Current mission title, purpose, reason, progress, evidence collected, evidence still needed, blockers, priority, confidence, trust, expected impact, approvals required, and next mission.

Mission types:

- Morning Brief.
- Project Walk.
- Executive Meeting Prep.
- Customer Update Prep.
- Inspection Verification.
- Reduce Project Uncertainty.
- Close Critical Risks.
- Safety Verification.
- Issue Investigation.
- Schedule Recovery.
- Communication Preparation.
- Documentation Completion.
- Monitoring.

Mission lifecycle:

```text
Identify Purpose
  |
  v
Gather Evidence
  |
  v
Evaluate Blockers
  |
  v
Recommend Action
  |
  v
Ask / Prepare / Escalate / Wait
  |
  v
User Verifies or Approves
  |
  v
Complete or Transition
```

Mission transitions:

```text
Morning Brief
  |
  v
Project Walk
  |
  v
Inspection Verification
  |
  v
Executive Review
  |
  v
Customer Update
  |
  v
Monitoring
```

Mission completion:

A mission is complete only when its success criteria are satisfied or the user has verified the necessary reality. Mission completion does not automatically save, send, close, approve, or change project status.

How Mission relates to Executive:

Executive identifies what deserves attention. Mission explains why that attention matters and what outcome PIE is pursuing.

How Mission relates to Behavior:

Behavior decides how PIE should act. Mission gives Behavior a purpose. For example, a Reduce Project Uncertainty mission may cause Behavior to Ask one focused verification question.

How Mission relates to Reflection:

Reflection audits whether the mission is supported by evidence. If Reflection finds weak support, Mission should shift toward reducing uncertainty before preparing communication or decisions.

How Mission relates to Runtime:

Runtime now exposes Mission as part of the single PIE response: current mission, mission summary, objective, progress, blockers, evidence, recommendations, success criteria, completion state, and next mission.

Mission -> Runtime integration:

Runtime consumes `PIEMissionEngine` by calling `buildMission(...)`, `buildDailyMission(...)`, `buildProjectMission(...)`, `buildMissionSummary(...)`, and mission helper functions for objective, blockers, evidence, recommendations, success criteria, progress, completion, and next mission.

Runtime uses Mission output to strengthen:

- Briefing: Runtime briefing summaries can identify the active mission.
- Priority Queue: mission recommendations can become the current next action when they outrank the fallback decision.
- Recommendations: mission recommendations are merged with Decision, Executive, Intelligence, Reasoning, and Conversation recommendations.
- Needs From User: mission evidence gaps and blockers become Runtime unknowns.
- Preparedness Score: Mission Readiness contributes to meeting, report, decision, and Project Walk readiness.
- Understanding Score: Mission coverage shows whether PIE has a clear purpose, evidence, progress, and transition.
- Trust explanation: Runtime trust now includes Mission trust, evidence count, blockers, and mission status.

How Mission relates to Conversation:

Conversation should express the current mission in concise project-manager language, such as: "PIE's mission right now is to verify inspection status before preparing the customer update."

How Mission relates to Knowledge Graph:

Knowledge Graph supports Mission by showing connected evidence, blockers, area-linked risks, missing relationships, and related people, documents, reports, or schedule items.

Future roadmap:

- Keep Phase 1 local and rule-based in `services/PIEMissionEngine.ts`.
- Keep Runtime as the UI-facing current mission state.
- Let Conversation and future voice explain the active mission.
- Let JARVIS validate that every mission has evidence, measurable success, correct transitions, and no conflict with Executive priorities.
- Use future Prediction to recommend mission transitions and future Learning to improve mission timing.

### PIE Partnership Layer

Purpose:

Define how PIE collaborates with the user.

PIE is not a chatbot and not an automation tool. PIE is an Executive Project Partner. The Partnership Layer defines the relationship between PIE's intelligence and the user's judgment.

Mission:

PIE exists to partner with the user to build the most accurate understanding of project reality. The user supplies judgment from the field. PIE supplies memory, analysis, prioritization, preparation, and recommendations. Together they manage the project.

Core collaboration principles:

- PIE prepares. User approves.
- PIE recommends. User decides.
- PIE asks. User verifies.
- PIE remembers. User teaches.
- PIE explains. User trusts.
- PIE never invents facts.
- PIE admits uncertainty.
- PIE always cites evidence.

Collaboration modes:

- Morning Brief.
- Project Walk.
- Project Review.
- Executive Review.
- Customer Review.
- Issue Investigation.
- Decision Review.
- Learning Review.
- Monitoring.

Conversation behaviors:

- Ask: PIE asks only when the answer improves understanding.
- Recommend: PIE proposes a useful next action with evidence.
- Challenge: PIE pushes back when evidence is weak, stale, or contradictory.
- Explain: PIE shows why, evidence, confidence, uncertainty, impact, and next action.
- Prepare: PIE drafts or assembles useful work for review.
- Verify: PIE asks the user to confirm reality when confidence is low.
- Teach: PIE explains what information would make it smarter.
- Summarize: PIE condenses current project reality.
- Reflect: PIE admits where its own thinking is weak.
- Wait: PIE stays quiet when speaking adds no value.

User interactions:

- Confirm.
- Correct.
- Reject.
- Approve.
- Delay.
- Escalate.
- Add evidence.
- Ask why.
- Request explanation.
- Override recommendation.
- Mark complete.

Every user interaction should improve PIE by strengthening evidence, correcting assumptions, refining confidence, improving defaults, or teaching future behavior. User feedback should not create hidden facts. Project facts still require evidence or explicit user-approved records.

Trust rules:

PIE must explain every recommendation, show evidence, show uncertainty, show confidence, show trust, never hide missing information, and never overstate certainty.

Learning loop:

```text
Reality
  |
  v
Evidence
  |
  v
Understanding
  |
  v
Recommendation
  |
  v
User Feedback
  |
  v
Improved Understanding
  |
  v
Future Recommendations
```

How Partnership connects Executive and Conversation:

Executive decides what deserves attention. Partnership defines how that attention should be handled with the user. Conversation expresses the partnership in language, prompts, summaries, questions, prepared updates, and future voice interaction.

Future voice path:

Voice should make partnership easier, not less controlled. Future voice observations should become draft evidence. The user still reviews, corrects, and approves before saving, sending, closing, or changing project status.

Future roadmap:

- Keep Phase 1 documentation-only in `docs/PIE_PartnershipModel.md`.
- Add Partnership state to Runtime or Behavior output.
- Connect user feedback events to Memory and future Learning.
- Use Partnership rules in Project Assistant and Project Walk.
- Support voice interaction with review-and-approve safeguards.

### PIE Reflection Engine

Purpose:

Create PIE's self-audit layer.

PIE Reflection does not make project decisions. It audits PIE's own thinking so PIE can better support the end user. Reflection asks whether PIE's understanding, beliefs, recommendations, priorities, and confidence are supported by evidence.

Inputs:

- PIERuntimeState and PIERuntimeResponse.
- PIEExecutiveBrief.
- PIEDecisionQueue and high-priority decisions.
- PIEReasoningResult, facts, concerns, questions, and recommendations.
- PIEMemorySnapshot, Project Story, memory gaps, and stale history.
- PIE Knowledge Graph, graph gaps, contradictions, blocked items, and relationship evidence.
- ProjectEvents.
- Project Intelligence Summary.

Outputs:

- PIEReflectionResult.
- PIEReflectionFinding.
- PIEReflectionRisk.
- PIEReflectionGap.
- PIEReflectionWeakRecommendation.
- PIEReflectionVerificationQuestion.
- PIEReflectionConfidenceAudit.
- PIEReflectionEvidenceAudit.
- Suggested confidence adjustments.
- What PIE should verify first.
- User-facing explanation of uncertainty.

How Reflection audits PIE's own thinking:

Reflection reviews the evidence behind PIE conclusions. It flags recommendations with low evidence, recommendations with low confidence, stale updates, missing photos, missing schedule support, missing inspection status, contradictions, high-priority decisions with weak support, and areas where PIE should ask the user to verify before acting.

How Reflection improves trust:

Reflection makes uncertainty visible. It helps PIE reduce confidence when support is weak, convert weak recommendations into verification questions, and explain why a recommendation should be trusted or treated cautiously.

How Reflection feeds Runtime and Project Assistant:

Runtime should eventually consume Reflection output so product surfaces can show weak recommendations, missing evidence, confidence adjustments, verification questions, and what PIE should verify first. Project Assistant should use Reflection to answer honestly when evidence is weak instead of presenting unsupported conclusions with too much certainty.

Core rule:

Reflection audits. It does not approve, send, close, change status, or override user judgment.

Future roadmap:

- Keep Phase 1 local and rule-based in `services/PIEReflectionEngine.ts`.
- Connect Reflection output to Runtime after the audit model is stable.
- Let Project Assistant and Reports explain uncertainty from Reflection.
- Add JARVIS checks for weak recommendations, missing evidence, verification questions, and confidence reduction.
- Add AI-assisted reflection only after deterministic self-audit behavior is reliable and evidence-backed.

### Conversation Engine

Purpose:

Coordinate Evidence, Events, Intelligence, Reasoning, Memory, and Decision into one continuous project intelligence experience.

The Conversation Engine is not a chatbot. It is the conductor that turns PIE's internal state into short, professional, evidence-backed responses for product surfaces and future voice workflows.

Inputs:

- PIE evidence from reasoning.
- ProjectEvents from the Event Engine.
- Project Intelligence Summary.
- PIE Thoughts, concerns, questions, recommendations, and communication insight.
- PIE Memory Snapshot, Project Story, gaps, patterns, timeline segments, and insights.
- PIE Decision Queue and Next Best Action.
- Conversation intent or user question.
- Current project, current draft, updates, schedule items, project areas, contacts, documents, report history, and sync freshness.

Outputs:

- `PIEConversation`.
- `PIEConversationState`.
- `PIEConversationResponse`.
- `PIEConversationSummary`.
- `PIEConversationQuestion`.
- `PIEConversationSuggestion`.
- Intent-specific responses for Morning Brief, Project Status, Project Story, Next Best Action, Risks, Concerns, Communication, Project Walk, Executive Summary, Customer Update, and General Question.

Dependencies:

- Evidence Engine.
- Event Engine.
- Intelligence Engine.
- Reasoning Engine.
- Memory Engine.
- Decision Engine.
- Explainability rules.
- Human approval rules.

Response rules:

- Always identify what PIE knows when evidence exists.
- Explain what changed when timeline or memory exists.
- Surface concerns without overstating weak evidence.
- Recommend one practical next action when possible.
- Say what PIE needs from the user when confidence is low or context is missing.
- Include confidence and uncertainty.
- Never invent facts.

How it orchestrates all engines:

1. Builds or receives ProjectEvents from existing local data.
2. Runs the Intelligence Engine for current project state.
3. Runs the Reasoning Engine to produce evidence, facts, concerns, questions, and recommendations.
4. Runs the Memory Engine to build Project Story, gaps, patterns, and timeline context.
5. Runs the Decision Engine to prioritize next best action and approval-required decisions.
6. Formats a response for the requested intent using the shared PIE state.

How Home uses it:

Home should use Conversation Engine output for the Morning Brief, today's priority, PIE observations, and what PIE needs from the user. Home should not independently invent competing recommendations.

How Project Walk uses it:

Project Walk should use Conversation Engine output to decide what to verify while the user is standing in the field: likely project, likely area, open concerns, overdue schedule items, inspection gaps, safety concerns, and missing context. Voice observations should enter as draft inputs that the user reviews before saving.

How Reports use it:

Reports should use Conversation Engine output to prepare executive summaries, customer updates, project summaries, and communication readiness. Reports must remain review-and-approve surfaces; PIE prepares, the user approves.

How future voice plugs into it:

Future voice should provide transcript evidence and intent signals to the Conversation Engine. The Conversation Engine should use voice as another input, not as uncontrolled automation. Voice can help PIE understand field observations, ask clarifying questions, and prepare structured updates, but saving updates or sending communication still requires user review and approval.

Future roadmap:

- Feed all major product surfaces from a shared conversation state.
- Add Project Walk voice intent after review-and-approve capture is dependable.
- Persist high-value conversation summaries and user corrections.
- Connect accepted/rejected recommendations to future learning.
- Add optional AI language drafting only after local rule-based orchestration remains evidence-backed.

### PIE Runtime

Purpose:

Create the central orchestration layer for all PIE engines and provide one stable interface between PIE and the application UI.

The Runtime is the answer to the product question: "PIE, what should I show?" It is not a new source of project facts. It collects, reconciles, prioritizes, and formats the output of the existing engines into one UI-ready state.

Inputs:

- PIE evidence from the Reasoning Engine.
- ProjectEvents and Project Story from the Event Engine.
- Project Intelligence Summary from the Intelligence Engine.
- PIE Thoughts, concerns, questions, recommendations, and communication insight from the Reasoning Engine.
- PIE Memory Snapshot, memory gaps, memory insights, patterns, timeline segments, and Project Story from the Memory Engine.
- PIE Decision Queue, Next Best Action, critical decisions, communication decisions, Project Walk recommendation, and approval-required items from the Decision Engine.
- PIE Conversation and intent response from the Conversation Engine.
- PIE Knowledge Graph nodes, edges, relationships, insights, gaps, blocked items, connected evidence, and area-linked risks.
- PIE Executive brief, ranked priorities, projects needing attention, escalations, preparations, questions, daily routine, and recommended operating mode.
- PIE Mission current mission, daily mission, project mission, objective, progress, blockers, evidence, recommendations, success criteria, completion state, and next mission.
- Current project, updates, photos, schedule items, project areas, contacts, documents, report history, sync freshness, and location context.

Outputs:

- `PIERuntimeResponse`.
- `PIERuntimeState`.
- `PIERuntimeSummary`.
- `PIEUnderstanding`.
- `PIECurrentUnderstanding`.
- `PIEPriorityQueue`.
- `PIEBriefing`.
- `PIEBelief`.
- `PIERecommendation`.
- `PIEPriority`.
- `PIEInsight`.
- `PIEUnknown`.
- `PIETrustScore`.
- `PIEUnderstandingScore`.
- `PIEPreparednessScore`.
- `PIEGraphInsight`.
- `PIEGraphGap`.
- Blocked graph relationships.
- Connected graph evidence.
- Recommendation evidence links.
- Area-linked risk relationships.
- Runtime relationship confidence.
- Executive brief.
- Executive priorities.
- Projects needing attention.
- Executive escalations.
- Executive preparations.
- Executive questions.
- Executive daily routine.
- Recommended operating mode.
- Executive trust explanation.
- Current mission.
- Mission summary.
- Mission objective.
- Mission progress.
- Mission blockers.
- Mission evidence.
- Mission recommendations.
- Mission success criteria.
- Mission complete state.
- Next mission.

Runtime responsibilities:

1. Collect outputs from every PIE engine.
2. Resolve conflicts by favoring evidence-backed, higher-priority, lower-risk conclusions.
3. Merge duplicate recommendations so the user sees one clear priority instead of repeated engine output.
4. Calculate overall PIE confidence from intelligence, memory, decisions, evidence, events, and unknowns.
5. Calculate project understanding so product surfaces can show how much PIE knows.
6. Generate one unified state suitable for Home, Projects, Project Overview, Capture, Reports, Project Assistant compatibility, and future Project Walk.
7. Keep raw engine detail available for explainability without requiring UI pages to call those engines directly.

Runtime output should always be able to answer:

- What PIE knows.
- What changed.
- What concerns PIE.
- What PIE recommends.
- What PIE needs from the user.
- Overall confidence.
- Current priority.

Runtime Contract 1.0:

The Runtime response is PIE's current understanding of reality. Every future page, report, workflow, voice interaction, and integration should consume this same object whenever practical.

Required sections:

1. Current Beliefs: what PIE currently believes to be true, with supporting evidence, contradicting evidence, confidence, status, and remaining uncertainty.
2. Current Understanding: the current project understanding in user-facing language.
3. Recent Changes: what has changed since the last review or latest known activity.
4. Current Concerns: risks, blockers, unknowns, and concerns that matter now.
5. Recommendations: prioritized actions PIE recommends.
6. Needs From User: questions, approvals, missing evidence, and confirmations.
7. Project Story: the current narrative from memory.
8. Decision Queue: pending decisions, next best action, communication decisions, Project Walk recommendation, and approval-required items.
9. Trust Score: whether PIE has enough current, broad, non-conflicting evidence.
10. Understanding Score: how complete PIE's current understanding is.
11. Preparedness Score: how ready PIE is to support the user right now.
12. Graph Intelligence: relationship-backed insights, gaps, blocked items, connected evidence, recommendation evidence, area-linked risks, and relationship confidence.
13. Executive Intelligence: Executive-backed priorities, escalations, preparations, questions, operating mode, and management brief.
14. Mission Intelligence: current mission, objective, progress, evidence, blockers, recommendations, success criteria, completion state, and next mission.

Runtime contract rules:

- Runtime is the only UI entry point whenever practical.
- Pages never calculate project intelligence.
- Pages render Runtime output.
- Every Runtime response must be explainable.
- Every recommendation traces back to evidence.
- Beliefs never invent facts.
- Unknown is better than wrong.
- PIE prepares. The user verifies, corrects, and approves.

Future compatibility:

The Runtime Contract should stay additive. New engines, external systems, Knowledge Graph relationships, voice transcripts, weather, calendar, email, inspections, safety observations, and prediction outputs should enter the Runtime as evidence-backed fields without breaking existing required sections.

Voice compatibility:

Future voice should provide transcript evidence, intent, user corrections, and approval state. Voice should not bypass Runtime, review, or user approval. Project Walk should use the same Runtime sections while the user moves through the field.

Knowledge Graph compatibility:

Knowledge Graph output supports beliefs, relationships, evidence, project story, decisions, and confidence. The graph enriches Runtime sections; it does not become a separate UI contract. Product surfaces should continue to render Runtime output instead of calling the graph directly.

Single Runtime response:

Every Runtime response should provide one complete, UI-ready answer:

- Current Beliefs.
- Current Understanding.
- Recent Changes.
- Current Concerns.
- Recommendations.
- Needs From User.
- Project Story.
- Decision Queue.
- What PIE knows.
- What changed.
- What concerns PIE.
- What PIE recommends.
- What PIE needs from the user.
- Confidence.
- Trust Score.
- Understanding Score.
- Preparedness Score.
- Priority Queue.
- Next Best Action.
- Graph Insights.
- Graph Gaps.
- Blocked Items.
- Connected Evidence.
- Evidence For Recommendations.
- Area-linked Risks.
- Relationship Confidence.
- Executive Brief.
- Executive Priorities.
- Projects Needing Attention.
- Executive Escalations.
- Executive Preparations.
- Executive Questions.
- Executive Daily Routine.
- Recommended Operating Mode.
- Executive Trust Explanation.
- Current Mission.
- Mission Summary.
- Mission Objective.
- Mission Progress.
- Mission Blockers.
- Mission Evidence.
- Mission Recommendations.
- Mission Success Criteria.
- Mission Complete.
- Next Mission.

How Mission supports product surfaces:

- Home: shows the daily mission, top priority, and what PIE needs from the user before the day starts.
- Project Overview: explains what PIE is trying to accomplish for the selected project and what evidence is missing.
- Project Walk: uses mission purpose, blockers, and evidence gaps to guide what the user should verify in the field.
- Reports: keeps executive and customer communication tied to the current mission and approval boundaries.
- Future daily operating cycle: Mission lets PIE move from Morning Brief to Project Walk, verification, review, communication, and monitoring without every surface inventing its own purpose.

This response is the first platform contract between PIE and product surfaces. A page may render only part of the response, but it should not recreate the response by manually coordinating multiple engines.

Trust Score:

The Trust Score is an initial local, rule-based heuristic that explains how much confidence the user should place in PIE's current understanding.

Trust Score factors:

- Evidence freshness.
- Evidence coverage.
- Photo coverage.
- Schedule completeness.
- Recent updates.
- Open questions.
- Conflicting evidence.
- Inspection status when available.

Trust Score output:

- Overall score from 0 to 100.
- Trust level.
- Reasons.
- Improvement suggestions.
- Factor-level score, weight, status, reason, and suggested improvement.

The Trust Score is not a promise that PIE is correct. It is an explainable measure of whether PIE has enough current, broad, and non-conflicting evidence to support its recommendations.

Preparedness Score:

The Preparedness Score explains how ready PIE is to support the user right now.

Preparedness areas:

- Executive meeting readiness.
- Customer update readiness.
- Project Walk readiness.
- Report readiness.
- Decision readiness.

Preparedness output:

- Overall score from 0 to 100.
- Preparedness level.
- Reasons.
- Missing items.
- Improvement suggestions.
- Area-level score, weight, level, reason, missing items, and improvement suggestions.

Preparedness is not permission to act automatically. It tells the user whether PIE has enough evidence and context to support a meeting, update, walk, report, or decision review.

Dependencies:

- Evidence Engine.
- Event Engine.
- Intelligence Engine.
- Reasoning Engine.
- Memory Engine.
- Decision Engine.
- Conversation Engine.
- PIE Executive Layer.
- Explainability rules.
- Human approval rules.

Relationship to every engine:

The Runtime sits above the individual PIE engines. Lower engines remain responsible for their specialized work. The Runtime is responsible for orchestration, conflict resolution, deduplication, confidence, and presentation shape.

The Runtime should not replace the engines. It should prevent product surfaces from manually stitching together multiple engine calls in inconsistent ways.

Relationship to UI:

No UI page should eventually depend directly on more than one PIE engine.

Home, Projects, Project Overview, Capture, Reports, Project Assistant compatibility, and future Project Walk should ask the Runtime for a single state. Pages may choose which Runtime section to render, but they should not independently decide project priority, confidence, recommendations, unknowns, or briefing language.

Architecture rule:

The Runtime is the single orchestration layer between PIE and the UI. Product surfaces should move toward calling `buildRuntime(...)` or a Runtime-specific helper instead of calling Intelligence, Reasoning, Memory, Decision, and Conversation services separately.

Development rule:

Every future UI component must consume Runtime output rather than multiple PIE engines whenever practical.

Direct engine calls should be reserved for engine-specific development, diagnostics, tests, or transitional compatibility. Daily product surfaces should ask the Runtime what to show.

Future voice integration:

Voice should enter PIE as transcript evidence and intent context. The Conversation Engine should interpret the voice intent, and the Runtime should decide what the UI should show while the user walks the project: likely project, likely area, current concerns, missing information, next verification, and draft update state. Voice should not bypass review-and-approve rules.

Future cloud synchronization:

The Runtime should eventually understand freshness across local and cloud data. It should expose sync confidence, stale-data unknowns, last analysis time, queued changes, and conflict signals so UI pages can show whether PIE is reasoning from current information.

Knowledge Graph -> Runtime integration:

The Runtime consumes the Project Knowledge Graph as a relationship layer that connects projects, areas, contractors, documents, schedule items, inspections, issues, decisions, reports, people, equipment, and external system records where those records are available.

The Knowledge Graph does not replace the Runtime. It is a richer evidence and relationship source that the Runtime uses to answer what PIE knows, what changed, what relationships matter, and what the user should verify next.

Runtime uses graph relationships to:

- Add graph-backed insights to current concerns and explainability.
- Surface graph gaps as missing information.
- Identify blocked items from `blocks` relationships.
- Connect recommendations to supporting evidence nodes.
- Identify area-linked risks for Project Walk and project-card context.
- Improve Trust Score and Understanding Score through relationship confidence.

Graph-backed evidence improves trust because recommendations can point to connected updates, photos, schedule items, documents, events, decisions, or unknowns instead of only repeating a summary. Missing relationships reduce confidence and become actionable gaps.

Evidence Fusion -> Runtime integration:

The Runtime consumes Evidence Fusion as the coherent evidence-audit layer. Evidence Fusion tells Runtime whether schedule, photos, GPS, typed updates, issues, safety, documents, reports, and sync metadata support the same story or whether PIE should reduce confidence and ask for verification.

Runtime exposes:

- `fusedEvidence`.
- `evidenceFusionSummary`.
- `intelligentSummary`.
- `evidenceGaps`.
- `evidenceConflicts`.

Runtime uses fused evidence to strengthen:

- What PIE knows.
- What changed.
- What concerns PIE.
- What PIE recommends.
- What PIE needs from the user.
- Trust Score.
- Understanding Score.
- Preparedness Score.
- Runtime recommendations.
- Runtime unknowns.

Product surfaces should consume these fields through Runtime. Pages should not independently recalculate schedule/photo/GPS/update fusion.

Future Prediction integration:

The Runtime should become the place where future Prediction Engine output is reconciled with current evidence, memory, decisions, and Trust Score.

Predictions should enter the Runtime as confidence-scored forecasts with evidence, impact, and suggested prevention actions. The Runtime should decide whether a prediction belongs in current concerns, recommendations, unknowns, Project Walk prompts, reports, or monitoring only.

Future roadmap:

- Replace direct multi-engine UI calls with Runtime calls.
- Add surface-specific Runtime briefs for Home, Projects, Project Overview, Capture, Reports, and Project Walk.
- Persist selected Runtime summaries after user approval so Project Story can remember what PIE recommended and what the user did.
- Add cloud freshness and device/offline confidence to Runtime state.
- Expand Knowledge Graph relationship evidence as project entities become more stable.
- Add Prediction Engine output once memory and event history are dependable.
- Add AI language drafting only after Runtime confidence and evidence rules remain stable.

### PIE Knowledge Graph

Purpose:

Create an in-memory relationship model that connects project data so PIE can understand how records relate to each other.

The Knowledge Graph is not a UI surface and is not a database schema in the first version. It is a local, rule-based relationship layer that helps PIE answer:

- What evidence supports this recommendation?
- What project areas are connected to risks?
- Which schedule items are blocked?
- Which documents or reports relate to this issue?
- What information is missing?
- Which people or contractors are tied to this concern?

Inputs:

- ProjectEvents.
- Project Intelligence Summary.
- PIE Reasoning Result.
- PIE Memory Snapshot.
- PIE Decision Queue.
- PIE Runtime State.
- Updates and photos.
- Schedule items.
- Documents metadata.
- Report history.
- Project areas.
- Contacts and contractors where available.

Outputs:

- `PIEGraphNode`.
- `PIEGraphEdge`.
- `PIEGraph`.
- `PIEGraphRelationship`.
- `PIEGraphInsight`.
- `PIEGraphGap`.

Node types:

- `project`
- `area`
- `photo`
- `update`
- `schedule_item`
- `document`
- `report`
- `person`
- `contractor`
- `issue`
- `safety`
- `inspection`
- `decision`
- `recommendation`
- `unknown`
- `event`
- `evidence`

Edge types:

- `belongs_to`
- `located_in`
- `supports`
- `contradicts`
- `blocks`
- `depends_on`
- `mentions`
- `assigned_to`
- `caused_by`
- `resolved_by`
- `requires_approval`
- `needs_evidence`
- `feeds_report`
- `updates_story`

How the Knowledge Graph supports Memory:

The graph gives Memory a relationship layer for Project Story. Instead of only counting events, memory can later understand which areas, contractors, documents, reports, and unresolved issues are repeatedly connected over time.

How the Knowledge Graph supports Reasoning:

The graph helps Reasoning trace concerns, facts, questions, and recommendations back to connected evidence. A recommendation should be able to show the update, photo, schedule item, document, event, or decision that supports it.

How the Knowledge Graph supports Decision:

The graph helps the Decision Engine prioritize actions by making blockers, approval requirements, missing evidence, people assignments, and schedule dependencies explicit.

How the Knowledge Graph supports Conversation:

The graph gives Conversation a structured way to explain why PIE says something. Future Project Assistant and voice responses can answer with connected evidence instead of isolated summaries.

How the Knowledge Graph supports Project Walk:

Project Walk can use graph relationships to decide what to verify while standing in the field: area-linked risks, schedule blockers, missing inspection evidence, open photo actions, contractors mentioned nearby, and documents tied to the current area.

How the Knowledge Graph supports future Prediction:

Prediction should eventually use graph patterns to detect repeated blockers, contractor performance patterns, area-specific risks, document gaps, inspection dependencies, and weak evidence chains. Predictions must remain confidence-scored and evidence-backed.

Future persistent graph storage path:

The first Knowledge Graph is derived in memory from existing local data. A future schema sprint may persist graph nodes and edges after the relationship model proves useful.

Persistent graph storage should:

- Use stable project IDs instead of project names where available.
- Preserve node IDs, edge IDs, confidence, source, timestamps, and metadata.
- Link graph nodes to original records without replacing updates, photos, schedules, documents, reports, or events.
- Store only approved or deterministic relationships at first.
- Keep inferred or low-confidence relationships marked as uncertain.
- Support cloud sync only after local graph behavior is stable.

Future roadmap:

- Expand Runtime graph insights and graph gaps as more inputs become structured.
- Connect more recommendations directly to graph evidence.
- Add area-based Project Walk prompts from graph relationships.
- Add graph-backed report evidence sections.
- Persist selected graph relationships after user approval or deterministic derivation.

### Future Prediction Engine

Purpose:

Forecast likely project outcomes and emerging risks from historical patterns and current evidence.

Inputs:

- Project memory.
- Schedule history.
- Risk patterns.
- Update cadence.
- Inspection outcomes.
- Weather, calendar, contractor, equipment, and external system data when available.

Outputs:

- Forecasted risk.
- Likely delay indicators.
- Early warning signals.
- Confidence-scored predictions.
- Recommended prevention actions.

Dependencies:

- Durable project memory.
- Reliable event history.
- Stable confidence model.
- Enough historical data to avoid weak predictions.

Future roadmap:

- Begin with rule-based early warnings.
- Add predictive models only when enough structured history exists.
- Keep every prediction explainable and confidence-scored.
- Never present a prediction as fact.

### Future Learning Engine

Purpose:

Learn user preferences, repeated project patterns, and organizational behavior so the product becomes more useful over time.

Inputs:

- Approved updates.
- Corrected PIE guesses.
- Preferred projects and areas.
- Preferred recipients.
- Report styles.
- Repeated assistant questions.
- Accepted and rejected recommendations.

Outputs:

- Better defaults.
- Personalized recommendations.
- Repeated issue recognition.
- Preferred communication settings.
- Reduced repeated decisions.

Dependencies:

- User approval history.
- Privacy-aware memory rules.
- Stable local and cloud identity model.

Future roadmap:

- Start with simple remembered preferences.
- Learn only from approved or corrected user actions.
- Keep learning transparent and reversible.
- Separate user preferences from project facts.

### Future Communication Engine

Purpose:

Turn PIE intelligence into stakeholder-ready communication for executives, customers, contractors, safety teams, and internal project teams.

Inputs:

- Project Intelligence Summary.
- PIE Thoughts.
- Project Story.
- Audience context.
- Contacts and recipients.
- Documents.
- Photos.
- Reports/history.

Outputs:

- Executive updates.
- Customer updates.
- Contractor follow-ups.
- Internal PM notes.
- Safety updates.
- Issue escalation drafts.
- Report-ready summaries.

Dependencies:

- Intelligence Engine.
- Reasoning Engine.
- Memory Engine.
- Audience rules.
- Human review workflow.

Future roadmap:

- Add audience-aware communication readiness.
- Track what was sent, copied, or approved.
- Preserve user review before communication leaves the app.
- Add optional AI drafting while keeping facts evidence-backed.

## 6. Project Story

A project is a story, not a collection of updates.

Raw updates say what was captured. Project Story explains what happened, what changed, what matters, what remains unresolved, and what should likely happen next.

PIE continuously builds Project Story by:

- Normalizing raw inputs into evidence.
- Converting evidence into events.
- Using intelligence to evaluate current project state.
- Using reasoning to identify facts, concerns, questions, and recommendations.
- Using memory to compare the current state against the project's history.

Project Story should summarize:

- What happened.
- What changed over time.
- Current phase.
- Major risks.
- Unresolved questions.
- Likely next step.

Project Story should feed Project Assistant, Project Overview, Reports, Morning Brief, future Project Walk, and future predictive signals.

## 7. PIE Thoughts

PIE Thoughts are structured reasoning packets.

They are not chat messages. They are explainable project-management thoughts that can feed the Project Assistant, Reports, Project Overview, and future communication tools.

PIE Thoughts include:

- Evidence: what PIE observed.
- Facts: what PIE can state from evidence.
- Relationships: how facts connect across schedule, updates, photos, areas, people, and history.
- Concerns: what may need attention.
- Questions: what PIE needs the user to confirm when confidence is low.
- Recommendations: what action PIE suggests.
- Communication Insight: what should be communicated and to whom.
- Confidence: how reliable the thought is.

Every PIE Thought should include:

- ID.
- Project name.
- Title.
- Summary.
- Evidence.
- Facts.
- Concern when applicable.
- Question when applicable.
- Recommendation when applicable.
- Confidence.
- Priority.
- Created timestamp.
- Source.

## 8. Explainable Intelligence

Every recommendation must answer:

- Why?
- Evidence?
- Confidence?
- Impact?
- Next Action?

Explainability is required for trust.

PIE should never produce a recommendation that cannot be traced back to evidence, events, intelligence signals, or memory.

Examples:

- "Capture today's progress" should explain whether the last update is stale, missing, or low-confidence.
- "Review overdue schedule items" should identify the overdue count and source schedule data.
- "Confirm detected project area" should explain location confidence and source evidence.
- "Prepare stakeholder update" should explain communication readiness and missing context.

Unknown is better than wrong. If PIE does not have enough evidence, it should say what is missing and recommend how to improve confidence.

## 9. Memory

### Short-term Memory

Short-term memory covers the current session, current draft, last opened project, active project, recent screen context, and the user's immediate workflow.

Purpose:

- Reduce repeated selections.
- Keep capture fast.
- Support current assistant answers.
- Help PIE infer likely project and area.

### Project Memory

Project memory covers durable project history.

Purpose:

- Remember updates, photos, issues, schedule imports, reports, decisions, inspections, safety observations, and assistant interactions.
- Build timeline segments.
- Identify patterns.
- Detect memory gaps.
- Build Project Story.

### Organizational Memory

Organizational memory covers patterns across projects.

Purpose:

- Recognize repeated contractor issues.
- Compare project update cadence.
- Understand common delay causes.
- Improve executive and customer reporting patterns.
- Support portfolio intelligence.

Organizational memory should only be added after project memory is dependable.

### Future Learned Memory

Future learned memory covers user preferences and repeated behavior.

Purpose:

- Remember preferred recipients.
- Learn report style preferences.
- Learn frequently used project areas.
- Learn accepted/rejected recommendations.
- Reduce repeated decisions.

Learned memory must remain transparent, reversible, and based on user-approved behavior.

## 10. Inputs

### Current Inputs

Current PIE inputs include:

- Photos.
- Photo captions.
- Photo categories.
- Photo action required, owner, due date, and status.
- Typed updates.
- Current draft updates.
- GPS metadata on updates and photos.
- Project areas.
- Schedule items.
- Schedule owner, contractor, priority, status, notes, progress, dates, milestones, and import metadata.
- Project data.
- Documents metadata.
- Reports/history metadata where available.
- Contacts and recipients.
- Sync/cloud freshness metadata where available.
- ProjectEvents.
- PIE reasoning and memory outputs.

### Future Inputs

Future PIE inputs include:

- Voice.
- Live GPS and stronger location confidence.
- Weather.
- Calendar.
- Email.
- Messages.
- Meetings.
- Drawings and specifications.
- Contractors and contact roles.
- Inspections.
- Safety observations.
- Equipment and assets.
- External systems.
- Procurement.
- BIM.
- ERP/accounting.
- Customer portals.

### Input Roles

Photos provide visual evidence of field conditions, work progress, issues, safety concerns, and action items.

Voice provides fast natural field observations that should become structured draft updates after review.

Typed Updates provide narrative field history and approved project context.

GPS provides project, area, building, zone, and on-site/off-site signals when confidence is high enough.

Schedule provides deadlines, milestones, overdue work, progress, priority, responsibility, and future risk.

Documents provide drawings, specifications, schedules, revisions, reference context, and current/non-current status.

Reports provide communication history and reveal what has already been summarized for stakeholders.

Calendar provides meetings, inspections, lookahead events, deadlines, and reporting obligations.

Weather provides context for delays, safety risks, exterior work readiness, and field conditions.

Contractors provide responsibility, performance, escalation paths, and repeated issue patterns.

Contacts provide audience context, preferred communication channels, and recipient readiness.

Email provides commitments, approvals, questions, blockers, and follow-ups when integrated later.

Meetings provide decisions, action items, open questions, and stakeholder concerns.

Equipment provides availability, location, readiness, ownership, and blockers.

External Systems provide source-of-truth schedule, procurement, financial, document, and construction-management data when connected later.

## 11. Decision Framework

PIE can decide:

- What evidence exists.
- What facts are supported by evidence.
- What confidence level applies.
- Which risks should be surfaced.
- Which questions need user confirmation.
- Which next action is recommended.
- Whether communication readiness is low, medium, or high.
- Which project or area is likely when confidence is high.
- Which memory gaps are reducing confidence.

PIE must not decide without user approval:

- Save a project update.
- Send stakeholder communication.
- Mark an issue closed.
- Change project schedule commitments.
- Change safety status.
- Archive, delete, or restore a project.
- Commit to a customer, executive, contractor, or inspector.
- Override low-confidence project or area detection.
- Create permanent project history from voice without review.

Decision rule:

PIE may recommend and prepare. The user verifies, corrects, and approves.

When confidence is high, PIE should reduce friction by preselecting or drafting. When confidence is low, PIE should ask a direct question.

### Decision Queue

The Decision Queue is PIE's prioritized list of project-manager actions.

Each decision should include:

- Title.
- Summary.
- Priority.
- Reason.
- Evidence and source.
- Confidence.
- Impact.
- Suggested next action.
- Whether user approval is required.

The queue should merge signals from intelligence, reasoning, memory, project events, risks, concerns, questions, recommendations, schedule status, confidence, and communication readiness.

The queue should prioritize safety, overdue schedule work, stale or missing field updates, low-confidence project context, open decisions, communication readiness, and project-walk opportunities.

### Next Best Action

Next Best Action is the top item in the Decision Queue.

It should answer:

- What should the project manager do next?
- Why does PIE recommend it?
- What evidence supports it?
- How confident is PIE?
- What is the impact?
- Does the user need to approve anything?

Next Best Action should feed:

- Home: one clear recommended action instead of many equal choices.
- Project Overview: project-specific decision guidance.
- Project Assistant: concise answers in project-manager language.
- Reports: communication and escalation decisions.
- Future Project Walk: what to verify while standing in the field.

### PIE Prepares / User Approves

The Decision Engine may recommend:

- Capture today's progress.
- Review overdue schedule items.
- Verify inspection status.
- Generate executive report.
- Send customer update.
- Walk the project.
- Review safety concern.
- Update missing project information.

The Decision Engine must not:

- Send reports automatically.
- Close issues automatically.
- Approve decisions automatically.
- Change project status without user confirmation.

PIE prepares the decision queue. The user decides what to approve, defer, correct, or reject.

## 12. Project Walk

Project Walk is the long-term field vision for PIE.

The user should be able to walk the project while talking naturally with Project Assistant.

Long-term workflow:

1. User arrives at the project.
2. PIE detects likely project and area from GPS, project memory, schedule, and recent activity.
3. User starts Walk the Project.
4. User speaks naturally about what they see.
5. PIE listens for work performed, work in progress, issues, safety observations, inspection status, contractors, blockers, and next actions.
6. PIE compares observations against project memory, schedule, documents, and unresolved questions.
7. PIE prepares a structured field update.
8. User reviews, corrects, and approves.
9. PIE saves the approved update and refreshes Project Story.

Project Walk should feel like walking with an experienced project manager who remembers the history, knows what needs follow-up, and asks only the questions that matter.

Voice must not bypass review. Natural conversation should produce drafts, not automatic commitments.

## 13. JARVIS QA

JARVIS QA is the internal quality system for Project Vision AI.

JARVIS validates:

- UI.
- Logic.
- Reasoning.
- Recommendations.
- Confidence.
- Project Story.
- Workflow.

JARVIS should test the product from the user's point of view:

- Does Home answer what should happen next?
- Do project cards show readable health, schedule, action, and location context?
- Is the primary action obvious?
- Do buttons clip or wrap awkwardly?
- Does Project Assistant answer from PIE?
- Does PIE remain local and rule-based where required?
- Does Project Story explain what happened and what is missing?
- Are recommendations evidence-backed and confidence-scored?

Future JARVIS should validate:

- UI layout across iPhone widths.
- Bottom navigation.
- Capture, Projects, Project Overview, Reports, More/Admin, and Project Assistant.
- PIE logic.
- Project Story quality.
- Memory gap detection.
- Recommendation explainability.
- Release readiness.
- Screenshot baselines.
- Maestro workflow tests.

JARVIS QA should protect the product mission: fast, clear, readable, useful, and guided by practical project intelligence.

## 14. Development Principles

- Evidence before conclusions.
- Never invent facts.
- Unknown is better than wrong.
- Every recommendation has evidence.
- Every recommendation has confidence.
- PIE asks questions only when confidence is low.
- Reduce uncertainty.
- Increase confidence.
- User enters information once.
- PIE creates value many times.
- AI recommends; people decide.
- Human review is required for stakeholder-facing output and project-history changes.
- Location is background intelligence, not a primary workflow.
- Admin, diagnostics, sync, and setup belong in More/Admin.
- Daily workflows should have one clear primary action.
- No external AI calls should be added to local PIE behavior unless explicitly requested.
- No schema changes should be made unless the sprint explicitly requires them.
- Existing capture, reports, sync, storage, and project behavior must be preserved unless a change is requested.

## 15. Five-Year Vision

If every roadmap item succeeds, Project Vision AI becomes the trusted Project Intelligence Operating System for construction, facilities, compliance, and project-management teams.

In five years:

- PIE understands every project continuously.
- Field teams capture updates by walking and talking naturally.
- Project managers receive clear risks, open questions, next actions, and communication drafts before they ask.
- Executives see reliable portfolio intelligence without waiting for manual status assembly.
- Customers receive clearer, more trustworthy updates.
- Contractors and internal teams get action-oriented follow-ups grounded in evidence.
- Project history becomes a living story instead of scattered notes, photos, schedules, and reports.
- The system remembers what happened, what changed, what was decided, what remains unresolved, and what should happen next.
- JARVIS QA protects every release by checking workflows, layout, PIE reasoning, confidence, and Project Story quality.
- External AI augments PIE, but PIE remains the evidence-backed source of truth.

The final product should feel like an experienced project manager is always prepared: aware of the field, aware of the schedule, aware of the risks, aware of history, and careful enough to ask when it is not sure.

Project Vision AI succeeds when project teams see clearly, decide wisely, communicate confidently, and move work forward with less effort.

## 16. PIE Scientific Method

PIE uses the Scientific Method as its thinking foundation.

The cognitive loop is:

```text
Question -> Observe -> Collect Evidence -> Interpret -> Recall Similar Situations -> Generate Hypotheses -> Challenge Hypotheses -> Evaluate Alternatives -> Predict Outcomes -> Select Best Decision -> Explain -> Monitor Result -> Reflect -> Learn
```

The architecture now treats Scientific Method as the bridge between Memory, Deliberation, Reflection, and Core Intelligence.

Important recommendations must include:

- Evidence trace.
- Hypothesis.
- Self-challenge.
- Uncertainty statement.
- Explanation.
- Uncertainty reduction action when confidence is not strong.

PIE should not make important recommendations without evidence, hypothesis, self-challenge, uncertainty statement, and explanation.

Scientific Method adds these architecture responsibilities:

- Uncertainty Reduction: identify what is not known and what evidence would reduce uncertainty.
- Hypothesis Testing: compare multiple possible explanations or actions.
- Self-Challenge: identify what could make PIE wrong, contradicting evidence, the weakest assumption, and what should be verified first.
- Decision Quality: score traceability, hypothesis strength, self-challenge strength, uncertainty reduction, and explanation clarity.

The Cognitive Constitution controls this behavior. The App remains responsible only for capture, review, approval, and display.

## 17. PIE Pattern Intelligence

Pattern Intelligence lets PIE recognize situations it has seen before.

Pattern Intelligence consumes Memory Recall and Reflection context, including prior evidence, lessons learned, user corrections, past recommendations, report history, recurring issues, and historical project events.

Pattern Intelligence detects:

- Recurring Pattern Detection.
- Early Warning Signals.
- Historical Recovery Patterns.
- Failed recommendation patterns.
- Repeated user corrections.
- Missing evidence patterns.

Pattern output feeds Scientific Method, Core Intelligence, and Reporter:

- Scientific Method uses pattern matches in recalled memory, hypotheses, challenges, predictions, and uncertainty reduction actions.
- Core Intelligence exposes patternIntelligence, patternMatches, earlyWarnings, recurringPatterns, patternBasedRecommendations, and patternConfidence.
- Reporter may use pattern context when it improves clarity, but should not overuse history or dump raw pattern analysis into reports.

## 18. PIE Belief And Confidence System

The Belief System transforms evidence, memory, patterns, reflection, and Scientific Method output into explainable beliefs.

PIE separates Evidence vs Belief:

- Evidence is an observed input.
- A belief is PIE's current interpretation of what is probably true.

The Belief System supports:

- Belief Formation.
- Belief Revision.
- Belief Readiness.
- Belief Explainability.
- Supporting evidence and contradicting evidence.
- Weakest assumption detection.
- Belief strengthening, weakening, challenging, retiring, and verification.

Scientific Method hypotheses can become beliefs. Pattern Intelligence can strengthen or weaken beliefs. Memory Recall can retrieve prior related beliefs. Reflection produces belief changes and lessons.

Core Intelligence exposes beliefs, beliefChanges, strongestBeliefs, challengedBeliefs, beliefsNeedingVerification, beliefReadiness, and beliefExplanations.

Attention should prioritize high-impact beliefs with low readiness. Experience should ask users to verify weak beliefs. Reporter should use beliefs to improve narrative clarity without presenting beliefs as final truth.

## 19. PIE Executive Reasoning

Executive Reasoning teaches PIE to think like an executive instead of a data summarizer.

Executive Reasoning determines:

- Executive Judgment.
- Executive Risk.
- Executive Priorities.
- Executive Decision Needs.
- Executive Opportunities.
- Executive Concerns.
- Executive Tradeoffs.
- Highest-Value Action.
- Executive Briefing Points.
- Executive Readiness.

Decision Scoring evaluates expected value, risk reduction, uncertainty reduction, schedule impact, safety impact, communication impact, effort level, readiness, and why recommended.

Executive Reasoning consumes Belief Engine output, including strongest beliefs, challenged beliefs, beliefs needing verification, belief readiness, and contradicting evidence. It also consumes Pattern Intelligence, Memory Recall, Scientific Method, and Deliberation so executive judgment is grounded in recurring patterns, historical lessons, hypotheses, alternatives, tradeoffs, uncertainty, and decision quality signals.

Core Intelligence exposes executiveReasoning, executivePriorities, biggestRisk, highestValueAction, decisionsNeeded, executiveBriefingPoints, and executiveReadiness.

Attention should prioritize the biggest executive risk. Experience should use the highest-value action. Reporter should use Executive Reasoning to improve executive summaries, confidence wording, action recommendations, and review warnings without exposing raw internal reasoning.

## 20. PIE Predictive Simulation

Predictive Simulation teaches PIE to simulate what may happen next.

Predictive Simulation supports:

- Scenario Analysis.
- No-Action Simulation.
- Best Case Simulation.
- Most Likely Simulation.
- Worst Case Simulation.
- Cascading Impact detection.
- Schedule impact prediction.
- Inspection impact prediction.
- Contractor impact prediction.
- Dependency awareness.
- Recovery Planning.

Dependencies include schedule predecessor/successor, inspection dependency, contractor dependency, material dependency, approval dependency, safety dependency, and evidence dependency.

Predictive Simulation consumes Runtime, schedule intelligence, graph gaps and blocked relationships, beliefs and belief readiness, recurring patterns, Scientific Method hypotheses and uncertainty, Deliberation alternatives and tradeoffs, and Executive Reasoning where available.

Core Intelligence exposes predictions, mostLikelyOutcome, bestCaseOutcome, worstCaseOutcome, noActionOutcome, cascadingImpacts, recoveryActions, and predictionConfidence.

Executive Reasoning should account for predicted schedule impact, risk propagation, recovery action value, and no-action consequence when choosing the highest-value action.

Attention should elevate high-impact predictions. Experience should prioritize urgent predicted risks when confidence is strong enough. Reporter should mention predicted impact only when evidence is strong and should avoid overstating weak predictions.

## 21. PIE Continuous Learning

Continuous Learning teaches PIE to improve over time.

Learning is not project analysis. Learning evaluates whether PIE's behavior improved after user corrections, report approvals, report edits, recommendation outcomes, prediction outcomes, Reflection lessons, pattern matches, schedule changes, photo evidence, GPS corrections, and decision outcomes.

Continuous Learning supports:

- Learning Signals.
- Learning Events.
- Outcome-Based Learning.
- Confidence Calibration.
- Pattern Updates.
- Belief Updates.
- Recommendation Improvements.
- Memory Consolidation.
- Future Adjustments.
- Decision Quality Learning.
- Report Style Learning.

Architecture sequence:

Evidence
-> Evidence Fusion
-> Knowledge Graph
-> Reflection
-> Learning
-> Memory
-> Patterns
-> Beliefs
-> Prediction
-> Core Intelligence
-> Experience
-> Reporter
-> App

Continuous Learning consumes Reflection, Runtime, Belief, Pattern, Prediction, Executive Reasoning, and Reporter context. It feeds Memory Recall, Pattern Intelligence, Belief System, Prediction, Core Intelligence, and Reporter.

Core Intelligence exposes learningResult, learningSignals, lessonsLearned, confidenceCalibration, futureAdjustments, memoryConsolidation, and decisionQualityLearning.

Reporter may use Continuous Learning to improve report style, confidence wording, review warnings, action recommendations, and David-style phrasing. Reporter must not expose raw learning internals in the email body by default.

PIE should learn only from evidence, corrections, approvals, edits, outcomes, and Reflection lessons. It should not invent learning.

## 22. PIE Decision Intelligence Advancement

Decision Intelligence improves PIE's ability to test competing interpretations and alternatives before important recommendations reach the user.

Architecture sequence:

Evidence
-> Authoritative Reality Model
-> Executive Judgment
-> Decision Simulation
-> Recommendation Challenge
-> JARVIS Reasoning Validation
-> Confidence Decomposition
-> Evidence Value Prioritization
-> Attention / Experience / Reporter
-> User

Decision Simulation evaluates credible options, including the recommended action, a real alternative, no action, delay-and-gather-evidence, and escalation when authority or risk requires it. Each option preserves expected outcome, prerequisites, impacts, assumptions, risks, uncertainty, authority, scenario results, scoring components, sensitivity analysis, and provenance. Longitudinal Photo Intelligence enters the simulation as qualified photo progress events, conflicts, and estimates; visual evidence can lower confidence or trigger a targeted evidence request, but it cannot prove completion by itself.

Recommendation Challenge must state the strongest argument against the preferred option, identify disconfirming evidence, review stakeholders and dependencies, test implementation failure, compare no-action and delay, enforce authority boundaries, detect overstated confidence, challenge visual evidence overinterpretation, test whether a different reasonable assumption changes the answer, and record whether the preferred option changed.

JARVIS Reasoning Validation is a rule-based release gate. It validates Reality authority, evidence traceability, assertion classification, fact support, conflicts, uncertainty disclosure, option completeness, no-action, tradeoffs, score and simulation reproducibility, sensitivity, authority boundaries, robustness, photo-evidence interpretation, causal reasoning, challenge completeness, explanation quality, fabricated-fact prevention, hidden assumptions, and consistency between PIE's recommendation and the user-facing summary.

Confidence Decomposition breaks recommendation confidence into evidence, Reality Model, identity, causal, forecast, option-comparison, execution, outcome-measurement, and overall recommendation confidence. PIE must explain the weakest component rather than imply false precision.

Evidence Value Prioritization ranks missing evidence by decision value and returns one highest-value evidence request first. PIE should not present a generic checklist when one targeted evidence request will reduce the most uncertainty.

Normal UI must not expose buttons for simulation, challenge, JARVIS validation, confidence recalculation, forecast refresh, option comparison, or evidence linking. These steps run automatically in the background and only surface one recommendation, the important uncertainty, and the next useful action.

## 23. Longitudinal Photo Intelligence

PIE reviews project photos over time as an automatic intelligence layer behind ECOS.

Architecture sequence:

Photo evidence + metadata + Reality Model + schedule/action/issue context
-> PIEPhotoProgressIntelligence
-> Photo Sequences
-> Comparability Assessment
-> Conservative Progress Events
-> Visual JARVIS Validation
-> Qualified Reality Evidence
-> Core / Executive Judgment / Predictions / Experience
-> User

Longitudinal Photo Intelligence groups photos into stable sequences by organization, project, building, area, room, Reality Object, subject, approximate viewpoint, and capture date. PIE must not compare two images merely because they belong to the same project.

Comparability is classified as strong match, probable match, weak match, or not comparable. Weak and non-comparable images do not create confident progress claims.

Original photos are never modified. Normalization operations are recorded as derived analysis metadata only.

Photo progress records separate:

- Observation: what is directly visible or supported by photo metadata and captions.
- Inference: what the observation may mean.
- Verification status: whether completion is supported by photos, inspection evidence, project update, schedule status, action-item closure, or human confirmation.

Completion, regression, and safety claims require corroboration or human/JARVIS validation. Photo evidence never silently overrides inspections, documents, schedules, or human-confirmed records. Conflicts become uncertainty or review items.

Photo progress enters Reality only as qualified visual observations through the established Layer 1-to-Reality evidence path. The photo-analysis service does not mutate Reality Objects directly.

Capture may show repeat-photo guidance only when a comparable update has high evidence value. Home may show one concise progress card when PIE has a useful visual signal. Normal UI must not expose internal controls such as Compare Photos, Analyze Progress, Run Visual Review, Calculate Progress, or Validate Image.
