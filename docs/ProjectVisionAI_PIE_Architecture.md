# Project Vision AI PIE Architecture

## Purpose

PIE stands for Project Intelligence Engine.

PIE is the intelligence foundation for Project Vision AI. It organizes project data into useful, structured intelligence that can later power Project Overview, the Project Assistant, Reports, recommendations, Morning Briefs, Customer Updates, and Executive Updates.

PIE exists to help Project Vision AI transform project information into decisions.

## What PIE Is

PIE is the brain of Project Vision AI.

It is a structured intelligence layer that reviews project data, evaluates project condition, identifies risks, measures confidence, and recommends useful next actions.

PIE should:

- Summarize project status.
- Evaluate health signals.
- Detect schedule and update risks.
- Measure project-context confidence.
- Recommend the next useful action.
- Estimate communication readiness.
- Prepare structured intelligence for product surfaces.

PIE should begin with rule-based logic and become more intelligent over time.

## What PIE Is Not

PIE is not a chatbot.

PIE is not a replacement for existing AI analysis.

PIE is not a new database schema.

PIE is not a user-facing page by itself.

PIE is not an uncontrolled automation layer that makes decisions without review.

PIE should organize intelligence. The Project Assistant, Project Overview, Reports, and communication tools can use that intelligence to help people act.

## Relationship Between Project Vision AI, PIE, Project Assistant, and Internal JARVIS QA

Project Vision AI is the overall product: an AI-powered Project Operating System for capturing project reality, understanding project status, making better decisions, and communicating progress.

PIE is the internal intelligence engine. It analyzes available project data and returns structured project intelligence.

The Project Assistant is the user-facing assistant experience. It should use PIE output to recommend actions, prepare communication, remember project history, and help users understand project status.

Internal JARVIS QA is the testing and diagnostic vision for the application. It should validate that Project Vision AI remains functional, useful, fast, and aligned with product standards. JARVIS QA tests the product; PIE powers product intelligence.

These systems should remain distinct:

- Project Vision AI is the product.
- PIE is the intelligence engine.
- Project Assistant is the user-facing assistant.
- JARVIS QA is the internal quality and diagnostic system.

## PIE Data Inputs

Initial PIE inputs should come from existing local app data.

Current data inputs:

- Project name
- Saved project updates
- Current draft update when available
- Photos
- Photo categories
- Photo action information
- Schedule items
- Schedule status
- Schedule progress
- Schedule finish dates

Future data inputs:

- Reference documents
- Imported schedule documents
- Contacts and preferred recipients
- Project areas and location confidence
- Weather
- Contractor data
- Customer communication history
- Cloud sync freshness
- AI-derived summaries
- User preferences and repeated behavior patterns

## PIE Input Roadmap

PIE should become more useful by using existing app data more deeply before adding new integrations such as voice, weather, calendar, email, or external project-management systems.

### Currently Available Inputs

- Photos: photo count, captions, categories, action required, action owner, action due date, action status, selected area, and captured GPS metadata.
- Typed updates: notes, update date, project name, selected area, recipients, photos, and draft update context.
- Schedule items: task name, project name, location, start date, finish date, milestone, owner, contractor, priority, status, progress, notes, import source, and import date.
- Project data: project name, active/archive state, favorite state, local list membership, and cloud project row metadata where available.
- Project areas: area name, building, radius, saved GPS point, selected update area, and selected photo area.
- Documents: reference document name, original file name, category, notes, current/non-current status, import date, and schedule document category.
- Reports/history: saved update history, generated report surfaces, recent project activity, and saved communication context when available.
- Sync/cloud metadata: Supabase configuration, queued sync changes, sync conflicts, last sync time, cloud row timestamps, and upload/download status when available.
- Contacts/recipients: contact names, selected emails/phones, recipient selections on updates, and repeated recipient patterns.

### Partially Available Inputs

