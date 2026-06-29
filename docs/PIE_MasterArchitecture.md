# PIE Master Architecture

## 1. Vision

PIE stands for Project Intelligence Engine.

PIE is the intelligence layer that understands projects, reasons about them, remembers them, and helps project managers make better decisions.

The mobile app exists primarily to collect information for PIE and present PIE's intelligence back to the user.

Project Vision AI is not only a project update app, a photo log, a reporting tool, or a chatbot. It is an AI-powered Project Operating System whose central product asset is PIE.

PIE should become the place where project reality is captured, normalized, remembered, explained, and turned into practical next actions.

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

### PIE

PIE is the intelligence system.

PIE acts as the project manager, reasoning layer, and project understanding engine inside the product. It observes project evidence, converts that evidence into structured understanding, reasons about concerns and decisions, remembers project history, builds the Project Story, recommends next actions, and prepares communication.

PIE owns project intelligence. It should answer what is known, what changed, what is concerning, what is recommended, what evidence supports that recommendation, what is unknown, and what needs user approval.

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

PIE should process project reality through a transparent cognitive flow:

```text
Raw Inputs
  |
  v
Evidence Engine
  |
  v
Knowledge Graph
  |
  v
Reasoning Engine
  |
  v
Memory Engine
  |
  v
Decision Engine
  |
  v
Behavior Layer
  |
  v
PIE Executive
  |
  v
Mission Engine
  |
  v
PIE Reflection
  |
  v
PIE Runtime
  |
  v
Conversation Engine
  |
  v
Product Surfaces
  |
  v
User
```

This flow keeps PIE explainable. Raw inputs should become evidence before they become facts. The Knowledge Graph should connect evidence, events, areas, people, schedule items, documents, issues, decisions, recommendations, and unknowns so PIE can reason about relationships instead of isolated records. Reasoning should turn evidence into facts, concerns, questions, and recommendations. Memory should turn repeated events and thoughts into a project story. The Decision Engine should prioritize candidate actions. The Behavior Layer should decide whether PIE should monitor, brief, ask, recommend, escalate, prepare, wait, or learn. PIE Executive should decide what deserves management attention. The Mission Engine should decide what PIE is trying to accomplish right now so every recommendation, briefing, walk, report, and question supports a clear purpose. PIE Reflection should audit Mission, Executive, Runtime, and other PIE output for weak evidence, missing support, confidence problems, and verification needs before product surfaces overstate certainty. The PIE Runtime should become the single UI-facing orchestration layer that turns all engine output into one unified state. The Conversation Engine should express that Runtime-backed state in concise project-manager language for Home, Project Overview, Project Assistant compatibility, Reports, and future Project Walk. Product surfaces should present that intelligence in project-manager language.

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
