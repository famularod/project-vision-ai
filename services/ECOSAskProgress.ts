/**
 * Plain-language progress for the Ask ECOS wait. The server answers in one
 * request, so these stages are based on elapsed time and on what usually
 * happens in that window; the wording says "usually" and never claims a step
 * has finished. A drawing question takes about 40-60 seconds today.
 */
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
    detail: 'This is taking longer than usual. ECOS will stop and tell you if it cannot finish.',
  };
}

export function ecosAskElapsedLabel(elapsedSeconds: number): string {
  const seconds = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : 0;
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
