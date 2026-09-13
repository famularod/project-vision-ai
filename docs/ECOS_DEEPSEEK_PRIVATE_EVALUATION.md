# Ask ECOS DeepSeek Private Evaluation

Status: privately qualified for Activity 10 under zero customer traffic
Verified: 2026-09-11

## Provider identity

DeepSeek's current production Responses API model name is
`deepseek-v4-flash`. Its published model version is DeepSeek-V4-Flash-0731.
The undocumented `deepseek-flash` name and the experimental vision model
`deepseek-v4-flash-vision-exp` are intentionally not accepted by this text-only
comparison so evaluation receipts cannot silently change identity.

Primary references:

- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://api-docs.deepseek.com/guides/responses_api/
- https://api-docs.deepseek.com/guides/tool_calls/

Verified capabilities relevant to Ask ECOS:

- OpenAI-compatible Responses API at `https://api.deepseek.com/responses`;
- function tools and required/automatic tool choice, with the provider's
  documented thinking-mode compatibility limits enforced below;
- strict JSON output;
- stateless multi-turn input;
- native image input;
- 1M-token context and up to 384K output tokens.

Ask ECOS will not use those large provider limits. The existing smaller request,
tool, output, time, evidence, and spending limits remain authoritative.

## Isolated architecture

```text
private Ask ECOS evaluation request
  -> owner and selected-project authorization
  -> zero-traffic Cloud Run agent runtime
  -> provider selection by server-owned evaluation model
  -> OpenAI model bridge for Luna/Terra/Sol
     or separate DeepSeek bridge for deepseek-v4-flash
  -> same read-only project tools and evidence dossier
  -> same citation checks and ECOS Assurance
  -> sanitized comparison receipt
```

The app, browser, and Cloud Run runtime never receive the DeepSeek credential.
Only the dedicated authenticated Supabase Edge Function reads
`DEEPSEEK_API_KEY`. The bridge accepts service-role authentication plus the
server worker token, rejects browser origins, allows only `deepseek-v4-flash`, and
forwards only the bounded Responses request shape already used by Ask ECOS.

DeepSeek is not added to customer routing by this work. It is an evaluation
candidate only. Existing Luna/Terra/Sol defaults remain unchanged.

## Compatibility decisions

- Use `reasoning.effort = none` throughout this private comparison. A synthetic
  provider-only probe proved that V4 Flash rejects `tool_choice = required`
  when thinking is enabled (`400 Thinking mode does not support this
  tool_choice`). Ask ECOS must require at least one authorized research tool
  before answering. Keeping the full tool transcript in non-thinking mode is
  the smallest deterministic compatible path; provider thinking remains
  unavailable unless DeepSeek later supports required tool selection or a new
  separately validated orchestration strategy is introduced.
- Continue sending the complete stateless tool transcript on each turn.
- Continue to execute tools inside Vitruvius. DeepSeek proposes calls but never
  receives database, storage, or project credentials.
- Treat DeepSeek's ignored `parallel_tool_calls` flag as non-authoritative. The
  Vitruvius agent loop still applies its own tool-call cap and validates every
  requested tool before execution.
- Reject every incomplete provider response. The bounded OpenAI-specific
  `max_messages` exception does not apply to DeepSeek.
- Keep the same deterministic refusal, citation, evidence-epoch, owner, and
  project-isolation gates. Provider output cannot weaken them.
- Do not upload customer documents to DeepSeek's Files API for this comparison.
  All models receive the same authorized Vitruvius tool results so the test is
  like-for-like.

## Cost accounting

The evaluation uses the published peak prices as the conservative comparison
profile: $0.14 per million cache-miss input tokens, $0.0028 per million
cache-hit input tokens, and $0.28 per million output tokens. Routing must use
the current published price and reverify it at the decision checkpoint.

## Remaining setup before the first hosted call

1. Create a DeepSeek API account/key with enough funded balance for the private
   test.
2. Store that key as the Supabase Edge Function secret `DEEPSEEK_API_KEY`.
   Never paste it into source, chat, a client build, or Cloud Run.
