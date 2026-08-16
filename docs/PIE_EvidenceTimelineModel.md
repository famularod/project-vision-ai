# PIE Evidence Timeline Model

## Purpose

PIE should understand evidence over time.

Evidence Timeline is a Layer 1 Perception service. It turns schedule imports, photos, notes, GPS confirmations, user corrections, issues, decisions, reports, and inspection updates into chronological project evidence.

The timeline helps PIE answer:

- What changed?
- When did it change?
- Is progress moving?
- Is evidence stale?
- Is the same issue repeating?
- Did activity restart after a delay?

## Event Types

- photo_added
- note_added
- schedule_imported
- schedule_changed
- GPS_confirmed
- user_corrected
- issue_opened
- issue_resolved
- decision_needed
- decision_made
- report_generated
- report_approved
- inspection_updated

## Grouping

Timeline events can be grouped by:

- Project
- Area
- Work package
- Issue
- Schedule item
- Decision

This allows PIE to understand both the full project story and a narrow area-specific or decision-specific story.

## Momentum

PIE should detect:

- progress_increasing
- progress_slowing
- no_recent_evidence
- repeated_same_issue
- area_going_stale
- new_activity_after_delay
- stable

Momentum should influence Pattern Intelligence, Beliefs, and Core Intelligence. If an area is going stale, PIE should weaken confidence until current evidence is captured. If new activity appears after a delay, PIE should explain that progress may have restarted but should still be verified.

## Output Contract

`services/PIEEvidenceTimeline.ts` returns:

- evidenceTimeline
- timelineGaps
- staleAreas
- momentumSignals
- recentChanges

## Product Rule

PIE should not only know the latest evidence. PIE should know the sequence of evidence that led to the current understanding.
