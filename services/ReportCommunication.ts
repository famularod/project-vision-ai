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
