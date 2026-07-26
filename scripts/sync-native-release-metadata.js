const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const productMetadata = JSON.parse(
  fs.readFileSync(path.join(root, 'product-metadata.json'), 'utf8'),
);
const version = productMetadata.version;
const build = String(productMetadata.build);

assert.match(version || '', /^\d+\.\d+\.\d+$/, 'app.json must define a numeric Expo version.');
assert.match(build || '', /^\d+$/, 'app.json must define a numeric iOS build number.');
assert.equal(
  appConfig.expo?.version,
  version,
  'Run sync:product-metadata before synchronizing native files.',
);
assert.equal(
  appConfig.expo?.ios?.buildNumber,
  build,
  'Run sync:product-metadata before synchronizing native files.',
);

const infoPlistPath = path.join(root, 'ios', 'ProjectPhotoUpdateTool', 'Info.plist');
const projectPath = path.join(root, 'ios', 'ProjectPhotoUpdateTool.xcodeproj', 'project.pbxproj');
const androidGradlePath = path.join(root, 'android', 'app', 'build.gradle');
const infoPlistExists = fs.existsSync(infoPlistPath);
const projectExists = fs.existsSync(projectPath);
const androidGradleExists = fs.existsSync(androidGradlePath);

if (!infoPlistExists && !projectExists && !androidGradleExists) {
  console.log('Native projects are not generated; Expo will use app.json metadata.');
  process.exit(0);
}

if (infoPlistExists || projectExists) {
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
}

if (androidGradleExists) {
  const androidGradleSource = fs.readFileSync(androidGradlePath, 'utf8');
  const androidGradle = replaceExactlyOnce(
    replaceExactlyOnce(
      androidGradleSource,
      /^(\s*versionCode\s+)\d+(\s*)$/m,
      `$1${build}$2`,
      'versionCode',
      'Android',
    ),
    /^(\s*versionName\s+)["'][^"']*["'](\s*)$/m,
    `$1"${version}"$2`,
    'versionName',
    'Android',
  );
  writeIfChanged(androidGradlePath, androidGradle);
  console.log(`Native Android metadata synchronized: ${version} / Build ${build}`);
}

function replaceExactlyOnce(source, pattern, replacement, label, platform = 'iOS') {
  assert(pattern.test(source), `The native ${platform} ${label} value is missing.`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function writeIfChanged(filePath, nextValue) {
  if (fs.readFileSync(filePath, 'utf8') !== nextValue) {
    fs.writeFileSync(filePath, nextValue);
  }
}
