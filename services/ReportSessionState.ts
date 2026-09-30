/**
 * What the manager typed and approved on the Reports screen, per report
 * scope, for the rest of the app session.
 *
 * Whole-app audit A6 (29 Sep 2026): edits and approval were component state
 * of a screen that unmounts on every tab change, so opening Schedule to
 * check a date and coming back discarded the edited body and the approval
 * while the screen said "Narrative edits are saved below." Approval is
 * restored only for the exact report text that was approved.
 */
export type ReportSessionEdits = Readonly<{ title: string; body: string; sourceFingerprint: string }>;

export type ReportSessionState = Readonly<{
  edits: ReportSessionEdits | null;
  /** The approval text key of the report that was approved, or null. */
  approvedTextKey: string | null;
}>;

const REMEMBERED_SCOPES = 12;
const store = new Map<string, ReportSessionState>();

export function rememberReportSessionState(scopeKey: string, state: ReportSessionState): void {
  store.delete(scopeKey);
  if (!state.edits && !state.approvedTextKey) return;
  store.set(scopeKey, state);
  while (store.size > REMEMBERED_SCOPES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function recallReportSessionState(scopeKey: string): ReportSessionState | null {
  return store.get(scopeKey) ?? null;
}

/** Approval stands only for the exact text that was approved. */
export function restoredReportApproval(state: ReportSessionState | null, approvalTextKey: string): boolean {
  return Boolean(state?.approvedTextKey) && state?.approvedTextKey === approvalTextKey;
}

export function forgetAllReportSessionState(): void {
  store.clear();
}
