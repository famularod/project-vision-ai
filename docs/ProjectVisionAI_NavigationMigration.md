# Project Vision AI Navigation Migration

## Decision

Project Vision AI should move to Expo Router after screen state is isolated from `AppShell`, not before.

Expo Router is the preferred destination because it provides typed file-based routes, native stacks, deep linking, URL-addressable screens, and platform back behavior. The current Build 48 application remains on its working native path while the migration prerequisites are completed.

## What Is Complete

- The screen union lives in `types/app-navigation.ts`.
- Every screen has a unique future path in `APP_SCREEN_PATHS`.
- Current navigation state and temporary return-screen state live in `useAppNavigation`, not directly in `AppShell`.
- The outer native frame and bottom navigation live in `AppShellFrame`.
- Executable tests verify screen changes, temporary return destinations, route uniqueness, and bottom-tab delegation.

## Why Router Is Not Installed Yet

Most screens still depend on state and commands owned by `AppShell`. Installing a router now would create route files that still require one giant parent component, preserving the primary architecture problem while changing the native entry path.

The repository also currently uses Expo SDK 54. The project instruction requires development decisions to follow the exact SDK 56 documentation. The SDK upgrade and Router adoption should be one deliberate native-platform milestone with its own build and device regression, not an incidental dependency change during state extraction.

## Migration Gates

Expo Router adoption begins when:

1. Each primary screen can mount from domain providers without a large prop bundle from `AppShell`.
2. Project, schedule, capture, reports, sync/auth, and DAVE authority state have stable domain ownership.
3. Navigation behavior tests cover Overview, Tasks, Talk, Reports, Project Workspace, update detail, Settings, and modal return paths.
4. The Expo SDK 56 upgrade is separately planned and validated.
5. The physical-device build, camera, location, sign-in, offline queue, sync, and reports have a known regression checklist.

## Route Plan

- `/` — Overview
- `/tasks` — Tasks and schedule
- `/reports` — Reports
- `/projects/workspace` — selected project workspace
- `/capture/photos` — field evidence capture
- `/capture/review` — field update review
- `/updates` and `/updates/detail` — update history
- `/projects/documents` — project documents
- `/contacts` — recipients
- `/settings` and `/settings/diagnostics` — settings and technical support

Project and update identifiers should become dynamic route parameters during Router migration. The current route contract intentionally records stable destinations first without changing persisted identifiers or user data.

## Safety Rule

Do not run a second navigation system beside the current controller in production. Migrate one coherent route tree after the gates above pass, then remove the compatibility controller after physical-device verification.
