# Ask ECOS follow-up repair — private runtime validated, apps not released

## Private hosted validation, subsequent continuation

Runtime `f7fdf691bf7ff9eff095841e8ee12b47c89ed994` built as Cloud Build `ddfda079-688b-4506-b778-8769b719619f`. All 42 uploaded inputs matched; image `sha256:e0413a0b1d3b7affc92681e514e08a54840e0d06125563b3d42cf4e64cba9ad0`, package `fb32aa6763675f325089c61bdb20856c782a04691132783b73cfbd436bdb882c`. New zero-traffic revision `ecos-agent-query-preview-followupf7fdf69` passed immutable readback and missing-gateway-token rejection. Existing traffic and tags unchanged.

One fresh private conversation returned B 5,248 SF (14,172 ms), “And canopy C?” 2,624 SF (12,741 ms), then “And canopy A?” 6,344 SF (12,922 ms). Each retained the correct conversation/turn chain and distinct exact page-4 document citation, with calculation caveats. No replay or seeded fixture. Invalid prior-turn UUID returned 409 before research. Temporary session was locally revoked, refresh denied, and independently verified absent from auth.sessions. Receipt directory: `../research/private-runtime-questions-f401a75b728041baad0d6b1abf4e1852/` relative to the app checkout. This is private API verification, NOT visible UI acceptance.

Release review also caught a compatibility issue in the initial local client patch: requiring a conversation receipt for every initial answer would reject standalone answers from unchanged general/fallback routing. The client now accepts a normal initial standalone answer with no conversation capability, but still rejects missing receipts for linked follow-ups and malformed/mismatched receipts from any route claiming support. No fallback answer is retained as conversation evidence.

## Exact regression-source recovery

The initial pre-bump release gate failed both the still-incomplete live acceptance gate and the local 2321 source-identity test. The default iCloud architectural file had SHA-256 `9d7e0c86758c6aef8ef8654f586a3e0d80953db7cac6329c153d551d15846059`, not the test's pinned `5c1f0ccac1dbb50b0ff373da39179e572d577c75fc3941cec5b77d12f4846bbb`. The Downloads copy matches the original expected hash exactly. A hash difference establishes different bytes, not why they changed or which revision is authoritative for live project questions.

Six original benchmark files were copied into private read-only fixtures under `../research/private-2321-pinned-ZOfaL5/`, with all expected hashes checked before and after copying and a manifest of the selected inputs. Neither user source was changed; no expected hash or assertion was changed. Explicit `ECOS_2321_REGRESSION_DIRECTORY` selection restored the hosted indexer run: 313 tests run, OK, 9 existing skips. Those skips are not passes. The ten-page mapping check now executes successfully. This verifies the pinned historical regression inputs, not the authority or indexing of the separate iCloud file. Complete release and device acceptance remain open.

## Observed end-user results

Normal signed-in Chrome, desktop Build 194, project 2375, 2026-09-14 UTC:

| Submission time | Actual question | Result |
| --- | --- | --- |
| 15:03:03.665 | What is the square footage of canopy B? | 82 by 64 feet, calculated 5,248 SF; B/WPB-4 citation. Proof not opened in this turn. |
| 15:03:37.390 | And canopy C? | Failed: invalid proof response. No answer accepted. |
| 15:05:25.504 | What is the square footage of canopy C? | 32 by 82 feet, calculated 2,624 SF; C/WPC-4 citation. Protected proof and full cited page opened visibly. Original Drive source not opened in this turn. |

These are three UI observations, not a complete repeatability pass. The drawing dimensions were not independently remeasured during this turn.

Read-only database verification found trace `646e6167-d1e8-461a-b0e5-d8d4d6ceabc1`: started 15:03:38.230Z; failed at `verify_document_proof_authority` with `proof_authority_response_invalid`. Runtime logs identify revision `ecos-agent-query-preview-beta3309413`; persisted routing names `deepseek-v4-flash`, route `deepseek-owner-beta-v1`. The model research completed; the exact malformed proof subcase is not retained in the existing trace and remains unproven. Do not assume conversation wiring alone fixes every proof failure.

## Confirmed code defects

1. Desktop workspace, auth-provider input, shared request builder/parser, and native hook did not retain/send the existing server-owned conversation/turn references.
2. Backend `sameProjectFollowUp` flattened previous B wording and current C wording into one retrieval question for “And canopy C?”. Running the actual resolver plus shared entity parser produced BOTH `canopy:B` and `canopy:C`. This second defect would remain after client-only wiring.

## Local repairs

- Client sends only UUID conversation and prior-turn references. Server retrieves an unexpired completed operation bound to the authenticated owner. Previous generated answers, excerpts, and credentials are never supplied as conversational evidence.
- Validate the returned conversation reference, prior turn, new turn and durable diagnostic receipt. Missing/mismatched continuity fails clearly rather than silently continuing a different conversation.
- Ephemeral client continuity resets on owner/project changes, errors and unmount. Late requests cannot attach to a newly selected scope. Native storage-owner context is only a local reset boundary, never backend authorization.
- Desktop and native question controls use the same continuity helper. There is no schema migration, secret change, provider change or dependency upgrade.
- Separate runtime patch resolves unambiguous subject-only follow-ups using the existing shared entity parser BEFORE retrieval. It supports named canopies, buildings, rooms, RFIs, equipment, phases and other parser-recognized entities. Ambiguous, multi-target or property-changing subject substitutions require the full question; no old/new-label flattening for those changes.
- Strict source identity, current revision, protected-page and permission checks are unchanged.

## Verification and limitations

- App `npm run check`: PASS with existing public client configuration obtained privately from the existing secret. The first bare-shell attempt failed missing configuration; it did not build or alter an installed app. No fabricated settings or guard bypass used.
- Full app Jest: **263 suites, 1,858 tests passed**. Includes normal desktop control and native Ask Another Question flow tests, transport receipt checks, scope switching and stale response rejection. Mocked answers in these tests are NOT product accuracy evidence.
- Runtime resolver typecheck: PASS. Focused conversation, identity, proof-authority and customer-gateway suites: **73 passed**. No external model question in these unit tests.
- Initial local tests caught a null-receipt guard issue and a test typing issue; both were repaired before the passing runs.
- Runtime proof failure's exact subcase is still unknown. General pronoun/complex follow-up behavior and history retention across navigating out of Ask ECOS remain limited. Do not claim full conversational intelligence.
- Private deterministic conversation fixtures are not real model-answer or user-path acceptance. Keep that distinction in evaluation reports.

## Next release gate

1. Review/package matching app and runtime candidates; verify exact deployment inputs and fresh rollback state. No old source seal covers these changes.
2. Test owner-bound conversation retrieval and gateway round trips privately, including expiration, foreign-owner references, malformed receipts and unchanged proof enforcement.
3. Perform controlled owner-only release, then submit full B question → “And canopy C?” → another subject through actual desktop, iPhone and iPad controls. Inspect each correct proof and original source. Repeat with reordered questions and project switches.
4. Capture any remaining proof error precisely; do not relax proof checks or relabel a refusal as success.

No app deployment, database migration, owner/customer routing change, evidence publication, or installed version change has occurred for this repair. The separately noted private runtime revision and temporary test session were created during hosted validation; the session was revoked. Native Build 196 and web Build 194 remain the installed baseline. Step 4 and the complete beta acceptance gate remain open.
