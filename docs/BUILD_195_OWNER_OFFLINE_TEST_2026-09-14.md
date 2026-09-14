# Build 195: controlled owner-only offline Field Notes test

## Actual device outcome: FAILED offline visibility

The owner reports the new iPad note disappeared while offline and returned only
after Wi-Fi was restored. Screenshots show `BEAT 195 IPAD` transitioning from
waiting to sync to sent. A targeted post-reconnect device read found that exact
note once, ID `field-note-mu1bvqle-1rc8f8o`, revision 1, synced, among 11 notes.
The private recovery copy is outside source control; SHA-256
`c5137fdc30f3d6f56a645980cad423dc13368e4b85e0bdf715646d9a87754ba3`.
Recovery is not an offline acceptance pass. Step 6 remains open.

Code inspection found an additional startup defect: App selected the native
Field Notes owner from online-dependent Layer4 identity, falling back to
`local-device` while that identity was unavailable. NativeRoot already selected
the session owner and activated its sandbox, but did not pass that identity to
Field Notes. This is consistent with the observed reconnect-only visibility;
we have not captured the transient on-device owner selection itself.

The original component test supplied a fixed owner and therefore missed this
boundary. The repair connects native notes to the root's local owner context,
without changing server authorization. New tests execute the real NativeRoot,
sandbox, native Field Notes screen, repository and sync coordinator; navigation,
session/transport, storage hardware, and voice are test substitutes. They cover
three offline reopen cycles, reconnect, account switching and pending startup.
A separate App wiring contract fails against Build 195's Layer4-based route.
These remain automated tests, not physical-device acceptance.

Prepared from the repaired Step 6 branch after original-note recovery was
verified. Native baseline: Build 194 on both paired devices. Web remains the
existing Build 194 deployment; backend, permissions, sessions and routing are
not changed by this native test build.

## Included changes

- Persist and render Field Notes independently of cloud request completion.
- Protect durable notes against concurrent save/refresh and stale sync replies.
- Reset the Field Notes workspace when the owner changes.
- Previously prepared limited-backup disclosure and size-budget containment.
  This does not implement a complete Field Notes or cloud-account backup.

## Pre-build evidence

Both installed Build 194 versions were freshly read back. Targeted Field Notes
copies were preserved outside source control: iPad 10 synced, iPhone 9 synced,
neither with pending notes. The original iPad test is revision 1 and exists once
in cloud storage. The iPhone had not yet loaded that new note; do not infer
cross-device convergence from its earlier inbox snapshot.

The retained Build 194 rollback app matches all 49 original artifact file hashes,
passes strict deep signature verification, and has a nonexpired provisioning
profile. Original device notes must not be overwritten to perform rollback.

19 focused tests and 1,836 tests in the full pre-bump gate passed. The first full
gate found two outdated test assertions requiring a misleading complete-backup
claim; both were corrected to require the explicit limitations while retaining
encryption and restore contracts. Corrected clean pre-bump gate: 18 passing
layers, one Android signing warning, one failure for missing complete live Ask
ECOS acceptance. Keep that failure and NOT CERTIFIED status. Do not synthesize
or relax the acceptance certificate for this controlled owner-only test.

## Required completion evidence

Post-bump checks, signed artifact identity/configuration verification, successful
install receipts and independent version readback are required before reporting
installation. Check preserved notes after installation. Then use the visible
Field Notes workflow on each device: offline save with visible confirmation,
three offline reopen cycles, reconnect, one matching cloud record and actual
desktop visibility. The old note's recovery is not acceptance of this new build.

No general beta release or all-seven-step completion is claimed by this document.
Build/install outcomes will be recorded in the external working register and
release receipts; this pre-build document does not claim they have happened.
