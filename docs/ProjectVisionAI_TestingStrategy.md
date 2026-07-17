# Project Vision AI Testing Strategy

## Purpose

Project Vision AI uses separate quality layers because each layer answers a different question. A passing source-contract check does not prove behavior, and a passing unit test does not prove that a field workflow fits on an iPhone screen.

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

These scripts exercise DAVE's established domain scenarios and guardrails. Some also contain source-contract assertions. They remain useful during the migration, but new behavior should prefer Jest tests against production exports.

The combined executable behavior command is:

```bash
npm run test:behavior
```

### 5. Static architecture contracts

Commands:

```bash
npm run jarvis:contracts
npm run jarvis:qa
```

JARVIS contracts verify that required services, documents, exports, boundaries, and safety markers exist. They are static architecture checks. A PASS does not by itself prove that the app behaves correctly or renders correctly.

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

This gate runs compilation and secret checks, executable behavior tests, UI contracts, report tests, and static JARVIS contracts. Maestro and physical-device validation follow when a coherent build milestone is ready.

## Coverage Policy

The initial whole-repository Jest baseline is intentionally low because most behavior predates the Jest harness. Coverage is a migration indicator, not a release-quality score.

- Do not inflate coverage with tests that only execute lines.
- Add focused behavior tests when production logic is changed or extracted.
- Ratchet coverage upward for migrated domains.
- Do not impose an arbitrary global threshold until the live application shell and critical domains are under the harness.

## Test Naming Rule

- `test:unit`: executable Jest unit/component tests.
- `test:behavior`: all local executable behavior suites.
- `jarvis:contracts`: static architecture and source contracts.
- `test:e2e`: Maestro user workflows.
- `qa:release`: complete local pre-device release gate.

Every failure report should name the layer that failed. Do not describe a static contract PASS as proof that DAVE's behavior is correct.
