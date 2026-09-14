#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  embeddedClientConfigurationFailures,
  verifyNativeCodeSignatures,
} = require("./ios-release-artifact-gate");

const environment = {
  EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-key",
};

assert.deepEqual(
  embeddedClientConfigurationFailures(
    Buffer.from(
      `${environment.EXPO_PUBLIC_SUPABASE_URL}:${environment.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
    ),
    environment,
  ),
  [],
);
assert.deepEqual(
  embeddedClientConfigurationFailures(
    Buffer.from(environment.EXPO_PUBLIC_SUPABASE_URL),
    environment,
  ),
  ["EXPO_PUBLIC_SUPABASE_ANON_KEY"],
);
assert.deepEqual(
  embeddedClientConfigurationFailures(Buffer.alloc(0), environment),
  ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"],
);

const signed = (team) => ({
  status: 0,
  stderr: `Authority=Apple Development: Test\nTeamIdentifier=${team}\n`,
});
const probe = (overrides) => (_command, args) =>
  overrides[args.at(-1)] || signed("TEAM123456");
assert.doesNotThrow(() =>
  verifyNativeCodeSignatures(["app", "hermes"], probe({})),
);
assert.throws(
  () =>
    verifyNativeCodeSignatures(
      ["app", "hermes"],
      probe({
        hermes: { status: 1, stderr: "code object is not signed at all" },
      }),
    ),
  /lacks an Apple device signing identity/,
);
assert.throws(
  () =>
    verifyNativeCodeSignatures(
      ["app", "hermes"],
      probe({
        hermes: {
          status: 0,
          stderr: "Signature=adhoc\nTeamIdentifier=not set",
        },
      }),
    ),
  /lacks an Apple device signing identity/,
);
assert.throws(
  () =>
    verifyNativeCodeSignatures(
      ["app", "hermes"],
      probe({
        hermes: signed("OTHER12345"),
      }),
    ),
  /different signing team/,
);
assert.throws(
  () =>
    verifyNativeCodeSignatures(["app", "hermes"], (_command, args) =>
      args.includes("--verify") && args.at(-1) === "hermes"
        ? { status: 1, stderr: "invalid signature" }
        : signed("TEAM123456"),
    ),
  /signature verification failed/,
);
assert.throws(
  () => verifyNativeCodeSignatures([], probe({})),
  /No native code/,
);

console.log(
  "iOS release artifact gate contract PASS, including unsigned, ad-hoc, wrong-team and invalid embedded code.",
);
