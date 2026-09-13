# Ask ECOS Quality-First Model Routing Plan

Status: retained beta-readiness workstream  
Date: 2026-09-10

## Governing decision

Ask ECOS will use a server-side router, but model assignment will be earned by measured end-user performance for each activity. The decision order is:

1. Answer correctness and evidence completeness.
2. Openable, exact citations and safe handling of missing or conflicting evidence.
3. Owner and project isolation.
4. Repeatability and operational reliability.
5. A hard response-time ceiling for beta eligibility.
6. Cost among models that clear every quality, safety, and response-time gate.
7. Response time and tool use only as final tie-breakers after cost.

A lower-cost model may replace a stronger model only after it clears the same quality, safety, citation, isolation, and repeatability gates for that activity. Cost is a secondary optimization, never permission to lower answer quality.

## Architecture retained from the review handoff

The proposed tiered architecture is retained with one correction: model roles remain provisional until activity-specific tests prove them.

```text
User question in Ask ECOS
  -> backend authorization and project binding
  -> deterministic request classification and evidence inventory
  -> authorized project tools and evidence dossier
  -> quality-based model routing
  -> additional tool research when needed
  -> deterministic citation and Assurance validation
  -> answer, supported limitations, or safe refusal
  -> sanitized diagnostics, quality outcome, latency, and cost record
```

The user stays in Vitruvius. Provider credentials and model selection stay on the server. Model names are not exposed in the normal product experience.

## Provisional roles

### Tier 0: deterministic application code

Use code, database functions, and project tools rather than a generative model for:

- owner authentication and project authorization;
- document, drawing, schedule, task, inspection, RFI, and update inventories;
- exact record retrieval and source opening;
- verified arithmetic over exact structured inputs;
- citation validation, evidence-epoch checks, capacity limits, and budget enforcement;
- final isolation, freshness, and unsupported-claim gates.

These controls are never delegated to Luna, Terra, or Sol.

### Tier 1: Luna qualified bounded roles and candidate support roles

Luna is a candidate for inexpensive, bounded, non-authoritative work:

- intent and activity classification;
- construction-vocabulary, accent-transcript, misspelling, and paraphrase expansion;
- suggested source-type filters and search-query generation;
- document classification and metadata enrichment proposals;
- candidate summaries that are never shown as factual answers without stronger verification.

Luna is qualified for bounded exact drawing/specification lookup, schedule status and dependencies, task/update/photo research, document source discovery, missing-evidence refusal, controlled conflict reasoning, the five bounded cross-document synthesis intents, controlled inspection/closeout reasoning, and Activity 10 conversation/project-switching behavior when the corresponding deterministic projector or fixture boundary applies. It is not approved for unbounded cross-document recommendations. Each proposed support role and each additional answer activity needs its own labeled evaluation before activation.

### Tier 2: Terra provisional default

Terra remains the qualified model for natural-language drawing lookup and a provisional research candidate for activity classes where it completes the full quality gate, including:

- direct drawing and specification lookup;
- natural-language variants of known construction questions;
- bounded multi-document comparisons with clear supporting evidence;
- ordinary project-status questions with explicit records;
- safe refusal where the requested fact is absent.

This is provisional until the broader activity suite is complete. Terra does not win an activity merely because it is faster when Luna has equal quality, both meet the response-time ceiling, and Luna is materially less expensive.

### Tier 3: Sol quality escalation candidate

Sol is the candidate escalation model for harder activities where tests show a material quality gain, such as:

- conflicts between drawings, specifications, RFIs, schedules, inspections, and field updates;
- questions requiring many sources or several research passes;
- schedule dependency, critical-path, and completion-risk analysis;
- compliance, inspection acceptance, and sign-off synthesis;
- recommendations that must distinguish required work, reported completion, and documented acceptance;
- low-confidence Terra results, unresolved evidence conflicts, or exhausted Terra research budgets.

Sol is not automatically the primary model. It becomes the model for an activity only when blinded head-to-head testing proves better correctness, evidence use, citation quality, safe refusal, or repeatability than Terra.

## Evidence available today

The first private 12-case-per-model comparison used the same case families and bounded tools. It is useful directional evidence, but it is too small to establish final production routing.

