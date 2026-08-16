# Ask ECOS — Project Question Architecture

## Purpose

Ask ECOS is a separate, read-only project question experience. It does not replace guided Talk. Talk remains the fast voice/text workflow for entering information and completing guided fields. Ask ECOS answers questions by reviewing the selected project's current records and searchable documents.

Example:

> How thick is the new concrete on the north side of 2375?

The answer must state the verified fact, label any inference or recommendation separately, and identify the exact task, update, document revision, sheet/page, excerpt, and drawing region used as proof.

## Implemented 1–10 flow

1. **Separate entry point** — iPhone, iPad, and desktop show a dedicated **Ask ECOS** action. Guided Talk remains independent.
2. **Explicit project scope** — the user selects one synchronized project before the question can be submitted.
3. **Fast voice or keyboard question** — native devices accept one short spoken or typed question. Question voice transcription skips memory-field interpretation to reduce delay and provider use.
4. **Authenticated request** — the Edge Function verifies the Supabase user and the authorized app owner before reading evidence or calling the AI provider.
5. **Current project evidence retrieval** — ECOS retrieves bounded, project-scoped tasks, field updates, project field notes, and only current indexed documents. Superseded drawings are excluded.
6. **Construction-aware document search** — retrieval removes conversational filler, expands common construction terms, searches several targeted terms, and ranks the matching page/region excerpts. Current drawing indexes can include authenticated page-image facts with bounded proof coordinates in addition to embedded text and OCR.
7. **ECOS Core synthesis** — ECOS Core receives only the bounded evidence set and proposes a concise answer using strict structured output. Source excerpts are treated as untrusted data, never instructions.
8. **Independent ECOS Assurance** — a separate deterministic check confirms every cited source exists, verifies numeric claims against the cited excerpts, removes unsupported proposed statements, and lowers confidence for limitations or conflicts.
9. **Proof-first presentation** — the result separates verified facts from inference/recommendations and shows the exact source record or document citation. Drawing citations retain revision, page/sheet, region coordinates, and excerpt text.
10. **Read-only, controlled operation** — Ask ECOS cannot change tasks, projects, updates, documents, authentication, or permissions. Requests are owner-scoped, rate-limited, idempotent, and cached briefly to prevent duplicate paid calls.

## ECOS Core and ECOS Assurance separation

ECOS Core may retrieve evidence and propose facts, inferences, recommendations, limitations, conflicts, and follow-up questions.

ECOS Assurance independently verifies:

- the selected project exists and belongs to the authorized owner;
- documents are current, indexed, project-scoped, and not superseded;
- every factual statement cites an available source;
- quantities and measurements in a factual statement appear in the cited evidence;
- citation page, sheet, revision, region, and coordinates came from the source index;
- unsupported factual statements are removed before presentation;
- presence or absence claims must match the requested subject, location, and feature; ambiguous alternatives and unrelated field updates are rejected;
- internal evidence identifiers are removed from all user-facing statements;
- conflicts and extraction limitations reduce confidence or produce an insufficient-evidence answer.

ECOS Core does not approve its own work.

## Drawing measurements and calculated answers

- Area and square-foot questions are measurement questions; a statement that merely identifies the drawing is not an answer.
- ECOS may calculate a rectangular plan footprint only when one current sheet supplies two clear overall dimensions. The displayed proof includes both dimensions, the formula, and the result.
- Construction-note evidence may join a sheet title/location to a measured note on the same page, but it may not combine unrelated measurements from different sheets.
- A drawing verifies what the design specifies. Questions worded as installed, placed, or poured receive the design value plus an explicit limitation that field/as-built evidence is required to verify the actual installation.

## Privacy, cost, and storage behavior

- No full PDF is sent to the answer provider. During indexing, one bounded drawing-page image at a time may be sent through the authenticated drawing-analysis function; only structured page facts and proof coordinates are retained in the searchable index.
- The original Google Drive or protected document remains the source file.
- Only small, relevant text excerpts and source labels are sent for a submitted question.
- A question creates no project/task/update mutation.
- The provider request occurs only after the user presses **Ask ECOS**.
- The operation ledger stores a small answer payload temporarily for idempotency; it does not duplicate drawing files.

## Field acceptance test

Ask a question whose answer is visible in a known current drawing, then confirm:

1. the selected project is correct;
2. the answer uses the same measurement or requirement shown in the drawing;
3. the Proof section names the correct current document and revision;
4. the sheet/page is correct;
5. the excerpt visibly contains the answer;
6. tapping document proof opens the evidence view or the current source document;
7. asking about information absent from all current sources returns **ECOS could not verify an answer**;
8. a superseded drawing does not appear as proof;
9. tasks and field updates remain unchanged after asking;
10. Guided Talk still opens its entry workflow and does not become the question-answer screen.
