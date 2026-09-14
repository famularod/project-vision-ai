# Step 6: offline Field Note disappearance

## Confirmed reconnect recovery

The subsequent owner screenshot shows the original `BETA OFFLINE CHECK 0914`
note in the iPad Field Notes inbox, marked `Sent to desktop`. A fresh read-only
cloud query confirms the original ID `field-note-mu1acvg2-1357f9l`, open, revision
1, original creation timestamp preserved, and exactly one matching marker for
that owner. The original offline note survived and synchronized after reconnect
and reopening, without recreating it or replacing the signed-in session.

Screenshot: `42329BC1-B22D-4A88-88A0-024CC5FF2E3C_4_5005_c.jpeg`, SHA-256
`19ac7d44691f1d8066441429b8fe3b8146d2a7df27bd92e269042d255c5087d2`.
This passes this note's bounded recovery/one-current-cloud-copy check. It does
not establish exactly-once transport execution, a visible desktop inbox check,
three offline reopen cycles, iPhone recovery, or acceptance of the uninstalled
repair. The earlier offline visibility failure remains a defect, not a pass.

## Recovery readback after Wi-Fi restoration

At approximately 2026-09-14 13:54 UTC, both devices were reachable. A targeted
read-only copy of the iPad owner's Field Notes storage found the original
`BETA OFFLINE CHECK 0914` note, ID `field-note-mu1acvg2-1357f9l`, created at
13:35:43.154 UTC, revision 0, pending. Ten records were present: nine synced and
one pending. Thus the reported note survived in durable device storage; do not
describe this particular incident as confirmed data loss.

The pending record's saved error was `Sign in is required before Field Notes can
synchronize.` This is a historical offline attempt result, not proof that the
current signed-in session is invalid. A fresh read-only query by exact note ID
still returned no cloud row. Foreground retry and visible recovery remain to be
verified; do not sign out or replace the session merely because of that message.

The untouched recovery copy and device-copy receipt are in the private research
folder `research/field-note-recovery-nr1cgZ/` outside the app repository. Note-store
SHA-256: `d227c6df4466ee2b17aaa6ad6a0d0e96d856657e7c0599d4bfd67e2549e352fd`.
Only the exact owner Field Notes file was copied; no credentials or whole app
container were copied. Device storage, installed apps and backend state were not
modified. The independent refresh/concurrent-write defects remain valid findings
but are not established as the cause of this original note's disappearance.

## Report and evidence boundary

The owner reported that a Field Note disappeared after refreshing, and confirmed
Wi-Fi was off. They did not notice whether the device-save confirmation appeared.
This is a failed owner acceptance drill, not a proven diagnosis of that exact note.
The iPad was unavailable for inspection. A read-only cloud lookup found no note
matching the disposable test marker `BETA OFFLINE CHECK 0914`; different wording
or a still-local note would not be found by that lookup.

The initial recovery instruction was not to uninstall, clear storage, restore
over device data, or recreate the original note. A subsequent targeted read-only
copy preserved the note as described above; no device data was overwritten.

## Confirmed local defects

- Refresh merged from a snapshot taken outside the durable write lock and could
  erase a newly saved note. The regression test failed before the repair.
- Concurrent repository saves could overwrite each other. The regression test
  failed before the repair.
- The native workspace waited for cloud work before rendering persisted notes
  or confirming a verified local save. A stalled network could therefore hide
  durable local data.
- A late sync acknowledgement could replace a newer local edit, and an old
  realtime revision could downgrade a synchronized local record.

## Candidate changes

Use the existing per-storage-key mutation coordinator for repository reads that
may repair storage and for all writes. Merge against the current durable list
inside the lock. Apply cloud acknowledgements only if the expected local record
is unchanged; preserve later work. Deduplicate concurrent per-note sync attempts
within each datasource and ignore older cloud revisions.

Render local notes and acknowledge verified local saves independently of cloud
requests. Reject superseded UI load results and reread current local notes for
sync notifications. Key the workspace by owner so drafts and callbacks cannot
carry into a different owner's inbox. No schema, authentication or permission
changes are included.

## Verification and remaining gates

Focused repository, sync and workspace tests: 5 suites / 19 tests passed.
Full local unit suite: 259 suites / 1,836 tests passed. Configured `npm run check`
and standalone typecheck passed. No full release or physical-device gate was run.
The offline UI test uses the real component and repository with an in-memory
storage adapter and a nonresponding cloud transport. It recreates the repository
and datasource, then reconnects and checks one stable-ID cloud creation.
It is not physical storage durability, real radio recovery, or cloud acceptance.

Before device acceptance: obtain the original-note reconnect result, preserve
any unsynced data, pass the release gates and verify an exact signed artifact.
On both devices: save offline, observe the local confirmation, reopen three
times offline, reconnect, and verify the same note exactly once in the desktop
inbox and after further device reopen cycles. Record failures, actual builds,
identities and timestamps. Existing cloud timeouts/retry behavior and offline
status/content editing need their own coverage; this does not certify those.

This candidate is local only. No install, production deployment, session change,
customer routing change or evidence publication occurred. Step 6 remains open.
