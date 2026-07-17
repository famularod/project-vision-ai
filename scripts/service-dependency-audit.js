#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const excludedDirectories = new Set([
  '.git',
  '.expo',
  'android',
  'build',
  'coverage',
  'dist',
  'docs',
  'e2e',
  'ios',
  'node_modules',
  'scripts',
  'supabase',
  'tests',
  'validation',
]);
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx'];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name)) return [];
      return walk(absolutePath);
    }
    return sourceExtensions.includes(path.extname(entry.name)) ? [absolutePath] : [];
  });
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    basePath,
    ...sourceExtensions.map(extension => `${basePath}${extension}`),
    ...sourceExtensions.map(extension => path.join(basePath, `index${extension}`)),
  ];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function importedSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) specifiers.push(match[1]);
  }
  return specifiers;
}

const files = walk(root);
const fileSet = new Set(files);
const dependencies = new Map();
const consumers = new Map(files.map(file => [file, new Set()]));

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const resolved = new Set(
    importedSpecifiers(source)
      .map(specifier => resolveImport(file, specifier))
      .filter(candidate => candidate && fileSet.has(candidate)),
  );
  dependencies.set(file, resolved);
  for (const dependency of resolved) consumers.get(dependency)?.add(file);
}

const roots = ['index.ts', 'index.tsx', 'App.tsx']
  .map(file => path.join(root, file))
  .filter(file => fileSet.has(file));
const reachable = new Set();
const queue = [...roots];
while (queue.length > 0) {
  const file = queue.shift();
  if (!file || reachable.has(file)) continue;
  reachable.add(file);
  for (const dependency of dependencies.get(file) || []) queue.push(dependency);
}

const serviceDirectory = path.join(root, 'services');
const serviceFiles = files
  .filter(file => file.startsWith(`${serviceDirectory}${path.sep}`))
  .sort();
const unreachableServices = serviceFiles.filter(file => !reachable.has(file));

const relative = file => path.relative(root, file);
const result = {
  generatedAt: new Date().toISOString(),
  productionRoots: roots.map(relative),
  serviceCount: serviceFiles.length,
  reachableServiceCount: serviceFiles.length - unreachableServices.length,
  unreachableServiceCount: unreachableServices.length,
  unreachableServices: unreachableServices.map(file => ({
    file: relative(file),
    staticConsumers: [...(consumers.get(file) || [])].map(relative).sort(),
  })),
  mostConsumedServices: serviceFiles
    .map(file => ({
      file: relative(file),
      consumerCount: consumers.get(file)?.size || 0,
    }))
    .sort((left, right) => right.consumerCount - left.consumerCount || left.file.localeCompare(right.file))
    .slice(0, 20),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log(`Services: ${result.serviceCount}`);
console.log(`Reachable from mobile entry: ${result.reachableServiceCount}`);
console.log(`Not statically reachable: ${result.unreachableServiceCount}`);
for (const service of result.unreachableServices) {
  const consumerNote = service.staticConsumers.length > 0
    ? ` (non-production consumers: ${service.staticConsumers.join(', ')})`
    : '';
  console.log(`- ${service.file}${consumerNote}`);
}

if (process.argv.includes('--assert')) {
  const maximumUnreachableServices = 5;
  if (result.unreachableServiceCount > maximumUnreachableServices) {
    console.error(
      `FAIL unreachable service count grew beyond ${maximumUnreachableServices}.`,
    );
    process.exit(1);
  }
  console.log(`PASS service reachability ratchet: ${result.unreachableServiceCount}/${maximumUnreachableServices}.`);
}