- GPS and project areas are captured, but PIE still needs stronger location confidence, project-area matching, and area-based risk grouping.
- Photo captions and action details are stored, but PIE should use them more directly for risk, ownership, due-date, and communication-readiness signals.
- Typed notes are stored, but PIE should extract stronger narrative, issue, blocker, and work-performed signals over time.
- Schedule owner, contractor, priority, and notes are stored, but PIE should use them to assign urgency and responsibility.
- Contacts and recipients are stored, but PIE should become audience-aware for customer, executive, contractor, and internal communications.
- Reference documents are stored as metadata, but PIE does not yet parse document contents or compare field activity against drawings and specifications.
- Report outputs exist as product surfaces, but report history is not yet a durable structured input.
- Sync state exists, but PIE needs a stable sync freshness input to evaluate whether intelligence is based on current local/cloud data.

### Future Strategic Inputs

- Voice: natural field observations that can become structured updates after user review.
- Live GPS/location confidence: project and area detection based on where the user is standing.
- Weather: project conditions that explain delays, unsafe work, or exterior-work readiness.
- Calendar: meetings, inspections, deadlines, lookahead events, and reporting obligations.
- Email/messages: commitments, approvals, stakeholder questions, blockers, and unanswered follow-ups.
- Drawings/specifications: parsed requirements, revisions, details, and inspection references.
- Contractors/contacts: company roles, responsibility history, preferred communication channels, and escalation paths.
- Inspections: requested, scheduled, passed, failed, and blocking inspection outcomes.
- Safety observations: hazard type, severity, corrective action, owner, and closure status.
- Equipment/assets: availability, location, ownership, readiness, and blockers.
- External systems: Procore, Primavera P6, Microsoft Project, BIM, ERP/accounting, procurement, and customer portals.

### Recommended Implementation Order

1. Enrich the PIE input contract with optional existing app data: project areas, contacts, reference documents, report/history metadata, and sync freshness.
2. Use current data more deeply: typed notes, photo captions, photo actions, action owners, action due dates, schedule owner, contractor, priority, and schedule notes.
3. Add source attribution and confidence metadata to every major PIE signal so Project Overview, Project Assistant, and Reports can explain why a recommendation exists.
4. Connect enriched PIE output to Project Overview and Project Assistant without changing their core layouts.
5. Add project-area and GPS confidence using existing selected-area and captured-location fields.
6. Add audience-aware communication readiness from recipients, contacts, documents, and report history.
7. Add voice capture only after the review-and-approve workflow is dependable.
8. Add weather, calendar, email/messages, document parsing, inspections, equipment/assets, and external systems as optional integrations.
9. Add learning behavior after enough structured usage history exists.

### Architecture Gaps

- Project identity still relies heavily on project name matching. PIE should eventually use stable project IDs across local and cloud data.
- There is no unified project event history that captures updates, photos, reports, sync events, inspections, communication, and assistant actions in one timeline.
- Project areas are not fully project-scoped and need stronger ownership, confidence, and relationship metadata.
- Reference documents do not yet have parsed text, page metadata, revision metadata, or structured links to project areas and schedule items.
- Reports are not yet saved as durable structured communication history.
- Sync freshness is not yet passed through as a consistent PIE input.
- Risks, action items, safety observations, and inspections are still mostly embedded in photos, updates, or schedules instead of first-class intelligence records.
- PIE signals need source attribution, confidence, and evidence fields so user-facing recommendations remain transparent.
- Future voice and AI interpretation will need transcript, review, approval, and audit history so field updates are never saved automatically without user confirmation.

## ProjectEvent Layer

The ProjectEvent layer is PIE's durable project memory concept.

ProjectEvents translate raw app records into a shared timeline that PIE can reason over. Instead of every intelligence surface separately reading updates, photos, schedules, reports, assistant actions, and sync state, PIE can first normalize those records into project events and then evaluate the story of the project.

### ProjectEvent Concept

A ProjectEvent represents something meaningful that happened on a project.

