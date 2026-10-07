import type { ScheduleRetirementEffect } from './SharedDocumentActivation';

/**
 * Review pass 1, web L5 (6 Oct 2026; caused by WS2 item 3): the words of the
 * web's "Change the current schedule?" card.
 *
 * WS2 item 3 gave the card one fixed first line, "Making “X” current changes
 * more than its own project.", and under it the phone's sentences
 * (scheduleRetirementMessage). Two things were then untrue on the web:
 *  - the card is also shown when the only change is to X's OWN project: an
 *    older combined schedule made current for a project that shows nothing,
 *    while another of its projects shows a newer schedule (whole-app audit A8
 *    pass 7 L1). Nothing changes beyond its own projects there;
 *  - the phone's sentences name the phone's button ("Set Active on Combined
 *    will show Combined for Alpha too.", "... until you set one."). The web's
 *    button is Make Current Schedule.
 *
 * What changes is still worked out by the phone's own function
 * (scheduleActivationEffects); only the words are the web's. The phone's
 * sentences are left as they are for the phone. Each sentence here is true
 * in every state the card can appear in: another project's schedule changes,
 * one of the schedule's own projects loses a newer schedule, or both.
 */

/** Alpha; Alpha and Beta; Alpha, Beta and Gamma. */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One project, or "each of" several: what is said holds for every one of them. */
function eachOf(names: readonly string[]): string {
  return names.length <= 1 ? listed(names) : `each of ${listed(names)}`;
}

function kinds(effects: readonly ScheduleRetirementEffect[]) {
  return {
    /** Projects that are not the chosen schedule's own, whose schedule it retires. */
    others: effects.filter(effect => !effect.newerScheduleReplaced),
    /** The chosen schedule's own projects that show a newer schedule now, which it replaces there. */
    own: effects.filter(effect => effect.newerScheduleReplaced && effect.fallbackSchedule),
  };
}

/** The card's first line: what kind of change making this schedule current brings. Empty when there is none. */
export function daveWebScheduleRetirementLead(
  targetName: string,
  effects: readonly ScheduleRetirementEffect[],
): string {
  const { others, own } = kinds(effects);
  const replaces = `replaces a newer schedule for ${eachOf(own.map(effect => effect.projectName))}`;
  if (others.length > 0 && own.length > 0) return `Making “${targetName}” current changes more than its own project, and ${replaces}.`;
  if (others.length > 0) return `Making “${targetName}” current changes more than its own project.`;
  return own.length > 0 ? `Making “${targetName}” current ${replaces}.` : '';
}

/** The card's sentences: what each project named is left showing. Empty when nothing changes for any. */
export function daveWebScheduleRetirementMessage(
  targetName: string,
  effects: readonly ScheduleRetirementEffect[],
): string {
  const { others, own } = kinds(effects);
  return [
    ...(others.length > 0 ? [`The schedule now current for ${eachOf(others.map(effect => effect.projectName))} will be retired too.`] : []),
    ...others.map(effect => effect.fallbackSchedule
      ? `${effect.projectName} goes back to ${effect.fallbackSchedule.name}, an older schedule still marked current there.`
      : `${effect.projectName} is left with no current schedule and shows no schedule tasks until a schedule is made current for it.`),
    ...own.map(effect =>
      `${effect.projectName} now shows “${effect.newerScheduleReplaced!.name}”, which is newer. Making “${targetName}” current will show “${targetName}” for ${effect.projectName} instead.`),
  ].join(' ');
}
