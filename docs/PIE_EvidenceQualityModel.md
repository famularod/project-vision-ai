# PIE Evidence Quality Model

## Purpose

PIE should not treat all evidence equally.

Evidence Quality is Layer 1 perception. It evaluates whether evidence is reliable enough to support beliefs, recommendations, decisions, and reports.

A recent GPS-tagged photo is stronger than an old note. A current reviewed schedule is stronger than an outdated or unreviewed OCR import.

## Quality Levels

- strong
- good
- weak
- stale
- conflicting
- insufficient

## Quality Factors

Evidence is stronger when it is:

- recent
- tied to a project
- tied to an area
- GPS confirmed
- photo-supported
- schedule-supported
- user-confirmed
- matched to prior evidence

Evidence is weaker when it is:

- old
- missing project
- missing area
- missing timestamp
- missing supporting photo
- contradicted by newer evidence
- from unreviewed OCR
- previously corrected by the user

## Scoring Dimensions

### Freshness

Freshness measures how current the evidence is. Evidence with no timestamp is weak. Evidence older than the useful project window is stale.

### Completeness

Completeness checks whether the evidence has project, area, timestamp, and supporting photo context where practical.

### Reliability

Reliability checks source confidence, GPS confirmation, user confirmation, schedule support, photo support, prior match, OCR review status, and prior correction history.

### Relevance

Relevance checks whether evidence is tied to the current project, area, risk, schedule, safety, decision, owner, critical item, or overdue condition.

### Conflict Detection

Conflict detection flags evidence that contains contradictory signals, such as completed/resolved evidence alongside blocked/open-risk evidence.

## Runtime Contract

`services/PIEEvidenceQuality.ts` returns:

- evidenceQuality
- strongEvidence
- weakEvidence
- conflictingEvidence
- staleEvidence
- evidenceReadiness

## Reasoning Integration

Belief Formation should prefer strong and good evidence.

Scientific Method should treat strong evidence as support and stale, conflicting, or insufficient evidence as contradiction or uncertainty.

Deliberation should recommend verification when evidence quality is weak, stale, conflicting, or insufficient.

PIE Core Intelligence exposes Evidence Quality so future engines and reports can use evidence strength without mixing weak and strong sources.
