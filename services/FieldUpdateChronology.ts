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

export function fieldUpdateChronologyDate(update: FieldUpdateChronology): string | null {
  const tappedAt = update.workflowTimestamps?.sendTappedAt;
  if (update.status === 'sent' && tappedAt && Number.isFinite(Date.parse(tappedAt))) return tappedAt;
  return update.date || null;
}
