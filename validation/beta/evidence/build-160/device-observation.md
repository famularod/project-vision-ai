# Build 160 read-only device and web observation

Recorded: 2026-08-09T00:12:47Z  
Scope: inventory and non-mutating checks only  
Release status: pending; this is not physical-device acceptance

## Installed candidate evidence

- The connected physical iPhone identified itself as an iPhone 17 Pro Max
  running iOS 27.0 beta, build 24A5390f. The connected physical iPad identified
  itself as an iPad Pro 13-inch (M5) running iPadOS 27.0 beta, build 24A5390f.
- `xcrun devicectl device info apps --bundle-id
  com.davidfamularo.projectphotoupdate` read the installed app directly from the
  iPhone and iPad. Both reported Vitruvius version `1.0.160`, bundle version
  `160`, bundle ID `com.davidfamularo.projectphotoupdate`.
- Installed-app metadata did not expose a Git source revision. The checkout was
  dirty at `ee387f6624dd76e36c2fa73fa402ac9ec73b0cfc`, so that revision is not
  accepted as proof of the source embedded in build 160.

No app was installed, replaced, launched, terminated, or exercised during this
inventory.

Both devices were refreshed again immediately before this evidence was closed;
CoreDevice reported each as available and returned the same `1.0.160` / `160`
installed metadata.

## Web reachability

- Nothing was listening on `http://localhost:8097` during this observation.
- No controllable browser session was available to perform interactive web,
  keyboard, zoom, focus, or screen-reader checks.
- No login, project data, form, or browser session state was changed.

## Automated source checks

These checks examine source/contracts and are not actual device behavior:

- `npm run test:accessibility`: PASS.
- `npm run test:performance`: PASS.
- `npm run test:offline-queue-idempotency`: PASS.
- `npm run test:web-foundation`: PASS. The Phase 3 and Phase 4 contracts passed;
  7 web test suites and 74 tests passed. The earlier failure was a stale static
  contract that looked only in the former monolithic shell after the reachable
  document-upload action moved into `DesktopDocumentOnboarding`; the contract
  now verifies both the shell wiring and the accessible child action.
- `npm run check`: PASS, including the production-secret guard, release metadata
  `1.0.160` / Build `160`, Expo dependency alignment, and TypeScript.
- Targeted outside-pilot authorization/navigation tests: PASS (30 tests).
- `npm run test:beta-readiness`: PASS for the fail-closed evidence contract.

## Actual behavior still unobserved

All sign-in, task, voice/text, field-note, document-resume, Ask ECOS/proof,
report, offline/reconnect, restart, conflict, VoiceOver, Dynamic Type, reduced
motion, contrast, focus, touch-target, keyboard, screen-reader, 200% zoom, and
runtime performance checks remain pending. They require a reachable device or
browser plus a human observer and must not be inferred from the source checks.
