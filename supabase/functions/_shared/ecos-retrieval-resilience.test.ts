import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  isECOSDatabaseStatementTimeout,
  runECOSBoundedRetrievalRPC,
} from "./ecos-retrieval-resilience.ts";

Deno.test("retrieval retries one statement timeout with a smaller budget", async () => {
  const limits: number[] = [];
  const result = await runECOSBoundedRetrievalRPC({
    primaryLimit: 48,
    retryLimit: 12,
    request: (limit) => {
      limits.push(limit);
      return Promise.resolve(
        limits.length === 1
          ? {
            data: null,
            error: {
              code: "57014",
              message: "canceling statement due to statement timeout",
            },
          }
          : { data: [{ id: "recovered" }], error: null },
      );
    },
  });
  assertEquals(limits, [48, 12]);
  assertEquals(result, {
    rows: [{ id: "recovered" }],
    retried: true,
    degraded: false,
  });
});

Deno.test("a repeated statement timeout degrades only that retrieval variant", async () => {
  const result = await runECOSBoundedRetrievalRPC({
    primaryLimit: 24,
    retryLimit: 8,
    request: () =>
      Promise.resolve({
        data: null,
        error: { code: "57014", message: "statement timeout" },
      }),
  });
  assertEquals(result, { rows: [], retried: true, degraded: true });
});

Deno.test("authorization and integrity failures remain fatal", async () => {
  await assertRejects(
    () =>
      runECOSBoundedRetrievalRPC({
        primaryLimit: 24,
        retryLimit: 8,
        request: () =>
          Promise.resolve({ data: null, error: { code: "42501" } }),
      }),
  );
  assertEquals(isECOSDatabaseStatementTimeout({ code: "42501" }), false);
});
