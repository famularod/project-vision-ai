# Project Vision AI PIE Field Update Design

## 1. Purpose

Users should be able to walk up to a project, speak naturally, and have PIE prepare a structured project update.

The purpose of PIE field updates is to reduce field documentation effort without reducing accountability. A project manager, field technician, contractor, or site lead should be able to describe what they see in plain language while Project Vision AI converts that observation into useful project intelligence.

The workflow should answer the core Capture question: what changed in the field?

PIE should listen for project context, work status, issues, risks, contractor activity, schedule signals, and next actions. It should then prepare a structured update that the user can review, correct, and approve before saving.

## 2. Target Workflow

The target workflow is:

1. User enters a project location.
2. App detects the likely project and location when available.
3. User taps Talk to PIE.
4. User speaks field observations naturally.
5. PIE converts speech into a structured update.
6. PIE identifies the project, area, work performed, issues, risks, contractors, and next actions.
7. User reviews and approves the prepared update.
8. App saves the update to the correct project.

The workflow should remain fast enough for field use. The user should not need to navigate through admin tools, diagnostics, or complex configuration to record a spoken update.

## 3. Example Spoken Input

"The electricians are working on power for lighting. The painters are working on the canopy. The concrete crew is waiting on inspection."

## 4. Example PIE Output

PIE should convert the spoken input into structured fields that can support Capture, Project Overview, Reports, and the Project Assistant.

Example output:

- Project: Detected from selected project, recent project, GPS location, or user confirmation.
- Area: Detected from GPS/project area, user selection, or spoken context.
- Work completed: None explicitly stated.
- Work in progress:
  - Electricians are working on power for lighting.
  - Painters are working on the canopy.
- Issues:
  - Concrete crew is waiting on inspection.
- Risks:
  - Inspection dependency may delay concrete work if not resolved.
- Contractors mentioned:
  - Electricians
  - Painters
  - Concrete crew
- Recommended next action:
  - Confirm inspection status and assign follow-up owner for concrete work.
- Draft update summary:
  - Electricians continued lighting power work, painters continued canopy work, and the concrete crew is waiting on inspection before proceeding.

## 5. Safety and Review Rule

PIE must not save field updates automatically without user review and approval.

Spoken updates can affect project history, stakeholder communication, safety status, schedule expectations, and contractor accountability. PIE may prepare and recommend, but the user must remain responsible for approving the saved record.

The review step should allow the user to:

- Confirm the project.
- Confirm the project area.
- Edit the draft notes.
- Remove misunderstood details.
- Confirm issues and risks.
- Confirm action items and owners when available.
- Save the update only after approval.

## 6. Future GPS and Location Intelligence

GPS and project areas should eventually help PIE determine the correct project automatically.

Future location intelligence should use:

- Current GPS position.
- Known project area boundaries.
- Building and zone metadata.
- Last active project.
- Last selected area.
- Nearby schedule activity.
- Recent field updates at the same location.

When location confidence is high, the app should preselect the likely project and area. When confidence is low, the app should present a clear confirmation choice instead of forcing the user to search manually.

Location should remain background intelligence. Users think in terms of projects and field observations; the app should use location to reduce decisions, not create a separate location workflow.

## 7. Future AI Path

The first PIE field update workflow should be practical and review-driven. Future AI capabilities can improve the quality of spoken update interpretation over time.

Future AI should help:

- Interpret natural language observations.
- Extract work performed and work in progress.
- Identify contractors, trades, and crews.
- Detect issues, blockers, safety concerns, and schedule risks.
- Extract action items, owners, and due dates when spoken.
- Classify risk severity.
- Produce clean draft notes from rough speech.
- Recommend the next useful project action.
- Prepare report-ready summaries after user approval.

AI interpretation should remain grounded in existing project data, selected project context, schedule information, project areas, and user-approved field history. Stakeholder-facing or project-record updates must continue to require human review.

## 8. First Implementation Recommendation

Start with a manual Talk to PIE button on Capture Update or Project Overview.

The first version should use the existing notes and save update structure. It should not require a new database schema.

Recommended first version:

- Add Talk to PIE as an optional capture entry point.
- Require an explicitly selected or preselected project.
- Use existing project area selection when available.
- Convert spoken observations into editable notes.
- Present a review screen before saving.
- Save through the existing update behavior after user approval.
- Store the result as a normal project update.

The first implementation should avoid adding new sync behavior, storage behavior, database tables, or stakeholder communication automation. It should prove the field workflow first: speak, review, approve, save.

Once the basic workflow is reliable, later versions can add structured extraction for contractors, issues, risks, action items, GPS confidence, schedule matching, and report-ready summaries.
