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
import type { DAVEReportSharedCheck } from './DAVEReportSnapshotStore';
import { loadDAVEWebReportPeriod, type DAVEWebReportStore } from './DAVEWebReportSend';

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
 * report" as the phone does: from the owner's period for these projects and
 * this format, with the phone's rules: an approval not yet sent never starts
 * a period, and while this tab has not downloaded every task since the other
 * device's send, nothing is counted ("Not counted yet") rather than the other
 * device's changes being read backwards (A6 pass 10 M1, M2).
 *
 * Owner answer 2 Oct (web sends count): this computer now approves and sends
 * into that period like the phone (DAVEWebReportSend), so the period is this
 * browser profile's own copy merged with the shared one (the later send
 * wins), and this computer's own sends never make it wait.
 */

export type DAVEWebReportPeriodRead =
  | Readonly<{ status: 'loading' }>
  /**
   * Read: the period (null when no report was approved or sent yet), whether
   * the shared copy was checked ('unavailable' before the report_snapshots
   * table exists; 'unchecked' when it could not be read: offline, a server
   * error, or no answer in four seconds), and whether the period's approval
   * not yet sent was saved here.
   */
  | Readonly<{
    status: 'loaded';
    snapshot: DAVEReportSnapshot | null;
    shared: DAVEReportSharedCheck;
    approvalSavedHere: boolean;
  }>;

/** Reads the period for these projects and format; a read that fails is this computer's own nothing. */
export async function readDAVEWebReportPeriod(
  store: DAVEWebReportStore,
  scopeKey: string,
  format: DAVEReportFormat,
): Promise<DAVEWebReportPeriodRead> {
  try {
    const loaded = await loadDAVEWebReportPeriod(store, scopeKey, format);
    return { status: 'loaded', snapshot: validReportPeriodSnapshot(loaded.snapshot, scopeKey, format), shared: loaded.shared, approvalSavedHere: loaded.approvalSavedHere };
  } catch {
    return { status: 'loaded', snapshot: null, shared: 'unchecked', approvalSavedHere: false };
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
 * for a download first. A send of this computer's own (`ownSends`) never
 * waits; `pulledAt` is when this tab's last download of every task started.
 */
export function daveWebReportPeriodState({
  read,
  fingerprint,
  pulledAt,
  ownSends = new Set(),
}: {
  read: DAVEWebReportPeriodRead;
  fingerprint: string;
  pulledAt: string | null;
  ownSends?: ReadonlySet<string>;
}): DAVEWebReportPeriodState {
  if (read.status === 'loading') return { previousSnapshot: null, behindSend: null, periodKey: 'loading' };
  if (!read.snapshot) return { previousSnapshot: null, behindSend: null, periodKey: 'none' };
  const period = read.snapshot;
  const send = reportPeriodSend(period);
  const sendKey = typeof send?.deliveredAt === 'string' ? `${send.sentBy ?? ''}|${send.deliveredAt}` : null;
  const behindSend = otherDeviceSendNotReceived({
    period,
    currentFingerprint: fingerprint,
    ownSends,
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

/**
 * What the page says about the period: why it has no "since" lines, or where
 * they count from when the shared copy was not read.
 */
export function daveWebReportPeriodNote(read: DAVEWebReportPeriodRead): string {
  if (read.status === 'loading') return 'Checking your last report…';
  const sentAt = reportPeriodSentAt(read.snapshot);
  if (read.shared === 'unavailable') {
    // Before the shared table (owner answer Q16): each device, this computer too, keeps its own period.
    return sentAt
      ? `Reports aren't shared between your devices yet, so this counts from the last report sent from this computer, ${describeReportSendTime(sentAt)}.`
      : "Reports aren't shared between your devices yet, and none was sent from this computer, so this report has no \"since the last report\" section.";
  }
  if (read.shared === 'unchecked') {
    return sentAt
      ? `Couldn't check your other devices' last report, so this counts from the last one this computer knows about, sent ${describeReportSendTime(sentAt)}.`
      : "Couldn't check your last report, so this report has no \"since the last report\" section. It is checked again on the next refresh.";
  }
  return sentAt ? '' : 'No report for these projects has been recorded as sent yet.';
}

/** Why Approve waits while this tab is behind the other device's send (as the phone says it). */
export function daveWebReportBehindMessage(send: DAVEReportSnapshot): string {
  return "This computer hasn't received your other device's latest changes yet: it sent the last report " +
    `${describeReportSendTime(send.deliveredAt as string)}. Vitruvius is downloading them now; approve once they arrive.`;
}

/**
 * Another device sent a later report than the one this approval counted
 * from (A6 pass 7 on the phone): an approval stops, and a send is not
 * recorded (owner answer 2 Oct, web sends count).
 */
export function daveWebReportLaterSendMessage(later: DAVEReportSnapshot, moment: 'approve' | 'record'): string {
  const when = describeReportSendTime(reportPeriodSentAt(later) ?? '');
  return moment === 'approve'
    ? `Your other device sent a report ${when}, so this report now covers what changed since then. Regenerate it from current facts, then approve.`
    : `Your other device sent a report ${when}, after this one was approved, so this one was not recorded as sent. The next report counts from your other device's report.`;
}

/** This computer's send, recorded (owner answer 2 Oct): where the next report counts from. */
export function daveWebReportRecordedMessage(sentAt: string, shared: 'checked' | 'unavailable' | 'unchecked'): string {
  const when = describeReportSendTime(sentAt);
  if (shared === 'unavailable') {
    return `Recorded as sent ${when}. Reports aren't shared between your devices yet, so the next report counts from it on this computer only.`;
  }
  if (shared === 'unchecked') {
    // Kept here; the next open that reaches the shared record carries it up (the phone does the same).
    return `Recorded as sent ${when} on this computer. Your other devices count from it once this computer reaches the shared record again.`;
  }
  return `Recorded as sent ${when}. The next report on every device runs from this one.`;
}

/** Shared again after this computer had recorded it as sent (review N1): said plainly, never as an error. */
export function daveWebReportAlreadyRecordedMessage(sentAt: string): string {
  return `Shared again. This report was already recorded as sent ${describeReportSendTime(sentAt)}, so this is not counted as another send.`;
}

/** Why an approved report is no longer shared: a later report was sent after it was approved. */
export function daveWebReportPeriodMovedMessage(currentKey: string): string {
  const sentAt = currentKey.startsWith('sent:') ? currentKey.slice('sent:'.length) : '';
  return `Your other device sent a report ${sentAt ? describeReportSendTime(sentAt) : 'since'}, after this one was approved, so its "since the last report" section is out of date. Regenerate it from current facts, then approve.`;
}
