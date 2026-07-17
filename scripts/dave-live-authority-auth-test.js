#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

assert(
  app.includes('subscribeToAuthStateChange'),
  'live authority identity must refresh when the Supabase session changes',
);
assert(
  app.includes('scheduleIdentityRefresh();'),
  'initial load and auth changes must schedule identity resolution safely',
);
assert(
  app.includes("layer4Identity.organizationStatus === 'verified'"),
  'live authority must trust only a verified organization identity',
);
assert(
  app.includes('organizationId: layer4Identity?.cloudTrusted'),
  'the verified organization must reach the live authority provider',
);
assert(
  !app.includes('identityTrusted: false,\n      cloudAvailable: false,'),
  'the live authority must not be permanently forced into degraded mode',
);

console.log('DAVE live authority auth transition checks passed.');
