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
import { daveWebReportOnlyApprovalKeptInTab, loadDAVEWebReportPeriod, type DAVEWebReportStore } from './DAVEWebReportSend';

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
 * Under "Since the last report", when there is no period to name: whose last
 * report it counts from. Review N1 (3 Oct 2026): it said "from your phone or
 * iPad" always. Since the web's own sends count (owner answer 2 Oct) that is
 * any of his devices when reports are shared between them, and this computer
 * alone before the shared record exists.
 */
export function daveWebReportCountedFromLine(read: DAVEWebReportPeriodRead): string {
  if (read.status === 'loading') return 'Counted from the last report sent.';
  return read.shared === 'unavailable'
    ? 'Counted from the last report sent from this computer.'
    : 'Counted from the last report sent from any of your devices.';
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
    // Review N4 L2 (6 Oct 2026): worded from what this computer has on record, which is all it can know. A report
    // sent from here that the browser could not keep (storage full, the tab since closed) was sent all the same:
    // "none was sent from this computer" and "the last report sent from this computer" were then not true.
    return sentAt
      ? `Reports aren't shared between your devices yet, so this counts from the last report this computer knows it sent, ${describeReportSendTime(sentAt)}.`
      : "Reports aren't shared between your devices yet, and this computer has no record of one sent from here, so this report has no \"since the last report\" section.";
  }
  if (read.shared === 'unchecked') {
    return sentAt
      ? `Couldn't check your other devices' last report, so this counts from the last one this computer knows about, sent ${describeReportSendTime(sentAt)}.`
      : "Couldn't check your last report, so this report has no \"since the last report\" section. It is checked again on the next refresh.";
  }
  return sentAt ? '' : 'No report for these projects has been recorded as sent yet.';
}

/**
 * This browser's storage would not take the period (full, or it keeps no
 * site data), so this tab holds it in its own memory (review N1 L1, 3 Oct
 * 2026). Said plainly, with what it means, in place of "Try Approve again",
 * which never helped.
 */
export function daveWebReportKeptInTabOnlyNote(
  shared: DAVEReportSharedCheck | 'loading',
  /**
   * The browser still holds an EARLIER report's period, which it would neither replace nor remove (review N4 L2,
   * 6 Oct 2026). The note promised "no 'since the last report' section" after the tab closes; with an earlier
   * period left behind the next report counts from that one instead.
   */
  olderPeriodLeft = false,
  /**
   * All the tab holds beyond the browser is an approval not yet sent; the last report SENT is in the browser
   * (review N5 C, 6 Oct 2026). The note said the next report "has no 'since the last report' section until one is
   * sent from here again", which is so after a send the browser could not keep, and not here: only the approval
   * goes with the tab, and the next tab counts from the last report sent.
   */
  onlyApproval = daveWebReportOnlyApprovalKeptInTab(),
): string {
  const kept = onlyApproval
    ? "This browser's storage for Vitruvius is full or switched off, so this computer remembers this approval only while this tab stays open."
    : "This browser's storage for Vitruvius is full or switched off, so this computer remembers its last report only while this tab stays open.";
  if (onlyApproval && (shared === 'unavailable' || shared === 'loading')) {
    return `${kept} After that, the approval is gone: the report has to be approved again, and it still counts from the last report this computer knows it sent. Clearing other sites' data in this browser makes room.`;
  }
  if (shared === 'unavailable' || shared === 'loading') {
    return olderPeriodLeft
      ? `${kept} After that, the next report from this computer may count from an earlier report and repeat what the last one covered: this browser would not clear the earlier one.`
      : `${kept} After that, the next report from this computer has no "since the last report" section until one is sent from here again. Clearing other sites' data in this browser makes room.`;
  }
  // Review N4 L2: with the shared record out of reach, a report sent now has not reached his other devices yet,
  // and this tab is the only place that has it.
  return shared === 'unchecked'
    ? `${kept} The shared record can't be reached right now, so a report sent now reaches your other devices only once it can be reached again: keep this tab open until then.`
    : `${kept} Reports recorded as sent still reach your other devices, and this computer reads them back from there.`;
}

