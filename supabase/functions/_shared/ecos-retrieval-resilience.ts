export type ECOSRetrievalRPCResult<T> = Readonly<{
  data: readonly T[] | null;
  error: unknown | null;
}>;

export type ECOSBoundedRetrievalResult<T> = Readonly<{
  rows: readonly T[];
  retried: boolean;
  degraded: boolean;
}>;

/**
 * Retries one database statement timeout with a smaller result budget. A
 * second statement timeout degrades only that retrieval variant; all other
 * database failures remain fatal so authorization and integrity errors can
 * never be hidden as an empty search result.
 */
export async function runECOSBoundedRetrievalRPC<T>({
  request,
  primaryLimit,
  retryLimit,
}: {
  request: (limit: number) => PromiseLike<ECOSRetrievalRPCResult<T>>;
  primaryLimit: number;
  retryLimit: number;
}): Promise<ECOSBoundedRetrievalResult<T>> {
  const first = await requestSafely(request, boundedLimit(primaryLimit));
  if (!first.error) {
    return Object.freeze({
      rows: Object.freeze(Array.isArray(first.data) ? [...first.data] : []),
      retried: false,
      degraded: false,
    });
  }
  if (!isECOSDatabaseStatementTimeout(first.error)) throw first.error;

  const retry = await requestSafely(
    request,
    Math.min(boundedLimit(primaryLimit), boundedLimit(retryLimit)),
  );
  if (!retry.error) {
    return Object.freeze({
      rows: Object.freeze(Array.isArray(retry.data) ? [...retry.data] : []),
      retried: true,
      degraded: false,
    });
  }
  if (!isECOSDatabaseStatementTimeout(retry.error)) throw retry.error;
  return Object.freeze({
    rows: Object.freeze([]),
    retried: true,
    degraded: true,
  });
}

export function isECOSDatabaseStatementTimeout(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const message = typeof record.message === "string"
    ? record.message.trim()
    : "";
  return code === "57014" ||
    /statement timeout|canceling statement/i.test(message);
}

async function requestSafely<T>(
  request: (limit: number) => PromiseLike<ECOSRetrievalRPCResult<T>>,
  limit: number,
): Promise<ECOSRetrievalRPCResult<T>> {
  try {
    return await request(limit);
  } catch (error) {
    return Object.freeze({ data: null, error });
  }
}

function boundedLimit(value: number) {
  return Math.max(
    1,
    Math.min(100, Math.floor(Number.isFinite(value) ? value : 1)),
  );
}
