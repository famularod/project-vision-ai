// Launch the exact packaged CMD with no credentials and no outbound network.
// Static cache/build success alone misses transitive dynamic imports.
const dockerfile = await Deno.readTextFile("/app/workers/ecos-agent-query-runtime/Dockerfile");
const command = dockerfile.match(/^CMD (\[.*\])$/m)?.[1];
if (!command) throw Error("Runtime CMD unavailable");
const args: string[] = JSON.parse(command);
if (!args.includes("--cached-only") || !args.includes("--no-prompt") ||
    !args.includes("--frozen") || !args.includes("--lock=/app/deno.lock")) throw Error("Unbounded runtime CMD");
const isolated = args.map((arg) => arg.startsWith("--allow-net=") ? "--allow-net=0.0.0.0:8080" : arg);
const hash = (await Deno.readTextFile("/app/ecos-agent-runtime-source.sha256")).trim();
const child = new Deno.Command("deno", { args: isolated, clearEnv: true,
  env: { DENO_DIR: "/app/.deno_cache", PORT: "8080", ECOS_AGENT_RUNTIME_ENABLED: "false",
    ECOS_AGENT_PACKAGE_SHA256: hash, ECOS_AGENT_PREVIEW_GATEWAY_TOKEN: "startup-test-not-a-credential-00000000" },
  stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
let exited = false;
const output = child.output().then((value) => { exited = true; return value; });
let passed = false;
try {
  for (let attempt = 0; attempt < 60 && !exited; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8080/healthz", { signal: AbortSignal.timeout(300) });
      const body = await response.json();
      if (response.status !== 200 || body.packagedSourceSha256 !== hash || body.enabled !== false) throw Error("Unexpected health identity");
      const refused = await fetch("http://127.0.0.1:8080/question", { method: "POST", body: "{}" });
      if (refused.status !== 503 || (await refused.json()).error !== "preview_not_enabled") throw Error("Disabled runtime answered");
      passed = true;
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
} finally {
  if (!exited) { try { child.kill("SIGTERM"); } catch { /* exited between checks */ } }
  const result = await output;
  if (!passed) {
    console.error(new TextDecoder().decode(result.stderr));
    throw Error("Packaged offline startup failed");
  }
}
console.log("ECOS_OFFLINE_PACKAGED_STARTUP_PASS");