| Model | Answer gate | Answer repeatability | Exact-region proof | Average latency | P95 latency | Mean tool calls | Estimated batch cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Terra | 12/12 | 91.67% | 83.33% | 17.57 s | 27.736 s | 1.583 | $0.405698 |
| Sol | 12/12 | 91.67% | 91.67% | 29.382 s | 54.989 s | 2.750 | $1.535137 |
| Luna | 12/12 | 75.00% | 58.33% | 27.749 s | 37.059 s | 2.833 | $0.075647 |

Subsequent Terra-only proof repairs improved the focused six-case page-proof result to 6/6 and the final two natural-language cases to 2/2 with repeatable status and exact proof. A fresh atomic 12-attempt qualification of runtime commit `94a7815` then passed every answer, citation, refusal, and isolation gate. All six question families repeated the same cited pages and exact regions, so proof repeatability was 100%. The combined outcome score remained 91.67% because the Canopy A result changed from `verified` to `verified_with_limits` while retaining identical proof. That status variation is a separate product-consistency defect and is not a proof-selection failure.

The deterministic Canopy A limitation repair was then qualified on private runtime commit `d46bcc0`. Its fresh atomic two-pass run completed 12/12 with 100% combined outcome repeatability, proof repeatability, exact-region repeatability, assurance-status repeatability, citation openability, safe refusal, and project isolation. All 12 traces and evidence dossiers were fresh, the temporary owner session was revoked, and there were no integrity failures. Mean latency was 20.957 seconds, P95 latency was 33.877 seconds, mean tool use was 1.917 calls, and estimated cost was $0.494666 for the batch.

A subsequent 30-attempt natural-language head-to-head used the same five concrete-thickness wordings twice for every model. Terra passed 10/10 answer gates, Sol passed 10/10, and Luna passed 9/10. Terra was the strongest overall candidate in this activity at 22.070 seconds mean latency and $0.555604 estimated batch cost, compared with Sol at 27.694 seconds and $0.931569 and Luna at 34.843 seconds and $0.072398. However, no model qualified under the corrected release gate: Terra had 70% exact-region repeatability, Sol had 80% exact-region and assurance-status repeatability, and Luna had 60% exact-region repeatability plus one scoped measurement leak. The run also exposed an evaluator defect that had incorrectly allowed exact-region and status instability to remain eligible. The gate now requires 100% page-proof, exact-region, assurance-status, and combined-outcome repeatability for the sealed critical comparison, plus P95 latency no greater than 60 seconds.

The first repair removed the scoped measurement leak and a fresh private head-to-head completed 30/30 answer gates. Terra remained the strongest provisional candidate: 10/10 answers, 100% page-proof and Assurance-status repeatability, 19.823 seconds mean latency, 29.298 seconds P95 latency, and $0.407560 estimated batch cost. Luna passed 10/10 at $0.068908 but retained 70% exact-region and 90% outcome/status repeatability. Sol passed 10/10 at $1.198837 but retained 70% exact-region and 80% outcome/status repeatability. Terra still had only 80% exact-region repeatability, so no model qualified.

The persisted private traces isolated the remaining shared product cause. The deterministic measurement fact and page were stable, but model-written duplicate measurements sometimes survived when the unit was a straight or smart inch mark. The answer assembler then expanded one exact structured proof into six to twelve model-dependent regions from the same page. The evaluator also measured outcome/page stability without separately requiring byte-identical answer fingerprints. The bounded repair recognizes symbolic units, uses stable tie-breaking for equal deterministic facts, replaces all model-proposed facts when a complete deterministic measurement answer exists, cites only the exact selected measurement proof, and requires 100% answer-fingerprint repeatability for the sealed critical comparison.

The repaired private candidate `24e1020` then completed a fresh 30-attempt comparison with 30/30 answer gates, zero integrity failures, 30 unique traces, 30 unique evidence dossiers, and verified temporary-session revocation. Every result contained one deterministic fact and one exact citation. Terra qualified for the natural-language drawing-lookup activity with 100% answer, page-proof, exact-region, Assurance-status, citation, and project-isolation repeatability; mean latency was 20.117 seconds, P95 latency was 35.274 seconds, mean tool use was 1.9 calls, and estimated cost was $0.306516 for ten attempts. Luna and Sol also returned ten correct answers with identical answer and proof fingerprints, but they did not qualify because their Assurance outcome/status repeatability remained 80%/80% and 70%/70%, respectively.

