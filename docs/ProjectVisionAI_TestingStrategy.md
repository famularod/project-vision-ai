# Vitruvius Testing Strategy

## Purpose

Vitruvius uses separate quality layers because each layer answers a different question. A passing source-contract check does not prove behavior, and a passing unit test does not prove that a field workflow fits on an iPhone screen.

## Quality Layers

### 1. Compile and secret safety

Command:

```bash
npm run check
```

This verifies the production-secret guard and TypeScript compilation. It does not prove runtime behavior.

### 2. Executable unit and component behavior

Command:

```bash
npm run test:unit
```

Jest with the Expo preset imports production modules and renders React Native components. These tests verify returned values, state transitions, prioritization rules, user-visible labels, and interaction callbacks.

The V.I.C. release path uses the stricter command:

```bash
npm run test:unit:strict
```

It fails on Jest failures, serious asynchronous test-harness warnings, or a drop below the recorded whole-repository coverage floors. The initial floors are a regression ratchet, not a claim that current coverage is sufficient.

Newly extracted services, hooks, reducers, and components must add executable tests. Tests should assert behavior, not source wording.

### 3. Architecture ratchets

Command:

```bash
npm run test:architecture
```

Architecture ratchets prevent known structural debt from growing while it is extracted safely. The initial ratchet prevents `App.tsx` from exceeding its Build 48 baseline and requires navigation state to remain outside the application shell. The line budget must move downward as extractions land; it must not be raised to accommodate new features.

### 4. Existing domain scenario harnesses

Command:

```bash
npm run test:dave-stages-1-8
```

These scripts exercise established Vitruvius domain scenarios and guardrails. Some compatibility filenames still use the legacy DAVE name. They remain useful during the migration, but new behavior should prefer Jest tests against production exports.

The combined executable behavior command is:

```bash
npm run test:behavior
```

### 5. Static architecture contracts

Static command:

```bash
npm run jarvis:contracts
```

V.I.C. contracts verify that required services, documents, exports, boundaries, and safety markers exist. The compatibility command remains `jarvis:contracts`. These are static architecture checks, and a PASS does not by itself prove that the app behaves correctly or renders correctly.

The escaped-defect registry at `validation/jarvis/escaped-defects.json` maps defect families that previously reached users to executable regression evidence, manual validation, and the remaining limitation of that automation. `npm run test:jarvis-coverage` fails when this evidence becomes missing, skipped, or disconnected from the release gate.

### 6. End-to-end device workflows

Command:

```bash
npm run test:e2e
```

Maestro validates real navigation and critical user flows on a running app. Physical-device review remains required for camera, location, offline recovery, native sign-in, sync, and normal iPhone-width layout.

## Release Gate

Run the local release gate before a field build:

```bash
npm run qa:release
```

`qa:release` and `jarvis:qa` run the same complete automated gate. It runs compilation and secret checks, architecture checks, strict Jest behavior and coverage, established domain scenarios, UI and report contracts, core-flow simulation, photo intelligence, authority/safety tests, escaped-defect coverage, a production web export, and the static contract audit.

The V.I.C. automated gate reports `Automated Gate: PASS` or `FAIL` separately from `Release Certification: DEVICE VALIDATION REQUIRED`. Maestro and physical-device validation follow when a coherent build milestone is ready. No automated PASS certifies live three-device sync, native camera/location/sign-in behavior, touch latency, real provider availability, or visual quality on supported screen sizes.

## Coverage Policy

The initial whole-repository Jest baseline is intentionally low because most behavior predates the Jest harness. Coverage is a migration indicator, not a release-quality score. V.I.C. starts with floors just below the measured baseline so coverage cannot silently regress while higher-risk domains are migrated.

- Do not inflate coverage with tests that only execute lines.
- Add focused behavior tests when production logic is changed or extracted.
- Ratchet coverage upward for migrated domains.
- Do not impose an arbitrary global threshold until the live application shell and critical domains are under the harness.

## Test Naming Rule

- `test:unit`: executable Jest unit/component tests.
- `test:unit:strict`: executable Jest tests plus serious-warning and coverage regression enforcement.
- `test:behavior`: all local executable behavior suites.
- `jarvis:contracts`: static architecture and source contracts.
- `jarvis:qa`: complete automated pre-device release gate.
- `test:jarvis-coverage`: escaped-defect regression evidence audit.
- `test:e2e`: Maestro user workflows.
- `qa:release`: complete local pre-device release gate.

Every failure report should name the layer that failed. Do not describe a static contract PASS as proof that Vitruvius behaves correctly.
