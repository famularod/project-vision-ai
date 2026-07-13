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

## Design language (established 2026-07-11, starting with the Overview redesign)

Applies to every screen redesign from here on (Project, Updates, and
anything after) — the goal is for pages built in different sessions to
still read as one considered product, not a patchwork.

- **Colors always carry consistent meaning, never decorative.** Use
  `App.tsx`'s existing soft-tinted semantic colors — `dangerSoft`/`danger`
  (problems, destructive actions), `warningSoft`/`warning` (caution, due
  soon, pending), `successSoft`/`success` (good/caught-up state),
  `primarySoft`/`primary` (neutral default UI, not tied to a specific
  status), `insightSoft`/`insight` (purple — reserved specifically for
  real DAVE/AI-derived findings, not just "a 4th color to fill a grid").
  Before assigning a color to anything, ask what it actually means — if a
  stat or icon doesn't genuinely represent one of these meanings, leave it
  neutral/muted rather than forcing a color on for visual variety.
- **Native iOS grouped-list is the base structural pattern**: a single
  rounded container per section, inset hairline separators between rows,
  no per-row shadow/border, right-chevron disclosure indicators, section
  headers as small uppercase muted labels above the group (not large bold
  headings). Prefer this over ad hoc bordered cards floating with gaps.
- **Subtle load-in animation is the established motion language**: content
  fades in with a small upward slide (~400ms), and key numbers count up
  from 0 to their real value over ~600-700ms, once on screen load. Nothing
  continuous, no spinners-as-decoration, no bounce/overshoot — everything
  settles within under a second and then stops moving.

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

Fixed 2026-07-09/10 (do not re-investigate — see merged PRs #1-16 on
GitHub for history if context is needed):
- Sign-in screen unreachable — fixed (PR #5, #6).
- Hold-to-delete project — verified working.
- Building 2321 / photo-comparison pipeline totally broken — root cause was
  a missing organization_memberships row blocking RLS at three separate
  points in the pipeline (storage upload, edge function auth, result
  read-back). Fixed via direct single-user ownership RLS policies (PR #8)
  and an edge function fix (PR #9). Full pipeline confirmed working
  end-to-end on device, including a real AI comparison result.
- Photo-analysis area/upload timing race for back-to-back photos — fixed
  (PR #7).
- Keyboard covering text fields in three modals (Area Mapping Details, both
  sign-in modals) — fixed via a shared KeyboardAvoidingModalCard wrapper
  (PR #12).
- Area name field snapping back to "New Area" mid-edit — fixed by giving it
  a local state buffer, same pattern as the GPS radius field (PR #16).
- Duplicate React key warnings (open-item-vdvdah, open-item-8xud1c) —
  root cause was stableOpenItemAttentionId hashing project+area+category
  instead of a unique per-photo id, silently colliding and hiding some
  "Needs Attention" cards. Fixed (PR #13).
- "Retry Analysis"/"Retry Send" doing nothing visible on the sent-update
  detail screen — root cause was ReadOnlyUpdateDetailScreen rendering
  from a frozen one-time snapshot instead of live savedUpdates state.
  Fixed (PR #14).
- Backup exports with empty photos arrays — root-caused 2026-07-13. The
  missing-photo sync cleanup removed photo records from savedUpdates, and
  backup export correctly serialized that already-damaged state. Cleanup now
  removes missing files only from the retry queue while preserving historical
  photo metadata in saved updates and backups. Existing backups that already
  contain photos: [] cannot reconstruct those deleted records by themselves.
- Resumed saved updates can now be deleted directly from Add Photos and
  Build Update. Brand-new unsaved drafts do not show the action, and confirmed
  deletion removes unreferenced local photo files correctly.
- Archived projects and invisible sync work — addressed 2026-07-13. The live
  project workspace now exposes Archive Project, Projects lists archived
  projects with Reopen, cloud loading recovers archived rows, and archive/
  reopen changes enter cloud sync. Settings now shows All caught up or the
  number of items waiting to sync and exposes Retry Sync when attention is
  needed.
- Lighting/obstruction comparability downgrades no longer keyword-match model
  prose such as "shadow", "glare", or "occluded". The strict photo-pair schema
  now requires independent none/minor/limiting impact fields, and only a
  structured limiting impact can trigger this downgrade. Deployed as
  pie-photo-vision version 20 on 2026-07-13. The residual alignment/overlap
  free-text safety check remains deliberately.

Still open:
- GPS auto-detection defaulting to "All Projects" — not a code bug.
  findProjectAreaSuggestions only trusts areas with locationCapturedAt
  set (i.e. captured live via the app's own GPS flow), and all 12 areas
  were seeded with hand-typed coordinates, never actually GPS-captured.
  The "Save GPS" flow works correctly and is reachable via gear icon →
  Settings → Area Mapping. This is a fieldwork task for David (visit each
  area physically, tap "Save GPS"), not a code fix.
- App.tsx monolith refactor — dead screens//components//hooks/ files
  acknowledged but out of scope unless actively wired in for a real fix.
- Two independent sync engines — not unified, not currently causing known
  bugs, but a source of confusion if debugging sync issues.
- Pending verification for the Phase 1 comparability-downgrade hardening
  above (PR #21, deployed 2026-07-10): no live phone test was meaningful
  for this change (it only affects the "Comparability" label in a narrow
  edge case that can't be reliably engineered on demand). An automated
  scheduled check (task id verify-comparability-downgrade-real-data,
  one-time, fires 2026-07-13) will query
  pie_photo_semantic_comparison_results.deterministic_metrics →
  comparabilityNormalizationReasons in Supabase against real data and
  report back whether the new specific-trigger format (e.g. "only 1
  shared visual anchor(s) reported...") is actually showing up instead of
  the old generic reason string. This is now automated, not a manual
  follow-up — remove this bullet once the scheduled check reports back
  confirming the fix.

Process note: verify PR/merge state directly against GitHub before marking
anything "fixed" in this file — don't rely on conversation history or
assumption, even within the same session.
