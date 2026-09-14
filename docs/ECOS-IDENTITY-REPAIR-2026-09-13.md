# Agent evidence authority repair — local checkpoint

Base: `2ffa26cc90ae3fac18799b2835d5241c92aab29e`.

Shared explicit-identity constraints now cover canopy, building, room, area,
zone, phase, unit, lot, level, door, RFI, submittal, revision and supported
equipment tags. Retrieval and final answer checks reject known conflicts;
titles cannot relabel conflicting excerpts. Unlabeled discovery context is
not automatically proof of a named entity. These lexical guards complement,
and do not replace, server-enforced project/document/version authorization.

Numeric proof now matches complete values and measurement/unit pairs. A
regression first demonstrated the old checker accepting six square feet from
a passage containing six inches and a different area; that case now fails
closed. This guard is not full semantic entailment: unrelated roles within a
long passage and unsupported identity forms still require structured proof.

The preserved area fallback repair requires explicit overall orthogonal
dimensions, rejects component/roof-covering substitution, conflicting axes,
and single-footprint answers to multi-entity questions. Correct real-source
numeric extraction is still required and is not proven by synthetic fixtures.

Validation: 301 backend tests passed; deployed runtime and candidate handler
type-check passed. Deno dependencies are locked, CI is separate from app
tests, the container build uses the frozen lock, and upload inputs are
allowlisted. Local tests are not physical-device or hosted-service evidence.

The app checkout owns the indexing worker and its migrations. Experimental
worker copies and plan OCR research are outside this runtime's shipping tree.
Do not activate customer traffic or mark beta-ready without exact artifact
readback and the actual three-device answer/proof acceptance run.
