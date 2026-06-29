# Project Vision AI JARVIS QA

## Purpose

JARVIS QA is the internal quality system for Project Vision AI.

Its purpose is to protect the product experience before every release by checking layout, navigation, critical workflows, PIE intelligence, and release readiness. JARVIS QA should make it harder for broken text, clipped buttons, confusing navigation, or weak PIE output to reach TestFlight.

JARVIS QA does not replace human review. It gives the team a repeatable checklist and a future automation path so humans can review the product faster and with better confidence.

## What JARVIS Tests

JARVIS should test the product from the user's point of view:

- Can a project manager understand what to do next?
- Does Home load without visual problems?
- Do project cards show readable health, schedule, action, and location context?
- Is there one obvious primary action on daily-use screens?
- Are admin actions behind More or Admin surfaces?
- Does Capture start quickly?
- Do Reports and More/Admin remain reachable?
- Does PIE provide visible recommendations?
- Does Project Assistant answer from project intelligence without external AI calls?
- Are duplicate actions removed from each daily-use page?
- Are Locations and Project Areas absent as primary workflows?
- Is the user-facing bottom nav Today / Projects / Walk / Review / More?
- Does Today start with Current Mission and PIE Briefing?
- Does Walk collect evidence for PIE rather than acting like a generic capture page?
- Does Review show PIE-prepared items, approvals, questions, and communication readiness?
- Do project cards read as mini PIE briefings?
- Does the App act as the pathway between the user and PIE rather than the intelligence source?
- Does PIE visibly drive recommendations, priorities, and next best action?
- Does JARVIS verify PIE logic and App usability as separate quality dimensions?

## UI Layout Checks

JARVIS should check visible app quality on normal iPhone widths:

- Text does not wrap awkwardly.
- Labels do not split mid-word.
- Buttons do not clip.
- Primary buttons have readable text.
- Secondary actions do not overflow horizontally.
- Cards do not overlap.
- Touch targets remain large enough for field use.
- Project cards show Update as the primary action.
- More/overflow menus expose admin actions without clipping Delete.
- Schedule values use short readable labels such as On Track, Required, Behind, None, and Due Soon.
- Project cards show one primary action.
- Project cards display location context without sending the user to a separate Locations workflow.

## Navigation Checks

JARVIS should confirm all primary destinations load:

- Today loads.
- Projects loads.
- Project Workspace loads from a project card.
- Walk starts from Today and bottom navigation.
- Review loads.
- More/Admin loads.
- Project Assistant compatibility screen loads only as an integrated PIE fallback, not as a primary destination.
- Schedule remains reachable.
- Reference documents, saved updates, timeline, and diagnostics remain reachable from their existing paths.
- Bottom navigation labels are exactly Today, Projects, Walk, Review, More.

## Workflow Checks

JARVIS should protect the daily project-management workflows:

- Start Walk in two taps or fewer.
- Create a project in under 30 seconds.
- Find a project in under 15 seconds.
- Open Project Workspace from Projects.
- Start an update from a project card.
- Save a field update.
- Review prepared updates, reports, and saved history.
- Open More/Admin for diagnostics and sync.
- Review PIE recommendation before acting.
- Confirm or correct PIE location only when confidence is low or context is wrong.

## PIE Logic Checks

JARVIS should validate that PIE remains useful and local:

