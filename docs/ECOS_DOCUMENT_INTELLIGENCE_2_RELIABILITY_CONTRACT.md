# ECOS Document Intelligence 2.0 Reliability Contract

## Required outcome

ECOS may return a factual project answer only when ECOS Assurance can trace
every factual clause to current, project-scoped evidence with an exact source
record and, for drawing evidence, an exact PDF page plus a bounded drawing
region. Unsupported, conflicted, stale, or visually incomplete evidence must
produce a clear `could_not_verify` result. A plausible answer is not a passing
result.

The acceptance target is 100% correct system outcomes across the approved
benchmark: either the exact supported answer with proof, or the correct safe
refusal. This does not mean every question will receive an answer.

## Fail-closed rules

1. Only current, non-superseded, project-matched documents may be searched.
2. A drawing must use the current Document Intelligence schema before it may
   support an answer.
3. A sheet number is cited only when Sheet Mapping v2 marks it `verified`.
   Conflicted or unverified mappings cite the PDF page only.
4. A visual fact requires a visible evidence transcription, page coordinates,
   and extraction confidence. Model interpretation without visible evidence is
   excluded.
5. A measurement answer must preserve the exact value and unit found in its
   cited evidence and must match the requested subject and location.
6. Design evidence cannot verify an installed condition. ECOS must state that
   limitation unless field or as-built evidence proves the installed condition.
7. Presence questions such as lighting require explicit plan, schedule, note,
   symbol, or callout evidence. Related field comments are not sufficient.
8. Conflicting facts or revisions are shown as conflicts; ECOS must not choose
   one silently.
9. ECOS Core proposes the answer. ECOS Assurance independently rejects any
   clause that fails these rules.

## Approved benchmark

| Question | Required supported outcome | Required refusal condition |
|---|---|---|
| How thick is the new PCC paving at the 2375 North Lot? | `6.0 inches`, tied to the exact C6 construction note region. | No exact paving note with North Lot context. |
| How thick is the PCC walkway? | `4 inches`, kept separate from the paving value. | Only paving evidence is available. |
| How thick was the concrete that was poured? | State the current design thickness and state that the drawing does not verify installed thickness. | No current design note or no field/as-built proof. |
| How many square feet is Canopy A? | `6,344 square feet` only when the same verified plan shows overall dimensions `122'-0" × 52'-0"`; label it a calculated plan footprint. | Dimensions are incomplete, from different pages, or not clearly overall dimensions. |
| Do the canopies have lighting? | Answer yes only from explicit current electrical-plan evidence showing fixtures/luminaires in the canopy area. | Only field updates, unrelated notes, or ambiguous symbols are available. |
| What does Sheet E-2.1 show? | Answer only when Sheet Mapping v2 verifies E-2.1 and the cited page evidence answers the question. | OCR says F-2.1 while visual title-block evidence says E-2.1. |

## Release gates

- All benchmark cases pass for at least 20 consecutive deterministic policy
  cycles.
- Sheet-mapping conflict tests pass.
- Full-page overview and six-tile deep visual coverage complete for each
  drawing page used in the benchmark.
- Every supported answer opens the cited current document, PDF page, and
  bounded proof region.
- Every unsupported case returns `could_not_verify` and contains no guessed
  value.
- Type checking, focused tests, `npm run check`, and `npm run qa:release` pass.
- Database migrations and edge functions deploy successfully before live
  authenticated testing.
- Drawing analysis and Ask ECOS must have sufficient provider capacity. A
  dedicated server-side `ECOS_OPENAI_API_KEY` may be configured in Supabase;
  otherwise ECOS falls back to `PIE_OPENAI_API_KEY`. Provider keys must never
  enter the client bundle.

## User-visible health language

The Documents workspace must distinguish these concepts:

- Searchable page coverage
- High-resolution visual coverage
- Verified sheet mapping coverage
- Current revision eligibility
- Known limitations or conflicts

The interface must not label a drawing “100% understood.”