3. Deploy `ecos-agent-deepseek-model-bridge` with JWT verification enabled and
   prove that an unauthenticated request receives `401`.
4. Deploy the reviewed runtime candidate at zero customer traffic with
   `ECOS_AGENT_DEEPSEEK_MODEL_BRIDGE_URL` pointing only to that bridge.
5. Verify the immutable image and packaged-source hashes and confirm baseline
   customer-private-preview traffic is unchanged.
6. Create one short-lived owner session, run a small diagnostic case, and revoke
   the session.
7. If transport and tool use are correct, run the complete Activity 10 DeepSeek
   comparison with the same cases, evidence, scoring, and two repetitions.
8. Compare quality first, then latency and conservative cost. Do not assign any
   routing role unless every applicable beta gate passes.

## Admission rule

DeepSeek may be considered for an Ask ECOS activity only after it independently
meets the same correctness, citation, safe-refusal, isolation, repeatability,
latency, tool-bound, and customer-path requirements applied to the OpenAI
models. A successful API connection or benchmark claim is not qualification.

## Private evaluation results

The corrected non-thinking transport completed a protected end-to-end conflict
diagnostic with three authorized tool calls, two evidence-producing calls, exact
citations, and project isolation. The first complete Activity 10 comparison then
passed 9 of 10 two-turn sequences. One repetition completed its research but
returned malformed final JSON; the same scenario passed on its second
repetition. Project state remained unchanged, no controlled fixture persisted,
and the temporary owner session was revoked.

That result is a reliability failure, not a qualifying score. The bounded
repair now validates final output inside the agent loop before the candidate
handler accepts it. It normalizes only a whole-response JSON fence, checks the
application answer schema, permits one tool-disabled format-repair turn using
only evidence already opened, and fails closed if the retry is still invalid.

The first in-loop repair passed the original failed scenario, but its fresh
complete batch again passed only 9 of 10 sequences. In the new failure, the
model used all four research turns and emitted malformed JSON on the final
fifth turn, leaving no budget for the repair turn. The follow-up repair now
reserves that repair turn separately from four possible research turns, so a
model that uses the full research allowance still receives one bounded
opportunity to correct only its final output format. Both failed batches kept
project state stable, prevented fixture persistence, and verified temporary
session revocation.

Candidate `139faed8837e7d4070271dd18623da74ba23410b` reserves a
separate format-repair turn after as many as four research turns. The targeted
two-repeat rerun of the formerly failing landscape follow-up passed 2/2, and
hosted logs proved that one malformed final response was repaired inside the
bounded agent loop.

The fresh complete Activity 10 rerun then passed 10/10 two-turn sequences and
20/20 questions. Citation, project-isolation, and answer-and-proof
repeatability rates were all 100%. All 20 traces and evidence dossiers were
fresh, project state was unchanged, controlled fixtures did not persist, the
temporary session was revoked, and there were no integrity failures. Two
malformed final responses were repaired in-loop without losing their evidence
or failing a sequence.

The complete receipt is
`/private/tmp/ecos-agent-private-deepseek-activity10-139faed-20260911.json` with
SHA-256
`b1979ee7f8e2f31d92b5ee48729a3fcb4d668cce225df9705e874b5fc91247ce`.
DeepSeek measured 6.383-second mean latency, 10.313-second P95 latency, 5.8
tool calls per sequence, and an estimated $0.0075776848 for all ten sequences.

DeepSeek is therefore privately qualified for Activity 10 only: follow-up
questions, explicit project switching, and bounded conversation-context
preservation. At equal measured quality it is the provisional quality-first
candidate for that activity because it also had the lowest P95 latency and
lowest estimated cost in the like-for-like comparison. This does not enable
customer routing. Server-side routing, private shadow evaluation, and real
web/iPhone/iPad acceptance remain required before beta exposure.

After validation, the dedicated bridge was restored to the exact private
baseline source with EZBR SHA-256
`11cf270c15fcab96e4749d8b20703428f68593b9cda5be521d6f08acc4139270`, JWT
verification remained enabled, unauthenticated access returned 401, the
temporary candidate tag was removed, and customer traffic remained 100% on
the unchanged baseline revision.
