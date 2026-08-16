# Ask ECOS Real-World Production Acceptance

## Purpose

This is the release-blocking test for Ask ECOS. It calls the deployed
`ecos-ask-project` function with the authenticated 2375 project and the current
drawing index. During controlled hosted-index validation it uses the protected
shadow mode; after promotion it uses the live publication path. It does not
substitute mocked search results, typed fixtures, source-code string checks, or
a simulated model response.

A release passes only when all approved questions are answered correctly with
current, project-scoped proof. A correct refusal is allowed only for a benchmark
case that explicitly requires a refusal. The current benchmark contains 15
supported questions, so all 15 must pass.

## What each case checks

Each question can require any combination of:

- exact answer values and units;
- correct distinction between drawing intent and installed condition;
- current, non-superseded document identity;
- verified sheet identity and exact PDF page;
- a bounded proof region with normalized page coordinates;
- complete high-resolution overview and tile coverage for the cited page;
- one or more cited drawings;
- one or more cited sheets;
- facts combined across civil and electrical drawings when the question needs
  both;
- no internal database or evidence ids in the user-facing answer.

The approved questions are defined in
`validation/ecos/ask-ecos-real-world-cases.json`.

## Run the live test

For the controlled hosted shadow gate, load the owner token and the protected
Vitruvius worker token into the process environment. The two values have
different purposes and neither is written to the result:

```sh
ECOS_LIVE_SHADOW_VALIDATION=true \
ECOS_LIVE_ACCESS_TOKEN='short-lived-owner-token' \
ECOS_SERVICE_WORKER_TOKEN='operator-secret' \
npm run test:ecos-ask:live
```

The shadow run fails closed unless every required drawing has a current-checksum
hosted job in `ready`, every source page is Assurance-approved, and every cited
page has zero unresolved regions. The normal customer Ask path cannot enable
shadow mode.

For a live-publication acceptance run, use either a short-lived authenticated
access token:

```sh
ECOS_LIVE_ACCESS_TOKEN='short-lived-token' npm run test:ecos-ask:live
```

Or use the same owner account as the app without saving the password in a file:

```sh
ECOS_LIVE_TEST_EMAIL='owner@example.com' \
ECOS_LIVE_TEST_PASSWORD='password' \
npm run test:ecos-ask:live
```

The test never writes the token, email, or password to its result. It records a
bounded result at `validation/output/ecos-ask-live-acceptance.json`, which is
excluded from source control.

## Release behavior

`npm run qa:release` now includes `check:ecos-ask:live-evidence`. That layer
fails when:

- no live result exists;
- fewer than 10 cases passed;
- any approved case failed;
- the pass rate is below 100%;
- required drawing pages were not ready;
- the result is older than 24 hours; or
- the Ask ECOS runtime, database contract, or benchmark changed after the live
  run.

Therefore a new build must not be created from a release gate that lacks a
fresh 100% production acceptance result.