Supported event types include:

- update_created
- photo_added
- schedule_imported
- schedule_item_overdue
- report_generated
- assistant_interaction
- project_created
- project_archived
- project_restored
- sync_completed
- issue_created
- issue_closed
- safety_observation
- inspection_event
- decision_recorded

Each event should carry:

- Stable event identity
- Project identity when available
- Project name
- Event type
- Title and description
- Occurrence timestamp
- Source
- Confidence
- Related area
- Related people
- Related documents
- Metadata

The first version derives ProjectEvents from existing local data only. It does not require new Supabase schema, new packages, or external AI calls.

### Why PIE Needs Event Memory

Project intelligence needs to understand history, not only the current screen.

Event memory allows PIE to answer questions such as:

- What changed recently?
- What is the latest meaningful project activity?
- Has an issue been created or closed?
- Are there open decisions that need follow-up?
- Was schedule information imported?
- Was a report generated?
- Is project confidence improving because more history is available?

This keeps PIE focused on project reality and makes Project Overview, Project Assistant, Reports, and future briefs more consistent.

### How Events Support Project Story

Project Story is a concise narrative built from ProjectEvents.

It should summarize:

- Recent project activity
- Key changes
- Open decisions
- Issue and safety movement
- Schedule events
- Report and assistant activity
- Event counts and timeline coverage

Project Story should help the user quickly understand what has happened, what still needs attention, and what PIE is basing its recommendations on.

### Future Path To Persistent Event Storage

The current ProjectEvent layer is derived in memory from existing app data.

Future persistent storage should:

- Store ProjectEvents as first-class records.
- Preserve event IDs, source, confidence, metadata, and related entities.
- Use stable project IDs instead of project-name matching where possible.
- Keep an audit trail for assistant interactions, decisions, inspections, safety observations, and sync events.
- Allow PIE to reason across long-term project history without re-deriving every event from raw records.
- Support cloud sync only after the local event model is stable.

Persistent event storage should be additive. It should not replace existing updates, photos, schedules, documents, or reports; it should connect them into a durable intelligence timeline.

## PIE Cognitive Architecture

PIE should reason in a transparent sequence:

Evidence -> Facts -> Relationships -> Concerns -> Questions -> Recommendations -> Communication Insight.

This sequence keeps PIE explainable. It allows the app to show what PIE saw, what it believes is true, what relationships matter, what may need attention, what question should be answered, and what action should be considered next.

The first reasoning version remains local and rule-based. It does not use external AI calls, new packages, or new database schema.

### PIE Thought Model

A PIE Thought is a structured reasoning unit.

Each PIE Thought should include:

- Stable thought identity
- Project name
- Title
- Summary
- Evidence
- Facts
- Concern when applicable
- Question when applicable
- Recommendation when applicable
- Confidence
- Priority
- Created timestamp
- Source

PIE Thoughts are not chat messages. They are project-management reasoning packets that can feed Project Overview, Project Assistant, Reports, Morning Briefs, and future communication tools.

### Explainable Intelligence

Every PIE recommendation should be able to answer:

- Why is this recommended?
- What evidence supports it?
- How confident is PIE?
- What is the project impact?
- What next action should the user consider?

Explainability protects trust. PIE should never present a recommendation as magic. It should connect recommendations back to project events, field updates, photos, schedules, document metadata, and Project Intelligence Summary signals.

### How Project Events Feed PIE Thoughts

ProjectEvents provide the memory layer for reasoning.

PIE Thoughts can use ProjectEvents to understand:

- Recent activity
- What changed
- Issue creation and closure
- Safety observations
- Schedule imports and overdue schedule events
- Report generation
- Assistant interactions
- Decisions that remain open

ProjectEvents give PIE a timeline. PIE Thoughts turn that timeline into meaning.

### How PIE Thoughts Feed Project Assistant and Reports

Project Assistant should use PIE Thoughts to answer project questions with project-manager judgment instead of raw data dumps.

