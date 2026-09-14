import {
  sourceDatabaseFailure,
  sourcePhaseTimer,
} from "./ecos-source-diagnostics.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("assertion failed");
};
Deno.test("fixed classifications preserve caller response and redact content", async () => {
  for (
    const [code, expected] of Object.entries({
      "57014": "statement_cancelled",
      "22023": "contract_rejected",
      "42501": "permission_denied",
      "PGRST003": "connection_pool_timeout",
      "secret-document-id": "unclassified",
      "toString": "unclassified",
    })
  ) {
    const body = JSON.stringify({
      code,
      message: "private contents",
      hint: "secret",
      details: "customer",
    });
    const response = new Response(body, { status: 500 });
    assert(await sourceDatabaseFailure(response) === expected);
    assert(await response.text() === body);
  }
});
Deno.test("malformed oversized and absent bodies are bounded", async () => {
  assert(
    await sourceDatabaseFailure(new Response("invalid")) === "unavailable",
  );
  assert(
    await sourceDatabaseFailure(new Response("x".repeat(8193))) ===
      "unavailable",
  );
  assert(await sourceDatabaseFailure(new Response(null)) === "unavailable");
});
Deno.test("slow error stream cannot block diagnostic or caller", async () => {
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"code":'));
      },
    }),
  );
  const started = performance.now();
  assert(await sourceDatabaseFailure(response) === "unavailable");
  assert(performance.now() - started < 1000);
  void response.body?.cancel();
});
Deno.test("phase logs contain only fixed phase and numeric timings; broken logger is harmless", () => {
  const old = console.warn, logs: string[] = [];
  try {
    console.warn = (text: string) => {
      logs.push(text);
    };
    const timer = sourcePhaseTimer();
    timer.next("indexes");
    timer.finish();
    assert(logs.length === 2);
    for (const line of logs) {
      const item = JSON.parse(line);
      assert(
        Object.keys(item).sort().join(",") === "elapsedMs,event,phase,totalMs",
      );
      assert(
        typeof item.elapsedMs === "number" && typeof item.totalMs === "number",
      );
    }
    console.warn = () => {
      throw new Error("logger unavailable");
    };
    timer.next("result");
    timer.finish();
  } finally {
    console.warn = old;
  }
});
