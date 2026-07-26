const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoots = ['App.tsx', 'components', 'providers', 'screens', 'services'];
const sourceFiles = [];
const visibleDaveFiles = new Set([
  'App.tsx',
  'screens/AdminScreen.tsx',
  'screens/ReportsScreen.tsx',
  'components/DAVEAskExperience.tsx',
  'components/DAVETypedCaptureSheet.tsx',
  'components/DAVEVoiceCaptureSheet.tsx',
  'components/DAVECaptureConfirmationSheet.tsx',
  'components/DAVECaptureMemoryDetailSheet.tsx',
  'components/PIEPanel.tsx',
  'services/DAVEDailyBrief.ts',
  'services/DAVEProjectReality.ts',
  'services/DAVEProjectEvidenceQuality.ts',
  'services/PIEAttentionEngine.ts',
  'services/PIEConversationEngine.ts',
  'services/PIEDecisionEngine.ts',
  'services/PIEEvidenceFusion.ts',
  'services/PIEExperienceEngine.ts',
  'services/PIEMissingEvidence.ts',
  'services/PIEPhotoVisionMobileWorkflow.ts',
  'services/PIEReporter.ts',
  'services/PIEScheduleReconciliation.ts',
  'services/ProjectIntelligenceEngine.ts',
]);

function collectSourceFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolutePath)) {
      collectSourceFiles(path.join(relativePath, entry));
    }
    return;
  }
  if (/\.tsx?$/.test(relativePath)) sourceFiles.push(relativePath);
}

sourceRoots.forEach(collectSourceFiles);

const violations = [];
const visibleDaveViolations = [];
for (const relativePath of sourceFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    const isUserReadableText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node);
    const isModuleSpecifier = ts.isStringLiteral(node) && (
      (ts.isImportDeclaration(node.parent) && node.parent.moduleSpecifier === node) ||
      (ts.isExportDeclaration(node.parent) && node.parent.moduleSpecifier === node)
    );
    if (isUserReadableText && /\bPIE\b/.test(node.text)) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${relativePath}:${location.line + 1}`);
    }
    if (
      visibleDaveFiles.has(relativePath) &&
      isUserReadableText &&
      !isModuleSpecifier &&
      /\bDAVE\b/.test(node.text)
    ) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      visibleDaveViolations.push(`${relativePath}:${location.line + 1}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (visibleDaveViolations.length > 0) {
  throw new Error(
    `Functional UI copy should describe the capability instead of repeating DAVE:\n${visibleDaveViolations.join('\n')}`,
  );
}

if (violations.length > 0) {
  throw new Error(
    `Visible legacy PIE branding remains in user-readable source text:\n${violations.join('\n')}`,
  );
}

const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
for (const expectedLabel of [
  'Photo Review',
  'Photo Analysis',
  'Analysis status',
]) {
  if (!app.includes(expectedLabel)) {
    throw new Error(`Expected consolidated DAVE label is missing: ${expectedLabel}`);
  }
}

console.log('DAVE brand consolidation tests passed.');