Examples:

- "What needs attention?" can use concern-backed thoughts.
- "What changed recently?" can use event-backed thoughts.
- "What should I tell my boss?" can use communication insight and recommendation-backed thoughts.
- "What is behind schedule?" can use schedule relationship thoughts.

Reports should use PIE Thoughts to prepare concise summaries with clear rationale. A report should be able to include evidence, facts, concerns, open questions, recommended next action, and communication readiness without re-deriving the logic in the report screen.

## PIE Memory Engine

The PIE Memory Engine is the first project-history layer above ProjectEvents and PIE reasoning.

It should help PIE understand how a project has changed over time instead of only answering from the current status snapshot. The first version is local and rule-based. It does not add Supabase schema, external AI calls, packages, or new UI requirements.

### Project Story

Project Story is the memory-level summary of a project.

It should explain:

- What happened
- What changed over time
- Current project phase
- Major risks
- Unresolved questions
- Likely next step

Project Story should use ProjectEvents, PIE Thoughts, Project Intelligence Summary, updates, photos, schedules, documents, and report history when available.

### Memory Gaps

Memory Gaps identify missing history that prevents PIE from understanding the project confidently.

Initial gaps include:

- No recent updates
- No schedule imported
- No photos
- Missing inspection status
- Missing document context
- No report history

Memory Gaps should produce clear impact and suggested action fields so Project Assistant and Reports can explain what is missing without blaming the user.

### Timeline Segments And Patterns

The Memory Engine should group available project history into timeline segments and identify recurring patterns.

Timeline segments help PIE answer when things happened. Patterns help PIE answer whether something is isolated or recurring.

Initial patterns can include:

- Recurring open issues
- Safety follow-up
- Schedule slippage
- Waiting work
- Photo-driven action tracking
- Active capture rhythm
- Reporting history

### Memory Insights

Memory Insights turn project history, gaps, and patterns into useful project-management interpretation.

Examples:

- Project memory points to risk follow-up.
- Memory gaps are limiting confidence.
- Memory can support communication.
- Timeline and patterns are forming project memory.

Each insight should include why it matters, suggested next action, source, confidence, priority, and links back to supporting patterns, gaps, or events.

### How Memory Supports Future Prediction

Future prediction should come after memory is dependable.

PIE can only forecast responsibly when it understands history: update cadence, repeated issue types, schedule movement, safety recurrence, inspection outcomes, document freshness, and reporting cadence.

Memory does not predict by itself in the first version. It prepares the structured historical foundation that future predictive logic can use.

### How Memory Supports Project Assistant, Reports, And Walk The Project

Project Assistant should use memory to answer questions with historical context:

- What changed over time?
- Is this a recurring issue?
- What is missing from the project record?
- What should happen next based on history?

Reports should use memory to explain current status in context, not just list current metrics.

Walk the Project should eventually use memory to guide field review. It can remind the user of open gaps, unresolved questions, overdue work, missing inspection status, and areas where the project record has not been updated recently.

## PIE Location Intelligence

Location is not a primary user workflow. ProjectVisionAI users think in projects, updates, and decisions; PIE should think in project areas, GPS context, and location confidence in the background.

The first location intelligence layer should turn existing app data into a structured project location read:

- Current Area
- GPS Status
- Last Known Location
- On Site / Off Site / Unknown
- Location Confidence
- Source evidence
- Confirmation prompt when confidence is not high

### Inputs

PIE Location Intelligence should use existing local data only:

- Selected project area on saved updates.
- Selected project area on photos.
- GPS coordinates and captured-at metadata on updates and photos.
- Distance from selected project area when available.
- Project Area configuration from More -> Admin -> Project Areas.
- Schedule item location names when update/photo location is missing.

### Product Rule

The app should not require the user to manually select Locations as a daily workflow. Manual Project Area setup belongs in More -> Admin -> Project Areas, and manual correction should appear only when PIE confidence is low or the user chooses to correct the detected area.

