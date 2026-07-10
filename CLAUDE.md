# Project Context & Working Agreement

This file is read automatically by Claude Code at the start of every session in
this repo. It exists so David doesn't have to re-explain the same rules every
time. If anything here goes stale, update this file rather than letting the
convention drift.

## What this app is

DAVE, running on ECOS (formerly PIE / Project Intelligence Engine) — a
single-user React Native/Expo field documentation tool for construction
project managers. Core goal: submit a photo-based project update in ~60
seconds, with AI-powered visual comparison of baseline vs. update photos,
GPS-based project auto-detection, and background intelligence processing.

### Naming (as of 2026-07-09)
The product-facing name changed from PIE to **DAVE**, running on **ECOS**.
This rename is **docs/UI-only for now** — do not rename `pie_*` tables,
files, functions, or other identifiers in the codebase as part of this.
Internal naming (`pie_layer4_has_permission`, `PIEStatusCopy`,
`services/PIEPhotoVisionMobileWorkflow.ts`, migration filenames, etc.) stays
exactly as-is unless there's a separate, explicit decision to rename code
too. User-facing display strings (things the user actually reads on screen,
like "PIE Brief" or "PIE checking photos...") are being updated to say DAVE
instead — see the app's git history for that pass.

- Repo: `https://github.com/famularod/project-vision-ai`
- Local path: `/Users/davidfamularo/Downloads/project-photo-update-tool`
- Backend: Supabase (Postgres, Storage, Edge Functions)
- Testing: physical iOS device only via Expo dev client, connected to a
  locally-running `npx expo start` — no simulator in normal use.
- David is a beginner developer / product owner. Explain terminal steps
  explicitly and in order. Don't assume familiarity with git, SQL, or
  Supabase's dashboard.

## Architecture gotchas (read this before assuming anything)

- **The live app is a single ~18,000-line `App.tsx` monolith.** A parallel
  `screens/`, `components/`, `hooks/` directory structure exists but is
  **mostly disconnected** from the live app unless explicitly wired into
  `App.tsx`'s navigation. Before touching a file in `screens/` or
  `components/`, confirm it's actually imported and rendered from `App.tsx` —
  don't assume a file's existence means it's reachable by the user.
- **There are duplicate type systems.** `App.tsx` has its own local
  `ProjectUpdate`/`ProjectArea`/etc. types, separate from the ones in
  `types/index.ts` that `screens/`/`components/` files import. They're
  usually structurally compatible but not always — expect occasional small
  type patches when wiring the two together.
- **There are two independent sync engines**: the live per-update queue sync
  in `App.tsx` (`runFieldUpdateCloudSync`/`hydrateQueuedUpdates`), and a
  separate batch sync in `services/SyncService.ts` used by the Admin screen's
  "Sync Now". Both work independently; they haven't been unified.
- **RLS policy pattern**: this app is single-user with no team/org sharing.
  Supabase tables under the PIE evidence/vision pipeline use a direct
  ownership check — `organization_id = auth.uid()::text` — not the older
  `pie_layer4_has_permission`/`organization_memberships` membership model
  (that table has no rows for any account and nothing provisions it). If you
  find a table still gated by `pie_layer4_has_permission` that the mobile
  client or an edge function actually reads/writes, it likely has the same
  bug: silent RLS rejection with no membership row ever created. Check
  `supabase/migrations/20260709000000_simplify_pie_evidence_single_user_rls.sql`
  and `20260709010000_simplify_pie_vision_pipeline_single_user_rls.sql` for
  the established fix pattern before proposing a new one.
- **Two style sheets that look shared often aren't.** Multiple files reuse
  identical-looking style property names (e.g. `detailModalCard`,
  `modalCard`) but each file defines its own independent style object. Don't
  assume patching one fixes the others — verify per-file.

## Working agreement

### Default flow for anything non-trivial
1. **Diagnose first.** Trace root cause before proposing a fix. Report
   findings plainly — don't speculate as fact.
2. **Propose before implementing.** Give David the plan, flag any real
   decision points (don't silently pick one), and wait for explicit
   go-ahead.
3. **Implement on a new branch off `v0.8-architecture-refactor`.** Never
   commit directly to that branch or to `main`.
4. **Run `npm run check`** (production-secret-guard + `tsc --noEmit`) before
   calling anything done. No Jest suite exists.
5. **Summarize the diff** before committing — what changed, what was
   deliberately left untouched, any tech debt noticed along the way.
6. **David live-tests on his physical device** before merge, unless the fix
   is unreachable without deploying (e.g. a Supabase migration or edge
   function) — in that case, deploy first, then test.
7. **Open a PR via `gh`** targeting `v0.8-architecture-refactor`. Merge only
   after David confirms the live test passed.

### When it's safe to move faster
For small, clearly-scoped, low-risk changes — copy tweaks, obvious null
checks, adding a missing prop, UI-only fixes with no data/auth implications —
skip the separate "propose a plan" round-trip. Just implement, run the check,
and show the diff for review. Still branch + PR + live-test as normal; the
only step being skipped is the up-front plan approval.

### When to always stop and get explicit sign-off first
- Any Supabase RLS policy or schema change.
- Any edge function change (these deploy independently of app code and are
  harder to roll back).
- Anything touching authentication, sessions, or security boundaries.
- Anything that's genuinely hard to undo.
For these, show the exact SQL/code before applying anything to the live
database or deploying — same as every migration today.

### Applying SQL / exact-text changes
Chat-based copy/paste has corrupted long SQL blocks before (dropped
characters, garbled table names). Prefer applying migrations directly via
`supabase db push` (CLI is linked and authenticated) over asking David to
paste SQL into the dashboard by hand. If a manual paste is unavoidable, write
it to a file first and have David `cat` it from the terminal rather than
relaying it through chat.

### Communication style
- Plain, sequential, numbered steps for anything David needs to do manually
  (terminal commands, app navigation, Supabase dashboard clicks).
- No jargon without a one-line plain-English translation.
- State assumptions and decision points explicitly rather than silently
  picking one, unless the fix is small enough to fall under "move faster"
  above.
- If a test result is ambiguous or a live-test loop isn't converging, say so
  and switch to direct inspection (logs, DB queries, deployed source diffing)
  rather than asking for another manual phone test that's unlikely to
  reveal new information.

## Known open issues (update this list as things get fixed)

- "Retry Analysis" button appears not to trigger anything on already-sent
  updates — found 2026-07-09, not yet investigated.
- Duplicate React key warnings on two item IDs (`open-item-vdvdah`,
  `open-item-8xud1c`).
- `App.tsx` monolith refactor — the dead `screens/`/`components/`/`hooks/`
  question is acknowledged but out of scope unless a specific file is being
  actively wired in for a real fix.
- Two independent sync engines (see above) — not unified, not currently
  causing known bugs, but a source of confusion if debugging sync issues.
