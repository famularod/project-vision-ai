# PIE Missing Evidence Model

## Purpose

PIE should identify what it does not know before it strengthens beliefs, recommendations, or reports.

Missing Evidence is a Layer 1 Perception service. It reads Runtime signals, Evidence Quality output, schedule status, photo status, GPS context, report readiness, and existing evidence gaps. It then recommends the minimum evidence needed to reduce uncertainty.

## Missing Evidence Types

- missing_photo
- missing_current_photo
- missing_location
- missing_schedule
- missing_owner
- missing_decision
- missing_inspection_status
- missing_safety_confirmation
- missing_progress_note
- missing_document
- missing_report_review
- missing_user_confirmation

## Questions Answered

Every missing evidence result should answer:

- What evidence is missing?
- Why does it matter?
- What decision does it affect?
- What is the smallest evidence request that helps?
- What should the user capture next?

Example:

```text
Need one current photo of Canopy C electrical rough-in to verify inspection readiness.
```

## Minimum Evidence Principle

PIE should not ask for every possible missing item. PIE should ask for the smallest evidence request that meaningfully reduces uncertainty.

Examples:

- One current photo is better than asking for a full walkthrough.
- One owner name is better than asking for a full action log.
- One decision confirmation is better than asking the user to rewrite the report.

## Output Contract

`services/PIEMissingEvidence.ts` returns:

- missingEvidence
- highestImpactEvidenceGap
- recommendedEvidenceRequests
- minimumEvidenceNeeded
- uncertaintyReductionActions
- totalEstimatedUncertaintyReduction

## Core Integration

PIE Core Intelligence exposes:

- missingEvidence
- highestImpactEvidenceGap
- recommendedEvidenceRequests
- uncertaintyReductionActions

Experience and Attention may consume Missing Evidence when a missing item blocks a decision, weakens confidence, or prevents the next recommendation from being reliable.

## Product Rule

If PIE does not know enough, it should ask for one useful piece of evidence instead of pretending to know.
