const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const version = appConfig.expo?.version;
const build = appConfig.expo?.ios?.buildNumber;

assert.match(version || '', /^\d+\.\d+\.\d+$/, 'app.json must define a numeric Expo version.');
assert.match(build || '', /^\d+$/, 'app.json must define a numeric iOS build number.');

const infoPlistPath = path.join(root, 'ios', 'ProjectPhotoUpdateTool', 'Info.plist');
const projectPath = path.join(root, 'ios', 'ProjectPhotoUpdateTool.xcodeproj', 'project.pbxproj');
const infoPlistExists = fs.existsSync(infoPlistPath);
const projectExists = fs.existsSync(projectPath);

if (!infoPlistExists && !projectExists) {
  console.log('Native iOS project is not generated; Expo will use app.json metadata.');
  process.exit(0);
}

assert(infoPlistExists && projectExists, 'Generated native iOS metadata is incomplete.');

const infoPlist = replaceExactlyOnce(
  replaceExactlyOnce(
    fs.readFileSync(infoPlistPath, 'utf8'),
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${version}$2`,
    'CFBundleShortVersionString',
  ),
  /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
  `$1${build}$2`,
  'CFBundleVersion',
);

const projectSource = fs.readFileSync(projectPath, 'utf8');
const marketingMatches = projectSource.match(/MARKETING_VERSION = [^;]+;/g) || [];
const buildMatches = projectSource.match(/CURRENT_PROJECT_VERSION = [^;]+;/g) || [];
assert(marketingMatches.length > 0, 'The native iOS project has no MARKETING_VERSION values.');
assert(buildMatches.length > 0, 'The native iOS project has no CURRENT_PROJECT_VERSION values.');
const project = projectSource
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

writeIfChanged(infoPlistPath, infoPlist);
writeIfChanged(projectPath, project);
console.log(`Native iOS metadata synchronized: ${version} / Build ${build}`);

function replaceExactlyOnce(source, pattern, replacement, label) {
  assert(pattern.test(source), `The native iOS ${label} value is missing.`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function writeIfChanged(filePath, nextValue) {
  if (fs.readFileSync(filePath, 'utf8') !== nextValue) {
    fs.writeFileSync(filePath, nextValue);
  }
}