The first private schedule comparison then ran five representative questions twice through every model. All 30 requests completed with stable evidence, fresh trace and dossier identities, zero integrity failures, and verified session revocation, but no model qualified: Luna passed 4/10, Terra 3/10, and Sol 2/10 under the strict first-pass gate. The run exposed one evaluator false positive and a shared product defect more important than provider choice. Models could request an arbitrarily small schedule result limit, omit members of an 11-row in-progress set, and drop required task identity, location, or snapshot context while composing a supported answer. The bounded repair makes schedule retrieval complete up to a fixed 25-row response cap and deterministically assembles exact-task dates and status, complete in-progress lists, earliest next work, and recorded dependency answers from structured authorized records. The second 30-attempt run passed 24/30: all three models passed the other four schedule intents twice, while all six “next work” attempts failed because more than 25 future activities at the requested location caused the deterministic projector to defer to model prose. The follow-up repair evaluates the complete authorized schedule internally for “next work” and cites only the earliest activity or tied activities. The model remains responsible for research planning; deterministic code now owns completeness and mandatory proof fields for these exact schedule intents.

The sealed `f61f6fe` schedule qualification then completed all 30 attempts with stable evidence, 30 fresh traces, 30 fresh evidence dossiers, zero integrity failures, and verified temporary-session revocation. All 30 answers were factually correct and all six repaired “next work” cases passed. Luna and Terra each passed 10/10 with 100% citation, project isolation, answer/proof repeatability, and P95 latency below 60 seconds. Luna is the schedule-activity recommendation because quality was equal while its P95 latency was 26.461 seconds and estimated ten-attempt cost was $0.020817, versus Terra at 50.749 seconds and $0.135948. Sol passed 9/10 under the release gate because one correct in-progress answer took 70.407 seconds; its P95 was 70.407 seconds and estimated cost was $0.308508. The batch receipt is `/private/tmp/ecos-agent-schedule-comparison-f61f6fe-20260911T035941Z.json` with SHA-256 `31480874a6e4fa2f76b2ca7006e4244bdff8dcfa40470c285360ecd998e13191`.

The first task/update/photo comparison on candidate `3300210` completed all 30 requests but passed only 18. Six failures were evaluator false negatives caused by comparing a canonical `YYYY-MM-DD` answer with a full source timestamp. The other six exposed a product defect: the trusted field-note record carried its update time in metadata, but the evidence excerpt omitted that timestamp, so ECOS Assurance correctly rejected the deterministic answer. Candidate `6da135d` repairs both boundaries by carrying the exact field-note update time into the evidence excerpt and accepting an exact canonical date when the trusted source value is a timestamp.

The sealed `6da135d` task/update/photo qualification then passed 30/30 with 30 fresh traces, 30 fresh evidence dossiers, a stable action-time fixture, zero integrity failures, and verified temporary-session revocation. Luna, Terra, and Sol each passed 10/10 with 100% answer, citation, project-isolation, and repeatability scores. The original runner incorrectly ranked latency and tool use before cost at equal quality. Under the corrected `quality_then_cost_within_slo_then_latency/1.0` policy, Luna is the recommendation because its estimated ten-attempt cost was $0.012590 and its 35.919-second P95 latency remained below the 60-second ceiling. Terra measured $0.105625 with 30.056-second P95 latency; Sol measured $0.324029 with 33.512-second P95 latency. The raw batch receipt is `validation/output/ecos-agent-private-progress-comparison-6da135d-20260911.json` with SHA-256 `bf749df8dac7d104cc0bb5e46364ff7e3fab92855721cc0835890c479c1e7f24`; the immutable derived selection receipt has SHA-256 `f0db8b762837dc5790afb068e5b1c69a3705bd6b17aa56020a8ad55a5e15ce91`.

The document-classification/source-discovery comparison exposed a shared product defect before provider selection: the 2321 hazardous-material canopy plan-set question used weak referral OCR instead of the exact current high-resolution A-1.5 and A-1.5A regions. Candidate `8c7bb05` adds a bounded plan-set resolver that requires a unique canopy-plan sheet and a distinct unique hazardous-material or containment sheet and fails closed on ambiguity. The repaired two-repetition run completed 30 attempts with stable evidence, 30 fresh traces, 30 fresh evidence dossiers, zero integrity failures, and verified temporary-session revocation. Luna and Sol each passed 10/10 with 100% citation, isolation, safe-refusal, and answer/proof repeatability. Luna is the quality-first recommendation because quality was equal while its mean latency was 25.556 seconds, P95 latency was 33.128 seconds, and estimated ten-attempt cost was $0.032156, versus Sol at 27.494 seconds, 43.286 seconds P95, and $0.600457. Terra was not eligible: it passed all answer and proof checks but one response took 98.305 seconds, above the 60-second beta ceiling. The batch receipt is `/private/tmp/ecos-agent-private-source-discovery-comparison-8c7bb05-two-repetition-20260911.json` with SHA-256 `aaec9c05c8bcf4c3a5de4f219b32b20f23bbee41c3bc47b67f35a38e814902d4`.

