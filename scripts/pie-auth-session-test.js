const fs = require('fs');
const path = require('path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'screens/AdminScreen.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function indexOfRequired(source, needle, message) {
  const index = source.indexOf(needle);
  assert(index >= 0, message);
  return index;
}

assert(
  supabase.includes("status: sessionTokenPresent ? 'token_present' : 'token_missing'") &&
    supabase.includes('? session.access_token') &&
    supabase.includes("authState: 'signed_in'"),
  'signed-in Supabase session returns token_present with the current access token',
);

assert(
  supabase.includes('await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);') &&
    admin.includes("event === 'SIGNED_OUT'") &&
    admin.includes('userEmail: result.data?.user?.email || email'),
  'Settings waits for stored-session hydration and applies successful auth state immediately',
);

assert(
  admin.includes('connectionStatus?.clientReady') &&
    admin.includes('connectionStatus.authenticated') &&
    !admin.includes('const connected = testResult?.connected ?? false'),
  'Settings connection badge follows the authenticated session instead of a separate project-table test',
);

assert(
  admin.includes('const statusRefreshRunRef = useRef(0)') &&
    admin.includes('statusRefreshRunRef.current === refreshRun') &&
    admin.includes('if (!isCurrentRefresh()) return;'),
  'an older Settings refresh cannot overwrite a newer authenticated session',
);

assert(
  supabase.includes("missingReason: storageAvailable ? 'signed_out' : 'storage_unavailable'") &&
    workflow.includes("'Sign in required for photo intelligence'") &&
    supabase.includes("appAuthMode") &&
    supabase.includes("'local_only'") &&
    !workflow.includes('Photo intelligence needs a signed-in cloud session before comparing photos.'),
  'main UI can operate local-only and signed-out token lookup returns signed_out instead of a generic connection failure',
);

assert(
    app.includes('function PhotoIntelligenceSignInModal') &&
    app.includes('Sign in to enable photo intelligence') &&
    app.includes('Use the email and password for your cloud sync account') &&
    app.includes('Do not use Apple Developer, Expo, or TestFlight credentials') &&
    app.includes('onSignInRequired') &&
    app.includes('pieResultRequiresSupabaseSignIn'),
  'sign-in-required PIE state includes a sign-in action, not only Retry',
);

assert(
  supabase.includes('export async function signUp') &&
    supabase.includes('client.auth.signUp') &&
    app.includes('EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP') &&
    app.includes('developmentSignupEnabled') &&
    app.includes('Create or sign in development account') &&
    envExample.includes('EXPO_PUBLIC_ENABLE_DEV_AUTH_SIGNUP=false') &&
    !app.includes('SUPABASE_SERVICE_ROLE_KEY') &&
    !supabase.includes('SUPABASE_SERVICE_ROLE_KEY'),
  'development-only test user creation uses Supabase anon auth and no service-role key in mobile code',
);

assert(
  app.includes('const result = await signIn({ email, password: photoAuthPassword });') &&
    app.includes('const tokenResult = await getCurrentSessionAccessToken();') &&
    app.includes("tokenLookup?.status !== 'token_present'"),
  'after sign-in, getCurrentSessionAccessToken is checked for token_present',
);

assert(
  workflow.includes("reason === 'auth_loading'") &&
    workflow.includes('buildPreparingSecurePhotoAnalysisState') &&
    app.includes('photoIntelligenceNeedsAuthHydrationRetry') &&
    app.includes('waitForPIEAuthHydrationRetry'),
  'auth-loading state is temporary and the app retries after hydration',
);

assert(
  app.includes('retryAttempt: true') &&
    app.includes('requestPhotoIntelligenceSignIn') &&
    app.includes('runPhotoAnalysisRetry') &&
    workflow.includes('retryFetchedFreshToken: retryAttempt') &&
    workflow.includes('const sessionTokenResult = await getCurrentSessionAccessToken();'),
  'Retry Analysis routes to sign-in while signed out and fetches a fresh Supabase session token after sign-in',
);

const tokenLookupIndex = indexOfRequired(
  workflow,
  "tokenLookup.status !== 'token_present'",
  'workflow checks for token_present before analysis',
);
const invokeIndex = indexOfRequired(
  workflow,
  "client.functions.invoke('pie-photo-vision'",
  'workflow invokes the deployed pie-photo-vision Edge Function',
);
assert(tokenLookupIndex < invokeIndex, 'missing token cannot invoke pie-photo-vision');

assert(
  workflow.includes('Authorization: `Bearer ${tokenLookup.accessToken}`'),
  'valid token invokes pie-photo-vision with Authorization Bearer session token',
);

assert(
  app.includes("'analysis_failed_retry'") &&
    app.includes("'comparison_unavailable'") &&
    app.includes('!pieResultSupportsInterpretations(result)'),
  'auth/session failures are not rendered under Possible interpretations',
);

assert(
  app.includes('analysisTimeTextForPIEResult') &&
    app.includes("'Analysis time unavailable'") &&
    !app.includes('<PIEDetailLine label="Analysis time" value={formatDisplayDate(result.updatedAt)} />'),
  'invalid analysis timestamps do not render Invalid Date',
);

assert(
  workflow.includes('supabaseAuthState:') &&
    workflow.includes('sessionTokenPresent:') &&
    workflow.includes('lastAuthEvent:') &&
    workflow.includes('tokenLookupResult:') &&
    workflow.includes('authHydrationCompleted:') &&
    workflow.includes('edgeFunctionStatus:') &&
    !app.includes('Supabase auth state:') &&
    !app.includes('Session token present:'),
  'auth/session diagnostics must remain available internally without appearing in the PM UI',
);

assert(
  app.includes("if (reason === 'expired_session') return PIE_STATUS_COPY.sessionExpired;") &&
    app.includes("tokenLookup?.missingReason === 'expired_session'"),
  'expired sessions show Session expired and route to sign-in before retry',
);
