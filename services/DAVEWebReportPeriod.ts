import {
  describeReportSendTime,
  otherDeviceSendNotReceived,
  reportBaselineSnapshot,
  reportPeriodSend,
  reportPeriodSentAt,
  validReportPeriodSnapshot,
  type DAVEReportFormat,
  type DAVEReportSnapshot,
} from './DAVEReportSnapshot';

/** When this tab first saw each of the other device's sends (the phone keeps the same in ScheduleCloudPull). */
const firstSeen = new Map<string, string>();
function sendFirstSeenAt(sendKey: string, now: () => string = () => new Date().toISOString()): string {
  const seen = firstSeen.get(sendKey) ?? now();
  firstSeen.set(sendKey, seen);
  return seen;
}

/** Test seam: a new tab has seen no sends. */
export function forgetDAVEWebReportPeriodSession(): void {
  firstSeen.clear();
}

/**
 * Everyday item 3 (2 Oct 2026): the web Reports page counts "since the last
 * report" as the phone does. It reads the owner's shared period for these
 * projects and this format (the report_snapshots row the phone and the iPad
 * keep, owner answer Q16) and compares the current facts with the report that
 * period runs from, with the phone's rules: an approval not yet sent never
 * starts a period, and while this tab has not downloaded every task since the
 * other device's send, nothing is counted ("Not counted yet") rather than the
 * other device's changes being read backwards (A6 pass 10 M1, M2).
 *
 * The web reads the period and never writes it: a report approved or shared
 * from this computer does not move the phone's or the iPad's period.
 */

export type DAVEWebReportPeriodRead =
  | Readonly<{ status: 'loading' }>
  /** Read: the shared period, or null when no report has been recorded as sent or approved yet. */
  | Readonly<{ status: 'checked'; snapshot: DAVEReportSnapshot | null }>
  /** No shared period to read: the report_snapshots table is not set up. */
  | Readonly<{ status: 'unavailable' }>
  /** It could not be read (offline, signed out, a server error, or no answer in four seconds). */
  | Readonly<{ status: 'unchecked' }>;

/** How long the page waits for the shared period, as the phone's Reports does. */
export const DAVE_WEB_REPORT_PERIOD_READ_TIMEOUT_MS = 4_000;

/** Reads the shared period for these projects and format. */
export async function readDAVEWebReportPeriod(
  load: (scopeKey: string, format: string) => Promise<Readonly<{ snapshot: unknown }> | 'unavailable'>,
  scopeKey: string,
  format: DAVEReportFormat,
  timeoutMs: number = DAVE_WEB_REPORT_PERIOD_READ_TIMEOUT_MS,
): Promise<DAVEWebReportPeriodRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      load(scopeKey, format),
      new Promise<'timed_out'>(resolve => {
        timer = setTimeout(() => resolve('timed_out'), timeoutMs);
      }),
    ]);
    if (result === 'timed_out') return { status: 'unchecked' };
    if (result === 'unavailable') return { status: 'unavailable' };
    return { status: 'checked', snapshot: validReportPeriodSnapshot(result.snapshot, scopeKey, format) };
  } catch {
    return { status: 'unchecked' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type DAVEWebReportPeriodState = Readonly<{
  /** The report the "since" section is compared with, for the briefing; null for none. */
  previousSnapshot: DAVEReportSnapshot | null;
  /** The other device's send this tab may not have the changes behind; null when it has them. */
  behindSend: DAVEReportSnapshot | null;
  /**
   * Which period a prepared report belongs to: 'sent:<time>' once a report was
   * sent; 'none' with no report sent, or the period not read; 'loading'. An
   * approval stands only on the period it was prepared on.
   */
  periodKey: string;
}>;

/**
 * The period on this tab: what the report counts from, and whether it waits
 * for a download first. This tab never sends, so every send is the other
 * device's; `pulledAt` is when its last download of every task started.
 */
export function daveWebReportPeriodState({
  read,
  fingerprint,
  pulledAt,
}: {
  read: DAVEWebReportPeriodRead;
  fingerprint: string;
  pulledAt: string | null;
}): DAVEWebReportPeriodState {
  if (read.status === 'loading') return { previousSnapshot: null, behindSend: null, periodKey: 'loading' };
  if (read.status !== 'checked' || !read.snapshot) return { previousSnapshot: null, behindSend: null, periodKey: 'none' };
  const period = read.snapshot;
  const send = reportPeriodSend(period);
  const sendKey = typeof send?.deliveredAt === 'string' ? `${send.sentBy ?? ''}|${send.deliveredAt}` : null;
  const behindSend = otherDeviceSendNotReceived({
    period,
    currentFingerprint: fingerprint,
    ownSends: new Set(),
    pulledAt,
    seenAt: sendKey ? sendFirstSeenAt(sendKey) : null,
  });
  const sentAt = reportPeriodSentAt(period);
  return {
    previousSnapshot: reportBaselineSnapshot(period, fingerprint),
    behindSend,
    periodKey: sentAt ? `sent:${sentAt}` : 'none',
  };
}

/** Whether a report prepared on `preparedKey` no longer counts from the period now shown. */
export function daveWebReportPeriodMoved(preparedKey: string | null | undefined, currentKey: string): boolean {
  return Boolean(preparedKey?.startsWith('sent:')) && preparedKey !== currentKey && currentKey !== 'loading';
}

/** What the page says about the period when it has no lines to show. */
export function daveWebReportPeriodNote(read: DAVEWebReportPeriodRead): string {
  if (read.status === 'loading') return 'Checking your last report…';
  if (read.status === 'unavailable') {
    return "Your phone and iPad's last report isn't shared with this computer yet, so this report has no \"since the last report\" section.";
  }
  if (read.status === 'unchecked') {
    return "Couldn't check your last report, so this report has no \"since the last report\" section. It is checked again on the next refresh.";
  }
  return read.snapshot && reportPeriodSentAt(read.snapshot)
    ? ''
    : 'No report for these projects has been recorded as sent from your phone or iPad yet.';
}

/** Why Approve waits while this tab is behind the other device's send (as the phone says it). */
export function daveWebReportBehindMessage(send: DAVEReportSnapshot): string {
  return "This computer hasn't received your other device's latest changes yet: it sent the last report " +
    `${describeReportSendTime(send.deliveredAt as string)}. Vitruvius is downloading them now; approve once they arrive.`;
}

/** Why an approved report is no longer shared: a later report was sent after it was approved. */
export function daveWebReportPeriodMovedMessage(currentKey: string): string {
  const sentAt = currentKey.startsWith('sent:') ? currentKey.slice('sent:'.length) : '';
  return `Your phone or iPad sent a report ${sentAt ? describeReportSendTime(sentAt) : 'since'}, after this one was approved, so its "since the last report" section is out of date. Regenerate it from current facts, then approve.`;
}
