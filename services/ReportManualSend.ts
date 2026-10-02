import {
  reportPeriodSentAt,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

/**
 * Everyday item 1 (2 Oct 2026): recording, in Reports, that the approved
 * report went out another way. The app records a send only when the share it
 * opened says it finished, so a Mail draft sent later ("Saved"), an Outlook
 * send after "Not yet", or the Word file sent from a laptop left the period
 * where it was, and the next report repeated what the client already had.
 *
 * Only the approval this device saved for the period, not yet sent, can be
 * marked, and only by the owner: nothing here runs on its own. It is the
 * approved report's facts that are recorded as sent, at a time between when
 * those facts were current and now, and after the report its period runs
 * from was sent (so a period never runs backwards).
 */

/** The approval this period is waiting to have sent, or null (none, or already sent). */
export function reportApprovalAwaitingSend(
  period: DAVEReportSnapshot | null | undefined,
): DAVEReportSnapshot | null {
  return period && period.deliveredAt === null ? period : null;
}

export type ManualReportSendWindow = Readonly<{
  /** The earliest time the approved report can be recorded as sent. */
  earliest: string;
  /** Now: a send cannot be recorded in the future. */
  latest: string;
}>;

/**
 * When the approved report can have been sent: not before its facts were
 * current (`capturedAt`: what it says was true from then on), not at or
 * before the report its period runs from was sent, and not after now. Null
 * when there is no such time (a clock moved back).
 */
export function manualReportSendWindow(
  approval: DAVEReportSnapshot,
  now: Date = new Date(),
): ManualReportSendWindow | null {
  const captured = Date.parse(approval.capturedAt);
  const lastSent = Date.parse(reportPeriodSentAt(approval.supersedes) ?? '');
  const latest = now.getTime();
  const floor = Math.max(
    Number.isNaN(captured) ? -Infinity : captured,
    Number.isNaN(lastSent) ? -Infinity : lastSent + 1,
  );
  const earliest = Number.isFinite(floor) ? floor : latest;
  if (earliest > latest) return null;
  return Object.freeze({ earliest: new Date(earliest).toISOString(), latest: new Date(latest).toISOString() });
}

export type ManualReportSendTime =
  | Readonly<{ ok: true; sentAt: string }>
  | Readonly<{ ok: false; message: string }>;

/**
 * The send time to record for the owner's choice, checked against the
 * window at the moment he confirms: now, or the minute he picked. A minute
 * that holds the window's start or end is taken as that time (the picker has
 * no seconds); any other minute outside it is refused, with what he can pick.
 */
export function manualReportSendTime(
  choice: 'now' | Date,
  approval: DAVEReportSnapshot,
  now: Date = new Date(),
): ManualReportSendTime {
  const window = manualReportSendWindow(approval, now);
  if (!window) {
    return { ok: false, message: "This report can't be recorded as sent yet: the time on this device is before it was approved." };
  }
  const earliest = Date.parse(window.earliest);
  const latest = Date.parse(window.latest);
  if (choice === 'now') return { ok: true, sentAt: window.latest };
  const picked = choice.getTime();
  if (Number.isNaN(picked)) return { ok: false, message: 'Choose when the report was sent.' };
  const minuteStart = Math.floor(picked / 60_000) * 60_000;
  if (minuteStart + 59_999 < earliest) {
    return {
      ok: false,
      message: `Choose ${describeSendWindowTime(window.earliest, now)} or later: this report has the project facts as they were then.`,
    };
  }
  if (minuteStart > latest) return { ok: false, message: 'Choose a time that has already passed.' };
  return { ok: true, sentAt: new Date(Math.min(Math.max(minuteStart, earliest), latest)).toISOString() };
}

/** "today at 2:30 PM"; "Oct 1 at 2:30 PM" another day (with the year when it is not this year). */
export function describeSendWindowTime(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'then';
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.toDateString() === now.toDateString()) return `today at ${time}`;
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  }).format(date);
  return `${day} at ${time}`;
}

/**
 * The time recorded with a send the owner marked: when he marked it, when
 * that is later than the send he named (a "just now" mark is a send at that
 * time, and carries none).
 */
export function manualReportMarkTime(sentAt: string, now: Date = new Date()): string | null {
  return now.getTime() > Date.parse(sentAt) ? now.toISOString() : null;
}
