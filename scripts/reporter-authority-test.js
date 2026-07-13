#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const core = read('services/PIECoreIntelligence.ts');
const reports = read('screens/ReportsScreen.tsx');
const buildUpdate = read('screens/BuildUpdateScreen.tsx');
const provider = read('providers/PIELiveAuthorityProvider.tsx');
const reporter = read('services/PIEReporter.ts');
const runtime = read('services/PIERuntime.ts');
const evidenceFusion = read('services/PIEEvidenceFusion.ts');
const app = read('App.tsx');

assert(core.includes('buildPIEReportDraftFromExecutiveJudgment'), 'Live Core must build reports from persisted Executive Judgment.');
assert(core.includes('executiveJudgmentRecord'), 'Live Core must persist and expose Executive Judgment records.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must prefer provider report drafts with Runtime recovery only.');
assert(!reports.includes('buildPIEReportDraft({'), 'Review must not rebuild report drafts from raw arrays.');
assert(buildUpdate.includes('authoritativeReportDraft'), 'Share/Build Update must use provider report draft when present.');
assert(buildUpdate.includes('onEmailReport(authoritativeReportDraft)'), 'Email action must use authoritative report draft when available.');
assert(buildUpdate.includes('onCopyReport(authoritativeReportDraft)'), 'Copy action must use authoritative report draft when available.');
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
  provider.includes('const currentCore = coreSignature === signature ? core : null') &&
    provider.includes('setFallbackRuntime(safeBuildProviderRuntime(input))'),
  'Report UI must not expose a completed draft built for an older project scope.',
);
assert(
  provider.includes('coreSignature === signature ? fallbackRuntime : currentInputRuntime'),
  'A newly selected report scope must render its current Runtime immediately without a stale combined-report frame.',
);
assert(
  provider.includes('reportType: refreshInput.reportType') &&
    runtime.includes('reportType: context.reportType ||'),
  'The user-selected report type must remain explicit through Runtime and Core authority.',
);
assert(
  reporter.includes('resolvePIEReportProjectNames({') &&
    app.includes('savedUpdates.filter(update => matchesReportUpdate(update.projectName))') &&
    app.includes('matchesReportProject(item.locationName)'),
  'Single-project reports must filter evidence to the selected project instead of unioning all saved projects.',
);
assert(
  core.includes('savedUpdates: input.runtimeContext?.updates') &&
    core.includes('scheduleItems: input.runtimeContext?.scheduleItems'),
  'Authoritative reports must receive raw selected updates and schedules, not only a high-level Runtime summary.',
);
assert(
  reports.includes('key={`${index}-${flag}`}') &&
    reports.includes('key={`${index}-${warning}`}'),
  'Repeated report warnings must retain unique React keys.',
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
  reporter.includes("? 'DAVE Executive Summary'") &&
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
  reporter.includes('scheduleReconciliationReviewFlags(input.runtime)') &&
    reporter.includes('Schedule attention: ${shortenReportBullet(warning.summary, 165)}') &&
    runtime.includes('state.projectNames.length > 1 ? null : state.projectName') &&
    evidenceFusion.includes('projectName: projectNames.length > 1 ? null : resolvedProjectName') &&
    reporter.includes("warning.type === 'field_progress_not_reflected'"),
  'Reports and Runtime must use project-scoped schedule-to-field warnings without falling back to unrelated projects.',
);

console.log('PASS reporter authority routing');
