# Project Vision AI Maestro Testing

## Purpose

This document explains the first automated Maestro smoke-test sprint for Project Vision AI.

The goal is to protect the highest-risk mobile workflows without changing app behavior:

- App launches
- Bottom navigation works
- Projects opens
- Project Overview opens from a project
- Capture starts from bottom navigation
- Reports opens
- More/Admin opens

These tests are intentionally simple. They use visible text selectors so they reflect the same interface a project manager sees in the field.

## Current Status

Maestro is not currently installed or configured in this repository.

No packages were installed as part of this sprint.

The repository now includes Maestro flow files in:

```text
e2e/maestro
```

## macOS Install Instructions

Maestro CLI requires Java 17 or higher.

1. Confirm Java 17+ is available:

   ```bash
   java -version
   ```

2. Install Maestro CLI with one of the official macOS options.

   Curl installer:

   ```bash
   curl -fsSL "https://get.maestro.mobile.dev" | bash
   ```

   Homebrew:

   ```bash
   brew tap mobile-dev-inc/tap
   brew trust --formula mobile-dev-inc/tap/maestro
   brew install mobile-dev-inc/tap/maestro
   ```

3. Verify the CLI:

   ```bash
   maestro --help
   ```

4. For iOS simulator testing, make sure Xcode and Xcode Command Line Tools are installed. If simulators do not appear, run:

   ```bash
   xcodebuild -runFirstLaunch
   ```

   If prompted for the Xcode license:

   ```bash
   sudo xcodebuild -license accept
   ```

Official docs:

- Maestro CLI install: https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli.md
- Maestro quickstart: https://docs.maestro.dev/get-started/quickstart.md

## App ID

The flows use a dynamic app id:

```yaml
appId: ${APP_ID}
```

The npm script passes `APP_ID` from `MAESTRO_APP_ID`.

Default:

```bash
host.exp.Exponent
```

This default is useful for Expo Go.

For a development build, pass the native bundle id:

```bash
MAESTRO_APP_ID=com.yourcompany.projectvisionai npm run test:e2e:maestro
```

If your local test project is not the default seed project, pass the project name:

```bash
MAESTRO_PROJECT_NAME="My Project" npm run test:e2e:maestro
```

## How To Run

Start the app on an iOS simulator, Android emulator, or connected device first.

For Expo Go:

```bash
npm start
```

Open the app on the device, then run:

```bash
npm run test:e2e:maestro
```

For a dev-client/native build:

```bash
npm run ios
MAESTRO_APP_ID=com.yourcompany.projectvisionai npm run test:e2e:maestro
```

Run one flow directly:

```bash
maestro test -e APP_ID=host.exp.Exponent e2e/maestro/01-app-launches.yaml
```

Run all flows directly:

```bash
maestro test -e APP_ID=host.exp.Exponent e2e/maestro
```

## Test Files

- `01-app-launches.yaml`
- `02-bottom-navigation.yaml`
- `03-projects-opens.yaml`
- `04-project-overview-opens.yaml`
- `05-capture-starts.yaml`
- `06-reports-opens.yaml`
- `07-more-admin-opens.yaml`

## Selector Strategy

The first flows use visible text selectors:

- `Home`
- `Projects`
- `Capture`
- `Reports`
- `More`
- `Project Finder`
- `Project Overview`
- `Project Summary`
- `Recommended Next Action`
- `Add Photos`
- `Take Photo`
- `Change Project`
- `Admin`
- `Cloud Status`

This matches the Design Standard requirement that screens use clear, literal titles and readable buttons.

## Fragile Selectors

Some selectors may need future hardening:

- `PROJECT_NAME` defaults to `Building 2375 Compliance`. If seed/default projects change, pass a known project name with `-e PROJECT_NAME="Project Name"` or set `MAESTRO_PROJECT_NAME="Project Name"`.
- `Add Photos`, `Take Photo`, and `Change Project` depend on the capture flow opening directly into the inferred active project. If there are no active projects, this flow may need a separate no-project branch.
- Bottom navigation labels are visible text today; accessibility IDs would be more stable later.
- `Admin Actions` and `Cloud Status` are visible section titles; renaming those sections will require test updates.

## Future Hardening

Recommended next improvements:

- Add stable `testID` values to bottom navigation, project rows, and primary screen actions.
- Add a small seeded test-data mode for deterministic project names.
- Add screenshots for Home, Projects, Project Overview, Capture, Reports, and More/Admin.
- Add flows for schedule upload once a stable fixture file path is available.
- Add timed 60-second workflow checks for Capture Update and Generate Report.

## Product Standards Covered

These flows begin checking:

- Bottom navigation remains Home | Projects | Capture | Reports | More.
- Projects opens from bottom navigation.
- Project Overview is the default project landing experience.
- Capture starts quickly from bottom navigation.
- Reports opens a true Reports Hub.
- More opens Admin tools instead of placing admin clutter on Home.