The first exact drawing/specification comparison passed all 30 individual checks but failed cross-run repeatability because deterministic facts were appended to variable model prose, proof selection expanded differently between runs, model-authored limitations changed Assurance status, and the natural "How much air does EF-1 move" wording did not enter the airflow resolver. Candidate `2738c2d` makes the bounded concrete-area, canopy-lighting, and equipment-airflow resolvers own their exact answers and proof, makes high-resolution source choice deterministic, suppresses unrelated model prose for those owned results, and recognizes ordinary airflow wording. Its fresh two-repetition private run passed 30/30 with 30 unique traces and evidence dossiers, stable evidence and runtime, zero integrity failures, verified session revocation, and 100% answer, proof, exact-region, Assurance-status, citation, isolation, and cross-run repeatability for Luna, Terra, and Sol. Luna is the exact drawing/specification recommendation at equal quality because its ten-attempt cost was $0.033193, versus Terra at $0.249963 and Sol at $0.628096; Luna's mean latency was 22.062 seconds and P95 latency was 42.819 seconds, below the 60-second ceiling. The batch receipt is `/private/tmp/ecos-agent-exact-drawing-comparison-2738c2d-two-repetition-20260911.json` with SHA-256 `39eb20e33f4df282dd9099bffb371a81e2db3112387a892332845381a23f2a28`.

The first missing-evidence comparison completed all 30 attempts across five cases, three models, and two repetitions with stable evidence and runtime, 30 fresh traces, 30 fresh dossiers, zero integrity failures, and verified temporary-session revocation. It passed 29/30 individual evaluator gates but qualified no model. All three models safely preserved the planned count while refusing to claim that all 78 trees were installed, yet the same case produced model-dependent extra facts, prose, Assurance output, and proof regions between repetitions. Luna and Terra each passed 10/10 individual gates but had only 90% repeatability; Sol passed 9/10 because one otherwise safe attempt took 63.403 seconds and also had 80% answer repeatability. The receipt is `/private/tmp/ecos-agent-missing-evidence-comparison-b580664-two-repetition-retry-20260911.json` with SHA-256 `56fb09444e15f047ab39292c2db0850467c8b6ed4ddacfbcad7d1b0ee9668549`.

The bounded repair makes a drawing-only installed-quantity conclusion own the final answer and exact proof whenever no accepted field-condition fact exists. It discards model-selected adjacent facts, limitations, conflicts, and suggestions for that owned response; preserves accepted positive or negative field evidence; and does not mistake an update that merely repeats the plan for proof of installation. It also resolves equal-score drawing proof by stable source identity rather than retrieval order. The repaired code passes the complete 152-test Deno suite and all six available server-side reliability contracts.

The sealed `7510786` missing-evidence requalification then completed all 30 attempts with stable evidence and runtime, 30 fresh traces, 30 fresh dossiers, zero integrity failures, verified session revocation, and exact restoration of both private services after the batch. Luna and Terra each passed 10/10 with 100% safe refusal, openable citations, project isolation, answer/proof/exact-region/Assurance-status repeatability, and P95 latency below 60 seconds. Luna is the missing-evidence recommendation because quality was equal while its estimated ten-attempt cost was $0.048972, versus Terra at $0.400610. Luna's mean latency was 27.991 seconds and P95 latency was 37.081 seconds; Terra measured 27.093 seconds mean and 44.216 seconds P95. Sol is not eligible: one otherwise safe attempt took 76.173 seconds, producing a 9/10 gate result and 90% repeatability. The batch receipt is `/private/tmp/ecos-agent-missing-evidence-comparison-7510786-two-repetition-20260911.json` with SHA-256 `1ca76eee272200b40b5d4f7a4b8c1ee20ae448491eebc25da9c709bc5006ffc9`.

