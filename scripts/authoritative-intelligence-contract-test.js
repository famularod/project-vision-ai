#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const failures = [];

function source(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing required file: ${relativePath}.`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, snippets) {
  const contents = source(relativePath);
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      failures.push(`${relativePath} is missing contract: ${snippet}.`);
    }
  }
}

requireText('services/AuthoritativeDocumentSystem.ts', [
  'currentAuthoritativeDocumentsForProject',
  'markAuthoritativeDocumentCurrent',
  'minimumConfidence',
  'region.areaName',
]);
requireText('services/ReportDrawingReferences.ts', [
  'buildAutomaticReportDrawingReferences',
  'selectAutomaticDrawingExcerpt',
]);
requireText('services/PIEPhotoVisionMobileWorkflow.ts', [
  'analyzeSingleProjectPhoto',
  "mode: 'single_photo'",
  'photoAnalysisContractEnvelope',
]);
requireText('services/BackupRestoreRuntime.ts', [
  'captureMemories',
  'validateBackupProjectRecordAuthority',
  'survivingProjectIds.has(captureMemoryProjectId(memory))',
  'serializeCaptureMemories',
]);
requireText('services/DAVEReportSnapshot.ts', [
  'sourceReferences',
  'revision:',
  'regionId',
]);
requireText('screens/ReportsScreen.tsx', [
  'drawingReferences',
  'Drawing References',
  'sourceReferences:',
]);
requireText('App.tsx', [
  '<DailyBriefSection',
  'Compare photos',
  'Share Schedule',
  'shareScheduleCalendar',
  'shareScheduleLookahead',
]);

console.log('Authoritative Intelligence Contract');
if (failures.length === 0) {
  console.log('PASS: document authority, report citations, photo analysis, backup safety, daily brief, comparison, and schedule sharing remain connected.');
} else {
  console.log('FAIL:');
  failures.forEach(failure => console.log(`- ${failure}`));
  process.exitCode = 1;
}
