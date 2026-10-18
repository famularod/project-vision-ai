import { fieldUpdatesNewestFirst } from '../../services/PIEEvidenceFusion';
/**
 * HIGH item 1f (the final review's F1; the coordinator's decision): every output a report of one format produces, on
 * the phone and on the desktop, as words a test can compare. "Already sent" (and an approval) is true to the reader
 * only where none of these moves while the report's fingerprint stays. Each output is built from the app's own pieces:
 * the briefing, the writer's draft, the drawing references each device works out, and the Word builders' own
 * descriptions of a photo and of a drawing excerpt (services/ReportWordMediaDescription). A picture is named by what
 * decides it: a photo by its id, a drawing excerpt by its document, revision, page and the part of the page.
 *
 *   the phone   = the written report (Copy, Email, Text, Outlook's body), the Reports screen in that format (the
 *                 overview, the Drawing References panel, the Project Manager report's Work Areas & Photos panel), the
 *                 Word file (Download Word Report and Outlook: title, body, the photos the body cites, the drawings),
 *                 and the photos e-mail and text attach (those the body cites);
 *   the desktop = its report in that format and its Word file (title, body, every photo of the report's updates, the
 *                 drawings).
 *
 * The outputs themselves are pinned in tests/services/high1f-every-output-of-each-format.test.ts: a new one (a share
 * route, a field a Word item prints) fails there until it is held in the report's fingerprint and modelled here.
 */
import * as RI from '../../services/DAVEReportIntelligence';
import { buildDAVEWebReportTitle, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import type * as Description from '../../services/ReportWordMediaDescription';
import type { ProjectUpdate } from '../../types';

/**
 * The Word builders' descriptions (HIGH 1f's shared module). On a build before it, the words its two builders each wrote
 * the same way, so that this model runs there too (and shows where that build's fingerprint misses an output).
 */
const description = ((): typeof Description => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../services/ReportWordMediaDescription');
  } catch {
    const reason = (photo: Parameters<typeof Description.reportWordPhotoDescription>[0], update: Parameters<typeof Description.reportWordPhotoDescription>[1]) => {
      const area = photo.selectedAreaName?.trim() || update.selectedAreaName?.trim();
      const task = update.scheduleTaskName?.trim();
      return task
        ? `This photo is attached to the field update for ${task}${area ? ` in ${area}` : ''} and supports the recorded project condition.`
        : `This photo is attached to a field update for ${area || update.projectName} and supports the recorded project condition.`;
    };
    return {
      reportWordPhotoDescription: (photo, update) => ({
        caption: photo.caption?.trim() || `Project photo from ${photo.selectedAreaName || update.selectedAreaName || update.projectName}`,
        projectName: update.projectName, areaName: photo.selectedAreaName || update.selectedAreaName, linkedTaskName: update.scheduleTaskName,
        recordedAt: update.date, reasonForInclusion: reason(photo, update),
      }),
      reportWordDrawingDescription: reference => ({
        label: `${reference.projectName} · ${reference.areaName} · ${reference.citation.label}`, caption: `${reference.projectName} — ${reference.areaName}`,
        projectName: reference.projectName, areaName: reference.areaName,
        reasonForInclusion: `This excerpt comes from the current drawing reference mapped to ${reference.areaName} and is included so the reader can verify the reported work location.`,
        citation: reference.citation.label,
      }),
    } as typeof Description;
  }
})();
const { reportWordDrawingDescription, reportWordPhotoDescription } = description;

export type ReportOutputFormat = 'project_manager' | 'executive';
type Briefing = ReturnType<typeof RI.buildDAVEReportBriefing>;
export type ReportOutputDraft = Readonly<{
  title?: string;
  body?: string;
  locationGroups: ReadonlyArray<{ title: string; workAreas: ReadonlyArray<{ title: string; bullets: ReadonlyArray<{ text: string; kind?: string }>; imageReferences: ReadonlyArray<{ photoId: string; imageNumber: number; caption?: string; areaName: string }> }> }>;
}>;

/** The outputs this model covers, by device: the inventory test holds the app's own list of them to this. */
export const REPORT_OUTPUTS_MODELLED = {
  phone: ['written report', 'Reports screen overview', 'Drawing References panel', 'Work Areas & Photos panel', 'Word file', 'e-mail and text photos'],
  desktop: ['report', 'Word file'],
} as const;

