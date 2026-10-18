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

/** Communication metadata uses the device's local calendar day when the
 * composer/download is prepared. generatedAt remains the immutable report-body
 * timestamp. A draft sent later from an external mail client cannot be redated.
 * The legacy timestamp parameter is retained for existing callers only.
 */
function deliberateTitleDate(title: string): string | undefined {
  const valid = (year: number, month: number, day: number) => {
    if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(year, month, 0).getDate();
  };
  for (const match of title.matchAll(/\b(\d{4})([-/])(\d{1,2})\2(\d{1,2})\b/g)) {
    if (valid(+match[1], +match[3], +match[4])) return match[0];
  }
  // Require a full year and slash/hyphen separators: bare years and dotted
  // version numbers are too ambiguous to suppress the action date.
  for (const match of title.matchAll(/\b(\d{1,2})([/-])(\d{1,2})\2(\d{4})\b/g)) {
    if (valid(+match[4], +match[1], +match[3]) || valid(+match[4], +match[3], +match[1])) return match[0];
  }
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthName = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?';
  for (const pattern of [
    new RegExp('\\b' + monthName + '\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b', 'gi'),
    new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + monthName + '[,]?\\s+(\\d{4})\\b', 'gi'),
  ]) {
    for (const match of title.matchAll(pattern)) {
      const monthFirst = /^[A-Za-z]/.test(match[1]);
      const month = months.indexOf((monthFirst ? match[1] : match[2]).slice(0, 3).toLowerCase()) + 1;
      if (valid(+match[3], month, +(monthFirst ? match[2] : match[1]))) return match[0];
    }
  }
  return undefined;
}

export function reportSubjectWithDate(
  title: string | null | undefined,
  _generatedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject = (title ?? '').trim();
  if (!subject) return day;
  return deliberateTitleDate(subject) ? subject : `${subject} — ${day}`;
}

/** Report-only basename, at most 235 UTF-8 bytes (240 with .docx).
 * Iterate code points so truncation never splits a surrogate pair. Leave the
 * generic document/schedule filename policy alone.
 */
export function reportFileTitleWithDate(
  title: string | null | undefined,
  _generatedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safe = (value: string) => value.replace(/[\\/\x00-\x1f\x7f-\x9f<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  let name = safe(title ?? '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `Report ${name}`;
  const manualDate = deliberateTitleDate(title ?? '');
  const truncate = (value: string, budget: number) => {
    let result = '';
    let bytes = 0;
    for (const character of value) {
      const cp = character.codePointAt(0)!;
      const size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      if (bytes + size > budget) break;
      result += character;
      bytes += size;
    }
    return result.replace(/[. ]+$/g, '');
  };
  if (manualDate) {
    const result = truncate(name, 235);
    const safeDate = safe(manualDate);
    // Keep a deliberately supplied date even if a long title put it past the
    // byte boundary. Never add a second (action) date to that title.
    return result.includes(safeDate) ? result : `${truncate(name, 234 - safeDate.length)} ${safeDate}`.trim();
  }
  return `${truncate(name, 224)} ${day}`.trim();
}
