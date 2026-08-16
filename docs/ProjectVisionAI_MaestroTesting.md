# Vitruvius Maestro Testing

## Purpose

Maestro exercises the current Vitruvius mobile interface on a running native app.
The flows protect these field journeys:

- launch and primary navigation;
- active-project discovery;
- project detail and Tasks and Schedule;
- New Field Update through the camera handoff;
- prepared reports and approval controls;
- Settings, Sync Now, and Back Up Data.

Visible selectors deliberately match the words a project manager sees. The
repository contract check rejects stale product labels before a device run.

## Commands

Install Maestro using its official installer and confirm Java 17 or newer:

```bash
curl -Ls https://get.maestro.mobile.dev | bash
java -version
maestro --help
```

Start or install the app on a simulator, emulator, or connected device, then run:

```bash
npm run test:e2e:maestro
```

The npm command injects:

- `MAESTRO_APP_ID`, defaulting to `host.exp.Exponent` for Expo Go;
- `MAESTRO_PROJECT_NAME`, defaulting to `2375 Compliance Project`.

A native release or development build uses the Vitruvius bundle identifier:

```bash
MAESTRO_APP_ID=com.davidfamularo.projectphotoupdate \
MAESTRO_PROJECT_NAME="2375 Compliance Project" \
npm run test:e2e:maestro
```

Run one flow directly:

```bash
maestro test \
  -e APP_ID=host.exp.Exponent \
  -e PROJECT_NAME="2375 Compliance Project" \
  e2e/maestro/05-capture-starts.yaml
```

## Current flows

- `01-app-launches.yaml`
- `02-bottom-navigation.yaml`
- `03-projects-opens.yaml`
- `04-project-overview-opens.yaml`
- `05-capture-starts.yaml`
- `06-reports-opens.yaml`
- `07-more-admin-opens.yaml`

`npm run test:maestro:contracts` verifies that every flow exists, launches the
injected app id, uses current Vitruvius labels, and is wired into both native CI
jobs. It does not replace native execution.

## Continuous integration

`.github/workflows/mobile-e2e.yml` runs the same flows against locally built
release apps on an iOS simulator and Android emulator. The workflow runs on a
weekday schedule and can be started manually. It does not publish an EAS update,
submit an app, deploy Supabase, or change external state.

`.github/workflows/mobile-ci.yml` runs the fast flow-contract validation on
pull requests and configured branches. This catches stale selectors and missing
CI wiring without pretending it drove a device.

## Determinism and known limits

- The selected account must contain the named active project. Set
  `MAESTRO_PROJECT_NAME` when the fixture differs.
- The capture flow reaches the native Take Photo handoff. Camera quality,
  permission prompts, photo-library behavior, and real uploads still require
  physical-device evidence.
- Reports and Settings selectors depend on the current PM-facing labels.
- Seeded test data and stable `testID` values would make flows less dependent on
  account content and visible copy.
- Schedule upload needs a deterministic fixture and safe test account before it
  can be automated without risking production records.

## Release boundary

A passing Maestro run proves only the exercised simulator/emulator paths. V.I.C.
still requires physical iPhone/iPad review for touch latency, keyboard behavior,
camera and location, background/foreground refresh, offline recovery, and live
three-device synchronization.
