# Vitruvius Expo SDK 57 Upgrade

Date: July 26, 2026

## Outcome

Vitruvius has been upgraded from Expo SDK 54 to Expo SDK 57 on the dedicated
`codex/build112-expo-security-upgrade` branch. Build 111 remains the verified
rollback point and has not been overwritten.

## Runtime versions

- Expo: 57.0.8
- React Native: 0.86.0
- React: 19.2.3
- React DOM: 19.2.3
- TypeScript: 6.0.3
- Jest Expo: 57.0.2
- React Test Renderer: 19.2.3

Expo SDK 57 requires iOS 16.4 or newer. The local release environment uses a
supported Node and Xcode toolchain.

## Compatibility corrections

- Registered the Expo font, mail composer, sharing, and status bar plugins.
- Moved custom config plugins to Expo's supported config-plugin entry point.
- Moved the local text-recognition module to the Expo 57 module entry point.
- Replaced the removed React Native absolute-fill style alias.
- Updated the hardware-back test contract for React Native 0.86.
- Corrected three test mocks so Expo 57 receives the native platform primitives
  it requires.

## Verification

- Expo Doctor: 20 of 20 checks passed.
- Type checking, linting, metadata checks, and focused contracts: passed.
- Unit and regression tests: 1,036 passed in 152 suites.
- Web production export: passed with 11 static routes.
- V.I.C. static contracts: 251 passed, 0 warnings, 0 failures.
- Complete release gate: 13 layers passed, 1 warning, 0 failures.

The remaining release-gate warning is Android production signing. It does not
block the current iPhone and iPad release, but Android must not be certified
until a production signing key replaces the development key.

## Dependency security result

The production dependency audit improved from 47 advisories before the SDK
upgrade to 37 advisories after the compatible Expo 57 upgrade:

- Critical: 0
- High: 25
- Moderate: 12
- Low: 0

The remaining advisories are transitive Expo, React Native, Jest, Xcode, and
build-tool dependencies. The package manager's automatic forced fixes would
downgrade or otherwise move Vitruvius outside the Expo 57 compatibility set.
Those unsafe fixes were not applied. These advisories must be reviewed again
when compatible upstream releases become available.

## Release boundary

This upgrade is automated-gate ready but not yet device certified. Before the
next signed release is approved, Vitruvius still requires:

- live iPhone, iPad, and desktop synchronization validation;
- camera, location, native sign-in, offline recovery, and touch-latency checks;
- visual review on supported iPhone and iPad screen sizes;
- confirmation of live Supabase, storage, edge-function, and external
  AI-provider availability.

The signed Build 111 IPA is retained as the rollback artifact:

`build/ProjectPhotoUpdateTool-1.0.111-111/ProjectPhotoUpdateTool.ipa`

SHA-256:

`0419058b420b6e59a45a64a6a2ebad3ec3ba9c53b2ba31289454c84810967bd9`
