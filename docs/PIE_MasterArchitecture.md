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

## 4. Cognitive Architecture

PIE should process project reality through a transparent cognitive flow:

```text
Raw Inputs
  |
  v
Evidence Engine
  |
  v
Event Engine
  |
  v
Intelligence Engine
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
Project Story
  |
  v
Decision Queue / Next Best Action
  |
  v
Project Assistant
  |
  v
Reports
  |
  v
User
```

This flow keeps PIE explainable. Raw inputs should become evidence before they become facts. Facts should become events before they become intelligence. Intelligence should become reasoning before it becomes recommendations. Memory should turn repeated events and thoughts into a project story. The Decision Engine should prioritize what the project manager should do next. The Project Assistant and Reports should present that intelligence in project-manager language.

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