When confidence is not high but PIE has a plausible area, the app should ask for review instead of silently trusting the guess:

> I believe you're at Building 2375 - Canopy B. Is that correct?

### How Location Improves PIE

Location intelligence supports:

- Active project detection when no explicit project is selected.
- Area detection for Capture Update and Project Walk.
- Project Overview context so recommendations include where the work is happening.
- Project Assistant answers that can explain whether location confidence is strong or needs confirmation.
- Future Walk the Project guidance by matching where the user is standing to open risks, missing updates, and unresolved questions for that area.

### Future Path

Future versions should persist location confidence history, map project areas to projects more explicitly, and compare live GPS against project area boundaries. This should happen after the current rule-based layer is stable and after users can review or correct low-confidence location guesses.

## PIE Processing Stages

### 1. Project Data Selection

PIE first selects data related to the project being analyzed. It should match project updates, schedule items, and current draft content to the project name.

### 2. Data Normalization

PIE should normalize dates, schedule progress, action status, photo counts, and missing values into predictable structures.

### 3. Signal Extraction

PIE should extract meaningful project signals, including:

- Last update
- Update count
- Photo count
- Open issue count
- Safety concern count
- Overdue schedule items
- Upcoming schedule items
- Average schedule progress
- Schedule availability
- Recent activity

### 4. Health Evaluation

PIE should evaluate project health using rule-based logic at first. It should consider update cadence, schedule risk, safety concerns, open issues, progress, and available project context.

### 5. Risk Evaluation

PIE should identify actionable risks such as stale updates, missing schedule data, overdue schedule work, open safety concerns, and insufficient project context.

### 6. Confidence Evaluation

PIE should measure how complete the app's project understanding is. Confidence is not the same as project health. A project can be healthy with low data confidence or risky with high data confidence.

### 7. Recommendation Selection

PIE should recommend action-oriented next steps. Recommendations should help the project manager decide what to do next, not merely describe observations.

### 8. Communication Readiness

PIE should estimate whether there is enough project context to produce useful communication for executives, customers, contractors, or internal teams.

## PIE Outputs

Initial PIE output should be a structured Project Intelligence result.

Core outputs:

- Project Intelligence Summary
- Project Health Signal
- Project Risk Signals
- Project Recommendations
- Project Confidence Signal
- Project Communication Readiness
- Project Next Action

These outputs should be stable enough for Project Overview, Reports, the Project Assistant, and Morning Brief to consume later.

## Initial Rule-Based Evaluation

The first PIE version should evaluate:

- Project name
- Health status
- Schedule status
- Progress status
- Last update
- Photo count
- Update count
- Overdue schedule items
- Upcoming schedule items
- Confidence score
- Recommended next action
- Communication readiness

No external AI calls should be used in the first version.

## Future Roadmap

### Phase 1: Foundation

- Create rule-based project intelligence.
- Define stable TypeScript result types.
- Keep PIE independent from UI.
- Preserve all existing app behavior.

### Phase 2: Product Integration

- Feed Project Overview with PIE output.
- Feed Home Morning Brief with PIE output.
- Feed Reports with PIE summary and readiness signals.
- Feed Project Assistant recommendations with PIE next actions.

### Phase 3: Communication Intelligence

- Use PIE to prepare executive, customer, contractor, safety, and internal project update inputs.
- Track whether communication outputs have enough project context.
- Surface missing information before generating stakeholder updates.

### Phase 4: Learning and Automation

- Learn preferred update cadence, recipients, report styles, project areas, and recurring issues.
- Reduce repeated user decisions over time.
- Recommend actions proactively while preserving human approval.

### Phase 5: AI-Augmented PIE

- Add optional AI interpretation on top of rule-based PIE output.
- Keep rule-based results as the dependable baseline.
- Require human review for stakeholder-facing outputs and project commitments.
