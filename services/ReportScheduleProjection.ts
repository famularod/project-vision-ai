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

/** The native report input before four-digit low years were preserved when saved.
 * Only this report-history view uses the former spelling. Saved and modern inputs stay intact.
 */
export function nativeScheduleItemsAsBeforeLowYearFormatting<T extends readonly ScheduleItem[]>(items: T): T {
  const before = (value: string) => {
    const match = value.match(/^(\d{2})\/(\d{2})\/(0[1-9]\d{2})$/);
    if (!match) return value;
    const year = Number(match[3]);
    const date = new Date(year, Number(match[1]) - 1, Number(match[2]));
    return date.getFullYear() === year && date.getMonth() + 1 === Number(match[1]) && date.getDate() === Number(match[2])
      ? `${match[1]}/${match[2]}/${year}` : value;
  };
  let changed = false;
  const projected = items.map(item => {
    const startDate = before(item.startDate);
    const finishDate = before(item.finishDate);
    if (startDate === item.startDate && finishDate === item.finishDate) return item;
    changed = true;
    return { ...item, startDate, finishDate };
  });
  return (changed ? projected : items) as unknown as T;
}
