# Project Vision AI — DAVE

Mobile project-intelligence app for capturing field evidence, reviewing schedule
and action risks, asking DAVE about a project, and producing evidence-backed
reports. The supported platforms are iOS and Android.

## Current field workflow

1. Use **Overview** to choose or create a project and review the current priority.
2. Use **Tasks** to review schedule work and items needing verification.
3. Use **New Field Update** to capture photos, location, status, and useful notes.
4. Use **Talk** to ask about the selected project or record a confirmed memory.
5. Use **Reports** to review, correct, approve, and share an evidence-backed report.

## Run

```bash
npm install
npm run start
```

Open the app in Expo Go from the QR code, or run the native iOS/Android commands
from the Expo terminal. Web is intentionally not a supported release platform.

## Quality gates

```bash
npm test
npm run qa:release
```

`npm test` runs dependency/configuration checks, strict TypeScript, and executable
Jest tests. `npm run qa:release` adds behavioral, UI-contract, architecture,
security, and JARVIS contract gates. Maestro and physical-device checks remain
required for a release candidate.

## Native source policy

This repository uses Expo Continuous Native Generation. The complete `ios/` and
`android/` projects are generated release artifacts and are not the source of
truth; reviewed app configuration, plugins, privacy strings, permissions, and
version metadata live in `app.json`, `eas.json`, and `plugins/`. Product icon
assets are intentionally versioned. Signed artifacts still require platform
entitlement, permission, backup-policy, and signing review before release.

## Release configuration

- Product: Project Vision AI
- In-app assistant: DAVE
- Bundle/package ID: `com.davidfamularo.projectphotoupdate`
- Supported platforms: iOS and Android
- Current version/build: see `app.json`
