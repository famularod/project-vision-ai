import type { ScheduleItem } from '../types';
import { normalizeDAVECompletionVerification } from './DAVECompletionVerification';

/** Report-local meaning of old task rows. Never mutates a saved row or its historical report input. */
export function projectScheduleItemsForReport<T extends readonly ScheduleItem[]>(items: T): T {
  let changed = false;
  const projected = items.map(item => {
    const projectName = item.projectName.trim() ? item.projectName : item.scheduleProjectName?.trim() || item.projectName;
    const verification = normalizeDAVECompletionVerification(item.completionVerification);
    const verificationChanged = JSON.stringify(item.completionVerification ?? null) !== JSON.stringify(verification);
    if (projectName === item.projectName && !verificationChanged) return item;
    changed = true;
    return { ...item, projectName, ...(verificationChanged ? { completionVerification: verification } : {}) };
  });
  return (changed ? projected : items) as unknown as T;
}
