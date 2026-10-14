import type { ScheduleItem } from '../types';
import { classifyDAVEBlocker, classifyDAVEIssue, classifyDAVESafety } from './DAVEAssertionParser';
import { scheduleProgressIsComplete } from './ScheduleProgressInvariant';

/**
 * HIGH item 1d (open item 7.55; the owner's instruction of 13 Oct 2026, the three high items): what the phone's
 * written report prints of a task's own schedule line in WORK AREAS / PHOTO NOTES, for the report's fingerprint
 * (ReportWrittenFacts), worked out the same on the phone and on the desktop. The line (the task's name, due date,
 * status, owner or contractor, and notes) prints as a problem where it reads as one, and as a next step, with its
 * owner, where it is one; else not at all.
 *
 * The writer's own rule for a schedule line (services/PIEReporter.ts: scheduleSummaryLine, scheduleActionLine,
 * reportScheduleNote, cleanReportBulletText, isRiskText, ownerFromText, ACTION_LANGUAGE, and isActionEvidence and
 * actionFromEvidence as they read a schedule line), word for word. Here, not imported: the desktop works the
 * fingerprint out too and does not load the writer (which loads the phone's own storage), and the writer's own
 * scripts keep its rules where they are. A test holds this to the lines the writer prints
 * (high1d-record-facts-held-as-each-format-prints-them: "the schedule line held is the line the writer prints").
 */
export type DAVEWrittenScheduleLine = Readonly<{
  problem: string | null;
  nextStep: Readonly<{ action: string; owner: string | null }> | null;
}>;

export function scheduleLineAsWritten(item: ScheduleItem): DAVEWrittenScheduleLine {
  const summary = scheduleSummaryLine(item);
  const owner = item.owner || item.contractor || null;
  const actionRequired = scheduleActionLine(item);
  const isNextStep = actionRequired?.trim()
    ? true
    : owner || ownerFromText(summary)
      ? ACTION_LANGUAGE.test(summary)
      : classifyDAVEBlocker(`${item.status || ''} ${summary}`) === 'blocked';
  return {
    problem: isRiskText(summary) ? cleanReportBulletText(summary) : null,
    nextStep: isNextStep ? { action: actionFrom(actionRequired || summary), owner: owner || ownerFromText(summary) } : null,
  };
}

const ACTION_LANGUAGE =
  /\b(please|need|needs|confirm|review|move|verify|provide|approve|assign|resolve|coordinate|schedule|complete|required|follow up|follow-up)\b/i;

function scheduleSummaryLine(item: ScheduleItem) {
  const scheduleNote = reportScheduleNote(item.notes);
  const parts = [
    cleanReportBulletText(item.taskName),
    !scheduleProgressIsComplete(item) && item.finishDate
      ? `due ${item.finishDate}`
      : null,
    item.status ? `status ${item.status}` : null,
    item.owner || item.contractor ? `owner ${item.owner || item.contractor}` : null,
    scheduleNote || null,
  ].filter(Boolean);

  return parts.join(', ');
}

function scheduleActionLine(item: ScheduleItem) {
  const taskName = cleanReportBulletText(item.taskName);
  if (!taskName) return null;
  if (item.status === 'Waiting') return `Confirm what is blocking ${taskName}.`;
  if (item.priority === 'High' && !scheduleProgressIsComplete(item)) {
    return `Confirm the current status of ${taskName}.`;
  }

  return null;
}

function reportScheduleNote(value: string) {
  return cleanReportBulletText(value)
    .replace(/\bActivity ID:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bDuration:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bPredecessors?:\s*[^.]+\.?\s*/gi, '')
    .replace(/\bImported from (?:a )?structured Microsoft Project PDF;?\s*/gi, '')
    .replace(/\bverify highlighted fields before approval\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function actionFrom(action: string) {
  return cleanReportBulletText(
    action
      .replace(/^next step:\s*/i, '')
      .replace(/^please\s+/i, '')
      .replace(/\bowner\s*:?\s*[A-Z][A-Za-z]+(?:\s*\/\s*[A-Z][A-Za-z]+)?/i, '')
      .trim(),
  );
}

function cleanReportBulletText(value: string) {
  let text = value
    .replace(/\s+/g, ' ')
    .replace(/\.\.+/g, '.')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\bLocation was captured\b\.?/gi, '')
    .replace(/\bGPS was captured\b\.?/gi, '')
    .replace(/\bEvidence was fused\b\.?/gi, '')
    .replace(/\bRuntime indicates\b[:,]?\s*/gi, '')
    .replace(/\bNo image references included\b\.?/gi, '')
    .replace(/\bpuddings\b/gi, 'footings')
    .replace(/\brebar is installed\b/gi, 'rebar has been installed')
    .replace(/\bstructure builders complete\b/gi, 'structural work is complete')
    .replace(/\bstill needs electrical\b/gi, 'electrical work remains')
    .replace(/\bphoto captured\b/gi, 'photo added for reference')
    .trim();

  text = text.replace(/([.!?])\1+$/g, '$1');

  if (/structural work is complete/i.test(text) && /electrical work remains/i.test(text)) {
    return 'Structural work is complete. Electrical work remains before the area can advance to the next phase.';
  }

  return text;
}

function isRiskText(value: string) {
  return (
    classifyDAVEIssue(value) === 'issue_present' ||
    classifyDAVEBlocker(value) === 'blocked' ||
    classifyDAVESafety(value) === 'issue_present'
  );
}

function ownerFromText(value: string) {
  const match = value.match(
    /\b([A-Z][A-Za-z]+(?:\s*\/\s*[A-Z][A-Za-z]+)?(?:\s+[A-Z][A-Za-z]+)?)\s*[–-]\s*Please\b/,
  );

  return match?.[1]?.trim() || null;
}
