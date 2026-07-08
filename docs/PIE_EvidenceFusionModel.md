# PIE Evidence Fusion Model

## Purpose

PIE Evidence Fusion turns separate project inputs into one coherent evidence view.

Its job is to combine schedule, photos, GPS, typed updates, issue signals, safety signals, documents, report history, and sync freshness so PIE can understand what evidence agrees, what is missing, and where evidence conflicts.

Evidence Fusion does not replace Runtime, Mission, Executive, Knowledge Graph, or Reasoning. It strengthens them by producing a fused evidence summary that they can trust, question, or explain.

## What Evidence Fusion Is

Evidence Fusion is a local, rule-based pipeline.

It answers:

- What schedule evidence exists?
- What photo evidence exists?
- What GPS or location evidence exists?
- What did the user say in typed updates?
- What issues or safety concerns are visible?
- What evidence is missing?
- What evidence conflicts?
- What summary can PIE safely produce from the current evidence?

## What Evidence Fusion Is Not

Evidence Fusion is not OCR, computer vision, external AI, or a storage layer.

It does not invent missing facts. It does not determine project truth by itself. It prepares structured evidence for higher PIE engines and clearly marks gaps or conflicts for user review.

## Inputs

Current inputs:

- Schedule items from CSV, PDF text extraction, AI/OCR endpoint output, or demo OCR schedule.
- Photo captions, categories, action required, owner, due date, status, timestamp, area, and GPS metadata.
- Typed update notes, project, area, date, photos, recipients, blockers, decisions, and next steps.
- GPS metadata from updates and photos.
- Project area mapping where available.
- Document metadata.
- Report history metadata.
- Sync/cloud freshness metadata.

Future inputs:

- Voice transcripts.
- Inspection results.
- Safety observations.
- Weather.
- Calendar.
- Email/messages.
- Equipment/assets.
- Contractor systems.
- External project systems.

## Schedule Evidence Priority

Schedule is the primary source for:

- Milestones.
- Overdue work.
- Upcoming work.
- Schedule risk.
- Next work.
- Priority.
- Executive summary context.

Imported schedule items should include project, task, area, start date, due date, status, percent complete, owner, contractor, priority, and notes whenever possible.

If a PDF has embedded text, the app should parse it locally. If a PDF is scanned or image-only, the app should explain that OCR is needed. If no OCR endpoint is configured, demo OCR schedule import remains available for testing and should be clearly marked as demo/test data.

## Photo Evidence Foundation

Photo Evidence extracts:

- Photo count.
- Caption presence.
- Category.
- Project.
- Area.
- Timestamp.
- Action required.
- Action owner.
- Action due date.
- Action status.
- Issue flag.
- Safety flag.
- GPS metadata.

The first version does not perform full computer vision. Captions, categories, action fields, area, and GPS metadata provide enough structure for PIE to reason locally.

## GPS Evidence

GPS Evidence extracts:

- GPS availability.
- Recommended project.
- Recommended area.
- Last known location.
- Nearest mapped area.
- Distance from nearest area.
- Whether the location is within a mapped area radius.
- Correction status.
- Confidence score.
- Whether the evidence supports Project Walk.

When GPS is unavailable, PIE should clearly say it is relying on last active project, selected area, schedule context, or recent activity.

## User Update Evidence

Typed Update Evidence extracts:

- Notes.
- Project.
- Area.
- Date/time.
- Photo count.
- Mentioned issues.
- Safety mentions.
- Decisions.
- Blockers.
- Next steps.
- Communication readiness when recipients and notes are present.

This helps PIE explain what changed and what the user likely needs to do next.

## Gaps

Evidence Fusion should surface gaps instead of hiding them.

Initial gaps include:

- No schedule evidence.
- No photo evidence.
- GPS unavailable.
- No typed updates.
- Schedule items needing review.
- Missing schedule owner or contractor.
- Missing document metadata.
- Missing report history.

Each gap includes severity, source, confidence, and suggested action.

## Conflicts

Evidence Fusion should surface conflicts when available evidence disagrees.

Initial conflicts include:

- A schedule item marked complete while an open issue exists in the same area.
- GPS-recommended area differs from the latest update area.
- A closed photo action still has an overdue due date.

Each conflict includes sources, severity, confidence, and suggested action.

## Intelligent Summary

The Intelligent Summary is the user-facing synthesis that higher PIE engines can consume.

It includes:

- Project status.
- What changed.
- Schedule status.
- Photo/evidence summary.
- GPS/location confidence.
- User update summary.
- Risks/issues.
- Safety summary.
- Missing information.
- PIE recommendation.
- Confidence/trust.
- Next action.
- Evidence source summary.

The summary must remain honest about missing information. Unknown is better than wrong.

## Runtime Integration

PIE Runtime consumes Evidence Fusion and exposes:

- `fusedEvidence`
- `evidenceFusionSummary`
- `intelligentSummary`
- `evidenceGaps`
- `evidenceConflicts`

Runtime uses Evidence Fusion to strengthen:

- What PIE knows.
- What changed.
- What concerns PIE.
- What PIE recommends.
- What PIE needs from the user.
- Trust Score.
- Understanding Score.
- Preparedness Score.
- Runtime recommendations.
- Runtime unknowns.

## Relationship To Knowledge Graph

Evidence Fusion summarizes and audits the evidence itself.

Knowledge Graph connects that evidence to relationships between projects, areas, schedule items, issues, safety concerns, documents, people, recommendations, and decisions.

Evidence Fusion answers, "What evidence do we have and does it agree?"

Knowledge Graph answers, "How is this evidence connected?"

## JARVIS Validation

JARVIS should validate that:

- Schedule evidence is present after CSV/PDF/OCR/demo import.
- Photo captions, categories, action fields, and GPS metadata feed PIE.
- GPS recommendation is confidence-scored.
- Typed updates become user update evidence.
- Evidence gaps are surfaced.
- Evidence conflicts are surfaced.
- Runtime includes fused evidence output.
- No recommendation is based on invented facts.

## Future Roadmap

Phase 1: local rule-based fusion from existing data.

Phase 2: stronger schedule extraction review and correction flow.

Phase 3: connect Fusion outputs more deeply into Knowledge Graph node creation.

Phase 4: add voice, inspection, safety, weather, calendar, email, and external systems as evidence sources.

Phase 5: add persistent evidence records and user-reviewed corrections.
