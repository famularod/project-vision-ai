# TEST_EVIDENCE — what was run, on what, and what it does and does not prove

All test runs happened in scratch copies inside the audit shell's private home (`$HOME/work/...` of the sandboxed Linux VM on the owner's Mac), never inside a source folder. No credentials, no `.env`, no cloud, no paid provider. Network was not needed: Deno ran with `--cached-only`. Copies are deleted with the session.

Tooling note: Deno 2.9.2 (aarch64 Linux) was downloaded into the scratch home earlier in this session for the v10/v11 proposal work; nothing was installed into any project. The app's existing `node_modules` (installed on macOS) was linked read-only into the scratch copy for Jest; nothing was installed or modified there.

Script definitions were read before anything was executed. `npm test`, `npm run check` and `qa:release` were **not** run because `check` performs `npx expo install --check` (network) and `qa:release` writes a manifest, runs git and rewrites `dist/`. Jest and Deno were invoked directly instead.

## 1. Runs

| # | Suite | Source identity | Exact command (from the scratch copy) | Result |
|---|---|---|---|---|
| T1 | v11 private runtime, full backend suite | `vitruvius-private-v11/runtime`, snapshot `950d0077...` | `deno test --cached-only --frozen --lock=deno.lock --allow-env --allow-read=. --no-check supabase/functions/_shared supabase/functions/ecos-ask-project-candidate supabase/functions/ecos-agent-model-bridge supabase/functions/ecos-agent-deepseek-model-bridge workers/ecos-agent-query-runtime/main.test.ts` | **594 passed / 0 failed** (24 s). Matches the owner's figure. |
| T2 | v12 draft, same command | `vitruvius-private-v12/runtime`, snapshot `ef6aff4e...` | same | **597 passed / 1 failed** (25 s). Failure: `time-aware finalization sends no tools after slow research and retains evidence` in `_shared/ecos-finalization-reserve.test.ts`. Matches the owner's figure. |
| T3 | v12 failing test in isolation + instrumented probe | same | `deno test ... supabase/functions/_shared/ecos-finalization-reserve.test.ts`, then a temporary probe test in the scratch copy that logged each model request | 3 passed / 1 failed. Probe output: call 1 `toolChoice:auto, tools:1, items:2`; call 2 `toolChoice:none, tools:0, items:3`; result `completed`, 2 calls, 2 successful research calls, both tool traces `completed`. Only `inputItems.length >= 4` is false (actual 3). See FINDINGS ECO-14. Probe file was deleted from the scratch copy afterwards; it never existed in the source folder. |
| T4 | Durable runtime, edge functions | `R/runtime` on-disk state incl. uncommitted + untracked, snapshot `6c9e190d...` | `deno test --cached-only --lock=deno.lock --allow-env --allow-read=. --no-check supabase/functions` | **506 passed / 0 failed** (20 s). Run without `--frozen` because the on-disk lockfile is itself a modified file. |
| T5 | Durable runtime, `scripts workers tests` | same | `deno test ... scripts workers tests` | 6 passed / 1 failed. The failure is `tests/services/ecos-ask-legacy-drawing-boundary.test.ts (uncaught error)`: a Jest-style file sitting in the Deno repo (a stray copy also exists at the repo root). Not a product failure; it is a misplaced test (hygiene). |
| T6 | App Jest suite, all 264 suites | `R/app` on-disk state incl. uncommitted + untracked, snapshot `b5ef0e8a...` (copy excluded `.git, node_modules, dist, ios, android, docs, .expo`) | `CI=1 node node_modules/jest/bin/jest.js --ci --watchman=false --cacheDirectory=<scratch> --maxWorkers=4 --shard=i/24` for i = 1..24 | **264 suites, 1,897 tests: 1,895 passed, 2 failed.** Both failures are in `tests/services/ecos-document-evaluation.test.ts` and are environmental: the macOS-installed `@napi-rs/canvas` native binding does not load in the Linux audit VM (`DOMMatrix is not defined` inside pdfjs). They would need to be rerun on the Mac to count. |
| T7 (earlier this session) | v9 final source baseline | `vitruvius-private-timing-v9.dEshDm/runtime` | same command as T1 | 572 passed / 0 failed |
| T8 (earlier this session) | Codex's independent reservation scenario, ported to the v11 API | v11 proposal | `deno test ... independent-reservation-ported.test.ts` | 1 passed |

