#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const core = read('services/PIECoreIntelligence.ts');
const reports = read('screens/ReportsScreen.tsx');
const app = read('App.tsx');
const provider = read('providers/PIELiveAuthorityProvider.tsx');
const reporter = read('services/PIEReporter.ts');
const runtime = read('services/PIERuntime.ts');
const evidenceFusion = read('services/PIEEvidenceFusion.ts');

assert(core.includes('buildPIEReportDraftFromExecutiveJudgment'), 'Live Core must build reports from persisted Executive Judgment.');
assert(core.includes('executiveJudgmentRecord'), 'Live Core must persist and expose Executive Judgment records.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must prefer provider report drafts with Runtime recovery only.');
assert(!reports.includes('buildPIEReportDraft({'), 'Review must not rebuild report drafts from raw arrays.');
assert(reports.includes('const baseReportDraft = liveAuthority.reportDraft || runtime.response.reportDraft'), 'Reports must select the authoritative draft before review or sharing.');
assert(reports.includes('onEmailReport(effectiveReportDraft)'), 'Email action must use the reviewed authoritative report draft.');
assert(reports.includes('onCopyReport(effectiveReportDraft)'), 'Copy action must use the reviewed authoritative report draft.');
assert(!reports.includes('MailComposer.composeAsync'), 'Review screen must not auto-send mail directly.');
assert(
  provider.includes('projectNames: input.projectNames'),
  'Report authority refresh signatures must include single/combined project scope.',
);
assert(
  provider.includes('const refreshInput = latestInputRef.current') &&
    provider.includes("void runRefresh(pendingReason || 'project_changed')"),
  'Authority refreshes must replay the latest input when scope changes during in-flight work.',
);
assert(
  provider.includes('const inputSnapshotIsCurrent = scopeIsCurrent && rawSignature === signature') &&
    provider.includes('const displayInput = inputSnapshotIsCurrent ? authorityInput : input') &&
    provider.includes('const currentCore = authorityResolution.coreIsCurrent ? core : null'),
  'Report UI must not expose a completed draft built before hydration or for an older project scope.',
);
assert(
  provider.includes('inputSnapshotIsCurrent ? null : safeBuildProviderRuntime(input)') &&
    provider.includes('currentCore?.runtime || immediateInputRuntime || fallbackRuntime'),
  'A newly selected report scope must render its current Runtime immediately without a stale combined-report frame.',
);
assert(
  provider.includes('reportType: refreshInput.reportType') &&
    runtime.includes('reportType: context.reportType ||'),
  'The user-selected report type must remain explicit through Runtime and Core authority.',
);
assert(
  reporter.includes('resolvePIEReportProjectNames({') &&
    app.includes('selectedReportProjectNames.flatMap(selectedProject =>') &&
    app.includes('savedUpdates.filter(update =>') &&
    app.includes('matchesReportProject(update.scheduleProjectName)') &&
    app.includes('matchesReportProject(item.locationName)'),
  'Single-project reports must filter evidence to the selected project instead of unioning all saved projects.',
);
assert(
  core.includes('savedUpdates: input.runtimeContext?.updates') &&
    core.includes('scheduleItems: input.runtimeContext?.scheduleItems'),
  'Authoritative reports must receive raw selected updates and schedules, not only a high-level Runtime summary.',
);
assert(
  reports.includes('Array.from(new Set([') &&
    reports.includes('key={`${index}-${warning}`}'),
  'Repeated report warnings must retain unique React keys.',
);
assert(
  reports.includes('key={`${item.id}-${index}`}') &&
    reports.includes('key={`${group.id}-${groupIndex}`}') &&
    reports.includes('key={`${area.id}-${areaIndex}`}') &&
    reporter.includes('stableSlugHash(normalized)'),
  'Report rows must remain uniquely keyed even when imported source IDs share long prefixes.',
);
assert(
  !reports.includes("? 'question' : 'questions'} to resolve") &&
    !reports.includes('Draft recovery mode:'),
  'Internal unanswered-question and report-authority diagnostics must not appear in the report surface.',
);
assert(
  reporter.includes('].filter((item): item is string => Boolean(item))).slice(0, 5)') &&
    reporter.includes('return selectConciseAreaBullets(uniqueBullets(bullets))') &&
    reporter.includes('].slice(0, 3)') &&
    reporter.includes('shortenReportBullet(bullet.text)'),
  'Generated reports must use a concise executive summary and at most three short bullets per work area.',
);
assert(
  reporter.includes('Key update: ${executiveAreaLabel(progressHighlight)}') &&
    reporter.includes("concernHighlight.hasSafetyConcern ? 'Safety' : 'Priority concern'") &&
    reporter.includes('Next action: ${executiveAreaLabel(actionHighlight)}') &&
    reporter.includes('Schedule attention is indicated in'),
  'Executive summaries must include concise progress, concern, action, and schedule context when available.',
);
assert(
  reports.includes('Report Scope') &&
    reports.includes('Report Format') &&
    reports.includes('Project Manager') &&
    reports.includes('Executive Summary') &&
    app.includes("reportFormat === 'executive'") &&
    app.includes("? 'executive_summary'"),
  'Reports must separate project scope from PM versus executive format.',
);
assert(
  reporter.includes("? 'Executive Summary'") &&
    reporter.includes("format === 'executive'") &&
    reporter.includes('reportBulletLabel(bullet)'),
  'Executive reports must omit work-area detail while PM reports retain labeled operational bullets.',
);
assert(
  reporter.includes("? 'Executive Summary'") &&
    reporter.includes(": 'Project Summary'") &&
    reports.includes("? 'Executive Summary'") &&
    reports.includes(": 'Project Summary'"),
  'Only executive-format reports may label their overview as Executive Summary.',
);
assert(
  reports.includes('function ReportDocumentPreview') &&
    reports.includes('reportDocumentSectionTitle') &&
    reports.includes('reportDocumentAreaTitle') &&
    reports.includes('reportDocumentBulletLabel'),
  'Report previews must render structured document headings and labeled, indented bullets.',
);
assert(
  reporter.includes('chooseBestWorkAreaName(candidates.slice(0, 2))') &&
    reporter.includes('if (cleaned.length <= 70) return cleaned;'),
  'Report work-area headings must prefer area metadata and reject caption-length headings.',
);
assert(
  reporter.includes('isConstructionRelevantObservation') &&
    reporter.includes('isIncidentalVisualObservation') &&
    reporter.includes('.filter(item => !isIncidentalReportEvidence(item))') &&
    reporter.includes('.filter(isVerifiedConstructionProgressEvidence)') &&
    reporter.includes("source === 'photo'") &&
    reporter.includes('return null;'),
  'Reports must exclude incidental visual observations and only count verified construction evidence as progress.',
);
assert(
  reporter.includes('No construction progress was reported or visually observed in the selected updates.') &&
    !reporter.includes('Verified construction progress was identified') &&
    !reporter.includes('areasWithProgress || workAreas.length'),
  'Report summaries must not overstate progress as verified or substitute the total work-area count when no progress evidence exists.',
);
assert(
  reporter.includes('function reportScheduleNote') &&
    reporter.includes('Activity ID:') &&
    reporter.includes('Predecessors?') &&
    reporter.includes('function scheduleActionLine') &&
    reporter.includes('Confirm the current status of'),
  'Reports must remove import metadata from PM copy and turn schedule risk into a meaningful follow-up.',
);
assert(
  reporter.includes('if (item.needsOwner) {') &&
    reporter.includes('return ensureSentence(item.action);') &&
    !reporter.includes('Owner unassigned —'),
  'Ownerless report actions must state the action directly without an Owner unassigned prefix.',
);
assert(
  reporter.includes("if (draft.reportType !== 'executive_summary') return draft;") &&
    reporter.includes("return projectName.trim() || areaName.trim() || 'Project';"),
  'PM reports must avoid executive-only recommendations and use the real parent project hierarchy.',
);
assert(
  reporter.includes('scheduleReconciliationReviewFlags(input.runtime)') &&
    reporter.includes('Schedule attention: ${shortenReportBullet(warning.summary, 165)}') &&
    runtime.includes('state.projectNames.length > 1 ? null : state.projectName') &&
    evidenceFusion.includes('projectName: projectNames.length > 1 ? null : resolvedProjectName') &&
    reporter.includes("warning.type === 'field_progress_not_reflected'"),
  'Reports and Runtime must use project-scoped schedule-to-field warnings without falling back to unrelated projects.',
);

console.log('PASS reporter authority routing');