The sealed `a0230d6` controlled conflict qualification then completed all 30 attempts across five conflict families with 30 fresh traces, 30 fresh evidence dossiers, a stable project-state snapshot, zero fixture records persisted in customer project tables, zero integrity failures, and verified temporary-session revocation. Luna, Terra, and Sol each passed 10/10 with 100% answer, exact two-source conflict proof, project-isolation, and answer/conflict/proof/Assurance-status repeatability. Under the corrected quality-first, cost-second policy, Luna is the recommendation because all three models remained below the 60-second P95 ceiling while Luna cost $0.012040 for ten attempts, versus Terra at $0.092481 and Sol at $0.221641. The raw receipt is `/private/tmp/ecos-agent-private-conflict-comparison-a0230d6-20260911.json` with SHA-256 `892047122e4803bc5b6eda0d37cdb05bb4006cb355725aee73adde5b1997a2e3`; the derived selection receipt has SHA-256 `cdcaeeaaa3bd3769e58728b66a69c539e0f6dd4c7b144b86f837fe4ea217e02f`. This controlled fixture qualifies conflict reasoning but does not replace the final real customer-path citation-opening gate.

The first cross-document synthesis batch on candidate `94ab0e0` completed all 15 attempts but exposed one shared hazardous-canopy retrieval and composition defect: Luna failed closed despite responsive A-1.5A evidence, Terra omitted a substantive hazardous-material requirement, and Sol supplied the strongest substantive answer while two phrase-exact evaluator checks misclassified its equivalent limitations. Candidate `a3c41f269cee7c2b6017a10cd790d7be3340695c` adds canonical read-only research for that bounded intent, requires exact A-1.5A plan identity and both containment assignments before answering, composes only facts supported by the cited excerpts and citation metadata, and reports schedule, field-progress, and inspection-acceptance limits separately. Two fresh private cycles then passed 30/30 with 30 fresh traces and dossiers, unchanged project state, verified session revocation, and one identical answer, proof, and Assurance-status fingerprint for each of the five cases across both cycles and all models. Luna, Terra, and Sol each passed 10/10 below the 60-second P95 ceiling. Luna is the recommendation at equal quality: its estimated ten-attempt cost was $0.082367 with 35.354-second mean and 43.924-second P95 latency, versus Terra at $0.505298 with 30.637-second mean and 41.969-second P95, and Sol at $1.211946 with 37.343-second mean and 48.087-second P95. The two receipts are `/private/tmp/ecos-agent-private-synthesis-a3c41f2-20260911.json` with SHA-256 `0d8f6378c0c7998dbf027669752680108b22d7043ad134b5259723635cfb3c67` and `/private/tmp/ecos-agent-private-synthesis-a3c41f2-repeat-2-20260911.json` with SHA-256 `9775622c5dbc372c668d31069bbff3604b1a5f6ac9eee194aa6b0e552ab61b25`. This qualifies only the five tested deterministic synthesis intents; free-form recommendations, dedicated inspection/closeout evidence, and conversation state remain separate gates.

The sealed `a57b041` inspection and closeout qualification completed 30/30 attempts across five controlled acceptance cases, all three models, and two fresh repetitions. All 30 traces and evidence dossiers were unique; no fixture record persisted in customer tables; the project-state snapshot remained unchanged; the short-lived owner session was revoked; and answer, proof, Assurance status, citation opening, and project isolation were 100% repeatable. Luna, Terra, and Sol each passed 10/10 below the 60-second P95 ceiling. Luna is the recommendation at equal quality because its estimated ten-attempt cost was $0.011382 with 14.025-second mean and 23.727-second P95 latency, versus Terra at $0.097183 and Sol at $0.245818. The receipt is `/private/tmp/ecos-agent-private-acceptance-a57b041-20260911.json` with SHA-256 `aae861ec4a6b5400b32328d372e05248dfbc73de5060ee34c8eadc0fcc0eea98`. This controlled fixture qualifies dedicated acceptance and closeout reasoning; real customer-path source opening remains required before beta exposure.

The end-user language layer now contains 50 unique questions: five variants for each of ten sealed evidence families. It includes the user's exact wording, conversational alternatives, construction synonyms, abbreviations, speech-like wording, and misspellings. A separate 50-case specification now covers all ten activity classes, including schedules, task and field-update synthesis, source discovery, conflicts, recommendations, inspections and closeout, conversation follow-ups, and project switching. Any case that still needs a controlled fixture or action-time snapshot is explicitly blocked rather than counted as passed.

