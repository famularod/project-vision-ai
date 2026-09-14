/** Fixed, content-free diagnostics. Never logs bodies, URLs, IDs or messages. */
export function sourceDiagnostic(value: Readonly<Record<string, unknown>>) {
  try {
    console.warn(JSON.stringify(value));
  } catch { /* Diagnostics must never change request behavior. */ }
}

export function sourcePhaseTimer() {
  const started = performance.now();
  let phase = "input", phaseStarted = started;
  const emit = () =>
    sourceDiagnostic({
      event: "ecos_owner_source_phase_timing",
      phase,
      elapsedMs: Math.round(performance.now() - phaseStarted),
      totalMs: Math.round(performance.now() - started),
    });
  return {
    next(
      next:
        | "inventory"
        | "indexes"
        | "page_observations"
        | "observation_bundle"
        | "raster_load"
        | "raster_revalidate"
        | "result",
    ) {
      emit();
      phase = next;
      phaseStarted = performance.now();
    },
    finish: emit,
  };
}

/** Reads only a bounded clone of an error response; caller keeps its body. */
export async function sourceDatabaseFailure(
  response: Response,
): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return "unavailable";
    const bounded = async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const item = await reader!.read();
        if (item.done) break;
        size += item.value.length;
        if (size > 8192) return "unavailable";
        chunks.push(item.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const value = JSON.parse(new TextDecoder().decode(bytes));
      const codes: Record<string, string> = {
        "57014": "statement_cancelled",
        "55P03": "lock_unavailable",
        "53300": "connections_exhausted",
        "22023": "contract_rejected",
        "42501": "permission_denied",
        "PGRST003": "connection_pool_timeout",
      };
      return typeof value?.code === "string" && Object.hasOwn(codes, value.code)
        ? codes[value.code]
        : "unclassified";
    };
    return await Promise.race([
      bounded(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("unavailable"), 250);
      }),
    ]);
  } catch {
    return "unavailable";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A tee cancellation may wait for the caller's body: never await it.
    void reader?.cancel().catch(() => {});
  }
}
