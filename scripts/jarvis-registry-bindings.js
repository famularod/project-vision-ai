const fs = require('node:fs');
const path = require('node:path');

function extractNamedJestTests(source) {
  const names = [];
  const pattern = /\b(?:it|test)\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  const executableSource = stripJavaScriptComments(source);
  let match;
  while ((match = pattern.exec(executableSource)) !== null) {
    names.push(unescapeSimpleLiteral(match[2]));
  }
  return names;
}

function productionSymbolIsDeclared(source, symbol) {
  const escaped = escapeRegExp(symbol);
  const executableSource = stripJavaScriptComments(source);
  return new RegExp(
    `\\b(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?`
      + `(?:function|class|const|let|var|interface|type|enum)\\s+${escaped}\\b`,
  ).test(executableSource);
}

function auditOptionalRegistryBindings(defect, repoRoot) {
  const failures = [];
  const evidence = new Set(defect.automatedEvidence || []);

  if (defect.namedTests !== undefined && !Array.isArray(defect.namedTests)) {
    failures.push(`${defect.id} namedTests must be an array when provided.`);
  }
  for (const binding of Array.isArray(defect.namedTests) ? defect.namedTests : []) {
    if (!binding || typeof binding.path !== 'string' || typeof binding.name !== 'string') {
      failures.push(`${defect.id} has an invalid namedTests entry.`);
      continue;
    }
    if (!evidence.has(binding.path)) {
      failures.push(`${defect.id} named test is not listed in automatedEvidence: ${binding.path}.`);
      continue;
    }
    const filePath = path.join(repoRoot, binding.path);
    if (!fs.existsSync(filePath)) {
      failures.push(`${defect.id} named test file is missing: ${binding.path}.`);
      continue;
    }
    const names = extractNamedJestTests(fs.readFileSync(filePath, 'utf8'));
    if (!names.includes(binding.name)) {
      failures.push(
        `${defect.id} does not contain the named Jest test "${binding.name}" in ${binding.path}.`,
      );
    }
  }

  if (defect.productionSymbols !== undefined && !Array.isArray(defect.productionSymbols)) {
    failures.push(`${defect.id} productionSymbols must be an array when provided.`);
  }
  for (const binding of Array.isArray(defect.productionSymbols)
    ? defect.productionSymbols
    : []) {
    if (!binding || typeof binding.path !== 'string' || typeof binding.symbol !== 'string') {
      failures.push(`${defect.id} has an invalid productionSymbols entry.`);
      continue;
    }
    if (
      !/^(?:App\.tsx|(?:components|hooks|providers|screens|services|utils)\/.+\.[cm]?[jt]sx?)$/
        .test(binding.path)
    ) {
      failures.push(`${defect.id} production symbol path is outside runtime code: ${binding.path}.`);
      continue;
    }
    const filePath = path.join(repoRoot, binding.path);
    if (!fs.existsSync(filePath)) {
      failures.push(`${defect.id} production symbol file is missing: ${binding.path}.`);
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    if (!productionSymbolIsDeclared(source, binding.symbol)) {
      failures.push(
        `${defect.id} production symbol ${binding.symbol} is not declared in ${binding.path}.`,
      );
    }
  }

  return failures;
}

function unescapeSimpleLiteral(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\(["'`\\])/g, '$1');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripJavaScriptComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

module.exports = {
  auditOptionalRegistryBindings,
  extractNamedJestTests,
  productionSymbolIsDeclared,
};