Current interpretation:

- Luna is qualified as the primary model for exact drawing and specification lookup when a bounded deterministic resolver owns the answer and proof. This does not qualify Luna for unbounded drawing synthesis, conflicts, recommendations, or closeout decisions.
- Terra is qualified as the primary model for the natural-language drawing-lookup activity. This does not qualify Terra for schedules, cross-document synthesis, recommendations, closeout, conflicts, or every Ask ECOS activity.
- Luna is qualified as the primary model for the bounded schedule-status-and-dependencies activity when deterministic schedule projection applies. This does not qualify Luna for drawing lookup, cross-document synthesis, recommendations, closeout, conflicts, or every Ask ECOS activity.
- Luna is qualified as the primary model for task, field-update, progress-photo, open-issue, and task-completion-boundary research when the deterministic progress projector applies. This does not qualify Luna for inspection acceptance, closeout, or cross-document recommendations.
- Luna is qualified as the primary model for document classification and source discovery when the bounded current-document inventory and deterministic source-selection rules apply. This does not qualify Luna for drawing facts, conflicts, cross-document recommendations, or closeout decisions.
- Luna is qualified as the primary model for the bounded missing-evidence and incomplete-search refusal activity. It may preserve an exact supported design fact while explicitly refusing the unsupported field-condition claim. This does not qualify Luna for conflict resolution, recommendations, inspection acceptance, or closeout decisions.
- Luna is qualified as the primary model for the controlled conflicting-and-superseded-records activity. All three models matched quality; Luna won on cost within the latency ceiling. Real customer-path source opening remains required before beta exposure.
- Luna is qualified as the primary model for the five bounded cross-document status, risk, planning, hazardous-canopy, and overdue-without-update synthesis intents. All three models matched quality and repeatability; Luna won on cost within the latency ceiling. This does not qualify unbounded recommendations or dedicated inspection/closeout decisions.
- Luna is qualified as the primary model for the five controlled inspection, acceptance, closeout-document, and sign-off-readiness intents. All three models matched quality and repeatability; Luna won on cost within the latency ceiling. Real customer-path source opening remains a separate beta gate.
- Sol remains the escalation candidate and should be tested specifically on complex synthesis and closeout cases; it did not produce a quality gain in the controlled conflict comparison.
- Luna's low cost never compensates for a quality deficit. Use it only for the activities it independently qualified for and keep its other roles provisional until separately qualified.
- No result yet supports a single-model-for-everything design.

## Activity-level evaluation matrix

Every routing decision must be based on representative questions submitted through the same request shape an end user uses. Each activity is scored separately:

1. Exact factual drawing and specification lookup.
2. Natural language, accents after transcription, alternate trade vocabulary, abbreviations, and misspellings.
3. Schedule status, dependencies, critical path, milestones, and remaining work.
4. Task, field-update, progress-photo, and completion summaries.
5. Document classification, metadata enrichment, and search-query generation.
6. Conflicting or superseded records and governing-source selection.
7. Cross-document project status, risks, and recommendations.
8. Missing-evidence and incomplete-search refusal.
9. Inspection, compliance, closeout, and sign-off readiness.
10. Follow-up questions, project switching, and conversation-context preservation.

For each activity, Luna, Terra, and Sol receive identical authorized tools, evidence versions, wording sets, limits, and scoring. Runs must include clean questions, real user wording, paraphrases, speech-transcription variants, typos, missing evidence, conflicting evidence, and attempts to cross project boundaries.

## Beta admission gates

An activity is eligible for beta routing only when the selected model and the complete customer path meet all applicable gates:

- 100% owner and project isolation;
- 100% openable citations for factual claims;
- zero unsupported factual claims;
- 100% safe refusal on the sealed missing-evidence and conflict cases;
- 100% correctness on critical construction, compliance, inspection, and safety cases;
- at least 95% correctness on the broader representative user-wording set, with no unresolved systematic failure family;
- at least 95% answer-and-proof repeatability, and 100% on the sealed critical set;
- identical authorization, evidence, answer, and citation behavior through web, iPhone, and iPad;
- bounded execution time, tool calls, output, retries, and spend;
- durable sanitized diagnostics sufficient to reproduce routing, tool, citation, and failure decisions.

Passing privileged validator wording does not qualify an activity. At least one acceptance pass must use the actual application request path and wording captured from representative users.

