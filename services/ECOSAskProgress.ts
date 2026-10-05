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

export type ECOSAskProgressStage = Readonly<{
  key: 'finding' | 'reading' | 'writing' | 'checking' | 'longer';
  title: string;
  detail: string;
}>;

export function ecosAskProgressStage(elapsedSeconds: number): ECOSAskProgressStage {
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
