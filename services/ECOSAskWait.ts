import * as Crypto from 'expo-crypto';
import {
  ECOS_ASK_DEADLINE_MS,
  ECOS_ASK_STOPPED_MESSAGE,
  ecosAskInProgressRetryMs,
  ecosAskTimedOutMessage,
} from './ECOSAskProgress';

export type ECOSAskStopCode = 'question_timed_out' | 'question_cancelled';

/** What a request is given so it can be stopped, and recognised if it is sent again. */
export type ECOSAskControl = Readonly<{ signal: AbortSignal; clientRequestId: string }>;

/** The app stopped waiting for an answer: the time limit passed, or the user stopped it. */
export class ECOSAskStoppedError extends Error {
  constructor(public readonly code: ECOSAskStopCode, deadlineMs: number = ECOS_ASK_DEADLINE_MS) {
    super(code === 'question_timed_out' ? ecosAskTimedOutMessage(deadlineMs) : ECOS_ASK_STOPPED_MESSAGE);
    this.name = 'ECOSAskStoppedError';
  }
}

/** Whether a question ended because the app stopped waiting, not because the server answered. */
export function isECOSAskStopped(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return code === 'question_timed_out' || code === 'question_cancelled';
}

/** Whether the server refused because it is still working on this same question from an earlier ask. */
export function isECOSAskStillInProgress(error: unknown): boolean {
  return (error as { code?: unknown } | null | undefined)?.code === 'question_in_progress';
}

/**
 * One Ask ECOS question at a time for one screen (independent review R10).
 * The phone and iPad sheet and the desktop page both wait through this.
 *
 * - The wait is bounded. At the time limit the request is aborted and run()
 *   rejects, whatever the request itself is doing.
 * - cancel() does the same at once.
 * - run() settles once. An answer that arrives after a stop, a time-out, or a
 *   change of project or account is never handed back.
 * - A question that was stopped or timed out keeps its request id. Asking the
 *   same thing again (same project, question and conversation turn) sends
 *   the identical request, id included. The server's own repeat check
 *   (ecos_begin_project_question) matches on the project and the question:
 *   it replays a finished answer and refuses one still in progress. The id
 *   ties the two tries together in its records. Once the server answers
 *   anything for it, or reset() is called, the id is forgotten.
 * - "Still in progress" is not an answer to show (review pass 2 A1: Stop then
 *   Try Again was refused while the server finished the first ask). run()
 *   tells the screen through onStillInProgress, waits, and sends the same
 *   request again, until the answer comes, it is stopped, or the time limit
 *   that began with this run() passes.
 */
export function createECOSAskWait(deadlineMs: number = ECOS_ASK_DEADLINE_MS) {
  let current: { stop(code: ECOSAskStopCode, keepRequestId: boolean): void } | null = null;
  let retained: Readonly<{ key: string; clientRequestId: string }> | null = null;
  let resets = 0;

  return {
    async run<T>(
      identity: readonly unknown[],
      request: (control: ECOSAskControl) => Promise<T>,
      onStillInProgress?: () => void,
    ): Promise<T> {
      current?.stop('question_cancelled', false);
      const key = JSON.stringify(identity);
      const clientRequestId = retained?.key === key ? retained.clientRequestId : Crypto.randomUUID();
      retained = null;
      const startedAfterResets = resets;
      const controller = new AbortController();
      let keepRequestId = true;
      let stopWaiting!: (error: ECOSAskStoppedError) => void;
      const stopped = new Promise<never>((_resolve, reject) => { stopWaiting = reject; });
      const attempt = {
        stop(code: ECOSAskStopCode, keep: boolean) {
          if (current !== attempt) return;
          current = null;
          keepRequestId = keep;
          stopWaiting(new ECOSAskStoppedError(code, deadlineMs));
          controller.abort();
        },
      };
      current = attempt;
      const timer = setTimeout(() => attempt.stop('question_timed_out', true), deadlineMs);
      let pause: ReturnType<typeof setTimeout> | undefined;
      try {
        for (;;) {
          try {
            return await Promise.race([stopped, request({ signal: controller.signal, clientRequestId })]);
          } catch (error) {
            if (!isECOSAskStillInProgress(error)) throw error;
            onStillInProgress?.();
            const retryMs = ecosAskInProgressRetryMs((error as { retryAfterSeconds?: unknown }).retryAfterSeconds);
            await Promise.race([stopped, new Promise<void>(resolve => { pause = setTimeout(resolve, retryMs); })]);
          }
        }
      } catch (error) {
        // Nothing came back, so asking again is the same request, not a new one.
        if (isECOSAskStopped(error) && keepRequestId && startedAfterResets === resets) {
          retained = { key, clientRequestId };
        }
        throw error;
      } finally {
        clearTimeout(timer);
        clearTimeout(pause);
        if (current === attempt) current = null;
      }
    },
    /** Stops waiting now. The question can be asked again as the same request. */
    cancel() {
      current?.stop('question_cancelled', true);
    },
    /** The project or account changed: stops waiting and forgets the request a retry would have repeated. */
    reset() {
      resets += 1;
      current?.stop('question_cancelled', false);
      retained = null;
    },
  };
}

export type ECOSAskWait = ReturnType<typeof createECOSAskWait>;