/** Approve could not save the period on this computer at all (review N1 L1): what that means, and that repeating it does not help. */
export const DAVE_WEB_REPORT_PERIOD_NOT_SAVED =
  "The report is approved, but this browser could not save its reporting period, so this computer cannot record that it was sent: the next report would count from the report before this one. Approving again will not change that. Sign out of this computer and in again, or use another browser, before you send it.";

/** Why Approve waits while this tab is behind the other device's send (as the phone says it). */
export function daveWebReportBehindMessage(send: DAVEReportSnapshot): string {
  return "This computer hasn't received your other device's latest changes yet: it sent the last report " +
    `${describeReportSendTime(send.deliveredAt as string)}. Vitruvius is downloading them now; approve once they arrive.`;
}

/**
 * Review N2 (5 Oct 2026): a draft written while this tab waited for the other
 * device's changes says "Not counted yet" under "Since the Last Report".
 * Untouched, it is written again when the changes arrive. Edited or saved, it
 * is his, and stays as it is (the phone keeps edits made while it waited the
 * same way, and does not let them be approved): the page says this in place
 * of "The draft matches the latest project facts", and when he presses
 * Approve, Share or Prepare Email.
 */
export const DAVE_WEB_REPORT_SAYS_NOT_COUNTED =
  'This report\'s "Since the Last Report" section says "Not counted yet", so it does not list what changed since the last report. Regenerate it from current facts before you approve or share it.';

/** The same draft after he took that line out by hand: it still lists nothing that changed (review N2). */
export const DAVE_WEB_REPORT_PREPARED_WHILE_WAITING =
  "This draft was prepared before this computer had your other device's latest changes, so it does not list what changed since the last report. Regenerate it from current facts before approval.";

/**
 * Review N2 follow-up (5 Oct 2026): Download Word Report pressed while this
 * tab still waits for the other device's changes and the draft says "Not
 * counted yet". The Word file would carry that sentence to the client, so it
 * is held back, as Approve is, until the changes have arrived.
 */
export function daveWebReportWordWaitsMessage(send: DAVEReportSnapshot): string {
  return "This computer hasn't received your other device's latest changes yet: it sent the last report " +
    `${describeReportSendTime(send.deliveredAt as string)}. Vitruvius is downloading them now; download the Word report once they arrive.`;
}

/**
 * Another device sent a later report than the one this approval counted
 * from (A6 pass 7 on the phone): an approval stops, and a send is not
 * recorded (owner answer 2 Oct, web sends count).
 */
