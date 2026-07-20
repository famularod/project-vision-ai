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
const provider = read('components/web-shell/desktop-auth-provider.tsx');
const browserAuthStorage = read('services/SupabaseAuthStorage.web.ts');
const readOnlyRepository = read('services/DAVEWebReadOnlyRepository.ts');
const webSupabaseClient = read('services/DAVEWebSupabaseClient.ts');

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
for (const route of ['app/_layout.tsx', 'app/index.tsx', 'app/projects.tsx', 'app/tasks.tsx', 'app/evidence.tsx', 'app/photos.tsx', 'app/documents.tsx', 'app/reports.tsx', 'app/settings.tsx', 'app/+not-found.tsx']) {
  assert(exists(route), `${route} must exist.`);
}
assert(shell.includes('Owner-authorized staging session'), 'The pilot must visibly identify its authorization boundary.');
assert(shell.includes('Project deletion, file uploads, report approval, and sending remain disabled'), 'The pilot must visibly preserve non-task mutation boundaries.');
assert(shell.includes('Cloud task accounting'), 'The Command Center must expose an auditable task total breakdown.');
assert(shell.includes('Sync from Cloud Now'), 'The browser must expose its cloud refresh action in Settings.');
assert(!provider.includes('SupabaseService'), 'The web provider must not import the native sync service.');
assert(provider.includes('loadDAVEWebReadOnlySnapshot'), 'The provider must load only through the reviewed read-only repository.');
assert(webSupabaseClient.includes("client.rpc('dave_is_app_owner')"), 'Every snapshot load must pass the server owner check first.');
assert(webSupabaseClient.includes(".from(table)") && webSupabaseClient.includes(".eq('owner_id', ownerId)"), 'Every desktop collection must be explicitly owner-scoped in addition to RLS.');
assert(webSupabaseClient.includes("'dave_sync_tombstones'"), 'The browser must load owner-scoped deletion history before counting cloud records.');
assert(readOnlyRepository.includes('isDAVESafeCloudScheduleRecord'), 'The browser must reject unsafe legacy schedule rows.');
assert(readOnlyRepository.includes('selectAuthoritativeScheduleItems'), 'The browser must count only the authoritative current schedule.');
assert(readOnlyRepository.includes('scheduleOverviewProjectNames'), 'The browser must use the mobile parent-project portfolio scope.');
for (const forbiddenMutation of ['createProject(', 'updateProject(', 'deleteProject(', 'saveProjectUpdate(', 'upsertScheduleItem(', 'upsertReferenceDocument(']) {
  assert(!readOnlyRepository.includes(forbiddenMutation), `The read-only repository must not call ${forbiddenMutation}.`);
}
assert(!webSupabaseClient.includes(".from('projects').update("), 'The browser gateway must not expose project editing.');
assert(!webSupabaseClient.includes(".from('projects').delete("), 'The browser gateway must not expose project deletion.');
assert(!webSupabaseClient.includes('.storage.'), 'The browser gateway must not expose file storage mutations.');
assert(!webSupabaseClient.includes('expo-file-system'), 'The browser Supabase gateway must not import native file support.');
assert(!webSupabaseClient.includes('expo-secure-store'), 'The browser Supabase gateway must not import native SecureStore.');
assert(!readOnlyRepository.includes("from '@react-native-async-storage/async-storage'"), 'The browser read repository must not import native AsyncStorage.');
assert(browserAuthStorage.includes('window.sessionStorage'), 'Browser sessions must use the reviewed tab-scoped adapter.');
assert(!browserAuthStorage.includes('window.localStorage'), 'Browser auth tokens must not persist in localStorage.');
assert(!browserAuthStorage.includes("from '@react-native-async-storage/async-storage'"), 'The browser auth adapter must not fall back to native AsyncStorage.');
assert(!browserAuthStorage.includes("from 'expo-secure-store'"), 'The browser bundle must not import native SecureStore.');

console.log('PASS Phase 3 authorized read-only web pilot');
