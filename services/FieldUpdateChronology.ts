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

export function fieldUpdateChronologyDate(update: FieldUpdateChronology, context: FieldUpdateChronologyContext = {}): string | null {
  const tappedAt = update.workflowTimestamps?.sendTappedAt;
  if ((update.status === 'sent' || context.cloudReceipts === true) && typeof tappedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(tappedAt) &&
    Number.isFinite(Date.parse(tappedAt))) return tappedAt;
  return update.date || null;
}
