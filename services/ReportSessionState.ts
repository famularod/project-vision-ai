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
 */
export type ReportSessionEdits = Readonly<{ title: string; body: string; sourceFingerprint: string }>;

export type ReportSessionAcknowledgement = Readonly<{ fingerprint: string; ids: readonly string[] }>;

export type ReportSessionState = Readonly<{
  edits: ReportSessionEdits | null;
  /** The approval text key of the report that was approved, or null. */
  approvedTextKey: string | null;
  /** The project facts that approval was given on, or null. */
  approvedFingerprint?: string | null;
  /** Review items acknowledged for one exact set of report facts. */
  acknowledgement: ReportSessionAcknowledgement | null;
}>;

const EMPTY: ReportSessionState = { edits: null, approvedTextKey: null, acknowledgement: null };
const REMEMBERED_SCOPES = 12;
const store = new Map<string, ReportSessionState>();

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
): void {
  write(scopeKey, {
    ...(recallReportSessionState(scopeKey) ?? EMPTY),
    approvedTextKey,
    approvedFingerprint: approvedTextKey ? approvedFingerprint : null,
  });
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

/** On sign-out: another account must not inherit this one's narrative or approval. */
export function forgetAllReportSessionState(): void {
  store.clear();
}