const short = (value: string | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const signed = (value: number) => (value === 0 ? '0' : `${value > 0 ? '+' : ''}${value}`);
const variance = (value: number | null) => (value === null ? 'Not set' : value === 0 ? 'On baseline' : `${value > 0 ? '+' : ''}${value} day${Math.abs(value) === 1 ? '' : 's'}`);

/** Every word the phone's Reports screen overview shows of the report in `format` (ReportsScreen DAVEReportOverview, opened). */
export function reportScreenWords(briefing: Briefing, format: ReportOutputFormat): string[] {
  const executive = format === 'executive';
  const period = briefing.reportingPeriod;
  const counted = period.basis === 'previous_approved_report';
  const action = (item: Briefing['nextActions'][number]) => [
    item.taskName, [item.projectName, item.areaName].filter(Boolean).join(' · '), item.dueDate ? short(item.dueDate) : '', item.issue, item.impact, item.action,
    `Owner: ${item.owner} · ${item.timing}${item.scheduleImpactDays !== null ? ` · ${item.scheduleImpactDays} schedule day${Math.abs(item.scheduleImpactDays) === 1 ? '' : 's'}` : ''}`,
  ].join(' | ');
  const milestone = (item: Briefing['milestones'][number]) => `${item.taskName} | ${[item.projectName, item.areaName, short(item.finishDate)].filter(Boolean).join(' · ')}`;
  const health = briefing.dashboard.scheduleHealth;
  const status = briefing.dashboard.taskStatus;
  const controls = briefing.dashboard.controls;
  const area = (item: Briefing['dashboard']['workAreas'][number]) => `${item.areaName} ${item.averagePercent}% ${item.completeTaskCount} of ${item.taskCount} task${item.taskCount === 1 ? '' : 's'} complete`;
  return [
    briefing.conditionLabel, briefing.executiveSnapshot, period.label,
    ...(period.waitingForOtherDevice ? [RI.REPORT_PERIOD_WAITING_LINE] : counted ? [`Completed ${signed(period.completeDelta)}`, `Open ${signed(period.openDelta)}`, `Overdue ${signed(period.overdueDelta)}`] : [RI.REPORT_FIRST_PERIOD_LINE]),
    ...(counted && briefing.recentChanges.length ? briefing.recentChanges.slice(0, executive ? 5 : 8).map(change => change.summary) : counted && !period.waitingForOtherDevice ? ['No material task changes were recorded in this period.'] : []),
    ...briefing.projectConditions.flatMap(condition => [condition.projectName, `${condition.percentComplete}%`, condition.currentReality, condition.schedule, `Forecast ${short(condition.forecastFinish)}`, `Baseline ${short(condition.baselineFinish)}`, `Variance ${variance(condition.forecastVarianceDays)}`]),
    ...(briefing.completedWork.length ? briefing.completedWork.slice(0, 8) : ['No completed work is recorded in the current project scope.']).map((line, index) => `${index + 1}. ${line}`),
    ...(executive
      ? [...briefing.nextActions.slice(0, 4).map(action), ...briefing.milestones.slice(0, 5).map(milestone)]
      : [
          ...briefing.nextActions.slice(0, 6).map(action),
          ...briefing.currentWork.slice(0, 6).map((line, index) => `${index + 1}. ${line}`),
          ...briefing.milestones.slice(0, 8).map(milestone),
          `Total ${status.total}`, ...[['Complete', status.complete], ['In Progress', status.inProgress], ['Waiting', status.waiting], ['Not Started', status.notStarted]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${value}`),
          ...[['Approvals', controls.pendingApprovals], ['Responses due', controls.responsesDue], ['Unassigned', controls.unassignedOpenWork], ['Checklist items', controls.incompleteChecklistItems]].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label} ${value}`),
          ...briefing.dashboard.workAreas.map(area),
        ]),
    `On Track ${health.onTrack}`, `Blocked ${health.blocked}`, `Due Soon ${health.dueSoon}`, `Overdue ${health.overdue}`,
    ...briefing.projectConditions.map(condition => `${briefing.projectConditions.length > 1 ? `${condition.projectName}: ` : ''}${condition.currentReality}`).filter(item => item.replace(/^[^:]+:\s*/, '').trim()),
    ...briefing.schedulePosition, ...briefing.criticalRisks, ...briefing.decisionsRequired,
  ];
}

/** The Project Manager screen's Work Areas & Photos panel. */
export const workAreasPanelWords = (draft: ReportOutputDraft): string[] => draft.locationGroups.flatMap(group => [group.title, ...group.workAreas.flatMap(area => {
  const bullets = area.bullets.map(bullet => ({ kind: bullet.kind, text: RI.reportBulletText(bullet) })).filter(bullet => bullet.text);
  return [area.title, `${bullets.length} updates · ${area.imageReferences.length} photos`, ...bullets.map(bullet => `${bullet.kind}: ${bullet.text}`),
    ...area.imageReferences.map(reference => `Photo ${reference.imageNumber} — ${reference.caption || `Project photo from ${reference.areaName}`}`)];
})]);

/** A drawing excerpt as a file shows it: the Word builders' description, and what decides its picture. */
const drawingWords = (reference: ReportDrawingReference, index: number) => JSON.stringify({
  heading: `Drawing excerpt ${index + 1}`,
  ...reportWordDrawingDescription(reference),
  // What decides the picture: the document and its revision, the page, the part of the page. (Not where the file sits on
  // a device: the same file in another folder is the same picture, and each device has its own path.)
  picture: {
    documentId: reference.excerpt.document.id,
    revision: (reference.excerpt.document as { drawingRevision?: unknown }).drawingRevision ?? null,
    page: reference.excerpt.pageNumber,
    region: { x: reference.excerpt.region.x, y: reference.excerpt.region.y, width: reference.excerpt.region.width, height: reference.excerpt.region.height },
  },
});

/** The phone's Reports screen Drawing References panel (its first six). */
export const drawingPanelWords = (references: readonly ReportDrawingReference[]): string[] =>
  references.slice(0, 6).flatMap(reference => [`${reference.projectName} · ${reference.areaName}`, reference.citation.label, drawingWords(reference, 0)]);

/** A Word file: its title, body, numbered photos and drawings. The authority inputs
 * also hold whether Word may append a task's photo reference (7.78): changing
 * that reference cannot disappear from this fingerprint guard's model.
 */
export function wordFileWords({ title, body, photos, drawings, taskLines }: {
  title: string;
  body: string;
  photos: ReadonlyArray<Readonly<{ photoId: string; number: number }>>;
  drawings: readonly ReportDrawingReference[];
  taskLines?: Briefing['wordTaskLines'];
}, updates: readonly ProjectUpdate[]): string[] {
  const byId = new Map(updates.flatMap(update => (update.photos ?? []).map(photo => [photo.id, { photo, update }] as const)));
  return [
    `TITLE ${title}`, body,
    JSON.stringify({ wordTaskLines: taskLines ?? [] }),
    ...photos.map(({ photoId, number }) => {
      const found = byId.get(photoId);
      return JSON.stringify(found ? {
        label: `Photo ${number}`, photoId,
        ...reportWordPhotoDescription(found.photo, found.update),
        linkedTaskId: found.update.scheduleItemId,
        projectId: found.update.projectId,
      } : { label: `Photo ${number}`, photoId, missing: true });
    }),
    ...drawings.map(drawingWords),
  ];
}

/** Whether a body cites a photo (App.tsx reportBodyCitesImages: never the Executive report's). */
const citesImages = (format: ReportOutputFormat, body: string) => format !== 'executive' && /\bSee Images?\s+\d/i.test(body);

/** Every output the phone produces of the report in `format`. */
export function phoneOutputs({ briefing, draft, format, drawingReferences, updates }: {
  briefing: Briefing;
  draft: ReportOutputDraft;
  format: ReportOutputFormat;
  drawingReferences: readonly ReportDrawingReference[];
  updates: readonly ProjectUpdate[];
}): string {
  const report = RI.enhanceDAVEReportDraft(draft as never, briefing, format);
  const body = String(report.body);
  const cited = citesImages(format, body)
    ? draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.imageReferences.map(reference => ({ photoId: reference.photoId, number: reference.imageNumber }))))
      .sort((left, right) => left.number - right.number)
    : [];
  return [
    '== written report', body,
    '== Reports screen', ...reportScreenWords(briefing, format),
    '== Drawing References panel', ...drawingPanelWords(drawingReferences),
    ...(format === 'project_manager' ? ['== Work Areas & Photos panel', ...workAreasPanelWords(draft)] : []),
    '== Word file', ...wordFileWords({ title: String(report.title), body, photos: cited, drawings: drawingReferences, taskLines: briefing.wordTaskLines }, orderedUpdates),
    '== e-mail and text photos', ...cited.map(photo => `${photo.number} ${photo.photoId}`),
  ].join('\n');
}

/** Every output the desktop produces of the report in `format`: its report, and its Word file with every photo of the report's updates. */
export function desktopOutputs({ briefing, format, drawingReferences, updates }: {
  briefing: Briefing;
  format: ReportOutputFormat;
  drawingReferences: readonly ReportDrawingReference[];
  updates: readonly ProjectUpdate[];
}): string {
  const since = RI.reportPeriodMovementLines(briefing);
  const body = formatDAVEWebReport(briefing, format, since ? { label: briefing.reportingPeriod.label, lines: since } : null)
    .split('\n').filter(text => !/^Generated: /.test(text)).join('\n');
  // The actual desktop producer uses the written report's order, not cloud upload order (7.58).
  const orderedUpdates = fieldUpdatesNewestFirst(updates);
  const photos = [...new Set(orderedUpdates.flatMap(update => (update.photos ?? []).map(photo => photo.id)))].map((photoId, index) => ({ photoId, number: index + 1 }));
  return [
    '== report', body,
    '== Word file', ...wordFileWords({ title: buildDAVEWebReportTitle(briefing, format), body, photos, drawings: drawingReferences, taskLines: briefing.wordTaskLines }, orderedUpdates),
  ].join('\n');
}
