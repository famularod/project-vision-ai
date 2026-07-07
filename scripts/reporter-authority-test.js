#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const core = read('services/PIECoreIntelligence.ts');
const reports = read('screens/ReportsScreen.tsx');
const buildUpdate = read('screens/BuildUpdateScreen.tsx');

assert(core.includes('buildPIEReportDraftFromExecutiveJudgment'), 'Live Core must build reports from persisted Executive Judgment.');
assert(core.includes('executiveJudgmentRecord'), 'Live Core must persist and expose Executive Judgment records.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must prefer provider report drafts with Runtime recovery only.');
assert(!reports.includes('buildPIEReportDraft({'), 'Review must not rebuild report drafts from raw arrays.');
assert(buildUpdate.includes('authoritativeReportDraft'), 'Share/Build Update must use provider report draft when present.');
assert(buildUpdate.includes('onEmailReport(authoritativeReportDraft)'), 'Email action must use authoritative report draft when available.');
assert(buildUpdate.includes('onCopyReport(authoritativeReportDraft)'), 'Copy action must use authoritative report draft when available.');
assert(!reports.includes('MailComposer.composeAsync'), 'Review screen must not auto-send mail directly.');

console.log('PASS reporter authority routing');
