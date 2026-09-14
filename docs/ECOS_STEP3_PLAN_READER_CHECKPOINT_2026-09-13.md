# Step 3 source-bound plan reader checkpoint

This is an intermediate engineering checkpoint, not beta certification.

## Current verified results

- The active extractor locates separate, source-bound full-span dimension labels on the actual A, B, and C structural drawing page 4. A uses interrupted ruler strokes and extended dashed grid lines; B/C retain their continuous-outline path.
- OCR proposals remain unresolved and non-searchable until a protected visual reader plus a different assurance provider accept the complete printed measurement.
- A completed protected B diagnostic read `82'-0"` and `64'-0"`; the relationship replay produced the corresponding overall width/length from B's own source geometry. The diagnostic did not publish evidence or run a customer question.
- Real-source detection tests check all three private PDFs by exact hash. Synthetic tests separately exercise stale source/page/project/version, altered read, missing second read, wrong axis, outline drift, no heading, and interrupted rulers. These are not counted as real-user answer passes.
- Worker suite: 303 tests run, 296 passed, seven skipped. Private reader typecheck and request-boundary tests pass. Unauthorized hosted request returned `unauthorized`.

## Failures retained

- The original reader's fixed scale could render small dimension glyphs only about six pixels high. Adaptive high-resolution crops are now bounded to 1,536 pixels on their longest edge (one-pixel raster rounding permitted).
- One original protected request timed out at the caller's 90-second deadline; another returned a recorded `analysis_timeout`. A later original read passed both B labels. This was not repeatable enough to declare success.
- Caller timeout is now 120 seconds with a typed uncertain transport outcome and no automatic paid retry. This change alone does not resolve slow provider behavior.
- An early split-line detector broke B/C geometry detection locally. It was corrected: continuous detection is preserved; bounded interrupted-stroke reconstruction is a fallback.
- The first C diagnostic was refused by the existing committed-index gate. Its original ready state was restored. Do not clear a committed marker to bypass that gate; use the existing exact-page reindex procedure after preserving the private rollback state.
- One test invocation used the wrong default architectural-PDF fixture. The exact private fixture directory was then supplied, and the full suite passed without changing its expected hash.

## Private deployed reader

- New function: `ecos-analyze-drawing-page-preview`, version 1, bundle `8daee52f7306d9b6dcaec17457a5eb1af59297de6fd11c2a64eef006b1db9573`.
- Entrypoint SHA-256: `be9d800c9cfcd90d118206f937946051c748293b29b8d52f3108253ff9d189fe`.
- All five deployed source files were compared byte-for-byte with the local candidate.
- Based on the freshly retrieved live drawing reader version 306, with its exact shared validators vendored into the private function. The older app-local live reader was not overwritten.
- Requires the existing server-only worker token, exact held job/operation/reservation, shadow job mode, one correction candidate, and one high-resolution tile. Comparison overrides and broad drawing reads are rejected.
- Limits the single-label output and provider call duration; no transient retry loop or model fallback chain. Separate-provider assurance remains required by the evidence validator.
- No customer routing, live reader, provider secrets, app deployment, user session, or evidence publication changed. Private probes restore the disabled shadow configuration and their exact held job state; paid audit receipts are retained.

## Remaining work

1. Finish A/C protected reads via the supported reindex boundary; verify repeatability and full proof relationships, not only raw labels.
2. Run the updated hosted worker and verify durable page, chunk, and reference-document materialization preserve the new evidence and reject forged/mismatched relationships.
3. Re-run the runtime against actual stored evidence, including shuffled A/B/C/D, other entity families, missing evidence and project switches.
4. Complete steps 4–7: actual visible desktop/iPhone/iPad question and proof opening, release/security/recovery gates, controlled release/install verification.

Private diagnostic receipts remain outside Git in the parent `research` directory. They are not sanitized handoff bundles and must not be shared externally.
