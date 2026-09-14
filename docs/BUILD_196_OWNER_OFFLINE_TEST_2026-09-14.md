# Build 196: native local-owner startup repair

Owner-only test build; no general release certification. Build 195 failed the
actual iPad offline-reopen test. Exact note recovered after Wi-Fi returned;
recovery is not an offline pass. See the Build 195 incident update.

## Narrow change

NativeRoot passes its activated sandbox owner through a local React context.
Native Field Notes consumes that context instead of the online-dependent Layer4
identity fallback. Undefined owner boundary throws; unresolved startup does not
mount notes; explicit sign-out uses the existing separate local-device bucket.
Backend authentication, project permissions, cloud sync authorization and
session storage are unchanged. No data migration or bulk rewrite occurs.

## Pre-bump verification

Repair commit: 2308f20. App route wiring check was observed failing before the
fix. New tests exercise actual NativeRoot / sandbox / native Field Notes /
repository / sync coordinator while replacing navigation shell, session network,
storage hardware and voice. They cover offline local save, three root remounts,
reconnect with one stable ID, account switch / draft isolation, and pending
startup. Four new tests; full 261 suites / 1,840 tests passed. App check passed.

First release run started before commit and correctly failed dirty-candidate
identity as well as missing full live acceptance. Clean rerun: 18 PASS, one
Android-signing WARN, one missing-full-live-Ask-ECOS-acceptance FAIL. Both results
retained. NOT CERTIFIED remains; no gate or acceptance record was weakened.

## Install and device acceptance requirements

Post-bump gate, exact artifact identity, embedded public cloud configuration,
native linkage and signatures must be verified. Both current devices read back
as Build 195; that rollback artifact's 49 files/signature were reverified.
Targeted private notes copied outside source: iPad 11 including BEAT 195 IPAD;
iPhone nine. Preserve current data with in-place installation only. Do not
uninstall, clear storage, replace sessions, or restore old note snapshots.

After installation and version readback, test via each visible native app:
Airplane Mode and Wi-Fi off, type a unique disposable note, observe local save
confirmation, fully close/reopen three times while still offline, then reconnect
and verify one matching synced record and desktop visibility. Passing unit
tests, installation receipts or an app process do not complete this drill.

Web stays Build 194; backend/runtime/gateways/routing and evidence publication
are unchanged. Step 6 remains open until actual device results pass.
