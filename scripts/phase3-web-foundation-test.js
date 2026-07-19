const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = relative => fs.existsSync(path.join(root, relative));
const appConfig = JSON.parse(read('app.json')).expo;
const packageJson = JSON.parse(read('package.json'));
const index = read('index.ts');
const nativeEntry = read('entry.ts');
const webEntry = read('entry.web.ts');
const shell = read('components/web-shell/desktop-read-only-shell.tsx');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(index.includes("import './entry'"), 'The root entry must resolve through a platform-specific entry module.');
assert(nativeEntry.includes("import App from './App'"), 'Native must keep the established reachable App.tsx entry.');
assert(nativeEntry.includes('registerRootComponent(App)'), 'Native must keep Expo root registration.');
assert(webEntry.includes("import 'expo-router/entry'"), 'Web must use the URL-addressable Expo Router entry.');
assert(appConfig.platforms.includes('web'), 'Web must be an explicit application platform.');
assert(appConfig.web?.bundler === 'metro', 'Web must use Metro for shared Expo module resolution.');
assert(appConfig.web?.output === 'static', 'The first read-only browser pilot must produce a static export.');
assert(appConfig.plugins.includes('expo-router'), 'Expo Router must be configured explicitly.');
for (const dependency of ['expo-router', 'react-dom', 'react-native-web', '@expo/metro-runtime']) {
  assert(packageJson.dependencies[dependency], `${dependency} must be a direct SDK-compatible dependency.`);
}
for (const route of ['app/_layout.tsx', 'app/index.tsx', 'app/projects.tsx', 'app/tasks.tsx', 'app/evidence.tsx', 'app/documents.tsx', 'app/reports.tsx', 'app/+not-found.tsx']) {
  assert(exists(route), `${route} must exist.`);
}
assert(shell.includes('Browser foundation only'), 'The pilot must visibly identify its safety boundary.');
assert(shell.includes('Live account data is intentionally unavailable'), 'The pilot must not present fixtures as live project truth.');
assert(shell.includes('hasMounted && width >= 900'), 'Responsive navigation must not diverge during static hydration.');
assert(!shell.includes('@supabase/supabase-js'), 'The first browser shell must not bypass the reviewed authentication gate.');

console.log('PASS Phase 3 read-only web foundation');
