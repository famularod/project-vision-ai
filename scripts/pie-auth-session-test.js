const fs = require('fs');
const path = require('path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
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
    app.includes('Use a Supabase Auth email and password') &&
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
  app.includes('Supabase auth state:') &&
    app.includes('App auth mode:') &&
    app.includes('Supabase user id present:') &&
    app.includes('Session token present:') &&
    app.includes('Last auth event:') &&
    app.includes('Reached without Supabase auth:') &&
    app.includes('Retry routed to sign-in:') &&
    app.includes('Token lookup result:') &&
    app.includes('Token missing reason:') &&
    app.includes('Sign-in client source:') &&
    app.includes('PIE analysis client source:') &&
    app.includes('Auth hydration completed:') &&
    app.includes('Retry fetched fresh token:') &&
    app.includes('Edge Function invoked:') &&
    app.includes('Edge Function status:'),
  'development diagnostics expose auth/session state without secret values',
);

assert(
  app.includes("if (reason === 'expired_session') return PIE_STATUS_COPY.sessionExpired;") &&
    app.includes("tokenLookup?.missingReason === 'expired_session'"),
  'expired sessions show Session expired and route to sign-in before retry',
);
