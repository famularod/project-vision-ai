# Timestamp-stable source authority checkpoint

This is a bounded Step 4 repair, not beta certification.

Root cause: the shadow page reset clears obsolete indexing markers. That ordinary update advances `reference_documents.updated_at`. Legacy owner authority included this bookkeeping timestamp in its source metadata and generation comparison. The unchanged original consequently lost access through the independent V2 proof path.

The new authority protocol /2.2 excludes only that timestamp. Legacy /2.1 hashes and receipts retain their original meaning. Owner, project, source content hash, revision, locator, currentness and generation checks remain. A new authority head must use predecessor CAS; old managed originals, execution bindings and page rasters remain stale until renewed through existing supported interfaces. No generation counter or historical receipt is rewritten.

Verification: current database definitions were captured, hashed and checked at migration time. Rolled-back database tests cover currentness after timestamp-only updates, rejected content/revision/page-count/locator/project/currentness changes, ABA invalidation, wrong predecessor, delayed legacy retries, unchanged old receipts, and anonymous/authenticated denial. The actual source-runtime adapter passes four real-database-response tests; a fresh read-only review found no concrete bypass/regression. Security advisors introduced no new finding.

Hosted migration history records version 20260914053252. Private source runtime code is maintained in the adjacent `owner-source-runtime` repository. Its zero-general-traffic image is sha256:2748f7d9d3dbfe685d74447544257275b9a637ff21b1a01e25254ce023a89fdd, packaged source aea626813abc48338632b44a345b98368b69b8d44fc772d8db02a4f14a3ccfa4. All 89 upload inputs matched; isolated network-disabled startup passed. Source gateway version 73 matches all five expected files and retains JWT validation.

The first renewed source returned HTTP 200 and `current_exact_page_image` through the real gateway. Independent PNG decoding and SHA verification passed. The temporary session was revoked and independently absent from auth.sessions. This is a private integration result, not a visible device pass. Desktop rendering, both physical devices, remaining sources, account isolation/recovery, and complete release acceptance remain required.

Rollback must preserve new immutable audit records. Restore private service/gateway routing if necessary; do not rewind authority heads, delete receipts, or reinterpret old hashes to make evidence current. The general customer query baseline was not changed.