## Routing and escalation rules

- Route by activity, evidence shape, and observed research state, not merely by question length.
- Start with deterministic tools whenever they can answer exactly.
- Preserve the complete authorized evidence dossier and tool transcript when escalating; do not restart retrieval and risk changing the evidence set.
- Escalate from Terra to Sol when there are material conflicts, multiple governing sources, complex dependency analysis, low evidence coverage, repeated search reformulation, or a validator signal that the answer is incomplete.
- Refuse safely if Sol cannot produce a fully supported answer within the bounded research budget.
- Never route around authorization, evidence freshness, citation, or Assurance controls.
- Record the resolved provider model, model configuration, evidence epoch, tool calls, answer fingerprint, validation outcome, latency, token use, and estimated cost for every evaluation run.

## Implementation sequence

1. Completed: the fresh atomic Terra qualification on private candidate `d46bcc0` passed 12/12 with every repeatability and safety gate at 100%.
2. Completed: two diagnostic head-to-head runs exposed model-dependent measurement phrasing, same-page proof expansion, symbolic-unit parsing, and a missing answer-fingerprint qualification gate. Candidate `24e1020` passed the fresh 30-attempt qualification and assigns Terra to natural-language drawing lookup.
3. Completed: candidate `f61f6fe` qualified Luna for bounded schedule status, exact-task schedule, complete in-progress-list, earliest-next-work, and dependency questions with deterministic schedule projection. The language layer has 50 unique questions with sealed drawing evidence, and the complete ten-activity layer has 50 specified cases. The required action-time snapshots and controlled conflict, acceptance, and conversation fixtures were frozen and verified by the later candidates recorded below.
4. Completed: candidates `6da135d`, `8c7bb05`, `2738c2d`, `7510786`, `a0230d6`, `a3c41f2`, `a57b041`, and `fbe26e7` qualified all ten activity classes, including conversation follow-ups and explicit project switching. The final Activity 10 OpenAI comparison passed 30/30 sequences and 60/60 questions across Luna, Terra, and Sol with 100% citations, isolation, and repeatability.
5. Assign a model only to activities where it clears every quality gate; use Sol as the fallback until a cheaper model proves equivalence.
6. Implement server-side routing and escalation behind a disabled private flag, preserving one evidence dossier across model transitions.
7. Add quality, latency, tool-use, and cost telemetry plus configurable owner and organization limits, then run private shadow evaluation and real web/iPhone/iPad customer-path acceptance before any beta exposure.

## Explicit non-goals for this workstream

- Do not optimize cost before quality gates pass.
- Do not let customers select models or supply provider keys.
- Do not make model output an authorization or citation authority.
- Do not cache answers across owners, projects, evidence epochs, source versions, or materially different normalized questions.
- Do not interpret one successful question family as evidence that the model is ready for all Ask ECOS activities.

## DeepSeek comparison after Activity 10

DeepSeek-V4-Flash-0731 is privately qualified for Activity 10 under the current
official API model name `deepseek-v4-flash`. Candidate `139faed` passed 10/10
two-turn sequences and 20/20 questions with 100% citations, isolation, and
answer-and-proof repeatability. It measured 6.383-second mean and 10.313-second
P95 latency at an estimated $0.0075776848 for the ten sequences. In the
like-for-like OpenAI batch, Luna measured 7.767-second mean, 14.596-second P95,
and $0.01384838; Terra measured 5.776-second mean, 12.079-second P95, and
$0.0995174; Sol measured 8.403-second mean, 22.424-second P95, and $0.2205828.
At equal measured quality, DeepSeek is the provisional quality-first candidate
for Activity 10 because its P95 latency and cost were also lowest. It remains
private and not customer-selectable until disabled server-side routing,
telemetry, shadow evaluation, and real web/iPhone/iPad acceptance pass. See
`ECOS_DEEPSEEK_PRIVATE_EVALUATION.md` for the provider contract and sealed
evidence.

## Decision checkpoint

The routing table becomes a release artifact, not a design assumption. After the activity matrix is complete, record for each activity:

- selected model and reasoning level;
- acceptable fallback and escalation model;
- measured correctness, citation, refusal, isolation, and repeatability;
- measured latency and cost;
- known unsupported evidence types or question classes;
- rollback threshold and safe user-facing failure message.

Until that checkpoint passes, all assignments in this document remain private and provisional.
