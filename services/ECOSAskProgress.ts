/**
 * Plain-language progress for the Ask ECOS wait. The server answers in one
 * request, so these stages are based on elapsed time and on what usually
 * happens in that window; the wording says "usually" and never claims a step
 * has finished. A drawing question takes about 40-60 seconds today.
 */

/**
 * How long the app waits for one Ask ECOS answer before it stops and says so
 * (independent review R10: there was no limit, and no way to stop). The live
 * gateway (ecos-agent-customer-gateway as deployed 30 Sep 2026) allows 10 s
 * to check the sign-in and then 125 s for the answer engine, after which it
 * answers with its own time-out: 135 s is the server's longest wait. The 15 s
 * on top lets that answer travel back over a slow site connection, so the
 * server's own word is heard before the app gives up.
 */
export const ECOS_ASK_SERVER_LONGEST_WAIT_MS = 10_000 + 125_000;
export const ECOS_ASK_DEADLINE_MS = ECOS_ASK_SERVER_LONGEST_WAIT_MS + 15_000;

export const ECOS_ASK_STOPPED_MESSAGE =
  'You stopped this question before ECOS answered. No answer has been verified. ' +
  'Your question is still here if you want to ask it again.';

export function ecosAskTimedOutMessage(deadlineMs: number = ECOS_ASK_DEADLINE_MS): string {
  return `ECOS did not answer within ${ecosAskElapsedLabel(deadlineMs / 1000)}, so the app stopped waiting. ` +
    'No answer has been verified. Your question is still here — try again.';
}

/**
 * How long the app waits before it asks again when the server says it is
 * still working on this same question (review pass 2 A1: Stop then Try Again
 * was refused with "already reviewing that question"). A refused repeat
 * starts no work and is not counted toward the question limit:
 * ecos_begin_project_question answers "in progress" before it counts or
 * records anything. So the wait only has to be kind to the server, and 5 s
 * shows a finished answer within about that long. When the server names its
 * own wait (the classic route sends 15 s), that is used instead.
 */
export const ECOS_ASK_IN_PROGRESS_RETRY_MS = 5_000;

export function ecosAskInProgressRetryMs(serverRetryAfterSeconds?: unknown): number {
  const seconds = Number(serverRetryAfterSeconds);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(60, Math.max(2, seconds)) * 1000
    : ECOS_ASK_IN_PROGRESS_RETRY_MS;
}

/**
 * How long a repeat of the request may stay open before the app takes it
 * that the server is working on it as a run of its own (review pass 3 A1w:
 * when the first run had failed, the screen went on saying it was waiting
 * for that answer while a new run did the work). An "in progress" refusal
 * and a stored answer both come back in about a second; a repeat still open
 * after this is neither.
 */
export const ECOS_ASK_REFUSAL_GRACE_MS = 4_000;

export type ECOSAskProgressStage = Readonly<{
  key: 'finding' | 'reading' | 'writing' | 'checking' | 'longer' | 'earlier';
  title: string;
  detail: string;
}>;

/**
 * `earlierAskStillRunning`: the server said it was already working on this
 * question (from the ask that was just stopped or timed out, or one made on
 * another device), so the stages by elapsed time would describe steps that
 * are not starting now.
 */
export function ecosAskProgressStage(
  elapsedSeconds: number,
  earlierAskStillRunning = false,
): ECOSAskProgressStage {
  if (earlierAskStillRunning) {
    return {
      key: 'earlier',
      title: 'Still working on this question…',
      detail: 'ECOS had already started on this question when you asked again. The app is waiting for that answer and shows it as soon as it is ready. ' +
        `If there is none by ${ecosAskElapsedLabel(ECOS_ASK_DEADLINE_MS / 1000)}, the app stops waiting and keeps your question. You can also stop now.`,
    };
  }
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  if (seconds < 8) {
    return {
      key: 'finding',
      title: 'Finding the right pages and records…',
      detail: 'Searching current tasks, field updates and the indexed drawings for this project.',
    };
  }
  if (seconds < 32) {
    return {
      key: 'reading',
      title: 'Reading the drawing sheet…',
      detail: 'ECOS opens the protected page and reads the picture itself. This is the slow part — usually 20 to 30 seconds.',
    };
  }
  if (seconds < 48) {
    return {
      key: 'writing',
      title: 'Writing the answer…',
      detail: 'Every statement is matched to a cited page before it is shown.',
    };
  }
  if (seconds < 90) {
    return {
      key: 'checking',
      title: 'Checking the answer against the sources…',
      detail: 'Almost done. Drawing questions usually take 40 to 60 seconds in total.',
    };
  }
  return {
    key: 'longer',
    title: 'Still working…',
    detail: `This is taking longer than usual. If there is no answer by ${ecosAskElapsedLabel(ECOS_ASK_DEADLINE_MS / 1000)}, ` +
      'the app stops waiting and keeps your question so you can try again. You can also stop now.',
  };
}

export function ecosAskElapsedLabel(elapsedSeconds: number): string {
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : 0;
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
