import { awaitECOSCancellableTask } from './ECOSPDFResourceLimits';

export async function readECOSBoundedResponseBytes(
  response: Response,
  {
    maximumBytes,
    label,
    timeoutMilliseconds = 60_000,
    signal,
  }: Readonly<{
    maximumBytes: number;
    label: string;
    timeoutMilliseconds?: number;
    signal?: AbortSignal;
  }>,
): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error(`The protected ${label} byte limit is invalid.`);
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`The ${label} is too large for protected in-browser processing.`);
  }
  if (!response.body) {
    throw new Error(`The ${label} download cannot be consumed through the required bounded stream.`);
  }
  if (signal?.aborted) throw abortError(label);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMilliseconds;
  let byteLength = 0;
  const onAbort = () => {
    void reader.cancel(abortError(label)).catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw abortError(label);
      const remainingMilliseconds = deadline - Date.now();
      if (remainingMilliseconds <= 0) {
        throw new Error(`The ${label} download exceeded its protected wall deadline.`);
      }
      const chunk = await awaitECOSCancellableTask({
        promise: reader.read(),
        cancel: () => reader.cancel(`The ${label} download exceeded its protected wall deadline.`),
        timeoutMilliseconds: remainingMilliseconds,
        timeoutMessage: `The ${label} download exceeded its protected wall deadline and was cancelled.`,
      });
      // A stream cancel is allowed to resolve the pending read as done. Never
      // mistake that cancellation sentinel for a complete protected download.
      if (signal?.aborted) throw abortError(label);
      if (chunk.done) break;
      const value = chunk.value;
      if (!value?.byteLength) continue;
      const nextByteLength = byteLength + value.byteLength;
      if (!Number.isSafeInteger(nextByteLength) || nextByteLength > maximumBytes) {
        throw new Error(`The ${label} is too large for protected in-browser processing.`);
      }
      chunks.push(value);
      byteLength = nextByteLength;
    }
    if (byteLength < 1) throw new Error(`The ${label} download was empty.`);
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already have been cancelled by the deadline or signal.
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function abortError(label: string) {
  const error = new Error(`The ${label} download was cancelled.`);
  error.name = 'AbortError';
  return error;
}
