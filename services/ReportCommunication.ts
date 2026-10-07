/**
 * Audit P1-40: report communication state must reflect what the system
 * composer actually reported, never optimistic assumptions. Only a
 * 'completed' outcome may mark communication done; canceled or
 * undetermined composers leave the report un-communicated.
 */

export type ReportCommunicationOutcome = 'completed' | 'canceled' | 'unknown';

/** Maps expo-mail-composer statuses to a communication outcome. */
export function mailComposerOutcome(
  status: string | null | undefined,
): ReportCommunicationOutcome {
  if (status === 'sent') return 'completed';
  if (status === 'cancelled') return 'canceled';
  return 'unknown';
}

/** Maps expo-sms results to a communication outcome. */
export function smsComposerOutcome(
  result: string | null | undefined,
): ReportCommunicationOutcome {
  if (result === 'sent') return 'completed';
  if (result === 'cancelled') return 'canceled';
  return 'unknown';
}

/** The single gate for flipping the communicated flag. */
export function shouldMarkCommunicationComplete(
  outcome: ReportCommunicationOutcome,
): boolean {
  return outcome === 'completed';
}

/**
 * A composer can finish after the user has selected or regenerated a different
 * report. Its outcome belongs only to the exact approved report that launched
 * it and must not mutate the new report's state.
 */
export function shouldApplyCommunicationOutcome({
  outcome,
  startedReportIdentity,
  currentReportIdentity,
  approvalAllowed,
  reportApproved,
}: {
  outcome: ReportCommunicationOutcome;
  startedReportIdentity: string;
  currentReportIdentity: string;
  approvalAllowed: boolean;
  reportApproved: boolean;
}): boolean {
  return shouldMarkCommunicationComplete(outcome) &&
    approvalAllowed &&
    reportApproved &&
    startedReportIdentity === currentReportIdentity;
}

/**
 * R5 item 6a (a send extra deferred on 29 Sep 2026). The email subject and
 * the Word file's name were the report's title alone ("Tower Project Status
 * Report"): two reports of one project made on different days could not be
 * told apart in a mailbox or a folder, and a second Word copy saved under
 * the first one's name. Both now carry the day the report was prepared,
 * which is the day its Word copy prints ("Prepared October 6, 2026"): the
 * device's calendar day of the report's own time, or today when it has none.
 */
function reportPreparedDay(generatedAt: string | Date | null | undefined, now: Date): Date {
  const date = generatedAt instanceof Date ? generatedAt : generatedAt ? new Date(generatedAt) : now;
  return Number.isNaN(date.getTime()) ? now : date;
}

/** "Tower Project Status Report — Oct 6, 2026". A title that already says that day is left as it is. */
export function reportSubjectWithDate(
  title: string | null | undefined,
  generatedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const day = reportPreparedDay(generatedAt, now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject = (title ?? '').trim();
  if (!subject) return day;
  return subject.includes(day) ? subject : `${subject} — ${day}`;
}

/** "Tower Project Status Report 2026-10-06", for a file name: the day as numbers, so the files sort by day in a folder. */
export function reportFileTitleWithDate(
  title: string | null | undefined,
  generatedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = reportPreparedDay(generatedAt, now);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const name = (title ?? '').trim();
  if (!name) return day;
  return name.includes(day) ? name : `${name} ${day}`;
}
