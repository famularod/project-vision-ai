# PIE Mission Model

## Purpose

The PIE Mission Model defines what PIE is trying to accomplish right now.

The Mission Engine gives PIE purpose. Every recommendation, project walk, report, briefing, and question should support the current mission.

PIE should always be able to answer:

- What am I trying to accomplish right now?
- Why does this mission matter?
- What evidence supports this mission?
- What evidence is still missing?
- What would make this mission complete?
- What mission should come next?

Mission sits above Executive. Executive manages priorities. Mission manages purpose.

## What A Mission Is

A PIE Mission is a focused project-management purpose.

It is not a task list and not automation. It is the reason PIE is preparing recommendations, questions, walks, reports, or briefings.

Each mission should include:

- Mission title.
- Mission purpose.
- Why the mission exists.
- Current progress.
- Evidence collected.
- Evidence still needed.
- Blockers.
- Priority.
- Confidence.
- Trust.
- Expected impact.
- Recommended actions.
- Success criteria.
- User approvals required.
- Next mission.

## Mission Lifecycle

PIE missions move through a simple lifecycle:

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

The Mission Engine should never treat a mission as complete just because PIE produced a recommendation. A mission is complete only when its success criteria are satisfied or the user has verified the necessary reality.

## Mission Hierarchy

Mission sits above Executive.

- Mission defines purpose.
- Executive decides what deserves management attention.
- Behavior decides how PIE should act.
- Reflection audits whether PIE's mission reasoning is supported.
- Runtime presents the mission-backed state to the app.
- Conversation expresses the mission in concise project-manager language.

The hierarchy is:

```text
Mission
  |
  v
Executive Priorities
  |
  v
Behavior
  |
  v
Decisions / Recommendations / Questions
  |
  v
User Review
```

Mission should not override Executive evidence. It should explain why Executive priorities matter and what outcome they support.

## Mission Types

Initial mission types:

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

## Mission Transitions

The Mission Engine should know when purpose changes.

Example transition:

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

Transitions should be evidence-backed. A mission should transition when:

- Success criteria are met.
- A higher-priority risk appears.
- A blocker prevents progress.
- User verification changes the current understanding.
- Executive priorities change.
- Reflection finds weak evidence that must be verified first.
- Communication or report readiness changes.

## Mission Completion

Every mission needs measurable success criteria.

Examples:

- Morning Brief is complete when the top priority, attention projects, and needed user questions are clear.
- Project Walk is complete when project/area context, current status, and open verification prompts have been reviewed.
- Inspection Verification is complete when inspection status is confirmed, corrected, or explicitly marked unknown.
- Customer Update Prep is complete when customer-facing status is evidence-backed and ready for user approval.
- Schedule Recovery is complete when overdue or blocked schedule work has a recommended recovery action.
- Monitoring is complete only when a meaningful trigger creates a more active mission.

Mission completion does not automatically save, send, close, approve, or change project status.

## Mission Prioritization

Mission priority should consider:

- Safety concerns.
- Critical risks.
- Schedule blockers.
- Missing inspections.
- Customer or executive communication needs.
- Trust Score.
- Understanding Score.
- Reflection gaps.
- Executive priorities.
- Decision Queue priority.
- Knowledge Graph blockers.
- Project Walk readiness.

Priority levels:

- Low: monitor quietly.
- Medium: brief or recommend when the user is already in context.
- High: guide the user's next action.
- Critical: escalate calmly and preserve approval boundaries.

## Mission Examples

### Morning Brief

Purpose: help the user start the day with the clearest priority.

Recommended action: review the top PIE priority and begin the highest-value workflow.

Success: the user knows what deserves attention first.

### Project Walk

Purpose: collect the field evidence PIE most needs.

Recommended action: confirm project, area, current work, photos, and open questions.

Success: PIE has current field evidence or clear unknowns.

### Inspection Verification

Purpose: prevent unsupported completion claims.

Recommended action: verify inspection status before customer or executive communication.

Success: inspection status is known, corrected, or explicitly unresolved.

### Schedule Recovery

Purpose: focus on overdue, blocked, or waiting schedule work.

Recommended action: review the highest-impact blocked or overdue item.

Success: recovery action is prepared for user review.

### Monitoring

Purpose: protect the user's attention when no meaningful action is needed.

Recommended action: stay quiet while PIE watches for change.

Success: PIE remains prepared without creating unnecessary user work.

## Relationship To Executive

Executive identifies what deserves attention.

Mission explains why that attention matters and what outcome PIE is pursuing.

For example, Executive may identify "Inspection status needs verification." Mission frames that as "Inspection Verification" so every question, recommendation, report caveat, and Project Walk prompt supports confirming inspection reality.

## Relationship To Behavior

Behavior determines whether PIE should monitor, brief, ask, recommend, escalate, prepare, wait, or learn.

Mission gives Behavior a purpose.

Example:

- Mission: Reduce Project Uncertainty.
- Behavior: Ask.
- Question: "What is the current inspection status?"

## Relationship To Reflection

Reflection audits mission quality.

Reflection should ask:

- Is this mission supported by evidence?
- Are the recommendations strong enough?
- What evidence is missing?
- Could this mission be wrong?
- What should the user verify first?

If Reflection finds weak support, Mission should shift toward reducing uncertainty before preparing communication or decisions.

## Relationship To Runtime

Runtime should eventually expose Mission as part of the single PIE response.

Runtime should show:

- Current Mission.
- Mission purpose.
- Mission progress.
- Mission blockers.
- Recommended mission action.
- Success criteria.
- Next mission.

The UI should render Mission output rather than inventing its own page purpose.

## Relationship To Conversation

Conversation expresses Mission in user-facing language.

Examples:

- "PIE's mission right now is to verify inspection status before preparing the customer update."
- "PIE is in Project Walk mode because current field evidence is stale."
- "PIE is monitoring. No urgent mission is supported by current evidence."

Conversation should not behave like open-ended chat. It should communicate the mission, evidence, uncertainty, and next useful action.

## Relationship To Knowledge Graph

Knowledge Graph helps Mission understand relationships.

It can show:

- Which evidence supports the mission.
- Which blockers affect the mission.
- Which areas are tied to risks.
- Which recommendations lack connected evidence.
- Which people, documents, reports, or schedule items are related.

Mission should use graph gaps as evidence-still-needed signals.

## Relationship To Future Prediction

Prediction should eventually help Mission anticipate the next useful purpose.

Examples:

- Predict that a stale update will become a communication risk.
- Predict that an overdue schedule item will need executive attention.
- Predict that missing inspection status will block customer communication.

Prediction should recommend mission transitions, not automate action.

## Relationship To Future Learning

Learning should improve mission timing and defaults.

Examples:

- Learn when the user usually starts the Morning Brief.
- Learn which projects should be walked first.
- Learn preferred communication preparation timing.
- Learn which verification questions the user frequently answers.

Learning must remain reviewable and evidence-backed.

## Development Rules

- Every mission must have purpose.
- Every mission must have evidence or clearly state missing evidence.
- Every mission must have measurable success criteria.
- Every mission must preserve user approval boundaries.
- Mission should support Executive priorities, not conflict with them.
- Mission should use Reflection to avoid overconfidence.
- Mission should transition when evidence, risk, or user feedback changes.
- Unknown is better than unsupported mission confidence.
