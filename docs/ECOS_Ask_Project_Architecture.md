# Ask ECOS — Project Question Architecture

## Purpose

Ask ECOS is the one read-only project-question experience on web, iPhone, and iPad. For an audience allowed to use Ask ECOS, the primary assistant control on every device opens the same authenticated question client and the same hosted function. The older project-actions workflow remains available only where Ask ECOS is disabled; it is not an alternate Ask ECOS answer path.

Example:

> How thick is the new concrete on the north side of 2375?

The answer must state the verified fact, label any inference or recommendation separately, and identify the exact task, update, document revision, sheet/page, excerpt, and drawing region used as proof.

## Reliability implementation — seven required steps

1. **One path on every device** — `ECOSQuestionProtocol` builds one versioned request with a unique client request id and exact client surface. `ECOSProjectQuestion` is the only app invocation boundary. Web, iPhone, and iPad use it, and all user-facing primary controls are named **Ask ECOS**.
2. **Private trace for every valid question** — the hosted function records stage timing, source counts, runtime identity, result code, client request id, snapshot id, and dossier id. It stores hashes rather than raw questions, answers, prompts, or source excerpts.
3. **Stable Project Evidence Snapshot** — before answering, ECOS inventories and hashes the selected project, tasks/schedule, field updates and photo intelligence, field notes, current documents, and hosted index/publication identity. It reads the evidence, rechecks the manifest, retries once on drift, and refuses safely if the project changes again.
4. **Hybrid natural-language retrieval** — question-only cleanup handles common speech, misspellings, abbreviations, and construction synonyms without rewriting source evidence. Retrieval combines exact structured matching, lexical/fuzzy document search, verified metadata, and vector similarity over the current immutable document chunks. The semantic index must be complete before a shadow index may become ready.
5. **Sealed Evidence Dossier** — the candidate and selected evidence set is hashed and saved before model composition. The model receives the exact sealed dossier, project identity, normalized question, and assurance requirements; it does not receive unrestricted project storage.
6. **One composition call plus deterministic proof checking** — the answer path has one generative Responses API boundary. ECOS Assurance then checks source identity, quantities, subject/location relevance, revisions, citations, drawing geometry, conflicts, and installed-versus-design limits. Unsupported clauses are removed or the result becomes insufficient evidence.
7. **End-user reliability gate** — the two 34-question project suites remain mandatory. A separate 90-attempt user-language matrix exercises real reported wording, typos, speech-like phrasing, synonyms, trade vocabulary, calculations, cross-document answers, and safe refusals over three repeats. Web, iPhone, and iPad must each use the unified path and open cited proof. All attempts must pass with unique persisted traces and p95 latency no greater than 60 seconds.

## Request flow

1. The user selects one synchronized project and asks by voice or keyboard.
2. The client verifies the signed-in session, rejects obvious cross-project references, assigns request and surface identity, and invokes `ecos-ask-project`.
3. The function authenticates the owner and project, captures the evidence manifest, retrieves current evidence, and verifies that the manifest did not change.
4. It persists the snapshot and dossier receipts before any answer is composed.
5. The single composition call proposes structured facts, limitations, conflicts, recommendations, and citations from the dossier.
6. Deterministic Assurance accepts only claims supported by the exact dossier and returns the verified answer or a safe refusal.
7. The app validates the response and trace contract, presents proof, and lets the user open the cited current document/page/region.

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
10. Web, iPhone, and iPad show **Ask ECOS**, submit through the same protocol, and return a unique persisted trace for the attempt.
