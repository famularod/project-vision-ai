# Step 3 extraction checkpoint — not a beta acceptance

## Local repairs

- The visual reader's explicit single-measurement correction contract now has
  a matching worker validator. The worker preserves independently agreed
  corrected feet/inch text instead of restoring the damaged OCR candidate.
- Correction acceptance requires both providers' exact candidate acceptance,
  valid disposition arrays, complete measurement syntax, bounded numeric
  transcription change, and the existing confidence and source-area checks.
  Ranges, added qualifiers, prose, extra facts and unsupported syntax remain
  unresolved. These are rejection controls, not independent measurement proof.
- Saved corrections retain their agreement record. Retry validation checks
  that record, distinct providers, evidence version and the exact extracted
  exception fingerprint. The existing outer worker contract additionally binds
  the stored result to the job's source/page/evidence context.
- Unmapped Type3 font programs are no longer trusted merely because their
  glyph IDs happen to produce printable ASCII. Mixed lines containing such a
  span are rejected whole. Separately mapped sheet labels remain available;
  optical extraction remains responsible for the rejected drawing text.

## Verification actually performed

- Correction tests first reproduced loss of the corrected text and acceptance
  without complete agreement. Added saved-result replay cases also failed
  before the fingerprint guard, then passed after the repair.
- An unmapped Type3 ASCII test failed before the font guard and passed afterward.
- Complete indexer command: 292 Python tests run, **285 passed, seven skipped**;
  associated JavaScript queue, version, target-claim and worker contracts passed.
- The real-file regression checks all pages of the exact hash-pinned A/B/C
  drawings for rejection of corrupt/unmapped text. This is NOT an answer test.
- `npm run check` passed using the existing project's public client configuration
  supplied only to that subprocess. An earlier invocation without configuration
  correctly failed the preflight; no dummy credentials or weakened guard used.
- `git diff --check` passed.

## Actual-page results: still incomplete

The current production extraction function was run locally against page 4 of
the exact B and C drawings, without model calls or database writes. Both runs
retained one separately mapped native sheet-label region and recovered the
anchor-rod plan title optically. Neither produced explicit overall-dimension
evidence. Smaller component dimensions and elevation text are not substitutes.

Code tracing found that `dimension_ocr_regions` is reached only through the
legacy `ocr_text_regions` function. The current `extract_page` function explicitly
skips that legacy path after its six fixed-tile reads. No dimension-specific
fallback is called from the current path. Restoring an entire duplicate scan
would risk the earlier timeouts and does not prove measurement accuracy.

The next repair must connect bounded, drawing-aware dimension detection and
reading to the **current** extraction path, with independent visible-label
verification and a coordinate-bound relationship to the correct plan. It must
handle a missing OCR token, not only correct a token that OCR already found.
Do not insert expected measurements or infer dimensions from pixel scale.

The repeatable read-only diagnostic is outside shipping source at
`../research/check_actual_plan_extraction.py` (relative to the app directory).
It emits bounded extraction observations, not a success grade.

## Release boundary

No service deployment, database migration, evidence publication, app install,
signed-in session change or end-user question submission occurred in this
checkpoint. Step 3 and the later hosted/device acceptance steps remain open.
