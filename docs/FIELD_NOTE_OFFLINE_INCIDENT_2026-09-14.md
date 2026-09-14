# Step 6: offline Field Note disappearance

## Report and evidence boundary

The owner reported that a Field Note disappeared after refreshing, and confirmed
Wi-Fi was off. They did not notice whether the device-save confirmation appeared.
This is a failed owner acceptance drill, not a proven diagnosis of that exact note.
The iPad was unavailable for inspection. A read-only cloud lookup found no note
matching the disposable test marker `BETA OFFLINE CHECK 0914`; different wording
or a still-local note would not be found by that lookup.

Do not uninstall, clear storage, restore over device data, or recreate the original
note before checking whether it reappears after reconnecting. No original device
data has been copied, restored, deleted or otherwise changed by this repair.

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