- PIE Insight appears on Home.
- PIE Insight appears on Project Overview.
- Project Assistant shows Powered by PIE or PIE recommendation context.
- PIE recommends a next best action.
- PIE uses local project updates, photos, schedules, documents, areas, sync metadata, events, reasoning, and memory where available.
- PIE handles empty projects honestly.
- PIE does not call external AI services for rule-based assistant answers.
- Project Assistant can answer status, recent change, attention, schedule, boss/customer communication, next action, project story, memory gaps, recurring issue, and what PIE remembers.
- Runtime beliefs are supported by named evidence.
- Runtime recommendations include evidence and confidence.
- Runtime Trust Score, Understanding Score, and Preparedness Score are available for product surfaces.
- Runtime does not recommend action from unsupported or invented facts.
- PIE next best action is visible on daily-use screens.
- PIE owns project, location, and area intelligence unless user correction is needed.
- Runtime includes graph-backed evidence when relationships are available.
- Recommendations can expose connected evidence from the Knowledge Graph.
- Runtime identifies blocked items from graph relationships.
- Missing graph relationships are surfaced as gaps instead of hidden.
- The App renders Runtime output instead of recreating PIE intelligence in page-level logic.
- PIE remains the source of recommendations, priorities, confidence, and project understanding.
- JARVIS can review PIE logic separately from visual layout and navigation usability.
- PIE Executive priorities are evidence-backed.
- Runtime includes PIE Executive priorities, projects needing attention, escalations, preparations, questions, daily routine, and operating mode.
- PIE Executive recommendations can be traced to evidence, confidence, urgency, impact, and user approval state.
- PIE Executive escalations include clear reasons, urgency, confidence, evidence, and user action.
- PIE Executive operating mode matches the current project-management context and is visible or testable through Runtime.
- PIE Executive preserves approval boundaries and does not automatically send, close, approve, or change project status.
- PIE Executive output stays concise and actionable.
- PIE Reflection identifies weak recommendations.
- PIE Reflection identifies missing evidence.
- PIE Reflection produces verification questions.
- PIE Reflection does not invent facts.
- PIE Reflection does not override user approval boundaries.
- PIE Reflection can explain why confidence should be reduced.
- PIE Partnership recommendations explain themselves with why, evidence, confidence, uncertainty, impact, and next action.
- User corrections improve PIE understanding instead of being ignored.
- Approvals never happen automatically.
- PIE asks useful questions that improve project understanding.
- PIE does not repeat itself without new evidence, urgency, or context.
- PIE reduces user effort instead of adding extra decisions.
- PIE behaves like a senior project manager: calm, direct, evidence-based, and action-oriented.
- PIE Mission always exists when Mission Engine output is requested.
- PIE Mission matches Runtime priorities and Executive priorities instead of competing with them.
- PIE Mission includes evidence collected and evidence still needed.
- PIE Mission has measurable success criteria.
- PIE Mission transitions correctly when complete, blocked, or superseded by higher-priority risk.
- PIE Mission never conflicts with Executive priorities or approval boundaries.
- Runtime includes current mission, mission summary, objective, progress, blockers, evidence, recommendations, success criteria, completion state, and next mission.
- Runtime mission output aligns with Executive priorities and does not compete with the next best action.
- Runtime exposes a mission-backed line where applicable, such as "Current Mission: Reduce Project Uncertainty."

## Release Readiness Checks

Before TestFlight release, JARVIS QA should confirm:

- `npm run check` passes.
- No daily-use screen has clipped controls.
- No primary labels are broken across lines.
- No horizontal overflow appears on iPhone-size screens.
- Today, Projects, Walk, Review, More/Admin, Project Workspace, and Project Assistant compatibility all load.
- Bottom navigation is Today / Projects / Walk / Review / More.
- Today starts with Current Mission, mission progress, blockers, PIE Briefing, Trust, Understanding, Preparedness, confidence, priorities, and projects needing attention.
- Walk shows PIE location context, likely project, likely area, confidence, walk mission, evidence needs, and useful correction controls.
- Review shows PIE prepared items, Executive Brief, Customer Update, Project Summary, open decisions, questions, reports ready for review, approval required, and communication readiness.
- Project cards show mini PIE briefings with mission, area/location context, health, trust/confidence, understanding, current concern, and next PIE recommendation.
- Project cards show readable status, schedule, Update, More, and location context.
- Delete remains available only through More and still requires confirmation.
- PIE recommendations are visible and action-oriented.
- PIE next best action is visible.
- PIE beliefs are evidence-backed.
- Trust Score is displayed where reliability matters.
- Understanding Score is displayed where completeness matters.
- Preparedness Score is displayed where the user is preparing for meetings, reports, walks, or decisions.
- No recommendation appears without evidence, confidence, impact, and a suggested next action.
- Graph-backed recommendations expose connected evidence where available.
- Blocked items are identified when graph relationships show an issue blocking schedule or project work.
- Missing relationships are surfaced as graph gaps.
- The App still acts as a pathway for capture, verification, correction, approval, and presentation.
- PIE is visibly driving recommendations and next best action.
- JARVIS verifies PIE logic separately from App usability and layout.
- PIE Executive priorities are evidence-backed.
- Runtime exposes PIE Executive outputs for release review.
- PIE Executive recommendations are evidence-backed.
- PIE Executive escalations require clear reasons.
- PIE Executive preserves user approval boundaries.
- PIE Executive operating mode is visible or testable and appropriate for the current context.
- No automatic send, close, approve, status-change, safety, schedule, stakeholder, or commitment behavior is introduced.
- PIE Executive output is concise and actionable.
- PIE Reflection flags weak recommendations when evidence or confidence is low.
- PIE Reflection flags missing evidence such as photos, schedule support, inspection status, stale updates, and graph gaps.
- PIE Reflection provides verification questions for user review.
- PIE Reflection preserves approval boundaries and does not act automatically.
- PIE Reflection explains confidence reduction with evidence.
- PIE Partnership behavior is visible in recommendations, questions, explanations, and prepared work.
- User corrections, rejections, approvals, and delays are treated as feedback signals for future PIE improvement.
- Recommendations explain themselves before asking for user action.
- PIE asks useful questions and avoids repetitive prompts.
- PIE reduces user effort while preserving approval boundaries.
- PIE behaves like a senior project manager, not a chatbot or uncontrolled automation tool.
- PIE Mission output exists for current project or daily context when Mission Engine is used.
- PIE Mission purpose aligns with Runtime current priority and Executive operating mode.
- PIE Mission recommendations are evidence-backed and list evidence still needed.
- PIE Mission success criteria are measurable and reviewable.
- PIE Mission transitions are explainable and do not skip user approval.
- PIE Mission does not send, close, approve, change status, or communicate automatically.
- Runtime includes current mission output for release review.
- Runtime mission output includes objective, evidence, blockers, and success criteria.
- Runtime mission recommendations preserve approval boundaries.
- A mission line is visible where applicable in existing PIE briefing sections.
- Location intelligence appears as context, not as a primary workflow.
- Project Areas and Locations do not appear as primary user workflows.
- Area Mapping, if needed, is hidden under Advanced Configuration.
- No duplicate action appears on the same page.
- Project cards display location context and one primary Update action.
- No Supabase schema changes were introduced unintentionally.
- No external AI calls were added to local PIE/assistant logic.

