import type { ReferenceDocument } from '../types';
import { loadDAVEWebCloudReferenceDocuments } from './DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from './DAVEWebSupabaseClient';
import {
  scheduleActivationEffects,
  scheduleRetirementMessage,
  type ScheduleRetirementEffect,
  type ScheduleRetirementScope,
} from './SharedDocumentActivation';

/**
 * Open item, web batch WS2 item 3 (WS1 item 3; 6 Oct 2026): the web made a
 * schedule current without a word about what that does to ANOTHER project.
 * On a cloud that retires whole schedules, making Alpha's new schedule
 * current retires a combined Alpha + Beta schedule for Beta too: Beta goes
 * back to an older schedule, or shows no schedule tasks at all. The phone
 * asks first ("Change the current schedule?"); the web did not.
 *
 * What the web now asks is worked out as the phone works it out, by the
 * phone's own functions (scheduleActivationEffects,
 * scheduleRetirementMessage): from the cloud's own current flags, read at
 * that moment, and from what THIS cloud does when a schedule is made
 * current, which the cloud is asked first. When either cannot be read the
 * schedule is not made current and he is told, as on the phone: a warning
 * that might be false is worse than none.
 */
export type DAVEWebScheduleRetirementCheck =
  | Readonly<{ ok: true; effects: readonly ScheduleRetirementEffect[]; message: string }>
  | Readonly<{ ok: false; message: string }>;

export const DAVE_WEB_SCHEDULES_UNREADABLE_TEXT = 'The shared schedules could not be read. Try again shortly.';
export const DAVE_WEB_SCHEDULE_CHANGED_TEXT =
  'This schedule is no longer in the shared record as this page shows it. Refresh the workspace, then try again.';

export async function daveWebScheduleRetirementCheck(
  target: Pick<ReferenceDocument, 'id'>,
  read: Readonly<{
    documents: () => Promise<readonly ReferenceDocument[]>;
    scope: () => Promise<ScheduleRetirementScope | null>;
  }> = {
    documents: loadDAVEWebCloudReferenceDocuments,
    scope: () => daveWebSupabaseGateway.loadAuthorizedScheduleRetirementScope(),
  },
): Promise<DAVEWebScheduleRetirementCheck> {
  let cloud: readonly ReferenceDocument[];
  let scope: ScheduleRetirementScope | null;
  try {
    [cloud, scope] = await Promise.all([read.documents(), read.scope()]);
  } catch {
    return { ok: false, message: DAVE_WEB_SCHEDULES_UNREADABLE_TEXT };
  }
  if (!scope) return { ok: false, message: DAVE_WEB_SCHEDULES_UNREADABLE_TEXT };
  const cloudTarget = cloud.find(document => document.id === target.id);
  if (!cloudTarget) return { ok: false, message: DAVE_WEB_SCHEDULE_CHANGED_TEXT };
  const effects = scheduleActivationEffects(cloudTarget, cloud, scope);
  return { ok: true, effects, message: effects.length > 0 ? scheduleRetirementMessage(effects) : '' };
}
