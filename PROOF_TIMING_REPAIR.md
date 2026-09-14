# Proof-opening diagnostic and bounded duplicate-work repair

2026-09-14. Customer owner test route is rolled back as ecos-ask-project v484; no release acceptance claim.

## Observations

- Real desktop proof request failed with index RPC HTTP 500, exposed as source HTTP 503. Subsequent original source service requests succeeded in 26–36 seconds. Initial 500 root cause remains unconfirmed.
- Direct REST inventory/index read pairs succeeded three times; index requests took 557/691/748 ms. Eleven inventory sources produce 101 index rows / 90 expected pages.
- Private diagnostic build 7de38cd4-70a5-4b56-817f-3bf80f5ac6cf / revision proof-8bcb0ff exactly matched 90 uploaded files. Package bca7602fe3fd02053d0db78fd4100c3fdee6abede0a113dc2b973382583d55c6; image sha256:7e27685503bc181732e34775718df09df00977c61566b166b42e2a2a76633b13.
- One real private B proof returned the exact page in 15.262 seconds: inventory 1.970s, indexes 1.231s, observations 2.075s, bundle 0.063s, raster load 5.970s, additional raster revalidation 2.471s. This is diagnostic evidence, not a visible end-user pass. Temporary session revoked and independently absent; receipt ../research/private-proof-1fa711041cf24e46b0e63a819ce0974f.

## Repair boundary

`loadECOSOwnerRasterImages` already performs an initial pinned raster read, exact-byte download and full PNG verification, a post-download raster-head read, a complete index reread and final index epoch comparison. The source viewer immediately repeated the model-path revalidator even though no model call or asynchronous operation intervened. Remove only that redundant second pass. The remaining comparison, origin-checked byte copy and return must stay synchronous.

No permission, epoch, page/receipt/hash, size, decoder, cancellation, time-limit or model-path revalidation check was removed from the raster loader. No database timeout changed. The initial intermittent HTTP 500 is NOT declared repaired by this optimization.

## Tests and provenance

Nineteen source-view tests and four diagnostic tests pass. The duplicate-pass test failed before and passed after. Drift, forged scope, wrong page/source/receipt, corrupt PNG, missing evidence and cancellation cases still reject. Runtime entrypoint typecheck passes.

The source-view suite and two synthetic fixture helpers were recovered from the user's read-only independent-review export. Its sanitized public storage project reference was restored to match this runtime's existing public constant; no customer evidence or credentials were introduced. Initial imported-suite failures from that placeholder and the old one-log-only assertion are retained in the work history. Diagnostic tests now check all log lines for leaks and exactly one failure event, allowing the new fixed phase timings.

Next: immutable private build, exact-source timing repeat and failure classification. Do not activate beta or certify three-device acceptance from these unit results.
