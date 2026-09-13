# Ask ECOS Agent Brain V1

## Goal

Ask ECOS remains the interface inside Vitruvius. A server-side, read-only agent becomes the research and reasoning layer. It may inspect authorized project records repeatedly, but it may not change project data. ECOS Assurance remains a separate deterministic gate that rejects unsupported claims and citations.

## Verified starting point

The sealed customer-path candidate used for this branch follows a one-pass flow:

1. Authorize the signed-in owner and selected project.
2. Capture the current project evidence manifest.
3. Gather one question-specific evidence dossier.
4. Make one Responses API request with the dossier embedded in the prompt.
5. Run deterministic ECOS Assurance over the proposed answer.

This is retrieval-augmented generation, but it is not an agent. The model cannot decide that the first search was incomplete, search again with different wording, open a particular source, or compare records before answering.

## First isolated implementation slice

This branch adds a provider-facing agent loop and connects it to the existing candidate behind the disabled `ECOS_AGENT_MODE=private_read_only_v1` switch.

The private agent receives five authorized tools:

- `inspect_project_evidence_inventory`: reports which evidence channels are available or limited. Inventory metadata cannot authorize an answer.
- `search_project_evidence`: searches the stable, project-scoped evidence snapshot using new wording and optional source-type filters. Exact returned sources can authorize a cited answer.
- `search_current_project_documents`: runs at most one additional authorized semantic, lexical, metadata, and exact-page search across the complete set of current project documents, and only when the stable snapshot has no responsive document evidence. Exact returned sources can authorize a cited answer.
- `open_project_evidence`: opens exact evidence records returned by search for a focused reread or comparison; it is not a ceremonial duplicate requirement after an exact search result has already been read.
- `list_project_schedule_activities`: filters and sorts the complete authorized schedule snapshot. It returns every match up to a fixed 25-row safety cap so the model cannot make a complete list incomplete by choosing a small limit.

The loop enforces:

- server-side provider credentials;
- an allowlist of read-only tools;
- strict tool argument schemas;
- a model-turn, tool-call, elapsed-time, tool-time, tool-output, and model-output budget;
- deterministic reuse of identical tool results within one run;
- sanitized diagnostics that record tool name, status, duration, and output size without recording project content;
- mandatory evidence-producing research before an answer may be accepted;
- a post-research manifest check that rejects the run if the current document evidence changed while the agent was working;
- expanded evidence receipts that include every unique source returned or opened during agent research;
- the existing structured answer contract;
- the existing ECOS Assurance verification after the agent finishes.

The orchestration mode is included in the question fingerprint so an agent run cannot replay an answer produced by the predecessor one-pass path.

For bounded schedule intents, the final response is now projected deterministically from the structured schedule records selected by the research path. Exact task schedule/status, complete in-progress lists, earliest next work, and recorded dependency checks always preserve task identity and required fields. “Next work” evaluates the complete authorized schedule snapshot, even when more than 25 future activities exist, and cites only the earliest activity or tied activities. An empty dependency list is reported only as “not recorded” and never as proof that no real-world predecessor or critical-path constraint exists.

## What is deliberately unchanged

- The feature is disabled by default.
- No production, gateway, database, web, iPhone, or iPad deployment is part of this slice.
- The current customer path remains one-pass.
- The agent cannot write tasks, documents, schedules, notes, updates, inspections, or any other project record.
- Existing project authorization and evidence-manifest checks remain ahead of the model call.
- Existing citation and Assurance behavior remains after the model call.

## Known limitations before private field testing

The agent can now search the complete current-document corpus beyond the passages selected by the original retrieval. Results are merged into the sealed evidence receipts used by the final deterministic Assurance check. This closes the first-search-only limitation, but the current-document tool still relies on the existing indexing, extraction, search, and source-opening quality. Missing or incorrectly extracted pages remain missing evidence rather than something the agent can repair at question time.

The following capabilities still need implementation:

1. Dedicated read tools for RFIs, submittals, inspections, requirements, schedule relationships, photos, and completion/acceptance records that are not yet represented consistently in the current evidence model.
2. Persisted conversation state bound to the owner, selected project, evidence epoch, and current source versions.
3. An asynchronous run/progress interface for web, iPhone, and iPad.
4. A user-centered evaluation set that starts from real app wording and identical app requests rather than privileged validator-only requests.
5. A blind provider comparison after the Vitruvius tools and evaluation path are stable.

## Required acceptance gates

Before customer activation, the agent path must demonstrate:

- no cross-owner or cross-project evidence access;
- no answer without an evidence-producing tool call;
- no factual claim without a current, openable source;
- deterministic refusal when evidence is missing or conflicting;
- correct separation of drawing requirements, reported completion, and documented acceptance;
- repeatable results for natural-language paraphrases, accents after transcription, common construction vocabulary, and misspellings;
- identical behavior through the actual web, iPhone, and iPad request path;
- bounded latency and cost with explicit timeout and partial-research messages;
- durable diagnostic receipts for model turns, tool outcomes, Assurance decisions, and source-opening failures;
- automatic restoration to the current safe path during any private deployment failure.

## Model selection experiment

Luna, Terra, and Sol are all available through the Responses API and support function calling and structured output. This branch includes a provider-neutral evaluation harness for `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`.

Every model must receive the same cases, evidence epoch, tools, limits, reasoning effort, and repetition count. The harness records correctness, openable citations, safe refusal, project isolation, answer fingerprint repeatability, latency, tool calls, token usage, and estimated API cost. A cheaper model cannot be recommended unless it first clears the same accuracy, citation, refusal, isolation, and repeatability thresholds. At least one answerable case and one missing-evidence case are required before any model can be recommended.

The candidate accepts a per-request model override only for protected shadow-validation requests carrying the server-side worker credential, and only for the three approved model ids. Each protected comparison request also requires a fresh evaluation-attempt id. Customer requests cannot choose or inject a provider model. The selected model and evaluation-attempt id are part of the idempotency fingerprint, preventing one model's answer from being replayed as another model's result while still allowing controlled repeatability trials.

The first useful comparison should use real user wording through the private customer path. It should not use a special validator prompt or give any model privileged evidence. Run one complete pass across all models first; only run additional repeats after the case set and scoring evidence are verified.

## Private runtime boundary

The first hosted comparison proved that a complete multi-turn research loop is too large for one Supabase Edge Function request. Six attempts completed, but the seventh and several retries were terminated with the platform's worker resource-limit response. This is an execution-placement defect, not evidence that a particular model answered incorrectly.

The bounded repair keeps Supabase as the credential and data authority while moving the stateful research loop to a dedicated Cloud Run preview service:

1. The private Cloud Run endpoint requires a separate gateway token in addition to the original signed-in user token and worker credential.
2. The existing candidate handler still authenticates the user, verifies project ownership, reserves capacity, loads only authorized project evidence, runs Assurance, and persists sanitized diagnostics.
3. Embeddings are obtained through the existing protected Supabase embedding bridge, so the provider key is not copied into Cloud Run.
4. Each individual model turn is sent through a new protected Supabase model bridge. The bridge accepts only the three evaluation models, the bounded Responses request shape, service-role authentication, and the server worker credential.
5. The agent loop, tool transcript, and repeated research run in the 2 GiB Cloud Run process rather than accumulating inside one Edge worker.
6. The preview service has no customer routing or app reference. Its immutable packaged-source hash is verified at startup and returned on every response.

This split is deliberately private. It does not activate the agent for web, iPhone, or iPad users; it only creates a realistic place to finish the blinded provider comparison without the known Edge resource ceiling.