export function daveWebReportLaterSendMessage(
  later: DAVEReportSnapshot,
  moment: 'approve' | 'record',
  /** Sent from this browser by another tab or window: never called "your other device" (review N1, 3 Oct 2026). */
  fromThisBrowser = false,
): string {
  const when = describeReportSendTime(reportPeriodSentAt(later) ?? '');
  const who = fromThisBrowser ? 'Another tab of this browser' : 'Your other device';
  return moment === 'approve'
    ? `${who} sent a report ${when}, so this report now covers what changed since then. Regenerate it from current facts, then approve.`
    : `${who} sent a report ${when}, after this one was approved, so this one was not recorded as sent. The next report counts from ${fromThisBrowser ? 'that report' : "your other device's report"}.`;
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

/**
 * Review N2 (5 Oct 2026): what Sign Out says before it goes ahead when a
 * report sent from this computer could not be confirmed in the shared record
 * (it was sent while the record could not be reached, and one more try at
 * sign-out did not reach it either). Signing out removes this account's
 * report periods from this browser, so it says what that means for his other
 * devices, and how to keep the send. `sentAts`: newest first, never empty.
 */
export function daveWebReportSendsNotSharedWarning(sentAts: readonly string[]): Readonly<{ title: string; lines: readonly string[] }> {
  const when = describeReportSendTime(sentAts[0] ?? '');
  const one = sentAts.length <= 1;
  const it = one ? 'it' : 'them';
  return Object.freeze({
    title: one
      ? 'A report sent from this computer may not have reached your other devices'
      : 'Reports sent from this computer may not have reached your other devices',
    lines: Object.freeze([
      one
        ? `Vitruvius tried again just now and could not confirm that the report sent from this computer ${when} is in the record your devices share.`
        : `Vitruvius tried again just now and could not confirm that ${sentAts.length} reports sent from this computer (the latest ${when}) are in the record your devices share.`,
      `Signing out removes this computer's own record of ${it}. If the shared record does not have ${it}, your other devices will not count from ${it}: ` +
        `the next report on every device will count from the report before ${it}, and may repeat what ${one ? 'it' : 'they'} covered.`,
      'Cancel and sign out a little later so Vitruvius can try again, or sign out now.',
    ]),
  });
}

/**
 * A report that went out from this browser with no approval of it waiting
 * here or in the shared period, where this computer cannot take the approval
 * as its own either (review N1 L2, 3 Oct 2026): its facts have changed since
 * it was prepared, or another approved report is waiting here to be marked
 * sent and would be lost (review N1 L5). Said plainly: what was not
 * recorded, and what follows.
 */
export const DAVE_WEB_REPORT_SEND_NOT_RECORDED =
  'This computer could not record that this report was sent: no approval of it is waiting here, and it cannot take one now (the project facts have changed since it was prepared, or another approved report is waiting to be marked sent). The next report will count from the last report recorded as sent, and may repeat what this one covered.';

/**
 * "Not yet", to "Was the report sent?" (owner answer 2 Oct). Review N2
 * follow-up (5 Oct 2026): it always ended "Once you send it, use Mark as
 * Sent.", also when Mark as Sent was no longer offered for that report:
 * another device's later report had overtaken it (`overtaken`: what the page
 * says of that, with the way out), or this computer holds no approval of it
 * to mark. It says only what is true.
 */
export function daveWebReportNotYetMessage(markAsSentOffered: boolean, overtaken: string | null = null): string {
  if (overtaken) return `Nothing was recorded. ${overtaken}`;
  return markAsSentOffered ? 'Nothing was recorded. Once you send it, use Mark as Sent.' : 'Nothing was recorded.';
}

/** Shared again after this computer had recorded it as sent (review N1): said plainly, never as an error. */
export function daveWebReportAlreadyRecordedMessage(sentAt: string): string {
  return `Shared again. This report was already recorded as sent ${describeReportSendTime(sentAt)}, so this is not counted as another send.`;
}

/**
 * Mark as Sent on a report this browser has already recorded as sent (another
 * tab did, since this tab last read the period): nothing more is recorded.
 * Review N2 (5 Oct 2026): it said "Shared again. ...", and he had shared
 * nothing; that line was only ever seen with the workspace open, and Mark as
 * Sent now says what happened in its own card.
 */
export function daveWebReportAlreadyMarkedSentMessage(sentAt: string): string {
  return `This report was already recorded as sent ${describeReportSendTime(sentAt)}, so nothing more was recorded.`;
}

/** The same, after the share menu or an email draft: nothing is asked, since nothing more is recorded (review N1 M2). */
export function daveWebReportAlreadySentNote(sentAt: string): string {
  return `This report was already recorded as sent ${describeReportSendTime(sentAt)}, so sending it again is not counted as another send.`;
}

/** What the review panel says of an approved report this computer sent (review N1 M2). */
export function daveWebReportSentFromHereNote(sentAt: string): string {
  return `This report was sent from this computer ${describeReportSendTime(sentAt)}. Sharing it again is not counted as another send.`;
}

/** How long a period check made ahead of a share stands (review N1): the click that follows goes straight through. */
export const DESKTOP_REPORT_SEND_CHECK_STANDS_MS = 60_000;

/**
 * The check before a share passed, but the browser no longer takes the press
 * as a click (the check used it up): nothing went out, and the next press
 * goes straight through (review N1, the later-send check comes first).
 */
export function daveWebReportCheckedPressAgain(button: string): string {
  return `Checked: no other device has sent a report since this one was approved. Press ${button} again.`;
}

/** Why an approved report is no longer shared: a later report was sent after it was approved. */
export function daveWebReportPeriodMovedMessage(
  currentKey: string,
  /** Sent from this browser by another tab or window: never called "your other device" (review N1 and N2). */
  fromThisBrowser = false,
): string {
  const sentAt = currentKey.startsWith('sent:') ? currentKey.slice('sent:'.length) : '';
  const who = fromThisBrowser ? 'Another tab of this browser' : 'Your other device';
  return `${who} sent a report ${sentAt ? describeReportSendTime(sentAt) : 'since'}, after this one was approved, so its "since the last report" section is out of date. Regenerate it from current facts, then approve.`;
}
