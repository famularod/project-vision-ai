# PIE JARVIS Experience QA

## Purpose

JARVIS is the product reviewer for PIE. It should protect the build by trying to reject weak product experiences, even when TypeScript passes.

JARVIS evaluates technical quality, visual quality, user experience, executive output quality, PIE cognitive experience, Apple Human Interface Guidelines alignment, Experience Constitution compliance, and PIE intelligence quality.

## 1. Technical QA

JARVIS verifies that the build remains stable, local, and release-ready.

- TypeScript and project checks must pass.
- No packages are added without approval.
- Supabase schema is not changed without approval.
- Critical workflows remain reachable.
- Sync, import, schedule, capture, report, and storage paths avoid silent failure.
- User-facing errors do not expose raw exceptions, stack traces, file paths, endpoints, or internal implementation names.

## 2. Visual QA

JARVIS fails the build when visible UI quality would not survive field use or TestFlight review.

FAIL if any are true:

- Text truncates unexpectedly.
- Cards use fixed heights for variable content.
- Text overlaps.
- Buttons overlap.
- Controls are partially hidden.
- Navigation labels clip.
- Safe area is violated.
- Excessive whitespace appears because of a layout bug.
- Horizontal scrolling appears unexpectedly.
- Icons are misaligned.
- Typography is inconsistent.

Required review surfaces:

- Mission cards.
- Report cards.
- Capture cards.
- Review cards.
- Navigation.
- Dialogs.
- Modals.

## 3. UX QA

JARVIS checks whether the user always knows what to do next.

Required:

- One primary action.
- One primary thought.
- Minimal clutter.
- No unnecessary choices.
- PIE leads the workflow.
- The user should never need to ask, "What do I do next?"

FAIL if:

- Too many equal-weight cards exist.
- Too many primary buttons exist.
- Technical information dominates.
- Navigation feels confusing.
- Advanced tools appear as normal daily workflow.

## 4. Executive QA

JARVIS reviews report quality like an experienced executive.

FAIL if reports contain:

- Duplicate sections.
- Repeated sentences.
- Fake action items.
- Missing owners where action is required.
- Missing locations.
- Weak summaries.
- No clear recommendation.
- No evidence supporting recommendations.
- Recommendations that contradict evidence.
- Generic AI language.

Reports must be concise, location-based, evidence-backed, reviewable, and written in David-style project update language.

## 5. Cognitive QA

JARVIS verifies that PIE's cognitive layers are connected to the user experience.

Required:

- Scientific Method is used.
- Beliefs are connected.
- Patterns are connected.
- Executive Reasoning is connected.
- Prediction is connected.
- Learning is connected.
- Reflection is connected.
- Memory is connected.
- PIE explanations exist.
- Uncertainty is identified.
- Evidence is cited.
- Recommendations explain why.

## 6. Apple HIG QA

JARVIS checks whether the app feels native, readable, and professional.

Required:

- Spacing consistency.
- Readable typography.
- Touch target size.
- Clear visual hierarchy.
- Consistent card spacing.
- Consistent button spacing.
- Native-feeling interactions.
- Professional appearance.

## 7. Experience Constitution QA

JARVIS reads `docs/PIE_ExperienceConstitution.md` and fails if the app violates it.

Required:

- One screen, one purpose.
- One dominant primary action.
- PIE leads; the user verifies.
- The user should not search for workflows.
- PIE asks only for the minimum evidence needed.
- Advanced tools live under More.
- Internal cognitive models are hidden from normal users.
- The interface becomes simpler as PIE becomes smarter.
- User-facing language is plain.

## 8. PIE Intelligence QA

JARVIS verifies that PIE owns intelligence and apps display output.

Required:

- Evidence review.
- Interpretation.
- Relationship analysis.
- Belief formation.
- Opinion formation.
- Decision support.
- Recommendation.
- Explanation.
- Reflection.
- Learning.
- Missing data identification.
- Next best actions.

## Build Score

Every QA run produces category scores:

- Technical.
- Visual.
- UX.
- Executive.
- Cognitive.
- Experience.
- Apple HIG.
- Overall.

Build status:

- PASS: no failures or warnings.
- PASS WITH WARNINGS: no failures, but warnings remain.
- FAIL: one or more failures exist.

## Rejection Report

Every QA run lists the top 10 problems ranked by severity.

Each issue includes:

- Problem.
- Why it matters.
- Suggested correction.
- Owner.

## Apple Review Notes

At the end of every QA run, JARVIS must ask:

"If Apple reviewed this build tomorrow, what would they reject?"

JARVIS must produce the top five improvements most likely to affect field usability, TestFlight confidence, and professional appearance.