Candidate typecheck (`deno check --frozen --lock=deno.lock supabase/functions/ecos-ask-project-candidate/index.ts`) passed for v9, v10 and v11 earlier in this session. It was not repeated for v12 in this audit; the owner reports it passes.

## 2. Not run, and why

| Suite | Reason |
|---|---|
| `npm run check`, `npm test`, `qa:release`, `web:export` | `check` uses the network; the gate writes a manifest, runs git, rewrites `dist/`. Out of scope for a read-only audit. |
| Python indexer tests (`app/workers/ecos-indexer/tests`, owner worker tests) | PyMuPDF, Tesseract, ClamAV are not installed in the audit VM, and installing dependencies was out of scope. Additionally, every real-PDF test is `skipUnless` private fixtures exist, so they cannot run in CI or Docker either (IDX/REL finding). |
| App-repo Deno tests under `app/supabase/functions/**` | Not attempted: no script or CI runs them (REL-02), and they would need an uncached dependency download. Listed as a gap, not as a pass. |
| Maestro e2e flows | Need a simulator/device and an installed build. |
| Every `*:live`, `test:rls-live`, `test:live-provider-mouse`, `dev:*`, `ops:health`, private validation/comparison scripts | They hit production, several mutate data or mint real owner sessions with the service role, some call paid providers (OPS-01). Not run. |
| SQL functions and migrations | No database access. No SQL-level test exists in any repo (the "migration tests" parse SQL text). |
| Any device, cloud, or live-question test | Requires separate approval per the guide. None requested, none run. |

## 3. What these results prove

- The saved working trees compile and their unit logic is internally consistent: v11, the durable runtime, and the app's Jest suite are green apart from two environment-only failures.
- The owner's reported counts for v11 (594) and v12 (597/1) are reproducible from the saved files.
- The v12 failure is a single assertion about transcript length in a test whose fake model turn omits the function_call item; the time-aware finalization path itself runs to completion in that test.
- Lane/review call reservations hold under the scenarios tested (v11), including Codex's reproduction.

## 4. What they do NOT prove

- That Ask ECOS answers a real question. No test in any repo calls `handleECOSAskProjectCandidateRequest`, `runECOSAgentCore` or `gatherEvidence`; the one real canary (r11) returned HTTP 502.
- That the deployed backend matches any of these folders (REL-01, SEC-01).
- Anything about SQL behaviour, RLS as deployed, storage policies, tombstone triggers, or the four untracked 0915 migrations.
- Anything on a physical device: photo survival across sign-out (ID-01), offline cold start (ID-03), report approval on a real project (REP-01/PIE-01), performance, accessibility with VoiceOver.
- Test quality is uneven by design of the suites: about 78 Jest files use `jest.mock`; 13 Jest files and roughly 97 of 165 scripts assert source text only; the "core workflow simulation" is a string search over `App.tsx`. A green count here is evidence of internal consistency, not of product behaviour.

## 5. Classification of evidence used in this audit

| Kind | Used for |
|---|---|
| Static reading of saved source (lead-verified lines marked `[L]`) | most findings |
| Static reading by delegated auditors (`[A]`) | breadth; spot-checked, none of the spot checks failed |
| Synthetic unit/integration tests run offline | section 1 |
| Actual backend observations | only the owner's saved receipts and the r11 canary report; none generated by this audit |
| Owner-reported device tests | referenced as history only (Field Notes, individual canopy questions); not current-build evidence |
