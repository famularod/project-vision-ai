/**
 * What the manager typed, acknowledged and approved on the Reports screen,
 * per report scope, for the rest of the app session.
 *
 * Whole-app audit A6 (29-30 Sep 2026): edits and approval were component
 * state of a screen that unmounts on every tab change, so opening Schedule
 * to check a date and coming back discarded the edited body and the
 * approval. A first version wrote the state back from an effect, which ran
 * on remount with the initial values and wiped the store before the
 * restore settled; the store is now written only when the manager acts
 * (types, acknowledges, approves, edits again, discards) and read on
 * mount. Approval is restored only for the exact report text that was
 * approved.
 *
 * Whole-app audit A6 pass 8 M1 (30 Sep 2026): an approval or edit made
 * before the other device sent was not tied to the reporting period it was
 * made on. Approved on the phone at 10:00, sent from the iPad at 12:00, the
 * approval came back after a tab switch and Copy sent the report again; an
 * edited report kept its morning "since" section. Each now remembers its
 * period: the approval when the report it counts from was sent, the edits
 * when the report their "since" section counts from was sent.
 */
export type ReportSessionEdits = Readonly<{
  title: string;
  body: string;
  sourceFingerprint: string;
  /**
   * When the report the edited "since" section counts from was sent
   * (reportPeriodSentAt of the baseline), or null for no earlier report.
   * Absent: edits made before this was kept, taken as current.
   */
  baselineSentAt?: string | null;
  /**
   * Made while "since the last report" was not counted, this device waiting
   * for the other device's changes (whole-app audit A6 pass 10 M1, M2): the
   * body says so, and the edits stand only while that is still true.
   */
  periodNotCounted?: boolean;
}>;

export type ReportSessionAcknowledgement = Readonly<{ fingerprint: string; ids: readonly string[] }>;

export type ReportSessionState = Readonly<{
  edits: ReportSessionEdits | null;
  /** The approval text key of the report that was approved, or null. */
  approvedTextKey: string | null;
  /** The project facts that approval was given on, or null. */
  approvedFingerprint?: string | null;
  /**
   * When the report that approval's period runs from was sent
   * (reportPeriodSentAt of the loaded period), or null for none. This
   * device's own send of the approval moves it to that send.
   */
  approvedPeriodSentAt?: string | null;
  /** Review items acknowledged for one exact set of report facts. */
  acknowledgement: ReportSessionAcknowledgement | null;
}>;

const EMPTY: ReportSessionState = { edits: null, approvedTextKey: null, acknowledgement: null };
/**
 * How many report scopes (a selection of projects, in one format) keep what he typed, acknowledged and approved
 * for the rest of the app session. R1 item 9 (8 Oct 2026, the owner's open items): it was 12, a guess made when
 * the store was added, with nothing behind it; a superintendent with a dozen projects passes it by opening each
 * project's report once, and the edits of the first were then gone without a word. The store lives in memory for
 * the app session only (nothing is written to the phone), and an entry is one report's text, a few thousand
 * characters, so 200 is a few megabytes at the very most and far more selections than a session makes. It stays
 * bounded so a session left open for weeks cannot grow without end; the scope used longest ago goes first.
 */
export const REMEMBERED_REPORT_SCOPES = 200;
const REMEMBERED_SCOPES = REMEMBERED_REPORT_SCOPES;
const store = new Map<string, ReportSessionState>();
/** When this device sent reports in this app session, so reading one back is never taken for the other device's. */
const ownSends = new Set<string>();

function write(scopeKey: string, next: ReportSessionState): void {
  store.delete(scopeKey);
  if (!next.edits && !next.approvedTextKey && !next.acknowledgement) return;
  store.set(scopeKey, next);
  while (store.size > REMEMBERED_SCOPES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function recallReportSessionState(scopeKey: string): ReportSessionState | null {
  return store.get(scopeKey) ?? null;
}

export function rememberReportEdits(scopeKey: string, edits: ReportSessionEdits | null): void {
  write(scopeKey, { ...(recallReportSessionState(scopeKey) ?? EMPTY), edits });
}

export function rememberReportApproval(
  scopeKey: string,
  approvedTextKey: string | null,
  approvedFingerprint: string | null = null,
  approvedPeriodSentAt: string | null = null,
): void {
  write(scopeKey, {
    ...(recallReportSessionState(scopeKey) ?? EMPTY),
    approvedTextKey,
    approvedFingerprint: approvedTextKey ? approvedFingerprint : null,
    approvedPeriodSentAt: approvedTextKey ? approvedPeriodSentAt : null,
  });
}

/**
 * This device sent the approved report: its period now runs from that send,
 * so the approval still stands on it (A6 pass 8 M1). Only the approval of
 * the period that send closed moves.
 */
export function rememberApprovedReportSent(scopeKey: string, periodSentAt: string | null, sentAt: string): void {
  const state = recallReportSessionState(scopeKey);
  if (!state?.approvedTextKey || (state.approvedPeriodSentAt ?? null) !== periodSentAt) return;
  write(scopeKey, { ...state, approvedPeriodSentAt: sentAt });
}

export function rememberOwnReportSend(sentAt: string): void {
  ownSends.add(sentAt);
}

export function ownReportSendTimes(): ReadonlySet<string> {
  return ownSends;
}

export function rememberReportAcknowledgement(
  scopeKey: string,
  acknowledgement: ReportSessionAcknowledgement | null,
): void {
  write(scopeKey, { ...(recallReportSessionState(scopeKey) ?? EMPTY), acknowledgement });
}

/** Approval stands only for the exact text that was approved. */
export function restoredReportApproval(state: ReportSessionState | null, approvalTextKey: string): boolean {
  return Boolean(state?.approvedTextKey) && state?.approvedTextKey === approvalTextKey;
}

/**
 * The facts the standing approval was given on, so a send records the
 * approved report even when facts the text does not show changed since
 * (whole-app audit A6 pass 6 (30 Sep 2026): a stage or checklist change
 * after approval left the sent report unsent, and the next report's period
 * repeated what the client already had).
 */
export function approvedReportFingerprint(state: ReportSessionState | null, approvalTextKey: string): string | null {
  return restoredReportApproval(state, approvalTextKey) ? state?.approvedFingerprint ?? null : null;
}

/**
 * When the report the standing approval's period runs from was sent, or
 * undefined when no approval of this text stands (A6 pass 8 M1).
 */
export function approvedReportPeriodSentAt(
  state: ReportSessionState | null,
  approvalTextKey: string,
): string | null | undefined {
  return restoredReportApproval(state, approvalTextKey) ? state?.approvedPeriodSentAt ?? null : undefined;
}

/** On sign-out: another account must not inherit this one's narrative or approval. */
export function forgetAllReportSessionState(): void {
  store.clear();
  ownSends.clear();
}
