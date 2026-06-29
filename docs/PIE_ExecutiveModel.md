# PIE Executive Model

## Purpose

PIE Executive is the management layer that decides what deserves attention across projects.

It reviews PIE Runtime, Behavior, Decision, Memory, Knowledge Graph, Reasoning, Events, and Intelligence outputs and turns them into a concise senior project-management brief.

PIE Executive answers:

- What deserves attention now?
- Which projects should be prioritized?
- What should be prepared for the user?
- What should be escalated?
- What should wait?
- What does PIE need from the user?

## What PIE Executive Is

PIE Executive is a senior project-management layer.

It is designed to sit above project-level intelligence and portfolio-level signals. It does not capture field evidence directly. It reviews existing PIE output and decides what matters most.

PIE Executive should behave like an experienced project manager scanning the current state of work:

- It looks for safety concerns.
- It checks schedule blockers.
- It reviews missing inspections.
- It watches communication readiness.
- It notices stale updates.
- It weighs trust, understanding, and confidence.
- It identifies decisions needing user approval.
- It prepares the next useful project-management action.

## What PIE Executive Is Not

PIE Executive is not a chatbot.

PIE Executive is not a replacement for PIE Runtime, Behavior, Decision, Memory, Reasoning, or Knowledge Graph.

PIE Executive is not an automation layer that sends reports, closes issues, approves decisions, changes project status, or communicates with stakeholders without the user.

PIE Executive should not create unsupported facts. It must work from existing PIE outputs and preserve user approval boundaries.

## Daily Operating Cycle

PIE Executive should operate as a daily management loop:

1. Review current Runtime state.
2. Check Behavior state and Attention Score when available.
3. Review Decision Queue and approval-required items.
4. Review Memory for stale updates, recurring patterns, and unresolved questions.
5. Review Knowledge Graph for blockers, missing evidence, area-linked risks, and connected recommendation evidence.
6. Rank project priorities.
7. Identify escalations.
8. Prepare reports, updates, or Project Walk prompts for user review.
9. Ask only useful questions.
10. Keep low-value items quiet.

## Operating Modes

### morning_brief

Use when the user starts the day or opens the app in the morning.

Goal: show the highest-priority project work, current confidence, and what PIE needs from the user.

### active_project_review

Use when a project has a critical or high-priority item.

Goal: focus the user on the project that needs management attention now.

### project_walk_prep

Use when PIE sees location uncertainty, area-linked risks, stale evidence, open safety concerns, or field verification needs.

Goal: prepare Project Walk prompts for review.

### executive_meeting_prep

Use when executive communication is ready or needed.

Goal: prepare an executive brief for user approval.

### customer_update_prep

Use when customer-impacting risk, readiness, or communication need exists.

Goal: prepare a customer update for user approval.

### end_of_day_review

Use when the day is closing and unresolved questions, updates, decisions, or communication needs remain.

Goal: summarize what still needs review before the next work period.

### monitor

Use when PIE does not see urgent or meaningful action.

Goal: stay quiet while continuing to update intelligence.

## Priority Model

PIE Executive ranks priorities by management attention value.

Priority factors:

- Critical safety concerns.
- Critical schedule blockers.
- Overdue inspections.
- Customer-impacting risks.
- Executive-report readiness.
- Missing recent updates.
- Low Trust Score.
- Low Understanding Score.
- High Attention Score when available.
- Open decisions requiring approval.
- Communication readiness.
- Project Walk need.
- Missing evidence that blocks confidence.

Each priority should include:

- Project name.
- Title.
- Summary.
- Priority level.
- Attention Score.
- Confidence.
- Sources.
- Evidence.
- Recommended action.
- Whether user approval is required.
- Whether it should be prepared or escalated.

## Escalation Model

PIE Executive should escalate only when attention is genuinely warranted.

Escalations require:

- Clear reason.
- Evidence.
- Urgency.
- Confidence.
- Recommended user action.
- User approval boundary.

Escalation examples:

- Open safety concern.
- Critical schedule blocker.
- Customer-impacting delay.
- Missing inspection tied to active work.
- High-risk item with no owner.
- Trust or Understanding Score dropping low.
- Knowledge Graph blocked item relationship.

## Preparation Model

PIE Executive should prepare useful work, not complete it automatically.

Preparation examples:

- Executive brief.
- Customer update.
- Project Walk prompt set.
- Field update review.
- Decision review.

Preparation output should include:

- Purpose.
- Audience or workflow.
- Evidence.
- Confidence.
- Suggested next action.
- User approval requirement.

## User Approval Rule

PIE prepares; the user approves.

PIE Executive must never automatically:

- Send reports.
- Send customer updates.
- Close issues.
- Approve decisions.
- Change project status.
- Commit schedule changes.
- Mark safety or inspection items complete.

Any action affecting stakeholders, safety, schedule, project status, communication, or commitments requires user review and approval.

## System Connections

### Runtime

Runtime provides the current UI-facing understanding of project reality.

PIE Executive consumes Runtime state, Runtime response, Trust Score, Understanding Score, Preparedness Score, recommendations, unknowns, graph outputs, and current priorities.

Runtime remains the UI contract. PIE Executive should feed Runtime or briefing surfaces in a future integration sprint.

### Behavior

Behavior Model defines when PIE should monitor, brief, ask, recommend, escalate, prepare, wait, or learn.

PIE Executive can use Behavior state and Attention Score when available to decide whether an item deserves management attention.

### Decision

Decision Engine provides candidate decisions and next actions.

PIE Executive ranks those decisions across projects, identifies approval-required decisions, and decides which decisions belong in escalations or preparations.

### Memory

Memory Engine provides Project Story, stale update signals, recurring patterns, unresolved questions, and historical context.

PIE Executive uses Memory to avoid repeating stale recommendations and to identify patterns that deserve attention.

### Knowledge Graph

Knowledge Graph provides relationship-based intelligence.

PIE Executive uses graph relationships to identify blockers, missing evidence, recommendation support, area-linked risks, and items tied to people, contractors, documents, reports, or schedule work.

### Conversation

Conversation should use PIE Executive output to produce concise user-facing briefings.

PIE Executive is not the conversation itself. It decides what matters; Conversation explains it clearly.

### JARVIS

JARVIS should validate PIE Executive behavior.

Checks should confirm:

- Priorities are evidence-backed.
- Escalations have clear reasons.
- User approval boundaries are preserved.
- Operating mode is appropriate.
- No automatic sending, closing, approval, or status change occurs.
- Executive output is concise and actionable.

## Future Use Outside Project Management

PIE Executive is designed for project intelligence first.

The pattern can eventually support other operational domains that require evidence, priorities, decisions, escalation, and human approval.

Future domains may include:

- Maintenance operations.
- Manufacturing operations.
- Facility management.
- Compliance programs.
- Capital projects.
- Safety programs.

Do not implement other industries yet. The project-management model must become reliable, explainable, and useful before generalization.

## Future Implementation Path

### Phase 1: Executive Service

Create a local rule-based `PIEExecutive` service that consumes existing PIE outputs and returns a management brief.

### Phase 2: Runtime Integration

Runtime consumes PIE Executive output and exposes it to Home, Projects, Project Overview, Reports, Project Assistant compatibility, and future Project Walk.

### Phase 3: Behavior Integration

PIE Executive consumes Behavior state and Attention Score once a Behavior Engine exists.

### Phase 4: Conversation Integration

Conversation uses PIE Executive output to produce senior project-manager briefings.

### Phase 5: JARVIS Validation

JARVIS validates operating mode, priority logic, escalation logic, approval boundaries, and concise/actionable output.
