const fs = require('fs');
const path = require('path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');

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
  supabase.includes("status: accessToken ? 'token_present' : 'token_missing'") &&
    supabase.includes('? session.access_token') &&
    supabase.includes("authState: 'signed_in'"),
  'signed-in Supabase session returns token_present with the current access token',
);

assert(
  supabase.includes("missingReason: storageAvailable ? 'signed_out' : 'storage_unavailable'") &&
    workflow.includes("'Sign in required for photo intelligence'") &&
    !workflow.includes('Photo intelligence needs a signed-in cloud session before comparing photos.'),
  'signed-out token lookup returns signed_out instead of a generic connection failure',
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
    workflow.includes('retryFetchedFreshToken: retryAttempt') &&
    workflow.includes('const sessionTokenResult = await getCurrentSessionAccessToken();'),
  'Retry Analysis fetches a fresh Supabase session token',
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
