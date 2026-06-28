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

## Navigation Checks

JARVIS should confirm all primary destinations load:

- Home loads.
- Projects loads.
- Project Overview loads from a project card.
- Capture starts from Home and bottom navigation.
- Reports loads.
- More/Admin loads.
- Project Assistant loads.
- Schedule remains reachable.
- Reference documents, saved updates, timeline, and diagnostics remain reachable from their existing paths.

## Workflow Checks

JARVIS should protect the daily project-management workflows:

- Start Capture in two taps or fewer.
- Create a project in under 30 seconds.
- Find a project in under 15 seconds.
- Open Project Overview from Projects.
- Start an update from a project card.
- Save a field update.
- Generate or open report paths.
- Open More/Admin for diagnostics and sync.
- Review PIE recommendation before acting.

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

## Release Readiness Checks

Before TestFlight release, JARVIS QA should confirm:

- `npm run check` passes.
- No daily-use screen has clipped controls.
- No primary labels are broken across lines.
- No horizontal overflow appears on iPhone-size screens.
- Home, Projects, Capture, Reports, More/Admin, Project Overview, and Project Assistant all load.
- Project cards show readable status, schedule, Update, More, and location context.
- Delete remains available only through More and still requires confirmation.
- PIE recommendations are visible and action-oriented.
- Location intelligence appears as context, not as a primary workflow.
- No Supabase schema changes were introduced unintentionally.
- No external AI calls were added to local PIE/assistant logic.

## JARVIS QA Checklist

Use this checklist before release handoff:

- [ ] Text does not wrap awkwardly.
- [ ] Buttons do not clip.
- [ ] Primary actions are obvious.
- [ ] No horizontal overflow appears.
- [ ] Home loads.
- [ ] Projects loads.
- [ ] Project Overview loads.
- [ ] Capture starts.
- [ ] Reports loads.
- [ ] More/Admin loads.
- [ ] PIE Insight appears on Home.
- [ ] PIE Insight appears on Project Overview.
- [ ] Project Assistant answers project questions.
- [ ] Location context appears on project cards.
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
