const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoots = [
  'App.tsx',
  'entry.ts',
  'entry.web.ts',
  'app',
  'components',
  'providers',
  'screens',
  'services',
];
const sourceFiles = [];
const retiredBrandPattern = /\b(?:DAVE|JARVIS|PIE)\b|Project Vision AI|Project Photo Update Tool/;
const humanStyleEcosPattern = /ECOS (?:believes|thinks|knows|remembers|sees|does not see)|What does ECOS know|What is ECOS assuming|Was ECOS (?:wrong|correct)|corrected ECOS/;

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
const humanStyleViolations = [];
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
    if (
      isUserReadableText &&
      !isModuleSpecifier &&
      retiredBrandPattern.test(node.text)
    ) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(`${relativePath}:${location.line + 1}`);
    }
    if (
      isUserReadableText &&
      !isModuleSpecifier &&
      humanStyleEcosPattern.test(node.text)
    ) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      humanStyleViolations.push(`${relativePath}:${location.line + 1}`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length > 0) {
  throw new Error(
    `Retired branding remains in user-readable source text:\n${violations.join('\n')}`,
  );
}

if (humanStyleViolations.length > 0) {
  throw new Error(
    `ECOS is presented as a human-style assistant in user-readable text:\n${humanStyleViolations.join('\n')}`,
  );
}

const app = fs.readFileSync(path.join(repoRoot, 'App.tsx'), 'utf8');
for (const expectedLabel of [
  'Photo Analysis',
  'Analysis status',
  'Photo status',
]) {
  if (!app.includes(expectedLabel)) {
    throw new Error(`Expected consolidated ECOS label is missing: ${expectedLabel}`);
  }
}

const productBrand = fs.readFileSync(path.join(repoRoot, 'product-brand.ts'), 'utf8');
for (const expectedContract of [
  'Vitruvius Project Intelligence, powered by ECOS.',
  "core: 'ECOS Core'",
  "assurance: 'ECOS Assurance'",
  'coreMayApproveOwnWork: false',
  'assuranceIsIndependent: true',
]) {
  if (!productBrand.includes(expectedContract)) {
    throw new Error(`Canonical ECOS contract is missing: ${expectedContract}`);
  }
}

const architectureDoc = fs.readFileSync(
  path.join(repoRoot, 'docs/VITRUVIUS_ECOS_NAMING_AND_ARCHITECTURE.md'),
  'utf8',
);
for (const expectedArchitectureRule of [
  'ECOS Core must not approve its own work.',
  'ECOS Assurance independently verifies:',
  'Vitruvius is the product. ECOS is the intelligence system. ECOS Core reasons.',
]) {
  if (!architectureDoc.includes(expectedArchitectureRule)) {
    throw new Error(`Canonical architecture documentation is missing: ${expectedArchitectureRule}`);
  }
}

console.log('Vitruvius and ECOS naming contract tests passed.');
