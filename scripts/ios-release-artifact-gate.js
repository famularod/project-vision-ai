#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  validateCloudClientConfiguration,
} = require("./cloud-client-config-preflight");

const REQUIRED_PUBLIC_CLIENT_KEYS = Object.freeze([
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
]);

function embeddedClientConfigurationFailures(bundle, environment) {
  return REQUIRED_PUBLIC_CLIENT_KEYS.filter((key) => {
    const value = environment[key]?.trim();
    return !value || !bundle.includes(Buffer.from(value));
  });
}

function listedLibraries(binaryPath) {
  return execFileSync("/usr/bin/otool", ["-L", binaryPath], {
    encoding: "utf8",
  });
}

function verifyNativeCodeSignatures(binaryPaths, run = spawnSync) {
  let expectedTeam;
  for (const binaryPath of binaryPaths) {
    const details = run(
      "/usr/bin/codesign",
      ["-d", "--verbose=4", binaryPath],
      {
        encoding: "utf8",
      },
    );
    const description = `${details.stdout || ""}\n${details.stderr || ""}`;
    const team = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(description)?.[1];
    if (
      details.status !== 0 ||
      !team ||
      !/^Authority=Apple /m.test(description)
    ) {
      throw new Error(
        `Native code lacks an Apple device signing identity: ${binaryPath}`,
      );
    }
    expectedTeam ??= team;
    if (team !== expectedTeam) {
      throw new Error(
        `Native code has a different signing team: ${binaryPath}`,
      );
    }
    const verification = run(
      "/usr/bin/codesign",
      ["--verify", "--strict", binaryPath],
      {
        encoding: "utf8",
      },
    );
    if (verification.status !== 0) {
      throw new Error(
        `Native code signature verification failed: ${binaryPath}`,
      );
    }
  }
  if (!expectedTeam)
    throw new Error("No native code signatures were examined.");
}

function main() {
  const appPath = process.argv[2] || process.env.VITRUVIUS_IOS_APP_PATH;
  if (!appPath) {
    throw new Error(
      "Provide the signed .app path as the first argument or VITRUVIUS_IOS_APP_PATH.",
    );
  }

  const resolvedAppPath = path.resolve(appPath);
  const infoPath = path.join(resolvedAppPath, "Info.plist");
  const bundlePath = path.join(resolvedAppPath, "main.jsbundle");
  if (!fs.existsSync(infoPath) || !fs.existsSync(bundlePath)) {
    throw new Error(
      "The selected artifact is not a complete Vitruvius iOS app.",
    );
  }

  const environmentResult = validateCloudClientConfiguration(
    path.resolve(__dirname, ".."),
    process.env,
  );
  if (!environmentResult.ok) {
    throw new Error(
      "Cloud client configuration is unavailable; refusing to approve the iOS artifact.",
    );
  }

  const bundle = fs.readFileSync(bundlePath);
  const missingEmbeddedValues = embeddedClientConfigurationFailures(
    bundle,
    process.env,
  );
  if (missingEmbeddedValues.length > 0) {
    throw new Error(
      `The iOS JavaScript bundle does not contain ${missingEmbeddedValues.join(", ")}.`,
    );
  }

  const executable = execFileSync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleExecutable", "raw", "-o", "-", infoPath],
    { encoding: "utf8" },
  ).trim();
  const nativeBinaries = [path.join(resolvedAppPath, executable)];
  const frameworksPath = path.join(resolvedAppPath, "Frameworks");
  if (fs.existsSync(frameworksPath)) {
    for (const entry of fs.readdirSync(frameworksPath, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".framework")) continue;
      const frameworkName = entry.name.slice(0, -".framework".length);
      const binaryPath = path.join(frameworksPath, entry.name, frameworkName);
      if (fs.existsSync(binaryPath)) nativeBinaries.push(binaryPath);
    }
  }

  const testingFrameworkReferences = nativeBinaries.filter((binaryPath) =>
    listedLibraries(binaryPath).includes("Testing.framework"),
  );
  if (testingFrameworkReferences.length > 0) {
    throw new Error(
      "The iOS artifact contains a forbidden runtime dependency on Testing.framework.",
    );
  }

  // A deep outer-bundle check can accept an unsigned embedded framework as a
  // sealed resource. iOS installation requires each executable to be signed.
  verifyNativeCodeSignatures(nativeBinaries);

  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", resolvedAppPath],
    {
      stdio: "pipe",
    },
  );

  process.stdout.write(
    "Vitruvius iOS release artifact gate PASS: cloud configuration is embedded, native linkage is customer-safe, and the signature is valid.\n",
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(
      `Vitruvius iOS release artifact gate FAIL: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_PUBLIC_CLIENT_KEYS,
  embeddedClientConfigurationFailures,
  verifyNativeCodeSignatures,
  main,
};
