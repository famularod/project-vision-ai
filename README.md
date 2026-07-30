# Vitruvius Project Intelligence

Vitruvius is a project-intelligence workspace for iPhone, iPad, and web. It
connects current tasks, field updates, schedules, documents, photos, and
project-manager decisions into one shared project record.

## Current workflow

1. Use **Overview** to choose a project and review the current priority.
2. Use **Tasks** to review schedule work, overdue items, and work needing attention.
3. Use **New Field Update** to capture photos, location, status, and useful notes.
4. Use **Talk** to ask about the selected project or record a confirmed memory.
5. Use **Reports** to review and approve a current project summary.
6. Use the web workspace for the same authorized record when a larger desktop view is useful.

## Run

```bash
npm install
npm run start
```

Open the app in Expo Go from the QR code, or run the native iOS/Android commands
from the Expo terminal. The Expo Router web workspace is also supported:

```bash
npm run web
```

## Quality gates

```bash
npm test
npm run test:release-contracts
npm run qa:release
```

`npm test` runs dependency/configuration checks, strict TypeScript, and executable
Jest tests. `test:release-contracts` checks ordered migrations, current Maestro
flows, UI policy, assets, and product metadata. `qa:release` runs the complete
VIGIL automated gate. Maestro execution and physical-device checks remain
required for release certification.

## Product metadata

The shared identity and release number are recorded in
`product-metadata.json`. Automated checks require it to match `app.json`,
`package.json`, `package-lock.json`, the native build numbers, and this README.
Product surfaces read the shared identity through `product-brand.ts`.

## Native source policy

This repository uses Expo Continuous Native Generation. The complete `ios/` and
`android/` projects are generated release artifacts and are not the source of
truth; reviewed app configuration, plugins, privacy strings, permissions, and
version metadata live in `app.json`, `eas.json`, `plugins/`, and
`product-metadata.json`. Signed artifacts still require platform entitlement,
permission, backup-policy, and signing review before release.

## Current identity

- Product: Vitruvius Project Intelligence
- Intelligence engine: Core
- Quality system: VIGIL (Vitruvius Integrity Gate and Inspection Layer)
- Bundle/package ID: `com.davidfamularo.projectphotoupdate`
- Supported platforms: iPhone, iPad, Android, and web
- Current version/build: `product-metadata.json`

Some internal filenames and compatibility commands still use the legacy DAVE,
PIE, JARVIS, V.I.C., or Project Vision AI names. They are implementation identifiers,
not current user-facing product copy.
