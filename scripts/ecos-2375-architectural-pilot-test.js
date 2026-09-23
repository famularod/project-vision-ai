#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const definitionPath = path.join(root, 'validation/ecos/2375-architectural-pilot.json');
const definition = JSON.parse(fs.readFileSync(definitionPath, 'utf8'));
const sheetMap = JSON.parse(fs.readFileSync(
  path.join(root, 'validation/ecos/2375-architectural-sheet-map.json'),
  'utf8',
));
const problems = [];

if (definition.schemaVersion !== 'ecos-architectural-pilot/1.0') problems.push('Unexpected schema version.');
if (definition.projectName !== '2375 Compliance Project') problems.push('Pilot project is not fixed to 2375.');
if (definition.discipline !== 'architectural') problems.push('Pilot discipline is not architectural.');
if (definition.targetQuestionCount !== 50) problems.push('Pilot target must remain 50 questions.');
if (!Array.isArray(definition.cases) || definition.cases.length < 10) problems.push('Initial pilot requires at least 10 cases.');
if (sheetMap.schemaVersion !== 'ecos-canonical-sheet-map/1.0') problems.push('Unexpected sheet-map schema version.');
if (sheetMap.documentSha256 !== definition.source.sha256) problems.push('Sheet map is bound to a different source.');
if (sheetMap.pageCount !== definition.source.pageCount || sheetMap.sheets?.length !== definition.source.pageCount) {
  problems.push('Canonical sheet map does not cover every PDF page exactly once.');
}
const sheetByPage = new Map();
for (const sheet of sheetMap.sheets || []) {
  if (sheetByPage.has(sheet.pdfPage)) problems.push(`PDF page ${sheet.pdfPage} is mapped more than once.`);
  sheetByPage.set(sheet.pdfPage, sheet.sheetNumber);
}
for (let page = 1; page <= definition.source.pageCount; page += 1) {
  if (!sheetByPage.has(page)) problems.push(`PDF page ${page} is missing from the canonical sheet map.`);
}

const ids = new Set();
for (const [index, testCase] of (definition.cases || []).entries()) {
  const label = `case ${index + 1}`;
  if (!testCase.id || ids.has(testCase.id)) problems.push(`${label} has a missing or duplicate id.`);
  ids.add(testCase.id);
  if (!testCase.question || !testCase.expectedAnswer) problems.push(`${label} is missing its question or verified answer.`);
  if (!/^A-\d/.test(testCase.sheetNumber || '')) problems.push(`${label} is not bound to an architectural sheet.`);
  if (!Number.isInteger(testCase.pdfPage) || testCase.pdfPage < 1 || testCase.pdfPage > definition.source.pageCount) {
    problems.push(`${label} has an invalid PDF page.`);
  }
  if (!testCase.evidenceLabel) problems.push(`${label} is missing an evidence-region label.`);
  if (sheetByPage.get(testCase.pdfPage) !== testCase.sheetNumber) {
    problems.push(`${label} cites ${testCase.sheetNumber} on PDF page ${testCase.pdfPage}, but the canonical map says ${sheetByPage.get(testCase.pdfPage)}.`);
  }
  if (!['printed', 'visual_location', 'calculated', 'unanswerable'].includes(testCase.answerType)) {
    problems.push(`${label} has an invalid answer type.`);
  }
  for (const pattern of testCase.requiredAnswerPatterns || []) {
    let regex;
    try { regex = new RegExp(pattern, 'i'); } catch (error) {
      problems.push(`${label} has invalid pattern ${pattern}: ${error.message}`);
      continue;
    }
    if (!regex.test(testCase.expectedAnswer)) problems.push(`${label} expected answer does not satisfy /${pattern}/i.`);
  }
}

if (definition.evidencePolicy.allowFieldUpdates || definition.evidencePolicy.allowScheduleItems ||
    definition.evidencePolicy.allowPhotos || definition.evidencePolicy.allowOtherDisciplines) {
  problems.push('Architectural pilot evidence isolation was weakened.');
}

const sourcePath = process.env.ECOS_2375_ARCHITECTURAL_PDF ||
  '/Users/davidfamularo/Downloads/01 - PLZ CORP - 2375 THIRD STREET - ARCHITECTURAL.pdf';
if (fs.existsSync(sourcePath)) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
  if (digest !== definition.source.sha256) problems.push(`Source SHA-256 changed: ${digest}.`);
} else if (process.env.ECOS_2375_ARCHITECTURAL_PDF) {
  problems.push(`Configured source does not exist: ${sourcePath}.`);
}

if (problems.length) {
  console.error(`2375 architectural pilot contract failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`2375 architectural pilot contract passed: ${definition.cases.length}/${definition.targetQuestionCount} verified questions defined.`);
