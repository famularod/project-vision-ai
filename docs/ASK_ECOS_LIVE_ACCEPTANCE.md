# Ask ECOS Real-World Production Acceptance

## Purpose

This is one input to the release decision for Ask ECOS. A private or protected
shadow run is diagnostic only and can never authorize release. Release evidence
must come from the signed-in customer path: the real `ecos-ask-project` slug,
the same Supabase Functions transport used by the app, live published evidence,
no shadow validation flag, no service-worker token, and an exact `web`, `iphone`,
or `ipad` trace identity.

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
excluded from source control. Because this command-line runner mirrors only the
network transport, it records `transport_equivalent_cli` and is rejected as
release evidence. It may not claim that it traversed the application UI.

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

## Required staged method

1. Run all 34 canonical questions once through the customer path.
2. If any fail, complete the batch, group the failures by shared cause, repair
   them together, and repeat the full 34-question pass. Do not run repeat cycles
   while the first pass has failures.
3. After 34/34, run the 30 real-user language variants once. These include the
   exact user-reported questions, typos, speech-like wording, construction
   synonyms, multi-document questions, and safe-refusal questions.
4. Only after that first language pass is perfect may two repeat cycles run.
5. Grade delivery, answer correctness, citation identity, proof quality, and
   safety/limitations separately so a correct answer is not mislabeled as a
   retrieval failure and an unsafe answer cannot pass on wording alone.
6. On web, iPhone, and iPad, submit at least one question through the visible
   Ask ECOS interface and open its cited proof. A script that merely labels a
   request as a device does not satisfy this requirement.
7. Keep private candidate tests for diagnosis and repair only. The final release
   decision is based solely on the customer-path results above.