## PIE Presence Release Gate

A feature is complete only if both conditions are true:

1. PIE became smarter.
2. The user can clearly perceive the improvement.

JARVIS should reject intelligence work that only improves internal calculations without making the product easier to understand, faster to act on, or clearer about what PIE knows.

JARVIS should also reject UI work that makes PIE more visible without improving or accurately exposing real PIE output.

Release review should ask:

- Does the screen show what PIE knows?
- Does the screen show what changed?
- Does the screen show what concerns PIE?
- Does the screen show what PIE recommends?
- Does the screen show what PIE needs from the user?
- Are Trust Score and Understanding Score visible where they help the user judge reliability?
- Is Preparedness Score visible where the user is preparing for a meeting, report, walk, or decision?
- Are current beliefs backed by supporting evidence?
- Are contradictions and remaining uncertainty surfaced instead of hidden?
- Does every recommendation trace back to evidence and confidence?
- Is the next best action obvious?
- Is there only one primary action per project card?
- Are duplicate page actions removed or moved behind More/overflow?
- Is Area Mapping hidden as advanced configuration rather than presented as a normal feature?
- Is the user still responsible for approval when action affects project status, safety, schedule, stakeholders, or communication?

## JARVIS QA Checklist

Use this checklist before release handoff:

- [ ] Text does not wrap awkwardly.
- [ ] Buttons do not clip.
- [ ] Primary actions are obvious.
- [ ] No horizontal overflow appears.
- [ ] Bottom nav is Today / Projects / Walk / Review / More.
- [ ] Today loads.
- [ ] Projects loads.
- [ ] Project Workspace loads.
- [ ] Walk starts.
- [ ] Review loads.
- [ ] More/Admin loads.
- [ ] PIE Insight appears on Today.
- [ ] PIE Insight appears on Project Workspace.
- [ ] Project Assistant compatibility answers project questions without being a primary nav item.
- [ ] Today starts with Current Mission and PIE Briefing.
- [ ] Walk collects evidence for PIE.
- [ ] Review shows prepared and approval-required items.
- [ ] Project cards show mini PIE briefings.
- [ ] Location context appears on project cards.
- [ ] No visible Project Areas or Locations primary workflow appears.
- [ ] Area Mapping is hidden under Advanced Configuration.
- [ ] One primary action appears per project card.
- [ ] No duplicate actions appear on the same page.
- [ ] PIE next best action is visible.
- [ ] Runtime beliefs have supporting evidence.
- [ ] Trust Score appears where reliability matters.
- [ ] Understanding Score appears where completeness matters.
- [ ] Preparedness Score appears where readiness matters.
- [ ] Recommendations do not appear without evidence.
- [ ] Runtime includes graph-backed evidence when available.
- [ ] Recommendations can show connected evidence.
- [ ] Blocked items are identified from graph relationships.
- [ ] Missing relationships are surfaced as graph gaps.
- [ ] App surfaces Runtime output instead of becoming the intelligence source.
- [ ] PIE visibly drives recommendations and next best action.
- [ ] JARVIS verifies PIE logic and App usability separately.
- [ ] PIE Executive priorities are evidence-backed.
- [ ] Runtime includes PIE Executive priorities.
- [ ] Runtime includes PIE Executive projects needing attention.
- [ ] Runtime includes PIE Executive preparations and questions.
- [ ] PIE Executive recommendations can show evidence, confidence, urgency, impact, and approval state.
- [ ] PIE Executive escalations include clear reasons.
- [ ] PIE Executive preserves user approval boundaries.
- [ ] PIE Executive operating mode is visible or testable and appropriate.
- [ ] PIE Executive does not automatically send, close, approve, or change status.
- [ ] PIE Executive output is concise and actionable.
- [ ] PIE Reflection identifies weak recommendations.
- [ ] PIE Reflection identifies missing evidence.
- [ ] PIE Reflection produces verification questions.
- [ ] PIE Reflection does not invent facts.
- [ ] PIE Reflection preserves user approval boundaries.
- [ ] PIE Reflection explains why confidence should be reduced.
- [ ] PIE Partnership recommendations explain why, evidence, confidence, uncertainty, impact, and next action.
- [ ] User corrections improve PIE understanding.
- [ ] Approvals never happen automatically.
- [ ] PIE asks useful questions.
- [ ] PIE does not repeat itself without new evidence, urgency, or context.
- [ ] PIE reduces user effort.
- [ ] PIE behaves like a senior project manager.
- [ ] PIE Mission exists when Mission Engine output is requested.
- [ ] PIE Mission matches Runtime and Executive priorities.
- [ ] PIE Mission has evidence.
- [ ] PIE Mission has measurable success criteria.
- [ ] PIE Mission transitions correctly.
- [ ] PIE Mission never conflicts with Executive priorities or approval boundaries.
- [ ] Runtime includes current mission.
- [ ] Runtime mission output has objective, evidence, blockers, and success criteria.
- [ ] Runtime mission aligns with Executive priorities.
- [ ] Runtime mission does not bypass user approval.
- [ ] Mission line is visible where applicable.
- [ ] Project card Update action is readable.
- [ ] Favorite, Rename, Archive, Restore, and Delete are inside More/overflow.
- [ ] Schedule card values are short and readable.
- [ ] Empty states are helpful when project data is missing.
- [ ] `npm run check` passes.

