import type { ProjectUpdate } from '../types';

/** Only the acknowledged update's original save/send tap is a shared send time.
 * Completion also stamps failures and background retries, so it cannot order authored updates.
 * Old updates and unsent work retain their displayed day and deterministic id order.
 */
export type FieldUpdateChronology = Readonly<{
  date?: string | null;
  status?: ProjectUpdate['status'];
  workflowTimestamps?: Pick<NonNullable<ProjectUpdate['workflowTimestamps']>, 'sendTappedAt'>;
}>;

export type FieldUpdateChronologyContext = Readonly<{
  /** Only for records obtained from an acknowledged cloud-row snapshot. Never for local waiting work. */
  cloudReceipts?: boolean;
}>;

/** Check the written calendar date before Date.parse can normalize February30 into March. */
function validSendTap(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  // Preserve the existing clock/offset rules, including accepted 24:00 end-of-day notation.
  return Number.isFinite(Date.parse(value));
}

export function fieldUpdateChronologyDate(update: FieldUpdateChronology, context: FieldUpdateChronologyContext = {}): string | null {
  const tappedAt = update.workflowTimestamps?.sendTappedAt;
  if ((update.status === 'sent' || context.cloudReceipts === true) && typeof tappedAt === 'string' && validSendTap(tappedAt)) return tappedAt;
  return update.date || null;
}