## Current Lightweight QA Foundation

The first JARVIS QA implementation is documentation-only and uses the checklist above.

This is intentional for the first sprint:

- It adds no packages.
- It does not change build tooling.
- It does not affect Supabase, storage, schema, or external AI.
- It gives every release a repeatable manual QA contract immediately.

The next safe step is to convert the checklist into a small local script or Maestro workflow once the screen labels and navigation targets are stable.

## Future Automated Screenshot Comparison

JARVIS should eventually capture approved screenshots for key screens:

- Home
- Projects
- Project Overview
- Capture
- Reports
- More/Admin
- Project Assistant

Future screenshot checks should compare current builds against approved baselines and flag:

- text clipping
- mid-word wrapping
- hidden buttons
- horizontal overflow
- broken cards
- missing PIE Insight surfaces
- missing project location context

Screenshot comparison should start as a release aid, not a blocking system, until baselines are stable.

## Future Maestro Tests

Maestro is the recommended first E2E automation layer.

Initial Maestro flows should test:

- Open Home.
- Start Capture.
- Open Projects.
- Open the first Project Overview.
- Tap Update on a project card.
- Open More on a project card and confirm admin actions are visible.
- Open Reports.
- Open More/Admin.
- Open Project Assistant.
- Ask a suggested Project Assistant question.

Future Maestro checks should also capture screenshots after each major screen loads so JARVIS can review navigation and visual quality together.

## Future JARVIS Direction

JARVIS QA should grow into an internal assistant that can:

- run local checks
- inspect screenshots
- verify product rules
- measure workflow speed
- summarize release risk
- confirm PIE output quality
- recommend whether a build is ready for TestFlight

JARVIS should test Project Vision AI the way a project manager experiences it: fast, clear, readable, and guided by practical project intelligence.
